// 육성 효율(P-031)의 화면: 편성 도구의 「육성 효율」 탭 — 기준 편성(덱 빌더의 지금 편성 · 요격전 1위 편성)과 상대,
// 육성 효율표(한 단계 올릴 수 있는 것을 자동으로 만들어 증가율 순으로), 오버로드 옵션 바꿔 보기, 큐브 바꿔 보기.
// 규칙 자체는 루트의 단위 테스트(tests/unit/efficiency.test.mjs)가, 실제 엔진으로는 tests/integration/efficiency.engine.test.mjs가 본다.
// Rust 쪽(backend)은 가짜다: 계정 폴더는 가짜 디스크, 엔진은 니케의 육성 칸(스킬·돌파·코어 강화·오버로드·큐브)에서 정해지는 값을 낸다.
// 계정은 검증용 샘플(data/samples/)뿐이다 — 실제 계정은 쓰지 않는다.
import { overloadOptionId } from '@core/account.mjs';
import { resolveOpponent as coreResolveOpponent } from '@core/deck.mjs';
import { compareCubes, cubeList, efficiencyTable, tryOverload, upgradeCandidates } from '@core/efficiency.mjs';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bundle from '../../data/intercept/anomaly.json';
import largeAccount from '../../data/samples/account.large.sample.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { damageUnit, signedPercent } from '../src/lib/format';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { simCache } from '../src/lib/runtime';
import type { CubeReport, EfficiencyReport, EngineRequest, EngineRow, InterceptReport, OverloadPart, OverloadTrialReport } from '../src/types';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog, FAKE_EVALUATOR, fakeRow, sampleAccount } from './helpers/fakeEngine';
import { currentPage, FakeDisk, installShell, openPage } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
  loadReport: vi.fn(),
  engineCatalog: vi.fn(),
  engineVersion: vi.fn(),
  engineRunBatch: vi.fn(),
  engineCancel: vi.fn(),
  readJsonFile: vi.fn(),
  pickJsonFile: vi.fn(),
  onEngineProgress: vi.fn(),
  setScreenTracking: vi.fn(),
  screenTrackStatus: vi.fn(),
  onScreenTrack: vi.fn(),
  accountSyncStatus: vi.fn(),
  extensionLinkStatus: vi.fn(),
  onExtensionLink: vi.fn(),
  captureGame: vi.fn(),
}));

const api = vi.mocked(backend);
let disk = new FakeDisk();
type Wrapper = ReturnType<typeof mount>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const all = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => all(w, testid).map((el) => el.text().replace(/\s+/g, ' '));
const named = (w: Wrapper, testid: string, name: string) => all(w, testid).find((el) => el.attributes('data-name') === name)!;

/** 샘플 계정의 편성(1·2·3·3·3단계). */
const DECK = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];
const kraken = coreResolveOpponent('boss:kraken', { bundle, catalog })!;

// ── 가짜 엔진: 니케의 육성 칸에서 정해지는 값 ──────────────────────────────────
const OPTION_WEIGHT: Record<string, number> = { atk_pct: 9, element_bonus: 7, max_ammo_pct: 5, crit_rate: 3, crit_dmg: 4, charge_speed_pct: 2, charge_dmg_pct: 2, accuracy_pct: 1, def_pct: 0 };
const codes = (text: string) => [...text].reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0);
/** 큐브의 가짜 효과: 니케와 큐브의 이름에서 정해지는 −4 ~ +6. */
const cubeBonus = (name: string, cube: string) => (codes(name + cube) % 11) - 4;

function power(name: string, entry: Record<string, unknown> | undefined): number {
  if (!entry) return 100;
  const skills = (entry.skill_levels as number[] | undefined) ?? [1, 1, 1];
  let p = 100 + skills[0] * 3 + skills[1] * 2 + skills[2] * 5 + Number(entry.breakthrough ?? 0) * 20 + Number(entry.core_enhancement ?? 0) * 7;
  for (const [key, value] of Object.entries((entry.overload ?? {}) as Record<string, number | number[]>)) {
    const lines = Array.isArray(value) ? value.reduce((s, lv) => s + lv / 10, 0) : value;
    p += lines * (OPTION_WEIGHT[overloadOptionId(key) ?? ''] ?? 0);
  }
  const cube = (entry.cube as { name?: string } | undefined)?.name;
  return p + (cube ? cubeBonus(name, cube) : 0);
}

/** 가짜 엔진의 결과 한 줄. `failCube`를 낀 요청은 계산하지 못한다. */
function engineRow(request: EngineRequest, failCube?: string): EngineRow {
  const chars = ((request.profile as { chars?: Record<string, Record<string, unknown>> } | undefined)?.chars ?? {}) as Record<string, Record<string, unknown>>;
  const squad = request.squad as string[];
  if (failCube && squad.some((n) => (chars[n]?.cube as { name?: string } | undefined)?.name === failCube)) {
    return { error: { type: 'invalid_input', message: `가짜 엔진 오류: ${failCube}`, path: '/profile' } };
  }
  const row = fakeRow(request);
  const members = (row.members as { name: string; damage: number }[]).map((m) => ({ name: m.name, damage: (m.damage * power(m.name, chars[m.name])) / 100 }));
  const total = members.reduce((sum, m) => sum + m.damage, 0);
  return { ...row, total_damage: total, members: members.map((m) => ({ ...m, share: m.damage / total })) };
}

/** 화면이 거치는 것과 같은 계산을 루트의 함수로 바로 한 것(기대값). */
const coreDeps = { catalog, runBatch: async (requests: EngineRequest[]) => requests.map((r) => engineRow(r)) };
const expectedTable = (account: unknown, members: string[], only: string | null = null) =>
  efficiencyTable({ account: account as object, opponent: kraken, members }, { only }, coreDeps) as unknown as Promise<EfficiencyReport>;

