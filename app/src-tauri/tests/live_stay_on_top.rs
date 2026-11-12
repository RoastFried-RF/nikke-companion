//! 게임 위에 머물기를 실제 창으로 확인한다. 게임은 필요 없다 — 이 테스트가 띄운 창들만 쓴다.
//!
//! 니케 게임 창은 항상 위(WS_EX_TOPMOST) 창이다. 항상 위 창끼리는 나중에 활성화된 창이 위로 오므로, 게임을 누르면
//! 게임이 오버레이를 덮는다. 여기서는 그 상황을 만든다: 오버레이 역할의 항상 위 창을 띄우고, 그 자리에 게임 역할의
//! 항상 위 창을 띄워 **활성화**한다. 그런 다음 앱이 쓰는 호출 그대로(`stay_on_top::StayOnTop::step` →
//! `overlay_win32::OverlayWindow::raise_without_activating`) 오버레이 역할의 창을 다시 올린다.
//!
//! 확인하는 것:
//! - 덮인 상태를 창 순서로 읽는다(`windows_above`에 게임 역할의 창이 있다) — 규칙이 「올린다」고 답한다
//! - 올린 뒤에는 오버레이 역할의 창이 게임 역할의 창보다 위다(창 순서와 화면 픽셀 둘 다) — 규칙이 「이미 위」라고 답한다
//! - **전경 창(키보드 포커스)은 바뀌지 않는다** — 오버레이 역할의 창이 전경 창이 되지 않는다
//! - 오버레이 역할의 창의 자리·크기, 게임 역할의 창의 자리·크기가 그대로다
//! - 다른 프로그램의 창 핸들로는 `OverlayWindow`를 만들 수 없다(올릴 수 없다)
//!
//! 둘째 테스트는 게임 역할의 창을 **다른 프로세스**(이 테스트 실행 파일을 한 번 더 띄운 것)가 갖게 한다 — 실제로는
//! 게임이 다른 프로세스이기 때문이다. 그 프로세스의 창은 읽기만 한다.
//!
//! 화면이 켜진 Windows 데스크톱이 필요해서 `#[ignore]`다:
//!
//! ```bash
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_stay_on_top -- --ignored --nocapture --test-threads=1
//! ```
//!
//! 2~3초 동안 화면 왼쪽 위에 초록 창과 자홍색 창이 떴다 사라진다. **초록 창(게임 역할)은 활성화된다** — 그동안
//! 쓰던 창의 키보드 입력이 잠깐 그 창으로 간다(테스트가 끝나면 창이 사라진다).
//!
//! 여기서 `SetForegroundWindow`·`ShowWindow`를 부르는 대상은 이 테스트가 띄운 창뿐이다.

#![cfg(windows)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use nikke_companion_lib::game_window::{
    refresh_game_window, GameWindowInfo, GameWindowStatus, ScreenRect,
};
use nikke_companion_lib::overlay_win32::OverlayWindow;
use nikke_companion_lib::stay_on_top::{self, Decision, Leave, Stacking, StayOnTop};

use desktop::{Role, TestWindow, GREEN, MAGENTA};

type Rgb = (u8, u8, u8);

/// 테스트를 하나씩 돌린다 — 창들이 서로 가리지 않게.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// 창이 그려지고 순서가 바뀌기를 기다리는 시간.
const SETTLE: Duration = Duration::from_millis(300);

/// 게임 역할의 창을 가진 프로세스 노릇을 하라는 환경 변수.
const GAME_HOST: &str = "NIKKE_STAY_ON_TOP_GAME_HOST";
const GAME_HOST_TEST: &str = "stay_on_top_game_window_host";
/// 그 프로세스가 창 핸들을 알리는 줄의 표지.
const GAME_WINDOW: &str = "STAY-ON-TOP-GAME-WINDOW";

