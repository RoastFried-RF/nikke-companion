//! 오버레이 위젯의 규칙(P-028). 창 API·파일·스레드를 모른다 — 무엇을 해야 하는지만 계산한다.
//!
//! 오버레이 창은 게임 위에 뜨는 작은 위젯이다. 여기에는 그 위젯의 다섯 가지가 있다:
//! - **모양**(`Shape`): 접힘(알약) · 한 줄 카드(기본) · 펼침. 누르거나 단축키로 차례대로 바뀐다(`Shape::next`).
//! - **설정**(`Prefs`): 크기 배율·불투명도·이상 개체 화면을 떠났을 때 하는 일과 기다리는 시간·기본 모양·클릭 통과.
//!   화면이 준 값은 범위 안으로 맞추고, 모르는 낱말은 한국어로 거부한다.
//! - **자동 표시**(`AutoShow`): 자동 추적이 읽은 화면에 따라 언제 접거나 쉬게 하고(창을 숨긴다) 언제 되돌리는가.
//! - **창 크기**(`fit_size`): 화면이 잰 위젯의 크기를 창 크기로 — 창이 위젯보다 크면 빈 투명 영역이 게임 클릭을 가로막는다.
//! - **자리**(`Spot`·`Anchor`·`clamp_into`): 끌어 둔 자리를 기억하는 방법, 게임 창 기준의 자리, 화면 밖으로 나간 자리를
//!   안쪽으로 되돌리는 계산.
//!
//! 자동 표시의 규칙(`AutoShow::step`):
//! - 자동 추적이 **이상 개체 화면과 보스를 인식하면**(`Seen::Anomaly`) 앞서 이 규칙이 접거나 쉬게 한 것을 되돌린다
//!   (쉬던 창은 활성화 없이 다시 보이고, 접었던 모양은 접기 전 모양으로). 사용자가 손으로 접은 것은 되돌리지 않는다.
//! - **이상 개체 화면이 아니게 되면**(`Seen::Away` — 다른 화면, 게임 없음, 게임 창 최소화) 설정한 시간 뒤에 접거나 쉰다.
//!   그 전에 이상 개체 화면으로 돌아오면 아무 일도 없다.
//! - **핀으로 고정했으면 그대로 둔다.** 「그대로 두기」로 설정했을 때도 그렇다.
//! - **인식이 `unknown`인 동안에는 바꾸지 않는다**(`Seen::Unsure` — 판단하지 않은 화면, 보스를 알아보지 못한 이상 개체 화면,
//!   읽기 실패, 사용자가 오버레이를 숨겨 읽지 않는 동안). 보스를 넘기는 도중이나 팝업 때문에 잠깐 모르게 된 것으로 접지 않는다.
//! - 떠나 있는 동안 사용자가 손으로 모양을 바꾸거나 다시 띄웠으면(`touched`) 그 사람의 뜻이다 — 이상 개체 화면에 다시
//!   들어갔다 나올 때까지 이 규칙은 손대지 않는다.
//!
//! 「쉰다」는 사용자가 숨긴 것(Alt+Shift+O)과 다르다: 쉬는 동안에도 자동 추적은 게임 화면을 계속 읽고(그래야 이상 개체
//! 화면에서 다시 뜬다), 사용자가 숨긴 오버레이는 자동 표시가 다시 띄우지 않는다.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::game_window::ScreenRect;
use crate::recognize::ScreenKind;
use crate::screen_track::{TrackState, TrackStatus};

// ── 모양 ─────────────────────────────────────────────────────────────────────

/// 위젯의 모양. 화면의 낱말(`collapsed`·`card`·`expanded`)과 같다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    /// 접힘(알약): 보스 이미지·이름·총딜.
    Collapsed,
    /// 한 줄 카드(기본): 보스 이미지·이름·약점·총딜·작은 초상화 다섯.
    #[default]
    Card,
    /// 펼침: 한 줄 카드 + 한 줄 요약 + 2·3위 + 자리 순서 안내.
    Expanded,
}

impl Shape {
    pub const fn key(self) -> &'static str {
        match self {
            Self::Collapsed => "collapsed",
            Self::Card => "card",
            Self::Expanded => "expanded",
        }
    }

    /// 화면·파일의 낱말을 읽는다. 모르는 낱말이면 `None`.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "collapsed" => Some(Self::Collapsed),
            "card" => Some(Self::Card),
            "expanded" => Some(Self::Expanded),
            _ => None,
        }
    }

    /// 단축키·누르기로 넘어가는 다음 모양: 접힘 → 한 줄 카드 → 펼침 → 접힘.
    pub const fn next(self) -> Self {
        match self {
            Self::Collapsed => Self::Card,
            Self::Card => Self::Expanded,
            Self::Expanded => Self::Collapsed,
        }
    }
}

// ── 설정 ─────────────────────────────────────────────────────────────────────

/// 이상 개체 화면을 떠났을 때 위젯이 하는 일.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Leave {
    /// 그대로 둔다.
    Stay,
    /// 접는다(알약 모양 — 기본).
    #[default]
    Collapse,
    /// 쉰다(창을 숨긴다. 이상 개체 화면으로 돌아오면 다시 뜬다).
    Hide,
}

impl Leave {
    pub const fn key(self) -> &'static str {
        match self {
            Self::Stay => "stay",
            Self::Collapse => "collapse",
            Self::Hide => "hide",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "stay" => Some(Self::Stay),
            "collapse" => Some(Self::Collapse),
            "hide" => Some(Self::Hide),
            _ => None,
        }
    }
}

/// 크기 배율의 범위와 기본값(%).
pub const SCALE_MIN: u32 = 80;
pub const SCALE_MAX: u32 = 150;
pub const SCALE_DEFAULT: u32 = 100;
/// 불투명도의 범위와 기본값(%). 정보 영역은 기본이 불투명이다 — 게임 화면이 비쳐 글자가 묻히지 않게.
pub const OPACITY_MIN: u32 = 40;
pub const OPACITY_MAX: u32 = 100;
pub const OPACITY_DEFAULT: u32 = 100;
/// 이상 개체 화면을 떠난 뒤 접거나 쉬기까지 기다리는 시간의 범위와 기본값(초).
pub const LEAVE_AFTER_MIN: u32 = 2;
pub const LEAVE_AFTER_MAX: u32 = 120;
pub const LEAVE_AFTER_DEFAULT: u32 = 8;

/// 오버레이 설정. 화면에 그대로 넘긴다(프런트의 `OverlayPrefs`와 같아야 한다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Prefs {
    /// 크기 배율(%).
    pub scale_percent: u32,
    /// 불투명도(%).
    pub opacity_percent: u32,
    /// 이상 개체 화면을 떠났을 때 하는 일.
    pub leave: Leave,
    /// 그 일을 하기까지 기다리는 시간(초).
    pub leave_after_sec: u32,
    /// 앱을 켰을 때의 모양.
    pub default_shape: Shape,
    /// 클릭 통과를 켜 둘 것인가(다음에 켤 때도 그대로다).
    pub click_through: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            scale_percent: SCALE_DEFAULT,
            opacity_percent: OPACITY_DEFAULT,
            leave: Leave::default(),
            leave_after_sec: LEAVE_AFTER_DEFAULT,
            default_shape: Shape::default(),
            click_through: false,
        }
    }
}

