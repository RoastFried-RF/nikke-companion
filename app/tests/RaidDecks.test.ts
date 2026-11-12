// 레이드 5덱(P-014)의 화면: 편성 도구의 「레이드 5덱」 탭 — 상대(하나 또는 덱마다), 덱 다섯의 초상화 줄, 덱별 총딜 막대와 합계,
// 쓰지 않은 보유 니케, 덱 고정, 진행 표시·중단, 덱 빌더에서 열기.
// 규칙 자체는 루트의 단위 테스트(tests/unit/union.test.mjs)가, 실제 엔진으로는 tests/integration/union.engine.test.mjs가 본다.
// Rust 쪽(backend)은 가짜다: 계정 폴더는 가짜 디스크, 엔진은 멤버와 자리에서 정해지는 값을 낸다.
// 계정은 검증용 샘플(data/samples/)뿐이다 — 실제 계정은 쓰지 않는다.
import { resolveOpponent as coreResolveOpponent } from '@core/deck.mjs';
import { allocateDecks, DEFAULT_UNION_BUDGET } from '@core/union.mjs';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bundle from '../../data/intercept/anomaly.json';
import largeAccount from '../../data/samples/account.large.sample.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { damageUnit } from '../src/lib/format';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { simCache } from '../src/lib/runtime';
import type { EngineRequest, PlanDoc, RaidDecksReport } from '../src/types';
import source from '../src/views/RaidDecks.vue?raw';
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
const raid = (w: Wrapper) => at(w, 'raid-decks');
const deckRows = (w: Wrapper) => all(w, 'raid-deck');
const deckRow = (w: Wrapper, n: number) => deckRows(w).find((d) => d.attributes('data-deck') === String(n))!;
const membersOf = (row: ReturnType<typeof deckRow>) => row.findAll('[data-testid="raid-member"]').map((m) => m.attributes('data-name')!);
const outsideFold = (el: Element | undefined) => el !== undefined && el.closest('details') === null;

const PRESET = 'preset:솔로 레이드 S40';
const sources = { bundle, catalog };
const conditionOf = (key: string) => coreResolveOpponent(key, sources)!.condition;
/** 화면이 거치는 것과 같은 계산을 루트의 함수로 바로 한 것(기대값). */
const coreDeps = { catalog, runBatch: async (requests: EngineRequest[]) => requests.map((r) => fakeRow(r)) };
const expected = (account: unknown, condition: unknown, options: Record<string, unknown> = {}) =>
  allocateDecks({ account: account as object, condition: condition as object }, { decks: 5, budget: DEFAULT_UNION_BUDGET, ...options }, coreDeps) as unknown as Promise<RaidDecksReport>;

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

/** 편성 도구의 레이드 5덱 탭을 연다. */
async function openRaid(w: Wrapper): Promise<void> {
  await openPage(w, 'tools');
  await at(w, 'tool-raid').trigger('click');
  await flushPromises();
}

async function find(w: Wrapper): Promise<void> {
  await at(w, 'raid-run').trigger('click');
  await idle(w);
}

async function chooseOpponent(w: Wrapper, key: string): Promise<void> {
  await raid(w).findAll('[data-testid="opponent-option"]').find((o) => o.attributes('data-key') === key)!.trigger('click');
  await flushPromises();
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
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r)));
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

