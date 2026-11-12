//! 계산 엔진(`vendor/nikke-calc`) 호출 — Node 런타임(`src/runtime/node.mjs`)과 같은 일을 한다.
//!
//! 여기에는 계산 로직이 없다. 엔진의 요청·결과 JSON 계약(`vendor/nikke-calc/docs/SIM-JSON.md`)대로
//! `python -m runner.sim --batch`를 띄워 줄을 주고받을 뿐이다. 요청을 만들고 결과를 해석하는 것은
//! 화면 쪽에서 도는 계산 모듈(`src/core`)이다. Tauri API를 모른다(명령은 `lib.rs`가 잇는다).

use std::fmt;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

/// 결과에 남기는 엔진 저장소 이름. `src/core/runtime.mjs`의 `ENGINE_REPO`와 같아야 한다.
pub const ENGINE_REPO: &str = "Jgaram/nikke-calc";

/// 동시에 띄우는 엔진 프로세스의 상한.
pub const MAX_WORKERS: usize = 4;

/// 엔진 프로세스 하나의 기본 시간 제한(Node 런타임과 같다).
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// 엔진 폴더를 지정하는 환경 변수.
pub const ENV_ENGINE_DIR: &str = "NIKKE_ENGINE_DIR";
/// python 실행 파일을 지정하는 환경 변수(Node 런타임과 같은 이름).
pub const ENV_PYTHON: &str = "NIKKE_PYTHON";

/// 엔진 폴더임을 확인하는 파일.
const ENGINE_MARKER: &str = "runner/sim.py";
/// 저장소 루트에서 본 엔진 폴더.
const ENGINE_SUBDIR: &str = "vendor/nikke-calc";

/// 설정 파일(`settings.json`)의 내용. 적지 않은 칸은 환경 변수와 기본값으로 정한다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EngineSettings {
    /// 엔진 폴더(`runner/sim.py`가 있는 곳).
    pub engine_dir: Option<String>,
    /// python 실행 파일 이름 또는 경로.
    pub python: Option<String>,
    /// 동시에 띄울 엔진 프로세스 수(1~4).
    pub concurrency: Option<usize>,
    /// 엔진 프로세스 하나의 시간 제한(초).
    pub timeout_seconds: Option<u64>,
}

/// 엔진을 부를 때 쓰는 확정된 값.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineConfig {
    pub engine_dir: PathBuf,
    pub python: String,
    pub concurrency: usize,
    pub timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    SettingsUnreadable { path: String, detail: String },
    SettingsInvalid { path: String, detail: String },
    EngineDirNotFound,
    NotAnEngineDir { path: String },
    DataUnreadable { path: String, detail: String },
    DataInvalid { path: String, detail: String },
    Spawn { python: String, detail: String },
    Timeout { seconds: u64 },
    Io { detail: String },
    BadOutput { line: String },
    Exit { code: String, detail: String },
    MissingResult { index: usize },
    Cancelled,
    /// 밖에서 멈추라고 했다(`StopSignal`). 화면의 중단 단추가 이 길로 온다.
    Stopped,
    Busy,
}

/// 중단으로 끝난 배치의 오류 문장이 시작하는 말. 화면이 '중단됨'으로 보인다.
pub const STOPPED_PREFIX: &str = "중단됨";

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SettingsUnreadable { path, detail } => {
                write!(f, "설정 파일을 읽을 수 없다: {path} ({detail})")
            }
            Self::SettingsInvalid { path, detail } => write!(
                f,
                "설정 파일의 형식이 잘못됐다: {path} ({detail}). 쓸 수 있는 칸: engine_dir, python, concurrency, timeout_seconds"
            ),
            Self::EngineDirNotFound => write!(
                f,
                "엔진 폴더(vendor/nikke-calc)를 찾을 수 없다. 설정 파일의 engine_dir 또는 환경 변수 {ENV_ENGINE_DIR}로 지정하라"
            ),
            Self::NotAnEngineDir { path } => write!(
                f,
                "엔진 폴더가 아니다({ENGINE_MARKER}가 없다): {path}. 서브모듈을 받았는지 확인하라"
            ),
            Self::DataUnreadable { path, detail } => {
                write!(f, "엔진 데이터를 읽을 수 없다: {path} ({detail})")
            }
            Self::DataInvalid { path, detail } => {
                write!(f, "엔진 데이터의 형식이 다르다: {path} ({detail})")
            }
            Self::Spawn { python, detail } => {
                write!(f, "엔진을 실행할 수 없다 ({python}): {detail}")
            }
            Self::Timeout { seconds } => write!(f, "엔진 시간 초과 ({seconds}초)"),
            Self::Io { detail } => write!(f, "엔진과 주고받는 중 오류가 났다: {detail}"),
            Self::BadOutput { line } => write!(f, "엔진 출력이 JSON이 아니다: {line}"),
            Self::Exit { code, detail } => write!(f, "엔진 종료 코드 {code}: {detail}"),
            Self::MissingResult { index } => {
                write!(f, "엔진이 요청 {index}의 결과를 돌려주지 않았다")
            }
            Self::Cancelled => write!(f, "다른 엔진 프로세스의 오류로 계산을 멈췄다"),
            Self::Stopped => write!(f, "{STOPPED_PREFIX}: 엔진 계산을 멈췄다"),
            Self::Busy => write!(f, "이미 계산 중이다. 끝난 뒤에 다시 실행하라"),
        }
    }
}

impl std::error::Error for EngineError {}

