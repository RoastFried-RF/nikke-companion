//! 엔진 프로세스 묶음 — Windows Job Object.
//!
//! 엔진을 멈출 때(중단·시간 초과·다른 프로세스의 오류) 띄운 `python`만 끝내면, 그 `python`이 다른 실행 파일을 띄우는
//! 껍데기였거나(가상 환경의 실행기 등) 엔진이 도중에 다른 프로그램(git)을 띄운 경우 그 프로세스가 남을 수 있다.
//! 그래서 띄운 프로세스를 Job Object에 넣고, 멈출 때 Job을 통째로 끝낸다.
//! 남은 자손은 프로세스만 남기는 것이 아니다 — 엔진의 출력 파이프를 물려받아 쥐고 있어서, 그 자손이 끝날 때까지
//! 배치 호출이 돌아오지 않는다(`tests/engine_cancel.rs`의 가짜 엔진으로 확인: Job 없이는 300초 동안 돌아오지 않았다).
//!
//! 여기서 다루는 것은 **이 앱이 띄운 엔진 프로세스뿐**이다: 핸들은 `std::process::Child`가 준 것이고, 다른 프로세스를
//! 열지 않는다(게임 프로세스와 무관하다).
//!
//! 한계: 프로세스를 띄운 직후에 Job에 넣는다. 그 사이(마이크로초)에 자식 프로세스가 만들어지면 그 자식은 Job 밖이다.

use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject,
};

/// 끝낸 프로세스에 남기는 종료 코드(엔진의 정상 종료 0·인자 오류 2와 겹치지 않으면 된다).
const KILLED_EXIT_CODE: u32 = 1;

/// 엔진 프로세스 하나와 그 자손들. Job을 만들지 못했으면 비어 있고, 그때는 띄운 프로세스만 끝낸다(`engine.rs`).
pub(crate) struct ProcessGroup(Option<HANDLE>);

impl ProcessGroup {
    /// 방금 띄운 프로세스를 새 Job에 넣는다. 실패해도 계산은 한다 — 멈출 때 자손까지 끝내지 못할 뿐이다.
    pub(crate) fn adopt(child: &Child) -> Self {
        // SAFETY: 이름 없는 Job을 기본 보안 속성으로 만든다. 받은 핸들은 Drop에서 닫는다.
        let Ok(job) = (unsafe { CreateJobObjectW(None, PCWSTR::null()) }) else {
            return Self(None);
        };
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
            // SAFETY: 한 번만 닫는다(take). Job을 닫아도 안의 프로세스는 끝나지 않는다 — 정상 종료한 엔진은 이미 끝나 있다.
            let _ = unsafe { CloseHandle(job) };
        }
    }
}
