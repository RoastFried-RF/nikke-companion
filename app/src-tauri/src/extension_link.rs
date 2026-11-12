//! 크롬 확장 연결 — 이 PC의 크롬 확장(저장소의 `extension/`)이 넘기는 세션 쿠키를 받는 작은 수신부.
//!
//! 이미 로그인된 브라우저의 세션을 단추 한 번으로 넘겨받는다(P-025). 확장이 `api.blablalink.com` 요청에 실릴 쿠키로
//! 만든 Cookie 헤더 한 줄을 이 수신부에 보내면, 붙여넣기와 같은 정리·검사(`cookie::normalize_pasted`)를 거쳐 엔진의
//! 쿠키 파일에 쓰고, 화면이 「계정 새로 받기」를 이어서 돌린다.
//!
//! **세션 쿠키는 계정 접근권이다.** 이 모듈의 규칙:
//! - 듣는 곳은 **루프백(127.0.0.1) 하나**다 — 다른 PC에서는 닿을 수 없다. 켰을 때만 열리고, 끄거나 앱이 끝나면 닫힌다.
//! - 밖으로 나가는 연결을 만들지 않는다. 이 모듈이 하는 것은 듣기와, 들어온 연결에 답하기뿐이다.
//! - 받는 요청은 하나다: `POST /nikke-companion/v1/session`, `Content-Type: application/json`, 정해진 크기 안,
//!   본문 `{"code": "...", "cookie": "..."}`. 그 밖은 거부한다.
//! - **웹 페이지는 부르지 못한다**: 출처(`Origin`)가 크롬 확장(`chrome-extension://…`)이 아니면 거부하고, 어떤 답에도
//!   다른 출처 허용 헤더(`Access-Control-Allow-*`)를 싣지 않는다(브라우저의 사전 요청은 실패한다). `Host`가 이 수신부의
//!   주소가 아니어도 거부한다.
//! - 연결 코드가 맞는 요청만 받는다. 틀리면 거부하고, 여러 번 틀리면 잠시 모든 요청을 막는다.
//! - 쿠키 값은 답·오류·상태·이벤트 어디에도 넣지 않는다. 답은 정해진 낱말(성공·실패와 사유)뿐이고, 본문을 읽다 난
//!   오류의 문장도 쓰지 않는다(값이 섞여 나올 수 있다). 쿠키를 쓰는 곳은 P-022와 같은 한 곳이다
//!   (`account_sync::store_pasted_cookie` → 엔진의 `scraper/.session_cookie`).
//! - 이 모듈은 아무것도 출력하지 않는다(표준 출력·표준 오류).
//!
//! 연결 코드는 쿠키가 아니다 — 화면에 보이고 설정 파일(`extension-link.json`)에 적힌다.

use std::fmt;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::account_sync::{self, SyncError};
use crate::capture;
use crate::cookie::{CookieError, MASK};

/// 수신부가 듣는 포트. 확장(`extension/lib/link.js`의 `OVERLAY_PORT`)과 같아야 한다.
pub const DEFAULT_PORT: u16 = 47615;
/// 받는 경로. 확장의 `SESSION_PATH`와 같아야 한다.
pub const SESSION_PATH: &str = "/nikke-companion/v1/session";
/// 받는 출처의 머리. 크로뮴 계열 브라우저의 확장은 모두 이 꼴이다(뒤에 확장 ID 32자).
pub const EXTENSION_ORIGIN: &str = "chrome-extension://";
/// 받는 본문의 형식.
pub const CONTENT_TYPE: &str = "application/json";
/// 요청 머리(요청 줄 + 헤더)의 최대 크기.
pub const MAX_HEAD_BYTES: usize = 8 * 1024;
/// 본문의 최대 크기. 쿠키 헤더는 16KiB까지다(`cookie::MAX_COOKIE_CHARS`) — 그것과 코드·JSON 껍데기가 들어갈 만큼.
pub const MAX_BODY_BYTES: usize = 32 * 1024;
/// 연결 하나를 읽는 데 쓰는 시간의 상한. 넘으면 끊는다.
pub const REQUEST_DEADLINE: Duration = Duration::from_secs(3);
/// 연속으로 이만큼 코드를 틀리면 잠시 막는다.
pub const MAX_WRONG_CODES: u32 = 5;
/// 막아 두는 시간.
pub const LOCK_FOR: Duration = Duration::from_secs(60);
/// 연결 코드에 쓰는 글자 32개. 헷갈리는 I·O·0·1은 없다. 확장의 `CODE_ALPHABET`과 같아야 한다.
pub const CODE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/// 연결 코드의 글자 수(32^8 ≈ 1조 가지 — 1분에 다섯 번만 시도할 수 있다).
pub const CODE_CHARS: usize = 8;
/// 켜짐 여부와 연결 코드를 기억하는 파일 이름. 앱 설정 폴더(`%APPDATA%/<identifier>`)에 둔다. 쿠키는 적지 않는다.
pub const SETTINGS_FILE: &str = "extension-link.json";

/// 들어온 연결이 없을 때 다시 볼 때까지 쉬는 시간(끄기 요청도 이 간격으로 본다).
const ACCEPT_POLL: Duration = Duration::from_millis(25);
/// 답을 쓰는 데 쓰는 시간의 상한.
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);
/// 답을 쓴 뒤 상대가 보내던 나머지를 받아 버리는 시간·크기의 상한(받지 않고 닫으면 상대가 답을 못 읽을 수 있다).
const DRAIN_FOR: Duration = Duration::from_millis(200);
const DRAIN_BYTES: usize = 256 * 1024;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // 다른 스레드가 잠근 채 죽었어도 상태 값 자체는 쓸 수 있다.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ── 오류 ─────────────────────────────────────────────────────────────────────

/// 수신부를 열지 못한 이유.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// 그 포트를 다른 프로그램이 쓰고 있다.
    PortInUse { port: u16 },
    Bind { port: u16, detail: String },
    Thread { detail: String },
    /// 연결 코드에 쓸 무작위 값을 얻지 못했다.
    Random { detail: String },
}

impl fmt::Display for LinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PortInUse { port } => write!(
                f,
                "크롬 확장 연결을 열지 못했다: 127.0.0.1:{port}를 다른 프로그램이 쓰고 있다 — 그 프로그램을 끄고 다시 켜라"
            ),
            Self::Bind { port, detail } => {
                write!(f, "크롬 확장 연결을 열지 못했다(127.0.0.1:{port}): {detail}")
            }
            Self::Thread { detail } => write!(f, "크롬 확장 연결을 시작하지 못했다: {detail}"),
            Self::Random { detail } => write!(f, "연결 코드를 만들지 못했다: {detail}"),
        }
    }
}

impl std::error::Error for LinkError {}

// ── 연결 코드 ─────────────────────────────────────────────────────────────────

/// 연결 코드. 오버레이가 무작위로 만들어 계정 화면에 보이고, 사용자가 확장에 한 번 넣는다. 쿠키가 아니다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkCode(String);

impl LinkCode {
    /// 무작위 바이트 여덟 개로 만든다(바이트마다 아래 5비트 — 32글자 가운데 하나, 치우침이 없다).
    pub fn from_random(bytes: [u8; CODE_CHARS]) -> Self {
        Self(
            bytes
                .iter()
                .map(|b| char::from(CODE_ALPHABET[usize::from(b & 31)]))
                .collect(),
        )
    }

    /// 운영체제의 난수로 새 코드를 만든다.
    pub fn generate() -> Result<Self, LinkError> {
        let mut bytes = [0u8; CODE_CHARS];
        getrandom::fill(&mut bytes).map_err(|e| LinkError::Random {
            detail: e.to_string(),
        })?;
        Ok(Self::from_random(bytes))
    }

