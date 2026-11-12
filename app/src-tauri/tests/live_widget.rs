//! 오버레이 위젯을 실제 실행 파일과 실제 웹뷰로 확인한다(P-028):
//!
//! - **창은 위젯만큼만 크다**: 화면이 잰 위젯의 크기로 창이 줄고 늘어난다 — 접힘 < 한 줄 카드 < 펼침. 크기를 손으로 바꿀 수 없는
//!   창(`resizable: false`)에도 듣는다.
//! - **붙어 있는 모서리는 제자리다**: 기본 자리(오른쪽 위)에서는 모양이 달라도 오른쪽 위 모서리가 같다.
//! - **자리를 기억한다**: 오버레이 창을 옮겨 두면 계정 폴더의 설정 파일에 적히고, 다시 켜면 그 자리에 뜬다.
//! - **화면 밖에 놓으면 안쪽으로 되돌린다.**
//! - **클릭 통과를 켠 채 끝냈으면** 다음에도 켜진 채로, 보이는 채로 뜬다.
//!
//! 화면이 켜진 Windows 데스크톱과 WebView2, 그리고 **화면 서버**(개발용 실행 파일은 화면을 `localhost:1420`에서 읽는다)가 필요해서
//! `#[ignore]`다. 다른 터미널에서 화면 서버를 먼저 띄운다:
//!
//! ```bash
//! npm --prefix app run dev
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_widget -- --ignored --nocapture --test-threads=1
//! ```
//!
//! 환경 변수 `NIKKE_WIDGET_SHOTS`에 폴더를 주면 모양마다 **이 앱의 오버레이 창**을 찍어 그 폴더에 PNG로 둔다(눈으로 볼 때 쓴다 —
//! 검증용 샘플 결과가 그려진 위젯이다. 게임 화면이 아니다). 저장소 안의 폴더를 주지 않는다.
//!
//! 1분쯤 앱 창과 오버레이 창이 몇 번 떴다 사라진다. **이미 앱이 떠 있으면 실패한다**(중복 실행 방지) — 끄고 돌린다.
//!
//! 실제 계정 폴더는 쓰지 않는다: 띄우는 실행 파일에 `NIKKE_ACCOUNTS_DIR`로 임시 폴더를 주고, 거기에 검증용 샘플 결과
//! (`app/tests/fixtures/intercept.sample.json` — `is_test_data`)와 위젯 설정을 둔다. 이 테스트가 옮기는 것은 자기가 띄운 앱의
//! 오버레이 창뿐이다(사용자가 끈 것을 흉내 낸다). 게임 창을 찾거나 건드리지 않는다.

#![cfg(windows)]

use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use nikke_companion_lib::capture::save_png;
use nikke_companion_lib::game_window::{capture_window, refresh_game_window, GameWindowInfo, ScreenRect};
use nikke_companion_lib::overlay_store;
use nikke_companion_lib::overlay_widget::{Corner, Prefs, Shape, Stored};
use nikke_companion_lib::shared_state;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetSystemMetrics, GetWindowLongW, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, SetWindowPos, GWL_EXSTYLE, SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_NOACTIVATE, SWP_NOSIZE,
    SWP_NOZORDER, WS_EX_TRANSPARENT,
};

/// 앱 실행 파일(cargo가 이 테스트를 위해 빌드한 것).
const APP_EXE: &str = env!("CARGO_BIN_EXE_nikke-companion");
const OVERLAY_TITLE: &str = "니케 컴패니언 오버레이";
/// 설정 파일(tauri.conf.json)의 오버레이 창 시작 크기(논리 픽셀) — 위젯에 맞추기 전의 크기다.
const START_SIZE: (i32, i32) = (392, 72);
/// 화면 서버(개발용 실행 파일이 화면을 읽는 곳).
const DEV_SERVER: &str = "127.0.0.1:1420";

const STARTUP: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(100);

/// 테스트용 임시 계정 폴더(실제 계정 폴더 대신). 끝나면 지운다.
struct TempAccounts(PathBuf);

impl TempAccounts {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-live-widget-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("임시 계정 폴더");
        // 검증용 샘플 결과(지어낸 값 — `is_test_data`)를 「앱 창이 저장한 마지막 결과」로 둔다.
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/intercept.sample.json");
        let report: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&fixture).expect("샘플 결과")).expect("샘플 결과의 모양");
        shared_state::save_intercept(&dir, &report).expect("샘플 결과 저장");
        Self(dir)
    }

    fn store(&self, stored: &Stored) {
        overlay_store::save(&self.0, stored).expect("위젯 설정 저장");
    }

    fn stored(&self) -> Stored {
        overlay_store::load(&self.0).0
    }
}

