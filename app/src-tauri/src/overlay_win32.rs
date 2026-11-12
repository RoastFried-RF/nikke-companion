//! 오버레이 창(이 앱의 창)에만 쓰는 Win32 호출: 활성화 없이 보이기·숨기기, 활성화 없이 다시 맨 위로 올리기
//! (게임 위에 머물기), 파일 고르기 창의 부모.
//!
//! 창 라이브러리(tao)의 `show()`는 `ShowWindow(SW_SHOW)`라서 창을 보이면서 **활성화한다** — 게임을 하다가
//! Alt+Shift+O로 오버레이를 다시 보이면 게임이 키보드 포커스를 잃는다. 그래서 단축키로 보이고 숨기는 것은
//! 여기서 직접 한다: 보일 때는 `SW_SHOWNA`(지금 크기·자리 그대로, 활성화하지 않음), 숨길 때는 `SW_HIDE`.
//!
//! 여기서 건드리는 창은 **오버레이 창 하나뿐**이다. 핸들은 Tauri가 준 이 앱의 창 핸들이고, 다른 창(게임 창)을
//! 찾거나 받지 않는다. 활성화(전경으로 가져오기)·포커스 주기·입력 보내기는 하지 않는다.
//!
//! 게임 위에 머물기(P-024): 니케 게임 창은 항상 위 창이라, 게임을 누르면 게임이 오버레이를 덮는다. 그래서 오버레이가
//! **자기 창**의 순서를 다시 맨 위로 올린다 — `OverlayWindow::raise_without_activating`. 창 순서를 바꾸는 호출
//! (`SetWindowPos`)은 그 한 곳에만 있고, `OverlayWindow`는 이 프로세스의 창으로만 만들어진다(다른 프로그램의 창
//! 핸들로는 만들 수 없다). 언제 올릴지는 `stay_on_top.rs`의 규칙이 정한다. `tests/contract.test.ts`가 이 약속을 확인한다.
//!
//! 알아 둘 것 — 창 라이브러리와의 어긋남: 시작할 때 한 번 `window.show()`로 보인 뒤에는 보임/숨김을 여기서만 바꾸므로
//! 창 라이브러리는 이 창이 계속 보인다고 안다. 그 상태에서 창 스타일을 바꾸는 호출(클릭 통과 전환 등)을 **숨긴 동안에**
//! 부르면 창 라이브러리가 "보임" 스타일을 다시 입혀 창이 나타날 수 있다. 지금은 일어나지 않는다 — 전환 규칙
//! (`overlay_state.rs`)이 숨긴 동안의 클릭 통과 전환을 무시한다. 보임/숨김을 `window.show()`·`window.hide()`와 섞어 쓰지 말 것.

use std::num::NonZeroIsize;

use raw_window_handle::{
    DisplayHandle, HandleError, HasDisplayHandle, HasWindowHandle, RawWindowHandle,
    Win32WindowHandle, WindowHandle,
};
use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindow, GetWindowThreadProcessId, IsWindow, SetWindowPos, ShowWindowAsync, GW_HWNDPREV,
    HWND_TOPMOST, SET_WINDOW_POS_FLAGS, SHOW_WINDOW_CMD, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNA,
};

/// 오버레이를 보일 때 쓰는 표시 방법: 지금 크기와 자리 그대로 보이되 **활성화하지 않는다**.
pub const SHOW_COMMAND: SHOW_WINDOW_CMD = SW_SHOWNA;

/// 오버레이를 숨길 때 쓰는 표시 방법.
pub const HIDE_COMMAND: SHOW_WINDOW_CMD = SW_HIDE;

/// 오버레이 창의 핸들 값. Tauri가 준 이 앱의 창 핸들이다.
fn overlay_handle(window: &WebviewWindow) -> Result<isize, String> {
    let hwnd = window
        .hwnd()
        .map_err(|e| format!("오버레이 창의 핸들을 얻지 못했다: {e}"))?;
    match hwnd.0 as isize {
        0 => Err("오버레이 창의 핸들이 비어 있다".to_string()),
        value => Ok(value),
    }
}

