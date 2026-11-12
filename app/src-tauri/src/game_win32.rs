//! 게임 창을 실제로 읽는 Win32 호출: 창 열거, 창 정보, 화면 캡처.
//!
//! 규칙(무엇이 게임 창인가, 프레임이 쓸 만한가, 어디를 잘라 낼까)은 `game_window`·`capture`에 있고
//! 여기서는 값을 읽어 넘길 뿐이다.
//!
//! **게임은 읽기만 한다.** 이 파일이 쓰는 것은 다음뿐이다:
//! - 창 열거·창 속성 읽기: `EnumWindows`, `GetWindowTextW`, `GetWindowThreadProcessId`, `IsWindowVisible`,
//!   `IsIconic`, `GetClientRect`, `ClientToScreen`, `GetForegroundWindow`, `DwmGetWindowAttribute`
//! - 프로세스 이름: 시스템 프로세스 목록(`CreateToolhelp32Snapshot`). 게임 프로세스를 열지 않는다(핸들 없음)
//! - 캡처: Windows.Graphics.Capture(합성기가 넘겨주는 창 화면)
//!
//! 쓰지 않는 것: 창을 옮기거나 크기·순서·활성 상태를 바꾸는 호출(`SetWindowPos`, `ShowWindow`,
//! `SetForegroundWindow` 등), 입력·메시지 전송(`SendInput`, `PostMessage` 등), 창에 그리기를 시키는 호출
//! (`PrintWindow`), 프로세스 열기·메모리 읽기·주입. `tests/contract.test.ts`가 이 목록을 확인한다.

use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::size_of;
use std::sync::{Mutex, Once};
use std::thread;
use std::time::{Duration, Instant};

use windows::core::{Interface, BOOL};
use windows::Graphics::Capture::{
    Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{CloseHandle, HMODULE, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{ClientToScreen, MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::CoIncrementMTAUsage;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::HiDpi::{
    GetDpiForMonitor, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClientRect, GetForegroundWindow, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
};

use crate::capture::{bgra_to_rgb, check_frame, client_crop, CaptureMethod, Frame, Stamp};
use crate::game_window::{
    is_candidate, select_game_window, GameError, GameWindowInfo, ScreenRect, Selection,
    WindowCandidate,
};

/// WGC에서 첫 프레임을 기다리는 시간.
const FRAME_TIMEOUT: Duration = Duration::from_millis(2500);
/// 첫 프레임이 빈 화면이거나 크기가 안 맞을 때 다음 프레임을 더 기다리는 시간.
const RETRY_WINDOW: Duration = Duration::from_millis(700);
/// 프레임이 아직 없을 때 다시 물어보는 간격.
const FRAME_POLL: Duration = Duration::from_millis(4);

/// 이 스레드의 좌표를 물리 픽셀로 읽게 한다. 끝나면 원래대로 돌린다.
/// (프로세스 전체 설정은 건드리지 않는다 — 오버레이 창의 DPI 처리는 Tauri가 정한 그대로다.)
struct DpiScope(DPI_AWARENESS_CONTEXT);

impl DpiScope {
    fn enter() -> Self {
        Self(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) })
    }
}

impl Drop for DpiScope {
    fn drop(&mut self) {
        if !self.0 .0.is_null() {
            unsafe { SetThreadDpiAwarenessContext(self.0) };
        }
    }
}

fn hwnd_value(hwnd: HWND) -> isize {
    hwnd.0 as isize
}

fn hwnd_from(value: i64) -> HWND {
    HWND(value as isize as *mut c_void)
}

fn info_error(what: &str, e: impl std::fmt::Display) -> GameError {
    GameError::WindowInfo {
        detail: format!("{what}: {e}"),
    }
}

// ── 창 찾기 ───────────────────────────────────────────────────────────────────

/// 실행 중인 프로세스의 pid → 실행 파일 이름. 시스템 목록을 읽을 뿐 프로세스를 열지 않는다.
fn process_names() -> Result<HashMap<u32, String>, GameError> {
    let mut names = HashMap::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            .map_err(|e| info_error("프로세스 목록을 읽지 못했다", e))?;
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                names.insert(
                    entry.th32ProcessID,
                    String::from_utf16_lossy(&entry.szExeFile[..len]),
                );
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    Ok(names)
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let list = &mut *(lparam.0 as *mut Vec<HWND>);
    list.push(hwnd);
    BOOL(1)
}

/// 최상위 창 전부.
fn top_level_windows() -> Vec<HWND> {
    let mut list: Vec<HWND> = Vec::new();
    unsafe {
        // 열거가 중간에 실패해도 모은 데까지 쓴다.
        let _ = EnumWindows(
            Some(collect_window),
            LPARAM(&mut list as *mut Vec<HWND> as isize),
        );
    }
    list
}

fn window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0).min(buf.len())])
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

