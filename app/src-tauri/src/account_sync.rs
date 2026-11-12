//! 계정 받기 — 쿠키 저장, 엔진의 수집 스크립트 실행, 받은 프로필 읽기, 계정 파일 저장.
//!
//! 터미널에서 손으로 하던 세 단계 가운데 파일과 프로세스를 다루는 부분이다. Tauri API를 모른다(명령은 `lib.rs`가 잇는다).
//! 프로필 → 계정 상태 변환은 여기에 없다 — 화면 쪽에서 도는 루트의 `src/core/import-profile.mjs`가 한다.
//!
//! **세션 쿠키는 계정 접근권이다.** 이 모듈의 규칙:
//! - 쿠키를 쓰는 곳은 엔진의 `scraper/.session_cookie` 하나다(`write_cookie_file`). 다른 파일·임시 파일에 쓰지 않는다.
//! - 쿠키 값은 반환값·오류 문장·진행 줄 어디에도 넣지 않는다. 수집 스크립트가 낸 줄은 쿠키 값을 가린 뒤에 넘긴다(`Redactor`).
//! - 이 모듈은 네트워크 요청을 하지 않는다. 쿠키를 보내는 것은 엔진의 수집 스크립트가 blablalink API에 하는 요청뿐이다.
//! - 이 모듈은 아무것도 출력하지 않는다(표준 출력·표준 오류).
//!
//! 실행할 스크립트는 정해져 있다: 설정된 엔진 폴더의 `scraper/profile_fetch.py`. 화면이 넘기는 것은 프로필 이름뿐이고,
//! 이름은 파일 이름에 안전한 글자만 받는다(`validate_name`).

use std::fmt;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};

use crate::capture::{find_repo_root, Stamp};
use crate::cookie::{self, BrowserCookie, CookieError, Redactor, SessionCookie};
use crate::engine::{self, EngineConfig, ProcessGroup, StopSignal, STOPPED_PREFIX};

/// 엔진 폴더에서 본 수집 스크립트. 이것만 실행한다.
pub const FETCH_SCRIPT: &str = "scraper/profile_fetch.py";
/// 엔진 폴더에서 본 쿠키 파일. 앱이 쿠키를 쓰는 유일한 곳이다(수집 스크립트가 여기서 읽는다).
pub const COOKIE_FILE: &str = "scraper/.session_cookie";
/// 엔진 폴더에서 본 프로필 폴더. 수집 스크립트가 `<이름>.json`과 `<이름>.raw.json`을 쓴다.
pub const PROFILES_SUBDIR: &str = "profiles";
/// 엔진 폴더에서 본 오버로드 옵션 표. 루트 `src/core/import-profile.mjs`의 `OPTION_TABLE_FILE`과 같아야 한다.
pub const OPTION_TABLE_FILE: &str = "data/base_stat_tables/equipment_skills.json";

/// 계정 파일을 둘 폴더를 지정하는 환경 변수. 없으면 저장소의 `data/accounts`(gitignore).
pub const ENV_ACCOUNTS_DIR: &str = "NIKKE_ACCOUNTS_DIR";
/// 저장소 루트에서 본 계정 폴더.
pub const ACCOUNTS_SUBDIR: [&str; 2] = ["data", "accounts"];

/// 수집 스크립트의 시간 제한. 요청마다 스크립트 자신의 30초 제한이 있고, 요청은 수십~백여 건이다.
pub const DEFAULT_FETCH_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// 이름을 주지 않았을 때의 프로필·계정 이름(수집 스크립트의 기본값과 같다).
pub const DEFAULT_NAME: &str = "me";
/// 이름의 최대 글자 수.
pub const MAX_NAME_CHARS: usize = 48;
/// 화면에 넘기는 줄의 최대 수. 넘으면 알리는 줄 하나를 남기고 버린다.
pub const MAX_LINES: usize = 2000;
/// 화면에 넘기는 한 줄의 최대 글자 수.
pub const MAX_LINE_CHARS: usize = 2000;

/// 수집 스크립트가 경고 줄 앞에 붙이는 표시.
const WARNING_MARK: &str = "[!]";

// ── 오류 ─────────────────────────────────────────────────────────────────────

/// 계정 받기의 실패. 문장에 쿠키 값은 들어가지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncError {
    /// 엔진 폴더·python 설정 문제(`lib.rs`의 `engine_config`가 낸 문장).
    Engine { detail: String },
    /// 엔진 폴더에 수집 스크립트가 없다.
    ScriptMissing { path: String },
    NameInvalid { reason: &'static str },
    Cookie(CookieError),
    /// 쿠키 파일이 없다.
    CookieFileMissing,
    /// 쿠키 파일에 game_token이 없다.
    CookieFileInvalid,
    CookieFileUnreadable { detail: String },
    CookieWrite { path: String, detail: String },
    /// 로그인 세션이 만료됐다. `ambiguous`면 스크립트가 "세션 만료이거나 비공개 계정"이라고만 알린 경우다.
    SessionExpired { ambiguous: bool },
    Network { detail: String },
    Timeout { seconds: u64 },
    Stopped,
    Busy,
    Spawn { python: String, detail: String },
    Io { detail: String },
    ScriptFailed { code: String, detail: String },
    /// 스크립트는 성공으로 끝났는데 프로필 파일이 새로 쓰이지 않았다.
    ProfileNotWritten { path: String },
    ProfileUnreadable { path: String, detail: String },
    ProfileInvalid { path: String, detail: String },
    AccountsDirUnknown,
    AccountInvalid { detail: &'static str },
    AccountWrite { path: String, detail: String },
    /// 로그인 창이 열려 있지 않다.
    LoginWindowClosed,
    LoginWindow { detail: String },
}

impl SyncError {
    /// 화면이 실패를 구분하는 이름.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Engine { .. } | Self::ScriptMissing { .. } | Self::Spawn { .. } => "engine",
            Self::NameInvalid { .. } => "name",
            Self::Cookie(CookieError::NotLoggedIn { .. }) => "not_logged_in",
            Self::Cookie(_) => "cookie_rejected",
            Self::CookieFileMissing => "cookie_missing",
            Self::CookieFileInvalid | Self::CookieFileUnreadable { .. } => "cookie_invalid",
            Self::CookieWrite { .. } => "cookie_write",
            Self::SessionExpired { .. } => "session_expired",
            Self::Network { .. } => "network",
            Self::Timeout { .. } => "timeout",
            Self::Stopped => "stopped",
            Self::Busy => "busy",
            Self::Io { .. } | Self::ScriptFailed { .. } => "script_failed",
            Self::ProfileNotWritten { .. }
            | Self::ProfileUnreadable { .. }
            | Self::ProfileInvalid { .. } => "profile",
            Self::AccountsDirUnknown | Self::AccountInvalid { .. } | Self::AccountWrite { .. } => {
                "account_file"
            }
            Self::LoginWindowClosed | Self::LoginWindow { .. } => "login_window",
        }
    }

    /// 쿠키를 다시 받아야 풀리는 실패인가. 화면이 쿠키를 받는 순서를 함께 보인다.
    pub fn needs_cookie(&self) -> bool {
        matches!(
            self,
            Self::Cookie(_)
                | Self::CookieFileMissing
                | Self::CookieFileInvalid
                | Self::CookieFileUnreadable { .. }
                | Self::SessionExpired { .. }
        )
    }
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Engine { detail } => write!(f, "{detail}"),
            Self::ScriptMissing { path } => write!(
                f,
                "엔진 폴더에 수집 스크립트({FETCH_SCRIPT})가 없다: {path}. 서브모듈을 받았는지 확인하라"
            ),
            Self::NameInvalid { reason } => write!(
                f,
                "계정 이름을 쓸 수 없다: {reason}. 글자·숫자·밑줄(_)·붙임표(-)·낱말 사이 공백만, {MAX_NAME_CHARS}자까지 쓴다"
            ),
            Self::Cookie(e) => write!(f, "{e}"),
            Self::CookieFileMissing => write!(
                f,
                "쿠키 파일이 없다 — 1단계에서 쿠키를 먼저 받아라(로그인 창 또는 붙여넣기)"
            ),
            Self::CookieFileInvalid => write!(
                f,
                "저장된 쿠키에 game_token이 없다 — 로그인 세션 쿠키 전체를 다시 받아라"
            ),
            Self::CookieFileUnreadable { detail } => {
                write!(f, "쿠키 파일을 읽을 수 없다 ({detail}) — 쿠키를 다시 받아라")
            }
            Self::CookieWrite { path, detail } => {
                write!(f, "쿠키 파일을 쓰지 못했다: {path} ({detail})")
            }
            Self::SessionExpired { ambiguous: false } => write!(
                f,
                "로그인 세션이 만료됐다(game not login) — 쿠키를 다시 받아라"
            ),
            Self::SessionExpired { ambiguous: true } => write!(
                f,
                "캐릭터 목록을 받지 못했다 — 로그인 세션이 만료됐거나 비공개 계정이다. 쿠키를 다시 받아라"
            ),
            Self::Network { detail } => write!(
                f,
                "네트워크 오류로 계정을 받지 못했다 — 인터넷 연결과 blablalink 접속을 확인하고 다시 하라 ({detail})"
            ),
            Self::Timeout { seconds } => write!(
                f,
                "시간 초과: 계정 수집이 {seconds}초 안에 끝나지 않아 멈췄다 — 네트워크 상태를 확인하고 다시 하라"
            ),
            Self::Stopped => write!(f, "{STOPPED_PREFIX}: 계정 수집을 멈췄다"),
            Self::Busy => write!(f, "이미 계정을 받는 중이다. 끝난 뒤에 다시 하라"),
            Self::Spawn { python, detail } => write!(
                f,
                "수집 스크립트를 실행할 수 없다 ({python}): {detail} — python 경로는 환경 변수 {}이나 설정 파일의 python으로 정한다",
                engine::ENV_PYTHON
            ),
            Self::Io { detail } => write!(f, "수집 스크립트와 주고받는 중 오류가 났다: {detail}"),
            Self::ScriptFailed { code, detail } => {
                write!(f, "수집 스크립트가 실패했다(종료 코드 {code}): {detail}")
            }
            Self::ProfileNotWritten { path } => write!(
                f,
                "수집 스크립트는 끝났는데 프로필 파일이 새로 쓰이지 않았다: {path}"
            ),
            Self::ProfileUnreadable { path, detail } => write!(
                f,
                "받은 프로필을 읽을 수 없다: {path} ({detail}) — 계정을 먼저 받아라"
            ),
            Self::ProfileInvalid { path, detail } => {
                write!(f, "받은 프로필의 형식이 다르다: {path} ({detail})")
            }
            Self::AccountsDirUnknown => write!(
                f,
                "계정 파일을 둘 폴더(data/accounts)를 찾을 수 없다. 환경 변수 {ENV_ACCOUNTS_DIR}로 지정하라"
            ),
            Self::AccountInvalid { detail } => {
                write!(f, "저장할 계정 문서의 형식이 다르다: {detail}")
            }
            Self::AccountWrite { path, detail } => {
                write!(f, "계정 파일을 쓰지 못했다: {path} ({detail})")
            }
            Self::LoginWindowClosed => write!(
                f,
                "로그인 창이 열려 있지 않다 — 「blablalink 로그인」으로 창을 열고 로그인한 뒤 다시 눌러라"
            ),
            Self::LoginWindow { detail } => write!(f, "로그인 창을 다루지 못했다: {detail}"),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<CookieError> for SyncError {
    fn from(e: CookieError) -> Self {
        Self::Cookie(e)
    }
}

