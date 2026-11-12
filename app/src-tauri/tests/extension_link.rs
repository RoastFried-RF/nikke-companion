//! 크롬 확장 연결 통합 테스트 — 수신부를 실제로 열고(빈 포트), **가짜 요청**을 실제 소켓으로 보낸다.
//!
//! 브라우저도 확장도 띄우지 않는다. 쿠키는 지어낸 글자이고, 쿠키 파일은 임시 폴더의 **가짜 엔진 폴더**에만 쓰인다 —
//! 실제 엔진의 `scraper/.session_cookie`, 앱의 설정 폴더, 실제 포트(47615)는 건드리지 않는다. 이 테스트가 만드는
//! 연결은 모두 이 PC 안(127.0.0.1)에서 끝난다.
//!
//! - 루프백에만 묶인다: 듣는 주소가 127.0.0.1이고, 이 PC의 다른 주소로는 연결되지 않는다
//! - 켰을 때만 열린다(기본 꺼짐·기억), 끄거나 버리면 닫힌다
//! - 정해진 요청 하나만 받는다: 방법·경로·형식·크기·출처·호스트가 다르면 거부한다. 어떤 답에도 다른 출처 허용 헤더가 없다
//! - 연결 코드가 맞는 요청만 받고, 여러 번 틀리면 잠시 막는다. 코드를 다시 만들면 옛 코드는 받지 않는다
//! - 받은 쿠키는 붙여넣기와 같은 정리·검사를 거쳐 엔진의 쿠키 파일 한 곳에만 쓰인다
//! - 쿠키 비노출: 가짜 쿠키가 답·상태(명령 반환값·이벤트에 실리는 것)·Debug 출력·이 프로세스의 표준 출력에 없다
//!
//! Tauri 명령(src/lib.rs의 `extension_link_*`)은 여기서 부르는 `LinkHub`를 그대로 쓴다.

use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use nikke_companion_lib::account_sync::{COOKIE_FILE, FETCH_SCRIPT};
use nikke_companion_lib::extension_link::{
    self, LinkHub, LinkStatus, Stored, DEFAULT_PORT, LOCK_FOR, MAX_BODY_BYTES, MAX_HEAD_BYTES,
    MAX_WRONG_CODES, SESSION_PATH, SETTINGS_FILE,
};
use serde_json::{json, Value};

/// 지어낸 쿠키. 실제 계정의 값이 아니다.
const TOKEN: &str = "FAKE-GAME-TOKEN-link-9bf31c7ff062936a96d3c8bd1f8f2ff3";
const OPENID: &str = "80706050403020109988";
const SHORT: &str = "ko";

/// 크롬 확장의 출처(지어낸 확장 ID).
const EXTENSION: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

fn fake_cookie() -> String {
    format!("game_token={TOKEN}; game_openid={OPENID}; game_gameid=29080; lang={SHORT}")
}

/// 가짜 쿠키의 어떤 조각도 글자에 없다.
fn assert_no_cookie(shown: &str, what: &str) {
    for secret in [TOKEN, OPENID, fake_cookie().as_str(), "lang=ko", "game_gameid=29080"] {
        assert!(!shown.contains(secret), "{what}에 쿠키가 보인다: {shown}");
    }
}

// ── 가짜 엔진 폴더·수신부 ─────────────────────────────────────────────────────

/// 임시 폴더. 가짜 엔진 폴더(수집 스크립트 자리만 있다)와 설정 파일 자리가 들어 있다.
struct Sandbox(PathBuf);

impl Sandbox {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-extension-link-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("engine/scraper")).expect("가짜 엔진 폴더");
        fs::write(dir.join("engine").join(FETCH_SCRIPT), "# 실행하지 않는 자리 표시\n").expect("스크립트");
        Self(dir)
    }

    fn engine(&self) -> PathBuf {
        self.0.join("engine")
    }

    fn cookie_file(&self) -> PathBuf {
        self.engine().join(COOKIE_FILE)
    }

    fn settings(&self) -> PathBuf {
        self.0.join("config").join(SETTINGS_FILE)
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 테스트가 여는 연결 하나: 앱과 같은 방식으로 만든 `LinkHub`(빈 포트)와 그것이 보낸 알림.
struct Link {
    hub: Arc<LinkHub>,
    /// 화면에 알린 횟수와 그때의 상태(앱에서는 `extension-link` 이벤트에 실리는 것).
    events: Arc<Mutex<Vec<LinkStatus>>>,
    /// 수집이 도는 중인 척한다.
    busy: Arc<AtomicBool>,
}

impl Link {
    /// 설정 파일을 읽어 연다(켜 두었으면 곧바로 듣는다). 포트는 빈 포트(0)다.
    fn open(sandbox: &Sandbox) -> Self {
        let engine = sandbox.engine();
        let busy = Arc::new(AtomicBool::new(false));
        let events: Arc<Mutex<Vec<LinkStatus>>> = Arc::new(Mutex::new(Vec::new()));
        let is_busy = Arc::clone(&busy);
        // 앱(lib.rs의 open_extension_link)과 같은 모양: 수집 중이면 받지 않고, 아니면 엔진의 쿠키 파일에 쓴다.
        let sink = move |cookie: &str| {
            if is_busy.load(Ordering::Acquire) {
                return Stored::Busy;
            }
            extension_link::store_in_engine(&engine, cookie)
        };
        // 알림을 받는 쪽은 상태를 읽는다 — 허브가 만들어진 뒤에 채운다(약한 참조: 허브를 붙들어 두지 않는다).
        let slot: Arc<Mutex<Weak<LinkHub>>> = Arc::new(Mutex::new(Weak::new()));
        let (for_event, heard) = (Arc::clone(&slot), Arc::clone(&events));
        let changed = move || {
            let hub = for_event.lock().expect("허브").upgrade();
            if let Some(hub) = hub {
                heard.lock().expect("알림").push(hub.status());
            }
        };
        let hub = Arc::new(LinkHub::open(
            Some(sandbox.settings()),
            0,
            Arc::new(sink),
            Arc::new(changed),
        ));
        *slot.lock().expect("허브") = Arc::downgrade(&hub);
        Self { hub, events, busy }
    }

    /// 열고 켠다.
    fn on(sandbox: &Sandbox) -> Self {
        let link = Self::open(sandbox);
        let status = link.hub.set_enabled(true);
        assert!(status.listening, "수신부가 열리지 않았다: {:?}", status.problem);
        link
    }

    fn addr(&self) -> SocketAddr {
        self.hub.addr().expect("듣고 있지 않다")
    }

    fn code(&self) -> String {
        self.hub.status().code
    }

    fn events(&self) -> Vec<LinkStatus> {
        self.events.lock().expect("알림").clone()
    }

    /// 알림이 `count`개가 될 때까지 잠깐 기다린다(답을 다 쓴 뒤에 알린다).
    fn wait_events(&self, count: usize) -> Vec<LinkStatus> {
        let started = Instant::now();
        while self.events().len() < count && started.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(10));
        }
        self.events()
    }
}