/** 띄운 앱 창들 — 테스트가 끝나면 내린다. */
const mounted: Wrapper[] = [];
async function render(): Promise<Wrapper> {
  const wrapper = mount(App);
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

/** 계산이 끝날 때까지(메뉴의 「계산 중」 점이 사라질 때까지) 기다린다. */
async function idle(w: Wrapper): Promise<void> {
  await flushPromises();
  await vi.waitFor(
    () => {
      if (at(w, 'nav-busy').exists()) throw new Error('아직 계산 중이다');
    },
    { timeout: 10000 },
  );
  await flushPromises();
}

/** 덱 빌더에서 짜던 편성으로 기억해 둔다(이 PC의 기억 — 덱 빌더를 열지 않아도 육성 효율이 읽는다). */
function rememberDeck(slots: (string | null)[], opponent: string | null = 'boss:kraken'): void {
  localStorage.setItem('nikke-companion.deck.working', JSON.stringify({ slots, opponent }));
}

/** 편성 도구의 육성 효율 탭을 연다. */
async function openLab(w: Wrapper): Promise<void> {
  await openPage(w, 'tools');
  await at(w, 'tool-efficiency').trigger('click');
  await flushPromises();
}

const memberNames = (w: Wrapper) => all(w, 'lab-member').map((m) => m.attributes('data-name') ?? null);
async function press(w: Wrapper, testid: string): Promise<void> {
  await at(w, testid).trigger('click');
  await idle(w);
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  simCache.clear();
  clearNikkeCatalog();
  disk = installShell(api);
  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue(FAKE_EVALUATOR);
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => engineRow(r)));
  api.engineCancel.mockResolvedValue(false);
  api.onEngineProgress.mockResolvedValue(() => {});
  api.readJsonFile.mockRejectedValue('없다');
  api.pickJsonFile.mockResolvedValue(null);
  api.loadReport.mockRejectedValue('결과가 없다');
  api.onScreenTrack.mockResolvedValue(() => {});
  api.screenTrackStatus.mockResolvedValue({ enabled: false, interval_ms: 2000, state: 'off', message: '', recognition: null, read_at: null, capture_ms: null, failures: 0 });
  api.accountSyncStatus.mockImplementation(async (name) => ({ name: name ?? 'me', cookie_saved: false, cookie_saved_at: null, profile_fetched_at: null, account_file: null, login_window_open: false, problems: [] }));
  api.extensionLinkStatus.mockResolvedValue({ enabled: false, listening: false, address: '127.0.0.1:47615', code: 'ABCD-2345', problem: null, pending: false, last: null, locked_seconds: 0 });
  api.onExtensionLink.mockResolvedValue(() => {});
});

// ── 기준 편성과 상대 ──────────────────────────────────────────────────────────

describe('기준 편성', () => {
  it('편성 도구에 「육성 효율」 탭이 있다 — 계정이 없으면 계정 연결을 안내한다', async () => {
    const w = await render();
    await openLab(w);
    expect(at(w, 'tool-efficiency').text()).toBe('육성 효율');
    expect(at(w, 'tool-efficiency').attributes('aria-selected')).toBe('true');
    expect(localStorage.getItem('nikke-companion.tools.tab')).toBe('efficiency');
    expect(at(w, 'lab-need-account').find('[data-testid="empty-title"]').text()).toBe('아직 계정을 연결하지 않았다');
    await at(w, 'lab-need-account').find('[data-testid="empty-action"]').trigger('click');
    expect(currentPage(w)).toBe('settings');
  });

  it('덱 빌더의 지금 편성을 기준으로 쓴다 — 덜 찼으면 무엇을 하면 되는지 말하고, 덱 빌더에서 바꾸면 따라온다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openLab(w);
    expect(at(w, 'lab-source-deck').attributes('aria-checked')).toBe('true');
    // 요격전 추천이 없으면 「요격전 1위 편성」은 고를 수 없다(왜인지 풍선 도움말로).
    expect(at(w, 'lab-source-intercept').attributes('disabled')).toBeDefined();
    expect(at(w, 'lab-source-intercept').attributes('title')).toBe('요격전 화면에서 추천을 계산하면 고를 수 있다');
    expect(at(w, 'lab-need-squad').text()).toContain('덱 빌더의 편성이 아직 다섯 명이 아니다(지금 0명)');
    for (const id of ['eff-run', 'ol-run', 'cube-run']) expect(at(w, id).attributes('disabled'), id).toBeDefined();
    expect(at(w, 'eff-run').attributes('title')).toBe('기준 편성의 다섯 자리가 모두 차야 계산할 수 있다(지금 0명)');

    // 「덱 빌더 열기」로 가서 다섯 자리를 채우고 상대를 고른다.
    await at(w, 'lab-open-deck').trigger('click');
    await flushPromises();
    expect(at(w, 'tool-deck').attributes('aria-selected')).toBe('true');
    for (const name of DECK) await all(w, 'deck-pick').find((b) => b.attributes('data-name') === name)!.trigger('click');
    await at(w, 'deck-builder').findAll('[data-testid="opponent-option"]').find((o) => o.attributes('data-key') === 'boss:kraken')!.trigger('click');
    await flushPromises();

    // 육성 효율로 돌아오면 그 편성과 그 상대가 기준이다.
    await at(w, 'tool-efficiency').trigger('click');
    await flushPromises();
    expect(memberNames(w)).toEqual(DECK);
    expect(at(w, 'lab-need-squad').exists()).toBe(false);
    const lab = at(w, 'growth-lab');
    expect(lab.find('[data-testid="opponent-name"]').text()).toBe('상대 크라켄');
    expect(lab.find('[data-testid="opponent-unconfirmed"]').text()).toBe('미확인 값 7칸');
    expect(at(w, 'eff-run').attributes('disabled')).toBeUndefined();
    expect(at(w, 'data-kind').exists()).toBe(true);
    // 약점 속성(풍압) 니케에는 테두리.
    for (const m of all(w, 'lab-member')) {
      expect(m.find('[data-testid="nikke-tile"]').attributes('data-weak')).toBe(catalog.nikkes[m.attributes('data-name')!]?.element_code === '풍압' ? 'true' : 'false');
    }
    // 상대는 여기서 따로 고를 수도 있다(덱 빌더의 상대는 그대로다).
    await lab.findAll('[data-testid="opponent-option"]').find((o) => o.attributes('data-key') === 'element:작열')!.trigger('click');
    expect(lab.find('[data-testid="opponent-name"]').text()).toBe('상대 약점 작열');
    expect(JSON.parse(localStorage.getItem('nikke-companion.deck.working')!).opponent).toBe('boss:kraken');
    // 짜는 것만으로는 계산하지 않는다.
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });

  it('요격전 1위 편성을 기준으로 쓴다 — 보스를 고르면 그 보스의 1위 편성과 그 보스가 상대가 된다', async () => {
    disk.addAccount('me', sampleAccount);
    // 샘플 결과의 보스 다섯을 이상 개체 보스 다섯으로 바꾼 지어낸 추천 결과(편성과 수치는 샘플 그대로).
    const report = structuredClone(interceptFixture) as unknown as InterceptReport;
    report.bosses.forEach((b, i) => {
      b.id = bundle.bosses[i].id;
      b.name = bundle.bosses[i].name;
      b.weak_pool = null;
    });
    disk.putIntercept(report);
    const w = await render();
    await openLab(w);
    expect(at(w, 'lab-source-intercept').attributes('disabled')).toBeUndefined();
    await at(w, 'lab-source-intercept').trigger('click');
    await flushPromises();
    expect(localStorage.getItem('nikke-companion.efficiency.source')).toBe('intercept');
    const withRanking = report.bosses.filter((b) => b.ranking.length > 0);
    expect(all(w, 'lab-boss').map((b) => b.attributes('data-id'))).toEqual(withRanking.map((b) => b.id));
    // 처음에는 첫 보스.
    expect(memberNames(w)).toEqual(withRanking[0].ranking[0].members.map((m) => m.name));
    expect(at(w, 'growth-lab').find('[data-testid="opponent-name"]').text()).toBe(`상대 ${withRanking[0].name}`);

    const target = withRanking.find((b) => b.id === 'kraken') ?? withRanking[1];
    await all(w, 'lab-boss').find((b) => b.attributes('data-id') === target.id)!.trigger('click');
    await flushPromises();
    const first = target.ranking[0].members.map((m) => m.name);
    expect(memberNames(w)).toEqual(first);
    expect(at(w, 'growth-lab').find('[data-testid="opponent-name"]').text()).toBe(`상대 ${target.name}`);

    // 그 편성으로 효율표를 계산한다: 엔진에 간 편성이 1위 편성 그대로다.
    await named(w, 'eff-only', first[0]).trigger('click');
    await press(w, 'eff-run');
    const sent = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(sent.every((r) => JSON.stringify(r.squad) === JSON.stringify(first))).toBe(true);
    const condition = coreResolveOpponent(`boss:${target.id}`, { bundle, catalog })!.condition as { enemy?: unknown };
    expect(condition.enemy).toBeDefined();
    expect(sent[0].enemy).toEqual(condition.enemy);
  });

  it('기준 편성에 이 계정에 없는 니케가 있으면 계산하지 않고 그렇게 말한다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck([...DECK.slice(0, 4), '신데렐라']);
    const w = await render();
    await openLab(w);
    expect(at(w, 'lab-missing').text()).toBe('이 계정에 없는 니케가 기준 편성에 있어 계산할 수 없다: 신데렐라');
    expect(at(w, 'eff-run').attributes('disabled')).toBeDefined();
    expect(at(w, 'eff-run').attributes('title')).toBe('이 계정에 없는 니케가 기준 편성에 있다: 신데렐라');
  });
});

