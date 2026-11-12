//! 게임 창을 고르는 규칙과 창 정보의 모양, 오버레이를 게임 창에 붙이는 위치 계산.
//!
//! 여기에는 Win32 호출이 없다 — 창 목록을 받아 무엇이 게임 창인지 정하고, 숫자로 자리를 계산할 뿐이다.
//! 실제 창을 읽는 일은 `game_win32`가 하고, 이 모듈의 `locate`·`capture`가 그쪽으로 넘긴다.
//!
//! 게임은 **읽기만 한다**: 게임 창을 옮기거나 크기를 바꾸거나 앞으로 가져오지 않고, 입력을 보내지 않고,
//! 게임 프로세스를 열거나 메모리를 읽지 않는다(`docs/spec.md` §게임과의 상호작용 규칙).

use std::fmt;

use serde::Serialize;

use crate::capture::{BlankKind, CaptureMethod, Frame};
use crate::overlay_state::top_right_position;

/// 게임 프로세스의 실행 파일 이름.
pub const GAME_PROCESS: &str = "nikke.exe";
/// 런처 프로세스의 실행 파일 이름. 게임과 같은 제목의 창을 갖고 있어 구분해야 한다.
pub const LAUNCHER_PROCESS: &str = "nikke_launcher.exe";
/// 게임 창(과 런처 창)의 제목.
pub const GAME_TITLE: &str = "NIKKE";

/// 화면 위의 사각형(물리 픽셀). `x`·`y`는 화면 좌표의 왼쪽 위다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl ScreenRect {
    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }
}

/// 창 열거에서 모은 후보 하나. 규칙이 보는 것만 담는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowCandidate {
    /// 창 핸들 값. 규칙은 이것을 순서를 정하는 데만 쓴다.
    pub hwnd: isize,
    pub pid: u32,
    /// 실행 파일 이름(경로 없음, 예: `nikke.exe`). 알 수 없으면 빈 문자열.
    pub process_name: String,
    pub title: String,
    /// WS_VISIBLE.
    pub visible: bool,
    /// DWM이 가린 창(다른 가상 데스크톱의 창, 숨겨진 UWP 틀 등). 화면에 없다.
    pub cloaked: bool,
    pub minimized: bool,
    /// 클라이언트 영역의 크기(물리 픽셀). 최소화된 창은 0일 수 있다.
    pub client_width: u32,
    pub client_height: u32,
}

/// 후보로 모을 창인가: 게임·런처 프로세스의 창이거나 제목이 게임 제목인 창.
pub fn is_candidate(process_name: &str, title: &str) -> bool {
    is_game_process(process_name) || is_launcher_process(process_name) || is_game_title(title)
}

pub fn is_game_process(process_name: &str) -> bool {
    process_name.trim().eq_ignore_ascii_case(GAME_PROCESS)
}

pub fn is_launcher_process(process_name: &str) -> bool {
    process_name.trim().eq_ignore_ascii_case(LAUNCHER_PROCESS)
}

pub fn is_game_title(title: &str) -> bool {
    title.trim().eq_ignore_ascii_case(GAME_TITLE)
}

/// 후보 가운데 무엇을 골랐는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Selection {
    /// 게임 창. 값은 후보 목록의 위치다.
    Game(usize),
    /// 게임 창은 없고 런처만 떠 있다.
    LauncherOnly,
    /// 게임도 런처도 없다(또는 게임 프로세스는 있어도 보이는 창이 없다).
    None,
}

/// 게임 창이 될 수 있는 후보인가: 게임 프로세스의 창이고, 보이고, 가려지지 않았고,
/// 그릴 영역이 있다(최소화된 창은 영역이 0이어도 게임 창이다 — 상태를 "최소화"로 알린다).
fn is_game_window(c: &WindowCandidate) -> bool {
    is_game_process(&c.process_name)
        && c.visible
        && !c.cloaked
        && (c.minimized || (c.client_width > 0 && c.client_height > 0))
}