/// 수집 스크립트가 낸 줄 하나(쿠키 값은 가려져 있다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FetchLine {
    pub text: String,
    /// 경고 줄(`[!]`)인가.
    pub warning: bool,
}

impl FetchLine {
    fn new(text: String) -> Self {
        let warning = text.trim_start().starts_with(WARNING_MARK);
        Self { text, warning }
    }
}

/// 화면에 넘기는 실패. 프런트의 `SyncFailure`(src/types.ts)와 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncFailure {
    /// 실패의 종류(`SyncError::kind`).
    pub kind: &'static str,
    /// 한국어 문장.
    pub message: String,
    /// 쿠키를 다시 받아야 하는가 — 화면이 쿠키를 받는 순서를 함께 보인다.
    pub cookie_help: bool,
    /// 수집 스크립트가 그때까지 낸 줄(수집 실패일 때만 있다).
    pub lines: Vec<FetchLine>,
    /// 그 가운데 경고 줄(`[!]`).
    pub warnings: Vec<String>,
}

impl SyncFailure {
    fn with_lines(error: &SyncError, lines: Vec<FetchLine>) -> Self {
        let warnings = warnings_of(&lines);
        Self {
            kind: error.kind(),
            message: error.to_string(),
            cookie_help: error.needs_cookie(),
            lines,
            warnings,
        }
    }
}

impl From<SyncError> for SyncFailure {
    fn from(error: SyncError) -> Self {
        Self::with_lines(&error, Vec::new())
    }
}

fn warnings_of(lines: &[FetchLine]) -> Vec<String> {
    lines
        .iter()
        .filter(|line| line.warning)
        .map(|line| line.text.trim().to_string())
        .collect()
}

// ── 이름 ─────────────────────────────────────────────────────────────────────

/// Windows에서 파일 이름으로 쓸 수 없는 장치 이름.
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 프로필·계정 이름을 확인한다. 이 이름이 엔진의 `profiles/<이름>.json`과 `data/accounts/<이름>.json`의 파일 이름이 되고
/// 수집 스크립트의 `--name` 인자가 된다 — 경로를 벗어나거나 인자로 읽힐 수 있는 이름은 고치지 않고 거부한다.
///
/// 받는 글자: 글자·숫자(한글 포함), 밑줄, 붙임표, 낱말 사이의 공백. 점·경로 구분자는 받지 않는다.
pub fn validate_name(name: &str) -> Result<String, SyncError> {
    let bad = |reason: &'static str| Err(SyncError::NameInvalid { reason });
    let name = name.trim();
    if name.is_empty() {
        return bad("이름이 비어 있다");
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return bad("이름이 너무 길다");
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | ' '))
    {
        return bad("쓸 수 없는 글자가 있다(점·경로 구분자·기호는 쓰지 않는다)");
    }
    if name.starts_with('-') {
        return bad("붙임표로 시작할 수 없다");
    }
    if RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(name)) {
        return bad("Windows가 쓰는 장치 이름이다");
    }
    Ok(name.to_string())
}

// ── 설정·상태 ─────────────────────────────────────────────────────────────────

/// 수집 스크립트를 띄울 때 쓰는 확정된 값. 엔진 설정(P-010의 엔진 폴더 규칙)에서 나온다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchConfig {
    pub engine_dir: PathBuf,
    pub python: String,
    pub timeout: Duration,
}

impl FetchConfig {
    pub fn from_engine(config: &EngineConfig) -> Self {
        Self {
            engine_dir: config.engine_dir.clone(),
            python: config.python.clone(),
            timeout: DEFAULT_FETCH_TIMEOUT,
        }
    }

    fn script(&self) -> PathBuf {
        self.engine_dir.join(FETCH_SCRIPT)
    }
}

pub fn cookie_path(engine_dir: &Path) -> PathBuf {
    engine_dir.join(COOKIE_FILE)
}

/// 엔진의 프로필 파일 경로. 이름은 `validate_name`을 거친 것이어야 한다.
fn profile_path(engine_dir: &Path, name: &str) -> PathBuf {
    engine_dir.join(PROFILES_SUBDIR).join(format!("{name}.json"))
}

fn iso(time: SystemTime) -> Option<String> {
    let ms = time.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(Stamp::from_unix_millis(u64::try_from(ms).ok()?).iso_utc())
}

/// 파일을 마지막으로 쓴 시각(ISO, UTC). 파일이 없거나 시각을 알 수 없으면 `None`. 내용은 읽지 않는다.
fn modified_at(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok().filter(fs::Metadata::is_file)?;
    iso(meta.modified().ok()?)
}

