// 요격전 화면 자동 추적: 따라가기 규칙(순수 함수)과 화면 흐름.
// Rust 쪽(backend)은 가짜다 — 인식 이벤트(`screen-track`)를 테스트가 직접 보낸다. 게임도 캡처도 없다.
// 추천 결과는 실제 CLI가 만든 샘플(tests/fixtures/intercept.sample.json)의 보스 id·이름만 실제 이상 개체 5종으로 바꾼 것이다
// (샘플은 검증용 보스 묶음으로 만들어 id가 test-a…다 — 인식이 알려 주는 id는 data/intercept/anomaly.json의 것이다).
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { simCache } from '../src/lib/runtime';
import {
  clampIntervalSec,
  clockTime,
  findBoss,
  followStep,
  NO_TAB_MOVE,
  NOT_FOLLOWING,
  summarize,
  tabMoveStep,
  type FollowState,
  type TabMoveInput,
  type TabMoveState,
} from '../src/lib/screenTrack';
import type { InterceptReport, ScreenKind, ScreenRecognition, ScreenTrackState, ScreenTrackStatus } from '../src/types';
import anomalyBundle from '../../data/intercept/anomaly.json';
import interceptFixture from './fixtures/intercept.sample.json';
import { ACCOUNT_PATH, BOSSES_PATH, catalog, CONDITION_PATH, documents, FAKE_EVALUATOR, fakeRow } from './helpers/fakeEngine';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  loadReport: vi.fn(),
  overlayStatus: vi.fn(),
  startupReportPath: vi.fn(),
  quitApp: vi.fn(),
  onOverlayState: vi.fn(),
  engineCatalog: vi.fn(),
  engineVersion: vi.fn(),
  engineRunBatch: vi.fn(),
  engineCancel: vi.fn(),
  readJsonFile: vi.fn(),
  pickJsonFile: vi.fn(),
  onEngineProgress: vi.fn(),
  gameWindowStatus: vi.fn(),
  setFollowGame: vi.fn(),
  captureGame: vi.fn(),
  onGameWindow: vi.fn(),
  onGameCapture: vi.fn(),
  setScreenTracking: vi.fn(),
  screenTrackStatus: vi.fn(),
  onScreenTrack: vi.fn(),
}));

const api = vi.mocked(backend);

// ── 인식 결과·추적 상태 만들기 ───────────────────────────────────────────────

/** 실제 이상 개체 5종(인식이 알려 주는 id·이름과 같다). */
const BOSSES = anomalyBundle.bosses.map((b) => ({ id: b.id, name: b.name }));
const boss = (id: string) => BOSSES.find((b) => b.id === id)!;

function recognition(screen: ScreenKind, bossId?: string): ScreenRecognition {
  const seen = bossId ? boss(bossId) : null;
  return {
    screen,
    boss: seen,
    confidence: seen ? 0.97 : 0,
    evidence: seen
      ? ['아래 띠 주황 100%(화면 맨 아래 가장자리)', `→ 이상 개체 보스 선택 화면, 보스 ${seen.name}`]
      : ['아래 띠에 테마 색이 없다'],
    width: 1881,
    height: 1058,
  };
}

const READ_AT = '2026-11-12T05:03:22.000Z';

function status(state: ScreenTrackState, more: Partial<ScreenTrackStatus> = {}): ScreenTrackStatus {
  return {
    enabled: state !== 'off',
    interval_ms: 2000,
    state,
    message: '',
    recognition: null,
    read_at: null,
    capture_ms: null,
    failures: 0,
    ...more,
  };
}

/** 게임 화면을 읽은 상태. */
function read(screen: ScreenKind, bossId?: string, more: Partial<ScreenTrackStatus> = {}): ScreenTrackStatus {
  return status('read', {
    message: bossId ? `이상 개체 요격전 화면 — ${boss(bossId).name}` : screen === 'other' ? '이상 개체 요격전 화면이 아니다' : '화면을 알아보지 못했다',
    recognition: recognition(screen, bossId),
    read_at: READ_AT,
    capture_ms: 64,
    ...more,
  });
}

const NO_GAME = status('no_game', { message: '게임 창을 찾을 수 없다. 니케 PC판(nikke.exe)이 실행 중인지 확인하라' });
const MINIMIZED = status('minimized', { message: '게임 창이 최소화돼 있어 읽지 않는다(이 앱은 게임 창을 건드리지 않는다)' });
const HIDDEN = status('overlay_hidden', { message: '오버레이가 숨겨져 있어 게임 화면을 읽지 않는다' });
const failed = (failures: number) => status('failed', { message: '화면을 캡처하지 못했다(WGC): 2500ms 안에 프레임이 오지 않았다', failures });

// ── 따라가기 규칙(순수 함수) ─────────────────────────────────────────────────

