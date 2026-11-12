// 오버레이에서 추천·비교를 실행하는 흐름: 파일 고르기 → 실행 → 진행 중 표시 → 순위 또는 오류.
// Rust 쪽(backend)은 가짜다. 후보 생성·순위는 루트의 실제 계산 코드가 하고, 결과는 P-009의 화면(ReportView)이 그린다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { simCache } from '../src/lib/runtime';
import type { CompareReport, EngineProgress, EngineRequest, EngineRow } from '../src/types';
import fixture from './fixtures/compare.sample.json';
import { ACCOUNT_PATH, catalog, CONDITION_PATH, documents, FAKE_EVALUATOR, fakeRow, SQUADS_PATH } from './helpers/fakeEngine';

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
const loaded = fixture as unknown as CompareReport;

/** Rust가 보내는 진행 이벤트를 흉내 낸다. */
let emitProgress: (progress: EngineProgress) => void = () => {};
const unlistenProgress = vi.fn();

/** 엔진 배치를 테스트가 원하는 때에 끝낸다. */
interface PendingBatch {
  requests: EngineRequest[];
  finish: (rows?: EngineRow[]) => void;
  fail: (reason: unknown) => void;
  /** 끝났나(결과든 오류든). */
  settled: boolean;
}
let batches: PendingBatch[] = [];
/** 엔진 배치를 테스트가 붙들고 있나(`holdEngine`). */
let held = false;

function holdEngine(): void {
  held = true;
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

async function render() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}
type Wrapper = Awaited<ReturnType<typeof render>>;

const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());

async function fillPaths(w: Wrapper): Promise<void> {
  await at(w, 'account-path').setValue(ACCOUNT_PATH);
  await at(w, 'condition-path').setValue(CONDITION_PATH);
}

/**
 * 배치 탐색(추천의 2단계)을 끈다 — 엔진 배치가 한 번뿐인 1단계의 흐름만 보는 테스트가 쓴다.
 * 켠 채로의 흐름(배치 두 번, 단계·예산 표시)은 아래 「배치 탐색과 예산」이 본다.
 */
async function refineOff(w: Wrapper): Promise<void> {
  await at(w, 'suggest-refine').setValue(false);
}

/** 실행 단추만 누른다(계산이 어디까지 갔는지는 기다리지 않는다). */
async function press(w: Wrapper): Promise<void> {
  await at(w, 'run-compute').trigger('click');
  await flushPromises();
}

/**
 * 계산이 엔진에 닿거나(`engineCalls`보다 배치 호출이 늘었다) 끝날 때까지 기다린다.
 * 시뮬 결과 캐시의 키는 Web Crypto로 만든다 — 진짜 비동기라 `flushPromises` 한 번으로는 끝났다고 볼 수 없다.
 */
async function settle(w: Wrapper, engineCalls = Number.POSITIVE_INFINITY): Promise<void> {
  await vi.waitFor(() => {
    const computing = at(w, 'compute-progress').exists();
    if (computing && api.engineRunBatch.mock.calls.length <= engineCalls) throw new Error('계산이 아직 엔진에 닿지 않았다');
  });
  await flushPromises();
}

/**
 * 실행 단추를 누르고, 계산이 엔진에 닿거나 끝날 때까지 기다린다.
 * 엔진을 붙들지 않았으면(`holdEngine`을 부르지 않았다) 끝날 때까지 기다린다 — 추천은 엔진 배치가 두 번(멤버 조합,
 * 배치 변형)일 수 있고 그 사이에 캐시 키를 만드는 진짜 비동기가 끼어, 첫 배치에 닿은 것만으로는 끝난 것이 아니다.
 */