// ── 설정 ─────────────────────────────────────────────────────────────────────

/// 설정 파일을 읽는다. 파일이 없으면 빈 설정이다(환경 변수와 기본값을 쓴다).
pub fn load_settings_file(path: &Path) -> Result<EngineSettings, EngineError> {
    let shown = path.display().to_string();
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(EngineSettings::default()),
        Err(e) => {
            return Err(EngineError::SettingsUnreadable {
                path: shown,
                detail: e.to_string(),
            })
        }
    };
    parse_settings(&text).map_err(|detail| EngineError::SettingsInvalid {
        path: shown,
        detail,
    })
}

/// 설정 파일 내용을 읽는다. 모르는 칸은 오타일 수 있어 오류로 본다.
pub fn parse_settings(text: &str) -> Result<EngineSettings, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if text.trim().is_empty() {
        return Ok(EngineSettings::default());
    }
    serde_json::from_str(text).map_err(|e| e.to_string())
}

/// 이 PC에서 쓸 기본 동시 실행 수: 코어 하나를 남기고 최대 4개(Node 런타임과 같은 규칙).
pub fn default_concurrency() -> usize {
    let cores = thread::available_parallelism().map_or(1, usize::from);
    cores.saturating_sub(1).clamp(1, MAX_WORKERS)
}

fn is_engine_dir(dir: &Path) -> bool {
    dir.join(ENGINE_MARKER).is_file()
}

/// 주어진 폴더들에서 위로 올라가며 `vendor/nikke-calc`를 찾는다(저장소 안에서 실행할 때의 기본값).
pub fn find_engine_dir(start_dirs: &[PathBuf]) -> Option<PathBuf> {
    start_dirs
        .iter()
        .flat_map(|start| start.ancestors())
        .map(|dir| dir.join(ENGINE_SUBDIR))
        .find(|candidate| is_engine_dir(candidate))
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// 설정을 확정한다. 우선순위: 환경 변수 → 설정 파일 → 기본값(엔진 폴더는 `search_from`에서 위로 찾는다).
pub fn resolve_config(
    settings: &EngineSettings,
    env: impl Fn(&str) -> Option<String>,
    search_from: &[PathBuf],
) -> Result<EngineConfig, EngineError> {
    let configured =
        non_empty(env(ENV_ENGINE_DIR)).or_else(|| non_empty(settings.engine_dir.clone()));
    let engine_dir = match configured {
        Some(dir) => {
            let dir = PathBuf::from(dir);
            if !is_engine_dir(&dir) {
                return Err(EngineError::NotAnEngineDir {
                    path: dir.display().to_string(),
                });
            }
            dir
        }
        None => find_engine_dir(search_from).ok_or(EngineError::EngineDirNotFound)?,
    };
    let python = non_empty(env(ENV_PYTHON))
        .or_else(|| non_empty(settings.python.clone()))
        .unwrap_or_else(|| "python".to_string());
    let concurrency = settings
        .concurrency
        .unwrap_or_else(default_concurrency)
        .clamp(1, MAX_WORKERS);
    let timeout = settings
        .timeout_seconds
        .filter(|s| *s > 0)
        .map_or(DEFAULT_TIMEOUT, Duration::from_secs);
    Ok(EngineConfig {
        engine_dir,
        python,
        concurrency,
        timeout,
    })
}

// ── 카탈로그·버전 ─────────────────────────────────────────────────────────────

fn read_engine_json(engine_dir: &Path, relative: &str) -> Result<Value, EngineError> {
    let path = engine_dir.join(relative);
    let shown = path.display().to_string();
    let text = fs::read_to_string(&path).map_err(|e| EngineError::DataUnreadable {
        path: shown.clone(),
        detail: e.to_string(),
    })?;
    serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text)).map_err(|e| {
        EngineError::DataInvalid {
            path: shown,
            detail: e.to_string(),
        }
    })
}

/// 엔진의 큐브 표(엔진 폴더 기준 경로). 카탈로그의 `cubes`가 여기서 나온다.
const CUBE_TABLE_FILE: &str = "data/base_stat_tables/cube.json";

/// 엔진의 큐브 표 → 카탈로그의 `cubes`: `[{name, skill, effect, max_level, supported}]`(표의 순서 그대로).
///
/// 루트 `src/core/efficiency.mjs`의 `cubeCatalogFrom`과 같은 규칙이다: `_`로 시작하는 키(주석·공통 스탯)와
/// `공통`(어떤 큐브를 껴도 붙는 두 번째 효과 — 큐브 이름이 아니다)은 빼고, `unsupported`가 참이면 엔진이 효과를
/// 계산하지 못하는 큐브다(`supported: false`).
pub fn cube_catalog(table: &Value) -> Vec<Value> {
    let Some(table) = table.as_object() else {
        return Vec::new();
    };
    // JS의 「참 같은 값」과 같게 본다(`!row.unsupported`).
    let truthy = |v: Option<&Value>| match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    };
    table
        .iter()
        .filter(|(name, row)| !name.starts_with('_') && name.as_str() != "공통" && row.is_object())
        .map(|(name, row)| {
            json!({
                "name": name,
                "skill": row.get("스킬명").and_then(Value::as_str),
                "effect": row.get("template").and_then(Value::as_str),
                "max_level": row.get("values").and_then(Value::as_object).map_or(0, |v| v.len()),
                "supported": !truthy(row.get("unsupported")),
            })
        })
        .collect()
}