// ── 가짜 요청 ─────────────────────────────────────────────────────────────────

/// 받은 답.
#[derive(Debug)]
struct Answer {
    status: u16,
    /// 헤더 이름(소문자)과 값.
    headers: Vec<(String, String)>,
    body: String,
    /// 답 전체(쿠키가 없는지 볼 때 쓴다).
    raw: String,
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|e| panic!("답의 본문이 JSON이 아니다({e}): {}", self.raw))
    }

    fn reason(&self) -> String {
        self.json()["reason"].as_str().unwrap_or_default().to_string()
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }
}

/// 바이트를 그대로 보내고 답을 끝까지 읽는다(수신부는 답한 뒤 연결을 닫는다).
fn send_raw(addr: SocketAddr, bytes: &[u8]) -> Answer {
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).expect("수신부에 연결");
    stream.set_read_timeout(Some(Duration::from_secs(10))).expect("시한");
    stream.set_write_timeout(Some(Duration::from_secs(10))).expect("시한");
    // 수신부가 머리만 보고 거부하면 본문을 다 받기 전에 답할 수 있다 — 쓰다가 끊겨도 답은 읽는다.
    let _ = stream.write_all(bytes);
    let _ = stream.flush();
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw);
    let _ = stream.shutdown(Shutdown::Both);
    let raw = String::from_utf8(raw).expect("답은 UTF-8이다");
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .unwrap_or_else(|| panic!("답에 빈 줄이 없다: {raw:?}"));
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split(' ').nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or_else(|| panic!("상태 줄을 읽을 수 없다: {raw:?}"));
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    Answer {
        status,
        headers,
        body: body.to_string(),
        raw,
    }
}

/// 요청 하나. 확장이 보내는 모양에서 시작해 칸을 바꿔 가며 쓴다.
#[derive(Clone)]
struct Request {
    method: String,
    target: String,
    origin: Option<String>,
    host: Option<String>,
    content_type: Option<String>,
    body: Vec<u8>,
}

impl Request {
    /// 확장이 보내는 요청: 코드와 쿠키 헤더 한 줄.
    fn from_extension(addr: SocketAddr, code: &str, cookie: &str) -> Self {
        Self {
            method: "POST".to_string(),
            target: SESSION_PATH.to_string(),
            origin: Some(EXTENSION.to_string()),
            host: Some(addr.to_string()),
            content_type: Some("application/json".to_string()),
            body: serde_json::to_vec(&json!({ "code": code, "cookie": cookie })).expect("본문"),
        }
    }

    fn bytes(&self) -> Vec<u8> {
        let mut head = format!("{} {} HTTP/1.1\r\n", self.method, self.target);
        if let Some(host) = &self.host {
            head.push_str(&format!("Host: {host}\r\n"));
        }
        if let Some(origin) = &self.origin {
            head.push_str(&format!("Origin: {origin}\r\n"));
        }
        if let Some(content_type) = &self.content_type {
            head.push_str(&format!("Content-Type: {content_type}\r\n"));
        }
        head.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", self.body.len()));
        let mut bytes = head.into_bytes();
        bytes.extend_from_slice(&self.body);
        bytes
    }

    fn send(&self, addr: SocketAddr) -> Answer {
        send_raw(addr, &self.bytes())
    }
}

/// 확장이 보내는 요청을 그대로 보낸다.
fn post(link: &Link, code: &str, cookie: &str) -> Answer {
    Request::from_extension(link.addr(), code, cookie).send(link.addr())
}

/// 어떤 답에도 다른 출처 허용 헤더가 없고, 쿠키가 없다.
fn assert_closed_to_pages(answer: &Answer) {
    for (name, _) in &answer.headers {
        assert!(
            !name.starts_with("access-control-") && name != "timing-allow-origin",
            "다른 출처 허용 헤더가 있다: {}",
            answer.raw
        );
    }
    assert_eq!(answer.header("connection"), Some("close"), "{}", answer.raw);
    assert_eq!(answer.header("cache-control"), Some("no-store"), "{}", answer.raw);
    assert_no_cookie(&answer.raw, "답");
}

fn refused(addr: SocketAddr) -> bool {
    TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_err()
}

// ── 루프백에만 묶인다·켰을 때만 열린다 ────────────────────────────────────────

