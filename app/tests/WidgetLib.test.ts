// 오버레이 위젯이 기대는 작은 규칙들(P-028): 모양의 차례·설정의 범위·창 크기 맞춤(lib/widget.ts), 결과에서 꺼내는 값(lib/bossView.ts),
// 계산 진행을 두 창이 함께 보는 길(lib/activity.ts). Rust 쪽(backend)은 가짜다.
import { summarizeInterceptBoss } from '@core/summary.mjs';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { announceWhile, IDLE, useActivity } from '../src/lib/activity';
import * as backend from '../src/lib/backend';
import { bestOf, bestTotal, summaryOf, unconfirmedOf, weakNamesOf } from '../src/lib/bossView';
import { nikkeInfoFrom } from '../src/lib/nikkeInfo';
import { clampSetting, DEFAULT_PREFS, fitRequest, LEAVE_AFTER_RANGE, LEAVES, nextShape, OPACITY_RANGE, SCALE_RANGE, SHAPES, useWidget, WIDGET_SHORTCUTS } from '../src/lib/widget';
import type { ComputeActivity, InterceptReport, NikkeInfo, OverlayShape } from '../src/types';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog } from './helpers/fakeEngine';
import { FakeDisk, FakeWidget, installShell, WIDGET_PREFS, widgetOf } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
}));

const api = vi.mocked(backend);
const sample = interceptFixture as unknown as InterceptReport;
const info = (name: string): NikkeInfo => nikkeInfoFrom(catalog, name);
let disk = new FakeDisk();
let widget = new FakeWidget();

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  disk = installShell(api);
  widget = widgetOf(disk);
});

describe('모양과 설정의 범위', () => {
  it('모양은 접힘 → 한 줄 카드 → 펼침 → 접힘으로 돈다', () => {
    expect(SHAPES.map((s) => s.key)).toEqual(['collapsed', 'card', 'expanded']);
    expect(SHAPES.map((s) => s.label)).toEqual(['접힘', '한 줄 카드', '펼침']);
    const walk: OverlayShape[] = ['collapsed'];
    for (let i = 0; i < 3; i += 1) walk.push(nextShape(walk[walk.length - 1]));
    expect(walk).toEqual(['collapsed', 'card', 'expanded', 'collapsed']);
  });

  it('기본 설정: 100%·불투명·한 줄 카드·떠나면 8초 뒤 접기·클릭 통과 꺼짐', () => {
    expect(DEFAULT_PREFS).toEqual({ scale_percent: 100, opacity_percent: 100, leave: 'collapse', leave_after_sec: 8, default_shape: 'card', click_through: false });
    expect(DEFAULT_PREFS).toEqual(WIDGET_PREFS);
    expect(LEAVES.map((l) => l.key)).toEqual(['stay', 'collapse', 'hide']);
    // 오버레이에 안내하는 단축키는 셋이다: 보이기/숨기기·클릭 통과·모양 바꾸기.
    expect(WIDGET_SHORTCUTS.map((s) => s.keys)).toEqual(['Alt+Shift+O', 'Alt+Shift+C', 'Alt+Shift+M']);
  });

  it('화면이 준 수는 범위 안의 정수로 맞추고, 수가 아니면 기본값이다', () => {
    expect(clampSetting('125', SCALE_RANGE)).toBe(125);
    expect(clampSetting(999, SCALE_RANGE)).toBe(150);
    expect(clampSetting(-5, SCALE_RANGE)).toBe(80);
    expect(clampSetting('112.6', SCALE_RANGE)).toBe(113);
    expect(clampSetting('', SCALE_RANGE)).toBe(100);
    expect(clampSetting('크게', OPACITY_RANGE)).toBe(100);
    expect(clampSetting(10, OPACITY_RANGE)).toBe(40);
    expect(clampSetting(0, LEAVE_AFTER_RANGE)).toBe(2);
    expect(clampSetting(Number.NaN, LEAVE_AFTER_RANGE)).toBe(8);
  });

  it('창 크기 맞춤: 잰 크기의 소수는 올리고, 잴 수 없었으면(0·수가 아님) 알리지 않는다', () => {
    expect(fitRequest(440, 86)).toEqual({ width: 440, height: 86 });
    expect(fitRequest(212.2, 38.01)).toEqual({ width: 213, height: 39 });
    for (const [w, h] of [
      [0, 86],
      [440, 0],
      [-1, 86],
      [Number.NaN, 86],
      [440, Number.POSITIVE_INFINITY],
    ]) {
      expect(fitRequest(w, h), `${w}×${h}`).toBeNull();
    }
  });
});

