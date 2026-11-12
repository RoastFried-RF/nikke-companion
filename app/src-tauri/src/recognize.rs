//! 요격전 화면 인식: 캡처한 프레임이 이상 개체 요격전의 어느 화면인지, 어느 보스가 선택됐는지 알아낸다.
//!
//! 순수 모듈이다 — `capture::Frame`만 받고 Win32·파일에 닿지 않는다. 글자를 읽지 않는다(OCR·ML 없음).
//! 보는 것은 **정해 둔 자리의 색**뿐이다:
//!
//! - 이상 개체 화면은 보스마다 테마 색이 다르다(초록·보라·빨강·주황·파랑). 화면 맨 아래 가장자리의 띠,
//!   `도전하기` 단추, 좌우 화살표(선택 화면), 보스 이름 칸의 좌우 막대와 정보 칸의 좌우 날개(편성 화면)가 그 색이다.
//! - 화면 종류는 그 화면에만 있는 표지로 가른다: 선택 화면은 아래 탭(이상 개체 요격전 쪽이 빨강),
//!   편성 화면은 `모의전`(파랑) 단추.
//!
//! 자리마다 격자로 몇백 점만 찍어 본다(`SAMPLES_PER_FRAME`, 프레임 크기와 무관). 프레임 전체를 훑지 않는다.
//! 자리는 화면 비율(0~1)로 적혀 있어 해상도와 무관하지만 **16:9 화면에서 잰 값**이다 — 비율이 다른 프레임은
//! 판단하지 않고 `unknown`으로 돌려준다.
//!
//! 판정은 엄격하다: 한 화면의 **필수 표지**가 모두 같은 보스 색으로 보여야 그 화면·그 보스라고 한다. 하나라도 빠지거나
//! 두 보스의 색이 섞이면 `unknown`이다 — 다른 보스로 잘못 말하느니 모른다고 한다.
//!
//! 다만 **한 단추의 색에 전부를 걸지 않는다**(P-023). 전투로 들어가는 단추 — 선택 화면의 `도전하기`, 편성 화면의
//! `전투 진입` — 는 필수 표지가 아니다: 그날의 요격 횟수를 다 쓰면 `전투 진입`이 빨강이 아니게 된다(2026-11-12 실제 게임에서
//! 빨강 0%). 제 색이면 근거에 더하고, 아니면 나머지 표지로 판단하되 그 사실을 근거에 적고 신뢰도를 낮춘다
//! (`WITHOUT_BUTTON_CONFIDENCE`). `도전하기`가 **다른 보스의** 테마 색이면 여전히 `unknown`이다.
//!
//! 기준값(자리·색 범위·몫)은 2026-11-12 사용자 계정의 캡처 16장(1881×1058, 로비 1장은 2212×1244)에서 쟀다.
//! 방법과 한계는 `app/README.md` §화면 인식, 화면 구성은 `docs/intercept.md` §화면 구성.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::capture::Frame;

// ── 결과 ─────────────────────────────────────────────────────────────────────

/// 화면 종류.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenKind {
    /// 이상 개체 요격전 — 보스 선택.
    AnomalySelect,
    /// 이상 개체 요격전 — 편성(`도전하기` 뒤).
    AnomalySquad,
    /// 이상 개체 화면이 아니다(아래 가장자리에 테마 색 띠가 없다).
    Other,
    /// 판단하지 않는다: 필수 표지가 일부만 보이거나, 두 보스의 색이 섞였거나, 지원하지 않는 프레임이다.
    Unknown,
}

/// 이상 개체 요격전의 보스. `id`·`name`은 `data/intercept/anomaly.json`과 같다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Boss {
    Indivilia,
    Ultra,
    Harvester,
    Kraken,
    MirrorContainer,
}

impl Boss {
    pub const ALL: [Boss; 5] = [
        Boss::Indivilia,
        Boss::Ultra,
        Boss::Harvester,
        Boss::Kraken,
        Boss::MirrorContainer,
    ];

    /// `Tally::theme`에서 이 보스의 자리.
    pub fn index(self) -> usize {
        match self {
            Self::Indivilia => 0,
            Self::Ultra => 1,
            Self::Harvester => 2,
            Self::Kraken => 3,
            Self::MirrorContainer => 4,
        }
    }

    /// 보스 묶음(`data/intercept/anomaly.json`)의 `id`.
    pub fn id(self) -> &'static str {
        match self {
            Self::Indivilia => "indivilia",
            Self::Ultra => "ultra",
            Self::Harvester => "harvester",
            Self::Kraken => "kraken",
            Self::MirrorContainer => "mirror_container",
        }
    }

    /// 게임 화면의 보스 이름.
    pub fn name(self) -> &'static str {
        match self {
            Self::Indivilia => "인디빌리아",
            Self::Ultra => "울트라",
            Self::Harvester => "하베스터",
            Self::Kraken => "크라켄",
            Self::MirrorContainer => "미러 컨테이너",
        }
    }

    /// 테마 색의 이름(근거 문장에 쓴다).
    pub fn theme(self) -> &'static str {
        match self {
            Self::Indivilia => "초록",
            Self::Ultra => "보라",
            Self::Harvester => "빨강",
            Self::Kraken => "주황",
            Self::MirrorContainer => "파랑",
        }
    }

    /// 테마 색의 색상 범위(도). 캡처에서 잰 값은 인디빌리아 139~147, 울트라 260~279, 하베스터 355~365,
    /// 크라켄 28~38, 미러 컨테이너 207~223이고, 여기에 10° 안팎의 여유를 뒀다. 범위끼리는 겹치지 않는다
    /// (가장 가까운 빨강과 주황 사이가 14° 비어 있다).
    pub fn hue(self) -> HueRange {
        match self {
            Self::Indivilia => HueRange::new(129.0, 157.0),
            Self::Ultra => HueRange::new(252.0, 284.0),
            Self::Harvester => HueRange::new(348.0, 6.0),
            Self::Kraken => HueRange::new(20.0, 44.0),
            Self::MirrorContainer => HueRange::new(205.0, 228.0),
        }
    }
}

impl Serialize for Boss {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut out = serializer.serialize_struct("Boss", 2)?;
        out.serialize_field("id", self.id())?;
        out.serialize_field("name", self.name())?;
        out.end()
    }
}

/// 인식 결과. 명령줄 도구가 JSON 한 줄로 찍고, 오버레이 화면이 그대로 받는다(프런트의 `ScreenRecognition`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Recognition {
    pub screen: ScreenKind,
    /// 이상 개체 화면일 때만 있다(`{id, name}`). 그 밖에는 null — 추측으로 채우지 않는다.
    pub boss: Option<Boss>,
    /// 0~1. 이상 개체 화면이면 0.5(모든 표지가 기준에 겨우 닿음)~1(캡처에서 잰 값만큼 뚜렷함) —
    /// `도전하기`·`전투 진입` 단추가 제 색이 아니면 0.8을 넘지 않는다(`WITHOUT_BUTTON_CONFIDENCE`).
    /// `other`는 아래 띠 자리에 테마 색이 적을수록 1에 가깝고, `unknown`은 0이다.
    pub confidence: f32,
    /// 무엇을 보고 그렇게 판단했는지(한국어 문장들).
    pub evidence: Vec<String>,
    /// 본 프레임의 크기.
    pub width: u32,
    pub height: u32,
}

// ── 색 ───────────────────────────────────────────────────────────────────────

/// 색상 범위(도, 양 끝 포함). `from > to`이면 0°를 넘어 돈다(빨강).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HueRange {
    pub from: f32,
    pub to: f32,
}

impl HueRange {
    pub const fn new(from: f32, to: f32) -> Self {
        Self { from, to }
    }

    pub fn contains(self, hue: f32) -> bool {
        if self.from <= self.to {
            hue >= self.from && hue <= self.to
        } else {
            hue >= self.from || hue <= self.to
        }
    }
}

/// 색상(0 이상 360 미만, 도)·채도(0~1)·명도(0~1).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hsv {
    pub hue: f32,
    pub sat: f32,
    pub val: f32,
}

/// RGB를 HSV로 바꾼다. 무채색의 색상은 0이다.
pub fn hsv(r: u8, g: u8, b: u8) -> Hsv {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let val = f32::from(max) / 255.0;
    if max == min {
        return Hsv {
            hue: 0.0,
            sat: 0.0,
            val,
        };
    }
    let delta = f32::from(max - min);
    let (rf, gf, bf) = (f32::from(r), f32::from(g), f32::from(b));
    let sector = if max == r {
        ((gf - bf) / delta).rem_euclid(6.0)
    } else if max == g {
        (bf - rf) / delta + 2.0
    } else {
        (rf - gf) / delta + 4.0
    };
    let hue = sector * 60.0;
    Hsv {
        // rem_euclid가 6.0에 닿는 끝자리 오차를 0으로 접는다.
        hue: if hue >= 360.0 { 0.0 } else { hue },
        sat: delta / f32::from(max),
        val,
    }
}

/// 테마 색으로 치는 최소 채도. 캡처의 테마 색은 0.75(울트라)~1.0이고, 흰 글자·어두운 배경과 섞인 가장자리가 0.6대다.
pub const THEME_MIN_SAT: f32 = 0.45;
/// 테마 색으로 치는 최소 명도. 가장 어두운 띠(인디빌리아 편성 화면)가 0.32~0.43, 띠 바로 위의 배경이 0.1 이하다.
pub const THEME_MIN_VAL: f32 = 0.20;
/// 단추 색(모의전 파랑·전투 진입 빨강·탭 빨강)으로 치는 최소 채도와 명도. 캡처에서는 채도 0.85 이상, 명도 0.8 이상.
pub const ACTION_MIN_SAT: f32 = 0.60;
pub const ACTION_MIN_VAL: f32 = 0.50;
/// `모의전` 단추의 파랑(캡처에서 197~199°). 미러 컨테이너의 테마 파랑(207° 이상)과 겹치지 않는다.
pub const ACTION_BLUE: HueRange = HueRange::new(188.0, 204.0);
/// `전투 진입` 단추(4~8°)와 선택된 탭 아이콘(350~0°)의 빨강.
pub const ACTION_RED: HueRange = HueRange::new(345.0, 15.0);

/// 이 색이 어느 보스의 테마 색인가. 채도·명도가 모자라거나 어느 범위에도 들지 않으면 `None`.
pub fn theme_of(r: u8, g: u8, b: u8) -> Option<Boss> {
    let color = hsv(r, g, b);
    if color.sat < THEME_MIN_SAT || color.val < THEME_MIN_VAL {
        return None;
    }
    Boss::ALL
        .into_iter()
        .find(|boss| boss.hue().contains(color.hue))
}

// ── 자리와 표본 ───────────────────────────────────────────────────────────────

/// 한 자리에서 찍어 본 점들의 색 분류.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Tally {
    /// 찍어 본 점의 수.
    pub samples: u32,
    /// 보스별 테마 색인 점의 수(`Boss::index` 순).
    pub theme: [u32; 5],
    /// `모의전` 파랑인 점의 수.
    pub blue: u32,
    /// 단추·탭 빨강인 점의 수.
    pub red: u32,
}

impl Tally {
    /// 점 하나를 더한다.
    pub fn add(&mut self, r: u8, g: u8, b: u8) {
        self.samples += 1;
        let color = hsv(r, g, b);
        if color.sat >= THEME_MIN_SAT && color.val >= THEME_MIN_VAL {
            if let Some(boss) = Boss::ALL
                .into_iter()
                .find(|boss| boss.hue().contains(color.hue))
            {
                self.theme[boss.index()] += 1;
            }
        }
        if color.sat >= ACTION_MIN_SAT && color.val >= ACTION_MIN_VAL {
            if ACTION_BLUE.contains(color.hue) {
                self.blue += 1;
            }
            if ACTION_RED.contains(color.hue) {
                self.red += 1;
            }
        }
    }

    fn share(&self, count: u32) -> f32 {
        if self.samples == 0 {
            0.0
        } else {
            count as f32 / self.samples as f32
        }
    }

    /// 이 보스의 테마 색인 점의 몫(0~1).
    pub fn theme_share(&self, boss: Boss) -> f32 {
        self.share(self.theme[boss.index()])
    }

    pub fn blue_share(&self) -> f32 {
        self.share(self.blue)
    }

    pub fn red_share(&self) -> f32 {
        self.share(self.red)
    }

    /// 테마 색이 많은 순으로 첫째와 둘째 (보스, 몫).
    pub fn top_themes(&self) -> [(Boss, f32); 2] {
        let mut ranked = Boss::ALL.map(|boss| (boss, self.theme_share(boss)));
        // 몫이 같으면 `Boss::ALL`의 순서를 지킨다(안정 정렬).
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
        [ranked[0], ranked[1]]
    }
}

/// 화면의 한 자리: 비율(0~1)로 적은 사각형과, 그 안에 고르게 찍는 격자의 크기.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Region {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    pub nx: u32,
    pub ny: u32,
}

impl Region {
    pub const fn new(x0: f64, y0: f64, x1: f64, y1: f64, nx: u32, ny: u32) -> Self {
        Self {
            x0,
            y0,
            x1,
            y1,
            nx,
            ny,
        }
    }

    /// 이 자리에서 찍는 점의 수.
    pub const fn samples(&self) -> u32 {
        self.nx * self.ny
    }

