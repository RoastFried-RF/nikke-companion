//! 엔진 배치 중단 통합 테스트 — 실제 엔진(vendor/nikke-calc)과 실제 python을 띄운다.
//!
//! - 긴 배치를 시작하고 도는 중에 멈추면: 수 초 안에 '중단됨' 오류로 돌아오고, 이 테스트가 띄운 엔진 프로세스가
//!   하나도 남지 않는다(Windows에서는 시스템 프로세스 목록으로 확인한다)
//! - 멈춘 뒤에 다시 실행할 수 있다(같은 자리 `BatchSlot`으로)
//! - 엔진 프로세스가 띄운 프로세스(가짜 엔진의 자식)도 함께 끝난다
//!
//! Tauri 명령 `engine_run_batch`·`engine_cancel`(src/lib.rs)은 `BatchSlot`과 `run_batch_with_stop`을 그대로 쓴다.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use nikke_companion_lib::engine::{
    self, BatchSlot, EngineConfig, EngineError, EngineSettings, StopSignal, DEFAULT_TIMEOUT,
    STOPPED_PREFIX,
};
use serde_json::{json, Value};

/// 중단을 청한 뒤 호출이 돌아올 때까지 봐주는 시간.
const RETURN_WITHIN: Duration = Duration::from_secs(5);

/// 테스트를 하나씩 돌린다 — "이 테스트 프로세스가 띄운 프로세스"를 세므로 서로 섞이면 안 된다.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn real_config(concurrency: usize) -> EngineConfig {
    let settings = EngineSettings {
        concurrency: Some(concurrency),
        ..EngineSettings::default()
    };
    engine::resolve_config(&settings, |name| std::env::var(name).ok(), &[repo_root()])
        .expect("vendor/nikke-calc 서브모듈이 있어야 한다")
}

/// 실제 엔진으로 몇 초씩 걸리는 요청(180초 전투의 기대값 시뮬).
fn long_sim(i: usize) -> Value {
    let squads: [&[&str]; 4] = [
        &["크라운", "헬름", "앨리스"],
        &["헬름", "크라운", "앨리스"],
        &["앨리스", "크라운", "헬름"],
        &["크라운", "앨리스", "헬름"],
    ];
    json!({ "squad": squads[i % squads.len()], "sim": { "expected": true, "duration": 180 } })
}

/// 이 테스트 프로세스가 띄운 프로세스들(자식, 그 자식…)의 번호와 실행 파일 이름.
#[cfg(windows)]
mod processes {
    use std::collections::{HashMap, HashSet};
    use std::mem::size_of;
    use std::sync::Mutex;

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

    /// 테스트를 시작할 때 이미 있던 프로세스들. 프로세스 목록은 부모의 **번호**만 알려 주는데 Windows는 끝난 프로세스의
    /// 번호를 다시 쓴다 — 오래전에 끝난 부모의 번호를 이 테스트의 자식이 물려받으면, 그 부모가 띄웠던 남의 프로세스
    /// (실제로 Overwolf 여덟 개가 그랬다)가 이 테스트의 자손으로 잘못 세어진다. 시작 전에 있던 프로세스는 자손일 수 없다.
    static BASELINE: Mutex<Option<HashSet<u32>>> = Mutex::new(None);

    /// 지금 있는 프로세스를 "시작 전에 있던 것"으로 적어 둔다. 테스트마다 무엇을 띄우기 전에 부른다.
    pub fn mark_start() {
        let now: HashSet<u32> = all().into_keys().collect();
        *BASELINE.lock().unwrap_or_else(|e| e.into_inner()) = Some(now);
    }