/// 게임 역할의 창이 놓이는 자리와, 그 안쪽에 놓이는 오버레이 역할의 창(붙이기를 켰을 때처럼 게임 화면 안쪽이다).
const GAME_RECT: (i32, i32, i32, i32) = (140, 140, 640, 400);
const OVERLAY_RECT: (i32, i32, i32, i32) = (520, 170, 220, 300);

/// 오버레이 역할의 창 한가운데(화면 좌표).
fn overlay_centre() -> (i32, i32) {
    let (x, y, w, h) = OVERLAY_RECT;
    (x + w / 2, y + h / 2)
}

fn is_colour(p: Rgb, c: Rgb) -> bool {
    let near = |a: u8, b: u8| a.abs_diff(b) <= 8;
    near(p.0, c.0) && near(p.1, c.1) && near(p.2, c.2)
}

/// 게임 역할의 창을 규칙이 받는 모양(`GameWindowInfo`)으로 읽는다 — 앱이 게임 창을 읽는 함수 그대로다.
fn game_info(hwnd: isize, pid: u32) -> GameWindowInfo {
    let seed = GameWindowInfo {
        hwnd: hwnd as i64,
        pid,
        process_name: "live_stay_on_top(game role)".to_string(),
        title: String::new(),
        client: ScreenRect::default(),
        frame: ScreenRect::default(),
        minimized: false,
        foreground: false,
        scale_factor: 1.0,
    };
    refresh_game_window(&seed).expect("게임 역할의 창을 읽지 못했다")
}

fn status_of(hwnd: isize, pid: u32) -> GameWindowStatus {
    GameWindowStatus::from_window(game_info(hwnd, pid))
}

