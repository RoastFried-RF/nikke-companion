// 프런트와 Rust 쪽이 맞물리는 곳, 그리고 "쓰는 것만 허용한다·네트워크를 쓰지 않는다"는 약속의 정적 확인.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureGame,
  ENGINE_PROGRESS_EVENT,
  engineCancel,
  engineCatalog,
  engineRunBatch,
  engineVersion,
  errorMessage,
  GAME_CAPTURE_EVENT,
  GAME_WINDOW_EVENT,
  gameWindowStatus,
  loadReport,
  overlayStatus,
  OVERLAY_STATE_EVENT,
  pickJsonFile,
  quitApp,
  readJsonFile,
  recognizeGameScreen,
  SCREEN_TRACK_EVENT,
  screenTrackStatus,
  setFollowGame,
  setScreenTracking,
  startupReportPath,
} from '../src/lib/backend';
import capability from '../src-tauri/capabilities/overlay.json';
import tauriConf from '../src-tauri/tauri.conf.json';
import buildRs from '../src-tauri/build.rs?raw';
import cargoToml from '../src-tauri/Cargo.toml?raw';
import captureRs from '../src-tauri/src/capture.rs?raw';
import captureCliRs from '../src-tauri/src/capture_cli.rs?raw';
import engineRs from '../src-tauri/src/engine.rs?raw';
import engineWin32Rs from '../src-tauri/src/engine_win32.rs?raw';
import gameWin32Rs from '../src-tauri/src/game_win32.rs?raw';
import gameWindowRs from '../src-tauri/src/game_window.rs?raw';
import libRs from '../src-tauri/src/lib.rs?raw';
import overlayStateRs from '../src-tauri/src/overlay_state.rs?raw';
import overlayWin32Rs from '../src-tauri/src/overlay_win32.rs?raw';
import recognizeRs from '../src-tauri/src/recognize.rs?raw';
import screenTrackRs from '../src-tauri/src/screen_track.rs?raw';
import gitignore from '../../.gitignore?raw';
import formatSource from '../src/lib/format.ts?raw';

