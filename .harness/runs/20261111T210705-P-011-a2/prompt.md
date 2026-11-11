너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-011
제목: 게임 창 추적·화면 캡처·캡처 저장 도구
설명: 니케 PC판 창을 찾아 상태를 읽고, 창의 클라이언트 영역을 캡처해 PNG로 저장한다. Rust(app/src-tauri)에 만든다. 게임은 **읽기만 한다**: 게임 창을 옮기거나 크기를 바꾸거나 앞으로 가져오지 않고, 게임에 마우스·키 입력을 보내지 않고, 게임 프로세스의 메모리를 읽거나 무엇을 주입하지 않는다. 표준 창 API(창 열거, 창 사각형, DWM, Windows.Graphics.Capture 또는 PrintWindow/BitBlt)만 쓴다. 지금 이 PC에서 게임이 창 모드로 실행 중이다(프로세스 nikke.exe, 창 제목 NIKKE. 런처 nikke_launcher.exe도 같은 제목의 창을 갖고 있으니 구분해야 한다). 캡처 이미지는 계정 정보와 게임 화면을 담으므로 data/captures/(gitignore)에만 쓰고 커밋하지 않는다. 캡처 방식은 크레이트 문서를 확인해 고르고, 고른 이유와 한계를 app/README.md에 적는다.

수락 조건:
- 게임 창 찾기: 프로세스 이름과 창 제목으로 후보를 모으고 런처·보이지 않는 창을 걸러 게임 창 하나를 고른다. 고르는 규칙은 Win32 호출과 분리된 순수 함수로 두고 단위 테스트한다(후보 없음, 런처만 있음, 최소화됨, 여러 개)
- 창 정보: 클라이언트 영역의 화면 좌표(물리 픽셀)와 크기, 최소화 여부, 전경 여부, 모니터 배율을 돌려준다
- 캡처: 게임 창의 클라이언트 영역(제목 표시줄·테두리 제외)을 원본 해상도로 캡처한다. 게임 창이 다른 창에 가려져 있어도 게임 화면이 찍혀야 한다. 최소화돼 있으면 한국어 오류. 전부 검거나 한 색인 프레임은 성공으로 치지 않고 오류로 돌려준다(판정 함수는 단위 테스트)
- 명령줄 도구 `nikke-capture`(cargo bin): `--info`는 창 정보를 JSON으로 출력, `--out <폴더> [--name <라벨>]`은 PNG를 저장하고 {path, width, height, captured_at, method, window}를 JSON 한 줄로 출력. 기본 폴더는 저장소의 data/captures. 게임이 없으면 종료 코드 2와 한국어 메시지. 파일 이름은 시각+라벨이고 라벨은 파일 이름에 안전한 문자만 남긴다
- 오버레이: 게임 창 상태(찾음/없음/최소화, 크기)를 화면에 보여 주고, 전역 단축키 Alt+Shift+S와 화면 단추로 현재 게임 화면을 저장한다. 저장 결과(경로 또는 오류)를 화면에 알린다
- 오버레이 붙이기: 켜면 오버레이가 게임 창의 오른쪽 위 안쪽에 자리 잡고 게임 창이 움직이거나 크기가 바뀌면 따라간다. 끄면 그 자리에 머문다. 위치 계산은 순수 함수로 두고 단위 테스트한다. 게임 창은 건드리지 않는다
- 실제 게임을 상대로 한 테스트가 app/src-tauri/tests/live_game.rs에 `#[ignore]`로 있다: 게임 창을 찾고(런처가 아님), 캡처한 이미지의 크기가 클라이언트 영역과 같고, 검은 화면이 아니며, 캡처 전후로 게임 창의 위치·크기·전경 여부가 바뀌지 않았음을 확인한다
- data/captures/가 .gitignore에 있다. capability에는 새로 쓰는 앱 명령만 더한다(파일·셸·네트워크 플러그인 없음)
- 기존 단위·통합·프런트·Rust 테스트가 계속 통과한다. app/README.md와 루트 CLAUDE.md의 명령 목록을 갱신한다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- cargo test --manifest-path app/src-tauri/Cargo.toml
- cargo test --manifest-path app/src-tauri/Cargo.toml --test live_game -- --ignored
- cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --info

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 오버레이에서 Alt+Shift+S로 저장한 캡처가 실제 게임 화면과 같다
- 붙이기를 켠 상태에서 게임 창을 옮기면 오버레이가 따라온다
- 전체 화면(테두리 없는 창·전용 전체 화면)에서 캡처가 되는지