async function start(w: Wrapper): Promise<void> {
  const engineCalls = api.engineRunBatch.mock.calls.length;
  await press(w);
  await settle(w, engineCalls);
  if (!held) await settle(w);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  simCache.clear(); // 시뮬 결과 캐시는 앱이 켜져 있는 동안 남는다 — 테스트끼리 섞이지 않게 비운다.
  batches = [];
  held = false;
  api.overlayStatus.mockResolvedValue({ visible: true, click_through: false, shortcut_problems: [] });
  api.startupReportPath.mockResolvedValue(null);
  api.loadReport.mockResolvedValue(loaded);
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
    if (!(path in documents)) throw `파일을 찾을 수 없다: ${path}`;
    return structuredClone(documents[path]);
  });
  api.pickJsonFile.mockResolvedValue(null);
  // 게임 창 칸(GamePanel)은 이 흐름과 무관하다 — 게임이 없는 상태로 둔다.
  api.gameWindowStatus.mockResolvedValue({ state: 'missing', window: null, message: '게임 창을 찾을 수 없다', follow: false });
  api.onGameWindow.mockResolvedValue(() => {});
  api.onGameCapture.mockResolvedValue(() => {});
  api.onEngineProgress.mockImplementation(async (handler) => {
    emitProgress = handler;
    return unlistenProgress;
  });
});

describe('추천 실행', () => {
  it('시작할 때는 엔진을 부르지 않는다', async () => {
    const w = await render();
    expect(at(w, 'run-compute').text()).toBe('추천 실행');
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(api.engineCatalog).not.toHaveBeenCalled();
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    expect(api.readJsonFile).not.toHaveBeenCalled();
    expect((at(w, 'account-path').element as HTMLInputElement).value).toBe('');
  });

  it('계정·조건 파일로 추천을 실행해 순위를 그린다', async () => {
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await at(w, 'suggest-top').setValue('3');
    await refineOff(w);
    await start(w);

    expect(api.readJsonFile.mock.calls.map((c) => c[0])).toEqual([ACCOUNT_PATH, CONDITION_PATH]);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    const requests = api.engineRunBatch.mock.calls[0][0];
    expect(requests).toHaveLength(6);

    // 결과는 P-009의 화면이 그린다.
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위']);
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'suggestion').text()).toContain('6개 계산 → 상위 3개 표시');
    expect(at(w, 'engine-version').text()).toContain('fake/engine @ ffffffff');
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(at(w, 'run-compute').attributes('disabled')).toBeUndefined();

    // 화면의 1위 총딜은 엔진이 준 값 가운데 가장 큰 것이다.
    const best = Math.max(...requests.map((r) => fakeRow(r).total_damage as number));
    expect(at(w, 'total-raw').text()).toBe(`(${best.toLocaleString('en-US')})`);
  });

  it('계산하는 동안 진행 중임을 보이고, 끝난 건수를 따라간다', async () => {
    holdEngine();
    const w = await render();
    api.loadReport.mockClear();
    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await refineOff(w);
    await start(w);

    const progress = at(w, 'compute-progress');
    expect(progress.exists()).toBe(true);
    expect(progress.attributes('role')).toBe('status');
    expect(progress.text()).toContain('엔진 계산 중 — 0/6건 끝남');
    expect(at(w, 'compute-elapsed').text()).toMatch(/^\d+초$/);
    expect(at(w, 'run-compute').text()).toBe('계산 중…');
    expect(at(w, 'run-compute').attributes('disabled')).toBeDefined();
    expect(at(w, 'account-path').attributes('disabled')).toBeDefined();
    expect(at(w, 'load-report').attributes('disabled')).toBeDefined();
    expect(at(w, 'hint').exists()).toBe(false);

    emitProgress({ done: 2, total: 6 });
    await flushPromises();
    expect(progress.text()).toContain('2/6건 끝남');
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('2');
    // 프로세스 여러 개가 따로 알려 오므로 늦게 온 작은 값으로 되돌아가지 않는다.
    emitProgress({ done: 1, total: 6 });
    await flushPromises();
    expect(progress.text()).toContain('2/6건 끝남');

    // 계산 중에 다시 눌러도, 결과 파일을 불러오려 해도 겹쳐 실행되지 않는다.
    await at(w, 'run-compute').trigger('click');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(batches).toHaveLength(1);
    expect(api.loadReport).not.toHaveBeenCalled();

    batches[0].finish();
    await flushPromises();
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(w.findAll('[data-testid="ranking-entry"]').length).toBeGreaterThan(0);
    expect(unlistenProgress).toHaveBeenCalledTimes(1);
  });

  it('엔진을 부르기 전에는 준비 중으로 보인다', async () => {
    let release: (value: unknown) => void = () => {};
    api.readJsonFile.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const w = await render();
    await fillPaths(w);
    await press(w);
    expect(at(w, 'compute-progress').text()).toContain('입력 파일과 엔진 데이터를 읽는 중');
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    release(structuredClone(documents[ACCOUNT_PATH]));
    await settle(w);
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(w.findAll('[data-testid="ranking-entry"]').length).toBeGreaterThan(0);
  });

  it('계산을 시작하면 앞서 불러온 다른 결과를 치운다', async () => {
    holdEngine();
    api.startupReportPath.mockResolvedValue('D:\\old.json');
    const w = await render();
    expect(texts(w, 'squad-name')).toContain('A 레드후드-앨리스');
    await fillPaths(w);
    await start(w);
    expect(at(w, 'ranking-entry').exists()).toBe(false);
    batches[0].fail('엔진 시간 초과 (600초)');
    await flushPromises();
    expect(at(w, 'ranking-entry').exists()).toBe(false);
    expect(at(w, 'error').text()).toBe('실행 오류 — 엔진 시간 초과 (600초)');
  });

  it('쓴 파일 경로와 방식을 기억했다가 다음 실행 때 채운다', async () => {
    const first = await render();
    await fillPaths(first);
    await start(first);
    first.unmount();

    const second = await render();
    expect((at(second, 'account-path').element as HTMLInputElement).value).toBe(ACCOUNT_PATH);
    expect((at(second, 'condition-path').element as HTMLInputElement).value).toBe(CONDITION_PATH);
    expect((at(second, 'mode-suggest').element as HTMLInputElement).checked).toBe(true);
  });
});