    /// 사람이 넣은 글자를 코드로: 공백·붙임표를 빼고 대문자로 본다. 모양이 맞지 않으면 `None`.
    pub fn parse(text: &str) -> Option<Self> {
        let raw: String = text
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .map(|c| c.to_ascii_uppercase())
            .collect();
        (raw.len() == CODE_CHARS && raw.bytes().all(|b| CODE_ALPHABET.contains(&b)))
            .then_some(Self(raw))
    }

    /// 화면에 보이는 모양(`ABCD-EFGH`).
    pub fn shown(&self) -> String {
        format!("{}-{}", &self.0[..4], &self.0[4..])
    }

    /// 받은 글자가 이 코드인가. 어디서 틀렸는지에 따라 걸리는 시간이 달라지지 않게 끝까지 견준다.
    pub fn matches(&self, given: &str) -> bool {
        let Some(given) = Self::parse(given) else {
            return false;
        };
        self.0
            .bytes()
            .zip(given.0.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
    }
}

/// 코드를 견준 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeCheck {
    Right,
    Wrong,
    /// 여러 번 틀려 막혀 있다(코드가 맞아도 받지 않는다).
    Locked { seconds: u64 },
}

/// 연결 코드와 틀린 횟수. 수신부 스레드와 화면 명령이 함께 본다.
#[derive(Debug)]
pub struct Gate(Mutex<GateInner>);

#[derive(Debug)]
struct GateInner {
    /// 코드를 만들지 못했으면 `None` — 어떤 요청도 받지 않는다.
    code: Option<LinkCode>,
    wrong: u32,
    locked_until: Option<Instant>,
}

impl Gate {
    pub fn new(code: Option<LinkCode>) -> Self {
        Self(Mutex::new(GateInner {
            code,
            wrong: 0,
            locked_until: None,
        }))
    }

    pub fn code(&self) -> Option<LinkCode> {
        lock(&self.0).code.clone()
    }

    /// 코드를 바꾼다. 옛 코드는 그 순간부터 받지 않고, 틀린 횟수와 막힘은 처음으로 돌아간다.
    pub fn replace_code(&self, code: LinkCode) {
        let mut inner = lock(&self.0);
        inner.code = Some(code);
        inner.wrong = 0;
        inner.locked_until = None;
    }

    /// 연속으로 틀린 횟수.
    pub fn wrong(&self) -> u32 {
        lock(&self.0).wrong
    }

    /// 막힘이 풀릴 때까지 남은 시간(초, 올림). 막혀 있지 않으면 0.
    pub fn locked_seconds(&self, now: Instant) -> u64 {
        lock(&self.0)
            .locked_until
            .and_then(|until| until.checked_duration_since(now))
            .map_or(0, ceil_seconds)
    }

    /// 받은 코드를 견준다. 틀리면 횟수를 세고, `MAX_WRONG_CODES`번째에 `LOCK_FOR` 동안 막는다.
    pub fn check(&self, given: &str, now: Instant) -> CodeCheck {
        let mut inner = lock(&self.0);
        if let Some(until) = inner.locked_until {
            match until.checked_duration_since(now).filter(|left| !left.is_zero()) {
                Some(left) => {
                    return CodeCheck::Locked {
                        seconds: ceil_seconds(left),
                    }
                }
                None => {
                    inner.locked_until = None;
                    inner.wrong = 0;
                }
            }
        }
        if inner.code.as_ref().is_some_and(|code| code.matches(given)) {
            inner.wrong = 0;
            return CodeCheck::Right;
        }
        inner.wrong += 1;
        if inner.wrong >= MAX_WRONG_CODES {
            inner.locked_until = Some(now + LOCK_FOR);
        }
        CodeCheck::Wrong
    }
}

fn ceil_seconds(left: Duration) -> u64 {
    left.as_secs() + u64::from(left.subsec_nanos() > 0)
}

// ── 답 ───────────────────────────────────────────────────────────────────────

/// 요청 하나에 대한 답. 정해진 낱말뿐이다 — 요청에 실려 온 글자(쿠키·코드)는 답에 들어가지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    /// 쿠키를 받아 저장했다.
    Received,
    /// 요청의 모양이 다르다(머리를 읽을 수 없다, 헤더가 겹친다, 본문이 정해진 JSON이 아니다).
    BadRequest,
    /// 연결 코드가 틀리다.
    WrongCode,
    /// 출처가 크롬 확장이 아니다(웹 페이지·출처 없음).
    ForbiddenOrigin,
    /// `Host`가 이 수신부의 주소가 아니다.
    ForbiddenHost,
    NotFound,
    MethodNotAllowed,
    /// 제때 다 보내지 않았다.
    Timeout,
    /// 계정을 받는 중이라 쿠키를 바꾸지 않았다.
    Busy,
    LengthRequired,
    TooLarge,
    UnsupportedType,
    /// 보낸 쿠키에 로그인 쿠키(game_token·game_openid)가 없다.
    NotLoggedIn,
    /// 보낸 쿠키의 형식이 맞지 않는다.
    CookieRejected,
    /// 코드를 여러 번 틀려 막혀 있다.
    Locked { seconds: u64 },
    /// 쿠키 파일을 쓰지 못했다(엔진 폴더 문제 등).
    StoreFailed,
}

impl Reply {
    /// HTTP 상태 코드와 문구.
    pub fn status(self) -> (u16, &'static str) {
        match self {
            Self::Received => (200, "OK"),
            Self::BadRequest => (400, "Bad Request"),
            Self::WrongCode => (401, "Unauthorized"),
            Self::ForbiddenOrigin | Self::ForbiddenHost => (403, "Forbidden"),
            Self::NotFound => (404, "Not Found"),
            Self::MethodNotAllowed => (405, "Method Not Allowed"),
            Self::Timeout => (408, "Request Timeout"),
            Self::Busy => (409, "Conflict"),
            Self::LengthRequired => (411, "Length Required"),
            Self::TooLarge => (413, "Content Too Large"),
            Self::UnsupportedType => (415, "Unsupported Media Type"),
            Self::NotLoggedIn | Self::CookieRejected => (422, "Unprocessable Content"),
            Self::Locked { .. } => (429, "Too Many Requests"),
            Self::StoreFailed => (500, "Internal Server Error"),
        }
    }

