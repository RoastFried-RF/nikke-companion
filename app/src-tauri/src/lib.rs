//! 니케 컴패니언 오버레이 — Tauri 쪽.
//!
//! 이 파일은 창·단축키·명령을 잇는 접착 코드다. 규칙은 창 API를 모르는 모듈에 있다:
//! - `overlay_state`: 보임/숨김·클릭 통과의 전환 규칙, 시작 위치 계산
//! - `report`: 비교 결과 JSON 읽기와 형식 확인, 입력 JSON 파일 읽기
//! - `engine`: 계산 엔진(vendor/nikke-calc) 프로세스 실행·카탈로그·버전. 계산 로직은 없다
//! - `game_window`: 게임 창을 고르는 규칙, 창 정보, 오버레이를 게임 창에 붙이는 위치 계산
//! - `capture`: 캡처한 프레임의 판정(빈 화면)·파일 이름·PNG 저장
//! - `capture_cli`: 명령줄 도구 `nikke-capture`의 동작
//! - `recognize`: 요격전 화면 인식 — 캡처한 프레임이 이상 개체의 어느 화면·어느 보스인지(색만 본다, 창·파일을 모른다)
//! - `screen_track`: 요격전 화면 자동 추적의 규칙 — 언제 읽고 언제 읽지 않는지, 무엇이 바뀌면 화면에 알리는지
//! - `stay_on_top`: 게임 위에 머물기의 규칙 — 게임 창이 오버레이보다 위로 올라왔을 때만 오버레이를 다시 올린다
//! - `game_win32`(비공개): 위 규칙에 값을 대 주는 Win32 호출 — 창 열거, 창 사각형, Windows.Graphics.Capture
//! - `overlay_win32`: 오버레이 창(이 앱의 창)만 다루는 Win32 호출 — 활성화 없이 보이기·숨기기·다시 맨 위로 올리기,
//!   파일 고르기 창의 부모
//! - `engine_win32`(비공개): 이 앱이 띄운 엔진 프로세스를 묶어 끝내는 Job Object(앱이 끝나면 함께 끝난다)
//!
//! - `cookie`: 세션 쿠키의 규칙 — 붙여넣은 글자·로그인 창의 쿠키 목록을 Cookie 헤더 한 줄로, 출력에서 쿠키 값 가리기(순수)
//! - `account_sync`: 계정 받기 — 쿠키 파일 쓰기, 엔진의 수집 스크립트 실행, 받은 프로필 읽기, 계정 파일 저장
//! - `login_window`: blablalink 로그인 창(별도 창, 앱 명령을 부를 수 없다) — 열기, 쿠키 읽기, 세션 지우기
//!
//! 편성 비교·추천의 계산은 화면 쪽의 `src/core`(JS)가 하고, 여기서는 엔진 프로세스만 대신 띄운다.
//! 이 앱의 Rust 코드는 네트워크 요청을 하지 않는다. 밖으로 나가는 요청은 둘뿐이다: 사용자가 연 로그인 창이
//! 보여 주는 페이지(blablalink와 로그인 제공자)와, 「계정 새로 받기」가 실행하는 엔진의 수집 스크립트가
//! blablalink API에 하는 요청.
//!
//! 세션 쿠키는 계정 접근권이다: 엔진의 `scraper/.session_cookie` 한 곳에만 쓰고, 화면·이벤트·반환값·오류 문장·
//! 표준 출력 어디에도 내보내지 않는다(`cookie.rs`·`account_sync.rs`의 규칙, `tests/account_fetch.rs`).
//!
//! 게임은 읽기만 한다: 게임 창을 옮기거나 크기를 바꾸거나 앞으로 가져오지 않고, 입력을 보내지 않는다.
//! 붙이기가 옮기는 것도, 게임 위에 머물기가 창 순서를 올리는 것도 오버레이 창뿐이다.
//!
//! 앱이 끝날 때(끝내기 단추, 오버레이 창 닫기) 돌던 엔진 계산과 계정 수집을 멈추고 그 프로세스가 끝나기를 잠깐
//! 기다린다(`stop_running_work`). 앱이 정리할 틈 없이 죽어도 프로세스 묶음(Job Object)이 함께 닫히며 끝낸다.
//!
//! 스레드는 둘이다: 게임 창 추적(`track_game` — 창 상태·붙이기·게임 위에 머물기)과 화면 추적(`track_screen` — 켜 둔 동안 주기적으로
//! 게임 화면을 찍어 인식만 한다. 찍은 프레임은 그 자리에서 버린다). 캡처가 붙이기를 늦추지 않게 따로 둔다.
//!
//! 오버레이는 한 번만 뜬다(`tauri-plugin-single-instance`): 두 번째 실행은 창을 만들기 전에 끝나고, 이미 떠 있는
//! 쪽이 숨겨져 있었다면 활성화 없이 보인다(`reveal_overlay`).

pub mod account_sync;
pub mod capture;
pub mod capture_cli;
pub mod cookie;
pub mod engine;
#[cfg(windows)]
mod engine_win32;
#[cfg(windows)]
mod game_win32;
pub mod game_window;
pub mod login_window;
pub mod overlay_state;
#[cfg(windows)]
pub mod overlay_win32;
pub mod recognize;
pub mod report;
pub mod screen_track;
pub mod stay_on_top;

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use account_sync::{
    CookieSaved, FetchConfig, FetchLine, FetchOutcome, SavedAccount, SyncError, SyncFailure,
    SyncStatus,
};
use capture::CaptureRecord;
use game_window::{
    follow_step, follow_target, FollowStep, GameError, GameWindowInfo, GameWindowStatus,
};
use overlay_state::{
    top_right_position, OverlayAction, OverlayState, Transition, VisibilityChange,
};
use recognize::Recognition;
use screen_track::{Reading, TrackSettings, TrackStatus};

/// tauri.conf.json의 창 label.
const MAIN_WINDOW: &str = "main";

/// 상태가 바뀔 때 화면으로 보내는 이벤트. 프런트의 `OVERLAY_STATE_EVENT`(src/lib/backend.ts)와 같아야 한다.
pub const OVERLAY_STATE_EVENT: &str = "overlay-state";

/// 엔진 계산이 한 건 끝날 때마다 화면으로 보내는 이벤트. 프런트의 `ENGINE_PROGRESS_EVENT`와 같아야 한다.
pub const ENGINE_PROGRESS_EVENT: &str = "engine-progress";

/// 게임 창 상태(찾음·없음·최소화, 크기, 붙이기 여부)가 바뀔 때 화면으로 보내는 이벤트.
/// 프런트의 `GAME_WINDOW_EVENT`와 같아야 한다.
pub const GAME_WINDOW_EVENT: &str = "game-window";