describe('배치 탐색과 예산 (추천의 2단계)', () => {
  it('배치 탐색은 처음부터 켜져 있고, 예산 칸은 계산 코드의 기본값을 보인다', async () => {
    const w = await render();
    expect((at(w, 'suggest-refine').element as HTMLInputElement).checked).toBe(true);
    expect(at(w, 'suggest-budget').attributes('placeholder')).toBe('120');
    expect((at(w, 'suggest-budget').element as HTMLInputElement).value).toBe('');
  });

  it('두 단계를 차례로 계산하며 단계와 쓴 예산을 보이고, 결과에 탐색 요약과 배치 메모를 그린다', async () => {
    holdEngine();
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await at(w, 'suggest-top').setValue('6');
    await at(w, 'suggest-budget').setValue('16');
    await start(w);

    // 1단계: 멤버 조합 6건.
    expect(batches).toHaveLength(1);
    expect(batches[0].requests).toHaveLength(6);
    const progress = at(w, 'compute-progress');
    expect(progress.text()).toContain('엔진 계산 중 — 1/2단계(멤버 조합) 0/6건 끝남');
    expect(at(w, 'compute-budget').text()).toBe('예산 16건 중 6건');
    emitProgress({ done: 6, total: 6 });
    await flushPromises();
    expect(progress.text()).toContain('1/2단계(멤버 조합) 6/6건 끝남');

    // 2단계: 남은 예산 10건만큼의 배치 변형. 건수는 새 배치에 맞춰 다시 센다.
    batches[0].finish();
    await settle(w, 1);
    expect(batches).toHaveLength(2);
    expect(batches[1].requests).toHaveLength(10);
    expect(progress.text()).toContain('엔진 계산 중 — 2/2단계(배치) 0/10건 끝남');
    expect(at(w, 'compute-budget').text()).toBe('예산 16건 중 16건');
    expect(w.find('[role="progressbar"]').attributes('aria-valuemax')).toBe('10');
    emitProgress({ done: 4, total: 10 });
    await flushPromises();
    expect(progress.text()).toContain('2/2단계(배치) 4/10건 끝남');
    expect(at(w, 'run-compute').attributes('disabled')).toBeDefined();

    batches[1].finish();
    await settle(w);
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(at(w, 'error').exists()).toBe(false);
    // 엔진에 맡긴 요청은 예산을 넘지 않는다.
    expect(batches.reduce((n, b) => n + b.requests.length, 0)).toBe(16);
    expect(at(w, 'search').text()).toMatch(
      /^탐색: 시뮬 16건 \/ 예산 16건 \(1단계 조합 6건 \+ 2단계 배치 10건\) · 예산이 모자라 못 본 것: 배치 변형 \d+개 · 배치를 바꾼 조합 \d\/5개$/,
    );
    expect(at(w, 'cache').text()).toBe('캐시: 적중 0건 · 엔진 계산 16건 · 새로 저장 16건');
    // 조합마다 한 줄이고(이름이 겹치지 않는다) 2단계 대상 다섯 조합에 배치 메모가 붙는다.
    const names = texts(w, 'squad-name');
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
    expect(texts(w, 'note').filter((n) => n.startsWith('배치 탐색:'))).toHaveLength(5);
    expect(w.text()).toMatch(/시뮬 예산 16건이 모자라 배치 변형 \d+개 중 \d+개를 계산하지 못했다\./);
  });

  it('배치 탐색으로 고른 1위는 끄고 계산한 1위 이상이다', async () => {
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await refineOff(w);
    await start(w);
    const plainBest = at(w, 'total-raw').text();
    expect(at(w, 'search').text()).toBe('탐색: 시뮬 6건 / 예산 120건 (1단계 조합 6건 · 배치 탐색 끔)');
    expect(texts(w, 'note').some((n) => n.startsWith('배치 탐색:'))).toBe(false);

    await at(w, 'suggest-refine').setValue(true);
    await start(w);
    const number = (text: string) => Number(text.replace(/[^\d]/g, ''));
    expect(number(at(w, 'total-raw').text())).toBeGreaterThanOrEqual(number(plainBest));
    expect(api.engineRunBatch.mock.calls.reduce((n, c) => n + c[0].length, 0)).toBeLessThanOrEqual(120);
  });

  it('배치 탐색을 끈 것을 기억했다가 다음 실행 때 그대로 둔다', async () => {
    const first = await render();
    await fillPaths(first);
    await refineOff(first);
    await start(first);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = await render();
    expect((at(second, 'suggest-refine').element as HTMLInputElement).checked).toBe(false);
  });

  it('예산이 잘못되면 입력 오류로 알리고 엔진을 부르지 않는다', async () => {
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-budget').setValue('0');
    await start(w);
    expect(at(w, 'error').text()).toMatch(/^입력 오류 — .*budget은 1 이상의 정수여야 한다/);
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });
});

