//! 게임 이미지 읽기 — 니케 초상화·보스 이미지·아이콘을 이 PC의 파일에서 읽어 화면에 넘긴다.
//!
//! 화면에는 파일·네트워크 권한이 없다. 이미지는 여기서 읽어 base64로 넘기고, 화면은 그것을 `data:` 주소로 그린다
//! (CSP의 `img-src 'self' data:` 안에서). 이 모듈은 Tauri API를 모른다(명령은 `lib.rs`가 잇는다). 네트워크를 쓰지 않는다 —
//! 이미지를 받는 일은 사람이 돌리는 `scripts/fetch-assets.mjs`가 한다.
//!
//! **화면이 넘긴 문자열로 임의의 파일을 읽을 수 없다:**
//! - 니케 초상화는 그 이름이 엔진 카탈로그(`data/parsed_nikke.json`)의 키일 때만 읽는다. 파일 이름은 엔진의
//!   `scraper/cdn_fetch.py`의 `safe_filename()` 규칙으로 만든다(금지 글자 `\ / : * ? " < > |` → `_`) — 폴더를 가르는 글자가 남지 않는다.
//! - 보스 이미지는 그 id가 내장 보스 묶음(`data/intercept/anomaly.json`)의 id이고 `a-z 0-9 _ -`만으로 됐을 때만 읽는다.
//! - 아이콘은 종류와 값이 이 파일의 표에 있을 때만 읽는다. 파일 이름은 표에 적힌 것이지 화면이 준 글자가 아니다.
//! - 읽은 내용이 WebP·PNG가 아니면(첫 바이트로 본다) 넘기지 않는다. 크기 한도가 있다.
//!
//! 없는 이미지는 오류가 아니다 — `found: false`로 돌려주고 화면이 대체 그림을 그린다.
//!
//! 읽는 순서:
//! - 초상화: 엔진 폴더의 `image/<이름>.webp` → `data/assets/portraits/<이름>.webp`
//! - 보스: `data/assets/bosses/<id>.webp|.png` → `data/captures/bosses/<id>.png`(사용자의 캡처에서 잘라 둔 것)
//! - 아이콘: `data/assets/icons/<종류>/<값>.webp|.png` → 엔진 폴더의 `image/icon/<파일>`(파일 이름이 엔진 코드에서 확인된 종류만)
//!
//! 게임 이미지는 저장소에 넣지 않는다(`data/assets/`·`data/captures/`는 gitignore, 엔진 폴더는 서브모듈).

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

/// 화면에 넘기는 이미지 하나의 최대 크기. 초상화는 수십 KB, 보스 조각은 100 KB 안쪽이다.
pub const MAX_IMAGE_BYTES: u64 = 2 * 1024 * 1024;
/// 엔진 폴더에서 본 카탈로그 파일(`engine::catalog`이 읽는 것과 같다).
pub const CATALOG_FILE: &str = "data/parsed_nikke.json";
/// 엔진 폴더에서 본 초상화 폴더와 아이콘 폴더.
pub const ENGINE_IMAGE_DIR: &str = "image";
pub const ENGINE_ICON_DIR: [&str; 2] = ["image", "icon"];
/// 저장소 루트에서 본 폴더·파일.
pub const ASSETS_SUBDIR: [&str; 2] = ["data", "assets"];
pub const BOSS_CAPTURES_SUBDIR: [&str; 3] = ["data", "captures", "bosses"];
pub const BOSS_BUNDLE_FILE: [&str; 3] = ["data", "intercept", "anomaly.json"];
/// 보스 id의 최대 길이.
pub const MAX_BOSS_ID_CHARS: usize = 64;

/// 이미지를 어디서 읽었나.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageSource {
    /// 엔진 폴더(`image/`).
    Engine,
    /// 받아 둔 리소스(`data/assets/`).
    Assets,
    /// 사용자의 캡처에서 잘라 둔 조각(`data/captures/bosses/`).
    Capture,
}

/// 화면에 넘기는 이미지. 프런트의 `GameImage`(src/types.ts)와 같아야 한다.
/// 없으면 `found: false`이고 나머지는 null이다 — 오류가 아니다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GameImage {
    pub found: bool,
    /// `image/webp` 또는 `image/png`.
    pub mime: Option<&'static str>,
    /// 파일 내용(base64).
    pub data: Option<String>,
    pub source: Option<ImageSource>,
}

impl GameImage {
    /// 「없음」.
    pub fn missing() -> Self {
        Self {
            found: false,
            mime: None,
            data: None,
            source: None,
        }
    }

    fn loaded(mime: &'static str, bytes: &[u8], source: ImageSource) -> Self {
        Self {
            found: true,
            mime: Some(mime),
            data: Some(encode_base64(bytes)),
            source: Some(source),
        }
    }
}

/// 이미지를 찾을 폴더들. 찾지 못한 쪽은 `None`이고 그쪽의 이미지는 「없음」이 된다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImageDirs {
    /// 엔진 폴더(`vendor/nikke-calc`). 엔진 계산과 같은 설정에서 나온다.
    pub engine_dir: Option<PathBuf>,
    pub data_root: Option<PathBuf>,
    pub captures: Option<PathBuf>,
    pub bundle: Option<PathBuf>,
}

