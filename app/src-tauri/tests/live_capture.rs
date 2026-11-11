//! 게임 없이 캡처 경로를 실제 Windows.Graphics.Capture로 확인한다. 이 테스트가 띄운 **자기 창**을 찍는다.
//!
//! `live_game.rs`는 실행 중인 니케가 떠 있어야 돈다. 게임 창이 최소화돼 있거나 게임이 꺼져 있어도 캡처 코드
//! (`game_window::capture_window`)가 이 Windows에서 맞게 도는지는 여기서 볼 수 있다. 게임 창은 읽지도 건드리지도 않는다.
//!
//! 화면이 켜진 Windows 데스크톱이 필요해서 `#[ignore]`다(잠긴 화면·원격 세션 끊김에서는 실패할 수 있다):
//!
//! ```bash
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_capture -- --ignored
//! ```
//!
//! 1~2초 동안 화면 왼쪽 위에 네 가지 색으로 칠한 작은 창(과 자홍색 네모)이 떴다 사라진다. 활성화하지 않으므로
//! 쓰던 창의 입력은 그대로다.
//!
//! 확인하는 것:
//! - 제목 표시줄·테두리가 있는 창에서 **클라이언트 영역만** 정확히 잘라 낸다(가장자리 한 픽셀까지)
//! - 다른 창이 가리고 있어도 그 창이 아니라 대상 창의 화면이 찍힌다
//! - 한 색뿐인 화면은 성공으로 치지 않는다(`BlankFrame`)
//! - 최소화된 창은 `Minimized` 오류이고, 다시 띄우면 찍힌다
//! - 캡처 전후로 대상 창의 위치·크기·최소화·전경 여부가 같다
//!
//! 여기서 `ShowWindow`를 부르는 대상은 이 테스트의 창뿐이다.

#![cfg(windows)]

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use nikke_companion_lib::capture::{blank_kind, BlankKind, CaptureMethod, Frame};
use nikke_companion_lib::game_window::{
    capture_window, refresh_game_window, GameError, GameWindowInfo, ScreenRect,
};

use desktop::{Paint, TestWindow, MAGENTA, QUADRANTS};

type Rgb = (u8, u8, u8);

/// 테스트를 하나씩 돌린다 — 창들이 서로 가리지 않게.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// 창이 그려지기를 기다리는 시간.
const SETTLE: Duration = Duration::from_millis(400);

/// 이 테스트의 창을 캡처 코드가 받는 모양(`GameWindowInfo`)으로 읽는다.
fn window_info(window: &TestWindow) -> GameWindowInfo {
    let seed = GameWindowInfo {
        hwnd: window.handle_value(),
        pid: std::process::id(),
        process_name: "live_capture(test)".to_string(),
        title: String::new(),
        client: ScreenRect::default(),
        frame: ScreenRect::default(),
        minimized: false,
        foreground: false,
        scale_factor: 1.0,
    };
    refresh_game_window(&seed).expect("테스트 창을 읽지 못했다")
}

fn pixel(frame: &Frame, x: u32, y: u32) -> Rgb {
    let i = (y as usize * frame.width as usize + x as usize) * 3;
    (frame.rgb[i], frame.rgb[i + 1], frame.rgb[i + 2])
}

/// 같은 색인가. GDI로 칠한 단색을 무손실로 받으므로 거의 같아야 한다(색 관리 차이만 조금 봐준다).
fn same_colour(a: Rgb, b: Rgb) -> bool {
    let near = |x: u8, y: u8| x.abs_diff(y) <= 6;
    near(a.0, b.0) && near(a.1, b.1) && near(a.2, b.2)
}

fn is_magenta(p: Rgb) -> bool {
    p.0 > 240 && p.1 < 16 && p.2 > 240
}

