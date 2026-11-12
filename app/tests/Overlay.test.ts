// 오버레이 창(게임 위에 뜨는 작은 창 — src/Overlay.vue): 상태 표시와 마지막 요격전 추천 결과.
// 이 창은 결과만 보여 준다 — 계산 실행·계정 받기·설정은 데스크톱 앱 창의 일이고, 권한(capabilities/overlay.json)도 그렇게 나뉘어 있다.
// Rust 쪽(backend)은 가짜다. 결과는 가짜 디스크(tests/helpers/shell.ts — 계정 폴더를 흉내 낸다)에 두고, 앱 창이 저장했다는 알림을 보낸다.
//
// P-027: 「상태 표시·클릭 통과·끝내기·구독 끊기·창 끌기」 다섯 건은 예전 App.test.ts에서 옮겨 왔다(오버레이 창의 뿌리가 App.vue에서
// Overlay.vue로 바뀌었다 — 확인하는 동작은 그대로다).
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Overlay from '../src/Overlay.vue';
import overlaySource from '../src/Overlay.vue?raw';
import * as backend from '../src/lib/backend';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import type { InterceptReport, OverlaySnapshot, ScreenTrackStatus } from '../src/types';
import capability from '../src-tauri/capabilities/overlay.json';
import anomalyBundle from '../../data/intercept/anomaly.json';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog } from './helpers/fakeEngine';
import { FakeDisk, installShell } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
  quitApp: vi.fn(),
  engineCatalog: vi.fn(),
  engineRunBatch: vi.fn(),
  setScreenTracking: vi.fn(),
  screenTrackStatus: vi.fn(),
  onScreenTrack: vi.fn(),
  accountSyncStatus: vi.fn(),
  nikkePortrait: vi.fn(),
  bossImage: vi.fn(),
  gameIcon: vi.fn(),
}));

const api = vi.mocked(backend);
const interactive: OverlaySnapshot = { visible: true, click_through: false, shortcut_problems: [] };
const sample = interceptFixture as unknown as InterceptReport;

/** 실제 이상 개체 5종의 id·이름을 가진 결과(샘플의 보스 id·이름만 바꿨다). */
const realReport = (() => {
  const copy = structuredClone(sample);
  copy.bosses.forEach((b, i) => {
    b.id = anomalyBundle.bosses[i].id;
    b.name = anomalyBundle.bosses[i].name;
  });
  return copy;
})();

/** Rust가 보내는 상태 이벤트를 흉내 낸다. */
let emitOverlayState: (state: OverlaySnapshot) => void = () => {};
const unlisten = vi.fn();
let trackListeners: Array<(next: ScreenTrackStatus) => void> = [];
let rustTrack: ScreenTrackStatus;
let disk = new FakeDisk();

const trackOff = (): ScreenTrackStatus => ({ enabled: false, interval_ms: 2000, state: 'off', message: '', recognition: null, read_at: null, capture_ms: null, failures: 0 });
const seeing = (id: string): ScreenTrackStatus => {
  const boss = anomalyBundle.bosses.find((b) => b.id === id)!;
  return {
    ...trackOff(),
    enabled: true,
    state: 'read',
    message: `이상 개체 요격전 화면 — ${boss.name}`,
    recognition: { screen: 'anomaly_select', boss: { id: boss.id, name: boss.name }, confidence: 0.97, evidence: [], width: 1881, height: 1058 },
    read_at: '2026-11-12T05:03:22.000Z',
  };
};

async function emitTrack(next: ScreenTrackStatus): Promise<void> {
  rustTrack = next;
  for (const listener of [...trackListeners]) listener(next);
  await flushPromises();
}

async function render() {
  const wrapper = mount(Overlay);
  await flushPromises();
  return wrapper;
}
type Wrapper = Awaited<ReturnType<typeof render>>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  clearNikkeCatalog();
  trackListeners = [];
  rustTrack = trackOff();
  disk = installShell(api);
  api.overlayStatus.mockResolvedValue(interactive);
  api.onOverlayState.mockImplementation(async (handler) => {
    emitOverlayState = handler;
    return unlisten;
  });
  api.quitApp.mockResolvedValue(undefined);
  api.engineCatalog.mockResolvedValue(catalog);
  api.screenTrackStatus.mockImplementation(async () => rustTrack);
  api.onScreenTrack.mockImplementation(async (handler) => {
    trackListeners.push(handler);
    return () => {
      trackListeners = trackListeners.filter((l) => l !== handler);
    };
  });
  const missing = { found: false, mime: null, data: null, source: null };
  api.nikkePortrait.mockResolvedValue(missing);
  api.bossImage.mockResolvedValue(missing);
  api.gameIcon.mockResolvedValue(missing);
});

