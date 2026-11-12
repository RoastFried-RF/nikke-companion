// 오버레이 창(게임 위에 뜨는 작은 위젯 — src/Overlay.vue): 마지막 요격전 추천을 세 모양으로 보여 준다.
// 이 창은 결과만 보여 준다 — 계산 실행·계정 받기·설정은 데스크톱 앱 창의 일이고, 권한(capabilities/overlay.json)도 그렇게 나뉘어 있다.
// Rust 쪽(backend)은 가짜다. 결과는 가짜 디스크(tests/helpers/shell.ts — 계정 폴더를 흉내 낸다)에 두고, 앱 창이 저장했다는 알림을 보낸다.
// 위젯의 모양·핀·설정과 계산 진행은 가짜 위젯(같은 파일의 FakeWidget — Rust가 쥔 상태를 흉내 낸다)이 쥔다.
//
// P-028: 오버레이가 위젯이 되면서 고친 것(무엇을 왜):
//   - 「상태 표시(조작 가능·창: 보임)」 → 위젯에는 그 줄이 없다. 클릭 통과 중일 때만 알린다(같은 testid `click-through-on`).
//   - 「닫기 단추가 앱을 끝낸다」 → 「숨기기 단추가 오버레이를 숨긴다 — 앱은 끝나지 않는다」(끝내기 명령 자체를 없앴다).
//   - 「창 끌기 영역(header)」 → 손잡이(`widget-grip`)와, 누른 채 움직이면 끄는 것.
//   - 「빈 상태(EmptyState)」 → 한 줄 알림과 「앱 열기」.
//   - 「보스 카드 다섯·큰 타일」 → 한 줄 카드(보스 하나)와 작은 초상화 다섯. 보스 고르기는 펼침 모양에 있다.
//   - 「보고 있는 보스의 추천이 없으면 … 앞의 보스를 그대로 보인다」 → 다른 보스의 편성을 보이지 않고 그 보스를 계산하라고 알린다.
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Overlay from '../src/Overlay.vue';
import overlaySource from '../src/Overlay.vue?raw';
import * as backend from '../src/lib/backend';
import { damageUnit } from '../src/lib/format';
import { clearImageCache } from '../src/lib/images';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import type { InterceptReport, OverlaySnapshot, ScreenTrackStatus } from '../src/types';
import capability from '../src-tauri/capabilities/overlay.json';
import anomalyBundle from '../../data/intercept/anomaly.json';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog } from './helpers/fakeEngine';
import { FakeDisk, FakeWidget, installShell, widgetOf } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
  engineCatalog: vi.fn(),
  engineRunBatch: vi.fn(),
  engineCancel: vi.fn(),
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
const totalOf = (report: InterceptReport, id: string) => damageUnit(report.bosses.find((b) => b.id === id)!.ranking[0].total_damage);

/** Rust가 보내는 상태 이벤트를 흉내 낸다. */
let emitOverlayState: (state: OverlaySnapshot) => void = () => {};
const unlisten = vi.fn();
let trackListeners: Array<(next: ScreenTrackStatus) => void> = [];
let rustTrack: ScreenTrackStatus;
let disk = new FakeDisk();
let widget = new FakeWidget();
/** 화면이 잰 위젯의 크기(테스트가 정한다 — 테스트 환경은 배치를 계산하지 않는다). */
let measured = { width: 0, height: 0 };
const realRect = HTMLElement.prototype.getBoundingClientRect;

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
const all = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  clearNikkeCatalog();
  clearImageCache();
  trackListeners = [];
  rustTrack = trackOff();
  measured = { width: 0, height: 0 };
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: measured.width, bottom: measured.height, width: measured.width, height: measured.height, toJSON: () => ({}) } as DOMRect;
  };
  disk = installShell(api);
  widget = widgetOf(disk);
  api.overlayStatus.mockResolvedValue(interactive);
  api.onOverlayState.mockImplementation(async (handler) => {
    emitOverlayState = handler;
    return unlisten;
  });
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

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

