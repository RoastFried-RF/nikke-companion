//! 실제로 실행 중인 니케 PC판을 상대로 한 테스트. 게임이 창 모드로 떠 있고 최소화돼 있지 않아야 한다.
//!
//! 평소 `cargo test`에서는 돌지 않는다(`#[ignore]`). 게임을 띄운 뒤에 직접 돌린다:
//!
//! ```bash
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_game -- --ignored
//! ```
//!
//! 확인하는 것:
//! - 게임 창을 찾는다(런처가 아니다)
//! - 캡처한 이미지의 크기가 클라이언트 영역과 같고, 검은 화면이 아니다
//! - 캡처 전후로 게임 창의 위치·크기·전경 여부가 바뀌지 않는다(게임은 읽기만 한다)
//! - 다른 창이 게임 화면을 가리고 있어도 게임 화면이 찍힌다(이 테스트가 작은 창을 잠깐 띄워 가린다)
//! - 명령줄 도구가 `--info`와 캡처 저장을 한다
//!
//! 캡처 이미지는 계정 정보와 게임 화면을 담는다. 테스트가 쓴 파일은 `data/captures/` 아래에 두었다가 지운다.

#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use nikke_companion_lib::capture::{
    blank_kind, capture_game_to_dir, CaptureMethod, Frame,
};
use nikke_companion_lib::game_window::{
    capture_window, find_game_window, GameWindowInfo, GAME_PROCESS, GAME_TITLE, LAUNCHER_PROCESS,
};
use serde_json::Value;

/// 테스트를 하나씩 돌린다 — 캡처 전후 비교가 서로 섞이지 않게.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// 이 테스트가 쓰는 캡처 폴더(`data/captures/_live-test-…`). 끝나면(실패해도) 지운다.
struct ScratchCaptures(PathBuf);

