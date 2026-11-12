//! 니케 컴패니언 오버레이 — Tauri 쪽.
//!
//! 이 파일은 창·단축키·명령을 잇는 접착 코드다. 규칙은 창 API를 모르는 모듈에 있다:
//! - `overlay_state`: 보임/숨김·클릭 통과의 전환 규칙, 시작 위치 계산
//! - `report`: 비교 결과 JSON 읽기와 형식 확인, 입력 JSON 파일 읽기
//! - `engine`: 계산 엔진(vendor/nikke-calc) 프로세스 실행·카탈로그·버전. 계산 로직은 없다
//! - `game_window`: 게임 창을 고르는 규칙, 창 정보, 오버레이를 게임 창에 붙이는 위치 계산
//! - `capture`: 캡처한 프레임의 판정(빈 화면)·파일 이름·PNG 저장
//! - `capture_cli`: 명령줄 도구 `nikke-capture`의 동작
//! - `game_win32`(비공개): 위 규칙에 값을 대 주는 Win32 호출 — 창 열거, 창 사각형, Windows.Graphics.Capture
//! - `overlay_win32`: 오버레이 창(이 앱의 창)만 다루는 Win32 호출 — 활성화 없이 보이기·숨기기, 파일 고르기 창의 부모
//! - `engine_win32`(비공개): 이 앱이 띄운 엔진 프로세스를 묶어 끝내는 Job Object
//!
//! 편성 비교·추천의 계산은 화면 쪽의 `src/core`(JS)가 하고, 여기서는 엔진 프로세스만 대신 띄운다.
//! 네트워크 요청은 하지 않는다.
//!
//! 게임은 읽기만 한다: 게임 창을 옮기거나 크기를 바꾸거나 앞으로 가져오지 않고, 입력을 보내지 않는다.
//! 붙이기가 옮기는 것은 오버레이 창뿐이다.

pub mod capture;
pub mod capture_cli;
pub mod engine;
#[cfg(windows)]
mod engine_win32;
#[cfg(windows)]
mod game_win32;
pub mod game_window;
pub mod overlay_state;
#[cfg(windows)]
pub mod overlay_win32;
pub mod report;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use capture::CaptureRecord;
use game_window::{follow_move, follow_target, GameError, GameWindowInfo, GameWindowStatus};
use overlay_state::{
    top_right_position, OverlayAction, OverlayState, Transition, VisibilityChange,
};

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

/// 엔진 설정 파일 이름. 앱 설정 폴더(`%APPDATA%/<identifier>`)에 둔다.
const SETTINGS_FILE: &str = "settings.json";

/// 시작할 때 화면 가장자리에서 띄우는 거리(논리 픽셀).
const SCREEN_MARGIN: f64 = 24.0;

/// 붙이기를 켰을 때 게임 화면 가장자리에서 띄우는 거리(논리 픽셀).
const ATTACH_MARGIN: f64 = 12.0;

/// 붙이기가 켜져 있을 때 게임 창의 위치를 다시 읽는 간격.
const FOLLOW_INTERVAL: Duration = Duration::from_millis(50);
/// 붙이기가 꺼져 있을 때 게임 창 상태를 다시 읽는 간격.
const IDLE_INTERVAL: Duration = Duration::from_millis(1000);
/// 붙이기 중에 창 목록을 처음부터 다시 훑는 간격(그 사이에는 찾아 둔 창만 다시 읽는다).
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

/// 게임 창을 지켜본다: 상태가 바뀌면 화면에 알리고, 붙이기가 켜져 있으면 오버레이를 게임 창에 맞춰 옮긴다.
/// 게임 창은 읽기만 한다.
fn track_game(app: AppHandle) {
    let tracker = app.state::<GameTracker>();
    let mut emitted: Option<GameSnapshot> = None;
    let mut applied: Option<(i32, i32)> = None;
    let mut known: Option<GameWindowInfo> = None;
    let mut scanned_at: Option<Instant> = None;
    loop {
        let follow = tracker.follow.load(Ordering::Acquire);
        // 붙이기 중에는 찾아 둔 창만 가볍게 다시 읽고, 가끔 창 목록을 처음부터 훑는다.
        let fresh = scanned_at.is_some_and(|at| at.elapsed() < RESCAN_INTERVAL);
        let refreshed = known
            .as_ref()
            .filter(|_| follow && fresh)
            .and_then(game_window::refresh_game_window);
        let status = match refreshed {
            Some(window) => GameWindowStatus::from_window(window),
            None => {
                scanned_at = Some(Instant::now());
                game_window::locate()
            }
        };
        known = status.window.clone();

        if !follow {
            // 꺼져 있는 동안에는 옮기지 않는다. 다시 켜면 처음부터 자리를 잡는다.
            applied = None;
        } else if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let target = overlay_metrics(&window)
                .and_then(|(width, margin)| follow_target(follow, &status, width, margin));
            if let Some((x, y)) = follow_move(target, applied) {
                match window.set_position(PhysicalPosition::new(x, y)) {
                    Ok(()) => applied = Some((x, y)),
                    Err(e) => eprintln!("오버레이를 게임 창에 맞춰 옮기지 못했다: {e}"),
                }
            }
        }

        let snapshot = GameSnapshot { status, follow };
        if emitted.as_ref() != Some(&snapshot) {
            if let Err(e) = app.emit(GAME_WINDOW_EVENT, snapshot.clone()) {
                eprintln!("게임 창 상태를 화면에 알리지 못했다: {e}");
            }
            emitted = Some(snapshot);
        }
        thread::park_timeout(if follow {
            FOLLOW_INTERVAL
        } else {
            IDLE_INTERVAL
        });
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
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Overlay::default())
        .manage(EngineRun::default())
        .manage(GameTracker::default())
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
            capture_game
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("니케 컴패니언 오버레이를 시작하지 못했다");
}
