//! 중복 실행 방지를 실제 실행 파일로 확인한다: 오버레이를 띄운 채 한 번 더 실행하면 두 번째는 창을 만들지 않고
//! 끝나고, 떠 있던 창이 숨겨져 있었다면 다시 보인다 — 활성화 없이.
//!
//! 화면이 켜진 Windows 데스크톱과 WebView2가 필요해서 `#[ignore]`다:
//!
//! ```bash
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_single_instance -- --ignored --nocapture
//! ```
//!
//! 10초쯤 화면 오른쪽 위에 오버레이 창이 떴다 사라진다(개발용 실행 파일이라 화면 서버가 없으면 내용은 비어 있거나
//! 연결 오류 쪽이다 — 창과 프로세스만 본다). 띄우는 동안 전역 단축키 Alt+Shift+C/O/S가 잠깐 등록된다.
//! **이미 오버레이가 떠 있으면 실패한다**(이 테스트의 첫 실행이 두 번째 실행이 되어 곧바로 끝난다) — 끄고 돌린다.
//!
//! 이 테스트가 창을 숨기는 대상은 자기가 띄운 오버레이 창뿐이다(「숨겨져 있었다」는 상태를 만들려고). 게임 창을
//! 찾거나 건드리지 않는다.

#![cfg(windows)]

use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    ShowWindowAsync, SW_HIDE,
};

/// 오버레이 실행 파일(cargo가 이 테스트를 위해 빌드한 것).
const OVERLAY_EXE: &str = env!("CARGO_BIN_EXE_nikke-companion");
/// 오버레이 창의 제목(tauri.conf.json).
const OVERLAY_TITLE: &str = "니케 컴패니언";

/// 창이 뜨거나 프로세스가 끝나기를 기다리는 시간.
const STARTUP: Duration = Duration::from_secs(40);
const POLL: Duration = Duration::from_millis(50);

/// 테스트가 띄운 오버레이. 테스트가 끝나면(실패해도) 끝낸다.
struct Overlay(Child);

impl Overlay {
    fn launch() -> Self {
        let child = Command::new(OVERLAY_EXE)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|e| panic!("오버레이를 실행하지 못했다: {OVERLAY_EXE} ({e})"));
        Self(child)
    }

    fn pid(&self) -> u32 {
        self.0.id()
    }

    fn exited(&mut self) -> Option<ExitStatus> {
        self.0.try_wait().expect("프로세스 상태를 읽지 못했다")
    }
}

impl Drop for Overlay {
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

/// 그 프로세스가 가진 최상위 창 가운데 오버레이 창(제목으로 가린다). 보이든 숨겨져 있든 센다.
fn overlay_windows(pid: u32) -> Vec<HWND> {
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut all as *mut Vec<HWND> as isize));
    }
    all.into_iter()
        .filter(|hwnd| {
            let mut owner = 0u32;
            unsafe { GetWindowThreadProcessId(*hwnd, Some(&mut owner)) };
            owner == pid && title_of(*hwnd) == OVERLAY_TITLE
        })
        .collect()
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

/// 한 번 더 실행하고 끝날 때까지 기다린다. 그동안 그 프로세스가 오버레이 창을 가진 적이 있는지 함께 본다.
fn launch_again() -> (ExitStatus, bool) {
    let mut second = Overlay::launch();
    let pid = second.pid();
    let mut had_window = false;
    let mut status = None;
    let finished = wait_until(STARTUP, || {
        had_window |= !overlay_windows(pid).is_empty();
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
#[ignore = "화면이 켜진 Windows 데스크톱이 필요하다(오버레이를 실제로 띄운다). 이미 떠 있는 오버레이는 끄고 돌린다"]
fn a_second_launch_exits_quietly_and_reveals_the_hidden_overlay() {
    let mut first = Overlay::launch();
    let pid = first.pid();

    // 첫 실행: 오버레이 창 하나가 뜬다.
    let mut early_exit = None;
    let shown = wait_until(STARTUP, || {
        early_exit = first.exited();
        early_exit.is_some() || overlay_windows(pid).iter().any(|hwnd| is_visible(*hwnd))
    });
    assert!(
        early_exit.is_none(),
        "첫 실행이 곧바로 끝났다({early_exit:?}) — 이미 다른 오버레이가 떠 있는 것으로 보인다. 끄고 다시 돌려라"
    );
    assert!(shown, "오버레이 창이 {}초 안에 뜨지 않았다", STARTUP.as_secs());
    let windows = overlay_windows(pid);
    assert_eq!(windows.len(), 1, "오버레이 창이 하나여야 한다");
    let overlay = windows[0];
    println!("첫 실행: pid {pid}, 창 {:?}", overlay.0);

    // 두 번째 실행: 창을 만들지 않고 조용히(종료 코드 0) 끝난다. 떠 있던 창은 그대로 하나다.
    let started = Instant::now();
    let (status, had_window) = launch_again();
    println!(
        "두 번째 실행: {:.1}초 만에 {status:?}로 끝났다",
        started.elapsed().as_secs_f64()
    );
    assert_eq!(status.code(), Some(0), "두 번째 실행이 오류로 끝났다");
    assert!(!had_window, "두 번째 실행이 오버레이 창을 만들었다");
    assert!(first.exited().is_none(), "떠 있던 오버레이가 끝나 버렸다");
    assert_eq!(overlay_windows(pid), vec![overlay], "떠 있던 오버레이의 창이 달라졌다");
    assert!(is_visible(overlay), "보이던 오버레이가 숨겨졌다");

    // 숨겨져 있었다면: 한 번 더 실행하면 다시 보인다 — 활성화 없이.
    // (숨기는 것은 이 테스트가 띄운 오버레이 창이다. 앱 안의 상태는 「보임」 그대로라서, 보이기 요청을
    //  상태와 무관하게 창에 거는지도 함께 확인된다.)
    assert!(unsafe { ShowWindowAsync(overlay, SW_HIDE) }.as_bool());
    assert!(
        wait_until(Duration::from_secs(5), || !is_visible(overlay)),
        "오버레이 창을 숨기지 못했다"
    );
    let (status, had_window) = launch_again();
    assert_eq!(status.code(), Some(0));
    assert!(!had_window, "세 번째 실행이 오버레이 창을 만들었다");
    assert!(
        wait_until(Duration::from_secs(5), || is_visible(overlay)),
        "숨겨져 있던 오버레이가 다시 보이지 않았다"
    );
    // 활성화하지 않는다: 다시 보인 오버레이가 전경 창(입력을 받는 창)이 되지 않았다.
    thread::sleep(Duration::from_millis(300));
    let foreground = unsafe { GetForegroundWindow() };
    assert_ne!(
        foreground, overlay,
        "다시 보인 오버레이가 키보드 포커스를 가져갔다"
    );
    assert_eq!(overlay_windows(pid), vec![overlay]);
    assert!(first.exited().is_none());
}
