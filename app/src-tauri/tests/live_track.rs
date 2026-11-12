//! 자동 추적이 주기마다 하는 일(창 찍기 + 인식)이 한 번에 얼마나 걸리는지 실제 Windows.Graphics.Capture로 잰다.
//!
//! 자동 추적은 켜 둔 동안 2초(기본)마다 `game_window::capture_window` → `recognize::recognize`를 한 번씩 부른다.
//! 캡처는 Direct3D 장치와 캡처 대상을 한 번 만들어 다시 쓰고(첫 캡처에 그 비용이 든다), 프레임 풀과 세션은 부를 때마다
//! 새로 만든다. 잰 값과 그렇게 정한 까닭은 `app/README.md` §자동 추적 §걸리는 시간에 적는다.
//!
//! 화면이 켜진 Windows 데스크톱이 필요해서 `#[ignore]`다. 창들이 서로 가리지 않게 하나씩 돌린다:
//!
//! ```bash
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_track -- --ignored --nocapture --test-threads=1
//! cargo test --release --manifest-path app/src-tauri/Cargo.toml --test live_track -- --ignored --nocapture --test-threads=1
//! ```
//!
//! - `capture_cycle_time_on_a_test_window`: 이 테스트가 띄운 **자기 창**(게임 창 모드와 비슷한 크기)을 찍는다. 게임이 없어도 돈다.
//!   몇 초 동안 화면 왼쪽 위에 네 가지 색으로 칠한 창이 떴다 사라진다(활성화하지 않는다).
//!   횟수와 간격은 환경 변수 `NIKKE_TRACK_ROUNDS`(기본 12)·`NIKKE_TRACK_GAP_MS`(기본 500)로 바꾼다.
//! - `repeated_captures_follow_a_resized_window`: 다시 쓰는 캡처 대상이 창 크기가 바뀐 뒤에도 바뀐 화면 영역을 그대로 찍는다.
//! - `a_new_window_is_captured_after_the_old_one_is_gone`: 찍던 창이 없어지고 다른 창이 떠도 새 창이 찍힌다.
//! - `capture_cycle_time_on_the_game_window`: 실행 중인 니케의 창을 찍는다(읽기만 한다 — 저장하지 않는다). 게임 창이 떠 있어야 한다.
//!
//! 여기서 만들고 없애고 크기를 바꾸는 창은 이 테스트의 창뿐이다. 게임 창에는 아무것도 하지 않는다.

#![cfg(windows)]

use std::time::{Duration, Instant};

use nikke_companion_lib::capture::Frame;
use nikke_companion_lib::game_window::{
    capture_window, find_game_window, refresh_game_window, GameError, GameWindowInfo, ScreenRect,
};
use nikke_companion_lib::recognize::recognize;
use nikke_companion_lib::screen_track::{DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS};

/// 잴 횟수의 기본값. 더 오래 재려면 환경 변수 `NIKKE_TRACK_ROUNDS`로 정한다(드문 지연을 찾을 때).
const ROUNDS: usize = 12;
const ENV_ROUNDS: &str = "NIKKE_TRACK_ROUNDS";

fn rounds() -> usize {
    std::env::var(ENV_ROUNDS)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|n| *n >= 2)
        .unwrap_or(ROUNDS)
}
/// 캡처 사이에 쉬는 시간의 기본값(밀리초). 환경 변수 `NIKKE_TRACK_GAP_MS`로 바꾼다.
/// 기본값은 자동 추적이 받는 가장 짧은 주기다 — 그보다 촘촘하게 찍는 일은 앱에 없다.
const GAP_MS: u64 = MIN_INTERVAL_MS;
const ENV_GAP_MS: &str = "NIKKE_TRACK_GAP_MS";

fn gap() -> Duration {
    let ms = std::env::var(ENV_GAP_MS)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(GAP_MS);
    Duration::from_millis(ms)
}

struct Timing {
    capture_ms: Vec<f64>,
    recognize_us: Vec<f64>,
    frame: (u32, u32),
}

fn sorted(values: &[f64]) -> Vec<f64> {
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).expect("시간은 수다"));
    v
}

fn median(values: &[f64]) -> f64 {
    let v = sorted(values);
    v[v.len() / 2]
}