describe('오버레이 창의 틀', () => {
  it('켜지면 Rust가 쥔 모양(기본: 한 줄 카드)으로 마지막 결과를 보인다 — 조작할 수 있을 때는 상태 줄이 없다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget').attributes('data-shape')).toBe('card');
    expect(at(w, 'widget-card').exists()).toBe(true);
    expect(at(w, 'click-through-on').exists()).toBe(false);
    expect(at(w, 'widget-error').exists()).toBe(false);
  });

  it('단축키로 클릭 통과가 켜지면 눈에 띄게 표시하고, 꺼지면 되돌린다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'overlay').classes()).not.toContain('overlay--passthrough');

    emitOverlayState({ ...interactive, click_through: true });
    await flushPromises();
    expect(at(w, 'click-through-on').text()).toContain('클릭 통과 중');
    expect(at(w, 'click-through-on').text()).toContain('Alt+Shift+C');
    expect(at(w, 'overlay').classes()).toContain('overlay--passthrough');
    expect(at(w, 'widget').classes()).toContain('widget--passthrough');

    emitOverlayState(interactive);
    await flushPromises();
    expect(at(w, 'click-through-on').exists()).toBe(false);
    expect(at(w, 'overlay').classes()).not.toContain('overlay--passthrough');
  });

  it('상태를 확인하지 못하면 오류를 보인다', async () => {
    api.overlayStatus.mockRejectedValue('명령을 부를 수 없다');
    const w = await render();
    expect(at(w, 'widget-error').text()).toContain('오버레이 상태를 확인하지 못했다');
    expect(at(w, 'widget-error').attributes('role')).toBe('alert');
  });

  it('숨기기 단추가 오버레이를 숨긴다 — 앱은 끝나지 않는다(끝내기 단추가 없다)', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'quit').exists()).toBe(false);
    await at(w, 'widget-hide').trigger('click');
    await flushPromises();
    expect(api.overlayHide).toHaveBeenCalledTimes(1);
    expect(at(w, 'widget-error').exists()).toBe(false);
    // 끝내기 명령은 화면 쪽에 아예 없다.
    expect(Object.keys(backend)).not.toContain('quitApp');
    expect(overlaySource).not.toMatch(/quit/i);

    api.overlayHide.mockRejectedValue('오버레이 창을 숨기지 못했다');
    await at(w, 'widget-hide').trigger('click');
    await flushPromises();
    expect(at(w, 'widget-error').text()).toBe('오버레이를 숨기지 못했다: 오버레이 창을 숨기지 못했다');
  });

  it('화면이 내려가면 상태 구독을 끊는다', async () => {
    const w = await render();
    w.unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
    // 공유 상태·자동 추적·위젯 상태·계산 진행의 구독도 끊는다.
    expect(disk.listeners.size).toBe(0);
    expect(trackListeners).toHaveLength(0);
    expect(widget.listeners.size).toBe(0);
    expect(widget.activityListeners.size).toBe(0);
  });

  it('끌어서 옮긴다: 손잡이가 있고, 위젯을 누른 채 조금 움직이면 창을 끈다 — 움직이지 않고 놓으면 누른 것이다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget-grip').attributes('data-tauri-drag-region')).toBeDefined();

    const root = at(w, 'overlay');
    // 누르고 거의 움직이지 않았다: 끌기가 아니다.
    await root.trigger('mousedown', { button: 0, screenX: 100, screenY: 100 });
    await root.trigger('mousemove', { buttons: 1, screenX: 102, screenY: 101 });
    await root.trigger('mouseup');
    expect(api.startOverlayDrag).not.toHaveBeenCalled();
    // 누른 채 움직였다: 한 번 끈다(창을 옮기는 것은 운영체제가 한다).
    await root.trigger('mousedown', { button: 0, screenX: 100, screenY: 100 });
    await root.trigger('mousemove', { buttons: 1, screenX: 110, screenY: 100 });
    await root.trigger('mousemove', { buttons: 1, screenX: 130, screenY: 100 });
    expect(api.startOverlayDrag).toHaveBeenCalledTimes(1);
    // 단추를 누르지 않은 채 움직이는 것, 오른쪽 단추로 누른 것은 끌기가 아니다.
    await root.trigger('mousemove', { buttons: 0, screenX: 300, screenY: 300 });
    await root.trigger('mousedown', { button: 2, screenX: 100, screenY: 100 });
    await root.trigger('mousemove', { buttons: 2, screenX: 200, screenY: 200 });
    // 누른 뒤 창 밖에서 놓았다(놓는 것을 듣지 못했다): 다음 움직임을 끌기로 보지 않는다.
    await root.trigger('mousedown', { button: 0, screenX: 100, screenY: 100 });
    await root.trigger('mousemove', { buttons: 0, screenX: 180, screenY: 100 });
    await root.trigger('mousemove', { buttons: 1, screenX: 260, screenY: 100 });
    expect(api.startOverlayDrag).toHaveBeenCalledTimes(1);
  });

  it('「앱 열기」가 데스크톱 앱 창을 앞으로 가져온다 — 못 열면 이유를 알린다', async () => {
    const w = await render();
    await at(w, 'open-app').trigger('click');
    expect(api.showAppWindow).toHaveBeenCalledTimes(1);
    expect(at(w, 'widget-error').exists()).toBe(false);

    api.showAppWindow.mockRejectedValue('앱 창을 찾을 수 없다');
    await at(w, 'open-app').trigger('click');
    await flushPromises();
    expect(at(w, 'widget-error').text()).toBe('앱 창을 열지 못했다: 앱 창을 찾을 수 없다');
  });
});