/// 화면이 준 수를 범위 안의 정수로. 수가 아니면 `None`.
fn clamped(value: &Value, min: u32, max: u32) -> Option<u32> {
    let n = value.as_f64().filter(|n| n.is_finite())?;
    Some(n.round().clamp(f64::from(min), f64::from(max)) as u32)
}

impl Prefs {
    /// 바꿀 칸만 담은 객체를 얹은 설정. 수는 범위 안으로 맞추고, 모르는 낱말·모양이 다른 값은 한국어로 거부한다
    /// (거부하면 아무것도 바뀌지 않는다). 모르는 칸은 무시한다.
    pub fn merged(self, patch: &Value) -> Result<Self, String> {
        let Some(patch) = patch.as_object() else {
            return Err("오버레이 설정의 모양이 다르다(칸 이름과 값의 묶음이어야 한다)".to_string());
        };
        let mut next = self;
        let number = |key: &str, label: &str, min: u32, max: u32| -> Result<Option<u32>, String> {
            match patch.get(key) {
                None => Ok(None),
                Some(value) => clamped(value, min, max)
                    .map(Some)
                    .ok_or_else(|| format!("{label}은(는) 수여야 한다")),
            }
        };
        if let Some(n) = number("scale_percent", "크기 배율", SCALE_MIN, SCALE_MAX)? {
            next.scale_percent = n;
        }
        if let Some(n) = number("opacity_percent", "불투명도", OPACITY_MIN, OPACITY_MAX)? {
            next.opacity_percent = n;
        }
        if let Some(n) = number(
            "leave_after_sec",
            "자동 숨김 시간",
            LEAVE_AFTER_MIN,
            LEAVE_AFTER_MAX,
        )? {
            next.leave_after_sec = n;
        }
        if let Some(value) = patch.get("leave") {
            next.leave = value
                .as_str()
                .and_then(Leave::parse)
                .ok_or("모르는 자동 숨김 방법이다")?;
        }
        if let Some(value) = patch.get("default_shape") {
            next.default_shape = value
                .as_str()
                .and_then(Shape::parse)
                .ok_or("모르는 오버레이 모양이다")?;
        }
        if let Some(value) = patch.get("click_through") {
            next.click_through = value.as_bool().ok_or("클릭 통과는 켜짐·꺼짐이어야 한다")?;
        }
        Ok(next)
    }

    /// 이상 개체 화면을 떠난 뒤 기다리는 시간(밀리초).
    pub const fn leave_after_ms(self) -> u64 {
        self.leave_after_sec as u64 * 1000
    }
}

/// 화면에 넘기는 위젯 상태. 프런트의 `WidgetSnapshot`(src/types.ts)과 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WidgetSnapshot {
    /// 지금 모양.
    pub shape: Shape,
    /// 핀으로 고정했는가(자동 표시가 접거나 쉬게 하지 않는다).
    pub pinned: bool,
    /// 자동 표시가 쉬게 했는가(창이 숨겨져 있다 — 이상 개체 화면으로 돌아오면 다시 뜬다).
    pub resting: bool,
    pub prefs: Prefs,
    /// 설정·자리를 읽거나 저장하다 난 문제(한국어 문장). 없으면 null.
    pub problem: Option<String>,
}

// ── 자동 표시 ─────────────────────────────────────────────────────────────────

/// 자동 추적이 방금 본 것을 자동 표시의 눈으로.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Seen {
    /// 이상 개체 화면이고 보스를 알아봤다.
    Anomaly,
    /// 이상 개체 화면이 아니다(다른 화면, 게임 없음, 게임 창 최소화).
    Away,
    /// 모른다 — 아무것도 바꾸지 않는다.
    Unsure,
}

/// 추적 상태에서 본 것을 읽는다.
pub fn seen(status: &TrackStatus) -> Seen {
    if !status.enabled {
        return Seen::Unsure;
    }
    match status.state {
        TrackState::Read => match status.recognition.as_ref() {
            Some(r) => match (r.screen, r.boss.is_some()) {
                (ScreenKind::AnomalySelect | ScreenKind::AnomalySquad, true) => Seen::Anomaly,
                (ScreenKind::Other, _) => Seen::Away,
                // 판단하지 않은 화면, 보스를 알아보지 못한 이상 개체 화면: 추측하지 않는다.
                _ => Seen::Unsure,
            },
            None => Seen::Unsure,
        },
        TrackState::NoGame | TrackState::Minimized => Seen::Away,
        TrackState::Off | TrackState::Starting | TrackState::OverlayHidden | TrackState::Failed => {
            Seen::Unsure
        }
    }
}

/// 자동 표시가 해 둔 일(되돌릴 때 쓴다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Parked {
    /// 접었다. `from`은 접기 전 모양.
    Collapsed { from: Shape },
    /// 쉬게 했다(창을 숨겼다).
    Resting,
}

/// 자동 표시가 한 주기에 시키는 일.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoAction {
    /// 아무것도 바꾸지 않는다.
    Keep,
    /// 접는다(알약 모양으로).
    Collapse,
    /// 쉬게 한다(창을 숨긴다).
    Rest,
    /// 접기 전 모양으로 되돌린다.
    Restore(Shape),
    /// 쉬던 창을 다시 보인다(활성화 없이).
    Wake,
}

/// 자동 표시의 한 주기에 넣는 것.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoInput {
    pub seen: Seen,
    /// 지금 시각(밀리초 — 어느 기준이든 늘기만 하면 된다).
    pub now_ms: u64,
    pub pinned: bool,
    /// 지금 모양.
    pub shape: Shape,
    pub leave: Leave,
    /// 떠난 뒤 기다리는 시간(밀리초).
    pub after_ms: u64,
}

/// 자동 표시의 상태.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AutoShow {
    /// 이상 개체 화면을 떠난 것을 처음 본 시각.
    away_since_ms: Option<u64>,
    /// 이번에 떠나 있는 동안의 일은 끝났다(이미 접거나 쉬게 했다, 또는 사용자가 손댔다).
    handled: bool,
    /// 이 규칙이 해 둔 일.
    parked: Option<Parked>,
}

impl AutoShow {
    /// 쉬게 해 둔 상태인가.
    pub fn is_resting(&self) -> bool {
        self.parked == Some(Parked::Resting)
    }

