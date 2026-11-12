// 탭과 새 화면 세 개(요격전·성장 비교·티어)의 흐름: 탭 옮기기, 실행 → 진행 표시 → 결과·오류·중단, 결과 파일 불러오기.
// Rust 쪽(backend)은 가짜다. 보스별 추천·성장 비교는 루트의 실제 계산 코드(src/core)가 하고 엔진 실행만 가짜다.
// 결과 파일로 넣는 문서는 실제 CLI가 만든 샘플이다(tests/fixtures — `npm run fixture`).
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import computePanelSource from '../src/components/ComputePanel.vue?raw';
import * as backend from '../src/lib/backend';
import { simCache } from '../src/lib/runtime';
import growthScreenSource from '../src/screens/GrowthScreen.vue?raw';
import interceptScreenSource from '../src/screens/InterceptScreen.vue?raw';
import type { EngineProgress, EngineRequest, EngineRow } from '../src/types';
import compareFixture from './fixtures/compare.sample.json';
import growthFixture from './fixtures/growth.sample.json';
import interceptFixture from './fixtures/intercept.sample.json';
import tierFixture from './fixtures/tier.sample.json';
import {
  ACCOUNT_PATH,
  BOSSES_PATH,
  catalog,
  CONDITION_PATH,
  documents,
  FAKE_EVALUATOR,
  fakeRow,
  sampleBossBundle,
  SQUADS_PATH,
  UPGRADES_PATH,
} from './helpers/fakeEngine';

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
}));

const api = vi.mocked(backend);

/** 결과 파일 경로 → 문서(실제 CLI가 만든 샘플과, 그것을 바꾼 잘못된 파일). */
const INTERCEPT_RESULT = 'D:\\결과\\intercept.json';
const GROWTH_RESULT = 'D:\\결과\\growth.json';
const TIER_RESULT = 'D:\\결과\\tier.json';
const COMPARE_RESULT = 'D:\\결과\\compare.json';
const NEWER_TIER = 'D:\\결과\\tier.v2.json';
const NEWER_INTERCEPT = 'D:\\결과\\intercept.v2.json';
const files: Record<string, unknown> = {
  ...documents,
  [INTERCEPT_RESULT]: interceptFixture,
  [GROWTH_RESULT]: growthFixture,
  [TIER_RESULT]: tierFixture,
  [COMPARE_RESULT]: compareFixture,
  [NEWER_TIER]: { ...tierFixture, schema_version: 2 },
  [NEWER_INTERCEPT]: { ...interceptFixture, schema_version: 2 },
};

/** Rust가 보내는 진행 이벤트를 흉내 낸다. */
let emitProgress: (progress: EngineProgress) => void = () => {};

/** 엔진 배치를 테스트가 원하는 때에 끝낸다. */
interface PendingBatch {
  requests: EngineRequest[];
  finish: (rows?: EngineRow[]) => void;
  fail: (reason: unknown) => void;
  settled: boolean;
}
let batches: PendingBatch[] = [];

function holdEngine(): void {
  api.engineRunBatch.mockImplementation(
    (requests) =>
      new Promise<EngineRow[]>((resolve, reject) => {
        const batch: PendingBatch = {
          requests,
          settled: false,
          finish: (rows) => {
            batch.settled = true;
            resolve(rows ?? requests.map((r) => fakeRow(r)));
          },
          fail: (reason) => {
            batch.settled = true;
            reject(reason);
          },
        };
        batches.push(batch);
      }),
  );
}

/** 육성 프로필에 따라 딜이 달라지는 가짜 엔진(성장 비교용). 같은 요청이면 언제나 같은 값이다. */
function growthRow(request: EngineRequest): EngineRow {
  const base = fakeRow(request) as { members: { name: string; damage: number; share: number }[] } & EngineRow;
  const weight = [...JSON.stringify(request.profile ?? null)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const members = base.members.map((m) => ({ ...m, damage: m.damage + weight * 100 }));
  const total = members.reduce((sum, m) => sum + m.damage, 0);
  return { ...base, total_damage: total, members: members.map((m) => ({ ...m, share: m.damage / total })) };
}

async function render() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}
type Wrapper = Awaited<ReturnType<typeof render>>;

const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());
const value = (w: Wrapper, testid: string) => (at(w, testid).element as HTMLInputElement).value;

async function openTab(w: Wrapper, key: 'compare' | 'intercept' | 'growth' | 'tier'): Promise<void> {
  await at(w, `tab-${key}`).trigger('click');
  await flushPromises();
}

/** 실행 단추만 누른다(계산이 어디까지 갔는지는 기다리지 않는다). */
async function press(w: Wrapper): Promise<void> {
  await at(w, 'run-compute').trigger('click');
  await flushPromises();
}

/** 계산이 끝날 때까지(진행 표시가 사라질 때까지) 기다린다. 캐시 키를 만드는 Web Crypto가 진짜 비동기라 여러 번 본다. */
async function idle(w: Wrapper): Promise<void> {
  await vi.waitFor(
    () => {
      if (at(w, 'compute-progress').exists()) throw new Error('아직 계산 중이다');
    },
    { timeout: 5000 },
  );
  await flushPromises();
}

/** 붙들어 둔 엔진에 배치가 `count`개째 닿을 때까지 기다린다. */
async function reached(count: number): Promise<void> {
  await vi.waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(count), { timeout: 5000 });
  await flushPromises();
}

