//! 니케 컴패니언 오버레이 — Tauri 쪽.
//!
//! 이 파일은 창·단축키·명령을 잇는 접착 코드다. 규칙은 창 API를 모르는 모듈에 있다:
//! - `overlay_state`: 보임/숨김·클릭 통과의 전환 규칙, 시작 위치 계산
//! - `report`: 비교 결과 JSON 읽기와 형식 확인
//!
//! 네트워크 요청은 하지 않는다. 엔진 호출·게임 창 추적·화면 캡처는 다음 작업이다.

pub mod overlay_state;
pub mod report;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use overlay_state::{top_right_position, OverlayAction, OverlayState, Transition};

/// tauri.conf.json의 창 label.
const MAIN_WINDOW: &str = "main";

/// 상태가 바뀔 때 화면으로 보내는 이벤트. 프런트의 `OVERLAY_STATE_EVENT`(src/lib/backend.ts)와 같아야 한다.
pub const OVERLAY_STATE_EVENT: &str = "overlay-state";

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
        .invoke_handler(tauri::generate_handler![
            load_report,
            overlay_status,
            startup_report_path,
            quit_app
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
