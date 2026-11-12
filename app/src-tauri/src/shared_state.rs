//! 두 창(데스크톱 앱 창·오버레이 창)이 함께 보는 것 — 디스크의 계정 폴더에 둔다.
//!
//! - **기본 계정**: 계산에 쓸 계정의 이름 하나. 화면은 파일 경로를 넘기지 않고 이름만 넘긴다 — 이름은 경로가 아니라
//!   열쇠다(`account_sync::validate_name`을 통과한 이름의 `<계정 폴더>/<이름>.json`만 읽는다).
//! - **오버레이를 언제 띄우는가**: 앱과 함께 / 게임을 찾았을 때 / 띄우지 않음.
//! - **마지막 요격전 추천 결과**: 앱 창이 계산을 끝내면 여기에 쓰고, 오버레이 창이 읽는다. 앱을 다시 켜도 남아 있다.
//!
//! 파일은 둘이다(계정 폴더는 gitignore — 개인 계정 데이터가 저장소에 올라가지 않는다):
//! `.companion-state.json`(기본 계정·오버레이 설정)과 `.last-intercept.json`(마지막 요격전 결과). 이름에 점이 있어
//! 계정 이름(점을 받지 않는다)과 겹치지 않는다.
//!
//! 형식 검사에 실패한 결과(다른 종류·다른 판)는 쓰지 않고 한국어로 알린다 — 앞서 저장한 것은 그대로다.
//! 이 모듈은 창·이벤트를 모른다(파일만 다룬다). 네트워크를 쓰지 않는다.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};

use crate::account_sync::validate_name;
use crate::capture::Stamp;

/// 기본 계정·오버레이 설정을 두는 파일(계정 폴더 안).
pub const STATE_FILE: &str = ".companion-state.json";
/// 마지막 요격전 추천 결과를 두는 파일(계정 폴더 안).
pub const INTERCEPT_FILE: &str = ".last-intercept.json";
/// 상태 파일의 판.
pub const STATE_SCHEMA_VERSION: u64 = 1;
/// 상태 파일의 종류.
pub const STATE_KIND: &str = "companion_state";
/// 이 앱이 읽는 요격전 추천 결과의 종류와 판(`src/core/intercept.mjs`의 INTERCEPT_REPORT_SCHEMA_VERSION과 같아야 한다).
pub const INTERCEPT_KIND: &str = "intercept_report";
pub const INTERCEPT_SCHEMA_VERSION: u64 = 1;
/// 실수로 큰 파일을 통째로 읽지 않는다.
pub const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// 오버레이 창을 언제 띄우는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayLaunch {
    /// 앱을 켜면 함께 띄운다(기본).
    #[default]
    WithApp,
    /// 게임 창을 찾았을 때 띄운다.
    WithGame,
    /// 스스로 띄우지 않는다(설정의 단추나 단축키로 띄운다).
    Manual,
}

impl OverlayLaunch {
    pub const fn key(self) -> &'static str {
        match self {
            Self::WithApp => "with_app",
            Self::WithGame => "with_game",
            Self::Manual => "manual",
        }
    }

    /// 화면·파일의 낱말을 읽는다. 모르는 낱말이면 `None`.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "with_app" => Some(Self::WithApp),
            "with_game" => Some(Self::WithGame),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }

    /// 앱이 켜질 때 오버레이를 곧바로 보이는가.
    pub const fn shows_at_start(self) -> bool {
        matches!(self, Self::WithApp)
    }

    /// 게임 창의 상태가 바뀌었을 때 오버레이를 보여야 하는가: 「게임을 찾았을 때」로 정해 두었고, 방금 게임 창을 찾았고
    /// (앞에서는 없었다), 오버레이가 숨겨져 있을 때만. 게임이 떠 있는 동안 사용자가 숨긴 오버레이를 다시 띄우지 않는다.
    pub const fn reveals_on_game(self, was_found: bool, now_found: bool, overlay_visible: bool) -> bool {
        matches!(self, Self::WithGame) && !was_found && now_found && !overlay_visible
    }
}

