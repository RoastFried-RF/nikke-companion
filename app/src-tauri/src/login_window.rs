//! blablalink 로그인 창 — 개발자 도구 없이 세션 쿠키를 받기 위한 별도 창.
//!
//! 오버레이와 달리 테두리·제목 표시줄이 있는 보통 창이고 작업 표시줄에 보인다. 이 창은 외부 사이트
//! (blablalink와 사용자가 고른 로그인 제공자)를 보여 준다. 아이디·비밀번호는 그 페이지에 직접 넣는다 —
//! 앱은 입력을 읽지 않고, 페이지에 스크립트를 넣지도 않는다.
//!
//! **이 창은 앱 명령을 부를 수 없다.** capability(`capabilities/overlay.json`)의 `windows`에 이 창의 이름이 없고,
//! 원격 주소에 IPC를 열어 주는 설정(`remote`)도 없다. 창의 주소가 어디로 바뀌든(blablalink, 로그인 제공자, 그 밖의
//! 어떤 사이트든) 마찬가지다 — 권한은 주소가 아니라 창 이름에 붙는데, 이 창에는 권한이 하나도 없다.
//!
//! 쿠키는 이 창의 쿠키 저장소에서 Rust가 직접 읽는다(`read_cookies`). 읽은 값은 `cookie::BrowserCookie`에 담겨
//! `account_sync::store_login_cookies`로만 간다 — 화면·이벤트·로그로 나가지 않는다. 이 모듈은 아무것도 출력하지 않는다.
//!
//! 이 창의 저장 데이터(쿠키·로컬 저장소)는 오버레이와 다른 폴더(`login-webview`)에 둔다 — 세션을 지울 때
//! 오버레이가 기억해 둔 것(마지막 탭·경로·결과)은 건드리지 않는다.

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::account_sync::SyncError;
use crate::cookie::BrowserCookie;

/// 로그인 창의 이름. capability의 `windows`에 넣지 않는다.
pub const LOGIN_WINDOW: &str = "login";
/// 로그인 창이 처음 여는 주소.
pub const LOGIN_URL: &str = "https://www.blablalink.com/";
/// 쿠키 저장소에 「이 주소로 가는 요청에 실릴 쿠키」를 묻는 주소 — 엔진의 수집 스크립트가 요청을 보내는 곳이다.
pub const COOKIE_URL: &str = "https://api.blablalink.com/api/game/proxy/";
/// 앱 데이터 폴더에서 본, 로그인 창만 쓰는 저장 폴더.
pub const DATA_SUBDIR: &str = "login-webview";
/// 창 제목.
const TITLE: &str = "blablalink 로그인 — 니케 컴패니언";

/// 세션 폴더를 지울 때 다시 해 보는 횟수와 간격(방금 닫은 창의 브라우저 프로세스가 파일을 잠깐 쥐고 있다).
const REMOVE_ATTEMPTS: u32 = 10;
const REMOVE_INTERVAL: Duration = Duration::from_millis(200);

/// 로그인 창이 가도 되는 주소인가: https뿐이다(빈 페이지 `about:blank`는 둔다).
/// 로그인 제공자가 여럿이라 도메인은 묶지 않는다 — 어디로 가든 이 창은 앱 명령을 부를 수 없다.
pub fn navigation_allowed(url: &Url) -> bool {
    url.scheme() == "https" || url.as_str() == "about:blank"
}

fn failed(what: &str, e: impl std::fmt::Display) -> SyncError {
    SyncError::LoginWindow {
        detail: format!("{what} ({e})"),
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, SyncError> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(DATA_SUBDIR))
        .map_err(|e| failed("앱 데이터 폴더를 알 수 없다", e))
}

fn parse(url: &str) -> Result<Url, SyncError> {
    url.parse::<Url>().map_err(|e| failed("주소를 읽을 수 없다", e))
}

/// 열려 있는 로그인 창.
pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LOGIN_WINDOW)
}

pub fn is_open(app: &AppHandle) -> bool {
    window(app).is_some()
}

/// 로그인 창을 연다. 이미 열려 있으면 그 창을 앞으로 가져온다.
pub fn open(app: &AppHandle) -> Result<(), SyncError> {
    open_in(app, data_dir(app)?)
}

/// `open`과 같되 저장 폴더를 받는다(테스트가 앱의 실제 로그인 세션을 건드리지 않게 임시 폴더를 준다).
pub fn open_in(app: &AppHandle, data_directory: PathBuf) -> Result<(), SyncError> {
    if let Some(existing) = window(app) {
        let _ = existing.unminimize();
        return existing
            .set_focus()
            .map_err(|e| failed("열려 있는 로그인 창을 앞으로 가져오지 못했다", e));
    }
    WebviewWindowBuilder::new(app, LOGIN_WINDOW, WebviewUrl::External(parse(LOGIN_URL)?))
        .title(TITLE)
        .inner_size(1100.0, 820.0)
        // 오버레이와 반대다: 테두리·제목 표시줄이 있고, 작업 표시줄에 보이고, 항상 위가 아니다.
        .decorations(true)
        .skip_taskbar(false)
        .always_on_top(false)
        .data_directory(data_directory)
        .on_navigation(navigation_allowed)
        .build()
        .map(|_| ())
        .map_err(|e| failed("로그인 창을 만들지 못했다", e))
}

