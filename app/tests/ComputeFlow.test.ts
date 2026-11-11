// 오버레이에서 추천·비교를 실행하는 흐름: 파일 고르기 → 실행 → 진행 중 표시 → 순위 또는 오류.
// Rust 쪽(backend)은 가짜다. 후보 생성·순위는 루트의 실제 계산 코드가 하고, 결과는 P-009의 화면(ReportView)이 그린다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
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
  readJsonFile: vi.fn(),
  pickJsonFile: vi.fn(),
  onEngineProgress: vi.fn(),
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
}
let batches: PendingBatch[] = [];

function holdEngine(): void {
  api.engineRunBatch.mockImplementation(
    (requests) =>
      new Promise<EngineRow[]>((resolve, reject) => {
        batches.push({ requests, finish: (rows) => resolve(rows ?? requests.map((r) => fakeRow(r))), fail: reject });
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

async function start(w: Wrapper): Promise<void> {
  await at(w, 'run-compute').trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  batches = [];
  api.overlayStatus.mockResolvedValue({ visible: true, click_through: false, shortcut_problems: [] });
  api.startupReportPath.mockResolvedValue(null);
  api.loadReport.mockResolvedValue(loaded);
  api.onOverlayState.mockResolvedValue(() => {});
  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue(FAKE_EVALUATOR);
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r)));
  api.readJsonFile.mockImplementation(async (path) => {
    if (!(path in documents)) throw `파일을 찾을 수 없다: ${path}`;
    return structuredClone(documents[path]);
  });
  api.pickJsonFile.mockResolvedValue(null);
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
    await start(w);
    expect(at(w, 'compute-progress').text()).toContain('입력 파일과 엔진 데이터를 읽는 중');
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    release(structuredClone(documents[ACCOUNT_PATH]));
    await flushPromises();
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

describe('비교 실행', () => {
  it('편성 파일 칸은 비교를 고르면 나온다', async () => {
    const w = await render();
    expect(at(w, 'squads-path').exists()).toBe(false);
    expect(at(w, 'suggest-limit').exists()).toBe(true);
    await at(w, 'mode-compare').setValue(true);
    expect(at(w, 'squads-path').exists()).toBe(true);
    expect(at(w, 'suggest-limit').exists()).toBe(false);
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