/// 창에 표시 방법을 건다. 창을 가진 스레드에 맡기고 기다리지 않는다(`ShowWindowAsync`) — 부르는 스레드가
/// 창 스레드가 아니어도, 창 스레드가 바빠도 막히지 않는다.
fn request_show(hwnd: isize, command: SHOW_WINDOW_CMD) -> bool {
    // SAFETY: 창 핸들 값을 그대로 넘긴다. 유효하지 않은 핸들이면 FALSE가 돌아올 뿐이다.
    unsafe { ShowWindowAsync(HWND(hwnd as _), command) }.as_bool()
}

/// 핸들 값으로 받은 **이 앱의 창**을 활성화하지 않고 보인다. 요청을 창에 걸었으면 `true`.
///
/// 앱에서는 `show_without_activating`이 오버레이 창의 핸들로 부른다. 따로 공개한 것은 테스트가 자기 창으로
/// 같은 호출을 확인할 수 있게 하려는 것이다(`tests/live_overlay.rs`).
pub fn show_handle_without_activating(hwnd: isize) -> bool {
    request_show(hwnd, SHOW_COMMAND)
}

/// 핸들 값으로 받은 **이 앱의 창**을 숨긴다. 요청을 창에 걸었으면 `true`.
pub fn hide_handle(hwnd: isize) -> bool {
    request_show(hwnd, HIDE_COMMAND)
}

/// 오버레이 창을 활성화하지 않고 보인다 — 지금 키보드 포커스를 가진 프로그램(게임)이 그대로 입력을 받는다.
pub(crate) fn show_without_activating(window: &WebviewWindow) -> Result<(), String> {
    if show_handle_without_activating(overlay_handle(window)?) {
        Ok(())
    } else {
        Err("오버레이 창을 보이지 못했다".to_string())
    }
}

/// 오버레이 창을 숨긴다.
pub(crate) fn hide(window: &WebviewWindow) -> Result<(), String> {
    if hide_handle(overlay_handle(window)?) {
        Ok(())
    } else {
        Err("오버레이 창을 숨기지 못했다".to_string())
    }
}

// ── 게임 위에 머물기 ──────────────────────────────────────────────────────────

/// 오버레이를 다시 맨 위로 올릴 때의 방법: 자리도 크기도 바꾸지 않고, **활성화하지 않는다**(키보드 포커스는 지금
/// 가진 프로그램 — 게임 — 에 그대로 있다). 창을 가진 스레드에 맡기고 기다리지 않는다.
pub const RAISE_FLAGS: SET_WINDOW_POS_FLAGS = SET_WINDOW_POS_FLAGS(
    SWP_NOMOVE.0 | SWP_NOSIZE.0 | SWP_NOACTIVATE.0 | SWP_ASYNCWINDOWPOS.0,
);

/// 창 순서를 따라 올라갈 때 보는 창 수의 상한. 넘으면 순서를 읽지 못한 것으로 친다(읽는 도중에 순서가 바뀌면
/// 같은 창을 맴돌 수 있다).
const MAX_WINDOWS_ABOVE: usize = 4096;

/// 이 창이 **이 프로세스의 창**인가. 창 순서를 바꾸는 호출의 대상을 우리 창으로 묶는 확인이다 —
/// 다른 프로그램(게임)의 창 핸들로는 `OverlayWindow`를 만들 수 없다.
fn belongs_to_this_process(hwnd: isize) -> bool {
    if hwnd == 0 {
        return false;
    }
    let mut pid = 0u32;
    // SAFETY: 창 핸들 값을 그대로 넘긴다. 유효하지 않은 핸들이면 0이 돌아오고 pid는 0으로 남는다.
    let thread = unsafe { GetWindowThreadProcessId(HWND(hwnd as _), Some(&mut pid)) };
    thread != 0 && pid == std::process::id()
}

/// 창 순서를 읽고 바꿀 수 있는 창 — **이 앱의 창**만 될 수 있다.
///
/// 게임 위에 머물기는 창 순서를 바꾸는 호출(`SetWindowPos`)을 쓴다. 그 호출은 이 타입의 메서드 한 곳에만 있고,
/// 이 타입은 이 프로세스의 창으로만 만들어진다(`of`는 Tauri가 준 오버레이 창에서, `own`은 핸들 값에서 —
/// 둘 다 `belongs_to_this_process`를 거친다). 게임 창의 핸들을 넣으면 `None`이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayWindow(isize);