describe('모양 셋 — 누르거나 단축키로 오가고, 창 크기가 모양에 맞게 줄고 늘어난다', () => {
  it('누르면 Rust에 모양을 바꾸라고 하고, 돌아온 모양으로 다시 그린다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    await at(w, 'widget-toggle').trigger('click');
    await flushPromises();
    expect(api.overlayShape).toHaveBeenLastCalledWith('expanded');
    expect(at(w, 'widget').attributes('data-shape')).toBe('expanded');
    expect(at(w, 'widget-more').exists()).toBe(true);

    await at(w, 'widget-collapse').trigger('click');
    await flushPromises();
    expect(api.overlayShape).toHaveBeenLastCalledWith('collapsed');
    expect(at(w, 'widget-pill').exists()).toBe(true);
    expect(at(w, 'widget-card').exists()).toBe(false);

    await at(w, 'widget-open').trigger('click');
    await flushPromises();
    expect(api.overlayShape).toHaveBeenLastCalledWith('card');
    expect(at(w, 'widget-card').exists()).toBe(true);
  });

  it('단축키(Alt+Shift+M)·자동 표시로 Rust가 모양을 바꾸면 알림을 받고 따라 그린다 — 화면은 Rust에 아무것도 시키지 않는다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    for (const shape of ['expanded', 'collapsed', 'card'] as const) {
      widget.set({ shape });
      await flushPromises();
      expect(at(w, 'widget').attributes('data-shape')).toBe(shape);
    }
    expect(api.overlayShape).not.toHaveBeenCalled();
  });

  it('모양을 바꾸지 못하면 이유를 알리고 앞의 모양을 그대로 둔다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    api.overlayShape.mockRejectedValue('모르는 오버레이 모양이다');
    await at(w, 'widget-toggle').trigger('click');
    await flushPromises();
    expect(at(w, 'widget').attributes('data-shape')).toBe('card');
    expect(at(w, 'widget-error').text()).toBe('오버레이의 모양을 바꾸지 못했다: 모르는 오버레이 모양이다');
  });

  it('위젯의 크기를 재서 Rust에 알린다 — 모양이 바뀌어 크기가 달라질 때마다, 같은 크기면 다시 알리지 않는다', async () => {
    disk.putIntercept(sample);
    measured = { width: 440, height: 86.2 };
    const w = await render();
    expect(at(w, 'widget-card').exists()).toBe(true);
    // 처음 그린 크기(소수는 올린다 — 창이 위젯보다 작아 잘리지 않게).
    expect(api.overlayFit).toHaveBeenLastCalledWith(440, 87);
    const first = api.overlayFit.mock.calls.length;

    // 펼쳤다: 더 커진 크기를 알린다.
    measured = { width: 440, height: 402 };
    widget.set({ shape: 'expanded' });
    await flushPromises();
    expect(api.overlayFit).toHaveBeenLastCalledWith(440, 402);
    // 접었다: 알약만큼 줄어든 크기를 알린다(빈 투명 영역이 남지 않는다).
    measured = { width: 212.5, height: 38 };
    widget.set({ shape: 'collapsed' });
    await flushPromises();
    expect(api.overlayFit).toHaveBeenLastCalledWith(213, 38);
    expect(api.overlayFit.mock.calls.length).toBe(first + 2);

    // 크기가 그대로면(같은 모양으로 다시 그렸다) 다시 알리지 않는다.
    widget.set({ pinned: true });
    await flushPromises();
    expect(api.overlayFit.mock.calls.length).toBe(first + 2);
    // 화면이 넘기는 것은 크기 둘뿐이다 — 자리는 넘기지 않는다.
    for (const call of api.overlayFit.mock.calls) expect(call).toHaveLength(2);
  });

  it('잴 수 없으면(아직 그려지지 않았다) 창을 건드리지 않고, 알리지 못했으면 다음에 다시 알린다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(api.overlayFit).not.toHaveBeenCalled();

    api.overlayFit.mockRejectedValueOnce('오버레이 창을 찾을 수 없다');
    measured = { width: 440, height: 86 };
    widget.set({ pinned: true });
    await flushPromises();
    expect(api.overlayFit).toHaveBeenCalledTimes(1);
    // 같은 크기지만 앞의 것이 실패했다: 다시 알린다.
    widget.set({ pinned: false });
    await flushPromises();
    expect(api.overlayFit).toHaveBeenCalledTimes(2);
    expect(at(w, 'widget-card').exists()).toBe(true);
  });

  it('크기 알림은 한 번에 하나씩 보낸다 — 가는 동안 또 바뀌면 끝난 뒤 마지막 크기만 이어서 알린다(옛 크기가 나중에 닿지 않게)', async () => {
    // 실제 창에서 본 결함: 켜지는 동안 크기가 잇달아 바뀌면 알림이 겹쳐 가고, 먼저 잰 크기가 나중에 적용돼 창이 위젯보다 작게 남았다.
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget').exists()).toBe(true);
    let release: () => void = () => {};
    api.overlayFit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    measured = { width: 480, height: 86 };
    widget.set({ pinned: true });
    await flushPromises();
    expect(api.overlayFit).toHaveBeenCalledTimes(1);
    expect(api.overlayFit).toHaveBeenLastCalledWith(480, 86);

    // 첫 알림이 가는 동안 두 번 더 바뀌었다: 그동안에는 보내지 않는다.
    measured = { width: 480, height: 300 };
    widget.set({ shape: 'expanded' });
    await flushPromises();
    measured = { width: 480, height: 427 };
    widget.set({ pinned: false });
    await flushPromises();
    expect(api.overlayFit).toHaveBeenCalledTimes(1);

    // 첫 알림이 끝났다: 중간 크기는 건너뛰고 마지막 크기 하나만 알린다.
    release();
    await flushPromises();
    expect(api.overlayFit).toHaveBeenCalledTimes(2);
    expect(api.overlayFit).toHaveBeenLastCalledWith(480, 427);
  });

  it('크기 배율·불투명도는 앱 창의 설정을 따른다(기본은 100%·불투명) — 배율이 바뀌면 창 크기도 다시 맞춘다', async () => {
    disk.putIntercept(sample);
    measured = { width: 440, height: 86 };
    const w = await render();
    expect(at(w, 'overlay').attributes('data-scale')).toBe('100');
    expect(at(w, 'overlay').attributes('data-opacity')).toBe('100');
    expect(at(w, 'overlay').attributes('style')).toContain('opacity: 1');

    measured = { width: 550, height: 108 };
    widget.set({ prefs: { ...widget.state.prefs, scale_percent: 125, opacity_percent: 70 } });
    await flushPromises();
    expect(at(w, 'overlay').attributes('data-scale')).toBe('125');
    expect(at(w, 'overlay').attributes('style')).toContain('zoom: 1.25');
    expect(at(w, 'overlay').attributes('style')).toContain('opacity: 0.7');
    expect(api.overlayFit).toHaveBeenLastCalledWith(550, 108);
    // 이 창은 설정을 바꾸지 않는다.
    expect(api.setOverlayPrefs).not.toHaveBeenCalled();
  });

  it('핀을 누르면 Rust에 고정하라고 하고, 고정 여부를 단추에 보인다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget-pin').attributes('aria-pressed')).toBe('false');
    await at(w, 'widget-pin').trigger('click');
    await flushPromises();
    expect(api.overlayPin).toHaveBeenLastCalledWith(true);
    expect(at(w, 'widget-pin').attributes('aria-pressed')).toBe('true');
    await at(w, 'widget-pin').trigger('click');
    await flushPromises();
    expect(api.overlayPin).toHaveBeenLastCalledWith(false);
    expect(at(w, 'widget-pin').attributes('aria-pressed')).toBe('false');
  });
});