/// 네 구역으로 칠한 창을 찍은 프레임이 클라이언트 영역과 정확히 맞는지 본다: 각 구역의 바깥 가장자리 줄
/// (맨 왼쪽·오른쪽 열, 맨 위·아래 행)이 그 구역의 색이어야 한다. 한 픽셀이라도 밀리면 테두리·제목 표시줄이 섞인다.
/// 모서리는 Windows 11이 둥글게 깎으므로 모서리에서 떨어진 자리를 본다.
fn assert_quadrants_fill_the_frame(frame: &Frame) {
    let (w, h) = (frame.width, frame.height);
    let [top_left, top_right, bottom_left, bottom_right] = QUADRANTS;
    let checks = [
        ("왼쪽 위 구역의 맨 왼쪽 열", (0, h / 4), top_left),
        ("왼쪽 위 구역의 맨 위 행", (w / 4, 0), top_left),
        ("오른쪽 위 구역의 맨 오른쪽 열", (w - 1, h / 4), top_right),
        ("오른쪽 위 구역의 맨 위 행", (3 * w / 4, 0), top_right),
        ("왼쪽 아래 구역의 맨 왼쪽 열", (0, 3 * h / 4), bottom_left),
        ("왼쪽 아래 구역의 맨 아래 행", (w / 4, h - 1), bottom_left),
        ("오른쪽 아래 구역의 맨 오른쪽 열", (w - 1, 3 * h / 4), bottom_right),
        ("오른쪽 아래 구역의 맨 아래 행", (3 * w / 4, h - 1), bottom_right),
        ("왼쪽 위 구역의 안쪽", (w / 2 - 2, h / 2 - 2), top_left),
        ("오른쪽 위 구역의 안쪽", (w / 2 + 2, h / 2 - 2), top_right),
        ("왼쪽 아래 구역의 안쪽", (w / 2 - 2, h / 2 + 2), bottom_left),
        ("오른쪽 아래 구역의 안쪽", (w / 2 + 2, h / 2 + 2), bottom_right),
    ];
    for (what, (x, y), expected) in checks {
        let actual = pixel(frame, x, y);
        assert!(
            same_colour(actual, expected),
            "{what} ({x}, {y})의 색이 {actual:?}다 — {expected:?}여야 한다. 클라이언트 영역이 아닌 곳이 찍혔다"
        );
    }
}