    /// 이 테스트 프로세스의 자손들(테스트를 시작한 뒤에 생긴 것만).
    pub fn spawned_by_this_test() -> Vec<(u32, String)> {
        let all = all();
        let baseline = BASELINE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or_default();
        let mut family: HashSet<u32> = HashSet::from([std::process::id()]);
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
        family.remove(&std::process::id());
        let mut spawned: Vec<(u32, String)> = family
            .into_iter()
            .map(|pid| (pid, all[&pid].1.clone()))
            .collect();
        spawned.sort();
        spawned
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

/// 다른 OS에서는 프로세스 목록을 보지 않는다(돌아오는 시간과 오류만 확인한다).
#[cfg(not(windows))]
mod processes {
    pub fn mark_start() {}

    pub fn spawned_by_this_test() -> Vec<(u32, String)> {
        Vec::new()
    }

    pub fn still_alive(_recorded: &[(u32, String)]) -> Vec<(u32, String)> {
        Vec::new()
    }
}

fn is_python(name: &str) -> bool {
    name.to_lowercase().starts_with("py")
}

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

/// 이 테스트가 띄워 둔 프로세스들(번호, 실행 파일 이름).
type Spawned = Vec<(u32, String)>;

/// 배치를 돌리다가 `ready`가 참이 되면 멈추고, (결과, 중단을 청한 뒤 돌아올 때까지 걸린 시간, 멈추기 직전에
/// 이 테스트가 띄워 둔 프로세스들)을 돌려준다.
fn run_then_stop(
    config: &EngineConfig,
    requests: &[Value],
    stop: &StopSignal,
    done: &AtomicUsize,
    ready: impl Fn() -> bool,
) -> (Result<Vec<Value>, EngineError>, Duration, Spawned) {
    let on_progress = |finished: usize, _total: usize| {
        done.fetch_max(finished, Ordering::Relaxed);
    };
    thread::scope(|scope| {
        let batch =
            scope.spawn(|| engine::run_batch_with_stop(config, requests, Some(&on_progress), stop));
        let started = wait_until(Duration::from_secs(120), || batch.is_finished() || ready());
        let running = processes::spawned_by_this_test();
        let asked = Instant::now();
        stop.stop();
        let outcome = batch.join().expect("배치 스레드");
        let took = asked.elapsed();
        assert!(started, "엔진이 돌기 시작하지 않았다: {outcome:?}");
        (outcome, took, running)
    })
}

/// 이 테스트가 띄운 프로세스가 하나도 남지 않을 때까지 잠깐 기다린 뒤 확인한다.
fn assert_nothing_left(recorded: &[(u32, String)]) {
    wait_until(Duration::from_secs(3), || {
        processes::still_alive(recorded).is_empty() && processes::spawned_by_this_test().is_empty()
    });
    assert_eq!(
        processes::still_alive(recorded),
        Vec::new(),
        "멈춘 뒤에도 엔진 프로세스가 남아 있다"
    );
    assert_eq!(
        processes::spawned_by_this_test(),
        Vec::new(),
        "멈춘 뒤에도 이 테스트가 띄운 프로세스가 남아 있다"
    );
}

#[test]
fn stopping_a_long_real_batch_returns_within_seconds_and_leaves_no_engine_process() {
    let _serial = serial();
    processes::mark_start();
    assert_eq!(processes::spawned_by_this_test(), Vec::new(), "시작 전에 띄워 둔 프로세스가 있다");

    // 40건 × 수 초: 멈추지 않으면 프로세스 4개로도 한참 걸린다.
    let config = real_config(4);
    let requests: Vec<Value> = (0..40).map(long_sim).collect();
    let slot = BatchSlot::default();
    let done = AtomicUsize::new(0);

    let ticket = slot.begin().expect("첫 배치");
    assert_eq!(slot.begin().unwrap_err(), EngineError::Busy, "도는 동안에는 겹쳐 띄우지 않는다");
    // 첫 결과가 나온 뒤에 멈춘다 — 엔진이 실제로 계산하는 중이고 나머지 요청이 남아 있다.
    // 중단 명령(`engine_cancel`)이 하는 일 그대로 자리(`BatchSlot`)를 통해 멈춘다.
    let (outcome, took, running) = run_then_stop(&config, &requests, ticket.signal(), &done, || {
        done.load(Ordering::Relaxed) >= 1
    });
    assert!(slot.stop(), "도는 배치가 있으면 중단 명령이 true를 돌려준다");
    drop(ticket);

    let finished = done.load(Ordering::Relaxed);
    println!(
        "중단: {finished}/{}건 끝난 뒤 멈춤, 돌아오기까지 {took:?}, 그때 띄워 둔 프로세스 {running:?}",
        requests.len()
    );
    let err = outcome.expect_err("멈춘 배치는 결과를 내지 않는다");
    assert_eq!(err, EngineError::Stopped);
    assert!(err.to_string().starts_with(STOPPED_PREFIX), "{err}");
    assert!(finished < requests.len(), "배치가 멈추기 전에 다 끝났다 — 중단을 확인하지 못했다");
    assert!(took < RETURN_WITHIN, "중단 뒤 돌아오기까지 {took:?} 걸렸다");

    // 멈추기 직전에는 엔진 프로세스가 돌고 있었고(Windows에서만 센다), 지금은 하나도 없다.
    #[cfg(windows)]
    {
        let pythons = running.iter().filter(|(_, name)| is_python(name)).count();
        assert!(pythons >= 1, "멈추기 전에 python 프로세스가 보이지 않았다: {running:?}");
    }
    assert_nothing_left(&running);

    // 멈춘 뒤에 다시 실행할 수 있다: 자리가 비었고, 새 배치는 앞 배치의 중단을 물려받지 않는다.
    assert!(!slot.is_running());
    assert!(!slot.stop(), "도는 배치가 없으면 중단 명령은 아무 일도 하지 않는다");
    let ticket = slot.begin().expect("중단 뒤 다시 실행");
    let again = [json!({ "squad": ["크라운", "헬름"], "sim": { "expected": true, "duration": 20 } })];
    let rows = engine::run_batch_with_stop(&config, &again, None, ticket.signal())
        .expect("중단 뒤의 배치는 끝까지 돈다");
    assert_eq!(rows.len(), 1);
    assert!(rows[0].get("error").is_none(), "{}", rows[0]);
    assert!(rows[0]["members"].as_array().is_some_and(|m| m.len() == 2));
    drop(ticket);
    assert_nothing_left(&running);
}

// ── 가짜 엔진: 프로세스를 하나 더 띄우고 멈춰 있는 runner.sim ─────────────────────

/// 요청을 받으면 자식 프로세스를 하나 띄우고(껍데기 실행기나 도중에 띄운 프로그램을 흉내 낸다) 결과 한 줄을 낸 뒤
/// 끝나지 않는다. 띄운 프로세스만 끝내면 그 자식이 남는다.
const FAKE_SIM_WITH_CHILD: &str = r#"
import json, subprocess, sys, time
for line in sys.stdin:
    if not line.strip():
        continue
    req = json.loads(line)
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
    print(json.dumps({"id": req["id"], "child": child.pid}))
    sys.stdout.flush()
    time.sleep(300)
"#;

struct FakeEngine(PathBuf);

impl FakeEngine {
    fn new(sim: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-fake-engine-cancel-{}",
            std::process::id()
        ));
        fs::create_dir_all(dir.join("runner")).expect("임시 엔진 폴더");
        fs::write(dir.join("runner/__init__.py"), "").expect("__init__.py");
        fs::write(dir.join("runner/sim.py"), sim).expect("sim.py");
        Self(dir)
    }
}

