//! 세션 쿠키 — 순수 규칙. 파일·창·프로세스·네트워크를 모른다.
//!
//! blablalink의 세션 쿠키는 **계정 접근권**이다. 이 모듈의 타입은 값을 글자로 내보이지 않는다:
//! `Debug`·`Display`는 값을 가리고, 오류 문장에는 쿠키 이름(`game_token` 같은 정해진 이름)만 들어간다.
//! 값을 꺼내는 길은 `SessionCookie::header` 하나이고, 그것을 부르는 곳은 엔진의 쿠키 파일에 쓰는 곳
//! (`account_sync::write_cookie_file`)뿐이다.
//!
//! - `normalize_pasted`: 사용자가 붙여넣은 글자 → Cookie 헤더 한 줄(앞뒤 공백·줄바꿈 정리, 필수 쿠키 확인)
//! - `header_from_browser_cookies`: 로그인 창의 쿠키 목록 → Cookie 헤더 한 줄(도메인이 맞는 것만, 필수 쿠키 확인)
//! - `Redactor`: 수집 스크립트가 낸 줄에서 쿠키 값을 가린다

use std::fmt;

/// 수집에 꼭 필요한 쿠키. 엔진의 수집 스크립트가 `game_token`으로 로그인 세션을, `game_openid`로 계정을 안다.
pub const REQUIRED_COOKIES: [&str; 2] = ["game_token", "game_openid"];

/// 수집 스크립트가 요청을 보내는 곳. 로그인 창에서는 이 호스트로 가는 요청에 실릴 쿠키만 받는다.
pub const API_HOST: &str = "api.blablalink.com";

/// 쿠키 헤더 한 줄의 최대 글자 수. 이보다 길면 쿠키가 아닌 것을 붙여넣은 것으로 본다.
pub const MAX_COOKIE_CHARS: usize = 16 * 1024;

/// 가린 자리에 넣는 글자.
pub const MASK: &str = "(가림)";

/// 이 글자 수 이상인 쿠키 값은 값만 따로 나와도 가린다. 더 짧은 값(`1`, `ko` 같은 것)은 `이름=값` 꼴일 때만 가린다 —
/// 짧은 값까지 가리면 스크립트의 보통 문장이 전부 가려진다.
pub const MIN_SECRET_CHARS: usize = 6;

/// 쿠키를 받아들이지 못한 이유. 문장에 쿠키 값은 들어가지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CookieError {
    /// 붙여넣은 것이 비어 있다.
    Empty,
    /// 너무 길다.
    TooLong { chars: usize },
    /// 쿠키 헤더에 올 수 없는 글자(제어 문자, 영문·숫자·기호가 아닌 글자)가 있다.
    Malformed,
    /// 필수 쿠키가 없다(붙여넣기).
    MissingRequired { missing: Vec<&'static str> },
    /// 필수 쿠키가 없다(로그인 창) — 아직 로그인하지 않았다.
    NotLoggedIn { missing: Vec<&'static str> },
}

impl fmt::Display for CookieError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "붙여넣은 쿠키가 비어 있다"),
            Self::TooLong { chars } => write!(
                f,
                "쿠키가 너무 길다({chars}자, 최대 {MAX_COOKIE_CHARS}자) — Cookie 헤더 한 줄만 붙여넣어라"
            ),
            Self::Malformed => write!(
                f,
                "쿠키에 올 수 없는 글자가 있다 — 요청 머리글의 Cookie 값 한 줄을 그대로 붙여넣어라"
            ),
            Self::MissingRequired { missing } => write!(
                f,
                "쿠키에 {}가 없다 — 로그인한 상태에서 {API_HOST} 요청의 Cookie 헤더 전체를 복사했는지 확인하라",
                names(missing)
            ),
            Self::NotLoggedIn { missing } => write!(
                f,
                "아직 로그인되지 않았다({} 쿠키가 없다) — 로그인 창에서 blablalink에 로그인하고 게임 계정을 연동한 뒤 다시 눌러라",
                names(missing)
            ),
        }
    }
}

impl std::error::Error for CookieError {}

