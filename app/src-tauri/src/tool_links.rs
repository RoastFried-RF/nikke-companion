//! 도구 링크(P-033): 커뮤니티 도구 목록의 주소를 **기본 브라우저**로 연다.
//!
//! - 목록은 저장소의 데이터 파일(`data/links/tools.json` — 출처는 그 파일의 `source`)이고, 빌드할 때 실행 파일에 들어간다.
//!   실행 중에 다른 파일이나 네트워크에서 목록을 읽지 않는다.
//! - **여는 주소는 목록에 있는 것뿐이다.** 화면이 넘기는 것은 주소가 아니라 목록의 id다 — id가 목록에 없으면 아무것도
//!   열지 않는다. 화면이 임의의 주소·파일·프로그램을 열 길이 없다(셸·열기 플러그인을 쓰지 않는다 — 권한도 없다).
//! - 목록의 주소도 한 번 더 본다: `https://`로 시작하는 평범한 주소(호스트와 길뿐 — 공백·따옴표·`?`·`#`·`@`·`%`·`\` 없음)만 연다.
//!   같은 검사가 화면 쪽 순수 모듈(`src/core/links.mjs`)에도 있다.
//! - 이 앱은 그 사이트의 내용을 가져오지 않는다. 이 모듈은 네트워크를 쓰지 않는다 — 운영체제에 「이 주소를 열어라」고 할 뿐이다.

use std::fmt;
use std::sync::OnceLock;

use serde::Serialize;
use serde_json::Value;

/// 도구 목록(저장소의 데이터 파일 그대로).
const LINKS_JSON: &str = include_str!("../../../data/links/tools.json");
/// 목록 문서의 종류와 판(`src/core/links.mjs`의 TOOL_LINKS_KIND·TOOL_LINKS_SCHEMA_VERSION과 같아야 한다).
pub const LINKS_KIND: &str = "tool_links";
pub const LINKS_SCHEMA_VERSION: u64 = 1;
/// id와 주소의 길이 한도.
pub const ID_MAX: usize = 40;
pub const URL_MAX: usize = 200;

/// 목록의 도구 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolLink {
    pub id: String,
    pub name: String,
    pub url: String,
}

/// 한국어 문장으로 화면에 보이는 실패.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// 목록에 없는 id다(주소·경로를 넘긴 것도 여기에 든다).
    Unknown,
    /// 운영체제가 열지 못했다.
    OpenFailed { detail: String },
    /// 이 운영체제에서는 여는 길을 만들지 않았다.
    Unsupported,
}

impl fmt::Display for LinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown => write!(f, "목록에 없는 도구다 — 열지 않았다"),
            Self::OpenFailed { detail } => write!(
                f,
                "기본 브라우저로 열지 못했다 ({detail}). 주소를 직접 브라우저에 적어 연다"
            ),
            Self::Unsupported => write!(f, "이 운영체제에서는 브라우저로 여는 기능을 지원하지 않는다"),
        }
    }
}

impl std::error::Error for LinkError {}