describe('위젯 상태(useWidget)', () => {
  function host() {
    let api_: ReturnType<typeof useWidget> | null = null;
    const w = mount(
      defineComponent({
        setup() {
          api_ = useWidget();
          return () => h('div');
        },
      }),
    );
    return { w, widget: () => api_! };
  }

  it('켜질 때 Rust의 상태를 읽고, 바뀔 때마다 알림을 받아 따른다 — 화면이 내려가면 구독을 끊는다', async () => {
    widget.state.shape = 'expanded';
    const { w, widget: use } = host();
    await flushPromises();
    expect(use().snapshot.value?.shape).toBe('expanded');
    widget.set({ shape: 'collapsed', resting: true });
    expect(use().snapshot.value).toMatchObject({ shape: 'collapsed', resting: true });
    w.unmount();
    expect(widget.listeners.size).toBe(0);
  });

  it('시킨 일이 실패하면 무엇을 못 했는지 한국어로 남기고 앞의 상태를 둔다 — 다음에 성공하면 지운다', async () => {
    const { widget: use } = host();
    await flushPromises();
    api.overlayPin.mockRejectedValueOnce('오버레이 창을 찾을 수 없다');
    await use().setPinned(true);
    expect(use().problem.value).toBe('오버레이를 고정하지 못했다: 오버레이 창을 찾을 수 없다');
    expect(use().snapshot.value?.pinned).toBe(false);
    await use().setPinned(true);
    expect(use().problem.value).toBe('');
    expect(use().snapshot.value?.pinned).toBe(true);

    api.setOverlayPrefs.mockRejectedValueOnce('모르는 자동 숨김 방법이다');
    expect(await use().setPrefs({ leave: 'hide' })).toBe(false);
    expect(use().problem.value).toBe('오버레이 설정을 바꾸지 못했다: 모르는 자동 숨김 방법이다');
    expect(await use().setPrefs({ leave: 'hide' })).toBe(true);
    expect(use().snapshot.value?.prefs.leave).toBe('hide');

    api.resetOverlayPosition.mockRejectedValueOnce('오버레이를 옮기지 못했다');
    expect(await use().resetPosition()).toBe(false);
    expect(use().problem.value).toBe('오버레이의 자리를 되돌리지 못했다: 오버레이를 옮기지 못했다');
  });

  it('상태를 읽지 못해도 화면은 뜬다 — 기본값으로 그리고 이유를 남긴다', async () => {
    api.overlayWidget.mockRejectedValue('명령을 부를 수 없다');
    const { widget: use } = host();
    await flushPromises();
    expect(use().snapshot.value).toBeNull();
    expect(use().problem.value).toBe('오버레이의 모양을 확인하지 못했다: 명령을 부를 수 없다');
  });
});

describe('결과에서 꺼내는 값(bossView)', () => {
  const boss = (id: string) => sample.bosses.find((b) => b.id === id)!;

  it('1위 편성과 총딜: 계산하지 않은 보스는 총딜이 없다(0이 아니다)', () => {
    expect(bestOf(boss('test-a'))?.rank).toBe(1);
    expect(bestTotal(boss('test-a'))).toBe(boss('test-a').ranking[0].total_damage);
    const pending = { ...structuredClone(boss('test-a')), status: 'not_computed' as const };
    expect(bestTotal(pending)).toBeNull();
    expect(bestOf(null)).toBeNull();
    expect(bestTotal(undefined)).toBeNull();
  });

  it('미확인 칸은 약점을 빼고 센다(앱 창의 요격전 화면과 같다)', () => {
    const e = boss('test-e');
    expect(unconfirmedOf(e).every((u) => u.field !== 'weak_to')).toBe(true);
    expect(unconfirmedOf(e).length).toBe(e.unconfirmed.filter((u) => u.field !== 'weak_to').length);
    expect(unconfirmedOf(null)).toEqual([]);
  });

  it('약점 속성 니케: 결과의 보유 목록을 쓰고, 없으면 니케 정보의 속성으로 본다 — 약점을 모르면 아무도 없다', () => {
    const a = boss('test-a');
    expect(weakNamesOf(a, info)).toEqual(a.weak_pool?.owned);
    const bare = structuredClone(a);
    delete (bare as { weak_pool?: unknown }).weak_pool;
    const byCatalog = weakNamesOf(bare, info);
    expect(byCatalog.length).toBeGreaterThan(0);
    for (const name of byCatalog) expect(info(name).element).toBe(a.element.weak_to);
    expect(weakNamesOf(boss('test-e'), info)).toEqual([]);
  });

  it('한 줄 요약은 루트의 순수 함수가 만든 문장 그대로다', () => {
    const a = boss('test-a');
    expect(summaryOf(a, true, info)).toBe(summarizeInterceptBoss(a, {}).text);
    expect(summaryOf(null, true, info)).toBe('');
    // 약점 속성 보유 목록이 없고 니케 정보도 모르면 속성 이야기를 하지 않는다.
    const bare = structuredClone(a);
    delete (bare as { weak_pool?: unknown }).weak_pool;
    expect(summaryOf(bare, false, info)).not.toContain('약점 속성');
    expect(summaryOf(bare, true, info)).toBe(summarizeInterceptBoss(bare, { elementOf: (name: string) => info(name).element }).text);
  });
});