/// 단축키로 게임 화면을 저장한 결과(경로 또는 오류)를 화면으로 보내는 이벤트.
/// 프런트의 `GAME_CAPTURE_EVENT`와 같아야 한다.
pub const GAME_CAPTURE_EVENT: &str = "game-capture";

/// 요격전 화면 자동 추적의 결과(켜짐·상태·인식한 화면과 보스)가 바뀔 때 화면으로 보내는 이벤트.
/// 프런트의 `SCREEN_TRACK_EVENT`와 같아야 한다. 이미지는 싣지 않는다.
pub const SCREEN_TRACK_EVENT: &str = "screen-track";

/// 계정 수집 스크립트가 줄을 낼 때마다 오버레이 창으로 보내는 이벤트(`{text, warning}` — 쿠키 값은 가려져 있다).
/// 프런트의 `ACCOUNT_FETCH_EVENT`와 같아야 한다.
pub const ACCOUNT_FETCH_EVENT: &str = "account-fetch";

/// 엔진 설정 파일 이름. 앱 설정 폴더(`%APPDATA%/<identifier>`)에 둔다.
const SETTINGS_FILE: &str = "settings.json";

/// 시작할 때 화면 가장자리에서 띄우는 거리(논리 픽셀).
const SCREEN_MARGIN: f64 = 24.0;

/// 붙이기를 켰을 때 게임 화면 가장자리에서 띄우는 거리(논리 픽셀).
const ATTACH_MARGIN: f64 = 12.0;

/// 창 목록을 처음부터 다시 훑는 간격(그 사이에는 찾아 둔 창만 가볍게 다시 읽는다).
/// 게임 창을 다시 보는 간격은 `stay_on_top::watch_interval`이 정한다.
const RESCAN_INTERVAL: Duration = Duration::from_millis(1000);

/// 전역 단축키. 모두 Alt+Shift 조합이다.
const SHORTCUTS: [ShortcutDef; 3] = [
    ShortcutDef {
        keys: "Alt+Shift+C",
        what: "클릭 통과 전환",
        code: Code::KeyC,
        action: ShortcutAction::Overlay(OverlayAction::ToggleClickThrough),
    },
    ShortcutDef {
        keys: "Alt+Shift+O",
        what: "창 숨김/보임",
        code: Code::KeyO,
        action: ShortcutAction::Overlay(OverlayAction::ToggleVisibility),
    },
    ShortcutDef {
        keys: "Alt+Shift+S",
        what: "게임 화면 저장",
        code: Code::KeyS,
        action: ShortcutAction::CaptureGame,
    },
];

struct ShortcutDef {
    keys: &'static str,
    what: &'static str,
    code: Code,
    action: ShortcutAction,
}

/// 단축키가 하는 일.
#[derive(Debug, Clone, Copy)]
enum ShortcutAction {
    /// 오버레이 창의 상태를 바꾼다.
    Overlay(OverlayAction),
    /// 지금 게임 화면을 저장한다.
    CaptureGame,
}

/// 앱이 들고 있는 오버레이 상태.
#[derive(Default)]
struct Overlay {
    state: Mutex<OverlayState>,
    /// 등록하지 못한 단축키의 설명. 화면에 그대로 보인다.
    shortcut_problems: Mutex<Vec<String>>,
}

/// 엔진 배치의 자리. 화면이 두 번 눌러도 엔진 프로세스를 겹쳐 띄우지 않고, 중단 명령이 도는 배치를 멈춘다.
#[derive(Default)]
struct EngineRun(engine::BatchSlot);

/// 계정 수집의 자리. 수집 스크립트를 겹쳐 띄우지 않고, 중단 명령이 도는 수집을 멈춘다(엔진 배치와 같은 방식).
#[derive(Default)]
struct FetchRun(engine::BatchSlot);

/// 캡처가 끝나면(오류로 끝나도) 표시를 내린다.
struct BusyGuard<'a>(&'a AtomicBool);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// 게임 창 추적 상태.
#[derive(Default)]
struct GameTracker {
    /// 오버레이를 게임 창에 붙여 따라가게 할지.
    follow: AtomicBool,
    /// 캡처가 돌고 있는지. 단축키와 단추가 겹쳐도 한 번에 하나만 찍는다.
    capturing: AtomicBool,
    /// 추적 스레드. 붙이기를 바꾸면 깨워서 바로 반영한다.
    thread: Mutex<Option<thread::Thread>>,
}

/// 요격전 화면 자동 추적. 규칙과 상태의 모양은 `screen_track`에 있다.
#[derive(Default)]
struct ScreenTracker {
    /// 화면이 정한 설정(켜짐·주기). 추적 스레드는 주기마다 다시 읽는다.
    settings: Mutex<TrackSettings>,
    /// 지금 상태. 캡처하는 동안에는 잠그지 않는다(상태 명령이 캡처를 기다리지 않게).
    log: Mutex<screen_track::Tracker>,
    /// 추적 스레드. 설정이 바뀌거나 오버레이가 다시 보이면 깨워서 바로 읽게 한다.
    thread: Mutex<Option<thread::Thread>>,
}

/// 화면에 넘기는 게임 창 상태. 프런트의 `GameSnapshot`(src/types.ts)과 같아야 한다.
#[derive(Debug, Clone, PartialEq, Serialize)]
struct GameSnapshot {
    #[serde(flatten)]
    status: GameWindowStatus,
    /// 붙이기가 켜져 있는가.
    follow: bool,
}

/// 단축키로 저장한 결과. 프런트의 `GameCaptureOutcome`(src/types.ts)과 같아야 한다.
#[derive(Debug, Clone, Serialize)]
struct GameCaptureOutcome {
    /// 저장한 캡처. 실패했으면 null.
    capture: Option<CaptureRecord>,
    /// 한국어 오류 문장. 성공했으면 null.
    error: Option<String>,
}

/// 화면에 넘기는 진행 상황. 프런트의 `EngineProgress`(src/types.ts)와 같아야 한다.
#[derive(Debug, Clone, Serialize)]
struct EngineProgress {
    done: usize,
    total: usize,
}

/// 화면에 넘기는 상태. 프런트의 `OverlaySnapshot`(src/types.ts)과 같아야 한다.
#[derive(Debug, Clone, Serialize)]
struct OverlaySnapshot {
    visible: bool,
    click_through: bool,
    shortcut_problems: Vec<String>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // 다른 스레드가 잠근 채 죽었어도 상태 값 자체는 쓸 수 있다.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Overlay {
    fn snapshot(&self) -> OverlaySnapshot {
        let state = *lock(&self.state);
        OverlaySnapshot {
            visible: state.visible,
            click_through: state.click_through,
            shortcut_problems: lock(&self.shortcut_problems).clone(),
        }
    }
}