/// 목록의 열쇠로 쓸 수 있는 id인가: 소문자·숫자와 그 사이의 붙임표, 40자까지.
pub fn is_link_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= ID_MAX
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_host_label(label: &str) -> bool {
    !label.is_empty()
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// 기본 브라우저로 열어도 되는 주소인가: `https://` + 호스트(점으로 나뉜 이름 둘 이상 — 소문자·숫자·붙임표) + 길
/// (글자·숫자와 `/ - _ . ~`). 그 밖의 글자가 하나라도 있으면 거부한다(목록의 주소에는 필요 없다).
pub fn is_safe_url(url: &str) -> bool {
    if url.len() > URL_MAX {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let (host, path) = match rest.find('/') {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, ""),
    };
    let labels: Vec<&str> = host.split('.').collect();
    labels.len() >= 2
        && labels.iter().all(|label| is_host_label(label))
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~'))
}

/// 목록 문서에서 열 수 있는 도구만 뽑는다. 종류·판이 다르면 빈 목록이다(아무것도 열지 못한다).
/// id나 주소가 검사를 지나지 못한 항목, id가 겹치는 항목(뒤의 것)은 뺀다.
pub fn parse_links(text: &str) -> Vec<ToolLink> {
    let Ok(doc) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    if doc.get("kind").and_then(Value::as_str) != Some(LINKS_KIND)
        || doc.get("schema_version").and_then(Value::as_u64) != Some(LINKS_SCHEMA_VERSION)
    {
        return Vec::new();
    }
    let mut links: Vec<ToolLink> = Vec::new();
    for item in doc.get("links").and_then(Value::as_array).into_iter().flatten() {
        let text_of = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
        let link = ToolLink {
            id: text_of("id"),
            name: text_of("name"),
            url: text_of("url"),
        };
        if is_link_id(&link.id) && is_safe_url(&link.url) && !links.iter().any(|l| l.id == link.id) {
            links.push(link);
        }
    }
    links
}

/// 앱에 든 도구 목록(한 번만 읽는다).
pub fn links() -> &'static [ToolLink] {
    static LINKS: OnceLock<Vec<ToolLink>> = OnceLock::new();
    LINKS.get_or_init(|| parse_links(LINKS_JSON))
}

/// id로 도구를 찾는다. 목록에 없으면 거부한다 — 화면이 넘긴 글자를 주소로 쓰지 않는다.
pub fn resolve<'a>(list: &'a [ToolLink], id: &str) -> Result<&'a ToolLink, LinkError> {
    if !is_link_id(id) {
        return Err(LinkError::Unknown);
    }
    list.iter().find(|l| l.id == id).ok_or(LinkError::Unknown)
}

/// 목록에서 찾은 도구의 주소를 `opener`로 연다. 목록에 없는 id면 `opener`를 부르지 않는다.
/// (여는 일을 인자로 받는 것은 테스트가 브라우저를 띄우지 않고 무엇이 열릴지 보기 위해서다.)
pub fn open_with(
    list: &[ToolLink],
    id: &str,
    opener: impl FnOnce(&str) -> Result<(), LinkError>,
) -> Result<ToolLink, LinkError> {
    let link = resolve(list, id)?;
    opener(&link.url)?;
    Ok(link.clone())
}

/// 그 id의 도구를 기본 브라우저로 연다. 연 도구(이름·주소)를 돌려준다.
pub fn open(id: &str) -> Result<ToolLink, LinkError> {
    open_with(links(), id, open_in_browser)
}

/// 주소를 기본 브라우저로 연다(운영체제의 「열기」). 부르는 쪽이 `is_safe_url`을 지난 목록의 주소만 넘긴다 —
/// 그래도 여기서 한 번 더 본다(이 함수가 다른 것을 여는 데 쓰이지 않게).
#[cfg(windows)]
fn open_in_browser(url: &str) -> Result<(), LinkError> {
    use windows::core::{w, HSTRING};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if !is_safe_url(url) {
        return Err(LinkError::Unknown);
    }
    let target = HSTRING::from(url);
    // 셸의 「열기」는 단일 스레드 아파트를 기대한다 — 이 일만 하는 스레드를 따로 쓴다(앱의 다른 스레드의 COM 상태를 바꾸지 않는다).
    let outcome = std::thread::spawn(move || {
        // SAFETY: 이 스레드에서만 COM을 켜고, 끝나기 전에 끈다. ShellExecuteW에는 살아 있는 문자열만 넘긴다.
        unsafe {
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).is_ok();
            let result = ShellExecuteW(None, w!("open"), &target, None, None, SW_SHOWNORMAL);
            if initialized {
                CoUninitialize();
            }
            // 32보다 크면 성공이다(그 아래는 오류 번호).
            result.0 as isize
        }
    })
    .join()
    .map_err(|_| LinkError::OpenFailed {
        detail: "여는 중에 멈췄다".to_string(),
    })?;
    if outcome > 32 {
        Ok(())
    } else {
        Err(LinkError::OpenFailed {
            detail: format!("오류 번호 {outcome}"),
        })
    }
}

