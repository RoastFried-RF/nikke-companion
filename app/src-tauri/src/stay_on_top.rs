//! 게임 위에 머물기 — 언제 오버레이를 다시 맨 위로 올리는지의 규칙. 창 API를 모른다.
//!
//! 왜 필요한가: 니케 게임 창은 그 자체가 항상 위(WS_EX_TOPMOST) 창이다. 항상 위 창끼리는 나중에 활성화된 창이
//! 위로 온다 — 게임을 누르거나 옮기면 게임이 오버레이를 덮고, 「게임 창에 붙이기」는 오버레이를 게임 화면 안쪽에
//! 두므로 통째로 가려진다. 그래서 게임 창이 오버레이보다 위로 올라온 것을 보면 **오버레이 자기 창**을 활성화 없이
//! 다시 맨 위로 올린다(`overlay_win32::OverlayWindow::raise_without_activating`). 게임 창은 건드리지 않는다 —
//! 읽는 것은 「누가 위인가」뿐이다.
//!
//! 규칙(`StayOnTop::step`):
//! - 오버레이를 숨겨 뒀으면 올리지 않는다(사용자가 숨긴 창을 다시 끌어올리지 않는다).
//! - 게임 창이 없거나(게임 없음·런처만·읽지 못함) 최소화돼 있으면 올리지 않는다. 창 순서도 읽지 않는다.
//! - 오버레이가 이미 게임보다 위면 아무것도 하지 않는다.
//! - 게임이 오버레이보다 위면 올린다.
//! - 창 순서를 읽지 못했으면: 게임이 **방금 전경이 됐을 때 한 번만** 올린다(전경이 됐다는 것은 방금 위로 올라왔다는
//!   뜻이다). 읽지 못하는 동안 주기마다 올리지는 않는다.
//!
//! 붙이기를 켜지 않아도 적용한다. 확인 주기는 `watch_interval`이 정한다 — 오버레이가 보이고 게임 창을 알고 있는
//! 동안에는 `WATCH_INTERVAL`(0.3초 안쪽)마다 본다. 이벤트를 듣는 방식(창 훅)은 쓰지 않는다: 주기적으로 읽기만 한다.

use std::time::Duration;

use crate::game_window::{GameWindowInfo, GameWindowState, GameWindowStatus};

/// 오버레이가 보이고 게임 창을 알고 있는 동안 창 순서를 다시 읽는 간격. 게임을 누른 뒤 오버레이가 다시 보이기까지
/// 걸리는 시간의 상한이다 — 0.3초를 넘기지 않아야 한다(`MAX_DELAY`).
pub const WATCH_INTERVAL: Duration = Duration::from_millis(100);

/// 게임을 누른 뒤 오버레이가 다시 보이기까지 넘기면 안 되는 시간.
pub const MAX_DELAY: Duration = Duration::from_millis(300);

/// 붙이기가 켜져 있을 때 게임 창의 위치를 다시 읽는 간격(창 순서도 이때 함께 본다).
pub const FOLLOW_INTERVAL: Duration = Duration::from_millis(50);

/// 볼 것이 없을 때(오버레이 숨김, 게임 창 없음) 게임 창 상태를 다시 읽는 간격.
pub const IDLE_INTERVAL: Duration = Duration::from_millis(1000);

/// 오버레이와 게임 창 가운데 누가 위인가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stacking {
    /// 오버레이가 게임보다 위다.
    OverlayAbove,
    /// 게임이 오버레이보다 위다(오버레이가 가려질 수 있다).
    GameAbove,
    /// 창 순서를 읽지 못했다.
    Unknown,
}

/// 창 순서를 읽은 결과에서 누가 위인지 정한다.
///
/// `above_overlay`는 오버레이 창보다 위에 있는 창들의 핸들 값이다(읽지 못했으면 `None`). 그 안에 게임 창이 있으면
/// 게임이 위다.
pub fn stacking(above_overlay: Option<&[isize]>, game: isize) -> Stacking {
    match above_overlay {
        None => Stacking::Unknown,
        Some(above) if above.contains(&game) => Stacking::GameAbove,
        Some(_) => Stacking::OverlayAbove,
    }
}