/// 후보에서 게임 창 하나를 고른다.
///
/// - 런처(`nikke_launcher.exe`)의 창은 제목이 같아도 게임 창이 아니다. 프로세스 이름을 모르는 창도 아니다.
/// - 보이지 않는 창·가려진 창·영역이 없는 창은 뺀다(게임 프로세스가 갖고 있는 보조 창들).
/// - 여러 개가 남으면: 제목이 `NIKKE`인 것 → 최소화되지 않은 것 → 클라이언트 영역이 넓은 것 →
///   핸들 값이 작은 것 순으로 고른다(열거 순서에 기대지 않는다).
pub fn select_game_window(candidates: &[WindowCandidate]) -> Selection {
    let best = candidates
        .iter()
        .enumerate()
        .filter(|(_, c)| is_game_window(c))
        .min_by_key(|(_, c)| {
            let area = u64::from(c.client_width) * u64::from(c.client_height);
            (
                !is_game_title(&c.title),
                c.minimized,
                std::cmp::Reverse(area),
                c.hwnd,
            )
        });
    match best {
        Some((index, _)) => Selection::Game(index),
        None if candidates
            .iter()
            .any(|c| is_launcher_process(&c.process_name)) =>
        {
            Selection::LauncherOnly
        }
        None => Selection::None,
    }
}

/// 게임 창의 현재 정보. 좌표와 크기는 모두 물리 픽셀이다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GameWindowInfo {
    /// 창 핸들 값(진단용).
    pub hwnd: i64,
    pub pid: u32,
    pub process_name: String,
    pub title: String,
    /// 클라이언트 영역(제목 표시줄·테두리 제외)의 화면 좌표와 크기. 최소화돼 있으면 크기가 0일 수 있다.
    pub client: ScreenRect,
    /// 창 전체에서 보이는 부분(DWM 확장 프레임 경계). 제목 표시줄과 테두리를 포함한다.
    pub frame: ScreenRect,
    pub minimized: bool,
    /// 지금 입력을 받는 창(전경 창)인가.
    pub foreground: bool,
    /// 창이 놓인 모니터의 배율(1.0 = 100%).
    pub scale_factor: f64,
}

/// 게임 창의 상태. 화면에 그대로 넘긴다(프런트의 `GameWindowState`와 같아야 한다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GameWindowState {
    /// 게임 창을 찾았고 캡처할 수 있다.
    Found,
    /// 게임 창이 최소화돼 있다.
    Minimized,
    /// 런처만 떠 있다.
    LauncherOnly,
    /// 게임이 실행 중이 아니다.
    Missing,
    /// 창을 읽지 못했다(이 OS에서는 지원하지 않거나 창 API가 실패했다).
    Unavailable,
}

/// 게임 창 상태와 정보.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GameWindowStatus {
    pub state: GameWindowState,
    /// `found`·`minimized`일 때만 있다.
    pub window: Option<GameWindowInfo>,
    /// 화면에 보일 한국어 설명.
    pub message: String,
}

impl GameWindowStatus {
    pub fn from_window(window: GameWindowInfo) -> Self {
        if window.minimized {
            Self {
                state: GameWindowState::Minimized,
                message: GameError::Minimized.to_string(),
                window: Some(window),
            }
        } else {
            Self {
                state: GameWindowState::Found,
                message: format!(
                    "게임 창을 찾았다 ({}×{})",
                    window.client.width, window.client.height
                ),
                window: Some(window),
            }
        }
    }

    pub fn from_error(error: &GameError) -> Self {
        let state = match error {
            GameError::NotRunning => GameWindowState::Missing,
            GameError::LauncherOnly => GameWindowState::LauncherOnly,
            _ => GameWindowState::Unavailable,
        };
        Self {
            state,
            window: None,
            message: error.to_string(),
        }
    }

    /// 캡처할 수 있는 창(찾았고 최소화되지 않았다).
    pub fn capturable(&self) -> Option<&GameWindowInfo> {
        match self.state {
            GameWindowState::Found => self.window.as_ref(),
            _ => None,
        }
    }
}