describe('비교 실행', () => {
  it('편성 파일 칸은 비교를 고르면 나온다', async () => {
    const w = await render();
    expect(at(w, 'squads-path').exists()).toBe(false);
    expect(at(w, 'suggest-limit').exists()).toBe(true);
    await at(w, 'mode-compare').setValue(true);
    expect(at(w, 'squads-path').exists()).toBe(true);
    expect(at(w, 'suggest-limit').exists()).toBe(false);
    expect(at(w, 'suggest-budget').exists()).toBe(false);
    expect(at(w, 'suggest-refine').exists()).toBe(false);
    expect(at(w, 'run-compute').text()).toBe('비교 실행');
  });

  it('편성 파일의 편성을 비교해 순위와 걸러진 편성을 그린다', async () => {
    const w = await render();
    await fillPaths(w);
    await at(w, 'mode-compare').setValue(true);
    await at(w, 'squads-path').setValue(SQUADS_PATH);
    await start(w);

    expect(api.readJsonFile.mock.calls.map((c) => c[0])).toEqual([ACCOUNT_PATH, CONDITION_PATH, SQUADS_PATH]);
    expect(api.engineRunBatch.mock.calls[0][0]).toHaveLength(3);
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위']);
    expect(texts(w, 'squad-name').sort()).toEqual(['A 레드후드-앨리스', 'B 레드후드-미하라', 'C 프리카-앨리스']);
    expect(w.text()).toContain('D 미보유 포함');
    expect(w.text()).toContain('E 중복');
    expect(at(w, 'suggestion').exists()).toBe(false);
    expect(localStorage.getItem('nikke-companion.compute.mode')).toBe('compare');
  });
});

