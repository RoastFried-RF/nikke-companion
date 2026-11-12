// 프런트와 Rust 쪽이 맞물리는 곳, 그리고 "쓰는 것만 허용한다·네트워크를 쓰지 않는다"는 약속의 정적 확인.
import { INTERCEPT_REPORT_SCHEMA_VERSION } from '@core/intercept.mjs';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_FETCH_EVENT,
  accountFetchCancel,
  accountFetchProfile,
  accountReadProfile,
  accountSaveCookie,
  accountSaveFile,
  accountSyncStatus,
  announceActivity,
  bossImage,
  captureGame,
  COMPUTE_ACTIVITY_EVENT,
  computeActivity,
  loadPlan,
  savePlan,
  loadDecks,
  saveDecks,
  copyText,
  ENGINE_PROGRESS_EVENT,
  engineCancel,
  engineCatalog,
  engineRunBatch,
  engineVersion,
  errorMessage,
  EXTENSION_LINK_EVENT,
  extensionLinkNewCode,
  extensionLinkSet,
  extensionLinkStatus,
  extensionLinkTakePending,
  GAME_CAPTURE_EVENT,
  GAME_WINDOW_EVENT,
  gameIcon,
  gameWindowStatus,
  loadReport,
  loginWindowClear,
  loginWindowOpen,
  loginWindowTakeCookie,
  nikkePortrait,
  overlayFit,
  overlayHide,
  overlayPin,
  overlayShape,
  overlayStatus,
  overlayWidget,
  OVERLAY_STATE_EVENT,
  OVERLAY_WIDGET_EVENT,
  pickJsonFile,
  readAccount,
  readJsonFile,
  recognizeGameScreen,
  resetOverlayPosition,
  saveInterceptResult,
  SCREEN_TRACK_EVENT,
  screenTrackStatus,
  setDefaultAccount,
  setFollowGame,
  setOverlayLaunch,
  setOverlayPrefs,
  setOverlayVisible,
  setScreenTracking,
  SHARED_STATE_EVENT,
  sharedState,
  showAppWindow,
  loadInterceptResult,
  startupReportPath,
  syncFailure,
} from '../src/lib/backend';
import appCapability from '../src-tauri/capabilities/app.json';
import capability from '../src-tauri/capabilities/overlay.json';
import tauriConf from '../src-tauri/tauri.conf.json';
import buildRs from '../src-tauri/build.rs?raw';
import cargoToml from '../src-tauri/Cargo.toml?raw';
import accountSyncRs from '../src-tauri/src/account_sync.rs?raw';
import captureRs from '../src-tauri/src/capture.rs?raw';
import captureCliRs from '../src-tauri/src/capture_cli.rs?raw';
import clipboardRs from '../src-tauri/src/clipboard.rs?raw';
import cookieRs from '../src-tauri/src/cookie.rs?raw';
import engineRs from '../src-tauri/src/engine.rs?raw';
import engineWin32Rs from '../src-tauri/src/engine_win32.rs?raw';
import extensionLinkRs from '../src-tauri/src/extension_link.rs?raw';
import gameWin32Rs from '../src-tauri/src/game_win32.rs?raw';
import gameWindowRs from '../src-tauri/src/game_window.rs?raw';
import libRs from '../src-tauri/src/lib.rs?raw';
import loginWindowRs from '../src-tauri/src/login_window.rs?raw';
import overlayStateRs from '../src-tauri/src/overlay_state.rs?raw';
import overlayStoreRs from '../src-tauri/src/overlay_store.rs?raw';
import overlayWidgetRs from '../src-tauri/src/overlay_widget.rs?raw';
import overlayWin32Rs from '../src-tauri/src/overlay_win32.rs?raw';
import recognizeRs from '../src-tauri/src/recognize.rs?raw';
import screenTrackRs from '../src-tauri/src/screen_track.rs?raw';
import sharedStateRs from '../src-tauri/src/shared_state.rs?raw';
import stayOnTopRs from '../src-tauri/src/stay_on_top.rs?raw';
import gitignore from '../../.gitignore?raw';
import formatSource from '../src/lib/format.ts?raw';