describe('따라가기 규칙(followStep)', () => {
  /** 상태를 차례로 넣어, 그때마다 따라간 보스의 id(안 따라갔으면 null)를 모은다. */
  function run(inputs: Array<ScreenTrackStatus | null>, switchOn = true, start: FollowState = NOT_FOLLOWING) {
    let state = start;
    const followed: Array<string | null> = [];
    for (const input of inputs) {
      const step = followStep(state, input, switchOn);
      state = step.state;
      followed.push(step.boss?.id ?? null);
    }
    return { followed, state };
  }

  it('이상 개체 화면 + 보스를 처음 보면 그 보스를 따라간다', () => {
    const step = followStep(NOT_FOLLOWING, read('anomaly_select', 'kraken'), true);
    expect(step.boss).toEqual({ id: 'kraken', name: '크라켄' });
    expect(step.state).toEqual({ followed: 'anomaly_select:kraken' });
  });

  it('같은 결과가 이어지는 동안에는 다시 따라가지 않는다', () => {
    const same = read('anomaly_select', 'kraken');
    expect(run([same, same, { ...same, read_at: '2026-11-12T05:03:24.000Z', capture_ms: 70 }, same]).followed).toEqual(['kraken', null, null, null]);
  });

  it('보스가 바뀌거나 같은 보스의 다른 화면(선택 ↔ 편성)이 되면 따라간다', () => {
    expect(
      run([
        read('anomaly_select', 'kraken'),
        read('anomaly_select', 'ultra'),
        read('anomaly_squad', 'ultra'),
        read('anomaly_squad', 'ultra'),
        read('anomaly_select', 'ultra'),
        read('anomaly_select', 'kraken'),
      ]).followed,
    ).toEqual(['kraken', 'ultra', 'ultra', null, 'ultra', 'kraken']);
  });

  it('unknown에서는 아무것도 바꾸지 않고, 같은 화면으로 돌아와도 다시 따라가지 않는다', () => {
    const { followed, state } = run([read('anomaly_select', 'kraken'), read('unknown'), read('unknown'), read('anomaly_select', 'kraken')]);
    expect(followed).toEqual(['kraken', null, null, null]);
    expect(state).toEqual({ followed: 'anomaly_select:kraken' });
    // 모르는 동안 다른 보스로 넘어갔으면 따라간다.
    expect(run([read('anomaly_select', 'kraken'), read('unknown'), read('anomaly_select', 'harvester')]).followed).toEqual(['kraken', null, 'harvester']);
  });

  it('other에서도 보스를 바꾸지 않는다 — 다만 이상 개체 화면을 떠난 것이라 다시 들어오면 새로 따라간다', () => {
    const { followed } = run([read('anomaly_squad', 'kraken'), read('other'), read('other'), read('anomaly_squad', 'kraken'), read('anomaly_squad', 'kraken')]);
    expect(followed).toEqual(['kraken', null, null, 'kraken', null]);
    expect(followStep({ followed: 'anomaly_squad:kraken' }, read('other'), true)).toEqual({ state: NOT_FOLLOWING, boss: null });
  });

  it('읽지 못한 상태(게임 없음·최소화·오버레이 숨김·읽기 실패·시작 전)에서는 그대로 둔다', () => {
    const before: FollowState = { followed: 'anomaly_select:kraken' };
    for (const paused of [NO_GAME, MINIMIZED, HIDDEN, failed(1), failed(7), status('starting')]) {
      expect(followStep(before, paused, true), paused.state).toEqual({ state: before, boss: null });
    }
    // 게임이 꺼졌다 다시 떠서 같은 화면이면 다시 따라가지 않고, 다른 보스면 따라간다.
    expect(run([read('anomaly_select', 'kraken'), NO_GAME, failed(1), read('anomaly_select', 'kraken'), MINIMIZED, read('anomaly_select', 'ultra')]).followed).toEqual([
      'kraken',
      null,
      null,
      null,
      null,
      'ultra',
    ]);
  });

  it('스위치가 꺼져 있으면 무엇이 와도 무시하고, 다시 켜면 처음부터 따라간다', () => {
    const seen = read('anomaly_select', 'kraken');
    expect(run([seen, read('anomaly_select', 'ultra'), NO_GAME], false).followed).toEqual([null, null, null]);
    // 켜진 동안 따라간 것은 끄는 순간 잊는다.
    const off = followStep({ followed: 'anomaly_select:kraken' }, seen, false);
    expect(off).toEqual({ state: NOT_FOLLOWING, boss: null });
    expect(followStep(off.state, seen, true).boss?.id).toBe('kraken');
    // Rust가 꺼졌다고 알려 온 것, 상태가 아직 없는 것도 같다.
    expect(followStep({ followed: 'anomaly_select:kraken' }, status('off'), true)).toEqual({ state: NOT_FOLLOWING, boss: null });
    expect(followStep({ followed: 'anomaly_select:kraken' }, null, true)).toEqual({ state: NOT_FOLLOWING, boss: null });
  });

  it('보스 없는 이상 개체 화면은 추측하지 않고 그대로 둔다', () => {
    const before: FollowState = { followed: 'anomaly_select:kraken' };
    const noBoss = read('anomaly_select');
    expect(followStep(before, noBoss, true)).toEqual({ state: before, boss: null });
    expect(followStep(NOT_FOLLOWING, noBoss, true)).toEqual({ state: NOT_FOLLOWING, boss: null });
  });

  it('입력을 바꾸지 않는다', () => {
    const before = Object.freeze({ followed: 'anomaly_select:kraken' });
    const input = Object.freeze(read('anomaly_select', 'ultra'));
    Object.freeze(input.recognition);
    expect(followStep(before, input, true).boss?.id).toBe('ultra');
    expect(before).toEqual({ followed: 'anomaly_select:kraken' });
    expect(Object.isFrozen(NOT_FOLLOWING)).toBe(true);
  });
});