describe('레이드 5덱 — 탭과 상대', () => {
  it('편성 도구에 「레이드 5덱」 탭이 있다 — 계정이 없으면 계정 연결을 안내한다', async () => {
    const w = await render();
    await openRaid(w);
    expect(at(w, 'tool-raid').text()).toBe('레이드 5덱');
    expect(at(w, 'tool-raid').attributes('aria-selected')).toBe('true');
    expect(localStorage.getItem('nikke-companion.tools.tab')).toBe('raid');
    expect(at(w, 'raid-need-account').find('[data-testid="empty-title"]').text()).toBe('아직 계정을 연결하지 않았다');
    await at(w, 'raid-need-account').find('[data-testid="empty-action"]').trigger('click');
    expect(currentPage(w)).toBe('settings');
  });

  it('처음에는 상대 하나(계산 도구에 든 솔로 레이드 보스)에 다섯 덱이다 — 찾기 전에는 결과가 없다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    expect(at(w, 'raid-mode-single').attributes('aria-checked')).toBe('true');
    expect(raid(w).find('[data-testid="opponent-name"]').text()).toBe('상대 솔로 레이드 S40');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'raid-run').text()).toBe('5덱 찾기');
    expect(at(w, 'raid-run').attributes('disabled')).toBeUndefined();
    expect(at(w, 'raid-result').exists()).toBe(false);
    expect(at(w, 'raid-precision-normal').attributes('aria-checked')).toBe('true');
  });

  it('프리셋이 없는 보스는 속성만 정한다 — 「미확인 값 N칸」이 접힌 구획 밖에 붙는다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await chooseOpponent(w, 'element:풍압');
    const opponent = coreResolveOpponent('element:풍압', sources)!;
    const pill = raid(w).find('[data-testid="opponent-unconfirmed"]');
    expect(pill.text()).toBe(`미확인 값 ${opponent.unconfirmed.length}칸`);
    expect(opponent.unconfirmed.length).toBeGreaterThan(0);
    expect(outsideFold(pill.element)).toBe(true);
    expect(at(w, 'raid-target-help').text()).toContain('이번 시즌의 보스가 목록에 없으면 「속성만 정하기」에서 약점 속성을 고른다');

    await find(w);
    const report = await expected(largeAccount, opponent.condition);
    expect(deckRows(w).map(membersOf)).toEqual(report.decks.map((d) => d.members.map((m) => m.name)));
    // 약점 속성(풍압) 니케에는 테두리가 있다.
    const weak = report.decks.flatMap((d) => d.members.map((m) => m.name)).filter((n) => catalog.nikkes[n].element_code === '풍압');
    expect(weak.length).toBeGreaterThan(0);
    for (const m of all(w, 'raid-member')) expect(m.classes().some((c) => c.includes('weak')), m.attributes('data-name')).toBe(weak.includes(m.attributes('data-name')!));
    // 접어 둔 계산 조건에 미확인 칸의 내용이 있다.
    const fold = at(w, 'raid-conditions');
    expect(fold.element.tagName).toBe('DETAILS');
    expect(fold.findAll('[data-testid="unconfirmed-item"]').map((li) => li.text())).toEqual(opponent.unconfirmed.map((u) => `미확인 값 — ${u.label}: ${u.text}`));
    // 고른 상대는 다음에도 기억한다.
    expect(localStorage.getItem('nikke-companion.raid.opponent')).toBe('element:풍압');
  });
});

