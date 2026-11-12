//! 오버레이 위젯의 설정과 자리를 디스크에 기억한다(P-028).
//!
//! 계정 폴더(환경 변수 NIKKE_ACCOUNTS_DIR → 저장소의 data/accounts — gitignore)의 `.overlay-widget.json` 하나에 둔다:
//! 오버레이 설정(크기 배율·불투명도·자동 숨김·기본 모양·클릭 통과), 핀, 끌어 둔 자리(화면 위의 자리·게임 창 기준의 자리).
//! 이름에 점이 있어 계정 이름(점을 받지 않는다)과 겹치지 않는다. 계정의 내용이나 게임 화면은 담지 않는다.
//!
//! 무엇을 담는지와 모양은 `overlay_widget::Stored`가 정한다. 여기서는 읽고 쓰기만 한다 — 쓰는 길은 `shared_state`의
//! 임시 파일 → 이름 바꾸기 하나다. 읽지 못한 파일은 건드리지 않고 기본값으로 쓴다(그 사실을 한국어로 알린다).
//! 네트워크를 쓰지 않는다.

use std::path::Path;

use crate::overlay_widget::Stored;
use crate::shared_state::{read_json, write_json, SharedError};

/// 오버레이 위젯의 설정·자리를 두는 파일(계정 폴더 안).
pub const WIDGET_FILE: &str = ".overlay-widget.json";

const WHAT: &str = "오버레이 설정";

/// 기억해 둔 것을 읽는다. 없으면 기본값이다. 읽을 수 없으면 기본값과 그 사실을 알리는 문장을 돌려준다(앱은 계속 쓴다).
pub fn load(dir: &Path) -> (Stored, Option<String>) {
    let path = dir.join(WIDGET_FILE);
    if !path.is_file() {
        return (Stored::default(), None);
    }
    let read = read_json(&path, WHAT)
        .map_err(|e| e.to_string())
        .and_then(|doc| Stored::from_value(&doc));
    match read {
        Ok(stored) => (stored, None),
        Err(e) => (Stored::default(), Some(format!("{e} — 기본값으로 쓴다"))),
    }
}

/// 기억해 둔다.
pub fn save(dir: &Path, stored: &Stored) -> Result<(), SharedError> {
    write_json(dir, WIDGET_FILE, &stored.to_value(), WHAT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay_widget::{Anchor, Corner, Leave, Prefs, Shape, Spot};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 테스트마다 다른 임시 폴더. 끝나면 지운다. 실제 계정 폴더는 쓰지 않는다.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "nikke-companion-widget-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("임시 폴더");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn has_korean(s: &str) -> bool {
        s.chars().any(|c| ('가'..='힣').contains(&c))
    }

    #[test]
    fn nothing_stored_means_defaults_without_a_problem() {
        let dir = TempDir::new();
        assert_eq!(load(&dir.0), (Stored::default(), None));
        assert_eq!(load(&dir.0.join("없는 폴더")), (Stored::default(), None));
    }

    #[test]
    fn settings_and_positions_survive_a_restart() {
        let dir = TempDir::new();
        let stored = Stored {
            prefs: Prefs {
                scale_percent: 125,
                opacity_percent: 70,
                leave: Leave::Hide,
                leave_after_sec: 20,
                default_shape: Shape::Expanded,
                click_through: true,
            },
            pinned: true,
            spot: Some(Spot { corner: Corner::BottomLeft, x: 40, y: 980 }),
            anchor: Some(Anchor { corner: Corner::TopRight, dx: -12, dy: 12 }),
        };
        save(&dir.0, &stored).unwrap();
        // 「다시 켠」 쪽은 디스크에서 읽는다.
        assert_eq!(load(&dir.0), (stored, None));
        assert!(!dir.0.join(format!("{WIDGET_FILE}.tmp")).exists());
        // 자리를 지워 저장하면(자리 초기화) 기본 자리로 돌아간다 — 설정은 그대로다.
        let reset = Stored { spot: None, anchor: None, ..stored };
        save(&dir.0, &reset).unwrap();
        let (read, problem) = load(&dir.0);
        assert_eq!(problem, None);
        assert_eq!(read.spot, None);
        assert_eq!(read.anchor, None);
        assert_eq!(read.prefs, stored.prefs);
    }

    #[test]
    fn a_broken_or_foreign_file_falls_back_to_defaults_and_says_so() {
        let dir = TempDir::new();
        for text in ["{ 깨진", r#"{"schema_version":9,"kind":"overlay_widget"}"#, r#"{"schema_version":1,"kind":"companion_state"}"#] {
            fs::write(dir.0.join(WIDGET_FILE), text).unwrap();
            let (stored, problem) = load(&dir.0);
            assert_eq!(stored, Stored::default(), "{text}");
            let problem = problem.expect("문제를 알린다");
            assert!(has_korean(&problem), "{problem}");
            assert!(problem.contains("기본값으로 쓴다"));
            // 파일은 지우지 않는다(다음 저장이 새로 쓴다).
            assert!(dir.0.join(WIDGET_FILE).is_file());
        }
    }

    #[test]
    fn the_file_name_cannot_collide_with_an_account() {
        // 계정 이름은 점을 받지 않는다 — 점으로 시작하는 이 파일은 계정 목록에 끼지 않는다.
        assert!(WIDGET_FILE.starts_with('.'));
        let dir = TempDir::new();
        save(&dir.0, &Stored::default()).unwrap();
        assert!(crate::shared_state::list_accounts(&dir.0).is_empty());
    }
}