describe('표시 도우미', () => {
  it('인식한 보스와 화면, 인식 못 함·게임 없음 같은 이유를 한 줄로 만든다', () => {
    const kraken = boss('kraken');
    expect(summarize(false, read('anomaly_select', 'kraken'), kraken)).toEqual({ tone: 'off', text: '꺼짐', reason: '' });
    expect(summarize(true, null, null)).toEqual({ tone: 'idle', text: '상태 확인 중…', reason: '' });
    expect(summarize(true, status('starting'), null).text).toBe('게임 화면을 읽는 중…');
    expect(summarize(true, read('anomaly_select', 'kraken'), kraken)).toEqual({ tone: 'on', text: '크라켄 · 보스 선택 화면', reason: '' });
    expect(summarize(true, read('anomaly_squad', 'mirror_container'), kraken).text).toBe('미러 컨테이너 · 편성 화면');
    expect(summarize(true, read('other'), kraken)).toEqual({ tone: 'idle', text: '이상 개체 화면 아님', reason: '마지막 보스 크라켄 유지' });
    expect(summarize(true, read('other'), null).reason).toBe('');
    expect(summarize(true, read('unknown'), kraken)).toEqual({ tone: 'warn', text: '인식 못 함', reason: '화면을 알아보지 못했다 — 마지막 보스 크라켄 유지' });
    expect(summarize(true, NO_GAME, null)).toEqual({ tone: 'warn', text: '게임 없음', reason: NO_GAME.message });
    expect(summarize(true, MINIMIZED, kraken).text).toBe('게임 창 최소화');
    expect(summarize(true, HIDDEN, kraken)).toEqual({ tone: 'idle', text: '오버레이 숨김', reason: HIDDEN.message });
    expect(summarize(true, failed(1), null).text).toBe('읽기 실패');
    expect(summarize(true, failed(4), kraken)).toEqual({ tone: 'warn', text: '읽기 실패 (연속 4회)', reason: `${failed(4).message} — 마지막 보스 크라켄 유지` });
  });

  it('결과의 보스는 id로, 없으면 이름으로 찾는다', () => {
    const list = [
      { id: 'a', name: '크라켄' },
      { id: 'kraken', name: '다른 이름' },
    ];
    expect(findBoss(list, boss('kraken'))).toBe(list[1]);
    expect(findBoss(list.slice(0, 1), boss('kraken'))).toBe(list[0]);
    expect(findBoss(list, boss('ultra'))).toBeUndefined();
  });

  it('주기는 0.5~60초로 맞추고, 수가 아니면 기본값 2초다', () => {
    expect(clampIntervalSec(2)).toBe(2);
    expect(clampIntervalSec('5')).toBe(5);
    expect(clampIntervalSec(0.1)).toBe(0.5);
    expect(clampIntervalSec(-3)).toBe(0.5);
    expect(clampIntervalSec(1000)).toBe(60);
    expect(clampIntervalSec('')).toBe(2);
    expect(clampIntervalSec('abc')).toBe(2);
    expect(clampIntervalSec(Number.NaN)).toBe(2);
  });

  it('읽은 시각은 현지 시각 HH:MM:SS로 보인다', () => {
    const d = new Date(READ_AT);
    const p = (n: number) => String(n).padStart(2, '0');
    expect(clockTime(READ_AT)).toBe(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    expect(clockTime(null)).toBe('');
    expect(clockTime('어제')).toBe('');
  });
});

// ── 화면 흐름(가짜 backend) ──────────────────────────────────────────────────

/** 실제 CLI 샘플의 보스 id·이름만 실제 이상 개체 5종으로 바꾼 추천 결과. */
const realReport = (() => {
  const copy = structuredClone(interceptFixture) as unknown as InterceptReport;
  copy.bosses.forEach((b, i) => {
    b.id = BOSSES[i].id;
    b.name = BOSSES[i].name;
  });
  return copy;
})();

const REAL_RESULT = 'D:\\결과\\intercept.real.json';
const TEST_RESULT = 'D:\\결과\\intercept.test.json';
const files: Record<string, unknown> = { ...documents, [REAL_RESULT]: realReport, [TEST_RESULT]: interceptFixture };

const SAVED_REPORT = 'nikke-companion.intercept.report';
const TRACK_ENABLED = 'nikke-companion.track.enabled';
const TRACK_AUTO_TAB = 'nikke-companion.track.auto-tab';
const TRACK_INTERVAL = 'nikke-companion.track.interval-sec';

/** Rust가 보내는 `screen-track` 이벤트를 흉내 낸다. 구독이 없으면(추적을 켠 적이 없으면) 아무 일도 없다. */
let listeners: Array<(next: ScreenTrackStatus) => void> = [];
/** 가짜 Rust가 쥐고 있는 지금 상태(상태 명령이 돌려준다). */
let rustStatus: ScreenTrackStatus = status('off');

async function emit(next: ScreenTrackStatus): Promise<void> {
  rustStatus = next;
  for (const listener of [...listeners]) listener(next);
  await flushPromises();
}

let mounted: Array<{ unmount: () => void }> = [];

async function render() {
  const wrapper = mount(App);
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}
type Wrapper = Awaited<ReturnType<typeof render>>;

const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());
const selectedTab = (w: Wrapper) => w.findAll('[role="tab"][data-testid^="tab-"]').find((t) => t.attributes('aria-selected') === 'true')?.attributes('data-testid');

async function openTab(w: Wrapper, key: 'compare' | 'intercept' | 'growth' | 'tier'): Promise<void> {
  await at(w, `tab-${key}`).trigger('click');
  await flushPromises();
}

async function toggle(w: Wrapper, on: boolean): Promise<void> {
  await at(w, 'track-switch').setValue(on);
  await flushPromises();
}

/** 추적을 켜 둔 채로(기억해 둔 스위치) 앱을 연다. `tab`은 기억해 둔 탭. */
async function renderTracking(options: { report?: InterceptReport | null; tab?: string } = {}) {
  localStorage.setItem(TRACK_ENABLED, '1');
  if (options.report) localStorage.setItem(SAVED_REPORT, JSON.stringify(options.report));
  if (options.tab) localStorage.setItem('nikke-companion.tab', options.tab);
  return render();
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  simCache.clear();
  listeners = [];
  rustStatus = status('off');
  api.overlayStatus.mockResolvedValue({ visible: true, click_through: false, shortcut_problems: [] });
  api.startupReportPath.mockResolvedValue(null);
  api.onOverlayState.mockResolvedValue(() => {});
  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue(FAKE_EVALUATOR);
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r)));
  api.engineCancel.mockResolvedValue(false);
  api.readJsonFile.mockImplementation(async (path) => {
    if (!(path in files)) throw `파일을 찾을 수 없다: ${path}`;
    return structuredClone(files[path]);
  });
  api.pickJsonFile.mockResolvedValue(null);
  api.gameWindowStatus.mockResolvedValue({ state: 'missing', window: null, message: '게임 창을 찾을 수 없다', follow: false });
  api.onGameWindow.mockResolvedValue(() => {});
  api.onGameCapture.mockResolvedValue(() => {});
  api.onEngineProgress.mockResolvedValue(() => {});
  api.onScreenTrack.mockImplementation(async (handler) => {
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((l) => l !== handler);
    };
  });
  // Rust처럼: 켜면 「읽는 중」, 끄면 「꺼짐」을 돌려준다(주기는 준 값 그대로).
  api.setScreenTracking.mockImplementation(async (enabled, intervalMs) => {
    rustStatus = status(enabled ? 'starting' : 'off', { interval_ms: intervalMs ?? 2000, message: enabled ? '게임 화면을 읽는 중이다' : '자동 추적이 꺼져 있다' });
    return rustStatus;
  });
  api.screenTrackStatus.mockImplementation(async () => rustStatus);
});

afterEach(() => {
  // 추적 칸의 상태 확인 타이머가 다음 테스트로 넘어가지 않게 한다.
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.useRealTimers();
});

