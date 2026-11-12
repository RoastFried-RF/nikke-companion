//! 라벨 붙은 **실제 게임 캡처**로 화면 인식(`recognize`)을 확인한다.
//!
//! 캡처는 사용자 계정의 게임 화면이라 저장소에 없다(`data/captures/`는 gitignore). 그래서 `#[ignore]`다 —
//! 캡처와 라벨(`data/captures/labels.json`)이 있는 PC에서만 돈다. 없으면 이유를 말하고 실패한다:
//!
//! ```bash
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_recognize -- --ignored
//! cargo test --release --manifest-path app/src-tauri/Cargo.toml --test live_recognize -- --ignored --nocapture   # 걸린 시간을 본다
//! ```
//!
//! 게임은 필요 없다(저장해 둔 PNG만 읽는다). 캡처 폴더는 `NIKKE_CAPTURE_DIR` → 저장소의 `data/captures`.
//!
//! 확인하는 것:
//! - 라벨 캡처 전부에서 정답: `anomaly_select`·`anomaly_squad`는 화면 종류와 보스가 맞고, 나머지(로비·요격전 탭·
//!   일반/특수 개체 편성)는 `other`이고 보스가 없다
//! - 전투로 들어가는 단추(`도전하기`·`전투 진입`) 자리만 회색으로 덧칠해도 같은 답이다 — 요격 횟수를 다 쓴 날을
//!   흉내 낸 것이다(P-023. 그 상태의 실제 캡처는 아직 없다)
//! - 0.6배·0.8배·1.25배로 다시 샘플링해도(가까운 픽셀·쌍선형) 같은 답이다
//! - 밝기 ±10%·약한 잡음에서도 같은 답이다
//! - 4:3·21:9로 자르거나 늘린 프레임은 틀린 답 대신 `unknown`이다
//! - 인식 한 번에 걸리는 시간(출력한다)
//!
//! 합성 이미지로 하는 단위 테스트(판정 함수·경계값·섞인 이미지)는 `src/recognize.rs`에 있고 캡처 없이 돈다.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Instant;

use nikke_companion_lib::capture::{default_capture_dir, load_png, Frame};
use nikke_companion_lib::recognize::{recognize, Recognition, ScreenKind, SAMPLES_PER_FRAME};

const LABELS_FILE: &str = "labels.json";

/// 라벨 하나와 그 캡처.
struct Labeled {
    file: String,
    /// 라벨의 화면 종류(`anomaly_select`, `anomaly_squad`, `lobby`, `intercept_map`, …).
    screen: String,
    /// 라벨의 보스 이름. 이상 개체 화면이 아니면 그 화면의 보스이거나 없다.
    boss: Option<String>,
    frame: Frame,
}

impl Labeled {
    /// 인식이 내야 하는 답: 이상 개체 화면이면 그 화면과 보스, 그 밖은 `other`와 보스 없음.
    fn expected(&self) -> (ScreenKind, Option<&str>) {
        match self.screen.as_str() {
            "anomaly_select" => (ScreenKind::AnomalySelect, self.boss.as_deref()),
            "anomaly_squad" => (ScreenKind::AnomalySquad, self.boss.as_deref()),
            _ => (ScreenKind::Other, None),
        }
    }

    fn is_anomaly(&self) -> bool {
        self.expected().0 != ScreenKind::Other
    }
}

fn capture_dir() -> PathBuf {
    default_capture_dir().unwrap_or_else(|e| panic!("캡처 폴더를 정하지 못했다: {e}"))
}