/// 비교 결과 파일을 읽어 돌려준다. 실패하면 한국어 오류 문장.
#[tauri::command]
async fn load_report(path: String) -> Result<serde_json::Value, String> {
    let path = report::clean_path_input(&path);
    report::load_report_file(Path::new(path)).map_err(|e| e.to_string())
}

/// 엔진 설정을 확정한다: 환경 변수 → 설정 파일 → 저장소 안의 vendor/nikke-calc.
/// 화면은 이 값을 바꿀 수 없다(화면이 임의의 프로그램을 실행하게 만들 수 없다).
fn engine_config(app: &AppHandle) -> Result<engine::EngineConfig, String> {
    let settings_path = app
        .path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .ok();
    let settings = match &settings_path {
        Some(path) => engine::load_settings_file(path).map_err(|e| e.to_string())?,
        None => engine::EngineSettings::default(),
    };
    let mut search_from: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        search_from.push(dir);
    }
    if let Ok(dir) = std::env::current_dir() {
        search_from.push(dir);
    }
    engine::resolve_config(&settings, |name| std::env::var(name).ok(), &search_from).map_err(|e| {
        match (&e, &settings_path) {
            (engine::EngineError::EngineDirNotFound, Some(path)) => {
                format!("{e} (설정 파일: {})", path.display())
            }
            _ => e.to_string(),
        }
    })
}

/// 오래 걸리는 일을 화면 응답을 막지 않는 스레드에서 돌린다.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("작업을 끝내지 못했다: {e}"))?
}

/// 엔진이 아는 니케와 보스 프리셋(`{nikkes, bosses}`).
#[tauri::command]
async fn engine_catalog(app: AppHandle) -> Result<Value, String> {
    let config = engine_config(&app)?;
    blocking(move || engine::catalog(&config.engine_dir).map_err(|e| e.to_string())).await
}

/// 엔진 버전(`{repo, commit, dirty}`). 커밋을 알 수 없으면 commit·dirty는 null.
#[tauri::command]
async fn engine_version(app: AppHandle) -> Result<Value, String> {
    let config = engine_config(&app)?;
    blocking(move || Ok(engine::version(&config.engine_dir))).await
}

/// 요청 여러 건을 엔진 배치로 돌린다. 결과는 입력 순서 그대로이고, 줄마다 결과 또는 `{error}`다.
/// 한 건이 끝날 때마다 `engine-progress` 이벤트를 보낸다.
/// 도는 동안 `engine_cancel`이 불리면 엔진 프로세스를 모두 끝내고 '중단됨' 오류로 돌아온다.
#[tauri::command]
async fn engine_run_batch(app: AppHandle, requests: Vec<Value>) -> Result<Vec<Value>, String> {
    let config = engine_config(&app)?;
    blocking(move || {
        let run = app.state::<EngineRun>();
        // 표는 이 함수가 끝날 때(오류로 끝나도) 버려져 자리가 빈다 — 중단 뒤에 다시 실행할 수 있다.
        let ticket = run.0.begin().map_err(|e| e.to_string())?;
        let progress = |done: usize, total: usize| {
            // 진행 표시를 못 보내도 계산은 계속한다.
            let _ = app.emit(ENGINE_PROGRESS_EVENT, EngineProgress { done, total });
        };
        engine::run_batch_with_stop(&config, &requests, Some(&progress), ticket.signal())
            .map_err(|e| e.to_string())
    })
    .await
}

/// 도는 엔진 배치를 멈춘다. 멈출 배치가 있었으면 true — 그 배치의 `engine_run_batch`가 '중단됨' 오류로 돌아온다.
/// 도는 배치가 없으면 아무 일도 하지 않고 false다(다음에 시작할 배치를 미리 멈추지 않는다).
#[tauri::command]
fn engine_cancel(run: State<'_, EngineRun>) -> bool {
    run.0.stop()
}

/// JSON 파일(계정 상태·전투 조건·후보 편성)을 읽어 내용 그대로 돌려준다. 실패하면 한국어 오류 문장.
#[tauri::command]
async fn read_json_file(path: String) -> Result<Value, String> {
    let path = report::clean_path_input(&path).to_string();
    blocking(move || report::read_json_file(Path::new(&path)).map_err(|e| e.to_string())).await
}

/// 파일 고르기 창을 띄워 JSON 파일 하나의 경로를 받는다. 취소하면 null.
/// 화면에는 파일·대화 상자 권한을 주지 않고, 고르는 일만 이 명령이 대신한다.
#[tauri::command]
async fn pick_json_file(window: WebviewWindow, title: String) -> Result<Option<String>, String> {
    blocking(move || pick_json_file_dialog(&window, &title)).await
}

#[cfg(windows)]
fn pick_json_file_dialog(window: &WebviewWindow, title: &str) -> Result<Option<String>, String> {
    // 오버레이는 항상 위 창이다. 대화 상자를 이 창의 자식(소유된 창)으로 띄워야 뒤에 가려지지 않는다.
    // 창 핸들을 얻지 못하면 부모 없이 띄우지 않고 오류로 알린다(경로는 직접 넣을 수 있다).
    let parent = overlay_win32::dialog_parent(window)?;
    let picked = overlay_win32::pick_json_file(&parent, title);
    Ok(picked.map(|path| path.display().to_string()))
}

#[cfg(not(windows))]
fn pick_json_file_dialog(_window: &WebviewWindow, _title: &str) -> Result<Option<String>, String> {
    Err("파일 고르기 창은 Windows에서만 쓸 수 있다. 경로를 직접 넣어라".to_string())
}

// ── 계정 받기 ─────────────────────────────────────────────────────────────────
//
// 아래 명령들은 세션 쿠키를 다룬다. 쿠키 값은 `account_sync`·`cookie`·`login_window` 안에서만 흐르고,
// 여기서는 반환값(`CookieSaved` — 시각과 개수뿐)과 한국어 오류만 화면으로 넘긴다. 쿠키를 출력하거나 이벤트에 싣지 않는다.

/// 수집에 쓸 설정. 엔진 폴더·python은 엔진 계산과 같은 설정에서 나온다 — 화면이 실행할 스크립트를 정할 수 없다.
fn fetch_config(app: &AppHandle) -> Result<FetchConfig, SyncFailure> {
    engine_config(app)
        .map(|config| FetchConfig::from_engine(&config))
        .map_err(|detail| SyncError::Engine { detail }.into())
}

/// `blocking`과 같되 실패를 종류와 함께 넘긴다(계정 받기 명령용).
async fn blocking_sync<T, F>(work: F) -> Result<T, SyncFailure>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, SyncFailure> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| {
            SyncFailure::from(SyncError::Engine {
                detail: format!("작업을 끝내지 못했다: {e}"),
            })
        })?
}