/// 한국어 문장으로 화면에 보이는 실패.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SharedError {
    /// 이름이 계정 이름으로 쓸 수 없는 글자다.
    NameInvalid { reason: String },
    /// 그 이름의 계정이 없다.
    AccountMissing { name: String },
    /// 기본 계정이 정해지지 않았고 고를 계정도 없다.
    NoAccount,
    Unreadable { what: &'static str, detail: String },
    TooLarge { what: &'static str },
    NotJson { what: &'static str },
    /// 요격전 추천 결과가 아니다(다른 종류).
    WrongKind { found: String },
    /// 판이 다르다.
    WrongVersion { found: String },
    /// 있어야 할 칸이 없다.
    MissingField { field: &'static str },
    Write { what: &'static str, detail: String },
    UnknownLaunch { found: String },
    /// 요격전 계획(기록·즐겨찾기) 문서의 모양이 다르다.
    PlanInvalid { reason: String },
}

impl fmt::Display for SharedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NameInvalid { reason } => write!(f, "계정 이름을 쓸 수 없다: {reason}"),
            Self::AccountMissing { name } => write!(
                f,
                "'{name}' 계정을 찾을 수 없다. 설정의 계정 연결에서 계정을 새로 받아라"
            ),
            Self::NoAccount => write!(f, "연결된 계정이 없다. 설정의 계정 연결에서 계정을 받아라"),
            Self::Unreadable { what, detail } => write!(f, "{what}을(를) 읽지 못했다 ({detail})"),
            Self::TooLarge { what } => write!(f, "{what}이(가) 너무 커서 읽지 않았다"),
            Self::NotJson { what } => write!(f, "{what}의 내용을 읽을 수 없다(형식이 깨졌다)"),
            Self::WrongKind { found } => write!(
                f,
                "요격전 추천 결과가 아니다(종류: {found}). 앞서 저장한 결과는 그대로 둔다"
            ),
            Self::WrongVersion { found } => write!(
                f,
                "요격전 추천 결과의 판이 다르다(받은 것 {found}, 이 앱이 읽는 판 {INTERCEPT_SCHEMA_VERSION}). 앞서 저장한 결과는 그대로 둔다"
            ),
            Self::MissingField { field } => write!(
                f,
                "요격전 추천 결과가 아니다({field} 칸이 없거나 모양이 다르다). 앞서 저장한 결과는 그대로 둔다"
            ),
            Self::Write { what, detail } => write!(f, "{what}을(를) 저장하지 못했다 ({detail})"),
            Self::UnknownLaunch { found } => write!(f, "모르는 오버레이 설정이다: {found}"),
            Self::PlanInvalid { reason } => write!(
                f,
                "요격전 기록이 아니다({reason}). 앞서 저장한 기록은 그대로 둔다"
            ),
        }
    }
}

impl std::error::Error for SharedError {}

/// 계정 폴더의 계정 하나(이름과 마지막으로 쓴 시각). 내용은 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountEntry {
    pub name: String,
    /// 계정을 마지막으로 저장한 시각(ISO, UTC). 알 수 없으면 `None`.
    pub modified_at: Option<String>,
}

/// 화면에 넘기는 공유 상태. 프런트의 `SharedSnapshot`(src/types.ts)과 같아야 한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SharedSnapshot {
    /// 지금 계산에 쓰는 계정의 이름. 계정이 하나도 없으면 `None`.
    pub default_account: Option<String>,
    /// 사용자가 고른 것인가(아니면 계정이 하나뿐이라 그것을 쓰는 것이다).
    pub remembered: bool,
    /// 계정 폴더의 계정들(이름순).
    pub accounts: Vec<AccountEntry>,
    /// 오버레이를 언제 띄우는가(`with_app`·`with_game`·`manual`).
    pub overlay_launch: OverlayLaunch,
    /// 마지막 요격전 결과를 저장한 시각(ISO, UTC). 없으면 `None`.
    pub intercept_saved_at: Option<String>,
    /// 읽다가 만난 문제(한국어 문장). 비어 있으면 문제없다.
    pub problems: Vec<String>,
}

/// 상태 파일의 내용.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StoredState {
    pub default_account: Option<String>,
    pub overlay_launch: OverlayLaunch,
}

fn iso(time: SystemTime) -> Option<String> {
    let ms = time.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(Stamp::from_unix_millis(u64::try_from(ms).ok()?).iso_utc())
}

fn modified_at(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok().filter(fs::Metadata::is_file)?;
    iso(meta.modified().ok()?)
}

fn account_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.json"))
}

fn checked_name(name: &str) -> Result<String, SharedError> {
    validate_name(name).map_err(|e| SharedError::NameInvalid {
        reason: e.to_string(),
    })
}

/// 크기 한도 안의 JSON 파일을 읽는다. (오버레이 위젯의 설정 파일도 이 길로 읽는다 — `overlay_store`.)
pub(crate) fn read_json(path: &Path, what: &'static str) -> Result<Value, SharedError> {
    let meta = fs::metadata(path).map_err(|e| SharedError::Unreadable {
        what,
        detail: e.to_string(),
    })?;
    if meta.len() > MAX_BYTES {
        return Err(SharedError::TooLarge { what });
    }
    let text = fs::read_to_string(path).map_err(|e| SharedError::Unreadable {
        what,
        detail: e.to_string(),
    })?;
    serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text))
        .map_err(|_| SharedError::NotJson { what })
}