/** 붙들어 둔 엔진의 배치를 오는 대로 끝내며 계산이 끝날 때까지 기다린다. */
async function finishAll(w: Wrapper): Promise<void> {
  await vi.waitFor(
    () => {
      for (const b of batches) if (!b.settled) b.finish();
      if (at(w, 'compute-progress').exists()) throw new Error('아직 계산 중이다');
    },
    { timeout: 5000 },
  );
  await flushPromises();
}

async function loadResult(w: Wrapper, path: string): Promise<void> {
  await at(w, 'result-path').setValue(path);
  await at(w, 'load-result').trigger('click');
  await flushPromises();
}

async function fillIntercept(w: Wrapper, budget = '10', top = '2'): Promise<void> {
  await at(w, 'account-path').setValue(ACCOUNT_PATH);
  await at(w, 'bosses-path').setValue(BOSSES_PATH);
  await at(w, 'intercept-budget').setValue(budget);
  await at(w, 'intercept-top').setValue(top);
}

async function fillGrowth(w: Wrapper): Promise<void> {
  await at(w, 'account-path').setValue(ACCOUNT_PATH);
  await at(w, 'condition-path').setValue(CONDITION_PATH);
  await at(w, 'squads-path').setValue(SQUADS_PATH);
  await at(w, 'upgrades-path').setValue(UPGRADES_PATH);
}

const bossNames = sampleBossBundle.bosses.map((b) => b.name);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  simCache.clear(); // 시뮬 결과 캐시는 앱이 켜져 있는 동안 남는다 — 테스트끼리 섞이지 않게 비운다.
  batches = [];
  api.overlayStatus.mockResolvedValue({ visible: true, click_through: false, shortcut_problems: [] });
  api.startupReportPath.mockResolvedValue(null);
  api.loadReport.mockResolvedValue(compareFixture as never);
  api.onOverlayState.mockResolvedValue(() => {});
  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue(FAKE_EVALUATOR);
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r)));
  // 중단 명령: Rust처럼 도는 배치를 '중단됨' 오류로 끝내고 true를, 도는 배치가 없으면 false를 돌려준다.
  api.engineCancel.mockImplementation(async () => {
    const running = batches.filter((b) => !b.settled);
    for (const b of running) b.fail('중단됨: 엔진 계산을 멈췄다');
    return running.length > 0;
  });
  api.readJsonFile.mockImplementation(async (path) => {
    if (!(path in files)) throw `파일을 찾을 수 없다: ${path}`;
    return structuredClone(files[path]);
  });
  api.pickJsonFile.mockResolvedValue(null);
  api.gameWindowStatus.mockResolvedValue({ state: 'missing', window: null, message: '게임 창을 찾을 수 없다', follow: false });
  api.onGameWindow.mockResolvedValue(() => {});
  api.onGameCapture.mockResolvedValue(() => {});
  api.onEngineProgress.mockImplementation(async (handler) => {
    emitProgress = handler;
    return () => {};
  });
});

describe('탭', () => {
  it('탭 네 개가 있고 처음에는 추천·비교가 보인다', async () => {
    const w = await render();
    expect(w.findAll('[role="tab"]').map((t) => t.text())).toEqual(['추천·비교', '요격전', '성장', '티어']);
    expect(at(w, 'tab-compare').attributes('aria-selected')).toBe('true');
    expect(at(w, 'screen-compare').exists()).toBe(true);
    for (const key of ['intercept', 'growth', 'tier']) expect(at(w, `screen-${key}`).exists()).toBe(false);
  });

  it('탭을 누르면 그 화면만 보인다. 유니온 레이드 화면은 없다', async () => {
    const w = await render();
    for (const key of ['intercept', 'growth', 'tier', 'compare'] as const) {
      await openTab(w, key);
      expect(at(w, `tab-${key}`).attributes('aria-selected')).toBe('true');
      expect(w.findAll('[data-testid^="screen-"]').map((s) => s.attributes('data-testid'))).toEqual([`screen-${key}`]);
    }
    expect(w.text()).not.toContain('유니온');
  });

  it('탭을 옮겼다 돌아와도 화면의 입력과 결과가 남는다', async () => {
    const w = await render();
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await openTab(w, 'tier');
    await loadResult(w, TIER_RESULT);
    expect(w.findAll('[data-testid="tier-entry"]')).toHaveLength(6);

    await openTab(w, 'compare');
    expect(value(w, 'account-path')).toBe(ACCOUNT_PATH);
    await openTab(w, 'tier');
    expect(w.findAll('[data-testid="tier-entry"]')).toHaveLength(6);
    // 돌아올 때 파일을 다시 읽지 않는다.
    expect(api.readJsonFile).toHaveBeenCalledTimes(1);
  });

  it('마지막으로 본 탭을 기억해 다음 실행 때 그 탭을 연다', async () => {
    const first = await render();
    await openTab(first, 'intercept');
    expect(localStorage.getItem('nikke-companion.tab')).toBe('intercept');
    first.unmount();

    const second = await render();
    expect(at(second, 'tab-intercept').attributes('aria-selected')).toBe('true');
    expect(at(second, 'screen-intercept').exists()).toBe(true);
    // 보이지 않는 추천·비교 화면은 아직 아무것도 읽지 않았다.
    expect(api.loadReport).not.toHaveBeenCalled();
  });

  it('실행 인자로 비교 결과 파일을 받으면 기억해 둔 탭 대신 추천·비교를 연다', async () => {
    localStorage.setItem('nikke-companion.tab', 'tier');
    api.startupReportPath.mockResolvedValue('D:\\arg.json');
    const w = await render();
    expect(at(w, 'tab-compare').attributes('aria-selected')).toBe('true');
    expect(api.loadReport).toHaveBeenCalledWith('D:\\arg.json');
    expect(w.findAll('[data-testid="ranking-entry"]')).toHaveLength(3);
    // 기억해 둔 탭은 바꾸지 않는다.
    expect(localStorage.getItem('nikke-companion.tab')).toBe('tier');
  });

  it('기억해 둔 탭 이름이 모르는 것이면 추천·비교를 연다', async () => {
    localStorage.setItem('nikke-companion.tab', 'union');
    const w = await render();
    expect(at(w, 'screen-compare').exists()).toBe(true);
  });
});

