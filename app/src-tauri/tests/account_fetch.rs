//! 계정 받기 통합 테스트 — **가짜 엔진 폴더와 가짜 수집 스크립트**로 실제 python을 띄운다.
//!
//! 실제 엔진의 `scraper/.session_cookie`·`profiles/`, 저장소의 `data/accounts/`는 읽지도 쓰지도 않는다. 쿠키는 지어낸
//! 글자이고, 프로필은 검증용 샘플(`data/samples/profile.sample.json`)이며, 네트워크 요청은 하나도 나가지 않는다
//! (가짜 스크립트는 파일을 읽고 쓰고 글자를 낼 뿐이다).
//!
//! - 성공: 프로필 파일이 생기고, 스크립트가 낸 줄이 하나도 빠지지 않고 차례대로 오며, 경고 줄(`[!]`)이 따로 모인다
//! - 쿠키 비노출: 스크립트가 쿠키를 출력해도 반환값·오류 문장·진행 줄·이 프로세스의 표준 출력에 가짜 쿠키가 없다
//!   (붙여넣기 길과 로그인 창 길 모두)
//! - 세션 만료·네트워크 오류·시간 초과·중단을 가려 한국어로 알린다. 시간 초과·중단은 스크립트와 그 자식 프로세스까지 끝낸다
//!
//! Tauri 명령(src/lib.rs의 `account_*`·`login_window_take_cookie`)은 여기서 부르는 함수를 그대로 쓴다.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use nikke_companion_lib::account_sync::{
    self, FetchConfig, FetchLine, FetchOutcome, SyncFailure, COOKIE_FILE, FETCH_SCRIPT,
    PROFILES_SUBDIR,
};
use nikke_companion_lib::cookie::{BrowserCookie, MASK};
use nikke_companion_lib::engine::{self, BatchSlot, EngineSettings, StopSignal, STOPPED_PREFIX};
use serde_json::Value;

/// 지어낸 쿠키. 실제 계정의 값이 아니다.
const TOKEN: &str = "FAKE-GAME-TOKEN-5d41402abc4b2a76b9719d911017c592";
const OPENID: &str = "40302010998877665544";
const SHORT: &str = "ko";

fn fake_cookie() -> String {
    format!("game_token={TOKEN}; game_openid={OPENID}; game_gameid=29080; lang={SHORT}")
}

/// 중단·시간 초과 뒤 호출이 돌아올 때까지 봐주는 시간.
const RETURN_WITHIN: Duration = Duration::from_secs(5);

/// 테스트를 하나씩 돌린다 — "이 테스트 프로세스가 띄운 프로세스"를 세므로 서로 섞이면 안 된다.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn python() -> String {
    std::env::var(engine::ENV_PYTHON).unwrap_or_else(|_| "python".to_string())
}

// ── 가짜 수집 스크립트 ────────────────────────────────────────────────────────

/// 모든 가짜 스크립트의 머리: 진짜 스크립트처럼 `--name`을 받고, 제 옆의 쿠키 파일을 읽는다.
const HEAD: &str = r#"
import argparse, json, os, subprocess, sys, time, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ap = argparse.ArgumentParser()
ap.add_argument("--name", default="me")
args = ap.parse_args()
cookie = open(os.path.join(HERE, ".session_cookie"), encoding="utf-8").read().strip()
pairs = dict(p.strip().split("=", 1) for p in cookie.split(";") if "=" in p)
"#;

