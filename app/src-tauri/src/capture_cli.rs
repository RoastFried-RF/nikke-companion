//! 명령줄 도구 `nikke-capture`의 동작(인자 해석 → 창 정보 출력·캡처 저장·화면 인식 → 종료 코드).
//!
//! 실행 파일(`src/bin/nikke-capture.rs`)은 이 모듈의 `run`에 실제 게임 접근(`LiveGame`)을 넘길 뿐이다.
//! 게임 접근을 trait으로 받아서, 게임이 없을 때의 종료 코드와 메시지를 게임 없이 단위 테스트한다.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::capture::{self, CaptureRecord, Frame};
use crate::game_window::{self, GameError, GameWindowInfo};
use crate::recognize;

/// 정상 종료.
pub const EXIT_OK: i32 = 0;
/// 인자 오류, 최소화, 캡처·저장 실패.
pub const EXIT_ERROR: i32 = 1;
/// 게임 창이 없다(게임이 꺼져 있거나 런처만 떠 있다).
pub const EXIT_NO_GAME: i32 = 2;

pub const USAGE: &str = "\
nikke-capture — 니케 PC판 게임 창의 정보를 읽거나 화면을 PNG로 저장한다 (게임은 읽기만 한다)

사용법:
  nikke-capture --info
      게임 창 정보를 JSON 한 줄로 출력한다:
      {hwnd, pid, process_name, title, client{x,y,width,height}, frame{…}, minimized, foreground, scale_factor}
      좌표와 크기는 물리 픽셀이다. client는 제목 표시줄·테두리를 뺀 게임 화면 영역이다.

  nikke-capture [--out <폴더>] [--name <라벨>]
      게임 화면(클라이언트 영역)을 PNG로 저장하고 결과를 JSON 한 줄로 출력한다:
      {path, width, height, captured_at, method, window}
      --out     저장할 폴더. 기본은 저장소의 data/captures (환경 변수 NIKKE_CAPTURE_DIR로 바꿀 수 있다)
      --name    파일 이름에 붙일 라벨. 글자·숫자·-·_만 남긴다. 파일 이름은 <현지 시각>_<라벨>.png
      method는 캡처 방식이다(지금은 wgc — Windows.Graphics.Capture 하나뿐이다)

  nikke-capture --recognize <PNG 파일>
      저장해 둔 캡처에서 화면 종류와 선택된 보스를 알아내 JSON 한 줄로 출력한다:
      {screen, boss, confidence, evidence, width, height}
      screen은 anomaly_select(이상 개체 보스 선택) · anomaly_squad(이상 개체 편성) · other(그 밖) · unknown(판단하지 않음)
      boss는 이상 개체 화면일 때 {id, name}, 그 밖에는 null. evidence는 무엇을 보고 판단했는지다
      unknown도 종료 코드는 0이다(인식은 끝났고, 답이 '모른다'이다)

  nikke-capture --recognize-live
      게임 창을 찍어 인식만 하고 같은 JSON을 출력한다. 이미지는 저장하지 않는다

종료 코드: 0 성공 · 1 인자 오류·최소화·캡처/저장 실패·이미지 읽기 실패 · 2 게임 창 없음
";

/// 해석한 명령.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Help,
    Info,
    Capture {
        out: Option<PathBuf>,
        name: Option<String>,
    },
    /// 저장해 둔 PNG에서 화면을 인식한다.
    Recognize {
        png: PathBuf,
    },
    /// 게임 창을 찍어 인식만 한다(저장하지 않는다).
    RecognizeLive,
}