    /// 한 주기: 본 것에 따라 할 일을 정한다.
    pub fn step(&mut self, input: AutoInput) -> AutoAction {
        match input.seen {
            Seen::Unsure => AutoAction::Keep,
            Seen::Anomaly => {
                self.away_since_ms = None;
                self.handled = false;
                match self.parked.take() {
                    Some(Parked::Resting) => AutoAction::Wake,
                    // 접어 둔 것을 사용자가 그 사이에 바꿨으면(이미 접힘이 아니다) 건드리지 않는다.
                    Some(Parked::Collapsed { from }) if input.shape == Shape::Collapsed => {
                        AutoAction::Restore(from)
                    }
                    _ => AutoAction::Keep,
                }
            }
            Seen::Away => {
                if input.pinned || input.leave == Leave::Stay {
                    // 고정했거나 그대로 두기로 했다. 고정을 풀면 그때부터 다시 센다.
                    self.away_since_ms = None;
                    return AutoAction::Keep;
                }
                if self.handled || self.parked.is_some() {
                    return AutoAction::Keep;
                }
                let since = *self.away_since_ms.get_or_insert(input.now_ms);
                if input.now_ms.saturating_sub(since) < input.after_ms {
                    return AutoAction::Keep;
                }
                self.handled = true;
                match input.leave {
                    Leave::Hide => {
                        self.parked = Some(Parked::Resting);
                        AutoAction::Rest
                    }
                    Leave::Collapse if input.shape != Shape::Collapsed => {
                        self.parked = Some(Parked::Collapsed { from: input.shape });
                        AutoAction::Collapse
                    }
                    // 이미 접혀 있다(사용자가 접었다): 할 일이 없다.
                    _ => AutoAction::Keep,
                }
            }
        }
    }

    /// 사용자가 손으로 모양을 바꾸거나 오버레이를 띄우거나 숨겼다: 이 규칙이 해 둔 일은 잊는다(되돌리지 않는다).
    /// 떠나 있는 동안이었으면 이번에는 더 손대지 않는다.
    pub fn touched(&mut self) {
        self.parked = None;
        if self.away_since_ms.is_some() {
            self.handled = true;
        }
    }

    /// 자동 추적이 꺼졌다: 처음으로 돌아간다. 쉬게 해 둔 창이 있었으면 `true` — 다시 보여야 한다
    /// (추적이 꺼지면 이 규칙이 다시 띄워 줄 일이 없다).
    pub fn release(&mut self) -> bool {
        let resting = self.is_resting();
        *self = Self::default();
        resting
    }
}

// ── 창 크기 ───────────────────────────────────────────────────────────────────

/// 위젯 크기의 범위(논리 픽셀). 화면이 잰 값이 이 밖이면 범위 안으로 맞춘다.
pub const FIT_MIN_WIDTH: f64 = 64.0;
pub const FIT_MAX_WIDTH: f64 = 760.0;
pub const FIT_MIN_HEIGHT: f64 = 24.0;
pub const FIT_MAX_HEIGHT: f64 = 760.0;

/// 화면이 잰 위젯의 크기(논리 픽셀)를 창의 크기(물리 픽셀)로. 수가 아니거나 0 이하면 `None`(창을 바꾸지 않는다).
/// 소수는 올린다 — 창이 위젯보다 작아 가장자리가 잘리지 않게.
pub fn fit_size(width: f64, height: f64, scale_factor: f64) -> Option<(u32, u32)> {
    let usable = |n: f64| n.is_finite() && n > 0.0;
    if !usable(width) || !usable(height) || !usable(scale_factor) {
        return None;
    }
    let w = width.clamp(FIT_MIN_WIDTH, FIT_MAX_WIDTH);
    let h = height.clamp(FIT_MIN_HEIGHT, FIT_MAX_HEIGHT);
    Some((
        (w * scale_factor).ceil() as u32,
        (h * scale_factor).ceil() as u32,
    ))
}

// ── 자리 ─────────────────────────────────────────────────────────────────────

/// 위젯이 붙어 있는 모서리. 모양이 바뀌어 크기가 달라져도 이 모서리는 제자리에 있다(오른쪽 위에 둔 위젯은 왼쪽·아래로 자란다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Corner {
    TopLeft,
    #[default]
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    pub const fn key(self) -> &'static str {
        match self {
            Self::TopLeft => "top_left",
            Self::TopRight => "top_right",
            Self::BottomLeft => "bottom_left",
            Self::BottomRight => "bottom_right",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "top_left" => Some(Self::TopLeft),
            "top_right" => Some(Self::TopRight),
            "bottom_left" => Some(Self::BottomLeft),
            "bottom_right" => Some(Self::BottomRight),
            _ => None,
        }
    }

    const fn is_right(self) -> bool {
        matches!(self, Self::TopRight | Self::BottomRight)
    }

    const fn is_bottom(self) -> bool {
        matches!(self, Self::BottomLeft | Self::BottomRight)
    }
}

fn clamp_i32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// 사각형의 그 모서리 점(화면 좌표).
pub fn corner_point(rect: ScreenRect, corner: Corner) -> (i32, i32) {
    let x = i64::from(rect.x) + if corner.is_right() { i64::from(rect.width) } else { 0 };
    let y = i64::from(rect.y) + if corner.is_bottom() { i64::from(rect.height) } else { 0 };
    (clamp_i32(x), clamp_i32(y))
}

/// 그 모서리 점에 모서리를 맞춘, 크기 `size`인 창의 왼쪽 위 좌표.
pub fn top_left_at(point: (i32, i32), corner: Corner, size: (u32, u32)) -> (i32, i32) {
    let x = i64::from(point.0) - if corner.is_right() { i64::from(size.0) } else { 0 };
    let y = i64::from(point.1) - if corner.is_bottom() { i64::from(size.1) } else { 0 };
    (clamp_i32(x), clamp_i32(y))
}

/// 기준 사각형(게임 화면·모니터) 안에서 위젯이 어느 모서리에 가까운가 — 위젯의 가운데가 기준의 어느 쪽 절반에 있는지로 정한다.
pub fn nearest_corner(reference: ScreenRect, overlay: ScreenRect) -> Corner {
    let center = |start: i32, length: u32| i64::from(start) * 2 + i64::from(length);
    let right = center(overlay.x, overlay.width) > center(reference.x, reference.width);
    let bottom = center(overlay.y, overlay.height) > center(reference.y, reference.height);
    match (right, bottom) {
        (false, false) => Corner::TopLeft,
        (true, false) => Corner::TopRight,
        (false, true) => Corner::BottomLeft,
        (true, true) => Corner::BottomRight,
    }
}

/// 화면 위의 자리(붙이기를 켜지 않았을 때): 위젯의 그 모서리 점이 있는 화면 좌표(물리 픽셀).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Spot {
    pub corner: Corner,
    pub x: i32,
    pub y: i32,
}

impl Spot {
    /// 사용자가 끌어 둔 자리에서 만든다. `area`는 위젯이 있는 모니터의 작업 영역(모르면 `None` — 오른쪽 위 모서리로 친다).
    pub fn of(area: Option<ScreenRect>, overlay: ScreenRect) -> Self {
        let corner = area.map(|a| nearest_corner(a, overlay)).unwrap_or_default();
        let (x, y) = corner_point(overlay, corner);
        Self { corner, x, y }
    }

    /// 이 자리에 둘 때 창의 왼쪽 위 좌표.
    pub fn position(self, size: (u32, u32)) -> (i32, i32) {
        top_left_at((self.x, self.y), self.corner, size)
    }
}

/// 게임 창 기준의 자리(붙이기를 켰을 때): 게임 화면의 그 모서리에서 위젯의 같은 모서리까지의 거리(물리 픽셀, 오른쪽·아래가 +).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Anchor {
    pub corner: Corner,
    pub dx: i32,
    pub dy: i32,
}

