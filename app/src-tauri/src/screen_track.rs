//! 요격전 화면 자동 추적의 규칙: 언제 게임 화면을 읽고(캡처하고) 언제 읽지 않는지, 읽은 결과를 어떤 상태로
//! 화면에 알리는지. 창·캡처 API를 모른다 — 값만 받아 판단한다. 실제로 읽는 일은 `lib.rs`의 추적 스레드가 한다.
//!
//! 규칙:
//! - **읽는 조건**: 자동 추적이 켜져 있고, 오버레이가 보이고, 게임 창이 떠 있을 때만(찾았고 최소화되지 않았다) 읽는다.
//!   꺼져 있거나, 오버레이가 숨겨져 있거나, 게임이 없거나(런처만 떠 있는 것 포함), 최소화돼 있으면 캡처하지 않는다
//!   (`overlay_gate`·`game_gate`).
//! - **실패는 상태다**: 캡처가 실패해도 오류를 쌓지 않는다. 상태 하나(`failed`)와 연속 실패 횟수만 남기고 다음 주기에
//!   다시 본다 — 게임이 다시 뜨면 스스로 이어진다.
//! - **바뀔 때만 알린다**: 화면에 보내는 이벤트는 결과(켜짐·주기·상태·이유·화면 종류·보스)가 바뀔 때만 나간다
//!   (`Tracker::observe`·`configure`가 `true`를 돌려줄 때). 읽은 시각·걸린 시간·근거 문장의 수치·연속 실패 횟수만
//!   달라진 것은 알리지 않는다 — 화면이 필요할 때 상태 명령으로 물어본다.
//! - 인식 결과에 따라 **어느 보스를 보일지**(따라가기)는 화면 쪽 규칙이다(`app/src/lib/screenTrack.ts`의 `followStep`).
//!   여기서는 읽은 것을 그대로 알릴 뿐이다.
//!
//! 캡처한 이미지는 여기까지 오지 않는다 — 인식 결과(`Recognition`: 화면 종류·보스·근거 문장)만 온다.

use serde::Serialize;

use crate::game_window::{GameError, GameWindowInfo, GameWindowState, GameWindowStatus};
use crate::recognize::{Boss, Recognition, ScreenKind};

/// 게임 화면을 읽는 주기의 기본값(밀리초).
pub const DEFAULT_INTERVAL_MS: u64 = 2000;
/// 주기의 하한. 이보다 짧게는 읽지 않는다(캡처 한 번이 수십 ms다 — `app/README.md` §자동 추적 §걸리는 시간).
pub const MIN_INTERVAL_MS: u64 = 500;
/// 주기의 상한.
pub const MAX_INTERVAL_MS: u64 = 60_000;

/// 화면이 준 주기를 쓸 수 있는 값으로 맞춘다. 주지 않았으면 기본값.
pub fn clamp_interval(interval_ms: Option<u64>) -> u64 {
    interval_ms
        .unwrap_or(DEFAULT_INTERVAL_MS)
        .clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS)
}

/// 자동 추적 설정. 화면이 정한다(스위치와 주기).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrackSettings {
    pub enabled: bool,
    pub interval_ms: u64,
}

impl TrackSettings {
    /// 화면이 준 값으로 만든다. 주기는 범위 안으로 맞춘다.
    pub fn new(enabled: bool, interval_ms: Option<u64>) -> Self {
        Self {
            enabled,
            interval_ms: clamp_interval(interval_ms),
        }
    }
}

impl Default for TrackSettings {
    /// 기본: 꺼짐, 2초.
    fn default() -> Self {
        Self::new(false, None)
    }
}