/// 라벨과 캡처를 읽는다(테스트들이 한 번만 읽어 함께 쓴다). 없으면 이유를 말하고 실패한다.
fn captures() -> &'static [Labeled] {
    static CAPTURES: OnceLock<Vec<Labeled>> = OnceLock::new();
    CAPTURES.get_or_init(|| {
        let dir = capture_dir();
        let labels_path = dir.join(LABELS_FILE);
        let text = std::fs::read_to_string(&labels_path).unwrap_or_else(|e| {
            panic!(
                "라벨 캡처가 없다: {} ({e}).\n이 테스트는 사용자 계정의 게임 화면 캡처와 라벨이 있어야 돈다 — 캡처는 \
                 저장소에 올리지 않는다(data/captures는 gitignore). 게임에서 이상 개체 요격전 화면을 \
                 `nikke-capture --name <라벨>`로 찍고 labels.json에 화면 종류와 보스를 적은 뒤에 돌려라.",
                labels_path.display()
            )
        });
        let labels: serde_json::Value = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("{}을 읽지 못했다: {e}", labels_path.display()));
        let listed = labels["captures"]
            .as_array()
            .unwrap_or_else(|| panic!("{}에 captures 목록이 없다", labels_path.display()));
        listed
            .iter()
            .map(|entry| {
                let file = entry["file"]
                    .as_str()
                    .unwrap_or_else(|| panic!("라벨에 file이 없다: {entry}"))
                    .to_string();
                let screen = entry["screen"]
                    .as_str()
                    .unwrap_or_else(|| panic!("라벨에 screen이 없다: {entry}"))
                    .to_string();
                let boss = entry["boss"].as_str().map(str::to_string);
                let path = dir.join(&file);
                let frame = load_png(&path).unwrap_or_else(|e| {
                    panic!("라벨에 적힌 캡처를 읽지 못했다(라벨만 있고 이미지가 없는가?): {e}")
                });
                Labeled {
                    file,
                    screen,
                    boss,
                    frame,
                }
            })
            .collect()
    })
}

fn seen_boss(seen: &Recognition) -> Option<&'static str> {
    seen.boss.map(|boss| boss.name())
}

/// 인식 결과가 라벨과 같은지 확인한다. `what`은 프레임을 어떻게 바꿨는지다.
fn assert_matches(label: &Labeled, seen: &Recognition, what: &str) {
    assert_eq!(
        (seen.screen, seen_boss(seen)),
        label.expected(),
        "{} [{what}] — 라벨: {} / {:?}\n근거:\n  {}",
        label.file,
        label.screen,
        label.boss,
        seen.evidence.join("\n  ")
    );
    if label.is_anomaly() {
        assert!(seen.confidence >= 0.5, "{} [{what}] {seen:?}", label.file);
    }
    assert!(!seen.evidence.is_empty(), "{} [{what}] 근거가 없다", label.file);
}

// ── 프레임 바꾸기 ─────────────────────────────────────────────────────────────

fn pixel(frame: &Frame, x: usize, y: usize) -> [u8; 3] {
    let at = (y * frame.width as usize + x) * 3;
    [frame.rgb[at], frame.rgb[at + 1], frame.rgb[at + 2]]
}

/// 가장 가까운 픽셀로 다시 샘플링한다.
fn resample_nearest(frame: &Frame, width: u32, height: u32) -> Frame {
    let (sw, sh) = (frame.width as usize, frame.height as usize);
    let xs: Vec<usize> = (0..width as usize)
        .map(|x| ((x * 2 + 1) * sw / (width as usize * 2)).min(sw - 1))
        .collect();
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for y in 0..height as usize {
        let sy = ((y * 2 + 1) * sh / (height as usize * 2)).min(sh - 1);
        for &sx in &xs {
            rgb.extend_from_slice(&pixel(frame, sx, sy));
        }
    }
    Frame { width, height, rgb }
}

/// 한 축의 쌍선형 보간 자리: (왼쪽 픽셀, 오른쪽 픽셀, 오른쪽의 무게 0~256).
fn linear_taps(src: usize, dst: usize) -> Vec<(usize, usize, u32)> {
    (0..dst)
        .map(|i| {
            let pos = ((i as f64 + 0.5) * src as f64 / dst as f64 - 0.5).clamp(0.0, (src - 1) as f64);
            let low = pos.floor() as usize;
            let high = (low + 1).min(src - 1);
            (low, high, ((pos - low as f64) * 256.0).round() as u32)
        })
        .collect()
}