const sources = import.meta.glob<string>(['../src/**/*.{ts,vue,css}', '../index.html'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** 앱의 Rust 소스 전부(src-tauri/src — 명령줄 도구 포함, 통합 테스트 제외). */
const allRust = import.meta.glob<string>('../src-tauri/src/**/*.rs', {
  query: '?raw',
  import: 'default',
  eager: true,
});

afterEach(() => clearMocks());

/**
 * 화면이 부르는 앱 명령.
 * P-028: 넷째 자리에 있던 끝내기(`quit_app`)를 없앴다 — 오버레이 위젯에는 끝내기가 없고(숨기기만 있다) 앱은 앱 창을 닫아 끝낸다.
 * 그 자리에는 위젯 상태 읽기(`overlay_widget`)를 두었고, 위젯의 나머지 명령 여덟은 끝에 더했다.
 */
const COMMANDS = [
  'load_report',
  'overlay_status',
  'startup_report_path',
  'overlay_widget',
  'engine_catalog',
  'engine_version',
  'engine_run_batch',
  'read_json_file',
  'pick_json_file',
  'game_window_status',
  'set_follow_game',
  'capture_game',
  'engine_cancel',
  'recognize_game_screen',
  'set_screen_tracking',
  'screen_track_status',
  'account_sync_status',
  'account_save_cookie',
  'account_fetch_profile',
  'account_fetch_cancel',
  'account_read_profile',
  'account_save_file',
  'login_window_open',
  'login_window_take_cookie',
  'login_window_clear',
  'extension_link_status',
  'extension_link_set',
  'extension_link_new_code',
  'extension_link_take_pending',
  'nikke_portrait',
  'boss_image',
  'game_icon',
  'shared_state',
  'set_default_account',
  'set_overlay_launch',
  'read_account',
  'save_intercept_result',
  'load_intercept_result',
  'show_app_window',
  'set_overlay_visible',
  'overlay_shape',
  'overlay_pin',
  'overlay_fit',
  'overlay_hide',
  'set_overlay_prefs',
  'reset_overlay_position',
  'announce_activity',
  'compute_activity',
  // P-029: 요격전 계획(손으로 적은 요격전 기록·즐겨찾기)을 계정 폴더에 두고 읽는 명령 둘 — 데스크톱 앱 창의 것이다.
  'load_plan',
  'save_plan',
  // P-030: 덱 빌더 — 저장한 편성(번호 칸 다섯과 이름 붙인 목록)을 계정 폴더에 두고 읽는 명령 둘, 편성을 글자로 클립보드에 쓰는 명령 하나.
  // 셋 다 데스크톱 앱 창의 것이다.
  'load_decks',
  'save_decks',
  'copy_text',
];

/**
 * 오버레이 창(main)이 부를 수 있는 명령 — 결과·상태 읽기와 자기 창의 조작뿐이다(P-027·P-028). 나머지는 데스크톱 앱 창(app)의 것이다.
 * 읽기: 오버레이 상태·위젯 상태·공유 상태·마지막 요격전 결과·추적 상태·계산 진행·니케 정보·이미지 셋.
 * 창 조작: 앱 창 열기·위젯 모양·핀·창 크기 맞춤·숨기기.
 */
const OVERLAY_COMMANDS = [
  'overlay_status',
  'overlay_widget',
  'overlay_shape',
  'overlay_pin',
  'overlay_fit',
  'overlay_hide',
  'show_app_window',
  'shared_state',
  'load_intercept_result',
  'screen_track_status',
  'compute_activity',
  'engine_catalog',
  'nikke_portrait',
  'boss_image',
  'game_icon',
];
/** 데스크톱 앱 창이 부르지 않는 명령: 앱 창 열기(자기 자신이다)와 오버레이 창의 것(위젯의 모양·핀·창 크기 맞춤·숨기기, 계산 진행 읽기). */
const NOT_FOR_APP = ['show_app_window', 'overlay_shape', 'overlay_pin', 'overlay_fit', 'overlay_hide', 'compute_activity'];
/** 오버레이 창이 부르지 못하는 위젯 명령: 설정 바꾸기·자리 초기화·계산 진행 알리기는 데스크톱 앱 창의 일이다. */
const WIDGET_APP_ONLY = ['set_overlay_prefs', 'reset_overlay_position', 'announce_activity'];

/** 계정 받기(P-022)에서 더한 명령 아홉 개. */
const ACCOUNT_COMMANDS = COMMANDS.slice(16, 25);
/** 크롬 확장 연결(P-025)에서 더한 명령 네 개. */
const EXTENSION_COMMANDS = COMMANDS.slice(25, 29);
/** 게임 이미지(P-026)에서 더한 명령 세 개. */
const IMAGE_COMMANDS = COMMANDS.slice(29, 32);
/** 두 창이 함께 보는 것·창 열기와 보이기(P-027)에서 더한 명령 여덟 개. */
const SHARED_COMMANDS = COMMANDS.slice(32, 40);
/** 오버레이 위젯(P-028)에서 더한 명령 아홉 개. */
const WIDGET_COMMANDS = [COMMANDS[3], ...COMMANDS.slice(40, 48)];
/** 요격전 계획(P-029)에서 더한 명령 두 개. */
const PLAN_COMMANDS = COMMANDS.slice(48, 50);
/** 덱 빌더(P-030)에서 더한 명령 세 개. */
const DECK_COMMANDS = COMMANDS.slice(50);
/** 내 편성(P-030) — 지어낸 편성 한 벌. */
const deckBook = {
  schema_version: 1,
  kind: 'deck_book',
  slots: [{ name: '편성 01', members: ['크라운', '헬름', null, null, null], opponent: 'boss:kraken', opponent_label: '크라켄', total_damage: null, saved_at: null }, null, null, null, null],
  saved: [],
};
/** 복사할 글(지어낸 값). */
const deckCopy = '편성: 1. 크라운 / 2. 헬름\n상대: 크라켄 (약점 풍압)\n총딜 계산 전';
/** 위젯 상태·계산 진행(지어낸 값). */
const widgetSnapshot = {
  shape: 'card',
  pinned: false,
  resting: false,
  prefs: { scale_percent: 100, opacity_percent: 100, leave: 'collapse', leave_after_sec: 8, default_shape: 'card', click_through: false },
  problem: null,
};
const activity = { running: true, label: '크라켄 추천 편성을 찾는 중', done: 12, total: 60, elapsed_ms: 15000 };
/** 요격전 계획(P-029) — 지어낸 기록 한 건. */
const planDoc = {
  schema_version: 1,
  kind: 'intercept_plan',
  favorites: ['크라운'],
  records: [{ id: 'r1', boss_id: 'kraken', boss_name: '크라켄', damage: 900000000, mode: 'mock' as const, date: '2026-11-12', stage: 4, note: null, created_at: null }],
};
/** 공유 상태(지어낸 값). 계정의 내용과 결과 문서는 싣지 않는다. */
const sharedSnapshot = {
  default_account: 'me',
  remembered: true,
  accounts: [{ name: 'me', modified_at: '2026-11-12T06:00:00.000Z' }],
  overlay_launch: 'with_app',
  intercept_saved_at: null,
  problems: [],
};
/** 없는 이미지(지어낸 값). 이미지 명령은 없는 이미지를 거부하지 않고 이렇게 돌려준다. */
const missingImage = { found: false, mime: null, data: null, source: null };
/** 크롬 확장 연결의 상태(지어낸 값). 쿠키는 없다 — 연결 코드는 쿠키가 아니다. */
const linkStatus = {
  enabled: true,
  listening: true,
  address: '127.0.0.1:47615',
  code: 'ABCD-2345',
  problem: null,
  pending: false,
  last: null,
  locked_seconds: 0,
};

/** 지어낸 쿠키. 실제 계정의 값이 아니다. */
const FAKE_COOKIE = 'game_token=FAKE-TOKEN-contract-0123456789; game_openid=55554444333322221111';
const syncStatus = {
  name: 'me',
  cookie_saved: true,
  cookie_saved_at: '2026-11-12T06:00:00.000Z',
  profile_fetched_at: null,
  account_file: null,
  login_window_open: false,
  problems: [],
};
const cookieSaved = { saved_at: '2026-11-12T06:00:00.000Z', count: 2 };
const fetchOutcome = {
  name: 'me',
  profile_path: 'D:\\engine\\profiles\\me.json',
  fetched_at: '2026-11-12T06:01:00.000Z',
  lines: [{ text: '[+] 프로필 저장: profiles/me.json  (6종)', warning: false }],
  warnings: [],
  seconds: 12.5,
};
const fetchedProfile = { path: 'D:\\engine\\profiles\\me.json', profile: { chars: {} }, option_table: {} };
const savedAccount = { path: 'D:\\repo\\data\\accounts\\me.json', backup: null };

const gameWindow = {
  hwnd: 1,
  pid: 2,
  process_name: 'nikke.exe',
  title: 'NIKKE',
  client: { x: 1, y: 31, width: 1920, height: 1080 },
  frame: { x: 0, y: 0, width: 1922, height: 1112 },
  minimized: false,
  foreground: false,
  scale_factor: 1,
};
const gameSnapshot = { state: 'found', window: gameWindow, message: '게임 창을 찾았다 (1920×1080)', follow: false };
const captureRecord = {
  path: 'D:\\captures\\20261112-054148-988.png',
  width: 1920,
  height: 1080,
  captured_at: '2026-11-11T20:41:48.988Z',
  method: 'wgc',
  window: gameWindow,
};
const recognition = {
  screen: 'anomaly_select',
  boss: { id: 'kraken', name: '크라켄' },
  confidence: 0.97,
  evidence: ['아래 띠 주황 100%(화면 맨 아래 가장자리)', '→ 이상 개체 보스 선택 화면, 보스 크라켄(테마 색 주황)'],
  width: 1881,
  height: 1058,
};
const trackStatus = {
  enabled: true,
  interval_ms: 2000,
  state: 'read',
  message: '이상 개체 요격전 보스 선택 화면 — 크라켄',
  recognition,
  read_at: '2026-11-12T05:00:00.000Z',
  capture_ms: 64,
  failures: 0,
};

describe('Rust 명령 호출', () => {
  it('명령 이름과 인자가 Rust 쪽과 같다', async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'load_report') return { schema_version: 1 };
      if (cmd === 'overlay_status') return { visible: true, click_through: false, shortcut_problems: [] };
      if (cmd === 'engine_catalog') return { nikkes: {}, bosses: [] };
      if (cmd === 'engine_version') return { repo: 'Jgaram/nikke-calc', commit: null };
      if (cmd === 'engine_run_batch') return [{ id: 0, total_damage: 1 }];
      if (cmd === 'read_json_file') return { schema_version: 1 };
      if (cmd === 'game_window_status') return gameSnapshot;
      if (cmd === 'set_follow_game') return { ...gameSnapshot, follow: true };
      if (cmd === 'capture_game') return captureRecord;
      if (cmd === 'engine_cancel') return true;
      if (cmd === 'recognize_game_screen') return recognition;
      if (cmd === 'set_screen_tracking' || cmd === 'screen_track_status') return trackStatus;
      if (cmd === 'account_sync_status') return syncStatus;
      if (cmd === 'account_save_cookie' || cmd === 'login_window_take_cookie') return cookieSaved;
      if (cmd === 'account_fetch_profile') return fetchOutcome;
      if (cmd === 'account_fetch_cancel') return true;
      if (cmd === 'account_read_profile') return fetchedProfile;
      if (cmd === 'account_save_file') return savedAccount;
      if (cmd === 'login_window_clear') return '로그인 창의 쿠키·저장 데이터를 지웠다';
      if (cmd === 'extension_link_status' || cmd === 'extension_link_set' || cmd === 'extension_link_new_code') return linkStatus;
      if (cmd === 'extension_link_take_pending') return true;
      if (cmd === 'nikke_portrait' || cmd === 'boss_image' || cmd === 'game_icon') return missingImage;
      if (['shared_state', 'set_default_account', 'set_overlay_launch', 'save_intercept_result'].includes(cmd)) return sharedSnapshot;
      if (cmd === 'read_account') return { name: 'me', modified_at: null, account: { schema_version: 1, nikkes: {} } };
      if (cmd === 'set_overlay_visible' || cmd === 'overlay_hide') return { visible: false, click_through: false, shortcut_problems: [] };
      if (['overlay_widget', 'overlay_shape', 'overlay_pin', 'set_overlay_prefs', 'reset_overlay_position'].includes(cmd)) return widgetSnapshot;
      if (cmd === 'announce_activity' || cmd === 'compute_activity') return activity;
      if (cmd === 'load_plan') return planDoc;
      if (cmd === 'load_decks') return deckBook;
      return null;
    });
    await expect(loadReport('D:\\r.json')).resolves.toEqual({ schema_version: 1 });
    await expect(overlayStatus()).resolves.toEqual({ visible: true, click_through: false, shortcut_problems: [] });
    await expect(startupReportPath()).resolves.toBeNull();
    await expect(overlayWidget()).resolves.toEqual(widgetSnapshot);
    await expect(engineCatalog()).resolves.toEqual({ nikkes: {}, bosses: [] });
    await expect(engineVersion()).resolves.toEqual({ repo: 'Jgaram/nikke-calc', commit: null });
    await expect(engineRunBatch([{ squad: ['크라운'] }])).resolves.toEqual([{ id: 0, total_damage: 1 }]);
    await expect(readJsonFile('D:\\a.json')).resolves.toEqual({ schema_version: 1 });
    await expect(pickJsonFile('계정 상태 파일 고르기')).resolves.toBeNull();
    await expect(gameWindowStatus()).resolves.toEqual(gameSnapshot);
    await expect(setFollowGame(true)).resolves.toEqual({ ...gameSnapshot, follow: true });
    await expect(captureGame()).resolves.toEqual(captureRecord);
    await expect(engineCancel()).resolves.toBe(true);
    await expect(recognizeGameScreen()).resolves.toEqual(recognition);
    await expect(setScreenTracking(true, 2000)).resolves.toEqual(trackStatus);
    await expect(screenTrackStatus()).resolves.toEqual(trackStatus);
    await expect(accountSyncStatus('me')).resolves.toEqual(syncStatus);
    await expect(accountSaveCookie(FAKE_COOKIE)).resolves.toEqual(cookieSaved);
    await expect(accountFetchProfile('me')).resolves.toEqual(fetchOutcome);
    await expect(accountFetchCancel()).resolves.toBe(true);
    await expect(accountReadProfile('me')).resolves.toEqual(fetchedProfile);
    await expect(accountSaveFile('me', { schema_version: 1, nikkes: {} })).resolves.toEqual(savedAccount);
    await expect(loginWindowOpen()).resolves.toBeNull();
    await expect(loginWindowTakeCookie()).resolves.toEqual(cookieSaved);
    await expect(loginWindowClear()).resolves.toBe('로그인 창의 쿠키·저장 데이터를 지웠다');
    await expect(extensionLinkStatus()).resolves.toEqual(linkStatus);
    await expect(extensionLinkSet(true)).resolves.toEqual(linkStatus);
    await expect(extensionLinkNewCode()).resolves.toEqual(linkStatus);
    await expect(extensionLinkTakePending()).resolves.toBe(true);
    await expect(nikkePortrait('크라운')).resolves.toEqual(missingImage);
    await expect(bossImage('kraken')).resolves.toEqual(missingImage);
    await expect(gameIcon('element', '작열')).resolves.toEqual(missingImage);
    await expect(sharedState()).resolves.toEqual(sharedSnapshot);
    await expect(setDefaultAccount('me')).resolves.toEqual(sharedSnapshot);
    await expect(setOverlayLaunch('with_game')).resolves.toEqual(sharedSnapshot);
    await expect(readAccount()).resolves.toEqual({ name: 'me', modified_at: null, account: { schema_version: 1, nikkes: {} } });
    await expect(saveInterceptResult({ schema_version: 1, kind: 'intercept_report' } as never)).resolves.toEqual(sharedSnapshot);
    await expect(loadInterceptResult()).resolves.toBeNull();
    await expect(showAppWindow()).resolves.toBeNull();
    await expect(setOverlayVisible(false)).resolves.toEqual({ visible: false, click_through: false, shortcut_problems: [] });
    await expect(overlayShape('next')).resolves.toEqual(widgetSnapshot);
    await expect(overlayPin(true)).resolves.toEqual(widgetSnapshot);
    await expect(overlayFit(440, 86)).resolves.toBeNull();
    await expect(overlayHide()).resolves.toEqual({ visible: false, click_through: false, shortcut_problems: [] });
    await expect(setOverlayPrefs({ scale_percent: 125, leave: 'hide' })).resolves.toEqual(widgetSnapshot);
    await expect(resetOverlayPosition()).resolves.toEqual(widgetSnapshot);
    await expect(announceActivity(activity)).resolves.toEqual(activity);
    await expect(computeActivity()).resolves.toEqual(activity);
    await expect(loadPlan()).resolves.toEqual(planDoc);
    await expect(savePlan(null, planDoc)).resolves.toBeNull();
    await expect(loadDecks()).resolves.toEqual(deckBook);
    await expect(saveDecks(null, deckBook)).resolves.toBeNull();
    await expect(copyText(deckCopy)).resolves.toBeNull();
    // 요격전 계획: 화면이 넘기는 것은 계정 이름(경로가 아니다 — 주지 않으면 지금 쓰는 계정)과 계획 문서뿐이다.
    expect(calls[48].args).toEqual({ name: null });
    expect(calls[49].args).toEqual({ name: null, plan: planDoc });
    // 덱 빌더: 화면이 넘기는 것은 계정 이름(경로가 아니다)·편성 묶음, 그리고 클립보드에 쓸 글자뿐이다.
    expect(calls[50].args).toEqual({ name: null });
    expect(calls[51].args).toEqual({ name: null, decks: deckBook });
    expect(calls[52].args).toEqual({ text: deckCopy });
    expect(calls.map((c) => c.cmd)).toEqual(COMMANDS);
    expect(WIDGET_COMMANDS).toHaveLength(9);
    expect(calls[0].args).toEqual({ path: 'D:\\r.json' });
    expect(calls[6].args).toEqual({ requests: [{ squad: ['크라운'] }] });
    expect(calls[7].args).toEqual({ path: 'D:\\a.json' });
    expect(calls[8].args).toEqual({ title: '계정 상태 파일 고르기' });
    expect(calls[10].args).toEqual({ enabled: true });
    expect(calls[11].args).toEqual({ label: null });
    // 화면 인식은 화면에서 받는 인자가 없다(무엇을 찍을지·어디에 둘지 화면이 정하지 못한다).
    expect(calls[13].args).toEqual({});
    // 자동 추적: 화면이 정하는 것은 켜짐과 주기뿐이다. 상태를 묻는 명령은 인자가 없다.
    expect(calls[14].args).toEqual({ enabled: true, intervalMs: 2000 });
    expect(calls[15].args).toEqual({});
    // 계정 받기: 화면이 넘기는 것은 이름, 붙여넣은 쿠키(한 번), 계정 문서뿐이다 — 실행할 스크립트나 폴더는 없다.
    expect(calls[16].args).toEqual({ name: 'me' });
    expect(calls[17].args).toEqual({ cookie: FAKE_COOKIE });
    expect(calls[18].args).toEqual({ name: 'me' });
    expect(calls[19].args).toEqual({});
    expect(calls[20].args).toEqual({ name: 'me' });
    expect(calls[21].args).toEqual({ name: 'me', account: { schema_version: 1, nikkes: {} } });
    // 로그인 창 명령은 화면에서 받는 인자가 없다(어떤 주소를 열지·어떤 쿠키를 읽을지 화면이 정하지 못한다).
    expect(calls[22].args).toEqual({});
    expect(calls[23].args).toEqual({});
    expect(calls[24].args).toEqual({});
    // 크롬 확장 연결: 화면이 정하는 것은 켜짐뿐이다 — 듣는 주소·포트·연결 코드·쿠키는 넘기지 않는다.
    expect(calls[25].args).toEqual({});
    expect(calls[26].args).toEqual({ enabled: true });
    expect(calls[27].args).toEqual({});
    expect(calls[28].args).toEqual({});
    // 게임 이미지: 화면이 넘기는 것은 니케 이름·보스 id·아이콘의 종류와 값뿐이다 — 경로나 폴더는 없다.
    expect(calls[29].args).toEqual({ name: '크라운' });
    expect(calls[30].args).toEqual({ id: 'kraken' });
    expect(calls[31].args).toEqual({ kind: 'element', key: '작열' });
    // 두 창이 함께 보는 것: 화면이 넘기는 것은 계정 이름(경로가 아니다)·오버레이를 띄우는 때·결과 문서뿐이다 — 폴더나 파일 이름은 없다.
    expect(calls[32].args).toEqual({});
    expect(calls[33].args).toEqual({ name: 'me' });
    expect(calls[34].args).toEqual({ mode: 'with_game' });
    expect(calls[35].args).toEqual({ name: null });
    expect(calls[36].args).toEqual({ report: { schema_version: 1, kind: 'intercept_report' } });
    expect(calls[37].args).toEqual({});
    expect(calls[38].args).toEqual({});
    expect(calls[39].args).toEqual({ visible: false });
    // 오버레이 위젯: 화면이 넘기는 것은 모양의 낱말·핀·잰 크기(자리는 없다)·바꿀 설정 칸·계산 진행뿐이다. 읽기와 숨기기·자리 초기화는 인자가 없다.
    expect(calls[3].args).toEqual({});
    expect(calls[40].args).toEqual({ shape: 'next' });
    expect(calls[41].args).toEqual({ pinned: true });
    expect(calls[42].args).toEqual({ width: 440, height: 86 });
    expect(calls[43].args).toEqual({});
    expect(calls[44].args).toEqual({ prefs: { scale_percent: 125, leave: 'hide' } });
    expect(calls[45].args).toEqual({});
    expect(calls[46].args).toEqual({ activity });
    expect(calls[47].args).toEqual({});
  });

  it('자동 추적의 주기를 주지 않으면 null을 넘긴다 — Rust가 기본값(2초)을 쓴다', async () => {
    const calls: unknown[] = [];
    mockIPC((_cmd, args) => {
      calls.push(args);
      return trackStatus;
    });
    await setScreenTracking(false);
    expect(calls).toEqual([{ enabled: false, intervalMs: null }]);
    expect(screenTrackRs).toContain('pub const DEFAULT_INTERVAL_MS: u64 = 2000;');
  });

  it('인자 이름이 Rust 명령의 매개변수와 같다', () => {
    expect(libRs).toMatch(/async fn engine_run_batch\(app: AppHandle, requests: Vec<Value>\)/);
    expect(libRs).toMatch(/async fn read_json_file\(path: String\)/);
    expect(libRs).toMatch(/async fn pick_json_file\(window: WebviewWindow, title: String\)/);
    expect(libRs).toMatch(/async fn game_window_status\(app: AppHandle\)/);
    expect(libRs).toMatch(/async fn set_follow_game\(app: AppHandle, enabled: bool\)/);
    expect(libRs).toMatch(/async fn capture_game\(app: AppHandle, label: Option<String>\)/);
    expect(libRs).toMatch(/async fn recognize_game_screen\(app: AppHandle\) -> Result<Recognition, String>/);
    // 중단 명령은 화면에서 받는 인자가 없다(무엇을 멈출지는 Rust가 안다 — 도는 배치 하나).
    expect(libRs).toMatch(/fn engine_cancel\(run: State<'_, EngineRun>\) -> bool/);
    // 자동 추적: 화면의 intervalMs가 Rust의 interval_ms다(Tauri가 이름을 바꿔 준다).
    expect(libRs).toMatch(/fn set_screen_tracking\(app: AppHandle, enabled: bool, interval_ms: Option<u64>\) -> TrackStatus/);
    expect(libRs).toMatch(/fn screen_track_status\(tracker: State<'_, ScreenTracker>\) -> TrackStatus/);
    // 계정 받기.
    expect(libRs).toMatch(/async fn account_sync_status\(app: AppHandle, name: Option<String>\) -> Result<SyncStatus, SyncFailure>/);
    expect(libRs).toMatch(/async fn account_save_cookie\(app: AppHandle, cookie: String\) -> Result<CookieSaved, SyncFailure>/);
    expect(libRs).toMatch(/async fn account_fetch_profile\(app: AppHandle, name: String\) -> Result<FetchOutcome, SyncFailure>/);
    expect(libRs).toMatch(/fn account_fetch_cancel\(run: State<'_, FetchRun>\) -> bool/);
    expect(libRs).toMatch(/async fn account_read_profile\(app: AppHandle, name: String\) -> Result<Value, SyncFailure>/);
    expect(libRs).toMatch(/async fn account_save_file\(name: String, account: Value\) -> Result<SavedAccount, SyncFailure>/);
    expect(libRs).toMatch(/async fn login_window_open\(app: AppHandle\) -> Result<\(\), SyncFailure>/);
    expect(libRs).toMatch(/async fn login_window_take_cookie\(app: AppHandle\) -> Result<CookieSaved, SyncFailure>/);
    expect(libRs).toMatch(/async fn login_window_clear\(app: AppHandle\) -> Result<String, SyncFailure>/);
    // 크롬 확장 연결.
    expect(libRs).toMatch(/fn extension_link_status\(link: State<'_, ExtensionLink>\) -> LinkStatus/);
    expect(libRs).toMatch(/async fn extension_link_set\(app: AppHandle, enabled: bool\) -> Result<LinkStatus, String>/);
    expect(libRs).toMatch(/fn extension_link_new_code\(link: State<'_, ExtensionLink>\) -> LinkStatus/);
    expect(libRs).toMatch(/fn extension_link_take_pending\(link: State<'_, ExtensionLink>\) -> bool/);
    // 두 창이 함께 보는 것(P-027). 계정 폴더·파일 이름은 인자에 없다 — Rust가 정한다.
    expect(libRs).toMatch(/async fn shared_state\(\) -> Result<SharedSnapshot, String>/);
    expect(libRs).toMatch(/async fn set_default_account\(app: AppHandle, name: String\) -> Result<SharedSnapshot, String>/);
    expect(libRs).toMatch(/async fn set_overlay_launch\(app: AppHandle, mode: String\) -> Result<SharedSnapshot, String>/);
    expect(libRs).toMatch(/async fn read_account\(name: Option<String>\) -> Result<Value, String>/);
    expect(libRs).toMatch(/async fn save_intercept_result\(app: AppHandle, report: Value\) -> Result<SharedSnapshot, String>/);
    expect(libRs).toMatch(/async fn load_intercept_result\(\) -> Result<Option<Value>, String>/);
    expect(libRs).toMatch(/fn show_app_window\(app: AppHandle\) -> Result<\(\), String>/);
    expect(libRs).toMatch(/fn set_overlay_visible\(app: AppHandle, visible: bool\) -> OverlaySnapshot/);
    // 오버레이 위젯(P-028). 창 크기 맞춤은 크기 둘만 받는다 — 자리·창 이름은 인자에 없다.
    expect(libRs).toMatch(/fn overlay_widget\(overlay: State<'_, Overlay>\) -> WidgetSnapshot/);
    expect(libRs).toMatch(/fn overlay_shape\(app: AppHandle, shape: String\) -> Result<WidgetSnapshot, String>/);
    expect(libRs).toMatch(/fn overlay_pin\(app: AppHandle, pinned: bool\) -> WidgetSnapshot/);
    expect(libRs).toMatch(/fn overlay_fit\(app: AppHandle, width: f64, height: f64\) -> Result<\(\), String>/);
    expect(libRs).toMatch(/fn overlay_hide\(app: AppHandle\) -> OverlaySnapshot/);
    expect(libRs).toMatch(/fn set_overlay_prefs\(app: AppHandle, prefs: Value\) -> Result<WidgetSnapshot, String>/);
    expect(libRs).toMatch(/fn reset_overlay_position\(app: AppHandle\) -> Result<WidgetSnapshot, String>/);
    expect(libRs).toMatch(/fn announce_activity\(app: AppHandle, activity: Activity\) -> Activity/);
    expect(libRs).toMatch(/fn compute_activity\(activity: State<'_, ComputeActivity>\) -> Activity/);
  });

  it('Rust가 거부한 한국어 문장을 그대로 넘긴다', async () => {
    mockIPC(() => {
      throw 'schema_version이 맞지 않는다: 파일은 2, 이 앱이 읽는 판은 1이다: x.json';
    });
    const failure = await loadReport('x.json').catch((e: unknown) => errorMessage(e));
    expect(failure).toBe('schema_version이 맞지 않는다: 파일은 2, 이 앱이 읽는 판은 1이다: x.json');
  });

  it('계정 받기 명령이 거부한 값은 종류·문장·쿠키 안내 여부로 읽는다 — Rust가 준 것이 아니면 종류 없는 실패로 감싼다', async () => {
    const rejected = { kind: 'session_expired', message: '로그인 세션이 만료됐다(game not login) — 쿠키를 다시 받아라', cookie_help: true, lines: [{ text: '[!] X', warning: true }], warnings: ['[!] X'] };
    mockIPC(() => {
      throw rejected;
    });
    const failure = await accountFetchProfile('me').catch((e: unknown) => syncFailure(e));
    expect(failure).toEqual(rejected);
    // 칸이 빠진 값도 화면이 그대로 쓸 수 있는 모양으로 채운다.
    expect(syncFailure({ kind: 'busy', message: '이미 계정을 받는 중이다' })).toEqual({ kind: 'busy', message: '이미 계정을 받는 중이다', cookie_help: false, lines: [], warnings: [] });
    // IPC 자체의 오류(문자열·Error)는 종류 없는 실패다 — 쿠키 안내를 붙이지 않는다.
    expect(syncFailure('명령을 부를 수 없다')).toEqual({ kind: 'unknown', message: '명령을 부를 수 없다', cookie_help: false, lines: [], warnings: [] });
    expect(syncFailure(new Error('끊겼다')).message).toBe('끊겼다');
    expect(syncFailure(null).kind).toBe('unknown');
    // Rust의 실패 타입과 화면의 타입이 같은 다섯 칸이다.
    const rust = accountSyncRs.slice(accountSyncRs.indexOf('pub struct SyncFailure {'), accountSyncRs.indexOf('impl SyncFailure {'));
    expect(rust.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual(['pub kind:', 'pub message:', 'pub cookie_help:', 'pub lines:', 'pub warnings:']);
    const types = sources['../src/types.ts'];
    const front = types.slice(types.indexOf('export interface SyncFailure {'), types.indexOf('/** 받은 프로필과 변환에 쓸 엔진의 오버로드 옵션 표'));
    expect(front.match(/^ {2}(\w+):/gm)?.map((f) => f.trim())).toEqual(['kind:', 'message:', 'cookie_help:', 'lines:', 'warnings:']);
  });

  it('errorMessage는 문자열·Error·그 밖의 값을 문장으로 바꾼다', () => {
    expect(errorMessage('가')).toBe('가');
    expect(errorMessage(new Error('나'))).toBe('나');
    expect(errorMessage(42)).toBe('42');
  });

  it('화면이 부르는 명령이 모두 Rust에 등록돼 있고 권한 목록(build.rs)에 있다', () => {
    for (const cmd of COMMANDS) {
      expect(libRs, cmd).toMatch(new RegExp(`fn ${cmd}\\(`));
      expect(buildRs, cmd).toContain(`"${cmd}"`);
    }
  });

  it('상태·진행 이벤트 이름이 Rust 쪽과 같다', () => {
    expect(libRs).toContain(`OVERLAY_STATE_EVENT: &str = "${OVERLAY_STATE_EVENT}"`);
    expect(libRs).toContain(`ENGINE_PROGRESS_EVENT: &str = "${ENGINE_PROGRESS_EVENT}"`);
    expect(libRs).toContain(`GAME_WINDOW_EVENT: &str = "${GAME_WINDOW_EVENT}"`);
    expect(libRs).toContain(`GAME_CAPTURE_EVENT: &str = "${GAME_CAPTURE_EVENT}"`);
    expect(libRs).toContain(`SCREEN_TRACK_EVENT: &str = "${SCREEN_TRACK_EVENT}"`);
    expect(libRs).toContain(`ACCOUNT_FETCH_EVENT: &str = "${ACCOUNT_FETCH_EVENT}"`);
    expect(libRs).toContain(`EXTENSION_LINK_EVENT: &str = "${EXTENSION_LINK_EVENT}"`);
    expect(libRs).toContain(`SHARED_STATE_EVENT: &str = "${SHARED_STATE_EVENT}"`);
    expect(libRs).toContain(`OVERLAY_WIDGET_EVENT: &str = "${OVERLAY_WIDGET_EVENT}"`);
    expect(libRs).toContain(`COMPUTE_ACTIVITY_EVENT: &str = "${COMPUTE_ACTIVITY_EVENT}"`);
  });
});

describe('계정 받기 — 세션 쿠키의 길(Rust)', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  /** `#[cfg(test)]` 앞까지 — 테스트 코드를 뺀 부분. */
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));
  const cookieCode = code(beforeTests(cookieRs));
  const syncCode = code(beforeTests(accountSyncRs));
  const loginCode = code(beforeTests(loginWindowRs));
  /** lib.rs에서 계정 받기 명령들이 있는 부분. */
  const glue = code(libRs.slice(libRs.indexOf('// ── 계정 받기'), libRs.indexOf('/// 게임 화면을 찍어 캡처 폴더(')));

  it('(a) 쿠키를 쓰는 곳은 엔진의 scraper/.session_cookie 하나다', () => {
    expect(accountSyncRs).toContain('pub const COOKIE_FILE: &str = "scraper/.session_cookie";');
    // 쿠키 값을 꺼내는 길(header)을 부르는 곳은 쿠키 파일을 쓰는 한 줄뿐이다.
    expect(cookieCode).toContain('pub(crate) fn header(&self) -> &str');
    expect(syncCode.match(/\.header\(\)/g)).toHaveLength(1);
    expect(syncCode).toMatch(/let path = cookie_path\(engine_dir\);\s*fs::write\(&path, format!\("\{\}\\n", cookie\.header\(\)\)\)/);
    for (const [file, source] of Object.entries({ 'lib.rs': code(libRs), 'login_window.rs': loginCode })) {
      expect(source, file).not.toMatch(/\.header\(\)/);
    }
    // 두 길(붙여넣기·로그인 창) 모두 그 한 곳으로 간다.
    expect(syncCode.match(/write_cookie_file\(engine_dir, &cookie\)/g)).toHaveLength(2);
    // 엔진의 수집 스크립트 옆이 아니면 쓰지 않는다.
    expect(syncCode).toMatch(/fn write_cookie_file\([^)]*\) -> Result<CookieSaved, SyncError> \{[\s\S]*?if !script\.is_file\(\) \{\s*return Err\(SyncError::ScriptMissing/);
  });

  it('(b·c) 쿠키를 담는 타입은 값을 글자로 내보이지 않고, 화면에 넘기는 타입에는 쿠키가 없다', () => {
    // 쿠키를 담는 두 타입은 Debug를 손으로 쓴다(값을 가린다). 직렬화(화면으로 넘기기)는 할 수 없다.
    expect(cookieCode).toMatch(/#\[derive\(Clone, PartialEq, Eq\)\]\s*pub struct SessionCookie\(String\);/);
    expect(cookieCode).toMatch(/#\[derive\(Clone, PartialEq, Eq\)\]\s*pub struct BrowserCookie \{/);
    expect(cookieCode).toMatch(/#\[derive\(Clone, Default\)\]\s*pub struct Redactor \{/);
    expect(cookieCode).not.toMatch(/Serialize|serde/);
    // 화면에 넘기는 「쿠키 저장 결과」는 시각과 개수뿐이다.
    const saved = accountSyncRs.slice(accountSyncRs.indexOf('pub struct CookieSaved {'), accountSyncRs.indexOf('/// 확인을 마친 쿠키를 엔진의 쿠키 파일에 쓴다'));
    expect(saved.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual(['pub saved_at:', 'pub count:']);
    const types = sources['../src/types.ts'];
    const front = types.slice(types.indexOf('export interface CookieSaved {'), types.indexOf('/** 수집 스크립트가 낸 줄 하나'));
    expect(front.match(/^ {2}(\w+):/gm)?.map((f) => f.trim())).toEqual(['saved_at:', 'count:']);
    // 상태에도 쿠키의 내용은 없다 — 있는지와 언제 썼는지뿐이다.
    const status = accountSyncRs.slice(accountSyncRs.indexOf('pub struct SyncStatus {'), accountSyncRs.indexOf('/// python을 실행할 수 있는지 본다'));
    expect(status.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual([
      'pub name:',
      'pub cookie_saved:',
      'pub cookie_saved_at:',
      'pub profile_fetched_at:',
      'pub account_file:',
      'pub login_window_open:',
      'pub problems:',
    ]);
  });

  it('(c) 쿠키를 다루는 Rust 코드는 아무것도 출력하지 않고, 이벤트로 가는 것은 가린 진행 줄뿐이다', () => {
    for (const [file, source] of Object.entries({ 'cookie.rs': cookieCode, 'account_sync.rs': syncCode, 'login_window.rs': loginCode, 'lib.rs(계정 받기)': glue })) {
      expect(source, file).not.toMatch(/\b(println|eprintln|print|eprint|dbg)!|\blog::|\btracing::/);
    }
    // 계정 받기 명령이 보내는 이벤트는 하나다: 수집 스크립트의 줄(가려진 것)을 계정 받기를 하는 창(데스크톱 앱 창)으로만.
    // (P-027: 계정 받기가 오버레이 창에서 앱 창으로 옮겨 가 받는 창이 MAIN_WINDOW에서 APP_WINDOW로 바뀌었다 — 한 창에만 보낸다는 약속은 그대로다.)
    expect(glue.match(/\.emit\w*\(/g)).toHaveLength(1);
    expect(glue).toContain('app.emit_to(APP_WINDOW, ACCOUNT_FETCH_EVENT, line.clone())');
    // 스크립트의 줄은 가린 뒤에야 모으고 알린다.
    expect(syncCode).toMatch(/let line = FetchLine::new\(truncate\(&redactor\.redact\(text\), MAX_LINE_CHARS\)\);/);
    expect(syncCode.match(/on_line\(/g)).toHaveLength(2);
    expect(syncCode).toContain('let redactor = cookie_redactor(&config.engine_dir)?;');
    // 받은 프로필의 계정 식별자(openid)도 화면에 넘기지 않는다.
    expect(syncCode).toContain('meta.remove("openid");');
  });

  // P-025에서 요구가 바뀌었다: 크롬 확장이 넘기는 쿠키를 받으려고 앱이 **듣는** 소켓 하나를 갖게 됐다(extension_link.rs —
  // 루프백에만 묶이고, 켰을 때만 열린다). 「밖으로 나가는 요청을 하지 않는다」는 그대로다: HTTP 크레이트가 없고, 소켓 코드는
  // 그 모듈 하나에만 있으며, 그 모듈에는 연결을 만드는 호출이 없다(아래 「크롬 확장 연결(Rust)」이 더 본다).
  it('(d) 앱의 Rust 코드는 네트워크 요청을 하지 않는다 — HTTP 크레이트가 없고, 소켓은 크롬 확장 수신부의 듣기 하나뿐이다', () => {
    expect(cargoToml).not.toMatch(/^\s*(reqwest|ureq|hyper|curl|isahc|attohttpc|surf|tungstenite|tokio-tungstenite|tauri-plugin-http|tauri-plugin-websocket|tauri-plugin-upload|tiny_http|rouille|axum|warp|actix-web|tokio)\s*=/m);
    for (const [file, source] of Object.entries({ 'cookie.rs': cookieCode, 'account_sync.rs': syncCode, 'login_window.rs': loginCode, 'lib.rs': code(libRs) })) {
      expect(source, file).not.toMatch(/std::net|TcpStream|UdpSocket|reqwest|ureq::/);
    }
    // 소켓을 쓰는 파일은 앱 전체에서 수신부 모듈 하나다. 어디에도 연결을 만드는 호출(나가는 연결)이 없다.
    const files = Object.entries(allRust);
    expect(files.length).toBeGreaterThan(12);
    for (const [file, source] of files) {
      const body = code(source.includes('#[cfg(test)]') ? beforeTests(source) : source);
      expect(/std::net|TcpListener|TcpStream|UdpSocket/.test(body), file).toBe(file.endsWith('/extension_link.rs'));
      expect(body, file).not.toMatch(/TcpStream::connect|\.connect\(|\.connect_timeout\(|UdpSocket|ToSocketAddrs|reqwest|ureq::/);
    }
    // 쿠키 규칙 모듈은 순수하다: 파일·프로세스·창에 닿지 않는다.
    expect(cookieCode).not.toMatch(/std::fs|std::io|std::path|std::process|std::env|std::thread|tauri|windows::/);
    expect(cookieCode.match(/^use /gm)).toHaveLength(1);
  });

  it('실행하는 것은 설정된 엔진 폴더의 scraper/profile_fetch.py뿐이다 — 화면은 이름만 넘긴다', () => {
    expect(accountSyncRs).toContain('pub const FETCH_SCRIPT: &str = "scraper/profile_fetch.py";');
    expect(syncCode).toMatch(/fn script\(&self\) -> PathBuf \{\s*self\.engine_dir\.join\(FETCH_SCRIPT\)/);
    expect(syncCode).toMatch(/let mut cmd = Command::new\(&config\.python\);\s*cmd\.arg\(&script\)\s*\.arg\("--name"\)\s*\.arg\(&name\)/);
    // 프로세스를 띄우는 곳은 둘뿐이다: 수집 스크립트와, 상태 조회의 `python --version`.
    expect(syncCode.match(/Command::new\(/g)).toHaveLength(2);
    expect(syncCode).toMatch(/let mut cmd = Command::new\(python\);\s*cmd\.arg\("--version"\)/);
    // 이름은 스크립트를 띄우기 전에 확인한다.
    const fetchBody = syncCode.slice(syncCode.indexOf('pub fn fetch_profile('), syncCode.indexOf('fn exit_of('));
    expect(fetchBody.indexOf('let name = validate_name(name)?;')).toBeGreaterThan(-1);
    expect(fetchBody.indexOf('let name = validate_name(name)?;')).toBeLessThan(fetchBody.indexOf('Command::new('));
    // 엔진 폴더·python은 엔진 계산과 같은 설정에서 나온다(P-010) — 명령의 인자에는 없다.
    expect(glue).toMatch(/fn fetch_config\(app: &AppHandle\) -> Result<FetchConfig, SyncFailure> \{\s*engine_config\(app\)\s*\.map\(\|config\| FetchConfig::from_engine\(&config\)\)/);
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/profile_fetch\.py|scraper\/|\.session_cookie|NIKKE_ACCOUNTS_DIR|accounts_dir|accountsDir/);
    }
  });

  it('중단·시간 초과는 엔진 계산과 같은 방식으로 스크립트와 그 자식 프로세스까지 끝낸다', () => {
    expect(libRs).toContain('struct FetchRun(engine::BatchSlot);');
    expect(glue).toMatch(/let ticket = run\.0\.begin\(\)\.map_err\(\|_\| SyncError::Busy\)\?;/);
    expect(glue).toMatch(/account_sync::fetch_profile\(&config, &name, &on_line, ticket\.signal\(\)\)/);
    expect(glue).toMatch(/fn account_fetch_cancel\([^)]*\) -> bool \{\s*run\.0\.stop\(\)\s*\}/);
    expect(syncCode).toContain('let group = ProcessGroup::adopt(&child);');
    expect(syncCode).toContain('engine::kill_engine(&mut child, &group);');
    expect(syncCode).toContain('pub const DEFAULT_FETCH_TIMEOUT: Duration = Duration::from_secs(10 * 60);');
    expect(syncCode).toContain('Self::Stopped => write!(f, "{STOPPED_PREFIX}: 계정 수집을 멈췄다")');
  });

  it('계정 파일은 계정 폴더 안에만, 안전한 이름으로, 있던 파일은 .bak으로 남기고 쓴다', () => {
    expect(accountSyncRs).toContain('pub const ENV_ACCOUNTS_DIR: &str = "NIKKE_ACCOUNTS_DIR";');
    expect(accountSyncRs).toContain('pub const ACCOUNTS_SUBDIR: [&str; 2] = ["data", "accounts"];');
    const save = syncCode.slice(syncCode.indexOf('pub fn save_account('));
    expect(save.indexOf('let name = validate_name(name)?;')).toBeLessThan(save.indexOf('fs::create_dir_all(dir)'));
    expect(save).toMatch(/let backup = if path\.is_file\(\) \{\s*let backup = dir\.join\(format!\("\{name\}\.json\.bak"\)\);\s*fs::copy\(&path, &backup\)/);
    // 화면은 폴더를 정하지 못한다 — 이름과 문서만 넘긴다.
    expect(glue).toMatch(/let dir = account_sync::default_accounts_dir\(\)\?;\s*Ok\(account_sync::save_account\(&dir, &name, &account\)\?\)/);
    expect(gitignore.split(/\r?\n/)).toContain('data/accounts/');
  });

  it('프로필 → 계정 상태 변환을 Rust로 다시 쓰지 않았다 — 화면 쪽의 src/core/import-profile.mjs가 한다', () => {
    for (const rust of [syncCode, glue]) {
      expect(rust).not.toMatch(/skill_levels|breakthrough|core_enhancement|equip_skills|collection_stage|favorite_stage|synchro_level/);
    }
    const sync = sources['../src/lib/accountSync.ts'];
    expect(sync).toMatch(/import \{ importProfile, importReport, optionTableFrom \} from '@core\/import-profile\.mjs'/);
    expect(sync).toMatch(/const result = importProfile\(profile, \{/);
    // 화면과 그 도우미에는 변환 규칙(칸 이름 다루기)이 없다. 동기화 레벨은 요약에 보이려고 읽기만 한다.
    for (const file of ['../src/screens/AccountScreen.vue', '../src/components/AccountFailure.vue', '../src/lib/accountSync.ts', '../src/lib/accountLink.ts']) {
      expect(sources[file], file).not.toMatch(/skill_levels|breakthrough|core_enhancement|equip_skills|collection_stage|favorite_stage|unknown\.push|\boverload\b/);
    }
    // 옵션 표 파일의 자리는 Rust와 루트 모듈이 같다.
    expect(accountSyncRs).toContain('pub const OPTION_TABLE_FILE: &str = "data/base_stat_tables/equipment_skills.json";');
  });
});

describe('로그인 창(Rust)', () => {
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));
  const login = code(beforeTests(loginWindowRs));
  const capabilityFiles = import.meta.glob('../src-tauri/capabilities/*.json');

  it('오버레이와 다른 보통 창이다 — 테두리·제목 표시줄이 있고 작업 표시줄에 보인다', () => {
    expect(loginWindowRs).toContain('pub const LOGIN_WINDOW: &str = "login";');
    const build = login.slice(login.indexOf('WebviewWindowBuilder::new('), login.indexOf('.build()'));
    expect(build).toContain('WebviewWindowBuilder::new(app, LOGIN_WINDOW, WebviewUrl::External(parse(LOGIN_URL)?))');
    expect(build).toContain('.decorations(true)');
    expect(build).toContain('.skip_taskbar(false)');
    expect(build).toContain('.always_on_top(false)');
    expect(build).not.toMatch(/\.transparent\(|\.visible\(false\)/);
    // 창은 실행 중에 만든다 — 설정 파일의 창은 오버레이와 데스크톱 앱 창 둘이고(P-027) 로그인 창은 거기에 없다.
    expect(tauriConf.app.windows.map((w) => w.label)).toEqual(['main', 'app']);
    // 여는 주소는 정해져 있다. 화면이 주소를 넘기지 못한다.
    expect(login).toMatch(/pub const LOGIN_URL: &str = "https:\/\/www\.blablalink\.com\/";/);
    expect(libRs).toMatch(/async fn login_window_open\(app: AppHandle\) -> Result<\(\), SyncFailure> \{\s*Ok\(login_window::open\(&app\)\?\)/);
  });

  it('이 창은 앱 명령을 부를 수 없다 — capability가 없고, 원격 주소에 IPC를 여는 설정이 없다', () => {
    // capability 파일은 둘이고(오버레이 창·데스크톱 앱 창 — P-027), 어느 쪽 창 목록에도 로그인 창이 없다(이름을 묶어 맞추는 * 도 없다).
    expect(Object.keys(capabilityFiles).sort()).toEqual(['../src-tauri/capabilities/app.json', '../src-tauri/capabilities/overlay.json']);
    expect(capability.windows).toEqual(['main']);
    expect(appCapability.windows).toEqual(['app']);
    for (const cap of [capability, appCapability]) {
      expect(cap.windows).not.toContain('login');
      for (const name of cap.windows) expect(name).not.toMatch(/[*?]/);
      // 원격 주소에 권한을 주는 칸이 없다 — 창의 주소가 어디로 바뀌든 권한은 생기지 않는다.
      expect(Object.keys(cap).sort()).toEqual(['$schema', 'description', 'identifier', 'permissions', 'windows']);
      expect(JSON.stringify(cap.permissions)).not.toMatch(/remote|https?:/);
    }
    expect(tauriConf.app.security.capabilities).toEqual(['overlay', 'app']);
    expect(JSON.stringify(tauriConf)).not.toMatch(/dangerousRemoteDomainIpcAccess|dangerousRemoteUrlIpcAccess|"remote"/);
    // 앱 명령은 권한 목록(build.rs)에 올라 있다 — 올리지 않은 명령은 어느 창에서나 불린다.
    for (const cmd of COMMANDS) expect(buildRs, cmd).toContain(`"${cmd}"`);
    // 로그인 창에 스크립트를 넣거나 페이지에서 무엇을 실행하지 않는다.
    expect(login).not.toMatch(/initialization_script|\.eval\(|on_page_load|on_web_resource_request|additional_browser_args|devtools\(true\)/);
    // 갈 수 있는 주소는 https뿐이다.
    expect(login).toContain('.on_navigation(navigation_allowed)');
    expect(login).toMatch(/pub fn navigation_allowed\(url: &Url\) -> bool \{\s*url\.scheme\(\) == "https" \|\| url\.as_str\(\) == "about:blank"/);
  });

  it('쿠키는 Rust가 그 창의 저장소에서 직접 읽어 쿠키 파일로만 보낸다 — 로그인하지 않았으면 창을 둔다', () => {
    // 읽는 것은 blablalink API로 가는 요청에 실릴 쿠키뿐이다(저장소 전체가 아니다).
    expect(login).toMatch(/pub const COOKIE_URL: &str = "https:\/\/api\.blablalink\.com\/api\/game\/proxy\/";/);
    expect(login).toContain('.cookies_for_url(parse(COOKIE_URL)?)');
    expect(login).not.toMatch(/\.cookies\(\)/);
    expect(cookieRs).toContain('pub const API_HOST: &str = "api.blablalink.com";');
    // 읽기 → 저장(필수 쿠키가 없으면 여기서 거부되고 창은 그대로) → 창 닫기.
    const take = code(libRs.slice(libRs.indexOf('async fn login_window_take_cookie('), libRs.indexOf('/// 로그인 창의 세션(쿠키·저장 데이터)을 지운다. 한 일을')));
    expect(take).toMatch(
      /let window = login_window::window\(&app\)\.ok_or\(SyncError::LoginWindowClosed\)\?;\s*let cookies = login_window::read_cookies\(&window\)\?;\s*let saved = account_sync::store_login_cookies\(&config\.engine_dir, &cookies\)\?;\s*login_window::close\(&window\);\s*Ok\(saved\)/,
    );
    expect(take).not.toMatch(/emit|format!|to_string\(\)/);
    // 쿠키 목록 → 헤더 한 줄은 순수 함수다.
    expect(cookieRs).toMatch(/pub fn header_from_browser_cookies\(\s*cookies: &\[BrowserCookie\],\s*host: &str,\s*\) -> Result<SessionCookie, CookieError>/);
    expect(accountSyncRs).toContain('let cookie = cookie::header_from_browser_cookies(cookies, cookie::API_HOST)?;');
    // Windows에서는 화면 응답을 맡은 스레드에서 쿠키를 읽으면 멈춘다 — 다른 스레드에서 읽는다.
    expect(take).toMatch(/blocking_sync\(move \|\| \{/);
  });

  it('세션을 지울 수 있고, 로그인 창의 저장 데이터는 오버레이와 다른 폴더에 둔다', () => {
    expect(loginWindowRs).toContain('pub const DATA_SUBDIR: &str = "login-webview";');
    expect(login).toMatch(/pub fn open\(app: &AppHandle\) -> Result<\(\), SyncError> \{\s*open_in\(app, data_dir\(app\)\?\)/);
    expect(login).toContain('.data_directory(data_directory)');
    expect(login).toMatch(/fn data_dir\(app: &AppHandle\) -> Result<PathBuf, SyncError> \{\s*app\.path\(\)\s*\.app_local_data_dir\(\)\s*\.map\(\|dir\| dir\.join\(DATA_SUBDIR\)\)/);
    const clear = login.slice(login.indexOf('pub fn clear_session('));
    expect(clear).toMatch(/pub fn clear_session\(app: &AppHandle\) -> Result<&'static str, SyncError> \{\s*clear_session_in\(app, &data_dir\(app\)\?\)/);
    expect(clear).toContain('.clear_all_browsing_data()');
    expect(clear).toContain('fs::remove_dir_all(dir)');
    // 지우는 것은 로그인 창의 폴더뿐이다 — 엔진의 쿠키 파일은 건드리지 않는다.
    expect(login).not.toMatch(/session_cookie|COOKIE_FILE|cookie_path/);
  });
});

describe('크롬 확장 연결(Rust)', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));
  const link = code(beforeTests(extensionLinkRs));
  /** lib.rs에서 크롬 확장 연결 명령들이 있는 부분. */
  const glue = code(libRs.slice(libRs.indexOf('// ── 크롬 확장 연결'), libRs.indexOf('// ── 두 창이 함께 보는 것')));

  it('루프백(127.0.0.1)에만 묶는다 — 듣는 소켓을 만드는 곳은 한 줄이고, 화면은 주소·포트를 정하지 못한다', () => {
    expect(link.match(/TcpListener::bind\(/g)).toHaveLength(1);
    expect(link).toContain('TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))');
    // 모든 주소·IPv6·방송 주소에 묶는 코드가 없다.
    expect(link).not.toMatch(/UNSPECIFIED|0\.0\.0\.0|Ipv6Addr|SocketAddrV6|\[::\]|BROADCAST/);
    // 받은 연결의 상대가 루프백인지도 한 번 더 본다.
    expect(link).toMatch(/Ok\(\(stream, peer\)\) if peer\.ip\(\)\.is_loopback\(\) => \{\s*serve\(stream, port, &gate, &\*sink, &\*notify\);/);
    // 밖으로 연결을 만드는 호출이 없다 — 듣고, 들어온 연결에 답할 뿐이다.
    expect(link).not.toMatch(/TcpStream::connect|\.connect\(|\.connect_timeout\(|UdpSocket/);
    expect(extensionLinkRs).toContain('pub const DEFAULT_PORT: u16 = 47615;');
    expect(glue).toMatch(/LinkHub::open\(\s*file,\s*extension_link::DEFAULT_PORT,/);
    expect(glue).toMatch(/async fn extension_link_set\(app: AppHandle, enabled: bool\) -> Result<LinkStatus, String> \{\s*blocking\(move \|\| Ok\(app\.state::<ExtensionLink>\(\)\.0\.set_enabled\(enabled\)\)\)\.await/);
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/47615|127\.0\.0\.1|localhost|\bport\b/i);
    }
  });

  it('기본은 꺼짐이고 켰을 때만 열린다 — 끄거나 앱이 끝나면 닫히고, 켜짐 여부는 Rust가 기억한다', () => {
    expect(link).toMatch(/struct Saved \{\s*#\[serde\(default\)\]\s*enabled: bool,\s*#\[serde\(default\)\]\s*code: String,\s*\}/);
    // 듣기 시작하는 곳은 둘뿐이다: 기억해 둔 설정이 켜짐일 때, 그리고 켜라는 명령.
    expect(link.match(/\b(self|hub)\.start\(/g)).toHaveLength(2);
    expect(link).toMatch(/if saved\.enabled \{\s*hub\.start\(&mut lock\(&hub\.state\)\);/);
    expect(link).toMatch(/if enabled \{\s*self\.start\(&mut state\);\s*None\s*\} else \{\s*state\.problem = None;\s*state\.receiver\.take\(\)\s*\}/);
    expect(link.match(/Receiver::start\(/g)).toHaveLength(1);
    // 수신부를 버리면 듣는 소켓이 닫힌다(끄기·앱 종료 모두 이 길이다).
    expect(link).toMatch(/impl Drop for Receiver \{\s*fn drop\(&mut self\) \{\s*self\.close\(\);/);
    expect(link).toMatch(/pub fn shutdown\(&self\) \{\s*let stopped = lock\(&self\.state\)\.receiver\.take\(\);\s*drop\(stopped\);/);
    // 앱이 끝나는 길에서 닫는다.
    const stop = code(libRs.slice(libRs.indexOf('fn stop_running_work('), libRs.indexOf('/// 전환 결과에서 바뀐 것만 창에 반영한다.')));
    expect(stop).toMatch(/if let Some\(link\) = app\.try_state::<ExtensionLink>\(\) \{\s*link\.0\.shutdown\(\);\s*\}/);
    // 설정 파일은 앱 설정 폴더에 있고(화면이 자리를 정하지 못한다) 켜짐과 코드뿐이다 — 화면은 이 스위치를 따로 기억하지 않는다.
    expect(extensionLinkRs).toContain('pub const SETTINGS_FILE: &str = "extension-link.json";');
    expect(glue).toMatch(/\.app_config_dir\(\)\s*\.map\(\|dir\| dir\.join\(extension_link::SETTINGS_FILE\)\)/);
    expect(code(sources['../src/lib/extensionLink.ts'])).not.toMatch(/\bremember\(|\brecall\(|localStorage|sessionStorage/);
    // 앱이 켜질 때 한 번 연다(켜 둔 채 끝냈으면 그때 다시 듣는다).
    expect(code(libRs).match(/open_extension_link\(/g)).toHaveLength(2);
    expect(code(libRs)).toContain('app.manage(open_extension_link(app.handle()));');
  });

  it('정해진 요청 하나만 받는다 — 경로·출처·방법·호스트·형식·크기를 머리에서 가리고, 본문은 두 칸짜리 객체다', () => {
    expect(extensionLinkRs).toContain('pub const SESSION_PATH: &str = "/nikke-companion/v1/session";');
    expect(extensionLinkRs).toContain('pub const CONTENT_TYPE: &str = "application/json";');
    expect(extensionLinkRs).toContain('pub const MAX_HEAD_BYTES: usize = 8 * 1024;');
    expect(extensionLinkRs).toContain('pub const MAX_BODY_BYTES: usize = 32 * 1024;');
    expect(extensionLinkRs).toContain('pub const REQUEST_DEADLINE: Duration = Duration::from_secs(3);');
    const screen = link.slice(link.indexOf('pub fn screen('), link.indexOf('const BODY_FIELDS'));
    const order = ['head.target != SESSION_PATH', 'is_some_and(is_extension_origin)', 'head.method != "POST"', 'head.header("host")?', 'media.as_deref() != Some(CONTENT_TYPE)', 'length > MAX_BODY_BYTES'].map((part) => screen.indexOf(part));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 머리에서 거부한 요청은 본문을 읽지 않는다: 가린 뒤에야 본문을 읽는다.
    const read = link.slice(link.indexOf('fn read_request('), link.indexOf('fn drain('));
    expect(read.indexOf('let length = screen(&head, port)?;')).toBeGreaterThan(-1);
    expect(read.indexOf('let length = screen(&head, port)?;')).toBeLessThan(read.indexOf('while body.len() < length'));
    expect(link).toContain('const BODY_FIELDS: [&str; 2] = ["code", "cookie"];');
    // 답한 뒤 연결을 닫는다(연결 하나에 요청 하나).
    expect(link).toContain('Connection: close');
  });

  it('웹 페이지는 부르지 못한다 — 확장의 출처만 받고, 다른 출처 허용 헤더는 코드에 아예 없다', () => {
    expect(extensionLinkRs).toContain('pub const EXTENSION_ORIGIN: &str = "chrome-extension://";');
    expect(link).toMatch(/pub fn is_extension_origin\(origin: &str\) -> bool \{\s*origin\s*\.strip_prefix\(EXTENSION_ORIGIN\)\s*\.is_some_and\(\|id\| id\.len\(\) == 32 && id\.bytes\(\)\.all\(\|b\| \(b'a'\.\.=b'p'\)\.contains\(&b\)\)\)/);
    expect(link).not.toMatch(/access-control|timing-allow-origin|cross-origin-resource-policy: cross/i);
    // 호스트는 이 수신부의 주소여야 한다(다른 이름으로 이 주소를 가리킨 페이지를 막는다).
    expect(link).toContain('if head.header("host")? != Some(format!("{}:{port}", Ipv4Addr::LOCALHOST).as_str()) {');
    // 웹 페이지의 요청은 화면에 알리지도, 틀린 코드로 세지도 않는다: 코드를 견주는 곳은 본문을 읽은 뒤의 한 곳이다.
    expect(link.match(/gate\.check\(/g)).toHaveLength(1);
    expect(link).toMatch(/if reply\.notable\(\) \{\s*notify\(reply\);\s*\}/);
  });

  it('연결 코드: 운영체제의 난수로 만들고, 맞는 요청만 받고, 여러 번 틀리면 잠시 막는다', () => {
    expect(cargoToml).toMatch(/^getrandom = "0\.3"$/m);
    expect(link).toContain('getrandom::fill(&mut bytes)');
    expect(link.match(/getrandom::/g)).toHaveLength(1);
    expect(extensionLinkRs).toContain('pub const CODE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";');
    expect(extensionLinkRs).toContain('pub const CODE_CHARS: usize = 8;');
    expect(extensionLinkRs).toContain('pub const MAX_WRONG_CODES: u32 = 5;');
    expect(extensionLinkRs).toContain('pub const LOCK_FOR: Duration = Duration::from_secs(60);');
    // 끝까지 견준다(어디서 틀렸는지에 따라 일찍 끝나지 않는다).
    expect(link).toMatch(/\.fold\(0u8, \|diff, \(a, b\)\| diff \| \(a \^ b\)\)\s*== 0/);
    // 코드가 맞기 전에는 쿠키를 저장하는 쪽에 넘기지 않는다.
    const judge = link.slice(link.indexOf('pub fn judge('), link.indexOf('pub fn store_in_engine('));
    expect(judge.indexOf('gate.check(&submission.code, now)')).toBeGreaterThan(-1);
    expect(judge.indexOf('gate.check(&submission.code, now)')).toBeLessThan(judge.indexOf('sink(&submission.cookie)'));
    expect(link.match(/sink\(&submission\.cookie\)/g)).toHaveLength(1);
    // 코드를 다시 만드는 명령이 있다.
    expect(glue).toMatch(/fn extension_link_new_code\(link: State<'_, ExtensionLink>\) -> LinkStatus \{\s*link\.0\.new_code\(\)/);
  });

  it('쿠키는 수신부에서 엔진의 쿠키 파일로만 흐른다 — 붙여넣기와 같은 정리·검사를 거치는 같은 한 곳이다', () => {
    expect(link).toMatch(/pub fn store_in_engine\(engine_dir: &Path, cookie: &str\) -> Stored \{\s*match account_sync::store_pasted_cookie\(engine_dir, cookie\) \{/);
    // 이 모듈은 파일에 쿠키를 쓰지 않는다: 쓰는 파일은 설정 파일 하나이고 거기 가는 것은 켜짐과 코드뿐이다.
    expect(link.match(/fs::write\(/g)).toHaveLength(1);
    expect(link).toMatch(/let saved = Saved \{\s*enabled: lock\(&self\.state\)\.enabled,\s*code: self\.gate\.code\(\)\.map\(\|code\| code\.shown\(\)\)\.unwrap_or_default\(\),\s*\};/);
    expect(link).not.toMatch(/\.header\(\)|session_cookie|COOKIE_FILE|cookie_path/);
    // 접착 코드: 수집이 도는 동안에는 쿠키를 바꾸지 않고, 엔진 폴더는 설정에서 나온다.
    expect(glue).toMatch(/if store\.state::<FetchRun>\(\)\.0\.is_running\(\) \{\s*return Stored::Busy;\s*\}/);
    expect(glue).toMatch(/Ok\(config\) => extension_link::store_in_engine\(&config\.engine_dir, cookie\),\s*Err\(_\) => Stored::Failed,/);
    expect(glue.match(/\bcookie\b/g)).toHaveLength(2);
  });

  it('쿠키는 답·오류·로그·이벤트·명령 반환값에 실리지 않는다', () => {
    // 아무것도 출력하지 않는다.
    for (const [file, source] of Object.entries({ 'extension_link.rs': link, 'lib.rs(크롬 확장 연결)': glue })) {
      expect(source, file).not.toMatch(/\b(println|eprintln|print|eprint|dbg)!|\blog::|\btracing::/);
    }
    // 답은 정해진 낱말로만 만든다: 본문을 만드는 함수에 들어가는 값은 사유의 낱말과 남은 초뿐이다.
    const body = link.slice(link.indexOf('pub fn body(self) -> String {'), link.indexOf('pub fn to_bytes(self)'));
    expect(body.match(/format!\(/g)).toHaveLength(2);
    expect(body).toContain('format!(r#"{{"ok":false,"reason":"locked","retry_after_seconds":{seconds}}}"#)');
    expect(body).toContain('format!(r#"{{"ok":false,"reason":"{}"}}"#, other.reason())');
    expect(link).toMatch(/pub fn reason\(self\) -> &'static str/);
    // 본문을 읽다 난 오류의 문장은 버린다(쿠키가 섞여 나올 수 있다).
    expect(link).toMatch(/let Ok\(Value::Object\(mut fields\)\) = serde_json::from_slice::<Value>\(raw\) else \{\s*return Err\(Reply::BadRequest\);/);
    // 확장이 보낸 것을 담는 타입은 값을 가리고, 화면으로 넘길 수(직렬화할 수) 없다.
    expect(link).toMatch(/#\[derive\(Clone, PartialEq, Eq\)\]\s*pub struct Submission \{\s*code: String,\s*cookie: String,\s*\}/);
    expect(link).toMatch(/f\.debug_struct\("Submission"\)\s*\.field\("code", &MASK\)\s*\.field\("cookie", &MASK\)/);
    // 화면에 가는 상태는 이 여덟 칸이고(연결 코드는 쿠키가 아니다) 쿠키가 없다. 화면 쪽 타입도 같다.
    const status = extensionLinkRs.slice(extensionLinkRs.indexOf('pub struct LinkStatus {'), extensionLinkRs.indexOf('/// 답 하나를 계정 화면에 보일 문장으로.'));
    const fields = ['enabled', 'listening', 'address', 'code', 'problem', 'pending', 'last', 'locked_seconds'];
    expect(status.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual(fields.map((f) => `pub ${f}:`));
    const types = sources['../src/types.ts'];
    const front = types.slice(types.indexOf('export interface ExtensionLinkStatus {'), types.indexOf('/** 계정 파일을 쓴 결과'));
    expect(front.match(/^ {2}(\w+):/gm)?.map((f) => f.trim())).toEqual(fields.map((f) => `${f}:`));
    const activity = extensionLinkRs.slice(extensionLinkRs.indexOf('pub struct LinkActivity {'), extensionLinkRs.indexOf('/// 크롬 확장 연결의 지금 상태.'));
    expect(activity.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual(['pub at:', 'pub outcome:', 'pub message:']);
    // 이벤트는 하나다: 상태를 계정 받기를 하는 창(데스크톱 앱 창)으로만. 알리는 쪽에는 인자가 없다(쿠키가 지나갈 길이 없다).
    // (P-027: 받는 창이 MAIN_WINDOW에서 APP_WINDOW로 바뀌었다. 연결 코드가 실린 상태가 오버레이 창에는 가지 않는다.)
    expect(glue.match(/\.emit\w*\(/g)).toHaveLength(1);
    expect(glue).toContain('notify.emit_to(APP_WINDOW, EXTENSION_LINK_EVENT, link.0.status())');
    expect(extensionLinkRs).toContain('pub type Changed = dyn Fn() + Send + Sync;');
    // 명령이 돌려주는 것은 상태와 참·거짓뿐이다.
    expect(glue.match(/-> (LinkStatus|Result<LinkStatus, String>|bool|ExtensionLink) \{/g)).toHaveLength(5);
  });

  it('받은 뒤의 「계정 새로 받기」는 화면이 잇는다 — 차례는 한 번만 가져가고, 계산 중에는 탭을 옮기지 않는다', () => {
    expect(link).toMatch(/pub fn take_pending\(&self\) -> bool \{\s*std::mem::take\(&mut lock\(&self\.activity\)\.pending\)/);
    expect(link).toContain('activity.pending |= reply == Reply::Received;');
    const rule = sources['../src/lib/extensionLink.ts'];
    expect(rule).toContain('export function arrivalStep(state: ArrivalState, input: ArrivalInput): ArrivalStep');
    expect(rule.match(/extensionLinkTakePending\(\)/g)).toHaveLength(1);
    const app = sources['../src/App.vue'];
    // (P-027: 계정 탭은 설정의 「계정 연결」 구획이 됐다 — 묻는 것과 시키는 것의 이름만 바뀌었다.)
    expect(app).toMatch(
      /provideExtensionLink\(\{\s*computing: \(\) => computingRun\.value !== null,\s*onAccount: \(\) => page\.value === 'settings' && nav\.section\.value === 'account',\s*openAccount: \(\) => nav\.openSettings\('account'\),\s*\}\);/,
    );
    expect(app).toContain('watch([computingRun, page, nav.section], () => extension.settle());');
    expect(app.match(/nav\.openSettings\('account'\)/g)).toHaveLength(1);
    // 계정 화면은 차례를 가져간 뒤에야 같은 「계정 새로 받기」를 돌린다. 쿠키는 화면에 오지 않는다.
    const screen = sources['../src/screens/AccountScreen.vue'];
    expect(screen).toMatch(/const mine = await extension\.claim\(\);\s*busy\.value = '';\s*if \(!mine\) return;/);
    expect(screen.match(/await fetchAccount\(\);/g)).toHaveLength(1);
    expect(rule).not.toMatch(/accountSaveCookie|cookie/i);
  });
});

describe('게임 창 추적·캡처(Rust)', () => {
  /** 주석을 뺀 코드. 금지한 호출을 주석에서 이름만 든 것은 세지 않는다. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const rustSources = {
    'game_win32.rs': gameWin32Rs,
    'game_window.rs': gameWindowRs,
    'capture.rs': captureRs,
    'capture_cli.rs': captureCliRs,
    'recognize.rs': recognizeRs,
    'screen_track.rs': screenTrackRs,
    'stay_on_top.rs': stayOnTopRs,
    'account_sync.rs': accountSyncRs,
    'cookie.rs': cookieRs,
    'login_window.rs': loginWindowRs,
    'extension_link.rs': extensionLinkRs,
    'lib.rs': libRs,
  };

  // 창 순서를 바꾸는 호출(SetWindowPos)은 여기 든 파일들 — 게임 창을 읽는 코드와 접착 코드 — 에 여전히 없다.
  // 게임 위에 머물기(P-024)가 쓰는 그 호출은 오버레이 창 모듈 한 곳에만 있고 대상은 오버레이 자신의 창뿐이다
  // (아래 「게임 위에 머물기(Rust)」가 확인한다).
  it('게임 창을 옮기거나 앞으로 가져오거나 입력을 보내는 호출이 없다', () => {
    const forbidden =
      /\b(SetWindowPos|MoveWindow|ShowWindow|ShowWindowAsync|SetForegroundWindow|BringWindowToTop|SetActiveWindow|SetFocus|SwitchToThisWindow|SetWindowPlacement|SetWindowLongW|SetWindowLongPtrW|SendInput|SendMessageW|SendMessageTimeoutW|PostMessageW|PostThreadMessageW|keybd_event|mouse_event|AttachThreadInput|SetCursorPos)\b/;
    for (const [file, source] of Object.entries(rustSources)) {
      expect(code(source), file).not.toMatch(forbidden);
    }
  });

  it('캡처는 Windows.Graphics.Capture뿐이다 — 게임 창에 그리기를 시키거나 화면을 통째로 복사하지 않는다', () => {
    expect(gameWin32Rs).toContain('IGraphicsCaptureItemInterop');
    expect(gameWin32Rs).toContain('CreateForWindow(hwnd)');
    for (const [file, source] of Object.entries(rustSources)) {
      expect(code(source), file).not.toMatch(/\b(PrintWindow|BitBlt|StretchBlt|WM_PRINT|WM_PRINTCLIENT)\b/);
    }
    expect(cargoToml).not.toMatch(/Win32_Storage_Xps/);
    expect(cargoToml).not.toMatch(/^\s*(xcap|windows-capture|screenshots|win-screenshot|scrap)\s*=/m);
  });

  it('게임 프로세스를 열거나 메모리를 읽거나 무엇을 주입하지 않는다', () => {
    const forbidden =
      /\b(OpenProcess|ReadProcessMemory|WriteProcessMemory|VirtualAllocEx|CreateRemoteThread|NtReadVirtualMemory|SetWindowsHookExW|QueueUserAPC|DebugActiveProcess)\b/;
    for (const [file, source] of Object.entries(rustSources)) {
      expect(code(source), file).not.toMatch(forbidden);
    }
    expect(cargoToml).not.toMatch(/Win32_System_Memory|Win32_System_Threading|Win32_System_Diagnostics_Debug|Win32_UI_Input/);
  });

  it('게임 창은 프로세스 이름으로 가린다 — 런처는 제목이 같아도 게임이 아니다', () => {
    expect(gameWindowRs).toContain('pub const GAME_PROCESS: &str = "nikke.exe";');
    expect(gameWindowRs).toContain('pub const LAUNCHER_PROCESS: &str = "nikke_launcher.exe";');
    expect(gameWindowRs).toContain('pub const GAME_TITLE: &str = "NIKKE";');
    // 규칙 모듈은 Win32를 모른다.
    expect(code(gameWindowRs)).not.toMatch(/windows::|HWND/);
    expect(code(captureRs)).not.toMatch(/windows::|HWND/);
  });

  it('화면은 저장할 폴더를 정하지 못한다 — 라벨만 넘긴다', () => {
    expect(captureRs).toContain('pub const ENV_CAPTURE_DIR: &str = "NIKKE_CAPTURE_DIR";');
    expect(libRs).toMatch(/capture::default_capture_dir\(\)/);
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/NIKKE_CAPTURE_DIR|capture_dir|captureDir|data\/captures/);
    }
  });

  it('캡처 폴더는 저장소에 올리지 않는다', () => {
    expect(gitignore.split(/\r?\n/)).toContain('data/captures/');
  });
});

describe('화면 인식(Rust)', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  /** `#[cfg(test)]` 앞까지 — 테스트 코드를 뺀 부분. */
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));

  it('인식 모듈은 순수하다 — 프레임만 받고 창·파일·프로세스·네트워크에 닿지 않는다', () => {
    const body = code(beforeTests(recognizeRs));
    expect(body).toContain('pub fn recognize(frame: &Frame) -> Recognition');
    expect(body).toContain('use crate::capture::Frame;');
    expect(body).not.toMatch(/windows::|HWND|std::fs|std::io|std::path|std::process|std::net|std::env|game_window|game_win32/);
    // 다른 모듈에서 가져오는 것은 프레임 하나뿐이다.
    expect(body.match(/use crate::/g)).toHaveLength(1);
  });

  it('OCR 엔진·ML 런타임·이미지 처리 라이브러리를 더하지 않았다', () => {
    expect(cargoToml).not.toMatch(/^\s*(tesseract|leptess|rusty-tesseract|ocrs|onnxruntime|ort|tract[\w-]*|candle[\w-]*|burn|tch|opencv|imageproc|image|template-matching)\s*=/m);
    expect(code(recognizeRs)).not.toMatch(/include_bytes!/);
  });

  it('게임 이미지 조각을 저장소에 두지 않는다 — 인식 코드에는 수치(자리 비율·색 범위)만 있다', () => {
    const images = import.meta.glob('../src-tauri/{src,tests}/**/*.{png,jpg,jpeg,bmp,webp,gif}');
    expect(Object.keys(images)).toEqual([]);
    expect(recognizeRs).toContain('pub const STRIP: Region = Region::new(');
    expect(recognizeRs).toContain('pub const STRIP_MIN: f32 =');
  });

  it('화면 비율로 자리를 정하고 16:9가 아닌 프레임은 판단하지 않는다', () => {
    expect(recognizeRs).toContain('pub const SUPPORTED_ASPECT: f64 = 16.0 / 9.0;');
    expect(recognizeRs).toContain('pub const ASPECT_TOLERANCE: f64 = 0.03;');
  });

  it('앱 명령은 찍은 프레임을 인식에만 쓴다 — 저장하지도 화면에 넘기지도 않는다', () => {
    const body = libRs.slice(libRs.indexOf('fn recognize_game('), libRs.indexOf('fn capture_from_shortcut('));
    expect(body).toMatch(/let \(frame, _method, _window\) = capture::grab_game_frame\(\)\?;\s*Ok\(recognize::recognize\(&frame\)\)/);
    expect(body).not.toMatch(/save_png|capture_game_to_dir|default_capture_dir|emit\(/);
    // 저장 없이 찍는 함수에는 저장하는 호출이 없다.
    const grab = captureRs.slice(captureRs.indexOf('pub fn grab_game_frame('), captureRs.indexOf('fn read_error('));
    expect(grab).toContain('game_window::capture_window(&window)');
    expect(grab).not.toMatch(/save_png|fs::/);
    // 인식 결과에는 이미지가 없다: 화면 종류·보스·신뢰도·근거·프레임 크기뿐이다.
    const result = recognizeRs.slice(recognizeRs.indexOf('pub struct Recognition {'), recognizeRs.indexOf('// ── 색'));
    expect(result.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual([
      'pub screen:',
      'pub boss:',
      'pub confidence:',
      'pub evidence:',
      'pub width:',
      'pub height:',
    ]);
  });

  it('명령줄의 --recognize-live도 저장하지 않는다', () => {
    const live = captureCliRs.slice(captureCliRs.indexOf('Command::RecognizeLive => {'), captureCliRs.indexOf('/// 명령을 실행하고 종료 코드를'));
    expect(live).toContain('game.frame()?');
    expect(live).not.toMatch(/game\.capture\(|save_png|default_dir/);
    expect(captureCliRs).toMatch(/fn frame\(&self\) -> Result<Frame, GameError> \{\s*capture::grab_game_frame\(\)\.map\(\|\(frame, _, _\)\| frame\)/);
  });
});

describe('화면 자동 추적(Rust)', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));
  /** 추적 스레드가 한 주기에 하는 일. */
  const readScreen = code(libRs.slice(libRs.indexOf('fn read_screen('), libRs.indexOf('fn emit_screen_track(')));
  const trackLoop = code(libRs.slice(libRs.indexOf('fn track_screen('), libRs.indexOf('fn start_screen_tracker(')));

  it('규칙 모듈은 순수하다 — 창·캡처·파일·스레드에 닿지 않는다', () => {
    const body = code(beforeTests(screenTrackRs));
    expect(body).not.toMatch(/windows::|HWND|std::fs|std::io|std::path|std::process|std::net|std::env|std::thread|game_win32|tauri/);
    expect(body).toContain('pub fn overlay_gate(enabled: bool, overlay_visible: bool) -> Result<(), Pause>');
    expect(body).toContain('pub fn game_gate(status: &GameWindowStatus) -> Result<&GameWindowInfo, Reading>');
    expect(body).toContain('pub fn observe(&mut self, reading: Reading, at: &str) -> bool');
  });

  it('꺼져 있거나 오버레이가 숨겨져 있으면 게임 창을 찾지도 않고, 게임 창이 떠 있을 때만 캡처한다', () => {
    const gate = readScreen.indexOf('screen_track::overlay_gate(settings.enabled, visible)');
    const locate = readScreen.indexOf('game_window::locate()');
    const game = readScreen.indexOf('screen_track::game_gate(&status)');
    const capture = readScreen.indexOf('game_window::capture_window(window)');
    expect(gate).toBeGreaterThan(-1);
    expect(locate).toBeGreaterThan(gate);
    expect(game).toBeGreaterThan(locate);
    expect(capture).toBeGreaterThan(game);
    // 오버레이가 보이는지는 오버레이 상태에서 읽는다.
    expect(readScreen).toContain('lock(&app.state::<Overlay>().state).visible');
    // 꺼져 있는 동안 추적 스레드는 깨울 때까지 잔다 — 창 열거도 캡처도 없다.
    expect(trackLoop).toMatch(/if !settings\.enabled \{\s*thread::park\(\);\s*continue;\s*\}/);
  });

  it('찍은 프레임은 인식에만 쓴다 — 저장하지도 화면에 넘기지도 않는다', () => {
    expect(readScreen).toMatch(/Ok\(\(frame, _method\)\) => \{\s*let recognition = recognize::recognize\(&frame\);/);
    expect(readScreen).not.toMatch(/save_png|capture_game_to_dir|default_capture_dir|fs::|emit\(/);
    // 화면에 가는 것은 상태뿐이다: 이 여덟 칸이고 이미지가 없다.
    const status = screenTrackRs.slice(screenTrackRs.indexOf('pub struct TrackStatus {'), screenTrackRs.indexOf('impl TrackStatus {'));
    expect(status.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual([
      'pub enabled:',
      'pub interval_ms:',
      'pub state:',
      'pub message:',
      'pub recognition:',
      'pub read_at:',
      'pub capture_ms:',
      'pub failures:',
    ]);
    // 화면 쪽 타입도 같은 여덟 칸이다.
    const types = sources['../src/types.ts'];
    const front = types.slice(types.indexOf('export interface ScreenTrackStatus {'), types.indexOf('/** 단축키로 저장한 결과'));
    expect(front.match(/^ {2}(\w+):/gm)?.map((f) => f.trim())).toEqual([
      'enabled:',
      'interval_ms:',
      'state:',
      'message:',
      'recognition:',
      'read_at:',
      'capture_ms:',
      'failures:',
    ]);
  });

  it('저장용 캡처와 겹치지 않는다 — 같은 표시를 쓰고, 겹치면 그 주기를 건너뛴다', () => {
    expect(readScreen).toMatch(/if game\.capturing\.swap\(true, Ordering::AcqRel\) \{\s*return Reading::Busy;\s*\}/);
    expect(readScreen).toContain('let _guard = BusyGuard(&game.capturing);');
  });

  it('결과가 바뀔 때만 화면에 알리고, 어떤 실패에도 추적 스레드는 끝나지 않는다', () => {
    // 알리는 것은 규칙이 「바뀌었다」고 할 때뿐이다.
    expect(trackLoop).toMatch(/log\.observe\(reading, &utc\.iso_utc\(\)\)\s*\.then\(\|\| log\.status\(\)\.clone\(\)\)/);
    expect(trackLoop).toMatch(/if let Some\(status\) = changed \{\s*emit_screen_track\(&app, status\);\s*\}/);
    expect(trackLoop.match(/emit_screen_track\(/g)).toHaveLength(1);
    // 끝없는 루프이고 빠져나가는 곳이 없다. 읽는 도중의 패닉도 상태로 바꾼다.
    expect(trackLoop).toMatch(/\bloop \{/);
    expect(trackLoop).not.toMatch(/\bbreak\b|\breturn\b|\.unwrap\(\)|\.expect\(|panic!/);
    expect(trackLoop).toContain('catch_unwind(AssertUnwindSafe(|| read_screen(&app, settings)))');
    // 캡처하는 동안에는 상태를 잠그지 않는다(상태 명령이 캡처를 기다리지 않는다).
    expect(trackLoop.indexOf('read_screen(&app, settings)')).toBeLessThan(trackLoop.indexOf('lock(&tracker.log)'));
  });

  it('캡처용 Direct3D 장치는 한 번 만들어 다시 쓴다 — 캡처 대상은 여전히 게임 창 하나뿐이다', () => {
    const win32 = code(gameWin32Rs);
    expect(win32).toContain('static CAPTURE_DEVICE: Mutex<Option<CaptureDevice>> = Mutex::new(None);');
    expect(win32.match(/CaptureDevice::create\(\)/g)).toHaveLength(1);
    // 캡처 API가 실패하면 장치를 버리고 다음에 새로 만든다.
    expect(win32).toMatch(/fn discards_device\(error: &GameError\) -> bool \{\s*matches!\(error, GameError::CaptureFailed \{ \.\. \}\)/);
    expect(win32.match(/CreateForWindow\(/g)).toHaveLength(1);
  });

  it('언제 보스를 바꾸는지의 규칙은 화면 쪽 순수 함수 하나다 — 화면들은 그 결과만 따른다', () => {
    const rule = sources['../src/lib/screenTrack.ts'];
    expect(rule).toContain('export function followStep(state: FollowState, status: ScreenTrackStatus | null | undefined, switchOn: boolean): FollowStep');
    // 화면을 옮기는 것은 App.vue, 보스를 고르는 것은 결과 그림(views/InterceptResult.vue — 고급의 예전 화면은 InterceptView.vue) —
    // 둘 다 규칙이 따라가라고 할 때만. (P-027: 요격전 탭은 왼쪽 메뉴의 요격전 화면이 됐다 — 묻는 것과 시키는 것의 이름만 바뀌었다.)
    // 언제 옮기고 언제 미루는지(계산 중)도 규칙(tabMoveStep)이 정한다(P-024): App.vue는 묻는 것에 답하고 시키는 대로 옮긴다.
    expect(rule).toContain('export function tabMoveStep(state: TabMoveState, input: TabMoveInput): TabMoveStep');
    const app = sources['../src/App.vue'];
    expect(app).toMatch(
      /provideScreenTrack\(\{\s*computing: \(\) => computingRun\.value !== null,\s*onIntercept: \(\) => page\.value === 'intercept',\s*moveToIntercept: \(\) => nav\.go\('intercept'\),\s*\}\);/,
    );
    expect(app).toContain('watch([computingRun, page, nav.section], () => track.settle());');
    // 요격전 화면으로 옮기는 곳은 그 한 줄뿐이고, App.vue는 자동 이동 설정을 직접 읽어 판단하지 않는다.
    expect(app.match(/nav\.go\('intercept'\)/g)).toHaveLength(1);
    expect(app).not.toMatch(/autoTab|tabMoveStep\(/);
    expect(rule.match(/host\.moveToIntercept\(\)/g)).toHaveLength(1);
    expect(rule).toMatch(/if \(step\.move\) host\.moveToIntercept\(\);/);
    expect(app).toContain('계산이 끝나면 요격전 화면으로 옮긴다');
    expect(sources['../src/components/InterceptView.vue']).toContain('watch(() => track.target.value?.seq, followTarget);');
    expect(sources['../src/views/InterceptResult.vue']).toContain('watch(() => track.target.value?.seq, followTarget);');
    // 오버레이 창은 보기만 한다: 추적을 켜거나 끄지 않는다.
    expect(sources['../src/Overlay.vue']).toMatch(/provideScreenTrack\(\{ computing: \(\) => false, onIntercept: \(\) => true, moveToIntercept: \(\) => \{\} \}, \{ passive: true \}\)/);
    const passive = rule.slice(rule.indexOf('async function watchOnly()'), rule.indexOf('return {\n    track:'));
    expect(passive).not.toMatch(/setScreenTracking|remember\(/);
    for (const [file, text] of Object.entries(sources)) {
      if (file === '../src/lib/screenTrack.ts') continue;
      // 인식 결과(화면 종류·보스)를 직접 읽어 따로 판단하는 화면이 없다.
      expect(text, file).not.toMatch(/recognition\.(screen|boss)\b|followStep\(/);
    }
    // 요격전 화면은 인식 결과로 계산을 시작하지 않는다: 실행은 단추와 입력 칸의 Enter뿐이다.
    const screen = sources['../src/screens/InterceptScreen.vue'];
    expect(screen.match(/@run="run"|@enter="run"/g)).toHaveLength(3);
    expect(screen).not.toMatch(/watch\(|onActivated\(|onMounted\(/);
    // 데스크톱 앱의 요격전 화면도 같다: 계산은 단추 하나로만 시작한다.
    const page = sources['../src/pages/InterceptPage.vue'];
    expect(page.match(/@click="run"/g)).toHaveLength(1);
    expect(page).not.toMatch(/watch\(|onActivated\(|onMounted\(/);
  });
});

describe('중복 실행 방지(Rust)', () => {
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const reveal = code(libRs.slice(libRs.indexOf('fn reveal_overlay('), libRs.indexOf('fn register_shortcuts(')));

  it('두 번째 실행을 막는 플러그인을 맨 먼저 등록한다 — 창을 만들고 단축키를 등록하기 전에 끝난다', () => {
    expect(cargoToml).toMatch(/^tauri-plugin-single-instance = "2"$/m);
    const run = code(libRs.slice(libRs.indexOf('pub fn run()')));
    const single = run.indexOf('.plugin(tauri_plugin_single_instance::init(');
    expect(single).toBeGreaterThan(-1);
    expect(run.match(/\.plugin\(/g)).toHaveLength(2);
    expect(single).toBeLessThan(run.indexOf('.plugin(tauri_plugin_global_shortcut'));
    expect(single).toBeLessThan(run.indexOf('register_shortcuts('));
    // 떠 있던 쪽이 하는 일은 하나다: 데스크톱 앱 창을 앞으로 가져온다. 실행 인자와 작업 폴더는 쓰지 않는다.
    // (P-027: 예전에는 오버레이를 활성화 없이 보였다 — 이제 사용자가 다시 실행한 것은 앱 창을 보려는 것이다. 오버레이 창과 게임 창은 건드리지 않는다.)
    expect(run).toMatch(/tauri_plugin_single_instance::init\(\|app, _args, _cwd\| \{\s*if let Err\(e\) = focus_app_window\(app\) \{\s*eprintln!\([^)]*\);\s*\}\s*\}\)/);
    const focus = code(libRs.slice(libRs.indexOf('fn focus_app_window('), libRs.indexOf('fn show_app_window(')));
    expect(focus).toContain('.get_webview_window(APP_WINDOW)');
    expect(focus).not.toMatch(/MAIN_WINDOW|game_window|game_win32/);
  });

  it('오버레이는 스스로 보일 때(게임 창을 찾았을 때) 활성화하지 않는다 — 포커스를 가져오는 호출이 없다', () => {
    expect(reveal).toContain('state.apply(OverlayAction::Show)');
    expect(reveal).toContain('show_overlay_without_activating(&window)');
    expect(reveal).not.toMatch(/\.show\(\)|set_focus|set_always_on_top|unminimize|request_user_attention/);
    expect(overlayStateRs).toMatch(/OverlayAction::Show => Self \{\s*visible: true,\s*\.\.self\s*\},/);
  });

  it('화면에서 부르는 것이 없어 권한을 더하지 않았다', () => {
    for (const p of [...capability.permissions, ...appCapability.permissions]) expect(p).not.toMatch(/single-instance/);
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/single[-_ ]?instance/i);
  });
});

describe('권한(capability)', () => {
  const allow = (commands: string[]) => commands.map((c) => `allow-${c.replaceAll('_', '-')}`);

  // P-027: 창이 둘이 되면서 권한도 창마다 나눴다 — 예전에는 오버레이 창 하나가 모든 명령을 가졌다.
  // P-028: 오버레이가 위젯이 되면서 끝내기 권한이 빠지고(명령 자체를 없앴다), 위젯 상태·계산 진행 읽기와 자기 창의 조작
  // (모양·핀·창 크기 맞춤·숨기기)이 들어왔다. 설정 바꾸기·자리 초기화·계산 진행 알리기는 여전히 이 창의 일이 아니다.
  it('오버레이 창은 쓰는 것만 허용한다 — 결과 읽기와 창 조작뿐이다', () => {
    expect([...capability.permissions].sort()).toEqual(
      ['core:event:allow-listen', 'core:event:allow-unlisten', 'core:window:allow-start-dragging', ...allow(OVERLAY_COMMANDS)].sort(),
    );
    expect(capability.windows).toEqual(['main']);
    // 계산 실행·계정 받기(쿠키·수집·로그인 창·크롬 확장 연결)·파일 읽기와 고르기·설정 바꾸기·화면 저장은 이 창의 일이 아니다.
    for (const p of capability.permissions) {
      expect(p).not.toMatch(/^allow-(engine-run|engine-cancel|engine-version|account-|login-window-|extension-link-|read-json|pick-json|load-report|capture-|recognize-|set-|save-|read-account|reset-|announce-|quit)/);
    }
    for (const cmd of WIDGET_APP_ONLY) {
      expect(capability.permissions, cmd).not.toContain(allow([cmd])[0]);
      expect(appCapability.permissions, cmd).toContain(allow([cmd])[0]);
    }
    expect(OVERLAY_COMMANDS).toHaveLength(15);
    // P-029: 요격전 기록·즐겨찾기를 읽고 쓰는 것은 데스크톱 앱 창의 일이다 — 오버레이 창에는 읽기 권한도 없다.
    for (const cmd of PLAN_COMMANDS) {
      expect(capability.permissions, cmd).not.toContain(allow([cmd])[0]);
      expect(appCapability.permissions, cmd).toContain(allow([cmd])[0]);
    }
    // P-030: 편성을 저장하고 클립보드에 쓰는 것도 데스크톱 앱 창의 일이다 — 게임 위의 오버레이 창은 클립보드를 건드리지 못한다.
    for (const cmd of DECK_COMMANDS) {
      expect(capability.permissions, cmd).not.toContain(allow([cmd])[0]);
      expect(appCapability.permissions, cmd).toContain(allow([cmd])[0]);
    }
  });

  it('클립보드는 쓰기만 한다 — 플러그인이 아니라 앱 명령 하나이고, 읽는 명령도 읽는 코드도 없다', () => {
    // 클립보드 플러그인을 쓰면 읽기 권한이 함께 생길 수 있다. 쓰기 한 가지만 앱 명령(copy_text)으로 만들었다.
    expect(cargoToml).not.toMatch(/tauri-plugin-clipboard/);
    expect(libRs).not.toMatch(/tauri_plugin_clipboard/);
    for (const p of [...capability.permissions, ...appCapability.permissions]) expect(p).not.toMatch(/clipboard/);
    expect(appCapability.permissions.filter((p) => /copy|paste/.test(p))).toEqual(['allow-copy-text']);
    expect(libRs).toContain('async fn copy_text(text: String) -> Result<(), String>');
    expect(libRs).toContain('clipboard::write_text(&text)');
    expect(COMMANDS.filter((c) => /clipboard|paste|read_text/.test(c))).toEqual([]);
    // Rust 소스 어디에도 클립보드를 읽는 호출이 없다(쓴 것을 확인하는 읽기는 통합 테스트 tests/live_clipboard.rs에만 있다).
    const noComments = (text: string) =>
      text
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
    for (const [file, text] of Object.entries(allRust)) {
      expect(noComments(text), file).not.toMatch(/GetClipboardData|EnumClipboardFormats|IsClipboardFormatAvailable|GetClipboardOwner|AddClipboardFormatListener/);
    }
    // 쓰는 것은 유니코드 글자 하나뿐이고, 길이에 상한이 있다. 넘길 메모리 덩이는 COM의 메모리 스트림으로 만든다 —
    // 메모리를 직접 잡고 잠그는 API(그 기능 묶음은 「게임 프로세스를 열거나 메모리를 읽거나…」가 금지한다)는 쓰지 않는다.
    expect(clipboardRs).toContain('pub const MAX_CHARS: usize = 4000;');
    expect(clipboardRs).toContain('const UNICODE_TEXT: u32 = 13;');
    expect(noComments(clipboardRs).match(/SetClipboardData\(/g)).toHaveLength(1);
    expect(noComments(clipboardRs)).toContain('CreateStreamOnHGlobal(HGLOBAL::default(), false)');
    expect(noComments(clipboardRs)).not.toMatch(/GlobalAlloc|GlobalLock|GlobalUnlock/);
    // 클립보드를 여는 창 핸들을 넘기지 않는다 — 어느 창도 클립보드의 주인이 되지 않는다(게임 창은 물론 이 앱의 창도).
    expect(noComments(clipboardRs)).toContain('OpenClipboard(None)');
    expect(noComments(clipboardRs)).not.toMatch(/HWND|game_win32|game_window/);
    // 화면 코드도 브라우저의 클립보드 API를 쓰지 않는다 — 읽기(붙여넣기)를 부를 길이 없다.
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/navigator\.clipboard|execCommand/);
  });

  it('데스크톱 앱 창은 쓰는 것만 허용한다 — 창 끌기와 끝내기 명령은 없다', () => {
    const forApp = COMMANDS.filter((c) => !NOT_FOR_APP.includes(c));
    expect([...appCapability.permissions].sort()).toEqual(['core:event:allow-listen', 'core:event:allow-unlisten', ...allow(forApp)].sort());
    expect(appCapability.windows).toEqual(['app']);
    // P-028: 38 → 42(위젯 상태 읽기·오버레이 설정 바꾸기·자리 초기화·계산 진행 알리기).
    // P-029: 42 → 44(요격전 계획 읽기·저장 — 손으로 적은 기록과 즐겨찾기를 계정 폴더에 둔다).
    // P-030: 44 → 47(덱 빌더 — 저장한 편성 읽기·저장, 편성을 글자로 클립보드에 쓰기).
    expect(forApp).toHaveLength(47);
    // 끝내기 명령은 어느 창에도 없다 — 앱에 그런 명령이 없다.
    for (const p of [...capability.permissions, ...appCapability.permissions]) expect(p).not.toMatch(/quit|exit/);
    expect(COMMANDS).not.toContain('quit_app');
    expect(buildRs).not.toContain('"quit_app"');
  });

  it('두 창의 권한을 합치면 앱 명령 전부다 — 어느 창도 부르지 못하는 명령이나 목록에 없는 권한이 없다', () => {
    const granted = new Set([...capability.permissions, ...appCapability.permissions].filter((p) => p.startsWith('allow-')));
    expect([...granted].sort()).toEqual(allow(COMMANDS).sort());
  });

  it('묶음 권한(default)이나 파일·셸·네트워크 권한이 없다', () => {
    for (const p of [...capability.permissions, ...appCapability.permissions]) {
      expect(p).not.toMatch(/default$/);
      expect(p).not.toMatch(/^(fs|shell|http|websocket|opener|process|dialog|updater):/);
    }
  });

  it('설정이 이 두 capability만 쓴다', () => {
    expect(tauriConf.app.security.capabilities).toEqual([capability.identifier, appCapability.identifier]);
  });
});

describe('엔진 호출(Rust)', () => {
  it('엔진은 python -m runner.sim --batch로, UTF-8로, 최대 4개 프로세스로 띄운다', () => {
    expect(engineRs).toContain('.args(["-m", "runner.sim", "--batch"])');
    expect(engineRs).toContain('.env("PYTHONUTF8", "1")');
    expect(engineRs).toContain('pub const MAX_WORKERS: usize = 4;');
  });

  it('화면은 엔진 폴더·python 경로를 넘기지 않는다 — 설정값이다', () => {
    // 화면이 실행할 프로그램을 정할 수 있으면 임의의 프로그램을 띄울 수 있다.
    for (const cmd of ['engine_catalog', 'engine_version']) {
      expect(libRs, cmd).toMatch(new RegExp(`async fn ${cmd}\\(app: AppHandle\\)`));
    }
    expect(engineRs).toContain('pub const ENV_ENGINE_DIR: &str = "NIKKE_ENGINE_DIR";');
    expect(engineRs).toContain('pub const ENV_PYTHON: &str = "NIKKE_PYTHON";');
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/engine_dir|engineDir|NIKKE_PYTHON|runner\.sim/);
    }
  });

  it('계산 로직을 Rust로 다시 쓰지 않았다 — 엔진 요청을 만들고 결과를 해석하는 것은 루트의 src/core다', () => {
    for (const rust of [engineRs, libRs]) {
      expect(rust).not.toMatch(/total_damage|burst_stage|skill_levels|relative_to_best/);
    }
    expect(sources['../src/lib/compute.ts']).toContain("from '@core/candidates.mjs'");
    expect(sources['../src/lib/compute.ts']).toContain("from '@core/compare.mjs'");
  });

  it('요격전·성장 비교·티어 화면도 계산 로직을 다시 쓰지 않았다 — 루트의 src/core·src/tier 함수를 그대로 부른다', () => {
    const compute = sources['../src/lib/compute.ts'];
    expect(compute).toMatch(/import \{[^}]*\brecommendIntercept\b[^}]*\} from '@core\/intercept\.mjs'/);
    expect(compute).toMatch(/import \{[^}]*\bcompareGrowth\b[^}]*\} from '@core\/growth\.mjs'/);
    expect(compute).toMatch(/await recommendIntercept\(/);
    expect(compute).toMatch(/await compareGrowth\(/);
    // 결과의 판 번호·상태 이름·버스트 묶음 규칙·탐색 요약 문장은 루트 모듈의 것을 가져다 쓴다.
    expect(sources['../src/lib/reports.ts']).toContain("from '@tier/evaluate.mjs'");
    expect(sources['../src/lib/reports.ts']).toContain("from '@core/intercept.mjs'");
    expect(sources['../src/lib/reports.ts']).toContain("from '@core/growth.mjs'");
    expect(sources['../src/components/TierView.vue']).toContain("import { STATUS_HOLD, STATUS_PREDICTED } from '@tier/evaluate.mjs'");
    expect(sources['../src/components/TierView.vue']).toContain("import { burstOrderGroup } from '@core/search.mjs'");
    expect(sources['../src/components/InterceptView.vue']).toContain("import { searchLine } from '@core/render.mjs'");
    // 화면 코드에는 계산(등급 매기기·속성 상성·증가율·엔진 요청 만들기)이 없다.
    for (const [file, text] of Object.entries(sources)) {
      if (!/\/(components|screens)\//.test(file)) continue;
      expect(text, file).not.toMatch(/\bgradeOf\b|ELEMENT_ADVANTAGE|\bgainRate\b|\bbuildTier\b|\btierRequest\b|profile_level|\.runBatch\(/);
    }
    // 티어 화면은 결과 파일을 읽기만 한다 — 엔진을 부르는 실행 상태를 쓰지 않는다.
    expect(sources['../src/screens/TierScreen.vue']).not.toMatch(/useEngineRun|RunButtons|compute'/);
  });

  it('새 화면을 위해 Rust 명령이나 권한을 더하지 않았다 — 결과 파일은 read_json_file로 읽는다', () => {
    // 화면 넷(P-017)까지는 14개였다. 그 뒤에 더한 것은 자동 추적(P-021)의 둘 — 켜기/끄기와 상태 — 과
    // 계정 받기(P-022)의 아홉(계정 화면은 쿠키 파일·수집 프로세스·로그인 창을 다뤄 명령이 필요하다),
    // 크롬 확장 연결(P-025)의 넷이다(수신부를 켜고 끄기·상태·연결 코드 다시 만들기·받은 쿠키로 수집 잇기 — 25 → 29).
    // 게임 이미지(P-026)의 셋: 화면에는 파일 권한이 없어 초상화·보스 이미지·아이콘을 Rust가 읽어 넘긴다(29 → 32).
    // 니케 정보(속성·버스트 단계 등)는 명령을 더하지 않고 이미 있는 engine_catalog에서 읽는다.
    // 두 창이 함께 보는 것(P-027)의 여덟: 기본 계정·오버레이를 띄우는 때·마지막 요격전 결과를 디스크(계정 폴더)에 두고 읽는 명령 여섯과,
    // 앱 창을 앞으로 가져오기·오버레이 보이기/숨기기(32 → 40). 화면은 여전히 폴더·파일 이름을 넘기지 않는다.
    // 오버레이 위젯(P-028)의 아홉에서 끝내기 하나를 뺐다(40 − 1 + 9 = 48): 위젯 상태 읽기, 자기 창의 조작 넷(모양·핀·창 크기 맞춤·숨기기),
    // 앱 창의 것 셋(설정 바꾸기·자리 초기화·계산 진행 알리기), 계산 진행 읽기. 화면은 여전히 폴더·파일 이름도 창의 자리도 넘기지 않는다.
    // 요격전 계획(P-029)의 둘: 손으로 적은 요격전 기록·즐겨찾기를 계정 폴더에 계정마다 두고 읽는다(48 → 50). 화면이 넘기는 계정 이름은 경로가 아니다.
    // 덱 빌더(P-030)의 셋: 저장한 편성을 계정 폴더에 계정마다 두고 읽는 둘과, 편성을 글자로 클립보드에 쓰는 하나(50 → 53).
    // 계산에는 명령을 더하지 않았다 — 덱 빌더의 계산은 이미 있는 engine_run_batch로 돈다.
    expect(COMMANDS).toHaveLength(53);
    expect(DECK_COMMANDS).toEqual(['load_decks', 'save_decks', 'copy_text']);
    expect(libRs).toContain('async fn load_decks(name: Option<String>) -> Result<Option<Value>, String>');
    expect(libRs).toContain('async fn save_decks(name: Option<String>, decks: Value) -> Result<(), String>');
    expect(sources['../src/lib/compute.ts']).toMatch(/import \{[^}]*\bevaluateDeck\b[^}]*\} from '@core\/deck\.mjs'/);
    expect(PLAN_COMMANDS).toEqual(['load_plan', 'save_plan']);
    expect(libRs).toContain('async fn load_plan(name: Option<String>) -> Result<Option<Value>, String>');
    expect(libRs).toContain('async fn save_plan(name: Option<String>, plan: Value) -> Result<(), String>');
    expect(WIDGET_COMMANDS).toEqual([
      'overlay_widget',
      'overlay_shape',
      'overlay_pin',
      'overlay_fit',
      'overlay_hide',
      'set_overlay_prefs',
      'reset_overlay_position',
      'announce_activity',
      'compute_activity',
    ]);
    expect(IMAGE_COMMANDS).toEqual(['nikke_portrait', 'boss_image', 'game_icon']);
    expect(SHARED_COMMANDS).toEqual([
      'shared_state',
      'set_default_account',
      'set_overlay_launch',
      'read_account',
      'save_intercept_result',
      'load_intercept_result',
      'show_app_window',
      'set_overlay_visible',
    ]);
    expect(COMMANDS.slice(14, 16)).toEqual(['set_screen_tracking', 'screen_track_status']);
    expect(ACCOUNT_COMMANDS).toHaveLength(9);
    for (const cmd of ACCOUNT_COMMANDS) expect(cmd).toMatch(/^(account|login_window)_/);
    expect(EXTENSION_COMMANDS).toHaveLength(4);
    for (const cmd of EXTENSION_COMMANDS) expect(cmd).toMatch(/^extension_link_/);
    expect(sources['../src/lib/resultFile.ts']).toContain('await readJsonFile(target)');
    // Tauri API를 직접 부르는 곳은 여전히 lib/backend.ts 하나다.
    for (const [file, text] of Object.entries(sources)) {
      if (file === '../src/lib/backend.ts') continue;
      expect(text, file).not.toMatch(/@tauri-apps\/api/);
    }
  });

  it('파일 고르기 창은 대화 상자 플러그인이 아니라 앱 명령 하나로만 연다', () => {
    expect(cargoToml).not.toMatch(/tauri-plugin-(dialog|fs|shell|http|opener)/);
    expect(libRs).not.toMatch(/tauri_plugin_(dialog|fs|shell|http|opener)/);
  });

  it('중단: 배치 명령은 자리(BatchSlot)의 신호로 돌고, 중단 명령은 그 자리를 멈춘다', () => {
    expect(libRs).toContain('struct EngineRun(engine::BatchSlot);');
    expect(libRs).toMatch(/run\.0\.begin\(\)/);
    expect(libRs).toMatch(/engine::run_batch_with_stop\(&config, &requests, Some\(&progress\), ticket\.signal\(\)\)/);
    expect(libRs).toMatch(/fn engine_cancel\([^)]*\) -> bool \{\s*run\.0\.stop\(\)\s*\}/);
    // 중단으로 끝난 배치의 오류는 '중단됨'으로 시작한다.
    expect(engineRs).toContain('pub const STOPPED_PREFIX: &str = "중단됨";');
    expect(engineRs).toContain('Self::Stopped => write!(f, "{STOPPED_PREFIX}: 엔진 계산을 멈췄다")');
  });

  it('엔진 프로세스 묶음은 앱이 띄운 프로세스만 다룬다 — 다른 프로세스를 열지 않는다', () => {
    const code = engineWin32Rs
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).toContain('AssignProcessToJobObject(job, HANDLE(child.as_raw_handle()))');
    expect(code).toContain('TerminateJobObject');
    expect(code).not.toMatch(/\b(OpenProcess|OpenJobObjectW|ReadProcessMemory|WriteProcessMemory|CreateRemoteThread|EnumProcesses|TerminateProcess)\b/);
    // 엔진을 멈추는 길은 하나다: 묶음을 끝내고 띄운 프로세스를 끝낸다.
    expect(engineRs).toMatch(/fn kill_engine\(child: &mut Child, group: &ProcessGroup\) \{\s*group\.terminate\(\);\s*let _ = child\.kill\(\);\s*let _ = child\.wait\(\);/);
  });
});

describe('오버레이 창 — 활성화 없이 보이기, 파일 고르기 창의 부모(Rust)', () => {
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

  it("전환 규칙에 '보일 때 활성화하지 않는다'가 있고, 접착 코드는 그 규칙대로만 창을 보인다", () => {
    expect(overlayStateRs).toContain('ShowWithoutActivating');
    expect(overlayStateRs).toContain('pub fn visibility_change(&self) -> Option<VisibilityChange>');
    const apply = libRs.slice(libRs.indexOf('fn apply_transition('), libRs.indexOf('fn handle_action('));
    expect(apply).toContain('Some(VisibilityChange::ShowWithoutActivating) => show_overlay_without_activating(window)');
    expect(apply).toContain('Some(VisibilityChange::Hide) => hide_overlay(window)');
    // Windows에서는 Win32의 활성화 없는 표시로, 그 밖에서는 창 라이브러리의 기존 동작으로.
    expect(apply).toMatch(/#\[cfg\(windows\)\]\s*fn show_overlay_without_activating\([^)]*\) -> Result<\(\), String> \{\s*overlay_win32::show_without_activating\(window\)/);
    expect(apply).toMatch(/#\[cfg\(not\(windows\)\)\]\s*fn show_overlay_without_activating\([^)]*\) -> Result<\(\), String> \{\s*window\.show\(\)/);
    // 단축키 처리에서 창 라이브러리의 show()(활성화한다)는 Windows가 아닐 때만 남아 있다.
    expect(code(apply).match(/window\.show\(\)/g)).toHaveLength(1);
    // 시작할 때 한 번 보이는 것 말고는 접착 코드 어디에도 show()가 없다.
    expect(code(libRs).match(/window\.show\(\)/g)).toHaveLength(2);
  });

  it('창에 반영하는 코드는 활성화 없는 표시(SW_SHOWNA)를 쓰고, 앞으로 가져오거나 포커스를 주지 않는다', () => {
    const win32 = code(overlayWin32Rs);
    expect(win32).toContain('pub const SHOW_COMMAND: SHOW_WINDOW_CMD = SW_SHOWNA;');
    expect(win32).toContain('pub const HIDE_COMMAND: SHOW_WINDOW_CMD = SW_HIDE;');
    expect(win32).toContain('ShowWindowAsync(HWND(hwnd as _), command)');
    // 활성화하는 표시 방법과 포커스·전경을 바꾸는 호출이 없다.
    // (P-024에서 요구가 바뀌었다: 창 순서를 올리는 SetWindowPos는 이제 쓴다 — 오버레이 자신의 창에만, 활성화 없이.
    //  그 약속은 아래 「게임 위에 머물기(Rust)」가 따로 확인한다. 활성화·포커스·입력 호출은 여전히 없다.)
    expect(win32).not.toMatch(/\b(SW_SHOW|SW_SHOWNORMAL|SW_RESTORE|SW_SHOWDEFAULT|SW_SHOWMAXIMIZED|SW_SHOWMINIMIZED)\b/);
    expect(win32).not.toMatch(
      /\b(SetForegroundWindow|BringWindowToTop|SetActiveWindow|SetFocus|SwitchToThisWindow|MoveWindow|SetWindowPlacement|AttachThreadInput|SendInput|SendMessageW|PostMessageW|keybd_event|mouse_event)\b/,
    );
  });

  it('오버레이 창 모듈은 오버레이 창의 핸들만 쓴다 — 다른 창을 찾지 않는다', () => {
    const win32 = code(overlayWin32Rs);
    expect(win32).toContain('.hwnd()');
    expect(win32).not.toMatch(/\b(FindWindowW|FindWindowExW|EnumWindows|GetForegroundWindow|WindowFromPoint)\b/);
    expect(win32).not.toMatch(/game_window|game_win32|nikke\.exe/);
    // 창의 주인을 읽는 호출은 한 곳뿐이다: 「이 창이 이 프로세스의 창인가」를 확인하는 데만 쓴다(P-024 — 다른 창을 찾는 데 쓰지 않는다).
    expect(win32.match(/GetWindowThreadProcessId\(/g)).toHaveLength(1);
    expect(win32).toMatch(
      /fn belongs_to_this_process\(hwnd: isize\) -> bool \{[\s\S]*?GetWindowThreadProcessId\(HWND\(hwnd as _\), Some\(&mut pid\)\)[\s\S]*?thread != 0 && pid == std::process::id\(\)\s*\}/,
    );
  });

  it('파일 고르기 창은 오버레이 창을 부모로 연다', () => {
    // 명령은 오버레이 창을 받아, 그 창의 핸들을 부모로 넘긴다. 핸들을 얻지 못하면 부모 없이 띄우지 않는다.
    expect(libRs).toMatch(/async fn pick_json_file\(window: WebviewWindow, title: String\)/);
    expect(libRs).toMatch(/let parent = overlay_win32::dialog_parent\(window\)\?;\s*let picked = overlay_win32::pick_json_file\(&parent, title\);/);
    const win32 = code(overlayWin32Rs);
    expect(win32).toMatch(/pub\(crate\) fn dialog_parent\(window: &WebviewWindow\) -> Result<DialogParent, String> \{\s*DialogParent::from_handle\(overlay_handle\(window\)\?\)/);
    expect(win32).toMatch(/rfd::FileDialog::new\(\)\s*\.set_title\(title\)\s*\.add_filter\("JSON", &\["json"\]\)\s*\.set_parent\(parent\)\s*\.pick_file\(\)/);
    // 대화 상자를 띄우는 곳은 한 곳뿐이다.
    expect((code(libRs) + win32).match(/rfd::/g)).toHaveLength(1);
  });
});

describe('게임 위에 머물기(Rust)', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));
  const win32 = code(beforeTests(overlayWin32Rs));
  const rule = code(beforeTests(stayOnTopRs));
  const keep = code(libRs.slice(libRs.indexOf('fn keep_overlay_on_top('), libRs.indexOf('/// Windows가 아니면 게임 창을 읽지 못하므로')));
  const trackLoop = code(libRs.slice(libRs.indexOf('fn track_game('), libRs.indexOf('fn wake_game_tracker(')));

  it('창 순서를 바꾸는 호출은 앱 전체에서 한 곳뿐이다 — 오버레이 창 모듈의, 우리 창만 받는 함수 안이다', () => {
    const files = Object.entries(allRust);
    expect(files.length).toBeGreaterThan(12);
    for (const [file, source] of files) {
      const calls = code(source).match(/\bSetWindowPos\(/g) ?? [];
      expect(calls, file).toHaveLength(file.endsWith('/overlay_win32.rs') ? 1 : 0);
      // 창 순서·자리·활성 상태를 바꾸는 다른 호출은 어디에도 없다(보임/숨김의 ShowWindowAsync는 오버레이 창 모듈에만 있다).
      expect(code(source), file).not.toMatch(
        /\b(DeferWindowPos|BeginDeferWindowPos|BringWindowToTop|SetForegroundWindow|SetActiveWindow|SwitchToThisWindow|MoveWindow|SetWindowPlacement)\b/,
      );
    }
    // 그 한 곳: `OverlayWindow`의 메서드이고, 대상은 self(이 프로세스의 창)다. 활성화 없이 맨 위로만 올린다.
    expect(win32).toMatch(
      /pub fn raise_without_activating\(&self\) -> bool \{\s*unsafe \{ SetWindowPos\(HWND\(self\.0 as _\), Some\(HWND_TOPMOST\), 0, 0, 0, 0, RAISE_FLAGS\) \}\.is_ok\(\)\s*\}/,
    );
    expect(win32).toMatch(
      /pub const RAISE_FLAGS: SET_WINDOW_POS_FLAGS = SET_WINDOW_POS_FLAGS\(\s*SWP_NOMOVE\.0 \| SWP_NOSIZE\.0 \| SWP_NOACTIVATE\.0 \| SWP_ASYNCWINDOWPOS\.0,\s*\);/,
    );
    // 숨긴 창을 보이게 하거나 크기·자리를 바꾸는 표시는 쓰지 않는다.
    expect(win32).not.toMatch(/\b(SWP_SHOWWINDOW|SWP_HIDEWINDOW|SWP_FRAMECHANGED|HWND_TOP\b|HWND_BOTTOM|HWND_NOTOPMOST)/);
  });

  it('올릴 수 있는 창은 이 프로세스의 창뿐이다 — 다른 프로그램(게임)의 창 핸들로는 OverlayWindow를 만들 수 없다', () => {
    // 안의 핸들은 비공개이고, 만드는 길은 둘뿐이며 둘 다 「이 프로세스의 창인가」를 거친다.
    expect(win32).toMatch(/pub struct OverlayWindow\(isize\);/);
    expect(win32.match(/Self\(hwnd\)/g)).toHaveLength(1);
    // 타입 선언 말고는 `OverlayWindow(…)`로 직접 만드는 곳이 없다.
    expect(win32.match(/OverlayWindow\(/g)).toHaveLength(1);
    expect(win32).toMatch(/pub fn own\(hwnd: isize\) -> Option<Self> \{\s*belongs_to_this_process\(hwnd\)\.then_some\(Self\(hwnd\)\)\s*\}/);
    expect(win32).toMatch(/pub\(crate\) fn of\(window: &WebviewWindow\) -> Result<Self, String> \{\s*Self::own\(overlay_handle\(window\)\?\)/);
    // 창 순서는 읽기만 한다: 우리 창에서 위쪽으로 따라 올라가며 핸들 값을 모은다.
    expect(win32).toMatch(/pub fn windows_above\(&self\) -> Option<Vec<isize>>/);
    expect(win32.match(/GetWindow\(/g)).toHaveLength(1);
    expect(win32).toContain('GetWindow(current, GW_HWNDPREV)');
  });

  it('접착 코드는 오버레이 창(main)으로만 OverlayWindow를 만들고, 규칙이 올리라고 할 때만 올린다', () => {
    const glue = code(libRs);
    expect(glue.match(/OverlayWindow::of\(/g)).toHaveLength(1);
    expect(glue).not.toMatch(/OverlayWindow::own\(/);
    expect(keep).toMatch(
      /\.get_webview_window\(MAIN_WINDOW\)\s*\.and_then\(\|window\| overlay_win32::OverlayWindow::of\(&window\)\.ok\(\)\);/,
    );
    expect(glue.match(/raise_without_activating\(\)/g)).toHaveLength(1);
    expect(keep).toMatch(
      /let decision = rule\.step\(overlay_visible, status, \|\| own\.windows_above\(\)\);\s*if decision == stay_on_top::Decision::Raise && !own\.raise_without_activating\(\) \{/,
    );
    // 게임 창의 핸들은 규칙에 넘기는 창 정보 안의 수일 뿐이다 — 그 핸들로 부르는 호출이 없다.
    expect(keep).not.toMatch(/hwnd|HWND|game_win32/);
    // 추적 스레드가 주기마다 본다 — 붙이기와 무관하게. 오버레이가 보이는지는 오버레이 상태에서 읽는다.
    expect(trackLoop).toContain('let overlay_visible = lock(&app.state::<Overlay>().state).visible;');
    expect(trackLoop).toContain('keep_overlay_on_top(&app, &mut on_top, &mut overlay_window, overlay_visible, &status);');
    expect(trackLoop).toContain('let pause = stay_on_top::watch_interval(follow, overlay_visible, &status);');
    expect(trackLoop).toContain('thread::park_timeout(pause);');
  });

  it('언제 올릴지의 규칙은 순수하다 — 창·프로세스·스레드에 닿지 않고, 확인 주기는 0.3초 안쪽이다', () => {
    expect(rule).not.toMatch(/windows::|HWND|std::fs|std::io|std::path|std::process|std::net|std::env|std::thread|game_win32|overlay_win32|tauri/);
    expect(rule).toContain('pub fn stacking(above_overlay: Option<&[isize]>, game: isize) -> Stacking');
    expect(rule).toContain('pub fn gate(overlay_visible: bool, game: &GameWindowStatus) -> Result<&GameWindowInfo, Leave>');
    expect(rule).toContain('pub fn watch_interval(follow: bool, overlay_visible: bool, game: &GameWindowStatus) -> Duration');
    expect(stayOnTopRs).toContain('pub const WATCH_INTERVAL: Duration = Duration::from_millis(100);');
    expect(stayOnTopRs).toContain('pub const FOLLOW_INTERVAL: Duration = Duration::from_millis(50);');
    expect(stayOnTopRs).toContain('pub const MAX_DELAY: Duration = Duration::from_millis(300);');
    // 이벤트를 듣는 방식(창 훅)은 쓰지 않는다 — 다른 프로세스에 무엇을 넣지 않는다.
    for (const [file, source] of Object.entries(allRust)) {
      expect(code(source), file).not.toMatch(/\b(SetWinEventHook|SetWindowsHookExW|SetWindowsHookExA|RegisterShellHookWindow)\b/);
    }
  });

  it('붙이기의 가장자리 규칙도 순수 함수다 — 최소화된 창의 자리로는 따라가지 않고, 게임이 없으면 기다린다', () => {
    expect(gameWindowRs).toContain('pub const PARKED_COORDINATE: i32 = -30000;');
    expect(gameWindowRs).toContain('pub fn follow_step(target: Option<(i32, i32)>, last_applied: Option<(i32, i32)>) -> FollowStep');
    expect(code(gameWindowRs)).toMatch(/if window\.minimized \|\| window\.client\.is_empty\(\) \|\| is_parked\(window\.client\) \{\s*return None;/);
    const follow = code(libRs.slice(libRs.indexOf('fn follow_game('), libRs.indexOf('/// 게임 위에 머물기에 쓰는 오버레이 창.')));
    expect(follow).toContain('match (follow_step(target, applied), window) {');
    // 붙이기가 옮기는 것은 오버레이 창(main)뿐이다. 붙이기 스위치는 규칙이 끄지 않는다(게임이 없어도 켜진 채 기다린다).
    expect(follow).toContain('app.get_webview_window(MAIN_WINDOW)');
    expect(follow.match(/\.set_position\(/g)).toHaveLength(1);
    expect(follow).not.toMatch(/follow\.store|tracker\.follow/);
  });
});

describe('종료 시 정리(Rust)', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));
  const job = code(beforeTests(engineWin32Rs));
  const glue = code(libRs);

  it('프로세스 묶음(Job Object)은 닫히면 안의 프로세스를 끝낸다 — 앱이 어떻게 끝나든 엔진·수집 프로세스가 함께 끝난다', () => {
    expect(job).toContain('info.basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;');
    expect(job).toMatch(/SetInformationJobObject\(\s*job,\s*JobObjectExtendedLimitInformation,/);
    // 프로세스를 넣기 전에 건다.
    const adopt = job.slice(job.indexOf('pub(crate) fn adopt('), job.indexOf('pub(crate) fn terminate('));
    expect(adopt.indexOf('kill_on_close(job)')).toBeGreaterThan(-1);
    expect(adopt.indexOf('kill_on_close(job)')).toBeLessThan(adopt.indexOf('AssignProcessToJobObject('));
    // Job은 이름이 없고 기본 보안 속성으로 만든다 — 핸들을 자식에게 물려주지 않고, 다른 프로세스가 열 수 없다.
    expect(job).toContain('CreateJobObjectW(None, PCWSTR::null())');
    // 엔진 계산과 계정 수집 모두 띄운 프로세스를 이 묶음에 넣는다.
    expect(code(engineRs)).toContain('let group = ProcessGroup::adopt(&child);');
    expect(code(accountSyncRs)).toContain('let group = ProcessGroup::adopt(&child);');
    // 다른 프로세스를 여는 호출이 딸린 기능은 여전히 켜지 않았다(구조체 모양을 직접 적었다).
    expect(cargoToml).not.toMatch(/Win32_System_Threading/);
  });

  it('앱이 끝나는 길에서 도는 엔진 계산과 계정 수집을 멈추고 끝나기를 잠깐 기다린다', () => {
    expect(engineRs).toContain('pub fn stop_all_and_wait(slots: &[&BatchSlot], grace: Duration) -> bool');
    expect(engineRs).toContain('pub const EXIT_GRACE: Duration = Duration::from_secs(3);');
    expect(glue).toMatch(
      /fn stop_running_work\(app: &AppHandle\) \{\s*let engine_run = app\.state::<EngineRun>\(\);\s*let fetch_run = app\.state::<FetchRun>\(\);\s*if !engine::stop_all_and_wait\(&\[&engine_run\.0, &fetch_run\.0\], engine::EXIT_GRACE\)/,
    );
    // 앱 창을 닫는 길이 앱의 종료 이벤트를 지난다.
    const run = glue.slice(glue.indexOf('pub fn run()'));
    expect(run).toMatch(/if let tauri::RunEvent::Exit = event \{\s*stop_running_work\(app\);\s*\}/);
    // (P-027: 앱을 끝내는 창이 오버레이 창에서 데스크톱 앱 창으로 바뀌었다 — 앱 창을 닫으면 앱이 끝난다. 트레이가 없어 오버레이만 남기지 않는다.)
    expect(run).toMatch(
      /if window\.label\(\) == APP_WINDOW && matches!\(event, tauri::WindowEvent::Destroyed\) \{\s*window\.app_handle\(\)\.exit\(0\);/,
    );
    // 오버레이 창은 닫지 않고 숨긴다 — 닫혀 버리면 앱 창이 떠 있는 동안 다시 띄울 수 없다. 숨기는 길은 단축키와 같다(프로세스를 남기지 않는다).
    expect(run).toMatch(
      /if window\.label\(\) == MAIN_WINDOW \{\s*if let tauri::WindowEvent::CloseRequested \{ api, \.\. \} = event \{\s*api\.prevent_close\(\);\s*handle_action\(window\.app_handle\(\), OverlayAction::Hide\);/,
    );
    // P-028: 끝내기 명령(quit_app)을 없앴다 — 오버레이 위젯의 단추는 숨기기이고(overlay_hide → 단축키와 같은 길), 앱을 끝내는
    // 길은 앱 창을 닫는 것 하나다. 앱을 끝내는 호출은 그 한 곳뿐이다.
    expect(glue).not.toMatch(/quit_app/);
    expect(glue.match(/\.exit\(0\)/g)).toHaveLength(1);
    expect(glue).toMatch(/fn overlay_hide\(app: AppHandle\) -> OverlaySnapshot \{\s*handle_action\(&app, OverlayAction::Hide\);/);
    // 프로세스를 곧바로 끝내는 호출(종료 처리를 건너뛴다)은 접착 코드에 없다.
    expect(glue).not.toMatch(/std::process::exit|process::abort/);
  });
});

describe('두 창이 함께 보는 것(Rust)', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const shared = code(sharedStateRs.slice(0, sharedStateRs.indexOf('#[cfg(test)]')));
  /** lib.rs에서 공유 상태 명령들이 있는 부분. */
  const glue = code(libRs.slice(libRs.indexOf('// ── 두 창이 함께 보는 것'), libRs.indexOf('/// 현재 오버레이 상태.')));

  it('기본 계정·오버레이 설정·마지막 요격전 결과는 계정 폴더(gitignore)의 두 파일에 둔다 — 화면은 폴더를 정하지 못한다', () => {
    expect(sharedStateRs).toContain('pub const STATE_FILE: &str = ".companion-state.json";');
    expect(sharedStateRs).toContain('pub const INTERCEPT_FILE: &str = ".last-intercept.json";');
    // 계정 폴더는 계정 받기와 같은 곳이다(환경 변수 → 저장소의 data/accounts). 저장소에 올라가지 않는다.
    expect(glue).toMatch(/fn shared_dir\(\) -> Result<PathBuf, String> \{\s*account_sync::default_accounts_dir\(\)\.map_err\(\|e\| e\.to_string\(\)\)/);
    expect(gitignore.split(/\r?\n/)).toContain('data/accounts/');
    // 명령은 폴더·파일 이름을 인자로 받지 않는다.
    expect(glue).not.toMatch(/path: String|dir: String|file: String/);
    // 이 모듈이 쓰는 파일은 그 둘(임시 파일을 거쳐)뿐이다.
    expect(shared.match(/fs::write\(/g)).toHaveLength(1);
    expect(shared).toMatch(/let temp = dir\.join\(format!\("\{file\}\.tmp"\)\);\s*fs::write\(&temp, format!\("\{text\}\\n"\)\)\.map_err\(io\)\?;\s*if let Err\(e\) = fs::rename\(&temp, &path\)/);
  });

  it('계정 이름은 경로가 아니라 열쇠다 — 계정 받기와 같은 이름 검사를 거친 `<이름>.json`만 읽는다', () => {
    expect(shared).toContain('use crate::account_sync::validate_name;');
    expect(shared).toMatch(/fn account_path\(dir: &Path, name: &str\) -> PathBuf \{\s*dir\.join\(format!\("\{name\}\.json"\)\)/);
    // 계정을 읽고 기본 계정을 정하는 길 모두 이름을 먼저 검사한다.
    expect(shared).toMatch(/pub fn set_default_account\(dir: &Path, name: &str\) -> Result<SharedSnapshot, SharedError> \{\s*let name = checked_name\(name\)\?;/);
    expect(shared).toMatch(/Some\(name\) => checked_name\(name\)\?,/);
    expect(shared.match(/account_path\(/g)).toHaveLength(3);
  });

  it('요격전 결과는 종류·판을 확인한 뒤에만 쓴다 — 맞지 않으면 한국어로 거부하고 앞서 저장한 것을 둔다', () => {
    expect(shared).toMatch(/pub fn save_intercept\(dir: &Path, report: &Value\) -> Result<SharedSnapshot, SharedError> \{\s*check_intercept\(report\)\?;\s*write_json\(/);
    // 판 번호는 결과를 만드는 루트 모듈의 것과 같다.
    expect(sharedStateRs).toContain(`pub const INTERCEPT_SCHEMA_VERSION: u64 = ${INTERCEPT_REPORT_SCHEMA_VERSION};`);
    expect(sharedStateRs).toContain('pub const INTERCEPT_KIND: &str = "intercept_report";');
    expect(sharedStateRs).toContain('앞서 저장한 결과는 그대로 둔다');
    // 읽을 때도 같은 검사를 한다.
    expect(shared).toMatch(/let doc = read_json\(&path, "요격전 추천 결과"\)\?;\s*check_intercept\(&doc\)\?;\s*Ok\(Some\(doc\)\)/);
  });

  it('바뀌면 모든 창에 상태만 알린다 — 결과 문서와 계정의 내용은 이벤트에 싣지 않는다', () => {
    expect(glue.match(/\.emit\w*\(/g)).toHaveLength(1);
    expect(glue).toContain('app.emit(SHARED_STATE_EVENT, snapshot.clone())');
    expect(glue.match(/emit_shared\(&app, &snapshot\);/g)).toHaveLength(3);
    // 화면에 가는 상태의 칸은 Rust와 화면이 같다.
    const fields = ['default_account', 'remembered', 'accounts', 'overlay_launch', 'intercept_saved_at', 'problems'];
    const rust = sharedStateRs.slice(sharedStateRs.indexOf('pub struct SharedSnapshot {'), sharedStateRs.indexOf('/// 상태 파일의 내용.'));
    expect(rust.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual(fields.map((f) => `pub ${f}:`));
    const types = sources['../src/types.ts'];
    const front = types.slice(types.indexOf('export interface SharedSnapshot {'), types.indexOf('/** 계정 한 명의 육성 칸'));
    expect(front.match(/^ {2}(\w+):/gm)?.map((f) => f.trim())).toEqual(fields.map((f) => `${f}:`));
    // 오버레이를 띄우는 때의 낱말도 같다.
    for (const word of ['with_app', 'with_game', 'manual']) {
      expect(sharedStateRs).toContain(`"${word}" => Some(`);
      expect(types).toContain(`'${word}'`);
    }
  });

  it('네트워크를 쓰지 않고, 화면이 넘긴 것으로 프로그램을 실행하지 않는다', () => {
    expect(shared).not.toMatch(/TcpStream|TcpListener|UdpSocket|reqwest|ureq|hyper|Command::new|std::process/);
    expect(glue).not.toMatch(/Command::new|std::process/);
  });

  it('오버레이를 언제 띄우는지는 순수 규칙이 정한다 — 게임이 떠 있는 동안 숨긴 것을 다시 띄우지 않는다', () => {
    expect(sharedStateRs).toMatch(/pub const fn reveals_on_game\(self, was_found: bool, now_found: bool, overlay_visible: bool\) -> bool \{\s*matches!\(self, Self::WithGame\) && !was_found && now_found && !overlay_visible/);
    const track = code(libRs.slice(libRs.indexOf('fn track_game('), libRs.indexOf('fn wake_game_tracker(')));
    expect(track).toMatch(/if launch\.reveals_on_game\(game_was_found, game_found, overlay_visible\) \{\s*reveal_overlay\(&app\);\s*\}/);
    // 시작할 때: 「앱과 함께」면 활성화 없이 보이고, 아니면 숨긴 채로 둔다. 창 라이브러리의 show()로 포커스를 가져오지 않는다.
    const setup = code(libRs.slice(libRs.indexOf('.setup(|app| {'), libRs.indexOf('.on_window_event(')));
    expect(setup).toMatch(/if launch\.shows_at_start\(\) \{\s*show_overlay_without_activating\(&window\)\?;\s*\} else \{\s*lock\(&app\.state::<Overlay>\(\)\.state\)\.visible = false;/);
    expect(setup).not.toMatch(/window\.show\(\)|set_focus/);
  });
});

describe('오버레이 위젯(Rust) — P-028', () => {
  /** 주석을 뺀 코드. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));
  const rule = code(beforeTests(overlayWidgetRs));
  const store = code(beforeTests(overlayStoreRs));
  const glue = code(libRs);
  const section = (from: string, to: string) => glue.slice(glue.indexOf(from), glue.indexOf(to));

  it('규칙 모듈은 순수하다 — 창·파일·스레드·시계에 닿지 않는다', () => {
    expect(rule).not.toMatch(/windows::|HWND|std::fs|std::io|std::path|std::process|std::net|std::env|std::thread|std::time|Instant|SystemTime|tauri|game_win32|overlay_win32/);
    expect(rule).toContain('pub fn step(&mut self, input: AutoInput) -> AutoAction');
    expect(rule).toContain('pub fn seen(status: &TrackStatus) -> Seen');
    expect(rule).toContain('pub fn fit_size(width: f64, height: f64, scale_factor: f64) -> Option<(u32, u32)>');
    expect(rule).toContain('pub fn clamp_into(position: (i32, i32), size: (u32, u32), areas: &[ScreenRect]) -> (i32, i32)');
    expect(rule).toContain('pub fn merged(self, patch: &Value) -> Result<Self, String>');
  });

  it('자동 표시: 추적 스레드가 읽을 때마다 규칙을 돌리고, 규칙이 시킨 것만 창에 반영한다 — 보일 때 활성화하지 않는다', () => {
    const loop = section('fn track_screen(', 'fn start_screen_tracker(');
    expect(loop).toContain('overlay_widget::seen(log.status())');
    expect(loop).toContain('auto_show(&app, seen, since);');
    const auto = section('fn auto_show(', 'fn release_auto_show(');
    expect(auto).toContain('let action = widget.auto.step(input);');
    expect(auto).toMatch(/\(AutoAction::Rest, Some\(window\)\) => hide_overlay\(&window\),\s*\(AutoAction::Wake, Some\(window\)\) => show_overlay_without_activating\(&window\),/);
    // 사용자가 숨긴 오버레이는 건드리지 않는다.
    expect(auto).toMatch(/if !lock\(&overlay\.state\)\.visible \{\s*return;\s*\}/);
    expect(auto).not.toMatch(/\.show\(\)|set_focus|set_always_on_top|unminimize|request_user_attention/);
    // 떠났을 때 하는 일·기다리는 시간·핀은 위젯의 설정과 상태에서 읽는다 — 화면이 그때그때 정하지 않는다.
    expect(auto).toContain('leave: widget.prefs.leave,');
    expect(auto).toContain('after_ms: widget.prefs.leave_after_ms(),');
    expect(auto).toContain('pinned: widget.pinned,');
    // 추적을 끄면 쉬게 해 둔 창을 다시 보인다(숨은 채로 남지 않는다).
    expect(section('fn set_screen_tracking(', 'fn screen_track_status(')).toMatch(/if !enabled \{\s*release_auto_show\(&app\);\s*\}/);
    // 「쉬는 중」은 사용자가 정한 보임(논리 상태)과 따로다 — 쉬는 동안에도 추적은 계속 읽는다(그래야 다시 뜬다).
    expect(rule).toContain('pub fn is_resting(&self) -> bool');
    const handle = section('fn handle_action(', 'fn reveal_overlay(');
    expect(handle).toMatch(/OverlayAction::ToggleVisibility \| OverlayAction::Show => \{\s*if let Err\(e\) = show_overlay_without_activating\(&window\)/);
  });

  it('창 크기 맞춤: 바꾸는 것은 오버레이 자기 창뿐이고, 화면은 크기만 넘긴다', () => {
    const fit = section('fn overlay_fit(', 'fn fitted_position(');
    expect(fit).toContain('.get_webview_window(MAIN_WINDOW)');
    expect(fit).toContain('overlay_widget::fit_size(width, height, scale)');
    expect(glue.match(/\.set_size\(/g)).toHaveLength(1);
    expect(fit).toContain('.set_size(PhysicalSize::new(size.0, size.1))');
    // 창을 옮기는 호출은 셋뿐이다: 붙이기, 이 앱이 옮기는 한 곳(move_overlay), 처음 자리(오른쪽 위). 모두 오버레이 창이다.
    expect(glue.match(/\.set_position\(/g)).toHaveLength(3);
    expect(glue.match(/get_webview_window\(APP_WINDOW\)/g)).toHaveLength(2);
    const focus = section('fn focus_app_window(', 'fn show_app_window(');
    expect(focus).not.toMatch(/set_position|set_size/);
    // 붙어 있는 모서리를 제자리에 두고 화면 안으로 되돌린다.
    const fitted = section('fn fitted_position(', 'fn overlay_hide(');
    expect(fitted).toContain('overlay_widget::clamp_into(raw, size, &work_areas(app, window))');
  });

  it('자리: 끌어 둔 자리를 기억하고(이 앱이 옮긴 것은 가린다), 붙이기는 P-024의 가장자리 규칙 그대로, 화면 밖이면 안쪽으로 되돌린다', () => {
    const moved = section('fn overlay_moved(', 'fn settle_overlay_place(');
    expect(moved).toMatch(/if lock\(&overlay\.widget\)\.programmatic\.contains\(&\(x, y\)\) \{\s*return;\s*\}/);
    expect(moved).toContain('Some(client) => widget.anchor = Some(Anchor::of(client, rect)),');
    expect(moved).toContain('None => widget.spot = Some(Spot::of(area, rect)),');
    // 게임 창은 다시 찾지 않는다 — 추적 스레드가 적어 둔 게임 화면을 읽을 뿐이다.
    expect(moved).not.toMatch(/game_window::locate|find_game_window|game_win32/);
    const run = glue.slice(glue.indexOf('pub fn run()'));
    expect(run).toMatch(/if let tauri::WindowEvent::Moved\(position\) = event \{\s*overlay_moved\(window\.app_handle\(\), position\.x, position\.y\);/);
    // 붙이기: 최소화·화면 밖·게임 없음이면 기다린다(follow_client) — 그 뒤에 게임 창 기준의 자리를 화면 안으로 되돌린다.
    const target = section('fn anchored_target(', 'fn overlay_moved(');
    expect(target).toContain('let client = follow_client(follow, status)?;');
    expect(target).toContain('overlay_widget::clamp_into(');
    expect(gameWindowRs).toContain('pub fn follow_client(follow: bool, status: &GameWindowStatus) -> Option<ScreenRect>');
    // 끄는 동안에는 당기지 않는다.
    expect(section('fn follow_game(', 'type OverlayOnTop')).toMatch(/if follow && overlay_being_dragged\(app\) \{\s*return applied;\s*\}/);
    // 끌기가 끝나면 화면 안으로 되돌리고 디스크에 쓴다.
    const settle = section('fn settle_overlay_place(', 'fn save_widget(');
    expect(settle).toMatch(/if !widget\.dirty \|\| widget\.being_dragged\(\) \{\s*return;\s*\}/);
    expect(settle).toContain('overlay_widget::clamp_into((rect.x, rect.y), size, &work_areas(app, &window));');
    expect(settle).toContain('save_widget(app);');
    // 자리 초기화(앱 창의 설정).
    expect(section('fn reset_overlay_position(', 'fn announce_activity(')).toMatch(/widget\.spot = None;\s*widget\.anchor = None;/);
  });

  it('기억: 계정 폴더(gitignore)의 파일 하나 — 설정·핀·자리뿐이고, 쓰는 길은 공유 상태와 같다', () => {
    expect(overlayStoreRs).toContain('pub const WIDGET_FILE: &str = ".overlay-widget.json";');
    expect(store).toContain('write_json(dir, WIDGET_FILE, &stored.to_value(), WHAT)');
    expect(store).not.toMatch(/fs::write|File::create|TcpStream|TcpListener|Command::new|std::process|std::net/);
    expect(section('fn save_widget(', 'fn widget_snapshot(')).toContain('shared_dir().and_then(|dir| {');
    expect(gitignore.split(/\r?\n/)).toContain('data/accounts/');
    const stored = rule.slice(rule.indexOf('pub struct Stored {'), rule.indexOf('fn int('));
    expect(stored.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual(['pub prefs:', 'pub pinned:', 'pub spot:', 'pub anchor:']);
    // 화면에는 위젯 명령으로 폴더·파일 이름이 가지 않는다.
    expect(section('fn overlay_widget(', 'fn stop_running_work(')).not.toMatch(/path: String|dir: String|file: String/);
  });

  it('화면에 가는 상태의 칸과 낱말·범위가 Rust와 화면에서 같다', () => {
    const types = sources['../src/types.ts'];
    const rust = (name: string) => {
      const start = rule.indexOf(`pub struct ${name} {`);
      return rule
        .slice(start, rule.indexOf('\n}', start))
        .match(/^\s*pub (\w+):/gm)
        ?.map((f) => f.trim().replace('pub ', ''));
    };
    const front = (name: string) => {
      const start = types.indexOf(`export interface ${name} {`);
      return types
        .slice(start, types.indexOf('\n}', start))
        .match(/^ {2}(\w+):/gm)
        ?.map((f) => f.trim());
    };
    const pairs: [string, string, string[]][] = [
      ['WidgetSnapshot', 'WidgetSnapshot', ['shape:', 'pinned:', 'resting:', 'prefs:', 'problem:']],
      ['Prefs', 'OverlayPrefs', ['scale_percent:', 'opacity_percent:', 'leave:', 'leave_after_sec:', 'default_shape:', 'click_through:']],
      ['Activity', 'ComputeActivity', ['running:', 'label:', 'done:', 'total:', 'elapsed_ms:']],
    ];
    for (const [rustName, frontName, fields] of pairs) {
      expect(rust(rustName), rustName).toEqual(fields);
      expect(front(frontName), frontName).toEqual(fields);
    }
    for (const word of ['collapsed', 'card', 'expanded', 'stay', 'collapse', 'hide']) {
      expect(rule, word).toContain(`"${word}" => Some(`);
      expect(types, word).toContain(`'${word}'`);
    }
    // 설정의 범위와 기본값.
    const widgetLib = sources['../src/lib/widget.ts'];
    const constant = (name: string) => Number(rule.match(new RegExp(`pub const ${name}: u32 = (\\d+);`))?.[1]);
    expect(widgetLib).toContain(`SCALE_RANGE = { min: ${constant('SCALE_MIN')}, max: ${constant('SCALE_MAX')}, step: 5, fallback: ${constant('SCALE_DEFAULT')} }`);
    expect(widgetLib).toContain(`OPACITY_RANGE = { min: ${constant('OPACITY_MIN')}, max: ${constant('OPACITY_MAX')}, step: 5, fallback: ${constant('OPACITY_DEFAULT')} }`);
    expect(widgetLib).toContain(`LEAVE_AFTER_RANGE = { min: ${constant('LEAVE_AFTER_MIN')}, max: ${constant('LEAVE_AFTER_MAX')}, step: 1, fallback: ${constant('LEAVE_AFTER_DEFAULT')} }`);
    // 정보 영역은 기본이 불투명이다.
    expect(constant('OPACITY_DEFAULT')).toBe(100);
  });

  it('단축키: 모양 바꾸기(Alt+Shift+M)가 있고, 오버레이에 안내하는 셋이 Rust에 등록돼 있다', () => {
    expect(glue).toMatch(/keys: "Alt\+Shift\+M",\s*what: "오버레이 모양 바꾸기",\s*code: Code::KeyM,\s*action: ShortcutAction::CycleShape,/);
    expect(glue).toMatch(/ShortcutAction::CycleShape => \{\s*change_shape\(app, None\);\s*\}/);
    const widgetLib = sources['../src/lib/widget.ts'];
    for (const keys of ['Alt+Shift+O', 'Alt+Shift+C', 'Alt+Shift+M']) {
      expect(glue, keys).toContain(`keys: "${keys}"`);
      expect(widgetLib, keys).toContain(`keys: '${keys}'`);
    }
    // 접힘 → 한 줄 카드 → 펼침 → 접힘.
    expect(rule).toMatch(/pub const fn next\(self\) -> Self \{\s*match self \{\s*Self::Collapsed => Self::Card,\s*Self::Card => Self::Expanded,\s*Self::Expanded => Self::Collapsed,/);
  });

  it('오버레이는 계산을 시작하지 않는다 — 계산 진행은 앱 창이 알리고 오버레이는 읽기만 한다', () => {
    const announce = section('fn announce_activity(', 'fn compute_activity(');
    expect(announce).not.toMatch(/engine::|EngineRun|run_batch|Command::new/);
    expect(announce).toContain('app.emit(COMPUTE_ACTIVITY_EVENT, activity.clone())');
    // 오버레이 창의 화면 코드는 계산·계정 모듈을 가져오지 않는다.
    for (const file of ['../src/Overlay.vue', '../src/views/OverlayWidget.vue', '../src/views/BossFace.vue', '../src/lib/widget.ts', '../src/lib/bossView.ts']) {
      expect(sources[file], file).not.toMatch(/lib\/(compute|engineRun|accountSync|accountLink|extensionLink)'|engineRunBatch|engineCancel|runInterceptWith/);
    }
    // 앱 창: 요격전 화면이 진행을 알린다. 알리는 모듈은 계산을 시작하지 않는다.
    expect(sources['../src/pages/InterceptPage.vue']).toContain('announceWhile(() => ({');
    expect(sources['../src/lib/activity.ts']).not.toMatch(/engineRunBatch|useEngineRun|runInterceptWith/);
  });

  it('클릭 통과를 바꾼 뒤 창이 숨지 않게 활성화 없이 한 번 더 보인다 — 숨긴 동안에는 설정으로도 바꾸지 못한다', () => {
    const apply = section('fn apply_transition(', 'fn handle_action(');
    expect(apply).toMatch(/if t\.next\.visible && t\.set_visible\.is_none\(\) \{\s*show_overlay_without_activating\(window\)\?;\s*\}/);
    const prefs = section('fn set_overlay_prefs(', 'fn reset_overlay_position(');
    expect(prefs).toContain('오버레이가 숨겨져 있어 클릭 통과를 바꾸지 못했다');
    expect(prefs).toContain('handle_action(&app, OverlayAction::ToggleClickThrough);');
  });
});

describe('창 설정', () => {
  const win = tauriConf.app.windows[0];
  const appWin = tauriConf.app.windows[1];

  it('데스크톱 앱 창은 보통 창이다 — 테두리·제목 표시줄이 있고 작업 표시줄에 보이며 크기를 바꿀 수 있다(기본 1100×720)', () => {
    expect(appWin.label).toBe('app');
    expect(appWin.decorations).toBe(true);
    expect(appWin.transparent).toBe(false);
    expect(appWin.alwaysOnTop).toBe(false);
    expect(appWin.skipTaskbar).toBe(false);
    expect(appWin.resizable).toBe(true);
    expect(appWin.visible).toBe(true);
    expect([appWin.width, appWin.height]).toEqual([1100, 720]);
    // 오버레이는 숨긴 채 만들고 포커스를 가져가지 않는다 — 앱을 켜면 앱 창이 포커스를 갖는다.
    expect(win.visible).toBe(false);
    expect(win.focus).toBe(false);
    expect(appWin.focus).toBe(true);
  });

  it('오버레이 창: 테두리 없음·투명·항상 위·작업 표시줄에 안 보임', () => {
    expect(win.label).toBe('main');
    expect(win.decorations).toBe(false);
    expect(win.transparent).toBe(true);
    expect(win.alwaysOnTop).toBe(true);
    expect(win.skipTaskbar).toBe(true);
  });

  it('오버레이 창은 위젯만큼만 크다(P-028) — 손으로 크기를 바꿀 수 없고, 접힌 알약만큼 작아질 수 있다', () => {
    // 창 크기는 위젯에 맞춰 Rust가 정한다(overlay_fit). 가장자리를 끌어 키우면 빈 투명 영역이 게임 클릭을 가로막는다.
    expect(win.resizable).toBe(false);
    expect(win.maximizable).toBe(false);
    expect(win.minWidth).toBeLessThanOrEqual(64);
    expect(win.minHeight).toBeLessThanOrEqual(24);
    // 시작할 때의 크기는 한 줄 카드 한 장쯤이다(화면이 그려지면 곧바로 잰 크기로 맞춘다).
    expect(win.width).toBeLessThanOrEqual(480);
    expect(win.height).toBeLessThanOrEqual(120);
    expect(win.shadow).toBe(false);
  });

  it('CSP가 외부 연결을 막는다(IPC만 허용)', () => {
    const csp = tauriConf.app.security.csp;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('connect-src ipc: http://ipc.localhost;');
    expect(csp).not.toMatch(/https:|wss?:|\*/);
  });

  it('전역 Tauri 객체를 노출하지 않는다', () => {
    expect(tauriConf.app.withGlobalTauri).toBe(false);
  });
});

describe('프런트 코드', () => {
  it('네트워크 API와 외부 주소를 쓰지 않는다', () => {
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(5);
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\//);
    }
  });

  it('대미지 단위 표기를 루트의 src/core/format.mjs에서 가져오고 다시 구현하지 않는다', () => {
    expect(formatSource).toContain("from '@core/format.mjs'");
    for (const [file, text] of Object.entries(sources)) {
      // 단위 글자나 단위 값을 직접 적은 곳이 없어야 한다.
      expect(text, file).not.toMatch(/['"`]억['"`]|['"`]조['"`]|1e8|1e12|100000000/);
    }
  });
});