    /// 사유를 알리는 낱말. 확장(`extension/lib/link.js`의 `describeReply`)이 이것으로 안내를 고른다.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Received => "received",
            Self::BadRequest => "bad_request",
            Self::WrongCode => "wrong_code",
            Self::ForbiddenOrigin => "origin",
            Self::ForbiddenHost => "host",
            Self::NotFound => "not_found",
            Self::MethodNotAllowed => "method",
            Self::Timeout => "timeout",
            Self::Busy => "busy",
            Self::LengthRequired => "length_required",
            Self::TooLarge => "too_large",
            Self::UnsupportedType => "content_type",
            Self::NotLoggedIn => "not_logged_in",
            Self::CookieRejected => "cookie_rejected",
            Self::Locked { .. } => "locked",
            Self::StoreFailed => "store_failed",
        }
    }

    /// 답의 본문(JSON). 성공·실패와 사유뿐이다.
    pub fn body(self) -> String {
        match self {
            Self::Received => r#"{"ok":true,"result":"received"}"#.to_string(),
            Self::Locked { seconds } => {
                format!(r#"{{"ok":false,"reason":"locked","retry_after_seconds":{seconds}}}"#)
            }
            other => format!(r#"{{"ok":false,"reason":"{}"}}"#, other.reason()),
        }
    }

    /// 답 전체(상태 줄·헤더·본문). 다른 출처 허용 헤더는 어떤 답에도 없다 — 웹 페이지는 이 답을 읽지 못한다.
    pub fn to_bytes(self) -> Vec<u8> {
        let (code, text) = self.status();
        let body = self.body();
        let mut head = format!(
            "HTTP/1.1 {code} {text}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n",
            body.len()
        );
        match self {
            Self::MethodNotAllowed => head.push_str("Allow: POST\r\n"),
            Self::Locked { seconds } => head.push_str(&format!("Retry-After: {seconds}\r\n")),
            _ => {}
        }
        head.push_str("\r\n");
        head.push_str(&body);
        head.into_bytes()
    }

    /// 계정 화면에 알릴 만한 답인가. 모양이 다른 요청·웹 페이지의 요청은 조용히 거부하고 알리지 않는다
    /// (웹 페이지가 요청을 쏟아부어 화면을 어지럽히지 못하게).
    pub fn notable(self) -> bool {
        matches!(
            self,
            Self::Received
                | Self::WrongCode
                | Self::Locked { .. }
                | Self::NotLoggedIn
                | Self::CookieRejected
                | Self::Busy
                | Self::StoreFailed
        )
    }
}

// ── 요청 읽기(순수) ───────────────────────────────────────────────────────────

/// 요청의 머리(요청 줄과 헤더). 헤더 이름은 소문자로 바꿔 둔다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub method: String,
    pub target: String,
    headers: Vec<(String, String)>,
}

impl Head {
    /// 그 이름(소문자)의 헤더 값. 없으면 `None`, 둘 이상이면 거부한다(어느 것을 믿을지 정하지 않는다).
    pub fn header(&self, name: &str) -> Result<Option<&str>, Reply> {
        let mut found = self
            .headers
            .iter()
            .filter(|(n, _)| n == name)
            .map(|(_, v)| v.as_str());
        let first = found.next();
        if found.next().is_some() {
            return Err(Reply::BadRequest);
        }
        Ok(first)
    }
}

/// 요청의 머리(빈 줄 앞까지의 바이트)를 읽는다.
pub fn parse_head(raw: &[u8]) -> Result<Head, Reply> {
    let text = std::str::from_utf8(raw).map_err(|_| Reply::BadRequest)?;
    let mut lines = text.split("\r\n");
    let request = lines.next().ok_or(Reply::BadRequest)?;
    let mut parts = request.split(' ');
    let (Some(method), Some(target), Some(version), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(Reply::BadRequest);
    };
    let method_ok = !method.is_empty() && method.bytes().all(|b| b.is_ascii_uppercase());
    let target_ok = target.starts_with('/') && target.bytes().all(|b| b.is_ascii_graphic());
    if !method_ok || !target_ok || !matches!(version, "HTTP/1.1" | "HTTP/1.0") {
        return Err(Reply::BadRequest);
    }
    let mut headers = Vec::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(Reply::BadRequest)?;
        let name_ok = !name.is_empty()
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'));
        if !name_ok || value.chars().any(|c| c.is_control() && c != '\t') {
            return Err(Reply::BadRequest);
        }
        headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
    }
    Ok(Head {
        method: method.to_string(),
        target: target.to_string(),
        headers,
    })
}

/// 출처가 크롬 확장인가: `chrome-extension://` + 확장 ID(a~p 32자). 웹 페이지의 출처(`https://…`, `http://…`, `null`)는 아니다.
pub fn is_extension_origin(origin: &str) -> bool {
    origin
        .strip_prefix(EXTENSION_ORIGIN)
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
}

/// 머리만 보고 받을 요청인지 가린다: 경로 → 출처 → 방법 → 호스트 → 형식 → 크기. 받을 요청이면 본문의 크기를 돌려준다.
pub fn screen(head: &Head, port: u16) -> Result<usize, Reply> {
    if head.target != SESSION_PATH {
        return Err(Reply::NotFound);
    }
    if !head.header("origin")?.is_some_and(is_extension_origin) {
        return Err(Reply::ForbiddenOrigin);
    }
    if head.method != "POST" {
        return Err(Reply::MethodNotAllowed);
    }
    if head.header("host")? != Some(format!("{}:{port}", Ipv4Addr::LOCALHOST).as_str()) {
        return Err(Reply::ForbiddenHost);
    }
    let media = head
        .header("content-type")?
        .and_then(|value| value.split(';').next())
        .map(|media| media.trim().to_ascii_lowercase());
    if media.as_deref() != Some(CONTENT_TYPE) {
        return Err(Reply::UnsupportedType);
    }
    if head.header("transfer-encoding")?.is_some() {
        return Err(Reply::LengthRequired);
    }
    let length = head
        .header("content-length")?
        .filter(|value| !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()))
        .ok_or(Reply::LengthRequired)?
        .parse::<usize>()
        .map_err(|_| Reply::TooLarge)?;
    if length > MAX_BODY_BYTES {
        return Err(Reply::TooLarge);
    }
    if length == 0 {
        return Err(Reply::BadRequest);
    }
    Ok(length)
}

/// 본문의 두 칸. 이 둘뿐이고 다른 칸이 있으면 거부한다.
const BODY_FIELDS: [&str; 2] = ["code", "cookie"];

/// 확장이 보낸 것. 쿠키 값을 글자로 내보이지 않는다.
#[derive(Clone, PartialEq, Eq)]
pub struct Submission {
    code: String,
    cookie: String,
}

impl fmt::Debug for Submission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Submission")
            .field("code", &MASK)
            .field("cookie", &MASK)
            .finish()
    }
}

/// 본문을 읽는다. 읽다 난 오류의 문장은 버린다 — 본문의 글자(쿠키)가 섞여 나올 수 있다.
///
/// 받는 모양은 하나다: 글자인 `code`와 `cookie` 두 칸만 있는 JSON 객체(같은 값을 배열로 늘어놓은 것도 받지 않는다).
pub fn parse_body(raw: &[u8]) -> Result<Submission, Reply> {
    let Ok(Value::Object(mut fields)) = serde_json::from_slice::<Value>(raw) else {
        return Err(Reply::BadRequest);
    };
    if fields.len() != BODY_FIELDS.len() {
        return Err(Reply::BadRequest);
    }
    let [code, cookie] = BODY_FIELDS.map(|name| fields.remove(name));
    match (code, cookie) {
        (Some(Value::String(code)), Some(Value::String(cookie))) => Ok(Submission { code, cookie }),
        _ => Err(Reply::BadRequest),
    }
}

/// 받은 쿠키를 저장한 결과. 쿠키의 내용은 없다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stored {
    Saved,
    /// 로그인 쿠키(game_token·game_openid)가 없다.
    NotLoggedIn,
    /// 쿠키 헤더로 쓸 수 없는 글자다(비었다, 너무 길다, 올 수 없는 글자).
    Rejected,
    /// 계정을 받는 중이다.
    Busy,
    Failed,
}

/// 코드가 맞은 요청의 쿠키를 받아 저장하는 쪽(`lib.rs`가 엔진 폴더를 정해 `store_in_engine`을 부른다).
pub type Sink = dyn Fn(&str) -> Stored + Send + Sync;
/// 알릴 만한 답이 나갈 때마다 불린다(`Reply::notable`).
pub type Notify = dyn Fn(Reply) + Send + Sync;
/// 상태가 바뀌어 화면에 알릴 때 불린다. 인자가 없다 — 화면에 가는 것은 `LinkStatus`뿐이다.
pub type Changed = dyn Fn() + Send + Sync;