/// 인자(프로그램 이름 제외)를 해석한다. 잘못되면 한국어 설명.
pub fn parse_args(args: &[String]) -> Result<Command, String> {
    let mut info = false;
    let mut out: Option<PathBuf> = None;
    let mut name: Option<String> = None;
    let mut recognize: Option<PathBuf> = None;
    let mut recognize_live = false;
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = |option: &str| {
            it.next()
                .filter(|v| !v.starts_with("--"))
                .cloned()
                .ok_or_else(|| format!("{option} 뒤에 값이 필요하다"))
        };
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--info" => info = true,
            "--out" => {
                let dir = value("--out")?;
                if dir.trim().is_empty() {
                    return Err("--out의 폴더가 비어 있다".to_string());
                }
                out = Some(PathBuf::from(dir));
            }
            "--name" => name = Some(value("--name")?),
            "--recognize" => {
                let file = value("--recognize")?;
                if file.trim().is_empty() {
                    return Err("--recognize의 파일 경로가 비어 있다".to_string());
                }
                recognize = Some(PathBuf::from(file));
            }
            "--recognize-live" => recognize_live = true,
            other => return Err(format!("모르는 인자다: {other}")),
        }
    }
    // 한 번에 한 가지 일만 한다: 창 정보, 캡처 저장, 파일 인식, 게임 화면 인식.
    let saving = out.is_some() || name.is_some();
    let modes = [info, recognize.is_some(), recognize_live];
    let alone = |option: &str| Err(format!("{option}는 다른 옵션과 함께 쓸 수 없다"));
    if modes.iter().filter(|on| **on).count() > 1 || (saving && modes.contains(&true)) {
        return if info {
            alone("--info")
        } else if recognize.is_some() {
            alone("--recognize")
        } else {
            alone("--recognize-live")
        };
    }
    if info {
        return Ok(Command::Info);
    }
    if let Some(png) = recognize {
        return Ok(Command::Recognize { png });
    }
    if recognize_live {
        return Ok(Command::RecognizeLive);
    }
    Ok(Command::Capture { out, name })
}

/// 게임에 닿는 일. 실제 구현은 `LiveGame`, 테스트는 가짜를 넘긴다.
pub trait GameAccess {
    fn find(&self) -> Result<GameWindowInfo, GameError>;
    fn default_dir(&self) -> Result<PathBuf, GameError>;
    fn capture(&self, dir: &Path, label: Option<&str>) -> Result<CaptureRecord, GameError>;
    /// 게임 화면을 찍어 프레임만 돌려준다. 저장하지 않는다.
    fn frame(&self) -> Result<Frame, GameError>;
}

/// 실제 게임 창을 상대로 한다.
pub struct LiveGame;

impl GameAccess for LiveGame {
    fn find(&self) -> Result<GameWindowInfo, GameError> {
        game_window::find_game_window()
    }

    fn default_dir(&self) -> Result<PathBuf, GameError> {
        capture::default_capture_dir()
    }

    fn capture(&self, dir: &Path, label: Option<&str>) -> Result<CaptureRecord, GameError> {
        capture::capture_game_to_dir(dir, label)
    }

    fn frame(&self) -> Result<Frame, GameError> {
        capture::grab_game_frame().map(|(frame, _, _)| frame)
    }
}

fn exit_code(error: &GameError) -> i32 {
    if error.is_game_missing() {
        EXIT_NO_GAME
    } else {
        EXIT_ERROR
    }
}

fn execute(command: Command, game: &dyn GameAccess) -> Result<String, GameError> {
    let json = |value: serde_json::Result<String>| {
        value.map_err(|e| GameError::WindowInfo {
            detail: format!("결과를 JSON으로 만들지 못했다: {e}"),
        })
    };
    match command {
        Command::Help => Ok(USAGE.trim_end().to_string()),
        Command::Info => json(serde_json::to_string(&game.find()?)),
        Command::Capture { out, name } => {
            let dir = match out {
                Some(dir) => dir,
                None => game.default_dir()?,
            };
            json(serde_json::to_string(&game.capture(&dir, name.as_deref())?))
        }
        // 파일 인식은 게임에 닿지 않는다.
        Command::Recognize { png } => {
            let frame = capture::load_png(&png)?;
            json(serde_json::to_string(&recognize::recognize(&frame)))
        }
        // 찍은 프레임은 인식에만 쓰고 버린다 — 저장하지 않는다.
        Command::RecognizeLive => {
            let frame = game.frame()?;
            json(serde_json::to_string(&recognize::recognize(&frame)))
        }
    }
}

