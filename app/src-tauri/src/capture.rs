//! 캡처한 프레임의 판정과 저장. Win32 호출이 없다(화면을 찍는 일은 `game_win32`가 한다).
//!
//! - 프레임 판정: 전부 검거나 한 색뿐인 프레임은 게임 화면이 아니다 — 저장하지 않고 오류로 돌려준다
//! - 클라이언트 영역 잘라 내기: 창 전체를 찍은 표면에서 제목 표시줄·테두리를 뺀 부분의 위치 계산
//! - 파일 이름: 시각 + 라벨(파일 이름에 안전한 글자만), PNG 저장(있는 파일은 덮어쓰지 않는다)
//! - 저장 폴더: 환경 변수 `NIKKE_CAPTURE_DIR` → 저장소의 `data/captures`(gitignore)
//!
//! 캡처 이미지는 계정 정보와 게임 화면을 담는다. 저장소에 올리지 않는다.

use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::game_window::{self, GameError, GameWindowInfo, ScreenRect};

/// 캡처 폴더를 지정하는 환경 변수.
pub const ENV_CAPTURE_DIR: &str = "NIKKE_CAPTURE_DIR";
/// 저장소 루트에서 본 기본 캡처 폴더(`data/captures`).
pub const CAPTURE_SUBDIR: [&str; 2] = ["data", "captures"];
/// 저장소 루트임을 확인하는 파일(이 앱의 Cargo.toml).
const REPO_MARKER: &str = "app/src-tauri/Cargo.toml";
/// 라벨의 최대 글자 수.
pub const MAX_LABEL_CHARS: usize = 48;

/// 화면을 찍는 방식. 결과 기록의 `method`에 남는다 — 어떤 방식으로 찍은 이미지인지 나중에 알 수 있게.
///
/// 지금은 하나뿐이다. PrintWindow는 니케 창에서 실패해 넣지 않았다(app/README.md §캡처 방식).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMethod {
    /// Windows.Graphics.Capture — 합성기(DWM)가 그 창의 화면을 넘겨준다. 가려진 창도 찍힌다.
    Wgc,
}

impl CaptureMethod {
    /// 결과 JSON의 `method` 값과 같은 이름.
    pub fn name(self) -> &'static str {
        match self {
            Self::Wgc => "wgc",
        }
    }
}

/// 캡처한 화면. 픽셀은 위에서 아래로, 한 픽셀이 R·G·B 세 바이트다.
#[derive(Clone, PartialEq, Eq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
}

impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // 픽셀을 통째로 찍지 않는다(테스트 실패 메시지가 수 MB가 된다).
        write!(f, "Frame({}×{}, {} bytes)", self.width, self.height, self.rgb.len())
    }
}

/// 게임 화면이 아닌 프레임의 종류.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlankKind {
    /// 픽셀이 없다.
    Empty,
    /// 모든 픽셀이 검다.
    Black,
    /// 모든 픽셀이 같은 색이다(검정 제외).
    SingleColor { r: u8, g: u8, b: u8 },
}

impl BlankKind {
    /// "캡처한 화면이 …" 뒤에 붙는 설명.
    pub fn describe(self) -> String {
        match self {
            Self::Empty => "비어 있다".to_string(),
            Self::Black => "전부 검다".to_string(),
            Self::SingleColor { r, g, b } => format!("한 색(#{r:02x}{g:02x}{b:02x})뿐이다"),
        }
    }
}

/// 빈 화면 판정에서 빼는 네 모서리 정사각형의 한 변(픽셀).
///
/// Windows 11은 창의 모서리를 둥글게 깎는다(반지름 8px × 모니터 배율). 창 모드에서는 클라이언트 영역의 아래쪽
/// 두 모서리가 창 모서리와 겹쳐서, 화면이 온통 한 색이어도 그 자리만 검게 찍힌다(`tests/live_capture.rs`에서
/// 실제로 확인). 그 픽셀 때문에 한 색 화면을 정상으로 보지 않게 모서리를 판정에서 뺀다. 배율 300%까지 덮는 크기다.
pub const BLANK_CORNER_IGNORE: u32 = 24;

/// 이 크기의 프레임에서 판정에서 빼는 모서리 정사각형의 한 변. 작은 프레임에서는 변의 1/4을 넘지 않는다.
pub fn blank_corner_zone(width: u32, height: u32) -> u32 {
    BLANK_CORNER_IGNORE.min(width / 4).min(height / 4)
}