fn client_size(hwnd: HWND) -> (u32, u32) {
    let mut rect = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut rect) }.is_err() {
        return (0, 0);
    }
    (
        u32::try_from(rect.right - rect.left).unwrap_or(0),
        u32::try_from(rect.bottom - rect.top).unwrap_or(0),
    )
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let read = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        )
    };
    read.is_ok() && cloaked != 0
}

fn rect_to_screen(rect: RECT) -> ScreenRect {
    ScreenRect {
        x: rect.left,
        y: rect.top,
        width: u32::try_from(rect.right - rect.left).unwrap_or(0),
        height: u32::try_from(rect.bottom - rect.top).unwrap_or(0),
    }
}

/// 창에서 보이는 부분(제목 표시줄·테두리 포함, 보이지 않는 크기 조절 테두리 제외).
fn frame_bounds(hwnd: HWND) -> ScreenRect {
    let mut rect = RECT::default();
    let read = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            size_of::<RECT>() as u32,
        )
    };
    if read.is_err() {
        rect = RECT::default();
        let _ = unsafe { GetWindowRect(hwnd, &mut rect) };
    }
    rect_to_screen(rect)
}

fn monitor_scale(hwnd: HWND) -> f64 {
    let (mut dpi_x, mut dpi_y) = (0u32, 0u32);
    let read = unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y)
    };
    if read.is_ok() && dpi_x > 0 {
        f64::from(dpi_x) / 96.0
    } else {
        1.0
    }
}

/// 창 하나의 정보를 읽는다. 호출하는 쪽이 `DpiScope` 안이어야 좌표가 물리 픽셀이다.
fn read_info(hwnd: HWND, pid: u32, process_name: &str) -> GameWindowInfo {
    let (width, height) = client_size(hwnd);
    let mut origin = POINT::default();
    let _ = unsafe { ClientToScreen(hwnd, &mut origin) };
    GameWindowInfo {
        hwnd: hwnd_value(hwnd) as i64,
        pid,
        process_name: process_name.to_string(),
        title: window_title(hwnd),
        client: ScreenRect {
            x: origin.x,
            y: origin.y,
            width,
            height,
        },
        frame: frame_bounds(hwnd),
        minimized: unsafe { IsIconic(hwnd) }.as_bool(),
        foreground: unsafe { GetForegroundWindow() } == hwnd,
        scale_factor: monitor_scale(hwnd),
    }
}

/// 게임 창을 찾아 정보를 읽는다.
pub fn find_game_window() -> Result<GameWindowInfo, GameError> {
    let _dpi = DpiScope::enter();
    let processes = process_names()?;
    let mut handles: Vec<HWND> = Vec::new();
    let mut candidates: Vec<WindowCandidate> = Vec::new();
    for hwnd in top_level_windows() {
        let pid = window_pid(hwnd);
        let process_name = processes.get(&pid).map(String::as_str).unwrap_or("");
        let title = window_title(hwnd);
        if !is_candidate(process_name, &title) {
            continue;
        }
        let (client_width, client_height) = client_size(hwnd);
        handles.push(hwnd);
        candidates.push(WindowCandidate {
            hwnd: hwnd_value(hwnd),
            pid,
            process_name: process_name.to_string(),
            title,
            visible: unsafe { IsWindowVisible(hwnd) }.as_bool(),
            cloaked: is_cloaked(hwnd),
            minimized: unsafe { IsIconic(hwnd) }.as_bool(),
            client_width,
            client_height,
        });
    }
    match select_game_window(&candidates) {
        Selection::Game(index) => {
            let chosen = &candidates[index];
            Ok(read_info(handles[index], chosen.pid, &chosen.process_name))
        }
        Selection::LauncherOnly => Err(GameError::LauncherOnly),
        Selection::None => Err(GameError::NotRunning),
    }
}