/// 계정 받기의 지금 상태. 프런트의 `SyncStatus`(src/types.ts)와 같아야 한다. 쿠키의 내용은 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncStatus {
    /// 확인한 이름.
    pub name: String,
    /// 쿠키 파일이 있는가. 내용은 읽지 않는다.
    pub cookie_saved: bool,
    /// 쿠키 파일을 마지막으로 쓴 시각.
    pub cookie_saved_at: Option<String>,
    /// 그 이름의 프로필을 마지막으로 받은 시각(프로필 파일을 쓴 시각).
    pub profile_fetched_at: Option<String>,
    /// 그 이름의 계정 파일 경로(있을 때만).
    pub account_file: Option<String>,
    /// 로그인 창이 열려 있는가(`lib.rs`가 채운다).
    pub login_window_open: bool,
    /// 엔진 폴더·수집 스크립트·python·계정 폴더의 문제(한국어 문장). 비어 있으면 받을 수 있다.
    pub problems: Vec<String>,
}

/// python을 실행할 수 있는지 본다(`python --version`). 문제가 있으면 한국어 문장.
fn python_problem(python: &str) -> Option<String> {
    let mut cmd = Command::new(python);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    engine::hide_console(&mut cmd);
    match cmd.status() {
        Ok(status) if status.success() => None,
        Ok(status) => Some(format!(
            "python이 오류로 끝났다 ({python}, 종료 코드 {})",
            status.code().map_or_else(|| "없음".to_string(), |c| c.to_string())
        )),
        Err(e) => Some(
            SyncError::Spawn {
                python: python.to_string(),
                detail: e.to_string(),
            }
            .to_string(),
        ),
    }
}

/// 계정 받기의 상태를 모은다. 파일의 유무와 시각만 본다 — 쿠키·프로필·계정 파일의 내용은 읽지 않는다.
pub fn status(
    engine: Result<&FetchConfig, &str>,
    accounts_dir: Result<&Path, &SyncError>,
    name: Option<&str>,
) -> SyncStatus {
    let mut problems = Vec::new();
    let name = match validate_name(name.unwrap_or(DEFAULT_NAME)) {
        Ok(name) => Some(name),
        Err(e) => {
            problems.push(e.to_string());
            None
        }
    };
    let mut status = SyncStatus {
        name: name.clone().unwrap_or_default(),
        cookie_saved: false,
        cookie_saved_at: None,
        profile_fetched_at: None,
        account_file: None,
        login_window_open: false,
        problems: Vec::new(),
    };
    match engine {
        Ok(config) => {
            if !config.script().is_file() {
                problems.push(
                    SyncError::ScriptMissing {
                        path: config.script().display().to_string(),
                    }
                    .to_string(),
                );
            }
            problems.extend(python_problem(&config.python));
            let cookie = cookie_path(&config.engine_dir);
            status.cookie_saved = cookie.is_file();
            status.cookie_saved_at = modified_at(&cookie);
            if let Some(name) = &name {
                status.profile_fetched_at = modified_at(&profile_path(&config.engine_dir, name));
            }
        }
        Err(detail) => problems.push(detail.to_string()),
    }
    match accounts_dir {
        Ok(dir) => {
            if let Some(name) = &name {
                let file = dir.join(format!("{name}.json"));
                if file.is_file() {
                    status.account_file = Some(file.display().to_string());
                }
            }
        }
        Err(e) => problems.push(e.to_string()),
    }
    status.problems = problems;
    status
}

// ── 쿠키 저장 ─────────────────────────────────────────────────────────────────

/// 쿠키를 저장한 결과. 쿠키의 내용은 없다. 프런트의 `CookieSaved`(src/types.ts)와 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CookieSaved {
    /// 저장한 시각(ISO, UTC).
    pub saved_at: Option<String>,
    /// 저장한 쿠키의 수(이름=값 조각 수). 값은 싣지 않는다.
    pub count: usize,
}

/// 확인을 마친 쿠키를 엔진의 쿠키 파일에 쓴다. **앱이 쿠키를 쓰는 유일한 곳이다.**
fn write_cookie_file(engine_dir: &Path, cookie: &SessionCookie) -> Result<CookieSaved, SyncError> {
    // 엔진의 수집 스크립트 옆이 아니면 쓰지 않는다(엔진 폴더가 아닌 곳에 쿠키를 흘리지 않는다).
    let script = engine_dir.join(FETCH_SCRIPT);
    if !script.is_file() {
        return Err(SyncError::ScriptMissing {
            path: script.display().to_string(),
        });
    }
    let path = cookie_path(engine_dir);
    fs::write(&path, format!("{}\n", cookie.header())).map_err(|e| SyncError::CookieWrite {
        path: path.display().to_string(),
        detail: e.to_string(),
    })?;
    Ok(CookieSaved {
        saved_at: modified_at(&path),
        count: cookie.count(),
    })
}

/// 붙여넣은 쿠키를 정리해 엔진의 쿠키 파일에 쓴다. 필수 쿠키가 없으면 쓰지 않고 거부한다.
pub fn store_pasted_cookie(engine_dir: &Path, pasted: &str) -> Result<CookieSaved, SyncError> {
    let cookie = cookie::normalize_pasted(pasted)?;
    write_cookie_file(engine_dir, &cookie)
}

/// 로그인 창에서 읽은 쿠키를 Cookie 헤더 한 줄로 만들어 엔진의 쿠키 파일에 쓴다.
/// 필수 쿠키가 없으면(아직 로그인하지 않았다) 쓰지 않고 `CookieError::NotLoggedIn`으로 거부한다.
pub fn store_login_cookies(
    engine_dir: &Path,
    cookies: &[BrowserCookie],
) -> Result<CookieSaved, SyncError> {
    let cookie = cookie::header_from_browser_cookies(cookies, cookie::API_HOST)?;
    write_cookie_file(engine_dir, &cookie)
}

/// 수집 전에 쿠키 파일을 확인하고, 스크립트의 출력에서 그 값을 가릴 도구를 만든다.
/// 쿠키의 내용은 이 함수 밖으로 나가지 않는다.
fn cookie_redactor(engine_dir: &Path) -> Result<Redactor, SyncError> {
    let path = cookie_path(engine_dir);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(SyncError::CookieFileMissing)
        }
        Err(e) => {
            return Err(SyncError::CookieFileUnreadable {
                detail: e.kind().to_string(),
            })
        }
    };
    if !cookie::has_game_token(&text) {
        return Err(SyncError::CookieFileInvalid);
    }
    Ok(Redactor::for_cookie_text(&text))
}

// ── 프로필 수집 ───────────────────────────────────────────────────────────────

/// 프로필 수집의 결과. 프런트의 `FetchOutcome`(src/types.ts)과 같아야 한다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FetchOutcome {
    pub name: String,
    /// 스크립트가 쓴 프로필 파일.
    pub profile_path: String,
    /// 프로필 파일을 쓴 시각(ISO, UTC).
    pub fetched_at: Option<String>,
    /// 스크립트가 낸 모든 줄(표준 출력·표준 오류, 나온 순서대로, 쿠키 값은 가려져 있다).
    pub lines: Vec<FetchLine>,
    /// 그 가운데 경고 줄(`[!]`).
    pub warnings: Vec<String>,
    /// 걸린 시간(초).
    pub seconds: f64,
}

/// 스크립트가 끝난 방식.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchEnd {
    Exited { success: bool, code: Option<i32> },
    Stopped,
    TimedOut { seconds: u64 },
}

/// 스크립트의 출력에서 네트워크 오류를 알아보는 낱말(파이썬 예외 이름과 표준 문장).
const NETWORK_MARKS: [&str; 16] = [
    "URLError",
    "gaierror",
    "getaddrinfo failed",
    "TimeoutError",
    "timed out",
    "ConnectionResetError",
    "ConnectionRefusedError",
    "ConnectionAbortedError",
    "RemoteDisconnected",
    "IncompleteRead",
    "SSLError",
    "CERTIFICATE_VERIFY_FAILED",
    "Temporary failure in name resolution",
    "Network is unreachable",
    "No route to host",
    "\"msg\": \"HTTP ",
];

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(max).collect();
    cut.push('…');
    cut
}