impl Anchor {
    /// 처음 붙일 때의 자리: 게임 화면의 오른쪽 위 안쪽으로 `margin`만큼.
    pub fn inside_top_right(margin: u32) -> Self {
        let m = clamp_i32(i64::from(margin));
        Self {
            corner: Corner::TopRight,
            dx: -m,
            dy: m,
        }
    }

    /// 사용자가 끌어 둔 자리에서 만든다(`client`는 게임 화면, `overlay`는 위젯의 지금 사각형).
    pub fn of(client: ScreenRect, overlay: ScreenRect) -> Self {
        let corner = nearest_corner(client, overlay);
        let (gx, gy) = corner_point(client, corner);
        let (ox, oy) = corner_point(overlay, corner);
        Self {
            corner,
            dx: clamp_i32(i64::from(ox) - i64::from(gx)),
            dy: clamp_i32(i64::from(oy) - i64::from(gy)),
        }
    }

    /// 게임 화면이 `client`일 때 창의 왼쪽 위 좌표.
    pub fn position(self, client: ScreenRect, size: (u32, u32)) -> (i32, i32) {
        let (gx, gy) = corner_point(client, self.corner);
        let point = (
            clamp_i32(i64::from(gx) + i64::from(self.dx)),
            clamp_i32(i64::from(gy) + i64::from(self.dy)),
        );
        top_left_at(point, self.corner, size)
    }
}

/// 두 사각형이 겹치는 넓이.
fn overlap(a: ScreenRect, b: ScreenRect) -> i64 {
    let span = |a0: i32, al: u32, b0: i32, bl: u32| {
        let start = i64::from(a0).max(i64::from(b0));
        let end = (i64::from(a0) + i64::from(al)).min(i64::from(b0) + i64::from(bl));
        (end - start).max(0)
    };
    span(a.x, a.width, b.x, b.width) * span(a.y, a.height, b.y, b.height)
}

/// 사각형의 가운데에서 영역까지의 거리(제곱). 영역 안이면 0.
fn distance_sq(rect: ScreenRect, area: ScreenRect) -> i64 {
    let cx = i64::from(rect.x) + i64::from(rect.width) / 2;
    let cy = i64::from(rect.y) + i64::from(rect.height) / 2;
    let gap = |c: i64, start: i32, length: u32| {
        let lo = i64::from(start);
        let hi = lo + i64::from(length);
        if c < lo {
            lo - c
        } else if c > hi {
            c - hi
        } else {
            0
        }
    };
    let dx = gap(cx, area.x, area.width);
    let dy = gap(cy, area.y, area.height);
    dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy))
}

/// 창이 화면 밖으로 나갔으면 안쪽으로 되돌린 왼쪽 위 좌표. `areas`는 모니터들의 작업 영역이다.
///
/// 창과 가장 많이 겹치는 모니터 안으로(어느 모니터와도 겹치지 않으면 가장 가까운 모니터 안으로) 통째로 들어오게 한다.
/// 창이 그 모니터보다 크면 왼쪽 위에 맞춘다. 이미 안에 있으면 그대로다. 모니터를 모르면(`areas`가 비었다) 바꾸지 않는다.
pub fn clamp_into(position: (i32, i32), size: (u32, u32), areas: &[ScreenRect]) -> (i32, i32) {
    let rect = ScreenRect {
        x: position.0,
        y: position.1,
        width: size.0,
        height: size.1,
    };
    let usable = areas.iter().copied().filter(|a| !a.is_empty());
    let Some(area) = usable.clone().max_by_key(|a| overlap(rect, *a)).filter(|a| overlap(rect, *a) > 0).or_else(|| usable.min_by_key(|a| distance_sq(rect, *a))) else {
        return position;
    };
    let fit = |start: i32, length: u32, area_start: i32, area_length: u32| {
        let lo = i64::from(area_start);
        let hi = (lo + i64::from(area_length) - i64::from(length)).max(lo);
        clamp_i32(i64::from(start).clamp(lo, hi))
    };
    (
        fit(position.0, size.0, area.x, area.width),
        fit(position.1, size.1, area.y, area.height),
    )
}

// ── 기억해 두는 것 ────────────────────────────────────────────────────────────

/// 기억해 두는 것의 종류와 판.
pub const STORED_KIND: &str = "overlay_widget";
pub const STORED_SCHEMA_VERSION: u64 = 1;

/// 디스크에 기억해 두는 것: 설정, 핀, 자리 둘(화면 위의 자리·게임 창 기준의 자리).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Stored {
    pub prefs: Prefs,
    pub pinned: bool,
    /// 끌어 둔 화면 위의 자리. 없으면 기본 자리(주 모니터의 오른쪽 위).
    pub spot: Option<Spot>,
    /// 끌어 둔 게임 창 기준의 자리. 없으면 기본 자리(게임 화면의 오른쪽 위 안쪽).
    pub anchor: Option<Anchor>,
}

fn int(value: &Value, key: &str) -> Option<i32> {
    value.get(key)?.as_i64().and_then(|n| i32::try_from(n).ok())
}

impl Stored {
    pub fn to_value(&self) -> Value {
        json!({
            "schema_version": STORED_SCHEMA_VERSION,
            "kind": STORED_KIND,
            "prefs": {
                "scale_percent": self.prefs.scale_percent,
                "opacity_percent": self.prefs.opacity_percent,
                "leave": self.prefs.leave.key(),
                "leave_after_sec": self.prefs.leave_after_sec,
                "default_shape": self.prefs.default_shape.key(),
                "click_through": self.prefs.click_through,
            },
            "pinned": self.pinned,
            "spot": self.spot.map(|s| json!({ "corner": s.corner.key(), "x": s.x, "y": s.y })),
            "anchor": self.anchor.map(|a| json!({ "corner": a.corner.key(), "dx": a.dx, "dy": a.dy })),
        })
    }

    /// 기억해 둔 문서를 읽는다. 종류·판이 다르거나 설정을 읽을 수 없으면 한국어로 알린다(부르는 쪽이 기본값을 쓴다).
    /// 자리는 읽을 수 없으면 없는 것으로 친다(기본 자리로 간다).
    pub fn from_value(doc: &Value) -> Result<Self, String> {
        if doc.get("kind").and_then(Value::as_str) != Some(STORED_KIND)
            || doc.get("schema_version").and_then(Value::as_u64) != Some(STORED_SCHEMA_VERSION)
        {
            return Err("오버레이 설정의 종류나 판이 달라 읽지 않았다".to_string());
        }
        let prefs = match doc.get("prefs") {
            Some(prefs) => Prefs::default().merged(prefs)?,
            None => Prefs::default(),
        };
        let corner = |v: &Value| v.get("corner").and_then(Value::as_str).and_then(Corner::parse);
        let spot = doc.get("spot").and_then(|v| {
            Some(Spot {
                corner: corner(v)?,
                x: int(v, "x")?,
                y: int(v, "y")?,
            })
        });
        let anchor = doc.get("anchor").and_then(|v| {
            Some(Anchor {
                corner: corner(v)?,
                dx: int(v, "dx")?,
                dy: int(v, "dy")?,
            })
        });
        Ok(Self {
            prefs,
            pinned: doc.get("pinned").and_then(Value::as_bool).unwrap_or(false),
            spot,
            anchor,
        })
    }
}