describe('오버레이 창의 틀', () => {
  it('시작하면 현재 상태(조작 가능)를 보인다', async () => {
    const w = await render();
    expect(at(w, 'click-through-off').exists()).toBe(true);
    expect(at(w, 'visibility').text()).toBe('창: 보임');
  });

  it('단축키로 클릭 통과가 켜지면 눈에 띄게 표시하고, 꺼지면 되돌린다', async () => {
    const w = await render();
    expect(at(w, 'overlay').classes()).not.toContain('overlay--passthrough');

    emitOverlayState({ ...interactive, click_through: true });
    await flushPromises();
    expect(at(w, 'click-through-on').text()).toContain('클릭 통과 중');
    expect(at(w, 'overlay').classes()).toContain('overlay--passthrough');

    emitOverlayState(interactive);
    await flushPromises();
    expect(at(w, 'click-through-on').exists()).toBe(false);
    expect(at(w, 'overlay').classes()).not.toContain('overlay--passthrough');
  });

  it('상태를 확인하지 못하면 오류를 보인다', async () => {
    api.overlayStatus.mockRejectedValue('명령을 부를 수 없다');
    const w = await render();
    expect(at(w, 'error').text()).toContain('오버레이 상태를 확인하지 못했다');
    expect(at(w, 'status-unknown').exists()).toBe(true);
  });

  it('닫기 단추가 앱을 끝낸다', async () => {
    const w = await render();
    await at(w, 'quit').trigger('click');
    expect(api.quitApp).toHaveBeenCalledTimes(1);
  });

  it('화면이 내려가면 상태 구독을 끊는다', async () => {
    const w = await render();
    w.unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
    // 공유 상태·자동 추적의 구독도 끊는다.
    expect(disk.listeners.size).toBe(0);
    expect(trackListeners).toHaveLength(0);
  });

  it('창 끌기 영역이 있다', async () => {
    const w = await render();
    expect(w.find('header').attributes('data-tauri-drag-region')).toBeDefined();
  });

  it('「앱 열기」가 데스크톱 앱 창을 앞으로 가져온다 — 못 열면 이유를 알린다', async () => {
    const w = await render();
    await at(w, 'open-app').trigger('click');
    expect(api.showAppWindow).toHaveBeenCalledTimes(1);
    expect(at(w, 'error').exists()).toBe(false);

    api.showAppWindow.mockRejectedValue('앱 창을 찾을 수 없다');
    await at(w, 'open-app').trigger('click');
    await flushPromises();
    expect(at(w, 'error').text()).toBe('앱 창을 열지 못했다: 앱 창을 찾을 수 없다');
  });
});

describe('마지막 요격전 추천 결과', () => {
  it('저장된 결과가 없으면 「앱 창에서 계산하라」는 빈 상태와 단추 하나가 보인다', async () => {
    const w = await render();
    expect(at(w, 'intercept-result').exists()).toBe(false);
    expect(at(w, 'overlay-empty').find('[data-testid="empty-title"]').text()).toBe('아직 요격전 추천이 없다');
    expect(at(w, 'overlay-empty').find('[data-testid="empty-hint"]').text()).toContain('앱 창의 요격전에서 추천을 계산하면');
    await at(w, 'overlay-empty').find('[data-testid="empty-action"]').trigger('click');
    expect(api.showAppWindow).toHaveBeenCalledTimes(1);
  });

  it('저장해 둔 결과가 있으면 켜질 때 바로 보인다 — 보스 카드, 1위의 니케 다섯, 「추정」·「검증용 데이터」 배지', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'overlay-empty').exists()).toBe(false);
    expect(w.findAll('[data-testid="boss-card"]')).toHaveLength(sample.bosses.length);
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[0].name);
    expect(w.findAll('[data-testid="squad-member"]')).toHaveLength(5);
    // 좁은 창이라 작은 타일로 그린다.
    expect(at(w, 'squad-tiles').findAll('[data-testid="nikke-tile"]').map((t) => t.classes().includes('tile--sm'))).toEqual([true, true, true, true, true]);
    // 숨기면 안 되는 표시는 오버레이에서도 보인다.
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'bundle-kind').text()).toBe('검증용 보스 정보');
  });

  it('앱 창이 계산을 끝내 결과를 저장하면 알림을 받고 새 결과를 다시 읽어 보인다', async () => {
    const w = await render();
    expect(at(w, 'intercept-result').exists()).toBe(false);
    const reads = api.loadInterceptResult.mock.calls.length;

    // 앱 창이 저장했다(Rust가 모든 창에 알린다).
    disk.putIntercept(sample, true);
    await flushPromises();
    expect(api.loadInterceptResult.mock.calls.length).toBe(reads + 1);
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[0].name);

    // 다시 계산해 저장하면 또 바뀐다.
    disk.putIntercept(realReport, true);
    await flushPromises();
    expect(at(w, 'boss-name').text()).toBe(realReport.bosses[0].name);
    // 같은 알림이 또 와도(저장 시각이 같다) 다시 읽지 않는다.
    const after = api.loadInterceptResult.mock.calls.length;
    disk.emit();
    await flushPromises();
    expect(api.loadInterceptResult.mock.calls.length).toBe(after);
  });

  it('읽을 수 없는 결과(다른 종류·다른 판)가 저장돼 있으면 한국어로 알리고 앞서 보이던 것을 그대로 둔다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[0].name);

    disk.putIntercept({ ...sample, schema_version: 2 }, true);
    await flushPromises();
    expect(at(w, 'result-problem').text()).toContain('앞서 저장한 요격전 추천을 읽지 못했다');
    expect(at(w, 'result-problem').text()).toContain('schema_version이 맞지 않는다');
    expect(at(w, 'result-problem').attributes('role')).toBe('alert');
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[0].name);

    disk.putIntercept({ schema_version: 1, kind: 'growth', account: {}, baseline: {}, ranking: [] }, true);
    await flushPromises();
    expect(at(w, 'result-problem').text()).toContain('요격전 추천 결과가 아니다');
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[0].name);
  });
});