/// 이 PC가 바깥과 주고받을 때 쓰는 주소(루프백이 아닌 것). 패킷은 보내지 않는다 — 운영체제에 어느 주소를 쓸지 묻기만 한다.
fn lan_address() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    // 문서용 주소(TEST-NET-1). UDP의 connect는 길을 정할 뿐 아무것도 보내지 않는다.
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

#[test]
fn the_receiver_listens_on_loopback_only_and_cannot_be_reached_through_another_address() {
    let sandbox = Sandbox::new("loopback");
    let link = Link::on(&sandbox);
    let addr = link.addr();
    // 듣는 주소는 127.0.0.1이다(모든 주소 0.0.0.0이 아니다).
    assert_eq!(addr.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert!(addr.ip().is_loopback());
    assert_eq!(link.hub.status().address, addr.to_string());
    assert!(link.hub.status().address.starts_with("127.0.0.1:"));
    // 루프백으로는 닿는다.
    assert_eq!(post(&link, &link.code(), &fake_cookie()).status, 200);

    // 이 PC의 다른 주소(다른 PC가 이 PC를 부를 때 쓰는 주소)로는 같은 포트에 연결되지 않는다.
    match lan_address() {
        Some(lan) => {
            let outside = SocketAddr::new(IpAddr::V4(lan), addr.port());
            assert!(
                refused(outside),
                "루프백이 아닌 주소 {outside}로 수신부에 연결됐다 — 다른 PC에서 닿을 수 있다"
            );
        }
        None => eprintln!("루프백이 아닌 주소가 없는 PC다 — 듣는 주소가 127.0.0.1인 것만 확인했다"),
    }
    // 앱이 쓰는 포트도 루프백의 것이다.
    assert_eq!(DEFAULT_PORT, 47615);
}

#[test]
fn the_receiver_is_closed_by_default_opens_only_when_switched_on_and_closes_when_switched_off() {
    let sandbox = Sandbox::new("switch");
    // 처음: 꺼져 있고 듣지 않는다. 연결 코드는 만들어져 있다.
    let link = Link::open(&sandbox);
    let status = link.hub.status();
    assert!(!status.enabled && !status.listening, "{status:?}");
    assert_eq!(link.hub.addr(), None);
    assert_eq!(status.problem, None);
    assert!(!status.pending && status.last.is_none());
    assert_eq!(status.code.len(), 9, "{}", status.code);

    // 켜면 열린다.
    let status = link.hub.set_enabled(true);
    assert!(status.enabled && status.listening, "{status:?}");
    let addr = link.addr();
    assert!(!refused(addr));
    // 다시 켜도 같은 수신부다.
    assert_eq!(link.hub.set_enabled(true).address, addr.to_string());

    // 끄면 닫힌다 — 같은 주소로 더는 연결되지 않는다.
    let status = link.hub.set_enabled(false);
    assert!(!status.enabled && !status.listening, "{status:?}");
    assert!(refused(addr), "끈 뒤에도 수신부가 열려 있다");

    // 다시 켜면 다시 열리고, 버리면(앱이 끝날 때) 닫힌다.
    link.hub.set_enabled(true);
    let addr = link.addr();
    assert!(!refused(addr));
    link.hub.shutdown();
    assert!(refused(addr), "닫은 뒤에도 수신부가 열려 있다");
    // 닫아도 켜짐 여부(기억)는 그대로다.
    assert!(link.hub.status().enabled);

    link.hub.set_enabled(true);
    let addr = link.addr();
    drop(link);
    assert!(refused(addr), "버린 뒤에도 수신부가 열려 있다");
}

#[test]
fn the_switch_and_the_code_are_remembered_and_the_file_holds_nothing_else() {
    let sandbox = Sandbox::new("remember");
    assert!(!sandbox.settings().exists());
    let first = Link::open(&sandbox);
    let code = first.code();
    // 처음 만든 코드는 곧바로 적어 둔다(켜지 않았어도).
    let saved: Value = serde_json::from_str(&fs::read_to_string(sandbox.settings()).expect("설정")).expect("JSON");
    assert_eq!(saved, json!({ "enabled": false, "code": code }));
    drop(first);

    // 꺼 둔 채로 다시 열면 꺼져 있고 코드는 같다.
    let again = Link::open(&sandbox);
    assert!(!again.hub.status().enabled && !again.hub.status().listening);
    assert_eq!(again.code(), code);
    again.hub.set_enabled(true);
    // 쿠키를 받아도 설정 파일에는 켜짐과 코드뿐이다.
    assert_eq!(post(&again, &code, &fake_cookie()).status, 200);
    let text = fs::read_to_string(sandbox.settings()).expect("설정");
    assert_no_cookie(&text, "설정 파일");
    assert_eq!(serde_json::from_str::<Value>(&text).expect("JSON"), json!({ "enabled": true, "code": code }));
    drop(again);

    // 켜 둔 채로 끝냈으면 다시 열 때 곧바로 듣는다 — 같은 코드로.
    let reopened = Link::open(&sandbox);
    let status = reopened.hub.status();
    assert!(status.enabled && status.listening, "{status:?}");
    assert_eq!(status.code, code);
    assert_eq!(post(&reopened, &code, &fake_cookie()).status, 200);

    // 깨진 설정 파일은 기본값으로 읽는다: 꺼짐, 새 코드.
    drop(reopened);
    fs::write(sandbox.settings(), "{ 깨진 파일").expect("설정");
    let fresh = Link::open(&sandbox);
    assert!(!fresh.hub.status().enabled);
    assert_eq!(fresh.code().len(), 9);
    assert_ne!(fresh.code(), code);
}

#[test]
fn a_port_in_use_is_reported_and_nothing_is_overheard() {
    let sandbox = Sandbox::new("in-use");
    let first = Link::on(&sandbox);
    let port = first.addr().port();
    // 같은 포트를 또 열 수는 없다 — 이유를 한국어로 알리고, 켜 두었다는 것은 남는다.
    let second = LinkHub::open(None, port, Arc::new(|_: &str| Stored::Saved), Arc::new(|| {}));
    let status = second.set_enabled(true);
    assert!(status.enabled && !status.listening, "{status:?}");
    let problem = status.problem.expect("이유");
    assert!(problem.contains(&format!("127.0.0.1:{port}")), "{problem}");
    assert!(problem.contains("다른 프로그램이 쓰고 있다"), "{problem}");
    assert_eq!(status.address, format!("127.0.0.1:{port}"));
    // 먼저 연 쪽이 닫히면 다시 켤 수 있다.
    first.hub.set_enabled(false);
    let status = second.set_enabled(true);
    assert!(status.listening && status.problem.is_none(), "{status:?}");
}

// ── 받는 요청 ─────────────────────────────────────────────────────────────────

#[test]
fn the_extensions_request_stores_the_cookie_like_a_pasted_one_and_hands_over_to_the_fetch() {
    let sandbox = Sandbox::new("accept");
    let link = Link::on(&sandbox);
    assert!(!sandbox.cookie_file().exists());
    assert!(!link.hub.take_pending());

    // 확장은 정리된 헤더를 보내지만, 받는 쪽도 붙여넣기와 같은 정리·검사를 한다(앞뒤 공백·줄바꿈·`Cookie:`).
    let answer = post(&link, &link.code(), &format!("  Cookie: {}\r\n", fake_cookie()));
    assert_eq!(answer.status, 200, "{}", answer.raw);
    assert_eq!(answer.json(), json!({ "ok": true, "result": "received" }));
    assert_eq!(answer.header("content-type"), Some("application/json; charset=utf-8"));
    assert_closed_to_pages(&answer);

    // 쿠키는 엔진의 쿠키 파일 한 곳에, 한 줄로 쓰였다.
    assert_eq!(
        fs::read_to_string(sandbox.cookie_file()).expect("쿠키 파일"),
        format!("{}\n", fake_cookie())
    );
    let mut holding = Vec::new();
    let mut stack = vec![sandbox.0.clone()];
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
    assert_eq!(holding, vec![sandbox.cookie_file()], "쿠키가 든 파일은 쿠키 파일 하나여야 한다");

    // 화면에 알린다: 받았다 → 「계정 새로 받기」를 이을 차례(한 번).
    let events = link.wait_events(1);
    assert_eq!(events.len(), 1);
    assert!(events[0].pending);
    let last = events[0].last.clone().expect("마지막 요청");
    assert_eq!(last.outcome, "received");
    assert!(last.message.contains("계정을 새로 받는다"), "{}", last.message);
    assert!(last.at.ends_with('Z'), "{}", last.at);
    assert!(link.hub.status().pending);
    assert!(link.hub.take_pending(), "받은 뒤 한 번은 true다");
    assert!(!link.hub.take_pending(), "두 번째부터는 false다");
    assert!(!link.hub.status().pending);

    // 연결 코드는 사람이 넣은 모양(소문자·공백·붙임표 없음)이어도 맞는다.
    let code = link.code();
    for typed in [code.to_lowercase(), code.replace('-', ""), format!(" {} ", code.replace('-', " "))] {
        assert_eq!(post(&link, &typed, &fake_cookie()).status, 200, "{typed}");
    }
}

#[test]
fn only_the_one_request_is_accepted_other_methods_paths_types_and_sizes_are_refused() {
    let sandbox = Sandbox::new("shape");
    let link = Link::on(&sandbox);
    let addr = link.addr();
    let good = Request::from_extension(addr, &link.code(), &fake_cookie());
    let with = |change: &dyn Fn(&mut Request)| {
        let mut request = good.clone();
        change(&mut request);
        request.send(addr)
    };
    let expect = |answer: Answer, status: u16, reason: &str| {
        assert_eq!((answer.status, answer.reason().as_str()), (status, reason), "{}", answer.raw);
        assert_eq!(answer.json()["ok"], false);
        assert_closed_to_pages(&answer);
    };

    // 방법.
    for method in ["GET", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] {
        let answer = with(&|r| r.method = method.to_string());
        assert_eq!(answer.status, 405, "{method}: {}", answer.raw);
        assert_eq!(answer.header("allow"), Some("POST"));
        assert_closed_to_pages(&answer);
    }
    // 경로.
    for target in ["/", "/nikke-companion/v1/session/", "/nikke-companion/v1/session?debug=1", "/nikke-companion/v1/cookie", "/favicon.ico"] {
        expect(with(&|r| r.target = target.to_string()), 404, "not_found");
    }
    // 형식.
    for content_type in [None, Some("text/plain"), Some("application/x-www-form-urlencoded"), Some("multipart/form-data; boundary=x")] {
        expect(with(&|r| r.content_type = content_type.map(str::to_string)), 415, "content_type");
    }
    // 크기: 본문이 너무 크면 읽지 않고 거부한다.
    let huge = format!("{}; pad={}", fake_cookie(), "x".repeat(MAX_BODY_BYTES));
    expect(Request::from_extension(addr, &link.code(), &huge).send(addr), 413, "too_large");
    // 머리가 너무 크다.
    let mut long_head = format!("POST {SESSION_PATH} HTTP/1.1\r\nHost: {addr}\r\nOrigin: {EXTENSION}\r\n").into_bytes();
    long_head.extend_from_slice(format!("X-Pad: {}\r\n", "x".repeat(MAX_HEAD_BYTES * 2)).as_bytes());
    long_head.extend_from_slice(b"\r\n");
    expect(send_raw(addr, &long_head), 413, "too_large");
    // 길이를 알리지 않은 본문.
    let chunked = format!(
        "POST {SESSION_PATH} HTTP/1.1\r\nHost: {addr}\r\nOrigin: {EXTENSION}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
    );
    expect(send_raw(addr, chunked.as_bytes()), 411, "length_required");
    // 본문이 정해진 JSON이 아니다.
    for body in [&b"not json"[..], b"{}", br#"{"code":"x"}"#, br#"["code","cookie"]"#, br#"{"code":"x","cookie":"y","to":"elsewhere"}"#] {
        expect(with(&|r| r.body = body.to_vec()), 400, "bad_request");
    }
    // 요청이 아닌 것.
    expect(send_raw(addr, b"hello\r\n\r\n"), 400, "bad_request");

    // 거부한 요청으로는 아무것도 쓰이지 않았고, 화면에 알리지도 않았다(조용히 거부한다).
    assert!(!sandbox.cookie_file().exists(), "거부한 요청의 쿠키가 쓰였다");
    assert_eq!(link.events().len(), 0);
    assert!(!link.hub.status().pending);
    // 그 뒤에도 제대로 된 요청은 받는다(틀린 코드로 세지 않았다).
    assert_eq!(good.send(addr).status, 200);
}

#[test]
fn a_request_that_stalls_is_cut_off() {
    let sandbox = Sandbox::new("stall");
    let link = Link::on(&sandbox);
    let addr = link.addr();
    // 본문을 보내겠다고 하고 보내지 않는다.
    let head = format!(
        "POST {SESSION_PATH} HTTP/1.1\r\nHost: {addr}\r\nOrigin: {EXTENSION}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n"
    );
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).expect("연결");
    stream.set_read_timeout(Some(Duration::from_secs(10))).expect("시한");
    stream.write_all(head.as_bytes()).expect("머리");
    let started = Instant::now();
    let mut raw = String::new();
    let _ = stream.read_to_string(&mut raw);
    assert!(raw.starts_with("HTTP/1.1 408 "), "{raw:?}");
    assert!(started.elapsed() < Duration::from_secs(8), "{:?}", started.elapsed());
    // 끊은 뒤에도 다음 요청을 받는다.
    assert_eq!(post(&link, &link.code(), &fake_cookie()).status, 200);
}