impl ScratchCaptures {
    fn new(tag: &str) -> Self {
        let dir = repo_root()
            .join("data")
            .join("captures")
            .join(format!("_live-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Self(dir)
    }
}

impl Drop for ScratchCaptures {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn game_window() -> GameWindowInfo {
    let window = find_game_window()
        .unwrap_or_else(|e| panic!("게임 창을 찾지 못했다 — 니케를 띄운 뒤에 돌려라: {e}"));
    assert!(
        !window.minimized,
        "게임 창이 최소화돼 있다 — 창을 띄운 뒤에 돌려라: {window:?}"
    );
    window
}

/// 캡처 전후에 그대로여야 하는 것: 같은 창, 같은 위치·크기, 같은 전경 여부, 최소화 아님.
fn assert_untouched(before: &GameWindowInfo, after: &GameWindowInfo) {
    assert_eq!(after.hwnd, before.hwnd, "다른 창이 됐다");
    assert_eq!(after.pid, before.pid);
    assert_eq!(after.client, before.client, "게임 화면 영역의 위치·크기가 바뀌었다");
    assert_eq!(after.frame, before.frame, "게임 창의 위치·크기가 바뀌었다");
    assert_eq!(after.minimized, before.minimized, "최소화 여부가 바뀌었다");
    assert_eq!(after.foreground, before.foreground, "전경 여부가 바뀌었다");
}

/// 검지 않은 픽셀의 비율.
fn non_black_ratio(frame: &Frame) -> f64 {
    let pixels = frame.rgb.as_chunks::<3>().0;
    let total = pixels.len().max(1);
    let lit = pixels.iter().filter(|p| p.iter().any(|c| *c > 8)).count();
    lit as f64 / total as f64
}

fn read_png(path: &Path) -> (u32, u32, Vec<u8>) {
    let decoder = png::Decoder::new(std::io::BufReader::new(fs::File::open(path).unwrap()));
    let mut reader = decoder.read_info().unwrap();
    let (width, height) = (reader.info().width, reader.info().height);
    assert_eq!(reader.info().color_type, png::ColorType::Rgb);
    let mut buf = vec![0; width as usize * height as usize * 3];
    reader.next_frame(&mut buf).unwrap();
    (width, height, buf)
}

#[test]
#[ignore = "실행 중인 니케(nikke.exe)가 필요하다"]
fn finds_the_game_window_and_not_the_launcher() {
    let _serial = serial();
    let window = game_window();
    println!("게임 창: {window:?}");
    assert!(
        window.process_name.eq_ignore_ascii_case(GAME_PROCESS),
        "게임 프로세스의 창이 아니다: {window:?}"
    );
    assert!(!window.process_name.eq_ignore_ascii_case(LAUNCHER_PROCESS));
    assert_eq!(window.title.trim(), GAME_TITLE);
    assert!(window.hwnd != 0 && window.pid != 0);
    assert!(
        window.client.width >= 320 && window.client.height >= 240,
        "게임 화면 영역이 너무 작다: {:?}",
        window.client
    );
    // 클라이언트 영역은 창의 보이는 부분 안에 있다(제목 표시줄·테두리만큼 작거나 같다).
    let (c, f) = (window.client, window.frame);
    assert!(c.x >= f.x && c.y >= f.y, "{window:?}");
    assert!(
        i64::from(c.x) + i64::from(c.width) <= i64::from(f.x) + i64::from(f.width)
            && i64::from(c.y) + i64::from(c.height) <= i64::from(f.y) + i64::from(f.height),
        "{window:?}"
    );
    assert!(
        (0.5..=5.0).contains(&window.scale_factor),
        "모니터 배율이 이상하다: {}",
        window.scale_factor
    );
    // 다시 찾아도 같은 창이다.
    assert_eq!(game_window().hwnd, window.hwnd);
}

#[test]
#[ignore = "실행 중인 니케(nikke.exe)가 필요하다"]
fn captures_the_client_area_without_touching_the_game_window() {
    let _serial = serial();
    let before = game_window();
    let started = Instant::now();
    let (frame, method) = capture_window(&before)
        .unwrap_or_else(|e| panic!("캡처하지 못했다: {e}"));
    let took = started.elapsed();
    let after = game_window();

    println!(
        "캡처: {}×{} ({}, {}ms), 검지 않은 픽셀 {:.1}%",
        frame.width,
        frame.height,
        method.name(),
        took.as_millis(),
        non_black_ratio(&frame) * 100.0
    );
    // 크기가 클라이언트 영역과 같다(제목 표시줄·테두리 없음, 원본 해상도).
    assert_eq!(
        (frame.width, frame.height),
        (before.client.width, before.client.height)
    );
    assert_eq!(
        frame.rgb.len(),
        frame.width as usize * frame.height as usize * 3
    );
    // 검은 화면이 아니다.
    assert_eq!(blank_kind(&frame), None, "빈 화면이 찍혔다");
    assert!(
        non_black_ratio(&frame) >= 0.001,
        "거의 전부 검은 화면이 찍혔다(검지 않은 픽셀 {:.3}%)",
        non_black_ratio(&frame) * 100.0
    );
    // 게임 창은 그대로다.
    assert_untouched(&before, &after);
}

#[test]
#[ignore = "실행 중인 니케(nikke.exe)가 필요하다"]
fn saves_a_png_that_matches_the_client_area() {
    let _serial = serial();
    let scratch = ScratchCaptures::new("save");
    let before = game_window();
    let record = capture_game_to_dir(&scratch.0, Some("live test / 저장"))
        .unwrap_or_else(|e| panic!("저장하지 못했다: {e}"));
    let after = game_window();

    let path = PathBuf::from(&record.path);
    assert!(path.is_absolute() && path.is_file(), "{}", record.path);
    assert!(
        path.starts_with(std::path::absolute(&scratch.0).unwrap()),
        "{}",
        record.path
    );
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    assert!(name.ends_with("_live-test-저장.png"), "{name}");
    assert_eq!(
        (record.width, record.height),
        (before.client.width, before.client.height)
    );
    assert_eq!(record.window.hwnd, before.hwnd);
    assert!(record.captured_at.ends_with('Z') && record.captured_at.len() == 24);

    // 저장한 PNG를 다시 읽으면 같은 크기이고 빈 화면이 아니다.
    let (width, height, rgb) = read_png(&path);
    assert_eq!((width, height), (record.width, record.height));
    let frame = Frame { width, height, rgb };
    assert_eq!(blank_kind(&frame), None);
    assert_untouched(&before, &after);
}

#[test]
#[ignore = "실행 중인 니케(nikke.exe)가 필요하다"]
fn cli_prints_window_info_and_saves_a_capture() {
    let _serial = serial();
    let scratch = ScratchCaptures::new("cli");
    let before = game_window();
    let exe = env!("CARGO_BIN_EXE_nikke-capture");

    let info = Command::new(exe).arg("--info").output().unwrap();
    assert_eq!(
        info.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&info.stderr)
    );
    let stdout = String::from_utf8(info.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 1);
    let json: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(json["hwnd"], before.hwnd);
    assert_eq!(json["process_name"].as_str().map(str::to_lowercase), Some(GAME_PROCESS.to_string()));
    assert_eq!(json["client"]["width"], before.client.width);
    assert_eq!(json["client"]["height"], before.client.height);
    assert_eq!(json["client"]["x"], before.client.x);
    assert_eq!(json["client"]["y"], before.client.y);
    assert_eq!(json["minimized"], false);
    assert!(json["foreground"].is_boolean());
    assert!(json["scale_factor"].as_f64().unwrap() > 0.0);

    let shot = Command::new(exe)
        .arg("--out")
        .arg(&scratch.0)
        .args(["--name", "cli:live"])
        .output()
        .unwrap();
    assert_eq!(
        shot.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&shot.stderr)
    );
    let stdout = String::from_utf8(shot.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 1);
    let json: Value = serde_json::from_str(&stdout).unwrap();
    let keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        ["path", "width", "height", "captured_at", "method", "window"]
    );
    let path = PathBuf::from(json["path"].as_str().unwrap());
    assert!(path.is_file());
    assert!(path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .ends_with("_clilive.png"));
    let (width, height, _) = read_png(&path);
    assert_eq!(json["width"], width);
    assert_eq!(json["height"], height);
    assert_eq!((width, height), (before.client.width, before.client.height));
    assert_untouched(&before, &game_window());
}