fn names(missing: &[&'static str]) -> String {
    missing
        .iter()
        .map(|name| format!("{name}="))
        .collect::<Vec<_>>()
        .join(", ")
}

/// 확인을 마친 Cookie 헤더 한 줄(`이름=값; 이름=값`). 값을 글자로 내보이지 않는다.
#[derive(Clone, PartialEq, Eq)]
pub struct SessionCookie(String);

impl SessionCookie {
    /// 헤더 한 줄 그대로. **쿠키 파일에 쓸 때만 부른다** — 로그·오류·반환값·이벤트에 넣지 않는다.
    pub(crate) fn header(&self) -> &str {
        &self.0
    }

    /// 든 쿠키의 수.
    pub fn count(&self) -> usize {
        pieces(&self.0).count()
    }
}

impl fmt::Debug for SessionCookie {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SessionCookie(쿠키 {}개, 값은 {MASK})", self.count())
    }
}

/// 로그인 창의 쿠키 저장소에서 읽은 쿠키 하나. 값을 글자로 내보이지 않는다.
#[derive(Clone, PartialEq, Eq)]
pub struct BrowserCookie {
    pub name: String,
    pub value: String,
    /// 쿠키의 도메인(`.blablalink.com` 같은 것). 저장소가 알려 주지 않았으면 `None`.
    pub domain: Option<String>,
}

impl fmt::Debug for BrowserCookie {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BrowserCookie")
            .field("name", &self.name)
            .field("value", &MASK)
            .field("domain", &self.domain)
            .finish()
    }
}

/// 헤더 한 줄을 `;`로 나눈 조각(앞뒤 공백을 뗀, 비지 않은 것).
fn pieces(header: &str) -> impl Iterator<Item = &str> {
    header.split(';').map(str::trim).filter(|p| !p.is_empty())
}

/// 조각 하나를 `(이름, 값)`으로. `=`가 없으면 `None`.
fn pair(piece: &str) -> Option<(&str, &str)> {
    let (name, value) = piece.split_once('=')?;
    Some((name.trim(), value.trim()))
}

/// 헤더에 든 필수 쿠키 가운데 없는 것(값이 빈 것도 없는 것으로 친다).
fn missing_required(header: &str) -> Vec<&'static str> {
    REQUIRED_COOKIES
        .into_iter()
        .filter(|required| {
            !pieces(header)
                .filter_map(pair)
                .any(|(name, value)| name == *required && !value.is_empty())
        })
        .collect()
}

/// 헤더 값에 올 수 있는 글자인가: 눈에 보이는 ASCII와 공백. 수집 스크립트는 헤더를 그대로 보내므로
/// 다른 글자(한글, 제어 문자)가 있으면 요청 자체가 만들어지지 않는다.
fn header_char(c: char) -> bool {
    c == ' ' || c.is_ascii_graphic()
}

/// 사용자가 붙여넣은 글자를 Cookie 헤더 한 줄로 정리한다.
///
/// - 앞뒤 공백과 줄바꿈을 정리해 한 줄로 만든다(줄이 `;`로 끝났으면 다음 줄을 띄어서, 아니면 붙여서 잇는다 —
///   값 한가운데서 줄이 바뀐 것으로 본다)
/// - 맨 앞의 `Cookie:`는 뗀다(헤더 줄을 통째로 복사한 경우)
/// - `game_token=`과 `game_openid=`가 없으면 거부한다
pub fn normalize_pasted(text: &str) -> Result<SessionCookie, CookieError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut line = String::new();
    for part in text.split(['\r', '\n']).map(str::trim).filter(|p| !p.is_empty()) {
        if line.ends_with(';') {
            line.push(' ');
        }
        line.push_str(part);
    }
    let mut body = line.trim();
    if let Some(head) = body.get(..7) {
        if head.eq_ignore_ascii_case("cookie:") {
            body = body[7..].trim();
        }
    }
    if body.is_empty() {
        return Err(CookieError::Empty);
    }
    let chars = body.chars().count();
    if chars > MAX_COOKIE_CHARS {
        return Err(CookieError::TooLong { chars });
    }
    if !body.chars().all(header_char) {
        return Err(CookieError::Malformed);
    }
    let header = pieces(body).collect::<Vec<_>>().join("; ");
    let missing = missing_required(&header);
    if !missing.is_empty() {
        return Err(CookieError::MissingRequired { missing });
    }
    Ok(SessionCookie(header))
}

