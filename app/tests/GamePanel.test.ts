// 게임 창 칸: 게임 창 상태 표시, 화면 저장(단추·단축키 결과), 붙이기. Rust 쪽은 가짜로 대체한다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GamePanel from '../src/components/GamePanel.vue';
import * as backend from '../src/lib/backend';
import type { CaptureRecord, GameCaptureOutcome, GameSnapshot, GameWindowInfo } from '../src/types';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  gameWindowStatus: vi.fn(),
  setFollowGame: vi.fn(),
  captureGame: vi.fn(),
  onGameWindow: vi.fn(),
  onGameCapture: vi.fn(),
}));

const api = vi.mocked(backend);

const gameWindow: GameWindowInfo = {
  hwnd: 3345878,
  pid: 24812,
  process_name: 'nikke.exe',
  title: 'NIKKE',
  client: { x: 101, y: 81, width: 1920, height: 1080 },
  frame: { x: 100, y: 50, width: 1922, height: 1112 },
  minimized: false,
  foreground: false,
  scale_factor: 1,
};

const found: GameSnapshot = { state: 'found', window: gameWindow, message: '게임 창을 찾았다 (1920×1080)', follow: false };
const missing: GameSnapshot = {
  state: 'missing',
  window: null,
  message: '게임 창을 찾을 수 없다. 니케 PC판(nikke.exe)이 실행 중인지 확인하라',
  follow: false,
};
const minimized: GameSnapshot = {
  state: 'minimized',
  window: { ...gameWindow, minimized: true, client: { x: -32000, y: -32000, width: 0, height: 0 } },
  message: '게임 창이 최소화돼 있다. 창을 다시 띄운 뒤에 캡처하라(이 앱은 게임 창을 건드리지 않는다)',
  follow: false,
};
const launcherOnly: GameSnapshot = {
  state: 'launcher_only',
  window: null,
  message: '런처(nikke_launcher.exe)만 떠 있고 게임 창이 없다. 런처에서 게임을 시작하라',
  follow: false,
};

const record: CaptureRecord = {
  path: 'E:\\code\\nikke-companion\\data\\captures\\20261112-054148-988.png',
  width: 1920,
  height: 1080,
  captured_at: '2026-11-11T20:41:48.988Z',
  method: 'wgc',
  window: gameWindow,
};

/** Rust가 보내는 이벤트를 흉내 낸다. */
let emitGameWindow: (snapshot: GameSnapshot) => void = () => {};
let emitGameCapture: (outcome: GameCaptureOutcome) => void = () => {};
const unlistenWindow = vi.fn();
const unlistenCapture = vi.fn();

async function render() {
  const wrapper = mount(GamePanel);
  await flushPromises();
  return wrapper;
}
type Wrapper = Awaited<ReturnType<typeof render>>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  api.gameWindowStatus.mockResolvedValue(found);
  api.setFollowGame.mockImplementation(async (enabled) => ({ ...found, follow: enabled }));
  api.captureGame.mockResolvedValue(record);
  api.onGameWindow.mockImplementation(async (handler) => {
    emitGameWindow = handler;
    return unlistenWindow;
  });
  api.onGameCapture.mockImplementation(async (handler) => {
    emitGameCapture = handler;
    return unlistenCapture;
  });
});

