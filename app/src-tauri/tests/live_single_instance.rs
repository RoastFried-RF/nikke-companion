//! 창 둘과 중복 실행 방지를 실제 실행 파일로 확인한다(P-027):
//!
//! - 앱을 실행하면 **데스크톱 앱 창**(보통 창)이 뜨고, **오버레이 창**은 설정대로 함께 뜬다(기본) — 또는 숨긴 채로 시작한다.
//! - 앱을 띄운 채 한 번 더 실행하면 두 번째는 창을 만들지 않고 끝나고, 떠 있던 앱 창이 앞으로 온다(최소화돼 있었으면 되돌린다).
//!   오버레이 창은 건드리지 않는다.
//! - 앱 창을 닫으면 프로세스가 끝난다(오버레이만 남지 않는다).
//!
//! 화면이 켜진 Windows 데스크톱과 WebView2가 필요해서 `#[ignore]`다:
//!
//! ```bash
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_single_instance -- --ignored --nocapture --test-threads=1
//! ```
//!
//! 20초쯤 앱 창과 오버레이 창이 떴다 사라진다(개발용 실행 파일이라 화면 서버가 없으면 내용은 비어 있거나 연결 오류 쪽이다 —
//! 창과 프로세스만 본다). 띄우는 동안 전역 단축키 Alt+Shift+C/O/S가 잠깐 등록된다.
//! **이미 앱이 떠 있으면 실패한다**(이 테스트의 첫 실행이 두 번째 실행이 되어 곧바로 끝난다) — 끄고 돌린다.
//!
//! 실제 계정 폴더는 쓰지 않는다: 띄우는 실행 파일에 `NIKKE_ACCOUNTS_DIR`로 임시 폴더를 준다(오버레이를 언제 띄울지의 설정이
//! 그 폴더에 있다). 이 테스트가 최소화하거나 닫는 것은 자기가 띄운 앱의 창뿐이다. 게임 창을 찾거나 건드리지 않는다.

#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use nikke_companion_lib::shared_state::{self, OverlayLaunch, StoredState};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    PostMessageW, ShowWindowAsync, SW_MINIMIZE, WM_CLOSE,
};

/// 앱 실행 파일(cargo가 이 테스트를 위해 빌드한 것).
const APP_EXE: &str = env!("CARGO_BIN_EXE_nikke-companion");
/// 데스크톱 앱 창과 오버레이 창의 제목(tauri.conf.json).
const APP_TITLE: &str = "니케 컴패니언";
const OVERLAY_TITLE: &str = "니케 컴패니언 오버레이";

/// 창이 뜨거나 프로세스가 끝나기를 기다리는 시간.
const STARTUP: Duration = Duration::from_secs(40);
const POLL: Duration = Duration::from_millis(50);

/// 테스트용 임시 계정 폴더(실제 계정 폴더 대신). 끝나면 지운다.
struct TempAccounts(PathBuf);

impl TempAccounts {
    fn new(label: &str, launch: OverlayLaunch) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-live-windows-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("임시 계정 폴더");
        shared_state::write_state(
            &dir,
            &StoredState {
                default_account: None,
                overlay_launch: launch,
            },
        )
        .expect("오버레이 설정 쓰기");
        Self(dir)
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

    fn pid(&self) -> u32 {
        self.0.id()
    }

    fn exited(&mut self) -> Option<ExitStatus> {
        self.0.try_wait().expect("프로세스 상태를 읽지 못했다")
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

fn title_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0).min(buf.len())])
}

fn is_visible(hwnd: HWND) -> bool {
    unsafe { IsWindowVisible(hwnd) }.as_bool()
}

fn is_minimized(hwnd: HWND) -> bool {
    unsafe { IsIconic(hwnd) }.as_bool()
}

/// 그 프로세스가 가진 최상위 창 가운데 그 제목의 창. 보이든 숨겨져 있든 센다.
fn windows_titled(pid: u32, title: &str) -> Vec<HWND> {
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut all as *mut Vec<HWND> as isize));
    }
    all.into_iter()
        .filter(|hwnd| {
            let mut owner = 0u32;
            unsafe { GetWindowThreadProcessId(*hwnd, Some(&mut owner)) };
            owner == pid && title_of(*hwnd) == title
        })
        .collect()
}

/// 그 프로세스가 가진 앱의 창(앱 창 + 오버레이 창)의 수.
fn app_window_count(pid: u32) -> usize {
    windows_titled(pid, APP_TITLE).len() + windows_titled(pid, OVERLAY_TITLE).len()
}

/// 조건이 참이 될 때까지 기다린다. 시간 안에 안 되면 `false`.
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

/// 앱을 띄우고 앱 창이 보일 때까지 기다린다. 돌려주는 것은 (앱, 앱 창, 오버레이 창).
fn launch_and_find(accounts: &Path) -> (App, HWND, HWND) {
    let mut app = App::launch(accounts);
    let pid = app.pid();
    let mut early_exit = None;
    let shown = wait_until(STARTUP, || {
        early_exit = app.exited();
        early_exit.is_some()
            || (windows_titled(pid, APP_TITLE).iter().any(|hwnd| is_visible(*hwnd))
                && !windows_titled(pid, OVERLAY_TITLE).is_empty())
    });
    assert!(
        early_exit.is_none(),
        "첫 실행이 곧바로 끝났다({early_exit:?}) — 이미 다른 앱이 떠 있는 것으로 보인다. 끄고 다시 돌려라"
    );
    assert!(shown, "앱 창이 {}초 안에 뜨지 않았다", STARTUP.as_secs());
    let app_windows = windows_titled(pid, APP_TITLE);
    let overlay_windows = windows_titled(pid, OVERLAY_TITLE);
    assert_eq!(app_windows.len(), 1, "데스크톱 앱 창이 하나여야 한다");
    assert_eq!(overlay_windows.len(), 1, "오버레이 창이 하나여야 한다");
    (app, app_windows[0], overlay_windows[0])
}