// ── 웹 페이지는 부르지 못한다 ─────────────────────────────────────────────────

#[test]
fn web_pages_cannot_call_the_receiver() {
    let sandbox = Sandbox::new("pages");
    let link = Link::on(&sandbox);
    let addr = link.addr();
    let good = Request::from_extension(addr, &link.code(), &fake_cookie());

    // 확장이 아닌 출처: 코드가 맞아도 거부한다.
    for origin in [
        None,
        Some("null"),
        Some("https://www.blablalink.com"),
        Some("https://evil.example"),
        Some("http://127.0.0.1"),
        Some("http://localhost:5173"),
        Some("chrome-extension://"),
        Some("chrome-extension://abcdefghijklmnopabcdefghijklmnop.evil.example"),
        Some("moz-extension://abcdefghijklmnopabcdefghijklmnop"),
    ] {
        let mut request = good.clone();
        request.origin = origin.map(str::to_string);
        let answer = request.send(addr);
        assert_eq!((answer.status, answer.reason().as_str()), (403, "origin"), "{origin:?}: {}", answer.raw);
        assert_closed_to_pages(&answer);
    }
    // 자기 주소를 출처로 댄 것도 웹 페이지다.
    let mut request = good.clone();
    request.origin = Some(format!("http://{addr}"));
    assert_eq!(request.send(addr).status, 403);

    // 브라우저가 다른 출처의 페이지를 대신해 먼저 보내는 사전 요청(OPTIONS): 허용 헤더를 주지 않는다 → 브라우저가 본 요청을 막는다.
    let preflight = format!(
        "OPTIONS {SESSION_PATH} HTTP/1.1\r\nHost: {addr}\r\nOrigin: https://evil.example\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type\r\nAccess-Control-Request-Private-Network: true\r\n\r\n"
    );
    let answer = send_raw(addr, preflight.as_bytes());
    assert_eq!(answer.status, 403, "{}", answer.raw);
    assert_closed_to_pages(&answer);
    // 확장의 출처로 온 사전 요청에도 허용 헤더는 없다(확장은 호스트 권한으로 사전 요청 없이 보낸다).
    let preflight = preflight.replace("https://evil.example", EXTENSION);
    let answer = send_raw(addr, preflight.as_bytes());
    assert_eq!(answer.status, 405, "{}", answer.raw);
    assert_closed_to_pages(&answer);

    // 사전 요청이 필요 없는 「단순 요청」(페이지의 폼·no-cors fetch): 형식이 application/json이 아니라 거부되고, 출처로도 거부된다.
    let mut simple = good.clone();
    simple.origin = Some("https://evil.example".to_string());
    simple.content_type = Some("text/plain".to_string());
    assert_eq!(simple.send(addr).status, 403);
    let mut simple = good.clone();
    simple.content_type = Some("text/plain".to_string());
    assert_eq!(simple.send(addr).status, 415);

    // 다른 이름으로 이 주소를 가리킨 요청(DNS를 바꿔치는 페이지)은 Host에서 걸린다.
    for host in [None, Some("evil.example".to_string()), Some(format!("evil.example:{}", addr.port())), Some(format!("localhost:{}", addr.port())), Some("127.0.0.1".to_string())] {
        let mut request = good.clone();
        request.host = host.clone();
        let answer = request.send(addr);
        assert_eq!((answer.status, answer.reason().as_str()), (403, "host"), "{host:?}: {}", answer.raw);
        assert_closed_to_pages(&answer);
    }

    // 페이지의 요청으로는 아무것도 쓰이지 않았고, 틀린 코드로 세지도 화면에 알리지도 않았다
    // (페이지가 요청을 쏟아부어 확장을 막거나 화면을 어지럽힐 수 없다).
    assert!(!sandbox.cookie_file().exists());
    assert_eq!(link.events().len(), 0);
    assert_eq!(link.hub.status().locked_seconds, 0);
    assert_eq!(good.send(addr).status, 200);
}