describe('스위치', () => {
  it('요격전 화면에 있고 기본은 꺼짐이다 — 켜기 전에는 Rust에 아무것도 시키지 않는다', async () => {
    const w = await render();
    expect(at(w, 'track-panel').exists()).toBe(false); // 추천·비교 탭에는 없다
    await openTab(w, 'intercept');
    expect(at(w, 'track-panel').exists()).toBe(true);
    expect((at(w, 'track-switch').element as HTMLInputElement).checked).toBe(false);
    expect(at(w, 'track-state').text()).toBe('꺼짐');
    expect(at(w, 'track-read-at').exists()).toBe(false);
    expect(api.setScreenTracking).not.toHaveBeenCalled();
    expect(api.onScreenTrack).not.toHaveBeenCalled();
    expect(api.screenTrackStatus).not.toHaveBeenCalled();
  });

  it('켜면 Rust에 알리고(기본 주기 2초) 기억한다 — 다시 열면 켜진 채로 시작한다', async () => {
    const first = await render();
    await openTab(first, 'intercept');
    await toggle(first, true);
    expect(api.setScreenTracking.mock.calls).toEqual([[true, 2000]]);
    expect(api.onScreenTrack).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TRACK_ENABLED)).toBe('1');
    expect(at(first, 'track-state').text()).toBe('게임 화면을 읽는 중…');
    first.unmount();

    api.setScreenTracking.mockClear();
    localStorage.setItem('nikke-companion.tab', 'compare');
    const second = await render();
    // 요격전 탭을 열지 않아도 앱이 뜰 때 추적을 켠다.
    expect(api.setScreenTracking.mock.calls).toEqual([[true, 2000]]);
    await openTab(second, 'intercept');
    expect((at(second, 'track-switch').element as HTMLInputElement).checked).toBe(true);
  });

  it('끄면 Rust에 알리고 기억한다 — 다시 열어도 꺼져 있다', async () => {
    const first = await renderTracking({ tab: 'intercept' });
    await toggle(first, false);
    expect(api.setScreenTracking.mock.calls).toEqual([
      [true, 2000],
      [false, 2000],
    ]);
    expect(localStorage.getItem(TRACK_ENABLED)).toBe('0');
    expect(at(first, 'track-state').text()).toBe('꺼짐');
    first.unmount();

    api.setScreenTracking.mockClear();
    const second = await render();
    expect(api.setScreenTracking).not.toHaveBeenCalled();
    expect((at(second, 'track-switch').element as HTMLInputElement).checked).toBe(false);
  });

  it('스위치를 끄면 이벤트를 무시한다 — 탭도 보스도 그대로다', async () => {
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'boss-name').text()).toBe('크라켄');

    await toggle(w, false);
    await openTab(w, 'growth');
    await emit(read('anomaly_select', 'ultra'));
    await emit(read('anomaly_squad', 'harvester'));
    expect(selectedTab(w)).toBe('tab-growth');
    await openTab(w, 'intercept');
    expect(at(w, 'boss-name').text()).toBe('크라켄');
    expect(at(w, 'track-state').text()).toBe('꺼짐');
    expect(at(w, 'track-need-run').exists()).toBe(false);

    // 다시 켜면 지금 화면부터 새로 따라간다(같은 보스여도).
    await w.find('[data-testid="boss-tab"][data-boss="ultra"]').trigger('click');
    await toggle(w, true);
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'boss-name').text()).toBe('크라켄');
  });

  it('켜지 못하면 그 사실을 추적 칸에 보인다 — 앱의 오류 줄은 건드리지 않는다', async () => {
    api.setScreenTracking.mockRejectedValue('화면 추적을 시작하지 못했다');
    const w = await render();
    await openTab(w, 'intercept');
    await toggle(w, true);
    expect(at(w, 'track-problem').text()).toBe('자동 추적을 켜지 못했다: 화면 추적을 시작하지 못했다');
    expect(at(w, 'error').exists()).toBe(false);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });
});

describe('인식한 보스를 따라간다', () => {
  it('다른 탭을 보고 있어도 요격전 탭으로 옮기고 그 보스를 고른다 — 결과가 있으면 편성이 바로 보인다', async () => {
    const w = await renderTracking({ report: realReport, tab: 'compare' });
    expect(selectedTab(w)).toBe('tab-compare');

    await emit(read('anomaly_select', 'kraken'));
    expect(selectedTab(w)).toBe('tab-intercept');
    expect(at(w, 'boss-name').text()).toBe('크라켄');
    expect(w.find('[data-testid="boss-tab"][data-boss="kraken"]').attributes('aria-selected')).toBe('true');
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위']);
    expect(w.findAll('[data-testid="ranking-entry"]')[0].findAll('[data-testid="member-name"]')).toHaveLength(5);
    expect(at(w, 'track-need-run').exists()).toBe(false);
    // 그 보스를 기억한다(다음에 열어도 그 보스다).
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('kraken');
    expect(localStorage.getItem('nikke-companion.tab')).toBe('intercept');
    // 계산을 시작하지 않았다.
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    expect(api.engineCatalog).not.toHaveBeenCalled();
  });

  it('요격전 화면을 이미 보고 있었다면 보스만 바뀐다. 게임에서 보스를 넘기면 따라 바뀐다', async () => {
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    expect(at(w, 'boss-name').text()).toBe('인디빌리아'); // 기억해 둔 보스가 없으면 첫 보스

    for (const b of [boss('ultra'), boss('harvester'), boss('mirror_container'), boss('indivilia')]) {
      await emit(read('anomaly_select', b.id));
      expect(at(w, 'boss-name').text()).toBe(b.name);
      expect(at(w, 'track-state').text()).toBe(`${b.name} · 보스 선택 화면`);
    }
    // 같은 보스의 편성 화면으로 들어가도 그 보스다.
    await emit(read('anomaly_squad', 'indivilia'));
    expect(at(w, 'boss-name').text()).toBe('인디빌리아');
    expect(at(w, 'track-state').text()).toBe('인디빌리아 · 편성 화면');
  });

  it('다른 탭에 가 있다가 돌아와도 그 사이에 따라간 보스가 보인다(자동 이동을 꺼 둔 경우)', async () => {
    localStorage.setItem(TRACK_AUTO_TAB, '0');
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    expect(at(w, 'boss-name').text()).toBe('인디빌리아');
    await openTab(w, 'tier');

    await emit(read('anomaly_select', 'kraken'));
    expect(selectedTab(w)).toBe('tab-tier'); // 옮기지 않는다
    await openTab(w, 'intercept');
    expect(at(w, 'boss-name').text()).toBe('크라켄');
  });

  it('결과가 없으면 「추천을 먼저 실행하라」고 알릴 뿐 계산을 시작하지 않는다', async () => {
    const w = await renderTracking({ tab: 'growth' });
    await emit(read('anomaly_select', 'kraken'));

    expect(selectedTab(w)).toBe('tab-intercept');
    expect(at(w, 'boss').exists()).toBe(false);
    const note = at(w, 'track-need-run').text();
    expect(note).toContain('게임에서 보고 있는 보스: 크라켄');
    expect(note).toContain('추천 결과가 아직 없다. 요격전 추천을 먼저 실행하라');
    expect(note).toContain('자동으로 계산을 시작하지 않는다');
    // 다른 보스로 넘기면 안내의 보스도 바뀐다.
    await emit(read('anomaly_select', 'ultra'));
    expect(at(w, 'track-need-run').text()).toContain('게임에서 보고 있는 보스: 울트라');

    // 엔진도 파일도 건드리지 않았다.
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    expect(api.engineCatalog).not.toHaveBeenCalled();
    expect(api.readJsonFile).not.toHaveBeenCalled();
    expect(at(w, 'compute-progress').exists()).toBe(false);

    // 결과가 생기면(불러오든 계산하든) 그 보스의 편성이 바로 보이고 안내는 사라진다.
    await at(w, 'result-path').setValue(REAL_RESULT);
    await at(w, 'load-result').trigger('click');
    await flushPromises();
    expect(at(w, 'boss-name').text()).toBe('울트라');
    expect(at(w, 'track-need-run').exists()).toBe(false);
  });

  it('결과에 그 보스가 없으면 그렇게 알리고 고른 보스는 바꾸지 않는다', async () => {
    // 검증용 보스 묶음으로 만든 결과(보스 id가 test-a…)를 보고 있다.
    const w = await renderTracking({ report: interceptFixture as unknown as InterceptReport, tab: 'intercept' });
    await w.find('[data-testid="boss-tab"][data-boss="test-c"]').trigger('click');

    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'boss-name').text()).toBe('시험 보스 C');
    expect(at(w, 'track-need-run').text()).toContain('게임에서 보고 있는 보스: 크라켄');
    expect(at(w, 'track-need-run').text()).toContain('지금 결과에는 이 보스가 없다');
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });

  it('결과의 보스 id가 달라도 이름이 같으면 그 보스를 고른다', async () => {
    const renamed = structuredClone(interceptFixture) as unknown as InterceptReport;
    renamed.bosses[3].name = '크라켄'; // id는 test-d 그대로
    const w = await renderTracking({ report: renamed, tab: 'intercept' });
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'boss').attributes('data-boss')).toBe('test-d');
    expect(at(w, 'track-need-run').exists()).toBe(false);
  });
});