/// 게임 창을 찾거나 캡처하다 생기는 오류. 문장은 한국어다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameError {
    /// 게임이 실행 중이 아니다.
    NotRunning,
    /// 런처만 떠 있다.
    LauncherOnly,
    /// 게임 창이 최소화돼 있어 캡처할 수 없다.
    Minimized,
    /// 클라이언트 영역의 크기가 0이다.
    EmptyClient,
    /// 창 정보를 읽지 못했다.
    WindowInfo { detail: String },
    /// 캡처 방식 하나가 실패했다.
    CaptureFailed {
        method: CaptureMethod,
        detail: String,
    },
    /// 전부 검거나 한 색인 프레임만 나왔다.
    BlankFrame {
        method: CaptureMethod,
        kind: BlankKind,
    },
    /// 캡처한 이미지의 크기가 클라이언트 영역과 다르다.
    SizeMismatch {
        method: CaptureMethod,
        expected: (u32, u32),
        actual: (u32, u32),
    },
    /// 저장할 폴더를 정하지 못했다.
    CaptureDirUnknown,
    /// 저장하지 못했다.
    Save { path: String, detail: String },
    /// 이미지 파일을 읽지 못했다.
    ReadImage { path: String, detail: String },
    /// 이미 캡처하고 있다.
    Busy,
    /// Windows가 아니다.
    Unsupported,
}

impl GameError {
    /// 게임(창)이 없어서 생긴 오류인가. 명령줄 도구는 이때 종료 코드 2로 끝난다.
    pub fn is_game_missing(&self) -> bool {
        matches!(self, Self::NotRunning | Self::LauncherOnly)
    }
}

impl fmt::Display for GameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotRunning => write!(
                f,
                "게임 창을 찾을 수 없다. 니케 PC판({GAME_PROCESS})이 실행 중인지 확인하라"
            ),
            Self::LauncherOnly => write!(
                f,
                "런처({LAUNCHER_PROCESS})만 떠 있고 게임 창이 없다. 런처에서 게임을 시작하라"
            ),
            Self::Minimized => write!(
                f,
                "게임 창이 최소화돼 있다. 창을 다시 띄운 뒤에 캡처하라(이 앱은 게임 창을 건드리지 않는다)"
            ),
            Self::EmptyClient => write!(f, "게임 창의 화면 영역 크기가 0이다"),
            Self::WindowInfo { detail } => write!(f, "게임 창 정보를 읽지 못했다: {detail}"),
            Self::CaptureFailed { method, detail } => {
                write!(f, "화면을 캡처하지 못했다({}): {detail}", method.name())
            }
            Self::BlankFrame { method, kind } => write!(
                f,
                "캡처한 화면이 {}({}). 게임 화면이 찍히지 않았다고 보고 저장하지 않았다",
                kind.describe(),
                method.name()
            ),
            Self::SizeMismatch {
                method,
                expected,
                actual,
            } => write!(
                f,
                "캡처한 이미지의 크기({}×{})가 게임 화면 영역({}×{})과 다르다({}). 창 크기가 바뀌는 중이었을 수 있다 — 다시 시도하라",
                actual.0,
                actual.1,
                expected.0,
                expected.1,
                method.name()
            ),
            Self::CaptureDirUnknown => write!(
                f,
                "캡처를 저장할 폴더를 정할 수 없다(저장소의 data/captures를 찾지 못했다). 환경 변수 {}로 지정하라",
                crate::capture::ENV_CAPTURE_DIR
            ),
            Self::Save { path, detail } => write!(f, "캡처를 저장하지 못했다: {path} ({detail})"),
            Self::ReadImage { path, detail } => {
                write!(f, "이미지를 읽지 못했다: {path} ({detail})")
            }
            Self::Busy => write!(f, "이미 캡처하고 있다. 끝난 뒤에 다시 시도하라"),
            Self::Unsupported => write!(f, "게임 창 추적과 화면 캡처는 Windows에서만 된다"),
        }
    }
}

impl std::error::Error for GameError {}

// ── 실제 창 읽기(Win32) ───────────────────────────────────────────────────────

/// 게임 창을 찾아 정보를 읽는다. 최소화된 창도 돌려준다(`minimized: true`).
#[cfg(windows)]
pub fn find_game_window() -> Result<GameWindowInfo, GameError> {
    crate::game_win32::find_game_window()
}

#[cfg(not(windows))]
pub fn find_game_window() -> Result<GameWindowInfo, GameError> {
    Err(GameError::Unsupported)
}