describe('요격전·성장 비교는 추천과 같은 진행 표시·오류 표시·중단을 쓴다', () => {
  it('세 화면이 같은 실행 상태·진행 표시·단추를 쓴다(다시 만들지 않았다)', () => {
    for (const [name, source] of Object.entries({ ComputePanel: computePanelSource, InterceptScreen: interceptScreenSource, GrowthScreen: growthScreenSource })) {
      expect(source, name).toMatch(/const engine = useEngineRun\('(compare|intercept|growth)'\)/);
      expect(source, name).toContain('<RunStatus :run="engine" />');
      expect(source, name).toMatch(/<RunButtons :run="engine" [^>]*@run="run" @stop="engine\.stop" \/>/);
      // 진행 줄·중단 단추를 화면마다 따로 그리지 않는다.
      expect(source, name).not.toMatch(/compute-progress|stop-compute|engineCancel|onEngineProgress/);
    }
    // 계산은 루트의 함수를 부르는 lib/compute.ts로만 한다.
    expect(interceptScreenSource).toContain('runIntercept(');
    expect(growthScreenSource).toContain('runGrowth(');
  });
});

describe('요격전 화면', () => {
  it('처음에는 안내만 보이고 엔진을 부르지 않는다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    expect(at(w, 'hint').text()).toContain('계정 파일과 보스 묶음 파일을 골라 요격전 추천을 실행한다');
    expect(at(w, 'run-compute').text()).toBe('요격전 추천 실행');
    expect(at(w, 'intercept-budget').attributes('placeholder')).toBe('300');
    expect(at(w, 'intercept-top').attributes('placeholder')).toBe('3');
    expect(at(w, 'boss').exists()).toBe(false);
    expect(api.engineCatalog).not.toHaveBeenCalled();
    expect(api.readJsonFile).not.toHaveBeenCalled();
  });

  it('계정과 보스 묶음으로 보스별 추천을 실행해, 보스를 골라 상위 편성을 본다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    await fillIntercept(w);
    await press(w);
    await idle(w);

    expect(api.readJsonFile.mock.calls.map((c) => c[0])).toEqual([ACCOUNT_PATH, BOSSES_PATH]);
    // 예산 10건을 보스 5종에 2건씩 — 엔진에 맡긴 요청은 예산을 넘지 않는다.
    const requests = api.engineRunBatch.mock.calls.flatMap((c) => c[0]);
    expect(requests).toHaveLength(10);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'hint').exists()).toBe(false);

    expect(w.findAll('[data-testid="boss-tab"]').map((t) => t.find('.bosses__name').text())).toEqual(bossNames);
    expect(at(w, 'boss-name').text()).toBe('시험 보스 A');
    expect(at(w, 'boss-weak').text()).toBe('약점 작열');
    expect(texts(w, 'rank')).toEqual(['1위', '2위']);
    expect(w.findAll('[data-testid="ranking-entry"]')[0].findAll('[data-testid="member-name"]')).toHaveLength(5);
    // 화면의 1위 총딜은 그 보스의 요청에 엔진이 준 값 가운데 가장 큰 것이다(보스 A의 적 속성은 풍압).
    const forA = requests.filter((r) => (r.enemy as { code?: string } | undefined)?.code === '풍압');
    expect(forA).toHaveLength(2);
    const best = Math.max(...forA.map((r) => fakeRow(r).total_damage as number));
    expect(texts(w, 'total-raw')[0]).toBe(`(${best.toLocaleString('en-US')})`);

    // 다른 보스를 고르면 그 보스의 편성이 보인다. 속성도 약점도 모르는 보스는 눈에 띄게 표시된다.
    await w.find('[data-testid="boss-tab"][data-boss="test-e"]').trigger('click');
    expect(at(w, 'boss-name').text()).toBe('시험 보스 E');
    expect(at(w, 'boss-flag').text()).toBe('속성 상성 미반영');
    expect(at(w, 'boss-unconfirmed').text()).toMatch(/^미확인 값 \d+칸/);
    expect(texts(w, 'rank')).toEqual(['1위', '2위']);
    expect(at(w, 'sims').text()).toContain('시뮬 10건 / 예산 10건');
    expect(at(w, 'cache').text()).toBe('캐시: 적중 0건 · 엔진 계산 10건 · 새로 저장 10건');
    // 결과가 나오면 입력 칸을 접어 보스와 편성이 위에 보이게 한다. 다시 펼 수 있다.
    expect((at(w, 'intercept-inputs').element as HTMLElement).style.display).toBe('none');
    await at(w, 'toggle-inputs').trigger('click');
    expect((at(w, 'intercept-inputs').element as HTMLElement).style.display).not.toBe('none');
  });

  it('계산하는 동안 추천과 같은 진행 줄에 보스·건수·예산·경과 시간을 보인다', async () => {
    holdEngine();
    const w = await render();
    await openTab(w, 'intercept');
    await fillIntercept(w);
    await press(w);
    await reached(1);

    const progress = at(w, 'compute-progress');
    expect(progress.attributes('role')).toBe('status');
    expect(progress.text()).toMatch(/^엔진 계산 중 — 보스 1\/5\(시험 보스 A\) .*0\/2건 끝남/);
    expect(at(w, 'compute-budget').text()).toBe('이 보스의 예산 2건 중 2건');
    expect(at(w, 'compute-elapsed').text()).toMatch(/^\d+초$/);
    expect(at(w, 'run-compute').text()).toBe('계산 중…');
    expect(at(w, 'run-compute').attributes('disabled')).toBeDefined();
    expect(at(w, 'account-path').attributes('disabled')).toBeDefined();
    expect(at(w, 'load-result').attributes('disabled')).toBeDefined();
    expect(at(w, 'tab-intercept').find('[data-testid="tab-busy"]').exists()).toBe(true);

    emitProgress({ done: 1, total: 2 });
    await flushPromises();
    expect(progress.text()).toContain('1/2건 끝남');
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('1');

    // 다음 보스로 넘어가면 보스 이름과 건수가 바뀐다.
    batches[0].finish();
    await reached(2);
    expect(progress.text()).toMatch(/보스 2\/5\(시험 보스 B\) .*0\/2건 끝남/);

    await finishAll(w);
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(at(w, 'tab-busy').exists()).toBe(false);
    expect(w.findAll('[data-testid="boss-tab"]')).toHaveLength(5);
  });

  it('중단하면 엔진을 멈추고 중단됨이 된다 — 오류가 아니고, 남은 보스를 엔진에 보내지 않는다', async () => {
    holdEngine();
    const w = await render();
    await openTab(w, 'intercept');
    expect(at(w, 'stop-compute').exists()).toBe(false);
    await fillIntercept(w);
    await press(w);
    await reached(1);
    expect(at(w, 'stop-compute').text()).toBe('중단');

    await at(w, 'stop-compute').trigger('click');
    await idle(w);
    expect(api.engineCancel).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
    expect(at(w, 'compute-stopped').text()).toMatch(/^중단됨/);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'stop-compute').exists()).toBe(false);
    expect(at(w, 'boss').exists()).toBe(false);
    expect(at(w, 'run-compute').attributes('disabled')).toBeUndefined();
    // 중단한 계산은 기억해 두지 않는다.
    expect(localStorage.getItem('nikke-companion.intercept.report')).toBeNull();

    // 다시 실행할 수 있다.
    await press(w);
    await finishAll(w);
    expect(at(w, 'compute-stopped').exists()).toBe(false);
    expect(w.findAll('[data-testid="boss-tab"]')).toHaveLength(5);
  });

  it('입력이 잘못되면 입력 오류를, 엔진이 실패하면 실행 오류를 추천과 같은 문장으로 보인다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toBe('보스 묶음 파일 경로를 넣어야 한다.');
    expect(at(w, 'error').attributes('role')).toBe('alert');
    expect(api.engineCatalog).not.toHaveBeenCalled();

    // 보스 묶음 자리에 계정 파일을 넣었다.
    await at(w, 'bosses-path').setValue(ACCOUNT_PATH);
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toMatch(/^입력 오류 — 보스 묶음이 잘못됐다/);
    expect(api.engineRunBatch).not.toHaveBeenCalled();

    await at(w, 'bosses-path').setValue('D:\\없음.json');
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toBe('보스 묶음 파일 — 파일을 찾을 수 없다: D:\\없음.json');

    await fillIntercept(w, '0');
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toMatch(/^입력 오류 — .*budget은 1 이상의 정수여야 한다/);

    await fillIntercept(w);
    api.engineRunBatch.mockRejectedValueOnce('엔진을 실행할 수 없다 (python): program not found');
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toBe('실행 오류 — 엔진을 실행할 수 없다 (python): program not found');
    expect(at(w, 'boss').exists()).toBe(false);

    // 다시 실행하면 오류가 사라지고 결과가 보인다.
    await press(w);
    await idle(w);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'boss-name').text()).toBe('시험 보스 A');
  });

  it('다시 계산하는 동안과 계산이 실패한 뒤에도 앞서 보이던 결과는 그대로 남는다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    await fillIntercept(w);
    await press(w);
    await idle(w);
    const before = { tabs: texts(w, 'boss-tab'), totals: texts(w, 'total-raw') };

    // 예산을 바꿔 다시 계산한다(새 요청이 생겨 엔진에 간다).
    holdEngine();
    await at(w, 'intercept-budget').setValue('15');
    await press(w);
    await reached(1);
    expect(at(w, 'stale-note').text()).toContain('이전 결과');
    expect({ tabs: texts(w, 'boss-tab'), totals: texts(w, 'total-raw') }).toEqual(before);

    batches[0].fail('엔진 시간 초과 (600초)');
    await idle(w);
    expect(at(w, 'error').text()).toBe('실행 오류 — 엔진 시간 초과 (600초)');
    expect(at(w, 'stale-note').exists()).toBe(false);
    expect({ tabs: texts(w, 'boss-tab'), totals: texts(w, 'total-raw') }).toEqual(before);
  });

  it('마지막으로 고른 보스와 결과를 기억해, 앱을 다시 열면 그 보스가 바로 보인다(다시 계산하지 않는다)', async () => {
    const first = await render();
    await openTab(first, 'intercept');
    await fillIntercept(first);
    await press(first);
    await idle(first);
    await first.find('[data-testid="boss-tab"][data-boss="test-d"]').trigger('click');
    const shown = { name: at(first, 'boss-name').text(), weak: at(first, 'boss-weak').text(), totals: texts(first, 'total-raw') };
    expect(shown.name).toBe('시험 보스 D');
    expect(at(first, 'restored-note').exists()).toBe(false);
    first.unmount();

    const engineCalls = api.engineRunBatch.mock.calls.length;
    const reads = api.readJsonFile.mock.calls.length;
    const second = await render();
    expect(at(second, 'screen-intercept').exists()).toBe(true);
    expect({ name: at(second, 'boss-name').text(), weak: at(second, 'boss-weak').text(), totals: texts(second, 'total-raw') }).toEqual(shown);
    expect(second.find('[data-testid="boss-tab"][data-boss="test-d"]').attributes('aria-selected')).toBe('true');
    // 기억해 둔 결과라는 것을 알린다. 엔진도 파일도 다시 부르지 않았다.
    expect(at(second, 'restored-note').text()).toContain('앞서 본 결과를 다시 보였다');
    expect(api.engineRunBatch.mock.calls.length).toBe(engineCalls);
    expect(api.readJsonFile.mock.calls.length).toBe(reads);
    // 입력 칸에는 마지막으로 쓴 파일이 채워져 있고 접혀 있다.
    expect(value(second, 'account-path')).toBe(ACCOUNT_PATH);
    expect(value(second, 'bosses-path')).toBe(BOSSES_PATH);
    expect((at(second, 'intercept-inputs').element as HTMLElement).style.display).toBe('none');
  });

  it('기억해 둔 결과가 이 판이 읽을 수 없는 문서면 버리고 안내를 보인다', async () => {
    localStorage.setItem('nikke-companion.tab', 'intercept');
    localStorage.setItem('nikke-companion.intercept.report', JSON.stringify({ ...interceptFixture, schema_version: 0 }));
    const w = await render();
    expect(at(w, 'boss').exists()).toBe(false);
    expect(at(w, 'hint').exists()).toBe(true);
    expect(at(w, 'error').exists()).toBe(false);
    expect(localStorage.getItem('nikke-companion.intercept.report')).toBeNull();
  });

  it('`intercept --json`이 만든 결과 파일을 불러와 보인다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    await loadResult(w, INTERCEPT_RESULT);
    expect(api.readJsonFile).toHaveBeenCalledWith(INTERCEPT_RESULT);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'boss-name').text()).toBe('시험 보스 A');
    expect(texts(w, 'total-unit')).toEqual(['46.51억', '39.41억', '38.27억']);
    expect(at(w, 'bundle-kind').text()).toBe('검증용 보스 묶음');
    expect(localStorage.getItem('nikke-companion.intercept.report-path')).toBe(INTERCEPT_RESULT);
    expect(api.engineCatalog).not.toHaveBeenCalled();
  });

  it('잘못된 결과 파일(다른 종류, 다른 판, 없는 파일)이면 한국어 오류를 보이고 이전 화면을 유지한다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    await loadResult(w, INTERCEPT_RESULT);
    await w.find('[data-testid="boss-tab"][data-boss="test-b"]').trigger('click');
    const before = { name: at(w, 'boss-name').text(), totals: texts(w, 'total-raw'), tabs: texts(w, 'boss-tab') };

    // 다른 종류: 티어 결과.
    await loadResult(w, TIER_RESULT);
    expect(at(w, 'error').text()).toBe(
      `요격전 추천 결과가 아니다 — 이 파일은 티어 결과(kind: tier)다. 이 화면은 \`node src/cli.mjs intercept … --json\`이 만든 파일만 읽는다: ${TIER_RESULT}`,
    );
    expect({ name: at(w, 'boss-name').text(), totals: texts(w, 'total-raw'), tabs: texts(w, 'boss-tab') }).toEqual(before);

    // 다른 종류: 편성 비교 결과.
    await loadResult(w, COMPARE_RESULT);
    expect(at(w, 'error').text()).toContain('편성 비교 결과(추천·비교 탭에서 불러온다)');
    expect(at(w, 'boss-name').text()).toBe(before.name);

    // 판이 다르다.
    await loadResult(w, NEWER_INTERCEPT);
    expect(at(w, 'error').text()).toBe(`schema_version이 맞지 않는다: 파일은 2, 이 화면이 읽는 판은 1이다: ${NEWER_INTERCEPT}`);
    expect(texts(w, 'total-raw')).toEqual(before.totals);

    // 없는 파일(Rust가 준 문장 그대로).
    await loadResult(w, 'D:\\없음.json');
    expect(at(w, 'error').text()).toBe('파일을 찾을 수 없다: D:\\없음.json');
    expect({ name: at(w, 'boss-name').text(), totals: texts(w, 'total-raw'), tabs: texts(w, 'boss-tab') }).toEqual(before);
    // 잘못된 파일의 경로는 기억하지 않는다.
    expect(localStorage.getItem('nikke-companion.intercept.report-path')).toBe(INTERCEPT_RESULT);

    // 맞는 파일을 다시 불러오면 오류가 사라진다.
    await loadResult(w, INTERCEPT_RESULT);
    expect(at(w, 'error').exists()).toBe(false);
  });

  it('결과 파일 경로가 비어 있으면 읽지 않고 알린다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    await loadResult(w, '   ');
    expect(at(w, 'error').text()).toBe('요격전 추천 결과 파일 경로를 넣어야 한다.');
    expect(api.readJsonFile).not.toHaveBeenCalled();
  });

  it('한 탭이 계산하는 동안 다른 탭은 계산을 시작할 수 없다. 탭을 옮겨도 계산은 계속된다', async () => {
    holdEngine();
    const w = await render();
    await openTab(w, 'intercept');
    await fillIntercept(w);
    await press(w);
    await reached(1);

    await openTab(w, 'compare');
    expect(at(w, 'run-compute').attributes('disabled')).toBeDefined();
    expect(at(w, 'run-compute').attributes('title')).toContain('다른 탭의 계산이 도는 중이다');
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(at(w, 'tab-intercept').find('[data-testid="tab-busy"]').exists()).toBe(true);
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'condition-path').setValue(CONDITION_PATH);
    await press(w);
    expect(batches).toHaveLength(1);

    await openTab(w, 'growth');
    expect(at(w, 'run-compute').attributes('disabled')).toBeDefined();
    // 계산하지 않는 화면(티어)은 그동안에도 쓸 수 있다.
    await openTab(w, 'tier');
    await loadResult(w, TIER_RESULT);
    expect(w.findAll('[data-testid="tier-entry"]')).toHaveLength(6);

    // 돌아오면 진행 표시가 그대로 있고, 끝나면 결과가 보인다.
    await openTab(w, 'intercept');
    expect(at(w, 'compute-progress').text()).toContain('보스 1/5(시험 보스 A)');
    await finishAll(w);
    expect(w.findAll('[data-testid="boss-tab"]')).toHaveLength(5);
    await openTab(w, 'compare');
    expect(at(w, 'run-compute').attributes('disabled')).toBeUndefined();
  });

  it('고르기로 보스 묶음 파일을 고른다', async () => {
    const w = await render();
    await openTab(w, 'intercept');
    api.pickJsonFile.mockResolvedValueOnce(BOSSES_PATH);
    await at(w, 'pick-bosses').trigger('click');
    await flushPromises();
    expect(api.pickJsonFile).toHaveBeenCalledWith('보스 묶음 파일 고르기');
    expect(value(w, 'bosses-path')).toBe(BOSSES_PATH);

    api.pickJsonFile.mockRejectedValueOnce('창 없음');
    await at(w, 'pick-account').trigger('click');
    await flushPromises();
    expect(at(w, 'error').text()).toBe('파일 고르기 창을 열지 못했다: 창 없음');
  });
});