/// 캡처 전후에 그대로여야 하는 것.
fn assert_untouched(before: &GameWindowInfo, after: &GameWindowInfo) {
    assert_eq!(after.client, before.client, "화면 영역의 위치·크기가 바뀌었다");
    assert_eq!(after.frame, before.frame, "창의 위치·크기가 바뀌었다");
    assert_eq!(after.minimized, before.minimized, "최소화 여부가 바뀌었다");
    assert_eq!(after.foreground, before.foreground, "전경 여부가 바뀌었다");
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 잠깐 띄운다)"]
fn captures_exactly_the_client_area_of_a_framed_window() {
    let _serial = serial();
    let window = TestWindow::framed(Paint::Quadrants, 120, 120, 720, 480);
    window.pump(SETTLE);
    let before = window_info(&window);
    println!("테스트 창: {before:?}");

    // 제목 표시줄과 테두리가 있는 창이다 — 클라이언트 영역이 창 경계보다 작다.
    assert!(!before.minimized);
    assert!(before.client.width >= 320 && before.client.height >= 240, "{before:?}");
    assert!(
        before.client.y > before.frame.y && before.client.height < before.frame.height,
        "제목 표시줄이 없는 창이 만들어졌다: {before:?}"
    );

    let (frame, method) = capture_window(&before).unwrap_or_else(|e| panic!("캡처하지 못했다: {e}"));
    window.pump(Duration::from_millis(20));
    let after = window_info(&window);

    assert_eq!(method, CaptureMethod::Wgc);
    assert_eq!(
        (frame.width, frame.height),
        (before.client.width, before.client.height),
        "캡처한 크기가 클라이언트 영역과 다르다"
    );
    assert_eq!(frame.rgb.len(), frame.width as usize * frame.height as usize * 3);
    assert_eq!(blank_kind(&frame), None);
    assert_quadrants_fill_the_frame(&frame);
    println!(
        "모서리 픽셀(둥근 모서리 확인용): 왼쪽 위 {:?}, 오른쪽 위 {:?}, 왼쪽 아래 {:?}, 오른쪽 아래 {:?}",
        pixel(&frame, 0, 0),
        pixel(&frame, frame.width - 1, 0),
        pixel(&frame, 0, frame.height - 1),
        pixel(&frame, frame.width - 1, frame.height - 1)
    );
    assert_untouched(&before, &after);
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 잠깐 띄운다)"]
fn captures_the_window_content_when_another_window_covers_it() {
    let _serial = serial();
    let window = TestWindow::framed(Paint::Quadrants, 120, 120, 720, 480);
    window.pump(SETTLE);
    let before = window_info(&window);

    // 네 구역이 만나는 가운데를 자홍색 창(항상 위, 비활성)으로 가린다.
    let side = (before.client.width.min(before.client.height) / 4).clamp(64, 240) as i32;
    let left = before.client.x + (before.client.width as i32 - side) / 2;
    let top = before.client.y + (before.client.height as i32 - side) / 2;
    let cover = TestWindow::cover(left, top, side, side);
    cover.pump(Duration::from_millis(250));
    window.pump(Duration::from_millis(50));

    // 가리개가 정말 화면에 보이는지 화면 픽셀로 확인한다 — 아니면 가린 상태를 만들지 못한 것이다.
    let on_screen = desktop::screen_pixel(left + side / 2, top + side / 2);
    let captured = capture_window(&before);
    cover.pump(Duration::from_millis(20));
    drop(cover);
    window.pump(Duration::from_millis(20));
    let after = window_info(&window);

    let on_screen = on_screen.expect("화면 픽셀을 읽지 못했다");
    assert!(
        is_magenta(on_screen),
        "가리개 창이 화면에 보이지 않는다(화면 픽셀 {on_screen:?}) — 화면이 잠겨 있거나 다른 창이 그 위에 있다"
    );
    let (frame, method) = captured.unwrap_or_else(|e| panic!("가려진 상태에서 캡처하지 못했다: {e}"));
    assert_eq!(method, CaptureMethod::Wgc);
    assert_eq!(
        (frame.width, frame.height),
        (before.client.width, before.client.height)
    );

    // 가린 자리에 가리개의 색이 하나도 찍히지 않았고, 대상 창이 칠한 색이 그대로 있다.
    let (x0, y0) = ((left - before.client.x) as u32, (top - before.client.y) as u32);
    let side = side as u32;
    let covered: usize = (y0..y0 + side)
        .flat_map(|y| (x0..x0 + side).map(move |x| (x, y)))
        .filter(|(x, y)| is_magenta(pixel(&frame, *x, *y)))
        .count();
    println!("가린 영역 {side}×{side}: 가리개 색 픽셀 {covered}개");
    assert_eq!(
        covered, 0,
        "가리개 창이 캡처에 찍혔다 — 대상 창의 화면이 아니라 화면에 보이는 것을 찍고 있다"
    );
    assert_quadrants_fill_the_frame(&frame);
    assert_untouched(&before, &after);
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 잠깐 띄운다)"]
fn a_single_colour_window_is_not_a_successful_capture() {
    let _serial = serial();
    let window = TestWindow::framed(Paint::Solid, 120, 120, 480, 360);
    window.pump(SETTLE);
    let info = window_info(&window);

    let result = capture_window(&info);
    let (r, g, b) = MAGENTA;
    assert_eq!(
        result,
        Err(GameError::BlankFrame {
            method: CaptureMethod::Wgc,
            kind: BlankKind::SingleColor { r, g, b },
        }),
        "한 색뿐인 화면이 성공으로 돌아왔다"
    );
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 잠깐 띄운다)"]
fn a_minimized_window_is_refused_and_captured_again_once_restored() {
    let _serial = serial();
    let window = TestWindow::framed(Paint::Quadrants, 120, 120, 720, 480);
    window.pump(SETTLE);
    let shown = window_info(&window);

    window.minimize();
    window.pump(SETTLE);
    let minimized = window_info(&window);
    assert!(minimized.minimized, "{minimized:?}");
    // 찾을 때 최소화돼 있던 창도, 찾은 뒤에 최소화된 창도 같은 오류다.
    assert_eq!(capture_window(&minimized), Err(GameError::Minimized));
    assert_eq!(capture_window(&shown), Err(GameError::Minimized));
    // 캡처를 시도해도 창은 최소화된 그대로다(복원하지 않는다).
    assert!(window_info(&window).minimized);

    window.restore();
    window.pump(SETTLE);
    let restored = window_info(&window);
    assert!(!restored.minimized);
    assert_eq!(restored.client, shown.client, "다시 띄운 창의 자리가 다르다");
    let (frame, _) = capture_window(&restored)
        .unwrap_or_else(|e| panic!("다시 띄운 창을 캡처하지 못했다: {e}"));
    assert_eq!(
        (frame.width, frame.height),
        (shown.client.width, shown.client.height)
    );
    assert_quadrants_fill_the_frame(&frame);
}

