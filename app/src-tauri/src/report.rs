//! 비교 결과 JSON 읽기 (`docs/data-model.md` §비교 결과, `schema_version` 1).
//!
//! 파일을 읽어 형식만 확인하고 내용은 그대로 돌려준다. 수치를 고치거나 채우지 않는다.

use std::fmt;
use std::fs;
use std::io;
use std::path::Path;

use serde_json::Value;

/// 이 앱이 읽을 수 있는 비교 결과의 판.
pub const SUPPORTED_SCHEMA_VERSION: u64 = 1;

/// 실수로 큰 파일을 고르면 통째로 읽지 않는다.
pub const MAX_REPORT_BYTES: u64 = 32 * 1024 * 1024;

/// 화면이 그릴 때 기대하는 배열 칸.
const ARRAY_FIELDS: [&str; 4] = ["ranking", "rejected", "failed", "caveats"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReportError {
    EmptyPath,
    NotFound { path: String },
    NotAFile { path: String },
    TooLarge { path: String, bytes: u64 },
    Unreadable { path: String, detail: String },
    NotUtf8 { path: String },
    InvalidJson { path: String, detail: String },
    NotAnObject { path: String },
    MissingSchemaVersion { path: String },
    SchemaVersionMismatch { path: String, found: String },
    WrongKind { path: String, kind: String },
    MissingField { path: String, field: &'static str },
}

impl fmt::Display for ReportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPath => write!(f, "비교 결과 파일 경로가 비어 있다"),
            Self::NotFound { path } => write!(f, "파일을 찾을 수 없다: {path}"),
            Self::NotAFile { path } => write!(f, "파일이 아니다(폴더 등): {path}"),
            Self::TooLarge { path, bytes } => write!(
                f,
                "파일이 너무 크다({bytes}바이트, 한도 {MAX_REPORT_BYTES}바이트). 비교 결과 파일이 맞는지 확인하라: {path}"
            ),
            Self::Unreadable { path, detail } => {
                write!(f, "파일을 읽을 수 없다: {path} ({detail})")
            }
            Self::NotUtf8 { path } => write!(f, "UTF-8 텍스트가 아니다: {path}"),
            Self::InvalidJson { path, detail } => {
                write!(f, "JSON이 아니다: {path} ({detail})")
            }
            Self::NotAnObject { path } => {
                write!(f, "비교 결과가 아니다(최상위가 JSON 객체가 아니다): {path}")
            }
            Self::MissingSchemaVersion { path } => {
                write!(f, "비교 결과가 아니다(schema_version이 없다): {path}")
            }
            Self::SchemaVersionMismatch { path, found } => write!(
                f,
                "schema_version이 맞지 않는다: 파일은 {found}, 이 앱이 읽는 판은 {SUPPORTED_SCHEMA_VERSION}이다: {path}"
            ),
            Self::WrongKind { path, kind } => write!(
                f,
                "편성 비교 결과가 아니다(kind: {kind}). compare·suggest가 만든 결과 파일만 읽는다: {path}"
            ),
            Self::MissingField { path, field } => {
                write!(f, "비교 결과가 아니다({field} 칸이 없거나 형식이 다르다): {path}")
            }
        }
    }
}

impl std::error::Error for ReportError {}

/// 입력란에 적은 경로를 다듬는다: 앞뒤 공백과, 탐색기의 "경로로 복사"가 붙이는 큰따옴표 한 쌍을 뗀다.
pub fn clean_path_input(input: &str) -> &str {
    let trimmed = input.trim();
    trimmed
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .map_or(trimmed, str::trim)
}

/// 실행 인자(프로그램 이름 제외)에서 결과 파일 경로를 고른다: 옵션(`-`로 시작)이 아닌 첫 인자.
pub fn first_path_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .map(|a| clean_path_input(&a).to_string())
        .find(|a| !a.is_empty() && !a.starts_with('-'))
}

/// 파일에서 비교 결과를 읽는다.
pub fn load_report_file(path: &Path) -> Result<Value, ReportError> {
    let (text, shown) = read_text_file(path)?;
    parse_report(&text, &shown)
}

/// JSON 파일(계정·전투 조건·후보 편성)을 읽어 내용 그대로 돌려준다. 형식 확인은 계산 코드(`src/core`)가 한다.
pub fn read_json_file(path: &Path) -> Result<Value, ReportError> {
    let (text, shown) = read_text_file(path)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    serde_json::from_str(text).map_err(|e| ReportError::InvalidJson {
        path: shown,
        detail: json_error_detail(&e),
    })
}