/// 로그인 창의 쿠키 저장소에서 blablalink API 요청에 실릴 쿠키를 읽는다.
///
/// Windows에서는 화면 응답을 맡은 스레드에서 부르면 멈춘다(WebView2) — 다른 스레드에서 부른다(`lib.rs`의 `blocking_sync`).
pub fn read_cookies(window: &WebviewWindow) -> Result<Vec<BrowserCookie>, SyncError> {
    let cookies = window
        .cookies_for_url(parse(COOKIE_URL)?)
        .map_err(|e| failed("로그인 창의 쿠키를 읽지 못했다", e))?;
    Ok(cookies
        .iter()
        .map(|cookie| BrowserCookie {
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            domain: cookie.domain().map(str::to_string),
        })
        .collect())
}

/// 로그인 창을 닫는다. 닫지 못해도 받은 쿠키는 이미 저장됐다 — 오류로 치지 않는다.
pub fn close(window: &WebviewWindow) {
    let _ = window.close();
}

/// 로그인 창의 세션(쿠키·저장 데이터)을 지운다 — 다른 계정으로 바꾸거나 공용 PC에서 쓴 뒤에.
/// 창이 열려 있으면 그 창의 데이터를 지우고 로그인 전 화면으로 되돌린다. 닫혀 있으면 저장 폴더를 지운다.
/// 엔진의 쿠키 파일(`scraper/.session_cookie`)은 건드리지 않는다.
pub fn clear_session(app: &AppHandle) -> Result<&'static str, SyncError> {
    clear_session_in(app, &data_dir(app)?)
}

/// `clear_session`과 같되 저장 폴더를 받는다(`open_in`에 준 폴더).
pub fn clear_session_in(app: &AppHandle, dir: &Path) -> Result<&'static str, SyncError> {
    if let Some(window) = window(app) {
        window
            .clear_all_browsing_data()
            .map_err(|e| failed("로그인 창의 저장 데이터를 지우지 못했다", e))?;
        window
            .navigate(parse(LOGIN_URL)?)
            .map_err(|e| failed("로그인 창을 처음 화면으로 되돌리지 못했다", e))?;
        return Ok("로그인 창의 쿠키·저장 데이터를 지웠다 — 창은 로그인 전 화면으로 돌아간다");
    }
    let mut last = None;
    for attempt in 0..REMOVE_ATTEMPTS {
        match fs::remove_dir_all(dir) {
            Ok(()) => return Ok("로그인 창의 쿠키·저장 데이터를 지웠다"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok("지울 로그인 세션이 없다(로그인 창을 연 적이 없거나 이미 지웠다)")
            }
            Err(e) => last = Some(e),
        }
        if attempt + 1 < REMOVE_ATTEMPTS {
            thread::sleep(REMOVE_INTERVAL);
        }
    }
    Err(failed(
        "로그인 창의 저장 폴더를 지우지 못했다 — 방금 창을 닫았다면 잠시 뒤에 다시 눌러라",
        last.map_or_else(|| "원인 미상".to_string(), |e| e.to_string()),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_pages_may_load_in_the_login_window() {
        for ok in [
            LOGIN_URL,
            COOKIE_URL,
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
            "https://appleid.apple.com/auth/authorize",
            "about:blank",
        ] {
            assert!(navigation_allowed(&ok.parse().expect(ok)), "{ok}");
        }
        for bad in [
            "http://www.blablalink.com/",
            "file:///C:/Windows/win.ini",
            "tauri://localhost/",
            "http://tauri.localhost/",
            "http://ipc.localhost/quit_app",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "ftp://example.com/",
            "about:config",
        ] {
            assert!(!navigation_allowed(&bad.parse().expect(bad)), "{bad}");
        }
    }

    #[test]
    fn the_window_opens_blablalink_and_asks_for_the_api_hosts_cookies() {
        let login: Url = LOGIN_URL.parse().expect("주소");
        assert_eq!(login.scheme(), "https");
        assert_eq!(login.host_str(), Some("www.blablalink.com"));
        let api: Url = COOKIE_URL.parse().expect("주소");
        assert_eq!(api.scheme(), "https");
        // 쿠키를 묻는 주소는 수집 스크립트가 요청을 보내는 호스트다 — 쿠키 헤더를 만들 때 맞춰 보는 호스트와 같다.
        assert_eq!(api.host_str(), Some(crate::cookie::API_HOST));
        assert_ne!(LOGIN_WINDOW, "main");
    }
}
