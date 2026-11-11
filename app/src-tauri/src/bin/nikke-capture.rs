//! `nikke-capture` — 게임 창 정보 출력과 화면 캡처 저장(명령줄).
//!
//! 동작은 라이브러리의 `capture_cli`에 있다. 사용법: `nikke-capture --help`.
//! 저장소 루트에서: `cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --info`

use nikke_companion_lib::capture_cli::{run, LiveGame};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = run(
        &args,
        &LiveGame,
        &mut std::io::stdout().lock(),
        &mut std::io::stderr().lock(),
    );
    std::process::exit(code);
}
