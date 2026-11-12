// Rust 쪽(src-tauri)과 주고받는 곳은 여기뿐이다. 화면 코드는 Tauri API를 직접 부르지 않는다.
// 이 앱은 네트워크 요청을 하지 않는다. 밖으로 나가는 통로는 Tauri IPC(invoke·이벤트)뿐이다
// (tests/contract.test.ts가 프런트 코드에 네트워크 API가 없는지 확인한다).

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  AccountRead,
  CaptureRecord,
  CompareReport,
  ComputeActivity,
  CookieSaved,
  EngineCatalog,
  EngineProgress,
  EngineRequest,
  EngineRow,
  EngineVersion,
  ExtensionLinkStatus,
  FetchedProfile,
  FetchLine,
  FetchOutcome,
  GameCaptureOutcome,
  GameImage,
  GameSnapshot,
  IconKind,
  InterceptReport,
  OverlayLaunch,
  OverlayPrefs,
  OverlayShape,
  OverlaySnapshot,
  SavedAccount,
  ScreenRecognition,
  ScreenTrackStatus,
  SharedSnapshot,
  SyncFailure,
  SyncStatus,
  WidgetSnapshot,
} from '../types';

/** 오버레이 창의 이름(src-tauri/tauri.conf.json의 label). 게임 위에 뜨는 작은 창이다. */
export const OVERLAY_WINDOW = 'main';

/** 데스크톱 앱 창의 이름(src-tauri/tauri.conf.json의 label). */
export const APP_WINDOW = 'app';

/**
 * 이 화면이 그려지는 창의 이름('main' 오버레이 · 'app' 데스크톱 앱). 앱 밖(브라우저의 개발 서버, 테스트)에서는 null.
 * Rust를 부르지 않는다 — 창이 만들어질 때 받은 값을 읽을 뿐이다.
 */