/// 앞서 찾은 창을 다시 읽는다. 창이 없어졌거나 다른 프로세스의 창이 됐으면 `None`.
pub fn refresh_game_window(previous: &GameWindowInfo) -> Option<GameWindowInfo> {
    let _dpi = DpiScope::enter();
    let hwnd = hwnd_from(previous.hwnd);
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() || window_pid(hwnd) != previous.pid {
        return None;
    }
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return None;
    }
    Some(read_info(hwnd, previous.pid, &previous.process_name))
}

/// 이 PC의 현지 시각.
pub fn local_time() -> Stamp {
    let t = unsafe { GetLocalTime() };
    Stamp {
        year: i32::from(t.wYear),
        month: u32::from(t.wMonth),
        day: u32::from(t.wDay),
        hour: u32::from(t.wHour),
        minute: u32::from(t.wMinute),
        second: u32::from(t.wSecond),
        millis: u32::from(t.wMilliseconds),
    }
}

// ── 캡처 ─────────────────────────────────────────────────────────────────────

/// 게임 창의 클라이언트 영역을 찍는다. 결과의 크기는 `window.client`와 같다.
pub fn capture_window(window: &GameWindowInfo) -> Result<(Frame, CaptureMethod), GameError> {
    let _dpi = DpiScope::enter();
    let current = refresh_game_window(window).ok_or(GameError::NotRunning)?;
    if current.minimized {
        return Err(GameError::Minimized);
    }
    if current.client.is_empty() {
        return Err(GameError::EmptyClient);
    }
    let hwnd = hwnd_from(window.hwnd);
    let expected = (window.client.width, window.client.height);
    let frame = capture_wgc(hwnd, window, expected)?;
    Ok((frame, CaptureMethod::Wgc))
}

fn wgc_error(what: &str, e: impl std::fmt::Display) -> GameError {
    GameError::CaptureFailed {
        method: CaptureMethod::Wgc,
        detail: format!("{what}: {e}"),
    }
}

fn create_d3d_device(
    driver: D3D_DRIVER_TYPE,
) -> windows::core::Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            driver,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    match (device, context) {
        (Some(device), Some(context)) => Ok((device, context)),
        _ => Err(windows::core::Error::empty()),
    }
}

/// 이 프로세스가 끝날 때까지 COM(MTA)을 살려 둔다. 첫 WinRT 호출보다 먼저 한 번 부른다.
///
/// `windows` 크레이트는 WinRT 활성화 팩터리(`GraphicsCaptureSession::IsSupported` 등)를 프로세스 전역에 캐시한다.
/// 첫 캡처를 한 스레드가 COM을 쥔 유일한 스레드였다면(창을 가진 스레드는 Windows가 COM을 대신 초기화해 둔다),
/// 그 스레드가 끝날 때 COM이 내려가면서 캡처 DLL이 언로드되고 캐시된 팩터리가 죽은 주소를 가리킨다 —
/// 다른 스레드의 다음 캡처가 그 주소를 불러 프로세스가 죽는다(STATUS_ACCESS_VIOLATION).
/// 실제 게임 테스트(`tests/live_game.rs`: 가리개 창을 띄운 테스트 다음의 캡처)에서 드러났다.
/// MTA 사용 횟수를 하나 올려 두면 COM이 프로세스 수명 동안 내려가지 않는다. 일부러 되돌리지 않는다.
fn keep_winrt_loaded() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // 실패해도 캡처는 시도한다(이 경우 위 문제가 남을 뿐이다).
        // 쿠키는 CoDecrementMTAUsage에 넘길 때만 쓴다 — 넘기지 않으므로 버린다.
        let _ = unsafe { CoIncrementMTAUsage() };
    });
}