/// 명령을 실행하고 종료 코드를 돌려준다. 결과는 `out`에 한 줄, 오류는 `err`에 한국어로 쓴다.
pub fn run(
    args: &[String],
    game: &dyn GameAccess,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> i32 {
    let command = match parse_args(args) {
        Ok(command) => command,
        Err(message) => {
            let _ = writeln!(err, "{message}\n\n{USAGE}");
            return EXIT_ERROR;
        }
    };
    match execute(command, game) {
        Ok(line) => {
            let _ = writeln!(out, "{line}");
            EXIT_OK
        }
        Err(error) => {
            let _ = writeln!(err, "{error}");
            exit_code(&error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CaptureMethod;
    use crate::game_window::ScreenRect;
    use crate::recognize::synth;
    use crate::recognize::Boss;
    use std::cell::{Cell, RefCell};

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn window(minimized: bool) -> GameWindowInfo {
        GameWindowInfo {
            hwnd: 0x1234,
            pid: 42,
            process_name: "nikke.exe".to_string(),
            title: "NIKKE".to_string(),
            client: ScreenRect {
                x: 1,
                y: 31,
                width: 1920,
                height: 1080,
            },
            frame: ScreenRect {
                x: 0,
                y: 0,
                width: 1922,
                height: 1112,
            },
            minimized,
            foreground: false,
            scale_factor: 1.0,
        }
    }

    /// 가짜 게임: 정해 둔 결과를 돌려주고, 캡처 요청을 기록한다.
    struct FakeGame {
        found: Result<GameWindowInfo, GameError>,
        default_dir: Result<PathBuf, GameError>,
        capture_error: Option<GameError>,
        captures: RefCell<Vec<(PathBuf, Option<String>)>>,
        /// 지금 게임 화면(저장 없이 찍을 때 돌려주는 프레임).
        screen: Frame,
        /// 저장 없이 찍은 횟수.
        frames: Cell<u32>,
    }

    impl FakeGame {
        fn running() -> Self {
            Self {
                found: Ok(window(false)),
                default_dir: Ok(PathBuf::from("R:\\repo\\data\\captures")),
                capture_error: None,
                captures: RefCell::new(Vec::new()),
                screen: synth::select_screen(1280, 720, Boss::Kraken),
                frames: Cell::new(0),
            }
        }

        fn failing(error: GameError) -> Self {
            Self {
                found: Err(error.clone()),
                capture_error: Some(error),
                ..Self::running()
            }
        }
    }

    impl GameAccess for FakeGame {
        fn find(&self) -> Result<GameWindowInfo, GameError> {
            self.found.clone()
        }

        fn default_dir(&self) -> Result<PathBuf, GameError> {
            self.default_dir.clone()
        }

        fn capture(&self, dir: &Path, label: Option<&str>) -> Result<CaptureRecord, GameError> {
            self.captures
                .borrow_mut()
                .push((dir.to_path_buf(), label.map(str::to_string)));
            if let Some(error) = &self.capture_error {
                return Err(error.clone());
            }
            let name = capture::capture_file_name(&capture::Stamp::from_unix_millis(0), label);
            Ok(CaptureRecord {
                path: dir.join(name).display().to_string(),
                width: 1920,
                height: 1080,
                captured_at: "1970-01-01T00:00:00.000Z".to_string(),
                method: CaptureMethod::Wgc,
                window: self.found.clone()?,
            })
        }

        fn frame(&self) -> Result<Frame, GameError> {
            self.frames.set(self.frames.get() + 1);
            match &self.capture_error {
                Some(error) => Err(error.clone()),
                None => Ok(self.screen.clone()),
            }
        }
    }

    fn run_with(game: &FakeGame, list: &[&str]) -> (i32, String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run(&args(list), game, &mut out, &mut err);
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn parses_info_capture_and_help() {
        assert_eq!(parse_args(&args(&["--info"])), Ok(Command::Info));
        assert_eq!(parse_args(&args(&["--help"])), Ok(Command::Help));
        assert_eq!(parse_args(&args(&["-h"])), Ok(Command::Help));
        // 인자가 없으면 기본 폴더에 캡처한다.
        assert_eq!(
            parse_args(&[]),
            Ok(Command::Capture {
                out: None,
                name: None
            })
        );
        assert_eq!(
            parse_args(&args(&["--out", "D:\\shots", "--name", "솔로 레이드"])),
            Ok(Command::Capture {
                out: Some(PathBuf::from("D:\\shots")),
                name: Some("솔로 레이드".to_string())
            })
        );
        assert_eq!(
            parse_args(&args(&["--name", "lobby"])),
            Ok(Command::Capture {
                out: None,
                name: Some("lobby".to_string())
            })
        );
        assert_eq!(
            parse_args(&args(&["--recognize", "D:\\shots\\a.png"])),
            Ok(Command::Recognize {
                png: PathBuf::from("D:\\shots\\a.png")
            })
        );
        assert_eq!(
            parse_args(&args(&["--recognize-live"])),
            Ok(Command::RecognizeLive)
        );
    }

    #[test]
    fn rejects_bad_arguments_in_korean() {
        for (list, expected) in [
            (&["--out"][..], "--out 뒤에 값이 필요하다"),
            (&["--out", "--name", "x"][..], "--out 뒤에 값이 필요하다"),
            (&["--name"][..], "--name 뒤에 값이 필요하다"),
            (&["--out", "  "][..], "--out의 폴더가 비어 있다"),
            (&["--method", "printwindow"][..], "모르는 인자다: --method"),
            (&["--verbose"][..], "모르는 인자다: --verbose"),
            (&["shot.png"][..], "모르는 인자다: shot.png"),
            (&["--info", "--out", "x"][..], "--info는 다른 옵션과 함께 쓸 수 없다"),
            (&["--recognize"][..], "--recognize 뒤에 값이 필요하다"),
            (&["--recognize", "--info"][..], "--recognize 뒤에 값이 필요하다"),
            (&["--recognize", " "][..], "--recognize의 파일 경로가 비어 있다"),
            (&["--recognize", "a.png", "--name", "x"][..], "--recognize는 다른 옵션과 함께 쓸 수 없다"),
            (&["--out", "x", "--recognize", "a.png"][..], "--recognize는 다른 옵션과 함께 쓸 수 없다"),
            (&["--recognize", "a.png", "--recognize-live"][..], "--recognize는 다른 옵션과 함께 쓸 수 없다"),
            (&["--recognize-live", "--out", "x"][..], "--recognize-live는 다른 옵션과 함께 쓸 수 없다"),
            (&["--recognize-live", "--info"][..], "--info는 다른 옵션과 함께 쓸 수 없다"),
            (&["--recognize-live", "a.png"][..], "모르는 인자다: a.png"),
        ] {
            let message = parse_args(&args(list)).unwrap_err();
            assert!(message.contains(expected), "{list:?}: {message}");
        }
    }

    #[test]
    fn info_prints_the_window_as_one_json_line() {
        let (code, out, err) = run_with(&FakeGame::running(), &["--info"]);
        assert_eq!(code, EXIT_OK);
        assert_eq!(err, "");
        assert_eq!(out.lines().count(), 1);
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(
            json["client"],
            serde_json::json!({ "x": 1, "y": 31, "width": 1920, "height": 1080 })
        );
        assert_eq!(json["minimized"], false);
        assert_eq!(json["foreground"], false);
        assert_eq!(json["scale_factor"], 1.0);
        assert_eq!(json["process_name"], "nikke.exe");
    }

    #[test]
    fn info_of_a_minimized_window_still_succeeds() {
        let game = FakeGame {
            found: Ok(window(true)),
            ..FakeGame::running()
        };
        let (code, out, _) = run_with(&game, &["--info"]);
        assert_eq!(code, EXIT_OK);
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(json["minimized"], true);
    }

    #[test]
    fn missing_game_exits_with_2_and_a_korean_message() {
        for list in [&["--info"][..], &[][..], &["--out", "D:\\x"][..]] {
            let (code, out, err) = run_with(&FakeGame::failing(GameError::NotRunning), list);
            assert_eq!(code, EXIT_NO_GAME, "{list:?}");
            assert_eq!(code, 2);
            assert_eq!(out, "", "{list:?}");
            assert!(err.contains("게임 창을 찾을 수 없다"), "{err}");
        }
        // 런처만 떠 있어도 게임은 없는 것이다.
        let (code, _, err) = run_with(&FakeGame::failing(GameError::LauncherOnly), &["--info"]);
        assert_eq!(code, EXIT_NO_GAME);
        assert!(err.contains("런처"), "{err}");
    }

    #[test]
    fn capture_prints_the_record_as_one_json_line() {
        let game = FakeGame::running();
        let (code, out, err) = run_with(&game, &["--out", "D:\\shots", "--name", "lobby"]);
        assert_eq!(code, EXIT_OK);
        assert_eq!(err, "");
        assert_eq!(out.lines().count(), 1);
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        let keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["path", "width", "height", "captured_at", "method", "window"]
        );
        assert!(json["path"].as_str().unwrap().ends_with("_lobby.png"));
        assert_eq!(
            *game.captures.borrow(),
            [(PathBuf::from("D:\\shots"), Some("lobby".to_string()))]
        );
    }

    #[test]
    fn capture_without_out_uses_the_default_folder() {
        let game = FakeGame::running();
        let (code, _, _) = run_with(&game, &[]);
        assert_eq!(code, EXIT_OK);
        assert_eq!(
            game.captures.borrow()[0].0,
            PathBuf::from("R:\\repo\\data\\captures")
        );

        // 기본 폴더를 정할 수 없으면 찍지 않고 알린다.
        let lost = FakeGame {
            default_dir: Err(GameError::CaptureDirUnknown),
            ..FakeGame::running()
        };
        let (code, out, err) = run_with(&lost, &[]);
        assert_eq!(code, EXIT_ERROR);
        assert_eq!(out, "");
        assert!(err.contains("NIKKE_CAPTURE_DIR"), "{err}");
        assert!(lost.captures.borrow().is_empty());
    }

    #[test]
    fn capture_failures_exit_with_1_and_a_korean_message() {
        for (error, expected) in [
            (GameError::Minimized, "최소화"),
            (
                GameError::BlankFrame {
                    method: CaptureMethod::Wgc,
                    kind: capture::BlankKind::Black,
                },
                "전부 검다",
            ),
            (
                GameError::Save {
                    path: "D:\\x\\a.png".to_string(),
                    detail: "액세스가 거부되었습니다".to_string(),
                },
                "저장하지 못했다",
            ),
        ] {
            let game = FakeGame {
                capture_error: Some(error),
                ..FakeGame::running()
            };
            let (code, out, err) = run_with(&game, &["--out", "D:\\x"]);
            assert_eq!(code, EXIT_ERROR);
            assert_eq!(out, "");
            assert!(err.contains(expected), "{err}");
        }
    }

    #[test]
    fn bad_arguments_print_usage_and_exit_with_1_without_touching_the_game() {
        let game = FakeGame::running();
        let (code, out, err) = run_with(&game, &["--bogus"]);
        assert_eq!(code, EXIT_ERROR);
        assert_eq!(out, "");
        assert!(err.contains("모르는 인자다: --bogus"));
        assert!(err.contains("사용법"));
        assert!(game.captures.borrow().is_empty());
    }

    /// 테스트마다 다른 임시 폴더에 프레임을 PNG로 저장하고 (폴더, 파일)을 돌려준다.
    fn saved_png(tag: &str, frame: &Frame) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-recognize-cli-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let path = capture::save_png(&dir, "screen.png", frame).unwrap();
        (dir, path)
    }

    #[test]
    fn recognize_prints_the_result_of_a_png_as_one_json_line_without_touching_the_game() {
        let (dir, path) = saved_png("select", &synth::select_screen(1280, 720, Boss::Ultra));
        // 게임이 꺼져 있어도 파일 인식은 된다.
        let game = FakeGame::failing(GameError::NotRunning);
        let (code, out, err) = run_with(&game, &["--recognize", path.to_str().unwrap()]);
        assert_eq!(code, EXIT_OK, "{err}");
        assert_eq!(err, "");
        assert_eq!(out.lines().count(), 1);
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        let keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["screen", "boss", "confidence", "evidence", "width", "height"]
        );
        assert_eq!(json["screen"], "anomaly_select");
        assert_eq!(
            json["boss"],
            serde_json::json!({ "id": "ultra", "name": "울트라" })
        );
        assert_eq!(json["width"], 1280);
        assert_eq!(json["height"], 720);
        assert!(json["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .all(|line| line.is_string()));
        assert_eq!(game.frames.get(), 0);
        assert!(game.captures.borrow().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();

        let (dir, path) = saved_png("squad", &synth::squad_screen(1920, 1080, Boss::Harvester));
        let (code, out, _) = run_with(&game, &["--recognize", path.to_str().unwrap()]);
        assert_eq!(code, EXIT_OK);
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(json["screen"], "anomaly_squad");
        assert_eq!(json["boss"]["name"], "하베스터");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recognize_reports_other_and_unknown_with_exit_code_0() {
        let game = FakeGame::running();
        // 이상 개체 화면이 아니다.
        let (dir, path) = saved_png("other", &synth::canvas(1280, 720, synth::BACKGROUND));
        let (code, out, _) = run_with(&game, &["--recognize", path.to_str().unwrap()]);
        assert_eq!(code, EXIT_OK);
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(json["screen"], "other");
        assert!(json["boss"].is_null());
        std::fs::remove_dir_all(&dir).unwrap();

        // 지원하지 않는 화면 비율: 답이 "모른다"일 뿐 실패가 아니다.
        let (dir, path) = saved_png("unknown", &synth::select_screen(1600, 1200, Boss::Kraken));
        let (code, out, err) = run_with(&game, &["--recognize", path.to_str().unwrap()]);
        assert_eq!(code, EXIT_OK, "{err}");
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(json["screen"], "unknown");
        assert!(json["boss"].is_null());
        assert_eq!(json["confidence"], 0.0);
        assert!(json["evidence"][0].as_str().unwrap().contains("화면 비율"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recognize_of_a_missing_or_broken_file_exits_with_1() {
        let game = FakeGame::running();
        let (code, out, err) = run_with(&game, &["--recognize", "Z:\\없는\\파일.png"]);
        assert_eq!(code, EXIT_ERROR);
        assert_eq!(out, "");
        assert!(err.contains("이미지를 읽지 못했다"), "{err}");
        assert_eq!(game.frames.get(), 0);

        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-recognize-cli-{}-broken",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let text = dir.join("memo.png");
        std::fs::write(&text, "그림이 아니다").unwrap();
        let (code, out, err) = run_with(&game, &["--recognize", text.to_str().unwrap()]);
        assert_eq!(code, EXIT_ERROR);
        assert_eq!(out, "");
        assert!(err.contains("PNG가 아니거나 깨졌다"), "{err}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recognize_live_recognises_the_game_screen_and_saves_nothing() {
        let game = FakeGame::running();
        let (code, out, err) = run_with(&game, &["--recognize-live"]);
        assert_eq!(code, EXIT_OK, "{err}");
        assert_eq!(err, "");
        assert_eq!(out.lines().count(), 1);
        let json: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(json["screen"], "anomaly_select");
        assert_eq!(
            json["boss"],
            serde_json::json!({ "id": "kraken", "name": "크라켄" })
        );
        // 한 번 찍었고, 저장 요청은 없었고, 결과에 파일 경로가 없다.
        assert_eq!(game.frames.get(), 1);
        assert!(game.captures.borrow().is_empty());
        assert!(json.get("path").is_none());
    }

    #[test]
    fn recognize_live_without_the_game_exits_with_2() {
        for error in [GameError::NotRunning, GameError::LauncherOnly] {
            let (code, out, err) = run_with(&FakeGame::failing(error), &["--recognize-live"]);
            assert_eq!(code, EXIT_NO_GAME);
            assert_eq!(code, 2);
            assert_eq!(out, "");
            assert!(!err.is_empty());
        }
        // 최소화·빈 화면은 게임이 있는 것이다 — 종료 코드 1.
        for (error, expected) in [
            (GameError::Minimized, "최소화"),
            (
                GameError::BlankFrame {
                    method: CaptureMethod::Wgc,
                    kind: capture::BlankKind::Black,
                },
                "전부 검다",
            ),
        ] {
            let (code, out, err) = run_with(&FakeGame::failing(error), &["--recognize-live"]);
            assert_eq!(code, EXIT_ERROR);
            assert_eq!(out, "");
            assert!(err.contains(expected), "{err}");
        }
    }

    #[test]
    fn help_prints_usage_and_succeeds() {
        let (code, out, err) = run_with(&FakeGame::failing(GameError::NotRunning), &["--help"]);
        assert_eq!(code, EXIT_OK);
        assert_eq!(err, "");
        assert!(out.contains("nikke-capture --info"));
        assert!(out.contains("data/captures"));
        assert!(out.contains("nikke-capture --recognize <PNG 파일>"));
        assert!(out.contains("nikke-capture --recognize-live"));
    }
}
