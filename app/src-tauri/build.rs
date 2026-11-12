fn main() {
    // 앱 명령을 여기 적으면 명령마다 권한(allow-<명령>)이 생기고, capability에 적은 것만 화면에서 부를 수 있다.
    // 적지 않으면 등록한 명령이 모두 허용된다.
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "load_report",
            "overlay_status",
            "startup_report_path",
            "engine_catalog",
            "engine_version",
            "engine_run_batch",
            "engine_run_views",
            "engine_cancel",
            "read_json_file",
            "pick_json_file",
            "game_window_status",
            "set_follow_game",
            "capture_game",
            "recognize_game_screen",
            "set_screen_tracking",
            "screen_track_status",
            "account_sync_status",
            "account_save_cookie",
            "account_fetch_profile",
            "account_fetch_cancel",
            "account_read_profile",
            "account_save_file",
            "login_window_open",
            "login_window_take_cookie",
            "login_window_clear",
            "extension_link_status",
            "extension_link_set",
            "extension_link_new_code",
            "extension_link_take_pending",
            "nikke_portrait",
            "boss_image",
            "game_icon",
            "shared_state",
            "set_default_account",
            "set_overlay_launch",
            "read_account",
            "save_intercept_result",
            "load_intercept_result",
            "show_app_window",
            "set_overlay_visible",
            "overlay_widget",
            "overlay_shape",
            "overlay_pin",
            "overlay_fit",
            "overlay_hide",
            "set_overlay_prefs",
            "reset_overlay_position",
            "announce_activity",
            "compute_activity",
            "load_plan",
            "save_plan",
            "load_decks",
            "save_decks",
            "copy_text",
            "set_account_hidden",
            "open_tool_link",
        ]),
    );
    tauri_build::try_build(attributes).expect("tauri-build 실패");
    embed_test_manifest();
}

/// Windows: 통합 테스트 실행 파일에 「공용 컨트롤 6」 선언을 넣는다.
///
/// 앱 실행 파일에는 tauri-build가 같은 선언을 넣어 준다. 테스트 실행 파일에는 없어서, Tauri의 창 코드를 실제로 쓰는
/// 테스트(`tests/live_login_window.rs`)는 시작도 못 하고 죽는다(STATUS_ENTRYPOINT_NOT_FOUND). 앱 실행 파일에는 영향이 없다.
fn embed_test_manifest() {
    let target = |key: &str| std::env::var(key).unwrap_or_default();
    if target("CARGO_CFG_TARGET_OS") != "windows" || target("CARGO_CFG_TARGET_ENV") != "msvc" {
        return;
    }
    let manifest = std::path::Path::new(&target("CARGO_MANIFEST_DIR")).join("tests/windows-test.manifest");
    println!("cargo:rerun-if-changed=tests/windows-test.manifest");
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
}