/// 같은 창을 여러 번 찍으며 캡처와 인식에 걸린 시간을 잰다. `between`은 캡처 사이에 할 일(메시지 돌리기 등).
fn time_cycles(window: &GameWindowInfo, mut between: impl FnMut(Duration)) -> Timing {
    let rounds = rounds();
    let gap = gap();
    println!("  {rounds}회, 캡처 사이 {}ms", gap.as_millis());
    let mut capture_ms = Vec::with_capacity(rounds);
    let mut recognize_us = Vec::with_capacity(rounds);
    let mut size = (0, 0);
    for round in 0..rounds {
        let started = Instant::now();
        let (frame, _method): (Frame, _) =
            capture_window(window).unwrap_or_else(|e| panic!("{round}번째 캡처가 실패했다: {e}"));
        let captured = started.elapsed();
        let started = Instant::now();
        let recognition = recognize(&frame);
        let recognized = started.elapsed();
        // 프레임은 여기서 버린다(저장하지 않는다).
        size = (frame.width, frame.height);
        drop(frame);
        capture_ms.push(captured.as_secs_f64() * 1000.0);
        recognize_us.push(recognized.as_secs_f64() * 1_000_000.0);
        println!(
            "  {:>2}회: 캡처 {:>7.1}ms · 인식 {:>6.0}µs · 화면 {:?}",
            round + 1,
            captured.as_secs_f64() * 1000.0,
            recognized.as_secs_f64() * 1_000_000.0,
            recognition.screen
        );
        between(gap);
    }
    Timing {
        capture_ms,
        recognize_us,
        frame: size,
    }
}

fn report(what: &str, timing: &Timing) {
    let capture = sorted(&timing.capture_ms);
    let first = timing.capture_ms[0];
    let rest = &timing.capture_ms[1..];
    println!(
        "{what}: 프레임 {}×{}, {}회 — 캡처 첫 회 {:.1}ms, 그 뒤 중앙값 {:.1}ms(최소 {:.1} · 최대 {:.1}), 전체 최대 {:.1}ms · 인식 중앙값 {:.0}µs",
        timing.frame.0,
        timing.frame.1,
        timing.capture_ms.len(),
        first,
        median(rest),
        sorted(rest)[0],
        sorted(rest)[rest.len() - 1],
        capture[capture.len() - 1],
        median(&timing.recognize_us),
    );
    let build = if cfg!(debug_assertions) { "디버그" } else { "릴리스" };
    println!(
        "  ({build} 빌드. 주기 기본 {DEFAULT_INTERVAL_MS}ms · 하한 {MIN_INTERVAL_MS}ms — 캡처 중앙값은 기본 주기의 {:.1}%)",
        median(rest) / DEFAULT_INTERVAL_MS as f64 * 100.0
    );
}

/// 주기 안에 들어오는가: 가장 느린 캡처도 주기의 하한보다 짧아야 주기가 밀리지 않는다.
fn assert_fits_the_interval(timing: &Timing) {
    let slowest = sorted(&timing.capture_ms)[timing.capture_ms.len() - 1];
    assert!(
        slowest < MIN_INTERVAL_MS as f64,
        "캡처 한 번이 {slowest:.0}ms 걸렸다 — 주기의 하한({MIN_INTERVAL_MS}ms)보다 길다"
    );
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 몇 초 띄운다)"]
fn capture_cycle_time_on_a_test_window() {
    // 게임의 창 모드(1881×1058 안팎)와 비슷한 크기. 화면이 작으면 Windows가 창을 줄일 수 있다 — 찍힌 크기를 함께 적는다.
    let window = desktop::TestWindow::framed(40, 40, 1920, 1100);
    window.pump(Duration::from_millis(500));
    let info = info_of(&window);
    println!("테스트 창: 화면 영역 {}×{}", info.client.width, info.client.height);

    let timing = time_cycles(&info, |d| window.pump(d));
    report("자기 창", &timing);
    assert_eq!(timing.frame, (info.client.width, info.client.height));
    assert_fits_the_interval(&timing);
}

/// 이 테스트의 창을 캡처 코드가 받는 모양으로 읽는다.
fn info_of(window: &desktop::TestWindow) -> GameWindowInfo {
    let seed = GameWindowInfo {
        hwnd: window.handle_value(),
        pid: std::process::id(),
        process_name: "live_track(test)".to_string(),
        title: String::new(),
        client: ScreenRect::default(),
        frame: ScreenRect::default(),
        minimized: false,
        foreground: false,
        scale_factor: 1.0,
    };
    refresh_game_window(&seed).expect("테스트 창을 읽지 못했다")
}

fn pixel(frame: &Frame, x: u32, y: u32) -> (u8, u8, u8) {
    let i = (y as usize * frame.width as usize + x as usize) * 3;
    (frame.rgb[i], frame.rgb[i + 1], frame.rgb[i + 2])
}