/// 본문을 읽어 답을 정한다: 모양 → 코드 → 저장. 코드가 맞기 전에는 쿠키를 저장하는 쪽에 넘기지 않는다.
pub fn judge(body: &[u8], gate: &Gate, sink: &dyn Fn(&str) -> Stored, now: Instant) -> Reply {
    let submission = match parse_body(body) {
        Ok(submission) => submission,
        Err(reply) => return reply,
    };
    match gate.check(&submission.code, now) {
        CodeCheck::Right => {}
        CodeCheck::Wrong => return Reply::WrongCode,
        CodeCheck::Locked { seconds } => return Reply::Locked { seconds },
    }
    match sink(&submission.cookie) {
        Stored::Saved => Reply::Received,
        Stored::NotLoggedIn => Reply::NotLoggedIn,
        Stored::Rejected => Reply::CookieRejected,
        Stored::Busy => Reply::Busy,
        Stored::Failed => Reply::StoreFailed,
    }
}

/// 확장이 보낸 쿠키를 엔진의 쿠키 파일에 쓴다 — 붙여넣기와 같은 정리·검사를 거치는 같은 길이다
/// (`account_sync::store_pasted_cookie`). 돌려주는 것은 결과의 종류뿐이다.
pub fn store_in_engine(engine_dir: &Path, cookie: &str) -> Stored {
    match account_sync::store_pasted_cookie(engine_dir, cookie) {
        Ok(_) => Stored::Saved,
        Err(SyncError::Cookie(CookieError::MissingRequired { .. })) => Stored::NotLoggedIn,
        Err(SyncError::Cookie(_)) => Stored::Rejected,
        Err(_) => Stored::Failed,
    }
}

// ── 수신부(소켓) ──────────────────────────────────────────────────────────────

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// 연결에서 조금 더 읽어 `buf`에 붙인다. 시한을 넘기면 `Timeout`.
fn read_some(stream: &mut TcpStream, buf: &mut Vec<u8>, deadline: Instant) -> Result<(), Reply> {
    let left = deadline
        .checked_duration_since(Instant::now())
        .filter(|left| !left.is_zero())
        .ok_or(Reply::Timeout)?;
    stream
        .set_read_timeout(Some(left))
        .map_err(|_| Reply::BadRequest)?;
    let mut chunk = [0u8; 4096];
    match stream.read(&mut chunk) {
        Ok(0) => Err(Reply::BadRequest),
        Ok(n) => {
            buf.extend_from_slice(&chunk[..n]);
            Ok(())
        }
        Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            Err(Reply::Timeout)
        }
        Err(e) if e.kind() == ErrorKind::Interrupted => Ok(()),
        Err(_) => Err(Reply::BadRequest),
    }
}

/// 요청 하나를 읽어 본문을 돌려준다. 머리에서 거부할 요청이면 본문을 읽지 않는다.
fn read_request(stream: &mut TcpStream, port: u16, deadline: Instant) -> Result<Vec<u8>, Reply> {
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let head_end = loop {
        if let Some(at) = find(&buf, b"\r\n\r\n") {
            break at;
        }
        if buf.len() > MAX_HEAD_BYTES {
            return Err(Reply::TooLarge);
        }
        read_some(stream, &mut buf, deadline)?;
    };
    if head_end > MAX_HEAD_BYTES {
        return Err(Reply::TooLarge);
    }
    let head = parse_head(&buf[..head_end])?;
    let length = screen(&head, port)?;
    let mut body = buf.split_off(head_end + 4);
    while body.len() < length {
        read_some(stream, &mut body, deadline)?;
    }
    // 연결 하나에 요청 하나다 — 본문 뒤에 더 온 것이 있으면 받지 않는다.
    if body.len() > length {
        return Err(Reply::BadRequest);
    }
    Ok(body)
}

/// 답을 쓴 뒤, 상대가 보내던 나머지를 잠깐 받아 버린다(읽지 않은 것이 남은 채 닫으면 상대가 답을 못 읽을 수 있다).
fn drain(stream: &mut TcpStream) {
    let until = Instant::now() + DRAIN_FOR;
    let mut chunk = [0u8; 4096];
    let mut total = 0usize;
    while total < DRAIN_BYTES {
        let Some(left) = until
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
        else {
            break;
        };
        if stream.set_read_timeout(Some(left)).is_err() {
            break;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => total += n,
        }
    }
}

/// 들어온 연결 하나에 답한다.
fn serve(mut stream: TcpStream, port: u16, gate: &Gate, sink: &Sink, notify: &Notify) {
    // 듣는 소켓이 기다리지 않는 방식이라, 받은 연결은 기다리는 방식으로 되돌린다(읽기 시한을 쓴다).
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let reply = match read_request(&mut stream, port, Instant::now() + REQUEST_DEADLINE) {
        Ok(body) => judge(&body, gate, sink, Instant::now()),
        Err(reply) => reply,
    };
    let _ = stream.write_all(&reply.to_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Write);
    drain(&mut stream);
    drop(stream);
    if reply.notable() {
        notify(reply);
    }
}

/// 끄라고 할 때까지 연결을 받는다. 듣는 소켓은 이 함수가 끝나며 닫힌다.
fn listen(
    listener: TcpListener,
    port: u16,
    stop: Arc<AtomicBool>,
    gate: Arc<Gate>,
    sink: Arc<Sink>,
    notify: Arc<Notify>,
) {
    while !stop.load(Ordering::Acquire) {
        match listener.accept() {
            // 루프백에만 묶여 있어 다른 주소에서는 올 수 없다 — 그래도 한 번 더 본다.
            Ok((stream, peer)) if peer.ip().is_loopback() => {
                serve(stream, port, &gate, &*sink, &*notify);
            }
            Ok(_) => {}
            Err(_) => thread::sleep(ACCEPT_POLL),
        }
    }
}

/// 열려 있는 수신부. 버리면(끄기·앱 종료) 듣는 소켓이 닫힌다.
#[derive(Debug)]
pub struct Receiver {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Receiver {
    /// 루프백(127.0.0.1)의 그 포트에서 듣기 시작한다. 포트 0이면 빈 포트를 고른다(테스트용).
    pub fn start(
        port: u16,
        gate: Arc<Gate>,
        sink: Arc<Sink>,
        notify: Arc<Notify>,
    ) -> Result<Self, LinkError> {
        let bind_failed = |e: std::io::Error| match e.kind() {
            ErrorKind::AddrInUse => LinkError::PortInUse { port },
            _ => LinkError::Bind {
                port,
                detail: e.to_string(),
            },
        };
        // 모든 주소(0.0.0.0)가 아니라 루프백 하나에 묶는다 — 이 PC 밖에서는 닿을 수 없다.
        let listener =
            TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).map_err(bind_failed)?;
        let addr = listener.local_addr().map_err(bind_failed)?;
        // 끄기 요청을 제때 보려고 기다리지 않는 방식으로 듣는다.
        listener.set_nonblocking(true).map_err(bind_failed)?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("extension-link".to_string())
            .spawn(move || listen(listener, addr.port(), flag, gate, sink, notify))
            .map_err(|e| LinkError::Thread {
                detail: e.to_string(),
            })?;
        Ok(Self {
            addr,
            stop,
            thread: Some(thread),
        })
    }

    /// 듣고 있는 주소.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// 듣기를 멈추고 소켓이 닫힐 때까지 기다린다(답하던 연결이 있으면 그 답이 끝난 뒤).
    pub fn stop(mut self) {
        self.close();
    }

    fn close(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            // 수신부 스레드 자신이 마지막으로 버리게 됐을 때는 기다리지 않는다(자기를 기다리면 끝나지 않는다) —
            // 멈춤 표시를 봤으니 스레드는 곧 끝나고 소켓이 닫힌다.
            if thread.thread().id() != thread::current().id() {
                let _ = thread.join();
            }
        }
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        self.close();
    }
}