// ── 연결 코드 ─────────────────────────────────────────────────────────────────

#[test]
fn a_wrong_code_is_refused_and_too_many_lock_the_receiver_for_a_while() {
    let sandbox = Sandbox::new("code");
    let link = Link::on(&sandbox);
    let code = link.code();
    // 코드는 여덟 글자(가운데 붙임표)이고, 화면에 보여도 되는 값이다 — 쿠키와 무관하다.
    assert_eq!(code.len(), 9);
    assert_eq!(code.as_bytes()[4], b'-');
    let wrong = if code.starts_with('A') { code.replacen('A', "B", 1) } else { format!("A{}", &code[1..]) };

    for n in 1..=MAX_WRONG_CODES {
        let answer = post(&link, &wrong, &fake_cookie());
        assert_eq!((answer.status, answer.reason().as_str()), (401, "wrong_code"), "{}", answer.raw);
        assert_closed_to_pages(&answer);
        let events = link.wait_events(n as usize);
        let last = events.last().and_then(|s| s.last.clone()).expect("알림");
        assert_eq!(last.outcome, "wrong_code");
        assert!(last.message.contains(&format!("연속 {n}회")), "{}", last.message);
    }
    for missing in ["", "ABCD", "가나다라-마바사아"] {
        // (이미 막혔다 — 아래에서 확인한다.)
        let answer = post(&link, missing, &fake_cookie());
        assert_eq!(answer.status, 429, "{missing}: {}", answer.raw);
    }

    // 다섯 번 틀린 뒤: 맞는 코드도 받지 않는다.
    let answer = post(&link, &code, &fake_cookie());
    assert_eq!((answer.status, answer.reason().as_str()), (429, "locked"), "{}", answer.raw);
    let seconds = answer.json()["retry_after_seconds"].as_u64().expect("남은 시간");
    assert!((1..=LOCK_FOR.as_secs()).contains(&seconds), "{seconds}");
    assert_eq!(answer.header("retry-after"), Some(seconds.to_string().as_str()));
    assert_closed_to_pages(&answer);
    let status = link.hub.status();
    assert!((1..=LOCK_FOR.as_secs()).contains(&status.locked_seconds), "{status:?}");
    let last = status.last.expect("마지막 요청");
    assert_eq!(last.outcome, "locked");
    assert!(last.message.contains("잠시 막았다"), "{}", last.message);
    // 막힌 동안 아무것도 쓰이지 않았다.
    assert!(!sandbox.cookie_file().exists(), "코드가 틀린 요청의 쿠키가 쓰였다");
    assert!(!link.hub.take_pending());
}