    /// 격자의 `i`번째 열·`j`번째 행이 찍는 픽셀. 칸의 가운데를 프레임 크기에 곱해 내림한다.
    pub fn pixel(&self, i: u32, j: u32, width: u32, height: u32) -> (u32, u32) {
        let fx = self.x0 + (f64::from(i) + 0.5) / f64::from(self.nx) * (self.x1 - self.x0);
        let fy = self.y0 + (f64::from(j) + 0.5) / f64::from(self.ny) * (self.y1 - self.y0);
        let x = (fx * f64::from(width)).floor().max(0.0) as u32;
        let y = (fy * f64::from(height)).floor().max(0.0) as u32;
        (
            x.min(width.saturating_sub(1)),
            y.min(height.saturating_sub(1)),
        )
    }

    /// 이 자리의 점들을 찍어 색을 센다. 프레임의 픽셀 수가 크기와 맞아야 한다(`recognize`가 먼저 확인한다).
    pub fn tally(&self, frame: &Frame) -> Tally {
        let mut tally = Tally::default();
        if frame.width == 0 || frame.height == 0 {
            return tally;
        }
        let stride = frame.width as usize * 3;
        for j in 0..self.ny {
            for i in 0..self.nx {
                let (x, y) = self.pixel(i, j, frame.width, frame.height);
                let at = y as usize * stride + x as usize * 3;
                if let Some(px) = frame.rgb.get(at..at + 3) {
                    tally.add(px[0], px[1], px[2]);
                }
            }
        }
        tally
    }
}

/// 보는 자리들. 비율은 1881×1058 캡처에서 잰 픽셀 좌표를 그 크기로 나눈 값이다(괄호 안이 픽셀).
pub mod regions {
    use super::Region;

    /// 화면 맨 아래 가장자리의 테마 색 띠(세로 1047~1058 중 1049~1055, 가로는 둥근 창 모서리를 피해 5~95%).
    pub const STRIP: Region = Region::new(0.05, 0.9915, 0.95, 0.9975, 96, 3);
    /// 선택 화면의 `도전하기` 단추 안쪽(846~1036 × 838~888). 흰 글자가 15%쯤 차지한다.
    pub const BUTTON: Region = Region::new(0.4498, 0.7921, 0.5508, 0.8393, 32, 8);
    /// 선택 화면의 보스 넘기기 화살표 — 왼쪽(748~778 × 780~810), 오른쪽(1108~1138).
    pub const CHEVRON_LEFT: Region = Region::new(0.3977, 0.7372, 0.4136, 0.7656, 12, 12);
    pub const CHEVRON_RIGHT: Region = Region::new(0.5891, 0.7372, 0.6050, 0.7656, 12, 12);
    /// 선택 화면 아래의 탭 아이콘 — `요격전`(1021~1059 × 936~979), `이상 개체 요격전`(1138~1176).
    pub const TAB_INTERCEPT: Region = Region::new(0.5428, 0.8847, 0.5630, 0.9253, 12, 12);
    pub const TAB_ANOMALY: Region = Region::new(0.6050, 0.8847, 0.6252, 0.9253, 12, 12);
    /// 편성 화면의 보스 이름 칸 좌우 막대 — 왼쪽(743~761 × 470~572, 막대는 746~758), 오른쪽(1119~1137).
    pub const BAR_LEFT: Region = Region::new(0.3950, 0.4442, 0.4046, 0.5406, 6, 24);
    pub const BAR_RIGHT: Region = Region::new(0.5949, 0.4442, 0.6045, 0.5406, 6, 24);
    /// 편성 화면의 정보 세 칸 좌우 날개 — 왼쪽(665~683 × 612~658), 오른쪽(1197~1215).
    pub const INFO_LEFT: Region = Region::new(0.3535, 0.5784, 0.3631, 0.6219, 6, 12);
    pub const INFO_RIGHT: Region = Region::new(0.6364, 0.5784, 0.6459, 0.6219, 6, 12);
    /// 편성 화면의 `모의전` 단추 안쪽(670~918 × 874~914).
    pub const MOCK: Region = Region::new(0.3562, 0.8261, 0.4880, 0.8639, 32, 6);
    /// 편성 화면의 `전투 진입` 단추 안쪽(968~1205 × 950~1005).
    pub const ENTER: Region = Region::new(0.5146, 0.8979, 0.6406, 0.9499, 32, 8);

    /// 모든 자리(`Readings`의 칸 순서).
    pub const ALL: [Region; 12] = [
        STRIP,
        BUTTON,
        CHEVRON_LEFT,
        CHEVRON_RIGHT,
        TAB_INTERCEPT,
        TAB_ANOMALY,
        BAR_LEFT,
        BAR_RIGHT,
        INFO_LEFT,
        INFO_RIGHT,
        MOCK,
        ENTER,
    ];
}

/// 인식 한 번에 찍어 보는 점의 수. 프레임 크기와 무관하다.
pub const SAMPLES_PER_FRAME: u32 = {
    let mut total = 0;
    let mut i = 0;
    while i < regions::ALL.len() {
        total += regions::ALL[i].samples();
        i += 1;
    }
    total
};

/// 자리마다 센 값.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Readings {
    pub strip: Tally,
    pub button: Tally,
    pub chevron_left: Tally,
    pub chevron_right: Tally,
    pub tab_intercept: Tally,
    pub tab_anomaly: Tally,
    pub bar_left: Tally,
    pub bar_right: Tally,
    pub info_left: Tally,
    pub info_right: Tally,
    pub mock: Tally,
    pub enter: Tally,
}

impl Readings {
    /// 찍어 본 점의 총수.
    pub fn samples(&self) -> u32 {
        [
            self.strip,
            self.button,
            self.chevron_left,
            self.chevron_right,
            self.tab_intercept,
            self.tab_anomaly,
            self.bar_left,
            self.bar_right,
            self.info_left,
            self.info_right,
            self.mock,
            self.enter,
        ]
        .iter()
        .map(|tally| tally.samples)
        .sum()
    }
}

/// 프레임에서 모든 자리를 한 번씩 찍어 센다.
pub fn measure(frame: &Frame) -> Readings {
    Readings {
        strip: regions::STRIP.tally(frame),
        button: regions::BUTTON.tally(frame),
        chevron_left: regions::CHEVRON_LEFT.tally(frame),
        chevron_right: regions::CHEVRON_RIGHT.tally(frame),
        tab_intercept: regions::TAB_INTERCEPT.tally(frame),
        tab_anomaly: regions::TAB_ANOMALY.tally(frame),
        bar_left: regions::BAR_LEFT.tally(frame),
        bar_right: regions::BAR_RIGHT.tally(frame),
        info_left: regions::INFO_LEFT.tally(frame),
        info_right: regions::INFO_RIGHT.tally(frame),
        mock: regions::MOCK.tally(frame),
        enter: regions::ENTER.tally(frame),
    }
}

// ── 판정 기준 ─────────────────────────────────────────────────────────────────
//
// `*_MIN`은 "그 표지가 있다"고 치는 최소 몫, `*_TYPICAL`은 신뢰도 1로 치는 몫이다. 괄호 안은 라벨 캡처 16장을
// 원본·0.34~1.25배·밝기 ±10%·잡음 ±16으로 바꿔 가며 잰 범위(있는 화면에서의 최솟값~최댓값 / 없는 화면에서의 최댓값).

/// 테마 색의 몫이 이보다 작으면 그 자리에 테마 색이 "없다"고 본다(이상 개체가 아닌 화면의 아래 띠 자리: 0.02 이하).
pub const ABSENT_SHARE: f32 = 0.08;
/// 둘째로 많은 테마 색이 첫째의 이 비율 이상이면 "두 보스의 색이 섞였다"고 본다(캡처에서는 0.03 이하).
pub const MIXED_RATIO: f32 = 0.25;

/// 아래 띠(0.94~1.00 / 0.02).
pub const STRIP_MIN: f32 = 0.70;
pub const STRIP_TYPICAL: f32 = 0.95;
/// `도전하기` 단추(0.81~0.91 / 0.16). 필수 표지가 아니다 — 기준 이상이면 근거에 더하고, 아니면 그 사실을 적는다.
pub const BUTTON_MIN: f32 = 0.55;
pub const BUTTON_TYPICAL: f32 = 0.85;
/// 좌우 화살표(0.41~0.58 / 0.12).
pub const CHEVRON_MIN: f32 = 0.25;
pub const CHEVRON_TYPICAL: f32 = 0.45;
/// 보스 이름 칸의 좌우 막대(0.56~0.98 / 0.21).
pub const BAR_MIN: f32 = 0.35;
pub const BAR_TYPICAL: f32 = 0.65;
/// 정보 칸의 좌우 날개(0.46~0.92 / 0.01).
pub const INFO_MIN: f32 = 0.28;
pub const INFO_TYPICAL: f32 = 0.50;
/// 선택된 탭 아이콘의 빨강(0.53~0.62). 선택되지 않은 탭은 0.00이다.
pub const TAB_ON_MIN: f32 = 0.35;
pub const TAB_ON_TYPICAL: f32 = 0.58;
/// 선택되지 않은 탭 아이콘에 허용하는 빨강의 최대 몫.
pub const TAB_OFF_MAX: f32 = 0.10;
/// `모의전` 단추의 파랑(0.94~0.95 / 일반·특수 개체 편성 화면 0.64).
pub const MOCK_MIN: f32 = 0.70;
pub const MOCK_TYPICAL: f32 = 0.94;
/// `전투 진입` 단추의 빨강(0.77~0.87). 필수 표지가 아니다 — 요격 횟수를 다 쓴 날에는 0.00이었다(2026-11-12 실제 게임).
pub const ENTER_MIN: f32 = 0.55;
pub const ENTER_TYPICAL: f32 = 0.82;
/// 전투로 들어가는 단추(`도전하기`·`전투 진입`)가 제 색이 아닐 때 신뢰도의 상한. 나머지 표지가 아무리 뚜렷해도
/// 표지 하나가 덜 받쳐 주는 만큼 낮춘다(어림값이다 — 화면에 보이는 숫자일 뿐 판정에는 쓰지 않는다).
pub const WITHOUT_BUTTON_CONFIDENCE: f32 = 0.80;

/// 지원하는 화면 비율(가로/세로)과 허용 오차(상대값). 기준값을 16:9 화면에서만 쟀다.
pub const SUPPORTED_ASPECT: f64 = 16.0 / 9.0;
pub const ASPECT_TOLERANCE: f64 = 0.03;
/// 이보다 작은 프레임은 판단하지 않는다(띠가 3픽셀, 막대가 4픽셀 아래로 줄어든다).
pub const MIN_WIDTH: u32 = 640;
pub const MIN_HEIGHT: u32 = 360;

/// 한 자리에서 읽은 테마 색.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ThemeRead {
    /// 테마 색이 (거의) 없다.
    Absent,
    /// 한 보스의 색이 보이지만 기준에 못 미친다.
    Weak { boss: Boss, share: f32 },
    /// 두 보스의 색이 섞여 있다.
    Mixed { first: Boss, second: Boss },
    /// 한 보스의 색이 기준 이상이다.
    Clear { boss: Boss, share: f32 },
}

impl ThemeRead {
    /// 기준 이상으로 보인 보스.
    pub fn clear(self) -> Option<(Boss, f32)> {
        match self {
            Self::Clear { boss, share } => Some((boss, share)),
            _ => None,
        }
    }
}

/// 한 자리의 테마 색을 읽는다. `min_share`는 그 자리의 기준(`*_MIN`)이다.
pub fn read_theme(tally: &Tally, min_share: f32) -> ThemeRead {
    let [(first, share), (second, second_share)] = tally.top_themes();
    if share < ABSENT_SHARE {
        ThemeRead::Absent
    } else if second_share >= MIXED_RATIO * share {
        ThemeRead::Mixed { first, second }
    } else if share >= min_share {
        ThemeRead::Clear { boss: first, share }
    } else {
        ThemeRead::Weak { boss: first, share }
    }
}

// ── 판정 ─────────────────────────────────────────────────────────────────────

/// 판정 결과(프레임 크기를 뺀 `Recognition`).
#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub screen: ScreenKind,
    pub boss: Option<Boss>,
    pub confidence: f32,
    pub evidence: Vec<String>,
}

fn percent(share: f32) -> String {
    format!("{:.0}%", share * 100.0)
}

/// 기준에서 얼마나 여유가 있는가: 기준에 겨우 닿으면 0, 캡처에서 잰 값만큼이면 1.
fn strength(share: f32, min: f32, typical: f32) -> f32 {
    ((share - min) / (typical - min)).clamp(0.0, 1.0)
}

/// 테마 색 표지 하나.
struct Mark {
    label: &'static str,
    read: ThemeRead,
    min: f32,
    typical: f32,
}

impl Mark {
    fn new(label: &'static str, tally: &Tally, min: f32, typical: f32) -> Self {
        Self {
            label,
            read: read_theme(tally, min),
            min,
            typical,
        }
    }

    fn describe(&self) -> String {
        match self.read {
            ThemeRead::Absent => format!("{} 테마 색 없음", self.label),
            ThemeRead::Weak { boss, share } => format!(
                "{} {} {}(기준 {} 미만)",
                self.label,
                boss.theme(),
                percent(share),
                percent(self.min)
            ),
            ThemeRead::Mixed { first, second } => {
                format!("{} {}·{} 섞임", self.label, first.theme(), second.theme())
            }
            ThemeRead::Clear { boss, share } => {
                format!("{} {} {}", self.label, boss.theme(), percent(share))
            }
        }
    }

    fn strength(&self) -> f32 {
        match self.read {
            ThemeRead::Clear { share, .. } => strength(share, self.min, self.typical),
            _ => 0.0,
        }
    }
}