/// 임시 파일에 다 쓴 뒤 이름을 바꾼다 — 쓰다가 죽어도 앞의 내용이 반쪽이 되지 않는다.
pub(crate) fn write_json(dir: &Path, file: &str, value: &Value, what: &'static str) -> Result<(), SharedError> {
    let io = |e: std::io::Error| SharedError::Write {
        what,
        detail: e.to_string(),
    };
    let text = serde_json::to_string(value).map_err(|e| SharedError::Write {
        what,
        detail: e.to_string(),
    })?;
    fs::create_dir_all(dir).map_err(io)?;
    let path = dir.join(file);
    let temp = dir.join(format!("{file}.tmp"));
    fs::write(&temp, format!("{text}\n")).map_err(io)?;
    if let Err(e) = fs::rename(&temp, &path) {
        let _ = fs::remove_file(&temp);
        return Err(io(e));
    }
    Ok(())
}

/// 계정 폴더의 계정들(이름순). 계정 이름으로 쓸 수 있는 이름의 `.json` 파일만 센다 — 사본(`.bak`)·결과 파일·이 모듈의
/// 파일은 이름에 점이 있어 빠진다. 폴더가 없으면 빈 목록이다. 내용은 읽지 않는다.
pub fn list_accounts(dir: &Path) -> Vec<AccountEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<AccountEntry> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let stem = path.file_stem()?.to_str()?;
            let name = validate_name(stem).ok().filter(|n| n == stem)?;
            Some(AccountEntry {
                modified_at: modified_at(&path),
                name,
            })
        })
        .collect();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// 상태 파일을 읽는다. 없으면 기본값이다. 깨졌으면 기본값과 그 사실을 알리는 문장을 돌려준다(앱은 계속 쓴다).
pub fn read_state(dir: &Path) -> (StoredState, Option<String>) {
    let path = dir.join(STATE_FILE);
    if !path.is_file() {
        return (StoredState::default(), None);
    }
    let doc = match read_json(&path, "앱 설정") {
        Ok(doc) => doc,
        Err(e) => return (StoredState::default(), Some(format!("{e} — 기본값으로 쓴다"))),
    };
    if doc.get("kind").and_then(Value::as_str) != Some(STATE_KIND)
        || doc.get("schema_version").and_then(Value::as_u64) != Some(STATE_SCHEMA_VERSION)
    {
        return (
            StoredState::default(),
            Some("앱 설정의 종류나 판이 달라 읽지 않았다 — 기본값으로 쓴다".to_string()),
        );
    }
    let default_account = doc
        .get("default_account")
        .and_then(Value::as_str)
        .and_then(|name| validate_name(name).ok());
    let overlay_launch = doc
        .get("overlay_launch")
        .and_then(Value::as_str)
        .and_then(OverlayLaunch::parse)
        .unwrap_or_default();
    (
        StoredState {
            default_account,
            overlay_launch,
        },
        None,
    )
}

/// 상태 파일을 쓴다.
pub fn write_state(dir: &Path, state: &StoredState) -> Result<(), SharedError> {
    let doc = json!({
        "schema_version": STATE_SCHEMA_VERSION,
        "kind": STATE_KIND,
        "default_account": state.default_account,
        "overlay_launch": state.overlay_launch.key(),
    });
    write_json(dir, STATE_FILE, &doc, "앱 설정")
}

/// 지금 쓸 계정을 고른다: 사용자가 고른 계정이 아직 있으면 그것, 아니면 계정이 하나뿐일 때 그것.
/// 둘 이상인데 고른 것이 없으면 `None` — 어느 것을 쓸지 추측하지 않는다(화면이 고르라고 알린다).
pub fn effective_account(remembered: Option<&str>, accounts: &[AccountEntry]) -> (Option<String>, bool) {
    if let Some(name) = remembered {
        if accounts.iter().any(|a| a.name == name) {
            return (Some(name.to_string()), true);
        }
    }
    match accounts {
        [only] => (Some(only.name.clone()), false),
        _ => (None, false),
    }
}

/// 공유 상태 한 벌.
pub fn snapshot(dir: &Path) -> SharedSnapshot {
    let accounts = list_accounts(dir);
    let (state, problem) = read_state(dir);
    let (default_account, remembered) = effective_account(state.default_account.as_deref(), &accounts);
    SharedSnapshot {
        default_account,
        remembered,
        accounts,
        overlay_launch: state.overlay_launch,
        intercept_saved_at: modified_at(&dir.join(INTERCEPT_FILE)),
        problems: problem.into_iter().collect(),
    }
}