describe('오류 표시', () => {
  it('파일 경로가 비어 있으면 알리고 엔진을 부르지 않는다', async () => {
    const w = await render();
    await at(w, 'condition-path').setValue(CONDITION_PATH);
    await start(w);
    const error = at(w, 'error');
    expect(error.text()).toBe('계정 파일 경로를 넣어야 한다.');
    expect(error.attributes('role')).toBe('alert');
    expect(api.engineCatalog).not.toHaveBeenCalled();
    expect(at(w, 'run-compute').attributes('disabled')).toBeUndefined();
  });

  it('파일을 읽지 못하면 Rust가 준 한국어 오류를 보인다', async () => {
    const w = await render();
    await at(w, 'account-path').setValue('D:\\없음.json');
    await at(w, 'condition-path').setValue(CONDITION_PATH);
    await start(w);
    expect(at(w, 'error').text()).toBe('계정 파일 — 파일을 찾을 수 없다: D:\\없음.json');
    expect(at(w, 'ranking-entry').exists()).toBe(false);
  });

  it('입력이 잘못되면 입력 오류를, 엔진이 실패하면 실행 오류를 보이고 다시 실행할 수 있다', async () => {
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-top').setValue('0');
    await start(w);
    expect(at(w, 'error').text()).toMatch(/^입력 오류 — .*top은 1 이상의 정수여야 한다/);

    await at(w, 'suggest-top').setValue('2');
    api.engineRunBatch.mockRejectedValueOnce('엔진을 실행할 수 없다 (python): program not found');
    await start(w);
    expect(at(w, 'error').text()).toBe('실행 오류 — 엔진을 실행할 수 없다 (python): program not found');
    expect(at(w, 'compute-progress').exists()).toBe(false);

    await start(w);
    expect(at(w, 'error').exists()).toBe(false);
    expect(texts(w, 'rank')).toEqual(['1위', '2위']);
  });

  it('엔진이 일부 편성에서 오류를 내면 실패한 편성으로 보이고 나머지는 순위에 남는다', async () => {
    api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r, '미하라')));
    const w = await render();
    await fillPaths(w);
    await at(w, 'mode-compare').setValue(true);
    await at(w, 'squads-path').setValue(SQUADS_PATH);
    await start(w);
    expect(texts(w, 'squad-name')).toEqual(['A 레드후드-앨리스']);
    expect(w.text()).toContain('가짜 엔진 오류: 미하라');
  });

  it('진행 이벤트를 듣지 못해도 계산은 끝까지 한다', async () => {
    api.onEngineProgress.mockRejectedValue('이벤트를 들을 수 없다');
    const w = await render();
    await fillPaths(w);
    await start(w);
    expect(at(w, 'error').exists()).toBe(false);
    expect(w.findAll('[data-testid="ranking-entry"]').length).toBeGreaterThan(0);
  });
});

