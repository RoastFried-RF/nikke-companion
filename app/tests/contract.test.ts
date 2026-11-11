// 프런트와 Rust 쪽이 맞물리는 곳, 그리고 "쓰는 것만 허용한다·네트워크를 쓰지 않는다"는 약속의 정적 확인.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENGINE_PROGRESS_EVENT,
  engineCatalog,
  engineRunBatch,
  engineVersion,
  errorMessage,
  loadReport,
  overlayStatus,
  OVERLAY_STATE_EVENT,
  pickJsonFile,
  quitApp,
  readJsonFile,
  startupReportPath,
} from '../src/lib/backend';
import capability from '../src-tauri/capabilities/overlay.json';
import tauriConf from '../src-tauri/tauri.conf.json';
import buildRs from '../src-tauri/build.rs?raw';
import cargoToml from '../src-tauri/Cargo.toml?raw';
import engineRs from '../src-tauri/src/engine.rs?raw';
import libRs from '../src-tauri/src/lib.rs?raw';
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
];

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
    expect(calls.map((c) => c.cmd)).toEqual(COMMANDS);
    expect(calls[0].args).toEqual({ path: 'D:\\r.json' });
    expect(calls[6].args).toEqual({ requests: [{ squad: ['크라운'] }] });
    expect(calls[7].args).toEqual({ path: 'D:\\a.json' });
    expect(calls[8].args).toEqual({ title: '계정 상태 파일 고르기' });
  });

  it('인자 이름이 Rust 명령의 매개변수와 같다', () => {
    expect(libRs).toMatch(/async fn engine_run_batch\(app: AppHandle, requests: Vec<Value>\)/);
    expect(libRs).toMatch(/async fn read_json_file\(path: String\)/);
    expect(libRs).toMatch(/async fn pick_json_file\(window: WebviewWindow, title: String\)/);
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