/// 쿠키의 도메인이 그 호스트로 가는 요청에 실리는 도메인인가: 호스트와 같거나 그 윗도메인이다.
/// 맨 앞의 점은 무시한다(`.blablalink.com`). 점이 없는 도메인(`com`)은 받지 않는다.
pub fn domain_matches(cookie_domain: &str, host: &str) -> bool {
    let domain = cookie_domain.trim().trim_start_matches('.').to_ascii_lowercase();
    let host = host.trim().to_ascii_lowercase();
    if domain.is_empty() || !domain.contains('.') {
        return false;
    }
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// 쿠키 이름으로 쓸 수 있는가: 비지 않고, 구분 글자(`=`, `;`, 공백 등)가 없는 눈에 보이는 ASCII.
fn cookie_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_graphic() && !matches!(c, '=' | ';' | ',' | '"'))
}

/// 쿠키 값으로 쓸 수 있는가: `;`가 없는 눈에 보이는 ASCII(빈 값도 된다).
fn cookie_value(value: &str) -> bool {
    value.chars().all(|c| c.is_ascii_graphic() && c != ';')
}

/// 로그인 창의 쿠키 목록 → `host`로 가는 요청에 실릴 Cookie 헤더 한 줄.
///
/// - 도메인이 `host`와 맞는 쿠키만 쓴다(도메인을 모르는 쿠키는, 저장소에 그 주소의 쿠키를 물어 받은 것이므로 쓴다)
/// - `이름=값` 꼴로 쓸 수 없는 쿠키는 뺀다
/// - 필수 쿠키(`game_token`, `game_openid`)가 없으면 아직 로그인하지 않은 것이다
pub fn header_from_browser_cookies(
    cookies: &[BrowserCookie],
    host: &str,
) -> Result<SessionCookie, CookieError> {
    let header = cookies
        .iter()
        .filter(|c| c.domain.as_deref().is_none_or(|d| domain_matches(d, host)))
        .filter(|c| cookie_name(&c.name) && cookie_value(&c.value))
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ");
    let missing = missing_required(&header);
    if !missing.is_empty() {
        return Err(CookieError::NotLoggedIn { missing });
    }
    let chars = header.chars().count();
    if chars > MAX_COOKIE_CHARS {
        return Err(CookieError::TooLong { chars });
    }
    Ok(SessionCookie(header))
}

/// 저장된 쿠키 파일의 내용에 `game_token=`이 있는가(수집 스크립트가 시작할 때 보는 것과 같은 확인).
pub fn has_game_token(file_text: &str) -> bool {
    file_text.contains("game_token=")
}

/// 글자 줄에서 쿠키 값을 가린다. 수집 스크립트가 쿠키를 출력해도(오류 문장, 디버그 출력) 화면·이벤트로
/// 그 값이 나가지 않게 한다.
///
/// 가리는 것: 쿠키 파일의 내용 전체, `이름=값` 조각 하나하나, 그리고 `MIN_SECRET_CHARS`자 이상인 값.
#[derive(Clone, Default)]
pub struct Redactor {
    /// 긴 것부터. 긴 것을 먼저 가려야 그 안의 짧은 조각만 가려지고 나머지가 남는 일이 없다.
    secrets: Vec<String>,
}

impl fmt::Debug for Redactor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Redactor(가릴 글자 {}개)", self.secrets.len())
    }
}

impl Redactor {
    /// 아무것도 가리지 않는다.
    pub fn none() -> Self {
        Self::default()
    }