describe('성장 비교 화면', () => {
  beforeEach(() => {
    api.engineRunBatch.mockImplementation(async (requests) => requests.map(growthRow));
  });

  it('계정·조건·기준 편성·업그레이드 후보 파일로 성장 비교를 실행해 증가율 순위를 그린다', async () => {
    const w = await render();
    await openTab(w, 'growth');
    expect(at(w, 'run-compute').text()).toBe('성장 비교 실행');
    expect(at(w, 'hint').exists()).toBe(true);
    await fillGrowth(w);
    await press(w);
    await idle(w);

    expect(api.readJsonFile.mock.calls.map((c) => c[0])).toEqual([ACCOUNT_PATH, CONDITION_PATH, SQUADS_PATH, UPGRADES_PATH]);
    // 기준 1건 + 계산할 후보 4건(기준 편성 밖·범위 밖 후보 둘은 엔진에 보내지 않는다).
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    const requests = api.engineRunBatch.mock.calls[0][0];
    expect(requests).toHaveLength(5);
    expect(at(w, 'error').exists()).toBe(false);

    // 이름을 비우면 편성 파일의 첫 편성이 기준이다.
    expect(at(w, 'baseline-name').text()).toBe('A 레드후드-앨리스');
    const baseline = growthRow(requests[0]).total_damage as number;
    expect(at(w, 'baseline-raw').text()).toBe(`(${baseline.toLocaleString('en-US')})`);
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위', '4위']);
    expect([...texts(w, 'upgrade-name')].sort()).toEqual(['앨리스 우월코드 +1줄', '크라운 공격력 +2줄', '헬름 스킬 10/10/10', '헬름 코어 강화 +4'].sort());
    // 순위는 엔진이 준 총딜의 증가량 순이다.
    const gains = requests.slice(1).map((r) => (growthRow(r).total_damage as number) - baseline);
    const best = Math.max(...gains);
    expect(texts(w, 'gain-rate')[0]).toBe(`${best < 0 ? '-' : '+'}${((Math.abs(best) / baseline) * 100).toFixed(2)}%`);
    expect(w.findAll('[data-testid="rejected-entry"]').map((e) => e.find('.issues__name').text())).toEqual([
      '프리카 코어 강화 7 (기준 편성 밖)',
      '앨리스 스킬 +1 (범위 밖)',
    ]);
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(texts(w, 'caveat')).toContain('재화·비용은 고려하지 않았다. 증가율이 높다고 투자 효율이 높다는 뜻은 아니다.');
    // 결과가 나오면 입력 칸을 접는다.
    expect((at(w, 'growth-inputs').element as HTMLElement).style.display).toBe('none');
  });

  it('기준 편성을 이름으로 고른다. 없는 이름이면 입력 오류로 알린다', async () => {
    const w = await render();
    await openTab(w, 'growth');
    await fillGrowth(w);
    await at(w, 'growth-squad').setValue('B 레드후드-미하라');
    await press(w);
    await idle(w);
    expect(at(w, 'baseline-name').text()).toBe('B 레드후드-미하라');
    expect(at(w, 'baseline').findAll('[data-testid="member-name"]').map((m) => m.text())).toContain('미하라');

    await at(w, 'growth-squad').setValue('없는 편성');
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toMatch(/^입력 오류 — 기준 편성이 없다: .*그 이름의 편성이 없다\. 있는 이름: A 레드후드-앨리스, B 레드후드-미하라/);
    // 앞서 보이던 결과는 그대로 남는다.
    expect(at(w, 'baseline-name').text()).toBe('B 레드후드-미하라');
  });

  it('계산하는 동안 추천과 같은 진행 줄을 보이고, 중단하면 중단됨이 된다', async () => {
    holdEngine();
    const w = await render();
    await openTab(w, 'growth');
    await fillGrowth(w);
    await press(w);
    await reached(1);
    expect(at(w, 'compute-progress').text()).toContain('엔진 계산 중 — 0/5건 끝남');
    expect(at(w, 'compute-elapsed').text()).toMatch(/^\d+초$/);
    expect(at(w, 'tab-growth').find('[data-testid="tab-busy"]').exists()).toBe(true);
    emitProgress({ done: 3, total: 5 });
    await flushPromises();
    expect(at(w, 'compute-progress').text()).toContain('3/5건 끝남');
    expect(at(w, 'upgrades-path').attributes('disabled')).toBeDefined();

    await at(w, 'stop-compute').trigger('click');
    await idle(w);
    expect(api.engineCancel).toHaveBeenCalledTimes(1);
    expect(at(w, 'compute-stopped').text()).toMatch(/^중단됨/);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'growth-entry').exists()).toBe(false);
    expect(at(w, 'run-compute').text()).toBe('성장 비교 실행');
    expect(at(w, 'run-compute').attributes('disabled')).toBeUndefined();
  });

  it('파일이 빠지거나 엔진이 실패하면 추천과 같은 문장으로 알린다', async () => {
    const w = await render();
    await openTab(w, 'growth');
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'condition-path').setValue(CONDITION_PATH);
    await at(w, 'squads-path').setValue(SQUADS_PATH);
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toBe('업그레이드 후보 파일 경로를 넣어야 한다.');
    expect(api.engineCatalog).not.toHaveBeenCalled();

    // 후보 파일 자리에 편성 파일을 넣었다.
    await at(w, 'upgrades-path').setValue(SQUADS_PATH);
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toMatch(/^입력 오류 — 업그레이드 후보가 없다/);

    await at(w, 'upgrades-path').setValue(UPGRADES_PATH);
    api.engineRunBatch.mockRejectedValueOnce('엔진 시간 초과 (600초)');
    await press(w);
    await idle(w);
    expect(at(w, 'error').text()).toBe('실행 오류 — 엔진 시간 초과 (600초)');

    await press(w);
    await idle(w);
    expect(at(w, 'error').exists()).toBe(false);
    expect(w.findAll('[data-testid="growth-entry"]')).toHaveLength(4);
  });

  it('쓴 파일과 기준 편성 이름을 기억했다가 다음 실행 때 채운다', async () => {
    const first = await render();
    await openTab(first, 'growth');
    await fillGrowth(first);
    await at(first, 'growth-squad').setValue('B 레드후드-미하라');
    await press(first);
    await idle(first);
    first.unmount();

    const second = await render();
    expect(at(second, 'screen-growth').exists()).toBe(true);
    expect(value(second, 'account-path')).toBe(ACCOUNT_PATH);
    expect(value(second, 'condition-path')).toBe(CONDITION_PATH);
    expect(value(second, 'squads-path')).toBe(SQUADS_PATH);
    expect(value(second, 'upgrades-path')).toBe(UPGRADES_PATH);
    expect(value(second, 'growth-squad')).toBe('B 레드후드-미하라');
  });

  it('`growth --json`이 만든 결과 파일을 불러오고, 잘못된 파일이면 한국어 오류를 보이며 이전 화면을 유지한다', async () => {
    const w = await render();
    await openTab(w, 'growth');
    await loadResult(w, GROWTH_RESULT);
    expect(at(w, 'error').exists()).toBe(false);
    expect(texts(w, 'gain-rate')).toEqual(['+0.93%', '+0.84%', '+0.78%', '+0.19%']);
    const before = { names: texts(w, 'upgrade-name'), totals: texts(w, 'gain-total') };

    await loadResult(w, INTERCEPT_RESULT);
    expect(at(w, 'error').text()).toBe(
      `성장 비교 결과가 아니다 — 이 파일은 요격전 추천 결과(kind: intercept_report)다. 이 화면은 \`node src/cli.mjs growth … --json\`이 만든 파일만 읽는다: ${INTERCEPT_RESULT}`,
    );
    expect({ names: texts(w, 'upgrade-name'), totals: texts(w, 'gain-total') }).toEqual(before);

    await loadResult(w, UPGRADES_PATH);
    expect(at(w, 'error').text()).toContain('성장 비교 결과가 아니다');
    expect({ names: texts(w, 'upgrade-name'), totals: texts(w, 'gain-total') }).toEqual(before);
    expect(api.engineCatalog).not.toHaveBeenCalled();
  });
});