// ── 켜고 끄기·상태 ────────────────────────────────────────────────────────────

/// 수신부에 마지막으로 온 요청(알릴 만한 것). 쿠키는 없다. 프런트의 `ExtensionLinkActivity`(src/types.ts)와 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkActivity {
    /// 언제(ISO, UTC).
    pub at: String,
    /// 답의 사유(`Reply::reason` — `received`·`wrong_code`·`locked`·…).
    pub outcome: &'static str,
    /// 한국어 문장.
    pub message: String,
}

/// 크롬 확장 연결의 지금 상태. 쿠키는 없다. 프런트의 `ExtensionLinkStatus`(src/types.ts)와 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkStatus {
    /// 사용자가 켜 두었는가(기억된다).
    pub enabled: bool,
    /// 지금 듣고 있는가. 켜 두었는데 듣지 못하면 이유가 `problem`에 있다.
    pub listening: bool,
    /// 듣는 주소(`127.0.0.1:포트`).
    pub address: String,
    /// 연결 코드(`ABCD-EFGH`). 쿠키가 아니라 화면에 보여도 된다. 만들지 못했으면 빈 문자열.
    pub code: String,
    /// 열지 못한 이유·설정을 저장하지 못한 이유(한국어 문장).
    pub problem: Option<String>,
    /// 확장에서 쿠키를 받았고 화면이 아직 「계정 새로 받기」를 잇지 않았다.
    pub pending: bool,
    /// 마지막으로 온 요청.
    pub last: Option<LinkActivity>,
    /// 코드를 여러 번 틀려 막힌 시간이 얼마나 남았는가(초). 막혀 있지 않으면 0.
    pub locked_seconds: u64,
}

/// 답 하나를 계정 화면에 보일 문장으로.
fn activity_message(reply: Reply, wrong: u32) -> String {
    match reply {
        Reply::Received => "크롬 확장에서 쿠키를 받아 저장했다 — 계정을 새로 받는다".to_string(),
        Reply::WrongCode => format!(
            "연결 코드가 틀린 요청이 왔다(연속 {wrong}회) — 확장에 넣은 코드가 위의 코드와 같은지 확인하라"
        ),
        Reply::Locked { seconds } => format!(
            "코드를 {MAX_WRONG_CODES}번 틀려 요청을 잠시 막았다({seconds}초 남음) — 확장의 코드를 고친 뒤 다시 보내라"
        ),
        Reply::NotLoggedIn => {
            "확장이 보낸 쿠키에 로그인 쿠키가 없다 — 그 브라우저에서 blablalink에 로그인돼 있지 않다".to_string()
        }
        Reply::CookieRejected => "확장이 보낸 쿠키의 형식이 맞지 않아 저장하지 않았다".to_string(),
        Reply::Busy => "계정을 받는 중이라 확장이 보낸 쿠키를 받지 않았다 — 끝난 뒤에 다시 보내라".to_string(),
        Reply::StoreFailed => {
            "확장이 보낸 쿠키를 저장하지 못했다 — 엔진 폴더 설정을 확인하라".to_string()
        }
        other => format!("요청을 거부했다({})", other.reason()),
    }
}

#[derive(Debug, Default)]
struct Activity {
    pending: bool,
    last: Option<LinkActivity>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    code: String,
}

fn load_settings(file: &Path) -> Saved {
    // 파일이 없거나 읽을 수 없으면 기본값이다: 꺼짐, 코드는 새로 만든다.
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text)).ok())
        .unwrap_or_default()
}

#[derive(Debug, Default)]
struct HubState {
    enabled: bool,
    problem: Option<String>,
    receiver: Option<Receiver>,
}

/// 크롬 확장 연결 전체: 켜고 끄기(기억), 연결 코드(기억·다시 만들기), 수신부, 화면에 보일 상태.
/// Tauri를 모른다 — 쿠키를 저장하는 쪽과 화면에 알리는 쪽은 `lib.rs`가 끼운다.
pub struct LinkHub {
    file: Option<PathBuf>,
    port: u16,
    gate: Arc<Gate>,
    sink: Arc<Sink>,
    changed: Arc<Changed>,
    activity: Arc<Mutex<Activity>>,
    state: Mutex<HubState>,
}

impl LinkHub {
    /// 기억해 둔 설정(`file`)을 읽어 연다. 켜 두었으면 곧바로 듣는다. 파일이 없으면 꺼진 채로, 코드는 새로 만든다.
    pub fn open(file: Option<PathBuf>, port: u16, sink: Arc<Sink>, changed: Arc<Changed>) -> Self {
        let saved = file.as_deref().map(load_settings).unwrap_or_default();
        let mut problem = None;
        let known = LinkCode::parse(&saved.code);
        let fresh = known.is_none();
        let code = known.or_else(|| match LinkCode::generate() {
            Ok(code) => Some(code),
            Err(e) => {
                problem = Some(e.to_string());
                None
            }
        });
        let hub = Self {
            file,
            port,
            gate: Arc::new(Gate::new(code)),
            sink,
            changed,
            activity: Arc::new(Mutex::new(Activity::default())),
            state: Mutex::new(HubState {
                enabled: saved.enabled,
                problem,
                receiver: None,
            }),
        };
        if saved.enabled {
            hub.start(&mut lock(&hub.state));
        }
        if fresh {
            hub.save();
        }
        hub
    }

    /// 듣기 시작한다(이미 듣고 있으면 그대로). 열지 못하면 이유를 남긴다.
    fn start(&self, state: &mut HubState) {
        if state.receiver.is_some() {
            return;
        }
        let activity = Arc::clone(&self.activity);
        let gate = Arc::clone(&self.gate);
        let changed = Arc::clone(&self.changed);
        let notify = move |reply: Reply| {
            let (utc, _local) = capture::now_stamps();
            {
                let mut activity = lock(&activity);
                activity.pending |= reply == Reply::Received;
                activity.last = Some(LinkActivity {
                    at: utc.iso_utc(),
                    outcome: reply.reason(),
                    message: activity_message(reply, gate.wrong()),
                });
            }
            // 잠금을 푼 뒤에 알린다 — 알림을 받는 쪽이 상태를 읽는다.
            changed();
        };
        match Receiver::start(
            self.port,
            Arc::clone(&self.gate),
            Arc::clone(&self.sink),
            Arc::new(notify),
        ) {
            Ok(receiver) => {
                state.receiver = Some(receiver);
                // 코드를 만들지 못한 문제는 남겨 둔다(듣고는 있지만 받을 수 있는 요청이 없다).
                if self.gate.code().is_some() {
                    state.problem = None;
                }
            }
            Err(e) => state.problem = Some(e.to_string()),
        }
    }

    /// 켜짐 여부와 코드를 설정 파일에 적는다. 적지 못하면 이유를 남긴다(연결 자체는 계속된다).
    fn save(&self) {
        let Some(file) = &self.file else {
            return;
        };
        let saved = Saved {
            enabled: lock(&self.state).enabled,
            code: self.gate.code().map(|code| code.shown()).unwrap_or_default(),
        };
        let written = serde_json::to_string_pretty(&saved)
            .map_err(|e| e.to_string())
            .and_then(|text| {
                if let Some(dir) = file.parent() {
                    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                }
                fs::write(file, format!("{text}\n")).map_err(|e| e.to_string())
            });
        if let Err(detail) = written {
            let mut state = lock(&self.state);
            if state.problem.is_none() {
                state.problem = Some(format!(
                    "크롬 확장 연결의 설정을 저장하지 못했다({detail}) — 다음에 켤 때 이 상태와 코드가 기억되지 않는다"
                ));
            }
        }
    }