describe('자동 추적을 따라간다(보기만 한다)', () => {
  it('앱 창이 켜 둔 추적의 보스를 따라 고른다 — 이 창은 추적을 켜거나 끄지 않는다', async () => {
    disk.putIntercept(realReport);
    rustTrack = seeing('kraken');
    const w = await render();
    // 켜질 때 이미 보고 있던 보스.
    expect(at(w, 'boss-name').text()).toBe('크라켄');
    await emitTrack(seeing('ultra'));
    expect(at(w, 'boss-name').text()).toBe('울트라');
    expect(at(w, 'track-need-run').exists()).toBe(false);
    // 끄면(앱 창에서) 고른 보스는 그대로다.
    await emitTrack(trackOff());
    expect(at(w, 'boss-name').text()).toBe('울트라');
    expect(api.setScreenTracking).not.toHaveBeenCalled();
  });

  it('보고 있는 보스의 추천이 없으면 앱 창에서 계산하라고 알린다', async () => {
    disk.putIntercept(sample); // 검증용 보스 묶음의 결과(보스 id가 test-a…)
    rustTrack = seeing('kraken');
    const w = await render();
    expect(at(w, 'track-need-run').text()).toContain('게임에서 보고 있는 보스: 크라켄');
    expect(at(w, 'track-need-run').text()).toContain('앱 창의 요격전에서 계산한다');
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[0].name);
  });

  it('추적이 꺼져 있으면 안내도 없고 Rust에 아무것도 시키지 않는다', async () => {
    const w = await render();
    expect(at(w, 'track-need-run').exists()).toBe(false);
    expect(api.setScreenTracking).not.toHaveBeenCalled();
  });
});

describe('이 창이 하지 않는 것', () => {
  it('계산·계정·설정 명령을 부르지 않는다 — 결과 읽기와 창 조작뿐이다', async () => {
    disk.putIntercept(realReport);
    rustTrack = seeing('kraken');
    const w = await render();
    await emitTrack(seeing('ultra'));
    disk.putIntercept(sample, true);
    await flushPromises();
    await at(w, 'open-app').trigger('click');
    for (const fn of [
      api.engineRunBatch,
      api.readAccount,
      api.saveInterceptResult,
      api.setDefaultAccount,
      api.setOverlayLaunch,
      api.setOverlayVisible,
      api.setScreenTracking,
      api.setFollowGame,
      api.accountSyncStatus,
      api.startupReportPath,
      api.gameWindowStatus,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('부른 명령은 모두 오버레이 창의 권한 목록에 있다', async () => {
    disk.putIntercept(realReport);
    rustTrack = seeing('kraken');
    const w = await render();
    await at(w, 'open-app').trigger('click');
    await at(w, 'quit').trigger('click');
    await flushPromises();
    /** backend 함수 → Rust 명령(권한 이름). 이벤트 구독(on…)은 명령이 아니다. */
    const COMMANDS: Record<string, string> = {
      overlayStatus: 'overlay-status',
      quitApp: 'quit-app',
      showAppWindow: 'show-app-window',
      sharedState: 'shared-state',
      loadInterceptResult: 'load-intercept-result',
      screenTrackStatus: 'screen-track-status',
      engineCatalog: 'engine-catalog',
      nikkePortrait: 'nikke-portrait',
      bossImage: 'boss-image',
      gameIcon: 'game-icon',
    };
    const called = Object.entries(api)
      .filter(([name, fn]) => !name.startsWith('on') && vi.isMockFunction(fn) && fn.mock.calls.length > 0)
      .map(([name]) => name)
      .sort();
    expect(called.length).toBeGreaterThan(5);
    for (const name of called) {
      expect(COMMANDS[name], `${name}은(는) 오버레이 창이 부르면 안 되는 명령이다`).toBeDefined();
      expect(capability.permissions).toContain(`allow-${COMMANDS[name]}`);
    }
    // 권한 목록에 있는 앱 명령은 이 표가 전부다(쓰지 않는 권한이 없다).
    expect(capability.permissions.filter((p) => p.startsWith('allow-')).sort()).toEqual(Object.values(COMMANDS).map((c) => `allow-${c}`).sort());
  });

  it('계산 실행·계정 받기·앱 창의 화면을 가져오지 않는다', () => {
    expect(overlaySource).not.toMatch(/from '\.\/(pages|screens)\//);
    expect(overlaySource).not.toMatch(/lib\/(compute|engineRun|accountSync|accountLink|extensionLink|toolResults|nav)'/);
    // 입력 칸·실행 단추·설정이 없다.
    expect(overlaySource).not.toMatch(/<input|<select|run-intercept|run-compute/);
  });
});