// ── 육성 효율표 ────────────────────────────────────────────────────────────────

describe('육성 효율표', () => {
  it('한 단계 올릴 수 있는 것을 자동으로 만들어 하나씩 계산하고, 총딜 증가율 순으로 초상화 · 무엇을 올리는지 · 막대를 보인다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    const made = upgradeCandidates({ account: sampleAccount, members: DECK, catalog });
    expect(made.candidates.length).toBeGreaterThan(30);
    expect(at(w, 'eff-run').attributes('title')).toBe(`한 단계 올릴 수 있는 것 ${made.candidates.length}개를 하나씩 계산한다`);
    expect(at(w, 'eff-hint').text()).toContain('스킬 1·2·버스트 레벨, 돌파, 코어 강화, 소장품 단계, 오버로드 줄을 한 단계씩 올려 본다. 이미 최대인 칸은 보지 않는다.');
    await press(w, 'eff-run');

    // 엔진에 간 것: 기준 1건 + 후보 수. 후보 파일을 읽은 적은 없다.
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    const sent = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(sent).toHaveLength(made.candidates.length + 1);
    expect(sent.every((r) => JSON.stringify(r.squad) === JSON.stringify(DECK))).toBe(true);
    expect(sent[0].enemy).toEqual({ code: '철갑' });
    expect(api.readJsonFile).not.toHaveBeenCalled();

    const expected = await expectedTable(sampleAccount, DECK);
    expect(at(w, 'eff-panel').attributes('data-fresh')).toBe('yes');
    expect(at(w, 'eff-baseline').text()).toBe(damageUnit(expected.baseline!.total_damage));
    const rows = all(w, 'eff-row');
    expect(rows.map((r) => r.attributes('data-id'))).toEqual(expected.rows.map((r) => r.id));
    expect(texts(w, 'eff-rank')).toEqual(expected.rows.map((r) => String(r.rank)));
    expect(texts(w, 'eff-nikke')).toEqual(expected.rows.map((r) => r.nikke));
    expect(texts(w, 'eff-step')).toEqual(expected.rows.map((r) => `${r.label} ${r.from} → ${r.to}`));
    expect(texts(w, 'eff-rate')).toEqual(expected.rows.map((r) => signedPercent(r.gain_rate)));
    expect(texts(w, 'eff-total')).toEqual(expected.rows.map((r) => damageUnit(r.total_after)));
    // 줄마다 니케 초상화와 증가율 막대가 있다. 1위의 막대가 가득 차 있고 뒤로 갈수록 짧다.
    expect(rows.every((r) => r.find('[data-testid="nikke-tile"]').exists() && r.find('[data-testid="damage-bar"]').exists())).toBe(true);
    const widths = rows.map((r) => Number.parseFloat((r.find('[data-testid="damage-bar-fill"]').element as HTMLElement).style.width));
    expect(widths[0]).toBe(100);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    // 증가율이 큰 순이다. 가짜 엔진에서 1위는 헬름의 오버로드 공격력 한 줄이 아니라 자리(5번)가 큰 앨리스 쪽일 수 있다 — 순서만 본다.
    const gains = expected.rows.map((r) => r.gain);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
    expect(gains[0]).toBeGreaterThan(0);
    // 이미 최대인 칸은 줄에 없다: 리틀 머메이드의 스킬·돌파·코어 강화.
    expect(rows.some((r) => r.attributes('data-nikke') === '리틀 머메이드' && ['skill1', 'skill2', 'burst', 'breakthrough', 'core'].includes(r.attributes('data-kind')!))).toBe(false);
    expect(rows.some((r) => r.attributes('data-nikke') === '헬름' && r.attributes('data-kind') === 'skill1')).toBe(true);
    const fold = at(w, 'eff-excluded');
    expect(fold.element.tagName).toBe('DETAILS');
    expect(fold.findAll('[data-testid="eff-excluded-item"]').map((li) => li.text())).toEqual(expected.excluded.map((e) => `${e.nikke} — ${e.reason}`));
    expect(fold.text()).toContain('리틀 머메이드 — 스킬 1 레벨이 이미 최대(10)다.');
    expect(at(w, 'eff-skipped').exists()).toBe(false);
    expect(at(w, 'eff-failed').exists()).toBe(false);
    // 접어 둔 계산 조건에 가정·주의가 있다.
    const conditions = at(w, 'lab-conditions');
    expect(conditions.findAll('[data-testid="caveat-item"]').map((li) => li.text())).toEqual(expected.caveats);
    expect(conditions.find('[data-testid="engine-version"]').text()).toBe('계산 도구: fake/engine @ ffffffff');
  });

  it('비용은 모른다는 것이 계산 전에도 뒤에도 접힌 구획 밖에 보인다 — 「추정」도 그렇다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    const check = () => {
      const cost = at(w, 'eff-cost');
      expect(cost.text()).toBe('비용은 모른다 — 재화와 필요 수량의 표가 이 앱에 없다. 아래 순위는 「한 단계 올렸을 때 총딜이 얼마나 느는가」일 뿐이고, 싸게 올릴 수 있는지는 반영하지 않았다.');
      expect(at(w, 'cost-pill').text()).toBe('비용 미반영');
      expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
      for (const id of ['eff-cost', 'cost-pill', 'estimate-pill']) expect(at(w, id).element.closest('details'), id).toBeNull();
    };
    check();
    await named(w, 'eff-only', '헬름').trigger('click');
    await press(w, 'eff-run');
    check();
    // 값을 지어내지 않는다: 줄에 비용·재화의 수치가 없다.
    expect(at(w, 'eff-rows').text()).not.toMatch(/재화|비용|골드|크레딧/);
    expect(at(w, 'lab-conditions').findAll('[data-testid="caveat-item"]')[0].text()).toMatch(/^비용은 모른다/);
  });

  it('니케 한 명만 골라 볼 수 있다 — 고르면 앞의 표는 「바꾸기 전」이고, 다시 계산하면 캐시에서 바로 나온다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    await press(w, 'eff-run');
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    expect(at(w, 'eff-run').text()).toBe('다시 계산');

    await named(w, 'eff-only', '헬름').trigger('click');
    expect(at(w, 'eff-panel').attributes('data-fresh')).toBe('no');
    expect(at(w, 'eff-stale').text()).toContain('아래 표는 바꾸기 전의 것이다');
    expect(at(w, 'eff-run').text()).toBe('효율표 계산');
    const helm = upgradeCandidates({ account: sampleAccount, members: DECK, catalog, only: '헬름' });
    expect(at(w, 'eff-run').attributes('title')).toBe(`한 단계 올릴 수 있는 것 ${helm.candidates.length}개를 하나씩 계산한다`);
    await press(w, 'eff-run');
    // 헬름의 후보는 편성 전체를 볼 때 이미 계산했다 — 엔진을 다시 부르지 않는다.
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    expect(at(w, 'eff-reused').text()).toBe('앞서 계산해 둔 결과를 바로 가져왔다.');
    const expected = await expectedTable(sampleAccount, DECK, '헬름');
    expect(all(w, 'eff-row').map((r) => r.attributes('data-id'))).toEqual(expected.rows.map((r) => r.id));
    expect(all(w, 'eff-row').every((r) => r.attributes('data-nikke') === '헬름')).toBe(true);
    expect(at(w, 'eff-count').text()).toBe(`한 단계씩 올려 본 것 ${helm.candidates.length}개 — 총딜이 많이 느는 순서`);

    // 상대를 바꿔도 다른 계산이다.
    await at(w, 'growth-lab').findAll('[data-testid="opponent-option"]').find((o) => o.attributes('data-key') === 'element:작열')!.trigger('click');
    expect(at(w, 'eff-stale').exists()).toBe(true);
    await press(w, 'eff-run');
    expect(api.engineRunBatch).toHaveBeenCalledTimes(2);
  });

  it('상한(60개)을 넘는 것과 계산하지 못한 것은 접지 않고 적는다 — 올릴 것이 없는 니케는 그렇게 말한다', async () => {
    disk.addAccount('me', largeAccount);
    // 덜 키운 니케 다섯: 후보가 한 명에 13개(스킬 셋 · 돌파 · 오버로드 9줄)라 다섯이면 상한을 넘는다.
    const low = Object.entries(largeAccount.nikkes as Record<string, { breakthrough?: number; core_enhancement?: number; overload?: unknown }>)
      .filter(([, e]) => (e.breakthrough ?? 0) < 3 && e.overload === undefined)
      .map(([name]) => name)
      .slice(0, 5);
    expect(low).toHaveLength(5);
    rememberDeck(low);
    // 첫 니케의 돌파를 올린 요청은 계산하지 못하는 엔진.
    const before = (largeAccount.nikkes as Record<string, { breakthrough?: number }>)[low[0]].breakthrough ?? 0;
    api.engineRunBatch.mockImplementation(async (requests) =>
      requests.map((r) => {
        const entry = (r.profile as { chars: Record<string, { breakthrough?: number }> }).chars[low[0]];
        return entry.breakthrough === before + 1 ? { error: { type: 'invalid_input', message: '가짜 엔진 오류', path: '/profile' } } : engineRow(r);
      }),
    );
    const w = await render();
    await openLab(w);
    const made = upgradeCandidates({ account: largeAccount, members: low, catalog });
    expect(made.candidates.length).toBeGreaterThan(60);
    const over = made.candidates.length - 60;
    expect(at(w, 'eff-run').attributes('title')).toBe(`한 단계 올릴 수 있는 것 60개를 하나씩 계산한다 (${over}개는 한 번에 보는 수를 넘어 보지 않는다)`);
    await press(w, 'eff-run');
    expect((api.engineRunBatch.mock.calls[0][0] as EngineRequest[]).length).toBe(61);
    expect(all(w, 'eff-row')).toHaveLength(59);

    const skipped = at(w, 'eff-skipped');
    expect(skipped.text().replace(/\s+/g, ' ')).toContain(`한 번에 60개까지만 계산한다. 올릴 수 있는 ${made.candidates.length}개 가운데 ${over}개는 보지 못했다`);
    expect(all(w, 'eff-skipped-item')).toHaveLength(over);
    expect(skipped.element.closest('details')).toBeNull();
    const failed = at(w, 'eff-failed');
    expect(failed.text().replace(/\s+/g, ' ')).toBe(`계산하지 못한 것 1개(0으로 치지 않고 뺐다): ${low[0]} 돌파 — 가짜 엔진 오류`);
    expect(failed.element.closest('details')).toBeNull();
    expect(all(w, 'eff-row').some((r) => r.attributes('data-nikke') === low[0] && r.attributes('data-kind') === 'breakthrough')).toBe(false);

    // 전부 최대로 키운 니케만 고르면 계산할 것이 없다(단추가 꺼지고 까닭이 보인다).
    const maxed = { ...sampleAccount, nikkes: { ...sampleAccount.nikkes, '리틀 머메이드': { skill_levels: [10, 10, 10], breakthrough: 3, core_enhancement: 7, collection_stage: 'SR15', overload: { 공격력: 4, '우월 코드 대미지': 4, '최대 장탄 수': 4 } } } };
    disk.addAccount('sub', maxed);
    disk.chosen = 'sub';
    disk.emit();
    rememberDeck(DECK);
    w.unmount();
    const again = await render();
    await openLab(again);
    await named(again, 'eff-only', '리틀 머메이드').trigger('click');
    expect(at(again, 'eff-run').attributes('disabled')).toBeDefined();
    expect(at(again, 'eff-hint').text()).toContain('한 단계 올릴 수 있는 칸이 없다.');
  });
});