/// 추적 상태. 화면에 그대로 넘긴다(프런트의 `ScreenTrackState`와 같아야 한다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackState {
    /// 자동 추적이 꺼져 있다.
    Off,
    /// 켰고 아직 한 번도 읽지 않았다.
    Starting,
    /// 게임 화면을 읽어 인식했다(`recognition`이 있다 — `unknown`·`other`도 읽은 것이다).
    Read,
    /// 오버레이가 숨겨져 있어 읽지 않는다.
    OverlayHidden,
    /// 게임이 실행 중이 아니다(런처만 떠 있는 것 포함).
    NoGame,
    /// 게임 창이 최소화돼 있다.
    Minimized,
    /// 읽으려 했지만 실패했다(창 정보 읽기·캡처 오류). 다음 주기에 다시 본다.
    Failed,
}

/// 캡처하지 않는 이유.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pause {
    /// 자동 추적이 꺼져 있다.
    Off,
    /// 오버레이가 숨겨져 있다.
    OverlayHidden,
    /// 게임이 실행 중이 아니다.
    NoGame,
    /// 런처만 떠 있다.
    LauncherOnly,
    /// 게임 창이 최소화돼 있다.
    Minimized,
}

impl Pause {
    pub fn state(self) -> TrackState {
        match self {
            Self::Off => TrackState::Off,
            Self::OverlayHidden => TrackState::OverlayHidden,
            Self::NoGame | Self::LauncherOnly => TrackState::NoGame,
            Self::Minimized => TrackState::Minimized,
        }
    }

    /// 화면에 보일 이유(한국어 한 줄).
    pub fn message(self) -> String {
        match self {
            Self::Off => "자동 추적이 꺼져 있다".to_string(),
            Self::OverlayHidden => "오버레이가 숨겨져 있어 게임 화면을 읽지 않는다".to_string(),
            Self::NoGame => GameError::NotRunning.to_string(),
            Self::LauncherOnly => GameError::LauncherOnly.to_string(),
            Self::Minimized => {
                "게임 창이 최소화돼 있어 읽지 않는다(이 앱은 게임 창을 건드리지 않는다)".to_string()
            }
        }
    }
}

/// 설정과 오버레이만 보고: 게임 창을 찾아볼 차례인가. 꺼져 있거나 오버레이가 숨겨져 있으면 아니다.
pub fn overlay_gate(enabled: bool, overlay_visible: bool) -> Result<(), Pause> {
    if !enabled {
        Err(Pause::Off)
    } else if !overlay_visible {
        Err(Pause::OverlayHidden)
    } else {
        Ok(())
    }
}

/// 게임 창 상태를 보고: 캡처할 창을 돌려주거나, 캡처하지 않고 알릴 것(`Reading`)을 돌려준다.
/// 게임 없음·런처만·최소화는 캡처하지 않는 이유이고, 창을 읽지 못한 것은 실패다.
pub fn game_gate(status: &GameWindowStatus) -> Result<&GameWindowInfo, Reading> {
    match status.state {
        GameWindowState::Found => status.window.as_ref().ok_or_else(|| Reading::Failed {
            message: "게임 창을 찾았지만 창 정보가 없다".to_string(),
        }),
        GameWindowState::Minimized => Err(Reading::Paused(Pause::Minimized)),
        GameWindowState::LauncherOnly => Err(Reading::Paused(Pause::LauncherOnly)),
        GameWindowState::Missing => Err(Reading::Paused(Pause::NoGame)),
        GameWindowState::Unavailable => Err(Reading::Failed {
            message: status.message.clone(),
        }),
    }
}

/// 캡처해도 되는가(세 조건을 한 번에). 추적 스레드는 `overlay_gate` → 게임 창 읽기 → `game_gate` 순으로 부른다 —
/// 이 함수는 같은 규칙을 값만으로 확인할 때 쓴다.
pub fn may_capture(enabled: bool, overlay_visible: bool, game: GameWindowState) -> bool {
    overlay_gate(enabled, overlay_visible).is_ok() && game == GameWindowState::Found
}