#[test]
fn a_new_code_retires_the_old_one_at_once() {
    let sandbox = Sandbox::new("new-code");
    let link = Link::on(&sandbox);
    let old = link.code();
    assert_eq!(post(&link, &old, &fake_cookie()).status, 200);
    fs::remove_file(sandbox.cookie_file()).expect("쿠키 파일");

    let status = link.hub.new_code();
    let new = status.code.clone();
    assert_ne!(new, old);
    assert!(status.listening, "코드를 바꿔도 수신부는 그대로 듣는다");
    // 옛 코드는 받지 않는다. 새 코드는 받는다.
    let answer = post(&link, &old, &fake_cookie());
    assert_eq!((answer.status, answer.reason().as_str()), (401, "wrong_code"));
    assert!(!sandbox.cookie_file().exists());
    assert_eq!(post(&link, &new, &fake_cookie()).status, 200);
    // 새 코드는 기억된다.
    let saved: Value = serde_json::from_str(&fs::read_to_string(sandbox.settings()).expect("설정")).expect("JSON");
    assert_eq!(saved["code"], new.as_str());

    // 코드를 다시 만들면 막힘도 풀린다(막힌 것은 옛 코드에 대한 시도였다).
    for _ in 0..MAX_WRONG_CODES {
        post(&link, &old, &fake_cookie());
    }
    assert_eq!(post(&link, &new, &fake_cookie()).status, 429);
    let newest = link.hub.new_code().code;
    assert_eq!(link.hub.status().locked_seconds, 0);
    assert_eq!(post(&link, &newest, &fake_cookie()).status, 200);
}

// ── 받은 쿠키의 검사·수집 중 ──────────────────────────────────────────────────

#[test]
fn a_cookie_without_the_login_cookies_is_not_stored() {
    let sandbox = Sandbox::new("not-logged-in");
    let link = Link::on(&sandbox);
    let code = link.code();
    for cookie in [format!("game_openid={OPENID}; lang={SHORT}"), format!("game_token={TOKEN}; lang={SHORT}"), "lang=ko; theme=dark".to_string()] {
        let answer = post(&link, &code, &cookie);
        assert_eq!((answer.status, answer.reason().as_str()), (422, "not_logged_in"), "{}", answer.raw);
        assert_closed_to_pages(&answer);
    }
    // 쿠키 헤더로 쓸 수 없는 것.
    for cookie in [String::new(), format!("{}; 메모=한글", fake_cookie()), format!("{}\u{0}", fake_cookie())] {
        let answer = post(&link, &code, &cookie);
        assert_eq!((answer.status, answer.reason().as_str()), (422, "cookie_rejected"), "{}", answer.raw);
        assert_closed_to_pages(&answer);
    }
    assert!(!sandbox.cookie_file().exists(), "거부한 쿠키가 쓰였다");
    assert!(!link.hub.take_pending());
    let events = link.wait_events(6);
    assert_eq!(events.len(), 6);
    for status in &events {
        assert!(!status.pending);
        assert_no_cookie(&serde_json::to_string(status).expect("직렬화"), "알림");
    }
    assert!(events[0].last.as_ref().is_some_and(|l| l.outcome == "not_logged_in" && l.message.contains("로그인돼 있지 않다")));
    assert!(events[5].last.as_ref().is_some_and(|l| l.outcome == "cookie_rejected"));
}

