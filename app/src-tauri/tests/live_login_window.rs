//! 로그인 창을 실제로 띄워 보는 테스트 — 평소에는 돌지 않는다(`--ignored`).
//!
//! ```text
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_login_window -- --ignored --nocapture
//! ```
//!
//! 하는 일: 이 앱의 설정으로 Tauri를 띄우고(오버레이 창은 숨긴 채), 로그인 창을 **임시 저장 폴더로** 열어
//! blablalink 첫 페이지를 띄운 뒤, 그 창의 쿠키 저장소를 읽어 「아직 로그인되지 않았다」가 나오는지, 세션 지우기가
//! 되는지 본다. 창이 몇 초 화면에 떴다가 닫힌다. 네트워크가 있어야 한다(blablalink 첫 페이지 요청 하나 — 로그인 없이).
//!
//! **로그인은 하지 않는다.** 임시 폴더의 새 세션이라 로그인된 쿠키가 있을 수 없고, 앱이 실제로 쓰는 로그인 세션
//! (`login-webview`)과 엔진의 쿠키 파일은 건드리지 않는다(쿠키를 쓸 곳도 임시 가짜 엔진 폴더다). 쿠키의 값은 출력하지 않는다 —
//! 이름과 개수만 낸다.

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use nikke_companion_lib::account_sync::{self, COOKIE_FILE, FETCH_SCRIPT};
use nikke_companion_lib::login_window::{self, LOGIN_WINDOW};
use tauri::Manager;

fn temp(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nikke-companion-live-login-{label}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("임시 폴더");
    dir
}

fn wait_until(limit: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let started = Instant::now();
    loop {
        if condition() {
            return true;
        }
        if started.elapsed() >= limit {
            return false;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

/// 로그인 창을 열고 닫으며 본 것. 실패하면 이유.
fn walk(app: &tauri::AppHandle, data: &Path, engine: &Path) -> Result<Vec<String>, String> {
    let mut seen = Vec::new();
    login_window::open_in(app, data.to_path_buf()).map_err(|e| e.to_string())?;
    let window = login_window::window(app).ok_or("로그인 창이 만들어지지 않았다")?;

    // 오버레이와 다른 보통 창이다.
    let decorated = window.is_decorated().map_err(|e| e.to_string())?;
    let on_top = window.is_always_on_top().map_err(|e| e.to_string())?;
    let title = window.title().map_err(|e| e.to_string())?;
    seen.push(format!("창: label={LOGIN_WINDOW} title={title:?} decorated={decorated} always_on_top={on_top}"));
    if !decorated || on_top {
        return Err(format!("보통 창이 아니다: decorated={decorated} always_on_top={on_top}"));
    }

    // 페이지가 뜨면 사이트가 심는 쿠키가 생긴다(로그인 전의 것). 값은 읽어도 내지 않는다.
    let mut cookies = Vec::new();
    let loaded = wait_until(Duration::from_secs(30), || {
        cookies = login_window::read_cookies(&window).unwrap_or_default();
        !cookies.is_empty()
    });
    let mut names: Vec<&str> = cookies.iter().map(|c| c.name.as_str()).collect();
    names.sort_unstable();
    seen.push(format!(
        "쿠키 저장소: {}개 (페이지가 심은 쿠키가 {}) 이름={names:?}",
        cookies.len(),
        if loaded { "보였다" } else { "30초 동안 보이지 않았다" }
    ));
    // 다른 스레드에서 읽어도 멈추지 않고 돌아온다(이 줄까지 왔다) — 한 번 더 읽어 오류가 없는지 본다.
    login_window::read_cookies(&window).map_err(|e| e.to_string())?;
    let url = window.url().map_err(|e| e.to_string())?;
    seen.push(format!("주소: {}://{}", url.scheme(), url.host_str().unwrap_or("?")));
    if loaded && url.scheme() != "https" {
        return Err(format!("https가 아닌 주소가 떴다: {}", url.scheme()));
    }

    // 로그인하지 않았다 → 「아직 로그인되지 않았다」, 쿠키 파일은 생기지 않는다.
    match account_sync::store_login_cookies(engine, &cookies) {
        Err(e) if e.kind() == "not_logged_in" => seen.push(format!("쿠키 가져오기: {e}")),
        Err(e) => return Err(format!("로그인 전인데 다른 오류가 났다: {e}")),
        Ok(_) => return Err("로그인하지 않았는데 쿠키가 저장됐다".to_string()),
    }
    if engine.join(COOKIE_FILE).exists() {
        return Err("로그인 전인데 쿠키 파일이 생겼다".to_string());
    }

    // 세션 지우기: 창이 열려 있을 때.
    let cleared = login_window::clear_session_in(app, data).map_err(|e| e.to_string())?;
    seen.push(format!("세션 지우기(창 열림): {cleared}"));
    thread::sleep(Duration::from_secs(1));

    // 창을 닫고, 닫힌 뒤의 세션 지우기: 저장 폴더가 사라진다.
    window.close().map_err(|e| e.to_string())?;
    if !wait_until(Duration::from_secs(10), || login_window::window(app).is_none()) {
        return Err("로그인 창이 닫히지 않았다".to_string());
    }
    if !data.is_dir() {
        return Err("로그인 창의 저장 폴더가 만들어지지 않았다 — 다른 폴더를 쓴 것 같다".to_string());
    }
    let cleared = login_window::clear_session_in(app, data).map_err(|e| e.to_string())?;
    seen.push(format!("세션 지우기(창 닫힘): {cleared}"));
    if data.exists() {
        return Err("세션을 지웠는데 저장 폴더가 남아 있다".to_string());
    }
    let again = login_window::clear_session_in(app, data).map_err(|e| e.to_string())?;
    seen.push(format!("세션 지우기(지울 것 없음): {again}"));
    Ok(seen)
}

#[test]
#[ignore = "로그인 창을 실제로 띄운다(네트워크 필요, 로그인은 하지 않는다) — 사람이 볼 때만 돌린다"]
fn the_login_window_opens_blablalink_reads_no_login_and_clears_its_session() {
    let data = temp("data");
    // 쿠키를 쓸 곳도 가짜 엔진 폴더다(수집 스크립트 자리만 있다). 실제 엔진의 쿠키 파일은 건드리지 않는다.
    let engine = temp("engine");
    fs::create_dir_all(engine.join("scraper")).expect("scraper 폴더");
    fs::write(engine.join(FETCH_SCRIPT), "# 실행하지 않는 자리 표시\n").expect("스크립트");

    let app = tauri::Builder::default()
        .any_thread()
        .build(tauri::generate_context!())
        .expect("Tauri 앱을 만들지 못했다");
    assert!(app.get_webview_window(LOGIN_WINDOW).is_none(), "로그인 창은 시작할 때 만들지 않는다");
    let handle = app.handle().clone();
    let (data_for_walk, engine_for_walk) = (data.clone(), engine.clone());
    let worker = thread::spawn(move || {
        let outcome = walk(&handle, &data_for_walk, &engine_for_walk);
        handle.exit(0);
        outcome
    });
    let code = app.run_return(|_, _| {});
    let outcome = worker.join().expect("확인 스레드");
    let _ = fs::remove_dir_all(&data);
    let _ = fs::remove_dir_all(&engine);

    match outcome {
        Ok(seen) => {
            for line in seen {
                println!("{line}");
            }
        }
        Err(reason) => panic!("{reason}"),
    }
    assert_eq!(code, 0);
}
