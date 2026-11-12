//! `engine::run_batch` 통합 테스트 — 실제 엔진(vendor/nikke-calc)과 실제 python을 띄운다. 수십 초 걸린다.
//!
//! - 실제 엔진: 입력 순서 보존, 한 건의 오류가 다른 건을 막지 않음, 결정론
//! - Node 런타임과 대조: 같은 요청의 total_damage가 같다 (`node`가 PATH에 있어야 한다)
//! - 가짜 엔진(작은 python 스크립트): 시간 제한, 종료 코드, 깨진 출력, 빠진 결과, PYTHONUTF8
//!
//! Tauri 명령 `engine_run_batch`(src/lib.rs)는 설정을 정한 뒤 이 함수를 그대로 부른다.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use nikke_companion_lib::engine::{
    self, EngineConfig, EngineError, EngineSettings, DEFAULT_TIMEOUT, ENGINE_REPO,
};
use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// 앱이 저장소 안에서 실행될 때와 같은 방법으로 설정을 정한다(환경 변수 NIKKE_PYTHON·NIKKE_ENGINE_DIR 존중).
fn real_config(concurrency: usize) -> EngineConfig {
    let settings = EngineSettings {
        concurrency: Some(concurrency),
        ..EngineSettings::default()
    };
    engine::resolve_config(&settings, |name| std::env::var(name).ok(), &[repo_root()])
        .expect("vendor/nikke-calc 서브모듈이 있어야 한다")
}

fn sim(squad: &[&str]) -> Value {
    json!({ "squad": squad, "sim": { "expected": true, "duration": 20 } })
}

fn member_names(row: &Value) -> Vec<String> {
    row["members"]
        .as_array()
        .unwrap_or_else(|| panic!("결과에 members가 없다: {row}"))
        .iter()
        .map(|m| m["name"].as_str().expect("이름").to_string())
        .collect()
}

fn total(row: &Value) -> u64 {
    row["total_damage"]
        .as_u64()
        .unwrap_or_else(|| panic!("결과에 total_damage가 없다: {row}"))
}

#[test]
fn real_engine_keeps_input_order_isolates_row_errors_and_is_deterministic() {
    // 6건을 4개 프로세스에 나눈다 — 프로세스마다 끝나는 때가 달라도 결과는 입력 순서여야 한다.
    let requests = vec![
        sim(&["크라운", "헬름"]),
        json!({ "squad": ["없는 니케"] }),
        sim(&["헬름", "크라운"]),
        json!("객체가 아닌 요청"),
        sim(&["앨리스"]),
        sim(&["크라운"]),
    ];
    let progress: Mutex<Vec<(usize, usize)>> = Mutex::new(Vec::new());
    let on_progress = |done: usize, total: usize| progress.lock().unwrap().push((done, total));
    let rows = engine::run_batch(&real_config(4), &requests, Some(&on_progress)).expect("배치 실행");

    assert_eq!(rows.len(), 6);
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(row["id"], json!(i), "결과 {i}의 번호");
    }
    assert_eq!(member_names(&rows[0]), ["크라운", "헬름"]);
    assert_eq!(member_names(&rows[2]), ["헬름", "크라운"]);
    assert_eq!(member_names(&rows[4]), ["앨리스"]);
    assert_eq!(member_names(&rows[5]), ["크라운"]);

    // 한 건의 오류는 그 줄에만 남는다.
    assert_eq!(rows[1]["error"]["type"], "invalid_input");
    assert_eq!(rows[1]["error"]["path"], "/squad/0");
    assert_eq!(rows[3]["error"]["type"], "invalid_input");
    for i in [0, 2, 4, 5] {
        assert!(rows[i].get("error").is_none(), "결과 {i}: {}", rows[i]);
        assert!(total(&rows[i]) > 0);
        // 엔진이 어떤 판으로 계산했는지 결과에 남는다.
        assert_eq!(rows[i]["evaluator"]["repo"], ENGINE_REPO);
    }

    // 진행 상황은 건마다 한 번씩, 마지막은 전체다.
    let mut seen = progress.lock().unwrap().clone();
    assert_eq!(seen.len(), 6);
    assert!(seen.iter().all(|&(_, total)| total == 6));
    seen.sort_unstable();
    assert_eq!(seen.last(), Some(&(6, 6)));

    // 결정론: 다시 돌려도, 프로세스 하나로 순서대로 돌려도 수치가 같다.
    let again = engine::run_batch(&real_config(4), &requests, None).expect("두 번째 실행");
    let serial = engine::run_batch(&real_config(1), &requests, None).expect("프로세스 하나로 실행");
    for i in [0, 2, 4, 5] {
        assert_eq!(total(&again[i]), total(&rows[i]), "결과 {i}: 다시 돌린 값");
        assert_eq!(total(&serial[i]), total(&rows[i]), "결과 {i}: 프로세스 하나로 돌린 값");
        assert_eq!(again[i]["members"], rows[i]["members"]);
    }
    assert_eq!(serial[1]["error"]["message"], rows[1]["error"]["message"]);
}