/// 계정 받기의 지금 상태: 쿠키 파일이 있는지(내용은 돌려주지 않는다)·언제 썼는지, 그 이름의 프로필을 마지막으로 받은 시각,
/// 계정 파일, 로그인 창이 열려 있는지, 엔진 폴더·python 문제. 이름을 주지 않으면 `me`.
#[tauri::command]
async fn account_sync_status(app: AppHandle, name: Option<String>) -> Result<SyncStatus, SyncFailure> {
    let engine = engine_config(&app).map(|config| FetchConfig::from_engine(&config));
    let login_window_open = login_window::is_open(&app);
    blocking_sync(move || {
        let accounts = account_sync::default_accounts_dir();
        let mut status = account_sync::status(
            engine.as_ref().map_err(String::as_str),
            accounts.as_deref(),
            name.as_deref(),
        );
        status.login_window_open = login_window_open;
        Ok(status)
    })
    .await
}

/// 붙여넣은 쿠키를 한 줄로 정리해 엔진의 쿠키 파일에 쓴다. `game_token=`·`game_openid=`가 없으면 한국어 오류로 거부한다.
/// 돌려주는 것은 저장한 시각과 쿠키 개수뿐이다 — 쿠키의 내용은 돌려주지 않는다.
#[tauri::command]
async fn account_save_cookie(app: AppHandle, cookie: String) -> Result<CookieSaved, SyncFailure> {
    let config = fetch_config(&app)?;
    blocking_sync(move || Ok(account_sync::store_pasted_cookie(&config.engine_dir, &cookie)?)).await
}

/// 엔진의 수집 스크립트(`scraper/profile_fetch.py --name <이름>`)를 실행해 프로필을 받는다.
/// 스크립트가 줄을 낼 때마다 `account-fetch` 이벤트를 오버레이 창으로 보내고(쿠키 값은 가려져 있다),
/// 끝나면 모든 줄과 경고 줄(`[!]`)을 돌려준다. 도는 동안 `account_fetch_cancel`이 불리면 스크립트와 그 자식
/// 프로세스까지 끝내고 '중단됨'으로 돌아온다. 시간 제한이 있다.
#[tauri::command]
async fn account_fetch_profile(app: AppHandle, name: String) -> Result<FetchOutcome, SyncFailure> {
    let config = fetch_config(&app)?;
    blocking_sync(move || {
        let run = app.state::<FetchRun>();
        // 표는 이 함수가 끝날 때(실패로 끝나도) 버려져 자리가 빈다 — 중단 뒤에 다시 받을 수 있다.
        let ticket = run.0.begin().map_err(|_| SyncError::Busy)?;
        let on_line = |line: &FetchLine| {
            // 오버레이 창에만 보낸다. 진행 줄을 못 보내도 수집은 계속한다.
            let _ = app.emit_to(MAIN_WINDOW, ACCOUNT_FETCH_EVENT, line.clone());
        };
        account_sync::fetch_profile(&config, &name, &on_line, ticket.signal())
    })
    .await
}

/// 도는 계정 수집을 멈춘다. 멈출 수집이 있었으면 true — 그 수집의 `account_fetch_profile`이 '중단됨'으로 돌아온다.
#[tauri::command]
fn account_fetch_cancel(run: State<'_, FetchRun>) -> bool {
    run.0.stop()
}

/// 수집 스크립트가 쓴 프로필과 엔진의 오버로드 옵션 표를 읽는다: `{path, profile, option_table}`.
/// 계정 상태로 바꾸는 것은 화면 쪽의 `src/core/import-profile.mjs`다(계산 로직을 여기 다시 쓰지 않는다).
#[tauri::command]
async fn account_read_profile(app: AppHandle, name: String) -> Result<Value, SyncFailure> {
    let config = fetch_config(&app)?;
    blocking_sync(move || Ok(account_sync::read_profile(&config.engine_dir, &name)?)).await
}

/// 계정 상태 문서를 계정 폴더(환경 변수 NIKKE_ACCOUNTS_DIR → 저장소의 data/accounts)의 `<이름>.json`에 쓴다.
/// 이름은 파일 이름에 안전한 글자만 받고(경로를 벗어나는 이름은 거부), 있던 파일은 `.bak`으로 한 벌 남긴다.
#[tauri::command]
async fn account_save_file(name: String, account: Value) -> Result<SavedAccount, SyncFailure> {
    blocking_sync(move || {
        let dir = account_sync::default_accounts_dir()?;
        Ok(account_sync::save_account(&dir, &name, &account)?)
    })
    .await
}

/// blablalink 로그인 창을 연다(이미 열려 있으면 앞으로 가져온다). 그 창은 앱 명령을 부를 수 없다.
#[tauri::command]
async fn login_window_open(app: AppHandle) -> Result<(), SyncFailure> {
    Ok(login_window::open(&app)?)
}

/// 로그인 창의 쿠키 저장소에서 blablalink API 요청에 실릴 쿠키를 읽어 엔진의 쿠키 파일에 쓰고 창을 닫는다.
/// `game_token`·`game_openid`가 없으면 「아직 로그인되지 않았다」로 거부하고 창은 그대로 둔다.
/// 돌려주는 것은 저장한 시각과 쿠키 개수뿐이다 — 쿠키 값은 Rust 안에서만 흐른다.
#[tauri::command]
async fn login_window_take_cookie(app: AppHandle) -> Result<CookieSaved, SyncFailure> {
    let config = fetch_config(&app)?;
    blocking_sync(move || {
        let window = login_window::window(&app).ok_or(SyncError::LoginWindowClosed)?;
        let cookies = login_window::read_cookies(&window)?;
        let saved = account_sync::store_login_cookies(&config.engine_dir, &cookies)?;
        login_window::close(&window);
        Ok(saved)
    })
    .await
}

/// 로그인 창의 세션(쿠키·저장 데이터)을 지운다. 한 일을 한국어 문장으로 돌려준다.
/// 엔진의 쿠키 파일과 오버레이가 기억해 둔 것은 건드리지 않는다.
#[tauri::command]
async fn login_window_clear(app: AppHandle) -> Result<String, SyncFailure> {
    blocking_sync(move || Ok(login_window::clear_session(&app)?.to_string())).await
}

/// 게임 화면을 찍어 캡처 폴더(환경 변수 NIKKE_CAPTURE_DIR → 저장소의 data/captures)에 저장한다.
/// 화면은 저장할 곳을 정하지 못한다 — 라벨만 넘기고, 라벨은 파일 이름에 안전한 글자만 남는다.
fn save_game_capture(app: &AppHandle, label: Option<&str>) -> Result<CaptureRecord, GameError> {
    let tracker = app.state::<GameTracker>();
    if tracker.capturing.swap(true, Ordering::AcqRel) {
        return Err(GameError::Busy);
    }
    let _guard = BusyGuard(&tracker.capturing);
    let dir = capture::default_capture_dir()?;
    capture::capture_game_to_dir(&dir, label)
}