// ── 앱 창이 알리는 계산 진행 ──────────────────────────────────────────────────

/// 진행을 설명하는 한 줄의 최대 길이(글자 수). 넘는 부분은 버린다.
pub const ACTIVITY_LABEL_MAX: usize = 80;

/// 데스크톱 앱 창이 요격전 추천을 계산하는 동안 알려 주는 진행. 오버레이는 이것을 작게 보여 줄 뿐이다 —
/// 계산을 시작하거나 멈추지 못한다. 프런트의 `ComputeActivity`(src/types.ts)와 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Activity {
    /// 계산이 돌고 있는가.
    pub running: bool,
    /// 무엇을 하는 중인지(「크라켄 추천 편성을 찾는 중」).
    pub label: String,
    /// 끝난 건수와 전체 건수. 전체를 아직 모르면 0.
    pub done: u32,
    pub total: u32,
    /// 시작한 뒤 흐른 시간(밀리초).
    pub elapsed_ms: u64,
}

impl Activity {
    /// 화면이 준 값을 다듬는다: 돌고 있지 않으면 빈 값, 설명은 길이를 자르고, 끝난 건수는 전체를 넘지 않는다.
    pub fn sanitized(self) -> Self {
        if !self.running {
            return Self::default();
        }
        Self {
            running: true,
            label: self.label.trim().chars().take(ACTIVITY_LABEL_MAX).collect(),
            done: if self.total > 0 { self.done.min(self.total) } else { 0 },
            total: self.total,
            elapsed_ms: self.elapsed_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recognize::{Boss, Recognition};

    #[test]
    fn the_announced_activity_is_tidied_before_it_reaches_the_overlay() {
        let raw = Activity {
            running: true,
            label: format!("  {}  ", "가".repeat(200)),
            done: 90,
            total: 60,
            elapsed_ms: 1234,
        };
        let tidy = raw.sanitized();
        assert_eq!(tidy.label.chars().count(), ACTIVITY_LABEL_MAX);
        assert_eq!((tidy.done, tidy.total), (60, 60));
        assert_eq!(tidy.elapsed_ms, 1234);
        // 전체를 모르면 끝난 건수도 말하지 않는다.
        let unknown = Activity { running: true, done: 5, total: 0, ..Activity::default() }.sanitized();
        assert_eq!((unknown.done, unknown.total), (0, 0));
        // 돌고 있지 않으면 남은 값이 없다.
        let idle = Activity { running: false, label: "남은 글".into(), done: 3, total: 9, elapsed_ms: 7 }.sanitized();
        assert_eq!(idle, Activity::default());
        let keys: Vec<String> = serde_json::to_value(Activity::default())
            .unwrap()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ["running", "label", "done", "total", "elapsed_ms"]);
    }

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    fn rect(x: i32, y: i32, width: u32, height: u32) -> ScreenRect {
        ScreenRect {
            x,
            y,
            width,
            height,
        }
    }

    // ── 모양·설정 ──

    #[test]
    fn the_shape_cycles_collapsed_card_expanded() {
        assert_eq!(Shape::default(), Shape::Card);
        assert_eq!(Shape::Collapsed.next(), Shape::Card);
        assert_eq!(Shape::Card.next(), Shape::Expanded);
        assert_eq!(Shape::Expanded.next(), Shape::Collapsed);
        for shape in [Shape::Collapsed, Shape::Card, Shape::Expanded] {
            assert_eq!(Shape::parse(shape.key()), Some(shape));
            assert_eq!(serde_json::to_value(shape).unwrap(), json!(shape.key()));
        }
        assert_eq!(Shape::parse("wide"), None);
    }

    #[test]
    fn default_prefs_are_opaque_full_size_and_collapse_after_a_while() {
        let prefs = Prefs::default();
        assert_eq!(prefs.scale_percent, 100);
        assert_eq!(prefs.opacity_percent, 100, "정보 영역은 기본이 불투명이다");
        assert_eq!(prefs.leave, Leave::Collapse);
        assert_eq!(prefs.leave_after_sec, 8);
        assert_eq!(prefs.default_shape, Shape::Card);
        assert!(!prefs.click_through);
        assert_eq!(prefs.leave_after_ms(), 8000);
    }

    #[test]
    fn prefs_take_only_the_given_fields_and_clamp_numbers() {
        let base = Prefs::default();
        let next = base
            .merged(&json!({ "scale_percent": 125, "leave": "hide", "unknown_field": 1 }))
            .unwrap();
        assert_eq!(next.scale_percent, 125);
        assert_eq!(next.leave, Leave::Hide);
        assert_eq!(next.opacity_percent, base.opacity_percent);
        assert_eq!(next.default_shape, base.default_shape);

        let clamped = base
            .merged(&json!({ "scale_percent": 999, "opacity_percent": 1, "leave_after_sec": 0.2 }))
            .unwrap();
        assert_eq!(clamped.scale_percent, SCALE_MAX);
        assert_eq!(clamped.opacity_percent, OPACITY_MIN);
        assert_eq!(clamped.leave_after_sec, LEAVE_AFTER_MIN);
        let rounded = base.merged(&json!({ "scale_percent": 110.4 })).unwrap();
        assert_eq!(rounded.scale_percent, 110);
        let all = base
            .merged(&json!({ "default_shape": "expanded", "click_through": true, "leave_after_sec": 30 }))
            .unwrap();
        assert_eq!(all.default_shape, Shape::Expanded);
        assert!(all.click_through);
        assert_eq!(all.leave_after_sec, 30);
    }

    #[test]
    fn prefs_refuse_unknown_words_in_korean_and_change_nothing() {
        let base = Prefs::default();
        for bad in [
            json!({ "leave": "vanish" }),
            json!({ "default_shape": "huge" }),
            json!({ "scale_percent": "big" }),
            json!({ "click_through": "yes" }),
            json!({ "opacity_percent": null }),
            json!([1, 2]),
            json!("card"),
        ] {
            let err = base.merged(&bad).unwrap_err();
            assert!(has_korean(&err), "{bad}: {err}");
        }
        // 한 칸이 틀리면 다른 칸도 바뀌지 않는다(반쯤 바뀐 설정이 없다).
        assert!(base
            .merged(&json!({ "scale_percent": 120, "leave": "vanish" }))
            .is_err());
    }

    #[test]
    fn the_snapshot_serializes_with_the_names_the_screen_reads() {
        let snapshot = WidgetSnapshot {
            shape: Shape::Expanded,
            pinned: true,
            resting: false,
            prefs: Prefs::default(),
            problem: None,
        };
        let value = serde_json::to_value(&snapshot).unwrap();
        let keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["shape", "pinned", "resting", "prefs", "problem"]);
        assert_eq!(value["shape"], "expanded");
        let prefs: Vec<&str> = value["prefs"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            prefs,
            [
                "scale_percent",
                "opacity_percent",
                "leave",
                "leave_after_sec",
                "default_shape",
                "click_through"
            ]
        );
        assert_eq!(value["prefs"]["leave"], "collapse");
        assert_eq!(value["prefs"]["default_shape"], "card");
    }