/// 캡처에 다시 쓰는 것들: Direct3D 장치 한 벌과, 마지막으로 찍은 창의 캡처 대상. 처음 캡처할 때 만든다.
///
/// 캡처마다 전부 새로 만들면 한 번에 약 200ms가 든다 — 장치 만들기 약 140ms, 캡처 대상 만들기 약 45ms
/// (`tests/live_track.rs`로 잰 값 — `app/README.md` §자동 추적 §걸리는 시간). 자동 추적은 2초마다 캡처하므로
/// 둘을 한 번만 만들어 다시 쓴다(한 번에 약 20ms). 프레임 풀과 세션은 여전히 캡처마다 새로 만들고 닫는다 —
/// 찍지 않는 동안에는 캡처가 돌지 않는다.
///
/// 장치만 다시 쓰고 캡처 대상을 매번 새로 만들면 100번에 한 번쯤 그 호출이 2초 동안 멈췄다(같은 테스트로 확인 —
/// 원인은 모른다). 그래서 캡처 대상도 창이 같은 동안에는 다시 쓴다.
struct CaptureDevice {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt: IDirect3DDevice,
    /// 마지막으로 찍은 창(핸들 값)과 그 창의 캡처 대상. 다른 창을 찍거나 캡처가 실패하면 새로 만든다.
    item: Option<(isize, GraphicsCaptureItem)>,
}

// SAFETY: Direct3D 11 장치는 여러 스레드에서 불러도 된다. 즉시 컨텍스트는 한 번에 한 스레드만 써야 하는데,
// 이 값은 `CAPTURE_DEVICE`의 잠금을 쥔 스레드만 만지므로(캡처 한 번이 끝날 때까지 쥔다) 겹치지 않는다.
// 장치·컨텍스트·캡처 대상 모두 스레드에 묶인 COM 객체가 아니다(아파트 마샬링이 없다). 만든 스레드가 끝나도
// COM은 `keep_winrt_loaded`가 프로세스 수명 동안 살려 둔다.
unsafe impl Send for CaptureDevice {}

/// 다시 쓰는 장치. 잠금은 캡처 한 번이 끝날 때까지 쥔다 — 캡처는 프로세스 안에서 한 번에 하나만 돈다.
static CAPTURE_DEVICE: Mutex<Option<CaptureDevice>> = Mutex::new(None);

impl CaptureDevice {
    fn create() -> Result<Self, GameError> {
        let (device, context) = create_d3d_device(D3D_DRIVER_TYPE_HARDWARE)
            .or_else(|_| create_d3d_device(D3D_DRIVER_TYPE_WARP))
            .map_err(|e| wgc_error("Direct3D 장치를 만들지 못했다", e))?;
        let dxgi: IDXGIDevice = device
            .cast()
            .map_err(|e| wgc_error("DXGI 장치를 얻지 못했다", e))?;
        let winrt: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }
            .and_then(|inspectable| inspectable.cast())
            .map_err(|e| wgc_error("캡처용 Direct3D 장치를 만들지 못했다", e))?;
        Ok(Self {
            device,
            context,
            winrt,
            item: None,
        })
    }

    /// 장치가 아직 쓸 만한가. 그래픽 드라이버가 다시 시작됐거나 장치가 제거됐으면 아니다.
    fn alive(&self) -> bool {
        unsafe { self.device.GetDeviceRemovedReason() }.is_ok()
    }

    /// 이 창의 캡처 대상. 같은 창이면 앞서 만든 것을 쓰고, 아니면 새로 만들어 둔다.
    fn item_for(&mut self, hwnd: HWND) -> Result<GraphicsCaptureItem, GameError> {
        let key = hwnd_value(hwnd);
        if let Some((kept, item)) = &self.item {
            if *kept == key {
                return Ok(item.clone());
            }
        }
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| wgc_error("캡처 대상을 만들 수 없다", e))?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(hwnd) }
            .map_err(|e| wgc_error("게임 창을 캡처 대상으로 만들지 못했다", e))?;
        self.item = Some((key, item.clone()));
        Ok(item)
    }
}

/// 이 오류 뒤에는 장치를 버리고 다음 캡처에서 새로 만든다: 캡처 API가 실패한 경우다(장치가 망가졌을 수 있다).
/// 최소화·빈 화면·크기 불일치는 장치와 무관하므로 장치를 그대로 둔다.
fn discards_device(error: &GameError) -> bool {
    matches!(error, GameError::CaptureFailed { .. })
}