fn game_snapshot(app: &AppHandle, status: GameWindowStatus) -> GameSnapshot {
    GameSnapshot {
        status,
        follow: app.state::<GameTracker>().follow.load(Ordering::Acquire),
    }
}

/// 붙이기 여부를 바꾸고, 추적 스레드를 깨워 바로 반영하게 한다.
fn wake_tracker(app: &AppHandle, follow: bool) {
    let tracker = app.state::<GameTracker>();
    tracker.follow.store(follow, Ordering::Release);
    let thread = lock(&tracker.thread).clone();
    if let Some(thread) = thread {
        thread.unpark();
    }
}

/// 게임 창의 현재 상태(찾음/없음/최소화/런처만, 화면 영역의 위치와 크기)와 붙이기 여부.
#[tauri::command]
async fn game_window_status(app: AppHandle) -> Result<GameSnapshot, String> {
    blocking(move || Ok(game_snapshot(&app, game_window::locate()))).await
}

/// 붙이기를 켜거나 끈다. 켜면 오버레이가 게임 창의 오른쪽 위 안쪽으로 가서 게임 창을 따라다니고,
/// 끄면 그 자리에 머문다. 옮기는 것은 오버레이 창뿐이다.
#[tauri::command]
async fn set_follow_game(app: AppHandle, enabled: bool) -> Result<GameSnapshot, String> {
    wake_tracker(&app, enabled);
    blocking(move || Ok(game_snapshot(&app, game_window::locate()))).await
}

/// 지금 게임 화면을 PNG로 저장하고 기록(`{path, width, height, captured_at, method, window}`)을 돌려준다.
/// 실패하면 한국어 오류 문장.
#[tauri::command]
async fn capture_game(app: AppHandle, label: Option<String>) -> Result<CaptureRecord, String> {
    blocking(move || save_game_capture(&app, label.as_deref()).map_err(|e| e.to_string())).await
}

/// 게임 화면을 찍어 인식만 한다. 프레임은 이 함수 안에서 쓰고 버린다 — 저장하지도 화면에 넘기지도 않는다.
/// 저장용 캡처와 겹치지 않게 같은 표시(`capturing`)를 쓴다.
fn recognize_game(app: &AppHandle) -> Result<Recognition, GameError> {
    let tracker = app.state::<GameTracker>();
    if tracker.capturing.swap(true, Ordering::AcqRel) {
        return Err(GameError::Busy);
    }
    let _guard = BusyGuard(&tracker.capturing);
    let (frame, _method, _window) = capture::grab_game_frame()?;
    Ok(recognize::recognize(&frame))
}

/// 지금 게임 화면이 이상 개체 요격전의 어느 화면인지, 어느 보스가 선택됐는지 알아낸다:
/// `{screen, boss, confidence, evidence, width, height}`. 이미지는 저장하지도 화면에 넘기지도 않는다.
/// 게임이 없거나 최소화돼 있으면 한국어 오류 문장.
#[tauri::command]
async fn recognize_game_screen(app: AppHandle) -> Result<Recognition, String> {
    blocking(move || recognize_game(&app).map_err(|e| e.to_string())).await
}

/// 단축키로 게임 화면을 저장한다. 단축키 처리를 막지 않게 따로 돌리고, 결과는 이벤트로 알린다.
fn capture_from_shortcut(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let outcome = match save_game_capture(&app, None) {
            Ok(record) => GameCaptureOutcome {
                capture: Some(record),
                error: None,
            },
            Err(e) => GameCaptureOutcome {
                capture: None,
                error: Some(e.to_string()),
            },
        };
        if let Err(e) = app.emit(GAME_CAPTURE_EVENT, outcome) {
            eprintln!("캡처 결과를 화면에 알리지 못했다: {e}");
        }
    });
}

/// 오버레이 창의 바깥 너비와 붙이기 여백(물리 픽셀). 창을 읽지 못하면 `None`.
fn overlay_metrics(window: &WebviewWindow) -> Option<(u32, u32)> {
    let width = window.outer_size().ok()?.width;
    let scale = window.scale_factor().ok()?;
    Some((width, (ATTACH_MARGIN * scale).round().max(0.0) as u32))
}

/// 붙이기의 한 주기: 오버레이가 있어야 할 자리를 구해, 규칙(`follow_step`)이 옮기라고 하면 옮긴다.
/// 돌려주는 것은 「마지막으로 옮긴 자리」다. 옮기는 것은 오버레이 창뿐이다.
fn follow_game(
    app: &AppHandle,
    follow: bool,
    status: &GameWindowStatus,
    applied: Option<(i32, i32)>,
) -> Option<(i32, i32)> {
    // 꺼져 있으면 오버레이 창을 읽지도 않는다 — 자리가 없으니 규칙이 「기다린다」로 답한다.
    let window = follow
        .then(|| app.get_webview_window(MAIN_WINDOW))
        .flatten();
    let target = window
        .as_ref()
        .and_then(overlay_metrics)
        .and_then(|(width, margin)| follow_target(follow, status, width, margin));
    match (follow_step(target, applied), window) {
        (FollowStep::MoveTo(x, y), Some(window)) => {
            match window.set_position(PhysicalPosition::new(x, y)) {
                Ok(()) => Some((x, y)),
                Err(e) => {
                    eprintln!("오버레이를 게임 창에 맞춰 옮기지 못했다: {e}");
                    applied
                }
            }
        }
        (FollowStep::Stay, _) => applied,
        // 붙일 곳이 없다(꺼짐·게임 없음·최소화): 오버레이는 그 자리에 두고, 게임 창이 다시 뜨면 새로 붙는다.
        (FollowStep::Wait, _) | (FollowStep::MoveTo(..), None) => None,
    }
}

/// 게임 위에 머물기에 쓰는 오버레이 창. 한 번 얻어 두고 다시 쓴다(창 핸들은 창이 사는 동안 바뀌지 않는다).
#[cfg(windows)]
type OverlayOnTop = Option<overlay_win32::OverlayWindow>;
#[cfg(not(windows))]
type OverlayOnTop = ();