/// 프레임이 게임 화면이 아닌지 판정한다: 픽셀이 없거나, 네 모서리(`blank_corner_zone`)를 뺀 모든 픽셀이 같은
/// 색이면 그 종류를 돌려준다. 모서리 밖의 픽셀이 하나라도 다르면 `None`(정상). 캡처는 무손실이라 "거의 같은
/// 색"은 따지지 않는다.
pub fn blank_kind(frame: &Frame) -> Option<BlankKind> {
    let (width, height) = (frame.width as usize, frame.height as usize);
    if width == 0 || height == 0 || frame.rgb.len() < 3 {
        return Some(BlankKind::Empty);
    }
    let reference = if frame.rgb.len() == width * height * 3 {
        // 가운데 픽셀이 기준이다(모서리 밖이다). 모서리가 걸친 줄에서는 모서리 사이만 본다.
        let zone = blank_corner_zone(frame.width, frame.height) as usize;
        let centre = ((height / 2) * width + width / 2) * 3;
        let reference = [frame.rgb[centre], frame.rgb[centre + 1], frame.rgb[centre + 2]];
        for (y, row) in frame.rgb.chunks_exact(width * 3).enumerate() {
            let (from, to) = if y < zone || y >= height - zone {
                (zone, width - zone)
            } else {
                (0, width)
            };
            if row[from * 3..to * 3].as_chunks::<3>().0.iter().any(|p| *p != reference) {
                return None;
            }
        }
        reference
    } else {
        // 픽셀 수가 크기와 맞지 않는 프레임은 자리를 알 수 없다 — 있는 픽셀을 전부 본다.
        let first = [frame.rgb[0], frame.rgb[1], frame.rgb[2]];
        if frame.rgb.as_chunks::<3>().0.iter().any(|p| *p != first) {
            return None;
        }
        first
    };
    Some(match reference {
        [0, 0, 0] => BlankKind::Black,
        [r, g, b] => BlankKind::SingleColor { r, g, b },
    })
}

/// 표면에서 잘라 낼 부분(표면의 왼쪽 위 기준, 픽셀).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Crop {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

/// 창 전체를 찍은 표면에서 클라이언트 영역의 위치를 구한다.
///
/// `surface_origin`은 표면의 왼쪽 위가 놓인 화면 좌표(창에서 보이는 부분의 왼쪽 위),
/// `surface_size`는 표면의 크기, `client`는 클라이언트 영역의 화면 좌표와 크기다.
/// 클라이언트 영역이 표면 밖으로 나가면 `None` — 잘린 이미지를 만들지 않는다.
pub fn client_crop(
    surface_origin: (i32, i32),
    surface_size: (u32, u32),
    client: ScreenRect,
) -> Option<Crop> {
    if client.is_empty() {
        return None;
    }
    let left = u32::try_from(i64::from(client.x) - i64::from(surface_origin.0)).ok()?;
    let top = u32::try_from(i64::from(client.y) - i64::from(surface_origin.1)).ok()?;
    let right = left.checked_add(client.width)?;
    let bottom = top.checked_add(client.height)?;
    (right <= surface_size.0 && bottom <= surface_size.1).then_some(Crop {
        left,
        top,
        width: client.width,
        height: client.height,
    })
}

/// BGRA 픽셀 줄들(줄마다 `row_pitch` 바이트, 앞의 `width * 4` 바이트만 픽셀)을 RGB로 바꾼다.
/// 알파는 버린다. 데이터가 모자라면 `None`.
pub fn bgra_to_rgb(data: &[u8], row_pitch: usize, width: u32, height: u32) -> Option<Vec<u8>> {
    let (width, height) = (width as usize, height as usize);
    let row_bytes = width.checked_mul(4)?;
    if row_pitch < row_bytes {
        return None;
    }
    if height > 0 && data.len() < row_pitch.checked_mul(height - 1)?.checked_add(row_bytes)? {
        return None;
    }
    let mut rgb = Vec::with_capacity(width * height * 3);
    for row in 0..height {
        let line = &data[row * row_pitch..row * row_pitch + row_bytes];
        for px in line.as_chunks::<4>().0 {
            rgb.extend_from_slice(&[px[2], px[1], px[0]]);
        }
    }
    Some(rgb)
}

// ── 시각·파일 이름 ────────────────────────────────────────────────────────────

/// 달력 시각. 어느 시간대인지는 만든 쪽이 안다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub millis: u32,
}

impl Stamp {
    /// 유닉스 시각(밀리초)을 UTC 달력 시각으로 바꾼다.
    pub fn from_unix_millis(ms: u64) -> Self {
        let secs = ms / 1000;
        let days = (secs / 86_400) as i64;
        let rem = secs % 86_400;
        // 날짜 계산: Howard Hinnant의 civil_from_days.
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z.rem_euclid(146_097);
        let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
        let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
        Self {
            year,
            month,
            day,
            hour: (rem / 3600) as u32,
            minute: (rem % 3600 / 60) as u32,
            second: (rem % 60) as u32,
            millis: (ms % 1000) as u32,
        }
    }

    /// `2026-11-12T06:30:45.123Z` — UTC 시각일 때만 쓴다.
    pub fn iso_utc(&self) -> String {
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
            self.year, self.month, self.day, self.hour, self.minute, self.second, self.millis
        )
    }

    /// `20261112-153045-123` — 파일 이름에 쓴다.
    pub fn compact(&self) -> String {
        format!(
            "{:04}{:02}{:02}-{:02}{:02}{:02}-{:03}",
            self.year, self.month, self.day, self.hour, self.minute, self.second, self.millis
        )
    }
}

/// 지금 시각: (UTC, 이 PC의 현지 시각). 현지 시각을 알 수 없으면 UTC를 쓴다.
pub fn now_stamps() -> (Stamp, Stamp) {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let utc = Stamp::from_unix_millis(ms);
    (utc, local_stamp().unwrap_or(utc))
}

#[cfg(windows)]
fn local_stamp() -> Option<Stamp> {
    Some(crate::game_win32::local_time())
}

#[cfg(not(windows))]
fn local_stamp() -> Option<Stamp> {
    None
}