/// Windows.Graphics.Capture로 창을 찍고 클라이언트 영역만 잘라 낸다.
///
/// 합성기(DWM)가 그 창의 화면을 텍스처로 넘겨준다 — 다른 창에 가려져 있어도 게임 화면이 찍힌다.
/// 표면은 창 전체(제목 표시줄·테두리 포함)라서 프레임을 받은 시점의 창 위치로 클라이언트 영역을 계산한다.
fn capture_wgc(
    hwnd: HWND,
    window: &GameWindowInfo,
    expected: (u32, u32),
) -> Result<Frame, GameError> {
    keep_winrt_loaded();
    if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
        return Err(GameError::CaptureFailed {
            method: CaptureMethod::Wgc,
            detail: "이 Windows는 Windows.Graphics.Capture를 지원하지 않는다".to_string(),
        });
    }
    // 다른 스레드가 잠근 채 죽었어도 장치 자리는 쓸 수 있다(망가졌으면 아래에서 새로 만든다).
    let mut slot = CAPTURE_DEVICE.lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref().is_some_and(|kept| !kept.alive()) {
        *slot = None;
    }
    let mut kept = match slot.take() {
        Some(kept) => kept,
        None => CaptureDevice::create()?,
    };
    let result = capture_with_device(&mut kept, hwnd, window, expected);
    // 이번 캡처가 쓴 읽기용 텍스처·프레임 표면을 지금 정리하게 한다. Direct3D 11은 놓은 자원을 다음 Flush까지
    // 들고 있을 수 있다 — 장치를 계속 쓰므로 캡처마다 비워 준다.
    unsafe { kept.context.Flush() };
    match &result {
        // 캡처 API가 실패했다: 장치도 캡처 대상도 버린다. 다음 캡처가 처음부터 다시 만든다.
        Err(e) if discards_device(e) => {}
        // 그 밖의 실패(최소화·빈 화면·크기 불일치): 장치는 두고 캡처 대상만 새로 만들게 한다 —
        // 창 크기가 바뀐 뒤에 옛 캡처 대상이 계속 어긋난 프레임을 주는 일이 없게.
        Err(_) => {
            kept.item = None;
            *slot = Some(kept);
        }
        Ok(_) => *slot = Some(kept),
    }
    result
}

/// 장치 한 벌로 캡처 한 번: 프레임 풀·세션을 만들고, 프레임 하나를 읽고, 닫는다.
fn capture_with_device(
    kept: &mut CaptureDevice,
    hwnd: HWND,
    window: &GameWindowInfo,
    expected: (u32, u32),
) -> Result<Frame, GameError> {
    let item = kept.item_for(hwnd)?;
    let size = item
        .Size()
        .map_err(|e| wgc_error("캡처 대상의 크기를 읽지 못했다", e))?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &kept.winrt,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        1,
        size,
    )
    .map_err(|e| wgc_error("프레임 풀을 만들지 못했다", e))?;
    let session = match pool.CreateCaptureSession(&item) {
        Ok(session) => session,
        Err(e) => {
            let _ = pool.Close();
            return Err(wgc_error("캡처 세션을 만들지 못했다", e));
        }
    };
    // 마우스 커서와 노란 캡처 테두리를 빼 달라고 한다. 지원하지 않는 Windows에서는 무시된다.
    let _ = session.SetIsCursorCaptureEnabled(false);
    let _ = session.SetIsBorderRequired(false);

    let result = session
        .StartCapture()
        .map_err(|e| wgc_error("캡처를 시작하지 못했다", e))
        .and_then(|()| wait_for_frame(&pool, &kept.device, &kept.context, hwnd, window, expected));
    let _ = session.Close();
    let _ = pool.Close();
    result
}