/// 올리지 않는 이유.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Leave {
    /// 오버레이를 숨겨 뒀다.
    OverlayHidden,
    /// 게임 창이 없다(게임 없음·런처만·창을 읽지 못함).
    NoGame,
    /// 게임 창이 최소화돼 있다.
    GameMinimized,
    /// 오버레이가 이미 게임보다 위다.
    AlreadyOnTop,
    /// 창 순서를 읽지 못했고, 게임이 방금 전경이 된 것도 아니다.
    OrderUnknown,
}

/// 이번 주기에 할 일.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// 오버레이 창을 활성화 없이 다시 맨 위로 올린다.
    Raise,
    /// 아무것도 하지 않는다.
    Leave(Leave),
}

/// 창 순서를 읽기 전에 거르는 것: 오버레이가 보이고 게임 창이 떠 있을 때만 그 창을 돌려준다.
pub fn gate(overlay_visible: bool, game: &GameWindowStatus) -> Result<&GameWindowInfo, Leave> {
    if !overlay_visible {
        return Err(Leave::OverlayHidden);
    }
    match (game.state, game.window.as_ref()) {
        (GameWindowState::Found, Some(window)) if !window.minimized => Ok(window),
        (GameWindowState::Found | GameWindowState::Minimized, Some(_)) => Err(Leave::GameMinimized),
        _ => Err(Leave::NoGame),
    }
}

/// 게임 위에 머물기의 상태: 지난 주기에 게임이 전경 창이었는가(창 순서를 읽지 못할 때만 쓴다).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StayOnTop {
    game_was_foreground: bool,
}

impl StayOnTop {
    pub fn new() -> Self {
        Self::default()
    }

    /// 한 주기: 올릴지 정한다. `read_above`는 오버레이 창보다 위에 있는 창들을 읽는다 — 오버레이가 숨겨져 있거나
    /// 게임 창이 없으면 부르지 않는다.
    pub fn step(
        &mut self,
        overlay_visible: bool,
        game: &GameWindowStatus,
        read_above: impl FnOnce() -> Option<Vec<isize>>,
    ) -> Decision {
        let window = match gate(overlay_visible, game) {
            Ok(window) => window,
            Err(reason) => {
                // 다시 보이거나 게임이 다시 뜨면 「방금 전경이 됐다」를 새로 본다.
                self.game_was_foreground = false;
                return Decision::Leave(reason);
            }
        };
        let became_foreground = window.foreground && !self.game_was_foreground;
        self.game_was_foreground = window.foreground;
        let above = read_above();
        match stacking(above.as_deref(), window.hwnd as isize) {
            Stacking::GameAbove => Decision::Raise,
            Stacking::OverlayAbove => Decision::Leave(Leave::AlreadyOnTop),
            Stacking::Unknown if became_foreground => Decision::Raise,
            Stacking::Unknown => Decision::Leave(Leave::OrderUnknown),
        }
    }
}