    /// 켜거나 끈다. 켜면 듣기 시작하고, 끄면 듣는 소켓을 닫는다. 켜짐 여부는 기억된다.
    pub fn set_enabled(&self, enabled: bool) -> LinkStatus {
        let stopped = {
            let mut state = lock(&self.state);
            state.enabled = enabled;
            if enabled {
                self.start(&mut state);
                None
            } else {
                state.problem = None;
                state.receiver.take()
            }
        };
        // 잠금을 푼 뒤에 닫는다 — 닫히기를 기다리는 동안 수신부 스레드가 상태를 읽을 수 있다.
        drop(stopped);
        self.save();
        self.status()
    }

    /// 연결 코드를 다시 만든다. 옛 코드는 그 순간부터 받지 않는다 — 확장에 새 코드를 넣어야 한다.
    pub fn new_code(&self) -> LinkStatus {
        match LinkCode::generate() {
            Ok(code) => {
                self.gate.replace_code(code);
                self.save();
            }
            Err(e) => lock(&self.state).problem = Some(e.to_string()),
        }
        self.status()
    }

    /// 확장에서 받은 쿠키로 「계정 새로 받기」를 이을 차례인가. 한 번 true를 돌려주면 다음부터는 false다.
    pub fn take_pending(&self) -> bool {
        std::mem::take(&mut lock(&self.activity).pending)
    }

    /// 지금 상태. 쿠키는 없다.
    pub fn status(&self) -> LinkStatus {
        let (enabled, problem, addr) = {
            let state = lock(&self.state);
            (
                state.enabled,
                state.problem.clone(),
                state.receiver.as_ref().map(Receiver::addr),
            )
        };
        let (pending, last) = {
            let activity = lock(&self.activity);
            (activity.pending, activity.last.clone())
        };
        LinkStatus {
            enabled,
            listening: addr.is_some(),
            address: addr.map_or_else(
                || format!("{}:{}", Ipv4Addr::LOCALHOST, self.port),
                |addr| addr.to_string(),
            ),
            code: self.gate.code().map(|code| code.shown()).unwrap_or_default(),
            problem,
            pending,
            last,
            locked_seconds: self.gate.locked_seconds(Instant::now()),
        }
    }

    /// 듣고 있는 주소(듣고 있을 때만).
    pub fn addr(&self) -> Option<SocketAddr> {
        lock(&self.state).receiver.as_ref().map(Receiver::addr)
    }

    /// 앱이 끝날 때: 듣는 소켓을 닫는다. 켜짐 여부(기억)는 바꾸지 않는다 — 다음 실행 때 다시 열린다.
    pub fn shutdown(&self) {
        let stopped = lock(&self.state).receiver.take();
        drop(stopped);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 테스트용 가짜 쿠키. 실제 계정의 값이 아니다.
    const TOKEN: &str = "FAKE-TOKEN-link-unit-3c59dc048e88";
    const OPENID: &str = "12121212343434345656";
    const ORIGIN: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const PORT: u16 = 47615;

    fn fake_cookie() -> String {
        format!("game_token={TOKEN}; game_openid={OPENID}; lang=ko")
    }

    fn code() -> LinkCode {
        LinkCode::parse("ABCD-2345").expect("코드")
    }

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    /// 받을 요청의 머리. `change`로 한 줄을 바꾸거나 뺀다.
    fn head_with(method: &str, target: &str, change: &[(&str, Option<&str>)]) -> Vec<u8> {
        let mut headers = vec![
            ("Host".to_string(), format!("127.0.0.1:{PORT}")),
            ("Origin".to_string(), ORIGIN.to_string()),
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Content-Length".to_string(), "64".to_string()),
        ];
        for (name, value) in change {
            headers.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
            if let Some(value) = value {
                headers.push(((*name).to_string(), (*value).to_string()));
            }
        }
        let mut text = format!("{method} {target} HTTP/1.1");
        for (name, value) in headers {
            text.push_str(&format!("\r\n{name}: {value}"));
        }
        text.into_bytes()
    }

    fn screened(method: &str, target: &str, change: &[(&str, Option<&str>)]) -> Result<usize, Reply> {
        screen(&parse_head(&head_with(method, target, change))?, PORT)
    }

    fn body(code: &str, cookie: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({ "code": code, "cookie": cookie })).expect("본문")
    }

    #[test]
    fn codes_use_the_unambiguous_alphabet_and_read_back_from_what_people_type() {
        assert_eq!(CODE_ALPHABET.len(), 32);
        for confusing in *b"IO01" {
            assert!(!CODE_ALPHABET.contains(&confusing));
        }
        let code = LinkCode::from_random([0, 1, 31, 32, 63, 255, 7, 200]);
        assert_eq!(code.shown(), "AB9A-99HJ");
        assert_eq!(code.shown().len(), CODE_CHARS + 1);
        for typed in ["AB9A-99HJ", "ab9a-99hj", " ab9a 99hj ", "AB9A99HJ", "a-b-9-a-9-9-h-j"] {
            assert_eq!(LinkCode::parse(typed), Some(code.clone()), "{typed}");
            assert!(code.matches(typed), "{typed}");
        }
        for typed in ["", "AB9A-99H", "AB9A-99HJK", "AB9A-99H1", "AB9A-99HO", "AB9A-99H!", "가나다라-마바사아"] {
            assert_eq!(LinkCode::parse(typed), None, "{typed}");
            assert!(!code.matches(typed), "{typed}");
        }
        assert!(!code.matches("AB9A-99HK"));
        assert!(!code.matches("BB9A-99HJ"));
    }

    #[test]
    fn generated_codes_are_well_formed_and_differ() {
        let codes: Vec<LinkCode> = (0..32).map(|_| LinkCode::generate().expect("난수")).collect();
        for code in &codes {
            assert_eq!(LinkCode::parse(&code.shown()).as_ref(), Some(code));
        }
        let mut distinct: Vec<String> = codes.iter().map(LinkCode::shown).collect();
        distinct.sort();
        distinct.dedup();
        assert_eq!(distinct.len(), codes.len(), "같은 코드가 다시 나왔다");
    }

    #[test]
    fn wrong_codes_are_counted_and_too_many_lock_everything_for_a_while() {
        let gate = Gate::new(Some(code()));
        let start = Instant::now();
        for n in 1..MAX_WRONG_CODES {
            assert_eq!(gate.check("ZZZZ-ZZZZ", start), CodeCheck::Wrong);
            assert_eq!(gate.wrong(), n);
            assert_eq!(gate.locked_seconds(start), 0);
        }
        // 맞히면 횟수가 처음으로 돌아간다.
        assert_eq!(gate.check("abcd-2345", start), CodeCheck::Right);
        assert_eq!(gate.wrong(), 0);
        for _ in 0..MAX_WRONG_CODES {
            assert_eq!(gate.check("ZZZZ-ZZZZ", start), CodeCheck::Wrong);
        }
        // 막힌 동안에는 맞는 코드도 받지 않는다.
        assert_eq!(gate.locked_seconds(start), LOCK_FOR.as_secs());
        assert_eq!(gate.check("ABCD-2345", start), CodeCheck::Locked { seconds: LOCK_FOR.as_secs() });
        let later = start + LOCK_FOR - Duration::from_millis(1500);
        assert_eq!(gate.check("ABCD-2345", later), CodeCheck::Locked { seconds: 2 });
        // 막힌 동안의 요청은 막힘을 늘리지 않는다.
        assert_eq!(gate.locked_seconds(later), 2);
        // 시간이 지나면 풀리고, 다시 다섯 번을 틀릴 수 있다.
        let after = start + LOCK_FOR;
        assert_eq!(gate.check("ZZZZ-ZZZZ", after), CodeCheck::Wrong);
        assert_eq!(gate.wrong(), 1);
        assert_eq!(gate.check("ABCD-2345", after), CodeCheck::Right);
    }