/// 기본 계정을 정한다. 그 이름의 계정이 있어야 한다.
pub fn set_default_account(dir: &Path, name: &str) -> Result<SharedSnapshot, SharedError> {
    let name = checked_name(name)?;
    if !account_path(dir, &name).is_file() {
        return Err(SharedError::AccountMissing { name });
    }
    let (mut state, _) = read_state(dir);
    state.default_account = Some(name);
    write_state(dir, &state)?;
    Ok(snapshot(dir))
}

/// 오버레이를 언제 띄울지 정한다.
pub fn set_overlay_launch(dir: &Path, mode: &str) -> Result<SharedSnapshot, SharedError> {
    let launch = OverlayLaunch::parse(mode).ok_or_else(|| SharedError::UnknownLaunch {
        found: mode.chars().take(40).collect(),
    })?;
    let (mut state, _) = read_state(dir);
    state.overlay_launch = launch;
    write_state(dir, &state)?;
    Ok(snapshot(dir))
}

/// 계정 하나를 읽는다: `{name, modified_at, account}`. 이름을 주지 않으면 지금 쓰는 계정이다.
/// 형식 확인은 계산 코드(`src/core/account.mjs`)가 한다 — 여기서는 객체인지만 본다.
pub fn read_account(dir: &Path, name: Option<&str>) -> Result<Value, SharedError> {
    let name = match name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => checked_name(name)?,
        None => snapshot(dir).default_account.ok_or(SharedError::NoAccount)?,
    };
    let path = account_path(dir, &name);
    if !path.is_file() {
        return Err(SharedError::AccountMissing { name });
    }
    let account = read_json(&path, "계정")?;
    if !account.is_object() {
        return Err(SharedError::NotJson { what: "계정" });
    }
    Ok(json!({ "name": name, "modified_at": modified_at(&path), "account": account }))
}

/// 요격전 추천 결과의 모양을 확인한다(종류·판·화면이 그릴 때 기대하는 칸). 수치는 보지 않는다.
pub fn check_intercept(doc: &Value) -> Result<(), SharedError> {
    let Some(obj) = doc.as_object() else {
        return Err(SharedError::WrongKind {
            found: "객체가 아님".to_string(),
        });
    };
    match obj.get("kind") {
        Some(Value::String(kind)) if kind == INTERCEPT_KIND => {}
        Some(Value::String(kind)) => {
            return Err(SharedError::WrongKind {
                found: kind.chars().take(40).collect(),
            })
        }
        _ => {
            return Err(SharedError::WrongKind {
                found: "없음".to_string(),
            })
        }
    }
    match obj.get("schema_version") {
        Some(v) if v.as_u64() == Some(INTERCEPT_SCHEMA_VERSION) => {}
        Some(v) => {
            return Err(SharedError::WrongVersion {
                found: v.to_string().chars().take(40).collect(),
            })
        }
        None => {
            return Err(SharedError::WrongVersion {
                found: "없음".to_string(),
            })
        }
    }
    for field in ["account", "bundle"] {
        if !obj.get(field).is_some_and(Value::is_object) {
            return Err(SharedError::MissingField { field });
        }
    }
    for field in ["bosses", "caveats"] {
        if !obj.get(field).is_some_and(Value::is_array) {
            return Err(SharedError::MissingField { field });
        }
    }
    Ok(())
}

/// 요격전 추천 결과를 저장한다. 모양이 맞지 않으면 쓰지 않는다 — 앞서 저장한 것이 그대로 남는다.
pub fn save_intercept(dir: &Path, report: &Value) -> Result<SharedSnapshot, SharedError> {
    check_intercept(report)?;
    write_json(dir, INTERCEPT_FILE, report, "요격전 추천 결과")?;
    Ok(snapshot(dir))
}

