// Rust 쪽(src-tauri)과 주고받는 곳은 여기뿐이다. 화면 코드는 Tauri API를 직접 부르지 않는다.
// 이 앱은 네트워크 요청을 하지 않는다. 밖으로 나가는 통로는 Tauri IPC(invoke·이벤트)뿐이다
// (tests/contract.test.ts가 프런트 코드에 네트워크 API가 없는지 확인한다).

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  CaptureRecord,
  CompareReport,
  EngineCatalog,
  EngineProgress,
  EngineRequest,
  EngineRow,
  EngineVersion,
  GameCaptureOutcome,
  GameSnapshot,
  OverlaySnapshot,
  ScreenRecognition,
  ScreenTrackStatus,
} from '../types';

/** 오버레이 상태가 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 OVERLAY_STATE_EVENT). */
export const OVERLAY_STATE_EVENT = 'overlay-state';

/** 엔진 계산이 한 건 끝날 때마다 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 ENGINE_PROGRESS_EVENT). */
export const ENGINE_PROGRESS_EVENT = 'engine-progress';

/** 게임 창 상태가 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 GAME_WINDOW_EVENT). */
export const GAME_WINDOW_EVENT = 'game-window';

/** 단축키(Alt+Shift+S)로 게임 화면을 저장한 결과를 Rust가 보내는 이벤트 이름(GAME_CAPTURE_EVENT). */
export const GAME_CAPTURE_EVENT = 'game-capture';

/** 요격전 화면 자동 추적의 결과가 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 SCREEN_TRACK_EVENT). */
export const SCREEN_TRACK_EVENT = 'screen-track';

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

/**
 * 도는 엔진 배치를 멈춘다. 멈출 배치가 있었으면 true — 그 배치의 `engineRunBatch`가 '중단됨' 오류로 거부된다.
 * 도는 배치가 없으면 Rust는 아무 일도 하지 않고 false를 돌려준다.
 */
export function engineCancel(): Promise<boolean> {
  return invoke<boolean>('engine_cancel');
}

/** JSON 파일(계정 상태·전투 조건·후보 편성)을 읽는다. 실패하면 한국어 오류 문장으로 거부된다. */
export function readJsonFile(path: string): Promise<unknown> {
  return invoke<unknown>('read_json_file', { path });
}

/** 파일 고르기 창으로 JSON 파일 하나를 고른다. 취소하면 null. */
export function pickJsonFile(title: string): Promise<string | null> {
  return invoke<string | null>('pick_json_file', { title });
}

/** 게임 창의 현재 상태(찾음/없음/최소화/런처만, 화면 영역)와 붙이기 여부. */
export function gameWindowStatus(): Promise<GameSnapshot> {
  return invoke<GameSnapshot>('game_window_status');
}

/** 붙이기를 켜거나 끈다. 켜면 오버레이가 게임 창의 오른쪽 위 안쪽에서 게임 창을 따라다닌다. */
export function setFollowGame(enabled: boolean): Promise<GameSnapshot> {
  return invoke<GameSnapshot>('set_follow_game', { enabled });
}

/** 지금 게임 화면을 PNG로 저장한다. 저장할 폴더는 Rust가 정한다. 실패하면 한국어 오류 문장으로 거부된다. */
export function captureGame(label: string | null = null): Promise<CaptureRecord> {
  return invoke<CaptureRecord>('capture_game', { label });
}

/**
 * 지금 게임 화면이 이상 개체 요격전의 어느 화면인지, 어느 보스가 선택됐는지 알아낸다.
 * Rust가 게임 창을 찍어 인식만 하고 결과만 돌려준다 — 이미지는 저장하지도 화면에 넘기지도 않는다.
 * 게임이 없거나 최소화돼 있으면 한국어 오류 문장으로 거부된다.
 */
export function recognizeGameScreen(): Promise<ScreenRecognition> {
  return invoke<ScreenRecognition>('recognize_game_screen');
}

/**
 * 요격전 화면 자동 추적을 켜거나 끄고 주기(밀리초)를 정한다. 지금 상태를 돌려준다.
 * 켜 두면 Rust가 주기마다 게임 화면을 찍어 인식만 하고(이미지는 저장하지도 넘기지도 않는다),
 * 결과가 바뀔 때 `screen-track` 이벤트를 보낸다. 주기는 Rust가 0.5~60초로 맞춘다.
 */
export function setScreenTracking(enabled: boolean, intervalMs: number | null = null): Promise<ScreenTrackStatus> {
  return invoke<ScreenTrackStatus>('set_screen_tracking', { enabled, intervalMs });
}

/** 자동 추적의 지금 상태(마지막으로 읽은 시각·근거 포함). 캡처하지 않는다 — 추적 스레드가 남긴 것을 읽을 뿐이다. */
export function screenTrackStatus(): Promise<ScreenTrackStatus> {
  return invoke<ScreenTrackStatus>('screen_track_status');
}

/** 자동 추적의 결과(켜짐·상태·인식한 화면과 보스)가 바뀔 때마다 불린다. 돌려받은 함수로 구독을 끊는다. */
export function onScreenTrack(handler: (status: ScreenTrackStatus) => void): Promise<UnlistenFn> {
  return listen<ScreenTrackStatus>(SCREEN_TRACK_EVENT, (event) => handler(event.payload));
}

/** 게임 창 상태가 바뀔 때마다 불린다. 돌려받은 함수로 구독을 끊는다. */
export function onGameWindow(handler: (snapshot: GameSnapshot) => void): Promise<UnlistenFn> {
  return listen<GameSnapshot>(GAME_WINDOW_EVENT, (event) => handler(event.payload));
}

/** 단축키로 게임 화면을 저장할 때마다 결과(캡처 또는 오류)와 함께 불린다. */
export function onGameCapture(handler: (outcome: GameCaptureOutcome) => void): Promise<UnlistenFn> {
  return listen<GameCaptureOutcome>(GAME_CAPTURE_EVENT, (event) => handler(event.payload));
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