/// 덮인 상태에서 다시 올리기까지의 확인. `pump`는 이 테스트의 창들이 메시지를 처리하게 한다.
fn raise_and_check(overlay: &TestWindow, game_hwnd: isize, game_pid: u32, pump: &dyn Fn(Duration)) {
    let own = OverlayWindow::own(overlay.handle()).expect("오버레이 역할의 창은 이 프로세스의 창이다");
    let (cx, cy) = overlay_centre();

    // 덮였다: 창 순서로도, 화면 픽셀로도 게임 역할의 창이 위다.
    let above = own.windows_above().expect("창 순서를 읽지 못했다");
    assert_eq!(
        stay_on_top::stacking(Some(&above), game_hwnd),
        Stacking::GameAbove,
        "덮인 상태를 만들지 못했다 — 게임 역할의 창이 오버레이 역할의 창보다 위로 오지 않았다"
    );
    let covered = desktop::screen_pixel(cx, cy).expect("화면 픽셀");
    assert!(
        is_colour(covered, GREEN),
        "오버레이 역할의 창이 가려지지 않았다(화면 픽셀 {covered:?}) — 화면이 잠겨 있거나 다른 창이 그 위에 있다"
    );

    let foreground_before = desktop::foreground();
    let overlay_rect = overlay.rect();
    let game_before = game_info(game_hwnd, game_pid);
    println!(
        "덮인 상태: 전경 창 {foreground_before:#x}, 게임 역할 {game_hwnd:#x}(전경 {}), 오버레이 역할 {:#x}, 위에 있는 창 {}개",
        game_before.foreground,
        overlay.handle(),
        above.len()
    );
    assert_ne!(foreground_before, overlay.handle(), "오버레이 역할의 창이 전경 창이다");

    // 앱이 한 주기에 하는 일 그대로: 규칙이 올리라고 하면 올린다.
    let mut rule = StayOnTop::new();
    let status = status_of(game_hwnd, game_pid);
    assert_eq!(rule.step(true, &status, || own.windows_above()), Decision::Raise);
    let asked = Instant::now();
    assert!(own.raise_without_activating(), "오버레이 역할의 창을 올리지 못했다");
    // 올라올 때까지 기다린다(요청은 창을 가진 스레드가 처리한다).
    let mut raised = false;
    while asked.elapsed() < Duration::from_secs(2) {
        pump(Duration::from_millis(10));
        let above = own.windows_above().expect("창 순서");
        if stay_on_top::stacking(Some(&above), game_hwnd) == Stacking::OverlayAbove {
            raised = true;
            break;
        }
    }
    println!("다시 올라오기까지 {:?}", asked.elapsed());
    assert!(raised, "올리기를 불렀는데 오버레이 역할의 창이 게임 역할의 창 위로 오지 않았다");
    assert!(
        asked.elapsed() < stay_on_top::MAX_DELAY,
        "올리는 데 {:?}가 걸렸다",
        asked.elapsed()
    );
    pump(SETTLE);

    // 화면에도 오버레이 역할의 창이 보인다.
    let shown = desktop::screen_pixel(cx, cy).expect("화면 픽셀");
    assert!(
        is_colour(shown, MAGENTA),
        "올린 뒤에도 오버레이 역할의 창이 화면에 보이지 않는다(화면 픽셀 {shown:?})"
    );
    // 전경 창(키보드 포커스)은 그대로다 — 오버레이 역할의 창이 가져가지 않았다.
    let foreground_after = desktop::foreground();
    assert_ne!(
        foreground_after,
        overlay.handle(),
        "올린 오버레이 역할의 창이 키보드 포커스를 가져갔다"
    );
    assert_eq!(
        foreground_after, foreground_before,
        "올리는 동안 전경 창이 바뀌었다 — 오버레이 역할의 창이 아닌 다른 창이 전경이 됐다면 테스트 도중에 다른 \
         프로그램이 활성화된 것이다(다시 돌려라)"
    );
    // 오버레이 역할의 창은 자리도 크기도 그대로이고, 게임 역할의 창은 아무것도 달라지지 않았다.
    assert_eq!(overlay.rect(), overlay_rect, "오버레이 역할의 창이 움직였다");
    let game_after = game_info(game_hwnd, game_pid);
    assert_eq!(game_after.client, game_before.client, "게임 역할의 창이 움직였다");
    assert_eq!(game_after.frame, game_before.frame);
    assert_eq!(game_after.minimized, game_before.minimized);
    assert_eq!(game_after.foreground, game_before.foreground, "게임 역할의 창의 전경 여부가 바뀌었다");

    // 이미 위다: 규칙은 더 올리지 않는다.
    let status = status_of(game_hwnd, game_pid);
    assert_eq!(
        rule.step(true, &status, || own.windows_above()),
        Decision::Leave(Leave::AlreadyOnTop)
    );
    // 숨겨 둔 오버레이는 올리지 않는다(창 순서도 읽지 않는다).
    assert_eq!(
        rule.step(false, &status, || panic!("숨긴 동안에는 창 순서를 읽지 않는다")),
        Decision::Leave(Leave::OverlayHidden)
    );
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 잠깐 띄우고 그 가운데 하나를 활성화한다)"]
fn the_overlay_window_goes_back_above_an_activated_topmost_window_without_taking_focus() {
    let _serial = serial();
    let overlay = TestWindow::show(Role::Overlay, OVERLAY_RECT);
    overlay.pump(SETTLE);
    // 오버레이 역할의 창이 먼저 화면에 보인다.
    let (cx, cy) = overlay_centre();
    let first = desktop::screen_pixel(cx, cy).expect("화면 픽셀");
    assert!(is_colour(first, MAGENTA), "오버레이 역할의 창이 화면에 보이지 않는다({first:?})");

    // 게임 역할의 항상 위 창을 띄워 활성화한다 — 게임을 누른 것과 같다.
    let game = TestWindow::show(Role::Game, GAME_RECT);
    let activated = game.activate();
    game.pump(SETTLE);
    overlay.pump(Duration::from_millis(50));
    println!(
        "게임 역할의 창 활성화: 요청 {activated}, 전경 창 {:#x}(게임 역할 {:#x})",
        desktop::foreground(),
        game.handle()
    );
    assert_eq!(
        desktop::foreground(),
        game.handle(),
        "게임 역할의 창을 활성화하지 못했다 — 이 테스트를 띄운 터미널이 전경에 있을 때 다시 돌려라"
    );

    raise_and_check(&overlay, game.handle(), std::process::id(), &|d| overlay.pump(d));

    // 다른 프로그램의 창(바탕 화면 창)으로는 오버레이 창을 만들 수 없다 — 그 창의 순서는 바꿀 수 없다.
    assert_eq!(OverlayWindow::own(desktop::desktop_window()), None);
    assert_eq!(OverlayWindow::own(0), None);
}

