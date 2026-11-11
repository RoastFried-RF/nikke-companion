//! 니케 컴패니언 오버레이 — Tauri 쪽.
//!
//! 이 파일은 창·단축키·명령을 잇는 접착 코드다. 규칙은 창 API를 모르는 모듈에 있다:
//! - `overlay_state`: 보임/숨김·클릭 통과의 전환 규칙, 시작 위치 계산
//! - `report`: 비교 결과 JSON 읽기와 형식 확인, 입력 JSON 파일 읽기
//! - `engine`: 계산 엔진(vendor/nikke-calc) 프로세스 실행·카탈로그·버전. 계산 로직은 없다
//!
//! 편성 비교·추천의 계산은 화면 쪽의 `src/core`(JS)가 하고, 여기서는 엔진 프로세스만 대신 띄운다.
//! 네트워크 요청은 하지 않는다. 게임 창 추적·화면 캡처는 다음 작업이다.

pub mod engine;
pub mod overlay_state;
pub mod report;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use overlay_state::{top_right_position, OverlayAction, OverlayState, Transition};

/// tauri.conf.json의 창 label.
const MAIN_WINDOW: &str = "main";

/// 상태가 바뀔 때 화면으로 보내는 이벤트. 프런트의 `OVERLAY_STATE_EVENT`(src/lib/backend.ts)와 같아야 한다.
pub const OVERLAY_STATE_EVENT: &str = "overlay-state";

/// 엔진 계산이 한 건 끝날 때마다 화면으로 보내는 이벤트. 프런트의 `ENGINE_PROGRESS_EVENT`와 같아야 한다.
pub const ENGINE_PROGRESS_EVENT: &str = "engine-progress";

/// 엔진 설정 파일 이름. 앱 설정 폴더(`%APPDATA%/<identifier>`)에 둔다.
const SETTINGS_FILE: &str = "settings.json";

/// 시작할 때 화면 가장자리에서 띄우는 거리(논리 픽셀).
const SCREEN_MARGIN: f64 = 24.0;

/// 전역 단축키. 둘 다 Alt+Shift 조합이다.
const SHORTCUTS: [ShortcutDef; 2] = [
    ShortcutDef {
        keys: "Alt+Shift+C",
        what: "클릭 통과 전환",
        code: Code::KeyC,
        action: OverlayAction::ToggleClickThrough,
    },
    ShortcutDef {
        keys: "Alt+Shift+O",
        what: "창 숨김/보임",
        code: Code::KeyO,
        action: OverlayAction::ToggleVisibility,
    },
];

struct ShortcutDef {
    keys: &'static str,
    what: &'static str,
    code: Code,
    action: OverlayAction,
}

/// 앱이 들고 있는 오버레이 상태.
#[derive(Default)]
struct Overlay {
    state: Mutex<OverlayState>,
    /// 등록하지 못한 단축키의 설명. 화면에 그대로 보인다.
    shortcut_problems: Mutex<Vec<String>>,
}

/// 엔진 배치가 돌고 있는지. 화면이 두 번 눌러도 엔진 프로세스를 겹쳐 띄우지 않는다.
#[derive(Default)]
struct EngineBusy(AtomicBool);

/// 배치가 끝나면(오류로 끝나도) 표시를 내린다.
struct BusyGuard<'a>(&'a AtomicBool);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
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

/// 엔진 버전(`{repo, commit}`). 커밋을 알 수 없으면 commit은 null.
#[tauri::command]
async fn engine_version(app: AppHandle) -> Result<Value, String> {
    let config = engine_config(&app)?;
    blocking(move || Ok(engine::version(&config.engine_dir))).await
}

/// 요청 여러 건을 엔진 배치로 돌린다. 결과는 입력 순서 그대로이고, 줄마다 결과 또는 `{error}`다.
/// 한 건이 끝날 때마다 `engine-progress` 이벤트를 보낸다.
#[tauri::command]
async fn engine_run_batch(app: AppHandle, requests: Vec<Value>) -> Result<Vec<Value>, String> {
    let config = engine_config(&app)?;
    blocking(move || {
        let busy = app.state::<EngineBusy>();
        if busy.0.swap(true, Ordering::AcqRel) {
            return Err(engine::EngineError::Busy.to_string());
        }
        let _guard = BusyGuard(&busy.0);
        let progress = |done: usize, total: usize| {
            // 진행 표시를 못 보내도 계산은 계속한다.
            let _ = app.emit(ENGINE_PROGRESS_EVENT, EngineProgress { done, total });
        };
        engine::run_batch(&config, &requests, Some(&progress)).map_err(|e| e.to_string())
    })
    .await
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
    // 오버레이는 항상 위 창이다. 대화 상자를 이 창의 자식으로 띄워야 뒤에 가려지지 않는다.
    let picked = rfd::FileDialog::new()
        .set_title(title)
        .add_filter("JSON", &["json"])
        .set_parent(window)
        .pick_file();
    Ok(picked.map(|path| path.display().to_string()))
}

#[cfg(not(windows))]
fn pick_json_file_dialog(_window: &WebviewWindow, _title: &str) -> Result<Option<String>, String> {
    Err("파일 고르기 창은 Windows에서만 쓸 수 있다. 경로를 직접 넣어라".to_string())
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

/// 전환 결과에서 바뀐 것만 창에 반영한다.
fn apply_transition(window: &WebviewWindow, t: &Transition) -> tauri::Result<()> {
    if let Some(ignore) = t.set_click_through {
        window.set_ignore_cursor_events(ignore)?;
    }
    match t.set_visible {
        Some(true) => window.show()?,
        Some(false) => window.hide()?,
        None => {}
    }
    Ok(())
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
                    handle_action(app, action);
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
        .manage(EngineBusy::default())
        .invoke_handler(tauri::generate_handler![
            load_report,
            overlay_status,
            startup_report_path,
            quit_app,
            engine_catalog,
            engine_version,
            engine_run_batch,
            read_json_file,
            pick_json_file
        ])
        .setup(|app| {
            let window = app
                .get_webview_window(MAIN_WINDOW)
                .ok_or("오버레이 창(main)이 설정에 없다")?;
            // 설정에서는 숨긴 채 만들고, 자리를 잡은 뒤에 보인다(엉뚱한 자리에서 번쩍이지 않게).
            if let Err(e) = place_top_right(&window) {
                eprintln!("창을 화면 오른쪽 위로 옮기지 못했다: {e}");
            }
            window.show()?;
            register_shortcuts(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("니케 컴패니언 오버레이를 시작하지 못했다");
}
