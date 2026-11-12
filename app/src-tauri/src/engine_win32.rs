//! 엔진 프로세스 묶음 — Windows Job Object.
//!
//! 엔진을 멈출 때(중단·시간 초과·다른 프로세스의 오류) 띄운 `python`만 끝내면, 그 `python`이 다른 실행 파일을 띄우는
//! 껍데기였거나(가상 환경의 실행기 등) 엔진이 도중에 다른 프로그램(git)을 띄운 경우 그 프로세스가 남을 수 있다.
//! 그래서 띄운 프로세스를 Job Object에 넣고, 멈출 때 Job을 통째로 끝낸다.
//! 남은 자손은 프로세스만 남기는 것이 아니다 — 엔진의 출력 파이프를 물려받아 쥐고 있어서, 그 자손이 끝날 때까지
//! 배치 호출이 돌아오지 않는다(`tests/engine_cancel.rs`의 가짜 엔진으로 확인: Job 없이는 300초 동안 돌아오지 않았다).
//!
//! **앱이 끝날 때도 함께 끝난다**(P-024): Job에 「Job이 닫히면 안의 프로세스를 모두 끝낸다」
//! (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`)를 걸어 둔다. Job의 핸들은 이 앱만 쥐고 있으므로(자식에게 물려주지 않는다),
//! 앱이 어떻게 끝나든 — 끝내기 단추, 창 닫기, 작업 관리자의 프로세스 종료, 충돌 — Windows가 핸들을 닫으면서 돌던
//! 엔진·수집 프로세스와 그 자식들을 끝낸다. 앱이 정리할 틈 없이 죽어도 된다(`tests/exit_cleanup.rs`).
//! 그 결과로, 계산이 정상으로 끝나 묶음을 버릴 때에도 엔진이 남겨 둔 자식 프로세스가 있으면 함께 끝난다.
//!
//! 여기서 다루는 것은 **이 앱이 띄운 엔진 프로세스뿐**이다: 핸들은 `std::process::Child`가 준 것이고, 다른 프로세스를
//! 열지 않는다(게임 프로세스와 무관하다).
//!
//! 한계: 프로세스를 띄운 직후에 Job에 넣는다. 그 사이(마이크로초)에 자식 프로세스가 만들어지면 그 자식은 Job 밖이다.

use std::ffi::c_void;
use std::mem::size_of;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// 끝낸 프로세스에 남기는 종료 코드(엔진의 정상 종료 0·인자 오류 2와 겹치지 않으면 된다).
const KILLED_EXIT_CODE: u32 = 1;

/// Win32의 `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`과 같은 모양.
///
/// `windows` 크레이트의 그 타입은 `Win32_System_Threading` 기능을 켜야 나온다(안에 `IO_COUNTERS`가 있다). 그 기능은
/// 다른 프로세스를 여는 호출(`OpenProcess` 등)도 함께 들여오므로 켜지 않고(`tests/contract.test.ts`), 같은 모양을
/// 여기 적는다. 쓰는 칸은 `basic.LimitFlags` 하나다.
#[repr(C)]
#[derive(Default)]
struct ExtendedLimitInformation {
    basic: JOBOBJECT_BASIC_LIMIT_INFORMATION,
    /// `IO_COUNTERS`: 64비트 수 여섯 개.
    io: [u64; 6],
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

/// Job에 「닫히면 안의 프로세스를 모두 끝낸다」를 건다. 걸었으면 `true`.
fn kill_on_close(job: HANDLE) -> bool {
    let mut info = ExtendedLimitInformation::default();
    info.basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: 방금 만든 Job 핸들과, 이 호출 동안 살아 있는 구조체의 주소·크기를 넘긴다.
    unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const ExtendedLimitInformation as *const c_void,
            size_of::<ExtendedLimitInformation>() as u32,
        )
    }
    .is_ok()
}

/// 엔진 프로세스 하나와 그 자손들. Job을 만들지 못했으면 비어 있고, 그때는 띄운 프로세스만 끝낸다(`engine.rs`).
pub(crate) struct ProcessGroup(Option<HANDLE>);

impl ProcessGroup {
    /// 방금 띄운 프로세스를 새 Job에 넣는다. 실패해도 계산은 한다 — 멈출 때 자손까지 끝내지 못할 뿐이다.
    pub(crate) fn adopt(child: &Child) -> Self {
        // SAFETY: 이름 없는 Job을 기본 보안 속성으로 만든다(핸들은 자식 프로세스에 물려주지 않는다). 받은 핸들은 Drop에서 닫는다.
        let Ok(job) = (unsafe { CreateJobObjectW(None, PCWSTR::null()) }) else {
            return Self(None);
        };
        // 앱이 끝나면(핸들이 닫히면) 안의 프로세스도 끝나게 한다. 걸지 못해도 중단·시간 초과 때의 정리는 그대로 된다 —
        // 앱이 끝날 때의 정리만 `lib.rs`의 종료 처리(도는 배치를 멈추고 잠깐 기다린다)에 기댄다.
        let _ = kill_on_close(job);
        // SAFETY: `child`가 살아 있는 동안 그 프로세스 핸들은 유효하다. Job 핸들은 위에서 만든 것이다.
        let assigned = unsafe { AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())) };
        if assigned.is_err() {
            // SAFETY: 위에서 만든, 아직 닫지 않은 핸들이다.
            let _ = unsafe { CloseHandle(job) };
            return Self(None);
        }
        Self(Some(job))
    }

    /// 묶음의 프로세스를 모두 끝낸다. 이미 끝났으면 아무 일도 없다.
    pub(crate) fn terminate(&self) {
        if let Some(job) = self.0 {
            // SAFETY: Drop 전이므로 Job 핸들이 유효하다.
            let _ = unsafe { TerminateJobObject(job, KILLED_EXIT_CODE) };
        }
    }
}

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if let Some(job) = self.0.take() {
            // SAFETY: 한 번만 닫는다(take). Job을 닫으면 안에 남아 있던 프로세스가 끝난다(「닫히면 끝낸다」) —
            // 정상 종료한 엔진은 이미 끝나 있고, 엔진이 남겨 둔 자식이 있었다면 여기서 함께 끝난다.
            let _ = unsafe { CloseHandle(job) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_limit_structure_has_the_win32_layout() {
        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION: 64비트에서 144바이트, 32비트에서 112바이트.
        #[cfg(target_pointer_width = "64")]
        assert_eq!(size_of::<ExtendedLimitInformation>(), 144);
        #[cfg(target_pointer_width = "32")]
        assert_eq!(size_of::<ExtendedLimitInformation>(), 112);
        // 「닫히면 끝낸다」 표시의 값.
        assert_eq!(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.0, 0x2000);
    }

    #[test]
    fn a_job_accepts_the_kill_on_close_limit() {
        // SAFETY: 이름 없는 Job을 만들고 이 테스트 안에서 닫는다. 프로세스는 넣지 않는다.
        let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.expect("Job Object");
        let set = kill_on_close(job);
        // SAFETY: 위에서 만든 핸들이다.
        let _ = unsafe { CloseHandle(job) };
        assert!(set, "Job에 「닫히면 끝낸다」를 걸지 못했다");
    }
}
