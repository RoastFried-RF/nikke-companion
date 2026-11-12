//! 클립보드에 글자 쓰기 — 덱 빌더의 「편성 복사」(P-030).
//!
//! **쓰기만 한다.** 이 앱에는 클립보드를 읽는 코드가 없다(읽는 명령도, 읽는 호출도 없다 — 읽기는
//! `tests/live_clipboard.rs`가 쓴 것을 확인할 때만 테스트 안에서 한다). 그래서 클립보드 플러그인을 쓰지 않고
//! 앱 명령 하나(`copy_text`)로 만들었다: 권한은 데스크톱 앱 창의 `allow-copy-text` 하나다.
//!
//! 쓰는 길: 표준 클립보드 API(열기 → 비우기 → 유니코드 글자 한 덩이 넘기기 → 닫기). 넘길 메모리 덩이는 COM의
//! 메모리 스트림(`CreateStreamOnHGlobal`)에 글을 써서 만든다 — 메모리를 직접 잡고 잠그는 API(`GlobalAlloc`·`GlobalLock`,
//! `Win32_System_Memory`)는 쓰지 않는다. 그 기능 묶음은 다른 프로세스의 메모리를 다루는 호출과 함께 있어 이 앱에서
//! 켜지 않기로 한 것이다(`tests/contract.test.ts`의 「게임 프로세스를 열거나 메모리를 읽거나 …」).
//! 어느 스레드에서 불러도 된다(창도 메시지 처리도 필요 없다 — 앱의 명령은 작업 스레드에서 돈다).
//!
//! 화면이 넘기는 것은 글자뿐이다. 무엇을 쓸지는 [`payload`]가 정한다(순수 함수): 빈 글과 너무 긴 글은 거부하고,
//! 제어 문자(줄바꿈·탭 제외)는 빼고, 줄바꿈은 Windows의 것(CRLF)으로 맞춘다.

use std::fmt;

/// 받아 주는 글의 길이(글자 수). 편성 한 벌은 백 자 안팎이다 — 넉넉히 잡되 끝없이 받지는 않는다.
pub const MAX_CHARS: usize = 4000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardError {
    /// 쓸 글이 없다(비었거나 공백뿐이다).
    Empty,
    /// 글이 너무 길다.
    TooLong { chars: usize },
    /// 다른 프로그램이 클립보드를 쥐고 있어 열지 못했다.
    Busy,
    /// 클립보드에 쓰는 도중에 실패했다.
    Failed { step: &'static str },
    /// 이 운영체제에서는 만들지 않았다.
    Unsupported,
}

impl fmt::Display for ClipboardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "복사할 글이 없다"),
            Self::TooLong { chars } => write!(
                f,
                "복사할 글이 너무 길다({chars}자 — {MAX_CHARS}자까지 복사한다)"
            ),
            Self::Busy => write!(
                f,
                "다른 프로그램이 클립보드를 쓰고 있어 복사하지 못했다. 잠시 뒤에 다시 누른다"
            ),
            Self::Failed { step } => write!(f, "클립보드에 쓰지 못했다({step}). 다시 눌러 본다"),
            Self::Unsupported => write!(f, "이 운영체제에서는 복사를 지원하지 않는다"),
        }
    }
}

impl std::error::Error for ClipboardError {}

/// 클립보드에 쓸 글(UTF-16, 끝에 NUL 하나). 순수 함수 — 클립보드를 건드리지 않는다.
///
/// - 제어 문자는 뺀다(줄바꿈·탭은 남긴다). 글 가운데의 NUL이 뒤를 잘라 먹지 않게 한다.
/// - 줄바꿈은 CRLF로 맞춘다(메모장 같은 프로그램에 붙였을 때 줄이 나뉘게).
/// - 빈 글·공백뿐인 글·[`MAX_CHARS`]를 넘는 글은 거부한다.
pub fn payload(text: &str) -> Result<Vec<u16>, ClipboardError> {
    let cleaned: String = text
        .chars()
        .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
        .collect();
    if cleaned.trim().is_empty() {
        return Err(ClipboardError::Empty);
    }
    let chars = cleaned.chars().count();
    if chars > MAX_CHARS {
        return Err(ClipboardError::TooLong { chars });
    }
    let mut wide: Vec<u16> = cleaned.replace('\n', "\r\n").encode_utf16().collect();
    wide.push(0);
    Ok(wide)
}