/// 게임 위에 머물기의 한 주기: 게임 창이 오버레이보다 위로 올라왔으면 오버레이 **자기 창**을 활성화 없이 다시
/// 맨 위로 올린다(언제 올릴지는 `stay_on_top`의 규칙). 게임 창은 건드리지 않는다 — 누가 위인지 읽을 뿐이다.
#[cfg(windows)]
fn keep_overlay_on_top(
    app: &AppHandle,
    rule: &mut stay_on_top::StayOnTop,
    overlay: &mut OverlayOnTop,
    overlay_visible: bool,
    status: &GameWindowStatus,
) {
    if overlay.is_none() {
        *overlay = app
            .get_webview_window(MAIN_WINDOW)
            .and_then(|window| overlay_win32::OverlayWindow::of(&window).ok());
    }
    let Some(own) = *overlay else {
        return;
    };
    let decision = rule.step(overlay_visible, status, || own.windows_above());
    if decision == stay_on_top::Decision::Raise && !own.raise_without_activating() {
        // 창이 없어졌을 수 있다 — 다음 주기에 오버레이 창을 다시 얻는다.
        *overlay = None;
    }
}

/// Windows가 아니면 게임 창을 읽지 못하므로 올릴 일도 없다.
#[cfg(not(windows))]
fn keep_overlay_on_top(
    _app: &AppHandle,
    _rule: &mut stay_on_top::StayOnTop,
    _overlay: &mut OverlayOnTop,
    _overlay_visible: bool,
    _status: &GameWindowStatus,
) {
}

/// 게임 창을 지켜본다: 상태가 바뀌면 화면에 알리고, 붙이기가 켜져 있으면 오버레이를 게임 창에 맞춰 옮기고,
/// 게임 창이 오버레이를 덮으면 오버레이를 다시 올린다. 게임 창은 읽기만 한다.
fn track_game(app: AppHandle) {
    let tracker = app.state::<GameTracker>();
    let mut emitted: Option<GameSnapshot> = None;
    let mut applied: Option<(i32, i32)> = None;
    let mut known: Option<GameWindowInfo> = None;
    let mut scanned_at: Option<Instant> = None;
    let mut on_top = stay_on_top::StayOnTop::new();
    let mut overlay_window = OverlayOnTop::default();
    loop {
        let follow = tracker.follow.load(Ordering::Acquire);
        let overlay_visible = lock(&app.state::<Overlay>().state).visible;
        // 찾아 둔 창만 가볍게 다시 읽고, 가끔 창 목록을 처음부터 훑는다.
        let fresh = scanned_at.is_some_and(|at| at.elapsed() < RESCAN_INTERVAL);
        let refreshed = known
            .as_ref()
            .filter(|_| fresh)
            .and_then(game_window::refresh_game_window);
        let status = match refreshed {
            Some(window) => GameWindowStatus::from_window(window),
            None => {
                scanned_at = Some(Instant::now());
                game_window::locate()
            }
        };
        known = status.window.clone();

        applied = follow_game(&app, follow, &status, applied);
        // 붙이기로 옮긴 뒤에 본다 — 붙이기를 켜지 않았어도 본다.
        keep_overlay_on_top(&app, &mut on_top, &mut overlay_window, overlay_visible, &status);

        let pause = stay_on_top::watch_interval(follow, overlay_visible, &status);
        let snapshot = GameSnapshot { status, follow };
        if emitted.as_ref() != Some(&snapshot) {
            if let Err(e) = app.emit(GAME_WINDOW_EVENT, snapshot.clone()) {
                eprintln!("게임 창 상태를 화면에 알리지 못했다: {e}");
            }
            emitted = Some(snapshot);
        }
        thread::park_timeout(pause);
    }
}

/// 게임 창 추적 스레드를 깨운다(오버레이가 다시 보였다) — 주기를 기다리지 않고 바로 창 순서를 다시 본다.
fn wake_game_tracker(app: &AppHandle) {
    let thread = lock(&app.state::<GameTracker>().thread).clone();
    if let Some(thread) = thread {
        thread.unpark();
    }
}

/// 게임 창 추적 스레드를 띄운다.
fn start_game_tracker(app: &AppHandle) {
    let handle = app.clone();
    match thread::Builder::new()
        .name("game-tracker".to_string())
        .spawn(move || track_game(handle))
    {
        Ok(joined) => *lock(&app.state::<GameTracker>().thread) = Some(joined.thread().clone()),
        Err(e) => eprintln!("게임 창 추적을 시작하지 못했다: {e}"),
    }
}

/// 자동 추적의 한 주기: 읽어도 되는지 보고(`screen_track`의 규칙), 되면 게임 화면을 찍어 인식만 한다.
/// 프레임은 이 함수 안에서 쓰고 버린다 — 저장하지도 화면에 넘기지도 않는다. 게임 창은 읽기만 한다.
/// 저장용 캡처와 겹치지 않게 같은 표시(`capturing`)를 쓴다 — 겹치면 이번 주기를 건너뛴다.
fn read_screen(app: &AppHandle, settings: TrackSettings) -> Reading {
    let visible = lock(&app.state::<Overlay>().state).visible;
    if let Err(pause) = screen_track::overlay_gate(settings.enabled, visible) {
        return Reading::Paused(pause);
    }
    let status = game_window::locate();
    let window = match screen_track::game_gate(&status) {
        Ok(window) => window,
        Err(reading) => return reading,
    };
    let game = app.state::<GameTracker>();
    if game.capturing.swap(true, Ordering::AcqRel) {
        return Reading::Busy;
    }
    let _guard = BusyGuard(&game.capturing);
    let started = Instant::now();
    match game_window::capture_window(window) {
        Ok((frame, _method)) => {
            let recognition = recognize::recognize(&frame);
            Reading::Recognized {
                recognition,
                capture_ms: u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX),
            }
        }
        Err(e) => screen_track::reading_from_error(&e),
    }
}

/// 추적 상태를 화면에 알린다. 못 보내도 추적은 계속한다.
fn emit_screen_track(app: &AppHandle, status: TrackStatus) {
    if let Err(e) = app.emit(SCREEN_TRACK_EVENT, status) {
        eprintln!("화면 추적 상태를 화면에 알리지 못했다: {e}");
    }
}

/// 화면 추적 스레드를 깨운다(설정이 바뀌었거나 오버레이가 다시 보였다) — 주기를 기다리지 않고 바로 다시 본다.
fn wake_screen_tracker(app: &AppHandle) {
    let thread = lock(&app.state::<ScreenTracker>().thread).clone();
    if let Some(thread) = thread {
        thread.unpark();
    }
}