// ── 오버로드 옵션 바꿔 보기 ────────────────────────────────────────────────────

describe('오버로드 옵션 바꿔 보기', () => {
  const partNames = (w: Wrapper) => all(w, 'ol-part').map((p) => p.attributes('data-part'));
  const optionValues = (w: Wrapper) => all(w, 'ol-part').map((p) => p.findAll('[data-testid="ol-option"]').map((s) => (s.element as HTMLSelectElement).value));

  it('니케 한 명의 부위별 옵션 줄을 바꿔 총딜 변화를 본다 — 계정은 바뀌지 않는다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const snapshot = JSON.stringify(sampleAccount);
    const w = await render();
    await openLab(w);
    await named(w, 'ol-nikke', '헬름').trigger('click');
    // 부위 넷 × 줄 셋. 계정의 줄(공격력 2줄 · 우월 코드 2줄)이 차례로 놓여 있다 — 같은 옵션은 서로 다른 부위에.
    expect(partNames(w)).toEqual(['머리', '몸통', '팔', '다리']);
    expect(optionValues(w)).toEqual([['atk_pct', 'element_bonus', ''], ['atk_pct', 'element_bonus', ''], ['', '', ''], ['', '', '']]);
    // 고를 수 있는 옵션은 계산 도구가 받는 9종과 빈 줄이다.
    const choices = all(w, 'ol-option')[0].findAll('option').map((o) => o.text());
    expect(choices).toEqual(['빈 줄', '공격력', '우월 코드 대미지', '최대 장탄 수', '크리티컬 확률', '크리티컬 대미지', '차지 속도', '차지 대미지', '명중률', '방어력']);
    expect(at(w, 'ol-before').text()).toBe('공격력 2줄 · 우월 코드 대미지 2줄');
    expect(at(w, 'ol-after').text()).toBe('공격력 2줄 · 우월 코드 대미지 2줄');
    expect(at(w, 'ol-reset').attributes('disabled')).toBeDefined();
    expect(at(w, 'ol-help').text()).toContain('계정은 바뀌지 않는다 — 여기서만 바꿔 본다.');
    expect(at(w, 'ol-help').text()).toContain('어느 부위에 어느 옵션이 붙었는지는 계정 정보에 없어');

    // 팔의 첫 줄에 공격력(레벨 15), 몸통의 우월 코드를 크리티컬 대미지로.
    const parts = () => all(w, 'ol-part');
    await parts()[2].findAll('[data-testid="ol-option"]')[0].setValue('atk_pct');
    await parts()[2].findAll('[data-testid="ol-level"]')[0].setValue('15');
    await parts()[1].findAll('[data-testid="ol-option"]')[1].setValue('crit_dmg');
    expect(at(w, 'ol-after').text()).toBe('공격력 3줄 · 우월 코드 대미지 1줄 · 크리티컬 대미지 1줄');
    expect(at(w, 'ol-count').text()).toBe('(5줄)');
    expect(at(w, 'ol-reset').attributes('disabled')).toBeUndefined();
    await press(w, 'ol-run');

    // 엔진에 간 것: 기준과 바꾼 것 두 건. 헬름의 옵션 9종이 모두 실린다.
    const sent = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(sent).toHaveLength(2);
    const helm = (r: EngineRequest) => (r.profile as { chars: Record<string, { overload: Record<string, unknown> }> }).chars.헬름.overload;
    expect(helm(sent[1])).toEqual({ 공격력: [15, 10, 10], '우월 코드 대미지': [10], '최대 장탄 수': [], '크리티컬 확률': [], '크리티컬 대미지': [10], '차지 속도': [], '차지 대미지': [], 명중률: [], 방어력: [] });
    expect(helm(sent[0]).공격력).toBe(2);

    const wanted: OverloadPart[] = [
      { part: '머리', lines: [{ id: 'atk_pct', level: 10 }, { id: 'element_bonus', level: 10 }, null] },
      { part: '몸통', lines: [{ id: 'atk_pct', level: 10 }, { id: 'crit_dmg', level: 10 }, null] },
      { part: '팔', lines: [{ id: 'atk_pct', level: 15 }, null, null] },
      { part: '다리', lines: [null, null, null] },
    ];
    const expected = (await tryOverload({ account: sampleAccount, opponent: kraken, members: DECK, nikke: '헬름', parts: wanted }, coreDeps)) as unknown as OverloadTrialReport;
    expect(expected.status).toBe('computed');
    const result = at(w, 'ol-result');
    expect(result.attributes('data-status')).toBe('computed');
    expect(result.attributes('data-fresh')).toBe('yes');
    expect(at(w, 'ol-total').text()).toBe(`${damageUnit(expected.total_before)} → ${damageUnit(expected.total_after)}`);
    expect(at(w, 'ol-change').text()).toBe(signedPercent(expected.gain_rate));
    expect(expected.gain).toBeGreaterThan(0);
    expect(at(w, 'ol-what').text()).toBe('공격력 2줄 · 우월 코드 대미지 2줄 → 공격력 3줄 · 우월 코드 대미지 1줄 · 크리티컬 대미지 1줄');
    expect(result.find('[data-testid="status-pill"]').text()).toBe('추정');
    // 계정은 그대로다: 디스크의 계정이 바뀌지 않았고, 화면이 넘긴 계정도 그대로다.
    expect(JSON.stringify(disk.accounts.get('me')!.doc)).toBe(snapshot);
    expect(JSON.stringify(sampleAccount)).toBe(snapshot);
    expect(at(w, 'lab-conditions').findAll('[data-testid="caveat-item"]')[0].text()).toBe('계정은 바뀌지 않는다 — 여기서만 바꿔 본 값이다.');

    // 옵션을 또 바꾸면 앞의 숫자는 「바꾸기 전」이다. 되돌리면 계정 값으로 돌아온다.
    await parts()[3].findAll('[data-testid="ol-option"]')[0].setValue('max_ammo_pct');
    expect(at(w, 'ol-result').attributes('data-fresh')).toBe('no');
    expect(at(w, 'ol-stale').text()).toContain('아래 숫자는 바꾸기 전의 것이다');
    await at(w, 'ol-reset').trigger('click');
    expect(optionValues(w)).toEqual([['atk_pct', 'element_bonus', ''], ['atk_pct', 'element_bonus', ''], ['', '', ''], ['', '', '']]);
    expect((all(w, 'ol-level')[0].element as HTMLSelectElement).value).toBe('10');
  });

  it('그대로 계산하면 「달라지는 것이 없다」, 같은 부위의 같은 옵션은 알리고, 계산하지 못하면 0이 아니라 그렇게 말한다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    await named(w, 'ol-nikke', '헬름').trigger('click');
    await press(w, 'ol-run');
    expect(at(w, 'ol-result').attributes('data-status')).toBe('same');
    expect(at(w, 'ol-same').text()).toMatch(/^지금 계정의 옵션과 같다 — 달라지는 것이 없다\(.+\)\.$/);
    expect(at(w, 'ol-change').exists()).toBe(false);

    // 머리의 셋째 줄에도 공격력: 같은 부위에 같은 옵션이 두 줄 — 막지 않고 알린다.
    await all(w, 'ol-part')[0].findAll('[data-testid="ol-option"]')[2].setValue('atk_pct');
    expect(at(w, 'ol-note').text()).toBe('머리에 공격력 옵션이 두 줄 이상이다 — 게임에서 되는 조합인지 이 앱은 확인하지 못했다. 계산은 그대로 한다.');
    expect(at(w, 'ol-run').attributes('disabled')).toBeUndefined();

    // 바꾼 것(헬름의 공격력이 세 줄인 요청)만 계산하지 못하는 엔진. 기준은 앞서 계산해 둔 것이 쓰인다.
    api.engineRunBatch.mockImplementation(async (requests) =>
      requests.map((r) => {
        const atk = (r.profile as { chars: Record<string, { overload: Record<string, unknown> }> }).chars.헬름.overload.공격력;
        return Array.isArray(atk) && atk.length === 3 ? { error: { type: 'invalid_input', message: '가짜 엔진 오류', path: '/profile' } } : engineRow(r);
      }),
    );
    await press(w, 'ol-run');
    expect(at(w, 'ol-result').attributes('data-status')).toBe('failed');
    expect(at(w, 'ol-failed').text().replace(/\s+/g, ' ')).toBe('계산하지 못함 이 옵션으로는 계산하지 못했다(0으로 치지 않는다). 가짜 엔진 오류');
    expect(at(w, 'ol-total').exists()).toBe(false);
  });

  it('오버로드가 미확인인 니케는 빈 줄에서 시작하고 그렇게 알린다 — 니케를 바꾸면 그 니케의 계정 값으로 바뀐다', async () => {
    disk.addAccount('me', sampleAccount);
    const deck = [...DECK.slice(0, 4), '미하라'];
    rememberDeck(deck);
    const w = await render();
    await openLab(w);
    // 처음에는 첫 자리의 니케.
    expect(named(w, 'ol-nikke', '리틀 머메이드').attributes('aria-checked')).toBe('true');
    expect(at(w, 'ol-before').text()).toBe('공격력 3줄 · 우월 코드 대미지 2줄');
    await named(w, 'ol-nikke', '미하라').trigger('click');
    expect(at(w, 'ol-unknown').text().replace(/\s+/g, ' ')).toContain('미확인 미하라의 오버로드는 계정에서 확인하지 못했다 — 빈 줄에서 시작하고');
    expect(at(w, 'ol-unknown').element.closest('details')).toBeNull();
    expect(at(w, 'ol-before').text()).toBe('옵션 없음');
    expect(optionValues(w).flat().every((v) => v === '')).toBe(true);
    // 빈 줄의 레벨 칸은 꺼져 있다.
    expect(all(w, 'ol-level').every((s) => s.attributes('disabled') !== undefined)).toBe(true);
    await all(w, 'ol-part')[0].findAll('[data-testid="ol-option"]')[0].setValue('atk_pct');
    await press(w, 'ol-run');
    expect(at(w, 'ol-result').attributes('data-status')).toBe('computed');
    expect(texts(w, 'ol-result-note').join('\n')).toMatch(/적용 전 값이 미확인이라 미육성으로 계산했다/);
    // 다른 니케를 고르면 그 니케의 결과가 아니므로 숫자를 내린다.
    await named(w, 'ol-nikke', '헬름').trigger('click');
    expect(at(w, 'ol-result').exists()).toBe(false);
    expect(at(w, 'ol-before').text()).toBe('공격력 2줄 · 우월 코드 대미지 2줄');
  });

  it('오버로드가 합산 수치로만 적힌 니케는 바꿔 볼 수 없다고 말한다(지원하지 않음)', async () => {
    const account = { ...sampleAccount, nikkes: { ...sampleAccount.nikkes, 헬름: { skill_levels: [7, 7, 10], breakthrough: 3, equip_skills: { atk_pct: 22.22 } } } };
    disk.addAccount('me', account);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    await named(w, 'ol-nikke', '헬름').trigger('click');
    expect(at(w, 'ol-unsupported').text().replace(/\s+/g, ' ')).toBe('지원하지 않음 오버로드가 옵션별 합산 수치로만 적혀 있어 줄 단위로 바꿔 볼 수 없다(지원하지 않음). 계정을 새로 받으면 줄 단위로 적힐 수 있다.');
    expect(at(w, 'ol-editor').exists()).toBe(false);
    expect(at(w, 'ol-run').attributes('disabled')).toBeDefined();
  });
});