/// 표지들이 모두 같은 보스의 색으로 뚜렷한가. 그렇다면 그 보스.
fn agreed_boss(marks: &[Mark]) -> Option<Boss> {
    let (first, _) = marks.first()?.read.clear()?;
    marks
        .iter()
        .all(|mark| mark.read.clear().is_some_and(|(boss, _)| boss == first))
        .then_some(first)
}

fn describe_marks(title: &str, marks: &[Mark], extra: &str) -> String {
    let listed: Vec<String> = marks.iter().map(Mark::describe).collect();
    format!("{title}: {} / {extra}", listed.join(", "))
}

fn min_strength(values: impl IntoIterator<Item = f32>) -> f32 {
    values.into_iter().fold(1.0, f32::min)
}

fn unknown(mut evidence: Vec<String>, reason: String) -> Verdict {
    evidence.push(format!("→ 판단하지 않는다: {reason}"));
    Verdict {
        screen: ScreenKind::Unknown,
        boss: None,
        confidence: 0.0,
        evidence,
    }
}

/// 전투로 들어가는 단추(`도전하기`·`전투 진입`)에서 읽은 것. 필수 표지가 아니다 — 요격 횟수를 다 쓰면 색이 달라진다.
#[derive(Debug, Clone, PartialEq)]
enum ButtonRead {
    /// 제 색이다. 값은 기준에서의 여유(0~1)이고 신뢰도에 넣는다.
    Usual(f32),
    /// 제 색이 아니다. 나머지 표지로 판단하고 이 문장을 근거에 적는다.
    Unusual(String),
    /// 다른 보스를 가리킨다(이유). 그 화면이라고 하지 않는다.
    Conflict(String),
}

/// 선택 화면의 `도전하기` 단추를 좌우 화살표가 가리킨 보스에 비춰 읽는다.
fn read_challenge_button(button: &Mark, boss: Boss) -> ButtonRead {
    const REST: &str = "필수 표지가 아니어서 나머지 표지(아래 띠·좌우 화살표·아래 탭)로 판단했다. \
                        요격 횟수를 다 쓴 날에 이렇게 보일 수 있다(미확인)";
    match button.read {
        ThemeRead::Clear { boss: seen, .. } if seen == boss => {
            ButtonRead::Usual(button.strength())
        }
        ThemeRead::Absent => ButtonRead::Unusual(format!(
            "도전하기 단추가 테마 색이 아니다(테마 색 {} 미만, 평소 {} 이상) — {REST}",
            percent(ABSENT_SHARE),
            percent(button.min)
        )),
        ThemeRead::Weak { boss: seen, share } if seen == boss => ButtonRead::Unusual(format!(
            "도전하기 단추의 테마 색이 평소보다 적다({} {}, 평소 {} 이상) — {REST}",
            seen.theme(),
            percent(share),
            percent(button.min)
        )),
        ThemeRead::Clear { boss: seen, .. } | ThemeRead::Weak { boss: seen, .. } => {
            ButtonRead::Conflict(format!(
                "도전하기 단추는 {}({}) 색인데 좌우 화살표는 {}({}) 색이다",
                seen.theme(),
                seen.name(),
                boss.theme(),
                boss.name()
            ))
        }
        ThemeRead::Mixed { first, second } => ButtonRead::Conflict(format!(
            "도전하기 단추에 두 보스의 색({}·{})이 섞여 있다",
            first.theme(),
            second.theme()
        )),
    }
}

/// 편성 화면의 `전투 진입` 단추를 읽는다. 빨강이 아니어도 다른 보스를 가리키는 것은 아니다(테마 색 단추가 아니다).
fn read_enter_button(red_share: f32) -> ButtonRead {
    if red_share >= ENTER_MIN {
        ButtonRead::Usual(strength(red_share, ENTER_MIN, ENTER_TYPICAL))
    } else {
        ButtonRead::Unusual(format!(
            "전투 진입 단추가 빨강이 아니다(빨강 {}, 평소 {} 이상) — 필수 표지가 아니어서 나머지 표지(아래 띠·이름 칸 막대·\
             정보 칸 날개·모의전 단추)로 판단했다. 요격 횟수를 다 쓴 날에 이렇게 보인다(추정)",
            percent(red_share),
            percent(ENTER_MIN)
        ))
    }
}

/// 필수 표지가 다 갖춰진 한 화면.
struct Layout {
    screen: ScreenKind,
    name: &'static str,
    boss: Boss,
    /// 그 화면의 표지를 적은 근거 줄.
    line: String,
    /// 필수 표지 중 가장 약한 것의 여유(0~1).
    strength: f32,
    button: ButtonRead,
}

/// 자리마다 센 값으로 화면 종류와 보스를 정한다.
///
/// - 선택 화면: 아래 띠 + 좌우 화살표가 모두 같은 보스 색이고, 아래 탭은 이상 개체 요격전 쪽만 빨강.
///   `도전하기` 단추는 필수가 아니다 — 같은 보스 색이면 근거에 더하고, 테마 색이 아니면 그 사실을 적는다.
///   다른 보스의 색이거나 두 보스의 색이 섞였으면 선택 화면이라고 하지 않는다.
/// - 편성 화면: 아래 띠 + 이름 칸 좌우 막대 + 정보 칸 좌우 날개가 모두 같은 보스 색이고, `모의전`이 파랑.
///   `전투 진입` 단추의 빨강은 필수가 아니다 — 빨강이 아니면 그 사실을 적는다.
/// - 아래 띠 자리에 테마 색이 없고 어느 화면의 표지도 갖춰지지 않았으면 `other`.
/// - 그 밖(필수 표지가 일부만 보임, 두 보스의 색이 섞임, 두 화면의 표지가 함께 보임)은 `unknown`.
pub fn decide(readings: &Readings) -> Verdict {
    let strip = Mark::new("아래 띠", &readings.strip, STRIP_MIN, STRIP_TYPICAL);
    let button = Mark::new("도전하기 단추", &readings.button, BUTTON_MIN, BUTTON_TYPICAL);
    let select_marks = [
        Mark::new(
            "왼쪽 화살표",
            &readings.chevron_left,
            CHEVRON_MIN,
            CHEVRON_TYPICAL,
        ),
        Mark::new(
            "오른쪽 화살표",
            &readings.chevron_right,
            CHEVRON_MIN,
            CHEVRON_TYPICAL,
        ),
    ];
    let squad_marks = [
        Mark::new("이름 칸 왼쪽 막대", &readings.bar_left, BAR_MIN, BAR_TYPICAL),
        Mark::new(
            "이름 칸 오른쪽 막대",
            &readings.bar_right,
            BAR_MIN,
            BAR_TYPICAL,
        ),
        Mark::new(
            "정보 칸 왼쪽 날개",
            &readings.info_left,
            INFO_MIN,
            INFO_TYPICAL,
        ),
        Mark::new(
            "정보 칸 오른쪽 날개",
            &readings.info_right,
            INFO_MIN,
            INFO_TYPICAL,
        ),
    ];

    let (tab_on, tab_off) = (
        readings.tab_anomaly.red_share(),
        readings.tab_intercept.red_share(),
    );
    let tabs_ok = tab_on >= TAB_ON_MIN && tab_off <= TAB_OFF_MAX;
    let (mock, enter) = (readings.mock.blue_share(), readings.enter.red_share());
    let mock_ok = mock >= MOCK_MIN;

    let strip_line = format!("{}(화면 맨 아래 가장자리)", strip.describe());
    let select_line = describe_marks(
        "보스 선택 화면의 표지",
        &select_marks,
        &format!(
            "아래 탭 빨강 — 이상 개체 요격전 쪽 {}(기준 {} 이상), 요격전 쪽 {}(기준 {} 이하) / 필수 아님 — {}",
            percent(tab_on),
            percent(TAB_ON_MIN),
            percent(tab_off),
            percent(TAB_OFF_MAX),
            button.describe()
        ),
    );
    let squad_line = describe_marks(
        "편성 화면의 표지",
        &squad_marks,
        &format!(
            "모의전 단추 파랑 {}(기준 {} 이상) / 필수 아님 — 전투 진입 단추 빨강 {}(평소 {} 이상)",
            percent(mock),
            percent(MOCK_MIN),
            percent(enter),
            percent(ENTER_MIN)
        ),
    );

    // 필수 표지가 갖춰진 화면과, 그 화면의 단추(필수 아님)에서 읽은 것.
    let select = agreed_boss(&select_marks)
        .filter(|_| tabs_ok)
        .map(|boss| (boss, read_challenge_button(&button, boss)));
    let squad = agreed_boss(&squad_marks)
        .filter(|_| mock_ok)
        .map(|boss| (boss, read_enter_button(enter)));
    // `도전하기` 단추가 다른 보스를 가리키면 선택 화면이라고 하지 않는다.
    let (select, button_conflict) = match select {
        Some((_, ButtonRead::Conflict(why))) => (None, Some(why)),
        other => (other, None),
    };

    let layout = match (select, squad) {
        (Some(_), Some(_)) => {
            return unknown(
                vec![strip_line, select_line, squad_line],
                "보스 선택 화면과 편성 화면의 표지가 함께 보인다".to_string(),
            );
        }
        (Some((boss, button)), None) => Layout {
            screen: ScreenKind::AnomalySelect,
            name: "이상 개체 보스 선택 화면",
            boss,
            line: select_line,
            strength: min_strength(
                select_marks.iter().map(Mark::strength).chain([
                    strength(tab_on, TAB_ON_MIN, TAB_ON_TYPICAL),
                    ((TAB_OFF_MAX - tab_off) / TAB_OFF_MAX).clamp(0.0, 1.0),
                ]),
            ),
            button,
        },
        (None, Some((boss, button))) => Layout {
            screen: ScreenKind::AnomalySquad,
            name: "이상 개체 편성 화면",
            boss,
            line: squad_line,
            strength: min_strength(
                squad_marks
                    .iter()
                    .map(Mark::strength)
                    .chain([strength(mock, MOCK_MIN, MOCK_TYPICAL)]),
            ),
            button,
        },
        (None, None) => {
            if strip.read == ThemeRead::Absent {
                let top = readings.strip.top_themes()[0].1;
                return Verdict {
                    screen: ScreenKind::Other,
                    boss: None,
                    confidence: 0.5 + 0.5 * (1.0 - top / ABSENT_SHARE).clamp(0.0, 1.0),
                    evidence: vec![
                        format!(
                            "화면 맨 아래 가장자리에 보스 테마 색 띠가 없다(가장 많은 테마 색 {}, 기준 {} 미만)",
                            percent(top),
                            percent(ABSENT_SHARE)
                        ),
                        select_line,
                        squad_line,
                        "→ 이상 개체 요격전 화면이 아니다".to_string(),
                    ],
                };
            }
            let mut reason =
                "아래 띠에는 테마 색이 보이는데 보스 선택 화면의 표지도 편성 화면의 표지도 다 갖춰지지 않았다"
                    .to_string();
            if let Some(why) = button_conflict {
                reason.push_str(&format!(" — {why}"));
            }
            return unknown(vec![strip_line, select_line, squad_line], reason);
        }
    };
    let Layout {
        screen,
        name: screen_name,
        boss,
        line,
        strength: layout_strength,
        button,
    } = layout;

    // 한 화면의 필수 표지가 다 갖춰졌다. 아래 띠도 같은 보스 색이어야 한다.
    match strip.read {
        ThemeRead::Clear { boss: seen, .. } if seen == boss => {
            let mut weakest = layout_strength.min(strip.strength());
            let mut evidence = vec![strip_line, line];
            let mut limit = 1.0;
            match button {
                ButtonRead::Usual(strength) => weakest = weakest.min(strength),
                // 단추가 제 색이 아니다: 그 사실을 적고 신뢰도를 낮춘다.
                ButtonRead::Unusual(note) => {
                    evidence.push(note);
                    limit = WITHOUT_BUTTON_CONFIDENCE;
                }
                // 다른 보스를 가리키는 단추는 위에서 걸러졌다.
                ButtonRead::Conflict(_) => {}
            }
            evidence.push(format!(
                "→ {screen_name}, 보스 {}(테마 색 {})",
                boss.name(),
                boss.theme()
            ));
            Verdict {
                screen,
                boss: Some(boss),
                confidence: (0.5 + 0.5 * weakest).min(limit),
                evidence,
            }
        }
        ThemeRead::Clear { boss: seen, .. } => unknown(
            vec![strip_line, line],
            format!(
                "아래 띠는 {}({}) 색인데 {screen_name}의 표지는 {}({}) 색이다 — 두 보스의 특징이 섞였다",
                seen.theme(),
                seen.name(),
                boss.theme(),
                boss.name()
            ),
        ),
        ThemeRead::Mixed { .. } => unknown(
            vec![strip_line, line],
            "아래 띠에 두 보스의 색이 섞여 있다".to_string(),
        ),
        ThemeRead::Weak { .. } | ThemeRead::Absent => unknown(
            vec![strip_line, line],
            format!("{screen_name}의 표지는 보이는데 아래 띠의 테마 색이 기준에 못 미친다"),
        ),
    }
}