impl ImageDirs {
    fn assets(&self, parts: &[&str]) -> Option<PathBuf> {
        self.data_root.as_ref().map(|root| parts.iter().fold(root.join(ASSETS_SUBDIR[1]), |dir, part| dir.join(part)))
    }

    fn engine(&self, parts: &[&str]) -> Option<PathBuf> {
        self.engine_dir
            .as_ref()
            .map(|root| parts.iter().fold(root.clone(), |dir, part| dir.join(part)))
    }
}

// ── 파일 이름·형식 ───────────────────────────────────────────────────────────

/// 니케 이름 → 이미지 파일 이름(확장자 제외). 엔진의 `scraper/cdn_fetch.py`의 `safe_filename()`과 같다:
/// Windows에서 금지된 글자 `\ / : * ? " < > |`를 `_`로 바꾼다(예: `D : 킬러 와이프` → `D _ 킬러 와이프`).
/// 받기 스크립트(`scripts/fetch-assets-lib.mjs`의 `safeFilename`)도 같은 규칙이다.
pub fn safe_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

/// 첫 바이트로 본 이미지 형식. WebP·PNG가 아니면 `None`.
pub fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 8 && bytes[0..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        Some("image/png")
    } else {
        None
    }
}

/// 표준 base64(채움 글자 `=` 포함).
pub fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[usize::from(b0 >> 2)] as char);
        out.push(TABLE[usize::from((b0 & 0x03) << 4 | b1 >> 4)] as char);
        if chunk.len() > 1 {
            out.push(TABLE[usize::from((b1 & 0x0F) << 2 | b2 >> 6)] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[usize::from(b2 & 0x3F)] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// 파일 이름 하나가 폴더를 벗어나지 않는가: 비어 있지 않고, 폴더를 가르는 글자가 없고, `.`·`..`이 아니다.
fn is_plain_file_name(name: &str) -> bool {
    if name.is_empty() || name.contains(['/', '\\', ':', '\0']) {
        return false;
    }
    let mut parts = Path::new(name).components();
    matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None))
}

/// `dir` 바로 아래의 파일 하나를 이미지로 읽는다. 읽지 못하는 모든 경우가 `None`이다(없음·폴더·너무 큼·이미지가 아님·
/// 폴더 밖을 가리키는 이름이나 링크).
fn read_image(dir: &Path, file_name: &str) -> Option<(&'static str, Vec<u8>)> {
    if !is_plain_file_name(file_name) {
        return None;
    }
    let path = dir.join(file_name);
    let meta = fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_IMAGE_BYTES {
        return None;
    }
    // 링크를 따라간 실제 자리가 그 폴더 바로 아래여야 한다.
    let real_dir = fs::canonicalize(dir).ok()?;
    let real_file = fs::canonicalize(&path).ok()?;
    if real_file.parent() != Some(real_dir.as_path()) {
        return None;
    }
    let bytes = fs::read(&real_file).ok()?;
    let mime = sniff_mime(&bytes)?;
    Some((mime, bytes))
}

/// 폴더에서 `<stem>.webp`, 없으면 `<stem>.png`.
fn read_webp_or_png(dir: &Path, stem: &str) -> Option<(&'static str, Vec<u8>)> {
    read_image(dir, &format!("{stem}.webp")).or_else(|| read_image(dir, &format!("{stem}.png")))
}

// ── 니케 초상화 ──────────────────────────────────────────────────────────────

/// 엔진 카탈로그의 니케 이름들. 파일이 바뀔 때만 다시 읽는다(초상화 한 장마다 카탈로그 전체를 읽지 않게).
#[derive(Debug, Default)]
pub struct NameIndex(Mutex<Option<IndexEntry>>);

#[derive(Debug)]
struct IndexEntry {
    file: PathBuf,
    modified: Option<SystemTime>,
    len: u64,
    names: Arc<HashSet<String>>,
}

impl NameIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// 그 엔진 폴더의 카탈로그에 있는 이름들. 카탈로그를 읽지 못하면 `None`(아는 이름이 없다).
    pub fn names(&self, engine_dir: &Path) -> Option<Arc<HashSet<String>>> {
        let file = engine_dir.join(CATALOG_FILE);
        let meta = fs::metadata(&file).ok()?;
        let (modified, len) = (meta.modified().ok(), meta.len());
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = slot.as_ref() {
            if entry.file == file && entry.modified == modified && entry.len == len {
                return Some(Arc::clone(&entry.names));
            }
        }
        let text = fs::read_to_string(&file).ok()?;
        let value: Value = serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text)).ok()?;
        let names: Arc<HashSet<String>> = Arc::new(value.as_object()?.keys().cloned().collect());
        *slot = Some(IndexEntry {
            file,
            modified,
            len,
            names: Arc::clone(&names),
        });
        Some(names)
    }
}