#[test]
#[ignore = "실행 중인 니케(nikke.exe)가 필요하다"]
fn captures_game_content_even_when_another_window_covers_it() {
    let _serial = serial();
    let before = game_window();
    // 게임 화면 가운데를 작은 자홍색 창으로 가린다(항상 위, 활성화하지 않음). 게임 창은 건드리지 않는다.
    let side = (before.client.width.min(before.client.height) / 4).clamp(64, 240) as i32;
    let left = before.client.x + (before.client.width as i32 - side) / 2;
    let top = before.client.y + (before.client.height as i32 - side) / 2;
    let cover = occluder::Cover::show(left, top, side, side);
    cover.pump(Duration::from_millis(250));

    // 가리개가 정말 화면에 보이는지 화면 픽셀로 확인한다 — 아니면 가린 상태를 만들지 못한 것이다.
    let on_screen = occluder::screen_pixel(left + side / 2, top + side / 2);
    let captured = capture_window(&before);
    cover.pump(Duration::from_millis(20));
    drop(cover);
    let after = game_window();

    let (r, g, b) = on_screen.expect("화면 픽셀을 읽지 못했다");
    assert!(
        r > 200 && g < 60 && b > 200,
        "가리개 창이 화면에 보이지 않는다(화면 픽셀 #{r:02x}{g:02x}{b:02x}) — 게임이 전용 전체 화면이거나 다른 창이 그 위에 있다"
    );
    let (frame, method) = captured.unwrap_or_else(|e| panic!("가려진 상태에서 캡처하지 못했다: {e}"));
    assert_eq!(method, CaptureMethod::Wgc, "가려진 창은 WGC로 찍혀야 한다");
    assert_eq!(
        (frame.width, frame.height),
        (before.client.width, before.client.height)
    );

    // 가린 자리(클라이언트 좌표)에 가리개의 색이 찍히지 않았다.
    let (x0, y0) = ((left - before.client.x) as usize, (top - before.client.y) as usize);
    let side = side as usize;
    let mut cover_coloured = 0usize;
    for y in y0..y0 + side {
        for x in x0..x0 + side {
            let i = (y * frame.width as usize + x) * 3;
            let (r, g, b) = (frame.rgb[i], frame.rgb[i + 1], frame.rgb[i + 2]);
            if r > 240 && g < 16 && b > 240 {
                cover_coloured += 1;
            }
        }
    }
    let ratio = cover_coloured as f64 / (side * side) as f64;
    println!(
        "가린 영역 {side}×{side}: 가리개 색 픽셀 {:.2}% ({})",
        ratio * 100.0,
        method.name()
    );
    assert!(
        ratio < 0.5,
        "가리개 창이 캡처에 찍혔다({:.0}%) — 게임 화면이 아니라 화면에 보이는 것을 찍고 있다",
        ratio * 100.0
    );
    assert_eq!(blank_kind(&frame), None);
    assert_untouched(&before, &after);
}

/// 게임 화면을 잠깐 가리는 이 테스트의 창. 게임 창에는 아무것도 하지 않는다.
mod occluder {
    use std::time::{Duration, Instant};

    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateSolidBrush, GetDC, GetPixel, ReleaseDC, CLR_INVALID};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW,
        RegisterClassW, TranslateMessage, MSG, PM_REMOVE, WNDCLASSW, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
    };

    /// 자홍색(#ff00ff). COLORREF는 0x00BBGGRR이다.
    const MAGENTA: COLORREF = COLORREF(0x00FF_00FF);

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    pub struct Cover(HWND);

    impl Cover {
        /// 화면 좌표(물리 픽셀)에 항상 위·비활성 창을 띄운다.
        pub fn show(x: i32, y: i32, width: i32, height: i32) -> Self {
            unsafe {
                SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                let instance = GetModuleHandleW(None).expect("모듈 핸들");
                let class = w!("NikkeCompanionLiveTestCover");
                let wc = WNDCLASSW {
                    lpfnWndProc: Some(wndproc),
                    hInstance: instance.into(),
                    lpszClassName: class,
                    hbrBackground: CreateSolidBrush(MAGENTA),
                    ..Default::default()
                };
                // 같은 프로세스에서 두 번째로 등록하면 실패한다 — 이미 있으면 그대로 쓴다.
                RegisterClassW(&wc);
                let hwnd = CreateWindowExW(
                    WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                    class,
                    w!("nikke-companion live test"),
                    WS_POPUP | WS_VISIBLE,
                    x,
                    y,
                    width,
                    height,
                    None,
                    None,
                    Some(instance.into()),
                    None,
                )
                .expect("가리개 창을 만들지 못했다");
                Self(hwnd)
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

    impl Drop for Cover {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }

    /// 화면의 한 점의 색(R, G, B). 화면에 실제로 보이는 것을 읽는다.
    pub fn screen_pixel(x: i32, y: i32) -> Option<(u8, u8, u8)> {
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