#[test]
fn while_an_account_is_being_fetched_the_cookie_is_left_alone() {
    let sandbox = Sandbox::new("busy");
    let link = Link::on(&sandbox);
    let code = link.code();
    assert_eq!(post(&link, &code, &fake_cookie()).status, 200);
    assert!(link.hub.take_pending());
    let before = fs::read_to_string(sandbox.cookie_file()).expect("쿠키 파일");

    link.busy.store(true, Ordering::Release);
    let other = format!("game_token=OTHER-{TOKEN}; game_openid={OPENID}");
    let answer = post(&link, &code, &other);
    assert_eq!((answer.status, answer.reason().as_str()), (409, "busy"), "{}", answer.raw);
    assert_closed_to_pages(&answer);
    assert_eq!(fs::read_to_string(sandbox.cookie_file()).expect("쿠키 파일"), before, "수집 중에 쿠키가 바뀌었다");
    assert!(!link.hub.take_pending(), "받지 않은 쿠키로 수집을 잇지 않는다");

    link.busy.store(false, Ordering::Release);
    assert_eq!(post(&link, &code, &other).status, 200);
    assert!(link.hub.take_pending());
}

#[test]
fn a_store_failure_is_reported_without_details() {
    // 엔진 폴더가 아닌 곳(수집 스크립트가 없다)에는 쿠키를 쓰지 않는다.
    let sandbox = Sandbox::new("store-failed");
    fs::remove_file(sandbox.engine().join(FETCH_SCRIPT)).expect("스크립트");
    let link = Link::on(&sandbox);
    let answer = post(&link, &link.code(), &fake_cookie());
    assert_eq!((answer.status, answer.reason().as_str()), (500, "store_failed"), "{}", answer.raw);
    assert_closed_to_pages(&answer);
    // 답에는 사유의 낱말뿐이다 — 폴더 경로나 오류 문장이 실리지 않는다.
    assert_eq!(answer.body, r#"{"ok":false,"reason":"store_failed"}"#);
    assert!(!sandbox.cookie_file().exists());
    assert!(!link.hub.take_pending());
}

// ── 쿠키 비노출 ───────────────────────────────────────────────────────────────

/// 쿠키가 지나가는 길을 모두 한 번씩 밟는다: 받기, 코드 틀림, 막힘, 로그인 안 됨, 형식 거부, 수집 중, 저장 실패,
/// 모양이 다른 요청(쿠키가 든 채로). 답·상태·알림을 모두 모아 돌려준다.
fn walk_every_path(label: &str) -> Vec<String> {
    let mut shown: Vec<String> = Vec::new();
    let mut note = |what: &str, text: String| shown.push(format!("[{what}] {text}"));

    let sandbox = Sandbox::new(label);
    let link = Link::on(&sandbox);
    let addr = link.addr();
    let code = link.code();
    let mut see = |what: &str, answer: Answer| {
        note(what, answer.raw.clone());
        note(what, format!("{answer:?}"));
    };

    see("받았다", post(&link, &code, &fake_cookie()));
    see("로그인 안 됨", post(&link, &code, &format!("game_openid={OPENID}; lang={SHORT}")));
    see("형식 거부", post(&link, &code, &format!("{}; 한글=값", fake_cookie())));
    link.busy.store(true, Ordering::Release);
    see("수집 중", post(&link, &code, &fake_cookie()));
    link.busy.store(false, Ordering::Release);

    // 모양이 다른 요청에도 쿠키를 실어 보낸다 — 거부하는 답에 요청의 글자가 되돌아오지 않아야 한다.
    let good = Request::from_extension(addr, &code, &fake_cookie());
    let mut broken = good.clone();
    broken.body = format!(r#"{{"code":"{code}","cookie":"{}""#, fake_cookie()).into_bytes();
    see("깨진 본문", broken.send(addr));
    let mut wrong_type = good.clone();
    wrong_type.body = format!(r#"{{"code":"{code}","cookie":["{}"]}}"#, fake_cookie()).into_bytes();
    see("쿠키가 글자가 아님", wrong_type.send(addr));
    let mut extra = good.clone();
    extra.body = serde_json::to_vec(&json!({ "code": code, "cookie": fake_cookie(), "extra": fake_cookie() })).expect("본문");
    see("모르는 칸", extra.send(addr));
    let mut page = good.clone();
    page.origin = Some("https://evil.example".to_string());
    see("웹 페이지", page.send(addr));
    let mut get = good.clone();
    get.method = "GET".to_string();
    get.target = format!("{SESSION_PATH}?cookie={TOKEN}");
    see("주소에 쿠키", get.send(addr));
    let in_header = format!(
        "POST {SESSION_PATH} HTTP/1.1\r\nHost: {addr}\r\nOrigin: {EXTENSION}\r\nCookie: {}\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n",
        fake_cookie()
    );
    see("헤더에 쿠키", send_raw(addr, in_header.as_bytes()));
    let mut as_code = good.clone();
    as_code.body = serde_json::to_vec(&json!({ "code": fake_cookie(), "cookie": fake_cookie() })).expect("본문");
    see("코드 칸에 쿠키", as_code.send(addr));
    for _ in 0..MAX_WRONG_CODES {
        see("코드 틀림", post(&link, "ZZZZ-ZZZZ", &fake_cookie()));
    }
    see("막힘", post(&link, &code, &fake_cookie()));

    // 명령의 반환값(상태·코드 다시 만들기·켜기/끄기·수집 잇기)과 이벤트에 실리는 상태.
    for (what, status) in [
        ("상태", link.hub.status()),
        ("코드 다시 만들기", link.hub.new_code()),
        ("끄기", link.hub.set_enabled(false)),
        ("켜기", link.hub.set_enabled(true)),
    ] {
        note(what, serde_json::to_string(&status).expect("직렬화"));
        note(what, format!("{status:?}"));
    }
    note("수집 잇기", link.hub.take_pending().to_string());
    for status in link.wait_events(4) {
        note("알림", serde_json::to_string(&status).expect("직렬화"));
        note("알림", format!("{status:?}"));
    }
    note("설정 파일", fs::read_to_string(sandbox.settings()).expect("설정"));

    // 저장 실패의 길.
    let failing = Sandbox::new(&format!("{label}-failing"));
    fs::remove_file(failing.engine().join(FETCH_SCRIPT)).expect("스크립트");
    let failing_link = Link::on(&failing);
    let answer = post(&failing_link, &failing_link.code(), &fake_cookie());
    note("저장 실패", answer.raw.clone());
    note("저장 실패", serde_json::to_string(&failing_link.hub.status()).expect("직렬화"));

    // 받은 쿠키가 실제로 쓰였는지(길을 제대로 밟았는지) 확인해 둔다 — 쿠키 파일의 내용은 돌려주지 않는다.
    assert!(fs::read_to_string(sandbox.cookie_file()).is_ok_and(|text| text.contains(TOKEN)));
    shown
}

#[test]
fn the_fake_cookie_never_appears_in_replies_statuses_events_or_debug_output() {
    let shown = walk_every_path("secret");
    // 길을 다 밟았다: 답 스물몇 개와 상태·알림.
    assert!(shown.len() > 40, "{}", shown.len());
    for needed in ["[받았다]", "[막힘]", "[웹 페이지]", "[저장 실패]", "[알림]", "[설정 파일]"] {
        assert!(shown.iter().any(|line| line.starts_with(needed)), "{needed}");
    }
    for line in &shown {
        assert_no_cookie(line, "수신부가 내보낸 것");
    }
    // 연결 코드는 쿠키가 아니다 — 상태에 보인다(가리지 않는다).
    assert!(shown.iter().any(|line| line.starts_with("[상태]") && line.contains("\"code\":\"")));
}

/// 아래 테스트가 따로 띄우는 프로세스에서 도는 부분. 쿠키가 지나가는 길을 모두 밟되 스스로는 아무것도 출력하지 않는다.
#[test]
#[ignore = "no_cookie_reaches_the_standard_output이 따로 띄운 프로세스에서 돈다"]
fn probe_walk_every_cookie_path_quietly() {
    let shown = walk_every_path("probe");
    assert!(shown.len() > 40);
}

#[test]
fn no_cookie_reaches_the_standard_output() {
    // 이 테스트 실행 파일을 한 번 더 띄워, 쿠키가 지나가는 길을 모두 밟는 동안 표준 출력·표준 오류에 나온 것을 전부 받는다.
    let output = Command::new(std::env::current_exe().expect("테스트 실행 파일"))
        .args([
            "--ignored",
            "--exact",
            "probe_walk_every_cookie_path_quietly",
            "--nocapture",
            "--test-threads=1",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("테스트 실행 파일을 다시 띄운다");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "길을 밟는 프로세스가 실패했다:\n{stdout}\n{stderr}");
    assert!(stdout.contains("1 passed"), "길을 밟는 테스트가 돌지 않았다:\n{stdout}");
    assert_no_cookie(&stdout, "표준 출력");
    assert_no_cookie(&stderr, "표준 오류");
    // 수신부는 요청에 대해 아무것도 출력하지 않는다(사유의 낱말조차).
    for word in ["wrong_code", "received", "chrome-extension", "game_token"] {
        assert!(!stdout.contains(word) && !stderr.contains(word), "{word}:\n{stdout}\n{stderr}");
    }
}

// ── 겹쳐 오는 요청 ────────────────────────────────────────────────────────────

#[test]
fn requests_arriving_together_are_each_answered() {
    let sandbox = Sandbox::new("together");
    let link = Link::on(&sandbox);
    let addr = link.addr();
    let request = Request::from_extension(addr, &link.code(), &fake_cookie()).bytes();
    let done = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..6 {
            scope.spawn(|| {
                let answer = send_raw(addr, &request);
                assert_eq!(answer.status, 200, "{}", answer.raw);
                done.fetch_add(1, Ordering::Relaxed);
            });
        }
    });
    assert_eq!(done.load(Ordering::Relaxed), 6);
    assert_eq!(link.wait_events(6).len(), 6);
    assert!(link.hub.take_pending());
    assert!(!link.hub.take_pending());
}

/// 가짜 엔진 폴더가 실제 저장소 밖(임시 폴더)에 있는지 — 이 테스트가 실제 엔진의 쿠키 파일을 건드리지 않는다는 확인.
#[test]
fn the_sandbox_is_outside_the_repository() {
    let sandbox = Sandbox::new("outside");
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("저장소");
    let dir = sandbox.0.canonicalize().expect("임시 폴더");
    assert!(!dir.starts_with(&repo), "{} 은 저장소 안이다", dir.display());
    assert!(dir.starts_with(std::env::temp_dir().canonicalize().expect("임시 폴더")));
}