describe('바꾸지 않는 경우', () => {
  it('unknown·other·게임 없음·최소화·읽기 실패에서는 고른 보스와 탭을 바꾸지 않는다(마지막 보스 유지)', async () => {
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'boss-name').text()).toBe('크라켄');

    for (const [next, label] of [
      [read('unknown'), '인식 못 함'],
      [read('other'), '이상 개체 화면 아님'],
      [NO_GAME, '게임 없음'],
      [MINIMIZED, '게임 창 최소화'],
      [failed(1), '읽기 실패'],
      [failed(5), '읽기 실패 (연속 5회)'],
    ] as const) {
      await emit(next);
      expect(at(w, 'track-state').text(), label).toBe(label);
      expect(at(w, 'boss-name').text(), label).toBe('크라켄');
      expect(selectedTab(w), label).toBe('tab-intercept');
      expect(at(w, 'track-reason').text(), label).toContain('마지막 보스 크라켄 유지');
    }
    // 처음부터 unknown·other만 오면 아무것도 고르지 않고 탭도 옮기지 않는다.
    const fresh = await renderTracking({ report: realReport, tab: 'compare' });
    await emit(read('unknown'));
    await emit(read('other'));
    await emit(NO_GAME);
    expect(selectedTab(fresh)).toBe('tab-compare');
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('kraken'); // 앞에서 따라간 것 그대로
  });

  it('같은 결과가 이어지는 동안에는 손으로 고른 보스를 그대로 둔다 — 인식 결과가 바뀌면 다시 따라간다', async () => {
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    const kraken = read('anomaly_select', 'kraken');
    await emit(kraken);
    expect(at(w, 'boss-name').text()).toBe('크라켄');

    // 손으로 다른 보스를 고른다.
    await w.find('[data-testid="boss-tab"][data-boss="ultra"]').trigger('click');
    expect(at(w, 'boss-name').text()).toBe('울트라');

    // 같은 결과가 또 와도(읽은 시각만 다르다), 잠깐 모르게 됐다 돌아와도, 읽기가 실패했다 돌아와도 그대로다.
    await emit({ ...kraken, read_at: '2026-11-12T05:03:24.000Z' });
    await emit(read('unknown'));
    await emit(kraken);
    await emit(failed(2));
    await emit(kraken);
    expect(at(w, 'boss-name').text()).toBe('울트라');
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('ultra');

    // 게임에서 다른 보스로 넘기면 다시 따라간다.
    await emit(read('anomaly_select', 'harvester'));
    expect(at(w, 'boss-name').text()).toBe('하베스터');
  });

  it('같은 결과가 이어지는 동안에는 손으로 옮긴 탭도 그대로 둔다', async () => {
    const w = await renderTracking({ report: realReport, tab: 'compare' });
    const kraken = read('anomaly_squad', 'kraken');
    await emit(kraken);
    expect(selectedTab(w)).toBe('tab-intercept');

    await openTab(w, 'tier');
    await emit(kraken);
    await emit(read('unknown'));
    await emit(kraken);
    expect(selectedTab(w)).toBe('tab-tier');

    // 이상 개체 화면을 떠났다가(other) 다시 들어오면 같은 보스여도 새로 따라간다.
    await emit(read('other'));
    expect(selectedTab(w)).toBe('tab-tier');
    await emit(kraken);
    expect(selectedTab(w)).toBe('tab-intercept');
    expect(at(w, 'boss-name').text()).toBe('크라켄');
  });

  it('자동 이동을 끄면 탭은 그대로 두고 보스만 고른다. 끈 것을 기억한다', async () => {
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    expect((at(w, 'track-auto-tab').element as HTMLInputElement).checked).toBe(true);
    await at(w, 'track-auto-tab').setValue(false);
    expect(localStorage.getItem(TRACK_AUTO_TAB)).toBe('0');

    await openTab(w, 'compare');
    await emit(read('anomaly_select', 'mirror_container'));
    expect(selectedTab(w)).toBe('tab-compare');
    await openTab(w, 'intercept');
    expect(at(w, 'boss-name').text()).toBe('미러 컨테이너');

    // 다시 켜면 옮긴다.
    await at(w, 'track-auto-tab').setValue(true);
    expect(localStorage.getItem(TRACK_AUTO_TAB)).toBe('1');
    await openTab(w, 'compare');
    await emit(read('anomaly_select', 'ultra'));
    expect(selectedTab(w)).toBe('tab-intercept');
  });
});