describe('마지막 요격전 추천 결과', () => {
  it('저장된 결과가 없으면 한 줄로 알리고 「앱 열기」만 둔다 — 계정이 없으면 계정부터', async () => {
    const w = await render();
    expect(at(w, 'widget-card').exists()).toBe(false);
    expect(at(w, 'widget').attributes('data-state')).toBe('no-account');
    expect(at(w, 'widget-notice-text').text()).toBe('연결된 계정이 없다 — 앱에서 계정을 연결한다');
    expect(w.findAll('button').map((b) => b.attributes('data-testid'))).toEqual(['open-app', 'widget-hide']);
    await at(w, 'open-app').trigger('click');
    expect(api.showAppWindow).toHaveBeenCalledTimes(1);
    w.unmount();

    // 계정은 있지만 아직 계산하지 않았다.
    disk.addAccount('me', { schema_version: 1, is_test_data: true, name: 'me', nikkes: {} });
    const again = await render();
    expect(at(again, 'widget').attributes('data-state')).toBe('empty');
    expect(at(again, 'widget-notice-text').text()).toBe('아직 요격전 추천이 없다 — 앱에서 계산한다');
  });

  it('저장해 둔 결과가 있으면 켜질 때 바로 보인다 — 보스 하나, 1위의 니케 다섯, 「추정」·「검증용 데이터」', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget-notice').exists()).toBe(false);
    expect(at(w, 'widget-boss').text()).toBe(sample.bosses[0].name);
    expect(at(w, 'widget-total').text()).toBe(totalOf(sample, 'test-a'));
    expect(all(w, 'widget-member')).toHaveLength(5);
    expect(at(w, 'widget-squad').findAll('[data-testid="nikke-tile"]').map((t) => t.classes().includes('tile--mini'))).toEqual([true, true, true, true, true]);
    // 약점 속성 니케는 엔진 카탈로그의 속성·결과의 약점 속성 보유 목록으로 강조한다.
    expect(all(w, 'widget-member').filter((m) => m.attributes('data-weak') === 'yes').length).toBeGreaterThan(0);
    // 숨기면 안 되는 표시는 오버레이에서도 보인다. 어느 계정·언제 것인지도.
    expect(at(w, 'estimate-pill').text()).toBe('추정');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'widget-source').text()).toContain(sample.account.name);
    expect(at(w, 'widget-source').text()).toContain('계산');
    // 펼치면 검증용 보스 정보와 한 줄 요약도 보인다.
    widget.set({ shape: 'expanded' });
    await flushPromises();
    expect(at(w, 'bundle-kind').text()).toBe('검증용 보스 정보');
    expect(at(w, 'boss-summary').text().length).toBeGreaterThan(5);
  });

  it('앱 창이 계산을 끝내 결과를 저장하면 알림을 받고 새 결과를 다시 읽어 보인다', async () => {
    disk.addAccount('me', { schema_version: 1, is_test_data: true, name: 'me', nikkes: {} });
    const w = await render();
    expect(at(w, 'widget-card').exists()).toBe(false);
    const reads = api.loadInterceptResult.mock.calls.length;

    // 앱 창이 저장했다(Rust가 모든 창에 알린다).
    disk.putIntercept(sample, true);
    await flushPromises();
    expect(api.loadInterceptResult.mock.calls.length).toBe(reads + 1);
    expect(at(w, 'widget-boss').text()).toBe(sample.bosses[0].name);

    // 다시 계산해 저장하면 또 바뀐다.
    disk.putIntercept(realReport, true);
    await flushPromises();
    expect(at(w, 'widget-boss').text()).toBe(realReport.bosses[0].name);
    // 같은 알림이 또 와도(저장 시각이 같다) 다시 읽지 않는다.
    const after = api.loadInterceptResult.mock.calls.length;
    disk.emit();
    await flushPromises();
    expect(api.loadInterceptResult.mock.calls.length).toBe(after);
  });

  it('읽을 수 없는 결과(다른 종류·다른 판)가 저장돼 있으면 한국어로 알리고 앞서 보이던 것을 그대로 둔다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget-boss').text()).toBe(sample.bosses[0].name);

    disk.putIntercept({ ...sample, schema_version: 2 }, true);
    await flushPromises();
    expect(at(w, 'widget-error').text()).toContain('앞서 저장한 요격전 추천을 읽지 못했다');
    expect(at(w, 'widget-error').text()).toContain('schema_version이 맞지 않는다');
    expect(at(w, 'widget-error').attributes('role')).toBe('alert');
    expect(at(w, 'widget-boss').text()).toBe(sample.bosses[0].name);

    disk.putIntercept({ schema_version: 1, kind: 'growth', account: {}, baseline: {}, ranking: [] }, true);
    await flushPromises();
    expect(at(w, 'widget-error').text()).toContain('요격전 추천 결과가 아니다');
    expect(at(w, 'widget-boss').text()).toBe(sample.bosses[0].name);
  });

  it('펼침의 보스 고르기로 다른 보스를 본다 — 고른 보스를 기억한다', async () => {
    disk.putIntercept(sample);
    widget.state.shape = 'expanded';
    const w = await render();
    expect(at(w, 'widget-boss').text()).toBe('시험 보스 A');
    await all(w, 'widget-boss-pick')[3].trigger('click');
    await flushPromises();
    expect(at(w, 'widget-boss').text()).toBe('시험 보스 D');
    expect(at(w, 'widget-total').text()).toBe(totalOf(sample, 'test-d'));
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('test-d');
    w.unmount();
    // 다시 켜도 그 보스다.
    const again = await render();
    expect(at(again, 'widget-boss').text()).toBe('시험 보스 D');
  });

  it('앱 창에서 보스를 고르면(같은 저장소) 오버레이도 그 보스를 보인다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget-boss').text()).toBe('시험 보스 A');
    window.dispatchEvent(new StorageEvent('storage', { key: 'nikke-companion.intercept.boss', newValue: 'test-c' }));
    await flushPromises();
    expect(at(w, 'widget-boss').text()).toBe('시험 보스 C');
    // 다른 열쇠의 변화는 따르지 않는다.
    window.dispatchEvent(new StorageEvent('storage', { key: 'nikke-companion.page', newValue: 'test-b' }));
    await flushPromises();
    expect(at(w, 'widget-boss').text()).toBe('시험 보스 C');
  });
});