/// 쓸 만한 프레임이 올 때까지 기다린다. 첫 프레임이 빈 화면이거나 크기가 안 맞으면 잠깐 더 받아 본다.
fn wait_for_frame(
    pool: &Direct3D11CaptureFramePool,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    hwnd: HWND,
    window: &GameWindowInfo,
    expected: (u32, u32),
) -> Result<Frame, GameError> {
    let started = Instant::now();
    let mut retry_until: Option<Instant> = None;
    let mut last_error: Option<GameError> = None;
    loop {
        let now = Instant::now();
        if retry_until.is_some_and(|until| now > until) || now.duration_since(started) > FRAME_TIMEOUT
        {
            break;
        }
        let Ok(frame) = pool.TryGetNextFrame() else {
            thread::sleep(FRAME_POLL);
            continue;
        };
        let read = read_client_area(device, context, &frame, hwnd, window)
            .and_then(|f| check_frame(&f, expected, CaptureMethod::Wgc).map(|()| f));
        let _ = frame.Close();
        match read {
            Ok(frame) => return Ok(frame),
            Err(e) => {
                last_error = Some(e);
                retry_until.get_or_insert(now + RETRY_WINDOW);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| GameError::CaptureFailed {
        method: CaptureMethod::Wgc,
        detail: format!(
            "{}ms 안에 프레임이 오지 않았다",
            FRAME_TIMEOUT.as_millis()
        ),
    }))
}

/// 프레임 표면에서 클라이언트 영역만 CPU 메모리로 읽어 온다.
fn read_client_area(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    frame: &Direct3D11CaptureFrame,
    hwnd: HWND,
    window: &GameWindowInfo,
) -> Result<Frame, GameError> {
    let texture: ID3D11Texture2D = frame
        .Surface()
        .and_then(|surface| surface.cast::<IDirect3DDxgiInterfaceAccess>())
        .and_then(|access| unsafe { access.GetInterface() })
        .map_err(|e| wgc_error("프레임의 텍스처를 얻지 못했다", e))?;
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    let content = frame
        .ContentSize()
        .map_err(|e| wgc_error("프레임의 크기를 읽지 못했다", e))?;
    let surface_size = (
        desc.Width.min(u32::try_from(content.Width).unwrap_or(0)),
        desc.Height.min(u32::try_from(content.Height).unwrap_or(0)),
    );

    // 프레임을 받은 지금의 창 위치로 계산한다(찾은 뒤에 창이 움직였을 수 있다).
    let now = read_info(hwnd, window.pid, &window.process_name);
    if now.minimized {
        return Err(GameError::Minimized);
    }
    let crop = client_crop((now.frame.x, now.frame.y), surface_size, now.client).ok_or(
        GameError::SizeMismatch {
            method: CaptureMethod::Wgc,
            expected: (now.client.width, now.client.height),
            actual: surface_size,
        },
    )?;

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: crop.width,
        Height: crop.height,
        MipLevels: 1,
        ArraySize: 1,
        Format: desc.Format,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging: Option<ID3D11Texture2D> = None;
    unsafe { device.CreateTexture2D(&staging_desc, None, Some(&mut staging)) }
        .map_err(|e| wgc_error("읽기용 텍스처를 만들지 못했다", e))?;
    let staging = staging.ok_or_else(|| wgc_error("읽기용 텍스처를 만들지 못했다", "null"))?;
    let source_box = D3D11_BOX {
        left: crop.left,
        top: crop.top,
        front: 0,
        right: crop.left + crop.width,
        bottom: crop.top + crop.height,
        back: 1,
    };
    unsafe {
        context.CopySubresourceRegion(&staging, 0, 0, 0, 0, &texture, 0, Some(&source_box));
    }
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }
        .map_err(|e| wgc_error("프레임을 메모리로 읽지 못했다", e))?;
    let row_pitch = mapped.RowPitch as usize;
    let row_bytes = crop.width as usize * 4;
    let rgb = if mapped.pData.is_null() || row_pitch < row_bytes {
        None
    } else {
        let len = row_pitch * (crop.height as usize - 1) + row_bytes;
        // SAFETY: Map이 성공했으므로 pData는 높이 × RowPitch 바이트 이상을 가리킨다(마지막 줄은 픽셀까지만 읽는다).
        let data = unsafe { std::slice::from_raw_parts(mapped.pData as *const u8, len) };
        bgra_to_rgb(data, row_pitch, crop.width, crop.height)
    };
    unsafe { context.Unmap(&staging, 0) };
    let rgb = rgb.ok_or_else(|| wgc_error("프레임 데이터의 모양이 예상과 다르다", "row pitch"))?;
    Ok(Frame {
        width: crop.width,
        height: crop.height,
        rgb,
    })
}