const sources = import.meta.glob<string>(['../src/**/*.{ts,vue,css}', '../index.html'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

afterEach(() => clearMocks());

/** 화면이 부르는 앱 명령. */
const COMMANDS = [
  'load_report',
  'overlay_status',
  'startup_report_path',
  'quit_app',
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
];

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
      return null;
    });
    await expect(loadReport('D:\\r.json')).resolves.toEqual({ schema_version: 1 });
    await expect(overlayStatus()).resolves.toEqual({ visible: true, click_through: false, shortcut_problems: [] });
    await expect(startupReportPath()).resolves.toBeNull();
    await quitApp();
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
    expect(calls.map((c) => c.cmd)).toEqual(COMMANDS);
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
  });

  it('Rust가 거부한 한국어 문장을 그대로 넘긴다', async () => {
    mockIPC(() => {
      throw 'schema_version이 맞지 않는다: 파일은 2, 이 앱이 읽는 판은 1이다: x.json';
    });
    const failure = await loadReport('x.json').catch((e: unknown) => errorMessage(e));
    expect(failure).toBe('schema_version이 맞지 않는다: 파일은 2, 이 앱이 읽는 판은 1이다: x.json');
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
    'lib.rs': libRs,
  };

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
    // 탭을 옮기는 것은 App.vue, 보스를 고르는 것은 InterceptView.vue — 둘 다 규칙이 따라가라고 할 때만.
    expect(sources['../src/App.vue']).toMatch(/provideScreenTrack\(\(\) => \{\s*if \(track\.autoTab\.value && tab\.value !== 'intercept'\) select\('intercept'\);/);
    expect(sources['../src/components/InterceptView.vue']).toContain('watch(() => track.target.value?.seq, followTarget);');
    for (const [file, text] of Object.entries(sources)) {
      if (file === '../src/lib/screenTrack.ts') continue;
      // 인식 결과(화면 종류·보스)를 직접 읽어 따로 판단하는 화면이 없다.
      expect(text, file).not.toMatch(/recognition\.(screen|boss)\b|followStep\(/);
    }
    // 요격전 화면은 인식 결과로 계산을 시작하지 않는다: 실행은 단추와 입력 칸의 Enter뿐이다.
    const screen = sources['../src/screens/InterceptScreen.vue'];
    expect(screen.match(/@run="run"|@enter="run"/g)).toHaveLength(3);
    expect(screen).not.toMatch(/watch\(|onActivated\(|onMounted\(/);
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
    // 떠 있던 쪽이 하는 일은 하나다. 실행 인자와 작업 폴더는 쓰지 않는다.
    expect(run).toMatch(/tauri_plugin_single_instance::init\(\|app, _args, _cwd\| \{\s*reveal_overlay\(app\);\s*\}\)/);
  });

  it('떠 있던 오버레이는 활성화 없이 보인다 — 포커스를 가져오는 호출이 없다', () => {
    expect(reveal).toContain('state.apply(OverlayAction::Show)');
    expect(reveal).toContain('show_overlay_without_activating(&window)');
    expect(reveal).not.toMatch(/\.show\(\)|set_focus|set_always_on_top|unminimize|request_user_attention/);
    expect(overlayStateRs).toMatch(/OverlayAction::Show => Self \{\s*visible: true,\s*\.\.self\s*\},/);
  });

  it('화면에서 부르는 것이 없어 권한을 더하지 않았다', () => {
    for (const p of capability.permissions) expect(p).not.toMatch(/single-instance/);
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/single[-_ ]?instance/i);
  });
});

describe('권한(capability)', () => {
  it('쓰는 것만 허용한다', () => {
    expect([...capability.permissions].sort()).toEqual(
      [
        'core:event:allow-listen',
        'core:event:allow-unlisten',
        'core:window:allow-start-dragging',
        ...COMMANDS.map((c) => `allow-${c.replaceAll('_', '-')}`),
      ].sort(),
    );
    expect(capability.windows).toEqual(['main']);
  });

  it('묶음 권한(default)이나 파일·셸·네트워크 권한이 없다', () => {
    for (const p of capability.permissions) {
      expect(p).not.toMatch(/default$/);
      expect(p).not.toMatch(/^(fs|shell|http|websocket|opener|process|dialog|updater):/);
    }
  });

  it('설정이 이 capability만 쓴다', () => {
    expect(tauriConf.app.security.capabilities).toEqual([capability.identifier]);
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
    // 화면 넷(P-017)까지는 14개였다. 그 뒤에 더한 것은 자동 추적(P-021)의 둘뿐이다 — 켜기/끄기와 상태.
    expect(COMMANDS).toHaveLength(16);
    expect(COMMANDS.slice(14)).toEqual(['set_screen_tracking', 'screen_track_status']);
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
    expect(win32).not.toMatch(/\b(SW_SHOW|SW_SHOWNORMAL|SW_RESTORE|SW_SHOWDEFAULT|SW_SHOWMAXIMIZED|SW_SHOWMINIMIZED)\b/);
    expect(win32).not.toMatch(
      /\b(SetForegroundWindow|BringWindowToTop|SetActiveWindow|SetFocus|SwitchToThisWindow|SetWindowPos|AttachThreadInput|SendInput|SendMessageW|PostMessageW|keybd_event|mouse_event)\b/,
    );
  });

  it('오버레이 창 모듈은 오버레이 창의 핸들만 쓴다 — 다른 창을 찾지 않는다', () => {
    const win32 = code(overlayWin32Rs);
    expect(win32).toContain('.hwnd()');
    expect(win32).not.toMatch(/\b(FindWindowW|FindWindowExW|EnumWindows|GetForegroundWindow|GetWindowThreadProcessId|WindowFromPoint)\b/);
    expect(win32).not.toMatch(/game_window|game_win32|nikke\.exe/);
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

describe('창 설정', () => {
  const win = tauriConf.app.windows[0];

  it('테두리 없음·투명·항상 위·작업 표시줄에 안 보임', () => {
    expect(win.label).toBe('main');
    expect(win.decorations).toBe(false);
    expect(win.transparent).toBe(true);
    expect(win.alwaysOnTop).toBe(true);
    expect(win.skipTaskbar).toBe(true);
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