/// 엔진이 아는 니케·보스 프리셋·큐브: `{nikkes, bosses, cubes}`. Node 런타임의 `loadCatalog`와 같은 값이다
/// (키 순서도 파일 그대로 — serde_json의 `preserve_order`).
pub fn catalog(engine_dir: &Path) -> Result<Value, EngineError> {
    let nikkes = read_engine_json(engine_dir, "data/parsed_nikke.json")?;
    if !nikkes.is_object() {
        return Err(EngineError::DataInvalid {
            path: engine_dir.join("data/parsed_nikke.json").display().to_string(),
            detail: "최상위가 객체가 아니다".to_string(),
        });
    }
    let presets = read_engine_json(engine_dir, "data/boss_presets.json")?;
    let Some(presets) = presets.as_object() else {
        return Err(EngineError::DataInvalid {
            path: engine_dir.join("data/boss_presets.json").display().to_string(),
            detail: "최상위가 객체가 아니다".to_string(),
        });
    };
    let bosses: Vec<&String> = presets.keys().filter(|k| !k.starts_with('_')).collect();
    // 큐브 표를 읽지 못하면 카탈로그를 버리지 않고 큐브만 「모름」(null)으로 둔다 — 화면이 큐브를 바꿔 볼 수 없다고 말한다.
    let cubes = read_engine_json(engine_dir, CUBE_TABLE_FILE)
        .ok()
        .map(|table| cube_catalog(&table));
    Ok(json!({ "nikkes": nikkes, "bosses": bosses, "cubes": cubes }))
}

/// 엔진 버전: `{repo, commit, dirty}`. 커밋을 알 수 없으면 commit·dirty가 null이다(값을 지어내지 않는다).
///
/// `dirty`는 엔진이 결과에 싣는 `evaluator.dirty`와 같은 기준이다: 추적 중인 파일에 커밋하지 않은 변경이 있나
/// (`git status --porcelain -uno`). 시뮬 결과 캐시(루트 `src/core/cache.mjs`)가 이 값으로 캐시를 쓸지 정한다 —
/// Node 런타임(`src/runtime/node.mjs`의 `engineVersion`)과 같은 값을 내야 한다.
pub fn version(engine_dir: &Path) -> Value {
    // `--no-optional-locks`: 엔진 프로세스와 동시에 불려도 `.git/index`를 건드리지 않는다.
    let git = |args: &[&str]| -> Option<String> {
        let mut cmd = Command::new("git");
        cmd.arg("--no-optional-locks")
            .arg("-C")
            .arg(engine_dir)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        hide_console(&mut cmd);
        cmd.output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
    };
    let commit = git(&["rev-parse", "HEAD"]).filter(|commit| !commit.is_empty());
    let dirty = commit
        .as_ref()
        .and_then(|_| git(&["status", "--porcelain", "-uno"]))
        .map(|status| !status.is_empty());
    json!({ "repo": ENGINE_REPO, "commit": commit, "dirty": dirty })
}

// ── 중단 ─────────────────────────────────────────────────────────────────────

/// 도는 배치를 밖에서 멈추는 신호. 한 번 켜면 꺼지지 않는다 — 배치마다 새로 만든다.
#[derive(Debug, Default)]
pub struct StopSignal(AtomicBool);

impl StopSignal {
    pub fn new() -> Self {
        Self::default()
    }

    /// 멈추라고 한다. 이 신호로 도는 배치의 엔진 프로세스가 모두 끝나고 `EngineError::Stopped`가 돌아온다.
    pub fn stop(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_stopped(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// 앱에서 한 번에 하나만 도는 엔진 배치의 자리. 겹쳐 띄우지 않게 하고, 도는 배치를 멈추는 길을 준다.
///
/// 신호를 배치마다 새로 만들기 때문에, 늦게 온 중단 요청이 다음 배치를 멈추는 일이 없다.
#[derive(Debug, Default)]
pub struct BatchSlot(Mutex<Option<Arc<StopSignal>>>);

/// 배치가 자리를 쥐고 있는 동안 들고 있는 표. 버리면(배치가 끝나면 — 오류로 끝나도) 자리가 빈다.
#[derive(Debug)]
pub struct BatchTicket<'a> {
    slot: &'a BatchSlot,
    signal: Arc<StopSignal>,
}

impl BatchSlot {
    fn guard(&self) -> MutexGuard<'_, Option<Arc<StopSignal>>> {
        // 다른 스레드가 잠근 채 죽었어도 자리 값 자체는 쓸 수 있다.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 자리를 잡는다. 이미 도는 배치가 있으면 `Busy`.
    pub fn begin(&self) -> Result<BatchTicket<'_>, EngineError> {
        let mut current = self.guard();
        if current.is_some() {
            return Err(EngineError::Busy);
        }
        let signal = Arc::new(StopSignal::new());
        *current = Some(Arc::clone(&signal));
        Ok(BatchTicket { slot: self, signal })
    }

    /// 도는 배치를 멈추라고 한다. 도는 배치가 있었으면 `true`, 없었으면 아무 일도 하지 않고 `false`.
    pub fn stop(&self) -> bool {
        match self.guard().as_ref() {
            Some(signal) => {
                signal.stop();
                true
            }
            None => false,
        }
    }

    /// 배치가 돌고 있는가.
    pub fn is_running(&self) -> bool {
        self.guard().is_some()
    }
}

/// 앱이 끝날 때 도는 일을 정리하려고 기다려 주는 시간의 기본값.
pub const EXIT_GRACE: Duration = Duration::from_secs(3);

/// 앱이 끝날 때 부른다: 자리마다 도는 일(엔진 배치, 계정 수집)을 멈추라고 하고, 모두 끝나 자리가 빌 때까지 —
/// 곧 띄운 프로세스와 그 자식들을 끝낼 때까지 — 최대 `grace` 동안 기다린다. 모두 비었으면 `true`.
///
/// 도는 일이 없으면 기다리지 않고 곧바로 `true`다. 시간 안에 비지 않으면 `false`로 돌아오고 앱은 그대로 끝난다 —
/// Windows에서는 그때에도 프로세스 묶음(`engine_win32.rs`의 Job Object)이 앱과 함께 닫히면서 남은 프로세스를 끝낸다.
pub fn stop_all_and_wait(slots: &[&BatchSlot], grace: Duration) -> bool {
    let mut stopping = false;
    for slot in slots {
        stopping |= slot.stop();
    }
    if !stopping {
        return true;
    }
    let deadline = Instant::now() + grace;
    loop {
        if slots.iter().all(|slot| !slot.is_running()) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

impl BatchTicket<'_> {
    /// 이 배치를 멈추는 신호. `run_batch_with_stop`에 넘긴다.
    pub fn signal(&self) -> &StopSignal {
        &self.signal
    }
}

impl Drop for BatchTicket<'_> {
    fn drop(&mut self) {
        *self.slot.guard() = None;
    }
}

/// 엔진 프로세스와 그 프로세스가 띄운 프로세스들을 한꺼번에 끝내는 묶음.
///
/// Windows에서는 Job Object다(`engine_win32.rs`) — `python`이 다른 실행 파일을 띄우는 껍데기(가상 환경의 실행기 등)여도,
/// 엔진이 도중에 다른 프로그램(git)을 띄웠어도 남기지 않는다. 다른 OS에서는 띄운 프로세스 하나만 끝낸다.
#[cfg(windows)]
pub(crate) use crate::engine_win32::ProcessGroup;

#[cfg(not(windows))]
pub(crate) struct ProcessGroup;

#[cfg(not(windows))]
impl ProcessGroup {
    pub(crate) fn adopt(_child: &Child) -> Self {
        Self
    }