/// 쌍선형 보간으로 다시 샘플링한다(픽셀 가운데 기준).
fn resample_bilinear(frame: &Frame, width: u32, height: u32) -> Frame {
    let xs = linear_taps(frame.width as usize, width as usize);
    let ys = linear_taps(frame.height as usize, height as usize);
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for &(y0, y1, wy) in &ys {
        for &(x0, x1, wx) in &xs {
            let (a, b, c, d) = (
                pixel(frame, x0, y0),
                pixel(frame, x1, y0),
                pixel(frame, x0, y1),
                pixel(frame, x1, y1),
            );
            for ch in 0..3 {
                let top = u32::from(a[ch]) * (256 - wx) + u32::from(b[ch]) * wx;
                let bottom = u32::from(c[ch]) * (256 - wx) + u32::from(d[ch]) * wx;
                rgb.push(((top * (256 - wy) + bottom * wy + (1 << 15)) >> 16) as u8);
            }
        }
    }
    Frame { width, height, rgb }
}

fn scaled_size(frame: &Frame, scale: f64) -> (u32, u32) {
    (
        (f64::from(frame.width) * scale).round() as u32,
        (f64::from(frame.height) * scale).round() as u32,
    )
}

/// 모든 채널에 `factor`를 곱한다.
fn brighten(frame: &Frame, factor: f32) -> Frame {
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

/// 채널마다 -amplitude..=amplitude의 잡음을 더한다(선형 합동 난수 — 같은 seed면 같은 결과).
fn add_noise(frame: &Frame, amplitude: i32, seed: u64) -> Frame {
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

/// 가운데를 `width` 너비로 잘라 낸다.
fn crop_centre(frame: &Frame, width: u32) -> Frame {
    let left = ((frame.width - width) / 2) as usize;
    let mut rgb = Vec::with_capacity(width as usize * frame.height as usize * 3);
    for y in 0..frame.height as usize {
        let from = (y * frame.width as usize + left) * 3;
        rgb.extend_from_slice(&frame.rgb[from..from + width as usize * 3]);
    }
    Frame {
        width,
        height: frame.height,
        rgb,
    }
}

/// 좌우에 검은 띠를 붙여 `width` 너비로 만든다(게임 화면은 가운데에 그대로).
fn pad_sides(frame: &Frame, width: u32) -> Frame {
    let left = ((width - frame.width) / 2) as usize;
    let mut rgb = vec![0; width as usize * frame.height as usize * 3];
    for y in 0..frame.height as usize {
        let from = y * frame.width as usize * 3;
        let to = (y * width as usize + left) * 3;
        rgb[to..to + frame.width as usize * 3]
            .copy_from_slice(&frame.rgb[from..from + frame.width as usize * 3]);
    }
    Frame {
        width,
        height: frame.height,
        rgb,
    }
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

const BOSSES: [&str; 5] = ["인디빌리아", "울트라", "하베스터", "크라켄", "미러 컨테이너"];

#[test]
#[ignore = "라벨 붙은 게임 캡처(data/captures/labels.json)가 필요하다"]
fn labels_cover_both_anomaly_screens_for_every_boss_and_some_other_screens() {
    let captures = captures();
    let count = |screen: &str| captures.iter().filter(|c| c.screen == screen).count();
    assert!(count("anomaly_select") >= 6, "보스 선택 화면 캡처가 모자란다: {}", count("anomaly_select"));
    assert!(count("anomaly_squad") >= 5, "편성 화면 캡처가 모자란다: {}", count("anomaly_squad"));
    let others: Vec<&str> = captures
        .iter()
        .filter(|c| !c.is_anomaly())
        .map(|c| c.screen.as_str())
        .collect();
    assert!(others.len() >= 5, "이상 개체가 아닌 화면 캡처가 모자란다: {others:?}");
    for needed in ["lobby", "intercept_map", "intercept_stage", "special_intercept_stage"] {
        assert!(others.contains(&needed), "{needed} 화면 캡처가 없다: {others:?}");
    }
    for screen in ["anomaly_select", "anomaly_squad"] {
        for boss in BOSSES {
            assert!(
                captures
                    .iter()
                    .any(|c| c.screen == screen && c.boss.as_deref() == Some(boss)),
                "{screen} 화면의 {boss} 캡처가 없다"
            );
        }
    }
}

#[test]
#[ignore = "라벨 붙은 게임 캡처(data/captures/labels.json)가 필요하다"]
fn every_labeled_capture_gets_the_right_screen_and_boss() {
    for label in captures() {
        let seen = recognize(&label.frame);
        println!(
            "{} ({}×{}) 라벨 {} / {:?} → {:?} / {:?}, 신뢰도 {}",
            label.file,
            label.frame.width,
            label.frame.height,
            label.screen,
            label.boss,
            seen.screen,
            seen_boss(&seen),
            seen.confidence
        );
        for line in &seen.evidence {
            println!("    {line}");
        }
        assert_matches(label, &seen, "원본");
        assert_eq!((seen.width, seen.height), (label.frame.width, label.frame.height));
        // 이상 개체가 아닌 화면에는 보스를 말하지 않는다.
        if !label.is_anomaly() {
            assert_eq!(seen.boss, None, "{}", label.file);
            assert_eq!(seen.screen, ScreenKind::Other, "{}", label.file);
        }
    }
}

/// 1881×1058 기준 픽셀 사각형 `[x0, y0, x1, y1)`을 이 프레임의 크기에 맞춰 한 색으로 덧칠한다.
fn paint(frame: &Frame, rect: [f64; 4], rgb: [u8; 3]) -> Frame {
    let mut out = Frame {
        width: frame.width,
        height: frame.height,
        rgb: frame.rgb.clone(),
    };
    let scale = |value: f64, reference: f64, size: u32| {
        ((value / reference * f64::from(size)).round().max(0.0) as u32).min(size)
    };
    let (x0, x1) = (scale(rect[0], 1881.0, out.width), scale(rect[2], 1881.0, out.width));
    let (y0, y1) = (scale(rect[1], 1058.0, out.height), scale(rect[3], 1058.0, out.height));
    for y in y0..y1 {
        for x in x0..x1 {
            let at = (y as usize * out.width as usize + x as usize) * 3;
            out.rgb[at..at + 3].copy_from_slice(&rgb);
        }
    }
    out
}

/// `도전하기` 단추(선택 화면)와 `전투 진입` 단추(편성 화면)의 자리 — `docs/intercept.md` §인식 근거.
const CHALLENGE_BUTTON: [f64; 4] = [835.0, 832.0, 1045.0, 893.0];
const ENTER_BUTTON: [f64; 4] = [962.0, 945.0, 1211.0, 1012.0];

/// 요격 횟수를 다 쓴 날에는 전투로 들어가는 단추의 색이 달라진다(P-023 — `전투 진입`이 빨강 0%였다). 그 상태의 캡처는
/// 아직 없어서, **실제 캡처의 단추 자리만 회색으로 덧칠해** 나머지 표지로 같은 답이 나오는지 본다. 실제 소진 화면이 아니다 —
/// 그 캡처를 찍어 라벨에 넣으면 `every_labeled_capture_gets_the_right_screen_and_boss`가 그대로 확인한다.
#[test]
#[ignore = "라벨 붙은 게임 캡처(data/captures/labels.json)가 필요하다"]
fn captures_with_the_battle_button_greyed_out_get_the_same_answer() {
    for label in captures() {
        for grey in [[118, 120, 124], [72, 72, 74], [200, 200, 204], [10, 10, 12]] {
            let (painted, said) = match label.screen.as_str() {
                "anomaly_select" => (
                    paint(&label.frame, CHALLENGE_BUTTON, grey),
                    Some("도전하기 단추가 테마 색이 아니다"),
                ),
                "anomaly_squad" => (
                    paint(&label.frame, ENTER_BUTTON, grey),
                    Some("전투 진입 단추가 빨강이 아니다(빨강 0%"),
                ),
                // 이상 개체가 아닌 화면은 두 자리를 다 칠해도 `other`다.
                _ => (
                    paint(&paint(&label.frame, CHALLENGE_BUTTON, grey), ENTER_BUTTON, grey),
                    None,
                ),
            };
            let what = format!("단추를 회색 {grey:?}로 덧칠");
            let seen = recognize(&painted);
            assert_matches(label, &seen, &what);
            if let Some(said) = said {
                let text = seen.evidence.join("\n");
                assert!(text.contains(said), "{} [{what}] 근거에 단추 이야기가 없다:\n{text}", label.file);
                assert!(text.contains("필수 표지가 아니어서"), "{} [{what}]\n{text}", label.file);
                assert!(seen.confidence <= 0.8, "{} [{what}] {seen:?}", label.file);
            }
            // 줄이고 밝기를 바꿔도 같다.
            let (width, height) = scaled_size(&painted, 0.6);
            let small = resample_bilinear(&painted, width, height);
            assert_matches(label, &recognize(&small), &format!("{what} + 0.6배"));
            assert_matches(label, &recognize(&brighten(&small, 0.9)), &format!("{what} + 0.6배 + 밝기 -10%"));
            assert_matches(
                label,
                &recognize(&add_noise(&painted, 8, 77)),
                &format!("{what} + 잡음 ±8"),
            );
        }
    }
}

#[test]
#[ignore = "라벨 붙은 게임 캡처(data/captures/labels.json)가 필요하다"]
fn resampled_captures_get_the_same_answer() {
    for label in captures() {
        for scale in [0.6, 0.8, 1.25] {
            let (width, height) = scaled_size(&label.frame, scale);
            assert_matches(
                label,
                &recognize(&resample_nearest(&label.frame, width, height)),
                &format!("{scale}배, 가까운 픽셀 → {width}×{height}"),
            );
            assert_matches(
                label,
                &recognize(&resample_bilinear(&label.frame, width, height)),
                &format!("{scale}배, 쌍선형 → {width}×{height}"),
            );
        }
        // 흔한 창 크기로도(비율이 조금 달라진다): 1280×720, 1920×1080.
        for (width, height) in [(1280, 720), (1920, 1080)] {
            assert_matches(
                label,
                &recognize(&resample_bilinear(&label.frame, width, height)),
                &format!("쌍선형 → {width}×{height}"),
            );
        }
    }
}

#[test]
#[ignore = "라벨 붙은 게임 캡처(data/captures/labels.json)가 필요하다"]
fn brightness_and_weak_noise_do_not_change_the_answer() {
    for (i, label) in captures().iter().enumerate() {
        let seed = 1000 + i as u64;
        for (what, frame) in [
            ("밝기 -10%", brighten(&label.frame, 0.9)),
            ("밝기 +10%", brighten(&label.frame, 1.1)),
            ("잡음 ±8", add_noise(&label.frame, 8, seed)),
            ("밝기 -10% + 잡음 ±8", add_noise(&brighten(&label.frame, 0.9), 8, seed + 1)),
            ("밝기 +10% + 잡음 ±8", add_noise(&brighten(&label.frame, 1.1), 8, seed + 2)),
        ] {
            assert_matches(label, &recognize(&frame), what);
        }
        // 줄인 뒤에 밝기를 바꿔도 같다.
        let (width, height) = scaled_size(&label.frame, 0.6);
        let small = resample_bilinear(&label.frame, width, height);
        assert_matches(label, &recognize(&brighten(&small, 0.9)), "0.6배 + 밝기 -10%");
        assert_matches(label, &recognize(&brighten(&small, 1.1)), "0.6배 + 밝기 +10%");
    }
}

#[test]
#[ignore = "라벨 붙은 게임 캡처(data/captures/labels.json)가 필요하다"]
fn frames_with_another_aspect_ratio_are_unknown_instead_of_wrong() {
    for label in captures() {
        let frame = &label.frame;
        let narrow = frame.height * 4 / 3; // 4:3
        let wide = frame.height * 21 / 9; // 21:9
        for (what, changed) in [
            ("가운데를 4:3으로 자름", crop_centre(frame, narrow)),
            ("4:3으로 눌러 줄임", resample_bilinear(frame, narrow, frame.height)),
            ("좌우에 검은 띠를 붙여 21:9", pad_sides(frame, wide)),
            ("21:9로 늘림", resample_bilinear(frame, wide, frame.height)),
        ] {
            let seen = recognize(&changed);
            assert_eq!(
                (seen.screen, seen.boss),
                (ScreenKind::Unknown, None),
                "{} [{what}] {}×{}: {seen:?}",
                label.file,
                changed.width,
                changed.height
            );
            assert_eq!(seen.confidence, 0.0);
            assert!(seen.evidence.iter().any(|line| line.contains("화면 비율")), "{seen:?}");
        }
    }
}

#[test]
#[ignore = "라벨 붙은 게임 캡처(data/captures/labels.json)가 필요하다"]
fn one_recognition_is_fast_and_looks_at_a_few_points_only() {
    let frames: Vec<&Frame> = captures()
        .iter()
        .map(|label| &label.frame)
        .filter(|frame| (frame.width, frame.height) == (1881, 1058))
        .collect();
    assert!(!frames.is_empty(), "1881×1058 캡처가 없다");
    const ROUNDS: usize = 200;
    // 첫 실행(캐시가 식은 상태)을 따로 잰다.
    let cold = Instant::now();
    let first = recognize(frames[0]);
    let cold = cold.elapsed();
    let started = Instant::now();
    let mut answered = 0usize;
    for _ in 0..ROUNDS {
        for frame in &frames {
            answered += usize::from(recognize(frame).screen != ScreenKind::Unknown);
        }
    }
    let elapsed = started.elapsed();
    let runs = ROUNDS * frames.len();
    let mean_us = elapsed.as_secs_f64() * 1e6 / runs as f64;
    let pixels = 1881u64 * 1058;
    println!(
        "인식 시간({} 빌드, 1881×1058 캡처 {}장 × {ROUNDS}회 = {runs}회): 평균 {mean_us:.1}µs, 첫 실행 {:.1}µs. \
         한 번에 {SAMPLES_PER_FRAME}점을 찍는다(프레임 {pixels}픽셀의 {:.3}%)",
        if cfg!(debug_assertions) { "디버그" } else { "릴리스" },
        frames.len(),
        cold.as_secs_f64() * 1e6,
        f64::from(SAMPLES_PER_FRAME) * 100.0 / pixels as f64
    );
    assert_eq!(answered, runs, "1881×1058 캡처는 모두 판단돼야 한다");
    assert_ne!(first.screen, ScreenKind::Unknown);
    // 프레임 전체를 훑지 않는다 — 찍어 보는 점이 픽셀 수의 1%도 안 된다.
    assert!(u64::from(SAMPLES_PER_FRAME) * 100 < pixels);
    // 넉넉한 상한(디버그 빌드, 느린 PC에서도): 프레임 전체를 한 번이라도 훑으면 디버그에서 수십 ms가 든다.
    assert!(mean_us < 5_000.0, "인식 한 번에 평균 {mean_us:.1}µs가 걸렸다");
}