    #[test]
    fn replacing_the_code_retires_the_old_one_and_a_gate_without_a_code_accepts_nothing() {
        let gate = Gate::new(Some(code()));
        let now = Instant::now();
        for _ in 0..MAX_WRONG_CODES {
            gate.check("ZZZZ-ZZZZ", now);
        }
        gate.replace_code(LinkCode::parse("WXYZ-6789").expect("코드"));
        assert_eq!(gate.locked_seconds(now), 0);
        assert_eq!(gate.check("ABCD-2345", now), CodeCheck::Wrong);
        assert_eq!(gate.check("WXYZ-6789", now), CodeCheck::Right);

        let empty = Gate::new(None);
        assert_eq!(empty.code(), None);
        assert_eq!(empty.check("", now), CodeCheck::Wrong);
        assert_eq!(empty.check("ABCD-2345", now), CodeCheck::Wrong);
    }

    #[test]
    fn the_one_accepted_request_passes_the_screen() {
        assert_eq!(screened("POST", SESSION_PATH, &[]), Ok(64));
        // 형식 뒤의 매개변수와 대소문자는 받는다.
        assert_eq!(
            screened("POST", SESSION_PATH, &[("content-type", Some("Application/JSON; charset=utf-8"))]),
            Ok(64)
        );
        assert_eq!(
            screened("POST", SESSION_PATH, &[("Content-Length", Some(&MAX_BODY_BYTES.to_string()))]),
            Ok(MAX_BODY_BYTES)
        );
    }

    #[test]
    fn other_paths_methods_types_and_sizes_are_refused() {
        for target in ["/", "/nikke-companion/v1/session/", "/nikke-companion/v1/session?x=1", "/nikke-companion/v2/session", "/favicon.ico"] {
            assert_eq!(screened("POST", target, &[]), Err(Reply::NotFound), "{target}");
        }
        for method in ["GET", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] {
            assert_eq!(screened(method, SESSION_PATH, &[]), Err(Reply::MethodNotAllowed), "{method}");
        }
        for media in [None, Some("text/plain"), Some("application/x-www-form-urlencoded"), Some("multipart/form-data"), Some("application/jsonx"), Some("")] {
            assert_eq!(
                screened("POST", SESSION_PATH, &[("Content-Type", media)]),
                Err(Reply::UnsupportedType),
                "{media:?}"
            );
        }
        for length in [None, Some(""), Some("-1"), Some("1e3"), Some("12 34"), Some("0x10")] {
            assert_eq!(
                screened("POST", SESSION_PATH, &[("Content-Length", length)]),
                Err(Reply::LengthRequired),
                "{length:?}"
            );
        }
        let too_big = (MAX_BODY_BYTES + 1).to_string();
        for length in [too_big.as_str(), "99999999999999999999999999999999"] {
            assert_eq!(
                screened("POST", SESSION_PATH, &[("Content-Length", Some(length))]),
                Err(Reply::TooLarge),
                "{length}"
            );
        }
        assert_eq!(screened("POST", SESSION_PATH, &[("Content-Length", Some("0"))]), Err(Reply::BadRequest));
        assert_eq!(
            screened("POST", SESSION_PATH, &[("Transfer-Encoding", Some("chunked"))]),
            Err(Reply::LengthRequired)
        );
    }

    #[test]
    fn only_a_chrome_extension_origin_is_let_in() {
        assert!(is_extension_origin(ORIGIN));
        for origin in [
            None,
            Some("null"),
            Some(""),
            Some("https://www.blablalink.com"),
            Some("https://evil.example"),
            Some("http://127.0.0.1:47615"),
            Some("http://localhost:47615"),
            Some("file://"),
            Some("chrome-extension://"),
            Some("chrome-extension://short"),
            Some("chrome-extension://abcdefghijklmnopabcdefghijklmnoq"),
            Some("chrome-extension://abcdefghijklmnopabcdefghijklmnop.evil.example"),
            Some("https://chrome-extension://abcdefghijklmnopabcdefghijklmnop"),
            Some("moz-extension://abcdefghijklmnopabcdefghijklmnop"),
        ] {
            assert_eq!(
                screened("POST", SESSION_PATH, &[("Origin", origin)]),
                Err(Reply::ForbiddenOrigin),
                "{origin:?}"
            );
        }
        // 웹 페이지의 사전 요청(OPTIONS)도 출처에서 걸린다.
        assert_eq!(
            screened("OPTIONS", SESSION_PATH, &[("Origin", Some("https://evil.example"))]),
            Err(Reply::ForbiddenOrigin)
        );
    }

    #[test]
    fn the_host_must_be_this_receiver() {
        for host in [None, Some("127.0.0.1"), Some("127.0.0.1:80"), Some("localhost:47615"), Some("evil.example:47615"), Some("192.168.0.10:47615")] {
            assert_eq!(
                screened("POST", SESSION_PATH, &[("Host", host)]),
                Err(Reply::ForbiddenHost),
                "{host:?}"
            );
        }
    }

    #[test]
    fn malformed_heads_and_repeated_headers_are_refused() {
        for raw in [
            &b""[..],
            b"POST",
            b"POST /nikke-companion/v1/session",
            b"POST /nikke-companion/v1/session HTTP/2",
            b"post /nikke-companion/v1/session HTTP/1.1",
            b"POST nikke-companion HTTP/1.1",
            b"POST /a b HTTP/1.1",
            b"POST /x HTTP/1.1\r\nno-colon",
            b"POST /x HTTP/1.1\r\n: empty-name",
            b"POST /x HTTP/1.1\r\nbad name: x",
            b"POST /x HTTP/1.1\r\n folded: x",
            b"POST /x HTTP/1.1\r\nX: a\nb",
            b"POST /x HTTP/1.1\r\nX: \xff\xfe",
        ] {
            assert_eq!(parse_head(raw), Err(Reply::BadRequest), "{:?}", String::from_utf8_lossy(raw));
        }
        // 같은 헤더가 둘이면 어느 것을 믿을지 정하지 않고 거부한다.
        for name in ["Origin", "Host", "Content-Type", "Content-Length"] {
            let mut raw = head_with("POST", SESSION_PATH, &[]);
            raw.extend_from_slice(format!("\r\n{name}: x").as_bytes());
            let head = parse_head(&raw).expect("머리");
            assert_eq!(screen(&head, PORT), Err(Reply::BadRequest), "{name}");
        }
    }

    #[test]
    fn the_body_is_exactly_a_code_and_a_cookie() {
        let parsed = parse_body(&body("ABCD-2345", &fake_cookie())).expect("본문");
        assert_eq!(parsed.code, "ABCD-2345");
        assert_eq!(parsed.cookie, fake_cookie());
        for raw in [
            &b""[..],
            b"null",
            b"[]",
            // 두 값을 배열로 늘어놓은 것은 받지 않는다(객체만 받는다).
            br#"["ABCD-2345","x"]"#,
            br#"{"code":"ABCD-2345","cookie":"x","code2":"y"}"#,
            br#"{"code":null,"cookie":"x"}"#,
            b"\"text\"",
            b"{}",
            br#"{"code":"ABCD-2345"}"#,
            br#"{"cookie":"x"}"#,
            br#"{"code":1,"cookie":"x"}"#,
            br#"{"code":"ABCD-2345","cookie":["x"]}"#,
            br#"{"code":"ABCD-2345","cookie":"x","extra":true}"#,
            br#"{"code":"ABCD-2345","cookie":"x"} trailing"#,
            b"code=ABCD-2345&cookie=x",
        ] {
            assert_eq!(parse_body(raw), Err(Reply::BadRequest), "{:?}", String::from_utf8_lossy(raw));
        }
    }