describe('인식 상태 표시', () => {
  it('지금 인식한 화면·보스와 마지막으로 읽은 시각이 보이고, 근거는 펼쳐서 본다', async () => {
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    await emit(read('anomaly_select', 'kraken'));

    expect(at(w, 'track-state').text()).toBe('크라켄 · 보스 선택 화면');
    expect(at(w, 'track-state').attributes('data-tone')).toBe('on');
    expect(at(w, 'track-read-at').text()).toBe(`읽음 ${clockTime(READ_AT)}`);
    expect(at(w, 'track-read-at').text()).toMatch(/^읽음 \d\d:\d\d:\d\d$/);
    expect(at(w, 'track-reason').exists()).toBe(false);

    // 근거는 접힌 칸 안에 있다(펼치면 보인다).
    const details = at(w, 'track-details');
    expect(details.element.tagName).toBe('DETAILS');
    expect((details.element as HTMLDetailsElement).open).toBe(false);
    expect(details.find('summary').text()).toBe('인식 근거·설정');
    expect(texts(w, 'track-evidence')).toEqual(['아래 띠 주황 100%(화면 맨 아래 가장자리)', '→ 이상 개체 보스 선택 화면, 보스 크라켄']);
    expect(w.findAll('[data-testid="track-evidence"]').every((el) => el.element.closest('details') === details.element)).toBe(true);
    expect(at(w, 'track-numbers').text()).toBe('캡처 1회 64ms · 프레임 1881×1058 · 신뢰도 0.97');
  });

  it('인식 못 함·게임 없음·읽기 실패는 이유와 함께 상태로만 보인다 — 오류 줄이 쌓이지 않는다', async () => {
    const w = await renderTracking({ tab: 'intercept' });

    await emit(read('unknown'));
    expect(at(w, 'track-state').text()).toBe('인식 못 함');
    expect(at(w, 'track-state').attributes('data-tone')).toBe('warn');
    expect(at(w, 'track-reason').text()).toBe('화면을 알아보지 못했다');
    expect(texts(w, 'track-evidence')).toEqual(['아래 띠에 테마 색이 없다']);

    await emit(NO_GAME);
    expect(at(w, 'track-state').text()).toBe('게임 없음');
    expect(at(w, 'track-reason').text()).toBe(NO_GAME.message);
    expect(at(w, 'track-no-evidence').text()).toBe('지금 읽은 화면이 없다.');

    // 실패가 열 번 이어져도 줄은 하나다.
    for (let n = 1; n <= 10; n += 1) await emit(failed(n));
    expect(w.findAll('[data-testid="track-state"]')).toHaveLength(1);
    expect(w.findAll('[data-testid="track-reason"]')).toHaveLength(1);
    expect(at(w, 'track-state').text()).toBe('읽기 실패 (연속 10회)');
    expect(at(w, 'track-reason').text()).toBe(failed(10).message);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'track-problem').exists()).toBe(false);
    expect(w.find('[role="alert"]').exists()).toBe(false);

    // 게임이 다시 뜨면 스스로 이어진다(화면은 온 상태를 그대로 보인다).
    await emit(read('anomaly_select', 'ultra', { read_at: '2026-11-12T05:10:00.000Z' }));
    expect(at(w, 'track-state').text()).toBe('울트라 · 보스 선택 화면');
    expect(at(w, 'track-read-at').text()).toBe(`읽음 ${clockTime('2026-11-12T05:10:00.000Z')}`);
  });

  it('보이는 동안 주기마다 상태를 물어 읽은 시각을 최신으로 둔다 — 같은 결과면 화면을 건드리지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    await emit(read('anomaly_select', 'kraken'));
    await w.find('[data-testid="boss-tab"][data-boss="ultra"]').trigger('click');
    const asked = api.screenTrackStatus.mock.calls.length;

    // Rust는 같은 결과라 이벤트를 보내지 않았지만, 읽은 시각은 새로워졌다.
    rustStatus = read('anomaly_select', 'kraken', { read_at: '2026-11-12T05:03:30.000Z', capture_ms: 71 });
    vi.advanceTimersByTime(2000);
    await flushPromises();
    expect(api.screenTrackStatus.mock.calls.length).toBe(asked + 1);
    expect(at(w, 'track-read-at').text()).toBe(`읽음 ${clockTime('2026-11-12T05:03:30.000Z')}`);
    expect(at(w, 'track-numbers').text()).toContain('캡처 1회 71ms');
    // 손으로 고른 보스는 그대로다.
    expect(at(w, 'boss-name').text()).toBe('울트라');

    // 다른 탭으로 가면 묻지 않는다. 돌아오면 바로 한 번 묻고 다시 주기마다 묻는다.
    await openTab(w, 'tier');
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(api.screenTrackStatus.mock.calls.length).toBe(asked + 1);
    await openTab(w, 'intercept');
    expect(api.screenTrackStatus.mock.calls.length).toBe(asked + 2);
    vi.advanceTimersByTime(2000);
    await flushPromises();
    expect(api.screenTrackStatus.mock.calls.length).toBe(asked + 3);

    // 끄면 묻지 않는다.
    await toggle(w, false);
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(api.screenTrackStatus.mock.calls.length).toBe(asked + 3);
  });
});

describe('주기', () => {
  it('바꾸면 Rust에 알리고 기억한다. 범위 밖의 값은 0.5~60초로 맞춘다', async () => {
    const w = await renderTracking({ tab: 'intercept' });
    expect((at(w, 'track-interval').element as HTMLInputElement).value).toBe('2');
    api.setScreenTracking.mockClear();

    await at(w, 'track-interval').setValue('5');
    await flushPromises();
    expect(api.setScreenTracking.mock.calls).toEqual([[true, 5000]]);
    expect(localStorage.getItem(TRACK_INTERVAL)).toBe('5');

    await at(w, 'track-interval').setValue('0.1');
    await flushPromises();
    expect(api.setScreenTracking.mock.calls.at(-1)).toEqual([true, 500]);
    expect((at(w, 'track-interval').element as HTMLInputElement).value).toBe('0.5');

    await at(w, 'track-interval').setValue('999');
    await flushPromises();
    expect(api.setScreenTracking.mock.calls.at(-1)).toEqual([true, 60_000]);
    expect(localStorage.getItem(TRACK_INTERVAL)).toBe('60');
  });

  it('꺼져 있을 때 바꾸면 기억만 하고, 켤 때 그 주기로 알린다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    await at(w, 'track-interval').setValue('3');
    await flushPromises();
    expect(api.setScreenTracking).not.toHaveBeenCalled();
    expect(localStorage.getItem(TRACK_INTERVAL)).toBe('3');

    await toggle(w, true);
    expect(api.setScreenTracking.mock.calls).toEqual([[true, 3000]]);
  });
});