/// 라벨에서 파일 이름에 안전한 글자만 남긴다: 글자·숫자(한글 포함), `-`, `_`.
/// 공백은 `-`로 바꾸고, 그 밖의 글자(경로 구분자·점·따옴표·제어 문자 등)는 버린다.
/// 앞뒤의 `-`·`_`는 떼고 `MAX_LABEL_CHARS` 글자로 자른다. 남는 것이 없으면 `None`.
pub fn sanitize_label(label: &str) -> Option<String> {
    let mut out = String::new();
    for ch in label.trim().chars() {
        let keep = if ch.is_alphanumeric() || ch == '_' {
            Some(ch)
        } else if ch == '-' || ch.is_whitespace() {
            Some('-')
        } else {
            None
        };
        match keep {
            // 이어지는 `-`는 하나로.
            Some('-') if out.ends_with('-') => {}
            Some(c) => out.push(c),
            None => {}
        }
    }
    let trimmed: String = out
        .trim_matches(['-', '_'])
        .chars()
        .take(MAX_LABEL_CHARS)
        .collect();
    let trimmed = trimmed.trim_end_matches(['-', '_']);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// 캡처 파일 이름: `<시각>_<라벨>.png`, 라벨이 없으면 `<시각>.png`.
pub fn capture_file_name(stamp: &Stamp, label: Option<&str>) -> String {
    match label.and_then(sanitize_label) {
        Some(label) => format!("{}_{label}.png", stamp.compact()),
        None => format!("{}.png", stamp.compact()),
    }
}

// ── 저장 ─────────────────────────────────────────────────────────────────────

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// 주어진 폴더들에서 위로 올라가며 저장소 루트를 찾는다.
pub fn find_repo_root(start_dirs: &[PathBuf]) -> Option<PathBuf> {
    start_dirs
        .iter()
        .flat_map(|start| start.ancestors())
        .find(|dir| dir.join(REPO_MARKER).is_file() && dir.join("data").is_dir())
        .map(Path::to_path_buf)
}

/// 캡처를 저장할 폴더: 환경 변수 `NIKKE_CAPTURE_DIR` → 저장소의 `data/captures`.
pub fn resolve_capture_dir(
    env: impl Fn(&str) -> Option<String>,
    search_from: &[PathBuf],
) -> Result<PathBuf, GameError> {
    if let Some(dir) = non_empty(env(ENV_CAPTURE_DIR)) {
        return Ok(PathBuf::from(dir));
    }
    find_repo_root(search_from)
        .map(|root| CAPTURE_SUBDIR.iter().fold(root, |dir, part| dir.join(part)))
        .ok_or(GameError::CaptureDirUnknown)
}

/// 이 프로세스의 기본 캡처 폴더(실행 파일 위치와 현재 폴더에서 저장소를 찾는다).
pub fn default_capture_dir() -> Result<PathBuf, GameError> {
    let mut search_from: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        search_from.push(dir);
    }
    if let Ok(dir) = std::env::current_dir() {
        search_from.push(dir);
    }
    resolve_capture_dir(|name| std::env::var(name).ok(), &search_from)
}

fn save_error(path: &Path, detail: impl ToString) -> GameError {
    GameError::Save {
        path: path.display().to_string(),
        detail: detail.to_string(),
    }
}

fn write_png(file: fs::File, frame: &Frame) -> Result<(), String> {
    let expected = frame.width as usize * frame.height as usize * 3;
    if frame.rgb.len() != expected {
        return Err(format!(
            "픽셀 수가 크기와 맞지 않는다({} ≠ {expected})",
            frame.rgb.len()
        ));
    }
    let mut out = BufWriter::new(file);
    let mut encoder = png::Encoder::new(&mut out, frame.width, frame.height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer
        .write_image_data(&frame.rgb)
        .map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    // 버퍼에 남은 것을 여기서 내보낸다(drop에 맡기면 쓰기 오류를 놓친다).
    out.flush().map_err(|e| e.to_string())
}

/// 프레임을 `dir/file_name`에 PNG로 저장하고 실제로 쓴 경로를 돌려준다.
/// 폴더가 없으면 만든다. 같은 이름의 파일이 있으면 덮어쓰지 않고 `-2`, `-3`…을 붙인다.
pub fn save_png(dir: &Path, file_name: &str, frame: &Frame) -> Result<PathBuf, GameError> {
    fs::create_dir_all(dir).map_err(|e| save_error(dir, e))?;
    let stem = file_name.strip_suffix(".png").unwrap_or(file_name);
    for attempt in 1..=99u32 {
        let name = if attempt == 1 {
            format!("{stem}.png")
        } else {
            format!("{stem}-{attempt}.png")
        };
        let path = dir.join(name);
        let file = match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(save_error(&path, e)),
        };
        if let Err(detail) = write_png(file, frame) {
            // 쓰다 만 파일을 남기지 않는다.
            let _ = fs::remove_file(&path);
            return Err(save_error(&path, detail));
        }
        return Ok(std::path::absolute(&path).unwrap_or(path));
    }
    Err(save_error(
        &dir.join(file_name),
        "같은 이름의 파일이 너무 많다",
    ))
}

/// 저장한 캡처 하나의 기록. 명령줄 도구가 JSON 한 줄로 찍고, 오버레이 화면이 그대로 받는다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CaptureRecord {
    /// 저장한 PNG의 절대 경로.
    pub path: String,
    pub width: u32,
    pub height: u32,
    /// 찍은 시각(UTC, ISO 8601).
    pub captured_at: String,
    pub method: CaptureMethod,
    /// 찍을 때의 게임 창 정보.
    pub window: GameWindowInfo,
}