/// 실패를 설명할 줄: 마지막 경고 줄, 없으면 마지막 줄.
fn last_meaningful(lines: &[FetchLine]) -> String {
    lines
        .iter()
        .rev()
        .find(|line| line.warning)
        .or_else(|| lines.last())
        .map_or_else(|| "출력이 없다".to_string(), |line| truncate(line.text.trim(), 300))
}

/// 스크립트가 끝난 방식과 낸 줄에서 실패의 종류를 가린다. 성공이면 `Ok`.
///
/// 스크립트의 문장(`vendor/nikke-calc/scraper/profile_fetch.py`)에 기대므로, 엔진을 올릴 때 함께 확인한다:
/// - `scraper/.session_cookie 없음` → 쿠키 파일 없음
/// - `game_token 이 없다` · `game_openid 없음` → 쿠키에 필수 값이 없음
/// - `로그인 세션 만료 (game not login)` → 세션 만료
/// - `캐릭터를 못 받았다. 세션 만료거나 비공개 계정` → 세션 만료이거나 비공개 계정(첫 요청이 거절된 경우 이 문장이 나온다)
/// - 파이썬의 네트워크 예외·HTTP 오류 → 네트워크 오류
pub fn classify(end: &FetchEnd, lines: &[FetchLine]) -> Result<(), SyncError> {
    let (success, code) = match end {
        FetchEnd::Stopped => return Err(SyncError::Stopped),
        FetchEnd::TimedOut { seconds } => return Err(SyncError::Timeout { seconds: *seconds }),
        FetchEnd::Exited { success, code } => (*success, *code),
    };
    if success {
        return Ok(());
    }
    let said = |needle: &str| lines.iter().any(|line| line.text.contains(needle));
    let network = NETWORK_MARKS.iter().any(|mark| said(mark));
    if said(".session_cookie 없음") {
        return Err(SyncError::CookieFileMissing);
    }
    if said("game_token 이 없다") || said("game_openid 없음") {
        return Err(SyncError::CookieFileInvalid);
    }
    if said("game not login") || said("로그인 세션 만료") {
        return Err(SyncError::SessionExpired { ambiguous: false });
    }
    if network {
        return Err(SyncError::Network {
            detail: last_meaningful(lines),
        });
    }
    if said("캐릭터를 못 받았다") {
        return Err(SyncError::SessionExpired { ambiguous: true });
    }
    Err(SyncError::ScriptFailed {
        code: code.map_or_else(|| "없음".to_string(), |c| c.to_string()),
        detail: last_meaningful(lines),
    })
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 스크립트의 출력(표준 출력과 표준 오류를 합친 것)을 줄 단위로 읽어, 쿠키 값을 가린 뒤에 모으고 알린다.
fn pump(
    stream: impl Read,
    redactor: &Redactor,
    sink: &Mutex<Vec<FetchLine>>,
    on_line: &(dyn Fn(&FetchLine) + Sync),
) {
    let mut reader = BufReader::new(stream);
    let mut raw = Vec::new();
    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&raw);
        let text = text.trim_end_matches(['\r', '\n']);
        if text.trim().is_empty() {
            continue;
        }
        // 가린 뒤에 자른다 — 먼저 자르면 잘린 쿠키 값의 앞부분이 남을 수 있다.
        let line = FetchLine::new(truncate(&redactor.redact(text), MAX_LINE_CHARS));
        let mut lines = lock(sink);
        match lines.len().cmp(&MAX_LINES) {
            std::cmp::Ordering::Less => {
                lines.push(line.clone());
                drop(lines);
                on_line(&line);
            }
            std::cmp::Ordering::Equal => {
                let notice = FetchLine::new(format!(
                    "(줄이 {MAX_LINES}개를 넘어 뒤의 출력은 보이지 않는다)"
                ));
                lines.push(notice.clone());
                drop(lines);
                on_line(&notice);
            }
            std::cmp::Ordering::Greater => {}
        }
    }
}

/// 엔진의 수집 스크립트(`scraper/profile_fetch.py --name <이름>`)를 실행한다.
///
/// - 실행하는 것은 `config.engine_dir`의 그 스크립트뿐이다. 호출하는 쪽이 정하는 것은 이름 하나다.
/// - 스크립트가 낸 줄(표준 출력·표준 오류)마다 `on_line`을 부른다. 쿠키 값은 가려져 있다.
/// - 시간 제한(`config.timeout`)을 넘기거나 `stop`이 켜지면 스크립트와 그 자식 프로세스까지 끝낸다
///   (엔진 계산 중단과 같은 방식 — Job Object).
/// - 실패는 종류를 가려 돌려준다(`classify`). 그때까지 나온 줄도 함께 간다.
pub fn fetch_profile(
    config: &FetchConfig,
    name: &str,
    on_line: &(dyn Fn(&FetchLine) + Sync),
    stop: &StopSignal,
) -> Result<FetchOutcome, SyncFailure> {
    let name = validate_name(name)?;
    let script = config.script();
    if !script.is_file() {
        return Err(SyncError::ScriptMissing {
            path: script.display().to_string(),
        }
        .into());
    }
    // 스크립트가 같은 확인을 하지만, 띄우기 전에 알 수 있는 것은 여기서 알린다.
    let redactor = cookie_redactor(&config.engine_dir)?;
    if stop.is_stopped() {
        return Err(SyncError::Stopped.into());
    }
    let profile = profile_path(&config.engine_dir, &name);
    let before = fs::metadata(&profile).and_then(|m| m.modified()).ok();

    // 표준 출력과 표준 오류를 파이프 하나로 받는다 — 스크립트가 낸 차례 그대로 줄이 온다
    // (경고는 표준 출력으로, 끝내는 오류 문장과 파이썬 오류 출력은 표준 오류로 나온다).
    let pipe_failed = |e: std::io::Error| SyncError::Io {
        detail: e.to_string(),
    };
    let (output, writer) = std::io::pipe().map_err(pipe_failed)?;
    let writer_for_errors = writer.try_clone().map_err(pipe_failed)?;
    let mut cmd = Command::new(&config.python);
    cmd.arg(&script)
        .arg("--name")
        .arg(&name)
        .current_dir(&config.engine_dir)
        // Windows 콘솔 기본 인코딩(cp949)이 아니라 UTF-8로 받고, 줄이 나오는 대로 받는다.
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(writer)
        .stderr(writer_for_errors);
    engine::hide_console(&mut cmd);
    let started = Instant::now();
    let spawned = cmd.spawn();
    // 쓰는 쪽 끝은 이제 스크립트만 쥔다 — 우리가 쥐고 있으면 스크립트가 끝나도 읽기가 끝나지 않는다.
    drop(cmd);
    let mut child = spawned.map_err(|e| SyncError::Spawn {
        python: config.python.clone(),
        detail: e.to_string(),
    })?;
    let group = ProcessGroup::adopt(&child);
    let deadline = started + config.timeout;
    let sink: Mutex<Vec<FetchLine>> = Mutex::new(Vec::new());

    let end: Result<FetchEnd, SyncError> = thread::scope(|scope| {
        let (redactor, sink) = (&redactor, &sink);
        let reader = scope.spawn(move || pump(output, redactor, sink, on_line));
        let end = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(exit_of(status)),
                Ok(None) => {}
                Err(e) => {
                    break Err(SyncError::Io {
                        detail: e.to_string(),
                    })
                }
            }
            if stop.is_stopped() {
                break Ok(FetchEnd::Stopped);
            }
            if Instant::now() >= deadline {
                break Ok(FetchEnd::TimedOut {
                    seconds: config.timeout.as_secs(),
                });
            }
            thread::sleep(Duration::from_millis(15));
        };
        if !matches!(end, Ok(FetchEnd::Exited { .. })) {
            // 멈춘 스크립트와 그 자식을 남기지 않는다. 죽으면 파이프가 닫혀 읽는 쪽도 끝난다.
            engine::kill_engine(&mut child, &group);
        }
        let _ = reader.join();
        end
    });
    let lines = sink.into_inner().unwrap_or_else(|e| e.into_inner());
    let fail = |error: SyncError, lines: Vec<FetchLine>| SyncFailure::with_lines(&error, lines);
    let end = match end {
        Ok(end) => end,
        Err(e) => return Err(fail(e, lines)),
    };
    if let Err(e) = classify(&end, &lines) {
        return Err(fail(e, lines));
    }
    // 성공으로 끝났으면 프로필 파일이 이번에 쓰였어야 한다 — 옛 파일을 새로 받은 것처럼 넘기지 않는다.
    let after = fs::metadata(&profile)
        .ok()
        .filter(fs::Metadata::is_file)
        .and_then(|m| m.modified().ok());
    let written = match (before, after) {
        (_, None) => false,
        (None, Some(_)) => true,
        (Some(before), Some(after)) => after > before,
    };
    if !written {
        let error = SyncError::ProfileNotWritten {
            path: profile.display().to_string(),
        };
        return Err(fail(error, lines));
    }
    Ok(FetchOutcome {
        name,
        profile_path: profile.display().to_string(),
        fetched_at: after.and_then(iso),
        warnings: warnings_of(&lines),
        lines,
        seconds: started.elapsed().as_secs_f64(),
    })
}