impl Drop for FakeEngine {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn stopping_also_ends_processes_the_engine_started() {
    let _serial = serial();
    processes::mark_start();
    assert_eq!(processes::spawned_by_this_test(), Vec::new(), "시작 전에 띄워 둔 프로세스가 있다");

    let fake = FakeEngine::new(FAKE_SIM_WITH_CHILD);
    let config = EngineConfig {
        engine_dir: fake.0.clone(),
        python: std::env::var(engine::ENV_PYTHON).unwrap_or_else(|_| "python".to_string()),
        concurrency: 2,
        timeout: DEFAULT_TIMEOUT,
    };
    let requests = [json!({ "squad": ["크라운"] }), json!({ "squad": ["헬름"] })];
    let stop = StopSignal::new();
    let done = AtomicUsize::new(0);
    // 두 프로세스가 모두 결과 줄을 냈으면 자식 프로세스도 떠 있다.
    let (outcome, took, running) =
        run_then_stop(&config, &requests, &stop, &done, || done.load(Ordering::Relaxed) >= 2);

    println!("가짜 엔진 중단: 돌아오기까지 {took:?}, 그때 띄워 둔 프로세스 {running:?}");
    assert_eq!(outcome, Err(EngineError::Stopped));
    assert!(took < RETURN_WITHIN, "중단 뒤 돌아오기까지 {took:?} 걸렸다");
    // 엔진 프로세스 둘 + 그 자식 둘이 떠 있었다(Windows에서만 센다).
    #[cfg(windows)]
    assert!(
        running.iter().filter(|(_, name)| is_python(name)).count() >= 4,
        "엔진 프로세스와 그 자식이 보이지 않았다: {running:?}"
    );
    assert_nothing_left(&running);
}