#[test]
fn rust_command_and_node_runtime_give_the_same_total_damage() {
    // 기준: Node 런타임(src/runtime/node.mjs)이 샘플 계정으로 만든 요청과 그 결과.
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/node_runtime_reference.mjs");
    let node = std::env::var("NIKKE_NODE").unwrap_or_else(|_| "node".to_string());
    let output = Command::new(&node)
        .arg(&script)
        .stdin(Stdio::null())
        .output()
        .unwrap_or_else(|e| panic!("{node}를 실행할 수 없다 — Node 런타임과 대조하려면 node가 필요하다: {e}"));
    assert!(
        output.status.success(),
        "기준 스크립트가 실패했다: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reference: Value = serde_json::from_slice(&output.stdout).expect("기준 출력은 JSON이다");
    let requests = reference["requests"].as_array().expect("requests").clone();
    let expected = reference["results"].as_array().expect("results");
    assert!(requests.len() >= 4, "샘플 편성 3개 + 오류 1건");

    let config = real_config(4);
    let rows = engine::run_batch(&config, &requests, None).expect("배치 실행");
    assert_eq!(rows.len(), expected.len());

    let mut compared = 0;
    for (i, (ours, theirs)) in rows.iter().zip(expected).enumerate() {
        if theirs.get("error").is_some() {
            assert_eq!(ours["error"]["type"], theirs["error"]["type"], "요청 {i}");
            assert_eq!(ours["error"]["message"], theirs["error"]["message"], "요청 {i}");
            assert_eq!(ours["error"]["path"], theirs["error"]["path"], "요청 {i}");
            continue;
        }
        assert_eq!(total(ours), total(theirs), "요청 {i}의 total_damage");
        assert_eq!(ours["members"], theirs["members"], "요청 {i}의 멤버별 딜");
        assert_eq!(ours["evaluator"], theirs["evaluator"], "요청 {i}의 엔진 판");
        assert!(total(ours) > 100_000_000, "샘플 계정의 180초 총딜이 너무 작다");
        compared += 1;
    }
    assert_eq!(compared, 3, "샘플 편성 3개를 모두 대조해야 한다");
    assert_eq!(
        rows.iter().filter(|r| r.get("error").is_some()).count(),
        1,
        "오류 줄은 하나다"
    );

    // 카탈로그와 버전도 같은 값이다(키 순서 포함).
    let catalog = engine::catalog(&config.engine_dir).expect("카탈로그");
    let names: Vec<&String> = catalog["nikkes"].as_object().expect("nikkes").keys().collect();
    let expected_names: Vec<&str> = reference["catalog"]["nikke_names"]
        .as_array()
        .expect("nikke_names")
        .iter()
        .map(|n| n.as_str().expect("이름"))
        .collect();
    assert_eq!(names, expected_names);
    assert_eq!(catalog["bosses"], reference["catalog"]["bosses"]);
    assert!(catalog["nikkes"]["크라운"]["burst_stage"].is_string());
    // 큐브 목록(P-031 — 큐브 바꿔 보기)도 Node 런타임과 같은 값·같은 순서다.
    assert_eq!(catalog["cubes"], reference["catalog"]["cubes"]);
    let cubes = catalog["cubes"].as_array().expect("cubes");
    assert!(cubes.iter().any(|c| c["supported"] == true) && cubes.iter().all(|c| c["name"].is_string()));

    let version = engine::version(&config.engine_dir);
    assert_eq!(version, reference["version"]);
    let commit = version["commit"].as_str().expect("서브모듈 커밋");
    assert!(commit.len() == 40 && commit.chars().all(|c| c.is_ascii_hexdigit()));
}

// ── 가짜 엔진 ─────────────────────────────────────────────────────────────────

/// 요청의 `mode`대로 움직이는 가짜 `runner.sim`. 실제 엔진으로는 만들기 어려운 실패를 흉내 낸다.
const FAKE_SIM: &str = r#"
import json, os, sys, time
for line in sys.stdin:
    if not line.strip():
        continue
    req = json.loads(line)
    mode = req.get("mode")
    if mode == "sleep":
        time.sleep(120)
    elif mode == "exit":
        sys.stderr.write("가짜 엔진이 멈췄다\n")
        sys.exit(3)
    elif mode == "garbage":
        print("JSON이 아닌 줄")
        sys.stdout.flush()
        continue
    elif mode == "drop":
        continue
    row = {"id": req["id"], "squad": req.get("squad"), "utf8": os.environ.get("PYTHONUTF8"),
           "encoding": sys.stdout.encoding.lower(), "cwd": os.getcwd(), "argv": sys.argv[1:]}
    print(json.dumps(row, ensure_ascii=False))
    sys.stdout.flush()
"#;

/// 테스트마다 다른 임시 엔진 폴더. 끝나면 지운다.
struct FakeEngine(PathBuf);

impl FakeEngine {
    fn new() -> Self {
        static SEQ: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "nikke-companion-fake-engine-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(dir.join("runner")).expect("임시 엔진 폴더");
        fs::write(dir.join("runner/__init__.py"), "").expect("__init__.py");
        fs::write(dir.join("runner/sim.py"), FAKE_SIM).expect("sim.py");
        Self(dir)
    }

    fn config(&self, concurrency: usize, timeout: Duration) -> EngineConfig {
        EngineConfig {
            engine_dir: self.0.clone(),
            python: std::env::var(engine::ENV_PYTHON).unwrap_or_else(|_| "python".to_string()),
            concurrency,
            timeout,
        }
    }
}

impl Drop for FakeEngine {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn engine_runs_in_its_folder_with_utf8_and_batch_arguments() {
    let fake = FakeEngine::new();
    let requests: Vec<Value> = (0..9)
        .map(|i| json!({ "squad": [format!("니케 {i}")], "id": "요청이 준 번호는 덮어쓴다" }))
        .collect();
    let rows = engine::run_batch(&fake.config(4, DEFAULT_TIMEOUT), &requests, None).expect("배치 실행");
    assert_eq!(rows.len(), 9);
    let engine_dir = fs::canonicalize(&fake.0).expect("엔진 폴더");
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(row["id"], json!(i));
        // 한글 이름이 깨지지 않고 오간다(Windows 콘솔 기본 인코딩은 cp949다).
        assert_eq!(row["squad"], json!([format!("니케 {i}")]));
        assert_eq!(row["utf8"], "1");
        assert_eq!(row["encoding"], "utf-8");
        assert_eq!(row["argv"], json!(["--batch"]));
        let cwd = fs::canonicalize(row["cwd"].as_str().expect("cwd")).expect("cwd");
        assert_eq!(cwd, engine_dir);
    }
}

#[test]
fn a_stuck_engine_is_stopped_at_the_time_limit() {
    let fake = FakeEngine::new();
    let started = Instant::now();
    let err = engine::run_batch(
        &fake.config(2, Duration::from_secs(2)),
        &[json!({ "mode": "sleep" }), json!({ "squad": ["크라운"] })],
        None,
    )
    .unwrap_err();
    assert_eq!(err, EngineError::Timeout { seconds: 2 });
    assert!(err.to_string().contains("시간 초과"));
    assert!(started.elapsed() < Duration::from_secs(60), "멈춘 프로세스를 기다리지 않는다");
}

#[test]
fn a_crashed_engine_process_fails_the_batch_and_stops_the_others() {
    let fake = FakeEngine::new();
    let started = Instant::now();
    // 프로세스 둘: 하나는 바로 죽고 하나는 오래 걸린다. 죽은 쪽의 오류를 알리고 남은 쪽도 멈춘다.
    let err = engine::run_batch(
        &fake.config(2, DEFAULT_TIMEOUT),
        &[json!({ "mode": "exit" }), json!({ "mode": "sleep" })],
        None,
    )
    .unwrap_err();
    match &err {
        EngineError::Exit { code, detail } => {
            assert_eq!(code, "3");
            assert!(detail.contains("가짜 엔진이 멈췄다"), "{detail}");
        }
        other => panic!("종료 코드 오류여야 한다: {other:?}"),
    }
    assert!(started.elapsed() < Duration::from_secs(60), "남은 프로세스를 끝까지 기다리지 않는다");
}

#[test]
fn output_that_is_not_json_or_misses_a_request_is_an_error() {
    let fake = FakeEngine::new();
    let config = fake.config(1, DEFAULT_TIMEOUT);
    let err = engine::run_batch(&config, &[json!({ "mode": "garbage" })], None).unwrap_err();
    assert_eq!(
        err,
        EngineError::BadOutput {
            line: "JSON이 아닌 줄".to_string()
        }
    );

    let err = engine::run_batch(
        &config,
        &[json!({ "squad": ["크라운"] }), json!({ "mode": "drop" })],
        None,
    )
    .unwrap_err();
    assert_eq!(err, EngineError::MissingResult { index: 1 });
    assert!(err.to_string().contains("요청 1"));
}

/// P-032: 버스트 흐름 — 엔진의 JSON 결과에는 없어 텍스트 보기(`--view burst`)를 돌려 글을 받는다.
#[test]
fn real_engine_burst_view_returns_the_text_in_input_order_and_isolates_row_errors() {
    let deck = ["리틀 머메이드", "크라운", "라피 : 레드 후드", "헬름", "앨리스"];
    let requests = vec![
        sim(&deck),
        json!({ "squad": ["없는 니케"] }),
        sim(&["크라운", "헬름"]),
    ];
    let progress = Mutex::new(Vec::new());
    let on_progress = |done: usize, total: usize| progress.lock().unwrap().push((done, total));
    let rows = engine::run_views(
        &real_config(3),
        &requests,
        "burst",
        Some(&on_progress),
        &engine::StopSignal::new(),
    )
    .expect("보기 실행");
    assert_eq!(rows.len(), 3);

    // 엔진이 적은 글 그대로다: 머리줄과, 이름에 콜론·공백이 있는 니케의 줄(한글이 깨지지 않았다).
    let text = rows[0]["text"].as_str().expect("글");
    assert!(text.contains("[버스트 사이클]"), "{text}");
    assert!(text.contains("stage:1 사용  리틀 머메이드"), "{text}");
    assert!(text.contains("stage:3 사용  라피 : 레드 후드"), "{text}");
    assert!(text.contains("full_burst 시작"), "{text}");
    assert!(rows[0].get("error").is_none());

    // 입력 오류는 그 건만 오류다(엔진의 말이 실린다).
    assert_eq!(rows[1]["error"]["type"], "invalid_input", "{}", rows[1]);
    let said = rows[1]["error"]["message"].as_str().expect("문장");
    assert!(said.contains("없는 니케"), "{said}");
    assert!(rows[1].get("text").is_none());

    // 1단계가 없는 두 명: 그래도 엔진의 글에는 머리줄이 있다.
    assert!(rows[2]["text"].as_str().expect("글").contains("[버스트 사이클]"));

    let mut seen = progress.into_inner().unwrap();
    seen.sort_unstable();
    assert_eq!(seen, vec![(1, 3), (2, 3), (3, 3)]);
}