// ── 게임 역할의 창을 다른 프로세스가 갖는 경우 ─────────────────────────────────

/// 평소에는 아무것도 하지 않는다. 환경 변수와 함께 실행됐을 때만 게임 역할의 창을 띄워 활성화하고 머문다.
#[test]
fn stay_on_top_game_window_host() {
    if std::env::var(GAME_HOST).is_err() {
        return;
    }
    let game = TestWindow::show(Role::Game, GAME_RECT);
    let activated = game.activate();
    game.pump(SETTLE);
    let mut out = std::io::stdout();
    let _ = writeln!(
        out,
        "{GAME_WINDOW} {} {} {activated}",
        game.handle(),
        std::process::id()
    );
    let _ = out.flush();
    // 끝내질 때까지 창을 살려 둔다(오래 남지는 않는다).
    game.pump(Duration::from_secs(30));
}

/// 게임 역할의 창을 가진 프로세스. 테스트가 끝나면(실패해도) 끝낸다.
struct GameProcess(Child);

impl Drop for GameProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(창을 잠깐 띄우고 그 가운데 하나를 활성화한다)"]
fn the_overlay_window_goes_back_above_a_topmost_window_of_another_process() {
    let _serial = serial();
    let overlay = TestWindow::show(Role::Overlay, OVERLAY_RECT);
    overlay.pump(SETTLE);

    let exe = std::env::current_exe().expect("테스트 실행 파일의 경로");
    let mut child = Command::new(exe)
        .args([GAME_HOST_TEST, "--exact", "--nocapture", "--test-threads=1"])
        .env(GAME_HOST, "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("게임 역할의 프로세스를 띄우지 못했다");
    let stdout = child.stdout.take().expect("표준 출력");
    let game_process = GameProcess(child);
    let announced = BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
        .find_map(|line| line.find(GAME_WINDOW).map(|at| line[at..].to_string()))
        .expect("게임 역할의 프로세스가 창을 알리지 않았다");
    let mut parts = announced.split_whitespace().skip(1);
    let game_hwnd: isize = parts.next().and_then(|v| v.parse().ok()).expect("창 핸들");
    let game_pid: u32 = parts.next().and_then(|v| v.parse().ok()).expect("프로세스 번호");
    assert_eq!(game_pid, game_process.0.id());
    overlay.pump(SETTLE);
    println!(
        "다른 프로세스({game_pid})의 게임 역할 창 {game_hwnd:#x}: 전경 창 {:#x}, 활성화 요청 {:?}",
        desktop::foreground(),
        parts.next()
    );
    // 다른 프로세스의 창으로는 오버레이 창을 만들 수 없다 — 그 창은 읽기만 한다.
    assert_eq!(OverlayWindow::own(game_hwnd), None);

    raise_and_check(&overlay, game_hwnd, game_pid, &|d| overlay.pump(d));
}

/// 이 테스트가 띄우는 창들. 다른 프로그램의 창에는 아무것도 하지 않는다(읽기만 한다).
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
        GetDesktopWindow, GetForegroundWindow, GetWindowRect, PeekMessageW, RegisterClassW,
        SetForegroundWindow, ShowWindow, TranslateMessage, MSG, PM_REMOVE, SW_SHOW,
        SW_SHOWNOACTIVATE, WM_ERASEBKGND, WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
    };

    use super::Rgb;

    /// 오버레이 역할의 창의 색.
    pub const MAGENTA: Rgb = (255, 0, 255);
    /// 게임 역할의 창의 색.
    pub const GREEN: Rgb = (30, 170, 70);

    /// 창의 역할.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Role {
        /// 오버레이: 항상 위, 활성화하지 않고 보인다.
        Overlay,
        /// 게임: 항상 위, 활성화된다(니케 게임 창의 확장 스타일 0x108 가운데 항상 위).
        Game,
    }

    /// COLORREF는 0x00BBGGRR이다.
    fn colorref((r, g, b): Rgb) -> COLORREF {
        COLORREF(u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16)
    }

    unsafe fn paint(hwnd: HWND, colour: Rgb) -> LRESULT {
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let mut ps = PAINTSTRUCT::default();
        let dc = BeginPaint(hwnd, &mut ps);
        let brush = CreateSolidBrush(colorref(colour));
        FillRect(dc, &rect, brush);
        let _ = DeleteObject(brush.into());
        let _ = EndPaint(hwnd, &ps);
        LRESULT(0)
    }

    unsafe extern "system" fn overlay_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => paint(hwnd, MAGENTA),
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe extern "system" fn game_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => paint(hwnd, GREEN),
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    pub struct TestWindow(HWND);

    impl TestWindow {
        /// 테두리 없는 항상 위 창을 그 자리에 띄운다(물리 픽셀). 활성화하지 않는다 — 게임 역할은 `activate`로 한다.
        pub fn show(role: Role, (x, y, width, height): (i32, i32, i32, i32)) -> Self {
            unsafe {
                SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                let instance = GetModuleHandleW(None).expect("모듈 핸들");
                let class: PCWSTR = match role {
                    Role::Overlay => w!("NikkeCompanionLiveStayOnTopOverlay"),
                    Role::Game => w!("NikkeCompanionLiveStayOnTopGame"),
                };
                let wc = WNDCLASSW {
                    lpfnWndProc: Some(match role {
                        Role::Overlay => overlay_proc,
                        Role::Game => game_proc,
                    }),
                    hInstance: instance.into(),
                    lpszClassName: class,
                    ..Default::default()
                };
                // 같은 프로세스에서 두 번째로 등록하면 실패한다 — 이미 있으면 그대로 쓴다.
                RegisterClassW(&wc);
                let ex_style = match role {
                    Role::Overlay => WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                    Role::Game => WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                };
                let hwnd = CreateWindowExW(
                    ex_style,
                    class,
                    w!("nikke-companion live stay-on-top test"),
                    WS_POPUP,
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
                let _ = ShowWindow(
                    hwnd,
                    match role {
                        Role::Overlay => SW_SHOWNOACTIVATE,
                        Role::Game => SW_SHOW,
                    },
                );
                Self(hwnd)
            }
        }

        pub fn handle(&self) -> isize {
            self.0 .0 as isize
        }

        /// 이 테스트의 창을 전경 창으로 만든다(게임을 누른 것과 같다). 요청이 받아들여졌으면 `true`.
        pub fn activate(&self) -> bool {
            unsafe { SetForegroundWindow(self.0) }.as_bool()
        }

        /// 창의 화면 자리와 크기(왼쪽, 위, 오른쪽, 아래).
        pub fn rect(&self) -> (i32, i32, i32, i32) {
            let mut rect = RECT::default();
            unsafe {
                let _ = GetWindowRect(self.0, &mut rect);
            }
            (rect.left, rect.top, rect.right, rect.bottom)
        }

        /// 창이 그려지고 요청을 처리하도록 잠깐 메시지를 돌린다.
        pub fn pump(&self, duration: Duration) {
            let until = Instant::now() + duration;
            let mut msg = MSG::default();
            loop {
                unsafe {
                    while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }
                if Instant::now() >= until {
                    break;
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

    /// 지금 전경 창(입력을 받는 창)의 핸들 값. 읽기만 한다.
    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow() }.0 as isize
    }

    /// 바탕 화면 창 — 이 프로세스의 창이 아닌 창의 예로 쓴다. 읽기만 한다.
    pub fn desktop_window() -> isize {
        unsafe { GetDesktopWindow() }.0 as isize
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