/// 저장해 둔 요격전 추천 결과. 없으면 `None`. 읽을 수 없는 것(깨졌다·다른 종류·다른 판)은 한국어로 알린다
/// (파일은 건드리지 않는다 — 다음 계산이 새로 쓴다).
pub fn load_intercept(dir: &Path) -> Result<Option<Value>, SharedError> {
    let path = dir.join(INTERCEPT_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let doc = read_json(&path, "요격전 추천 결과")?;
    check_intercept(&doc)?;
    Ok(Some(doc))
}

// ── 요격전 계획(P-029): 계정마다 손으로 적은 요격전 기록과 즐겨찾기 ─────────────────────────────

/// 요격전 계획 문서의 종류와 판(`src/core/plan.mjs`의 PLAN_KIND·PLAN_SCHEMA_VERSION과 같아야 한다).
pub const PLAN_KIND: &str = "intercept_plan";
pub const PLAN_SCHEMA_VERSION: u64 = 1;
/// 계획 파일 이름의 꼬리: `<계정 이름>.plan.json`. 이름에 점이 더 있어 계정 목록에 들지 않는다.
pub const PLAN_SUFFIX: &str = ".plan.json";
/// 받아 주는 기록·즐겨찾기의 수(화면의 계산 코드는 기록을 500건까지만 남긴다 — 그보다 넉넉히).
pub const PLAN_MAX_ITEMS: usize = 2000;

fn plan_file(name: &str) -> String {
    format!("{name}{PLAN_SUFFIX}")
}

/// 이름을 주지 않으면 지금 쓰는 계정이다. 그 계정이 계정 폴더에 있어야 한다(없는 계정의 기록을 만들지 않는다).
fn plan_account(dir: &Path, name: Option<&str>) -> Result<String, SharedError> {
    let name = match name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => checked_name(name)?,
        None => snapshot(dir).default_account.ok_or(SharedError::NoAccount)?,
    };
    // 계정 파일을 읽지는 않는다 — 계정 목록에 그 이름이 있는지만 본다.
    if !list_accounts(dir).iter().any(|a| a.name == name) {
        return Err(SharedError::AccountMissing { name });
    }
    Ok(name)
}

/// 요격전 계획 문서의 모양을 확인한다(종류·판·목록 둘). 기록 하나하나의 값은 화면의 계산 코드(`src/core/plan.mjs`)가 본다.
pub fn check_plan(doc: &Value) -> Result<(), SharedError> {
    let wrong = |reason: &str| SharedError::PlanInvalid {
        reason: reason.to_string(),
    };
    let obj = doc.as_object().ok_or_else(|| wrong("객체가 아니다"))?;
    if obj.get("kind").and_then(Value::as_str) != Some(PLAN_KIND) {
        return Err(wrong("종류가 다르다"));
    }
    if obj.get("schema_version").and_then(Value::as_u64) != Some(PLAN_SCHEMA_VERSION) {
        return Err(wrong("판이 다르다"));
    }
    for field in ["favorites", "records"] {
        match obj.get(field).and_then(Value::as_array) {
            Some(list) if list.len() <= PLAN_MAX_ITEMS => {}
            Some(_) => return Err(wrong("항목이 너무 많다")),
            None => return Err(wrong("목록 칸이 없다")),
        }
    }
    Ok(())
}

/// 그 계정의 요격전 계획(기록·즐겨찾기). 아직 없으면 `None`. 읽을 수 없으면 한국어로 알린다(파일은 건드리지 않는다).
pub fn load_plan(dir: &Path, name: Option<&str>) -> Result<Option<Value>, SharedError> {
    let name = plan_account(dir, name)?;
    let path = dir.join(plan_file(&name));
    if !path.is_file() {
        return Ok(None);
    }
    let doc = read_json(&path, "요격전 기록")?;
    check_plan(&doc)?;
    Ok(Some(doc))
}