/// 크기 한도 안의 UTF-8 텍스트 파일을 읽는다. 돌려주는 두 번째 값은 오류 문장에 넣을 경로다.
fn read_text_file(path: &Path) -> Result<(String, String), ReportError> {
    let shown = path.display().to_string();
    if path.as_os_str().is_empty() {
        return Err(ReportError::EmptyPath);
    }
    let meta = fs::metadata(path).map_err(|e| io_error(&shown, &e))?;
    if !meta.is_file() {
        return Err(ReportError::NotAFile { path: shown });
    }
    if meta.len() > MAX_REPORT_BYTES {
        return Err(ReportError::TooLarge {
            path: shown,
            bytes: meta.len(),
        });
    }
    let bytes = fs::read(path).map_err(|e| io_error(&shown, &e))?;
    let text = String::from_utf8(bytes).map_err(|_| ReportError::NotUtf8 {
        path: shown.clone(),
    })?;
    Ok((text, shown))
}

/// JSON 텍스트가 비교 결과인지 확인하고 값으로 돌려준다. `shown`은 오류 문장에 넣을 파일 이름이다.
pub fn parse_report(text: &str, shown: &str) -> Result<Value, ReportError> {
    let path = || shown.to_string();
    // Windows 편집기가 붙이는 BOM은 JSON이 아니므로 뗀다.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let value: Value = serde_json::from_str(text).map_err(|e| ReportError::InvalidJson {
        path: path(),
        detail: json_error_detail(&e),
    })?;
    let Some(obj) = value.as_object() else {
        return Err(ReportError::NotAnObject { path: path() });
    };

    match obj.get("schema_version") {
        None | Some(Value::Null) => {
            return Err(ReportError::MissingSchemaVersion { path: path() })
        }
        Some(v) if v.as_u64() == Some(SUPPORTED_SCHEMA_VERSION) => {}
        Some(v) => {
            return Err(ReportError::SchemaVersionMismatch {
                path: path(),
                found: v.to_string(),
            })
        }
    }

    // 성장 비교·가져오기·변경 감지 결과는 kind가 있다. 편성 비교 결과에는 없다.
    if let Some(kind) = obj.get("kind").filter(|k| !k.is_null()) {
        return Err(ReportError::WrongKind {
            path: path(),
            kind: kind.as_str().map_or_else(|| kind.to_string(), str::to_string),
        });
    }

    if !obj.get("account").is_some_and(Value::is_object) {
        return Err(ReportError::MissingField {
            path: path(),
            field: "account",
        });
    }
    for field in ARRAY_FIELDS {
        if !obj.get(field).is_some_and(Value::is_array) {
            return Err(ReportError::MissingField {
                path: path(),
                field,
            });
        }
    }
    Ok(value)
}

fn io_error(shown: &str, e: &io::Error) -> ReportError {
    match e.kind() {
        io::ErrorKind::NotFound => ReportError::NotFound {
            path: shown.to_string(),
        },
        _ => ReportError::Unreadable {
            path: shown.to_string(),
            detail: e.to_string(),
        },
    }
}