/// 앞서 찾은 창의 정보를 다시 읽는다. 그 창이 사라졌거나 다른 프로세스의 것이 됐으면 `None`
/// (창 목록을 다시 훑어야 한다). 창 열거를 하지 않아 가볍다 — 게임 창을 따라갈 때 쓴다.
#[cfg(windows)]
pub fn refresh_game_window(previous: &GameWindowInfo) -> Option<GameWindowInfo> {
    crate::game_win32::refresh_game_window(previous)
}

#[cfg(not(windows))]
pub fn refresh_game_window(_previous: &GameWindowInfo) -> Option<GameWindowInfo> {
    None
}

/// 게임 창의 상태(찾음/최소화/런처만/없음)를 읽는다. 실패하지 않는다 — 실패도 상태다.
pub fn locate() -> GameWindowStatus {
    match find_game_window() {
        Ok(window) => GameWindowStatus::from_window(window),
        Err(e) => GameWindowStatus::from_error(&e),
    }
}

/// 게임 창의 클라이언트 영역을 캡처한다. 크기는 `window.client`와 같다.
/// 검거나 한 색인 프레임은 오류다. 게임 창은 건드리지 않는다.
#[cfg(windows)]
pub fn capture_window(window: &GameWindowInfo) -> Result<(Frame, CaptureMethod), GameError> {
    crate::game_win32::capture_window(window)
}

#[cfg(not(windows))]
pub fn capture_window(_window: &GameWindowInfo) -> Result<(Frame, CaptureMethod), GameError> {
    Err(GameError::Unsupported)
}

// ── 오버레이 붙이기 ───────────────────────────────────────────────────────────

/// 오버레이를 게임 창의 오른쪽 위 안쪽에 둘 때의 왼쪽 위 좌표(물리 픽셀).
///
/// `client`는 게임 창의 클라이언트 영역, `overlay_width`는 오버레이 창의 바깥 너비, `margin`은 가장자리에서
/// 띄우는 거리다. 오버레이가 게임 화면보다 넓으면 게임 화면의 왼쪽 끝에 맞춘다(여백도 그만큼 줄인다).
pub fn attach_position(client: ScreenRect, overlay_width: u32, margin: u32) -> (i32, i32) {
    top_right_position(client.x, client.y, client.width, overlay_width, margin)
}

/// 붙이기가 켜져 있을 때 오버레이가 있어야 할 자리. 붙일 수 없으면(꺼짐·게임 없음·최소화·영역 없음) `None` —
/// 그때 오버레이는 있던 자리에 머문다.
pub fn follow_target(
    follow: bool,
    status: &GameWindowStatus,
    overlay_width: u32,
    margin: u32,
) -> Option<(i32, i32)> {
    if !follow {
        return None;
    }
    let window = status.capturable()?;
    if window.client.is_empty() {
        return None;
    }
    Some(attach_position(window.client, overlay_width, margin))
}