impl OverlayWindow {
    /// 오버레이 창(Tauri가 준 이 앱의 창)에서 만든다.
    pub(crate) fn of(window: &WebviewWindow) -> Result<Self, String> {
        Self::own(overlay_handle(window)?)
            .ok_or_else(|| "오버레이 창이 이 프로세스의 창이 아니다".to_string())
    }

    /// 핸들 값에서 만든다. 이 프로세스의 창이 아니면(다른 프로그램의 창, 없는 창, 0) `None`.
    /// 따로 공개한 것은 테스트가 자기 창으로 같은 호출을 확인할 수 있게 하려는 것이다(`tests/live_stay_on_top.rs`).
    pub fn own(hwnd: isize) -> Option<Self> {
        belongs_to_this_process(hwnd).then_some(Self(hwnd))
    }

    /// 창 핸들 값.
    pub fn handle(&self) -> isize {
        self.0
    }

    /// 이 창보다 위에 있는 창들의 핸들 값(가까운 것부터). 읽기만 한다. 읽지 못했으면 `None`.
    ///
    /// 「누가 위인가」의 판단은 `stay_on_top::stacking`이 한다 — 여기서는 이 창에서 위쪽으로 창 순서를 따라가며
    /// 핸들 값을 모을 뿐이다(다른 창의 내용·속성은 읽지 않는다).
    pub fn windows_above(&self) -> Option<Vec<isize>> {
        // SAFETY: 창 핸들 값을 그대로 넘긴다. 읽기 전용 호출이다.
        if !unsafe { IsWindow(Some(HWND(self.0 as _))) }.as_bool() {
            return None;
        }
        let mut above = Vec::new();
        let mut current = HWND(self.0 as _);
        while above.len() < MAX_WINDOWS_ABOVE {
            // SAFETY: 읽기 전용 호출이다. 더 위에 창이 없으면 빈 핸들(오류)이 돌아온다.
            match unsafe { GetWindow(current, GW_HWNDPREV) } {
                Ok(previous) if !previous.0.is_null() => {
                    above.push(previous.0 as isize);
                    current = previous;
                }
                _ => return Some(above),
            }
        }
        None
    }

    /// 이 창을 활성화하지 않고 다시 맨 위(항상 위 창들의 맨 위)로 올린다. 요청을 창에 걸었으면 `true`.
    ///
    /// **창 순서를 바꾸는 호출은 이 한 곳뿐이다.** 대상은 `self` — 이 프로세스의 창 — 이고, 자리·크기·활성 상태는
    /// 바꾸지 않는다(`RAISE_FLAGS`).
    pub fn raise_without_activating(&self) -> bool {
        // SAFETY: 이 프로세스의 창 핸들이다(만들 때 확인했다). 창이 그 사이 없어졌으면 오류가 돌아올 뿐이다.
        unsafe { SetWindowPos(HWND(self.0 as _), Some(HWND_TOPMOST), 0, 0, 0, 0, RAISE_FLAGS) }.is_ok()
    }
}

/// 파일 고르기 창의 부모로 넘기는 창 핸들.
///
/// 오버레이는 항상 위 창이다. 대화 상자가 부모 없이 뜨면 그 뒤에 가려진다 — 오버레이 창이 부모(소유자)이면
/// Windows가 대화 상자를 언제나 그 위에 둔다.
pub struct DialogParent(NonZeroIsize);

impl DialogParent {
    /// 핸들 값으로 만든다. 0이면 `None`.
    pub fn from_handle(hwnd: isize) -> Option<Self> {
        NonZeroIsize::new(hwnd).map(Self)
    }

    /// 부모 창의 핸들 값.
    pub fn handle(&self) -> isize {
        self.0.get()
    }
}

impl HasWindowHandle for DialogParent {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let raw = RawWindowHandle::Win32(Win32WindowHandle::new(self.0));
        // SAFETY: 대화 상자가 떠 있는 동안 부모 창(오버레이)은 살아 있다 — 대화 상자가 닫혀야 명령이 끝난다.
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

impl HasDisplayHandle for DialogParent {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        Ok(DisplayHandle::windows())
    }
}