describe('게임 창 상태', () => {
  it('찾으면 화면 영역의 크기와 배율을 보인다', async () => {
    const w = await render();
    expect(at(w, 'game-state').text()).toBe('게임 창: 찾음');
    expect(at(w, 'game-size').text()).toBe('1920×1080');
    expect(at(w, 'game-scale').text()).toBe('배율 100%');
    expect(at(w, 'game-foreground').exists()).toBe(false);
    expect(at(w, 'game-message').exists()).toBe(false);
    expect(at(w, 'game-error').exists()).toBe(false);
  });

  it('배율과 전경 여부를 그대로 보인다', async () => {
    api.gameWindowStatus.mockResolvedValue({
      ...found,
      window: { ...gameWindow, scale_factor: 1.25, foreground: true, client: { x: 0, y: 0, width: 2212, height: 1244 } },
    });
    const w = await render();
    expect(at(w, 'game-size').text()).toBe('2212×1244');
    expect(at(w, 'game-scale').text()).toBe('배율 125%');
    expect(at(w, 'game-foreground').text()).toBe('전경');
  });

  it('게임이 없으면 없다고 알리고 저장 단추를 막는다', async () => {
    api.gameWindowStatus.mockResolvedValue(missing);
    const w = await render();
    expect(at(w, 'game-state').text()).toBe('게임 창: 없음');
    expect(at(w, 'game-size').exists()).toBe(false);
    expect(at(w, 'game-message').text()).toContain('nikke.exe');
    expect(at(w, 'capture-game').attributes('disabled')).toBeDefined();
  });

  it('최소화돼 있으면 크기를 보이지 않고 저장 단추를 막는다', async () => {
    api.gameWindowStatus.mockResolvedValue(minimized);
    const w = await render();
    expect(at(w, 'game-state').text()).toBe('게임 창: 최소화됨');
    expect(at(w, 'game-size').exists()).toBe(false);
    expect(at(w, 'game-message').text()).toContain('최소화');
    expect(at(w, 'capture-game').attributes('disabled')).toBeDefined();
  });

  it('런처만 떠 있으면 그렇게 알린다', async () => {
    api.gameWindowStatus.mockResolvedValue(launcherOnly);
    const w = await render();
    expect(at(w, 'game-state').text()).toBe('게임 창: 없음 (런처만 떠 있다)');
    expect(at(w, 'game-message').text()).toContain('런처');
  });

  it('Rust가 상태 변화를 알리면 바로 반영한다', async () => {
    api.gameWindowStatus.mockResolvedValue(missing);
    const w = await render();
    expect(at(w, 'game-state').text()).toBe('게임 창: 없음');

    emitGameWindow(found);
    await flushPromises();
    expect(at(w, 'game-state').text()).toBe('게임 창: 찾음');
    expect(at(w, 'game-size').text()).toBe('1920×1080');
    expect(at(w, 'capture-game').attributes('disabled')).toBeUndefined();

    // 창 크기가 바뀌면 크기도 바뀐다.
    emitGameWindow({ ...found, window: { ...gameWindow, client: { x: 0, y: 0, width: 1280, height: 720 } } });
    await flushPromises();
    expect(at(w, 'game-size').text()).toBe('1280×720');

    emitGameWindow(minimized);
    await flushPromises();
    expect(at(w, 'game-state').text()).toBe('게임 창: 최소화됨');
  });

  it('상태를 읽지 못하면 오류를 보이고 확인 중으로 남는다', async () => {
    api.gameWindowStatus.mockRejectedValue('명령을 부를 수 없다');
    const w = await render();
    expect(at(w, 'game-error').text()).toBe('게임 창 상태를 확인하지 못했다: 명령을 부를 수 없다');
    expect(at(w, 'game-error').attributes('role')).toBe('alert');
    expect(at(w, 'game-state').text()).toBe('게임 창 확인 중…');
    expect(at(w, 'capture-game').attributes('disabled')).toBeDefined();
  });

  it('화면이 내려가면 구독을 끊는다', async () => {
    const w = await render();
    w.unmount();
    expect(unlistenWindow).toHaveBeenCalledTimes(1);
    expect(unlistenCapture).toHaveBeenCalledTimes(1);
  });
});

describe('화면 저장', () => {
  it('단추를 누르면 저장하고 경로와 크기를 알린다', async () => {
    const w = await render();
    expect(w.text()).toContain('Alt+Shift+S');
    await at(w, 'capture-game').trigger('click');
    await flushPromises();
    expect(api.captureGame).toHaveBeenCalledTimes(1);
    const saved = at(w, 'capture-saved');
    expect(saved.text()).toContain(record.path);
    expect(saved.text()).toContain('1920×1080');
    expect(saved.attributes('role')).toBe('status');
    expect(at(w, 'capture-error').exists()).toBe(false);
  });

  it('화면은 저장할 폴더를 넘기지 않는다 — Rust가 정한다', async () => {
    const w = await render();
    await at(w, 'capture-game').trigger('click');
    await flushPromises();
    expect(api.captureGame.mock.calls[0]).toEqual([]);
  });

  it('저장하는 동안에는 단추를 막고 다시 누를 수 없다', async () => {
    let finish: (r: CaptureRecord) => void = () => {};
    api.captureGame.mockImplementation(() => new Promise<CaptureRecord>((resolve) => (finish = resolve)));
    const w = await render();
    await at(w, 'capture-game').trigger('click');
    expect(at(w, 'capture-game').text()).toBe('저장 중…');
    expect(at(w, 'capture-game').attributes('disabled')).toBeDefined();
    await at(w, 'capture-game').trigger('click');
    expect(api.captureGame).toHaveBeenCalledTimes(1);

    finish(record);
    await flushPromises();
    expect(at(w, 'capture-game').text()).toBe('화면 저장');
    expect(at(w, 'capture-game').attributes('disabled')).toBeUndefined();
    expect(at(w, 'capture-saved').exists()).toBe(true);
  });

  it('실패하면 Rust가 준 한국어 오류를 보이고 앞선 저장 결과를 치운다', async () => {
    const w = await render();
    await at(w, 'capture-game').trigger('click');
    await flushPromises();
    expect(at(w, 'capture-saved').exists()).toBe(true);

    api.captureGame.mockRejectedValue('캡처한 화면이 전부 검다(wgc). 게임 화면이 찍히지 않았다고 보고 저장하지 않았다');
    await at(w, 'capture-game').trigger('click');
    await flushPromises();
    const error = at(w, 'capture-error');
    expect(error.text()).toBe('캡처한 화면이 전부 검다(wgc). 게임 화면이 찍히지 않았다고 보고 저장하지 않았다');
    expect(error.attributes('role')).toBe('alert');
    expect(at(w, 'capture-saved').exists()).toBe(false);
  });

  it('단축키로 저장한 결과(경로)도 알린다', async () => {
    const w = await render();
    emitGameCapture({ capture: record, error: null });
    await flushPromises();
    expect(at(w, 'capture-saved').text()).toContain(record.path);
    expect(api.captureGame).not.toHaveBeenCalled();
  });

  it('단축키로 저장하다 난 오류도 알린다 — 게임이 없어 단추가 막혀 있어도', async () => {
    api.gameWindowStatus.mockResolvedValue(missing);
    const w = await render();
    emitGameCapture({ capture: null, error: missing.message });
    await flushPromises();
    expect(at(w, 'capture-error').text()).toBe(missing.message);
    expect(at(w, 'capture-saved').exists()).toBe(false);

    // 다음에 성공하면 오류를 치운다.
    emitGameCapture({ capture: record, error: null });
    await flushPromises();
    expect(at(w, 'capture-error').exists()).toBe(false);
    expect(at(w, 'capture-saved').exists()).toBe(true);
  });
});

