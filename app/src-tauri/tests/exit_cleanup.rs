//! 종료 시 정리 통합 테스트 — 실제 프로세스를 띄운다(가짜 엔진 폴더 + 실제 python).
//!
//! 앱이 끝날 때 돌고 있던 엔진 프로세스와 계정 수집 프로세스가 **자식까지** 함께 끝나는지 본다:
//!
//! - `killed`: 실행 파일이 밖에서 끝내졌다(작업 관리자의 프로세스 종료, 충돌) — 정리할 틈이 없다
//! - `drops`: 실행 파일이 아무 정리 없이 스스로 끝났다(`std::process::exit`) — 종료 처리가 시간 안에 못 끝낸 경우
//! - `quits`: 앱이 끝나는 길 그대로 — 도는 일을 멈추고(`engine::stop_all_and_wait`, `lib.rs`의 `stop_running_work`가
//!   부르는 함수) 끝난다(끝내기 단추, 창 닫기)
//!
//! 「실행 파일」은 이 테스트 실행 파일을 한 번 더 띄운 것이다(`exit_cleanup_host_process`를 환경 변수와 함께 실행한다).
//! 그 프로세스가 앱이 쓰는 함수 그대로(`engine::run_batch_with_stop`, `account_sync::fetch_profile` — Tauri 명령
//! `engine_run_batch`·`account_fetch_profile`이 부르는 것) 오래 도는 가짜 엔진과 가짜 수집 스크립트를 띄운다.
//! 둘 다 자식 프로세스를 하나씩 더 띄우고 멈춰 있다. 이 테스트가 그 실행 파일을 끝낸 뒤, 그 자손이 수 초 안에
//! 하나도 남지 않는지 시스템 프로세스 목록으로 확인한다.
//!
//! `killed`·`drops`는 Windows의 프로세스 묶음(Job Object의 「닫히면 끝낸다」 — `src/engine_win32.rs`)에 기대므로
//! Windows에서만 돈다. 실제 엔진·실제 쿠키·네트워크는 쓰지 않는다(쿠키는 지어낸 글자다).

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use nikke_companion_lib::account_sync::{self, FetchConfig, FetchLine, FETCH_SCRIPT};
use nikke_companion_lib::engine::{self, BatchSlot, EngineConfig, DEFAULT_TIMEOUT, EXIT_GRACE};
use serde_json::json;

/// 이 환경 변수가 있으면 이 테스트 실행 파일은 「끝내질 실행 파일」 노릇을 한다. 값은 끝나는 방식이다.
const HOST_MODE: &str = "NIKKE_EXIT_CLEANUP_HOST";
/// 가짜 엔진 폴더.
const HOST_ENGINE_DIR: &str = "NIKKE_EXIT_CLEANUP_ENGINE_DIR";
/// 실행 파일 노릇을 하는 테스트의 이름.
const HOST_TEST: &str = "exit_cleanup_host_process";

/// 실행 파일이 「엔진과 수집 스크립트, 그 자식들이 모두 떴다」를 알리는 줄.
const READY: &str = "EXIT-CLEANUP-READY";
/// `quits`에서 종료 처리가 끝났음을 알리는 줄(뒤에 true/false).
const STOPPED: &str = "EXIT-CLEANUP-STOPPED";
/// 이 파일이 생기면 실행 파일이 스스로 끝난다(`drops`·`quits`).
const GO_FILE: &str = "go";

/// 실행 파일을 끝낸 뒤 자식 프로세스가 사라질 때까지 봐주는 시간.
const GONE_WITHIN: Duration = Duration::from_secs(5);
/// 실행 파일이 엔진·수집 스크립트를 띄울 때까지 기다리는 시간.
const STARTUP: Duration = Duration::from_secs(90);

/// 지어낸 쿠키. 실제 계정의 값이 아니다.
const FAKE_COOKIE: &str = "game_token=FAKE-EXIT-CLEANUP-TOKEN-0123456789; game_openid=11112222333344445555";

/// 테스트를 하나씩 돌린다 — 프로세스 목록을 세므로 서로 섞이면 안 된다.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn python() -> String {
    std::env::var(engine::ENV_PYTHON).unwrap_or_else(|_| "python".to_string())
}

// ── 가짜 엔진 ─────────────────────────────────────────────────────────────────

/// 가짜 엔진: 요청을 받으면 자식 프로세스를 하나 띄우고 결과 한 줄을 낸 뒤 끝나지 않는다.
const FAKE_SIM: &str = r#"
import json, subprocess, sys, time
for line in sys.stdin:
    if not line.strip():
        continue
    req = json.loads(line)
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
    print(json.dumps({"id": req["id"], "child": child.pid}))
    sys.stdout.flush()
    time.sleep(600)
