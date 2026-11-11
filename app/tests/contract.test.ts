// 프런트와 Rust 쪽이 맞물리는 곳, 그리고 "쓰는 것만 허용한다·네트워크를 쓰지 않는다"는 약속의 정적 확인.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureGame,
  ENGINE_PROGRESS_EVENT,
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
  setFollowGame,
  startupReportPath,
} from '../src/lib/backend';
import capability from '../src-tauri/capabilities/overlay.json';
import tauriConf from '../src-tauri/tauri.conf.json';
import buildRs from '../src-tauri/build.rs?raw';
import cargoToml from '../src-tauri/Cargo.toml?raw';
import captureRs from '../src-tauri/src/capture.rs?raw';
import engineRs from '../src-tauri/src/engine.rs?raw';
import gameWin32Rs from '../src-tauri/src/game_win32.rs?raw';
import gameWindowRs from '../src-tauri/src/game_window.rs?raw';
import libRs from '../src-tauri/src/lib.rs?raw';
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
    expect(calls.map((c) => c.cmd)).toEqual(COMMANDS);
    expect(calls[0].args).toEqual({ path: 'D:\\r.json' });
    expect(calls[6].args).toEqual({ requests: [{ squad: ['크라운'] }] });
    expect(calls[7].args).toEqual({ path: 'D:\\a.json' });
    expect(calls[8].args).toEqual({ title: '계정 상태 파일 고르기' });
    expect(calls[10].args).toEqual({ enabled: true });
    expect(calls[11].args).toEqual({ label: null });
  });

  it('인자 이름이 Rust 명령의 매개변수와 같다', () => {
    expect(libRs).toMatch(/async fn engine_run_batch\(app: AppHandle, requests: Vec<Value>\)/);
    expect(libRs).toMatch(/async fn read_json_file\(path: String\)/);
    expect(libRs).toMatch(/async fn pick_json_file\(window: WebviewWindow, title: String\)/);
    expect(libRs).toMatch(/async fn game_window_status\(app: AppHandle\)/);
    expect(libRs).toMatch(/async fn set_follow_game\(app: AppHandle, enabled: bool\)/);
    expect(libRs).toMatch(/async fn capture_game\(app: AppHandle, label: Option<String>\)/);
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
  });
});

describe('게임 창 추적·캡처(Rust)', () => {
  /** 주석을 뺀 코드. 금지한 호출을 주석에서 이름만 든 것은 세지 않는다. */
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  const rustSources = { 'game_win32.rs': gameWin32Rs, 'game_window.rs': gameWindowRs, 'capture.rs': captureRs, 'lib.rs': libRs };

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

  it('파일 고르기 창은 대화 상자 플러그인이 아니라 앱 명령 하나로만 연다', () => {
    expect(cargoToml).not.toMatch(/tauri-plugin-(dialog|fs|shell|http|opener)/);
    expect(libRs).not.toMatch(/tauri_plugin_(dialog|fs|shell|http|opener)/);
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