/// 오버레이를 옮겨야 하는가. 목표가 마지막으로 옮긴 자리와 같으면 옮기지 않는다
/// (게임 창이 가만히 있는 동안 사용자가 오버레이를 끌어 둔 자리를 되돌리지 않는다).
pub fn follow_move(target: Option<(i32, i32)>, last_applied: Option<(i32, i32)>) -> Option<(i32, i32)> {
    match target {
        Some(t) if Some(t) != last_applied => Some(t),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(hwnd: isize, process: &str, title: &str) -> WindowCandidate {
        WindowCandidate {
            hwnd,
            pid: 1000 + hwnd as u32,
            process_name: process.to_string(),
            title: title.to_string(),
            visible: true,
            cloaked: false,
            minimized: false,
            client_width: 1920,
            client_height: 1080,
        }
    }

    fn game(hwnd: isize) -> WindowCandidate {
        candidate(hwnd, "nikke.exe", "NIKKE")
    }

    fn launcher(hwnd: isize) -> WindowCandidate {
        WindowCandidate {
            client_width: 1280,
            client_height: 720,
            ..candidate(hwnd, "nikke_launcher.exe", "NIKKE")
        }
    }

    fn info(client: ScreenRect, minimized: bool) -> GameWindowInfo {
        GameWindowInfo {
            hwnd: 0x1234,
            pid: 42,
            process_name: "nikke.exe".to_string(),
            title: "NIKKE".to_string(),
            client,
            frame: client,
            minimized,
            foreground: false,
            scale_factor: 1.0,
        }
    }

    const CLIENT: ScreenRect = ScreenRect {
        x: 100,
        y: 50,
        width: 1920,
        height: 1080,
    };

    #[test]
    fn candidates_are_collected_by_process_name_or_title() {
        assert!(is_candidate("nikke.exe", ""));
        assert!(is_candidate("NIKKE.EXE", "아무 제목"));
        assert!(is_candidate("nikke_launcher.exe", "NIKKE"));
        assert!(is_candidate("explorer.exe", "NIKKE"));
        assert!(is_candidate("", " nikke "));
        assert!(!is_candidate("explorer.exe", "NIKKE 공략 - Chrome"));
        assert!(!is_candidate("nikke_helper.exe", "도우미"));
        assert!(!is_candidate("", ""));
    }

    #[test]
    fn no_candidates_means_no_game() {
        assert_eq!(select_game_window(&[]), Selection::None);
    }

    #[test]
    fn launcher_alone_is_not_the_game() {
        assert_eq!(select_game_window(&[launcher(1)]), Selection::LauncherOnly);
        // 런처가 숨겨져 있어도(트레이) 런처만 있는 상태다.
        let hidden = WindowCandidate {
            visible: false,
            ..launcher(1)
        };
        assert_eq!(select_game_window(&[hidden]), Selection::LauncherOnly);
    }

    #[test]
    fn game_is_chosen_over_the_launcher_with_the_same_title() {
        // 런처가 먼저 열거되고 더 커도 게임 창을 고른다.
        let big_launcher = WindowCandidate {
            client_width: 3840,
            client_height: 2160,
            ..launcher(1)
        };
        assert_eq!(
            select_game_window(&[big_launcher.clone(), game(2)]),
            Selection::Game(1)
        );
        assert_eq!(
            select_game_window(&[game(2), big_launcher]),
            Selection::Game(0)
        );
    }

    #[test]
    fn a_window_titled_like_the_game_in_another_process_is_ignored() {
        let other = candidate(1, "notepad.exe", "NIKKE");
        assert_eq!(
            select_game_window(std::slice::from_ref(&other)),
            Selection::None
        );
        let unknown = candidate(2, "", "NIKKE");
        assert_eq!(select_game_window(&[other, unknown]), Selection::None);
    }

    #[test]
    fn invisible_cloaked_and_empty_game_windows_are_filtered_out() {
        let invisible = WindowCandidate {
            visible: false,
            ..game(1)
        };
        let cloaked = WindowCandidate {
            cloaked: true,
            ..game(2)
        };
        let empty = WindowCandidate {
            client_width: 0,
            client_height: 0,
            ..game(3)
        };
        assert_eq!(
            select_game_window(&[invisible.clone(), cloaked.clone(), empty.clone()]),
            Selection::None
        );
        // 게임 프로세스는 있지만 보이는 창이 없고 런처가 떠 있으면 런처만 있는 것으로 알린다.
        assert_eq!(
            select_game_window(&[invisible.clone(), launcher(9)]),
            Selection::LauncherOnly
        );
        assert_eq!(
            select_game_window(&[invisible, cloaked, empty, game(4)]),
            Selection::Game(3)
        );
    }

    #[test]
    fn a_minimized_game_window_is_still_the_game_window() {
        // 최소화된 창은 클라이언트 영역이 0으로 읽힌다 — 그래도 게임 창이다(상태로 알린다).
        let minimized = WindowCandidate {
            minimized: true,
            client_width: 0,
            client_height: 0,
            ..game(1)
        };
        assert_eq!(
            select_game_window(&[launcher(5), minimized]),
            Selection::Game(1)
        );
    }

    #[test]
    fn among_several_game_windows_the_titled_visible_largest_one_wins() {
        // 게임 프로세스의 보조 창(제목 다름)이 더 커도 제목이 NIKKE인 창을 고른다.
        let helper = WindowCandidate {
            client_width: 3840,
            client_height: 2160,
            ..candidate(1, "nikke.exe", "UnityCrashHandler")
        };
        assert_eq!(select_game_window(&[helper.clone(), game(2)]), Selection::Game(1));

        // 제목이 같으면 최소화되지 않은 창.
        let minimized = WindowCandidate {
            minimized: true,
            ..game(3)
        };
        assert_eq!(
            select_game_window(&[minimized.clone(), game(4)]),
            Selection::Game(1)
        );

        // 그다음은 넓은 창.
        let small = WindowCandidate {
            client_width: 640,
            client_height: 360,
            ..game(5)
        };
        assert_eq!(select_game_window(&[small.clone(), game(6)]), Selection::Game(1));
        assert_eq!(select_game_window(&[game(6), small]), Selection::Game(0));

        // 모두 같으면 핸들 값이 작은 창 — 열거 순서와 무관하다.
        assert_eq!(select_game_window(&[game(8), game(7)]), Selection::Game(1));
        assert_eq!(select_game_window(&[game(7), game(8)]), Selection::Game(0));

        // 제목이 NIKKE인 창이 없으면 게임 프로세스의 보이는 창 가운데서 고른다.
        assert_eq!(select_game_window(&[launcher(1), helper]), Selection::Game(1));
    }

    #[test]
    fn process_name_comparison_ignores_case_but_not_extra_text() {
        assert_eq!(
            select_game_window(&[candidate(1, "NIKKE.exe", "NIKKE")]),
            Selection::Game(0)
        );
        assert_eq!(
            select_game_window(&[candidate(1, "nikke.exe.bak", "NIKKE")]),
            Selection::None
        );
    }

    #[test]
    fn status_reports_found_and_minimized() {
        let found = GameWindowStatus::from_window(info(CLIENT, false));
        assert_eq!(found.state, GameWindowState::Found);
        assert!(found.message.contains("1920×1080"));
        assert!(found.capturable().is_some());

        let minimized = GameWindowStatus::from_window(info(ScreenRect::default(), true));
        assert_eq!(minimized.state, GameWindowState::Minimized);
        assert!(minimized.message.contains("최소화"));
        assert!(minimized.window.is_some());
        assert!(minimized.capturable().is_none());
    }

    #[test]
    fn status_reports_missing_launcher_only_and_unavailable() {
        let missing = GameWindowStatus::from_error(&GameError::NotRunning);
        assert_eq!(missing.state, GameWindowState::Missing);
        assert!(missing.window.is_none());
        assert!(missing.message.contains("nikke.exe"));

        let launcher = GameWindowStatus::from_error(&GameError::LauncherOnly);
        assert_eq!(launcher.state, GameWindowState::LauncherOnly);
        assert!(launcher.message.contains("런처"));

        let other = GameWindowStatus::from_error(&GameError::Unsupported);
        assert_eq!(other.state, GameWindowState::Unavailable);
    }

    #[test]
    fn status_serializes_for_the_front_end() {
        let json = serde_json::to_value(GameWindowStatus::from_window(info(CLIENT, false))).unwrap();
        assert_eq!(json["state"], "found");
        assert_eq!(
            json["window"]["client"],
            serde_json::json!({ "x": 100, "y": 50, "width": 1920, "height": 1080 })
        );
        assert_eq!(json["window"]["minimized"], false);
        assert_eq!(json["window"]["foreground"], false);
        assert_eq!(json["window"]["scale_factor"], 1.0);
        assert_eq!(json["window"]["process_name"], "nikke.exe");

        let json = serde_json::to_value(GameWindowStatus::from_error(&GameError::LauncherOnly)).unwrap();
        assert_eq!(json["state"], "launcher_only");
        assert!(json["window"].is_null());
    }

    #[test]
    fn errors_are_korean_sentences_and_only_missing_game_is_flagged() {
        assert!(GameError::NotRunning.is_game_missing());
        assert!(GameError::LauncherOnly.is_game_missing());
        assert!(!GameError::Minimized.is_game_missing());
        assert!(!GameError::Busy.is_game_missing());

        assert!(GameError::Minimized.to_string().contains("최소화"));
        let blank = GameError::BlankFrame {
            method: CaptureMethod::Wgc,
            kind: BlankKind::Black,
        };
        assert!(blank.to_string().contains("검다"), "{blank}");
        let mismatch = GameError::SizeMismatch {
            method: CaptureMethod::Wgc,
            expected: (1920, 1080),
            actual: (1900, 1000),
        };
        assert!(mismatch.to_string().contains("1900×1000"));
        assert!(mismatch.to_string().contains("1920×1080"));
        assert!(GameError::CaptureDirUnknown.to_string().contains("NIKKE_CAPTURE_DIR"));
    }

    #[test]
    fn overlay_attaches_inside_the_top_right_of_the_game_client_area() {
        // 1920 너비 게임 화면이 (100, 50)에 있고, 440 너비 오버레이, 여백 12
        assert_eq!(attach_position(CLIENT, 440, 12), (100 + 1920 - 440 - 12, 62));
        // 보조 모니터(음수 좌표)
        let left = ScreenRect {
            x: -2560,
            y: -200,
            width: 2560,
            height: 1440,
        };
        assert_eq!(attach_position(left, 440, 12), (-2560 + 2560 - 440 - 12, -188));
    }

    #[test]
    fn overlay_wider_than_the_game_stays_at_the_game_left_edge() {
        let narrow = ScreenRect {
            x: 300,
            y: 40,
            width: 400,
            height: 800,
        };
        assert_eq!(attach_position(narrow, 440, 12), (300, 40));
        // 여백을 둘 자리가 모자라면 여백을 줄인다.
        let tight = ScreenRect {
            width: 446,
            ..narrow
        };
        assert_eq!(attach_position(tight, 440, 12), (300, 46));
    }

    #[test]
    fn follow_target_exists_only_while_attached_to_a_capturable_window() {
        let found = GameWindowStatus::from_window(info(CLIENT, false));
        assert_eq!(follow_target(true, &found, 440, 12), Some((1568, 62)));
        // 꺼져 있으면 그 자리에 머문다.
        assert_eq!(follow_target(false, &found, 440, 12), None);
        // 게임이 없거나 최소화돼 있으면 옮기지 않는다.
        let minimized = GameWindowStatus::from_window(info(ScreenRect::default(), true));
        assert_eq!(follow_target(true, &minimized, 440, 12), None);
        let missing = GameWindowStatus::from_error(&GameError::NotRunning);
        assert_eq!(follow_target(true, &missing, 440, 12), None);
        // 영역이 없는 창에는 붙지 않는다.
        let empty = GameWindowStatus::from_window(info(
            ScreenRect {
                width: 0,
                height: 0,
                ..CLIENT
            },
            false,
        ));
        assert_eq!(follow_target(true, &empty, 440, 12), None);
    }

    #[test]
    fn follow_target_tracks_game_moves_and_resizes() {
        let at = |client: ScreenRect| {
            follow_target(true, &GameWindowStatus::from_window(info(client, false)), 440, 12)
        };
        let moved = ScreenRect {
            x: 400,
            y: 300,
            ..CLIENT
        };
        assert_eq!(at(moved), Some((400 + 1920 - 452, 312)));
        let resized = ScreenRect {
            width: 1280,
            height: 720,
            ..CLIENT
        };
        assert_eq!(at(resized), Some((100 + 1280 - 452, 62)));
    }

    #[test]
    fn overlay_moves_only_when_the_target_changes() {
        // 처음 붙일 때는 옮긴다.
        assert_eq!(follow_move(Some((10, 20)), None), Some((10, 20)));
        // 게임 창이 가만히 있으면 다시 옮기지 않는다.
        assert_eq!(follow_move(Some((10, 20)), Some((10, 20))), None);
        // 게임 창이 움직이면 따라간다.
        assert_eq!(follow_move(Some((30, 20)), Some((10, 20))), Some((30, 20)));
        // 붙일 곳이 없으면 그대로 둔다.
        assert_eq!(follow_move(None, Some((10, 20))), None);
        assert_eq!(follow_move(None, None), None);
    }
}