describe('레이드 5덱 — 결과', () => {
  it('덱 다섯의 초상화 줄 · 덱별 총딜 막대 · 합계 · 쓰지 않은 보유 니케가 계산 코드의 결과 그대로 보인다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await find(w);
    const report = await expected(largeAccount, conditionOf(PRESET));
    expect(report.made).toBe(5);

    const rows = deckRows(w);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.find('[data-testid="raid-deck-no"]').text())).toEqual(['덱 1', '덱 2', '덱 3', '덱 4', '덱 5']);
    expect(rows.map(membersOf)).toEqual(report.decks.map((d) => d.members.map((m) => m.name)));
    // 어떤 니케도 두 덱에 없다.
    const names = rows.flatMap(membersOf);
    expect(names).toHaveLength(25);
    expect(new Set(names).size).toBe(25);
    expect(names.every((n) => Object.hasOwn(largeAccount.nikkes, n))).toBe(true);
    // 덱별 총딜과 막대(가장 센 덱이 가득), 합계에서의 몫.
    expect(rows.map((r) => r.find('[data-testid="raid-deck-total"]').text())).toEqual(report.decks.map((d) => damageUnit(d.total_damage)));
    const best = Math.max(...report.decks.map((d) => d.total_damage!));
    rows.forEach((r, i) => {
      const fill = r.find('[data-testid="raid-deck-bar"]').find('[style]');
      expect(fill.attributes('style'), `덱 ${i + 1}`).toContain(`${Math.min(1, report.decks[i].total_damage! / best) * 100}%`);
      expect(r.find('[data-testid="raid-deck-part"]').text()).toBe(`합계의 ${Math.round((report.decks[i].total_damage! / report.total_damage) * 100)}%`);
    });
    expect(at(w, 'raid-total').text()).toBe(damageUnit(report.total_damage));
    expect(at(w, 'raid-sum').text()).toContain('덱 5개의 합계');
    // 쓰지 않은 보유 니케.
    expect(at(w, 'raid-unused-head').text()).toBe(`쓰지 않은 보유 니케 ${report.unused.length}명`);
    expect(all(w, 'raid-unused-item').map((li) => li.attributes('data-name'))).toEqual(report.unused);
    expect(report.unused).toHaveLength(Object.keys(largeAccount.nikkes).length - 25);
    expect(at(w, 'raid-shortage').exists()).toBe(false);
    expect(at(w, 'raid-result').attributes('data-fresh')).toBe('yes');
    expect(at(w, 'raid-run').text()).toBe('다시 찾기');
    // 계산 도구에 넘어간 편성은 모두 이 계정의 니케 다섯이고, 건수는 계산 횟수의 상한 이하다.
    const sent = api.engineRunBatch.mock.calls.flatMap(([requests]) => requests as EngineRequest[]);
    expect(sent.length).toBeLessThanOrEqual(DEFAULT_UNION_BUDGET);
    expect(sent.length).toBe(report.search.sims);
    expect(sent.every((r) => (r.squad as string[]).length === 5)).toBe(true);
  });

  it('숨기면 안 되는 표시는 접힌 구획 밖에 있다: 추정 · 실전 미대조, 지원하지 않음, 검증용 데이터 — 주의 문장은 접어 둔다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await find(w);
    const report = await expected(largeAccount, conditionOf(PRESET));
    const result = at(w, 'raid-result');
    expect(result.find('[data-testid="estimate-pill"]').text()).toBe('추정 · 실전 미대조');
    expect(result.find('[data-testid="unsupported-pill"]').text()).toBe(`지원하지 않음 ${report.unsupported.length}가지`);
    expect(result.find('[data-testid="unsupported-pill"]').attributes('title')).toContain('보스 패턴');
    expect(result.find('[data-testid="result-data-kind"]').text()).toBe('검증용 데이터');
    expect(result.find('[data-role="estimate"]').text()).toBe('추정');
    expect(at(w, 'raid-limit').text()).toBe('덱별 총딜 어림의 합이다 — 레이드의 점수가 아니다. 보스의 패턴과 체력, 점수 규칙은 계산하지 않는다(지원하지 않음).');
    for (const id of ['estimate-pill', 'unsupported-pill', 'result-data-kind', 'raid-limit']) expect(outsideFold(result.find(`[data-testid="${id}"]`).element), id).toBe(true);
    expect(outsideFold(result.find('[data-role="estimate"]').element)).toBe(true);
    const fold = at(w, 'raid-conditions');
    expect((fold.element as HTMLDetailsElement).open).toBe(false);
    expect(fold.findAll('[data-testid="caveat-item"]').map((li) => li.text())).toEqual(report.caveats);
    expect(fold.findAll('[data-testid="assumption-item"]').map((li) => li.text())).toEqual(report.assumptions);
    expect(fold.findAll('[data-testid="deck-note"]').map((li) => li.text())).toEqual(report.decks.flatMap((d) => d.notes.map((n) => `덱 ${d.deck}: ${n}`)));
    expect(fold.find('[data-testid="engine-version"]').text()).toContain('fake/engine');
  });

  it('버스트 단계가 모자라 덱을 다 만들 수 없으면 만든 만큼만 보이고, 어느 단계가 모자라는지가 접힌 구획 밖에 적힌다', async () => {
    // 큰 시험 계정에서 2단계 니케를 둘만 남긴다(1단계 10 · 2단계 2 · 3단계 14): 인원은 넉넉한데 두 덱뿐이다.
    const stage2 = Object.keys(largeAccount.nikkes).filter((n) => catalog.nikkes[n].burst_stage === '2');
    const dropped = new Set(stage2.slice(2));
    const scarce = { ...largeAccount, nikkes: Object.fromEntries(Object.entries(largeAccount.nikkes).filter(([n]) => !dropped.has(n))) };
    disk.addAccount('me', scarce);
    const w = await render();
    await openRaid(w);
    await find(w);
    const report = await expected(scarce, conditionOf(PRESET));
    expect(report.made).toBe(2);
    expect(report.shortage!.kind).toBe('stage');
    expect(report.shortage!.lacking).toEqual(['2']);
    expect(at(w, 'raid-shortage-pill').text()).toBe('덱 2 / 5개');
    expect(at(w, 'raid-shortage').text()).toContain(report.shortage!.text);
    expect(at(w, 'raid-shortage').text()).toMatch(/덱 5개 중 2개만 만들었다 — 남은 보유 니케 \d+명에 버스트 2단계가 모자란다/);
    expect(outsideFold(at(w, 'raid-shortage').element)).toBe(true);
    expect(deckRows(w).map((r) => r.attributes('data-status'))).toEqual(['computed', 'computed', 'empty', 'empty', 'empty']);
    expect(deckRow(w, 3).find('[data-testid="raid-deck-empty"]').text()).toContain('버스트 2단계 니케를 보유하지 않았다');
    expect(new Set(deckRows(w).flatMap(membersOf)).size).toBe(10);
  });

  it('인원이 모자라도 만든 만큼만 보인다 — 빈 덱은 0이 아니라 「빈 덱」이고 까닭이 적힌다', async () => {
    // 샘플 계정은 여덟 명이다(1단계 1 · 2단계 3 · 3단계 4): 한 덱뿐이다.
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openRaid(w);
    await find(w);
    const report = await expected(sampleAccount, conditionOf(PRESET));
    expect(report.made).toBe(1);
    expect(report.shortage!.kind).toBe('size');
    expect(at(w, 'raid-shortage-pill').text()).toBe('덱 1 / 5개');
    expect(at(w, 'raid-shortage').text()).toContain(report.shortage!.text);
    expect(report.shortage!.text).toMatch(/남은 보유 니케가 3명이라 다섯 명을 채울 수 없다/);
    expect(outsideFold(at(w, 'raid-shortage').element)).toBe(true);
    expect(deckRows(w).map((r) => r.attributes('data-status'))).toEqual(['computed', 'empty', 'empty', 'empty', 'empty']);
    const empty = deckRow(w, 2);
    expect(empty.find('[data-testid="raid-deck-empty"]').text()).toContain('빈 덱');
    expect(empty.find('[data-testid="raid-deck-empty"]').text()).toContain(report.decks[1].reason!);
    expect(empty.find('[data-testid="raid-deck-total"]').exists()).toBe(false);
    expect(empty.find('[data-testid="raid-pin"]').exists()).toBe(false);
    expect(at(w, 'raid-sum').text()).toContain('덱 1개의 합계');
    expect(all(w, 'raid-unused-item')).toHaveLength(3);
  });

  it('상대를 바꾸면 앞의 덱은 「바꾸기 전의 것」이라고 적힌다 — 다시 찾으면 지금 상대의 것이다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await find(w);
    expect(at(w, 'raid-stale').exists()).toBe(false);
    await chooseOpponent(w, 'element:수냉');
    expect(at(w, 'raid-result').attributes('data-fresh')).toBe('no');
    expect(at(w, 'raid-stale').text()).toContain('아래 덱은 바꾸기 전의 상대로 찾은 것이다');
    await find(w);
    expect(at(w, 'raid-result').attributes('data-fresh')).toBe('yes');
    const report = await expected(largeAccount, conditionOf('element:수냉'));
    expect(deckRows(w).map(membersOf)).toEqual(report.decks.map((d) => d.members.map((m) => m.name)));
  });

  it('계정을 바꾸면 앞 계정의 덱과 고정은 치운다', async () => {
    disk.addAccount('me', largeAccount);
    disk.addAccount('sub', sampleAccount);
    disk.chosen = 'me';
    const w = await render();
    await openRaid(w);
    await find(w);
    await deckRow(w, 1).find('[data-testid="raid-pin"]').trigger('click');
    expect(at(w, 'raid-result').exists()).toBe(true);
    await at(w, 'account-switch-select').setValue('sub');
    await flushPromises();
    await flushPromises();
    expect(at(w, 'raid-result').exists()).toBe(false);
    expect(at(w, 'raid-run').text()).toBe('5덱 찾기');
  });
});