impl Drop for TempAccounts {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 테스트가 띄운 앱. 테스트가 끝나면(실패해도) 끝낸다.
struct App(Child);

impl App {
    fn launch(accounts: &Path) -> Self {
        let child = Command::new(APP_EXE)
            .env("NIKKE_ACCOUNTS_DIR", accounts)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|e| panic!("앱을 실행하지 못했다: {APP_EXE} ({e})"));
        Self(child)
    }
}

impl Drop for App {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let list = &mut *(lparam.0 as *mut Vec<HWND>);
    list.push(hwnd);
    BOOL(1)
}

fn overlay_window(pid: u32) -> Option<HWND> {
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut all as *mut Vec<HWND> as isize));
    }
    all.into_iter().find(|hwnd| {
        let mut owner = 0u32;
        unsafe { GetWindowThreadProcessId(*hwnd, Some(&mut owner)) };
        let mut buf = [0u16; 256];
        let len = unsafe { GetWindowTextW(*hwnd, &mut buf) };
        owner == pid && String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0)]) == OVERLAY_TITLE
    })
}

/// 창의 사각형: (왼쪽, 위, 너비, 높이) — 물리 픽셀.
fn rect_of(hwnd: HWND) -> (i32, i32, i32, i32) {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.expect("창의 사각형");
    (rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
}

fn scale_of(hwnd: HWND) -> f64 {
    f64::from(unsafe { GetDpiForWindow(hwnd) }.max(96)) / 96.0
}

fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let until = Instant::now() + timeout;
    loop {
        if condition() {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        thread::sleep(POLL);
    }
}

/// 창의 사각형이 `quiet` 동안 그대로일 때까지 기다린 뒤 그 사각형.
fn settled_rect(hwnd: HWND, quiet: Duration) -> (i32, i32, i32, i32) {
    let mut last = rect_of(hwnd);
    let mut since = Instant::now();
    let until = Instant::now() + Duration::from_secs(20);
    while Instant::now() < until {
        thread::sleep(POLL);
        let now = rect_of(hwnd);
        if now != last {
            last = now;
            since = Instant::now();
        } else if since.elapsed() >= quiet {
            break;
        }
    }
    last
}

/// 앱을 띄우고, 오버레이 창이 보이고 **위젯에 맞춰진**(시작 크기에서 달라진) 뒤의 사각형을 돌려준다.
fn launch_fitted(accounts: &TempAccounts) -> (App, HWND, (i32, i32, i32, i32)) {
    let mut app = App::launch(&accounts.0);
    let pid = app.0.id();
    let mut window = None;
    let mut exited = None;
    let shown = wait_until(STARTUP, || {
        exited = app.0.try_wait().expect("프로세스 상태");
        window = overlay_window(pid).filter(|hwnd| unsafe { IsWindowVisible(*hwnd) }.as_bool());
        exited.is_some() || window.is_some()
    });
    assert!(
        exited.is_none(),
        "앱이 곧바로 끝났다({exited:?}) — 이미 다른 앱이 떠 있는 것으로 보인다. 끄고 다시 돌려라"
    );
    assert!(shown, "오버레이 창이 {}초 안에 뜨지 않았다", STARTUP.as_secs());
    let hwnd = window.expect("오버레이 창");
    let scale = scale_of(hwnd);
    let start = (
        (f64::from(START_SIZE.0) * scale).round() as i32,
        (f64::from(START_SIZE.1) * scale).round() as i32,
    );
    // 화면이 그려지고 위젯의 크기를 알려 올 때까지: 시작 크기에서 달라진다.
    let fitted = wait_until(STARTUP, || {
        let (_, _, w, h) = rect_of(hwnd);
        (w, h) != start
    });
    assert!(
        fitted,
        "오버레이 창이 시작 크기({start:?})에서 바뀌지 않았다 — 화면이 위젯의 크기를 알려 오지 않았다(화면 서버가 떠 있는가?)"
    );
    // 이미지가 늦게 와 한두 번 더 바뀔 수 있다: 가라앉을 때까지 기다린다.
    let rect = settled_rect(hwnd, Duration::from_millis(1500));
    (app, hwnd, rect)
}

/// `NIKKE_WIDGET_SHOTS`에 폴더를 줬으면 오버레이 창(이 앱의 창)을 찍어 둔다. 찍지 못해도 테스트는 계속한다.
fn snapshot(hwnd: HWND, label: &str) {
    let Ok(dir) = std::env::var("NIKKE_WIDGET_SHOTS") else {
        return;
    };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    let seed = GameWindowInfo {
        hwnd: hwnd.0 as i64,
        pid,
        process_name: "nikke-companion.exe(test)".to_string(),
        title: OVERLAY_TITLE.to_string(),
        client: ScreenRect::default(),
        frame: ScreenRect::default(),
        minimized: false,
        foreground: false,
        scale_factor: 1.0,
    };
    let shot = refresh_game_window(&seed)
        .ok_or_else(|| "창 정보를 읽지 못했다".to_string())
        .and_then(|info| capture_window(&info).map_err(|e| e.to_string()))
        .and_then(|(frame, _)| save_png(Path::new(&dir), label, &frame).map_err(|e| e.to_string()));
    match shot {
        Ok(path) => println!("찍어 둔 곳: {}", path.display()),
        Err(e) => println!("{label}: 찍지 못했다 — {e}"),
    }
}

fn require_dev_server() {
    let addr: SocketAddr = DEV_SERVER.parse().expect("주소");
    let up = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).is_ok()
        || TcpStream::connect_timeout(&"[::1]:1420".parse().expect("주소"), Duration::from_secs(2)).is_ok();
    assert!(
        up,
        "화면 서버({DEV_SERVER})가 떠 있지 않다 — 다른 터미널에서 `npm --prefix app run dev`를 먼저 띄워라"
    );
}

