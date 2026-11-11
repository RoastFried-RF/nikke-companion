// Rust 쪽(src-tauri)과 주고받는 곳은 여기뿐이다. 화면 코드는 Tauri API를 직접 부르지 않는다.
// 이 앱은 네트워크 요청을 하지 않는다. 밖으로 나가는 통로는 Tauri IPC(invoke·이벤트)뿐이다
// (tests/contract.test.ts가 프런트 코드에 네트워크 API가 없는지 확인한다).

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  CompareReport,
  EngineCatalog,
  EngineProgress,
  EngineRequest,
  EngineRow,
  EngineVersion,
  OverlaySnapshot,
} from '../types';

/** 오버레이 상태가 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 OVERLAY_STATE_EVENT). */
export const OVERLAY_STATE_EVENT = 'overlay-state';

/** 엔진 계산이 한 건 끝날 때마다 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 ENGINE_PROGRESS_EVENT). */
export const ENGINE_PROGRESS_EVENT = 'engine-progress';

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

/** 엔진이 아는 니케와 보스 프리셋. */
export function engineCatalog(): Promise<EngineCatalog> {
  return invoke<EngineCatalog>('engine_catalog');
}

/** 엔진 버전. 커밋을 알 수 없으면 commit이 null이다. */
export function engineVersion(): Promise<EngineVersion> {
  return invoke<EngineVersion>('engine_version');
}

/** 요청 여러 건을 엔진 배치로 돌린다. 결과는 입력 순서 그대로이고 줄마다 결과 또는 `{error}`다. */
export function engineRunBatch(requests: EngineRequest[]): Promise<EngineRow[]> {
  return invoke<EngineRow[]>('engine_run_batch', { requests });
}

/** JSON 파일(계정 상태·전투 조건·후보 편성)을 읽는다. 실패하면 한국어 오류 문장으로 거부된다. */
export function readJsonFile(path: string): Promise<unknown> {
  return invoke<unknown>('read_json_file', { path });
}

/** 파일 고르기 창으로 JSON 파일 하나를 고른다. 취소하면 null. */
export function pickJsonFile(title: string): Promise<string | null> {
  return invoke<string | null>('pick_json_file', { title });
}

/** 엔진 배치가 한 건 끝날 때마다 불린다. 돌려받은 함수로 구독을 끊는다. */
export function onEngineProgress(handler: (progress: EngineProgress) => void): Promise<UnlistenFn> {
  return listen<EngineProgress>(ENGINE_PROGRESS_EVENT, (event) => handler(event.payload));
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