// ── 큐브 ──────────────────────────────────────────────────────────────────────

describe('큐브 바꿔 보기', () => {
  const cubes = cubeList(catalog) as { supported: { name: string }[]; unsupported: { name: string }[] };
  const expectedCubes = (members: string[], only: string | null = null) =>
    compareCubes({ account: sampleAccount as object, opponent: kraken, members }, { only }, coreDeps) as unknown as Promise<CubeReport>;

  it('큐브를 어떻게 계산하는지와 한계(보유 큐브를 모른다 · 지원하지 않는 큐브)가 계산 전에도 보인다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    const help = at(w, 'cube-help').text();
    expect(help).toContain('계산 도구는 니케마다 큐브를 바꿔 계산할 수 있다.');
    expect(help).toContain('기본 큐브(렐릭 베어 큐브 Lv.15)를 낀 것으로 계산한다');
    expect(help).toContain('계정 정보에는 계정을 받을 때 끼고 있던 큐브만 있다 — 추천한 큐브를 갖고 있는지, 몇 레벨인지는 이 앱이 모른다.');
    expect(at(w, 'cube-help').element.closest('details')).toBeNull();
    expect(cubes.unsupported.length).toBeGreaterThan(0);
    const pill = at(w, 'cube-unsupported-pill');
    expect(pill.text()).toBe(`지원하지 않는 큐브 ${cubes.unsupported.length}종`);
    expect(pill.attributes('title')).toBe(`계산 도구가 효과를 계산하지 못해 견주지 않는다: ${cubes.unsupported.map((c) => c.name).join(', ')}`);
    const count = (cubes.supported.length - 1) * 5;
    expect(help).toContain(`큐브를 하나씩 바꿔 끼워 ${count}번 계산한다.`);
    expect(at(w, 'cube-run').attributes('title')).toBe(`큐브를 하나씩 바꿔 끼워 ${count}번 계산한다`);
  });

  it('니케 한 명의 큐브를 바꿔 본 총딜을 큰 순으로 보이고, 가장 좋은 큐브를 추천한다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    await named(w, 'cube-only', '헬름').trigger('click');
    await press(w, 'cube-run');
    // 엔진에 간 것: 기준 1건 + 헬름에게 끼워 본 큐브 수(지금 큐브와 지원하지 않는 큐브는 뺀다).
    const sent = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(sent).toHaveLength(cubes.supported.length);
    const worn = sent.slice(1).map((r) => (r.profile as { chars: Record<string, { cube?: { name: string; level: number } }> }).chars.헬름.cube);
    expect(worn.map((c) => c?.name)).toEqual(cubes.supported.map((c) => c.name).filter((n) => n !== '렐릭 베어 큐브'));
    expect(worn.every((c) => c?.level === 15)).toBe(true);
    expect((sent[0].profile as { chars: Record<string, { cube?: unknown }> }).chars.헬름.cube).toBeUndefined();

    const expected = await expectedCubes(DECK, '헬름');
    const block = at(w, 'cube-nikke');
    expect(block.attributes('data-nikke')).toBe('헬름');
    expect(at(w, 'cube-current').text()).toBe('지금 렐릭 베어 큐브 Lv.15 — 계정에 적혀 있지 않아 계산 도구의 기본 큐브로 계산했다');
    const rows = all(w, 'cube-row');
    expect(rows.map((r) => r.attributes('data-cube'))).toEqual(expected.nikkes[0].rows.map((r) => r.cube));
    expect(texts(w, 'cube-row-change')).toEqual(expected.nikkes[0].rows.map((r) => signedPercent(r.change)));
    expect(texts(w, 'cube-row-total')).toEqual(expected.nikkes[0].rows.map((r) => damageUnit(r.total_damage)));
    const totals = expected.nikkes[0].rows.map((r) => r.total_damage);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    // 앞의 셋만 펼쳐 있고 나머지는 접혀 있다.
    expect(rows.filter((r) => r.element.closest('details') === null)).toHaveLength(3);
    expect(at(w, 'cube-more').find('[data-testid="details-fold-count"]').text()).toBe(String(rows.length - 3));

    // 「이 편성에 맞는 큐브」: 가장 좋았던 큐브. 보유 여부를 모른다는 표시가 접힌 구획 밖에 있다.
    const rec = at(w, 'cube-rec');
    expect(rec.attributes('data-status')).toBe(expected.recommendation.status);
    expect(expected.nikkes[0].best).not.toBeNull();
    expect(at(w, 'cube-pick').attributes('data-changed')).toBe('yes');
    expect(at(w, 'cube-pick-name').text()).toBe(expected.nikkes[0].best!.cube);
    expect(at(w, 'cube-pick-change').text()).toBe(`혼자 바꾸면 ${signedPercent(expected.nikkes[0].best!.change)}`);
    expect(at(w, 'cube-together').text().replace(/\s+/g, ' ')).toBe(
      `함께 끼우면 총딜 ${signedPercent(expected.recommendation.gain_rate)} (${damageUnit(expected.baseline.total_damage)} → ${damageUnit(expected.recommendation.total_damage)})`,
    );
    expect(at(w, 'cube-owned-unknown').text()).toBe('보유 여부 모름');
    expect(at(w, 'cube-owned-unknown').element.closest('details')).toBeNull();
    expect(at(w, 'cube-unsupported').text().replace(/\s+/g, ' ')).toBe(`지원하지 않음 ${cubes.unsupported.map((c) => c.name).join(', ')} — 계산 도구가 효과를 계산하지 못하는 큐브라 견주지 않았다.`);
    expect(at(w, 'cube-unsupported').element.closest('details')).toBeNull();
    expect(at(w, 'lab-conditions').findAll('[data-testid="caveat-item"]')[0].text()).toMatch(/^보유 큐브는 모른다/);
  });

  it('편성 전체: 니케마다 가장 좋았던 큐브를 함께 끼운 총딜을 한 번 더 계산해 보인다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    await press(w, 'cube-run');
    const expected = await expectedCubes(DECK);
    // 첫 배치: 기준 + 다섯 명 × 바꿔 볼 큐브. 추천이 둘 이상 바뀌면 함께 끼운 것 한 건이 더 간다(기준은 캐시).
    const first = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(first).toHaveLength(1 + 5 * (cubes.supported.length - 1));
    const changed = expected.recommendation.picks.filter((p) => p.changed);
    expect(changed.length).toBeGreaterThan(1);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(2);
    const second = api.engineRunBatch.mock.calls[1][0] as EngineRequest[];
    expect(second).toHaveLength(1);
    const chars = (second[0].profile as { chars: Record<string, { cube?: { name: string } }> }).chars;
    for (const p of expected.recommendation.picks) expect(chars[p.nikke].cube?.name, p.nikke).toBe(p.changed ? p.cube : undefined);

    expect(all(w, 'cube-nikke').map((n) => n.attributes('data-nikke'))).toEqual(DECK);
    const picks = all(w, 'cube-pick');
    expect(picks.map((p) => p.attributes('data-nikke'))).toEqual(DECK);
    expect(texts(w, 'cube-pick-name')).toEqual(expected.recommendation.picks.map((p) => p.cube));
    expect(picks.map((p) => p.attributes('data-changed'))).toEqual(expected.recommendation.picks.map((p) => (p.changed ? 'yes' : 'no')));
    expect(expected.recommendation.status).toBe('computed');
    expect(at(w, 'cube-together').text().replace(/\s+/g, ' ')).toBe(
      `함께 끼우면 총딜 ${signedPercent(expected.recommendation.gain_rate)} (${damageUnit(expected.baseline.total_damage)} → ${damageUnit(expected.recommendation.total_damage)})`,
    );
    expect(at(w, 'cube-skipped').exists()).toBe(false);
    // 다시 누르면 전부 캐시다.
    await press(w, 'cube-run');
    expect(api.engineRunBatch).toHaveBeenCalledTimes(2);
  });

  it('계산하지 못한 큐브는 0이 아니라 빠지고, 큐브 목록을 읽지 못하면 바꿔 볼 수 없다고 말한다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const broken = cubes.supported.map((c) => c.name).find((n) => n !== '렐릭 베어 큐브')!;
    api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => engineRow(r, broken)));
    const w = await render();
    await openLab(w);
    await named(w, 'cube-only', '헬름').trigger('click');
    await press(w, 'cube-run');
    expect(at(w, 'cube-failed').text().replace(/\s+/g, ' ')).toBe(`계산하지 못한 것 1건(0으로 치지 않고 뺐다): 헬름 ${broken} — 가짜 엔진 오류: ${broken}`);
    expect(at(w, 'cube-failed').element.closest('details')).toBeNull();
    expect(all(w, 'cube-row').some((r) => r.attributes('data-cube') === broken)).toBe(false);
    w.unmount();

    // 큐브 목록이 없는 카탈로그(큐브 표를 읽지 못했다).
    clearNikkeCatalog();
    api.engineCatalog.mockResolvedValue({ nikkes: catalog.nikkes, bosses: catalog.bosses, cubes: null });
    const again = await render();
    await openLab(again);
    expect(at(again, 'cube-unknown').text()).toBe('큐브 목록을 읽지 못해 큐브를 바꿔 볼 수 없다. 설정의 계산 도구에서 문제를 확인한다.');
    expect(at(again, 'cube-run').attributes('disabled')).toBeDefined();
    expect(at(again, 'cube-run').attributes('title')).toBe('큐브 목록을 읽지 못해 큐브를 바꿔 볼 수 없다');
    // 효율표는 큐브 목록과 무관하게 계산할 수 있다.
    expect(at(again, 'eff-run').attributes('disabled')).toBeUndefined();
  });
});