/// 한 번 더 실행하고 끝날 때까지 기다린다. 그동안 그 프로세스가 창을 가진 적이 있는지 함께 본다.
fn launch_again(accounts: &Path) -> (ExitStatus, bool) {
    let mut second = App::launch(accounts);
    let pid = second.pid();
    let mut had_window = false;
    let mut status = None;
    let finished = wait_until(STARTUP, || {
        had_window |= app_window_count(pid) > 0;
        status = second.exited();
        status.is_some()
    });
    assert!(
        finished,
        "두 번째 실행이 {}초가 지나도 끝나지 않았다 — 창을 하나 더 띄운 것이다(창 있음: {had_window})",
        STARTUP.as_secs()
    );
    (status.expect("끝난 상태"), had_window)
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(앱을 실제로 띄운다). 이미 떠 있는 앱은 끄고 돌린다"]
fn the_app_window_and_the_overlay_come_up_and_a_second_launch_brings_the_app_forward() {
    let accounts = TempAccounts::new("with-app", OverlayLaunch::WithApp);
    let (mut first, app_window, overlay) = launch_and_find(&accounts.0);
    let pid = first.pid();
    println!("첫 실행: pid {pid}, 앱 창 {:?}, 오버레이 창 {:?}", app_window.0, overlay.0);

    // 「앱과 함께 띄우기」(기본): 앱 창과 오버레이 창이 모두 보인다.
    assert!(is_visible(app_window), "앱 창이 보여야 한다");
    assert!(
        wait_until(Duration::from_secs(10), || is_visible(overlay)),
        "오버레이 창이 앱과 함께 뜨지 않았다"
    );

    // 두 번째 실행: 창을 만들지 않고 조용히(종료 코드 0) 끝난다. 떠 있던 창은 그대로 둘이다.
    let started = Instant::now();
    let (status, had_window) = launch_again(&accounts.0);
    println!(
        "두 번째 실행: {:.1}초 만에 {status:?}로 끝났다",
        started.elapsed().as_secs_f64()
    );
    assert_eq!(status.code(), Some(0), "두 번째 실행이 오류로 끝났다");
    assert!(!had_window, "두 번째 실행이 창을 만들었다");
    assert!(first.exited().is_none(), "떠 있던 앱이 끝나 버렸다");
    assert_eq!(app_window_count(pid), 2, "떠 있던 앱의 창 수가 달라졌다");

    // 앱 창이 최소화돼 있었다면: 한 번 더 실행하면 되돌아온다. 오버레이 창은 그대로다.
    assert!(unsafe { ShowWindowAsync(app_window, SW_MINIMIZE) }.as_bool());
    assert!(
        wait_until(Duration::from_secs(5), || is_minimized(app_window)),
        "앱 창을 최소화하지 못했다"
    );
    let (status, had_window) = launch_again(&accounts.0);
    assert_eq!(status.code(), Some(0));
    assert!(!had_window, "세 번째 실행이 창을 만들었다");
    assert!(
        wait_until(Duration::from_secs(5), || !is_minimized(app_window)),
        "최소화돼 있던 앱 창이 되돌아오지 않았다"
    );
    assert!(is_visible(overlay), "오버레이 창이 숨겨졌다");
    assert_eq!(app_window_count(pid), 2);

    // 앱 창을 닫으면 프로세스가 끝난다 — 오버레이만 남지 않는다.
    unsafe { PostMessageW(Some(app_window), WM_CLOSE, WPARAM(0), LPARAM(0)) }
        .expect("앱 창에 닫기를 보내지 못했다");
    let mut status = None;
    assert!(
        wait_until(Duration::from_secs(15), || {
            status = first.exited();
            status.is_some()
        }),
        "앱 창을 닫았는데 프로세스가 끝나지 않았다(오버레이만 남았다)"
    );
    println!("앱 창을 닫자 {status:?}로 끝났다");
    assert_eq!(status.and_then(|s| s.code()), Some(0));
}

#[test]
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(앱을 실제로 띄운다). 이미 떠 있는 앱은 끄고 돌린다"]
fn the_overlay_stays_hidden_at_start_when_it_is_set_to_wait_and_closing_it_does_not_end_the_app() {
    // 「직접 띄우기」: 앱 창만 보이고 오버레이 창은 숨긴 채로 있다(게임을 찾았을 때 띄우기도 게임이 없으면 같다).
    let accounts = TempAccounts::new("manual", OverlayLaunch::Manual);
    let (mut app, app_window, overlay) = launch_and_find(&accounts.0);
    assert!(is_visible(app_window));
    thread::sleep(Duration::from_secs(2));
    assert!(!is_visible(overlay), "「직접 띄우기」인데 오버레이 창이 떴다");

    // 오버레이 창에 닫기를 보내도(Alt+F4 등) 앱은 끝나지 않고 창도 사라지지 않는다 — 숨길 뿐이다.
    unsafe { PostMessageW(Some(overlay), WM_CLOSE, WPARAM(0), LPARAM(0)) }
        .expect("오버레이 창에 닫기를 보내지 못했다");
    thread::sleep(Duration::from_secs(2));
    assert!(app.exited().is_none(), "오버레이 창을 닫았더니 앱이 끝났다");
    assert_eq!(windows_titled(app.pid(), OVERLAY_TITLE), vec![overlay]);
    assert!(is_visible(app_window));
}