fn exit_of(status: ExitStatus) -> FetchEnd {
    FetchEnd::Exited {
        success: status.success(),
        code: status.code(),
    }
}

// ── 받은 프로필 읽기 ──────────────────────────────────────────────────────────

fn read_json(path: &Path) -> Result<Value, SyncError> {
    let shown = path.display().to_string();
    let text = fs::read_to_string(path).map_err(|e| SyncError::ProfileUnreadable {
        path: shown.clone(),
        detail: e.to_string(),
    })?;
    serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text)).map_err(|e| {
        SyncError::ProfileInvalid {
            path: shown,
            detail: e.to_string(),
        }
    })
}

/// 수집 스크립트가 쓴 프로필과, 그것을 계정 상태로 바꿀 때 필요한 엔진의 오버로드 옵션 표를 읽는다:
/// `{path, profile, option_table}`. 변환은 화면 쪽의 `src/core/import-profile.mjs`가 한다.
///
/// 프로필의 `_meta.openid`(계정 식별자)는 변환에 쓰이지 않으므로 화면에 넘기지 않는다.
pub fn read_profile(engine_dir: &Path, name: &str) -> Result<Value, SyncError> {
    let name = validate_name(name)?;
    let path = profile_path(engine_dir, &name);
    let mut profile = read_json(&path)?;
    let Some(root) = profile.as_object_mut() else {
        return Err(SyncError::ProfileInvalid {
            path: path.display().to_string(),
            detail: "최상위가 객체가 아니다".to_string(),
        });
    };
    if let Some(meta) = root.get_mut("_meta").and_then(Value::as_object_mut) {
        meta.remove("openid");
    }
    let option_table = read_json(&engine_dir.join(OPTION_TABLE_FILE))?;
    Ok(json!({
        "path": path.display().to_string(),
        "profile": profile,
        "option_table": option_table,
    }))
}

// ── 계정 파일 저장 ────────────────────────────────────────────────────────────

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// 계정 파일을 둘 폴더: 환경 변수 `NIKKE_ACCOUNTS_DIR` → 저장소의 `data/accounts`.
pub fn resolve_accounts_dir(
    env: impl Fn(&str) -> Option<String>,
    search_from: &[PathBuf],
) -> Result<PathBuf, SyncError> {
    if let Some(dir) = non_empty(env(ENV_ACCOUNTS_DIR)) {
        return Ok(PathBuf::from(dir));
    }
    find_repo_root(search_from)
        .map(|root| ACCOUNTS_SUBDIR.iter().fold(root, |dir, part| dir.join(part)))
        .ok_or(SyncError::AccountsDirUnknown)
}

/// 이 프로세스의 기본 계정 폴더(실행 파일 위치와 현재 폴더에서 저장소를 찾는다).
pub fn default_accounts_dir() -> Result<PathBuf, SyncError> {
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
    resolve_accounts_dir(|name| std::env::var(name).ok(), &search_from)
}

/// 계정 파일을 쓴 결과. 프런트의 `SavedAccount`(src/types.ts)와 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SavedAccount {
    /// 쓴 계정 파일.
    pub path: String,
    /// 덮어쓰기 전에 남긴 옛 파일의 사본(`<이름>.json.bak`). 새로 만든 것이면 `None`.
    pub backup: Option<String>,
}