/// 그 계정의 요격전 계획을 저장한다. 모양이 맞지 않으면 쓰지 않는다 — 앞서 저장한 것이 그대로 남는다.
pub fn save_plan(dir: &Path, name: Option<&str>, plan: &Value) -> Result<(), SharedError> {
    check_plan(plan)?;
    let name = plan_account(dir, name)?;
    write_json(dir, &plan_file(&name), plan, "요격전 기록")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 테스트마다 다른 임시 계정 폴더. 끝나면 지운다. 실제 계정 폴더는 쓰지 않는다.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "nikke-companion-shared-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("임시 폴더");
            Self(dir)
        }

        fn account(&self, name: &str) {
            let doc = json!({ "schema_version": 1, "is_test_data": true, "name": name, "nikkes": {} });
            fs::write(self.0.join(format!("{name}.json")), doc.to_string()).expect("계정 쓰기");
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn report(marker: &str) -> Value {
        json!({
            "schema_version": 1,
            "kind": "intercept_report",
            "account": { "name": marker, "is_test_data": true },
            "bundle": { "name": "검증용", "is_test_data": true },
            "bosses": [],
            "caveats": [],
        })
    }

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    #[test]
    fn an_empty_or_missing_folder_has_no_account_and_default_settings() {
        let dir = TempDir::new();
        let snap = snapshot(&dir.0);
        assert_eq!(snap.default_account, None);
        assert!(snap.accounts.is_empty());
        assert_eq!(snap.overlay_launch, OverlayLaunch::WithApp);
        assert_eq!(snap.intercept_saved_at, None);
        assert!(snap.problems.is_empty());
        let missing = snapshot(&dir.0.join("없는 폴더"));
        assert_eq!(missing.default_account, None);
    }

    #[test]
    fn only_real_account_files_are_listed() {
        let dir = TempDir::new();
        dir.account("me");
        dir.account("부계정");
        fs::write(dir.0.join("me.json.bak"), "{}").unwrap();
        fs::write(dir.0.join("me.intercept.json"), "{}").unwrap();
        fs::write(dir.0.join("notes.txt"), "x").unwrap();
        save_intercept(&dir.0, &report("me")).unwrap();
        write_state(&dir.0, &StoredState::default()).unwrap();
        let names: Vec<String> = list_accounts(&dir.0).into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["me", "부계정"]);
    }

    #[test]
    fn a_single_account_is_used_without_asking_but_two_need_a_choice() {
        let dir = TempDir::new();
        dir.account("me");
        let one = snapshot(&dir.0);
        assert_eq!(one.default_account.as_deref(), Some("me"));
        assert!(!one.remembered);

        dir.account("sub");
        assert_eq!(snapshot(&dir.0).default_account, None);

        let chosen = set_default_account(&dir.0, "sub").unwrap();
        assert_eq!(chosen.default_account.as_deref(), Some("sub"));
        assert!(chosen.remembered);
        // 다시 읽어도 그대로다(디스크에 있다).
        assert_eq!(snapshot(&dir.0).default_account.as_deref(), Some("sub"));
    }

    #[test]
    fn a_remembered_account_that_no_longer_exists_is_not_used() {
        let dir = TempDir::new();
        dir.account("me");
        dir.account("sub");
        set_default_account(&dir.0, "sub").unwrap();
        fs::remove_file(dir.0.join("sub.json")).unwrap();
        let snap = snapshot(&dir.0);
        assert_eq!(snap.default_account.as_deref(), Some("me"));
        assert!(!snap.remembered);
    }

    #[test]
    fn names_are_keys_not_paths() {
        let dir = TempDir::new();
        dir.account("me");
        for bad in ["../me", "..\\me", "me.json", "C:\\x", "a/b", ""] {
            assert!(set_default_account(&dir.0, bad).is_err(), "{bad}");
        }
        for bad in ["../me", "..\\me", "me.json", "C:\\x", "a/b"] {
            let err = read_account(&dir.0, Some(bad)).unwrap_err();
            assert!(matches!(err, SharedError::NameInvalid { .. }), "{bad}: {err:?}");
            assert!(has_korean(&err.to_string()));
        }
        let missing = set_default_account(&dir.0, "nobody").unwrap_err();
        assert_eq!(missing, SharedError::AccountMissing { name: "nobody".into() });
    }

    #[test]
    fn reads_the_default_account_or_a_named_one() {
        let dir = TempDir::new();
        assert_eq!(read_account(&dir.0, None).unwrap_err(), SharedError::NoAccount);
        dir.account("me");
        let read = read_account(&dir.0, None).unwrap();
        assert_eq!(read["name"], "me");
        assert_eq!(read["account"]["name"], "me");
        assert!(read["modified_at"].is_string());
        dir.account("sub");
        assert_eq!(read_account(&dir.0, Some(" sub ")).unwrap()["name"], "sub");
        // 빈 이름은 「지금 쓰는 계정」이다 — 둘인데 고르지 않았으면 없다고 알린다.
        assert_eq!(read_account(&dir.0, Some("  ")).unwrap_err(), SharedError::NoAccount);
    }

    #[test]
    fn a_broken_account_is_reported_in_korean() {
        let dir = TempDir::new();
        fs::write(dir.0.join("me.json"), "{ 깨진").unwrap();
        let err = read_account(&dir.0, Some("me")).unwrap_err();
        assert_eq!(err, SharedError::NotJson { what: "계정" });
        assert!(has_korean(&err.to_string()));
        fs::write(dir.0.join("me.json"), "[1,2]").unwrap();
        assert_eq!(read_account(&dir.0, Some("me")).unwrap_err(), SharedError::NotJson { what: "계정" });
    }

    #[test]
    fn the_last_intercept_result_survives_a_restart() {
        let dir = TempDir::new();
        assert_eq!(load_intercept(&dir.0).unwrap(), None);
        let saved = save_intercept(&dir.0, &report("첫째")).unwrap();
        assert!(saved.intercept_saved_at.is_some());
        // 「다시 켠」 쪽은 디스크에서 읽는다.
        assert_eq!(load_intercept(&dir.0).unwrap(), Some(report("첫째")));
        save_intercept(&dir.0, &report("둘째")).unwrap();
        assert_eq!(load_intercept(&dir.0).unwrap().unwrap()["account"]["name"], "둘째");
        assert!(!dir.0.join(format!("{INTERCEPT_FILE}.tmp")).exists());
    }

    #[test]
    fn a_result_of_another_kind_or_version_is_refused_and_the_previous_one_stays() {
        let dir = TempDir::new();
        save_intercept(&dir.0, &report("앞의 것")).unwrap();

        let mut growth = report("x");
        growth["kind"] = json!("growth");
        let mut newer = report("x");
        newer["schema_version"] = json!(2);
        let mut no_kind = report("x");
        no_kind.as_object_mut().unwrap().remove("kind");
        let mut no_bosses = report("x");
        no_bosses.as_object_mut().unwrap().remove("bosses");

        let cases = [
            (growth, SharedError::WrongKind { found: "growth".into() }),
            (newer, SharedError::WrongVersion { found: "2".into() }),
            (no_kind, SharedError::WrongKind { found: "없음".into() }),
            (no_bosses, SharedError::MissingField { field: "bosses" }),
            (json!([1]), SharedError::WrongKind { found: "객체가 아님".into() }),
        ];
        for (doc, expected) in cases {
            let err = save_intercept(&dir.0, &doc).unwrap_err();
            assert_eq!(err, expected);
            assert!(has_korean(&err.to_string()));
            assert!(err.to_string().contains("그대로 둔다"));
            // 앞서 저장한 것은 그대로다.
            assert_eq!(load_intercept(&dir.0).unwrap().unwrap()["account"]["name"], "앞의 것");
        }
    }

    #[test]
    fn a_stored_result_this_version_cannot_read_is_reported_not_shown() {
        let dir = TempDir::new();
        let mut newer = report("x");
        newer["schema_version"] = json!(3);
        fs::write(dir.0.join(INTERCEPT_FILE), newer.to_string()).unwrap();
        let err = load_intercept(&dir.0).unwrap_err();
        assert_eq!(err, SharedError::WrongVersion { found: "3".into() });
        fs::write(dir.0.join(INTERCEPT_FILE), "{ 깨진").unwrap();
        let err = load_intercept(&dir.0).unwrap_err();
        assert!(has_korean(&err.to_string()));
        // 파일은 지우지 않는다.
        assert!(dir.0.join(INTERCEPT_FILE).is_file());
    }

    #[test]
    fn overlay_launch_is_remembered_and_unknown_words_are_refused() {
        let dir = TempDir::new();
        dir.account("me");
        set_default_account(&dir.0, "me").unwrap();
        let snap = set_overlay_launch(&dir.0, "with_game").unwrap();
        assert_eq!(snap.overlay_launch, OverlayLaunch::WithGame);
        // 다른 설정(기본 계정)은 그대로다.
        assert_eq!(snap.default_account.as_deref(), Some("me"));
        assert!(snap.remembered);
        assert_eq!(read_state(&dir.0).0.overlay_launch, OverlayLaunch::WithGame);
        let err = set_overlay_launch(&dir.0, "always").unwrap_err();
        assert!(has_korean(&err.to_string()));
        assert_eq!(read_state(&dir.0).0.overlay_launch, OverlayLaunch::WithGame);
        for mode in [OverlayLaunch::WithApp, OverlayLaunch::WithGame, OverlayLaunch::Manual] {
            assert_eq!(OverlayLaunch::parse(mode.key()), Some(mode));
        }
    }

    #[test]
    fn a_broken_settings_file_falls_back_to_defaults_and_says_so() {
        let dir = TempDir::new();
        dir.account("me");
        fs::write(dir.0.join(STATE_FILE), "{ 깨진").unwrap();
        let snap = snapshot(&dir.0);
        assert_eq!(snap.overlay_launch, OverlayLaunch::WithApp);
        assert_eq!(snap.default_account.as_deref(), Some("me"));
        assert_eq!(snap.problems.len(), 1);
        assert!(has_korean(&snap.problems[0]));
        fs::write(dir.0.join(STATE_FILE), r#"{"schema_version":9,"kind":"companion_state"}"#).unwrap();
        assert_eq!(snapshot(&dir.0).problems.len(), 1);
    }

    #[test]
    fn the_overlay_shows_at_start_or_when_the_game_appears() {
        assert!(OverlayLaunch::WithApp.shows_at_start());
        assert!(!OverlayLaunch::WithGame.shows_at_start());
        assert!(!OverlayLaunch::Manual.shows_at_start());

        let game = OverlayLaunch::WithGame;
        // 방금 게임 창을 찾았고 오버레이가 숨겨져 있을 때만.
        assert!(game.reveals_on_game(false, true, false));
        assert!(!game.reveals_on_game(true, true, false), "게임이 떠 있는 동안 숨긴 것을 다시 띄우지 않는다");
        assert!(!game.reveals_on_game(false, true, true));
        assert!(!game.reveals_on_game(false, false, false));
        assert!(!game.reveals_on_game(true, false, false));
        for other in [OverlayLaunch::WithApp, OverlayLaunch::Manual] {
            assert!(!other.reveals_on_game(false, true, false));
        }
    }

    fn plan(marker: &str) -> Value {
        json!({
            "schema_version": 1,
            "kind": "intercept_plan",
            "favorites": [marker],
            "records": [{ "id": "r1", "boss_id": "kraken", "damage": 1000, "mode": "mock", "date": "2026-11-12" }],
        })
    }

    #[test]
    fn the_plan_is_kept_per_account_and_survives_a_restart() {
        let dir = TempDir::new();
        // 계정이 없으면 기록도 없다(없는 계정의 기록을 만들지 않는다).
        assert_eq!(load_plan(&dir.0, None).unwrap_err(), SharedError::NoAccount);
        assert_eq!(save_plan(&dir.0, None, &plan("x")).unwrap_err(), SharedError::NoAccount);
        dir.account("me");
        assert_eq!(load_plan(&dir.0, None).unwrap(), None);
        save_plan(&dir.0, None, &plan("크라운")).unwrap();
        assert_eq!(load_plan(&dir.0, None).unwrap(), Some(plan("크라운")));
        assert!(dir.0.join("me.plan.json").is_file());
        assert!(!dir.0.join("me.plan.json.tmp").exists());

        // 계정마다 따로다. 기록 파일은 계정 목록에 들지 않는다.
        dir.account("sub");
        save_plan(&dir.0, Some("sub"), &plan("헬름")).unwrap();
        assert_eq!(load_plan(&dir.0, Some("me")).unwrap().unwrap()["favorites"][0], "크라운");
        assert_eq!(load_plan(&dir.0, Some(" sub ")).unwrap().unwrap()["favorites"][0], "헬름");
        let names: Vec<String> = list_accounts(&dir.0).into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["me", "sub"]);
    }

    #[test]
    fn a_plan_of_another_shape_is_refused_and_the_previous_one_stays() {
        let dir = TempDir::new();
        dir.account("me");
        save_plan(&dir.0, Some("me"), &plan("앞의 것")).unwrap();

        let mut other_kind = plan("x");
        other_kind["kind"] = json!("intercept_report");
        let mut newer = plan("x");
        newer["schema_version"] = json!(2);
        let mut no_records = plan("x");
        no_records.as_object_mut().unwrap().remove("records");
        let mut huge = plan("x");
        huge["records"] = Value::Array(vec![json!({}); PLAN_MAX_ITEMS + 1]);
        for doc in [other_kind, newer, no_records, huge, json!([1])] {
            let err = save_plan(&dir.0, Some("me"), &doc).unwrap_err();
            assert!(matches!(err, SharedError::PlanInvalid { .. }), "{err:?}");
            assert!(has_korean(&err.to_string()));
            assert!(err.to_string().contains("그대로 둔다"));
            assert_eq!(load_plan(&dir.0, Some("me")).unwrap().unwrap()["favorites"][0], "앞의 것");
        }

        // 이름은 경로가 아니다. 없는 계정에는 쓰지 않는다.
        for bad in ["../me", "..\\me", "me.plan", "C:\\x", "a/b"] {
            let err = save_plan(&dir.0, Some(bad), &plan("x")).unwrap_err();
            assert!(matches!(err, SharedError::NameInvalid { .. }), "{bad}: {err:?}");
            assert!(matches!(load_plan(&dir.0, Some(bad)).unwrap_err(), SharedError::NameInvalid { .. }), "{bad}");
        }
        assert_eq!(
            save_plan(&dir.0, Some("nobody"), &plan("x")).unwrap_err(),
            SharedError::AccountMissing { name: "nobody".into() }
        );
        assert!(!dir.0.join("nobody.plan.json").exists());

        // 깨진 파일은 한국어로 알리고 지우지 않는다.
        fs::write(dir.0.join("me.plan.json"), "{ 깨진").unwrap();
        let err = load_plan(&dir.0, Some("me")).unwrap_err();
        assert!(has_korean(&err.to_string()));
        assert!(dir.0.join("me.plan.json").is_file());
    }

    #[test]
    fn the_snapshot_serializes_with_the_names_the_screen_reads() {
        let dir = TempDir::new();
        dir.account("me");
        let value = serde_json::to_value(snapshot(&dir.0)).unwrap();
        let keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["default_account", "remembered", "accounts", "overlay_launch", "intercept_saved_at", "problems"]
        );
        assert_eq!(value["overlay_launch"], "with_app");
        assert_eq!(value["accounts"][0]["name"], "me");
    }
}