// ── 계산 중 자동 이동 ────────────────────────────────────────────────────────

describe('탭 이동 규칙(tabMoveStep)', () => {
  /** 기본 입력: 다른 탭을 보고 있고, 따라가는 중이고, 자동 이동이 켜져 있고, 계산은 돌지 않는다. */
  const input = (more: Partial<TabMoveInput> = {}): TabMoveInput => ({
    followed: false,
    following: true,
    autoTab: true,
    computing: false,
    onIntercept: false,
    ...more,
  });
  const PENDING: TabMoveState = { pending: true };

  it('계산이 돌지 않을 때 보스를 따라가면 바로 옮긴다', () => {
    expect(tabMoveStep(NO_TAB_MOVE, input({ followed: true }))).toEqual({ state: NO_TAB_MOVE, move: true });
  });

  it('계산이 도는 동안 보스를 따라가면 옮기지 않고 미뤄 둔다 — 어느 탭의 계산이든 같다', () => {
    expect(tabMoveStep(NO_TAB_MOVE, input({ followed: true, computing: true }))).toEqual({ state: PENDING, move: false });
    // 계산이 이어지는 동안에는 계속 미뤄 둔다(보스를 또 따라가도, 아무 일이 없어도).
    expect(tabMoveStep(PENDING, input({ computing: true }))).toEqual({ state: PENDING, move: false });
    expect(tabMoveStep(PENDING, input({ followed: true, computing: true }))).toEqual({ state: PENDING, move: false });
  });

  it('계산이 끝나면 그때 한 번 옮긴다 — 그 뒤에는 다시 옮기지 않는다', () => {
    const done = tabMoveStep(PENDING, input());
    expect(done).toEqual({ state: NO_TAB_MOVE, move: true });
    expect(tabMoveStep(done.state, input())).toEqual({ state: NO_TAB_MOVE, move: false });
    // 미뤄 둔 것이 없으면 계산이 끝나도 옮기지 않는다.
    expect(tabMoveStep(NO_TAB_MOVE, input())).toEqual({ state: NO_TAB_MOVE, move: false });
    expect(tabMoveStep(NO_TAB_MOVE, input({ computing: true }))).toEqual({ state: NO_TAB_MOVE, move: false });
  });

  it('자동 이동이 꺼져 있으면 옮기지도 미루지도 않는다 — 미뤄 둔 것도 버린다', () => {
    for (const computing of [false, true]) {
      expect(tabMoveStep(NO_TAB_MOVE, input({ followed: true, autoTab: false, computing }))).toEqual({ state: NO_TAB_MOVE, move: false });
      expect(tabMoveStep(PENDING, input({ autoTab: false, computing }))).toEqual({ state: NO_TAB_MOVE, move: false });
    }
  });

  it('이미 요격전 탭이면 옮길 것이 없다 — 계산 중에 사용자가 요격전 탭을 직접 열었으면 미뤄 둔 이동을 버린다', () => {
    expect(tabMoveStep(NO_TAB_MOVE, input({ followed: true, onIntercept: true }))).toEqual({ state: NO_TAB_MOVE, move: false });
    const opened = tabMoveStep(PENDING, input({ computing: true, onIntercept: true }));
    expect(opened).toEqual({ state: NO_TAB_MOVE, move: false });
    // 그 뒤 다른 탭으로 가 있다가 계산이 끝나도 옮기지 않는다.
    expect(tabMoveStep(opened.state, input())).toEqual({ state: NO_TAB_MOVE, move: false });
  });

  it('따라가는 것이 없어지면(스위치를 껐다·이상 개체 화면을 떠났다) 미뤄 둔 이동을 버린다', () => {
    const left = tabMoveStep(PENDING, input({ following: false, computing: true }));
    expect(left).toEqual({ state: NO_TAB_MOVE, move: false });
    expect(tabMoveStep(left.state, input({ following: false }))).toEqual({ state: NO_TAB_MOVE, move: false });
  });

  it('입력을 바꾸지 않는다', () => {
    const state = Object.freeze({ pending: true });
    const frozen = Object.freeze(input({ computing: true }));
    expect(() => tabMoveStep(state, frozen)).not.toThrow();
    expect(Object.isFrozen(NO_TAB_MOVE)).toBe(true);
  });
});