/// 니케 초상화. 이름이 엔진 카탈로그에 있을 때만 읽는다 — 그 밖의 문자열은 파일을 건드리지 않고 「없음」이다.
pub fn portrait(dirs: &ImageDirs, index: &NameIndex, name: &str) -> GameImage {
    let Some(engine_dir) = dirs.engine_dir.as_deref() else {
        return GameImage::missing();
    };
    let known = index
        .names(engine_dir)
        .is_some_and(|names| names.contains(name));
    if !known {
        return GameImage::missing();
    }
    let file = format!("{}.webp", safe_filename(name));
    if let Some((mime, bytes)) = read_image(&engine_dir.join(ENGINE_IMAGE_DIR), &file) {
        return GameImage::loaded(mime, &bytes, ImageSource::Engine);
    }
    if let Some((mime, bytes)) = dirs
        .assets(&["portraits"])
        .and_then(|dir| read_image(&dir, &file))
    {
        return GameImage::loaded(mime, &bytes, ImageSource::Assets);
    }
    GameImage::missing()
}

// ── 보스 이미지 ──────────────────────────────────────────────────────────────

/// 보스 id로 쓸 수 있는 글자인가: 소문자·숫자·`_`·`-`만, 1~64자.
pub fn is_boss_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_BOSS_ID_CHARS
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// 보스 묶음 파일(`{bosses: [{id, …}]}`)의 id들. 읽지 못하면 빈 목록이다.
pub fn boss_ids(bundle_file: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(bundle_file) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(text.strip_prefix('\u{feff}').unwrap_or(&text)) else {
        return Vec::new();
    };
    value
        .get("bosses")
        .and_then(Value::as_array)
        .map(|bosses| {
            bosses
                .iter()
                .filter_map(|boss| boss.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// 보스 이미지. id가 내장 보스 묶음에 있을 때만 읽는다. 받아 둔 리소스가 먼저고, 없으면 사용자의 캡처 조각이다.
pub fn boss_image(dirs: &ImageDirs, id: &str) -> GameImage {
    if !is_boss_id(id) {
        return GameImage::missing();
    }
    let known = dirs
        .bundle.as_ref()
        .is_some_and(|file| boss_ids(file).iter().any(|known| known == id));
    if !known {
        return GameImage::missing();
    }
    if let Some((mime, bytes)) = dirs
        .assets(&["bosses"])
        .and_then(|dir| read_webp_or_png(&dir, id))
    {
        return GameImage::loaded(mime, &bytes, ImageSource::Assets);
    }
    if let Some((mime, bytes)) = dirs
        .captures.as_ref().map(|dir| dir.join(BOSS_CAPTURES_SUBDIR[2]))
        .and_then(|dir| read_image(&dir, &format!("{id}.png")))
    {
        return GameImage::loaded(mime, &bytes, ImageSource::Capture);
    }
    GameImage::missing()
}

// ── 아이콘 ───────────────────────────────────────────────────────────────────

/// 아이콘 하나의 자리: 받아 둔 리소스에서의 폴더·파일 이름(확장자 제외), 엔진 폴더의 파일 이름(확인된 것만).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IconSlot {
    /// `data/assets/icons/<dir>/`.
    pub dir: &'static str,
    /// `<stem>.webp` 또는 `<stem>.png`.
    pub stem: &'static str,
    /// 엔진 폴더의 `image/icon/` 아래 파일 이름. 엔진 코드(`runner/squads.py`)에서 확인된 종류에만 있다.
    pub engine_file: Option<&'static str>,
}

const fn slot(dir: &'static str, stem: &'static str, engine_file: Option<&'static str>) -> IconSlot {
    IconSlot {
        dir,
        stem,
        engine_file,
    }
}

/// 아이콘의 표: (종류, 값) → 자리. 종류와 값은 엔진 카탈로그의 낱말 그대로다
/// (속성 `element_code`, 버스트 `burst_stage`, 클래스 `class`, 기업 `manufacturer`, 무기 `weapon_type`).
///
/// 엔진 폴더의 파일 이름은 `vendor/nikke-calc/runner/squads.py`의 `ELEMENT_ICON`·`BURST_ICON`·`CLASS_ICON`에 있는 것만 적었다.
/// 기업 아이콘(`icn_corp_01~05.webp`)은 어느 번호가 어느 기업인지 그 코드에 없어 쓰지 않는다. 무기 아이콘은 엔진 폴더에 없다.
pub const ICONS: [(&str, &str, IconSlot); 23] = [
    ("element", "작열", slot("element", "fire", Some("icn_element_fire.webp"))),
    ("element", "수냉", slot("element", "water", Some("icn_element_water.webp"))),
    ("element", "풍압", slot("element", "wind", Some("icn_element_wind.webp"))),
    ("element", "전격", slot("element", "electric", Some("icn_element_elect.webp"))),
    ("element", "철갑", slot("element", "iron", Some("icn_element_iron.webp"))),
    ("burst", "1", slot("burst", "1", Some("icn_burst_01.webp"))),
    ("burst", "2", slot("burst", "2", Some("icn_burst_02.webp"))),
    ("burst", "3", slot("burst", "3", Some("icn_burst_03.webp"))),
    ("burst", "A", slot("burst", "all", Some("icn_burst_all.webp"))),
    ("class", "화력형", slot("class", "attacker", Some("icn_class_attacker.webp"))),
    ("class", "지원형", slot("class", "supporter", Some("icn_class_supporter.webp"))),
    ("class", "방어형", slot("class", "defender", Some("icn_class_defender.webp"))),
    ("corp", "엘리시온", slot("corp", "elysion", None)),
    ("corp", "미실리스", slot("corp", "missilis", None)),
    ("corp", "테트라", slot("corp", "tetra", None)),
    ("corp", "필그림", slot("corp", "pilgrim", None)),
    ("corp", "어브노말", slot("corp", "abnormal", None)),
    ("weapon", "AR", slot("weapon", "ar", None)),
    ("weapon", "SMG", slot("weapon", "smg", None)),
    ("weapon", "SG", slot("weapon", "sg", None)),
    ("weapon", "SR", slot("weapon", "sr", None)),
    ("weapon", "MG", slot("weapon", "mg", None)),
    ("weapon", "RL", slot("weapon", "rl", None)),
];

/// 그 종류·값의 아이콘 자리. 표에 없으면 `None`.
pub fn icon_slot(kind: &str, key: &str) -> Option<IconSlot> {
    ICONS
        .iter()
        .find(|(k, v, _)| *k == kind && *v == key)
        .map(|(_, _, slot)| *slot)
}

/// 아이콘. 종류와 값이 표에 있을 때만 읽는다. 받아 둔 리소스가 먼저고, 없으면 엔진 폴더의 것(확인된 종류만),
/// 그것도 없으면 「없음」 — 화면이 직접 그린 대체 아이콘을 쓴다.
pub fn icon(dirs: &ImageDirs, kind: &str, key: &str) -> GameImage {
    let Some(slot) = icon_slot(kind, key) else {
        return GameImage::missing();
    };
    if let Some((mime, bytes)) = dirs
        .assets(&["icons", slot.dir])
        .and_then(|dir| read_webp_or_png(&dir, slot.stem))
    {
        return GameImage::loaded(mime, &bytes, ImageSource::Assets);
    }
    if let Some((mime, bytes)) = slot.engine_file.and_then(|file| {
        dirs.engine(&ENGINE_ICON_DIR)
            .and_then(|dir| read_image(&dir, file))
    }) {
        return GameImage::loaded(mime, &bytes, ImageSource::Engine);
    }
    GameImage::missing()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// 테스트마다 새 임시 폴더. 끝나면 지운다.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "nikke-assets-{label}-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("임시 폴더");
            Self(dir)
        }

        fn write(&self, relative: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().expect("부모 폴더")).expect("폴더");
            fs::write(&path, bytes).expect("파일");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// 코드로 만든 가짜 WebP(머리 바이트만 맞는다 — 게임 이미지가 아니다). `tag`로 서로 구분한다.
    fn fake_webp(tag: u8) -> Vec<u8> {
        let mut bytes = b"RIFF\x10\x00\x00\x00WEBPVP8 ".to_vec();
        bytes.extend_from_slice(&[tag; 16]);
        bytes
    }

    /// 코드로 만든 가짜 PNG(머리 바이트만 맞는다).
    fn fake_png(tag: u8) -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(&[tag; 16]);
        bytes
    }

    /// 가짜 엔진 폴더와 가짜 저장소 루트. 카탈로그의 니케는 지어낸 이름이다.
    struct World {
        engine: TempDir,
        repo: TempDir,
        index: NameIndex,
    }

    impl World {
        fn new() -> Self {
            let engine = TempDir::new("engine");
            engine.write(
                CATALOG_FILE,
                "\u{feff}{\"가나\": {\"element_code\": \"작열\"}, \"D : 킬러\": {}, \"그림없음\": {}, \"받아둔\": {}, \"..\": {}, \"icon\": {}}"
                    .as_bytes(),
            );
            engine.write("image/가나.webp", &fake_webp(1));
            engine.write("image/D _ 킬러.webp", &fake_webp(2));
            // 카탈로그에 없는 이름의 파일들 — 읽히면 안 된다.
            engine.write("image/비밀.webp", &fake_webp(9));
            engine.write("secret.webp", &fake_webp(9));
            engine.write("image/icon/icn_element_fire.webp", &fake_webp(11));
            engine.write("image/icon/icn_burst_all.webp", &fake_webp(12));
            engine.write("image/icon/icn_corp_01.webp", &fake_webp(13));
            let repo = TempDir::new("repo");
            repo.write(
                "data/intercept/anomaly.json",
                br#"{"schema_version": 1, "bosses": [{"id": "kraken", "name": "K"}, {"id": "ultra"}, {"id": "no_image"}, {"id": "../escape"}, {"id": "Upper"}, {"name": "no id"}]}"#,
            );
            repo.write("data/captures/bosses/kraken.png", &fake_png(21));
            repo.write("data/captures/bosses/ultra.png", &fake_png(22));
            repo.write("data/captures/bosses/_sheet.png", &fake_png(29));
            repo.write("data/captures/escape.png", &fake_png(29));
            repo.write("data/assets/portraits/받아둔.webp", &fake_webp(3));
            repo.write("data/assets/portraits/가나.webp", &fake_webp(4));
            Self {
                engine,
                repo,
                index: NameIndex::new(),
            }
        }

        fn dirs(&self) -> ImageDirs {
            ImageDirs {
                engine_dir: Some(self.engine.0.clone()),
                data_root: Some(self.repo.0.join("data")),
                captures: Some(self.repo.0.join("data/captures")),
                bundle: Some(self.repo.0.join("data/intercept/anomaly.json")),
            }
        }

        fn portrait(&self, name: &str) -> GameImage {
            portrait(&self.dirs(), &self.index, name)
        }
    }

    fn loaded(mime: &'static str, bytes: &[u8], source: ImageSource) -> GameImage {
        GameImage::loaded(mime, bytes, source)
    }

    #[test]
    fn safe_filename_follows_the_engine_rule() {
        assert_eq!(safe_filename("D : 킬러 와이프"), "D _ 킬러 와이프");
        assert_eq!(safe_filename("a\\b/c:d*e?f\"g<h>i|j"), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(safe_filename("E.H."), "E.H.");
        assert_eq!(safe_filename("아스카 : WILLE"), "아스카 _ WILLE");
        assert_eq!(safe_filename("../../비밀"), ".._.._비밀");
        // 엔진 코드의 금지 글자 목록과 같은지 대조한다.
        let engine = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/nikke-calc/scraper/cdn_fetch.py");
        let source = fs::read_to_string(engine).expect("엔진의 cdn_fetch.py");
        assert!(source.contains(r#"for ch in r'\/:*?"<>|':"#), "safe_filename의 금지 글자 목록이 바뀌었다");
        assert!(source.contains(r#"name = name.replace(ch, "_")"#));
    }

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foob"), "Zm9vYg==");
        assert_eq!(encode_base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(encode_base64(&[0xFB, 0xFF, 0xFE]), "+//+");
        assert_eq!(encode_base64(&[0x00, 0x00, 0x00, 0xFF]), "AAAA/w==");
    }

    #[test]
    fn only_webp_and_png_are_images() {
        assert_eq!(sniff_mime(&fake_webp(0)), Some("image/webp"));
        assert_eq!(sniff_mime(&fake_png(0)), Some("image/png"));
        assert_eq!(sniff_mime(b"<html></html>"), None);
        assert_eq!(sniff_mime(b"RIFF\x10\x00\x00\x00WAVEfmt "), None);
        assert_eq!(sniff_mime(b"{\"game_token\": 1}"), None);
        assert_eq!(sniff_mime(b""), None);
        assert_eq!(sniff_mime(b"RIFF"), None);
    }

    #[test]
    fn portrait_is_read_from_the_engine_image_folder_for_catalog_names() {
        let world = World::new();
        assert_eq!(world.portrait("가나"), loaded("image/webp", &fake_webp(1), ImageSource::Engine));
        // 이름의 ':'는 엔진 규칙대로 '_'가 된다.
        assert_eq!(world.portrait("D : 킬러"), loaded("image/webp", &fake_webp(2), ImageSource::Engine));
        // 엔진 폴더에 없으면 받아 둔 리소스에서 읽는다.
        assert_eq!(world.portrait("받아둔"), loaded("image/webp", &fake_webp(3), ImageSource::Assets));
        // 화면에 넘기는 모양: found·mime·data(base64)·source.
        let json = serde_json::to_value(world.portrait("가나")).unwrap();
        assert_eq!(json["found"], true);
        assert_eq!(json["mime"], "image/webp");
        assert_eq!(json["source"], "engine");
        assert_eq!(json["data"], encode_base64(&fake_webp(1)));
        assert_eq!(json.as_object().unwrap().len(), 4);
    }

    #[test]
    fn a_missing_portrait_is_not_an_error() {
        let world = World::new();
        // 카탈로그에 있지만 그림이 없다.
        assert_eq!(world.portrait("그림없음"), GameImage::missing());
        let json = serde_json::to_value(GameImage::missing()).unwrap();
        assert_eq!(json, serde_json::json!({"found": false, "mime": null, "data": null, "source": null}));
        // 엔진 폴더를 모르거나 카탈로그를 읽을 수 없어도 「없음」이다.
        let none = ImageDirs::default();
        assert_eq!(portrait(&none, &NameIndex::new(), "가나"), GameImage::missing());
        let broken = TempDir::new("broken");
        broken.write(CATALOG_FILE, b"{ not json");
        broken.write("image/가나.webp", &fake_webp(1));
        let dirs = ImageDirs {
            engine_dir: Some(broken.0.clone()),
            ..ImageDirs::default()
        };
        assert_eq!(portrait(&dirs, &NameIndex::new(), "가나"), GameImage::missing());
        // 최상위가 객체가 아닌 카탈로그.
        broken.write(CATALOG_FILE, b"[\"\xea\xb0\x80\xeb\x82\x98\"]");
        assert_eq!(portrait(&dirs, &NameIndex::new(), "가나"), GameImage::missing());
    }

    #[test]
    fn names_outside_the_catalog_never_reach_the_file_system() {
        let world = World::new();
        // 파일은 있지만 카탈로그에 없는 이름.
        assert_eq!(world.portrait("비밀"), GameImage::missing());
        // 경로 탈출 시도: 위로 올라가기, 절대 경로, 다른 폴더, 확장자 붙이기, 빈 문자열, 널 문자.
        let attacks = [
            "../secret",
            "..\\secret",
            "../../data/parsed_nikke",
            "image/../secret",
            "icon/icn_element_fire",
            "icon\\icn_element_fire",
            "가나/../비밀",
            "가나.webp",
            "가나\0",
            "",
            ".",
            "C:\\Windows\\win.ini",
            "/etc/passwd",
            "\\\\server\\share\\x",
            "file:///C:/x",
            "비밀.webp",
            "%2e%2e%2fsecret",
        ];
        for name in attacks {
            assert_eq!(world.portrait(name), GameImage::missing(), "{name:?}");
        }
        // 카탈로그에 이상한 이름이 있어도(".." · 폴더 이름) 폴더 밖이나 폴더 자체를 읽지 않는다.
        assert_eq!(world.portrait(".."), GameImage::missing());
        assert_eq!(world.portrait("icon"), GameImage::missing());
        // 카탈로그 이름과 파일 이름이 같아야 한다 — 비슷한 이름(공백·대소문자)은 다른 이름이다.
        assert_eq!(world.portrait("가나 "), GameImage::missing());
        assert_eq!(world.portrait("d : 킬러"), GameImage::missing());
    }

    #[test]
    fn a_catalog_name_cannot_point_outside_the_image_folder() {
        // 카탈로그가 통째로 악의적이어도(이름에 경로가 들어 있어도) 파일 이름 규칙이 폴더를 가르는 글자를 없앤다.
        let engine = TempDir::new("evil");
        engine.write(CATALOG_FILE, br#"{"../secret": {}, "..\\secret": {}, "C:\\secret": {}, "a/b": {}}"#);
        engine.write("secret.webp", &fake_webp(9));
        engine.write("image/a/b.webp", &fake_webp(9));
        // 규칙대로 바꾼 이름의 파일만 읽힌다.
        engine.write("image/a_b.webp", &fake_webp(5));
        let dirs = ImageDirs {
            engine_dir: Some(engine.0.clone()),
            ..ImageDirs::default()
        };
        let index = NameIndex::new();
        for name in ["../secret", "..\\secret", "C:\\secret"] {
            assert_eq!(portrait(&dirs, &index, name), GameImage::missing(), "{name:?}");
        }
        assert_eq!(portrait(&dirs, &index, "a/b"), loaded("image/webp", &fake_webp(5), ImageSource::Engine));
        assert!(is_plain_file_name("가나.webp"));
        for bad in ["", ".", "..", "a/b", "a\\b", "C:x", "a\0b", "/a", "..\\a"] {
            assert!(!is_plain_file_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn files_that_are_not_images_or_are_too_large_are_not_handed_over() {
        let world = World::new();
        // 이미지 확장자를 한 다른 내용(예: 글자 파일)은 넘기지 않는다.
        world.engine.write("image/가나.webp", b"game_token=SECRET; game_openid=1");
        assert_eq!(world.portrait("가나"), loaded("image/webp", &fake_webp(4), ImageSource::Assets), "엔진 쪽이 이미지가 아니면 받아 둔 것으로 넘어간다");
        world.repo.write("data/assets/portraits/가나.webp", b"not an image");
        assert_eq!(world.portrait("가나"), GameImage::missing());
        // 빈 파일.
        world.engine.write("image/D _ 킬러.webp", b"");
        assert_eq!(world.portrait("D : 킬러"), GameImage::missing());
        // 한도를 넘는 파일.
        let mut big = fake_webp(1);
        big.resize(usize::try_from(MAX_IMAGE_BYTES).unwrap() + 1, 0);
        world.engine.write("image/그림없음.webp", &big);
        assert_eq!(world.portrait("그림없음"), GameImage::missing());
        big.truncate(usize::try_from(MAX_IMAGE_BYTES).unwrap());
        world.engine.write("image/그림없음.webp", &big);
        assert!(world.portrait("그림없음").found);
        // 같은 이름의 폴더.
        fs::create_dir_all(world.engine.0.join("image/받아둔.webp")).unwrap();
        assert_eq!(world.portrait("받아둔").source, Some(ImageSource::Assets));
    }

    #[test]
    fn the_name_index_reloads_when_the_catalog_changes() {
        let world = World::new();
        assert_eq!(world.portrait("새니케"), GameImage::missing());
        world.engine.write("image/새니케.webp", &fake_webp(7));
        assert_eq!(world.portrait("새니케"), GameImage::missing(), "카탈로그에 아직 없다");
        // 카탈로그가 바뀌면(크기가 달라진다) 다시 읽는다.
        world.engine.write(CATALOG_FILE, "{\"가나\": {}, \"새니케\": {\"element_code\": \"수냉\"}}".as_bytes());
        assert_eq!(world.portrait("새니케"), loaded("image/webp", &fake_webp(7), ImageSource::Engine));
        // 빠진 이름은 더는 읽지 않는다.
        assert_eq!(world.portrait("D : 킬러"), GameImage::missing());
        // 같은 색인을 다른 엔진 폴더에 써도 그 폴더의 카탈로그를 본다.
        let other = TempDir::new("other");
        other.write(CATALOG_FILE, br#"{"X": {}}"#);
        let names = world.index.names(&other.0).expect("카탈로그");
        assert!(names.contains("X") && !names.contains("가나"));
        assert!(world.index.names(&world.engine.0).expect("카탈로그").contains("가나"));
        assert!(world.index.names(Path::new("없는-엔진-폴더")).is_none());
    }

    #[test]
    fn boss_image_prefers_fetched_assets_then_the_capture_crop() {
        let world = World::new();
        let dirs = world.dirs();
        // 받아 둔 것이 없으면 사용자의 캡처 조각.
        assert_eq!(boss_image(&dirs, "kraken"), loaded("image/png", &fake_png(21), ImageSource::Capture));
        // 받아 둔 것이 있으면 그것(WebP가 PNG보다 먼저).
        world.repo.write("data/assets/bosses/kraken.png", &fake_png(31));
        assert_eq!(boss_image(&dirs, "kraken"), loaded("image/png", &fake_png(31), ImageSource::Assets));
        world.repo.write("data/assets/bosses/kraken.webp", &fake_webp(32));
        assert_eq!(boss_image(&dirs, "kraken"), loaded("image/webp", &fake_webp(32), ImageSource::Assets));
        // 다른 보스는 여전히 캡처 조각.
        assert_eq!(boss_image(&dirs, "ultra").source, Some(ImageSource::Capture));
        // 묶음에는 있지만 그림이 없는 보스: 없음 — 화면이 속성 색으로 대신한다.
        assert_eq!(boss_image(&dirs, "no_image"), GameImage::missing());
        // 받아 둔 것이 이미지가 아니면 캡처 조각으로 넘어간다.
        world.repo.write("data/assets/bosses/ultra.webp", b"<html>");
        assert_eq!(boss_image(&dirs, "ultra"), loaded("image/png", &fake_png(22), ImageSource::Capture));
    }

    #[test]
    fn boss_image_is_read_only_for_ids_in_the_bundle() {
        let world = World::new();
        let dirs = world.dirs();
        // 파일은 있지만 묶음에 없는 id.
        assert_eq!(boss_image(&dirs, "_sheet"), GameImage::missing());
        // 묶음에 있어도 id로 쓸 수 없는 글자면 읽지 않는다.
        assert_eq!(boss_image(&dirs, "../escape"), GameImage::missing());
        assert_eq!(boss_image(&dirs, "Upper"), GameImage::missing());
        for id in ["", "..", "kraken.png", "kraken/../ultra", "bosses\\kraken", "C:\\x", "kraken\0", "KRAKEN", "크라켄", " kraken"] {
            assert_eq!(boss_image(&dirs, id), GameImage::missing(), "{id:?}");
        }
        assert!(is_boss_id("mirror_container") && is_boss_id("test-a") && is_boss_id("a1"));
        assert!(!is_boss_id(&"a".repeat(MAX_BOSS_ID_CHARS + 1)));
        assert!(is_boss_id(&"a".repeat(MAX_BOSS_ID_CHARS)));
        // 저장소를 모르거나 묶음을 읽을 수 없으면 없음.
        assert_eq!(boss_image(&ImageDirs::default(), "kraken"), GameImage::missing());
        world.repo.write("data/intercept/anomaly.json", b"{ not json");
        assert_eq!(boss_image(&dirs, "kraken"), GameImage::missing());
        assert_eq!(boss_ids(Path::new("없는-파일.json")), Vec::<String>::new());
    }

    #[test]
    fn the_real_boss_bundle_ids_are_usable() {
        let bundle = BOSS_BUNDLE_FILE
            .iter()
            .fold(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."), |dir, part| dir.join(part));
        let ids = boss_ids(&bundle);
        assert_eq!(ids, ["indivilia", "ultra", "harvester", "kraken", "mirror_container"]);
        assert!(ids.iter().all(|id| is_boss_id(id)));
    }

    #[test]
    fn icon_prefers_fetched_assets_then_the_engine_icon_then_nothing() {
        let world = World::new();
        let dirs = world.dirs();
        // 받아 둔 것이 없으면 엔진 폴더의 아이콘(파일 이름이 확인된 종류).
        assert_eq!(icon(&dirs, "element", "작열"), loaded("image/webp", &fake_webp(11), ImageSource::Engine));
        assert_eq!(icon(&dirs, "burst", "A"), loaded("image/webp", &fake_webp(12), ImageSource::Engine));
        // 받아 둔 것이 있으면 그것.
        world.repo.write("data/assets/icons/element/fire.png", &fake_png(41));
        assert_eq!(icon(&dirs, "element", "작열"), loaded("image/png", &fake_png(41), ImageSource::Assets));
        world.repo.write("data/assets/icons/element/fire.webp", &fake_webp(42));
        assert_eq!(icon(&dirs, "element", "작열"), loaded("image/webp", &fake_webp(42), ImageSource::Assets));
        // 어디에도 없으면 없음 — 화면이 직접 그린 대체 아이콘을 쓴다.
        assert_eq!(icon(&dirs, "element", "수냉"), GameImage::missing());
        assert_eq!(icon(&dirs, "weapon", "SR"), GameImage::missing());
        // 기업 아이콘은 엔진 폴더에 파일이 있어도 쓰지 않는다(번호와 기업의 짝을 확인하지 못했다).
        assert_eq!(icon(&dirs, "corp", "엘리시온"), GameImage::missing());
        world.repo.write("data/assets/icons/corp/elysion.webp", &fake_webp(43));
        assert_eq!(icon(&dirs, "corp", "엘리시온").source, Some(ImageSource::Assets));
        world.repo.write("data/assets/icons/weapon/sr.png", &fake_png(44));
        assert_eq!(icon(&dirs, "weapon", "SR"), loaded("image/png", &fake_png(44), ImageSource::Assets));
        // 폴더를 하나도 몰라도 없음.
        assert_eq!(icon(&ImageDirs::default(), "element", "작열"), GameImage::missing());
    }

    #[test]
    fn icons_outside_the_table_are_never_read() {
        let world = World::new();
        let dirs = world.dirs();
        for (kind, key) in [
            ("element", "fire"),
            ("element", "../../../secret"),
            ("element", "icn_element_fire.webp"),
            ("..", "작열"),
            ("icons", "element/fire"),
            ("corp", "01"),
            ("corp", "icn_corp_01"),
            ("burst", "all"),
            ("burst", "4"),
            ("weapon", "sr"),
            ("", ""),
            ("element", ""),
            ("portrait", "가나"),
        ] {
            assert_eq!(icon(&dirs, kind, key), GameImage::missing(), "{kind:?} {key:?}");
        }
        assert_eq!(icon_slot("element", "전격").unwrap().stem, "electric");
        assert_eq!(icon_slot("burst", "A").unwrap().engine_file, Some("icn_burst_all.webp"));
        assert_eq!(icon_slot("class", "화력형").unwrap().engine_file, Some("icn_class_attacker.webp"));
        assert!(icon_slot("corp", "필그림").unwrap().engine_file.is_none());
    }

    #[test]
    fn the_icon_table_is_safe_and_matches_the_engine_code() {
        // 표의 폴더·파일 이름은 폴더를 벗어날 수 없는 글자뿐이고, 겹치지 않는다.
        let mut seen = HashSet::new();
        for (kind, key, slot) in ICONS {
            assert_eq!(kind, slot.dir);
            assert!(slot.stem.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()), "{kind} {key}");
            assert!(seen.insert((slot.dir, slot.stem)), "{kind} {key}");
            if let Some(file) = slot.engine_file {
                assert!(is_plain_file_name(file) && file.starts_with("icn_") && file.ends_with(".webp"));
            }
        }
        assert_eq!(seen.len(), 23);
        // 엔진 폴더의 파일 이름은 엔진 코드(runner/squads.py)에 적힌 그대로다 — 값(속성·단계·클래스)과의 짝도 같다.
        let squads = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/nikke-calc/runner/squads.py"))
            .expect("엔진의 runner/squads.py");
        for (kind, key, slot) in ICONS {
            match slot.engine_file {
                Some(file) => assert!(squads.contains(&format!("\"{key}\": \"{file}\"")), "{kind} {key} {file}"),
                None => assert!(matches!(kind, "corp" | "weapon"), "{kind} {key}"),
            }
        }
        // 기업 아이콘의 번호-기업 짝은 그 코드에 없다(그래서 쓰지 않는다).
        assert!(!squads.contains("icn_corp_"));
    }

    #[test]
    fn real_engine_portraits_and_icons_load() {
        // 저장소의 엔진 서브모듈에는 초상화와 아이콘이 들어 있다.
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dirs = ImageDirs {
            engine_dir: Some(root.join("vendor/nikke-calc")),
            ..ImageDirs::default()
        };
        let index = NameIndex::new();
        for name in ["크라운", "라피 : 레드 후드", "D : 킬러 와이프", "E.H.", "아스카 : WILLE"] {
            let image = portrait(&dirs, &index, name);
            assert!(image.found, "{name}");
            assert_eq!(image.mime, Some("image/webp"), "{name}");
            assert_eq!(image.source, Some(ImageSource::Engine), "{name}");
        }
        // 카탈로그에만 있는 시험용 니케는 그림이 없다.
        assert_eq!(portrait(&dirs, &index, "test_B1"), GameImage::missing());
        assert_eq!(portrait(&dirs, &index, "없는 니케"), GameImage::missing());
        for (kind, key) in [("element", "작열"), ("element", "전격"), ("burst", "1"), ("burst", "A"), ("class", "방어형")] {
            assert_eq!(icon(&dirs, kind, key).source, Some(ImageSource::Engine), "{kind} {key}");
        }
    }
}
