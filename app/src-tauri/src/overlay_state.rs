//! 오버레이 상태의 전환 규칙. 창 API를 모른다 — 무엇을 바꿔야 하는지만 계산한다.
//!
//! 규칙:
//! - 시작: 보임, 클릭 통과 꺼짐(조작 가능).
//! - 클릭 통과 전환: 보이는 동안에만 켜고 끈다. 숨긴 동안에는 무시한다
//!   (보이지 않는 창의 상태가 몰래 바뀌면 다시 보였을 때 어느 쪽인지 알 수 없다).
//! - 숨김/보임 전환: 클릭 통과 여부는 그대로 둔다. 다시 보이면 숨기기 전 상태다.

use serde::Serialize;

/// 오버레이 창의 논리 상태.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct OverlayState {
    /// 창이 보이는가.
    pub visible: bool,
    /// 마우스 입력이 창을 지나 아래 프로그램으로 가는가.
    pub click_through: bool,
}

/// 단축키가 일으키는 동작.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayAction {
    ToggleClickThrough,
    ToggleVisibility,
}

/// 전환 결과. `set_*`가 `Some`인 것만 창에 적용하면 된다(바뀌지 않은 것은 건드리지 않는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transition {
    pub next: OverlayState,
    pub set_visible: Option<bool>,
    pub set_click_through: Option<bool>,
}

impl Transition {
    /// 상태가 하나도 바뀌지 않았는가.
    pub fn is_noop(&self) -> bool {
        self.set_visible.is_none() && self.set_click_through.is_none()
    }
}

impl OverlayState {
    /// 시작 상태: 보이고, 조작할 수 있다.
    pub const fn initial() -> Self {
        Self {
            visible: true,
            click_through: false,
        }
    }

    /// 동작을 적용한 다음 상태와, 창에 반영할 변화를 돌려준다. 자신은 바꾸지 않는다.
    pub fn apply(self, action: OverlayAction) -> Transition {
        let next = match action {
            OverlayAction::ToggleClickThrough if self.visible => Self {
                click_through: !self.click_through,
                ..self
            },
            OverlayAction::ToggleClickThrough => self,
            OverlayAction::ToggleVisibility => Self {
                visible: !self.visible,
                ..self
            },
        };
        Transition {
            next,
            set_visible: (next.visible != self.visible).then_some(next.visible),
            set_click_through: (next.click_through != self.click_through)
                .then_some(next.click_through),
        }
    }
}

impl Default for OverlayState {
    fn default() -> Self {
        Self::initial()
    }
}

/// 창을 화면 오른쪽 위에 둘 때의 왼쪽 위 좌표(물리 픽셀).
///
/// `area_*`는 모니터의 작업 영역(위치와 크기), `window_width`는 창의 바깥 너비다.
/// 창이 작업 영역보다 넓으면 왼쪽 끝에 맞춘다(화면 밖으로 나가지 않게).
pub fn top_right_position(
    area_x: i32,
    area_y: i32,
    area_width: u32,
    window_width: u32,
    margin: u32,
) -> (i32, i32) {
    // 창 옆에 남는 너비. 여백을 둘 자리가 모자라면 여백을 줄인다.
    let free = (i64::from(area_width) - i64::from(window_width)).max(0);
    let margin = i64::from(margin).min(free);
    let x = i64::from(area_x) + free - margin;
    let y = i64::from(area_y) + margin;
    (clamp_i32(x), clamp_i32(y))
}

fn clamp_i32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use OverlayAction::{ToggleClickThrough, ToggleVisibility};

    fn state(visible: bool, click_through: bool) -> OverlayState {
        OverlayState {
            visible,
            click_through,
        }
    }

    #[test]
    fn starts_visible_and_interactive() {
        assert_eq!(OverlayState::initial(), state(true, false));
        assert_eq!(OverlayState::default(), OverlayState::initial());
    }

    #[test]
    fn click_through_toggles_on_and_off_while_visible() {
        let on = OverlayState::initial().apply(ToggleClickThrough);
        assert_eq!(on.next, state(true, true));
        assert_eq!(on.set_click_through, Some(true));
        assert_eq!(on.set_visible, None);

        let off = on.next.apply(ToggleClickThrough);
        assert_eq!(off.next, state(true, false));
        assert_eq!(off.set_click_through, Some(false));
        assert_eq!(off.set_visible, None);
    }

    #[test]
    fn visibility_toggles_and_keeps_click_through() {
        for click_through in [false, true] {
            let hidden = state(true, click_through).apply(ToggleVisibility);
            assert_eq!(hidden.next, state(false, click_through));
            assert_eq!(hidden.set_visible, Some(false));
            assert_eq!(hidden.set_click_through, None);

            let shown = hidden.next.apply(ToggleVisibility);
            assert_eq!(shown.next, state(true, click_through));
            assert_eq!(shown.set_visible, Some(true));
            assert_eq!(shown.set_click_through, None);
        }
    }

    #[test]
    fn click_through_toggle_is_ignored_while_hidden() {
        for click_through in [false, true] {
            let t = state(false, click_through).apply(ToggleClickThrough);
            assert_eq!(t.next, state(false, click_through));
            assert!(t.is_noop());
        }
    }

    #[test]
    fn only_changed_fields_are_reported() {
        // 네 상태 × 두 동작: set_*는 실제로 바뀐 것과 정확히 일치한다.
        for visible in [false, true] {
            for click_through in [false, true] {
                for action in [ToggleClickThrough, ToggleVisibility] {
                    let before = state(visible, click_through);
                    let t = before.apply(action);
                    assert_eq!(
                        t.set_visible,
                        (t.next.visible != before.visible).then_some(t.next.visible)
                    );
                    assert_eq!(
                        t.set_click_through,
                        (t.next.click_through != before.click_through)
                            .then_some(t.next.click_through)
                    );
                    assert_eq!(t.is_noop(), t.next == before);
                }
            }
        }
    }

    #[test]
    fn apply_does_not_mutate_the_original() {
        let before = OverlayState::initial();
        let _ = before.apply(ToggleVisibility);
        assert_eq!(before, OverlayState::initial());
    }

    #[test]
    fn hide_then_show_restores_click_through_mode() {
        let s = OverlayState::initial()
            .apply(ToggleClickThrough)
            .next
            .apply(ToggleVisibility)
            .next
            .apply(ToggleClickThrough) // 숨긴 동안: 무시
            .next
            .apply(ToggleVisibility)
            .next;
        assert_eq!(s, state(true, true));
    }

    #[test]
    fn serializes_with_snake_case_fields() {
        let json = serde_json::to_value(state(true, true)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "visible": true, "click_through": true })
        );
    }

    #[test]
    fn top_right_places_window_inside_the_work_area() {
        // 1920 너비 작업 영역, 420 너비 창, 여백 24
        assert_eq!(top_right_position(0, 0, 1920, 420, 24), (1476, 24));
        // 보조 모니터(왼쪽, 음수 좌표)
        assert_eq!(
            top_right_position(-2560, 100, 2560, 420, 24),
            (-2560 + 2116, 124)
        );
    }

    #[test]
    fn top_right_never_leaves_the_work_area() {
        // 여백을 둘 자리가 모자라면 여백을 줄인다
        assert_eq!(top_right_position(0, 0, 430, 420, 24), (0, 10));
        // 창이 더 넓으면 왼쪽 위 끝에 맞춘다
        assert_eq!(top_right_position(10, 20, 300, 420, 24), (10, 20));
        // 꼭 맞으면 여백 없음
        assert_eq!(top_right_position(0, 0, 420, 420, 24), (0, 0));
    }
}