describe('티어 화면', () => {
  it('처음에는 안내만 보이고, 결과 파일을 불러오면 등급표를 그린다', async () => {
    const w = await render();
    await openTab(w, 'tier');
    expect(at(w, 'hint').text()).toContain('node src/cli.mjs tier build --json tier.json');
    expect(at(w, 'run-compute').exists()).toBe(false);
    expect(api.readJsonFile).not.toHaveBeenCalled();

    await loadResult(w, TIER_RESULT);
    expect(api.readJsonFile).toHaveBeenCalledWith(TIER_RESULT);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'hint').exists()).toBe(false);
    expect(at(w, 'tier-summary').text()).toBe('자동 티어 — 8명 (등급 6명 · 평가 보류 2명)');
    expect(texts(w, 'tier-name')).toEqual(['SSS', 'SS', 'S', 'D']);
    expect(at(w, 'tier-provisional').text()).toContain('임시');
    expect(w.findAll('[data-testid="hold-entry"]')).toHaveLength(2);
    // 이 화면은 계산하지 않는다 — 엔진을 부르지 않는다.
    expect(api.engineCatalog).not.toHaveBeenCalled();
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });

  it('마지막으로 불러온 파일을 기억해 다음 실행 때 다시 연다', async () => {
    const first = await render();
    await openTab(first, 'tier');
    await loadResult(first, TIER_RESULT);
    expect(localStorage.getItem('nikke-companion.tier.report-path')).toBe(TIER_RESULT);
    first.unmount();

    api.readJsonFile.mockClear();
    const second = await render();
    expect(at(second, 'screen-tier').exists()).toBe(true);
    expect(api.readJsonFile).toHaveBeenCalledWith(TIER_RESULT);
    expect(value(second, 'result-path')).toBe(TIER_RESULT);
    expect(second.findAll('[data-testid="tier-entry"]')).toHaveLength(6);
  });

  it('잘못된 결과 파일(다른 종류, 다른 판, 없는 파일)이면 한국어 오류를 보이고 이전 표를 유지한다', async () => {
    const w = await render();
    await openTab(w, 'tier');
    await loadResult(w, TIER_RESULT);
    await w.find('[data-testid="burst-option"][data-burst="3"]').trigger('click');
    const before = { tiers: texts(w, 'tier-name'), names: texts(w, 'entry-name'), scores: texts(w, 'entry-score') };
    expect(before.names).toEqual(['라피 : 레드 후드', '헬름', '앨리스']);

    // 다른 종류: 성장 비교 결과.
    await loadResult(w, GROWTH_RESULT);
    expect(at(w, 'error').text()).toBe(
      `티어 결과가 아니다 — 이 파일은 성장 비교 결과(kind: growth)다. 이 화면은 \`node src/cli.mjs tier build … --json\`이 만든 파일만 읽는다: ${GROWTH_RESULT}`,
    );
    expect(at(w, 'error').attributes('role')).toBe('alert');
    expect({ tiers: texts(w, 'tier-name'), names: texts(w, 'entry-name'), scores: texts(w, 'entry-score') }).toEqual(before);
    // 보이는 표가 어느 파일의 것인지 알린다.
    expect(at(w, 'kept-note').text()).toBe(`아래는 앞서 불러온 표다: ${TIER_RESULT}`);

    // 다른 종류: 편성 비교 결과, 계정 파일.
    await loadResult(w, COMPARE_RESULT);
    expect(at(w, 'error').text()).toContain('편성 비교 결과(추천·비교 탭에서 불러온다)');
    await loadResult(w, ACCOUNT_PATH);
    expect(at(w, 'error').text()).toContain('티어 결과가 아니다');
    expect(texts(w, 'entry-name')).toEqual(before.names);

    // 판이 다르다.
    await loadResult(w, NEWER_TIER);
    expect(at(w, 'error').text()).toBe(`schema_version이 맞지 않는다: 파일은 2, 이 화면이 읽는 판은 1이다: ${NEWER_TIER}`);
    expect(texts(w, 'entry-score')).toEqual(before.scores);

    // 없는 파일.
    await loadResult(w, 'D:\\없음.json');
    expect(at(w, 'error').text()).toBe('파일을 찾을 수 없다: D:\\없음.json');
    expect({ tiers: texts(w, 'tier-name'), names: texts(w, 'entry-name'), scores: texts(w, 'entry-score') }).toEqual(before);
    // 임시 규칙 문구도 그대로 보인다. 잘못된 파일의 경로는 기억하지 않는다.
    expect(at(w, 'tier-provisional').exists()).toBe(true);
    expect(localStorage.getItem('nikke-companion.tier.report-path')).toBe(TIER_RESULT);

    // 맞는 파일을 다시 불러오면 오류와 알림이 사라진다.
    await loadResult(w, TIER_RESULT);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'kept-note').exists()).toBe(false);
  });

  it('이전 표가 없을 때 잘못된 파일을 받으면 오류만 보인다', async () => {
    const w = await render();
    await openTab(w, 'tier');
    await loadResult(w, INTERCEPT_RESULT);
    expect(at(w, 'error').text()).toContain('티어 결과가 아니다 — 이 파일은 요격전 추천 결과(kind: intercept_report)다');
    expect(at(w, 'tier-summary').exists()).toBe(false);
    expect(at(w, 'kept-note').exists()).toBe(false);
  });

  it('경로가 비어 있으면 읽지 않고 알린다. 고르기로 파일을 고를 수 있다', async () => {
    const w = await render();
    await openTab(w, 'tier');
    await at(w, 'load-result').trigger('click');
    await flushPromises();
    expect(at(w, 'error').text()).toBe('티어 결과 파일 경로를 넣어야 한다.');
    expect(api.readJsonFile).not.toHaveBeenCalled();

    api.pickJsonFile.mockResolvedValueOnce(TIER_RESULT);
    await at(w, 'pick-result').trigger('click');
    await flushPromises();
    expect(api.pickJsonFile).toHaveBeenCalledWith('티어 결과 파일 고르기');
    expect(value(w, 'result-path')).toBe(TIER_RESULT);
    await at(w, 'result-path').trigger('keydown.enter');
    await flushPromises();
    expect(w.findAll('[data-testid="tier-entry"]')).toHaveLength(6);
  });
});