    pub(crate) fn terminate(&self) {}
}

/// 멈춘 엔진 프로세스를 남기지 않는다: 묶음을 끝내고, 띄운 프로세스가 죽은 것을 확인한다.
/// 계정 수집 스크립트(`account_sync.rs`)도 같은 길로 끝낸다.
pub(crate) fn kill_engine(child: &mut Child, group: &ProcessGroup) {
    group.terminate();
    let _ = child.kill();
    let _ = child.wait();
}

// ── 배치 실행 ─────────────────────────────────────────────────────────────────

/// 창 없는 프로그램에서 띄운 콘솔 프로그램이 검은 창을 번쩍이지 않게 한다.
pub(crate) fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// 요청 `count`건을 프로세스 `workers`개에 돌아가며 나눈다(Node 런타임과 같은 규칙). 값은 요청 번호다.
pub fn plan_chunks(count: usize, workers: usize) -> Vec<Vec<usize>> {
    let workers = workers.clamp(1, MAX_WORKERS).min(count.max(1));
    let mut chunks = vec![Vec::new(); workers];
    for i in 0..count {
        chunks[i % workers].push(i);
    }
    chunks.retain(|c| !c.is_empty());
    chunks
}

/// 엔진이 돌려준 줄에서 요청 번호(`id`)를 읽는다.
fn row_index(row: &Value, total: usize) -> Option<usize> {
    let id = usize::try_from(row.get("id")?.as_u64()?).ok()?;
    (id < total).then_some(id)
}

/// 객체가 아닌 요청은 엔진에 보낼 수 없다(번호를 붙일 곳이 없다). 엔진의 줄 단위 오류와 같은 모양으로 돌려준다.
fn not_an_object_row(index: usize) -> Value {
    json!({
        "id": index,
        "error": {
            "type": "invalid_input",
            "exception": "RequestError",
            "message": "배치 한 줄은 JSON 객체여야 한다",
            "path": "",
        }
    })
}

fn tail_chars(text: &str, max: usize) -> String {
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(max)).collect()
}