    // ── 자동 표시 ──

    const AFTER: u64 = 5000;

    fn input(seen: Seen, now_ms: u64, shape: Shape) -> AutoInput {
        AutoInput {
            seen,
            now_ms,
            pinned: false,
            shape,
            leave: Leave::Collapse,
            after_ms: AFTER,
        }
    }

    fn status(state: TrackState, recognition: Option<(ScreenKind, Option<Boss>)>) -> TrackStatus {
        TrackStatus {
            enabled: true,
            interval_ms: 2000,
            state,
            message: String::new(),
            recognition: recognition.map(|(screen, boss)| Recognition {
                screen,
                boss,
                confidence: 0.9,
                evidence: Vec::new(),
                width: 1920,
                height: 1080,
            }),
            read_at: None,
            capture_ms: None,
            failures: 0,
        }
    }

    #[test]
    fn what_the_tracker_saw_maps_to_anomaly_away_or_unsure() {
        let boss = Some(Boss::Kraken);
        assert_eq!(seen(&status(TrackState::Read, Some((ScreenKind::AnomalySelect, boss)))), Seen::Anomaly);
        assert_eq!(seen(&status(TrackState::Read, Some((ScreenKind::AnomalySquad, boss)))), Seen::Anomaly);
        assert_eq!(seen(&status(TrackState::Read, Some((ScreenKind::Other, None)))), Seen::Away);
        assert_eq!(seen(&status(TrackState::NoGame, None)), Seen::Away);
        assert_eq!(seen(&status(TrackState::Minimized, None)), Seen::Away);
        // 모르는 것은 모르는 것이다: 판단하지 않은 화면, 보스 없는 이상 개체 화면, 실패, 숨김, 시작 중.
        assert_eq!(seen(&status(TrackState::Read, Some((ScreenKind::Unknown, None)))), Seen::Unsure);
        assert_eq!(seen(&status(TrackState::Read, Some((ScreenKind::AnomalySelect, None)))), Seen::Unsure);
        assert_eq!(seen(&status(TrackState::Read, None)), Seen::Unsure);
        assert_eq!(seen(&status(TrackState::Failed, None)), Seen::Unsure);
        assert_eq!(seen(&status(TrackState::OverlayHidden, None)), Seen::Unsure);
        assert_eq!(seen(&status(TrackState::Starting, None)), Seen::Unsure);
        // 추적이 꺼져 있으면 무엇이 남아 있든 모른다.
        let mut off = status(TrackState::Read, Some((ScreenKind::Other, None)));
        off.enabled = false;
        assert_eq!(seen(&off), Seen::Unsure);
    }