/// 프레임을 판단할 수 있는지 확인한다. 못 하면 이유.
pub fn unsupported_reason(frame: &Frame) -> Option<String> {
    let (width, height) = (frame.width, frame.height);
    if width == 0 || height == 0 {
        return Some("프레임이 비어 있다".to_string());
    }
    let expected = width as usize * height as usize * 3;
    if frame.rgb.len() != expected {
        return Some(format!(
            "프레임의 픽셀 수가 크기와 맞지 않는다({} ≠ {expected})",
            frame.rgb.len()
        ));
    }
    if width < MIN_WIDTH || height < MIN_HEIGHT {
        return Some(format!(
            "프레임이 너무 작다({width}×{height}, 최소 {MIN_WIDTH}×{MIN_HEIGHT})"
        ));
    }
    let aspect = f64::from(width) / f64::from(height);
    if (aspect / SUPPORTED_ASPECT - 1.0).abs() > ASPECT_TOLERANCE {
        return Some(format!(
            "화면 비율 {width}×{height}(가로/세로 {aspect:.2})는 지원하지 않는다 — 기준값은 16:9({SUPPORTED_ASPECT:.2}) 화면에서 쟀다"
        ));
    }
    None
}

/// 캡처한 프레임에서 화면 종류와 선택된 보스를 알아낸다. 정해 둔 자리의 점만 찍어 본다(`SAMPLES_PER_FRAME`).
pub fn recognize(frame: &Frame) -> Recognition {
    let verdict = match unsupported_reason(frame) {
        Some(reason) => unknown(Vec::new(), reason),
        None => decide(&measure(frame)),
    };
    Recognition {
        screen: verdict.screen,
        boss: verdict.boss,
        // 소수 둘째 자리까지만 낸다.
        confidence: (verdict.confidence * 100.0).round() / 100.0,
        evidence: verdict.evidence,
        width: frame.width,
        height: frame.height,
    }
}

// ── 합성 화면(테스트용) ───────────────────────────────────────────────────────

/// 코드로 그린 합성 화면. 게임 이미지가 아니다 — 캡처에서 잰 자리(1881×1058 기준 픽셀)에 색 사각형만 칠한다.
#[cfg(test)]
pub(crate) mod synth {
    use super::Boss;
    use crate::capture::Frame;

    /// 자리를 잰 캡처의 크기.
    pub const REF_W: f64 = 1881.0;
    pub const REF_H: f64 = 1058.0;

    pub const BACKGROUND: [u8; 3] = [6, 7, 9];
    pub const WHITE: [u8; 3] = [245, 245, 245];
    pub const GREY: [u8; 3] = [72, 72, 74];
    /// 요격 횟수를 다 쓴 날의 `전투 진입`·`도전하기` 단추로 **가정한** 회색. 실제 색은 모른다(캡처가 없다) —
    /// `전투 진입`이 빨강 0%였다는 것까지만 안다.
    pub const SPENT_GREY: [u8; 3] = [118, 120, 124];
    /// `모의전` 단추·`전투 진입` 단추·선택된 탭 아이콘의 색(캡처에서 잰 평균).
    pub const MOCK_BLUE: [u8; 3] = [19, 177, 244];
    pub const ENTER_RED: [u8; 3] = [238, 75, 54];
    pub const TAB_RED: [u8; 3] = [205, 4, 4];

    /// 보스 테마 색의 대표값(캡처의 아래 띠·단추에서 잰 평균).
    pub fn theme_rgb(boss: Boss) -> [u8; 3] {
        match boss {
            Boss::Indivilia => [0, 177, 67],
            Boss::Ultra => [122, 51, 211],
            Boss::Harvester => [166, 2, 11],
            Boss::Kraken => [222, 120, 12],
            Boss::MirrorContainer => [3, 84, 205],
        }
    }

    pub fn canvas(width: u32, height: u32, rgb: [u8; 3]) -> Frame {
        Frame {
            width,
            height,
            rgb: rgb.as_slice().repeat(width as usize * height as usize),
        }
    }

    /// 1881×1058 기준 픽셀 사각형 `[x0, y0, x1, y1)`을 이 프레임의 크기에 맞춰 칠한다.
    pub fn fill(frame: &mut Frame, rect: [f64; 4], rgb: [u8; 3]) {
        let scale = |value: f64, reference: f64, size: u32| {
            ((value / reference * f64::from(size)).round().max(0.0) as u32).min(size)
        };
        let (x0, x1) = (
            scale(rect[0], REF_W, frame.width),
            scale(rect[2], REF_W, frame.width),
        );
        let (y0, y1) = (
            scale(rect[1], REF_H, frame.height),
            scale(rect[3], REF_H, frame.height),
        );
        for y in y0..y1 {
            for x in x0..x1 {
                let at = (y as usize * frame.width as usize + x as usize) * 3;
                frame.rgb[at..at + 3].copy_from_slice(&rgb);
            }
        }
    }

    pub const STRIP: [f64; 4] = [0.0, 1047.0, 1881.0, 1058.0];
    pub const BUTTON: [f64; 4] = [838.0, 836.0, 1044.0, 890.0];
    pub const BUTTON_TEXT: [f64; 4] = [900.0, 846.0, 986.0, 880.0];
    pub const CHEVRON_LEFT: [f64; 4] = [750.0, 782.0, 766.0, 808.0];
    pub const CHEVRON_RIGHT: [f64; 4] = [1110.0, 782.0, 1126.0, 808.0];
    pub const TAB_INTERCEPT: [f64; 4] = [1024.0, 938.0, 1050.0, 977.0];
    pub const TAB_ANOMALY: [f64; 4] = [1141.0, 938.0, 1167.0, 977.0];
    pub const BAR_LEFT: [f64; 4] = [746.0, 462.0, 758.0, 580.0];
    pub const BAR_RIGHT: [f64; 4] = [1122.0, 462.0, 1134.0, 580.0];
    pub const INFO_LEFT: [f64; 4] = [668.0, 610.0, 680.0, 660.0];
    pub const INFO_RIGHT: [f64; 4] = [1200.0, 610.0, 1212.0, 660.0];
    pub const MOCK: [f64; 4] = [661.0, 869.0, 926.0, 919.0];
    pub const ENTER: [f64; 4] = [960.0, 945.0, 1213.0, 1010.0];

    /// 선택 화면의 표지(아래 띠 제외)를 `theme` 색으로 그린다.
    pub fn draw_select_marks(frame: &mut Frame, theme: [u8; 3]) {
        fill(frame, BUTTON, theme);
        fill(frame, BUTTON_TEXT, WHITE);
        fill(frame, CHEVRON_LEFT, theme);
        fill(frame, CHEVRON_RIGHT, theme);
        fill(frame, TAB_INTERCEPT, GREY);
        fill(frame, TAB_ANOMALY, TAB_RED);
    }

    /// 편성 화면의 표지(아래 띠 제외)를 `theme` 색으로 그린다.
    pub fn draw_squad_marks(frame: &mut Frame, theme: [u8; 3]) {
        fill(frame, BAR_LEFT, theme);
        fill(frame, BAR_RIGHT, theme);
        fill(frame, INFO_LEFT, theme);
        fill(frame, INFO_RIGHT, theme);
        fill(frame, MOCK, MOCK_BLUE);
        fill(frame, ENTER, ENTER_RED);
    }

    /// 이상 개체 보스 선택 화면.
    pub fn select_screen(width: u32, height: u32, boss: Boss) -> Frame {
        let mut frame = canvas(width, height, BACKGROUND);
        fill(&mut frame, STRIP, theme_rgb(boss));
        draw_select_marks(&mut frame, theme_rgb(boss));
        frame
    }

    /// 이상 개체 편성 화면.
    pub fn squad_screen(width: u32, height: u32, boss: Boss) -> Frame {
        let mut frame = canvas(width, height, BACKGROUND);
        fill(&mut frame, STRIP, theme_rgb(boss));
        draw_squad_marks(&mut frame, theme_rgb(boss));
        frame
    }

    /// 요격 횟수를 다 쓴 날의 보스 선택 화면: `도전하기` 단추만 `colour`로 칠한다(글자는 그대로 흰색).
    pub fn spent_select_screen(width: u32, height: u32, boss: Boss, colour: [u8; 3]) -> Frame {
        let mut frame = select_screen(width, height, boss);
        fill(&mut frame, BUTTON, colour);
        fill(&mut frame, BUTTON_TEXT, WHITE);
        frame
    }

    /// 요격 횟수를 다 쓴 날의 편성 화면: `전투 진입` 단추만 `colour`로 칠한다.
    pub fn spent_squad_screen(width: u32, height: u32, boss: Boss, colour: [u8; 3]) -> Frame {
        let mut frame = squad_screen(width, height, boss);
        fill(&mut frame, ENTER, colour);
        frame
    }

    /// 모든 채널에 `factor`를 곱한다(밝기 변화).
    pub fn brighten(frame: &Frame, factor: f32) -> Frame {
        Frame {
            width: frame.width,
            height: frame.height,
            rgb: frame
                .rgb
                .iter()
                .map(|&v| (f32::from(v) * factor).round().clamp(0.0, 255.0) as u8)
                .collect(),
        }
    }