// ── 진행 · 중단 · 오류 ─────────────────────────────────────────────────────────

describe('진행 표시 · 중단 · 오류', () => {
  it('계산 중에는 진행 패널과 메뉴의 「계산 중」이 뜨고 단추가 꺼진다 — 다른 탭에 다녀와도 결과가 남는다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    let release: () => void = () => {};
    const w = await render();
    await openLab(w);
    await named(w, 'eff-only', '헬름').trigger('click');
    api.engineRunBatch.mockImplementationOnce((requests) => new Promise((resolve) => (release = () => resolve(requests.map((r) => engineRow(r))))));
    await at(w, 'eff-run').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(api.engineRunBatch).toHaveBeenCalledTimes(1));
    await flushPromises();
    expect(at(w, 'nav-tools').find('[data-testid="nav-busy"]').exists()).toBe(true);
    const panel = at(w, 'progress-panel');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain('한 단계씩 올려 보는 중');
    for (const id of ['eff-run', 'ol-run', 'cube-run', 'lab-source-deck']) expect(at(w, id).attributes('disabled'), id).toBeDefined();
    expect(all(w, 'ol-part').every((p) => p.attributes('disabled') !== undefined)).toBe(true);
    // 다른 탭을 봐도 계산은 이어진다.
    await at(w, 'tool-suggest').trigger('click');
    await openPage(w, 'home');
    release();
    await idle(w);
    await openPage(w, 'tools');
    await at(w, 'tool-efficiency').trigger('click');
    expect(all(w, 'eff-row').length).toBeGreaterThan(0);
    expect(at(w, 'progress-panel').exists()).toBe(false);
    expect(named(w, 'eff-only', '헬름').attributes('aria-checked')).toBe('true');
  });

  it('중단하면 결과도 오류도 아닌 「중단했다」가 보이고 앞의 결과는 그대로다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    const w = await render();
    await openLab(w);
    await named(w, 'eff-only', '헬름').trigger('click');
    await press(w, 'eff-run');
    const before = all(w, 'eff-row').map((r) => r.attributes('data-id'));

    await named(w, 'cube-only', '헬름').trigger('click');
    let fail: (reason: unknown) => void = () => {};
    api.engineRunBatch.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    api.engineCancel.mockImplementation(async () => {
      fail('중단됨');
      return true;
    });
    await at(w, 'cube-run').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(api.engineRunBatch).toHaveBeenCalledTimes(2));
    await flushPromises();
    expect(at(w, 'progress-panel').text()).toContain('큐브를 바꿔 끼워 보는 중');
    await at(w, 'progress-panel').find('button').trigger('click');
    await idle(w);
    expect(api.engineCancel).toHaveBeenCalled();
    expect(at(w, 'stopped-note').text()).toBe('계산을 중단했다. 앞서 보이던 결과는 그대로다.');
    expect(at(w, 'lab-error').exists()).toBe(false);
    expect(at(w, 'cube-board').exists()).toBe(false);
    expect(all(w, 'eff-row').map((r) => r.attributes('data-id'))).toEqual(before);
  });

  it('계산 도구가 통째로 실패하면 무슨 일이 있었고 무엇을 하면 되는지 말한다', async () => {
    disk.addAccount('me', sampleAccount);
    rememberDeck(DECK);
    api.engineRunBatch.mockRejectedValue('계산 도구를 실행하지 못했다');
    const w = await render();
    await openLab(w);
    await press(w, 'eff-run');
    expect(at(w, 'lab-error').text()).toBe('효율표를 계산하지 못했다. 실행 오류 — 계산 도구를 실행하지 못했다 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.');
    expect(at(w, 'eff-board').exists()).toBe(false);
    await press(w, 'cube-run');
    expect(at(w, 'lab-error').text()).toMatch(/^큐브를 견주지 못했다\. 실행 오류 — /);
  });
});