/// 계정 상태 문서를 `dir/<이름>.json`에 쓴다.
///
/// - 이름은 `validate_name`을 통과해야 한다 — 화면이 폴더 밖의 파일을 쓰게 할 수 없다.
/// - 같은 이름의 파일이 있으면 덮어쓰기 전에 `<이름>.json.bak`으로 한 벌 남긴다(손으로 고친 내용을 되찾을 수 있게).
/// - 임시 파일에 다 쓴 뒤에 이름을 바꾼다 — 쓰다가 죽어도 계정 파일이 반쪽이 되지 않는다.
pub fn save_account(dir: &Path, name: &str, account: &Value) -> Result<SavedAccount, SyncError> {
    let name = validate_name(name)?;
    let Some(doc) = account.as_object() else {
        return Err(SyncError::AccountInvalid {
            detail: "계정 문서는 객체여야 한다",
        });
    };
    if !doc.get("schema_version").is_some_and(Value::is_u64) {
        return Err(SyncError::AccountInvalid {
            detail: "schema_version이 없다",
        });
    }
    if !doc.get("nikkes").is_some_and(Value::is_object) {
        return Err(SyncError::AccountInvalid {
            detail: "nikkes가 없다",
        });
    }
    let path = dir.join(format!("{name}.json"));
    let shown = path.display().to_string();
    let io = |e: std::io::Error| SyncError::AccountWrite {
        path: shown.clone(),
        detail: e.to_string(),
    };
    let text = serde_json::to_string_pretty(account).map_err(|e| SyncError::AccountWrite {
        path: shown.clone(),
        detail: e.to_string(),
    })?;
    fs::create_dir_all(dir).map_err(io)?;
    let backup = if path.is_file() {
        let backup = dir.join(format!("{name}.json.bak"));
        fs::copy(&path, &backup).map_err(io)?;
        Some(backup.display().to_string())
    } else {
        None
    };
    let temp = dir.join(format!("{name}.json.tmp"));
    fs::write(&temp, format!("{text}\n")).map_err(io)?;
    if let Err(e) = fs::rename(&temp, &path) {
        let _ = fs::remove_file(&temp);
        return Err(io(e));
    }
    Ok(SavedAccount { path: shown, backup })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 테스트용 가짜 쿠키. 실제 계정의 값이 아니다.
    const TOKEN: &str = "FAKE-TOKEN-0a1b2c3d4e5f6071";
    const OPENID: &str = "11223344556677889900";

    fn fake_cookie() -> String {
        format!("game_token={TOKEN}; game_openid={OPENID}; game_gameid=29080")
    }

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    /// 수집 스크립트 자리만 있는 가짜 엔진 폴더. 스크립트는 실행하지 않는다.
    struct Dir(PathBuf);

    impl Dir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "nikke-companion-account-sync-{label}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("임시 폴더");
            Self(dir)
        }

        fn engine(label: &str) -> Self {
            let dir = Self::new(label);
            fs::create_dir_all(dir.0.join("scraper")).expect("scraper 폴더");
            fs::write(dir.0.join(FETCH_SCRIPT), "# 실행하지 않는 자리 표시\n").expect("스크립트");
            dir
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn line(text: &str) -> FetchLine {
        FetchLine::new(text.to_string())
    }

    fn exited(code: i32) -> FetchEnd {
        FetchEnd::Exited {
            success: code == 0,
            code: Some(code),
        }
    }

    #[test]
    fn names_are_file_safe_or_rejected() {
        for (given, expected) in [
            ("me", "me"),
            ("  부계 2  ", "부계 2"),
            ("alt_account-3", "alt_account-3"),
            ("본계", "본계"),
        ] {
            assert_eq!(validate_name(given).as_deref(), Ok(expected), "{given}");
        }
        for bad in [
            "",
            "   ",
            "..",
            "../밖",
            "..\\밖",
            "a/b",
            "a\\b",
            "C:me",
            "me.json",
            ".hidden",
            "a\0b",
            "a\nb",
            "-rf",
            "--out=x",
            "a*b",
            "a?b",
            "con",
            "NUL",
            "LPT1",
            "%APPDATA%",
            "$HOME",
            "a;b",
            "a\"b",
        ] {
            let err = validate_name(bad).expect_err(bad);
            assert!(matches!(err, SyncError::NameInvalid { .. }), "{bad}: {err:?}");
            assert!(has_korean(&err.to_string()));
        }
        assert!(validate_name(&"가".repeat(MAX_NAME_CHARS)).is_ok());
        assert!(validate_name(&"가".repeat(MAX_NAME_CHARS + 1)).is_err());
    }

    #[test]
    fn pasted_cookie_is_written_to_the_engine_cookie_file_only() {
        let engine = Dir::engine("paste");
        let saved = store_pasted_cookie(&engine.0, &format!("\r\n  Cookie: {}  \r\n", fake_cookie()))
            .expect("저장");
        assert_eq!(saved.count, 3);
        assert!(saved.saved_at.is_some());
        // 파일에는 한 줄로 정리된 쿠키가 있다(수집 스크립트가 읽는 모양).
        let written = fs::read_to_string(cookie_path(&engine.0)).expect("쿠키 파일");
        assert_eq!(written, format!("{}\n", fake_cookie()));
        // 쿠키가 든 파일은 그 하나뿐이다.
        let mut holding = Vec::new();
        let mut stack = vec![engine.0.clone()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).expect("폴더").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if fs::read_to_string(&path).is_ok_and(|t| t.contains(TOKEN)) {
                    holding.push(path);
                }
            }
        }
        assert_eq!(holding, vec![cookie_path(&engine.0)]);
        // 반환값에는 쿠키가 없다.
        let returned = serde_json::to_string(&saved).expect("직렬화");
        assert!(!returned.contains(TOKEN) && !returned.contains(OPENID), "{returned}");
        assert!(!format!("{saved:?}").contains(TOKEN));
    }

    #[test]
    fn a_rejected_cookie_is_not_written_and_the_error_does_not_show_it() {
        let engine = Dir::engine("reject");
        for pasted in [
            format!("game_token={TOKEN}; lang=ko"),
            format!("game_openid={OPENID}"),
            format!("{}; 메모=한글", fake_cookie()),
            String::new(),
        ] {
            let err = store_pasted_cookie(&engine.0, &pasted).expect_err("거부");
            assert_eq!(err.kind(), "cookie_rejected");
            assert!(err.needs_cookie());
            let failure = SyncFailure::from(err.clone());
            for shown in [
                err.to_string(),
                format!("{err:?}"),
                serde_json::to_string(&failure).expect("직렬화"),
            ] {
                assert!(!shown.contains(TOKEN) && !shown.contains(OPENID), "{shown}");
            }
            assert!(has_korean(&failure.message));
            assert!(failure.cookie_help);
        }
        assert!(!cookie_path(&engine.0).exists(), "거부한 쿠키를 쓰면 안 된다");
    }

    #[test]
    fn cookies_are_not_written_into_a_folder_without_the_fetch_script() {
        let not_engine = Dir::new("not-engine");
        let err = store_pasted_cookie(&not_engine.0, &fake_cookie()).expect_err("거부");
        assert!(matches!(err, SyncError::ScriptMissing { .. }), "{err:?}");
        assert!(!err.to_string().contains(TOKEN));
        assert_eq!(fs::read_dir(&not_engine.0).expect("폴더").count(), 0);
    }

    #[test]
    fn login_window_cookies_take_the_same_path_as_pasted_ones() {
        let engine = Dir::engine("login");
        let cookie = |name: &str, value: &str, domain: &str| BrowserCookie {
            name: name.to_string(),
            value: value.to_string(),
            domain: Some(domain.to_string()),
        };
        // 로그인 전: 필수 쿠키가 없다 — 쓰지 않고 「아직 로그인되지 않았다」.
        let before = [cookie("lang", "ko", ".blablalink.com")];
        let err = store_login_cookies(&engine.0, &before).expect_err("로그인 전");
        assert_eq!(err.kind(), "not_logged_in");
        assert!(err.to_string().contains("아직 로그인되지 않았다"), "{err}");
        assert!(!cookie_path(&engine.0).exists());

        // 로그인 뒤: API 요청에 실릴 쿠키만 한 줄로 쓴다.
        let after = [
            cookie("game_token", TOKEN, ".blablalink.com"),
            cookie("other_site", "tracking-value-123456", ".example.com"),
            cookie("game_openid", OPENID, ".blablalink.com"),
            cookie("game_gameid", "29080", "api.blablalink.com"),
        ];
        let saved = store_login_cookies(&engine.0, &after).expect("저장");
        assert_eq!(saved.count, 3);
        assert_eq!(
            fs::read_to_string(cookie_path(&engine.0)).expect("쿠키 파일"),
            format!("{}\n", fake_cookie())
        );
        let returned = serde_json::to_string(&saved).expect("직렬화");
        assert!(!returned.contains(TOKEN) && !returned.contains(OPENID), "{returned}");
        // 붙여넣기로 같은 쿠키를 넣은 것과 파일이 같다 — 그 뒤의 수집은 어느 길로 받았는지 모른다.
        let pasted = Dir::engine("login-paste");
        store_pasted_cookie(&pasted.0, &fake_cookie()).expect("저장");
        assert_eq!(
            fs::read(cookie_path(&pasted.0)).expect("쿠키 파일"),
            fs::read(cookie_path(&engine.0)).expect("쿠키 파일")
        );
    }

    #[test]
    fn status_reports_files_without_reading_them() {
        let engine = Dir::engine("status");
        let accounts = Dir::new("status-accounts");
        let config = FetchConfig {
            engine_dir: engine.0.clone(),
            python: std::env::var(engine::ENV_PYTHON).unwrap_or_else(|_| "python".to_string()),
            timeout: DEFAULT_FETCH_TIMEOUT,
        };
        let fresh = status(Ok(&config), Ok(&accounts.0), None);
        assert_eq!(fresh.name, DEFAULT_NAME);
        assert!(!fresh.cookie_saved);
        assert_eq!(fresh.cookie_saved_at, None);
        assert_eq!(fresh.profile_fetched_at, None);
        assert_eq!(fresh.account_file, None);
        assert_eq!(fresh.problems, Vec::<String>::new());

        store_pasted_cookie(&engine.0, &fake_cookie()).expect("저장");
        fs::create_dir_all(engine.0.join(PROFILES_SUBDIR)).expect("profiles");
        fs::write(profile_path(&engine.0, "부계"), "{}").expect("프로필");
        fs::write(accounts.0.join("부계.json"), "{}").expect("계정");
        let filled = status(Ok(&config), Ok(&accounts.0), Some(" 부계 "));
        assert_eq!(filled.name, "부계");
        assert!(filled.cookie_saved);
        assert!(filled.cookie_saved_at.as_deref().is_some_and(|t| t.ends_with('Z')));
        assert!(filled.profile_fetched_at.is_some());
        assert_eq!(
            filled.account_file,
            Some(accounts.0.join("부계.json").display().to_string())
        );
        // 상태에는 쿠키의 내용이 없다.
        let shown = serde_json::to_string(&filled).expect("직렬화");
        assert!(!shown.contains(TOKEN) && !shown.contains(OPENID), "{shown}");
        // 다른 이름의 프로필·계정은 없다.
        let other = status(Ok(&config), Ok(&accounts.0), Some("me"));
        assert_eq!((other.profile_fetched_at, other.account_file), (None, None));
    }

    #[test]
    fn status_lists_engine_python_and_name_problems() {
        let engine = Dir::new("status-broken");
        let config = FetchConfig {
            engine_dir: engine.0.clone(),
            python: "nikke-companion-없는-python".to_string(),
            timeout: DEFAULT_FETCH_TIMEOUT,
        };
        let unknown = SyncError::AccountsDirUnknown;
        let broken = status(Ok(&config), Err(&unknown), Some("../밖"));
        assert_eq!(broken.name, "");
        assert_eq!(broken.problems.len(), 4, "{:?}", broken.problems);
        assert!(broken.problems[0].contains("계정 이름을 쓸 수 없다"));
        assert!(broken.problems[1].contains(FETCH_SCRIPT));
        assert!(broken.problems[2].contains("nikke-companion-없는-python"));
        assert!(broken.problems[3].contains(ENV_ACCOUNTS_DIR));
        let no_engine = status(Err("엔진 폴더(vendor/nikke-calc)를 찾을 수 없다"), Ok(&engine.0), None);
        assert_eq!(no_engine.problems, vec!["엔진 폴더(vendor/nikke-calc)를 찾을 수 없다".to_string()]);
        assert!(!no_engine.cookie_saved);
    }

    #[test]
    fn failures_are_told_apart_by_what_the_script_said() {
        let cases: [(&[&str], i32, &str, bool); 9] = [
            (
                &["[!] scraper/.session_cookie 없음 — 최초 로그인으로 쿠키를 넣어라 (.agent/skills/profile-sync/SKILL.md §쿠키 확보)."],
                1,
                "cookie_missing",
                true,
            ),
            (
                &["[!] .session_cookie 에 game_token 이 없다 — 로그인 세션 쿠키 전체를 넣어라."],
                1,
                "cookie_invalid",
                true,
            ),
            (&["[!] 쿠키에 game_openid 없음 — --openid 로 직접 지정하라."], 1, "cookie_invalid", true),
            (
                &[
                    "[+] openid (가림) (area 83): 캐릭터 121종",
                    "[!] GetUserCharacterDetails: 로그인 세션 만료 (game not login). 쿠키를 다시 받아라.",
                ],
                1,
                "session_expired",
                true,
            ),
            (
                &["[!] openid (가림): 캐릭터를 못 받았다. 세션 만료거나 비공개 계정."],
                1,
                "session_expired",
                true,
            ),
            (
                &[
                    "Traceback (most recent call last):",
                    "urllib.error.URLError: <urlopen error [Errno 11001] getaddrinfo failed>",
                ],
                1,
                "network",
                false,
            ),
            (
                &["[!] GetUserCharacterDetails 실패: {\"code\": 502, \"msg\": \"HTTP 502\", \"_raw\": \"Bad Gateway\"}"],
                1,
                "network",
                false,
            ),
            (&["TimeoutError: The read operation timed out"], 1, "network", false),
            (&["KeyError: 'character_details'"], 1, "script_failed", false),
        ];
        for (texts, code, kind, cookie_help) in cases {
            let lines: Vec<FetchLine> = texts.iter().map(|t| line(t)).collect();
            let err = classify(&exited(code), &lines).expect_err(kind);
            assert_eq!(err.kind(), kind, "{texts:?}");
            assert_eq!(err.needs_cookie(), cookie_help, "{texts:?}");
            assert!(has_korean(&err.to_string()), "{err}");
        }
        assert_eq!(classify(&exited(0), &[line("[!] 경고가 있어도 성공은 성공이다")]), Ok(()));
        assert_eq!(classify(&FetchEnd::Stopped, &[]), Err(SyncError::Stopped));
        assert_eq!(
            classify(&FetchEnd::TimedOut { seconds: 600 }, &[line("[+] 상세 수집 중…")]),
            Err(SyncError::Timeout { seconds: 600 })
        );
        // 중단·시간 초과는 스크립트가 무엇을 말했든 그것이 답이다.
        assert_eq!(
            classify(&FetchEnd::Stopped, &[line("로그인 세션 만료 (game not login)")]),
            Err(SyncError::Stopped)
        );
        // 세션 만료가 분명하면 네트워크 낱말이 섞여 있어도 세션 만료다.
        let both = [line("TimeoutError: timed out"), line("[!] X: 로그인 세션 만료 (game not login).")];
        assert_eq!(classify(&exited(1), &both), Err(SyncError::SessionExpired { ambiguous: false }));
        // 「캐릭터를 못 받았다」에 네트워크 오류가 함께 있으면 네트워크 오류다.
        let net = [line("urllib.error.URLError: <urlopen error timed out>"), line("[!] openid: 캐릭터를 못 받았다. 세션 만료거나 비공개 계정.")];
        assert_eq!(classify(&exited(1), &net).expect_err("네트워크").kind(), "network");
    }

    #[test]
    fn every_failure_is_korean_and_cookie_failures_ask_for_a_new_cookie() {
        let all = [
            SyncError::Engine { detail: "엔진 폴더가 아니다".into() },
            SyncError::ScriptMissing { path: "D:\\x".into() },
            SyncError::NameInvalid { reason: "이름이 비어 있다" },
            SyncError::Cookie(CookieError::Empty),
            SyncError::Cookie(CookieError::NotLoggedIn { missing: vec!["game_token"] }),
            SyncError::CookieFileMissing,
            SyncError::CookieFileInvalid,
            SyncError::CookieFileUnreadable { detail: "permission denied".into() },
            SyncError::CookieWrite { path: "c".into(), detail: "os error 5".into() },
            SyncError::SessionExpired { ambiguous: false },
            SyncError::SessionExpired { ambiguous: true },
            SyncError::Network { detail: "URLError".into() },
            SyncError::Timeout { seconds: 600 },
            SyncError::Stopped,
            SyncError::Busy,
            SyncError::Spawn { python: "python".into(), detail: "not found".into() },
            SyncError::Io { detail: "broken pipe".into() },
            SyncError::ScriptFailed { code: "1".into(), detail: "KeyError".into() },
            SyncError::ProfileNotWritten { path: "p.json".into() },
            SyncError::ProfileUnreadable { path: "p.json".into(), detail: "os error 2".into() },
            SyncError::ProfileInvalid { path: "p.json".into(), detail: "EOF".into() },
            SyncError::AccountsDirUnknown,
            SyncError::AccountInvalid { detail: "nikkes가 없다" },
            SyncError::AccountWrite { path: "a.json".into(), detail: "os error 5".into() },
            SyncError::LoginWindowClosed,
            SyncError::LoginWindow { detail: "창을 만들지 못했다".into() },
        ];
        let cookie_kinds = ["cookie_rejected", "not_logged_in", "cookie_missing", "cookie_invalid", "session_expired"];
        for e in all {
            assert!(has_korean(&e.to_string()), "{e:?}");
            assert_eq!(e.needs_cookie(), cookie_kinds.contains(&e.kind()), "{e:?}");
            let failure = SyncFailure::from(e.clone());
            assert_eq!((failure.kind, failure.cookie_help), (e.kind(), e.needs_cookie()));
            assert_eq!(failure.message, e.to_string());
        }
        assert!(SyncError::Stopped.to_string().starts_with(STOPPED_PREFIX));
    }

    #[test]
    fn warning_lines_are_the_ones_the_script_marks() {
        let lines = [
            line("[+] 프로필 저장: profiles/me.json  (121종)"),
            line("[!] 애장품 단계 3 미만 2명"),
            line("    이름매핑 실패 name_code(신캐·미수집 가능): [9999]"),
            line("  [!] 들여 쓴 경고"),
        ];
        assert_eq!(
            lines.iter().map(|l| l.warning).collect::<Vec<_>>(),
            vec![false, true, false, true]
        );
        assert_eq!(
            warnings_of(&lines),
            vec!["[!] 애장품 단계 3 미만 2명".to_string(), "[!] 들여 쓴 경고".to_string()]
        );
    }

    #[test]
    fn fetch_refuses_before_starting_when_it_cannot_work() {
        let quiet = |_: &FetchLine| {};
        let engine = Dir::engine("pre");
        // 없는 python이다 — 띄우려 했다면 Spawn 오류가 난다.
        let config = FetchConfig {
            engine_dir: engine.0.clone(),
            python: "nikke-companion-없는-python".to_string(),
            timeout: DEFAULT_FETCH_TIMEOUT,
        };
        let stop = StopSignal::new();
        assert_eq!(fetch_profile(&config, "../밖", &quiet, &stop).expect_err("이름").kind, "name");
        let missing = fetch_profile(&config, "me", &quiet, &stop).expect_err("쿠키 없음");
        assert_eq!((missing.kind, missing.cookie_help), ("cookie_missing", true));

        fs::write(cookie_path(&engine.0), format!("game_openid={OPENID}\n")).expect("쿠키");
        let invalid = fetch_profile(&config, "me", &quiet, &stop).expect_err("game_token 없음");
        assert_eq!((invalid.kind, invalid.cookie_help), ("cookie_invalid", true));
        assert!(!serde_json::to_string(&invalid).expect("직렬화").contains(OPENID));

        store_pasted_cookie(&engine.0, &fake_cookie()).expect("저장");
        let spawn = fetch_profile(&config, "me", &quiet, &stop).expect_err("python 없음");
        assert_eq!(spawn.kind, "engine");
        assert!(spawn.message.contains("수집 스크립트를 실행할 수 없다"), "{}", spawn.message);
        stop.stop();
        assert_eq!(fetch_profile(&config, "me", &quiet, &stop).expect_err("중단").kind, "stopped");

        let no_script = Dir::new("pre-no-script");
        let config = FetchConfig { engine_dir: no_script.0.clone(), ..config };
        let err = fetch_profile(&config, "me", &quiet, &StopSignal::new()).expect_err("스크립트 없음");
        assert_eq!(err.kind, "engine");
        assert!(err.message.contains(FETCH_SCRIPT));
    }

    #[test]
    fn reading_a_profile_hands_over_what_the_conversion_needs_but_not_the_openid() {
        let engine = Dir::engine("read");
        fs::create_dir_all(engine.0.join(PROFILES_SUBDIR)).expect("profiles");
        fs::create_dir_all(engine.0.join("data/base_stat_tables")).expect("표 폴더");
        fs::write(
            profile_path(&engine.0, "me"),
            format!("\u{feff}{{\"_meta\": {{\"name\": \"me\", \"openid\": \"{OPENID}\", \"fetched_at\": \"2026-11-12T15:01:00+09:00\"}}, \"chars\": {{\"크라운\": {{}}}}}}"),
        )
        .expect("프로필");
        fs::write(engine.0.join(OPTION_TABLE_FILE), "{\"atk_pct\": {\"template\": \"공격력 {0}% 증가\", \"values\": [0.0477]}}").expect("옵션 표");

        let read = read_profile(&engine.0, " me ").expect("읽기");
        assert_eq!(read["path"], profile_path(&engine.0, "me").display().to_string());
        assert_eq!(read["profile"]["_meta"]["name"], "me");
        assert_eq!(read["profile"]["_meta"]["fetched_at"], "2026-11-12T15:01:00+09:00");
        assert!(read["profile"]["chars"]["크라운"].is_object());
        assert_eq!(read["option_table"]["atk_pct"]["values"][0], 0.0477);
        assert!(!read.to_string().contains(OPENID), "openid는 화면에 넘기지 않는다");

        assert!(matches!(read_profile(&engine.0, "없는이름"), Err(SyncError::ProfileUnreadable { .. })));
        assert!(matches!(read_profile(&engine.0, "../me"), Err(SyncError::NameInvalid { .. })));
        fs::write(profile_path(&engine.0, "깨진"), "[1, 2").expect("프로필");
        assert!(matches!(read_profile(&engine.0, "깨진"), Err(SyncError::ProfileInvalid { .. })));
        fs::write(profile_path(&engine.0, "배열"), "[1, 2]").expect("프로필");
        assert!(matches!(read_profile(&engine.0, "배열"), Err(SyncError::ProfileInvalid { .. })));
    }

    #[test]
    fn accounts_folder_comes_from_the_environment_or_the_repository() {
        let env = |name: &str| (name == ENV_ACCOUNTS_DIR).then(|| "  D:\\계정  ".to_string());
        assert_eq!(resolve_accounts_dir(env, &[]), Ok(PathBuf::from("D:\\계정")));
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let found = resolve_accounts_dir(|_| None, &[manifest.join("target/debug")]).expect("저장소 안");
        assert!(found.ends_with("data/accounts"), "{}", found.display());
        assert!(found.parent().and_then(Path::parent).is_some_and(|root| root.join("app/src-tauri/Cargo.toml").is_file()));
        assert_eq!(
            resolve_accounts_dir(|_| Some("  ".to_string()), &[std::env::temp_dir()]),
            Err(SyncError::AccountsDirUnknown)
        );
    }

    #[test]
    fn saving_an_account_backs_up_the_file_it_replaces() {
        let dir = Dir::new("save");
        let accounts = dir.0.join("accounts");
        let first = json!({ "schema_version": 1, "is_test_data": true, "name": "부계", "nikkes": { "크라운": { "breakthrough": 3 } } });
        let saved = save_account(&accounts, " 부계 ", &first).expect("저장");
        let path = accounts.join("부계.json");
        assert_eq!(saved, SavedAccount { path: path.display().to_string(), backup: None });
        let text = fs::read_to_string(&path).expect("계정 파일");
        assert!(text.ends_with("}\n"));
        assert!(text.contains("\n  \"schema_version\": 1"), "두 칸 들여쓰기: {text}");
        assert_eq!(serde_json::from_str::<Value>(&text).expect("JSON"), first);
        // 키 순서는 화면이 넘긴 그대로다.
        assert!(text.find("schema_version").expect("칸") < text.find("nikkes").expect("칸"));

        // 손으로 고친 파일을 덮어쓰기 전에 한 벌 남긴다.
        fs::write(&path, "{\"손으로\": \"고친 내용\"}").expect("고치기");
        let second = json!({ "schema_version": 1, "nikkes": {} });
        let saved = save_account(&accounts, "부계", &second).expect("덮어쓰기");
        let backup = accounts.join("부계.json.bak");
        assert_eq!(saved.backup, Some(backup.display().to_string()));
        assert_eq!(fs::read_to_string(&backup).expect("사본"), "{\"손으로\": \"고친 내용\"}");
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(&path).expect("계정 파일")).expect("JSON"), second);
        // 다시 덮어쓰면 사본은 바로 앞의 것이다. 임시 파일은 남지 않는다.
        save_account(&accounts, "부계", &first).expect("덮어쓰기");
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(&backup).expect("사본")).expect("JSON"), second);
        let mut names: Vec<String> = fs::read_dir(&accounts)
            .expect("폴더")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["부계.json".to_string(), "부계.json.bak".to_string()]);
    }

    #[test]
    fn an_account_cannot_be_saved_outside_the_folder_or_in_another_shape() {
        let dir = Dir::new("save-bad");
        let accounts = dir.0.join("accounts");
        let account = json!({ "schema_version": 1, "nikkes": {} });
        for name in ["../밖", "..", "a/b", "a\\b", "C:x", "me.json", "", "NUL"] {
            let err = save_account(&accounts, name, &account).expect_err(name);
            assert!(matches!(err, SyncError::NameInvalid { .. }), "{name}: {err:?}");
        }
        for bad in [json!([1]), json!("x"), json!({ "nikkes": {} }), json!({ "schema_version": 1 }), json!({ "schema_version": "1", "nikkes": {} }), json!({ "schema_version": 1, "nikkes": [] })] {
            let err = save_account(&accounts, "me", &bad).expect_err("형식");
            assert_eq!(err.kind(), "account_file");
        }
        // 거부한 것은 아무것도 쓰지 않는다 — 폴더도 만들지 않는다.
        assert!(!accounts.exists());
        assert_eq!(fs::read_dir(&dir.0).expect("폴더").count(), 0);
    }
}