export function windowLabel(): string | null {
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

/** 두 창이 함께 보는 것이 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 SHARED_STATE_EVENT). */
export const SHARED_STATE_EVENT = 'shared-state';

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

/** 계정 수집 스크립트가 줄을 낼 때마다 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 ACCOUNT_FETCH_EVENT). */
export const ACCOUNT_FETCH_EVENT = 'account-fetch';

/** 크롬 확장 연결의 상태가 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 EXTENSION_LINK_EVENT). */
export const EXTENSION_LINK_EVENT = 'extension-link';

/** 오버레이 위젯의 상태(모양·핀·쉬는 중·설정)가 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 OVERLAY_WIDGET_EVENT). */
export const OVERLAY_WIDGET_EVENT = 'overlay-widget';

/** 앱 창이 알린 계산 진행이 바뀔 때 Rust가 보내는 이벤트 이름(src-tauri/src/lib.rs의 COMPUTE_ACTIVITY_EVENT). */
export const COMPUTE_ACTIVITY_EVENT = 'compute-activity';

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

// ── 계정 받기 ─────────────────────────────────────────────────────────────────
// 세션 쿠키는 계정 접근권이다. 화면에서 Rust로 가는 것은 붙여넣은 글자 한 번뿐이고(accountSaveCookie),
// Rust에서 화면으로 오는 것에는 쿠키가 없다 — 저장한 시각·개수, 가려진 진행 줄, 한국어 오류뿐이다.
// 아래 명령들은 실패하면 `SyncFailure`(종류·문장·쿠키를 다시 받아야 하는지)로 거부된다 — `syncFailure`로 읽는다.

/** 계정 받기의 지금 상태: 쿠키 파일이 있는지(내용은 오지 않는다), 마지막으로 받은 시각, 엔진 폴더·python 문제. */
export function accountSyncStatus(name: string | null = null): Promise<SyncStatus> {
  return invoke<SyncStatus>('account_sync_status', { name });
}

/**
 * 붙여넣은 쿠키를 Rust에 넘겨 엔진의 쿠키 파일에 쓰게 한다. Rust가 한 줄로 정리하고, 필수 쿠키가 없으면 거부한다.
 * 돌아오는 것은 저장한 시각과 개수뿐이다. 넘긴 글자는 화면 쪽 어디에도 남기지 않는다(부르는 쪽이 입력 칸을 비운다).
 */
export function accountSaveCookie(cookie: string): Promise<CookieSaved> {
  return invoke<CookieSaved>('account_save_cookie', { cookie });
}

/**
 * 엔진의 수집 스크립트로 프로필을 받는다(blablalink에 요청이 나간다 — 저장된 쿠키로, 엔진 스크립트가).
 * 화면이 정하는 것은 이름뿐이다. 도는 동안 `account-fetch` 이벤트로 줄이 오고, 끝나면 모든 줄과 경고가 온다.
 */
export function accountFetchProfile(name: string): Promise<FetchOutcome> {
  return invoke<FetchOutcome>('account_fetch_profile', { name });
}

/** 도는 계정 수집을 멈춘다. 멈출 수집이 있었으면 true — 그 수집의 `accountFetchProfile`이 '중단됨'으로 거부된다. */
export function accountFetchCancel(): Promise<boolean> {
  return invoke<boolean>('account_fetch_cancel');
}

/** 받은 프로필과 변환에 쓸 엔진의 오버로드 옵션 표를 읽는다. */
export function accountReadProfile(name: string): Promise<FetchedProfile> {
  return invoke<FetchedProfile>('account_read_profile', { name });
}

/** 계정 상태 문서를 계정 폴더의 `<이름>.json`에 쓴다. 폴더는 Rust가 정하고, 있던 파일은 `.bak`으로 한 벌 남는다. */
export function accountSaveFile(name: string, account: unknown): Promise<SavedAccount> {
  return invoke<SavedAccount>('account_save_file', { name, account });
}

/** blablalink 로그인 창을 연다(별도 창 — 로그인은 그 페이지에서 사용자가 직접 한다). */
export function loginWindowOpen(): Promise<void> {
  return invoke<void>('login_window_open');
}

/**
 * 로그인 창의 쿠키를 Rust가 읽어 엔진의 쿠키 파일에 쓰고 창을 닫는다. 쿠키 값은 화면으로 오지 않는다.
 * 아직 로그인하지 않았으면 `not_logged_in`으로 거부되고 창은 그대로다.
 */
export function loginWindowTakeCookie(): Promise<CookieSaved> {
  return invoke<CookieSaved>('login_window_take_cookie');
}

/** 로그인 창의 세션(쿠키·저장 데이터)을 지운다. 한 일을 알리는 문장이 온다. */
export function loginWindowClear(): Promise<string> {
  return invoke<string>('login_window_clear');
}

// ── 크롬 확장 연결 ────────────────────────────────────────────────────────────
// 이 PC의 크롬 확장이 넘기는 세션 쿠키는 Rust의 수신부가 받아 엔진의 쿠키 파일에 쓴다 — 쿠키는 화면을 지나가지 않는다.
// 화면이 보는 것은 상태(켜짐·주소·연결 코드·마지막 요청의 결과)뿐이고, 화면이 정하는 것은 켜짐과 「코드 다시 만들기」뿐이다.

/** 크롬 확장 연결의 지금 상태. 쿠키는 오지 않는다. */
export function extensionLinkStatus(): Promise<ExtensionLinkStatus> {
  return invoke<ExtensionLinkStatus>('extension_link_status');
}

/** 크롬 확장 연결을 켜거나 끈다. 켜면 Rust가 이 PC 안에서만 닿는 주소에서 듣기 시작하고, 끄면 닫는다. Rust가 기억한다. */
export function extensionLinkSet(enabled: boolean): Promise<ExtensionLinkStatus> {
  return invoke<ExtensionLinkStatus>('extension_link_set', { enabled });
}

/** 연결 코드를 다시 만든다. 옛 코드는 그 순간부터 받지 않는다 — 확장에 새 코드를 넣어야 한다. */
export function extensionLinkNewCode(): Promise<ExtensionLinkStatus> {
  return invoke<ExtensionLinkStatus>('extension_link_new_code');
}

/** 확장에서 쿠키를 받아 「계정 새로 받기」를 이을 차례면 true(한 번만). */
export function extensionLinkTakePending(): Promise<boolean> {
  return invoke<boolean>('extension_link_take_pending');
}

// ── 게임 이미지 ───────────────────────────────────────────────────────────────
// 화면에는 파일·네트워크 권한이 없다. 초상화·보스 이미지·아이콘은 Rust가 이 PC의 정해진 폴더에서 읽어 넘긴다.
// 넘기는 이름·id·종류는 경로가 아니다 — Rust가 엔진 카탈로그·보스 묶음·아이콘 표에 있는 것일 때만 읽는다.
// 없는 이미지는 거부가 아니라 `found: false`로 온다. 화면 코드는 lib/images.ts(주소로 바꾸고 기억해 둔다)를 쓴다.

/** 니케 초상화. 엔진 카탈로그에 있는 이름일 때만 읽힌다. */
export function nikkePortrait(name: string): Promise<GameImage> {
  return invoke<GameImage>('nikke_portrait', { name });
}

/** 보스 이미지. 내장 보스 묶음에 있는 id일 때만 읽힌다(받아 둔 리소스 → 캡처에서 잘라 둔 조각). */
export function bossImage(id: string): Promise<GameImage> {
  return invoke<GameImage>('boss_image', { id });
}

/** 아이콘(속성·버스트 단계·클래스·기업·무기). 값은 엔진 카탈로그의 낱말 그대로 넘긴다. */
export function gameIcon(kind: IconKind, key: string): Promise<GameImage> {
  return invoke<GameImage>('game_icon', { kind, key });
}

// ── 두 창이 함께 보는 것 ──────────────────────────────────────────────────────
// 기본 계정·오버레이를 띄우는 때·마지막 요격전 추천 결과는 Rust가 계정 폴더에 둔다(src-tauri/src/shared_state.rs).
// 화면이 넘기는 계정 이름은 경로가 아니다 — Rust가 계정 폴더의 그 이름만 읽는다.

/** 두 창이 함께 보는 것의 지금 상태(기본 계정·계정 목록·오버레이를 띄우는 때·마지막 결과를 저장한 시각). */
export function sharedState(): Promise<SharedSnapshot> {
  return invoke<SharedSnapshot>('shared_state');
}

/** 기본 계정을 정한다. 그 이름의 계정이 없으면 한국어 오류 문장으로 거부된다. */
export function setDefaultAccount(name: string): Promise<SharedSnapshot> {
  return invoke<SharedSnapshot>('set_default_account', { name });
}

/** 오버레이를 언제 띄울지 정한다. */
export function setOverlayLaunch(mode: OverlayLaunch): Promise<SharedSnapshot> {
  return invoke<SharedSnapshot>('set_overlay_launch', { mode });
}

/** 계정 하나를 읽는다. 이름을 주지 않으면 지금 쓰는 계정이다. 없으면 한국어 오류 문장으로 거부된다. */
export function readAccount(name: string | null = null): Promise<AccountRead> {
  return invoke<AccountRead>('read_account', { name });
}

/** 요격전 추천 결과를 저장하고 모든 창에 알린다. 종류·판이 맞지 않으면 거부되고 앞서 저장한 것은 그대로다. */
export function saveInterceptResult(report: InterceptReport): Promise<SharedSnapshot> {
  return invoke<SharedSnapshot>('save_intercept_result', { report });
}

/** 저장해 둔 마지막 요격전 추천 결과. 없으면 null. 읽을 수 없으면 한국어 오류 문장으로 거부된다. */
export function loadInterceptResult(): Promise<unknown | null> {
  return invoke<unknown | null>('load_intercept_result');
}

/** 데스크톱 앱 창을 앞으로 가져온다(오버레이의 「앱 열기」). */
export function showAppWindow(): Promise<void> {
  return invoke<void>('show_app_window');
}

/** 오버레이 창을 보이거나 숨긴다(활성화하지 않는다). 바뀐 오버레이 상태가 온다. */
export function setOverlayVisible(visible: boolean): Promise<OverlaySnapshot> {
  return invoke<OverlaySnapshot>('set_overlay_visible', { visible });
}

// ── 오버레이 위젯(P-028) ──────────────────────────────────────────────────────
// 오버레이 창이 부르는 것은 읽기(위젯 상태·계산 진행)와 자기 창의 조작(모양·핀·창 크기 맞춤·숨기기·끌기)뿐이다.
// 설정을 바꾸고 자리를 초기화하고 계산 진행을 알리는 것은 데스크톱 앱 창의 일이다 — 권한(capabilities)이 그렇게 나뉘어 있다.

/** 위젯의 지금 상태(모양·핀·쉬는 중·설정). */
export function overlayWidget(): Promise<WidgetSnapshot> {
  return invoke<WidgetSnapshot>('overlay_widget');
}

/** 위젯의 모양을 정한다. 'next'면 다음 모양으로(접힘 → 한 줄 카드 → 펼침 → 접힘). */
export function overlayShape(shape: OverlayShape | 'next'): Promise<WidgetSnapshot> {
  return invoke<WidgetSnapshot>('overlay_shape', { shape });
}

/** 핀으로 고정하거나 푼다. 고정해 두면 이상 개체 화면을 떠나도 접히거나 쉬지 않는다. */
export function overlayPin(pinned: boolean): Promise<WidgetSnapshot> {
  return invoke<WidgetSnapshot>('overlay_pin', { pinned });
}

/**
 * 오버레이 창의 크기를 위젯에 맞춘다(화면이 잰 위젯의 크기 — 논리 픽셀). 창이 위젯보다 크면 빈 투명 영역이
 * 게임 클릭을 가로막는다. 화면이 정하는 것은 크기뿐이다 — 자리는 Rust가 정한다(붙어 있는 모서리를 제자리에 둔다).
 */
export function overlayFit(width: number, height: number): Promise<void> {
  return invoke<void>('overlay_fit', { width, height });
}

/** 오버레이를 숨긴다(앱은 끝나지 않는다 — 앱 창이나 단축키로 다시 띄운다). 바뀐 오버레이 상태가 온다. */
export function overlayHide(): Promise<OverlaySnapshot> {
  return invoke<OverlaySnapshot>('overlay_hide');
}

/** 오버레이 창을 끌기 시작한다(마우스 단추를 누른 채 움직였을 때). 옮기는 것은 이 창뿐이다. */
export function startOverlayDrag(): Promise<void> {
  return getCurrentWindow().startDragging();
}

/** 오버레이 설정을 바꾼다(바꿀 칸만 넘긴다). 수는 Rust가 범위 안으로 맞추고, 모르는 낱말은 한국어로 거부한다. */
export function setOverlayPrefs(prefs: Partial<OverlayPrefs>): Promise<WidgetSnapshot> {
  return invoke<WidgetSnapshot>('set_overlay_prefs', { prefs });
}

/** 끌어 둔 자리를 잊고 기본 자리로 되돌린다. */
export function resetOverlayPosition(): Promise<WidgetSnapshot> {
  return invoke<WidgetSnapshot>('reset_overlay_position');
}

/** 요격전 추천 계산의 진행을 알린다(오버레이가 작게 보여 준다). 계산을 시작하거나 멈추는 명령이 아니다. */
export function announceActivity(activity: ComputeActivity): Promise<ComputeActivity> {
  return invoke<ComputeActivity>('announce_activity', { activity });
}

/** 앱 창이 마지막으로 알린 계산 진행. */
export function computeActivity(): Promise<ComputeActivity> {
  return invoke<ComputeActivity>('compute_activity');
}

/** 위젯 상태가 바뀔 때마다 불린다(단축키·자동 표시·설정 변경). 돌려받은 함수로 구독을 끊는다. */
export function onOverlayWidget(handler: (snapshot: WidgetSnapshot) => void): Promise<UnlistenFn> {
  return listen<WidgetSnapshot>(OVERLAY_WIDGET_EVENT, (event) => handler(event.payload));
}

/** 앱 창이 알린 계산 진행이 바뀔 때마다 불린다. 돌려받은 함수로 구독을 끊는다. */
export function onComputeActivity(handler: (activity: ComputeActivity) => void): Promise<UnlistenFn> {
  return listen<ComputeActivity>(COMPUTE_ACTIVITY_EVENT, (event) => handler(event.payload));
}

/** 두 창이 함께 보는 것이 바뀔 때마다 불린다(다른 창이 바꿨을 때도). 돌려받은 함수로 구독을 끊는다. */
export function onSharedState(handler: (snapshot: SharedSnapshot) => void): Promise<UnlistenFn> {
  return listen<SharedSnapshot>(SHARED_STATE_EVENT, (event) => handler(event.payload));
}

/** 크롬 확장 연결의 상태가 바뀔 때마다 불린다(쿠키를 받았다·코드가 틀린 요청이 왔다). 돌려받은 함수로 구독을 끊는다. */
export function onExtensionLink(handler: (status: ExtensionLinkStatus) => void): Promise<UnlistenFn> {
  return listen<ExtensionLinkStatus>(EXTENSION_LINK_EVENT, (event) => handler(event.payload));
}

/** 계정 수집 스크립트가 줄을 낼 때마다 불린다(쿠키 값은 가려져 있다). 돌려받은 함수로 구독을 끊는다. */
export function onAccountFetch(handler: (line: FetchLine) => void): Promise<UnlistenFn> {
  return listen<FetchLine>(ACCOUNT_FETCH_EVENT, (event) => handler(event.payload));
}

/** 계정 받기 명령이 거부한 값을 `SyncFailure`로. Rust가 준 것이 아니면(IPC 오류 등) 종류 없는 실패로 감싼다. */
export function syncFailure(e: unknown): SyncFailure {
  if (e !== null && typeof e === 'object' && typeof (e as SyncFailure).kind === 'string' && typeof (e as SyncFailure).message === 'string') {
    const f = e as Partial<SyncFailure> & Pick<SyncFailure, 'kind' | 'message'>;
    return { kind: f.kind, message: f.message, cookie_help: f.cookie_help === true, lines: f.lines ?? [], warnings: f.warnings ?? [] };
  }
  return { kind: 'unknown', message: errorMessage(e), cookie_help: false, lines: [], warnings: [] };
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
