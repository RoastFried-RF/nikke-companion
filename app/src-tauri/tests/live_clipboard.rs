//! 클립보드에 실제로 쓰이는지 본다(P-030 — 덱 빌더의 「편성 복사」).
//!
//! 이 PC의 실제 클립보드를 쓴다: 지금 든 글자를 읽어 두고 → 시험 글을 쓰고 → 읽어서 같은지 보고 → 읽어 둔 글자를 되돌린다.
//! 글자가 아닌 것(이미지·파일)이 들어 있었으면 되돌리지 못한다 — 그래서 평소 `cargo test`에서는 돌지 않는다(`--ignored`).
//! 앱에서처럼 창이 없는 작업 스레드에서 쓴다(앱의 명령은 작업 스레드에서 돈다).
//!
//! ```text
//! cargo test --manifest-path app/src-tauri/Cargo.toml --test live_clipboard -- --ignored --nocapture
//! ```
#![cfg(windows)]

use nikke_companion_lib::clipboard;
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};

/// 클립보드의 유니코드 글자. 글자가 없으면 `None`. (앱 코드에는 읽는 길이 없다 — 테스트만 읽는다.)
fn read_text() -> Option<String> {
    // SAFETY: 표준 클립보드 API. 열고, 유니코드 글자 덩이를 메모리 스트림으로 감싸(덩이는 클립보드의 것 — 놓을 때 풀지 않는다)
    // NUL이 나올 때까지 읽고, 닫는다.
    unsafe {
        OpenClipboard(None).ok()?;
        let text = (|| {
            let handle = GetClipboardData(13).ok()?;
            let stream = CreateStreamOnHGlobal(HGLOBAL(handle.0), false).ok()?;
            let mut units: Vec<u16> = Vec::new();
            loop {
                let mut unit = [0u8; 2];
                let mut read = 0u32;
                if stream.Read(unit.as_mut_ptr().cast(), 2, Some(&mut read)).is_err() || read < 2 {
                    break;
                }
                let value = u16::from_le_bytes(unit);
                if value == 0 {
                    break;
                }
                units.push(value);
            }
            Some(String::from_utf16_lossy(&units))
        })();
        let _ = CloseClipboard();
        text
    }
}

#[test]
#[ignore = "이 PC의 실제 클립보드를 쓴다(끝나면 앞의 글자를 되돌린다)"]
fn text_written_by_the_app_can_be_pasted() {
    // 앱의 명령처럼 창이 없는 작업 스레드에서 쓴다.
    let run = std::thread::spawn(|| {
        let before = read_text();
        let sample = "편성: 1. 리틀 머메이드 / 2. 크라운 / 3. 라피 : 레드 후드 / 4. 헬름 / 5. 앨리스\n상대: 크라켄 (약점 풍압)\n총딜 25.62억 (추정 · 실전 미대조 · 내 계정 육성 기준)";
        clipboard::write_text(sample).expect("클립보드에 쓴다");
        let pasted = read_text().expect("쓴 글자가 클립보드에 있다");
        assert_eq!(pasted, sample.replace('\n', "\r\n"));

        // 한 번 더 쓰면 앞의 것이 바뀐다(쌓이지 않는다).
        clipboard::write_text("둘째").unwrap();
        assert_eq!(read_text().as_deref(), Some("둘째"));

        // 빈 글은 쓰지 않는다 — 클립보드는 그대로다.
        assert!(clipboard::write_text("  ").is_err());
        assert_eq!(read_text().as_deref(), Some("둘째"));

        // 긴 글(상한까지)도 그대로 간다.
        let long = "가".repeat(clipboard::MAX_CHARS);
        clipboard::write_text(&long).unwrap();
        assert_eq!(read_text().as_deref(), Some(long.as_str()));

        // 앞에 있던 글자를 되돌린다.
        match before.filter(|t| !t.trim().is_empty()) {
            Some(text) => {
                let _ = clipboard::write_text(&text);
            }
            None => {
                let _ = clipboard::write_text("(니케 컴패니언의 클립보드 테스트가 지나갔다)");
            }
        }
    });
    run.join().expect("작업 스레드가 끝난다");
}