describe('레이드 5덱 — 덱 고정과 덱 빌더', () => {
  it('덱을 고정하고 다시 찾으면 그 덱은 그대로이고 그 니케는 다른 덱에 없다 — 고정한 덱이 계산에 그대로 넘어간다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await find(w);
    const first = await expected(largeAccount, conditionOf(PRESET));
    const pinned = first.decks[1].members.map((m) => m.name);

    const pin = () => deckRow(w, 2).find('[data-testid="raid-pin"]');
    expect(pin().text()).toBe('고정');
    expect(pin().attributes('aria-pressed')).toBe('false');
    await pin().trigger('click');
    expect(pin().text()).toBe('고정 풀기');
    expect(pin().attributes('aria-pressed')).toBe('true');
    expect(deckRow(w, 2).attributes('data-pinned')).toBe('yes');
    expect(deckRow(w, 2).find('[data-testid="raid-deck-pinned"]').text()).toBe('고정');
    expect(at(w, 'raid-run').text()).toBe('고정한 덱 1개는 두고 다시 찾기');

    api.engineRunBatch.mockClear();
    simCache.clear();
    await find(w);
    const again = await expected(largeAccount, conditionOf(PRESET), { locked: [{ deck: 2, members: pinned }] });
    expect(again.decks[1].lock).toBe('full');
    expect(deckRows(w).map(membersOf)).toEqual(again.decks.map((d) => d.members.map((m) => m.name)));
    expect(membersOf(deckRow(w, 2))).toEqual(pinned);
    for (const n of [1, 3, 4, 5]) expect(membersOf(deckRow(w, n)).some((m) => pinned.includes(m)), `덱 ${n}`).toBe(false);
    expect(new Set(deckRows(w).flatMap(membersOf)).size).toBe(25);
    // 고정한 덱이 맨 먼저, 받은 자리 순서 그대로 계산 도구에 넘어갔다.
    const sent = api.engineRunBatch.mock.calls.flatMap(([requests]) => requests as EngineRequest[]);
    expect(sent[0].squad).toEqual(pinned);
    expect(sent.filter((r) => (r.squad as string[]).some((m) => pinned.includes(m)))).toHaveLength(1);
    // 고정은 다시 찾은 뒤에도 남는다. 풀면 단추가 돌아온다.
    expect(deckRow(w, 2).attributes('data-pinned')).toBe('yes');
    await pin().trigger('click');
    expect(at(w, 'raid-run').text()).toBe('다시 찾기');
    expect(deckRow(w, 2).attributes('data-pinned')).toBe('no');
    // 계산에서 고정됐던 덱이라는 표시는 결과에 남는다.
    expect(deckRow(w, 2).find('[data-testid="raid-deck-pinned"]').exists()).toBe(true);
  });

  it('「덱 빌더에서 열기」: 그 덱이 자리 순서 그대로, 그 상대로 덱 빌더에 온다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await chooseOpponent(w, 'element:작열');
    await find(w);
    const members = membersOf(deckRow(w, 3));
    await deckRow(w, 3).find('[data-testid="raid-open-deck"]').trigger('click');
    await flushPromises();
    expect(at(w, 'tool-deck').attributes('aria-selected')).toBe('true');
    expect(all(w, 'deck-slot').map((s) => s.attributes('data-name') ?? null)).toEqual(members);
    expect(at(w, 'deck-builder').find('[data-testid="opponent-name"]').text()).toBe('상대 약점 작열');
    // 돌아오면 찾은 덱은 그대로다.
    await at(w, 'tool-raid').trigger('click');
    expect(membersOf(deckRow(w, 3))).toEqual(members);
  });
});

