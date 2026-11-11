fn main() {
    // 앱 명령을 여기 적으면 명령마다 권한(allow-<명령>)이 생기고, capability에 적은 것만 화면에서 부를 수 있다.
    // 적지 않으면 등록한 명령이 모두 허용된다.
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "load_report",
            "overlay_status",
            "startup_report_path",
            "quit_app",
            "engine_catalog",
            "engine_version",
            "engine_run_batch",
            "read_json_file",
            "pick_json_file",
            "game_window_status",
            "set_follow_game",
            "capture_game",
        ]),
    );
    tauri_build::try_build(attributes).expect("tauri-build 실패");
}