describe('게임 창에 붙이기', () => {
  const checkbox = (w: Wrapper) => at(w, 'follow-game').element as HTMLInputElement;

  it('처음에는 꺼져 있고 Rust를 부르지 않는다', async () => {
    const w = await render();
    expect(checkbox(w).checked).toBe(false);
    expect(api.setFollowGame).not.toHaveBeenCalled();
  });

  it('켜면 Rust에 알리고, 끄면 다시 알린다', async () => {
    const w = await render();
    await at(w, 'follow-game').setValue(true);
    await flushPromises();
    expect(api.setFollowGame).toHaveBeenLastCalledWith(true);
    expect(checkbox(w).checked).toBe(true);

    await at(w, 'follow-game').setValue(false);
    await flushPromises();
    expect(api.setFollowGame).toHaveBeenLastCalledWith(false);
    expect(checkbox(w).checked).toBe(false);
    expect(api.setFollowGame).toHaveBeenCalledTimes(2);
  });

  it('켜 둔 것을 기억했다가 다음 실행에서 다시 켠다', async () => {
    const first = await render();
    await at(first, 'follow-game').setValue(true);
    await flushPromises();
    first.unmount();

    api.setFollowGame.mockClear();
    const second = await render();
    expect(api.setFollowGame).toHaveBeenCalledTimes(1);
    expect(api.setFollowGame).toHaveBeenCalledWith(true);
    expect(checkbox(second).checked).toBe(true);
  });

  it('꺼 둔 것도 기억한다', async () => {
    const first = await render();
    await at(first, 'follow-game').setValue(true);
    await flushPromises();
    await at(first, 'follow-game').setValue(false);
    await flushPromises();
    first.unmount();

    api.setFollowGame.mockClear();
    const second = await render();
    expect(api.setFollowGame).not.toHaveBeenCalled();
    expect(checkbox(second).checked).toBe(false);
  });

  it('Rust가 이미 붙이기 중이라고 알리면 켜진 것으로 보인다', async () => {
    api.gameWindowStatus.mockResolvedValue({ ...found, follow: true });
    const w = await render();
    expect(checkbox(w).checked).toBe(true);
    expect(api.setFollowGame).not.toHaveBeenCalled();
  });

  it('바꾸지 못하면 오류를 보이고 표시는 Rust의 상태 그대로다', async () => {
    api.setFollowGame.mockRejectedValue('명령을 부를 수 없다');
    const w = await render();
    await at(w, 'follow-game').setValue(true);
    await flushPromises();
    expect(at(w, 'game-error').text()).toBe('붙이기를 바꾸지 못했다: 명령을 부를 수 없다');
    expect(checkbox(w).checked).toBe(false);
    expect(localStorage.getItem('nikke-companion.follow-game')).toBeNull();
  });

  it('게임이 없어도 켤 수 있다 — 게임 창이 생기면 따라간다', async () => {
    api.gameWindowStatus.mockResolvedValue(missing);
    api.setFollowGame.mockImplementation(async (enabled) => ({ ...missing, follow: enabled }));
    const w = await render();
    expect(checkbox(w).disabled).toBe(false);
    await at(w, 'follow-game').setValue(true);
    await flushPromises();
    expect(api.setFollowGame).toHaveBeenCalledWith(true);
    expect(checkbox(w).checked).toBe(true);
  });
});