/// 캡처 오류를 알릴 것으로 바꾼다. 캡처하는 사이에 게임이 꺼지거나 최소화된 것은 실패가 아니라 읽지 않는 이유다.
pub fn reading_from_error(error: &GameError) -> Reading {
    match error {
        GameError::NotRunning => Reading::Paused(Pause::NoGame),
        GameError::LauncherOnly => Reading::Paused(Pause::LauncherOnly),
        GameError::Minimized => Reading::Paused(Pause::Minimized),
        // 저장용 캡처(단축키·단추)가 돌고 있다 — 이번 주기만 건너뛴다.
        GameError::Busy => Reading::Busy,
        other => Reading::Failed {
            message: other.to_string(),
        },
    }
}

/// 추적 스레드가 한 주기에 알아낸 것.
#[derive(Debug, Clone, PartialEq)]
pub enum Reading {
    /// 캡처하지 않았다.
    Paused(Pause),
    /// 캡처해 인식했다. `capture_ms`는 캡처 한 번에 걸린 시간(창 찍기 + 인식).
    Recognized {
        recognition: Recognition,
        capture_ms: u32,
    },
    /// 읽으려 했지만 실패했다.
    Failed { message: String },
    /// 다른 캡처가 돌고 있어 이번 주기를 건너뛰었다. 상태를 바꾸지 않는다.
    Busy,
}

/// 화면에 넘기는 추적 상태. 프런트의 `ScreenTrackStatus`(src/types.ts)와 같아야 한다. 이미지는 없다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TrackStatus {
    /// 자동 추적이 켜져 있는가.
    pub enabled: bool,
    /// 게임 화면을 읽는 주기(밀리초).
    pub interval_ms: u64,
    pub state: TrackState,
    /// 지금 상태를 설명하는 한국어 한 줄(읽지 않는 이유, 실패 원인, 인식한 화면).
    pub message: String,
    /// 방금 읽은 화면의 인식 결과. `state`가 `read`일 때만 있다.
    pub recognition: Option<Recognition>,
    /// 마지막으로 게임 화면을 읽은 시각(UTC, ISO 8601). 켠 뒤로 한 번도 읽지 못했으면 null.
    pub read_at: Option<String>,
    /// 마지막 읽기에서 캡처 한 번에 걸린 시간(밀리초).
    pub capture_ms: Option<u32>,
    /// 연속으로 실패한 횟수. 읽기에 성공하거나 읽지 않는 상태가 되면 0.
    pub failures: u32,
}

impl TrackStatus {
    fn off(interval_ms: u64) -> Self {
        Self {
            enabled: false,
            interval_ms,
            state: TrackState::Off,
            message: Pause::Off.message(),
            recognition: None,
            read_at: None,
            capture_ms: None,
            failures: 0,
        }
    }

    /// 읽은 화면: 화면 종류와 보스. 읽지 않았으면 `None`.
    fn seen(&self) -> Option<(ScreenKind, Option<Boss>)> {
        self.recognition.as_ref().map(|r| (r.screen, r.boss))
    }

    /// 결과가 같은가(화면에 다시 알릴 필요가 없는가). 가르는 값은 켜짐·주기·상태·이유·화면 종류·보스다.
    /// 읽은 시각·걸린 시간·신뢰도·근거 문장·연속 실패 횟수는 달라도 같은 결과다.
    pub fn same_result(&self, other: &Self) -> bool {
        self.enabled == other.enabled
            && self.interval_ms == other.interval_ms
            && self.state == other.state
            && self.message == other.message
            && self.seen() == other.seen()
    }
}