/// 글자를 클립보드에 쓴다(유니코드 글자 형식 하나만). 클립보드의 앞선 내용은 이 글로 바뀐다.
#[cfg(windows)]
pub fn write_text(text: &str) -> Result<(), ClipboardError> {
    use std::time::Duration;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::Com::StructuredStorage::{
        CreateStreamOnHGlobal, GetHGlobalFromStream,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };

    /// 유니코드 글자 형식(CF_UNICODETEXT).
    const UNICODE_TEXT: u32 = 13;
    /// 다른 프로그램이 잠깐 쥐고 있을 때 다시 열어 보는 횟수와 간격.
    const OPEN_TRIES: u32 = 10;
    const OPEN_WAIT: Duration = Duration::from_millis(20);

    let wide = payload(text)?;
    let bytes: Vec<u8> = wide.iter().flat_map(|unit| unit.to_le_bytes()).collect();
    let prepare = ClipboardError::Failed { step: "글 준비" };

    // 글을 담은 메모리 덩이: 메모리 스트림을 만들어 글을 쓰고, 그 스트림이 쥔 덩이를 꺼낸다.
    // 스트림을 놓아도 덩이는 남는다(`fdeleteonrelease = false`) — 클립보드에 넘기거나 아래에서 직접 푼다.
    // SAFETY: 쓰는 버퍼(`bytes`)는 호출이 끝날 때까지 살아 있고 길이를 그대로 넘긴다.
    let memory: HGLOBAL = unsafe {
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), false).map_err(|_| prepare.clone())?;
        let mut written = 0u32;
        let wrote = stream.Write(bytes.as_ptr().cast(), bytes.len() as u32, Some(&mut written));
        let memory = GetHGlobalFromStream(&stream).map_err(|_| prepare.clone())?;
        if wrote.is_err() || written as usize != bytes.len() {
            let _ = GlobalFree(Some(memory));
            return Err(prepare);
        }
        memory
    };

    // SAFETY: 표준 클립보드 API를 정해진 순서로 부른다. 넘긴 덩이는 운영체제의 것이 된다(넘기지 못했을 때만 여기서 푼다).
    // 창 핸들을 넘기지 않는다(주인 없는 열기) — 이 앱의 어느 창도 클립보드의 주인이 되지 않는다.
    unsafe {
        let mut opened = false;
        for _ in 0..OPEN_TRIES {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(OPEN_WAIT);
        }
        if !opened {
            let _ = GlobalFree(Some(memory));
            return Err(ClipboardError::Busy);
        }
        let result = (|| {
            EmptyClipboard().map_err(|_| ClipboardError::Failed { step: "비우기" })?;
            SetClipboardData(UNICODE_TEXT, Some(HANDLE(memory.0)))
                .map_err(|_| ClipboardError::Failed { step: "쓰기" })?;
            Ok(())
        })();
        if result.is_err() {
            let _ = GlobalFree(Some(memory));
        }
        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
pub fn write_text(text: &str) -> Result<(), ClipboardError> {
    payload(text)?;
    Err(ClipboardError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of(wide: &[u16]) -> String {
        String::from_utf16(&wide[..wide.len() - 1]).unwrap()
    }

    #[test]
    fn the_payload_is_utf16_with_one_trailing_nul_and_crlf_lines() {
        let wide = payload("편성: 1. 크라운 / 2. 헬름\n상대: 크라켄\n총딜 25.62억 (추정)").unwrap();
        assert_eq!(wide.last(), Some(&0));
        assert_eq!(wide.iter().filter(|u| **u == 0).count(), 1);
        assert_eq!(
            text_of(&wide),
            "편성: 1. 크라운 / 2. 헬름\r\n상대: 크라켄\r\n총딜 25.62억 (추정)"
        );
        // 이미 CRLF인 글은 줄바꿈이 겹치지 않는다.
        assert_eq!(text_of(&payload("a\r\nb").unwrap()), "a\r\nb");
    }

    #[test]
    fn control_characters_are_dropped_but_tabs_and_newlines_stay() {
        let wide = payload("가\u{0}나\u{7}\t다\u{1b}[31m\n라").unwrap();
        assert_eq!(text_of(&wide), "가나\t다[31m\r\n라");
    }

    #[test]
    fn empty_and_oversized_text_is_refused_in_korean() {
        for empty in ["", "   ", "\n\t ", "\u{0}\u{1}"] {
            assert_eq!(payload(empty).unwrap_err(), ClipboardError::Empty, "{empty:?}");
        }
        assert!(payload(&"가".repeat(MAX_CHARS)).is_ok());
        let err = payload(&"가".repeat(MAX_CHARS + 1)).unwrap_err();
        assert_eq!(err, ClipboardError::TooLong { chars: MAX_CHARS + 1 });
        for err in [
            ClipboardError::Empty,
            err,
            ClipboardError::Busy,
            ClipboardError::Failed { step: "쓰기" },
            ClipboardError::Unsupported,
        ] {
            assert!(err.to_string().chars().any(|c| ('가'..='힣').contains(&c)), "{err:?}");
        }
    }

    #[test]
    fn this_module_only_writes() {
        // 읽는 호출이 이 파일에 없다(쓴 것을 확인하는 읽기는 tests/live_clipboard.rs에만 있다).
        let source = include_str!("clipboard.rs");
        let code: String = source
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        let read_call = ["Get", "ClipboardData"].concat();
        assert!(!code.contains(&read_call));
    }
}