describe('레이드 5덱 — 덱마다 상대', () => {
  it('덱마다 상대를 고르면 덱마다 그 상대로 계산한다 — 덱 줄에 상대가 적히고 미확인 값 표시가 고르는 줄마다 붙는다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await at(w, 'raid-mode-each').trigger('click');
    expect(localStorage.getItem('nikke-companion.raid.mode')).toBe('each');
    expect(raid(w).find('[data-testid="deck-opponent"]').exists()).toBe(false);
    const selects = () => all(w, 'raid-each-select');
    expect(selects()).toHaveLength(5);
    const keys = ['element:작열', 'element:수냉', 'element:작열', PRESET, 'boss:kraken'];
    for (const [i, key] of keys.entries()) await selects()[i].setValue(key);
    await flushPromises();
    expect(JSON.parse(localStorage.getItem('nikke-companion.raid.opponents')!)).toEqual(keys);
    // 속성만 정한 상대와 이상 개체 보스에는 미확인 값이 있다. 프리셋에는 없다.
    const rows = all(w, 'raid-each-row');
    expect(rows[0].find('[data-testid="raid-each-unconfirmed"]').text()).toMatch(/^미확인 값 \d+칸$/);
    expect(rows[3].find('[data-testid="raid-each-unconfirmed"]').exists()).toBe(false);
    expect(rows[4].find('[data-testid="raid-each-unconfirmed"]').text()).toBe('미확인 값 7칸');
    expect(outsideFold(rows[0].find('[data-testid="raid-each-unconfirmed"]').element)).toBe(true);

    await find(w);
    const report = await expected(largeAccount, keys.map(conditionOf));
    expect(report.mode).toBe('per_deck');
    expect(report.conditions).toHaveLength(4);
    expect(deckRows(w).map(membersOf)).toEqual(report.decks.map((d) => d.members.map((m) => m.name)));
    expect(new Set(deckRows(w).flatMap(membersOf)).size).toBe(25);
    expect(deckRows(w).map((r) => r.find('[data-testid="raid-deck-opponent"]').text())).toEqual(['상대 약점 작열', '상대 약점 수냉', '상대 약점 작열', '상대 솔로 레이드 S40', '상대 크라켄']);
    expect(at(w, 'raid-total').text()).toBe(damageUnit(report.total_damage));
    // 덱 5를 덱 빌더에서 열면 상대는 그 덱의 보스다.
    await deckRow(w, 5).find('[data-testid="raid-open-deck"]').trigger('click');
    await flushPromises();
    expect(at(w, 'deck-builder').find('[data-testid="opponent-name"]').text()).toBe('상대 크라켄');
  });
});