/// 오버레이 창을 파일 고르기 창의 부모로 쓴다. 핸들을 얻지 못하면 오류다 — 부모 없이 띄워 오버레이 뒤에
/// 가려진 대화 상자를 남기지 않는다.
pub(crate) fn dialog_parent(window: &WebviewWindow) -> Result<DialogParent, String> {
    DialogParent::from_handle(overlay_handle(window)?)
        .ok_or_else(|| "오버레이 창의 핸들이 비어 있다".to_string())
}

/// JSON 파일 하나를 고르는 창을 `parent`의 자식(소유된 창)으로 띄운다. 취소하면 `None`.
pub fn pick_json_file(parent: &DialogParent, title: &str) -> Option<std::path::PathBuf> {
    rfd::FileDialog::new()
        .set_title(title)
        .add_filter("JSON", &["json"])
        .set_parent(parent)
        .pick_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_overlay_is_shown_with_the_no_activate_command() {
        // SW_SHOWNA = 8: "지금 크기와 자리 그대로 보인다. SW_SHOW와 같되 창을 활성화하지 않는다."
        assert_eq!(SHOW_COMMAND, SW_SHOWNA);
        assert_eq!(SHOW_COMMAND.0, 8);
        assert_eq!(HIDE_COMMAND.0, 0);
    }

    #[test]
    fn the_dialog_parent_hands_over_the_overlay_window_handle() {
        assert!(DialogParent::from_handle(0).is_none());
        let parent = DialogParent::from_handle(0x1234).expect("0이 아닌 핸들");
        assert_eq!(parent.handle(), 0x1234);
        match parent.window_handle().expect("창 핸들").as_raw() {
            RawWindowHandle::Win32(handle) => assert_eq!(handle.hwnd.get(), 0x1234),
            other => panic!("Win32 창 핸들이어야 한다: {other:?}"),
        }
        assert!(parent.display_handle().is_ok());
    }

    #[test]
    fn a_handle_that_is_not_a_window_is_reported_not_ignored() {
        // 없는 창이면 요청이 걸리지 않는다 — 조용히 성공으로 치지 않는다.
        assert!(!show_handle_without_activating(0));
        assert!(!hide_handle(0));
    }

    #[test]
    fn the_overlay_is_raised_without_moving_resizing_or_activating_it() {
        // SWP_NOSIZE 0x0001 | SWP_NOMOVE 0x0002 | SWP_NOACTIVATE 0x0010 | SWP_ASYNCWINDOWPOS 0x4000
        assert_eq!(RAISE_FLAGS.0, 0x4013);
        assert_ne!(RAISE_FLAGS.0 & SWP_NOACTIVATE.0, 0, "올릴 때 활성화하지 않는다");
        assert_ne!(RAISE_FLAGS.0 & SWP_NOMOVE.0, 0, "자리를 바꾸지 않는다");
        assert_ne!(RAISE_FLAGS.0 & SWP_NOSIZE.0, 0, "크기를 바꾸지 않는다");
        // 숨긴 창을 보이게 하는 표시(SWP_SHOWWINDOW 0x0040)가 없다 — 숨겨 둔 오버레이가 나타나지 않는다.
        assert_eq!(RAISE_FLAGS.0 & 0x0040, 0);
    }

    #[test]
    fn only_a_window_of_this_process_can_be_raised() {
        // 0과 없는 창으로는 만들 수 없다.
        assert_eq!(OverlayWindow::own(0), None);
        assert_eq!(OverlayWindow::own(0x7fff_fff0), None);
        // 다른 프로그램의 창(바탕 화면 창 — 이 프로세스의 것이 아니다)으로도 만들 수 없다.
        // SAFETY: 읽기 전용 호출이다.
        let desktop = unsafe { windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow() };
        if !desktop.0.is_null() {
            assert_eq!(
                OverlayWindow::own(desktop.0 as isize),
                None,
                "다른 프로세스의 창이 오버레이 창으로 받아들여졌다"
            );
        }
    }
}