describe('계산 중 — 앱 창이 알린 진행을 작게 보인다', () => {
  it('결과가 없을 때: 한 줄과 진행 막대, 「앱 열기」 — 계산이 끝나 결과가 오면 카드로 바뀐다', async () => {
    disk.addAccount('me', { schema_version: 1, is_test_data: true, name: 'me', nikkes: {} });
    const w = await render();
    widget.announce({ running: true, label: '크라켄 추천 편성을 찾는 중', done: 12, total: 60, elapsed_ms: 12_000 });
    await flushPromises();
    expect(at(w, 'widget').attributes('data-state')).toBe('computing');
    expect(at(w, 'widget-notice-text').text()).toBe('앱에서 추천을 계산하는 중');
    expect(at(w, 'widget-activity-fill').attributes('style')).toContain('width: 20%');
    expect(at(w, 'widget-activity-eta').text()).toBe('약 50초 남음');
    expect(at(w, 'open-app').exists()).toBe(true);

    widget.announce({ running: false, label: '', done: 0, total: 0, elapsed_ms: 0 });
    disk.putIntercept(sample, true);
    await flushPromises();
    expect(at(w, 'widget').attributes('data-state')).toBe('result');
    expect(at(w, 'widget-activity').exists()).toBe(false);
  });

  it('켜질 때 이미 계산 중이었으면 그 진행부터 보인다', async () => {
    disk.putIntercept(sample);
    widget.activity = { running: true, label: '하베스터 추천 편성을 찾는 중', done: 30, total: 60, elapsed_ms: 60_000 };
    const w = await render();
    expect(at(w, 'widget-activity').text()).toContain('앱에서 다시 계산하는 중');
    expect(at(w, 'widget-activity-eta').text()).toBe('약 1분 남음');
    // 앞의 결과는 그대로 보인다.
    expect(at(w, 'widget-boss').text()).toBe(sample.bosses[0].name);
  });

  it('이 창은 진행을 알리지도, 계산을 시작하거나 멈추지도 않는다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    widget.announce({ running: true, label: '찾는 중', done: 1, total: 60, elapsed_ms: 1000 });
    await flushPromises();
    expect(at(w, 'widget-activity').exists()).toBe(true);
    for (const fn of [api.announceActivity, api.engineRunBatch, api.engineCancel]) expect(fn).not.toHaveBeenCalled();
  });
});