describe('레이드 5덱 — 「안 씀」 · 진행 · 중단 · 오류', () => {
  const blankPlan = (over: Partial<PlanDoc> = {}): PlanDoc => ({ schema_version: 1, kind: 'intercept_plan', favorites: [], unused: [], records: [], rewards: [], ...over });

  it('「안 씀」 니케 빼기를 켜면 그 니케는 어느 덱에도 없고, 뺐다는 배지가 접힌 구획 밖에 남는다', async () => {
    disk.addAccount('me', largeAccount);
    disk.plans.set('me', blankPlan({ unused: ['라피 : 레드 후드', '크라운'] }));
    const w = await render();
    await openRaid(w);
    expect(at(w, 'raid-unused-count').text()).toBe('(2명)');
    await at(w, 'raid-exclude-unused').setValue(true);
    await find(w);
    const names = deckRows(w).flatMap(membersOf);
    expect(names).not.toContain('라피 : 레드 후드');
    expect(names).not.toContain('크라운');
    expect(all(w, 'raid-unused-item').map((li) => li.attributes('data-name'))).not.toContain('크라운');
    const pill = at(w, 'excluded-pill');
    expect(pill.text()).toBe('안 씀 2명 제외');
    expect(pill.attributes('title')).toContain('라피 : 레드 후드');
    expect(outsideFold(pill.element)).toBe(true);
  });

  it('계산 중에는 진행 패널과 메뉴의 「계산 중」이 뜨고 단추가 꺼진다 — 다른 탭에 다녀와도 결과가 남는다', async () => {
    disk.addAccount('me', largeAccount);
    let release: () => void = () => {};
    const w = await render();
    await openRaid(w);
    api.engineRunBatch.mockImplementationOnce((requests) => new Promise((resolve) => (release = () => resolve(requests.map((r) => fakeRow(r))))));
    await at(w, 'raid-run').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(api.engineRunBatch).toHaveBeenCalledTimes(1));
    await flushPromises();
    expect(at(w, 'nav-tools').find('[data-testid="nav-busy"]').exists()).toBe(true);
    const panel = at(w, 'progress-panel');
    expect(panel.find('[data-testid="progress-title"]').text()).toBe('덱 후보를 견줘 보는 중');
    expect(panel.find('[data-testid="progress-detail"]').text()).toBe('1/2단계');
    expect(panel.find('[data-testid="progress-count"]').text()).toContain(`/ ${DEFAULT_UNION_BUDGET}`);
    for (const id of ['raid-run', 'raid-mode-each', 'raid-precision-fast']) expect(at(w, id).attributes('disabled'), id).toBeDefined();
    // 다른 탭을 봐도 계산은 이어진다.
    await at(w, 'tool-suggest').trigger('click');
    await openPage(w, 'home');
    release();
    await idle(w);
    await openPage(w, 'tools');
    await at(w, 'tool-raid').trigger('click');
    expect(deckRows(w)).toHaveLength(5);
    expect(at(w, 'progress-panel').exists()).toBe(false);
  });

  it('중단하면 결과도 오류도 아닌 「중단했다」가 보이고 앞서 찾은 덱은 그대로다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openRaid(w);
    await find(w);
    const before = deckRows(w).map(membersOf);

    await at(w, 'raid-precision-thorough').trigger('click');
    expect(localStorage.getItem('nikke-companion.raid.precision')).toBe('thorough');
    let fail: (reason: unknown) => void = () => {};
    const calls = api.engineRunBatch.mock.calls.length;
    api.engineRunBatch.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    api.engineCancel.mockImplementation(async () => {
      fail('중단됨');
      return true;
    });
    await at(w, 'raid-run').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(api.engineRunBatch).toHaveBeenCalledTimes(calls + 1));
    await flushPromises();
    expect(at(w, 'stale-note').text()).toContain('이전에 찾은 덱');
    await at(w, 'progress-panel').find('[data-testid="progress-stop"]').trigger('click');
    await idle(w);
    expect(api.engineCancel).toHaveBeenCalled();
    expect(at(w, 'stopped-note').text()).toBe('계산을 중단했다. 앞서 보이던 덱은 그대로다.');
    expect(at(w, 'raid-error').exists()).toBe(false);
    expect(deckRows(w).map(membersOf)).toEqual(before);
  });

  it('계산 도구가 통째로 실패하면 무슨 일이 있었고 무엇을 하면 되는지 말한다', async () => {
    disk.addAccount('me', largeAccount);
    api.engineRunBatch.mockRejectedValue('계산 도구를 실행하지 못했다');
    const w = await render();
    await openRaid(w);
    await find(w);
    expect(at(w, 'raid-error').text()).toBe('다섯 덱을 찾지 못했다. 실행 오류 — 계산 도구를 실행하지 못했다 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.');
    expect(at(w, 'raid-result').exists()).toBe(false);
  });

  it('계산하지 못한 후보는 0으로 치지 않는다 — 몇 개인지 접힌 구획 밖에 적는다', async () => {
    disk.addAccount('me', largeAccount);
    api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r, '블랑')));
    const w = await render();
    await openRaid(w);
    await find(w);
    expect(deckRows(w).flatMap(membersOf)).not.toContain('블랑');
    expect(at(w, 'raid-failed').text()).toMatch(/^계산하지 못한 후보 \d+개 계산 도구가 계산하지 못한 후보는 0으로 치지 않고 뺐다\.$/);
    expect(outsideFold(at(w, 'raid-failed').element)).toBe(true);
  });
});

describe('레이드 5덱 — 문구와 모양', () => {
  it('새 화면은 색·크기를 디자인 토큰으로만 적고, 화면의 글에 개발 용어를 쓰지 않는다', () => {
    const style = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(style).not.toMatch(/\d(px|rem|em|pt)\b/);
    expect(style).not.toMatch(/\b(rgba?|hsla?)\(/);
    const template = source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>')).replace(/<!--[\s\S]*?-->/g, '');
    expect(template).not.toMatch(/JSON|시뮬|예산|파일|경로|schema|엔진|스크립트/);
  });
});