/// 인식 결과를 설명하는 한 줄.
pub fn describe(recognition: &Recognition) -> String {
    let boss = recognition.boss.map(|b| b.name());
    match (recognition.screen, boss) {
        (ScreenKind::AnomalySelect, Some(name)) => format!("이상 개체 요격전 보스 선택 화면 — {name}"),
        (ScreenKind::AnomalySquad, Some(name)) => format!("이상 개체 요격전 편성 화면 — {name}"),
        (ScreenKind::AnomalySelect | ScreenKind::AnomalySquad, None) => {
            "이상 개체 요격전 화면이지만 보스를 알아보지 못했다".to_string()
        }
        (ScreenKind::Other, _) => "이상 개체 요격전 화면이 아니다".to_string(),
        (ScreenKind::Unknown, _) => "화면을 알아보지 못했다".to_string(),
    }
}

/// 추적 상태를 쥐고, 설정 변경과 읽은 결과를 반영한다. 화면에 알려야 할 때만 `true`를 돌려준다.
#[derive(Debug, Clone, PartialEq)]
pub struct Tracker {
    status: TrackStatus,
}

impl Default for Tracker {
    fn default() -> Self {
        Self {
            status: TrackStatus::off(DEFAULT_INTERVAL_MS),
        }
    }
}

impl Tracker {
    pub fn status(&self) -> &TrackStatus {
        &self.status
    }

    /// 설정을 반영한다. 켜면 「읽는 중」으로, 끄면 「꺼짐」으로 가고 앞서 읽은 것은 지운다.
    /// 화면에 알려야 하면(켜짐·주기가 바뀌었으면) `true`.
    pub fn configure(&mut self, settings: TrackSettings) -> bool {
        let mut next = self.status.clone();
        next.interval_ms = clamp_interval(Some(settings.interval_ms));
        if settings.enabled != self.status.enabled {
            next = if settings.enabled {
                TrackStatus {
                    enabled: true,
                    state: TrackState::Starting,
                    message: "게임 화면을 읽는 중이다".to_string(),
                    ..TrackStatus::off(next.interval_ms)
                }
            } else {
                TrackStatus::off(next.interval_ms)
            };
        }
        self.replace(next)
    }

    /// 한 주기에 알아낸 것을 반영한다. `at`은 지금 시각(UTC, ISO 8601).
    /// 결과가 바뀌어 화면에 알려야 하면 `true`. 꺼져 있는 동안 온 것은 버린다(끄는 순간 돌고 있던 읽기).
    pub fn observe(&mut self, reading: Reading, at: &str) -> bool {
        if !self.status.enabled {
            return false;
        }
        let mut next = self.status.clone();
        match reading {
            Reading::Busy => return false,
            // 꺼짐은 설정으로만 간다. 켜져 있는데 「꺼짐」이 오면(끄는 순간의 경합) 버린다.
            Reading::Paused(Pause::Off) => return false,
            Reading::Paused(pause) => {
                next.state = pause.state();
                next.message = pause.message();
                next.recognition = None;
                next.failures = 0;
            }
            Reading::Failed { message } => {
                next.state = TrackState::Failed;
                next.message = message;
                next.recognition = None;
                next.failures = self.status.failures.saturating_add(1);
            }
            Reading::Recognized {
                recognition,
                capture_ms,
            } => {
                next.state = TrackState::Read;
                next.message = describe(&recognition);
                next.recognition = Some(recognition);
                next.read_at = Some(at.to_string());
                next.capture_ms = Some(capture_ms);
                next.failures = 0;
            }
        }
        self.replace(next)
    }