    #[test]
    fn a_cookie_reaches_the_sink_only_after_the_code_is_right() {
        let seen: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let sink = |cookie: &str| {
            seen.lock().expect("기록").push(cookie.to_string());
            Stored::Saved
        };
        let gate = Gate::new(Some(code()));
        let now = Instant::now();
        assert_eq!(judge(&body("ZZZZ-ZZZZ", &fake_cookie()), &gate, &sink, now), Reply::WrongCode);
        assert_eq!(judge(&body("", &fake_cookie()), &gate, &sink, now), Reply::WrongCode);
        assert_eq!(judge(b"{}", &gate, &sink, now), Reply::BadRequest);
        assert!(seen.lock().expect("기록").is_empty(), "코드가 틀린 요청의 쿠키가 저장하는 쪽에 갔다");
        assert_eq!(judge(&body("abcd 2345", &fake_cookie()), &gate, &sink, now), Reply::Received);
        assert_eq!(*seen.lock().expect("기록"), vec![fake_cookie()]);
    }

    #[test]
    fn judge_maps_every_store_result_and_never_stores_while_locked() {
        static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let now = Instant::now();
        for (stored, reply) in [
            (Stored::Saved, Reply::Received),
            (Stored::NotLoggedIn, Reply::NotLoggedIn),
            (Stored::Rejected, Reply::CookieRejected),
            (Stored::Busy, Reply::Busy),
            (Stored::Failed, Reply::StoreFailed),
        ] {
            let gate = Gate::new(Some(code()));
            let sink = move |_: &str| {
                CALLS.fetch_add(1, Ordering::Relaxed);
                stored
            };
            assert_eq!(judge(&body("ABCD-2345", &fake_cookie()), &gate, &sink, now), reply);
        }
        let before = CALLS.load(Ordering::Relaxed);
        let gate = Gate::new(Some(code()));
        let sink = |_: &str| {
            CALLS.fetch_add(1, Ordering::Relaxed);
            Stored::Saved
        };
        for _ in 0..MAX_WRONG_CODES {
            assert_eq!(judge(&body("ZZZZ-ZZZZ", &fake_cookie()), &gate, &sink, now), Reply::WrongCode);
        }
        assert_eq!(
            judge(&body("ABCD-2345", &fake_cookie()), &gate, &sink, now),
            Reply::Locked { seconds: LOCK_FOR.as_secs() }
        );
        assert_eq!(CALLS.load(Ordering::Relaxed), before, "막힌 동안 쿠키를 저장했다");
    }

    /// 모든 답.
    fn every_reply() -> Vec<Reply> {
        vec![
            Reply::Received,
            Reply::BadRequest,
            Reply::WrongCode,
            Reply::ForbiddenOrigin,
            Reply::ForbiddenHost,
            Reply::NotFound,
            Reply::MethodNotAllowed,
            Reply::Timeout,
            Reply::Busy,
            Reply::LengthRequired,
            Reply::TooLarge,
            Reply::UnsupportedType,
            Reply::NotLoggedIn,
            Reply::CookieRejected,
            Reply::Locked { seconds: 42 },
            Reply::StoreFailed,
        ]
    }

    #[test]
    fn no_reply_carries_a_cross_origin_allowance_and_only_success_is_2xx() {
        for reply in every_reply() {
            let text = String::from_utf8(reply.to_bytes()).expect("답");
            let lower = text.to_ascii_lowercase();
            assert!(!lower.contains("access-control"), "{text}");
            assert!(!lower.contains("timing-allow-origin"), "{text}");
            assert!(lower.contains("connection: close"), "{text}");
            assert!(lower.contains("cache-control: no-store"), "{text}");
            let (code, _) = reply.status();
            assert_eq!(code == 200, reply == Reply::Received, "{reply:?}");
            assert!(text.starts_with(&format!("HTTP/1.1 {code} ")), "{text}");
            let (head, body) = text.split_once("\r\n\r\n").expect("빈 줄");
            assert!(head.contains(&format!("Content-Length: {}", body.len())), "{text}");
            let json: serde_json::Value = serde_json::from_str(body).expect("JSON");
            assert_eq!(json["ok"], reply == Reply::Received);
            if reply != Reply::Received {
                assert_eq!(json["reason"], reply.reason());
            }
        }
        let locked = String::from_utf8(Reply::Locked { seconds: 42 }.to_bytes()).expect("답");
        assert!(locked.contains("Retry-After: 42") && locked.contains(r#""retry_after_seconds":42"#), "{locked}");
        assert!(String::from_utf8(Reply::MethodNotAllowed.to_bytes()).expect("답").contains("Allow: POST"));
    }

    #[test]
    fn replies_and_debug_output_never_show_what_was_sent() {
        let submission = parse_body(&body("ABCD-2345", &fake_cookie())).expect("본문");
        let shown = format!("{submission:?}");
        for secret in [TOKEN, OPENID, "ABCD-2345", "lang=ko"] {
            assert!(!shown.contains(secret), "{shown}");
        }
        assert!(shown.contains(MASK));
        // 답은 요청과 무관한 정해진 글자다 — 쿠키가 들어갈 길이 없다.
        let gate = Gate::new(Some(code()));
        let now = Instant::now();
        for (stored, expected) in [
            (Stored::Saved, Reply::Received),
            (Stored::NotLoggedIn, Reply::NotLoggedIn),
            (Stored::Failed, Reply::StoreFailed),
        ] {
            let reply = judge(&body("ABCD-2345", &fake_cookie()), &gate, &|_| stored, now);
            assert_eq!(reply, expected);
            let text = format!("{}\n{reply:?}", String::from_utf8(reply.to_bytes()).expect("답"));
            for secret in [TOKEN, OPENID, "game_token", "lang=ko"] {
                assert!(!text.contains(secret), "{text}");
            }
        }
        // 본문이 깨져 있어도(쿠키가 든 채로) 오류의 문장은 답에 가지 않는다.
        let broken = format!(r#"{{"code":"ABCD-2345","cookie":"{}""#, fake_cookie());
        let reply = judge(broken.as_bytes(), &gate, &|_| Stored::Saved, now);
        assert_eq!(reply, Reply::BadRequest);
        assert_eq!(reply.body(), r#"{"ok":false,"reason":"bad_request"}"#);
    }

    #[test]
    fn only_requests_worth_showing_reach_the_screen_and_their_messages_are_korean() {
        for reply in every_reply() {
            let notable = matches!(
                reply,
                Reply::Received
                    | Reply::WrongCode
                    | Reply::Locked { .. }
                    | Reply::NotLoggedIn
                    | Reply::CookieRejected
                    | Reply::Busy
                    | Reply::StoreFailed
            );
            assert_eq!(reply.notable(), notable, "{reply:?}");
            if notable {
                assert!(has_korean(&activity_message(reply, 3)), "{reply:?}");
            }
        }
        assert!(activity_message(Reply::WrongCode, 3).contains("연속 3회"));
        assert!(activity_message(Reply::Locked { seconds: 42 }, 5).contains("42초"));
    }

    #[test]
    fn errors_are_korean_and_name_the_port() {
        for error in [
            LinkError::PortInUse { port: PORT },
            LinkError::Bind { port: PORT, detail: "os error".to_string() },
            LinkError::Thread { detail: "os error".to_string() },
            LinkError::Random { detail: "os error".to_string() },
        ] {
            assert!(has_korean(&error.to_string()), "{error:?}");
        }
        assert!(LinkError::PortInUse { port: PORT }.to_string().contains("127.0.0.1:47615"));
    }
}