/// 엔진 프로세스 하나에 요청 줄들을 주고 결과 줄들을 받는다.
fn run_worker(
    config: &EngineConfig,
    lines: &[String],
    cancel: &AtomicBool,
    stop: &StopSignal,
    on_row: &(dyn Fn() + Sync),
) -> Result<Vec<Value>, EngineError> {
    // 이미 멈추라고 했으면 띄우지 않는다.
    if stop.is_stopped() {
        return Err(EngineError::Stopped);
    }
    let mut cmd = Command::new(&config.python);
    cmd.args(["-m", "runner.sim", "--batch"])
        .current_dir(&config.engine_dir)
        // Windows 콘솔 기본 인코딩(cp949)이 아니라 UTF-8로 주고받는다.
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| EngineError::Spawn {
        python: config.python.clone(),
        detail: e.to_string(),
    })?;
    let group = ProcessGroup::adopt(&child);

    let mut stdin = child.stdin.take().expect("stdin 파이프");
    let stdout = child.stdout.take().expect("stdout 파이프");
    let mut stderr = child.stderr.take().expect("stderr 파이프");
    let mut input = lines.join("\n");
    input.push('\n');
    let deadline = Instant::now() + config.timeout;

    // 입력 쓰기·출력 읽기를 따로 돌려야 파이프가 차서 서로 기다리는 일이 없다.
    let (status, out_lines, err_text) = thread::scope(|scope| {
        scope.spawn(move || {
            // 엔진이 먼저 끝나면 쓰기는 실패한다. 그때는 종료 코드가 사정을 알려 준다.
            let _ = stdin.write_all(input.as_bytes());
        });
        let reader = scope.spawn(move || -> std::io::Result<Vec<String>> {
            let mut rows = Vec::new();
            for line in BufReader::new(stdout).lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                rows.push(line);
                on_row();
            }
            Ok(rows)
        });
        let errors = scope.spawn(move || {
            let mut bytes = Vec::new();
            let _ = stderr.read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        });

        let status: Result<ExitStatus, EngineError> = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {}
                Err(e) => {
                    break Err(EngineError::Io {
                        detail: e.to_string(),
                    })
                }
            }
            let halt = if stop.is_stopped() {
                Some(EngineError::Stopped)
            } else if cancel.load(Ordering::Relaxed) {
                Some(EngineError::Cancelled)
            } else if Instant::now() >= deadline {
                Some(EngineError::Timeout {
                    seconds: config.timeout.as_secs(),
                })
            } else {
                None
            };
            if let Some(reason) = halt {
                break Err(reason);
            }
            thread::sleep(Duration::from_millis(15));
        };
        if status.is_err() {
            // 멈춘 프로세스를 남기지 않는다. 죽으면 파이프가 닫혀 읽는 쪽도 끝난다.
            kill_engine(&mut child, &group);
        }
        let out_lines = reader.join().unwrap_or_else(|_| Ok(Vec::new()));
        let err_text = errors.join().unwrap_or_default();
        (status, out_lines, err_text)
    });

    let status = status?;
    let out_lines = out_lines.map_err(|e| EngineError::Io {
        detail: e.to_string(),
    })?;
    let mut rows = Vec::with_capacity(out_lines.len());
    for line in &out_lines {
        let row: Value = serde_json::from_str(line).map_err(|_| EngineError::BadOutput {
            line: line.chars().take(200).collect(),
        })?;
        rows.push(row);
    }
    // 배치를 시작하지도 못했으면(코드≠0) 줄 단위 결과가 아니다.
    if !status.success() {
        let detail = rows
            .first()
            .and_then(|row| row.pointer("/error/message"))
            .and_then(Value::as_str)
            .map_or_else(|| tail_chars(err_text.trim(), 500), str::to_string);
        return Err(EngineError::Exit {
            code: status
                .code()
                .map_or_else(|| "없음".to_string(), |c| c.to_string()),
            detail,
        });
    }
    Ok(rows)
}

/// 요청 여러 건을 엔진 배치로 돌린다. 반환 배열은 입력 순서와 같다.
///
/// 요청마다 결과 객체 또는 `{error: {type, message, path}}`가 온다 — 한 건의 오류가 다른 건을 막지 않는다.
/// 프로세스를 띄우지 못했거나 시간을 넘기는 등 배치 자체가 실패하면 `Err`이고, 남은 프로세스도 멈춘다.
/// `on_progress(끝난 수, 전체 수)`는 결과 줄이 도착할 때마다 불린다.
pub fn run_batch(
    config: &EngineConfig,
    requests: &[Value],
    on_progress: Option<&(dyn Fn(usize, usize) + Sync)>,
) -> Result<Vec<Value>, EngineError> {
    run_batch_with_stop(config, requests, on_progress, &StopSignal::new())
}