/// 성공: 줄을 내고 프로필 파일을 쓴다. 도중에 **쿠키를 그대로 출력한다**(디버그 출력·오류 문장에 쿠키가 섞이는 경우).
const SUCCESS: &str = r#"
print(f"[+] openid {pairs['game_openid']} (area 83): 캐릭터 6종")
print("[debug] 보낸 헤더:", {"Cookie": cookie})
print("[debug] token =", pairs["game_token"], file=sys.stderr)
print("[debug] lang=" + pairs["lang"])
print("[+] 상세 수집 중… (동기화 소대 5종 · 소대 밖 1종)")
os.makedirs(os.path.join(ROOT, "profiles"), exist_ok=True)
profile = json.load(open(os.path.join(HERE, "sample_profile.json"), encoding="utf-8"))
profile["_meta"]["name"] = args.name
profile["_meta"]["openid"] = pairs["game_openid"]
json.dump(profile, open(os.path.join(ROOT, "profiles", args.name + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
print(f"[+] 프로필 저장: profiles/{args.name}.json  (6종, 1종 이름매핑 실패)")
print("    이름매핑 실패 name_code(신캐·미수집 가능): [9999]")
print("[!] 애장품 단계 3 미만 1명 — 그 단계의 스킬 판본으로 계산된다: {'헬름': 0}")
print("[!] 모르는 재활용 연구실 tid 1301 (lv 3) — 무시했다. 신규 역할군·기업이면 profile_fetch.py의 CONSOLE_TIDS에 추가하라")
print("[+] 동기화 소대 밖 1종 (참고) — 레벨은 정책이 정하므로 계산에는 영향이 없다: ['나가']")
print("[+] 소장품 미장착 0종 · 장비 4부위 전부 미장착 0종")
"#;

/// 세션 만료: 진짜 스크립트가 상세 요청에서 code 300001을 받았을 때 내는 문장 그대로.
const EXPIRED: &str = r#"
print(f"[+] openid {pairs['game_openid']} (area 83): 캐릭터 6종")
sys.exit("[!] GetUserCharacterDetails: 로그인 세션 만료 (game not login). 쿠키를 다시 받아라.")
"#;

/// 첫 요청이 거절됐을 때: 진짜 스크립트는 만료와 비공개 계정을 가르지 못하고 이 문장을 낸다(openid가 들어 있다).
const NO_CHARACTERS: &str = r#"
sys.exit(f"[!] openid {pairs['game_openid']}: 캐릭터를 못 받았다. 세션 만료거나 비공개 계정.")
"#;

/// 네트워크 오류: 진짜 스크립트는 예외를 잡지 않아 파이썬 오류 출력으로 끝난다. 요청은 보내지 않는다.
const NETWORK: &str = r#"
print("[+] CDN 매핑 수집 중…")
raise urllib.error.URLError("[Errno 11001] getaddrinfo failed")
"#;

/// 끝나지 않는 스크립트: 자식 프로세스를 하나 띄우고(껍데기 실행기나 도중에 띄운 프로그램을 흉내 낸다) 멈춰 있다.
const HANGS: &str = r#"
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
print("[+] 상세 수집 중… (동기화 소대 5종 · 소대 밖 1종)")
time.sleep(300)
"#;

/// 성공으로 끝나지만 프로필을 쓰지 않는 스크립트.
const WRITES_NOTHING: &str = r#"
print("[+] 아무것도 쓰지 않고 끝난다")
"#;

/// 가짜 엔진 폴더: 엔진 폴더임을 알리는 `runner/sim.py`와 수집 스크립트 자리만 있다.
struct FakeEngine(PathBuf);

impl FakeEngine {
    fn new(label: &str, script_body: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-fake-fetch-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("runner")).expect("임시 엔진 폴더");
        fs::create_dir_all(dir.join("scraper")).expect("scraper 폴더");
        fs::write(dir.join("runner/sim.py"), "").expect("sim.py");
        fs::write(dir.join(FETCH_SCRIPT), format!("{HEAD}{script_body}")).expect("가짜 스크립트");
        // 가짜 스크립트가 프로필로 쓸 검증용 샘플.
        fs::copy(
            repo_root().join("data/samples/profile.sample.json"),
            dir.join("scraper/sample_profile.json"),
        )
        .expect("샘플 프로필");
        Self(dir)
    }

    /// 엔진 설정 규칙(P-010)대로 이 폴더를 엔진 폴더로 정한 수집 설정.
    fn config(&self, timeout: Duration) -> FetchConfig {
        let settings = EngineSettings {
            engine_dir: Some(self.0.display().to_string()),
            python: Some(python()),
            ..EngineSettings::default()
        };
        let engine = engine::resolve_config(&settings, |_| None, &[]).expect("가짜 엔진 폴더");
        FetchConfig {
            timeout,
            ..FetchConfig::from_engine(&engine)
        }
    }

    fn with_cookie(self) -> Self {
        account_sync::store_pasted_cookie(&self.0, &fake_cookie()).expect("가짜 쿠키 저장");
        self
    }

    fn profile(&self, name: &str) -> PathBuf {
        self.0.join(PROFILES_SUBDIR).join(format!("{name}.json"))
    }
}

impl Drop for FakeEngine {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 진행 줄을 모으는 귀(명령이 `account-fetch` 이벤트로 보내는 내용과 같다).
#[derive(Default)]
struct Heard(Mutex<Vec<FetchLine>>);

impl Heard {
    fn listener(&self) -> impl Fn(&FetchLine) + Sync + '_ {
        |line| self.0.lock().expect("줄").push(line.clone())
    }

    fn lines(&self) -> Vec<FetchLine> {
        self.0.lock().expect("줄").clone()
    }
}

fn run(
    engine: &FakeEngine,
    name: &str,
    timeout: Duration,
) -> (Result<FetchOutcome, SyncFailure>, Vec<FetchLine>) {
    let heard = Heard::default();
    let outcome = account_sync::fetch_profile(
        &engine.config(timeout),
        name,
        &heard.listener(),
        &StopSignal::new(),
    );
    (outcome, heard.lines())
}

/// 가짜 쿠키의 어떤 조각도 글자에 없다.
fn assert_no_cookie(shown: &str, what: &str) {
    for secret in [TOKEN, OPENID, fake_cookie().as_str(), "lang=ko"] {
        assert!(!shown.contains(secret), "{what}에 쿠키가 보인다: {shown}");
    }
}

fn texts(lines: &[FetchLine]) -> Vec<&str> {
    lines.iter().map(|l| l.text.as_str()).collect()
}

// ── 프로세스 목록(Windows) ────────────────────────────────────────────────────

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

    fn all() -> HashMap<u32, (u32, String)> {
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

    /// 테스트를 시작할 때 이미 있던 프로세스들. Toolhelp의 "부모 번호"는 그 부모가 끝난 뒤에도 남고, Windows는 프로세스
    /// 번호를 다시 쓴다 — 오래전에 끝난 부모의 번호를 이 테스트 프로세스(나 그 자식)가 물려받으면, 그 부모가 띄웠던 남의
    /// 프로세스(실제로 MoNotificationUx.exe가 그랬다)가 이 테스트의 자손으로 잘못 세어진다. 시작 전에 있던 프로세스는
    /// 자손일 수 없다(`engine_cancel.rs`와 같은 처방).
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

    pub fn still_alive(recorded: &[(u32, String)]) -> Vec<(u32, String)> {
        let all = all();
        recorded
            .iter()
            .filter(|(pid, name)| all.get(pid).is_some_and(|(_, now)| now == name))
            .cloned()
            .collect()
    }
}

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

fn assert_nothing_left(recorded: &[(u32, String)]) {
    wait_until(Duration::from_secs(3), || {
        processes::still_alive(recorded).is_empty() && processes::spawned_by_this_test().is_empty()
    });
    assert_eq!(
        processes::still_alive(recorded),
        Vec::new(),
        "멈춘 뒤에도 수집 스크립트 프로세스가 남아 있다"
    );
    assert_eq!(
        processes::spawned_by_this_test(),
        Vec::new(),
        "멈춘 뒤에도 이 테스트가 띄운 프로세스가 남아 있다"
    );
}

// ── 성공 ─────────────────────────────────────────────────────────────────────

#[test]
fn a_successful_fetch_writes_the_profile_and_hands_over_every_line() {
    let _serial = serial();
    let engine = FakeEngine::new("success", SUCCESS).with_cookie();
    assert!(!engine.profile("부계").exists());

    let (outcome, heard) = run(&engine, " 부계 ", Duration::from_secs(60));
    let outcome = outcome.unwrap_or_else(|e| panic!("수집 실패: {}", e.message));

    // 프로필 파일이 생겼고, 스크립트가 `--name`을 받았다.
    assert_eq!(outcome.name, "부계");
    assert_eq!(outcome.profile_path, engine.profile("부계").display().to_string());
    assert!(outcome.fetched_at.as_deref().is_some_and(|t| t.ends_with('Z')));
    let written: Value =
        serde_json::from_str(&fs::read_to_string(engine.profile("부계")).expect("프로필")).expect("JSON");
    assert_eq!(written["_meta"]["name"], "부계");
    assert!(written["chars"].as_object().is_some_and(|c| c.len() == 6));

    // 줄은 하나도 빠지지 않고 스크립트가 낸 차례대로 온다 — 표준 출력과 표준 오류(셋째 줄)가 섞여서(쿠키 값만 가려져 있다).
    assert_eq!(
        texts(&outcome.lines),
        vec![
            format!("[+] openid {MASK} (area 83): 캐릭터 6종").as_str(),
            format!("[debug] 보낸 헤더: {{'Cookie': '{MASK}'}}").as_str(),
            format!("[debug] token = {MASK}").as_str(),
            format!("[debug] {MASK}").as_str(),
            "[+] 상세 수집 중… (동기화 소대 5종 · 소대 밖 1종)",
            "[+] 프로필 저장: profiles/부계.json  (6종, 1종 이름매핑 실패)",
            "    이름매핑 실패 name_code(신캐·미수집 가능): [9999]",
            "[!] 애장품 단계 3 미만 1명 — 그 단계의 스킬 판본으로 계산된다: {'헬름': 0}",
            "[!] 모르는 재활용 연구실 tid 1301 (lv 3) — 무시했다. 신규 역할군·기업이면 profile_fetch.py의 CONSOLE_TIDS에 추가하라",
            "[+] 동기화 소대 밖 1종 (참고) — 레벨은 정책이 정하므로 계산에는 영향이 없다: ['나가']",
            "[+] 소장품 미장착 0종 · 장비 4부위 전부 미장착 0종",
        ]
    );
    // 경고 줄은 따로 모인다.
    assert_eq!(
        outcome.warnings,
        vec![
            "[!] 애장품 단계 3 미만 1명 — 그 단계의 스킬 판본으로 계산된다: {'헬름': 0}".to_string(),
            "[!] 모르는 재활용 연구실 tid 1301 (lv 3) — 무시했다. 신규 역할군·기업이면 profile_fetch.py의 CONSOLE_TIDS에 추가하라".to_string(),
        ]
    );
    assert_eq!(outcome.lines.iter().filter(|l| l.warning).count(), 2);
    // 진행 줄(이벤트)로 간 것과 돌려준 것이 같다.
    assert_eq!(heard, outcome.lines);

    // 받은 프로필 읽기: 변환에 쓸 프로필이 오고, openid는 오지 않는다.
    fs::create_dir_all(engine.0.join("data/base_stat_tables")).expect("표 폴더");
    fs::write(engine.0.join(account_sync::OPTION_TABLE_FILE), "{}").expect("옵션 표");
    let read = account_sync::read_profile(&engine.0, "부계").expect("읽기");
    assert_eq!(read["profile"]["chars"], written["chars"]);
    assert_no_cookie(&read.to_string(), "받은 프로필");
}

#[test]
fn fetching_again_replaces_the_profile_and_a_run_that_writes_nothing_is_not_a_success() {
    let _serial = serial();
    let engine = FakeEngine::new("again", SUCCESS).with_cookie();
    let (first, _) = run(&engine, "me", Duration::from_secs(60));
    first.expect("첫 수집");
    // 파일 시각이 구분될 만큼 기다린 뒤에 다시 받는다.
    thread::sleep(Duration::from_millis(1100));
    let (second, _) = run(&engine, "me", Duration::from_secs(60));
    second.expect("다시 받기");

    // 스크립트가 성공으로 끝났어도 프로필을 새로 쓰지 않았으면 옛 파일을 새 것처럼 넘기지 않는다.
    fs::write(engine.0.join(FETCH_SCRIPT), format!("{HEAD}{WRITES_NOTHING}")).expect("스크립트");
    let (stale, _) = run(&engine, "me", Duration::from_secs(60));
    let failure = stale.expect_err("프로필을 쓰지 않았다");
    assert_eq!(failure.kind, "profile");
    assert!(failure.message.contains("새로 쓰이지 않았다"), "{}", failure.message);
    assert_eq!(texts(&failure.lines), vec!["[+] 아무것도 쓰지 않고 끝난다"]);
}

// ── 쿠키 비노출 ───────────────────────────────────────────────────────────────

#[test]
fn the_fake_cookie_never_appears_in_results_errors_or_progress_lines() {
    let _serial = serial();

    // 붙여넣기: 저장 결과와 거부 오류.
    let engine = FakeEngine::new("secret", SUCCESS);
    let saved = account_sync::store_pasted_cookie(&engine.0, &format!("Cookie: {}\r\n", fake_cookie()))
        .expect("저장");
    assert_no_cookie(&serde_json::to_string(&saved).expect("직렬화"), "쿠키 저장의 반환값");
    assert_no_cookie(&format!("{saved:?}"), "쿠키 저장의 반환값(Debug)");
    for rejected in [
        format!("game_token={TOKEN}; lang={SHORT}"),
        format!("game_openid={OPENID}; lang={SHORT}"),
        format!("{}; 한글=값", fake_cookie()),
    ] {
        let failure = SyncFailure::from(
            account_sync::store_pasted_cookie(&engine.0, &rejected).expect_err("거부"),
        );
        assert_no_cookie(&serde_json::to_string(&failure).expect("직렬화"), "쿠키 거부 오류");
    }

    // 상태 조회.
    let config = engine.config(Duration::from_secs(60));
    let accounts = engine.0.join("accounts");
    let status = account_sync::status(Ok(&config), Ok(&accounts), None);
    assert!(status.cookie_saved);
    assert_no_cookie(&serde_json::to_string(&status).expect("직렬화"), "상태");

    // 수집 성공: 스크립트가 쿠키를 세 번 출력한다(헤더 전체, 토큰, 짧은 값의 이름=값).
    let (outcome, heard) = run(&engine, "me", Duration::from_secs(60));
    let outcome = outcome.expect("수집");
    assert_no_cookie(&serde_json::to_string(&outcome).expect("직렬화"), "수집의 반환값");
    assert_no_cookie(&format!("{outcome:?}"), "수집의 반환값(Debug)");
    for line in &heard {
        assert_no_cookie(&serde_json::to_string(line).expect("직렬화"), "진행 줄");
    }
    // 가린 줄은 버리지 않고 가린 채로 넘긴다.
    assert_eq!(heard.iter().filter(|l| l.text.contains(MASK)).count(), 4);

    // 수집 실패: 오류 문장과 함께 가는 줄에도 없다.
    for (label, script) in [("secret-expired", EXPIRED), ("secret-nochars", NO_CHARACTERS)] {
        let engine = FakeEngine::new(label, script).with_cookie();
        let (outcome, heard) = run(&engine, "me", Duration::from_secs(60));
        let failure = outcome.expect_err("실패");
        assert_no_cookie(&serde_json::to_string(&failure).expect("직렬화"), "수집 실패");
        assert_no_cookie(&format!("{failure:?}"), "수집 실패(Debug)");
        assert_no_cookie(&format!("{heard:?}"), "진행 줄");
        assert!(failure.lines.iter().any(|l| l.text.contains(MASK)), "{:?}", failure.lines);
    }

    // 로그인 창 길: 쿠키 목록 → 저장 결과, 그리고 「아직 로그인되지 않았다」.
    let login = FakeEngine::new("secret-login", SUCCESS);
    let cookie = |name: &str, value: &str| BrowserCookie {
        name: name.to_string(),
        value: value.to_string(),
        domain: Some(".blablalink.com".to_string()),
    };
    let not_yet = [cookie("lang", SHORT), cookie("game_openid", OPENID)];
    let failure =
        SyncFailure::from(account_sync::store_login_cookies(&login.0, &not_yet).expect_err("로그인 전"));
    assert_eq!(failure.kind, "not_logged_in");
    assert_no_cookie(&serde_json::to_string(&failure).expect("직렬화"), "로그인 전 오류");
    assert_no_cookie(&format!("{not_yet:?}"), "쿠키 목록(Debug)");
    assert!(!login.0.join(COOKIE_FILE).exists());

    let logged_in = [
        cookie("game_token", TOKEN),
        cookie("game_openid", OPENID),
        cookie("game_gameid", "29080"),
        cookie("lang", SHORT),
    ];
    let saved = account_sync::store_login_cookies(&login.0, &logged_in).expect("저장");
    assert_no_cookie(&serde_json::to_string(&saved).expect("직렬화"), "로그인 창 저장의 반환값");
    // 로그인 창으로 받은 쿠키로도 같은 수집이 된다 — 그 길에서도 줄에 쿠키가 없다.
    assert_eq!(
        fs::read_to_string(login.0.join(COOKIE_FILE)).expect("쿠키 파일"),
        format!("{}\n", fake_cookie())
    );
    let (outcome, heard) = run(&login, "me", Duration::from_secs(60));
    assert_no_cookie(&serde_json::to_string(&outcome.expect("수집")).expect("직렬화"), "수집의 반환값");
    assert_no_cookie(&format!("{heard:?}"), "진행 줄");
}

/// 아래 테스트가 따로 띄우는 프로세스에서 도는 부분. 쿠키가 지나가는 길을 모두 한 번씩 밟되 스스로는 아무것도 출력하지 않는다.
/// 직접 돌릴 일은 없다(`--ignored`로 돌려도 통과한다).
#[test]
#[ignore = "no_cookie_reaches_the_standard_output이 따로 띄운 프로세스에서 돈다"]
fn probe_walk_every_cookie_path_quietly() {
    let quiet = |_: &FetchLine| {};
    let engine = FakeEngine::new("probe", SUCCESS);
    let _ = account_sync::store_pasted_cookie(&engine.0, &format!("game_token={TOKEN}"));
    let _ = account_sync::store_pasted_cookie(&engine.0, &fake_cookie());
    let config = engine.config(Duration::from_secs(60));
    let _ = account_sync::status(Ok(&config), Ok(&engine.0), None);
    let fetched = account_sync::fetch_profile(&config, "me", &quiet, &StopSignal::new());
    assert!(fetched.is_ok(), "가짜 수집이 실패했다");

    let expired = FakeEngine::new("probe-expired", EXPIRED).with_cookie();
    let failed = account_sync::fetch_profile(
        &expired.config(Duration::from_secs(60)),
        "me",
        &quiet,
        &StopSignal::new(),
    );
    assert!(failed.is_err(), "가짜 세션 만료가 성공했다");

    let login = FakeEngine::new("probe-login", SUCCESS);
    let cookie = |name: &str, value: &str| BrowserCookie {
        name: name.to_string(),
        value: value.to_string(),
        domain: Some(".blablalink.com".to_string()),
    };
    let _ = account_sync::store_login_cookies(&login.0, &[cookie("game_openid", OPENID)]);
    let stored = account_sync::store_login_cookies(
        &login.0,
        &[cookie("game_token", TOKEN), cookie("game_openid", OPENID)],
    );
    assert!(stored.is_ok(), "가짜 로그인 쿠키 저장이 실패했다");
}

#[test]
fn no_cookie_reaches_the_standard_output() {
    let _serial = serial();
    // 이 테스트 실행 파일을 한 번 더 띄워, 쿠키가 지나가는 길을 모두 밟는 동안 표준 출력·표준 오류에 나온 것을 전부 받는다.
    let output = Command::new(std::env::current_exe().expect("테스트 실행 파일"))
        .args([
            "--ignored",
            "--exact",
            "probe_walk_every_cookie_path_quietly",
            "--nocapture",
            "--test-threads=1",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("테스트 실행 파일을 다시 띄운다");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "길을 밟는 프로세스가 실패했다:\n{stdout}\n{stderr}");
    assert!(stdout.contains("1 passed"), "길을 밟는 테스트가 돌지 않았다:\n{stdout}");
    assert_no_cookie(&stdout, "표준 출력");
    assert_no_cookie(&stderr, "표준 오류");
    // 수집 스크립트가 낸 글자도(가린 것이든 아니든) 이 프로세스의 출력으로 새지 않는다.
    assert!(!stdout.contains("openid") && !stderr.contains("openid"), "{stdout}\n{stderr}");
}

// ── 실패의 구분 ───────────────────────────────────────────────────────────────

#[test]
fn an_expired_session_is_reported_as_such_with_the_scripts_lines() {
    let _serial = serial();
    let engine = FakeEngine::new("expired", EXPIRED).with_cookie();
    let (outcome, heard) = run(&engine, "me", Duration::from_secs(60));
    let failure = outcome.expect_err("세션 만료");
    assert_eq!(failure.kind, "session_expired");
    assert!(failure.cookie_help, "쿠키를 다시 받는 순서를 함께 보여야 한다");
    assert!(failure.message.contains("로그인 세션이 만료됐다"), "{}", failure.message);
    assert!(failure.message.contains("쿠키를 다시 받아라"), "{}", failure.message);
    assert_eq!(
        texts(&failure.lines),
        vec![
            format!("[+] openid {MASK} (area 83): 캐릭터 6종").as_str(),
            "[!] GetUserCharacterDetails: 로그인 세션 만료 (game not login). 쿠키를 다시 받아라.",
        ]
    );
    assert_eq!(
        failure.warnings,
        vec!["[!] GetUserCharacterDetails: 로그인 세션 만료 (game not login). 쿠키를 다시 받아라.".to_string()]
    );
    assert_eq!(heard, failure.lines);
    assert!(!engine.profile("me").exists());

    // 첫 요청이 거절된 경우의 문장도 쿠키를 다시 받으라는 안내로 이어진다.
    let engine = FakeEngine::new("nochars", NO_CHARACTERS).with_cookie();
    let (outcome, _) = run(&engine, "me", Duration::from_secs(60));
    let failure = outcome.expect_err("캐릭터 없음");
    assert_eq!((failure.kind, failure.cookie_help), ("session_expired", true));
    assert!(failure.message.contains("만료됐거나 비공개 계정"), "{}", failure.message);
}

#[test]
fn a_network_error_is_told_apart_from_a_cookie_problem() {
    let _serial = serial();
    let engine = FakeEngine::new("network", NETWORK).with_cookie();
    let (outcome, _) = run(&engine, "me", Duration::from_secs(60));
    let failure = outcome.expect_err("네트워크 오류");
    assert_eq!(failure.kind, "network");
    assert!(!failure.cookie_help, "네트워크 오류는 쿠키를 다시 받을 일이 아니다");
    assert!(failure.message.contains("네트워크 오류"), "{}", failure.message);
    // 파이썬의 오류 출력(표준 오류)도 줄로 온다 — 표준 출력의 줄 뒤에, 낸 차례대로.
    assert_eq!(failure.lines[0].text, "[+] CDN 매핑 수집 중…");
    assert!(failure.lines[1].text.starts_with("Traceback"), "{:?}", failure.lines);
    assert!(failure.lines.last().is_some_and(|l| l.text.contains("URLError")), "{:?}", failure.lines);
    assert!(failure.lines.iter().any(|l| l.text.starts_with("Traceback")), "{:?}", failure.lines);
    assert!(failure.lines.iter().any(|l| l.text.contains("URLError")), "{:?}", failure.lines);
}

#[test]
fn a_missing_cookie_file_is_reported_before_the_script_runs() {
    let _serial = serial();
    // 쿠키 파일이 없으면 가짜 스크립트는 파일을 열다가 죽는다 — 그 전에 알린다.
    let engine = FakeEngine::new("nocookie", SUCCESS);
    let (outcome, heard) = run(&engine, "me", Duration::from_secs(60));
    let failure = outcome.expect_err("쿠키 없음");
    assert_eq!((failure.kind, failure.cookie_help), ("cookie_missing", true));
    assert!(failure.message.contains("쿠키 파일이 없다"), "{}", failure.message);
    assert_eq!(heard, Vec::new(), "스크립트를 띄우지 않았다");

    fs::write(engine.0.join(COOKIE_FILE), format!("game_openid={OPENID}\n")).expect("쿠키");
    let (outcome, heard) = run(&engine, "me", Duration::from_secs(60));
    let failure = outcome.expect_err("game_token 없음");
    assert_eq!((failure.kind, failure.cookie_help), ("cookie_invalid", true));
    assert!(failure.message.contains("game_token"), "{}", failure.message);
    assert_eq!(heard, Vec::new());
}

// ── 시간 초과·중단 ────────────────────────────────────────────────────────────

#[test]
fn a_fetch_that_runs_too_long_is_stopped_with_its_child_processes() {
    let _serial = serial();
    processes::mark_start();
    assert_eq!(processes::spawned_by_this_test(), Vec::new(), "시작 전에 띄워 둔 프로세스가 있다");
    let engine = FakeEngine::new("timeout", HANGS).with_cookie();

    let started = Instant::now();
    let (outcome, heard) = run(&engine, "me", Duration::from_secs(2));
    let took = started.elapsed();
    let failure = outcome.expect_err("시간 초과");
    assert_eq!(failure.kind, "timeout");
    assert!(!failure.cookie_help);
    assert!(failure.message.contains("시간 초과"), "{}", failure.message);
    assert!(failure.message.contains("2초"), "{}", failure.message);
    assert!(took >= Duration::from_secs(2), "{took:?}");
    assert!(took < Duration::from_secs(2) + RETURN_WITHIN, "시간 초과 뒤 돌아오기까지 {took:?}");
    // 그때까지 나온 줄은 함께 온다.
    assert_eq!(texts(&heard), vec!["[+] 상세 수집 중… (동기화 소대 5종 · 소대 밖 1종)"]);
    assert_eq!(failure.lines, heard);
    assert_nothing_left(&[]);
}

#[test]
fn stopping_a_fetch_returns_within_seconds_and_leaves_no_process() {
    let _serial = serial();
    processes::mark_start();
    assert_eq!(processes::spawned_by_this_test(), Vec::new(), "시작 전에 띄워 둔 프로세스가 있다");
    let engine = FakeEngine::new("stop", HANGS).with_cookie();
    let config = engine.config(Duration::from_secs(300));

    // 명령(`account_fetch_profile`·`account_fetch_cancel`)과 같은 자리(`BatchSlot`)로 돌리고 멈춘다.
    let slot = BatchSlot::default();
    let lines = AtomicUsize::new(0);
    let on_line = |_: &FetchLine| {
        lines.fetch_add(1, Ordering::Relaxed);
    };
    let ticket = slot.begin().expect("수집 자리");
    assert!(slot.begin().is_err(), "도는 동안에는 겹쳐 띄우지 않는다");
    let (outcome, took, running) = thread::scope(|scope| {
        let fetch =
            scope.spawn(|| account_sync::fetch_profile(&config, "me", &on_line, ticket.signal()));
        // 스크립트가 줄을 냈으면 자식 프로세스도 떠 있다.
        let started = wait_until(Duration::from_secs(60), || {
            fetch.is_finished() || lines.load(Ordering::Relaxed) >= 1
        });
        let running = processes::spawned_by_this_test();
        let asked = Instant::now();
        assert!(slot.stop(), "도는 수집이 있으면 중단 명령이 true를 돌려준다");
        let outcome = fetch.join().expect("수집 스레드");
        assert!(started, "스크립트가 돌기 시작하지 않았다");
        (outcome, asked.elapsed(), running)
    });
    drop(ticket);

    let failure = outcome.expect_err("멈춘 수집은 결과를 내지 않는다");
    assert_eq!(failure.kind, "stopped");
    assert!(failure.message.starts_with(STOPPED_PREFIX), "{}", failure.message);
    assert!(!failure.cookie_help);
    assert!(took < RETURN_WITHIN, "중단 뒤 돌아오기까지 {took:?} 걸렸다");
    // 멈추기 직전에는 스크립트와 그 자식이 돌고 있었고(Windows에서만 센다), 지금은 하나도 없다.
    #[cfg(windows)]
    assert!(
        running.iter().filter(|(_, name)| is_python(name)).count() >= 2,
        "스크립트와 그 자식이 보이지 않았다: {running:?}"
    );
    assert_nothing_left(&running);
    assert!(!engine.profile("me").exists());

    // 멈춘 뒤에 다시 받을 수 있다: 자리가 비었고, 새 수집은 앞의 중단을 물려받지 않는다.
    assert!(!slot.is_running());
    assert!(!slot.stop(), "도는 수집이 없으면 중단 명령은 아무 일도 하지 않는다");
    fs::write(engine.0.join(FETCH_SCRIPT), format!("{HEAD}{SUCCESS}")).expect("스크립트");
    let ticket = slot.begin().expect("중단 뒤 다시 받기");
    let again = account_sync::fetch_profile(&config, "me", &|_| {}, ticket.signal());
    assert!(again.is_ok(), "{:?}", again.err().map(|f| f.message));
    assert!(engine.profile("me").is_file());
    drop(ticket);
    assert_nothing_left(&running);
}

#[test]
fn only_the_engine_folders_fetch_script_is_run() {
    let _serial = serial();
    // 화면이 넘기는 것은 이름뿐이다. 경로처럼 생긴 이름·인자처럼 생긴 이름은 스크립트를 띄우기 전에 거부한다.
    let engine = FakeEngine::new("only", SUCCESS).with_cookie();
    for name in ["../../밖", "..\\밖", "a/b", "--from-raw", "-h", "me.json", "me;x", "me\"x"] {
        let (outcome, heard) = run(&engine, name, Duration::from_secs(60));
        let failure = outcome.expect_err(name);
        assert_eq!(failure.kind, "name", "{name}");
        assert_eq!(heard, Vec::new(), "{name}: 스크립트를 띄우지 않았다");
    }
    assert!(!engine.0.join(PROFILES_SUBDIR).exists());
    // 엔진 폴더가 아닌 곳(수집 스크립트가 없다)에서는 띄울 것이 없다.
    let empty = std::env::temp_dir().join(format!("nikke-companion-fake-fetch-empty-{}", std::process::id()));
    fs::create_dir_all(&empty).expect("빈 폴더");
    let config = FetchConfig {
        engine_dir: empty.clone(),
        python: python(),
        timeout: Duration::from_secs(60),
    };
    let failure = account_sync::fetch_profile(&config, "me", &|_| {}, &StopSignal::new())
        .expect_err("스크립트 없음");
    assert_eq!(failure.kind, "engine");
    let _ = fs::remove_dir_all(&empty);
}