/// 게임 창을 찾아 클라이언트 영역을 찍는다. **저장하지 않는다** — 프레임은 메모리에만 있다.
/// 게임이 없거나 최소화돼 있거나 빈 화면만 나오면 한국어 오류를 돌려준다.
pub fn grab_game_frame() -> Result<(Frame, CaptureMethod, GameWindowInfo), GameError> {
    let window = game_window::find_game_window()?;
    if window.minimized {
        return Err(GameError::Minimized);
    }
    let (frame, method) = game_window::capture_window(&window)?;
    Ok((frame, method, window))
}

fn read_error(path: &Path, detail: impl ToString) -> GameError {
    GameError::ReadImage {
        path: path.display().to_string(),
        detail: detail.to_string(),
    }
}

/// PNG 파일을 프레임(8비트 RGB)으로 읽는다. 알파는 버리고, 회색조는 세 채널에 같은 값을 넣는다.
/// 이 앱이 저장한 캡처(8비트 RGB)를 화면 인식에 다시 넣을 때 쓴다.
pub fn load_png(path: &Path) -> Result<Frame, GameError> {
    let file = fs::File::open(path).map_err(|e| read_error(path, e))?;
    let mut decoder = png::Decoder::new(std::io::BufReader::new(file));
    // 팔레트·16비트·1~4비트 회색조를 8비트 채널로 편다.
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder
        .read_info()
        .map_err(|e| read_error(path, format!("PNG가 아니거나 깨졌다: {e}")))?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| read_error(path, "이미지가 너무 크다"))?;
    let mut buf = vec![0; size];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| read_error(path, format!("PNG를 풀지 못했다: {e}")))?;
    let channels = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Indexed => {
            return Err(read_error(path, "팔레트 PNG를 RGB로 펴지 못했다"));
        }
    };
    let pixels = info.width as usize * info.height as usize;
    let data = buf
        .get(..pixels * channels)
        .ok_or_else(|| read_error(path, "픽셀 수가 크기와 맞지 않는다"))?;
    let rgb = match channels {
        3 => data.to_vec(),
        4 => data
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|px| [px[0], px[1], px[2]])
            .collect(),
        _ => data
            .chunks_exact(channels)
            .flat_map(|px| [px[0], px[0], px[0]])
            .collect(),
    };
    Ok(Frame {
        width: info.width,
        height: info.height,
        rgb,
    })
}

/// 게임 창을 찾아 클라이언트 영역을 찍고 `dir`에 저장한다.
/// 게임이 없거나 최소화돼 있거나 빈 화면만 나오면 저장하지 않고 한국어 오류를 돌려준다.
pub fn capture_game_to_dir(dir: &Path, label: Option<&str>) -> Result<CaptureRecord, GameError> {
    let (frame, method, window) = grab_game_frame()?;
    let (utc, local) = now_stamps();
    let path = save_png(dir, &capture_file_name(&local, label), &frame)?;
    Ok(CaptureRecord {
        path: path.display().to_string(),
        width: frame.width,
        height: frame.height,
        captured_at: utc.iso_utc(),
        method,
        window,
    })
}