/// 이 테스트가 띄우는 창들. 다른 프로그램의 창에는 아무것도 하지 않는다.
mod desktop {
    use std::time::{Duration, Instant};

    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, GetDC, GetPixel, ReleaseDC,
        CLR_INVALID, PAINTSTRUCT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect,
        PeekMessageW, RegisterClassW, ShowWindow, TranslateMessage, MSG, PM_REMOVE,
        SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE, WM_ERASEBKGND,
        WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE,
    };

    use super::Rgb;

    /// 자홍색(#ff00ff) — 가리개와 한 색 창의 색.
    pub const MAGENTA: Rgb = (255, 0, 255);
    /// 네 구역의 색: 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래.
    pub const QUADRANTS: [Rgb; 4] = [(200, 40, 40), (40, 180, 60), (40, 80, 220), (230, 200, 40)];

    /// COLORREF는 0x00BBGGRR이다.
    fn colorref((r, g, b): Rgb) -> COLORREF {
        COLORREF(u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16)
    }

    /// 창을 무엇으로 칠할까.
    #[derive(Clone, Copy)]
    pub enum Paint {
        /// 클라이언트 영역을 네 구역으로 나눠 `QUADRANTS`의 색으로.
        Quadrants,
        /// 전부 `MAGENTA`로.
        Solid,
    }

    unsafe fn fill(hwnd: HWND, colours: &[(RECT, Rgb)]) -> LRESULT {
        let mut ps = PAINTSTRUCT::default();
        let dc = BeginPaint(hwnd, &mut ps);
        for (rect, colour) in colours {
            let brush = CreateSolidBrush(colorref(*colour));
            FillRect(dc, rect, brush);
            let _ = DeleteObject(brush.into());
        }
        let _ = EndPaint(hwnd, &ps);
        LRESULT(0)
    }

    unsafe fn client_rect(hwnd: HWND) -> RECT {
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        rect
    }

    unsafe extern "system" fn quadrants_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => {
                let rc = client_rect(hwnd);
                let (mx, my) = (rc.right / 2, rc.bottom / 2);
                let rect = |left, top, right, bottom| RECT {
                    left,
                    top,
                    right,
                    bottom,
                };
                fill(
                    hwnd,
                    &[
                        (rect(0, 0, mx, my), QUADRANTS[0]),
                        (rect(mx, 0, rc.right, my), QUADRANTS[1]),
                        (rect(0, my, mx, rc.bottom), QUADRANTS[2]),
                        (rect(mx, my, rc.right, rc.bottom), QUADRANTS[3]),
                    ],
                )
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe extern "system" fn solid_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => fill(hwnd, &[(client_rect(hwnd), MAGENTA)]),
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    pub struct TestWindow(HWND);

    impl TestWindow {
        /// 제목 표시줄·테두리가 있는 보통 창(게임의 창 모드와 같은 모양). 활성화하지 않는다.
        /// 좌표와 크기는 창 바깥 기준(물리 픽셀)이다.
        pub fn framed(paint: Paint, x: i32, y: i32, width: i32, height: i32) -> Self {
            Self::create(
                paint,
                WS_EX_NOACTIVATE,
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                (x, y, width, height),
            )
        }

        /// 다른 창을 가리는 자홍색 네모(항상 위, 비활성, 테두리 없음).
        pub fn cover(x: i32, y: i32, width: i32, height: i32) -> Self {
            Self::create(
                Paint::Solid,
                WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                WS_POPUP | WS_VISIBLE,
                (x, y, width, height),
            )
        }

        fn create(
            paint: Paint,
            ex_style: WINDOW_EX_STYLE,
            style: WINDOW_STYLE,
            (x, y, width, height): (i32, i32, i32, i32),
        ) -> Self {
            unsafe {
                SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                let instance = GetModuleHandleW(None).expect("모듈 핸들");
                let class: PCWSTR = match paint {
                    Paint::Quadrants => w!("NikkeCompanionLiveCaptureQuadrants"),
                    Paint::Solid => w!("NikkeCompanionLiveCaptureSolid"),
                };
                let wc = WNDCLASSW {
                    lpfnWndProc: Some(match paint {
                        Paint::Quadrants => quadrants_proc,
                        Paint::Solid => solid_proc,
                    }),
                    hInstance: instance.into(),
                    lpszClassName: class,
                    ..Default::default()
                };
                // 같은 프로세스에서 두 번째로 등록하면 실패한다 — 이미 있으면 그대로 쓴다.
                RegisterClassW(&wc);
                let hwnd = CreateWindowExW(
                    ex_style,
                    class,
                    w!("nikke-companion live capture test"),
                    style,
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

        /// 이 테스트의 창을 최소화한다(활성 창은 바꾸지 않는다).
        pub fn minimize(&self) {
            unsafe {
                let _ = ShowWindow(self.0, SW_SHOWMINNOACTIVE);
            }
        }

        /// 이 테스트의 창을 다시 띄운다(활성화하지 않는다).
        pub fn restore(&self) {
            unsafe {
                let _ = ShowWindow(self.0, SW_SHOWNOACTIVATE);
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

    /// 화면의 한 점의 색. 화면에 실제로 보이는 것을 읽는다.
    pub fn screen_pixel(x: i32, y: i32) -> Option<Rgb> {
        unsafe {
            let dc = GetDC(None);
            let colour = GetPixel(dc, x, y);
            ReleaseDC(None, dc);
            if colour.0 == CLR_INVALID {
                return None;
            }
            Some((
                (colour.0 & 0xFF) as u8,
                ((colour.0 >> 8) & 0xFF) as u8,
                ((colour.0 >> 16) & 0xFF) as u8,
            ))
        }
    }
}