describe('자동 추적을 따라간다(보기만 한다)', () => {
  it('앱 창이 켜 둔 추적의 보스를 따라 고른다 — 이 창은 추적을 켜거나 끄지 않는다', async () => {
    disk.putIntercept(realReport);
    rustTrack = seeing('kraken');
    const w = await render();
    // 켜질 때 이미 보고 있던 보스.
    expect(at(w, 'widget-boss').text()).toBe('크라켄');
    expect(at(w, 'widget-total').text()).toBe(totalOf(realReport, 'kraken'));
    await emitTrack(seeing('ultra'));
    expect(at(w, 'widget-boss').text()).toBe('울트라');
    expect(at(w, 'boss-face').attributes('data-boss')).toBe('ultra');
    expect(at(w, 'widget-notice').exists()).toBe(false);
    // 끄면(앱 창에서) 고른 보스는 그대로다.
    await emitTrack(trackOff());
    expect(at(w, 'widget-boss').text()).toBe('울트라');
    expect(api.setScreenTracking).not.toHaveBeenCalled();
  });

  it('같은 인식이 이어지는 동안에는 손으로 고른 보스를 되돌리지 않는다', async () => {
    disk.putIntercept(realReport);
    rustTrack = seeing('kraken');
    widget.state.shape = 'expanded';
    const w = await render();
    expect(at(w, 'widget-boss').text()).toBe('크라켄');
    await all(w, 'widget-boss-pick')[0].trigger('click');
    await flushPromises();
    expect(at(w, 'widget-boss').text()).toBe(realReport.bosses[0].name);
    // 같은 화면·같은 보스가 또 읽혔다: 그대로다.
    await emitTrack(seeing('kraken'));
    expect(at(w, 'widget-boss').text()).toBe(realReport.bosses[0].name);
    // 게임에서 다른 보스로 넘겼다: 따라간다.
    await emitTrack(seeing('harvester'));
    expect(at(w, 'widget-boss').text()).toBe('하베스터');
  });

  it('보고 있는 보스의 추천이 없으면 다른 보스의 편성을 보이지 않고 앱에서 계산하라고 알린다 — 결과가 생기면 카드로 바뀐다', async () => {
    disk.putIntercept(sample); // 검증용 보스 묶음의 결과(보스 id가 test-a…)
    rustTrack = seeing('kraken');
    const w = await render();
    expect(at(w, 'widget').attributes('data-state')).toBe('missing');
    expect(at(w, 'widget-notice-text').text()).toBe('크라켄 추천이 아직 없다 — 앱에서 계산한다');
    // 보스의 속성은 내장 보스 묶음에서 안다(이미지가 없을 때의 바탕색).
    expect(at(w, 'boss-face').attributes('data-boss')).toBe('kraken');
    expect(at(w, 'boss-face').attributes('data-element')).toBe(anomalyBundle.bosses.find((b) => b.id === 'kraken')!.enemy.code);
    expect(at(w, 'widget-card').exists()).toBe(false);
    expect(at(w, 'open-app').exists()).toBe(true);

    // 앱 창이 실제 보스로 계산해 저장했다.
    disk.putIntercept(realReport, true);
    await flushPromises();
    expect(at(w, 'widget').attributes('data-state')).toBe('result');
    expect(at(w, 'widget-boss').text()).toBe('크라켄');
  });

  it('결과가 아예 없을 때 보스를 보고 있으면 그 보스를 계산하라고 알린다', async () => {
    disk.addAccount('me', { schema_version: 1, is_test_data: true, name: 'me', nikkes: {} });
    rustTrack = seeing('ultra');
    const w = await render();
    expect(at(w, 'widget-notice-text').text()).toBe('울트라 추천이 아직 없다 — 앱에서 계산한다');
  });

  it('추적이 꺼져 있으면 안내도 없고 Rust에 아무것도 시키지 않는다', async () => {
    disk.putIntercept(sample);
    const w = await render();
    expect(at(w, 'widget').attributes('data-state')).toBe('result');
    expect(api.setScreenTracking).not.toHaveBeenCalled();
  });

  it('이상 개체 화면을 떠나 Rust가 접으면(자동 표시) 접힌 알약이 되고, 돌아와 되돌리면 카드가 된다 — 언제 접을지는 화면이 정하지 않는다', async () => {
    disk.putIntercept(realReport);
    rustTrack = seeing('kraken');
    const w = await render();
    expect(at(w, 'widget-card').exists()).toBe(true);
    // 게임이 다른 화면으로 갔다: 화면은 스스로 접지 않는다(규칙과 시간은 Rust에 있다).
    await emitTrack({ ...seeing('kraken'), recognition: { screen: 'other', boss: null, confidence: 0.9, evidence: [], width: 1881, height: 1058 }, message: '이상 개체 요격전 화면이 아니다' });
    expect(at(w, 'widget').attributes('data-shape')).toBe('card');
    // Rust의 자동 표시가 접었다.
    widget.set({ shape: 'collapsed' });
    await flushPromises();
    expect(at(w, 'widget-pill').exists()).toBe(true);
    expect(at(w, 'widget-boss').text()).toBe('크라켄');
    // 돌아왔다: Rust가 되돌린다.
    await emitTrack(seeing('kraken'));
    widget.set({ shape: 'card' });
    await flushPromises();
    expect(at(w, 'widget-card').exists()).toBe(true);
    expect(overlaySource).not.toMatch(/setTimeout|setInterval|leave_after|AutoShow/);
  });
});