/// serde_json의 영어 설명 대신 위치만 한국어로 알린다.
fn json_error_detail(e: &serde_json::Error) -> String {
    if e.is_eof() && e.line() <= 1 && e.column() == 0 {
        return "내용이 비어 있다".to_string();
    }
    let what = if e.is_eof() {
        "내용이 중간에 끊겼다"
    } else {
        "문법 오류"
    };
    format!("{}번째 줄 {}번째 글자 근처: {what}", e.line(), e.column())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 실제 CLI(`node src/cli.mjs compare … --json`)가 만든 샘플 결과. 프런트 컴포넌트 테스트와 같은 파일이다.
    fn sample_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/compare.sample.json")
    }

    /// 테스트마다 다른 임시 파일. 끝나면 지운다.
    struct TempFile(PathBuf);

    impl TempFile {
        fn with_bytes(bytes: &[u8]) -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let name = format!(
                "nikke-companion-report-test-{}-{}.json",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            );
            let path = std::env::temp_dir().join(name);
            fs::write(&path, bytes).expect("임시 파일 쓰기");
            Self(path)
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    fn minimal() -> Value {
        serde_json::json!({
            "schema_version": 1,
            "account": { "name": "t", "is_test_data": true },
            "ranking": [], "rejected": [], "failed": [], "caveats": []
        })
    }

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    #[test]
    fn reads_the_sample_report_made_by_the_real_cli() {
        let report = load_report_file(&sample_path()).expect("샘플 결과를 읽는다");
        assert_eq!(report["schema_version"], 1);
        assert_eq!(report["account"]["is_test_data"], true);
        let ranking = report["ranking"].as_array().unwrap();
        assert_eq!(ranking.len(), 3);
        assert_eq!(ranking[0]["rank"], 1);
        // 수치는 원값 그대로 돌려준다
        assert_eq!(ranking[0]["total_damage"], 3_463_364_987_u64);
        assert_eq!(report["rejected"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn returns_the_document_unchanged() {
        let text = fs::read_to_string(sample_path()).unwrap();
        let expected: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(load_report_file(&sample_path()).unwrap(), expected);
    }

    #[test]
    fn missing_file_is_a_korean_error() {
        let path = std::env::temp_dir().join("nikke-companion-no-such-report.json");
        let err = load_report_file(&path).unwrap_err();
        assert!(matches!(err, ReportError::NotFound { .. }));
        let msg = err.to_string();
        assert!(msg.contains("파일을 찾을 수 없다"), "{msg}");
        assert!(msg.contains("nikke-companion-no-such-report.json"), "{msg}");
    }

    #[test]
    fn empty_path_and_directory_are_errors() {
        assert_eq!(
            load_report_file(Path::new("")).unwrap_err(),
            ReportError::EmptyPath
        );
        let err = load_report_file(&std::env::temp_dir()).unwrap_err();
        assert!(matches!(err, ReportError::NotAFile { .. }));
        assert!(err.to_string().contains("파일이 아니다"));
    }

    #[test]
    fn non_json_is_a_korean_error_with_position() {
        let file = TempFile::with_bytes("1위  A 레드후드-앨리스  총딜 34.63억\n".as_bytes());
        let err = load_report_file(&file.0).unwrap_err();
        assert!(matches!(err, ReportError::InvalidJson { .. }));
        let msg = err.to_string();
        assert!(msg.contains("JSON이 아니다"), "{msg}");
        assert!(msg.contains("1번째 줄"), "{msg}");
    }

    #[test]
    fn truncated_and_empty_json_are_reported() {
        let cut = TempFile::with_bytes(br#"{"schema_version": 1, "ranking": ["#);
        let msg = load_report_file(&cut.0).unwrap_err().to_string();
        assert!(msg.contains("JSON이 아니다") && msg.contains("끊겼다"), "{msg}");

        let empty = TempFile::with_bytes(b"");
        let msg = load_report_file(&empty.0).unwrap_err().to_string();
        assert!(msg.contains("JSON이 아니다") && msg.contains("비어 있다"), "{msg}");
    }

    #[test]
    fn non_utf8_is_an_error() {
        let file = TempFile::with_bytes(&[0xff, 0xfe, 0x00, 0x7b]);
        let err = load_report_file(&file.0).unwrap_err();
        assert!(matches!(err, ReportError::NotUtf8 { .. }));
    }

    #[test]
    fn schema_version_mismatch_names_both_versions() {
        let mut doc = minimal();
        doc["schema_version"] = serde_json::json!(2);
        let err = parse_report(&doc.to_string(), "결과.json").unwrap_err();
        assert_eq!(
            err,
            ReportError::SchemaVersionMismatch {
                path: "결과.json".into(),
                found: "2".into()
            }
        );
        let msg = err.to_string();
        assert!(msg.contains("schema_version이 맞지 않는다"), "{msg}");
        assert!(msg.contains("파일은 2") && msg.contains("읽는 판은 1"), "{msg}");
    }

    #[test]
    fn schema_version_must_be_the_number_one() {
        for bad in [
            serde_json::json!("1"),
            serde_json::json!(1.5),
            serde_json::json!(0),
            serde_json::json!(-1),
            serde_json::json!([1]),
        ] {
            let mut doc = minimal();
            doc["schema_version"] = bad.clone();
            let err = parse_report(&doc.to_string(), "x.json").unwrap_err();
            assert!(
                matches!(err, ReportError::SchemaVersionMismatch { .. }),
                "{bad}: {err:?}"
            );
        }
    }

    #[test]
    fn missing_schema_version_is_an_error() {
        let mut doc = minimal();
        doc.as_object_mut().unwrap().remove("schema_version");
        let err = parse_report(&doc.to_string(), "x.json").unwrap_err();
        assert!(matches!(err, ReportError::MissingSchemaVersion { .. }));
        assert!(err.to_string().contains("schema_version이 없다"));
    }

    #[test]
    fn top_level_must_be_an_object() {
        for text in ["[]", "1", "\"문자열\"", "null"] {
            let err = parse_report(text, "x.json").unwrap_err();
            assert!(matches!(err, ReportError::NotAnObject { .. }), "{text}");
        }
    }

    #[test]
    fn other_result_kinds_are_rejected() {
        let mut doc = minimal();
        doc["kind"] = serde_json::json!("growth");
        let err = parse_report(&doc.to_string(), "x.json").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("편성 비교 결과가 아니다"), "{msg}");
        assert!(msg.contains("growth"), "{msg}");
    }

    #[test]
    fn required_fields_are_checked() {
        for field in ["account", "ranking", "rejected", "failed", "caveats"] {
            let mut doc = minimal();
            doc.as_object_mut().unwrap().remove(field);
            let err = parse_report(&doc.to_string(), "x.json").unwrap_err();
            assert_eq!(
                err,
                ReportError::MissingField {
                    path: "x.json".into(),
                    field
                },
                "{field}"
            );
            assert!(err.to_string().contains(field));
        }
        let mut doc = minimal();
        doc["ranking"] = serde_json::json!({});
        assert!(parse_report(&doc.to_string(), "x.json").is_err());
    }

    #[test]
    fn utf8_bom_is_accepted() {
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(minimal().to_string().as_bytes());
        let file = TempFile::with_bytes(&bytes);
        assert_eq!(load_report_file(&file.0).unwrap(), minimal());
    }

    #[test]
    fn suggest_results_are_accepted() {
        // suggest 결과는 비교 결과에 suggestion 요약이 더 붙은 것이다
        let mut doc = minimal();
        doc["suggestion"] = serde_json::json!({ "considered": 30, "generated": 6, "simulated": 6, "shown": 5 });
        assert!(parse_report(&doc.to_string(), "x.json").is_ok());
    }

    #[test]
    fn path_input_is_trimmed_and_unquoted() {
        assert_eq!(clean_path_input("  C:\\결과\\a.json \n"), "C:\\결과\\a.json");
        assert_eq!(clean_path_input("\"C:\\내 문서\\a.json\""), "C:\\내 문서\\a.json");
        assert_eq!(clean_path_input(" \" a.json \" "), "a.json");
        // 한쪽에만 있는 따옴표는 건드리지 않는다
        assert_eq!(clean_path_input("\"a.json"), "\"a.json");
        assert_eq!(clean_path_input("   "), "");
    }

    #[test]
    fn startup_path_is_the_first_non_option_argument() {
        let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(first_path_arg(args(&[])), None);
        assert_eq!(first_path_arg(args(&["--flag", ""])), None);
        assert_eq!(
            first_path_arg(args(&["--flag", "결과.json", "other.json"])),
            Some("결과.json".to_string())
        );
        assert_eq!(
            first_path_arg(args(&["\"C:\\a b\\r.json\""])),
            Some("C:\\a b\\r.json".to_string())
        );
    }

    #[test]
    fn reads_any_json_file_without_report_checks() {
        // 계정·조건·편성 파일은 비교 결과가 아니다. 내용 그대로 돌려주고 형식은 계산 코드가 본다.
        let f = TempFile::with_bytes("\u{feff}{\"squads\": [{\"members\": [\"크라운\"]}]}".as_bytes());
        let v = read_json_file(&f.0).expect("읽기");
        assert_eq!(v["squads"][0]["members"][0], "크라운");

        let list = TempFile::with_bytes(b"[1, 2]");
        assert_eq!(read_json_file(&list.0).expect("읽기"), serde_json::json!([1, 2]));

        let broken = TempFile::with_bytes(b"{\"a\": ");
        assert!(matches!(
            read_json_file(&broken.0),
            Err(ReportError::InvalidJson { .. })
        ));
        assert!(matches!(
            read_json_file(Path::new("없는-폴더/없음.json")),
            Err(ReportError::NotFound { .. })
        ));
        assert_eq!(read_json_file(Path::new("")), Err(ReportError::EmptyPath));
    }

    #[test]
    fn every_error_message_is_korean() {
        let p = || "x.json".to_string();
        let all = [
            ReportError::EmptyPath,
            ReportError::NotFound { path: p() },
            ReportError::NotAFile { path: p() },
            ReportError::TooLarge { path: p(), bytes: MAX_REPORT_BYTES + 1 },
            ReportError::Unreadable { path: p(), detail: "os error 5".into() },
            ReportError::NotUtf8 { path: p() },
            ReportError::InvalidJson { path: p(), detail: "문법 오류".into() },
            ReportError::NotAnObject { path: p() },
            ReportError::MissingSchemaVersion { path: p() },
            ReportError::SchemaVersionMismatch { path: p(), found: "2".into() },
            ReportError::WrongKind { path: p(), kind: "growth".into() },
            ReportError::MissingField { path: p(), field: "ranking" },
        ];
        for e in all {
            assert!(has_korean(&e.to_string()), "{e:?}");
        }
    }
}