    fn replace(&mut self, next: TrackStatus) -> bool {
        let changed = !self.status.same_result(&next);
        self.status = next;
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_window::ScreenRect;

    const T1: &str = "2026-11-12T05:00:00.000Z";
    const T2: &str = "2026-11-12T05:00:02.000Z";
    const T3: &str = "2026-11-12T05:00:04.000Z";

    fn recognition(screen: ScreenKind, boss: Option<Boss>) -> Recognition {
        Recognition {
            screen,
            boss,
            confidence: if boss.is_some() { 0.9 } else { 0.0 },
            evidence: vec!["아래 띠 주황 100%".to_string()],
            width: 1881,
            height: 1058,
        }
    }

    fn read(screen: ScreenKind, boss: Option<Boss>) -> Reading {
        Reading::Recognized {
            recognition: recognition(screen, boss),
            capture_ms: 40,
        }
    }

    fn on() -> Tracker {
        let mut tracker = Tracker::default();
        assert!(tracker.configure(TrackSettings::new(true, None)));
        tracker
    }

    fn window(minimized: bool) -> GameWindowInfo {
        GameWindowInfo {
            hwnd: 1,
            pid: 2,
            process_name: "nikke.exe".to_string(),
            title: "NIKKE".to_string(),
            client: ScreenRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            frame: ScreenRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            minimized,
            foreground: false,
            scale_factor: 1.0,
        }
    }

    #[test]
    fn the_default_is_off_with_a_two_second_interval() {
        let settings = TrackSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.interval_ms, 2000);
        let tracker = Tracker::default();
        assert_eq!(tracker.status().state, TrackState::Off);
        assert!(!tracker.status().enabled);
        assert_eq!(tracker.status().interval_ms, DEFAULT_INTERVAL_MS);
        assert_eq!(tracker.status().recognition, None);
        assert_eq!(tracker.status().read_at, None);
    }

    #[test]
    fn the_interval_is_kept_inside_its_range() {
        assert_eq!(clamp_interval(None), 2000);
        assert_eq!(clamp_interval(Some(3000)), 3000);
        assert_eq!(clamp_interval(Some(0)), MIN_INTERVAL_MS);
        assert_eq!(clamp_interval(Some(1)), MIN_INTERVAL_MS);
        assert_eq!(clamp_interval(Some(u64::MAX)), MAX_INTERVAL_MS);
        assert_eq!(TrackSettings::new(true, Some(10)).interval_ms, MIN_INTERVAL_MS);
    }

    #[test]
    fn it_captures_only_when_enabled_visible_and_the_game_window_is_up() {
        use GameWindowState::{Found, LauncherOnly, Minimized, Missing, Unavailable};
        // 여덟 조합 × 게임 상태 다섯: 캡처하는 것은 (켜짐, 보임, 찾음) 하나뿐이다.
        for enabled in [false, true] {
            for visible in [false, true] {
                for game in [Found, Minimized, LauncherOnly, Missing, Unavailable] {
                    assert_eq!(
                        may_capture(enabled, visible, game),
                        enabled && visible && game == Found,
                        "{enabled} {visible} {game:?}"
                    );
                }
            }
        }
        assert_eq!(overlay_gate(false, true), Err(Pause::Off));
        // 꺼져 있으면 오버레이가 숨겨져 있어도 이유는 「꺼짐」이다.
        assert_eq!(overlay_gate(false, false), Err(Pause::Off));
        assert_eq!(overlay_gate(true, false), Err(Pause::OverlayHidden));
        assert_eq!(overlay_gate(true, true), Ok(()));
    }

    #[test]
    fn the_game_gate_hands_over_the_window_or_says_why_not() {
        let found = GameWindowStatus::from_window(window(false));
        assert_eq!(game_gate(&found).map(|w| w.hwnd), Ok(1));

        let minimized = GameWindowStatus::from_window(window(true));
        assert_eq!(game_gate(&minimized), Err(Reading::Paused(Pause::Minimized)));

        let missing = GameWindowStatus::from_error(&GameError::NotRunning);
        assert_eq!(game_gate(&missing), Err(Reading::Paused(Pause::NoGame)));

        let launcher = GameWindowStatus::from_error(&GameError::LauncherOnly);
        assert_eq!(game_gate(&launcher), Err(Reading::Paused(Pause::LauncherOnly)));

        // 창을 읽지 못한 것은 실패로 알린다(문장 그대로).
        let unavailable = GameWindowStatus::from_error(&GameError::Unsupported);
        assert_eq!(
            game_gate(&unavailable),
            Err(Reading::Failed {
                message: GameError::Unsupported.to_string()
            })
        );
    }