/// 네 구역으로 칠한 창이 통째로 찍혔는가: 크기가 화면 영역과 같고, 네 구역의 가운데가 각각 그 구역의 색이다.
fn assert_whole_window(frame: &Frame, info: &GameWindowInfo) {
    assert_eq!(
        (frame.width, frame.height),
        (info.client.width, info.client.height),
        "캡처한 크기가 화면 영역과 다르다"
    );
    let (w, h) = (frame.width, frame.height);
    let centres = [(w / 4, h / 4), (3 * w / 4, h / 4), (w / 4, 3 * h / 4), (3 * w / 4, 3 * h / 4)];
    for ((x, y), expected) in centres.into_iter().zip(desktop::QUADRANTS) {
        let actual = pixel(frame, x, y);
        let near = |a: u8, b: u8| a.abs_diff(b) <= 6;
        assert!(
            near(actual.0, expected.0) && near(actual.1, expected.1) && near(actual.2, expected.2),
            "({x}, {y})의 색이 {actual:?}다 — {expected:?}여야 한다"
        );
    }
}

/// 캡처용 장치와 캡처 대상은 한 번 만들어 다시 쓴다. 그 사이에 창 크기가 바뀌어도 바뀐 화면 영역이 그대로 찍힌다.
#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 몇 초 띄운다)"]
fn repeated_captures_follow_a_resized_window() {
    let window = desktop::TestWindow::framed(60, 60, 900, 600);
    window.pump(Duration::from_millis(400));
    let first = info_of(&window);
    for _ in 0..3 {
        let (frame, _) = capture_window(&first).unwrap_or_else(|e| panic!("캡처하지 못했다: {e}"));
        assert_whole_window(&frame, &first);
        window.pump(Duration::from_millis(60));
    }

    // 키웠다가 줄인다. 크기가 바뀐 직후의 캡처는 한 번 어긋날 수 있다(그때는 오류다 — 잘못된 프레임이 아니다).
    // 그 뒤에는 바뀐 크기로 찍혀야 한다.
    for (width, height) in [(1280, 760), (700, 520), (1100, 700)] {
        window.resize(width, height);
        window.pump(Duration::from_millis(400));
        let now = info_of(&window);
        assert_ne!(now.client, first.client, "창 크기가 바뀌지 않았다");
        let mut last_error = None;
        let frame = (0..3).find_map(|_| match capture_window(&now) {
            Ok((frame, _)) => Some(frame),
            Err(e) => {
                println!("  크기를 바꾼 직후: {e}");
                last_error = Some(e);
                window.pump(Duration::from_millis(200));
                None
            }
        });
        let frame = frame.unwrap_or_else(|| panic!("{width}×{height}로 바꾼 뒤 캡처하지 못했다: {last_error:?}"));
        assert_whole_window(&frame, &now);
        // 이어지는 캡처도 같은 크기로 찍힌다.
        let (again, _) = capture_window(&now).unwrap_or_else(|e| panic!("캡처하지 못했다: {e}"));
        assert_whole_window(&again, &now);
    }
}

/// 찍던 창이 없어지고 다른 창이 떠도(게임을 껐다 켠 것과 같다) 새 창이 찍힌다 — 옛 창의 캡처 대상을 붙들지 않는다.
#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 몇 초 띄운다)"]
fn a_new_window_is_captured_after_the_old_one_is_gone() {
    let old = desktop::TestWindow::framed(60, 60, 800, 560);
    old.pump(Duration::from_millis(400));
    let old_info = info_of(&old);
    let (frame, _) = capture_window(&old_info).unwrap_or_else(|e| panic!("캡처하지 못했다: {e}"));
    assert_whole_window(&frame, &old_info);
    drop(old);

    // 없어진 창은 「게임 없음」이다. 오류가 나도 다음 캡처는 된다.
    assert_eq!(capture_window(&old_info).map(|_| ()), Err(GameError::NotRunning));

    let new = desktop::TestWindow::framed(120, 100, 1000, 640);
    new.pump(Duration::from_millis(400));
    let new_info = info_of(&new);
    assert_ne!(new_info.hwnd, old_info.hwnd);
    for _ in 0..2 {
        let (frame, _) = capture_window(&new_info).unwrap_or_else(|e| panic!("새 창을 캡처하지 못했다: {e}"));
        assert_whole_window(&frame, &new_info);
        new.pump(Duration::from_millis(60));
    }
}