/// 켜 둔 동안 주기마다 게임 화면을 읽어 인식하고, 결과가 바뀔 때만 화면에 알린다. 꺼져 있으면 깨울 때까지 잔다.
/// 어떤 실패도 상태로만 남기고 다음 주기에 다시 본다 — 이 스레드는 끝나지 않는다.
fn track_screen(app: AppHandle) {
    let tracker = app.state::<ScreenTracker>();
    loop {
        let settings = *lock(&tracker.settings);
        if !settings.enabled {
            // 켜질 때까지 아무것도 하지 않는다(창 열거도 캡처도 없다). 가짜로 깨어나면 다시 확인하고 잔다.
            thread::park();
            continue;
        }
        // 읽는 도중의 예기치 못한 오류(패닉)도 상태로 바꾼다 — 스레드가 죽으면 추적이 조용히 멈춘다.
        let reading = catch_unwind(AssertUnwindSafe(|| read_screen(&app, settings)))
            .unwrap_or_else(|_| Reading::Failed {
                message: "게임 화면을 읽다가 예기치 못한 오류가 났다".to_string(),
            });
        let (utc, _local) = capture::now_stamps();
        let changed = {
            let mut log = lock(&tracker.log);
            log.observe(reading, &utc.iso_utc())
                .then(|| log.status().clone())
        };
        if let Some(status) = changed {
            emit_screen_track(&app, status);
        }
        thread::park_timeout(Duration::from_millis(settings.interval_ms));
    }
}

/// 화면 추적 스레드를 띄운다. 처음에는 꺼져 있어 자기만 한다.
fn start_screen_tracker(app: &AppHandle) {
    let handle = app.clone();
    match thread::Builder::new()
        .name("screen-tracker".to_string())
        .spawn(move || track_screen(handle))
    {
        Ok(joined) => *lock(&app.state::<ScreenTracker>().thread) = Some(joined.thread().clone()),
        Err(e) => eprintln!("화면 추적을 시작하지 못했다: {e}"),
    }
}

/// 요격전 화면 자동 추적을 켜거나 끄고 주기(밀리초, 없으면 2초)를 정한다. 지금 상태를 돌려준다.
/// 켜면 추적 스레드가 주기마다 게임 화면을 읽어 인식하고, 결과가 바뀔 때 `screen-track` 이벤트를 보낸다.
/// 화면이 정할 수 있는 것은 이 둘뿐이다 — 무엇을 찍을지·어디에 둘지는 정하지 못한다(찍은 것은 저장하지 않는다).
#[tauri::command]
fn set_screen_tracking(app: AppHandle, enabled: bool, interval_ms: Option<u64>) -> TrackStatus {
    let tracker = app.state::<ScreenTracker>();
    let settings = TrackSettings::new(enabled, interval_ms);
    *lock(&tracker.settings) = settings;
    let (status, changed) = {
        let mut log = lock(&tracker.log);
        let changed = log.configure(settings);
        (log.status().clone(), changed)
    };
    if changed {
        emit_screen_track(&app, status.clone());
    }
    wake_screen_tracker(&app);
    status
}

/// 자동 추적의 지금 상태: `{enabled, interval_ms, state, message, recognition, read_at, capture_ms, failures}`.
/// 캡처하지 않는다 — 추적 스레드가 마지막으로 남긴 것을 돌려줄 뿐이다.
#[tauri::command]
fn screen_track_status(tracker: State<'_, ScreenTracker>) -> TrackStatus {
    lock(&tracker.log).status().clone()
}

/// 현재 오버레이 상태.
#[tauri::command]
fn overlay_status(overlay: State<'_, Overlay>) -> OverlaySnapshot {
    overlay.snapshot()
}

/// 실행 인자로 받은 결과 파일 경로(`nikke-companion.exe <결과.json>`). 없으면 null.
#[tauri::command]
fn startup_report_path() -> Option<String> {
    report::first_path_arg(std::env::args().skip(1))
}

/// 앱을 끝낸다. 테두리도 작업 표시줄 단추도 없어서 화면의 닫기 단추가 이것을 부른다.
/// 돌던 엔진 계산·계정 수집은 앱이 끝나는 길(`run`의 종료 처리 — `stop_running_work`)에서 멈춘다.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// 앱이 끝날 때: 돌던 엔진 계산과 계정 수집을 멈추고, 그 프로세스들(자식까지)이 끝나 자리가 빌 때까지 잠깐 기다린다.
/// 끝내기 단추·오버레이 창 닫기 어느 길로 끝나든 여기를 지난다. 시간 안에 끝나지 않아도 앱은 끝난다 — 그때와
/// 앱이 여기를 지나지 못하고 죽었을 때(프로세스 종료·충돌)는 프로세스 묶음(`engine_win32.rs`)이 앱과 함께 닫히며 끝낸다.
fn stop_running_work(app: &AppHandle) {
    let engine_run = app.state::<EngineRun>();
    let fetch_run = app.state::<FetchRun>();
    if !engine::stop_all_and_wait(&[&engine_run.0, &fetch_run.0], engine::EXIT_GRACE) {
        eprintln!("앱을 끝내는 동안 엔진·수집 프로세스가 제때 끝나지 않았다 — 프로세스 묶음이 닫히며 끝난다");
    }
}

/// 전환 결과에서 바뀐 것만 창에 반영한다. 어느 변화도 창을 활성화하지 않는다(게임의 키보드 포커스를 건드리지 않는다).
fn apply_transition(window: &WebviewWindow, t: &Transition) -> Result<(), String> {
    if let Some(ignore) = t.set_click_through {
        // 창 스타일만 바꾼다 — 보이기·활성화 호출이 아니다.
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    match t.visibility_change() {
        Some(VisibilityChange::ShowWithoutActivating) => show_overlay_without_activating(window),
        Some(VisibilityChange::Hide) => hide_overlay(window),
        None => Ok(()),
    }
}

/// 오버레이를 활성화하지 않고 보인다. Windows에서는 Win32의 활성화 없는 표시(SW_SHOWNA)를 쓴다 —
/// 창 라이브러리의 `show()`는 창을 활성화해 게임의 키보드 포커스를 가져간다.
#[cfg(windows)]
fn show_overlay_without_activating(window: &WebviewWindow) -> Result<(), String> {
    overlay_win32::show_without_activating(window)
}

/// Windows가 아니면 창 라이브러리의 보이기를 그대로 쓴다(기존 동작 — 활성화 여부는 그 플랫폼을 따른다).
#[cfg(not(windows))]
fn show_overlay_without_activating(window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())
}

/// 오버레이를 숨긴다. Windows에서는 보이기와 같은 길(Win32)로 숨긴다 — 두 길을 섞으면 창 라이브러리가 아는
/// 보임 상태와 실제가 어긋난다(`overlay_win32.rs`).
#[cfg(windows)]
fn hide_overlay(window: &WebviewWindow) -> Result<(), String> {
    overlay_win32::hide(window)
}