describe('이 창이 하지 않는 것', () => {
  it('계산·계정·설정 명령을 부르지 않는다 — 결과 읽기와 자기 창의 조작뿐이다', async () => {
    disk.putIntercept(realReport);
    rustTrack = seeing('kraken');
    measured = { width: 440, height: 86 };
    const w = await render();
    await emitTrack(seeing('ultra'));
    await at(w, 'widget-pin').trigger('click');
    await at(w, 'widget-toggle').trigger('click');
    await flushPromises();
    // 보고 있는 보스가 없는 결과로 바뀌었다(한 줄 알림): 여기서도 계산을 시작하지 않는다.
    disk.putIntercept(sample, true);
    await flushPromises();
    expect(at(w, 'widget').attributes('data-state')).toBe('missing');
    await at(w, 'open-app').trigger('click');
    await at(w, 'widget-hide').trigger('click');
    await flushPromises();
    for (const fn of [
      api.engineRunBatch,
      api.engineCancel,
      api.readAccount,
      api.saveInterceptResult,
      api.setDefaultAccount,
      api.setOverlayLaunch,
      api.setOverlayVisible,
      api.setOverlayPrefs,
      api.resetOverlayPosition,
      api.announceActivity,
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
    measured = { width: 440, height: 86 };
    const w = await render();
    await at(w, 'widget-pin').trigger('click');
    await at(w, 'widget-toggle').trigger('click');
    await flushPromises();
    await at(w, 'open-app').trigger('click');
    await at(w, 'widget-hide').trigger('click');
    const root = at(w, 'overlay');
    await root.trigger('mousedown', { button: 0, screenX: 0, screenY: 0 });
    await root.trigger('mousemove', { buttons: 1, screenX: 40, screenY: 0 });
    await flushPromises();
    /** backend 함수 → Rust 명령(권한 이름). 이벤트 구독(on…)은 명령이 아니다. */
    const COMMANDS: Record<string, string> = {
      overlayStatus: 'overlay-status',
      overlayWidget: 'overlay-widget',
      overlayShape: 'overlay-shape',
      overlayPin: 'overlay-pin',
      overlayFit: 'overlay-fit',
      overlayHide: 'overlay-hide',
      showAppWindow: 'show-app-window',
      sharedState: 'shared-state',
      loadInterceptResult: 'load-intercept-result',
      screenTrackStatus: 'screen-track-status',
      computeActivity: 'compute-activity',
      engineCatalog: 'engine-catalog',
      nikkePortrait: 'nikke-portrait',
      bossImage: 'boss-image',
      gameIcon: 'game-icon',
    };
    /** 창 끌기는 앱 명령이 아니라 창 권한이다. */
    const WINDOW: Record<string, string> = { startOverlayDrag: 'core:window:allow-start-dragging' };
    const called = Object.entries(api)
      .filter(([name, fn]) => !name.startsWith('on') && vi.isMockFunction(fn) && fn.mock.calls.length > 0)
      .map(([name]) => name)
      .sort();
    expect(called.length).toBeGreaterThan(10);
    for (const name of called) {
      if (WINDOW[name]) {
        expect(capability.permissions).toContain(WINDOW[name]);
        continue;
      }
      expect(COMMANDS[name], `${name}은(는) 오버레이 창이 부르면 안 되는 명령이다`).toBeDefined();
      expect(capability.permissions).toContain(`allow-${COMMANDS[name]}`);
    }
    // 이 흐름이 권한 목록의 앱 명령을 빠짐없이 썼다(쓰지 않는 권한이 없다).
    expect(called.filter((name) => !WINDOW[name]).map((name) => `allow-${COMMANDS[name]}`).sort()).toEqual(capability.permissions.filter((p) => p.startsWith('allow-')).sort());
    expect(capability.permissions.filter((p) => p.startsWith('allow-')).sort()).toEqual(Object.values(COMMANDS).map((c) => `allow-${c}`).sort());
  });

  it('계산 실행·계정 받기·앱 창의 화면을 가져오지 않는다', () => {
    expect(overlaySource).not.toMatch(/from '\.\/(pages|screens)\//);
    expect(overlaySource).not.toMatch(/lib\/(compute|engineRun|accountSync|accountLink|extensionLink|toolResults|nav)'/);
    // 입력 칸·실행 단추·설정이 없다.
    expect(overlaySource).not.toMatch(/<input|<select|run-intercept|run-compute/);
    // 설정을 바꾸거나 진행을 알리는 함수를 가져오지 않는다.
    expect(overlaySource).not.toMatch(/setOverlayPrefs|resetOverlayPosition|announceActivity|announceWhile|setOverlayVisible/);
  });
});