/// `run_batch`와 같되 밖에서 멈출 수 있다: `stop`이 켜지면 엔진 프로세스를 모두 끝내고 `EngineError::Stopped`를
/// 돌려준다(프로세스마다 0.015초 간격으로 신호를 본다). 그때까지 끝난 결과는 버린다 — 일부만 계산된 배치를 결과로
/// 내지 않는다.
pub fn run_batch_with_stop(
    config: &EngineConfig,
    requests: &[Value],
    on_progress: Option<&(dyn Fn(usize, usize) + Sync)>,
    stop: &StopSignal,
) -> Result<Vec<Value>, EngineError> {
    let total = requests.len();
    if total == 0 {
        return Ok(Vec::new());
    }
    let mut results: Vec<Option<Value>> = vec![None; total];
    let done = AtomicUsize::new(0);
    let report = || {
        let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(on_progress) = on_progress {
            on_progress(finished.min(total), total);
        }
    };

    // 요청에 번호(id)를 붙인다. 엔진이 결과 줄에 그대로 돌려주므로 프로세스를 나눠도 순서를 되찾는다.
    let mut numbered: Vec<String> = Vec::with_capacity(total);
    for (i, request) in requests.iter().enumerate() {
        match request.as_object() {
            Some(obj) => {
                let mut obj = obj.clone();
                obj.insert("id".to_string(), json!(i));
                numbered.push(Value::Object(obj).to_string());
            }
            None => {
                results[i] = Some(not_an_object_row(i));
                report();
            }
        }
    }

    let chunks = plan_chunks(numbered.len(), config.concurrency);
    let cancel = AtomicBool::new(false);
    let outcomes: Vec<Result<Vec<Value>, EngineError>> = thread::scope(|scope| {
        let handles: Vec<_> = chunks
            .iter()
            .filter(|chunk| !chunk.is_empty())
            .map(|chunk| {
                let lines: Vec<String> = chunk.iter().map(|&i| numbered[i].clone()).collect();
                let (cancel, report) = (&cancel, &report);
                scope.spawn(move || {
                    let outcome = run_worker(config, &lines, cancel, stop, report);
                    if outcome.is_err() {
                        cancel.store(true, Ordering::Relaxed);
                    }
                    outcome
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| {
                h.join().unwrap_or_else(|_| {
                    Err(EngineError::Io {
                        detail: "엔진 작업 스레드가 죽었다".to_string(),
                    })
                })
            })
            .collect()
    });

    // 멈추라고 했으면 그것이 답이다 — 프로세스가 죽으며 낸 다른 오류나, 마침 다 끝난 결과로 덮지 않는다.
    if stop.is_stopped() {
        return Err(EngineError::Stopped);
    }

    // 먼저 난 진짜 오류를 알린다. "다른 프로세스 때문에 멈췄다"는 그 결과일 뿐이다.
    let mut cancelled = false;
    let mut rows = Vec::new();
    let mut first_error = None;
    for outcome in outcomes {
        match outcome {
            Ok(mut part) => rows.append(&mut part),
            Err(EngineError::Cancelled) => cancelled = true,
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    if let Some(e) = first_error {
        return Err(e);
    }
    if cancelled {
        return Err(EngineError::Cancelled);
    }

    for row in rows {
        if let Some(i) = row_index(&row, total) {
            results[i] = Some(row);
        }
    }
    results
        .into_iter()
        .enumerate()
        .map(|(index, row)| row.ok_or(EngineError::MissingResult { index }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn settings_file_fields_are_optional() {
        assert_eq!(parse_settings("").unwrap(), EngineSettings::default());
        assert_eq!(parse_settings("{}").unwrap(), EngineSettings::default());
        let s = parse_settings(
            "\u{feff}{\"engine_dir\": \"D:\\\\엔진\", \"python\": \"py\", \"concurrency\": 2, \"timeout_seconds\": 30}",
        )
        .unwrap();
        assert_eq!(s.engine_dir.as_deref(), Some("D:\\엔진"));
        assert_eq!(s.python.as_deref(), Some("py"));
        assert_eq!(s.concurrency, Some(2));
        assert_eq!(s.timeout_seconds, Some(30));
    }

    #[test]
    fn settings_file_rejects_unknown_fields_and_broken_json() {
        assert!(parse_settings("{\"engineDir\": \"x\"}").is_err());
        assert!(parse_settings("{").is_err());
        assert!(parse_settings("{\"concurrency\": \"4\"}").is_err());
    }

    #[test]
    fn missing_settings_file_means_defaults() {
        let missing = std::env::temp_dir().join("nikke-companion-없는-설정.json");
        assert_eq!(
            load_settings_file(&missing).unwrap(),
            EngineSettings::default()
        );
    }

    #[test]
    fn finds_the_engine_by_walking_up_from_the_executable() {
        // 개발 실행 파일은 app/src-tauri/target/debug 아래에 있다.
        let exe_dir = repo_root().join("app/src-tauri/target/debug");
        let found = find_engine_dir(&[exe_dir]).expect("저장소 안에서는 엔진을 찾는다");
        assert!(found.join("runner/sim.py").is_file());
        assert!(found.ends_with("vendor/nikke-calc"));
        assert_eq!(find_engine_dir(&[std::env::temp_dir()]), None);
        assert_eq!(find_engine_dir(&[]), None);
    }

    #[test]
    fn config_defaults_to_repo_engine_and_path_python() {
        let c = resolve_config(&EngineSettings::default(), no_env, &[repo_root()]).unwrap();
        assert!(c.engine_dir.ends_with("vendor/nikke-calc"));
        assert_eq!(c.python, "python");
        assert!((1..=MAX_WORKERS).contains(&c.concurrency));
        assert_eq!(c.timeout, DEFAULT_TIMEOUT);
    }

    #[test]
    fn environment_overrides_settings_file_which_overrides_defaults() {
        let engine = repo_root().join("vendor/nikke-calc").display().to_string();
        let settings = EngineSettings {
            engine_dir: Some(engine.clone()),
            python: Some("py-from-file".into()),
            concurrency: Some(99),
            timeout_seconds: Some(5),
        };
        let c = resolve_config(&settings, no_env, &[]).unwrap();
        assert_eq!(c.engine_dir, PathBuf::from(&engine));
        assert_eq!(c.python, "py-from-file");
        assert_eq!(c.concurrency, MAX_WORKERS, "프로세스는 최대 4개");
        assert_eq!(c.timeout, Duration::from_secs(5));

        let env = |name: &str| match name {
            ENV_PYTHON => Some(" py-from-env ".to_string()),
            ENV_ENGINE_DIR => Some("   ".to_string()),
            _ => None,
        };
        let c = resolve_config(&settings, env, &[]).unwrap();
        assert_eq!(c.python, "py-from-env");
        assert_eq!(c.engine_dir, PathBuf::from(&engine), "빈 환경 변수는 없는 것으로 본다");

        let zero = EngineSettings {
            concurrency: Some(0),
            timeout_seconds: Some(0),
            ..settings
        };
        let c = resolve_config(&zero, no_env, &[]).unwrap();
        assert_eq!(c.concurrency, 1);
        assert_eq!(c.timeout, DEFAULT_TIMEOUT);
    }

    #[test]
    fn a_configured_folder_that_is_not_the_engine_is_an_error() {
        let settings = EngineSettings {
            engine_dir: Some(std::env::temp_dir().display().to_string()),
            ..EngineSettings::default()
        };
        assert!(matches!(
            resolve_config(&settings, no_env, &[repo_root()]),
            Err(EngineError::NotAnEngineDir { .. })
        ));
        assert_eq!(
            resolve_config(&EngineSettings::default(), no_env, &[std::env::temp_dir()]),
            Err(EngineError::EngineDirNotFound)
        );
    }

    #[test]
    fn chunks_are_round_robin_and_never_more_than_four() {
        assert_eq!(plan_chunks(0, 4), Vec::<Vec<usize>>::new());
        assert_eq!(plan_chunks(1, 4), vec![vec![0]]);
        assert_eq!(plan_chunks(3, 4), vec![vec![0], vec![1], vec![2]]);
        assert_eq!(
            plan_chunks(6, 4),
            vec![vec![0, 4], vec![1, 5], vec![2], vec![3]]
        );
        assert_eq!(plan_chunks(5, 1), vec![vec![0, 1, 2, 3, 4]]);
        assert_eq!(plan_chunks(5, 0).len(), 1);
        assert_eq!(plan_chunks(100, 64).len(), MAX_WORKERS);
        let mut all: Vec<usize> = plan_chunks(100, 64).into_iter().flatten().collect();
        all.sort_unstable();
        assert_eq!(all, (0..100).collect::<Vec<_>>());
    }

    #[test]
    fn row_index_accepts_only_request_numbers() {
        assert_eq!(row_index(&json!({"id": 2}), 3), Some(2));
        assert_eq!(row_index(&json!({"id": 3}), 3), None);
        assert_eq!(row_index(&json!({"id": -1}), 3), None);
        assert_eq!(row_index(&json!({"id": "2"}), 3), None);
        assert_eq!(row_index(&json!({"line": 1}), 3), None);
    }

    #[test]
    fn empty_batch_does_not_start_the_engine() {
        let config = EngineConfig {
            engine_dir: PathBuf::from("없는-폴더"),
            python: "없는-python".into(),
            concurrency: 4,
            timeout: DEFAULT_TIMEOUT,
        };
        assert_eq!(run_batch(&config, &[], None), Ok(Vec::new()));
        // 객체가 아닌 요청만 있으면 엔진을 띄우지 않고 줄 단위 오류로 돌려준다.
        let rows = run_batch(&config, &[json!("문자열"), Value::Null], None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1]["id"], 1);
        assert_eq!(rows[0]["error"]["type"], "invalid_input");
    }

    #[test]
    fn a_python_that_cannot_start_is_reported() {
        let config = EngineConfig {
            engine_dir: repo_root(),
            python: "nikke-companion-없는-python".into(),
            concurrency: 2,
            timeout: DEFAULT_TIMEOUT,
        };
        let err = run_batch(&config, &[json!({"squad": ["크라운"]}), json!({"squad": ["헬름"]})], None)
            .unwrap_err();
        assert!(matches!(err, EngineError::Spawn { .. }), "{err:?}");
        assert!(err.to_string().contains("엔진을 실행할 수 없다"));
    }

    #[test]
    fn a_stopped_batch_says_so_in_words_the_screen_shows() {
        let message = EngineError::Stopped.to_string();
        assert!(message.starts_with(STOPPED_PREFIX), "{message}");
        assert_eq!(STOPPED_PREFIX, "중단됨");
        // 다른 프로세스의 오류로 멈춘 것과는 다른 말이다.
        assert_ne!(message, EngineError::Cancelled.to_string());
    }

    #[test]
    fn a_batch_stopped_before_it_starts_never_launches_the_engine() {
        // 없는 python이다 — 띄우려 했다면 Spawn 오류가 난다.
        let config = EngineConfig {
            engine_dir: repo_root(),
            python: "nikke-companion-없는-python".into(),
            concurrency: 2,
            timeout: DEFAULT_TIMEOUT,
        };
        let stop = StopSignal::new();
        assert!(!stop.is_stopped());
        stop.stop();
        assert!(stop.is_stopped());
        let err = run_batch_with_stop(
            &config,
            &[json!({"squad": ["크라운"]}), json!({"squad": ["헬름"]})],
            None,
            &stop,
        )
        .unwrap_err();
        assert_eq!(err, EngineError::Stopped);
        // 엔진에 보낼 것이 없는 배치도 멈추라고 했으면 결과를 내지 않는다.
        assert_eq!(
            run_batch_with_stop(&config, &[json!("문자열")], None, &stop),
            Err(EngineError::Stopped)
        );
    }

    #[test]
    fn only_one_batch_holds_the_slot_and_stop_reaches_only_that_batch() {
        let slot = BatchSlot::default();
        assert!(!slot.is_running());
        assert!(!slot.stop(), "도는 배치가 없으면 멈출 것도 없다");

        let first = slot.begin().expect("첫 배치");
        assert!(slot.is_running());
        assert_eq!(slot.begin().unwrap_err(), EngineError::Busy);
        assert!(!first.signal().is_stopped());
        assert!(slot.stop());
        assert!(first.signal().is_stopped());
        assert!(slot.stop(), "두 번 눌러도 된다");
        drop(first);

        // 끝난 뒤에는 자리가 비고, 다음 배치는 앞 배치의 중단을 물려받지 않는다.
        assert!(!slot.is_running());
        assert!(!slot.stop());
        let second = slot.begin().expect("중단 뒤 다시 실행");
        assert!(!second.signal().is_stopped());
    }

    #[test]
    fn at_exit_running_work_is_stopped_and_waited_for() {
        // 도는 일이 없으면 기다리지 않는다.
        let (engine, fetch) = (BatchSlot::default(), BatchSlot::default());
        let started = Instant::now();
        assert!(stop_all_and_wait(&[&engine, &fetch], Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_secs(1));

        // 도는 일이 둘이면 둘 다 멈추라고 하고, 둘 다 자리를 비울 때까지 기다린다.
        thread::scope(|scope| {
            let (engine, fetch) = (&engine, &fetch);
            let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();
            for (slot, slow) in [(engine, 30u64), (fetch, 120u64)] {
                let ready = ready_tx.clone();
                scope.spawn(move || {
                    let ticket = slot.begin().expect("자리");
                    ready.send(()).expect("준비 알림");
                    // 멈추라고 할 때까지 돈다(엔진 배치가 신호를 보는 것과 같다). 멈춘 뒤 정리에 시간이 조금 든다.
                    while !ticket.signal().is_stopped() {
                        thread::sleep(Duration::from_millis(5));
                    }
                    thread::sleep(Duration::from_millis(slow));
                });
            }
            ready_rx.recv().expect("첫 일");
            ready_rx.recv().expect("둘째 일");
            assert!(engine.is_running() && fetch.is_running());
            assert!(stop_all_and_wait(&[engine, fetch], Duration::from_secs(5)));
            assert!(!engine.is_running() && !fetch.is_running(), "자리가 비기 전에 돌아왔다");
        });

        // 시간 안에 끝나지 않으면 false로 돌아온다(앱은 그대로 끝난다) — 멈추라는 신호는 가 있다.
        let stuck = BatchSlot::default();
        let ticket = stuck.begin().expect("자리");
        let started = Instant::now();
        assert!(!stop_all_and_wait(&[&stuck], Duration::from_millis(80)));
        assert!(started.elapsed() >= Duration::from_millis(80));
        assert!(ticket.signal().is_stopped());
        assert!(EXIT_GRACE >= Duration::from_secs(1) && EXIT_GRACE <= Duration::from_secs(5));
    }

    #[test]
    fn catalog_of_a_folder_without_data_is_an_error() {
        assert!(matches!(
            catalog(&std::env::temp_dir().join("nikke-companion-없는-엔진")),
            Err(EngineError::DataUnreadable { .. })
        ));
    }

    #[test]
    fn cube_catalog_keeps_table_order_and_marks_unsupported_cubes() {
        // 지어낸 큐브 표(엔진의 cube.json과 같은 모양): 주석 키·공통 효과는 큐브가 아니다.
        let table = json!({
            "_comment": "주석",
            "_stats": { "1": { "atk": 1 } },
            "공통": { "stat": "element_bonus", "스킬명": "공통 효과", "template": "공통 {0}%", "values": { "5": 1.0 } },
            "가 큐브": { "stat": "a", "스킬명": "가 효과", "template": "가 {0}% ▲", "values": { "1": 1.0, "2": 2.0, "3": 3.0 } },
            "나 큐브": { "stat": "b", "스킬명": "나 효과", "template": "나 {0}% ▲", "values": { "1": 1.0 }, "unsupported": true },
            "다 큐브": { "stat": "c", "values": {}, "unsupported": false },
            "이상한 줄": "객체가 아니다"
        });
        let cubes = cube_catalog(&table);
        assert_eq!(
            cubes,
            vec![
                json!({ "name": "가 큐브", "skill": "가 효과", "effect": "가 {0}% ▲", "max_level": 3, "supported": true }),
                json!({ "name": "나 큐브", "skill": "나 효과", "effect": "나 {0}% ▲", "max_level": 1, "supported": false }),
                json!({ "name": "다 큐브", "skill": null, "effect": null, "max_level": 0, "supported": true }),
            ]
        );
        assert!(cube_catalog(&json!(["객체가 아니다"])).is_empty());
    }

    #[test]
    fn version_of_a_non_repository_has_no_commit() {
        let v = version(&std::env::temp_dir().join("nikke-companion-없는-엔진"));
        assert_eq!(v["repo"], ENGINE_REPO);
        assert!(v["commit"].is_null());
        // 커밋을 모르면 깨끗한지도 모른다 — false(깨끗함)로 지어내지 않는다(캐시가 이 값을 믿는다).
        assert!(v.as_object().expect("객체").contains_key("dirty"));
        assert!(v["dirty"].is_null());
    }

    #[test]
    fn every_error_message_is_korean() {
        let all = [
            EngineError::SettingsUnreadable { path: "s.json".into(), detail: "os error 5".into() },
            EngineError::SettingsInvalid { path: "s.json".into(), detail: "unknown field".into() },
            EngineError::EngineDirNotFound,
            EngineError::NotAnEngineDir { path: "D:\\x".into() },
            EngineError::DataUnreadable { path: "p.json".into(), detail: "os error 2".into() },
            EngineError::DataInvalid { path: "p.json".into(), detail: "EOF".into() },
            EngineError::Spawn { python: "python".into(), detail: "not found".into() },
            EngineError::Timeout { seconds: 600 },
            EngineError::Io { detail: "broken pipe".into() },
            EngineError::BadOutput { line: "Traceback".into() },
            EngineError::Exit { code: "2".into(), detail: "usage".into() },
            EngineError::MissingResult { index: 3 },
            EngineError::Cancelled,
            EngineError::Stopped,
            EngineError::Busy,
        ];
        for e in all {
            assert!(has_korean(&e.to_string()), "{e:?}");
        }
    }
}