    /// 채널마다 -amplitude..=amplitude의 잡음을 더한다. 같은 `seed`면 같은 결과다(선형 합동 난수).
    pub fn add_noise(frame: &Frame, amplitude: i32, seed: u64) -> Frame {
        let mut state = seed;
        let span = (2 * amplitude + 1) as u64;
        Frame {
            width: frame.width,
            height: frame.height,
            rgb: frame
                .rgb
                .iter()
                .map(|&v| {
                    state = state
                        .wrapping_mul(6_364_136_223_846_793_005)
                        .wrapping_add(1_442_695_040_888_963_407);
                    let delta = ((state >> 33) % span) as i32 - amplitude;
                    (i32::from(v) + delta).clamp(0, 255) as u8
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::synth::*;
    use super::*;

    /// 16:9 프레임 크기들: 라벨 캡처의 0.34배쯤부터 4K까지.
    const SIZES: [(u32, u32); 7] = [
        (640, 360),
        (1129, 635),
        (1280, 720),
        (1881, 1058),
        (1920, 1080),
        (2212, 1244),
        (3840, 2160),
    ];

    fn tally_of(samples: u32, theme: &[(Boss, u32)], blue: u32, red: u32) -> Tally {
        let mut tally = Tally {
            samples,
            blue,
            red,
            ..Tally::default()
        };
        for (boss, count) in theme {
            tally.theme[boss.index()] = *count;
        }
        tally
    }

    /// 천 점 중 `count`점이 이 보스의 색인 자리.
    fn themed(boss: Boss, count: u32) -> Tally {
        tally_of(1000, &[(boss, count)], 0, 0)
    }

    /// 캡처에서 잰 값만큼 뚜렷한 선택 화면.
    fn select_readings(boss: Boss) -> Readings {
        Readings {
            strip: themed(boss, 980),
            button: themed(boss, 850),
            chevron_left: themed(boss, 450),
            chevron_right: themed(boss, 460),
            tab_intercept: tally_of(1000, &[], 0, 0),
            tab_anomaly: tally_of(1000, &[], 0, 600),
            ..Readings::default()
        }
    }

    /// 캡처에서 잰 값만큼 뚜렷한 편성 화면.
    fn squad_readings(boss: Boss) -> Readings {
        Readings {
            strip: themed(boss, 980),
            bar_left: themed(boss, 700),
            bar_right: themed(boss, 680),
            info_left: themed(boss, 550),
            info_right: themed(boss, 600),
            mock: tally_of(1000, &[], 950, 0),
            enter: tally_of(1000, &[], 0, 850),
            // 편성 화면에서는 탭 자리에 `전투 진입` 단추가 걸친다.
            tab_intercept: tally_of(1000, &[], 0, 700),
            tab_anomaly: tally_of(1000, &[], 0, 800),
            ..Readings::default()
        }
    }

    fn assert_unknown(verdict: &Verdict, expected_reason: &str) {
        assert_eq!(verdict.screen, ScreenKind::Unknown, "{verdict:?}");
        assert_eq!(verdict.boss, None, "{verdict:?}");
        assert_eq!(verdict.confidence, 0.0, "{verdict:?}");
        let last = verdict.evidence.last().expect("근거가 있어야 한다");
        assert!(last.starts_with("→ 판단하지 않는다"), "{last}");
        assert!(last.contains(expected_reason), "{last}");
    }

    // ── 색 ──

    #[test]
    fn hsv_of_primary_and_grey_colours() {
        assert_eq!(
            hsv(255, 0, 0),
            Hsv {
                hue: 0.0,
                sat: 1.0,
                val: 1.0
            }
        );
        assert_eq!(hsv(0, 255, 0).hue, 120.0);
        assert_eq!(hsv(0, 0, 255).hue, 240.0);
        assert_eq!(hsv(255, 255, 0).hue, 60.0);
        assert_eq!(hsv(255, 0, 255).hue, 300.0);
        // 파랑이 조금 섞인 빨강은 360 바로 아래다(음수가 되지 않는다).
        let wine = hsv(255, 0, 17);
        assert!(wine.hue > 355.0 && wine.hue < 360.0, "{wine:?}");
        // 무채색.
        for v in [0u8, 77, 255] {
            let grey = hsv(v, v, v);
            assert_eq!((grey.hue, grey.sat), (0.0, 0.0));
            assert_eq!(grey.val, f32::from(v) / 255.0);
        }
        // 어두운 색도 채도는 그대로다.
        assert_eq!(hsv(40, 0, 0).sat, 1.0);
        assert!((hsv(128, 64, 64).sat - 0.5).abs() < 1e-6);
    }

    #[test]
    fn hue_range_includes_both_ends_and_wraps_around_zero() {
        let green = HueRange::new(129.0, 157.0);
        assert!(green.contains(129.0) && green.contains(143.0) && green.contains(157.0));
        assert!(!green.contains(128.9) && !green.contains(157.1));
        let red = HueRange::new(348.0, 6.0);
        for inside in [348.0, 359.9, 0.0, 6.0] {
            assert!(red.contains(inside), "{inside}");
        }
        for outside in [347.9, 6.1, 20.0, 180.0] {
            assert!(!red.contains(outside), "{outside}");
        }
    }

    #[test]
    fn theme_hue_ranges_do_not_overlap_and_leave_gaps() {
        for hue in 0..3600 {
            let hue = hue as f32 / 10.0;
            let owners: Vec<Boss> = Boss::ALL
                .into_iter()
                .filter(|boss| boss.hue().contains(hue))
                .collect();
            assert!(owners.len() <= 1, "{hue}° — {owners:?}");
        }
        // 빨강(하베스터)과 주황(크라켄) 사이, 모의전 파랑과 테마 파랑 사이는 어느 보스의 것도 아니다.
        for between in [10.0, 13.0, 19.0, 198.0, 204.5, 240.0, 300.0, 90.0] {
            assert!(
                Boss::ALL.iter().all(|boss| !boss.hue().contains(between)),
                "{between}"
            );
        }
        assert!(!Boss::MirrorContainer.hue().contains(ACTION_BLUE.to));
        assert!(!ACTION_BLUE.contains(Boss::MirrorContainer.hue().from));
    }

    #[test]
    fn representative_theme_colours_belong_to_their_boss() {
        for boss in Boss::ALL {
            let [r, g, b] = theme_rgb(boss);
            assert_eq!(theme_of(r, g, b), Some(boss), "{boss:?}");
        }
        // 캡처에서 본 다른 밝기의 같은 색(편성 화면의 어두운 띠, 밝은 단추).
        assert_eq!(theme_of(3, 113, 45), Some(Boss::Indivilia));
        assert_eq!(theme_of(29, 216, 104), Some(Boss::Indivilia));
        assert_eq!(theme_of(72, 28, 132), Some(Boss::Ultra));
        assert_eq!(theme_of(155, 82, 232), Some(Boss::Ultra));
        assert_eq!(theme_of(204, 32, 42), Some(Boss::Harvester));
        assert_eq!(theme_of(139, 77, 2), Some(Boss::Kraken));
        assert_eq!(theme_of(37, 128, 232), Some(Boss::MirrorContainer));
        // 단추 색·흰색·회색·배경은 어느 보스의 색도 아니다.
        for [r, g, b] in [MOCK_BLUE, WHITE, GREY, BACKGROUND, [255, 0, 255], [255, 255, 0]] {
            assert_eq!(theme_of(r, g, b), None, "{r},{g},{b}");
        }
    }

    #[test]
    fn theme_needs_enough_saturation_and_value() {
        // 초록(색상 143° 근처)에서 채도만 바꾼다: 채도 = 1 - 최소/최대.
        assert_eq!(theme_of(110, 200, 144), Some(Boss::Indivilia)); // 채도 0.45
        assert_eq!(theme_of(112, 200, 146), None); // 채도 0.44
        // 명도만 바꾼다: 51/255 = 0.2.
        assert_eq!(theme_of(0, 51, 20), Some(Boss::Indivilia));
        assert_eq!(theme_of(0, 50, 20), None);
    }

    #[test]
    fn tally_counts_theme_blue_and_red_separately() {
        let mut tally = Tally::default();
        for [r, g, b] in [
            theme_rgb(Boss::Kraken),
            theme_rgb(Boss::Kraken),
            theme_rgb(Boss::Harvester),
            MOCK_BLUE,
            ENTER_RED,
            TAB_RED,
            WHITE,
            BACKGROUND,
        ] {
            tally.add(r, g, b);
        }
        assert_eq!(tally.samples, 8);
        assert_eq!(tally.theme[Boss::Kraken.index()], 2);
        // 탭의 빨강은 하베스터의 테마 빨강과 색상이 같다 — 색이 아니라 자리로 가른다.
        // 전투 진입의 주홍(7°)은 단추 빨강이지만 테마 색은 아니다.
        assert_eq!(tally.theme[Boss::Harvester.index()], 2);
        assert_eq!(tally.blue, 1);
        assert_eq!(tally.red, 3);
        assert_eq!(tally.theme_share(Boss::Kraken), 0.25);
        assert_eq!(tally.blue_share(), 0.125);
        assert_eq!(tally.red_share(), 0.375);
        // 어두운 테마 색(명도 0.5 미만)은 단추 색으로 세지 않는다.
        let mut dark = Tally::default();
        dark.add(100, 0, 4);
        assert_eq!((dark.theme[Boss::Harvester.index()], dark.red), (1, 0));
        // 빈 집계의 몫은 0이다(0으로 나누지 않는다).
        assert_eq!(Tally::default().theme_share(Boss::Ultra), 0.0);
        assert_eq!(Tally::default().red_share(), 0.0);
    }

    // ── 자리 ──

    #[test]
    fn regions_stay_inside_the_frame_and_sample_a_fixed_number_of_points() {
        for region in regions::ALL {
            assert!(0.0 <= region.x0 && region.x0 < region.x1 && region.x1 <= 1.0, "{region:?}");
            assert!(0.0 <= region.y0 && region.y0 < region.y1 && region.y1 <= 1.0, "{region:?}");
            for (width, height) in SIZES {
                for (i, j) in [(0, 0), (region.nx - 1, region.ny - 1)] {
                    let (x, y) = region.pixel(i, j, width, height);
                    assert!(x < width && y < height, "{region:?} {width}×{height}");
                }
            }
        }
        // 아래 띠 자리는 둥근 창 모서리(24px)를 피한다.
        let (x, _) = regions::STRIP.pixel(0, 0, 640, 360);
        assert!(x >= 24, "{x}");
        assert_eq!(
            SAMPLES_PER_FRAME,
            regions::ALL.iter().map(Region::samples).sum::<u32>()
        );
    }

    #[test]
    fn one_recognition_samples_the_same_few_points_whatever_the_frame_size() {
        // 프레임 전체를 훑지 않는다: 찍어 보는 점은 몇천 개뿐이고 해상도가 커져도 늘지 않는다.
        const { assert!(SAMPLES_PER_FRAME < 3000) };
        for (width, height) in SIZES {
            let readings = measure(&select_screen(width, height, Boss::Ultra));
            assert_eq!(readings.samples(), SAMPLES_PER_FRAME, "{width}×{height}");
        }
        // 가장 큰 프레임에서 픽셀 수의 0.1%도 안 된다.
        assert!(u64::from(SAMPLES_PER_FRAME) * 1000 < 3840 * 2160);
    }

    #[test]
    fn region_pixel_maps_cell_centres_to_pixels() {
        let region = Region::new(0.25, 0.5, 0.75, 1.0, 2, 2);
        // 칸의 가운데: x = 0.375, 0.625 / y = 0.625, 0.875.
        assert_eq!(region.pixel(0, 0, 100, 100), (37, 62));
        assert_eq!(region.pixel(1, 1, 100, 100), (62, 87));
        assert_eq!(region.pixel(1, 1, 8, 8), (5, 7));
        // 프레임 밖으로 나가지 않는다.
        let edge = Region::new(0.9, 0.9, 1.0, 1.0, 1, 1);
        assert_eq!(edge.pixel(0, 0, 1, 1), (0, 0));
        // 빈 프레임은 찍지 않는다.
        let empty = Frame {
            width: 0,
            height: 0,
            rgb: Vec::new(),
        };
        assert_eq!(region.tally(&empty), Tally::default());
    }

    // ── 한 자리 읽기 ──

    #[test]
    fn read_theme_boundaries() {
        let boss = Boss::Kraken;
        // 기준에 딱 닿으면 뚜렷하다, 한 점 모자라면 약하다.
        assert_eq!(
            read_theme(&themed(boss, 700), STRIP_MIN),
            ThemeRead::Clear { boss, share: 0.7 }
        );
        assert_eq!(
            read_theme(&themed(boss, 699), STRIP_MIN),
            ThemeRead::Weak { boss, share: 0.699 }
        );
        // '없다'의 경계.
        assert_eq!(
            read_theme(&themed(boss, 80), STRIP_MIN),
            ThemeRead::Weak { boss, share: 0.08 }
        );
        assert_eq!(read_theme(&themed(boss, 79), STRIP_MIN), ThemeRead::Absent);
        assert_eq!(read_theme(&Tally::default(), STRIP_MIN), ThemeRead::Absent);
        // 자리마다 기준이 다르다.
        assert!(read_theme(&themed(boss, 300), CHEVRON_MIN).clear().is_some());
        assert!(read_theme(&themed(boss, 300), BUTTON_MIN).clear().is_none());
    }

    #[test]
    fn read_theme_reports_two_bosses_as_mixed() {
        let mix = |first: u32, second: u32| {
            read_theme(
                &tally_of(1000, &[(Boss::Indivilia, first), (Boss::Ultra, second)], 0, 0),
                STRIP_MIN,
            )
        };
        // 둘째가 첫째의 1/4 이상이면 섞인 것이다 — 첫째가 기준을 넘어도.
        assert_eq!(
            mix(720, 180),
            ThemeRead::Mixed {
                first: Boss::Indivilia,
                second: Boss::Ultra
            }
        );
        assert_eq!(
            mix(500, 500),
            ThemeRead::Mixed {
                first: Boss::Indivilia,
                second: Boss::Ultra
            }
        );
        assert_eq!(
            mix(300, 600),
            ThemeRead::Mixed {
                first: Boss::Ultra,
                second: Boss::Indivilia
            }
        );
        // 1/4에 못 미치면 첫째만 본다.
        assert_eq!(
            mix(720, 179),
            ThemeRead::Clear {
                boss: Boss::Indivilia,
                share: 0.72
            }
        );
        // 둘 다 아주 적으면 없는 것이다.
        assert_eq!(mix(50, 40), ThemeRead::Absent);
    }

    // ── 판정 함수 ──

    #[test]
    fn decide_recognises_each_boss_on_both_screens() {
        for boss in Boss::ALL {
            let select = decide(&select_readings(boss));
            assert_eq!(select.screen, ScreenKind::AnomalySelect, "{select:?}");
            assert_eq!(select.boss, Some(boss));
            assert_eq!(select.confidence, 1.0);
            let squad = decide(&squad_readings(boss));
            assert_eq!(squad.screen, ScreenKind::AnomalySquad, "{squad:?}");
            assert_eq!(squad.boss, Some(boss));
            assert_eq!(squad.confidence, 1.0);
        }
    }

    #[test]
    fn decide_explains_what_it_saw() {
        let select = decide(&select_readings(Boss::Indivilia));
        let text = select.evidence.join("\n");
        for part in [
            "아래 띠 초록 98%",
            "도전하기 단추 초록 85%",
            "왼쪽 화살표 초록 45%",
            "오른쪽 화살표 초록 46%",
            "이상 개체 요격전 쪽 60%",
            "→ 이상 개체 보스 선택 화면, 보스 인디빌리아(테마 색 초록)",
        ] {
            assert!(text.contains(part), "{part} — {text}");
        }
        let squad = decide(&squad_readings(Boss::MirrorContainer));
        let text = squad.evidence.join("\n");
        for part in [
            "아래 띠 파랑 98%",
            "이름 칸 왼쪽 막대 파랑 70%",
            "정보 칸 오른쪽 날개 파랑 60%",
            "모의전 단추 파랑 95%",
            "전투 진입 단추 빨강 85%",
            "→ 이상 개체 편성 화면, 보스 미러 컨테이너(테마 색 파랑)",
        ] {
            assert!(text.contains(part), "{part} — {text}");
        }
    }

    #[test]
    fn decide_says_other_when_the_bottom_strip_has_no_theme_colour() {
        let blank = decide(&Readings::default());
        assert_eq!(blank.screen, ScreenKind::Other);
        assert_eq!(blank.boss, None);
        assert_eq!(blank.confidence, 1.0);
        assert!(blank.evidence.last().unwrap().contains("이상 개체 요격전 화면이 아니다"));
        assert!(blank.evidence[0].contains("테마 색 띠가 없다"), "{blank:?}");

        // 일반 개체 편성 화면처럼 모의전·전투 진입 단추만 있는 화면.
        let stage = Readings {
            mock: tally_of(1000, &[], 600, 0),
            enter: tally_of(1000, &[], 0, 700),
            tab_intercept: tally_of(1000, &[], 0, 400),
            tab_anomaly: tally_of(1000, &[], 0, 450),
            ..Readings::default()
        };
        assert_eq!(decide(&stage).screen, ScreenKind::Other);

        // 아래 띠 자리에 테마 색이 조금(기준 미만) 보이면 신뢰도가 내려간다.
        let faint = Readings {
            strip: themed(Boss::Kraken, 40),
            ..Readings::default()
        };
        let verdict = decide(&faint);
        assert_eq!(verdict.screen, ScreenKind::Other);
        assert_eq!(verdict.confidence, 0.75);
        // 경계: 79/1000까지 other, 80/1000부터는 '띠가 약하게 보인다' — 모른다.
        let below = Readings {
            strip: themed(Boss::Kraken, 79),
            ..Readings::default()
        };
        assert_eq!(decide(&below).screen, ScreenKind::Other);
        let at = Readings {
            strip: themed(Boss::Kraken, 80),
            ..Readings::default()
        };
        assert_unknown(&decide(&at), "다 갖춰지지 않았다");
    }

    #[test]
    fn decide_boundaries_of_each_select_mark() {
        let boss = Boss::Harvester;
        let base = select_readings(boss);
        let ok = |readings: Readings| decide(&readings).screen == ScreenKind::AnomalySelect;
        // 기준에 딱 닿으면 인정한다(신뢰도는 0.5로 내려간다).
        let edge = Readings {
            strip: themed(boss, 700),
            button: themed(boss, 550),
            chevron_left: themed(boss, 250),
            chevron_right: themed(boss, 250),
            tab_anomaly: tally_of(1000, &[], 0, 350),
            tab_intercept: tally_of(1000, &[], 0, 100),
            ..base
        };
        let verdict = decide(&edge);
        assert_eq!((verdict.screen, verdict.boss), (ScreenKind::AnomalySelect, Some(boss)));
        assert_eq!(verdict.confidence, 0.5);
        // 필수 표지가 하나라도 한 점 모자라면 모른다.
        for short in [
            Readings { strip: themed(boss, 699), ..edge },
            Readings { chevron_left: themed(boss, 249), ..edge },
            Readings { chevron_right: themed(boss, 249), ..edge },
            Readings { tab_anomaly: tally_of(1000, &[], 0, 349), ..edge },
            Readings { tab_intercept: tally_of(1000, &[], 0, 101), ..edge },
        ] {
            assert!(!ok(short), "{short:?}");
            assert_eq!(decide(&short).screen, ScreenKind::Unknown);
            assert_eq!(decide(&short).boss, None);
        }
        assert!(ok(base));
        // `도전하기` 단추는 필수가 아니다(P-023): 기준에 한 점 모자라도 나머지 표지로 인식하고 그 사실을 적는다.
        let dim_button = decide(&Readings { button: themed(boss, 549), ..edge });
        assert_eq!(
            (dim_button.screen, dim_button.boss),
            (ScreenKind::AnomalySelect, Some(boss)),
            "{dim_button:?}"
        );
        assert_eq!(dim_button.confidence, 0.5);
        assert!(
            dim_button.evidence.join("\n").contains("도전하기 단추의 테마 색이 평소보다 적다(빨강 55%"),
            "{dim_button:?}"
        );
    }

    #[test]
    fn decide_boundaries_of_each_squad_mark() {
        let boss = Boss::Ultra;
        let base = squad_readings(boss);
        let edge = Readings {
            strip: themed(boss, 700),
            bar_left: themed(boss, 350),
            bar_right: themed(boss, 350),
            info_left: themed(boss, 280),
            info_right: themed(boss, 280),
            mock: tally_of(1000, &[], 700, 0),
            enter: tally_of(1000, &[], 0, 550),
            ..base
        };
        let verdict = decide(&edge);
        assert_eq!((verdict.screen, verdict.boss), (ScreenKind::AnomalySquad, Some(boss)));
        assert_eq!(verdict.confidence, 0.5);
        for short in [
            Readings { strip: themed(boss, 699), ..edge },
            Readings { bar_left: themed(boss, 349), ..edge },
            Readings { bar_right: themed(boss, 349), ..edge },
            Readings { info_left: themed(boss, 279), ..edge },
            Readings { info_right: themed(boss, 279), ..edge },
            Readings { mock: tally_of(1000, &[], 699, 0), ..edge },
        ] {
            let verdict = decide(&short);
            assert_eq!(verdict.screen, ScreenKind::Unknown, "{short:?}");
            assert_eq!(verdict.boss, None);
        }
        // `전투 진입` 단추의 빨강은 필수가 아니다(P-023): 기준에 한 점 모자라도 나머지 표지로 인식하고 그 사실을 적는다.
        let dim_enter = decide(&Readings { enter: tally_of(1000, &[], 0, 549), ..edge });
        assert_eq!(
            (dim_enter.screen, dim_enter.boss),
            (ScreenKind::AnomalySquad, Some(boss)),
            "{dim_enter:?}"
        );
        assert_eq!(dim_enter.confidence, 0.5);
        assert!(
            dim_enter.evidence.join("\n").contains("전투 진입 단추가 빨강이 아니다(빨강 55%, 평소 55% 이상)"),
            "{dim_enter:?}"
        );
    }

    // ── 전투로 들어가는 단추는 필수 표지가 아니다 (P-023) ──

    #[test]
    fn decide_recognises_the_squad_screen_when_the_enter_button_is_not_red() {
        for boss in Boss::ALL {
            // 2026-11-12 실제 게임(인디빌리아 편성 화면, 요격 횟수 소진 추정)에서 읽힌 값: 빨강 0%.
            for red in [0, 100, 549] {
                let spent = Readings {
                    enter: tally_of(1000, &[], 0, red),
                    // 단추가 빨강이 아니면 그 위에 걸친 탭 자리도 빨강이 아니다.
                    tab_intercept: tally_of(1000, &[], 0, 0),
                    tab_anomaly: tally_of(1000, &[], 0, 0),
                    ..squad_readings(boss)
                };
                let verdict = decide(&spent);
                assert_eq!(
                    (verdict.screen, verdict.boss),
                    (ScreenKind::AnomalySquad, Some(boss)),
                    "빨강 {red}/1000 {verdict:?}"
                );
                // 나머지 표지가 아무리 뚜렷해도 신뢰도는 상한을 넘지 않는다.
                assert_eq!(verdict.confidence, WITHOUT_BUTTON_CONFIDENCE, "{verdict:?}");
                let text = verdict.evidence.join("\n");
                assert!(text.contains("전투 진입 단추가 빨강이 아니다"), "{text}");
                assert!(text.contains("필수 표지가 아니어서 나머지 표지"), "{text}");
                assert!(
                    verdict.evidence.last().unwrap().starts_with("→ 이상 개체 편성 화면"),
                    "{text}"
                );
            }
        }
        // 사용자가 본 값 그대로: 아래 띠 초록 100%, 막대 69%·77%, 날개 64%·47%, 모의전 파랑 95%, 전투 진입 빨강 0%.
        let reported = Readings {
            strip: themed(Boss::Indivilia, 1000),
            bar_left: themed(Boss::Indivilia, 690),
            bar_right: themed(Boss::Indivilia, 770),
            info_left: themed(Boss::Indivilia, 640),
            info_right: themed(Boss::Indivilia, 470),
            mock: tally_of(1000, &[], 950, 0),
            ..Readings::default()
        };
        let verdict = decide(&reported);
        assert_eq!(
            (verdict.screen, verdict.boss),
            (ScreenKind::AnomalySquad, Some(Boss::Indivilia)),
            "{verdict:?}"
        );
        assert!(verdict.evidence.join("\n").contains("전투 진입 단추가 빨강이 아니다(빨강 0%"));
        // 단추가 빨강이면 그런 말을 하지 않고 상한도 없다.
        let usual = decide(&squad_readings(Boss::Indivilia));
        assert!(!usual.evidence.join("\n").contains("빨강이 아니다"), "{usual:?}");
        assert_eq!(usual.confidence, 1.0);
        assert_eq!(usual.evidence.len(), 3);
    }

    #[test]
    fn decide_recognises_the_select_screen_when_the_challenge_button_has_no_theme_colour() {
        for boss in Boss::ALL {
            for button in [Tally::default(), tally_of(1000, &[], 0, 0), themed(boss, 79), themed(boss, 300)] {
                let spent = Readings { button, ..select_readings(boss) };
                let verdict = decide(&spent);
                assert_eq!(
                    (verdict.screen, verdict.boss),
                    (ScreenKind::AnomalySelect, Some(boss)),
                    "{button:?} {verdict:?}"
                );
                assert_eq!(verdict.confidence, WITHOUT_BUTTON_CONFIDENCE, "{verdict:?}");
                let text = verdict.evidence.join("\n");
                assert!(text.contains("도전하기 단추"), "{text}");
                assert!(text.contains("필수 표지가 아니어서 나머지 표지(아래 띠·좌우 화살표·아래 탭)"), "{text}");
                assert!(
                    verdict.evidence.last().unwrap().starts_with("→ 이상 개체 보스 선택 화면"),
                    "{text}"
                );
            }
        }
        let grey = decide(&Readings { button: Tally::default(), ..select_readings(Boss::Kraken) });
        assert!(grey.evidence.join("\n").contains("도전하기 단추가 테마 색이 아니다"), "{grey:?}");
        // 단추가 제 색이면 그런 말을 하지 않는다.
        let usual = decide(&select_readings(Boss::Kraken));
        assert!(!usual.evidence.join("\n").contains("필수 표지가 아니어서"), "{usual:?}");
        assert_eq!(usual.evidence.len(), 3);
    }

    #[test]
    fn a_challenge_button_in_another_boss_colour_is_still_unknown() {
        let boss = Boss::Harvester;
        for (button, said) in [
            // 다른 보스의 색이 뚜렷하다.
            (themed(Boss::Kraken, 850), "도전하기 단추는 주황(크라켄) 색인데 좌우 화살표는 빨강(하베스터) 색이다"),
            // 다른 보스의 색이 조금(기준 미만) 보인다 — 그래도 다른 보스를 가리킨다.
            (themed(Boss::Ultra, 200), "도전하기 단추는 보라(울트라) 색인데"),
            // 두 보스의 색이 섞였다.
            (
                tally_of(1000, &[(Boss::Harvester, 500), (Boss::MirrorContainer, 400)], 0, 0),
                "도전하기 단추에 두 보스의 색(빨강·파랑)이 섞여 있다",
            ),
        ] {
            let verdict = decide(&Readings { button, ..select_readings(boss) });
            assert_unknown(&verdict, "다 갖춰지지 않았다");
            assert!(verdict.evidence.last().unwrap().contains(said), "{verdict:?}");
        }
    }

    #[test]
    fn a_missing_required_mark_is_unknown_whatever_the_button_looks_like() {
        let boss = Boss::MirrorContainer;
        // 선택 화면: 단추가 테마 색이 아닌데 필수 표지까지 하나 빠졌다(= 평소 표지에서 둘이 빠졌다).
        let spent_select = Readings { button: Tally::default(), ..select_readings(boss) };
        for short in [
            Readings { strip: Tally::default(), ..spent_select },
            Readings { strip: themed(boss, 400), ..spent_select },
            Readings { chevron_left: Tally::default(), ..spent_select },
            Readings { chevron_right: themed(boss, 249), ..spent_select },
            Readings { tab_anomaly: tally_of(1000, &[], 0, 0), ..spent_select },
            Readings { tab_intercept: tally_of(1000, &[], 0, 600), ..spent_select },
            // 필수 표지가 다른 보스를 가리킨다.
            Readings { chevron_left: themed(Boss::Ultra, 450), ..spent_select },
            Readings { strip: themed(Boss::Ultra, 980), ..spent_select },
        ] {
            let verdict = decide(&short);
            assert_eq!((verdict.screen, verdict.boss), (ScreenKind::Unknown, None), "{short:?}");
        }
        // 편성 화면: 전투 진입이 빨강이 아닌데 필수 표지까지 하나 빠졌다.
        let spent_squad = Readings {
            enter: Tally::default(),
            tab_intercept: Tally::default(),
            tab_anomaly: Tally::default(),
            ..squad_readings(boss)
        };
        for short in [
            Readings { strip: Tally::default(), ..spent_squad },
            Readings { bar_left: Tally::default(), ..spent_squad },
            Readings { bar_right: themed(boss, 349), ..spent_squad },
            Readings { info_left: Tally::default(), ..spent_squad },
            Readings { info_right: themed(boss, 279), ..spent_squad },
            Readings { mock: tally_of(1000, &[], 699, 0), ..spent_squad },
            Readings { mock: Tally::default(), ..spent_squad },
            Readings { bar_right: themed(Boss::Kraken, 700), ..spent_squad },
            Readings { strip: themed(Boss::Kraken, 980), ..spent_squad },
        ] {
            let verdict = decide(&short);
            assert_eq!((verdict.screen, verdict.boss), (ScreenKind::Unknown, None), "{short:?}");
        }
        // 단추가 제 색이어도 필수 표지 둘이 빠지면 모른다.
        for short in [
            Readings {
                chevron_left: Tally::default(),
                chevron_right: Tally::default(),
                ..select_readings(boss)
            },
            Readings {
                bar_left: Tally::default(),
                info_right: Tally::default(),
                ..squad_readings(boss)
            },
            Readings {
                mock: Tally::default(),
                info_left: Tally::default(),
                ..squad_readings(boss)
            },
        ] {
            let verdict = decide(&short);
            assert_eq!((verdict.screen, verdict.boss), (ScreenKind::Unknown, None), "{short:?}");
        }
        // 단추만 남고 아래 띠도 없으면(일반 개체 편성 화면처럼) 이상 개체 화면이 아니다.
        let only_buttons = Readings {
            mock: tally_of(1000, &[], 950, 0),
            enter: tally_of(1000, &[], 0, 850),
            ..Readings::default()
        };
        assert_eq!(decide(&only_buttons).screen, ScreenKind::Other);
    }

    #[test]
    fn confidence_follows_the_weakest_mark() {
        let boss = Boss::Kraken;
        // 단추만 기준과 대표값의 가운데(0.70): 0.5 + 0.5 × 0.5.
        let middling = Readings {
            button: themed(boss, 700),
            ..select_readings(boss)
        };
        assert!((decide(&middling).confidence - 0.75).abs() < 1e-4);
        // 요격전 쪽 탭에 빨강이 5%: (0.10 - 0.05) / 0.10 = 0.5.
        let tab = Readings {
            tab_intercept: tally_of(1000, &[], 0, 50),
            ..select_readings(boss)
        };
        assert!((decide(&tab).confidence - 0.75).abs() < 1e-4);
        // 편성 화면: 아래 띠가 0.80 → (0.80 - 0.70) / 0.25 = 0.4.
        let strip = Readings {
            strip: themed(boss, 800),
            ..squad_readings(boss)
        };
        assert!((decide(&strip).confidence - 0.70).abs() < 1e-4);
    }

    #[test]
    fn decide_refuses_when_marks_of_two_bosses_are_mixed() {
        // 아래 띠는 인디빌리아, 선택 화면의 표지는 울트라.
        let split = Readings {
            strip: themed(Boss::Indivilia, 980),
            ..select_readings(Boss::Ultra)
        };
        assert_unknown(&decide(&split), "두 보스의 특징이 섞였다");
        assert!(decide(&split).evidence.last().unwrap().contains("인디빌리아"));
        assert!(decide(&split).evidence.last().unwrap().contains("울트라"));
        // 표지끼리 보스가 다르다.
        let chevron = Readings {
            chevron_right: themed(Boss::Kraken, 450),
            ..select_readings(Boss::Harvester)
        };
        assert_unknown(&decide(&chevron), "다 갖춰지지 않았다");
        let bar = Readings {
            bar_right: themed(Boss::MirrorContainer, 700),
            ..squad_readings(Boss::Indivilia)
        };
        assert_unknown(&decide(&bar), "다 갖춰지지 않았다");
        // 한 자리 안에 두 색.
        let button = Readings {
            button: tally_of(1000, &[(Boss::Harvester, 600), (Boss::Kraken, 250)], 0, 0),
            ..select_readings(Boss::Harvester)
        };
        assert_unknown(&decide(&button), "다 갖춰지지 않았다");
        assert!(decide(&button).evidence.join("\n").contains("도전하기 단추 빨강·주황 섞임"));
        let strip = Readings {
            strip: tally_of(1000, &[(Boss::Ultra, 500), (Boss::MirrorContainer, 480)], 0, 0),
            ..squad_readings(Boss::Ultra)
        };
        assert_unknown(&decide(&strip), "아래 띠에 두 보스의 색이 섞여 있다");
    }

    #[test]
    fn decide_refuses_incomplete_or_contradictory_layouts() {
        let boss = Boss::Indivilia;
        // 두 화면의 표지가 함께 보인다.
        let both = Readings {
            button: themed(boss, 850),
            chevron_left: themed(boss, 450),
            chevron_right: themed(boss, 450),
            tab_intercept: tally_of(1000, &[], 0, 0),
            tab_anomaly: tally_of(1000, &[], 0, 600),
            ..squad_readings(boss)
        };
        assert_unknown(&decide(&both), "표지가 함께 보인다");
        // 표지는 다 있는데 아래 띠가 없다(무엇이 아래를 가렸다) — other가 아니라 모른다.
        let no_strip = Readings {
            strip: Tally::default(),
            ..select_readings(boss)
        };
        assert_unknown(&decide(&no_strip), "아래 띠의 테마 색이 기준에 못 미친다");
        let weak_strip = Readings {
            strip: themed(boss, 400),
            ..squad_readings(boss)
        };
        assert_unknown(&decide(&weak_strip), "아래 띠의 테마 색이 기준에 못 미친다");
        // 아래 띠만 있다(다른 화면에 같은 색 띠가 있을 때).
        let only_strip = Readings {
            strip: themed(boss, 980),
            ..Readings::default()
        };
        assert_unknown(&decide(&only_strip), "다 갖춰지지 않았다");
        // 탭이 반대(요격전 쪽이 빨강)면 선택 화면이 아니다.
        let wrong_tab = Readings {
            tab_intercept: tally_of(1000, &[], 0, 600),
            tab_anomaly: tally_of(1000, &[], 0, 0),
            ..select_readings(boss)
        };
        assert_unknown(&decide(&wrong_tab), "다 갖춰지지 않았다");
    }

    // ── 합성 이미지 ──

    #[test]
    fn synthetic_screens_are_recognised_for_every_boss_at_every_size() {
        for (width, height) in SIZES {
            for boss in Boss::ALL {
                let select = recognize(&select_screen(width, height, boss));
                assert_eq!(
                    (select.screen, select.boss),
                    (ScreenKind::AnomalySelect, Some(boss)),
                    "{width}×{height} {select:?}"
                );
                assert!(select.confidence >= 0.5, "{select:?}");
                assert_eq!((select.width, select.height), (width, height));
                let squad = recognize(&squad_screen(width, height, boss));
                assert_eq!(
                    (squad.screen, squad.boss),
                    (ScreenKind::AnomalySquad, Some(boss)),
                    "{width}×{height} {squad:?}"
                );
                assert!(squad.confidence >= 0.5, "{squad:?}");
            }
        }
    }

    #[test]
    fn synthetic_non_anomaly_screens_are_other() {
        for (width, height) in SIZES {
            // 어두운 화면, 밝은 화면.
            for background in [BACKGROUND, WHITE, GREY, [14, 18, 40]] {
                let plain = recognize(&canvas(width, height, background));
                assert_eq!((plain.screen, plain.boss), (ScreenKind::Other, None), "{plain:?}");
                assert!(plain.confidence >= 0.5);
            }
            // 일반 개체 편성 화면처럼 모의전·전투 진입 단추가 있지만 아래 띠가 없다.
            let mut stage = canvas(width, height, [40, 40, 42]);
            fill(&mut stage, MOCK, MOCK_BLUE);
            fill(&mut stage, ENTER, ENTER_RED);
            assert_eq!(recognize(&stage).screen, ScreenKind::Other);
            // 요격전 탭: 요격전 쪽 탭이 빨강.
            let mut map = canvas(width, height, BACKGROUND);
            fill(&mut map, TAB_INTERCEPT, TAB_RED);
            fill(&mut map, TAB_ANOMALY, GREY);
            assert_eq!(recognize(&map).screen, ScreenKind::Other);
        }
    }

    // ── 합성 이미지: 요격 횟수를 다 쓴 화면 (P-023) ──

    /// 횟수를 다 쓴 단추로 그려 보는 색들. 실제 색은 모른다 — 회색 계열과, 단추 색 기준에 못 미치는 어두운 색.
    const SPENT_COLOURS: [[u8; 3]; 4] = [SPENT_GREY, GREY, [200, 200, 204], [58, 44, 46]];

    #[test]
    fn squad_screen_with_a_grey_enter_button_is_recognised() {
        for (width, height) in SIZES {
            for boss in Boss::ALL {
                for colour in SPENT_COLOURS {
                    let seen = recognize(&spent_squad_screen(width, height, boss, colour));
                    assert_eq!(
                        (seen.screen, seen.boss),
                        (ScreenKind::AnomalySquad, Some(boss)),
                        "{width}×{height} {colour:?} {seen:?}"
                    );
                    assert!(
                        (0.5..=WITHOUT_BUTTON_CONFIDENCE).contains(&seen.confidence),
                        "{seen:?}"
                    );
                    let text = seen.evidence.join("\n");
                    assert!(text.contains("전투 진입 단추가 빨강이 아니다(빨강 0%"), "{text}");
                    assert!(text.contains("필수 아님 — 전투 진입 단추 빨강 0%"), "{text}");
                }
            }
        }
        // 단추가 아예 없어도(배경색) 같다.
        let mut erased = squad_screen(1881, 1058, Boss::Ultra);
        fill(&mut erased, ENTER, BACKGROUND);
        let seen = recognize(&erased);
        assert_eq!((seen.screen, seen.boss), (ScreenKind::AnomalySquad, Some(Boss::Ultra)), "{seen:?}");
        // 평소의 빨강 단추면 그 말이 없고 신뢰도에 상한도 없다.
        let usual = recognize(&squad_screen(1881, 1058, Boss::Ultra));
        assert!(!usual.evidence.join("\n").contains("빨강이 아니다"), "{usual:?}");
        assert!(usual.confidence > WITHOUT_BUTTON_CONFIDENCE, "{usual:?}");
    }

    #[test]
    fn select_screen_with_a_grey_challenge_button_is_recognised() {
        for (width, height) in SIZES {
            for boss in Boss::ALL {
                for colour in SPENT_COLOURS {
                    let seen = recognize(&spent_select_screen(width, height, boss, colour));
                    assert_eq!(
                        (seen.screen, seen.boss),
                        (ScreenKind::AnomalySelect, Some(boss)),
                        "{width}×{height} {colour:?} {seen:?}"
                    );
                    assert!(
                        (0.5..=WITHOUT_BUTTON_CONFIDENCE).contains(&seen.confidence),
                        "{seen:?}"
                    );
                    let text = seen.evidence.join("\n");
                    assert!(text.contains("도전하기 단추가 테마 색이 아니다"), "{text}");
                    assert!(text.contains("필수 아님 — 도전하기 단추 테마 색 없음"), "{text}");
                }
            }
        }
        // 단추가 아예 없어도(배경색) 같다.
        let mut erased = select_screen(1881, 1058, Boss::Kraken);
        fill(&mut erased, BUTTON, BACKGROUND);
        let seen = recognize(&erased);
        assert_eq!((seen.screen, seen.boss), (ScreenKind::AnomalySelect, Some(Boss::Kraken)), "{seen:?}");
        // 같은 보스 색이 어둡게만 남은 단추(명도가 기준 위)는 평소처럼 읽힌다.
        let dimmed = spent_select_screen(1881, 1058, Boss::Indivilia, [0, 88, 33]);
        let seen = recognize(&dimmed);
        assert_eq!((seen.screen, seen.boss), (ScreenKind::AnomalySelect, Some(Boss::Indivilia)), "{seen:?}");
        assert!(!seen.evidence.join("\n").contains("필수 표지가 아니어서"), "{seen:?}");
    }

    #[test]
    fn spent_screens_survive_brightness_and_weak_noise() {
        for (width, height) in [(960, 540), (1366, 768), (1881, 1058)] {
            for boss in Boss::ALL {
                for (kind, frame) in [
                    (ScreenKind::AnomalySelect, spent_select_screen(width, height, boss, SPENT_GREY)),
                    (ScreenKind::AnomalySquad, spent_squad_screen(width, height, boss, SPENT_GREY)),
                ] {
                    for (label, variant) in [
                        ("밝기 -10%", brighten(&frame, 0.9)),
                        ("밝기 +10%", brighten(&frame, 1.1)),
                        ("잡음 ±12", add_noise(&frame, 12, 41)),
                        ("밝기 -10% + 잡음", add_noise(&brighten(&frame, 0.9), 6, 13)),
                    ] {
                        let seen = recognize(&variant);
                        assert_eq!(
                            (seen.screen, seen.boss),
                            (kind, Some(boss)),
                            "{label} {width}×{height}: {seen:?}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn spent_screens_mixing_two_bosses_are_still_unknown() {
        let (width, height) = (1881, 1058);
        for (first, second) in [
            (Boss::Indivilia, Boss::Ultra),
            (Boss::Harvester, Boss::Kraken),
            (Boss::MirrorContainer, Boss::Indivilia),
        ] {
            // 아래 띠는 한 보스, 나머지 표지는 다른 보스 — 단추가 회색이어도 모른다.
            let mut select = canvas(width, height, BACKGROUND);
            fill(&mut select, STRIP, theme_rgb(first));
            draw_select_marks(&mut select, theme_rgb(second));
            fill(&mut select, BUTTON, SPENT_GREY);
            let seen = recognize(&select);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
            let mut squad = canvas(width, height, BACKGROUND);
            fill(&mut squad, STRIP, theme_rgb(first));
            draw_squad_marks(&mut squad, theme_rgb(second));
            fill(&mut squad, ENTER, SPENT_GREY);
            let seen = recognize(&squad);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
            // 좌우 화살표·막대의 색이 서로 다르다.
            let mut chevrons = spent_select_screen(width, height, first, SPENT_GREY);
            fill(&mut chevrons, CHEVRON_RIGHT, theme_rgb(second));
            let seen = recognize(&chevrons);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
            let mut wings = spent_squad_screen(width, height, first, SPENT_GREY);
            fill(&mut wings, INFO_LEFT, theme_rgb(second));
            let seen = recognize(&wings);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
            // `도전하기` 단추가 통째로 다른 보스의 색이다 — 단추는 필수가 아니지만 다른 보스를 가리키면 모른다.
            let other_button = spent_select_screen(width, height, first, theme_rgb(second));
            let seen = recognize(&other_button);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
            assert!(seen.evidence.last().unwrap().contains("도전하기 단추는"), "{seen:?}");
        }
    }

    #[test]
    fn screens_without_marks_stay_other_whatever_the_buttons_look_like() {
        for (width, height) in SIZES {
            // 로비처럼 표지가 하나도 없는 화면: 여러 색 덩어리가 있어도 아래 띠·표지 자리는 비어 있다.
            let mut lobby = canvas(width, height, [24, 26, 30]);
            fill(&mut lobby, [120.0, 90.0, 520.0, 300.0], [230, 190, 60]);
            fill(&mut lobby, [1400.0, 120.0, 1800.0, 420.0], [40, 160, 220]);
            fill(&mut lobby, [1500.0, 700.0, 1850.0, 760.0], WHITE);
            let seen = recognize(&lobby);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Other, None), "{width}×{height} {seen:?}");
            // 일반 개체 편성 화면: 모의전·전투 진입 단추가 있고 아래 띠가 없다 — 전투 진입이 빨강이든 회색이든.
            for enter in [ENTER_RED, SPENT_GREY, BACKGROUND] {
                let mut stage = canvas(width, height, [40, 40, 42]);
                fill(&mut stage, MOCK, MOCK_BLUE);
                fill(&mut stage, ENTER, enter);
                let seen = recognize(&stage);
                assert_eq!((seen.screen, seen.boss), (ScreenKind::Other, None), "{enter:?} {seen:?}");
            }
            // 요격전 탭(일반·특수 개체 선택): 요격전 쪽 탭이 빨강, 표지는 없다.
            let mut map = canvas(width, height, BACKGROUND);
            fill(&mut map, TAB_INTERCEPT, TAB_RED);
            fill(&mut map, TAB_ANOMALY, GREY);
            fill(&mut map, [300.0, 300.0, 700.0, 700.0], [150, 150, 156]);
            let seen = recognize(&map);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Other, None), "{seen:?}");
            // 이상 개체 탭이 빨강이고 가운데에 회색 단추만 있는 화면(띠·화살표 없음)도 이상 개체 화면이 아니다.
            let mut tabs_only = canvas(width, height, BACKGROUND);
            fill(&mut tabs_only, TAB_INTERCEPT, GREY);
            fill(&mut tabs_only, TAB_ANOMALY, TAB_RED);
            fill(&mut tabs_only, BUTTON, SPENT_GREY);
            let seen = recognize(&tabs_only);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Other, None), "{seen:?}");
        }
    }

    #[test]
    fn brightness_and_weak_noise_do_not_change_the_answer() {
        for (width, height) in [(960, 540), (1366, 768)] {
            for boss in Boss::ALL {
                for (kind, frame) in [
                    (ScreenKind::AnomalySelect, select_screen(width, height, boss)),
                    (ScreenKind::AnomalySquad, squad_screen(width, height, boss)),
                ] {
                    let variants = [
                        ("밝기 -10%", brighten(&frame, 0.9)),
                        ("밝기 +10%", brighten(&frame, 1.1)),
                        ("잡음 ±6", add_noise(&frame, 6, 7)),
                        ("잡음 ±12", add_noise(&frame, 12, 99)),
                        ("밝기 -10% + 잡음", add_noise(&brighten(&frame, 0.9), 6, 3)),
                        ("밝기 +10% + 잡음", add_noise(&brighten(&frame, 1.1), 6, 5)),
                    ];
                    for (label, variant) in variants {
                        let seen = recognize(&variant);
                        assert_eq!(
                            (seen.screen, seen.boss),
                            (kind, Some(boss)),
                            "{label} {width}×{height}: {seen:?}"
                        );
                    }
                }
            }
            // 이상 개체가 아닌 화면도 그대로다.
            let dark = canvas(width, height, BACKGROUND);
            for variant in [brighten(&dark, 1.1), add_noise(&dark, 12, 1), brighten(&dark, 0.9)] {
                assert_eq!(recognize(&variant).screen, ScreenKind::Other);
            }
        }
    }

    #[test]
    fn images_mixing_two_bosses_are_unknown() {
        let (width, height) = (1881, 1058);
        let pairs = [
            (Boss::Indivilia, Boss::Ultra),
            (Boss::Harvester, Boss::Kraken),
            (Boss::Kraken, Boss::Harvester),
            (Boss::MirrorContainer, Boss::Ultra),
            (Boss::Ultra, Boss::Harvester),
        ];
        for (first, second) in pairs {
            // 아래 띠는 한 보스, 선택 화면의 표지는 다른 보스.
            let mut select = canvas(width, height, BACKGROUND);
            fill(&mut select, STRIP, theme_rgb(first));
            draw_select_marks(&mut select, theme_rgb(second));
            let seen = recognize(&select);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
            assert_eq!(seen.confidence, 0.0);
            assert!(seen.evidence.last().unwrap().contains("섞였다"), "{seen:?}");

            // 편성 화면도 같다.
            let mut squad = canvas(width, height, BACKGROUND);
            fill(&mut squad, STRIP, theme_rgb(first));
            draw_squad_marks(&mut squad, theme_rgb(second));
            let seen = recognize(&squad);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");

            // 아래 띠가 반반(보스를 넘기는 도중처럼).
            let mut half = select_screen(width, height, first);
            fill(&mut half, [940.0, 1047.0, 1881.0, 1058.0], theme_rgb(second));
            let seen = recognize(&half);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");

            // 좌우 막대의 색이 다르다.
            let mut bars = squad_screen(width, height, first);
            fill(&mut bars, BAR_RIGHT, theme_rgb(second));
            let seen = recognize(&bars);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");

            // 단추의 절반이 다른 보스 색.
            let mut button = select_screen(width, height, first);
            fill(&mut button, [941.0, 836.0, 1044.0, 890.0], theme_rgb(second));
            let seen = recognize(&button);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
        }
        // 두 화면의 표지가 한 프레임에. 실제 게임에서는 두 화면의 단추 자리가 겹친다(모의전 ↔ 도전하기,
        // 전투 진입 ↔ 아래 탭) — 편성 화면의 표지를 먼저 그리고 그 위에 선택 화면의 표지를 다시 그려 둘 다 살린다.
        let mut both = squad_screen(width, height, Boss::Kraken);
        fill(&mut both, [1021.0, 936.0, 1059.0, 979.0], GREY);
        draw_select_marks(&mut both, theme_rgb(Boss::Kraken));
        let seen = recognize(&both);
        assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{seen:?}");
        assert!(seen.evidence.last().unwrap().contains("표지가 함께 보인다"), "{seen:?}");
    }

    #[test]
    fn partial_screens_are_unknown_not_guessed() {
        let (width, height) = (1881, 1058);
        let boss = Boss::Harvester;
        // 선택 화면에서 필수 표지 하나씩을 지운다 — 단추가 제 색이든(평소) 회색이든(횟수 소진) 모른다.
        // (`도전하기` 단추만 지운 화면은 P-023부터 인식한다 — 아래 「요격 횟수를 다 쓴 화면」 테스트.)
        for erased in [CHEVRON_LEFT, CHEVRON_RIGHT, TAB_ANOMALY, STRIP] {
            for mut frame in [
                select_screen(width, height, boss),
                spent_select_screen(width, height, boss, SPENT_GREY),
            ] {
                fill(&mut frame, erased, BACKGROUND);
                let seen = recognize(&frame);
                assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{erased:?} {seen:?}");
            }
        }
        // 편성 화면에서 필수 표지 하나씩을 지운다(`전투 진입` 단추만 지운 화면은 인식한다).
        for erased in [BAR_LEFT, BAR_RIGHT, INFO_LEFT, INFO_RIGHT, MOCK, STRIP] {
            for mut frame in [
                squad_screen(width, height, boss),
                spent_squad_screen(width, height, boss, SPENT_GREY),
            ] {
                fill(&mut frame, erased, BACKGROUND);
                let seen = recognize(&frame);
                assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{erased:?} {seen:?}");
            }
        }
        // 필수 표지 둘이 빠졌다.
        for (first, second) in [
            (CHEVRON_LEFT, CHEVRON_RIGHT),
            (CHEVRON_RIGHT, TAB_ANOMALY),
            (CHEVRON_LEFT, TAB_ANOMALY),
        ] {
            let mut frame = select_screen(width, height, boss);
            fill(&mut frame, first, BACKGROUND);
            fill(&mut frame, second, BACKGROUND);
            let seen = recognize(&frame);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{first:?} {second:?} {seen:?}");
        }
        for (first, second) in [
            (BAR_LEFT, BAR_RIGHT),
            (INFO_LEFT, MOCK),
            (BAR_RIGHT, INFO_RIGHT),
            (BAR_LEFT, INFO_LEFT),
        ] {
            let mut frame = squad_screen(width, height, boss);
            fill(&mut frame, first, BACKGROUND);
            fill(&mut frame, second, BACKGROUND);
            let seen = recognize(&frame);
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{first:?} {second:?} {seen:?}");
        }
        // 화면 전체가 어두워졌다(팝업 뒤): 테마 색의 명도가 기준 아래로 — 틀린 보스를 말하지 않는다.
        let dimmed = brighten(&select_screen(width, height, boss), 0.25);
        let seen = recognize(&dimmed);
        assert_eq!(seen.boss, None, "{seen:?}");
        assert_ne!(seen.screen, ScreenKind::AnomalySelect);
        // 테마 색이 아닌 색(자홍)의 띠와 표지.
        let mut magenta = canvas(width, height, BACKGROUND);
        fill(&mut magenta, STRIP, [255, 0, 255]);
        draw_select_marks(&mut magenta, [255, 0, 255]);
        assert_eq!(recognize(&magenta).boss, None);
    }

    #[test]
    fn frames_with_another_aspect_ratio_are_unknown() {
        // 4:3, 16:10, 21:9, 32:9, 세로 화면 — 선택 화면을 그 크기로 그려도 판단하지 않는다.
        for (width, height) in [
            (1600, 1200),
            (1024, 768),
            (1680, 1050),
            (2560, 1080),
            (3440, 1440),
            (3840, 1080),
            (1080, 1920),
        ] {
            let seen = recognize(&select_screen(width, height, Boss::Indivilia));
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{width}×{height}");
            assert_eq!(seen.confidence, 0.0);
            assert_eq!(seen.evidence.len(), 1);
            assert!(seen.evidence[0].contains("화면 비율"), "{seen:?}");
            assert!(seen.evidence[0].contains("지원하지 않는다"), "{seen:?}");
            assert_eq!((seen.width, seen.height), (width, height));
        }
        // 16:9에서 조금 벗어난 창 크기(1366×768, 창 모드의 1881×1058)는 받는다.
        for (width, height) in [(1366, 768), (1360, 768), (1881, 1058), (1600, 900), (1920, 1060)] {
            assert_eq!(unsupported_reason(&canvas(width, height, BACKGROUND)), None, "{width}×{height}");
        }
        // 허용 오차의 경계(3%): 1.778 × 1.03 = 1.831.
        assert_eq!(unsupported_reason(&canvas(1830, 1000, BACKGROUND)), None);
        assert!(unsupported_reason(&canvas(1832, 1000, BACKGROUND)).is_some());
        assert_eq!(unsupported_reason(&canvas(1725, 1000, BACKGROUND)), None);
        assert!(unsupported_reason(&canvas(1724, 1000, BACKGROUND)).is_some());
    }

    #[test]
    fn broken_or_tiny_frames_are_unknown() {
        let empty = Frame {
            width: 0,
            height: 0,
            rgb: Vec::new(),
        };
        let seen = recognize(&empty);
        assert_eq!((seen.screen, seen.boss, seen.confidence), (ScreenKind::Unknown, None, 0.0));
        assert!(seen.evidence[0].contains("프레임이 비어 있다"), "{seen:?}");

        // 픽셀 수가 크기와 맞지 않는다.
        let mut short = select_screen(1280, 720, Boss::Ultra);
        short.rgb.truncate(1000);
        let seen = recognize(&short);
        assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None));
        assert!(seen.evidence[0].contains("픽셀 수가 크기와 맞지 않는다"), "{seen:?}");

        // 너무 작은 프레임.
        for (width, height) in [(320, 180), (639, 360), (640, 359)] {
            let seen = recognize(&select_screen(width, height, Boss::Ultra));
            assert_eq!((seen.screen, seen.boss), (ScreenKind::Unknown, None), "{width}×{height}");
            assert!(seen.evidence[0].contains("너무 작다"), "{seen:?}");
        }
    }

    #[test]
    fn recognition_serialises_to_the_documented_shape() {
        let seen = recognize(&select_screen(1280, 720, Boss::MirrorContainer));
        let json = serde_json::to_value(&seen).unwrap();
        let keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["screen", "boss", "confidence", "evidence", "width", "height"]);
        assert_eq!(json["screen"], "anomaly_select");
        assert_eq!(
            json["boss"],
            serde_json::json!({ "id": "mirror_container", "name": "미러 컨테이너" })
        );
        assert!(json["confidence"].as_f64().unwrap() >= 0.5);
        assert!(json["evidence"].as_array().unwrap().len() >= 3);
        assert_eq!((json["width"].as_u64(), json["height"].as_u64()), (Some(1280), Some(720)));
        // 신뢰도는 소수 둘째 자리까지다.
        let text = serde_json::to_string(&seen).unwrap();
        let confidence = text.split("\"confidence\":").nth(1).unwrap().split(',').next().unwrap();
        assert!(confidence.len() <= 4, "{confidence}");

        let squad = serde_json::to_value(recognize(&squad_screen(1280, 720, Boss::Kraken))).unwrap();
        assert_eq!(squad["screen"], "anomaly_squad");
        assert_eq!(squad["boss"]["id"], "kraken");
        let other = serde_json::to_value(recognize(&canvas(1280, 720, BACKGROUND))).unwrap();
        assert_eq!(other["screen"], "other");
        assert!(other["boss"].is_null());
        let unknown = serde_json::to_value(recognize(&canvas(800, 800, BACKGROUND))).unwrap();
        assert_eq!(unknown["screen"], "unknown");
        assert!(unknown["boss"].is_null());
        assert_eq!(unknown["confidence"], 0.0);
    }

    #[test]
    fn boss_ids_and_names_match_the_boss_bundle() {
        // data/intercept/anomaly.json의 id·name과 같아야 추천 결과와 이어진다.
        let bundle = include_str!("../../../data/intercept/anomaly.json");
        let json: serde_json::Value = serde_json::from_str(bundle).unwrap();
        let listed: Vec<(String, String)> = json["bosses"]
            .as_array()
            .unwrap()
            .iter()
            .map(|boss| {
                (
                    boss["id"].as_str().unwrap().to_string(),
                    boss["name"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        let ours: Vec<(String, String)> = Boss::ALL
            .iter()
            .map(|boss| (boss.id().to_string(), boss.name().to_string()))
            .collect();
        assert_eq!(ours, listed);
        for (i, boss) in Boss::ALL.into_iter().enumerate() {
            assert_eq!(boss.index(), i);
        }
    }
}