#[cfg(not(windows))]
fn open_in_browser(_url: &str) -> Result<(), LinkError> {
    Err(LinkError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// 작업이 정한 목록(대화형 세션이 직접 열어 확인한 것) — 데이터 파일이 이것과 같아야 한다.
    const EXPECTED: [(&str, &str); 13] = [
        ("레츠도로", "https://letsdoro.com/"),
        ("니케 장비 현황", "https://nikkegear885.github.io/nikke-/"),
        ("딜도로", "https://dildoro.com/"),
        ("Enikk", "https://enikk.app/"),
        ("도로파티", "https://doroparty.com/"),
        ("니케 금서고", "https://nikkeforbiddenlibrary.com/"),
        ("NIKKE PvP META", "https://inspiring-hotteok-9de45f.netlify.app/"),
        ("NIKKE DECK", "https://nikke-deck.com/ko/deck"),
        ("NIKKE Arena Tools", "https://nikke.top/"),
        ("소장품 강화 시뮬레이터", "https://changjoeconomy.github.io/collectibles/"),
        ("니붕 시뮬레이터", "https://nibung.kr/"),
        ("니케피그", "https://nikkefig.com/"),
        ("홍련 농장", "https://scarletfarm.app/"),
    ];

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    #[test]
    fn the_embedded_list_is_exactly_the_checked_tools() {
        let found: Vec<(&str, &str)> = links().iter().map(|l| (l.name.as_str(), l.url.as_str())).collect();
        assert_eq!(found, EXPECTED.to_vec());
        // id는 겹치지 않고, 모두 열쇠로 쓸 수 있는 글자다.
        let mut ids: Vec<&str> = links().iter().map(|l| l.id.as_str()).collect();
        assert!(ids.iter().all(|id| is_link_id(id)));
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), EXPECTED.len());
        // 데이터 파일에 든 항목이 검사에서 하나도 빠지지 않았다.
        let doc: Value = serde_json::from_str(LINKS_JSON).unwrap();
        assert_eq!(doc["links"].as_array().unwrap().len(), EXPECTED.len());
        // 출처가 적혀 있다.
        assert!(doc["source"]["title"].as_str().is_some_and(|t| t.contains("모음집")));
    }

    #[test]
    fn only_ids_in_the_list_open_and_only_their_own_address() {
        for link in links() {
            let opened = RefCell::new(Vec::new());
            let done = open_with(links(), &link.id, |url| {
                opened.borrow_mut().push(url.to_string());
                Ok(())
            })
            .unwrap();
            assert_eq!(done, *link);
            assert_eq!(*opened.borrow(), vec![link.url.clone()]);
        }
    }

    #[test]
    fn anything_that_is_not_a_listed_id_opens_nothing() {
        let tries = [
            "",
            " ",
            "letsdoro ",
            "LETSDORO",
            "없는-도구",
            "unknown-tool",
            "https://letsdoro.com/",
            "https://example.com/",
            "http://letsdoro.com/",
            "letsdoro.com",
            "//example.com",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\System32\\calc.exe",
            "calc.exe",
            "cmd /c calc",
            "..",
            "../letsdoro",
            "letsdoro/../x",
            "letsdoro?x=1",
            "letsdoro#x",
            "letsdoro\n",
            "letsdoro\0",
            "-letsdoro",
            "lets--doro",
            "ms-settings:",
            "shell:startup",
        ];
        for id in tries {
            let called = RefCell::new(0);
            let err = open_with(links(), id, |_| {
                *called.borrow_mut() += 1;
                Ok(())
            })
            .unwrap_err();
            assert_eq!(err, LinkError::Unknown, "{id:?}");
            assert_eq!(*called.borrow(), 0, "{id:?}");
        }
        // 너무 긴 글자도 마찬가지다.
        assert_eq!(resolve(links(), &"a".repeat(ID_MAX + 1)), Err(LinkError::Unknown));
    }

    #[test]
    fn only_plain_https_addresses_pass() {
        for (_, url) in EXPECTED {
            assert!(is_safe_url(url), "{url}");
        }
        for bad in [
            "",
            "https://",
            "https:///x",
            "https://localhost/",
            "http://letsdoro.com/",
            "HTTPS://letsdoro.com/",
            "ftp://letsdoro.com/",
            "file:///C:/x",
            "javascript:alert(1)",
            "https://letsdoro.com/?q=1",
            "https://letsdoro.com/#top",
            "https://user@letsdoro.com/",
            "https://letsdoro.com:8443/",
            "https://letsdoro.com/a b",
            "https://letsdoro.com/\"x\"",
            "https://letsdoro.com/%2e%2e",
            "https://letsdoro.com\\x",
            "https://lets doro.com/",
            "https://-letsdoro.com/",
            "https://letsdoro-.com/",
            "https://letsdoro..com/",
            "https://LetsDoro.com/",
            "https://letsdoro.com/\n",
            " https://letsdoro.com/",
            "https://letsdoro.com/ & calc",
        ] {
            assert!(!is_safe_url(bad), "{bad:?}");
        }
        assert!(!is_safe_url(&format!("https://a.com/{}", "x".repeat(URL_MAX))));
    }

    #[test]
    fn broken_or_foreign_lists_open_nothing() {
        assert!(parse_links("{ 깨진").is_empty());
        assert!(parse_links(r#"{"kind":"deck_book","schema_version":1,"links":[{"id":"a","name":"A","url":"https://a.com/"}]}"#).is_empty());
        assert!(parse_links(r#"{"kind":"tool_links","schema_version":2,"links":[{"id":"a","name":"A","url":"https://a.com/"}]}"#).is_empty());
        // 검사를 지나지 못한 항목과 id가 겹치는 뒤의 항목은 빠진다.
        let list = parse_links(
            r#"{"kind":"tool_links","schema_version":1,"links":[
                {"id":"a","name":"A","url":"https://a.com/"},
                {"id":"a","name":"A2","url":"https://a2.com/"},
                {"id":"B","name":"B","url":"https://b.com/"},
                {"id":"c","name":"C","url":"http://c.com/"},
                {"id":"d","name":"D","url":"file:///C:/x"},
                {"id":"e","name":"E"},
                "글자"
            ]}"#,
        );
        assert_eq!(list, vec![ToolLink { id: "a".into(), name: "A".into(), url: "https://a.com/".into() }]);
        assert_eq!(resolve(&list, "c"), Err(LinkError::Unknown));
    }

    #[test]
    fn a_failed_open_is_reported_in_korean() {
        let err = open_with(links(), "letsdoro", |_| Err(LinkError::OpenFailed { detail: "오류 번호 31".into() })).unwrap_err();
        assert!(err.to_string().contains("기본 브라우저로 열지 못했다"));
        for e in [LinkError::Unknown, LinkError::Unsupported, err] {
            assert!(has_korean(&e.to_string()), "{e:?}");
        }
    }

    #[test]
    fn this_module_runs_no_program_and_uses_no_network() {
        let source = include_str!("tool_links.rs");
        let code: String = source[..source.find("#[cfg(test)]").unwrap()]
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for banned in ["Command::new", "std::process", "TcpStream", "TcpListener", "UdpSocket", "reqwest", "ureq", "fs::write", "fs::read"] {
            assert!(!code.contains(banned), "{banned}");
        }
        // 운영체제의 「열기」를 부르는 곳은 한 곳이고, 여는 동작은 「open」 하나다(실행·편집·인쇄가 아니다).
        assert_eq!(code.matches("ShellExecuteW(").count(), 1);
        assert!(code.contains(r#"w!("open")"#));
        assert!(!code.contains("runas"));
    }
}