describe('계산 중단', () => {
  it('중단 단추는 계산이 도는 동안에만 보인다', async () => {
    holdEngine();
    const w = await render();
    expect(at(w, 'stop-compute').exists()).toBe(false);
    await fillPaths(w);
    await refineOff(w);
    await start(w);
    expect(at(w, 'stop-compute').exists()).toBe(true);
    expect(at(w, 'stop-compute').text()).toBe('중단');
    expect(at(w, 'compute-stopped').exists()).toBe(false);

    batches[0].finish();
    await settle(w);
    // 끝까지 간 계산: 단추가 사라지고 '중단됨'은 없다.
    expect(at(w, 'stop-compute').exists()).toBe(false);
    expect(at(w, 'compute-stopped').exists()).toBe(false);
    expect(api.engineCancel).not.toHaveBeenCalled();
    expect(w.findAll('[data-testid="ranking-entry"]').length).toBeGreaterThan(0);
  });

  it('중단하면 엔진을 멈추고 상태가 중단됨이 된다. 이전 결과는 그대로 남고 오류는 뜨지 않는다', async () => {
    holdEngine();
    api.startupReportPath.mockResolvedValue('D:\\old.json');
    const w = await render();
    const before = { names: texts(w, 'squad-name'), totals: texts(w, 'total-raw') };
    expect(before.names).toContain('A 레드후드-앨리스');

    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await refineOff(w);
    await start(w);
    // 계산하는 동안에는 이전 결과를 치워 둔다(새 계산의 결과로 오해하지 않게).
    expect(at(w, 'ranking-entry').exists()).toBe(false);
    expect(at(w, 'compute-progress').text()).toContain('0/6건 끝남');

    await at(w, 'stop-compute').trigger('click');
    await settle(w);

    // Rust의 중단 명령을 한 번 불렀고, 배치는 '중단됨' 오류로 끝났다.
    expect(api.engineCancel).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
    expect(batches[0].settled).toBe(true);
    // 상태는 '중단됨'이고 오류가 아니다.
    expect(at(w, 'compute-stopped').text()).toMatch(/^중단됨/);
    expect(at(w, 'compute-stopped').attributes('role')).toBe('status');
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'compute-progress').exists()).toBe(false);
    expect(at(w, 'stop-compute').exists()).toBe(false);
    expect(at(w, 'run-compute').text()).toBe('추천 실행');
    expect(at(w, 'run-compute').attributes('disabled')).toBeUndefined();
    expect(at(w, 'load-report').attributes('disabled')).toBeUndefined();
    // 이전 결과가 그대로 다시 보인다.
    expect({ names: texts(w, 'squad-name'), totals: texts(w, 'total-raw') }).toEqual(before);
    // 멈춘 계산의 요청은 캐시에 남지 않는다.
    expect(simCache.size).toBe(0);
    expect(unlistenProgress).toHaveBeenCalledTimes(1);
  });

  it('이전 결과가 없을 때 중단하면 결과 없이 중단됨만 보인다', async () => {
    holdEngine();
    const w = await render();
    await fillPaths(w);
    await refineOff(w);
    await start(w);
    await at(w, 'stop-compute').trigger('click');
    await settle(w);
    expect(at(w, 'compute-stopped').text()).toMatch(/^중단됨/);
    expect(at(w, 'ranking-entry').exists()).toBe(false);
    expect(at(w, 'error').exists()).toBe(false);
  });

  it('중단한 뒤에 다시 실행할 수 있다', async () => {
    holdEngine();
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await at(w, 'suggest-top').setValue('3');
    await refineOff(w);
    await start(w);
    await at(w, 'stop-compute').trigger('click');
    await settle(w);
    expect(at(w, 'compute-stopped').exists()).toBe(true);

    // 다시 실행: '중단됨'이 사라지고, 새 배치가 엔진에 가서 끝까지 돈다.
    await start(w);
    expect(at(w, 'compute-stopped').exists()).toBe(false);
    expect(at(w, 'stop-compute').exists()).toBe(true);
    expect(batches).toHaveLength(2);
    expect(batches[1].requests).toHaveLength(6);
    batches[1].finish();
    await settle(w);
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위']);
    expect(at(w, 'compute-stopped').exists()).toBe(false);
    expect(at(w, 'error').exists()).toBe(false);
    expect(api.engineCancel).toHaveBeenCalledTimes(1);
  });

  it('두 단계 사이(엔진이 돌지 않을 때)나 2단계에서 중단해도 멈춘다 — 다음 배치를 엔진에 보내지 않는다', async () => {
    holdEngine();
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await at(w, 'suggest-budget').setValue('16');
    await start(w);
    expect(batches).toHaveLength(1);

    // 1단계 배치가 막 돌아온 순간에 누른다: 멈출 엔진 프로세스가 없다.
    batches[0].finish();
    await at(w, 'stop-compute').trigger('click');
    expect(at(w, 'stop-compute').text()).toBe('중단하는 중…');
    expect(at(w, 'stop-compute').attributes('disabled')).toBeDefined();
    await settle(w);
    expect(batches).toHaveLength(1);
    expect(at(w, 'compute-stopped').text()).toMatch(/^중단됨/);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'ranking-entry').exists()).toBe(false);
  });

  it('중단 명령이 닿기 전에 배치가 시작 전이었으면 다시 청해서 멈춘다', async () => {
    holdEngine();
    const w = await render();
    await fillPaths(w);
    await refineOff(w);
    await start(w);
    // 첫 청은 "도는 배치 없음"(Rust에 배치 호출이 아직 닿지 않았다), 다음 청에서 멈춘다.
    api.engineCancel.mockResolvedValueOnce(false);
    await at(w, 'stop-compute').trigger('click');
    await vi.waitFor(() => expect(api.engineCancel).toHaveBeenCalledTimes(2));
    await settle(w);
    expect(at(w, 'compute-stopped').text()).toMatch(/^중단됨/);
    expect(at(w, 'error').exists()).toBe(false);
  });

  it('중단 명령을 보내지 못해도 그 계산의 결과는 쓰지 않는다', async () => {
    holdEngine();
    api.engineCancel.mockRejectedValue('명령을 부를 수 없다');
    const w = await render();
    await fillPaths(w);
    await refineOff(w);
    await start(w);
    await at(w, 'stop-compute').trigger('click');
    await flushPromises();
    // 엔진은 멈추지 못했다 — 계산이 끝까지 가도 누른 뒤의 화면은 '중단됨'이다.
    expect(at(w, 'compute-progress').exists()).toBe(true);
    batches[0].finish();
    await settle(w);
    expect(at(w, 'compute-stopped').text()).toMatch(/^중단됨/);
    expect(at(w, 'ranking-entry').exists()).toBe(false);
    expect(at(w, 'error').exists()).toBe(false);
  });
});