describe('계산 중에는 탭을 옮기지 않는다', () => {
  /** 엔진 배치를 붙든다: 풀어 줄 때까지 계산이 끝나지 않는다. */
  function holdEngine(): { release: () => void } {
    const waiting: Array<() => void> = [];
    let open = false;
    api.engineRunBatch.mockImplementation(
      (requests) =>
        new Promise((resolve) => {
          const finish = () => resolve(requests.map((r) => fakeRow(r)));
          if (open) finish();
          else waiting.push(finish);
        }),
    );
    return {
      release: () => {
        open = true;
        for (const finish of waiting.splice(0)) finish();
      },
    };
  }

  /** 계산이 엔진에 닿을 때까지 기다린다(붙들어 둔 엔진에서 멈춰 있다). */
  async function reachEngine(): Promise<void> {
    await vi.waitFor(() => {
      if (api.engineRunBatch.mock.calls.length === 0) throw new Error('계산이 아직 엔진에 닿지 않았다');
    });
    await flushPromises();
  }

  /** 추천·비교 탭에서 추천 계산을 시작한다. */
  async function startCompare(w: Wrapper): Promise<void> {
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'condition-path').setValue(CONDITION_PATH);
    await at(w, 'run-compute').trigger('click');
    await reachEngine();
  }

  /** 계산이 끝날 때까지 기다린다(탭의 「계산 중」 점이 사라진다). */
  async function finish(w: Wrapper, engine: { release: () => void }): Promise<void> {
    engine.release();
    await vi.waitFor(
      () => {
        if (at(w, 'tab-busy').exists()) throw new Error('아직 계산 중이다');
      },
      { timeout: 5000 },
    );
    await flushPromises();
  }

  it('보고 있는 탭에서 계산이 도는 동안에는 그 탭에 머문다 — 한 줄로 알리고, 계산이 끝나면 요격전 탭으로 옮긴다', async () => {
    const engine = holdEngine();
    const w = await renderTracking({ report: realReport, tab: 'compare' });
    await startCompare(w);
    expect(at(w, 'tab-busy').exists()).toBe(true);
    expect(at(w, 'track-pending-move').exists()).toBe(false);

    await emit(read('anomaly_select', 'kraken'));
    expect(selectedTab(w)).toBe('tab-compare');
    expect(at(w, 'compute-progress').exists()).toBe(true); // 보고 있던 계산 화면 그대로다
    const note = at(w, 'track-pending-move').text();
    expect(note).toContain('게임에서 보고 있는 보스: 크라켄');
    expect(note).toContain('계산이 끝나면 요격전 탭으로 옮긴다');
    // 보스는 요격전 화면의 선택에 반영됐다(탭만 그대로다).
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('kraken');
    expect(localStorage.getItem('nikke-companion.tab')).toBe('compare');

    // 계산 중에 게임에서 보스를 넘겨도 탭은 그대로이고, 안내의 보스만 바뀐다.
    await emit(read('anomaly_select', 'ultra'));
    expect(selectedTab(w)).toBe('tab-compare');
    expect(at(w, 'track-pending-move').text()).toContain('게임에서 보고 있는 보스: 울트라');

    await finish(w, engine);
    expect(selectedTab(w)).toBe('tab-intercept');
    expect(at(w, 'boss-name').text()).toBe('울트라');
    expect(at(w, 'track-pending-move').exists()).toBe(false);
    // 한 번만 옮긴다: 다른 탭으로 가면 그대로 둔다.
    await openTab(w, 'compare');
    await emit(read('anomaly_select', 'ultra'));
    expect(selectedTab(w)).toBe('tab-compare');
  });

  it('다른 탭의 계산이 도는 동안에도 옮기지 않는다 — 요격전 계산을 돌려 놓고 성장 탭을 보는 경우', async () => {
    const engine = holdEngine();
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    await at(w, 'toggle-inputs').trigger('click');
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'bosses-path').setValue(BOSSES_PATH);
    await at(w, 'intercept-budget').setValue('10');
    await at(w, 'run-compute').trigger('click');
    await reachEngine();
    await openTab(w, 'growth');

    await emit(read('anomaly_squad', 'harvester'));
    expect(selectedTab(w)).toBe('tab-growth');
    expect(at(w, 'track-pending-move').text()).toContain('계산이 끝나면 요격전 탭으로 옮긴다');

    await finish(w, engine);
    expect(selectedTab(w)).toBe('tab-intercept');
    expect(at(w, 'track-pending-move').exists()).toBe(false);
  });

  it('계산 중에 게임이 이상 개체 화면을 떠나면 미뤄 둔 이동을 버린다 — 계산이 끝나도 탭은 그대로다', async () => {
    const engine = holdEngine();
    const w = await renderTracking({ report: realReport, tab: 'compare' });
    await startCompare(w);
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'track-pending-move').exists()).toBe(true);

    await emit(read('other'));
    expect(at(w, 'track-pending-move').exists()).toBe(false);
    await finish(w, engine);
    expect(selectedTab(w)).toBe('tab-compare');
  });

  it('잠깐 모르게 된 화면(unknown)·읽지 못한 상태에서는 미뤄 둔 이동을 버리지 않는다', async () => {
    const engine = holdEngine();
    const w = await renderTracking({ report: realReport, tab: 'compare' });
    await startCompare(w);
    await emit(read('anomaly_select', 'kraken'));
    await emit(read('unknown'));
    await emit(failed(1));
    expect(at(w, 'track-pending-move').exists()).toBe(true);
    await finish(w, engine);
    expect(selectedTab(w)).toBe('tab-intercept');
  });

  it('계산 중에 사용자가 요격전 탭을 직접 열어 봤으면 계산이 끝나도 다시 옮기지 않는다', async () => {
    const engine = holdEngine();
    const w = await renderTracking({ report: realReport, tab: 'compare' });
    await startCompare(w);
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'track-pending-move').exists()).toBe(true);

    await openTab(w, 'intercept');
    expect(at(w, 'track-pending-move').exists()).toBe(false);
    expect(at(w, 'boss-name').text()).toBe('크라켄');
    await openTab(w, 'tier');
    await finish(w, engine);
    expect(selectedTab(w)).toBe('tab-tier');
  });

  it('자동 이동을 꺼 뒀으면 계산 중에도 끝난 뒤에도 옮기지 않고, 안내도 없다', async () => {
    localStorage.setItem(TRACK_AUTO_TAB, '0');
    const engine = holdEngine();
    const w = await renderTracking({ report: realReport, tab: 'compare' });
    await startCompare(w);
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'track-pending-move').exists()).toBe(false);
    await finish(w, engine);
    expect(selectedTab(w)).toBe('tab-compare');
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('kraken');
  });

  it('계산 중에 스위치를 끄면 미뤄 둔 이동을 버린다', async () => {
    const engine = holdEngine();
    const w = await renderTracking({ report: realReport, tab: 'intercept' });
    await at(w, 'toggle-inputs').trigger('click');
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'bosses-path').setValue(BOSSES_PATH);
    await at(w, 'intercept-budget').setValue('10');
    await at(w, 'run-compute').trigger('click');
    await reachEngine();
    await openTab(w, 'tier');
    await emit(read('anomaly_select', 'kraken'));
    expect(at(w, 'track-pending-move').exists()).toBe(true);

    // 스위치는 요격전 화면에 있다 — 열면 미뤄 둔 이동은 이미 버려진다. 끄고 다른 탭으로 간다.
    await openTab(w, 'intercept');
    await toggle(w, false);
    await openTab(w, 'tier');
    expect(at(w, 'track-pending-move').exists()).toBe(false);
    await finish(w, engine);
    expect(selectedTab(w)).toBe('tab-tier');
  });
});

describe('추천 실행과 함께', () => {
  it('추적 중에도 추천은 사용자가 눌러야 돈다 — 계산한 결과에 인식한 보스가 없으면 그렇게 알린다', async () => {
    const w = await renderTracking({ tab: 'intercept' });
    await emit(read('anomaly_select', 'kraken'));
    expect(api.engineRunBatch).not.toHaveBeenCalled();

    // 검증용 보스 묶음(보스 id가 test-a…)으로 직접 실행한다.
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'bosses-path').setValue(BOSSES_PATH);
    await at(w, 'intercept-budget').setValue('10');
    await at(w, 'run-compute').trigger('click');
    await vi.waitFor(
      () => {
        if (!at(w, 'boss').exists() || at(w, 'compute-progress').exists()) throw new Error('아직 계산 중이다');
      },
      { timeout: 5000 },
    );
    await flushPromises();
    expect(api.engineRunBatch).toHaveBeenCalled();
    expect(at(w, 'boss-name').text()).toBe('시험 보스 A');
    expect(at(w, 'track-need-run').text()).toContain('지금 결과에는 이 보스가 없다');
  });
});