#[cfg(not(windows))]
fn hide_overlay(window: &WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// 단축키 동작 하나를 처리한다: 규칙으로 다음 상태를 구하고, 창에 반영하고, 화면에 알린다.
fn handle_action(app: &AppHandle, action: OverlayAction) {
    let overlay = app.state::<Overlay>();
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    {
        let mut state = lock(&overlay.state);
        let transition = state.apply(action);
        if transition.is_noop() {
            return;
        }
        if let Err(e) = apply_transition(&window, &transition) {
            // 창에 반영하지 못했으면 상태도 바꾸지 않는다(화면 표시와 실제가 어긋나지 않게).
            eprintln!("오버레이 상태를 창에 반영하지 못했다: {e}");
            return;
        }
        *state = transition.next;
    }
    if let Err(e) = app.emit(OVERLAY_STATE_EVENT, overlay.snapshot()) {
        eprintln!("오버레이 상태를 화면에 알리지 못했다: {e}");
    }
    // 숨기면 화면 추적이 쉬고, 다시 보이면 주기를 기다리지 않고 바로 읽는다.
    wake_screen_tracker(app);
    // 다시 보였을 때 게임이 위에 있으면 곧바로 올린다(숨긴 동안에는 올리지 않는다).
    wake_game_tracker(app);
}

/// 오버레이를 한 번 더 실행했을 때 이미 떠 있는 쪽이 하는 일: 숨겨져 있었다면 보인다 — 활성화 없이
/// (게임을 하다가 바로 가기를 눌렀어도 게임의 키보드 포커스는 그대로다). 두 번째 실행은 창을 만들지 않고 끝난다.
///
/// 논리 상태가 「보임」이어도 창에 한 번 더 요청한다: 이미 보이는 창에는 아무 일도 일어나지 않고,
/// 상태와 실제 창이 어긋나 있었다면(그럴 일은 없어야 하지만) 이때 맞춰진다.
fn reveal_overlay(app: &AppHandle) {
    let overlay = app.state::<Overlay>();
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let changed = {
        let mut state = lock(&overlay.state);
        let transition = state.apply(OverlayAction::Show);
        if let Err(e) = show_overlay_without_activating(&window) {
            eprintln!("두 번째 실행을 받았지만 오버레이를 보이지 못했다: {e}");
            return;
        }
        *state = transition.next;
        !transition.is_noop()
    };
    if changed {
        if let Err(e) = app.emit(OVERLAY_STATE_EVENT, overlay.snapshot()) {
            eprintln!("오버레이 상태를 화면에 알리지 못했다: {e}");
        }
        wake_screen_tracker(app);
    }
    // 보이게 한 창이 게임 아래에 있으면 곧바로 올린다.
    wake_game_tracker(app);
}

/// 전역 단축키를 등록한다. 하나가 실패해도 나머지는 등록하고, 실패는 화면에 보이도록 남긴다.
fn register_shortcuts(app: &AppHandle) {
    let overlay = app.state::<Overlay>();
    for def in &SHORTCUTS {
        let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), def.code);
        let action = def.action;
        let registered = app
            .global_shortcut()
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    match action {
                        ShortcutAction::Overlay(action) => handle_action(app, action),
                        ShortcutAction::CaptureGame => capture_from_shortcut(app),
                    }
                }
            });
        if let Err(e) = registered {
            let problem = format!(
                "단축키 {}({})를 등록하지 못했다 — 다른 프로그램이 쓰고 있을 수 있다 ({e})",
                def.keys, def.what
            );
            eprintln!("{problem}");
            lock(&overlay.shortcut_problems).push(problem);
        }
    }
}

/// 창을 주 모니터 작업 영역의 오른쪽 위에 둔다. 모니터를 알 수 없으면 그대로 둔다.
fn place_top_right(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = match window.primary_monitor()? {
        Some(m) => Some(m),
        None => window.current_monitor()?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = monitor.work_area();
    let margin = (SCREEN_MARGIN * monitor.scale_factor()).round().max(0.0) as u32;
    let (x, y) = top_right_position(
        area.position.x,
        area.position.y,
        area.size.width,
        window.outer_size()?.width,
        margin,
    );
    window.set_position(PhysicalPosition::new(x, y))
}

pub fn run() {
    tauri::Builder::default()
        // 맨 먼저 등록한다: 이미 떠 있는 오버레이가 있으면 이 실행은 여기서(창을 만들고 단축키를 등록하기 전에) 끝나고,
        // 떠 있던 쪽에서 아래 함수가 불린다. 실행 인자와 작업 폴더는 쓰지 않는다.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_overlay(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Overlay::default())
        .manage(EngineRun::default())
        .manage(GameTracker::default())
        .manage(ScreenTracker::default())
        .manage(FetchRun::default())
        .invoke_handler(tauri::generate_handler![
            load_report,
            overlay_status,
            startup_report_path,
            quit_app,
            engine_catalog,
            engine_version,
            engine_run_batch,
            engine_cancel,
            read_json_file,
            pick_json_file,
            game_window_status,
            set_follow_game,
            capture_game,
            recognize_game_screen,
            set_screen_tracking,
            screen_track_status,
            account_sync_status,
            account_save_cookie,
            account_fetch_profile,
            account_fetch_cancel,
            account_read_profile,
            account_save_file,
            login_window_open,
            login_window_take_cookie,
            login_window_clear
        ])
        .setup(|app| {
            let window = app
                .get_webview_window(MAIN_WINDOW)
                .ok_or("오버레이 창(main)이 설정에 없다")?;
            // 설정에서는 숨긴 채 만들고, 자리를 잡은 뒤에 보인다(엉뚱한 자리에서 번쩍이지 않게).
            // 시작할 때만 창 라이브러리의 show()를 쓴다 — 사용자가 방금 띄운 창이라 활성화돼도 된다.
            // 그 뒤의 보임/숨김(단축키)은 활성화 없는 길로만 한다(apply_transition).
            if let Err(e) = place_top_right(&window) {
                eprintln!("창을 화면 오른쪽 위로 옮기지 못했다: {e}");
            }
            window.show()?;
            register_shortcuts(app.handle());
            start_game_tracker(app.handle());
            start_screen_tracker(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // 오버레이 창이 닫히면(Alt+F4 등) 앱을 끝낸다 — 로그인 창이 떠 있어도 오버레이 없이 남지 않는다.
            // 돌던 계산·수집은 아래 종료 처리에서 멈춘다.
            if window.label() == MAIN_WINDOW && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("니케 컴패니언 오버레이를 시작하지 못했다")
        .run(|app, event| {
            // 앱이 끝나는 모든 길(끝내기 단추, 창 닫기)이 여기를 지난다. 프로세스가 끝나기 직전이다.
            if let tauri::RunEvent::Exit = event {
                stop_running_work(app);
            }
        });
}