"#;

/// 가짜 수집 스크립트: 자식 프로세스를 하나 띄우고 줄 하나를 낸 뒤 끝나지 않는다. 네트워크 요청은 없다.
const FAKE_FETCH: &str = r#"
import subprocess, sys, time
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
print("[+] 상세 수집 중… (끝나지 않는 가짜 스크립트)")
sys.stdout.flush()
time.sleep(600)
"#;

struct FakeEngine(PathBuf);

impl FakeEngine {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-exit-cleanup-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("runner")).expect("임시 엔진 폴더");
        fs::create_dir_all(dir.join("scraper")).expect("scraper 폴더");
        fs::write(dir.join("runner/__init__.py"), "").expect("__init__.py");
        fs::write(dir.join("runner/sim.py"), FAKE_SIM).expect("sim.py");
        fs::write(dir.join(FETCH_SCRIPT), FAKE_FETCH).expect("가짜 수집 스크립트");
        account_sync::store_pasted_cookie(&dir, FAKE_COOKIE).expect("지어낸 쿠키 저장");
        Self(dir)
    }
}

impl Drop for FakeEngine {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// ── 끝내질 실행 파일 노릇 ─────────────────────────────────────────────────────

fn say(line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

/// 앱처럼 엔진 배치와 계정 수집을 돌리다가, 정해진 방식으로 끝난다(또는 끝내지기를 기다린다).
fn run_host(mode: &str, engine_dir: &Path) -> ! {
    let config = EngineConfig {
        engine_dir: engine_dir.to_path_buf(),
        python: python(),
        concurrency: 2,
        timeout: DEFAULT_TIMEOUT,
    };
    let fetch_config = FetchConfig {
        engine_dir: engine_dir.to_path_buf(),
        python: python(),
        timeout: DEFAULT_TIMEOUT,
    };
    // 앱의 `EngineRun`·`FetchRun`과 같은 자리.
    let engine_run: &'static BatchSlot = Box::leak(Box::default());
    let fetch_run: &'static BatchSlot = Box::leak(Box::default());
    let rows: &'static AtomicUsize = Box::leak(Box::default());
    let fetching: &'static AtomicBool = Box::leak(Box::default());

    thread::spawn(move || {
        let ticket = engine_run.begin().expect("엔진 자리");
        let progress = |done: usize, _total: usize| {
            rows.fetch_max(done, Ordering::Relaxed);
        };
        let requests = [json!({ "squad": ["크라운"] }), json!({ "squad": ["헬름"] })];
        let outcome =
            engine::run_batch_with_stop(&config, &requests, Some(&progress), ticket.signal());
        say(&format!("EXIT-CLEANUP-ENGINE-ENDED {}", outcome.is_ok()));
    });
    thread::spawn(move || {
        let ticket = fetch_run.begin().expect("수집 자리");
        let on_line = |_line: &FetchLine| fetching.store(true, Ordering::Relaxed);
        let outcome = account_sync::fetch_profile(&fetch_config, "me", &on_line, ticket.signal());
        say(&format!("EXIT-CLEANUP-FETCH-ENDED {}", outcome.is_ok()));
    });

    // 엔진 프로세스 둘이 결과 줄을 냈고 수집 스크립트가 줄을 냈으면, 그 자식들도 모두 떠 있다.
    let started = Instant::now();
    while rows.load(Ordering::Relaxed) < 2 || !fetching.load(Ordering::Relaxed) {
        if started.elapsed() > STARTUP {
            say("EXIT-CLEANUP-FAILED 가짜 엔진·수집 스크립트가 뜨지 않았다");
            std::process::exit(3);
        }
        thread::sleep(Duration::from_millis(20));
    }
    say(READY);

    let go = engine_dir.join(GO_FILE);
    loop {
        if mode != "killed" && go.exists() {
            break;
        }
        // `killed`는 여기서 끝내지기를 기다린다. 아무도 끝내지 않으면(테스트가 죽었다) 스스로 끝난다.
        if started.elapsed() > STARTUP + Duration::from_secs(60) {
            std::process::exit(4);
        }
        thread::sleep(Duration::from_millis(20));
    }
    if mode == "quits" {
        // 앱이 끝나는 길(`lib.rs`의 `stop_running_work`)과 같은 호출.
        let stopped = engine::stop_all_and_wait(&[engine_run, fetch_run], EXIT_GRACE);
        say(&format!("{STOPPED} {stopped}"));
    }
    // `drops`는 아무 정리 없이 끝난다.
    std::process::exit(0);
}

/// 평소에는 아무것도 하지 않는다. 환경 변수와 함께 실행됐을 때만 「끝내질 실행 파일」 노릇을 한다.
#[test]
fn exit_cleanup_host_process() {
    let (Ok(mode), Ok(dir)) = (std::env::var(HOST_MODE), std::env::var(HOST_ENGINE_DIR)) else {
        return;
    };
    run_host(&mode, Path::new(&dir));
}

// ── 프로세스 목록 ─────────────────────────────────────────────────────────────

#[cfg(windows)]
mod processes {
    use std::collections::{HashMap, HashSet};
    use std::mem::size_of;

    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    /// 시스템의 모든 프로세스: 번호 → (부모 번호, 실행 파일 이름).
    pub fn all() -> HashMap<u32, (u32, String)> {
        let mut found = HashMap::new();
        // SAFETY: 프로세스 목록의 스냅숏을 읽기만 한다. 어떤 프로세스도 열지 않는다.
        unsafe {
            let snapshot =
                CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).expect("프로세스 목록");
            let mut entry = PROCESSENTRY32W {
                dwSize: size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|c| *c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    found.insert(
                        entry.th32ProcessID,
                        (
                            entry.th32ParentProcessID,
                            String::from_utf16_lossy(&entry.szExeFile[..len]),
                        ),
                    );
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        found
    }

    /// 지금 있는 프로세스 번호들. 실행 파일을 띄우기 전에 적어 둔다 — 그때 이미 있던 프로세스는 자손일 수 없다
    /// (Windows는 끝난 프로세스의 번호를 다시 쓰므로 부모 번호만으로는 남의 프로세스가 자손으로 세어질 수 있다).
    pub fn baseline() -> HashSet<u32> {
        all().into_keys().collect()
    }

    /// 그 프로세스의 자손들(번호, 실행 파일 이름) — `baseline` 뒤에 생긴 것만.
    pub fn descendants_of(root: u32, baseline: &HashSet<u32>) -> Vec<(u32, String)> {
        let all = all();
        let mut family: HashSet<u32> = HashSet::from([root]);
        loop {
            let before = family.len();
            for (pid, (parent, _)) in &all {
                if family.contains(parent) && !baseline.contains(pid) {
                    family.insert(*pid);
                }
            }
            if family.len() == before {
                break;
            }
        }
        family.remove(&root);
        let mut found: Vec<(u32, String)> = family
            .into_iter()
            .map(|pid| (pid, all[&pid].1.clone()))
            .collect();
        found.sort();
        found
    }

    /// 주어진 프로세스들 가운데 아직 살아 있는 것(번호와 이름이 그대로인 것).
    pub fn still_alive(recorded: &[(u32, String)]) -> Vec<(u32, String)> {
        let all = all();
        recorded
            .iter()
            .filter(|(pid, name)| all.get(pid).is_some_and(|(_, now)| now == name))
            .cloned()
            .collect()
    }
}

/// 다른 OS에서는 프로세스 목록을 보지 않는다(끝나는 것과 종료 처리의 결과만 확인한다).
#[cfg(not(windows))]
mod processes {
    use std::collections::HashSet;

    pub fn baseline() -> HashSet<u32> {
        HashSet::new()
    }

    pub fn descendants_of(_root: u32, _baseline: &HashSet<u32>) -> Vec<(u32, String)> {
        Vec::new()
    }

    pub fn still_alive(_recorded: &[(u32, String)]) -> Vec<(u32, String)> {
        Vec::new()
    }
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

/// 조건이 참이 될 때까지 기다린다. 끝내 안 되면 `false`.
fn wait_until(limit: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let started = Instant::now();
    loop {
        if condition() {
            return true;
        }
        if started.elapsed() >= limit {
            return false;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// 띄운 실행 파일. 테스트가 실패해도 남기지 않는다.
struct Host {
    child: Child,
    lines: Receiver<String>,
    seen: Vec<String>,
}

impl Host {
    fn launch(mode: &str, engine_dir: &Path) -> Self {
        let exe = std::env::current_exe().expect("테스트 실행 파일의 경로");
        let mut child = Command::new(exe)
            .args([HOST_TEST, "--exact", "--nocapture", "--test-threads=1"])
            .env(HOST_MODE, mode)
            .env(HOST_ENGINE_DIR, engine_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("실행 파일을 띄우지 못했다");
        let stdout = child.stdout.take().expect("표준 출력");
        let (tx, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            lines,
            seen: Vec::new(),
        }
    }

    /// 그 표지가 든 줄이 나올 때까지 기다려, 표지부터 줄 끝까지를 돌려준다.
    /// (테스트 하네스가 같은 줄 앞에 `test 이름 ... `을 찍어 두므로 줄의 처음이 아닐 수 있다.)
    fn wait_for(&mut self, marker: &str, limit: Duration) -> Option<String> {
        let deadline = Instant::now() + limit;
        loop {
            let left = deadline.checked_duration_since(Instant::now())?;
            let line = self.lines.recv_timeout(left).ok()?;
            self.seen.push(line.clone());
            if let Some(at) = line.find(marker) {
                return Some(line[at..].trim().to_string());
            }
        }
    }

    /// 실행 파일이 끝날 때까지 기다린다. 시간 안에 끝났으면 `true`.
    fn wait_exit(&mut self, limit: Duration) -> bool {
        wait_until(limit, || matches!(self.child.try_wait(), Ok(Some(_))))
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn is_python(name: &str) -> bool {
    name.to_lowercase().starts_with("py")
}

/// 실행 파일을 띄워 엔진·수집 프로세스가 돌게 한 뒤 `end`로 끝내고, 그 자손이 수 초 안에 남지 않는지 본다.
fn children_are_gone_after(mode: &str, end: impl FnOnce(&mut Host, &Path)) {
    let _serial = serial();
    let fake = FakeEngine::new(mode);
    let baseline = processes::baseline();
    let mut host = Host::launch(mode, &fake.0);
    let host_pid = host.child.id();

    let ready = host.wait_for(READY, STARTUP);
    assert!(
        ready.is_some(),
        "실행 파일이 엔진·수집 프로세스를 띄우지 못했다. 나온 줄: {:?}",
        host.seen
    );
    let running = processes::descendants_of(host_pid, &baseline);
    println!("[{mode}] 끝내기 직전에 떠 있던 자손: {running:?}");
    // 엔진 프로세스 둘 + 그 자식 둘 + 수집 스크립트 + 그 자식(Windows에서만 센다).
    #[cfg(windows)]
    assert!(
        running.iter().filter(|(_, name)| is_python(name)).count() >= 6,
        "엔진·수집 프로세스와 그 자식이 다 보이지 않았다: {running:?}"
    );

    let asked = Instant::now();
    end(&mut host, &fake.0);
    assert!(
        host.wait_exit(GONE_WITHIN + EXIT_GRACE),
        "실행 파일이 끝나지 않았다. 나온 줄: {:?}",
        host.seen
    );
    let gone = wait_until(GONE_WITHIN, || {
        processes::still_alive(&running).is_empty()
            && processes::descendants_of(host_pid, &baseline).is_empty()
    });
    println!("[{mode}] 끝낸 뒤 자손이 사라지기까지 {:?}", asked.elapsed());
    assert!(
        gone,
        "실행 파일이 끝난 뒤에도 그 자식 프로세스가 남아 있다: {:?} / {:?}",
        processes::still_alive(&running),
        processes::descendants_of(host_pid, &baseline)
    );
}

/// 끝내기 단추·창 닫기: 앱이 끝나는 길에서 도는 일을 멈추고 끝난다. 종료 처리는 시간 안에 끝났다고 답한다.
#[test]
fn quitting_stops_the_engine_and_the_fetch_with_their_children() {
    children_are_gone_after("quits", |host, dir| {
        fs::write(dir.join(GO_FILE), "").expect("끝내라는 표시");
        let stopped = host.wait_for(STOPPED, GONE_WITHIN + EXIT_GRACE);
        assert_eq!(
            stopped.as_deref(),
            Some("EXIT-CLEANUP-STOPPED true"),
            "종료 처리가 엔진·수집을 제때 멈추지 못했다. 나온 줄: {:?}",
            host.seen
        );
    });
}

/// 프로세스 종료(작업 관리자, 충돌): 정리할 틈 없이 끝내져도 자식까지 끝난다.
#[cfg(windows)]
#[test]
fn killing_the_executable_leaves_no_engine_or_fetch_process_behind() {
    children_are_gone_after("killed", |host, _dir| {
        host.child.kill().expect("실행 파일을 끝내지 못했다");
    });
}

/// 종료 처리 없이 스스로 끝나도(종료 처리가 시간 안에 못 끝냈을 때와 같다) 자식까지 끝난다.
#[cfg(windows)]
#[test]
fn exiting_without_cleanup_still_ends_the_children() {
    children_are_gone_after("drops", |_host, dir| {
        fs::write(dir.join(GO_FILE), "").expect("끝내라는 표시");
    });
}