#[test]
#[ignore = "실행 중인 니케가 필요하다(게임 창이 떠 있어야 한다 — 최소화돼 있으면 실패한다)"]
fn capture_cycle_time_on_the_game_window() {
    let window = find_game_window().unwrap_or_else(|e| panic!("{e}"));
    assert!(
        !window.minimized,
        "게임 창이 최소화돼 있다. 창을 다시 띄운 뒤에 돌려라(이 테스트는 게임 창을 건드리지 않는다)"
    );
    println!("게임 창: 화면 영역 {}×{}", window.client.width, window.client.height);
    let before = refresh_game_window(&window).expect("게임 창을 다시 읽지 못했다");

    let timing = time_cycles(&window, std::thread::sleep);
    report("게임 창", &timing);
    assert_fits_the_interval(&timing);

    // 찍는 동안 게임 창은 그대로다.
    let after = refresh_game_window(&window).expect("게임 창을 다시 읽지 못했다");
    assert_eq!(after.client, before.client, "화면 영역의 위치·크기가 바뀌었다");
    assert_eq!(after.frame, before.frame, "창의 위치·크기가 바뀌었다");
    assert_eq!(after.minimized, before.minimized, "최소화 여부가 바뀌었다");
}

/// 이 테스트가 띄우는 창. 다른 프로그램의 창에는 아무것도 하지 않는다.
mod desktop {
    use std::time::{Duration, Instant};

    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, InvalidateRect, PAINTSTRUCT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect,
        PeekMessageW, RegisterClassW, SetWindowPos, TranslateMessage, MSG,
        PM_REMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER, WM_ERASEBKGND, WM_PAINT, WNDCLASSW,
        WS_EX_NOACTIVATE, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };

    /// 네 구역의 색: 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래(한 색뿐인 화면은 캡처가 빈 화면으로 본다).
    pub const QUADRANTS: [(u8, u8, u8); 4] = [(200, 40, 40), (40, 180, 60), (40, 80, 220), (230, 200, 40)];

    unsafe extern "system" fn paint_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => {
                let mut rc = RECT::default();
                let _ = GetClientRect(hwnd, &mut rc);
                let (mx, my) = (rc.right / 2, rc.bottom / 2);
                let rects = [
                    (0, 0, mx, my),
                    (mx, 0, rc.right, my),
                    (0, my, mx, rc.bottom),
                    (mx, my, rc.right, rc.bottom),
                ];
                let mut ps = PAINTSTRUCT::default();
                let dc = BeginPaint(hwnd, &mut ps);
                for ((left, top, right, bottom), (r, g, b)) in rects.into_iter().zip(QUADRANTS) {
                    // COLORREF는 0x00BBGGRR이다.
                    let brush =
                        CreateSolidBrush(COLORREF(u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16));
                    FillRect(
                        dc,
                        &RECT {
                            left,
                            top,
                            right,
                            bottom,
                        },
                        brush,
                    );
                    let _ = DeleteObject(brush.into());
                }
                let _ = EndPaint(hwnd, &ps);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    pub struct TestWindow(HWND);

    impl TestWindow {
        /// 제목 표시줄·테두리가 있는 보통 창(게임의 창 모드와 같은 모양). 활성화하지 않는다.
        pub fn framed(x: i32, y: i32, width: i32, height: i32) -> Self {
            unsafe {
                SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                let instance = GetModuleHandleW(None).expect("모듈 핸들");
                let class = w!("NikkeCompanionLiveTrack");
                let wc = WNDCLASSW {
                    lpfnWndProc: Some(paint_proc),
                    hInstance: instance.into(),
                    lpszClassName: class,
                    ..Default::default()
                };
                RegisterClassW(&wc);
                let hwnd = CreateWindowExW(
                    WS_EX_NOACTIVATE,
                    class,
                    w!("nikke-companion live track test"),
                    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    x,
                    y,
                    width,
                    height,
                    None,
                    None,
                    Some(instance.into()),
                    None,
                )
                .expect("테스트 창을 만들지 못했다");
                Self(hwnd)
            }
        }

        pub fn handle_value(&self) -> i64 {
            self.0 .0 as isize as i64
        }

        /// 이 테스트의 창의 바깥 크기를 바꾼다(자리·순서·활성 상태는 그대로). 네 구역을 새 크기로 다시 칠하게 한다.
        pub fn resize(&self, width: i32, height: i32) {
            unsafe {
                SetWindowPos(
                    self.0,
                    None,
                    0,
                    0,
                    width,
                    height,
                    SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
                )
                .expect("테스트 창의 크기를 바꾸지 못했다");
                let _ = InvalidateRect(Some(self.0), None, true);
            }
        }

        /// 창이 그려지도록 잠깐 메시지를 돌린다.
        pub fn pump(&self, duration: Duration) {
            let until = Instant::now() + duration;
            let mut msg = MSG::default();
            while Instant::now() < until {
                unsafe {
                    while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }

    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }
}