/// 게임 창 추적 스레드가 다음에 다시 볼 때까지 쉬는 시간.
///
/// - 게임 창을 모르면(게임 없음·런처만) `IDLE_INTERVAL` — 붙이기가 켜져 있어도 그렇다(게임이 다시 뜨면 1초 안에
///   알아채고 붙는다. 없는 창을 찾으려고 창 목록을 초당 스무 번 훑지 않는다).
/// - 붙이기가 켜져 있으면 `FOLLOW_INTERVAL`(게임 창을 끌 때 오버레이가 따라가야 한다).
/// - 오버레이가 보이면(게임 창이 떠 있든 최소화돼 있든) `WATCH_INTERVAL` — 게임이 위로 올라오는 것을 0.3초 안에 알아챈다.
/// - 오버레이를 숨겨 뒀으면 `IDLE_INTERVAL`.
pub fn watch_interval(follow: bool, overlay_visible: bool, game: &GameWindowStatus) -> Duration {
    if game.window.is_none() {
        IDLE_INTERVAL
    } else if follow {
        FOLLOW_INTERVAL
    } else if overlay_visible {
        WATCH_INTERVAL
    } else {
        IDLE_INTERVAL
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_window::{GameError, ScreenRect};

    const GAME: isize = 0x1234;
    const OTHER: isize = 0x9999;

    fn info(minimized: bool, foreground: bool) -> GameWindowInfo {
        let client = ScreenRect {
            x: 100,
            y: 50,
            width: 1920,
            height: 1080,
        };
        GameWindowInfo {
            hwnd: GAME as i64,
            pid: 42,
            process_name: "nikke.exe".to_string(),
            title: "NIKKE".to_string(),
            client: if minimized { ScreenRect::default() } else { client },
            frame: client,
            minimized,
            foreground,
            scale_factor: 1.0,
        }
    }

    fn found(foreground: bool) -> GameWindowStatus {
        GameWindowStatus::from_window(info(false, foreground))
    }

    fn minimized() -> GameWindowStatus {
        GameWindowStatus::from_window(info(true, false))
    }

    fn missing() -> GameWindowStatus {
        GameWindowStatus::from_error(&GameError::NotRunning)
    }

    /// 창 순서를 읽으면 안 되는 자리에 넣는다 — 불리면 실패한다.
    fn never() -> Option<Vec<isize>> {
        panic!("창 순서를 읽으면 안 되는 상태다")
    }

    #[test]
    fn stacking_says_who_is_above() {
        assert_eq!(stacking(None, GAME), Stacking::Unknown);
        assert_eq!(stacking(Some(&[]), GAME), Stacking::OverlayAbove);
        assert_eq!(stacking(Some(&[OTHER, 7, 8]), GAME), Stacking::OverlayAbove);
        assert_eq!(stacking(Some(&[OTHER, GAME]), GAME), Stacking::GameAbove);
        assert_eq!(stacking(Some(&[GAME]), GAME), Stacking::GameAbove);
    }

    #[test]
    fn a_hidden_overlay_is_never_raised() {
        // 게임이 위에 있고 전경이어도, 사용자가 숨긴 오버레이는 올리지 않는다. 창 순서도 읽지 않는다.
        let mut rule = StayOnTop::new();
        for game in [found(true), found(false), minimized(), missing()] {
            assert_eq!(
                rule.step(false, &game, never),
                Decision::Leave(Leave::OverlayHidden)
            );
        }
        assert_eq!(gate(false, &found(true)), Err(Leave::OverlayHidden));
    }

    #[test]
    fn nothing_is_raised_without_a_game_window_or_while_it_is_minimized() {
        let mut rule = StayOnTop::new();
        assert_eq!(rule.step(true, &missing(), never), Decision::Leave(Leave::NoGame));
        let launcher = GameWindowStatus::from_error(&GameError::LauncherOnly);
        assert_eq!(rule.step(true, &launcher, never), Decision::Leave(Leave::NoGame));
        let unavailable = GameWindowStatus::from_error(&GameError::Unsupported);
        assert_eq!(rule.step(true, &unavailable, never), Decision::Leave(Leave::NoGame));
        assert_eq!(
            rule.step(true, &minimized(), never),
            Decision::Leave(Leave::GameMinimized)
        );
        // 상태는 「찾음」인데 창 정보가 최소화로 읽힌 경우(읽는 사이에 바뀜)도 올리지 않는다.
        let mut racing = found(false);
        if let Some(window) = racing.window.as_mut() {
            window.minimized = true;
        }
        assert_eq!(
            rule.step(true, &racing, never),
            Decision::Leave(Leave::GameMinimized)
        );
    }

    #[test]
    fn an_overlay_that_is_already_above_the_game_is_left_alone() {
        let mut rule = StayOnTop::new();
        // 위에 다른 창(다른 항상 위 창)이 있어도 게임이 아니면 올리지 않는다 — 남의 창과 자리를 다투지 않는다.
        for above in [vec![], vec![OTHER], vec![OTHER, 7, 8]] {
            for foreground in [false, true] {
                assert_eq!(
                    rule.step(true, &found(foreground), || Some(above.clone())),
                    Decision::Leave(Leave::AlreadyOnTop)
                );
            }
        }
    }

    #[test]
    fn the_overlay_is_raised_when_the_game_is_above_it() {
        let mut rule = StayOnTop::new();
        // 게임이 전경이든 아니든(끌어 옮기는 중, 다른 창이 전경) 위에 있으면 올린다.
        for foreground in [true, false] {
            assert_eq!(
                rule.step(true, &found(foreground), || Some(vec![OTHER, GAME])),
                Decision::Raise
            );
        }
        // 올린 뒤에는(오버레이가 위) 다시 올리지 않는다.
        assert_eq!(
            rule.step(true, &found(true), || Some(vec![])),
            Decision::Leave(Leave::AlreadyOnTop)
        );
        // 게임을 다시 누르면(다시 위로) 또 올린다 — 횟수 제한이 없다.
        assert_eq!(
            rule.step(true, &found(true), || Some(vec![GAME])),
            Decision::Raise
        );
    }

    #[test]
    fn with_an_unreadable_order_the_overlay_is_raised_once_when_the_game_becomes_foreground() {
        let mut rule = StayOnTop::new();
        // 전경이 아니면 올리지 않는다.
        assert_eq!(
            rule.step(true, &found(false), || None),
            Decision::Leave(Leave::OrderUnknown)
        );
        // 방금 전경이 됐다 → 한 번 올린다. 전경인 채로 이어지면 다시 올리지 않는다.
        assert_eq!(rule.step(true, &found(true), || None), Decision::Raise);
        assert_eq!(
            rule.step(true, &found(true), || None),
            Decision::Leave(Leave::OrderUnknown)
        );
        // 전경에서 벗어났다가 다시 전경이 되면 또 한 번.
        assert_eq!(
            rule.step(true, &found(false), || None),
            Decision::Leave(Leave::OrderUnknown)
        );
        assert_eq!(rule.step(true, &found(true), || None), Decision::Raise);
    }

    #[test]
    fn hiding_or_losing_the_game_forgets_the_foreground_edge() {
        // 게임이 전경인 채로 오버레이를 숨겼다가 다시 보이면, 순서를 읽지 못해도 한 번 올린다.
        let mut rule = StayOnTop::new();
        assert_eq!(rule.step(true, &found(true), || None), Decision::Raise);
        assert_eq!(
            rule.step(false, &found(true), never),
            Decision::Leave(Leave::OverlayHidden)
        );
        assert_eq!(rule.step(true, &found(true), || None), Decision::Raise);
        // 게임이 최소화됐다가 전경으로 돌아와도 같다.
        assert_eq!(
            rule.step(true, &minimized(), never),
            Decision::Leave(Leave::GameMinimized)
        );
        assert_eq!(rule.step(true, &found(true), || None), Decision::Raise);
    }

    #[test]
    fn the_order_is_read_only_when_there_is_something_to_decide() {
        let mut rule = StayOnTop::new();
        let reads = std::cell::Cell::new(0);
        let count = || {
            reads.set(reads.get() + 1);
            Some(vec![])
        };
        let _ = rule.step(false, &found(true), count);
        let _ = rule.step(true, &missing(), count);
        let _ = rule.step(true, &minimized(), count);
        assert_eq!(reads.get(), 0);
        let _ = rule.step(true, &found(true), count);
        assert_eq!(reads.get(), 1);
    }

    #[test]
    fn the_watch_interval_keeps_the_delay_under_the_limit() {
        // 주기가 0.3초 안쪽이어야 「게임을 누른 뒤 0.3초 안에 다시 보인다」가 성립한다.
        assert!(WATCH_INTERVAL < MAX_DELAY);
        assert!(FOLLOW_INTERVAL < MAX_DELAY);
        assert_eq!(MAX_DELAY, Duration::from_millis(300));
        // 오버레이가 보이고 게임 창을 알고 있으면 — 붙이기가 꺼져 있어도 — 짧은 주기로 본다.
        for foreground in [false, true] {
            assert_eq!(watch_interval(false, true, &found(foreground)), WATCH_INTERVAL);
            assert_eq!(watch_interval(true, true, &found(foreground)), FOLLOW_INTERVAL);
        }
        // 최소화된 게임 창도 짧은 주기로 본다(다시 뜨는 것을 바로 알아챈다).
        assert_eq!(watch_interval(false, true, &minimized()), WATCH_INTERVAL);
        // 볼 것이 없으면 느리게.
        assert_eq!(watch_interval(false, false, &found(true)), IDLE_INTERVAL);
        assert_eq!(watch_interval(false, true, &missing()), IDLE_INTERVAL);
        assert_eq!(watch_interval(false, false, &missing()), IDLE_INTERVAL);
        // 붙이기 중이면 오버레이를 숨겨 뒀어도 게임 창을 따라간다. 게임이 없으면 붙이기 중에도 느리게 본다.
        assert_eq!(watch_interval(true, false, &found(false)), FOLLOW_INTERVAL);
        assert_eq!(watch_interval(true, true, &minimized()), FOLLOW_INTERVAL);
        assert_eq!(watch_interval(true, true, &missing()), IDLE_INTERVAL);
        assert_eq!(watch_interval(true, false, &missing()), IDLE_INTERVAL);
    }
}