fn with_shape(shape: Shape) -> Stored {
    Stored {
        prefs: Prefs {
            default_shape: shape,
            ..Prefs::default()
        },
        ..Stored::default()
    }
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱과 화면 서버(npm --prefix app run dev)가 필요하다(앱을 실제로 띄운다)"]
fn the_window_shrinks_and_grows_with_the_shape_and_keeps_its_corner() {
    require_dev_server();
    let accounts = TempAccounts::new("shapes");
    let mut sizes = Vec::new();
    for shape in [Shape::Collapsed, Shape::Card, Shape::Expanded] {
        accounts.store(&with_shape(shape));
        let (app, hwnd, rect) = launch_fitted(&accounts);
        let scale = scale_of(hwnd);
        println!("{shape:?}: 창 {rect:?} (배율 {scale})");
        snapshot(hwnd, &format!("widget-{}", shape.key()));
        sizes.push((shape, rect, scale));
        drop(app);
        thread::sleep(Duration::from_millis(500));
    }
    let (_, pill, scale) = sizes[0];
    let (_, card, _) = sizes[1];
    let (_, expanded, _) = sizes[2];
    let px = |logical: f64| (logical * scale).round() as i32;

    // 한 줄 카드: 폭은 위젯의 폭(480)이고, 높이는 카드 한 장과 한 줄이다.
    assert!((card.2 - px(480.0)).abs() <= 2, "한 줄 카드의 폭이 위젯의 폭이 아니다: {card:?}");
    assert!(card.3 > px(50.0) && card.3 < px(130.0), "한 줄 카드의 높이가 이상하다: {card:?}");
    // 접힘: 카드보다 좁고 낮다(알약 — 내용만큼만).
    assert!(pill.2 < card.2 - px(100.0), "접힌 알약이 카드만큼 넓다: {pill:?} / {card:?}");
    assert!(pill.3 < card.3, "접힌 알약이 카드보다 낮지 않다: {pill:?} / {card:?}");
    assert!(pill.2 <= px(300.0) + 2 && pill.3 <= px(60.0), "접힌 알약이 너무 크다: {pill:?}");
    // 펼침: 폭은 같고 훨씬 높다.
    assert!((expanded.2 - card.2).abs() <= 2, "펼침의 폭이 카드와 다르다: {expanded:?}");
    assert!(expanded.3 > card.3 + px(150.0), "펼침이 카드보다 충분히 높지 않다: {expanded:?} / {card:?}");
    // 어느 것도 시작 크기 그대로가 아니다 — 빈 투명 영역이 남지 않는다.
    // 기본 자리(오른쪽 위)에서는 오른쪽 위 모서리가 제자리다: 모양이 달라도 오른쪽 끝과 위쪽이 같다.
    for (shape, rect, _) in &sizes {
        assert_eq!(rect.0 + rect.2, card.0 + card.2, "{shape:?}: 오른쪽 끝이 달라졌다 {rect:?} / {card:?}");
        assert_eq!(rect.1, card.1, "{shape:?}: 위쪽이 달라졌다 {rect:?} / {card:?}");
    }
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱과 화면 서버(npm --prefix app run dev)가 필요하다(앱을 실제로 띄운다)"]
fn a_dragged_position_is_remembered_and_an_off_screen_one_is_brought_back() {
    require_dev_server();
    let accounts = TempAccounts::new("place");
    accounts.store(&with_shape(Shape::Card));
    let (app, hwnd, first) = launch_fitted(&accounts);
    println!("처음 자리: {first:?}");
    assert_eq!(accounts.stored().spot, None, "끌기 전에는 기억한 자리가 없다");

    // 사용자가 끌어 둔 것처럼 창을 옮긴다(화면 왼쪽 위 근처).
    let target = (first.0 - 300, first.1 + 200);
    unsafe { SetWindowPos(hwnd, None, target.0, target.1, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) }
        .expect("오버레이 창 옮기기");
    // 끌기가 끝난 것으로 보고(0.4초) 디스크에 적는다.
    assert!(
        wait_until(Duration::from_secs(10), || accounts.stored().spot.is_some()),
        "옮긴 자리가 설정 파일에 적히지 않았다"
    );
    let spot = accounts.stored().spot.expect("기억한 자리");
    println!("기억한 자리: {spot:?}");
    let moved = rect_of(hwnd);
    assert_eq!((moved.0, moved.1), target, "옮긴 자리에 있지 않다(앱이 되돌렸다)");
    // 기억한 것은 그 모서리 점이다.
    let corner_x = if matches!(spot.corner, Corner::TopRight | Corner::BottomRight) { moved.0 + moved.2 } else { moved.0 };
    let corner_y = if matches!(spot.corner, Corner::BottomLeft | Corner::BottomRight) { moved.1 + moved.3 } else { moved.1 };
    assert_eq!((spot.x, spot.y), (corner_x, corner_y));
    drop(app);
    thread::sleep(Duration::from_millis(500));

    // 다시 켜면 그 자리에 뜬다.
    let (app, hwnd, again) = launch_fitted(&accounts);
    println!("다시 켠 자리: {again:?}");
    assert_eq!((again.0, again.1), target, "다시 켰을 때 기억한 자리가 아니다");

    // 화면 밖에 놓는다(가상 화면의 오른쪽 아래 너머): 안쪽으로 되돌아온다.
    let screen = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    let outside = (screen.0 + screen.2 - 40, screen.1 + screen.3 - 20);
    unsafe { SetWindowPos(hwnd, None, outside.0, outside.1, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) }
        .expect("오버레이 창 옮기기");
    let inside = |rect: (i32, i32, i32, i32)| {
        rect.0 >= screen.0 && rect.1 >= screen.1 && rect.0 + rect.2 <= screen.0 + screen.2 && rect.1 + rect.3 <= screen.1 + screen.3
    };
    assert!(
        wait_until(Duration::from_secs(10), || inside(rect_of(hwnd))),
        "화면 밖에 놓은 오버레이가 안쪽으로 돌아오지 않았다: {:?} (화면 {screen:?})",
        rect_of(hwnd)
    );
    println!("되돌아온 자리: {:?}", rect_of(hwnd));
    drop(app);
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱과 화면 서버(npm --prefix app run dev)가 필요하다(앱을 실제로 띄운다)"]
fn click_through_left_on_comes_back_on_and_the_overlay_is_still_visible() {
    require_dev_server();
    let accounts = TempAccounts::new("click-through");
    accounts.store(&Stored {
        prefs: Prefs {
            click_through: true,
            ..Prefs::default()
        },
        ..Stored::default()
    });
    let (app, hwnd, rect) = launch_fitted(&accounts);
    println!("클릭 통과를 켠 채 뜬 창: {rect:?}");
    snapshot(hwnd, "widget-click-through");
    let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
    assert_ne!(ex_style & WS_EX_TRANSPARENT.0, 0, "클릭 통과 스타일이 걸려 있지 않다");
    assert!(unsafe { IsWindowVisible(hwnd) }.as_bool(), "클릭 통과를 켠 채 뜬 오버레이가 보이지 않는다");
    // 설정은 그대로 남아 있다.
    assert!(accounts.stored().prefs.click_through);
    drop(app);
}