describe('계산 진행을 두 창이 함께 본다(activity)', () => {
  const running: ComputeActivity = { running: true, label: '크라켄 추천 편성을 찾는 중', done: 3, total: 60, elapsed_ms: 4000 };

  it('앱 창: 진행이 바뀔 때마다 알리고, 같은 값은 다시 알리지 않고, 끝나면 「돌고 있지 않다」로 알린다', async () => {
    const source = ref<ComputeActivity>({ ...IDLE });
    const w = mount(
      defineComponent({
        setup() {
          announceWhile(() => source.value);
          return () => h('div');
        },
      }),
    );
    await flushPromises();
    expect(api.announceActivity.mock.calls.map(([a]) => a)).toEqual([IDLE]);

    source.value = { ...running };
    await flushPromises();
    source.value = { ...running }; // 같은 값
    await flushPromises();
    source.value = { ...running, done: 4, elapsed_ms: 5000 };
    await flushPromises();
    expect(api.announceActivity.mock.calls.map(([a]) => a)).toEqual([IDLE, running, { ...running, done: 4, elapsed_ms: 5000 }]);

    // 돌고 있지 않을 때 남은 값은 싣지 않는다.
    source.value = { running: false, label: '남은 글', done: 9, total: 9, elapsed_ms: 1 };
    await flushPromises();
    expect(api.announceActivity).toHaveBeenLastCalledWith(IDLE);

    // 계산 중에 화면이 내려가면 「끝났다」고 알린다(오버레이에 진행이 남지 않는다).
    source.value = { ...running };
    await flushPromises();
    w.unmount();
    expect(api.announceActivity).toHaveBeenLastCalledWith(IDLE);
  });

  it('알리지 못해도 조용히 넘어간다 — 계산을 막지 않는다', async () => {
    api.announceActivity.mockRejectedValue('명령을 부를 수 없다');
    const mounted = () =>
      mount(
        defineComponent({
          setup() {
            announceWhile(() => running);
            return () => h('div');
          },
        }),
      );
    expect(mounted).not.toThrow();
    await flushPromises();
    api.announceActivity.mockImplementation(() => {
      throw new Error('앱 밖이다');
    });
    expect(mounted).not.toThrow();
  });

  it('오버레이 창: 켜질 때 한 번 묻고, 알림을 받아 따른다 — 모르면 「돌고 있지 않다」로 그린다', async () => {
    widget.activity = { ...running };
    let seen: ReturnType<typeof useActivity> | null = null;
    const w = mount(
      defineComponent({
        setup() {
          seen = useActivity();
          return () => h('div');
        },
      }),
    );
    expect(seen!.value).toEqual(IDLE);
    await flushPromises();
    expect(seen!.value).toEqual(running);
    widget.announce({ ...running, done: 30 });
    expect(seen!.value.done).toBe(30);
    widget.announce(IDLE);
    expect(seen!.value.running).toBe(false);
    w.unmount();
    expect(widget.activityListeners.size).toBe(0);

    api.computeActivity.mockRejectedValue('명령을 부를 수 없다');
    let unknown: ReturnType<typeof useActivity> | null = null;
    mount(
      defineComponent({
        setup() {
          unknown = useActivity();
          return () => h('div');
        },
      }),
    );
    await flushPromises();
    expect(unknown!.value).toEqual(IDLE);
  });
});
