// Rust 쪽(src-tauri)과 주고받는 곳은 여기뿐이다. 화면 코드는 Tauri API를 직접 부르지 않는다.
// 이 앱은 네트워크 요청을 하지 않는다. 밖으로 나가는 통로는 Tauri IPC(invoke·이벤트)뿐이다
// (tests/contract.test.ts가 프런트 코드에 네트워크 API가 없는지 확인한다).

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CompareReport, OverlaySnapshot } from '../types';

/** 오버레이 상태가 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 OVERLAY_STATE_EVENT). */
export const OVERLAY_STATE_EVENT = 'overlay-state';

/** 비교 결과 파일을 읽는다. 실패하면 한국어 오류 문장으로 거부된다. */
export function loadReport(path: string): Promise<CompareReport> {
  return invoke<CompareReport>('load_report', { path });
}

/** 현재 오버레이 상태. */
export function overlayStatus(): Promise<OverlaySnapshot> {
  return invoke<OverlaySnapshot>('overlay_status');
}

/** 실행할 때 인자로 받은 결과 파일 경로. 없으면 null. */
export function startupReportPath(): Promise<string | null> {
  return invoke<string | null>('startup_report_path');
}

/** 앱을 끝낸다. */
export function quitApp(): Promise<void> {
  return invoke<void>('quit_app');
}

/** 단축키로 상태가 바뀔 때마다 불린다. 돌려받은 함수로 구독을 끊는다. */
export function onOverlayState(handler: (state: OverlaySnapshot) => void): Promise<UnlistenFn> {
  return listen<OverlaySnapshot>(OVERLAY_STATE_EVENT, (event) => handler(event.payload));
}

/** invoke가 거부한 값을 화면에 보일 문장으로. Rust 명령은 한국어 문자열로 거부한다. */
export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