/// 캡처한 프레임이 쓸 만한지 확인한다: 크기가 클라이언트 영역과 같고, 빈 화면이 아니다.
pub fn check_frame(
    frame: &Frame,
    expected: (u32, u32),
    method: CaptureMethod,
) -> Result<(), GameError> {
    if (frame.width, frame.height) != expected {
        return Err(GameError::SizeMismatch {
            method,
            expected,
            actual: (frame.width, frame.height),
        });
    }
    match blank_kind(frame) {
        Some(kind) => Err(GameError::BlankFrame { method, kind }),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    /// 한 색으로 채운 프레임.
    fn solid_frame(width: u32, height: u32, rgb: [u8; 3]) -> Frame {
        Frame {
            width,
            height,
            rgb: rgb
                .iter()
                .copied()
                .cycle()
                .take(width as usize * height as usize * 3)
                .collect(),
        }
    }

    /// 테스트마다 다른 임시 폴더.
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-capture-{}-{tag}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn read_png(path: &Path) -> (u32, u32, Vec<u8>) {
        let decoder = png::Decoder::new(std::io::BufReader::new(fs::File::open(path).unwrap()));
        let mut reader = decoder.read_info().unwrap();
        let (width, height) = {
            let info = reader.info();
            assert_eq!(info.color_type, png::ColorType::Rgb);
            assert_eq!(info.bit_depth, png::BitDepth::Eight);
            (info.width, info.height)
        };
        let mut buf = vec![0; width as usize * height as usize * 3];
        reader.next_frame(&mut buf).unwrap();
        (width, height, buf)
    }

    #[test]
    fn all_black_frame_is_blank() {
        assert_eq!(
            blank_kind(&solid_frame(64, 36, [0, 0, 0])),
            Some(BlankKind::Black)
        );
    }

    #[test]
    fn single_colour_frame_is_blank() {
        assert_eq!(
            blank_kind(&solid_frame(64, 36, [255, 255, 255])),
            Some(BlankKind::SingleColor {
                r: 255,
                g: 255,
                b: 255
            })
        );
        assert_eq!(
            blank_kind(&solid_frame(8, 8, [18, 52, 86])),
            Some(BlankKind::SingleColor {
                r: 18,
                g: 52,
                b: 86
            })
        );
        // 한 픽셀짜리도 한 색이다.
        assert_eq!(
            blank_kind(&solid_frame(1, 1, [1, 0, 0])),
            Some(BlankKind::SingleColor { r: 1, g: 0, b: 0 })
        );
    }

    #[test]
    fn empty_frame_is_blank() {
        assert_eq!(blank_kind(&solid_frame(0, 0, [0, 0, 0])), Some(BlankKind::Empty));
        assert_eq!(blank_kind(&solid_frame(0, 10, [9, 9, 9])), Some(BlankKind::Empty));
    }

    /// `(x, y)` 픽셀의 한 채널을 바꾼다.
    fn poke(frame: &mut Frame, x: u32, y: u32, channel: usize, value: u8) {
        let i = (y as usize * frame.width as usize + x as usize) * 3 + channel;
        frame.rgb[i] = value;
    }

    #[test]
    fn a_frame_with_any_different_pixel_is_not_blank() {
        // 64×36 프레임에서 판정에서 빠지는 모서리는 9×9다.
        assert_eq!(blank_corner_zone(64, 36), 9);

        // 검은 화면에 픽셀 하나, 그것도 채널 하나가 1만 달라도 정상이다 — 모서리 밖 어디든.
        // 맨 위·아래 행과 맨 왼쪽·오른쪽 열에서 모서리 바로 옆 자리, 그리고 안쪽.
        let spots = [
            (9, 0),
            (54, 0),
            (0, 9),
            (63, 9),
            (0, 26),
            (63, 26),
            (9, 35),
            (54, 35),
            (9, 8),
            (32, 18),
            (31, 35),
        ];
        for (x, y) in spots {
            let mut frame = solid_frame(64, 36, [0, 0, 0]);
            poke(&mut frame, x, y, 2, 1);
            assert_eq!(blank_kind(&frame), None, "({x}, {y})");

            let mut frame = solid_frame(64, 36, [200, 200, 200]);
            poke(&mut frame, x, y, 0, 199);
            assert_eq!(blank_kind(&frame), None, "({x}, {y})");
        }

        // 채널 하나만 다른 가운데 픽셀.
        let mut frame = solid_frame(4, 4, [10, 20, 30]);
        frame.rgb[3 * 5 + 1] = 21;
        assert_eq!(blank_kind(&frame), None);

        // 모서리를 뺄 수 없을 만큼 작은 프레임(변이 4픽셀 미만)은 모든 픽셀을 본다.
        assert_eq!(blank_corner_zone(64, 3), 0);
        let mut frame = solid_frame(64, 3, [0, 0, 0]);
        let last = frame.rgb.len() - 1;
        frame.rgb[last] = 1;
        assert_eq!(blank_kind(&frame), None);
        let mut frame = solid_frame(3, 64, [200, 200, 200]);
        frame.rgb[0] = 199;
        assert_eq!(blank_kind(&frame), None);
    }

    #[test]
    fn rounded_window_corners_do_not_make_a_single_colour_frame_look_fine() {
        // Windows 11 창 모드: 화면이 온통 한 색이어도 아래쪽 두 모서리가 둥글게 깎여 검게 찍힌다
        // (tests/live_capture.rs에서 실제 캡처로 확인). 그래도 한 색 화면이다.
        assert_eq!(blank_corner_zone(1920, 1080), BLANK_CORNER_IGNORE);
        let (w, h) = (1920u32, 1080u32);
        let mut frame = solid_frame(w, h, [255, 255, 255]);
        // 반지름 16px(배율 200%)로 깎인 아래쪽 두 모서리.
        for dy in 0..16u32 {
            for dx in 0..16u32 {
                let outside_arc = (16 - dx).pow(2) + (16 - dy).pow(2) > 16 * 16;
                if outside_arc {
                    for channel in 0..3 {
                        poke(&mut frame, dx, h - 1 - dy, channel, 0);
                        poke(&mut frame, w - 1 - dx, h - 1 - dy, channel, 0);
                    }
                }
            }
        }
        assert_eq!(
            blank_kind(&frame),
            Some(BlankKind::SingleColor {
                r: 255,
                g: 255,
                b: 255
            })
        );
        assert!(matches!(
            check_frame(&frame, (w, h), CaptureMethod::Wgc),
            Err(GameError::BlankFrame { .. })
        ));

        // 네 모서리 정사각형이 통째로 다른 색이어도 나머지가 한 색이면 빈 화면이다 — 검은 화면도 마찬가지.
        let zone = blank_corner_zone(w, h);
        let mut frame = solid_frame(w, h, [0, 0, 0]);
        for y in (0..zone).chain(h - zone..h) {
            for x in (0..zone).chain(w - zone..w) {
                poke(&mut frame, x, y, 1, 77);
            }
        }
        assert_eq!(blank_kind(&frame), Some(BlankKind::Black));

        // 모서리 정사각형에서 한 픽셀만 벗어나도 판정에 들어간다.
        for (x, y) in [(zone, h - 1), (0, h - zone - 1), (w - zone - 1, 0), (w - 1, zone)] {
            let mut frame = solid_frame(w, h, [255, 255, 255]);
            poke(&mut frame, x, y, 0, 254);
            assert_eq!(blank_kind(&frame), None, "({x}, {y})");
        }
    }

    #[test]
    fn a_frame_whose_pixel_count_does_not_match_its_size_is_judged_pixel_by_pixel() {
        // 자리를 알 수 없으니 모서리를 빼지 않는다.
        let mut frame = solid_frame(64, 36, [5, 5, 5]);
        frame.rgb.truncate(64 * 30 * 3);
        assert_eq!(
            blank_kind(&frame),
            Some(BlankKind::SingleColor { r: 5, g: 5, b: 5 })
        );
        frame.rgb[0] = 6;
        assert_eq!(blank_kind(&frame), None);
    }

    #[test]
    fn blank_kinds_are_described_in_korean() {
        assert_eq!(BlankKind::Black.describe(), "전부 검다");
        assert_eq!(
            BlankKind::SingleColor {
                r: 255,
                g: 0,
                b: 16
            }
            .describe(),
            "한 색(#ff0010)뿐이다"
        );
        assert_eq!(BlankKind::Empty.describe(), "비어 있다");
    }

    #[test]
    fn check_frame_rejects_blank_and_wrong_size() {
        let mut ok = solid_frame(4, 2, [0, 0, 0]);
        ok.rgb[0] = 7;
        assert_eq!(check_frame(&ok, (4, 2), CaptureMethod::Wgc), Ok(()));
        assert_eq!(
            check_frame(&ok, (4, 3), CaptureMethod::Wgc),
            Err(GameError::SizeMismatch {
                method: CaptureMethod::Wgc,
                expected: (4, 3),
                actual: (4, 2)
            })
        );
        assert_eq!(
            check_frame(&solid_frame(4, 2, [0, 0, 0]), (4, 2), CaptureMethod::Wgc),
            Err(GameError::BlankFrame {
                method: CaptureMethod::Wgc,
                kind: BlankKind::Black
            })
        );
        assert_eq!(
            check_frame(&solid_frame(4, 2, [9, 9, 9]), (4, 2), CaptureMethod::Wgc),
            Err(GameError::BlankFrame {
                method: CaptureMethod::Wgc,
                kind: BlankKind::SingleColor { r: 9, g: 9, b: 9 }
            })
        );
    }

    #[test]
    fn client_crop_removes_title_bar_and_borders() {
        // 창의 보이는 부분이 (100, 50)에서 시작하고 1922×1112, 클라이언트는 테두리 1px·제목 31px 안쪽.
        let client = ScreenRect {
            x: 101,
            y: 81,
            width: 1920,
            height: 1080,
        };
        assert_eq!(
            client_crop((100, 50), (1922, 1112), client),
            Some(Crop {
                left: 1,
                top: 31,
                width: 1920,
                height: 1080
            })
        );
        // 테두리 없는 창: 그대로.
        assert_eq!(
            client_crop((101, 81), (1920, 1080), client),
            Some(Crop {
                left: 0,
                top: 0,
                width: 1920,
                height: 1080
            })
        );
        // 음수 화면 좌표(왼쪽 모니터).
        let left = ScreenRect {
            x: -2559,
            y: -169,
            width: 1280,
            height: 720,
        };
        assert_eq!(
            client_crop((-2560, -200), (1282, 752), left),
            Some(Crop {
                left: 1,
                top: 31,
                width: 1280,
                height: 720
            })
        );
    }

    #[test]
    fn client_crop_refuses_areas_outside_the_surface() {
        let client = ScreenRect {
            x: 101,
            y: 81,
            width: 1920,
            height: 1080,
        };
        // 표면이 작다(창 크기가 바뀌는 중).
        assert_eq!(client_crop((100, 50), (1900, 1112), client), None);
        assert_eq!(client_crop((100, 50), (1922, 1100), client), None);
        // 클라이언트가 표면의 왼쪽·위 밖에서 시작한다.
        assert_eq!(client_crop((102, 50), (1922, 1112), client), None);
        assert_eq!(client_crop((100, 82), (1922, 1112), client), None);
        // 영역이 없다.
        let empty = ScreenRect {
            width: 0,
            ..client
        };
        assert_eq!(client_crop((100, 50), (1922, 1112), empty), None);
    }

    #[test]
    fn bgra_rows_become_rgb_and_padding_is_skipped() {
        // 2×2, 줄마다 12바이트(픽셀 8 + 채움 4).
        #[rustfmt::skip]
        let data = [
            3, 2, 1, 255,   6, 5, 4, 0,     99, 99, 99, 99,
            9, 8, 7, 255,   12, 11, 10, 7,  99, 99, 99, 99,
        ];
        assert_eq!(
            bgra_to_rgb(&data, 12, 2, 2),
            Some(vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        );
        // 마지막 줄에는 채움이 없어도 된다.
        assert_eq!(
            bgra_to_rgb(&data[..20], 12, 2, 2),
            Some(vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        );
        // 모자란 데이터, 너무 작은 줄 길이.
        assert_eq!(bgra_to_rgb(&data[..19], 12, 2, 2), None);
        assert_eq!(bgra_to_rgb(&data, 7, 2, 2), None);
        assert_eq!(bgra_to_rgb(&[], 0, 0, 0), Some(vec![]));
    }

    #[test]
    fn unix_time_becomes_a_utc_calendar_time() {
        assert_eq!(
            Stamp::from_unix_millis(0).iso_utc(),
            "1970-01-01T00:00:00.000Z"
        );
        // 2026-11-12 06:30:45.123 UTC
        assert_eq!(
            Stamp::from_unix_millis(1_794_465_045_123).iso_utc(),
            "2026-11-12T06:30:45.123Z"
        );
        // 윤년의 2월 29일과 그 다음 날
        assert_eq!(
            Stamp::from_unix_millis(1_709_251_199_999).iso_utc(),
            "2024-02-29T23:59:59.999Z"
        );
        assert_eq!(
            Stamp::from_unix_millis(1_709_251_200_000).iso_utc(),
            "2024-03-01T00:00:00.000Z"
        );
        // 해가 바뀌는 순간
        assert_eq!(
            Stamp::from_unix_millis(1_767_225_599_000).iso_utc(),
            "2025-12-31T23:59:59.000Z"
        );
    }

    #[test]
    fn labels_keep_only_file_name_safe_characters() {
        assert_eq!(sanitize_label("lobby"), Some("lobby".to_string()));
        assert_eq!(sanitize_label("  솔로 레이드 3단계 "), Some("솔로-레이드-3단계".to_string()));
        assert_eq!(sanitize_label("raid_boss-01"), Some("raid_boss-01".to_string()));
        // 경로 구분자·점·따옴표·예약 문자는 버린다(폴더 밖으로 나갈 수 없다).
        assert_eq!(sanitize_label("..\\..\\secret"), Some("secret".to_string()));
        assert_eq!(sanitize_label("../../etc/passwd"), Some("etcpasswd".to_string()));
        assert_eq!(sanitize_label("a:b*c?d\"e<f>g|h"), Some("abcdefgh".to_string()));
        assert_eq!(sanitize_label("C:\\Users\\x.png"), Some("CUsersxpng".to_string()));
        assert_eq!(sanitize_label("tab\there\nline"), Some("tab-here-line".to_string()));
        // 이어지는 구분자는 하나로, 앞뒤 구분자는 뗀다.
        assert_eq!(sanitize_label("--a   -  b__"), Some("a-b".to_string()));
        // 남는 것이 없으면 라벨이 없다.
        assert_eq!(sanitize_label(""), None);
        assert_eq!(sanitize_label("   "), None);
        assert_eq!(sanitize_label("../.."), None);
        assert_eq!(sanitize_label("-_-"), None);
    }

    #[test]
    fn long_labels_are_cut() {
        let long = "가".repeat(200);
        assert_eq!(
            sanitize_label(&long).unwrap().chars().count(),
            MAX_LABEL_CHARS
        );
        // 자른 끝이 구분자면 뗀다.
        let label = format!("{}-뒤", "a".repeat(MAX_LABEL_CHARS - 1));
        assert_eq!(sanitize_label(&label), Some("a".repeat(MAX_LABEL_CHARS - 1)));
    }

    #[test]
    fn file_name_is_time_plus_label() {
        let stamp = Stamp {
            year: 2026,
            month: 11,
            day: 12,
            hour: 15,
            minute: 4,
            second: 5,
            millis: 7,
        };
        assert_eq!(capture_file_name(&stamp, None), "20261112-150405-007.png");
        assert_eq!(
            capture_file_name(&stamp, Some("솔로 레이드")),
            "20261112-150405-007_솔로-레이드.png"
        );
        // 쓸 글자가 없는 라벨은 없는 것과 같다.
        assert_eq!(
            capture_file_name(&stamp, Some("///")),
            "20261112-150405-007.png"
        );
        // 어떤 라벨이든 폴더 구분자가 들어가지 않는다.
        for label in ["..\\up", "a/b", "c:\\d", "e\u{0}f"] {
            let name = capture_file_name(&stamp, Some(label));
            assert!(!name.contains(['/', '\\', ':', '\u{0}']), "{name}");
            assert!(!name.contains(".."), "{name}");
        }
    }

    #[test]
    fn method_name_matches_the_json_value() {
        assert_eq!(CaptureMethod::Wgc.name(), "wgc");
        assert_eq!(
            serde_json::to_value(CaptureMethod::Wgc).unwrap(),
            serde_json::json!("wgc")
        );
    }

    #[test]
    fn saved_png_round_trips_pixels() {
        let dir = temp_dir("roundtrip");
        let frame = Frame {
            width: 3,
            height: 2,
            rgb: (0u8..18).collect(),
        };
        let path = save_png(&dir, "a.png", &frame).unwrap();
        assert!(path.is_absolute());
        assert_eq!(path.file_name().unwrap(), "a.png");
        assert_eq!(read_png(&path), (3, 2, frame.rgb.clone()));
        // 저장한 캡처를 다시 읽으면 같은 프레임이다.
        assert_eq!(load_png(&path).unwrap(), frame);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// 주어진 색 형식의 PNG를 쓴다(테스트용).
    fn write_raw_png(path: &Path, width: u32, height: u32, color: png::ColorType, data: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut encoder = png::Encoder::new(fs::File::create(path).unwrap(), width, height);
        encoder.set_color(color);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(data).unwrap();
        writer.finish().unwrap();
    }

    #[test]
    fn load_png_drops_alpha_and_expands_greyscale() {
        let dir = temp_dir("load");
        let rgba = dir.join("rgba.png");
        write_raw_png(
            &rgba,
            2,
            1,
            png::ColorType::Rgba,
            &[10, 20, 30, 255, 40, 50, 60, 0],
        );
        assert_eq!(
            load_png(&rgba).unwrap(),
            Frame {
                width: 2,
                height: 1,
                rgb: vec![10, 20, 30, 40, 50, 60],
            }
        );
        let grey = dir.join("grey.png");
        write_raw_png(&grey, 1, 2, png::ColorType::Grayscale, &[7, 200]);
        assert_eq!(
            load_png(&grey).unwrap(),
            Frame {
                width: 1,
                height: 2,
                rgb: vec![7, 7, 7, 200, 200, 200],
            }
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn load_png_explains_missing_and_broken_files() {
        let dir = temp_dir("load-bad");
        fs::create_dir_all(&dir).unwrap();
        let missing = load_png(&dir.join("없는 파일.png")).unwrap_err();
        assert!(matches!(missing, GameError::ReadImage { .. }), "{missing:?}");
        assert!(missing.to_string().contains("이미지를 읽지 못했다"), "{missing}");
        assert!(missing.to_string().contains("없는 파일.png"), "{missing}");
        assert!(!missing.is_game_missing());

        let text = dir.join("not-a-png.png");
        fs::write(&text, "PNG가 아니다").unwrap();
        let broken = load_png(&text).unwrap_err();
        assert!(broken.to_string().contains("PNG가 아니거나 깨졌다"), "{broken}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn saving_creates_the_folder_and_never_overwrites() {
        let dir = temp_dir("no-overwrite").join("없던").join("폴더");
        let first = solid_frame(2, 2, [1, 2, 3]);
        let second = solid_frame(2, 2, [4, 5, 6]);
        let a = save_png(&dir, "shot.png", &first).unwrap();
        let b = save_png(&dir, "shot.png", &second).unwrap();
        let c = save_png(&dir, "shot.png", &second).unwrap();
        assert_eq!(a.file_name().unwrap(), "shot.png");
        assert_eq!(b.file_name().unwrap(), "shot-2.png");
        assert_eq!(c.file_name().unwrap(), "shot-3.png");
        // 처음 파일은 그대로다.
        assert_eq!(read_png(&a).2, first.rgb);
        assert_eq!(read_png(&b).2, second.rgb);
        fs::remove_dir_all(dir.parent().unwrap().parent().unwrap()).unwrap();
    }

    #[test]
    fn saving_a_frame_with_wrong_pixel_count_fails_and_leaves_no_file() {
        let dir = temp_dir("bad-frame");
        let bad = Frame {
            width: 4,
            height: 4,
            rgb: vec![0; 10],
        };
        let err = save_png(&dir, "bad.png", &bad).unwrap_err();
        assert!(matches!(err, GameError::Save { .. }), "{err:?}");
        assert!(err.to_string().contains("저장하지 못했다"));
        assert!(!dir.join("bad.png").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn capture_dir_prefers_the_environment_variable() {
        let env = |name: &str| (name == ENV_CAPTURE_DIR).then(|| "  D:\\캡처  ".to_string());
        assert_eq!(
            resolve_capture_dir(env, &[]),
            Ok(PathBuf::from("D:\\캡처"))
        );
    }

    #[test]
    fn capture_dir_defaults_to_the_repository_data_captures() {
        // 이 테스트는 저장소 안에서 돈다: app/src-tauri에서 위로 올라가면 저장소 루트다.
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let start = manifest.join("target").join("debug");
        let dir = resolve_capture_dir(|_| None, &[start]).unwrap();
        assert!(dir.ends_with("data/captures"), "{}", dir.display());
        let root = dir.parent().unwrap().parent().unwrap();
        assert!(root.join("docs/spec.md").is_file(), "{}", root.display());
        // 빈 환경 변수는 없는 것과 같다.
        let blank = |_: &str| Some("   ".to_string());
        assert_eq!(resolve_capture_dir(blank, &[manifest]), Ok(dir));
    }

    #[test]
    fn capture_dir_is_unknown_outside_the_repository() {
        let outside = std::env::temp_dir();
        assert_eq!(
            resolve_capture_dir(|_| None, &[outside]),
            Err(GameError::CaptureDirUnknown)
        );
        assert_eq!(
            resolve_capture_dir(|_| None, &[]),
            Err(GameError::CaptureDirUnknown)
        );
    }

    #[test]
    fn capture_record_serializes_the_documented_fields() {
        let record = CaptureRecord {
            path: "E:\\code\\nikke-companion\\data\\captures\\20261112-150405-007_lobby.png".to_string(),
            width: 1920,
            height: 1080,
            captured_at: "2026-11-12T06:04:05.007Z".to_string(),
            method: CaptureMethod::Wgc,
            window: GameWindowInfo {
                hwnd: 0x1234,
                pid: 42,
                process_name: "nikke.exe".to_string(),
                title: "NIKKE".to_string(),
                client: ScreenRect {
                    x: 1,
                    y: 31,
                    width: 1920,
                    height: 1080,
                },
                frame: ScreenRect {
                    x: 0,
                    y: 0,
                    width: 1922,
                    height: 1112,
                },
                minimized: false,
                foreground: true,
                scale_factor: 1.25,
            },
        };
        let json = serde_json::to_value(&record).unwrap();
        let keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["path", "width", "height", "captured_at", "method", "window"]
        );
        assert_eq!(json["method"], "wgc");
        assert_eq!(json["window"]["client"]["width"], 1920);
        assert_eq!(json["window"]["scale_factor"], 1.25);
        // 한 줄로 찍힌다.
        assert!(!serde_json::to_string(&record).unwrap().contains('\n'));
    }
}