    #[test]
    fn leaving_the_anomaly_screen_collapses_after_the_delay_and_coming_back_restores() {
        let mut auto = AutoShow::default();
        assert_eq!(auto.step(input(Seen::Anomaly, 0, Shape::Expanded)), AutoAction::Keep);
        // 떠났다: 시간이 차기 전에는 그대로다.
        assert_eq!(auto.step(input(Seen::Away, 1000, Shape::Expanded)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 5999, Shape::Expanded)), AutoAction::Keep);
        // 시간이 찼다: 접는다.
        assert_eq!(auto.step(input(Seen::Away, 6000, Shape::Expanded)), AutoAction::Collapse);
        // 떠나 있는 동안 다시 시키지 않는다.
        assert_eq!(auto.step(input(Seen::Away, 60_000, Shape::Collapsed)), AutoAction::Keep);
        // 돌아왔다: 접기 전 모양으로.
        assert_eq!(
            auto.step(input(Seen::Anomaly, 61_000, Shape::Collapsed)),
            AutoAction::Restore(Shape::Expanded)
        );
        assert_eq!(auto.step(input(Seen::Anomaly, 62_000, Shape::Expanded)), AutoAction::Keep);
    }

    #[test]
    fn coming_back_before_the_delay_changes_nothing_and_restarts_the_clock() {
        let mut auto = AutoShow::default();
        assert_eq!(auto.step(input(Seen::Away, 0, Shape::Card)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Anomaly, 3000, Shape::Card)), AutoAction::Keep);
        // 다시 떠나면 처음부터 센다.
        assert_eq!(auto.step(input(Seen::Away, 4000, Shape::Card)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 8000, Shape::Card)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 9000, Shape::Card)), AutoAction::Collapse);
    }

    #[test]
    fn unsure_readings_never_change_anything() {
        let mut auto = AutoShow::default();
        // 처음부터 모르면 아무 일도 없다 — 아무리 오래 지나도.
        for now in [0, 10_000, 1_000_000] {
            assert_eq!(auto.step(input(Seen::Unsure, now, Shape::Card)), AutoAction::Keep);
        }
        // 떠난 뒤 모르게 됐다: 시간이 차도 모르는 동안에는 접지 않는다.
        assert_eq!(auto.step(input(Seen::Away, 2_000_000, Shape::Card)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Unsure, 2_010_000, Shape::Card)), AutoAction::Keep);
        // 다시 「아니다」로 읽히면 그때 접는다(떠난 시각부터 센다).
        assert_eq!(auto.step(input(Seen::Away, 2_011_000, Shape::Card)), AutoAction::Collapse);
        // 접어 둔 뒤 모르게 돼도 되돌리지 않는다 — 이상 개체 화면을 봤을 때만 되돌린다.
        assert_eq!(auto.step(input(Seen::Unsure, 2_012_000, Shape::Collapsed)), AutoAction::Keep);
        assert_eq!(
            auto.step(input(Seen::Anomaly, 2_013_000, Shape::Collapsed)),
            AutoAction::Restore(Shape::Card)
        );
    }

    #[test]
    fn a_pinned_widget_is_left_alone() {
        let mut auto = AutoShow::default();
        let pinned = |now| AutoInput {
            pinned: true,
            ..input(Seen::Away, now, Shape::Card)
        };
        for now in [0, 6000, 600_000] {
            assert_eq!(auto.step(pinned(now)), AutoAction::Keep);
        }
        // 고정을 풀면 그때부터 센다(풀자마자 접히지 않는다).
        assert_eq!(auto.step(input(Seen::Away, 600_001, Shape::Card)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 605_000, Shape::Card)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 605_001, Shape::Card)), AutoAction::Collapse);
    }

    #[test]
    fn stay_never_acts_and_hide_rests_then_wakes() {
        let mut auto = AutoShow::default();
        let stay = |now| AutoInput {
            leave: Leave::Stay,
            ..input(Seen::Away, now, Shape::Card)
        };
        assert_eq!(auto.step(stay(0)), AutoAction::Keep);
        assert_eq!(auto.step(stay(100_000)), AutoAction::Keep);

        let mut auto = AutoShow::default();
        let hide = |seen, now| AutoInput {
            leave: Leave::Hide,
            ..input(seen, now, Shape::Expanded)
        };
        assert_eq!(auto.step(hide(Seen::Away, 0)), AutoAction::Keep);
        assert!(!auto.is_resting());
        assert_eq!(auto.step(hide(Seen::Away, 5000)), AutoAction::Rest);
        assert!(auto.is_resting());
        assert_eq!(auto.step(hide(Seen::Away, 50_000)), AutoAction::Keep);
        assert_eq!(auto.step(hide(Seen::Unsure, 51_000)), AutoAction::Keep);
        assert!(auto.is_resting(), "모르는 동안에는 깨우지도 않는다");
        assert_eq!(auto.step(hide(Seen::Anomaly, 52_000)), AutoAction::Wake);
        assert!(!auto.is_resting());
        // 모양은 건드리지 않았다(쉬기 전 모양 그대로 다시 뜬다).
        assert_eq!(auto.step(hide(Seen::Anomaly, 53_000)), AutoAction::Keep);
    }

    #[test]
    fn a_widget_the_user_collapsed_is_not_restored() {
        let mut auto = AutoShow::default();
        // 사용자가 이미 접어 둔 채 떠났다: 접을 것이 없다.
        assert_eq!(auto.step(input(Seen::Away, 0, Shape::Collapsed)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 9000, Shape::Collapsed)), AutoAction::Keep);
        // 돌아와도 펴지 않는다.
        assert_eq!(auto.step(input(Seen::Anomaly, 10_000, Shape::Collapsed)), AutoAction::Keep);
    }

    #[test]
    fn touching_the_widget_while_away_makes_the_rule_back_off_until_the_next_visit() {
        // 접힌 뒤 사용자가 손으로 폈다: 다시 접지 않고, 돌아와도 되돌리지 않는다.
        let mut auto = AutoShow::default();
        assert_eq!(auto.step(input(Seen::Away, 0, Shape::Card)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 5000, Shape::Card)), AutoAction::Collapse);
        auto.touched();
        assert_eq!(auto.step(input(Seen::Away, 100_000, Shape::Expanded)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Anomaly, 101_000, Shape::Expanded)), AutoAction::Keep);
        // 다음에 떠나면 다시 일한다.
        assert_eq!(auto.step(input(Seen::Away, 102_000, Shape::Expanded)), AutoAction::Keep);
        assert_eq!(auto.step(input(Seen::Away, 107_000, Shape::Expanded)), AutoAction::Collapse);

        // 시간이 차기 전에 손댔어도 이번에는 접지 않는다.
        let mut auto = AutoShow::default();
        assert_eq!(auto.step(input(Seen::Away, 0, Shape::Card)), AutoAction::Keep);
        auto.touched();
        assert_eq!(auto.step(input(Seen::Away, 50_000, Shape::Expanded)), AutoAction::Keep);

        // 쉬는 창을 사용자가 다시 띄웠다: 쉬는 것이 아니게 되고, 돌아와도 따로 깨우지 않는다.
        let mut auto = AutoShow::default();
        let hide = |seen, now| AutoInput {
            leave: Leave::Hide,
            ..input(seen, now, Shape::Card)
        };
        auto.step(hide(Seen::Away, 0));
        assert_eq!(auto.step(hide(Seen::Away, 5000)), AutoAction::Rest);
        auto.touched();
        assert!(!auto.is_resting());
        assert_eq!(auto.step(hide(Seen::Away, 60_000)), AutoAction::Keep);
        assert_eq!(auto.step(hide(Seen::Anomaly, 61_000)), AutoAction::Keep);
    }

    #[test]
    fn a_collapse_the_user_undid_and_redid_is_not_restored_to_a_stale_shape() {
        let mut auto = AutoShow::default();
        auto.step(input(Seen::Away, 0, Shape::Expanded));
        assert_eq!(auto.step(input(Seen::Away, 5000, Shape::Expanded)), AutoAction::Collapse);
        // 사용자가 손대지 않았는데 모양이 접힘이 아니다(다른 길로 바뀌었다): 되돌리지 않는다.
        assert_eq!(auto.step(input(Seen::Anomaly, 6000, Shape::Card)), AutoAction::Keep);
    }

    #[test]
    fn turning_tracking_off_wakes_a_resting_widget() {
        let mut auto = AutoShow::default();
        let hide = |now| AutoInput {
            leave: Leave::Hide,
            ..input(Seen::Away, now, Shape::Card)
        };
        auto.step(hide(0));
        auto.step(hide(5000));
        assert!(auto.is_resting());
        assert!(auto.release(), "쉬던 창은 다시 보여야 한다");
        assert_eq!(auto, AutoShow::default());
        // 쉬고 있지 않았으면 할 일이 없다.
        assert!(!auto.release());
        let mut collapsed = AutoShow::default();
        collapsed.step(input(Seen::Away, 0, Shape::Card));
        collapsed.step(input(Seen::Away, 5000, Shape::Card));
        assert!(!collapsed.release());
    }

    // ── 창 크기 ──

    #[test]
    fn the_window_is_fitted_to_the_measured_widget() {
        assert_eq!(fit_size(380.0, 64.0, 1.0), Some((380, 64)));
        // 배율이 있는 화면: 물리 픽셀로, 소수는 올린다.
        assert_eq!(fit_size(380.0, 64.0, 1.5), Some((570, 96)));
        assert_eq!(fit_size(200.3, 40.2, 1.0), Some((201, 41)));
        assert_eq!(fit_size(200.3, 40.2, 1.25), Some((251, 51)));
    }

    #[test]
    fn absurd_sizes_are_clamped_and_unusable_ones_are_ignored() {
        assert_eq!(fit_size(5.0, 5.0, 1.0), Some((64, 24)));
        assert_eq!(fit_size(10_000.0, 10_000.0, 1.0), Some((760, 760)));
        for (w, h, s) in [
            (0.0, 50.0, 1.0),
            (50.0, 0.0, 1.0),
            (-3.0, 50.0, 1.0),
            (f64::NAN, 50.0, 1.0),
            (50.0, f64::INFINITY, 1.0),
            (50.0, 50.0, 0.0),
            (50.0, 50.0, f64::NAN),
        ] {
            assert_eq!(fit_size(w, h, s), None, "{w} {h} {s}");
        }
    }

    // ── 자리 ──

    const SCREEN: ScreenRect = ScreenRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn the_anchor_corner_is_the_nearest_one() {
        let game = rect(100, 100, 1600, 900);
        assert_eq!(nearest_corner(game, rect(120, 120, 300, 60)), Corner::TopLeft);
        assert_eq!(nearest_corner(game, rect(1300, 120, 300, 60)), Corner::TopRight);
        assert_eq!(nearest_corner(game, rect(120, 900, 300, 60)), Corner::BottomLeft);
        assert_eq!(nearest_corner(game, rect(1300, 900, 300, 60)), Corner::BottomRight);
        for corner in [Corner::TopLeft, Corner::TopRight, Corner::BottomLeft, Corner::BottomRight] {
            assert_eq!(Corner::parse(corner.key()), Some(corner));
        }
        assert_eq!(Corner::parse("middle"), None);
    }

    #[test]
    fn a_spot_keeps_its_corner_when_the_widget_changes_size() {
        // 오른쪽 위에 끌어 둔 위젯: 오른쪽 위 모서리 점을 기억한다.
        let dropped = rect(1500, 30, 380, 64);
        let spot = Spot::of(Some(SCREEN), dropped);
        assert_eq!(spot, Spot { corner: Corner::TopRight, x: 1880, y: 30 });
        assert_eq!(spot.position((380, 64)), (1500, 30));
        // 펼치면 왼쪽·아래로 자란다 — 오른쪽 위 모서리는 제자리다.
        assert_eq!(spot.position((380, 300)), (1500, 30));
        assert_eq!(spot.position((200, 40)), (1680, 30));
        // 왼쪽 아래에 둔 위젯은 위로 자란다.
        let low = Spot::of(Some(SCREEN), rect(20, 900, 380, 64));
        assert_eq!(low.corner, Corner::BottomLeft);
        assert_eq!(low.position((380, 300)), (20, 664));
        // 모니터를 모르면 오른쪽 위 모서리로 친다.
        assert_eq!(Spot::of(None, dropped).corner, Corner::TopRight);
    }

    #[test]
    fn an_anchor_follows_the_game_window_and_survives_its_resize() {
        let game = rect(100, 100, 1600, 900);
        // 처음 붙일 때: 오른쪽 위 안쪽으로 12.
        let first = Anchor::inside_top_right(12);
        assert_eq!(first.position(game, (380, 64)), (100 + 1600 - 12 - 380, 112));
        // 사용자가 게임 화면의 왼쪽 아래로 끌어 뒀다.
        let dropped = rect(130, 900, 380, 64);
        let anchor = Anchor::of(game, dropped);
        assert_eq!(anchor, Anchor { corner: Corner::BottomLeft, dx: 30, dy: -36 });
        assert_eq!(anchor.position(game, (380, 64)), (130, 900));
        // 게임 창을 옮기면 같은 거리로 따라간다.
        assert_eq!(anchor.position(rect(-1800, 50, 1600, 900), (380, 64)), (-1770, 850));
        // 게임 창 크기가 바뀌어도 그 모서리에서의 거리는 같다.
        assert_eq!(anchor.position(rect(100, 100, 1280, 720), (380, 64)), (130, 720));
        // 위젯이 커지면 그 모서리에서 위로 자란다.
        assert_eq!(anchor.position(game, (380, 300)), (130, 664));
        // 게임 화면 밖에 끌어 둔 자리도 기억한다(왼쪽 바깥).
        let outside = Anchor::of(game, rect(-300, 150, 380, 64));
        assert_eq!(outside.corner, Corner::TopLeft);
        assert_eq!(outside.position(game, (380, 64)), (-300, 150));
    }

    #[test]
    fn a_window_outside_the_screen_is_brought_back_inside() {
        let areas = [SCREEN];
        // 안에 있으면 그대로다.
        assert_eq!(clamp_into((100, 100), (380, 64), &areas), (100, 100));
        // 오른쪽·아래로 삐져나갔다.
        assert_eq!(clamp_into((1800, 1000), (380, 64), &areas), (1540, 976));
        // 왼쪽·위로 삐져나갔다.
        assert_eq!(clamp_into((-50, -20), (380, 64), &areas), (0, 0));
        // 통째로 밖에 있다(모니터를 뺐다): 가장 가까운 모니터 안으로.
        assert_eq!(clamp_into((5000, 300), (380, 64), &areas), (1540, 300));
        // 창이 모니터보다 크면 왼쪽 위에 맞춘다.
        assert_eq!(clamp_into((50, 50), (4000, 3000), &areas), (0, 0));
        // 모니터를 모르면 바꾸지 않는다.
        assert_eq!(clamp_into((5000, 300), (380, 64), &[]), (5000, 300));
        assert_eq!(clamp_into((5000, 300), (380, 64), &[rect(0, 0, 0, 0)]), (5000, 300));
    }

    #[test]
    fn the_monitor_the_window_overlaps_most_wins() {
        // 왼쪽 보조 모니터(음수 좌표)와 주 모니터.
        let areas = [rect(-1920, 0, 1920, 1040), SCREEN];
        // 대부분 왼쪽 모니터에 있다: 왼쪽 모니터 안으로.
        assert_eq!(clamp_into((-300, 100), (380, 64), &areas), (-380, 100));
        // 대부분 주 모니터에 있다.
        assert_eq!(clamp_into((-80, 100), (380, 64), &areas), (0, 100));
        // 왼쪽 모니터의 위로 나갔다.
        assert_eq!(clamp_into((-1000, -500), (380, 64), &areas), (-1000, 0));
    }

    // ── 기억해 두는 것 ──

    #[test]
    fn stored_settings_round_trip() {
        let stored = Stored {
            prefs: Prefs {
                scale_percent: 120,
                opacity_percent: 80,
                leave: Leave::Hide,
                leave_after_sec: 15,
                default_shape: Shape::Collapsed,
                click_through: true,
            },
            pinned: true,
            spot: Some(Spot { corner: Corner::BottomRight, x: 1900, y: 1000 }),
            anchor: Some(Anchor { corner: Corner::TopLeft, dx: -40, dy: 12 }),
        };
        let doc = stored.to_value();
        assert_eq!(doc["kind"], STORED_KIND);
        assert_eq!(doc["schema_version"], STORED_SCHEMA_VERSION);
        assert_eq!(Stored::from_value(&doc).unwrap(), stored);
        // 자리가 없는 것도 그대로 돌아온다.
        let plain = Stored::default();
        assert_eq!(Stored::from_value(&plain.to_value()).unwrap(), plain);
        assert!(plain.to_value()["spot"].is_null());
    }

    #[test]
    fn a_stored_document_of_another_kind_or_version_is_refused_in_korean() {
        let mut doc = Stored::default().to_value();
        doc["schema_version"] = json!(2);
        assert!(has_korean(&Stored::from_value(&doc).unwrap_err()));
        let mut doc = Stored::default().to_value();
        doc["kind"] = json!("companion_state");
        assert!(Stored::from_value(&doc).is_err());
        assert!(Stored::from_value(&json!([])).is_err());
        // 설정의 낱말이 틀렸다.
        let mut doc = Stored::default().to_value();
        doc["prefs"]["leave"] = json!("vanish");
        assert!(has_korean(&Stored::from_value(&doc).unwrap_err()));
    }

    #[test]
    fn an_unreadable_position_is_dropped_but_the_settings_stay() {
        let mut doc = Stored {
            prefs: Prefs { scale_percent: 130, ..Prefs::default() },
            pinned: true,
            spot: Some(Spot { corner: Corner::TopLeft, x: 1, y: 2 }),
            anchor: Some(Anchor { corner: Corner::TopLeft, dx: 3, dy: 4 }),
        }
        .to_value();
        doc["spot"]["corner"] = json!("middle");
        doc["anchor"]["dx"] = json!("far");
        let read = Stored::from_value(&doc).unwrap();
        assert_eq!(read.spot, None);
        assert_eq!(read.anchor, None);
        assert_eq!(read.prefs.scale_percent, 130);
        assert!(read.pinned);
        // 설정 칸이 없는 옛 문서는 기본 설정이다.
        let bare = json!({ "schema_version": 1, "kind": STORED_KIND });
        assert_eq!(Stored::from_value(&bare).unwrap(), Stored::default());
    }
}