    #[test]
    fn pauses_map_to_states_and_korean_reasons() {
        assert_eq!(Pause::Off.state(), TrackState::Off);
        assert_eq!(Pause::OverlayHidden.state(), TrackState::OverlayHidden);
        assert_eq!(Pause::NoGame.state(), TrackState::NoGame);
        assert_eq!(Pause::LauncherOnly.state(), TrackState::NoGame);
        assert_eq!(Pause::Minimized.state(), TrackState::Minimized);
        assert!(Pause::NoGame.message().contains("게임 창을 찾을 수 없다"));
        assert!(Pause::LauncherOnly.message().contains("런처"));
        assert!(Pause::Minimized.message().contains("최소화"));
        assert!(Pause::OverlayHidden.message().contains("숨겨져"));
    }

    #[test]
    fn capture_errors_become_pauses_or_failures() {
        assert_eq!(
            reading_from_error(&GameError::NotRunning),
            Reading::Paused(Pause::NoGame)
        );
        assert_eq!(
            reading_from_error(&GameError::LauncherOnly),
            Reading::Paused(Pause::LauncherOnly)
        );
        assert_eq!(
            reading_from_error(&GameError::Minimized),
            Reading::Paused(Pause::Minimized)
        );
        assert_eq!(reading_from_error(&GameError::Busy), Reading::Busy);
        assert_eq!(
            reading_from_error(&GameError::EmptyClient),
            Reading::Failed {
                message: GameError::EmptyClient.to_string()
            }
        );
    }