    /// 쿠키 파일의 내용(헤더 한 줄)에서 가릴 글자를 뽑는다.
    pub fn for_cookie_text(text: &str) -> Self {
        let whole = text.trim();
        let mut secrets: Vec<String> = Vec::new();
        if !whole.is_empty() {
            secrets.push(whole.to_string());
        }
        for piece in pieces(whole) {
            secrets.push(piece.to_string());
            if let Some((_, value)) = pair(piece) {
                if value.chars().count() >= MIN_SECRET_CHARS {
                    secrets.push(value.to_string());
                }
            }
        }
        secrets.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        secrets.dedup();
        Self { secrets }
    }

    /// 줄에 든 쿠키 값을 `MASK`로 바꾼다.
    pub fn redact(&self, line: &str) -> String {
        let mut out = line.to_string();
        for secret in &self.secrets {
            if out.contains(secret.as_str()) {
                out = out.replace(secret.as_str(), MASK);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 테스트용 가짜 쿠키. 실제 계정의 값이 아니다.
    const TOKEN: &str = "FAKE-TOKEN-7f3a9c2e51b84d06";
    const OPENID: &str = "99887766554433221100";

    fn fake_header() -> String {
        format!("game_token={TOKEN}; game_openid={OPENID}; game_gameid=29080; lang=ko")
    }

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    fn browser(name: &str, value: &str, domain: Option<&str>) -> BrowserCookie {
        BrowserCookie {
            name: name.to_string(),
            value: value.to_string(),
            domain: domain.map(str::to_string),
        }
    }

    #[test]
    fn pasted_text_becomes_one_trimmed_line() {
        let expected = fake_header();
        let variants = [
            expected.clone(),
            format!("  \r\n{expected}\r\n\r\n  "),
            format!("\u{feff}{expected}\n"),
            format!("Cookie: {expected}"),
            format!("cookie:{expected}"),
            // 헤더 줄이 `;`에서 꺾여 여러 줄이 된 경우.
            format!("game_token={TOKEN};\r\n  game_openid={OPENID};\n game_gameid=29080;\n lang=ko\n"),
            // 값 한가운데서 꺾인 경우 — 붙여서 잇는다.
            format!("game_token=FAKE-TOKEN-\n7f3a9c2e51b84d06; game_openid={OPENID}; game_gameid=29080; lang=ko"),
            // 구분 글자 주변의 공백과 끝의 `;`.
            format!("game_token={TOKEN} ;game_openid={OPENID};   game_gameid=29080;lang=ko;"),
        ];
        for text in variants {
            let cookie = normalize_pasted(&text).unwrap_or_else(|e| panic!("{e:?}"));
            assert_eq!(cookie.header(), expected);
            assert_eq!(cookie.count(), 4);
            assert!(!cookie.header().contains(['\r', '\n']));
        }
    }

    #[test]
    fn pasted_text_without_required_cookies_is_rejected_in_korean() {
        let no_token = format!("game_openid={OPENID}; lang=ko");
        assert_eq!(
            normalize_pasted(&no_token),
            Err(CookieError::MissingRequired { missing: vec!["game_token"] })
        );
        let no_openid = format!("game_token={TOKEN}; lang=ko");
        assert_eq!(
            normalize_pasted(&no_openid),
            Err(CookieError::MissingRequired { missing: vec!["game_openid"] })
        );
        // 이름만 있고 값이 비었으면 없는 것이다. 다른 이름의 일부로 들어 있는 것도 아니다.
        let empty_value = format!("game_token=; game_openid={OPENID}");
        assert!(matches!(normalize_pasted(&empty_value), Err(CookieError::MissingRequired { .. })));
        let lookalike = format!("xgame_token={TOKEN}; game_openid={OPENID}");
        assert!(matches!(normalize_pasted(&lookalike), Err(CookieError::MissingRequired { .. })));
        let both = normalize_pasted("lang=ko; theme=dark").unwrap_err();
        assert_eq!(both, CookieError::MissingRequired { missing: vec!["game_token", "game_openid"] });
        let message = both.to_string();
        assert!(message.contains("game_token=") && message.contains("game_openid="), "{message}");
        assert!(has_korean(&message));
    }

    #[test]
    fn empty_too_long_and_odd_characters_are_rejected() {
        for text in ["", "   ", "\r\n\n", "Cookie:", "cookie:   \n"] {
            assert_eq!(normalize_pasted(text), Err(CookieError::Empty), "{text:?}");
        }
        let long = format!("{}; pad={}", fake_header(), "x".repeat(MAX_COOKIE_CHARS));
        assert!(matches!(normalize_pasted(&long), Err(CookieError::TooLong { .. })));
        for text in [
            format!("{}; 이름=값", fake_header()),
            format!("game_token={TOKEN}\tx; game_openid={OPENID}"),
            format!("{}\u{0}", fake_header()),
        ] {
            assert_eq!(normalize_pasted(&text), Err(CookieError::Malformed));
        }
    }

    #[test]
    fn no_error_message_or_debug_output_shows_a_cookie_value() {
        let secret_inputs = [
            format!("game_token={TOKEN}"),
            format!("game_openid={OPENID}"),
            format!("game_token={TOKEN}; game_openid={OPENID}; 한글=값"),
            format!("{}; pad={}", fake_header(), "x".repeat(MAX_COOKIE_CHARS)),
        ];
        for text in secret_inputs {
            let err = normalize_pasted(&text).unwrap_err();
            for shown in [err.to_string(), format!("{err:?}")] {
                assert!(!shown.contains(TOKEN) && !shown.contains(OPENID), "{shown}");
                assert!(has_korean(&err.to_string()));
            }
        }
        let cookie = normalize_pasted(&fake_header()).unwrap();
        let shown = format!("{cookie:?}");
        assert!(!shown.contains(TOKEN) && !shown.contains(OPENID), "{shown}");
        let shown = format!("{:?}", browser("game_token", TOKEN, Some(".blablalink.com")));
        assert!(!shown.contains(TOKEN), "{shown}");
        assert!(shown.contains("game_token") && shown.contains(MASK));
        let shown = format!("{:?}", Redactor::for_cookie_text(&fake_header()));
        assert!(!shown.contains(TOKEN) && !shown.contains(OPENID), "{shown}");
    }

    #[test]
    fn cookie_domains_match_the_host_or_its_parents_only() {
        for domain in ["api.blablalink.com", ".blablalink.com", "blablalink.com", " .BlablaLink.com "] {
            assert!(domain_matches(domain, API_HOST), "{domain}");
        }
        for domain in [
            "www.blablalink.com",
            "evilblablalink.com",
            "blablalink.com.evil.example",
            "x.api.blablalink.com",
            "google.com",
            "com",
            ".com",
            "",
            ".",
        ] {
            assert!(!domain_matches(domain, API_HOST), "{domain}");
        }
    }

    #[test]
    fn browser_cookies_become_a_header_of_matching_domains_only() {
        let cookies = [
            browser("game_token", TOKEN, Some(".blablalink.com")),
            browser("tracker", "should-not-be-sent", Some(".google.com")),
            browser("game_openid", OPENID, Some("api.blablalink.com")),
            browser("www_only", "nope", Some("www.blablalink.com")),
            browser("game_gameid", "29080", None),
            browser("lang", "ko", Some("blablalink.com")),
        ];
        let cookie = header_from_browser_cookies(&cookies, API_HOST).unwrap();
        assert_eq!(
            cookie.header(),
            format!("game_token={TOKEN}; game_openid={OPENID}; game_gameid=29080; lang=ko")
        );
        // 붙여넣기로 받은 것과 같은 모양이다 — 다시 정리해도 그대로다.
        assert_eq!(normalize_pasted(cookie.header()).unwrap(), cookie);
    }

    #[test]
    fn browser_cookies_that_cannot_be_written_as_name_value_are_left_out() {
        let cookies = [
            browser("game_token", TOKEN, Some(".blablalink.com")),
            browser("game_openid", OPENID, Some(".blablalink.com")),
            browser("", "no-name", Some(".blablalink.com")),
            browser("bad name", "x", Some(".blablalink.com")),
            browser("semi", "a;b", Some(".blablalink.com")),
            browser("eq=", "x", Some(".blablalink.com")),
            browser("newline", "a\nb", Some(".blablalink.com")),
            browser("한글", "x", Some(".blablalink.com")),
            browser("empty_ok", "", Some(".blablalink.com")),
        ];
        let cookie = header_from_browser_cookies(&cookies, API_HOST).unwrap();
        assert_eq!(
            cookie.header(),
            format!("game_token={TOKEN}; game_openid={OPENID}; empty_ok=")
        );
    }

    #[test]
    fn missing_login_cookies_mean_not_logged_in() {
        // 로그인 전: 사이트가 심은 쿠키만 있다.
        let before = [browser("lang", "ko", Some(".blablalink.com"))];
        assert_eq!(
            header_from_browser_cookies(&before, API_HOST),
            Err(CookieError::NotLoggedIn { missing: vec!["game_token", "game_openid"] })
        );
        assert_eq!(
            header_from_browser_cookies(&[], API_HOST),
            Err(CookieError::NotLoggedIn { missing: vec!["game_token", "game_openid"] })
        );
        // 필수 쿠키가 다른 사이트의 것이면 없는 것이다.
        let elsewhere = [
            browser("game_token", TOKEN, Some(".example.com")),
            browser("game_openid", OPENID, Some(".blablalink.com")),
        ];
        let err = header_from_browser_cookies(&elsewhere, API_HOST).unwrap_err();
        assert_eq!(err, CookieError::NotLoggedIn { missing: vec!["game_token"] });
        let message = err.to_string();
        assert!(message.contains("아직 로그인되지 않았다"), "{message}");
        assert!(!message.contains(TOKEN) && !message.contains(OPENID), "{message}");
        // 값이 빈 필수 쿠키도 없는 것이다.
        let blank = [
            browser("game_token", "", Some(".blablalink.com")),
            browser("game_openid", OPENID, Some(".blablalink.com")),
        ];
        assert!(matches!(
            header_from_browser_cookies(&blank, API_HOST),
            Err(CookieError::NotLoggedIn { .. })
        ));
    }

    #[test]
    fn redactor_masks_the_cookie_wherever_a_line_carries_it() {
        let header = fake_header();
        let redactor = Redactor::for_cookie_text(&format!("{header}\n"));
        let lines = [
            format!("[debug] cookie = {header}"),
            format!("Cookie: {header}"),
            format!("[!] 실패: token {TOKEN} rejected"),
            format!("[+] openid {OPENID} (area 83): 캐릭터 121종"),
            format!("game_openid={OPENID};game_token={TOKEN}"),
            format!("{{'Cookie': 'lang=ko; game_token={TOKEN}'}}"),
        ];
        for line in &lines {
            let shown = redactor.redact(line);
            assert!(!shown.contains(TOKEN), "{shown}");
            assert!(!shown.contains(OPENID), "{shown}");
            assert!(shown.contains(MASK), "{shown}");
        }
        // 가린 줄에도 나머지 글자는 남는다 — 줄을 통째로 버리지 않는다.
        assert_eq!(
            redactor.redact(&lines[3]),
            format!("[+] openid {MASK} (area 83): 캐릭터 121종")
        );
    }

    #[test]
    fn redactor_leaves_ordinary_lines_alone() {
        let redactor = Redactor::for_cookie_text(&fake_header());
        for line in [
            "[+] 상세 수집 중… (동기화 소대 100종 · 소대 밖 21종)",
            "[!] 애장품 단계 3 미만 2명",
            // 짧은 값(`ko`, `29080`)은 값만으로는 가리지 않는다.
            "language ko, game 29080",
            "",
        ] {
            assert_eq!(redactor.redact(line), line);
        }
        // `이름=값` 꼴이면 짧은 값도 가린다.
        assert_eq!(redactor.redact("sent lang=ko"), format!("sent {MASK}"));
        assert_eq!(Redactor::none().redact(&fake_header()), fake_header());
        assert_eq!(Redactor::for_cookie_text("  \n").redact("그대로"), "그대로");
    }

    #[test]
    fn game_token_check_matches_the_scripts_own_check() {
        assert!(has_game_token(&fake_header()));
        assert!(!has_game_token("game_openid=1; lang=ko"));
        assert!(!has_game_token(""));
    }
}