describe('시뮬 결과 캐시', () => {
  it('같은 계산을 다시 실행하면 엔진을 부르지 않고 같은 순위를 그린다. 캐시 줄이 그것을 알린다', async () => {
    const w = await render();
    await fillPaths(w);
    await at(w, 'suggest-limit').setValue('6');
    await at(w, 'suggest-top').setValue('3');
    await refineOff(w);
    await start(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    expect(at(w, 'cache').text()).toBe('캐시: 적중 0건 · 엔진 계산 6건 · 새로 저장 6건');
    const first = { names: texts(w, 'squad-name'), totals: texts(w, 'total-raw') };

    await start(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    expect(at(w, 'cache').text()).toBe('캐시: 적중 6건 · 엔진 계산 0건 · 새로 저장 0건');
    expect({ names: texts(w, 'squad-name'), totals: texts(w, 'total-raw') }).toEqual(first);
    expect(at(w, 'cache-warning').exists()).toBe(false);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'compute-progress').exists()).toBe(false);
  });

  it('엔진 판을 알 수 없으면 캐시 없이 계산하고 이유를 보인다', async () => {
    api.engineVersion.mockResolvedValue({ repo: 'fake/engine', commit: null, dirty: null });
    const w = await render();
    await fillPaths(w);
    await refineOff(w);
    await start(w);
    await start(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(2);
    expect(at(w, 'cache').text()).toMatch(/^캐시: 적중 0건 · 엔진 계산 \d+건 · 새로 저장 0건$/);
    expect(texts(w, 'cache-warning')).toEqual(['! 엔진 커밋을 알 수 없어 캐시를 쓰지 않았다']);
    expect(w.findAll('[data-testid="ranking-entry"]').length).toBeGreaterThan(0);
  });
});

describe('파일 고르기', () => {
  it('고른 파일의 경로를 칸에 채운다. 취소하면 그대로 둔다', async () => {
    const w = await render();
    api.pickJsonFile.mockResolvedValueOnce('D:\\고른\\account.json');
    await at(w, 'pick-account').trigger('click');
    await flushPromises();
    expect(api.pickJsonFile).toHaveBeenCalledWith('계정 상태 파일 고르기');
    expect((at(w, 'account-path').element as HTMLInputElement).value).toBe('D:\\고른\\account.json');

    await at(w, 'pick-account').trigger('click');
    await flushPromises();
    expect((at(w, 'account-path').element as HTMLInputElement).value).toBe('D:\\고른\\account.json');

    api.pickJsonFile.mockResolvedValueOnce(CONDITION_PATH);
    await at(w, 'pick-condition').trigger('click');
    await flushPromises();
    expect(api.pickJsonFile).toHaveBeenLastCalledWith('전투 조건 파일 고르기');
    expect((at(w, 'condition-path').element as HTMLInputElement).value).toBe(CONDITION_PATH);
  });

  it('고르기 창을 열지 못하면 알린다(경로는 직접 넣을 수 있다)', async () => {
    api.pickJsonFile.mockRejectedValue('창 없음');
    const w = await render();
    await at(w, 'pick-account').trigger('click');
    await flushPromises();
    expect(at(w, 'error').text()).toBe('파일 고르기 창을 열지 못했다: 창 없음');
  });
});