    #[test]
    fn turning_it_on_and_off_is_reported_and_clears_what_was_read() {
        let mut tracker = Tracker::default();
        // 꺼져 있는 것을 다시 꺼도 알릴 것이 없다.
        assert!(!tracker.configure(TrackSettings::new(false, None)));

        assert!(tracker.configure(TrackSettings::new(true, None)));
        assert_eq!(tracker.status().state, TrackState::Starting);
        assert!(tracker.status().enabled);
        // 켜져 있는 것을 같은 설정으로 다시 켜도 알릴 것이 없다.
        assert!(!tracker.configure(TrackSettings::new(true, None)));

        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));
        assert!(tracker.configure(TrackSettings::new(false, None)));
        let status = tracker.status();
        assert_eq!(status.state, TrackState::Off);
        assert_eq!(status.recognition, None);
        assert_eq!(status.read_at, None);
        assert_eq!(status.message, "자동 추적이 꺼져 있다");
    }

    #[test]
    fn changing_only_the_interval_is_reported_and_keeps_the_reading() {
        let mut tracker = on();
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));
        assert!(tracker.configure(TrackSettings::new(true, Some(5000))));
        let status = tracker.status();
        assert_eq!(status.interval_ms, 5000);
        assert_eq!(status.state, TrackState::Read);
        assert_eq!(status.recognition.as_ref().and_then(|r| r.boss), Some(Boss::Kraken));
        assert_eq!(status.read_at.as_deref(), Some(T1));
    }

    #[test]
    fn a_reading_is_reported_once_and_not_again_while_it_stays_the_same() {
        let mut tracker = on();
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));
        let first = tracker.status().clone();
        assert_eq!(first.state, TrackState::Read);
        assert_eq!(first.message, "이상 개체 요격전 보스 선택 화면 — 크라켄");
        assert_eq!(first.read_at.as_deref(), Some(T1));
        assert_eq!(first.capture_ms, Some(40));

        // 같은 화면·같은 보스: 알리지 않는다. 읽은 시각과 근거는 최신으로 바뀌어 있다(상태 명령이 돌려준다).
        let mut again = recognition(ScreenKind::AnomalySelect, Some(Boss::Kraken));
        again.confidence = 0.8;
        again.evidence = vec!["아래 띠 주황 97%".to_string()];
        assert!(!tracker.observe(
            Reading::Recognized {
                recognition: again.clone(),
                capture_ms: 55
            },
            T2
        ));
        assert_eq!(tracker.status().read_at.as_deref(), Some(T2));
        assert_eq!(tracker.status().capture_ms, Some(55));
        assert_eq!(tracker.status().recognition, Some(again));
        assert!(tracker.status().same_result(&first));
    }

    #[test]
    fn a_different_boss_or_screen_is_reported() {
        let mut tracker = on();
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));
        // 다른 보스
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Ultra)), T2));
        // 같은 보스의 다른 화면(선택 → 편성)
        assert!(tracker.observe(read(ScreenKind::AnomalySquad, Some(Boss::Ultra)), T3));
        assert_eq!(tracker.status().message, "이상 개체 요격전 편성 화면 — 울트라");
        // 이상 개체 화면이 아님 → 모름
        assert!(tracker.observe(read(ScreenKind::Other, None), T3));
        assert_eq!(tracker.status().message, "이상 개체 요격전 화면이 아니다");
        assert!(!tracker.observe(read(ScreenKind::Other, None), T3));
        assert!(tracker.observe(read(ScreenKind::Unknown, None), T3));
        assert_eq!(tracker.status().message, "화면을 알아보지 못했다");
        assert!(!tracker.observe(read(ScreenKind::Unknown, None), T3));
    }

    #[test]
    fn repeated_failures_are_one_state_with_a_count_not_a_pile_of_errors() {
        let mut tracker = on();
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));
        let failure = || Reading::Failed {
            message: "화면을 캡처하지 못했다(WGC): 2500ms 안에 프레임이 오지 않았다".to_string(),
        };
        assert!(tracker.observe(failure(), T2));
        for _ in 0..9 {
            // 같은 실패가 이어지는 동안에는 알리지 않는다.
            assert!(!tracker.observe(failure(), T3));
        }
        let status = tracker.status();
        assert_eq!(status.state, TrackState::Failed);
        assert_eq!(status.failures, 10);
        assert_eq!(status.recognition, None);
        // 마지막으로 읽은 시각은 성공한 때 그대로다.
        assert_eq!(status.read_at.as_deref(), Some(T1));
        assert!(status.message.contains("프레임이 오지 않았다"));

        // 다른 이유의 실패는 알린다. 횟수는 이어진다.
        assert!(tracker.observe(
            Reading::Failed {
                message: "게임 창의 화면 영역 크기가 0이다".to_string()
            },
            T3
        ));
        assert_eq!(tracker.status().failures, 11);
    }

    #[test]
    fn it_resumes_by_itself_when_the_game_comes_back() {
        let mut tracker = on();
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));

        // 게임이 꺼졌다
        assert!(tracker.observe(Reading::Paused(Pause::NoGame), T2));
        assert!(!tracker.observe(Reading::Paused(Pause::NoGame), T2));
        assert_eq!(tracker.status().state, TrackState::NoGame);
        assert_eq!(tracker.status().recognition, None);
        assert_eq!(tracker.status().failures, 0);

        // 런처만 떴다 — 상태는 같지만 이유가 달라 알린다
        assert!(tracker.observe(Reading::Paused(Pause::LauncherOnly), T2));
        assert_eq!(tracker.status().state, TrackState::NoGame);

        // 게임이 떴지만 최소화돼 있다
        assert!(tracker.observe(Reading::Paused(Pause::Minimized), T2));
        assert_eq!(tracker.status().state, TrackState::Minimized);

        // 캡처가 한 번 실패한 뒤
        assert!(tracker.observe(
            Reading::Failed {
                message: "캡처 실패".to_string()
            },
            T2
        ));
        assert_eq!(tracker.status().failures, 1);

        // 다시 읽힌다 — 같은 보스여도 「읽음」으로 돌아온 것은 알린다.
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T3));
        let status = tracker.status();
        assert_eq!(status.state, TrackState::Read);
        assert_eq!(status.failures, 0);
        assert_eq!(status.read_at.as_deref(), Some(T3));
    }

    #[test]
    fn hiding_the_overlay_pauses_and_showing_it_resumes() {
        let mut tracker = on();
        assert!(tracker.observe(read(ScreenKind::AnomalySquad, Some(Boss::Harvester)), T1));
        assert!(tracker.observe(Reading::Paused(Pause::OverlayHidden), T2));
        assert_eq!(tracker.status().state, TrackState::OverlayHidden);
        assert_eq!(tracker.status().read_at.as_deref(), Some(T1));
        assert!(tracker.observe(read(ScreenKind::AnomalySquad, Some(Boss::Harvester)), T3));
    }

    #[test]
    fn a_busy_cycle_changes_nothing() {
        let mut tracker = on();
        assert!(tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Indivilia)), T1));
        let before = tracker.status().clone();
        assert!(!tracker.observe(Reading::Busy, T2));
        assert_eq!(tracker.status(), &before);
    }

    #[test]
    fn readings_that_arrive_while_off_are_dropped() {
        let mut tracker = Tracker::default();
        assert!(!tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));
        assert_eq!(tracker.status().state, TrackState::Off);
        assert_eq!(tracker.status().recognition, None);

        // 끄는 순간 돌고 있던 읽기가 늦게 와도 「꺼짐」 그대로다.
        let mut tracker = on();
        assert!(tracker.configure(TrackSettings::new(false, None)));
        assert!(!tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1));
        assert!(!tracker.observe(
            Reading::Failed {
                message: "늦게 온 실패".to_string()
            },
            T1
        ));
        assert_eq!(tracker.status().state, TrackState::Off);

        // 켜져 있는데 「꺼짐」이 오면 버린다.
        let mut tracker = on();
        assert!(!tracker.observe(Reading::Paused(Pause::Off), T1));
        assert_eq!(tracker.status().state, TrackState::Starting);
    }

    #[test]
    fn the_status_serializes_the_way_the_screen_reads_it() {
        let mut tracker = on();
        tracker.observe(read(ScreenKind::AnomalySelect, Some(Boss::Kraken)), T1);
        let json = serde_json::to_value(tracker.status()).unwrap();
        assert_eq!(json["enabled"], true);
        assert_eq!(json["interval_ms"], 2000);
        assert_eq!(json["state"], "read");
        assert_eq!(json["message"], "이상 개체 요격전 보스 선택 화면 — 크라켄");
        assert_eq!(json["recognition"]["screen"], "anomaly_select");
        assert_eq!(json["recognition"]["boss"]["id"], "kraken");
        assert_eq!(json["recognition"]["boss"]["name"], "크라켄");
        assert_eq!(json["read_at"], T1);
        assert_eq!(json["capture_ms"], 40);
        assert_eq!(json["failures"], 0);
        // 이미지는 없다: 이 여덟 칸뿐이다.
        assert_eq!(json.as_object().unwrap().len(), 8);

        for (state, name) in [
            (TrackState::Off, "off"),
            (TrackState::Starting, "starting"),
            (TrackState::Read, "read"),
            (TrackState::OverlayHidden, "overlay_hidden"),
            (TrackState::NoGame, "no_game"),
            (TrackState::Minimized, "minimized"),
            (TrackState::Failed, "failed"),
        ] {
            assert_eq!(serde_json::to_value(state).unwrap(), name);
        }
    }

    #[test]
    fn describe_never_names_a_boss_it_did_not_see() {
        assert_eq!(
            describe(&recognition(ScreenKind::AnomalySelect, None)),
            "이상 개체 요격전 화면이지만 보스를 알아보지 못했다"
        );
        for boss in Boss::ALL {
            assert!(describe(&recognition(ScreenKind::AnomalySquad, Some(boss))).ends_with(boss.name()));
        }
    }
}