이전 시도(1회차)의 검증이 실패했다: 검증 실패: live-game(exit 101)
--- live-game (exit 101) 출력 끝부분 ---

thread 'captures_game_content_even_when_another_window_covers_it' (40552) panicked at tests\live_game.rs:68:5:
게임 창이 최소화돼 있다 — 창을 띄운 뒤에 돌려라: GameWindowInfo { hwnd: 3345878, pid: 24812, process_name: "nikke.exe", title: "NIKKE", client: ScreenRect { x: -32000, y: -32000, width: 0, height: 0 }, frame: ScreenRect { x: -31993, y: -32000, width: 146, height: 28 }, minimized: true, foreground: false, scale_factor: 1.0 }
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

---- captures_the_client_area_without_touching_the_game_window stdout ----

thread 'captures_the_client_area_without_touching_the_game_window' (47088) panicked at tests\live_game.rs:68:5:
게임 창이 최소화돼 있다 — 창을 띄운 뒤에 돌려라: GameWindowInfo { hwnd: 3345878, pid: 24812, process_name: "nikke.exe", title: "NIKKE", client: ScreenRect { x: -32000, y: -32000, width: 0, height: 0 }, frame: ScreenRect { x: -31993, y: -32000, width: 146, height: 28 }, minimized: true, foreground: false, scale_factor: 1.0 }

---- finds_the_game_window_and_not_the_launcher stdout ----

thread 'finds_the_game_window_and_not_the_launcher' (28816) panicked at tests\live_game.rs:68:5:
게임 창이 최소화돼 있다 — 창을 띄운 뒤에 돌려라: GameWindowInfo { hwnd: 3345878, pid: 24812, process_name: "nikke.exe", title: "NIKKE", client: ScreenRect { x: -32000, y: -32000, width: 0, height: 0 }, frame: ScreenRect { x: -31993, y: -32000, width: 146, height: 28 }, minimized: true, foreground: false, scale_factor: 1.0 }

---- cli_prints_window_info_and_saves_a_capture stdout ----

thread 'cli_prints_window_info_and_saves_a_capture' (47412) panicked at tests\live_game.rs:68:5:
게임 창이 최소화돼 있다 — 창을 띄운 뒤에 돌려라: GameWindowInfo { hwnd: 3345878, pid: 24812, process_name: "nikke.exe", title: "NIKKE", client: ScreenRect { x: -32000, y: -32000, width: 0, height: 0 }, frame: ScreenRect { x: -31993, y: -32000, width: 146, height: 28 }, minimized: true, foreground: false, scale_factor: 1.0 }

---- saves_a_png_that_matches_the_client_area stdout ----

thread 'saves_a_png_that_matches_the_client_area' (40820) panicked at tests\live_game.rs:68:5:
게임 창이 최소화돼 있다 — 창을 띄운 뒤에 돌려라: GameWindowInfo { hwnd: 3345878, pid: 24812, process_name: "nikke.exe", title: "NIKKE", client: ScreenRect { x: -32000, y: -32000, width: 0, height: 0 }, frame: ScreenRect { x: -31993, y: -32000, width: 146, height: 28 }, minimized: true, foreground: false, scale_factor: 1.0 }


failures:
    captures_game_content_even_when_another_window_covers_it
    captures_the_client_area_without_touching_the_game_window
    cli_prints_window_info_and_saves_a_capture
    finds_the_game_window_and_not_the_launcher
    saves_a_png_that_matches_the_client_area

test result: FAILED. 0 passed; 5 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s


    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.28s
     Running tests\live_game.rs (app\src-tauri\target\debug\deps\live_game-b6c173744d3c9bf5.exe)
error: test failed, to rerun pass `--test live_game`

원인을 분석해 고쳐라. 테스트를 지우거나 약하게 만들지 마라.

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.