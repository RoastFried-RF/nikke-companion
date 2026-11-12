// 덱 빌더(P-030)의 화면: 편성 도구의 「덱 빌더」 탭 — 초상화로 편성 짜기·상대 고르기·바로 계산·육성 기준 둘·한 명을 바꾼다면·
// 자리 순서 비교·내 편성 저장·편성 복사, 요격전 추천의 「덱 빌더에서 열기」, 설정의 자동 계산.
// 규칙 자체는 루트의 단위 테스트(tests/unit/deck.test.mjs)가, 실제 엔진으로는 tests/integration/deck.engine.test.mjs가 본다.
// Rust 쪽(backend)은 가짜다: 계정 폴더는 가짜 디스크(저장한 편성과 클립보드에 쓴 글도 거기에 남는다), 엔진은 이름과 자리에서 정해지는 값을 낸다.
// 계정은 검증용 샘플(data/samples/)뿐이다 — 실제 계정은 쓰지 않는다.
import { resolveOpponent as coreResolveOpponent, swapCandidates } from '@core/deck.mjs';
import { placementVariants } from '@core/search.mjs';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bundle from '../../data/intercept/anomaly.json';
import largeAccount from '../../data/samples/account.large.sample.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { damageUnit } from '../src/lib/format';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { simCache } from '../src/lib/runtime';
import type { EngineRequest, EngineRow, InterceptReport } from '../src/types';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog, FAKE_EVALUATOR, fakeDamage, fakeRow, sampleAccount } from './helpers/fakeEngine';
import { currentPage, FakeDisk, installShell, openPage, openSection } from './helpers/shell';

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

/** 샘플 계정의 편성(1·2·3·3·3단계). */
const DECK = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];
const stageOf = (name: string) => String(catalog.nikkes[name]?.burst_stage);
const total = (members: string[], scale = 1) => members.reduce((sum, name, i) => sum + fakeDamage(name, i) * scale, 0);

/** 가짜 엔진: 「모두 최대 육성」(계산 도구의 기본 스펙) 요청은 두 배를 낸다. `failOn`이 편성에 들면 계산하지 못한다. */
function engineRow(request: EngineRequest, failOn?: string): EngineRow {
  const row = fakeRow(request, failOn);
  const profile = request.profile as { base?: string } | undefined;
  if (profile?.base !== 'default' || 'error' in row) return row;
  const members = (row.members as { name: string; damage: number; share: number }[]).map((m) => ({ ...m, damage: m.damage * 2 }));
  return { ...row, total_damage: (row.total_damage as number) * 2, members };
}

/** 띄운 앱 창들 — 테스트가 끝나면 내린다(늦게 끝난 계산이 다음 테스트에 섞이지 않게). */
const mounted: Wrapper[] = [];
async function render(): Promise<Wrapper> {
  const wrapper = mount(App);
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

/** 계산이 끝날 때까지(메뉴의 「계산 중」 점이 사라질 때까지) 기다린다. 캐시의 열쇠를 만드는 해시가 비동기라 한 번에 끝나지 않는다. */
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

/** 편성 도구의 덱 빌더 탭을 연다. */
async function openDeck(w: Wrapper): Promise<void> {
  await openPage(w, 'tools');
  await at(w, 'tool-deck').trigger('click');
  await flushPromises();
}

const pickButton = (w: Wrapper, name: string) => all(w, 'deck-pick').find((b) => b.attributes('data-name') === name)!;
async function fill(w: Wrapper, names: string[]): Promise<void> {
  for (const name of names) await pickButton(w, name).trigger('click');
  await idle(w);
}
const slotNames = (w: Wrapper) => all(w, 'deck-slot').map((s) => s.attributes('data-name') ?? null);
async function choose(w: Wrapper, key: string): Promise<void> {
  await all(w, 'opponent-option')
    .find((o) => o.attributes('data-key') === key)!
    .trigger('click');
  await flushPromises();
}
async function calc(w: Wrapper): Promise<void> {
  await at(w, 'deck-run').trigger('click');
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

// ── 편성 짜기 ─────────────────────────────────────────────────────────────────

describe('편성 짜기', () => {
  it('보유 니케의 초상화를 눌러 다섯 자리에 넣는다 — 같은 니케는 두 번 넣을 수 없다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    expect(at(w, 'tool-deck').text()).toBe('덱 빌더');
    expect(at(w, 'tool-deck').attributes('aria-selected')).toBe('true');
    // 보유 니케 전부가 초상화 타일로 보인다.
    const owned = Object.keys(sampleAccount.nikkes);
    expect(all(w, 'deck-pick').map((b) => b.attributes('data-name')).sort()).toEqual([...owned].sort());
    expect(all(w, 'deck-pick').every((b) => b.find('[data-testid="nikke-tile"]').exists())).toBe(true);
    expect(slotNames(w)).toEqual([null, null, null, null, null]);
    expect(at(w, 'deck-count').text()).toContain('0 / 5명');
    // 다섯 자리가 차기 전에는 계산 단추가 꺼져 있다.
    expect(at(w, 'deck-run').attributes('disabled')).toBeDefined();
    expect(at(w, 'deck-hint').text()).toContain('다섯 명을 골라 자리에 놓는다');

    await fill(w, DECK.slice(0, 2));
    expect(slotNames(w)).toEqual(['리틀 머메이드', '크라운', null, null, null]);
    // 이미 든 니케는 누를 수 없다(표시도 다르다).
    const crown = pickButton(w, '크라운');
    expect(crown.attributes('disabled')).toBeDefined();
    expect(crown.attributes('data-in')).toBe('yes');
    expect(crown.attributes('title')).toBe('크라운 — 이미 편성에 있다');
    await crown.trigger('click');
    expect(slotNames(w)).toEqual(['리틀 머메이드', '크라운', null, null, null]);
    expect(at(w, 'deck-run').attributes('disabled')).toBeDefined();
    expect(at(w, 'deck-run').attributes('title')).toBe('다섯 자리를 모두 채우면 계산할 수 있다(지금 2명)');

    await fill(w, DECK.slice(2));
    expect(slotNames(w)).toEqual(DECK);
    expect(at(w, 'deck-run').attributes('disabled')).toBeUndefined();
    expect(at(w, 'deck-burst').text()).toBe('버스트 1·2·3단계가 모두 있다.');
    // 가득 찼는데 더 넣으려 하면 무슨 일인지 말한다.
    await pickButton(w, '미하라').trigger('click');
    expect(at(w, 'deck-notice').text()).toContain('다섯 자리가 모두 찼다');
    expect(slotNames(w)).toEqual(DECK);

    // 빼면 그 자리가 비고, 뺀 니케는 다시 고를 수 있다.
    await all(w, 'slot-remove')[1].trigger('click');
    expect(slotNames(w)).toEqual(['리틀 머메이드', null, '라피 : 레드 후드', '헬름', '앨리스']);
    expect(pickButton(w, '크라운').attributes('disabled')).toBeUndefined();
    // 엔진을 부른 적이 없다 — 짜는 것만으로는 계산하지 않는다(자동 계산은 꺼져 있다).
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });

  it('속성·버스트 단계·이름으로 거른다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openDeck(w);
    const owned = Object.keys(largeAccount.nikkes);
    expect(at(w, 'deck-roster-count').text()).toBe(`${owned.length}명`);

    const fire = all(w, 'deck-filter-element').find((b) => b.attributes('data-element') === '작열')!;
    await fire.trigger('click');
    const fireNames = owned.filter((n) => catalog.nikkes[n]?.element_code === '작열');
    expect(fireNames.length).toBeGreaterThan(0);
    expect(all(w, 'deck-pick').map((b) => b.attributes('data-name')).sort()).toEqual([...fireNames].sort());

    const b1 = all(w, 'deck-filter-burst').find((b) => b.attributes('data-burst') === '1')!;
    await b1.trigger('click');
    const fire1 = fireNames.filter((n) => ['1', 'A'].includes(stageOf(n)));
    expect(all(w, 'deck-pick').map((b) => b.attributes('data-name')).sort()).toEqual([...fire1].sort());
    await fire.trigger('click');
    await b1.trigger('click');

    await at(w, 'deck-search').setValue('크라');
    expect(all(w, 'deck-pick').map((b) => b.attributes('data-name')).sort()).toEqual(owned.filter((n) => n.replaceAll(' ', '').includes('크라')).sort());
    await at(w, 'deck-search').setValue('없는 이름');
    expect(at(w, 'deck-roster-empty').text()).toBe('조건에 맞는 니케가 없다.');
  });

  it('자리끼리 끌거나 ◀ ▶로 순서를 바꾼다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    const slots = () => all(w, 'deck-slot');
    expect(slots()[0].attributes('draggable')).toBe('true');

    // 1번 자리를 끌어 4번 자리에 놓으면 둘이 맞바뀐다.
    await slots()[0].trigger('dragstart');
    await slots()[3].trigger('dragover');
    await slots()[3].trigger('drop');
    expect(slotNames(w)).toEqual(['헬름', '크라운', '라피 : 레드 후드', '리틀 머메이드', '앨리스']);
    // 빈 자리로도 옮긴다.
    await all(w, 'slot-remove')[4].trigger('click');
    await slots()[1].trigger('dragstart');
    await slots()[4].trigger('drop');
    expect(slotNames(w)).toEqual(['헬름', null, '라피 : 레드 후드', '리틀 머메이드', '크라운']);
    expect(slots()[1].attributes('draggable')).toBe('false');

    // ◀ ▶: 옆 자리와 맞바꾼다. 맨 앞의 ◀와 맨 뒤의 ▶는 꺼져 있다.
    await slots()[2].find('[data-testid="slot-right"]').trigger('click');
    expect(slotNames(w)).toEqual(['헬름', null, '리틀 머메이드', '라피 : 레드 후드', '크라운']);
    await slots()[2].find('[data-testid="slot-left"]').trigger('click');
    expect(slotNames(w)).toEqual(['헬름', '리틀 머메이드', null, '라피 : 레드 후드', '크라운']);
    expect(slots()[0].find('[data-testid="slot-left"]').attributes('disabled')).toBeDefined();
    expect(slots()[4].find('[data-testid="slot-right"]').attributes('disabled')).toBeDefined();
  });

  it('버스트 단계 구성이 맞지 않으면 무엇이 모자란지 바로 보인다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    // 3단계만 셋: 1·2단계가 없다(아직 덜 찼다 — 알림 색이 아니다).
    await fill(w, ['라피 : 레드 후드', '헬름', '앨리스']);
    expect(at(w, 'deck-burst').text()).toBe('버스트 1·2단계 니케가 없다.');
    expect(at(w, 'deck-burst').attributes('data-ok')).toBe('no');
    expect(at(w, 'deck-burst').attributes('data-tone')).toBe('neutral');
    // 1단계 없이 다섯을 채우면 경고가 된다 — 그래도 계산은 할 수 있다(막지 않는다).
    const noFirst = Object.keys(sampleAccount.nikkes).filter((n) => stageOf(n) !== '1' && !['라피 : 레드 후드', '헬름', '앨리스'].includes(n));
    expect(noFirst.length).toBeGreaterThanOrEqual(2);
    await fill(w, noFirst.slice(0, 2));
    expect(slotNames(w).every((n) => n !== null)).toBe(true);
    expect(at(w, 'deck-burst').text()).toBe('버스트 1단계 니케가 없다. 풀 버스트가 열리지 않을 수 있다.');
    expect(at(w, 'deck-burst').attributes('data-tone')).toBe('unknown');
    expect(at(w, 'deck-run').attributes('disabled')).toBeUndefined();
  });
});

// ── 상대 고르기 ────────────────────────────────────────────────────────────────

describe('상대 고르기', () => {
  it('이상 개체 보스 5종 · 계산 도구의 솔로 레이드 보스 · 속성만 정하기(약점 다섯 + 속성 없음)', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    const groups = all(w, 'opponent-group');
    expect(groups.map((g) => g.attributes('data-kind'))).toEqual(['boss', 'preset', 'element']);
    const keysOf = (i: number) => groups[i].findAll('[data-testid="opponent-option"]').map((o) => o.attributes('data-key'));
    expect(keysOf(0)).toEqual(bundle.bosses.map((b) => `boss:${b.id}`));
    expect(keysOf(1)).toEqual(catalog.bosses.map((b) => `preset:${b}`));
    expect(keysOf(2)).toEqual(['element:전격', 'element:수냉', 'element:작열', 'element:풍압', 'element:철갑', 'element:none']);
    expect(groups[0].text()).toContain('크라켄');
    expect(groups[0].text()).toContain('약점 풍압');

    // 처음에는 계산 도구의 솔로 레이드 보스다(편성 도구의 추천과 같은 기준). 그 보스의 약점은 이 화면이 모른다고 적는다.
    expect(at(w, 'opponent-name').text()).toBe(`상대 ${catalog.bosses[0]}`);
    expect(at(w, 'opponent-element-unknown').text()).toBe('약점 속성은 이 화면이 알지 못한다');
    expect(at(w, 'opponent-unconfirmed').exists()).toBe(false);
  });

  it('고른 상대의 미확인 값 표시는 요격전 화면과 같다 — 배지는 접힌 구획 밖, 칸별 내용은 「계산 조건」', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await choose(w, 'boss:kraken');
    const kraken = coreResolveOpponent('boss:kraken', { bundle, catalog })!;
    expect(at(w, 'opponent-name').text()).toBe('상대 크라켄');
    expect(at(w, 'opponent-chosen').find('[data-testid="element-chip"]').text()).toBe('약점 풍압');
    // 요격전 화면의 배지와 같은 글·같은 풍선 도움말이다.
    const pill = at(w, 'opponent-unconfirmed');
    expect(pill.text()).toBe(`미확인 값 ${kraken.unconfirmed.length}칸`);
    expect(kraken.unconfirmed).toHaveLength(7);
    expect(pill.attributes('title')).toBe('게임 화면에서 확인하지 못한 값이다. 기본값으로 계산했다 — 확정값이 아니다.');
    expect(pill.element.closest('details')).toBeNull();
    const fold = at(w, 'deck-conditions');
    expect(fold.element.tagName).toBe('DETAILS');
    expect(fold.findAll('[data-testid="unconfirmed-item"]').map((li) => li.text())).toEqual(kraken.unconfirmed.map((u) => `${u.label}: ${u.text}`));
    expect(fold.findAll('[data-testid="opponent-note"]').map((li) => li.text())).toEqual(kraken.notes);

    // 속성만 정하기: 약점 작열 → 그 속성 니케에 테두리. 고른 속성은 미확인이 아니다(8칸).
    await choose(w, 'element:작열');
    expect(at(w, 'opponent-name').text()).toBe('상대 약점 작열');
    expect(at(w, 'opponent-unconfirmed').text()).toBe('미확인 값 8칸');
    expect(at(w, 'opponent-flag').exists()).toBe(false);
    const fireOwned = Object.keys(sampleAccount.nikkes).filter((n) => catalog.nikkes[n]?.element_code === '작열');
    for (const name of fireOwned) expect(pickButton(w, name).find('[data-testid="nikke-tile"]').attributes('data-weak')).toBe('true');

    // 속성 없음: 「속성 상성 미반영」이 눈에 띄게 붙는다.
    await choose(w, 'element:none');
    expect(at(w, 'opponent-flag').text()).toBe('속성 상성 미반영');
    expect(at(w, 'opponent-flag').element.closest('details')).toBeNull();
    expect(at(w, 'opponent-unconfirmed').text()).toBe('미확인 값 9칸');
    // 고른 상대를 기억한다.
    expect(JSON.parse(localStorage.getItem('nikke-companion.deck.working')!).opponent).toBe('element:none');
  });
});

// ── 바로 계산 · 육성 기준 ─────────────────────────────────────────────────────

describe('바로 계산', () => {
  it('계산을 누르면 편성 위에 큰 총딜 숫자와 니케별 딜 비중 막대가 보인다 — 두 육성 기준이 나란히', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await choose(w, 'boss:kraken');
    await fill(w, DECK);
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    await calc(w);

    // 엔진에 간 것: 같은 다섯을 계정 육성과 계산 도구의 기본 스펙 두 가지로, 크라켄의 조건으로.
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    const sent = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(sent).toHaveLength(2);
    expect(sent.map((r) => r.squad)).toEqual([DECK, DECK]);
    expect((sent[0].profile as { base: string }).base).toBe('ungrown');
    expect(sent[1].profile).toEqual({ base: 'default', chars: {}, _meta: { name: '엔진 기본 스펙' } });
    expect(sent[0].enemy).toEqual({ code: '철갑' });

    // 결과는 다섯 자리보다 위에 있다.
    const result = at(w, 'deck-result');
    expect(result.attributes('data-fresh')).toBe('yes');
    expect(result.element.compareDocumentPosition(at(w, 'deck-slots').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(at(w, 'deck-total').text()).toBe(damageUnit(total(DECK)));
    expect(at(w, 'deck-total').classes()).toContain('nk-hero');
    expect(result.find('[data-role="estimate"]').text()).toBe('추정');
    // 육성 기준 둘이 나란히: 내 계정 육성 / 모두 최대 육성(계산 도구의 기본 스펙).
    expect(at(w, 'basis-account').text()).toContain('내 계정 육성');
    expect(at(w, 'basis-max').text()).toContain('모두 최대 육성');
    expect(at(w, 'basis-max').text()).toContain('계산 도구의 기본 스펙');
    expect(at(w, 'deck-total-max').text()).toBe(damageUnit(total(DECK, 2)));
    expect(at(w, 'deck-growth').text()).toMatch(/^지금 육성으로는 모두 최대 육성일 때의 50%다 — 같은 조합을 끝까지 키우면 .+까지 오른다\. 그 값도 낮으면 조합을 바꿔 본다\.$/);
    // 니케별 딜 비중 막대(자리의 타일마다).
    const bars = all(w, 'deck-slot').map((s) => s.find('[data-testid="damage-bar-percent"]').text());
    expect(bars).toEqual(DECK.map((name, i) => `${Math.round((fakeDamage(name, i) / total(DECK)) * 100)}%`));
    // 약점 속성(풍압) 니케에는 테두리.
    for (const [i, name] of DECK.entries()) {
      expect(all(w, 'deck-slot')[i].find('[data-testid="nikke-tile"]').attributes('data-weak')).toBe(catalog.nikkes[name]?.element_code === '풍압' ? 'true' : 'false');
    }
    // 접어 둔 계산 조건: 가정·주의·기준의 뜻.
    const fold = at(w, 'deck-conditions');
    expect(fold.find('[data-testid="max-spec"]').text()).toContain('코어 강화 0');
    expect(fold.findAll('[data-testid="caveat-item"]').map((li) => li.text()).join('\n')).toMatch(/보스 패턴 미반영[\s\S]*「전부 최대」가 아니다[\s\S]*지원하지 않음: /);
    expect(fold.find('[data-testid="engine-version"]').text()).toBe('계산 도구: fake/engine @ ffffffff');
  });

  it('같은 편성·같은 상대는 캐시로 바로 나온다 — 편성이나 상대를 바꾸면 앞의 숫자는 「바꾸기 전」으로 표시된다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await calc(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    expect(at(w, 'deck-reused').exists()).toBe(false);
    expect(at(w, 'deck-run').text()).toBe('다시 계산');

    await calc(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    expect(at(w, 'deck-reused').text()).toBe('앞서 계산해 둔 결과를 바로 가져왔다.');
    expect(at(w, 'deck-conditions').find('[data-testid="reused"]').text()).toBe('앞서 계산해 둔 것을 다시 쓴 편성 2건 · 새로 계산한 편성 0건');

    // 자리를 바꾸면 다른 편성이다: 숫자는 남지만 바꾸기 전의 것이라고 알리고, 막대는 내린다.
    await all(w, 'deck-slot')[3].find('[data-testid="slot-right"]').trigger('click');
    expect(at(w, 'deck-result').attributes('data-fresh')).toBe('no');
    expect(at(w, 'deck-stale').text()).toContain('아래 숫자는 바꾸기 전의 것이다');
    expect(at(w, 'deck-run').text()).toBe('계산');
    expect(all(w, 'deck-slot')[0].find('[data-testid="damage-bar"]').exists()).toBe(false);
    await calc(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(2);
    const moved = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '앨리스', '헬름'];
    expect(at(w, 'deck-total').text()).toBe(damageUnit(total(moved)));
    // 되돌리면 처음 계산이 캐시에 있다.
    await all(w, 'deck-slot')[3].find('[data-testid="slot-right"]').trigger('click');
    await calc(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(2);
    expect(at(w, 'deck-total').text()).toBe(damageUnit(total(DECK)));
    // 상대를 바꿔도 다른 계산이다.
    await choose(w, 'element:작열');
    expect(at(w, 'deck-stale').exists()).toBe(true);
    await calc(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(3);
  });

  it('계산 도구가 계산하지 못한 편성은 0이 아니라 「계산하지 못함」이다', async () => {
    disk.addAccount('me', sampleAccount);
    api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => engineRow(r, '앨리스')));
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await calc(w);
    expect(at(w, 'deck-total').exists()).toBe(false);
    expect(at(w, 'deck-failed-pill').text()).toBe('계산하지 못함');
    expect(at(w, 'deck-failed').text()).toBe('이 편성은 계산하지 못했다 — 지원하지 않는 니케나 효과가 있을 수 있다. 0으로 치지 않는다. 가짜 엔진 오류: 앨리스');
    expect(at(w, 'deck-max-failed-pill').text()).toBe('계산하지 못함');
    expect(at(w, 'deck-growth').exists()).toBe(false);
    expect(all(w, 'deck-slot')[0].find('[data-testid="damage-bar"]').exists()).toBe(false);
    expect(at(w, 'deck-result').text()).not.toMatch(/(^|\s)0(\s|$)/);
  });

  it('엔진 배치가 통째로 실패하면 무슨 일이 있었고 무엇을 하면 되는지 말한다', async () => {
    disk.addAccount('me', sampleAccount);
    api.engineRunBatch.mockRejectedValue('계산 도구를 실행하지 못했다');
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await calc(w);
    expect(at(w, 'deck-error').text()).toBe('계산하지 못했다. 실행 오류 — 계산 도구를 실행하지 못했다 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.');
    expect(at(w, 'deck-total').exists()).toBe(false);
  });

  it('자동 계산은 설정에서 켠다 — 켜 두면 다섯 자리가 찼을 때 스스로 계산한다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK.slice(0, 4));
    // 기본은 꺼짐: 다섯째를 넣어도 계산하지 않는다.
    await fill(w, DECK.slice(4));
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    await all(w, 'slot-remove')[4].trigger('click');

    await openSection(w, 'engine');
    const box = at(w, 'deck-auto');
    expect((box.element as HTMLInputElement).checked).toBe(false);
    expect(at(w, 'settings-deck').text()).toContain('다섯 자리가 차면 바로 계산한다');
    await box.setValue(true);
    expect(localStorage.getItem('nikke-companion.deck.auto')).toBe('on');

    await openPage(w, 'tools');
    await flushPromises();
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    await fill(w, DECK.slice(4));
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
    expect(at(w, 'deck-total').text()).toBe(damageUnit(total(DECK)));
    // 자리를 바꾸면 다시 스스로 계산한다.
    await all(w, 'deck-slot')[0].find('[data-testid="slot-right"]').trigger('click');
    await idle(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(2);
    expect(at(w, 'deck-result').attributes('data-fresh')).toBe('yes');
  });
});

// ── 한 명을 바꾼다면 · 자리 순서 비교 ─────────────────────────────────────────

describe('한 명을 바꾼다면', () => {
  it('한 자리를 고르면 같은 버스트 단계의 보유 니케를 하나씩 넣어 계산하고 총딜 변화 순으로 초상화와 +/−%를 보인다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openDeck(w);
    await choose(w, 'boss:kraken');
    const owned = Object.keys(largeAccount.nikkes);
    const pick = (stage: string, count: number) => owned.filter((n) => stageOf(n) === stage).slice(0, count);
    const deck = [...pick('1', 2), ...pick('2', 2), ...pick('3', 1)];
    expect(deck).toHaveLength(5);
    await fill(w, deck);

    // 5번 자리(3단계)를 바꿔 본다. 큰 샘플 계정에는 3단계 니케가 상한(12명)보다 많다.
    const preview = swapCandidates({ members: deck, slot: 4, account: largeAccount, catalog });
    expect(preview.candidates).toHaveLength(12);
    expect(preview.skipped.length).toBeGreaterThan(0);
    const button = all(w, 'deck-slot')[4].find('[data-testid="slot-swap"]');
    expect(button.attributes('title')).toBe(`같은 버스트 단계의 보유 니케 12명을 하나씩 넣어 계산한다 (${preview.skipped.length}명은 한 번에 보는 수를 넘어 보지 않는다)`);
    await button.trigger('click');
    await idle(w);

    // 엔진에 간 것: 지금 편성 + 넣어 본 열둘.
    const sent = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(sent).toHaveLength(13);
    expect(sent.slice(1).map((r) => (r.squad as string[])[4])).toEqual(preview.candidates);

    const panel = at(w, 'swap-panel');
    expect(at(w, 'swap-head').text()).toBe(`5번 자리의 ${deck[4]} 대신 — 총딜이 큰 순서`);
    const base = total(deck);
    const expected = preview.candidates
      .map((name: string) => ({ name, total: total([...deck.slice(0, 4), name]) }))
      .sort((a: { total: number }, b: { total: number }) => b.total - a.total);
    const rows = all(w, 'swap-row');
    expect(rows.map((r) => r.attributes('data-name'))).toEqual(expected.map((e: { name: string }) => e.name));
    const sign = (x: number) => `${x < 0 ? '−' : '+'}${(Math.abs(x) * 100).toFixed(1)}%`;
    expect(texts(w, 'swap-change')).toEqual(expected.map((e: { total: number }) => sign((e.total - base) / base)));
    expect(texts(w, 'swap-total')).toEqual(expected.map((e: { total: number }) => damageUnit(e.total)));
    expect(rows.every((r) => r.find('[data-testid="nikke-tile"]').exists())).toBe(true);
    expect(texts(w, 'swap-change').some((t) => t.startsWith('+'))).toBe(true);
    expect(texts(w, 'swap-change').some((t) => t.startsWith('−'))).toBe(true);
    // 상한 때문에 못 본 것을 접지 않고 적는다.
    const skipped = at(w, 'swap-skipped');
    expect(skipped.text().replace(/\s+/g, ' ')).toBe(`한 번에 12명까지만 넣어 본다(많이 키운 순). 보지 못한 니케 ${preview.skipped.length}명: ${preview.skipped.join(', ')}`);
    expect(skipped.element.closest('details')).toBeNull();
    expect(panel.find('[data-testid="status-pill"]').text()).toBe('추정');

    // 누르면 그 니케로 바뀐다(바꾼 편성은 새 편성이라 바꿔 본 목록은 내린다).
    const best = expected[0].name as string;
    await rows[0].find('[data-testid="swap-apply"]').trigger('click');
    expect(slotNames(w)).toEqual([...deck.slice(0, 4), best]);
    expect(at(w, 'swap-panel').exists()).toBe(false);
  });

  it('넣어 볼 니케가 없거나 계산하지 못한 니케가 있으면 그렇게 적는다', async () => {
    disk.addAccount('me', sampleAccount);
    api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => engineRow(r, '미하라')));
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    // 5번 자리(앨리스, 3단계): 샘플 계정에서 넣어 볼 3단계 니케는 미하라뿐이고, 가짜 엔진은 미하라를 계산하지 못한다.
    await all(w, 'deck-slot')[4].find('[data-testid="slot-swap"]').trigger('click');
    await idle(w);
    expect(all(w, 'swap-row')).toHaveLength(0);
    expect(at(w, 'swap-failed').text().replace(/\s+/g, ' ')).toBe('계산하지 못한 니케 1명(지원하지 않음 — 0으로 치지 않고 뺐다): 미하라 — 가짜 엔진 오류: 미하라');

    // 2번 자리(크라운, 2단계)에 넣어 볼 다른 2단계 보유 니케가 있는지에 따라.
    const others = Object.keys(sampleAccount.nikkes).filter((n) => !DECK.includes(n) && stageOf(n) === stageOf('크라운'));
    await all(w, 'deck-slot')[1].find('[data-testid="slot-swap"]').trigger('click');
    await idle(w);
    if (others.length === 0) expect(at(w, 'swap-none').text()).toContain('넣어 볼 수 있는 보유 니케가 없다');
    else expect(all(w, 'swap-row').map((r) => r.attributes('data-name')).sort()).toEqual([...others].sort());
  });
});

describe('자리 순서 비교', () => {
  it('같은 다섯의 자리 변형을 계산해 가장 좋은 순서와 지금 순서의 차이를 보이고, 누르면 그 순서로 바뀐다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await choose(w, 'boss:kraken');
    await fill(w, DECK);
    await at(w, 'order-run').trigger('click');
    await idle(w);

    const variants = placementVariants(DECK, catalog) as { members: string[] }[];
    expect(variants.length).toBeGreaterThan(0);
    const sent = api.engineRunBatch.mock.calls[0][0] as EngineRequest[];
    expect(sent.map((r) => r.squad)).toEqual([DECK, ...variants.map((v) => v.members)]);
    const best = [DECK, ...variants.map((v) => v.members)].reduce((a, b) => (total(b) > total(a) ? b : a));
    expect(best).not.toEqual(DECK);

    const panel = at(w, 'order-panel');
    expect(panel.attributes('data-changed')).toBe('yes');
    expect(all(w, 'order-member').map((m) => m.attributes('data-name'))).toEqual(best);
    expect(at(w, 'order-gain').text()).toBe(`지금 순서보다 +${((total(best) / total(DECK) - 1) * 100).toFixed(1)}%`);
    expect(at(w, 'order-total').text()).toBe(`${damageUnit(total(DECK))} → ${damageUnit(total(best))}`);
    expect(at(w, 'order-changes').text()).toMatch(/^바꾼 것: /);
    expect(at(w, 'order-skipped').exists()).toBe(false);

    await at(w, 'order-apply').trigger('click');
    expect(slotNames(w)).toEqual(best);
    // 바뀐 순서를 계산하면 견줄 때 계산해 둔 값이 바로 나온다(계정 육성 쪽은 캐시).
    await calc(w);
    expect(at(w, 'deck-total').text()).toBe(damageUnit(total(best)));
    // 이제 그 순서가 가장 좋다.
    await at(w, 'order-run').trigger('click');
    await idle(w);
    expect(at(w, 'order-panel').attributes('data-changed')).toBe('no');
    expect(at(w, 'order-kept').text()).toContain('지금 순서가 가장 좋다');
    expect(at(w, 'order-apply').exists()).toBe(false);
  });
});

// ── 내 편성 저장 · 가져오기 · 복사 ────────────────────────────────────────────

describe('내 편성 저장', () => {
  it('다섯 칸(01~05)과 이름 붙인 목록에 저장한다 — 계정 폴더에 남아 앱을 다시 켜도 보인다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    expect(texts(w, 'book-slot-no')).toEqual(['01', '02', '03', '04', '05']);
    expect(all(w, 'book-slot').every((s) => s.attributes('data-filled') === 'no')).toBe(true);
    // 빈 편성은 저장할 수 없다.
    expect(all(w, 'book-save')[0].attributes('disabled')).toBeDefined();

    await choose(w, 'boss:kraken');
    await fill(w, DECK);
    await calc(w);
    await all(w, 'book-save')[1].trigger('click');
    await flushPromises();
    const slot = all(w, 'book-slot')[1];
    expect(slot.attributes('data-filled')).toBe('yes');
    expect(slot.find('[data-testid="book-slot-name"]').text()).toBe('편성 02');
    expect(slot.find('[data-testid="book-slot-info"]').text()).toBe(`상대 크라켄 · ${damageUnit(total(DECK))} · 추정`);
    expect(slot.findAll('[data-testid="nikke-tile"]')).toHaveLength(5);

    // 이름을 붙여 목록에도 저장한다(계산하지 않은 편성은 「계산 전」).
    await all(w, 'slot-remove')[4].trigger('click');
    expect(at(w, 'saved-add').attributes('disabled')).toBeDefined();
    await at(w, 'saved-name').setValue('솔레 1덱');
    await at(w, 'saved-add').trigger('click');
    await flushPromises();
    expect(texts(w, 'saved-item-name')).toEqual(['솔레 1덱']);
    expect(at(w, 'saved-item-info').text()).toContain('상대 크라켄 · 계산 전');

    // 계정 폴더(가짜 디스크)에 그 계정의 문서로 남았다.
    const saved = disk.decks.get('me') as { kind: string; slots: ({ members: (string | null)[]; total_damage: number | null } | null)[]; saved: { name: string; members: (string | null)[] }[] };
    expect(saved.kind).toBe('deck_book');
    expect(saved.slots.map((s) => s?.members ?? null)).toEqual([null, DECK, null, null, null]);
    expect(saved.slots[1]?.total_damage).toBe(total(DECK));
    expect(saved.saved.map((d) => [d.name, d.members])).toEqual([['솔레 1덱', [...DECK.slice(0, 4), null]]]);
    w.unmount();

    // 다시 켠다: 저장한 편성이 그대로 보이고, 불러오면 자리와 상대가 돌아온다.
    localStorage.clear();
    const again = await render();
    await openDeck(again);
    expect(all(again, 'book-slot')[1].find('[data-testid="book-slot-name"]').text()).toBe('편성 02');
    expect(texts(again, 'saved-item-name')).toEqual(['솔레 1덱']);
    expect(slotNames(again)).toEqual([null, null, null, null, null]);
    await all(again, 'book-slot')[1].find('[data-testid="book-load"]').trigger('click');
    await flushPromises();
    expect(slotNames(again)).toEqual(DECK);
    expect(at(again, 'opponent-name').text()).toBe('상대 크라켄');
    await at(again, 'saved-load').trigger('click');
    expect(slotNames(again)).toEqual([...DECK.slice(0, 4), null]);

    // 비우고 지운다.
    await all(again, 'book-slot')[1].find('[data-testid="book-clear"]').trigger('click');
    await at(again, 'saved-remove').trigger('click');
    await flushPromises();
    expect(all(again, 'book-slot').every((s) => s.attributes('data-filled') === 'no')).toBe(true);
    expect(at(again, 'saved-empty').exists()).toBe(true);
    const cleared = disk.decks.get('me') as { slots: unknown[]; saved: unknown[] };
    expect(cleared.slots).toEqual([null, null, null, null, null]);
    expect(cleared.saved).toEqual([]);
  });

  it('저장하지 못하면 알리고 되돌린다. 계정마다 따로다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK.slice(0, 2));
    api.saveDecks.mockRejectedValueOnce('디스크가 가득 찼다');
    await all(w, 'book-save')[0].trigger('click');
    await flushPromises();
    expect(at(w, 'book-problem').text()).toContain('편성을 저장하지 못했다: 디스크가 가득 찼다');
    expect(all(w, 'book-slot')[0].attributes('data-filled')).toBe('no');
    expect(disk.decks.has('me')).toBe(false);

    await all(w, 'book-save')[0].trigger('click');
    await flushPromises();
    expect(at(w, 'book-problem').exists()).toBe(false);
    expect(all(w, 'book-slot')[0].attributes('data-filled')).toBe('yes');

    // 다른 계정으로 바꾸면 그 계정의 것(없다)을 본다.
    disk.addAccount('sub', largeAccount);
    disk.chosen = 'sub';
    disk.emit();
    await flushPromises();
    expect(all(w, 'book-slot').every((s) => s.attributes('data-filled') === 'no')).toBe(true);
    expect(disk.decks.has('sub')).toBe(false);
  });
});

describe('요격전 추천에서 가져오기 · 편성 복사', () => {
  /** 샘플 결과의 보스 다섯을 이상 개체 보스 다섯으로 바꾼 지어낸 추천 결과(편성과 수치는 샘플 그대로). */
  function anomalyReport(): InterceptReport {
    const report = structuredClone(interceptFixture) as unknown as InterceptReport;
    report.bosses.forEach((b, i) => {
      const real = bundle.bosses[i];
      b.id = real.id;
      b.name = real.name;
      b.element = { ...b.element, code: real.enemy.code, weak_to: real.weak_to };
      b.weak_pool = null;
    });
    return report;
  }

  it('요격전 추천 결과의 편성을 「덱 빌더에서 열기」로 가져온다 — 자리 순서와 그 보스가 그대로 온다', async () => {
    disk.addAccount('me', sampleAccount);
    const report = anomalyReport();
    disk.putIntercept(report);
    localStorage.setItem('nikke-companion.intercept.boss', 'kraken');
    const w = await render();
    await openPage(w, 'intercept');
    const boss = report.bosses.find((b) => b.id === 'kraken')!;
    const first = boss.ranking[0].members.map((m) => m.name);
    const button = at(w, 'open-in-deck');
    expect(button.text()).toBe('덱 빌더에서 열기');
    await button.trigger('click');
    await idle(w);
    expect(currentPage(w)).toBe('tools');
    expect(at(w, 'tool-deck').attributes('aria-selected')).toBe('true');
    expect(slotNames(w)).toEqual(first);
    expect(at(w, 'opponent-name').text()).toBe('상대 크라켄');

    // 2위 편성을 보고 있으면 그 편성이 온다.
    await openPage(w, 'intercept');
    if (boss.ranking.length > 1) {
      await all(w, 'rank-pick')[0].trigger('click');
      await at(w, 'open-in-deck').trigger('click');
      await flushPromises();
      expect(slotNames(w)).toEqual(boss.ranking[1].members.map((m) => m.name));
    }
  });

  it('편성을 글자로 클립보드에 복사한다: 자리 순서대로 이름, 상대, 총딜, 「추정」 표시', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    // 아무도 없으면 복사할 것이 없다.
    expect(at(w, 'deck-copy').attributes('disabled')).toBeDefined();
    await choose(w, 'boss:kraken');
    await fill(w, DECK);

    // 계산 전: 총딜을 지어내지 않는다.
    await at(w, 'deck-copy').trigger('click');
    await flushPromises();
    expect(disk.clipboard).toEqual([['편성: 1. 리틀 머메이드 / 2. 크라운 / 3. 라피 : 레드 후드 / 4. 헬름 / 5. 앨리스', '상대: 크라켄 (약점 풍압)', '총딜 계산 전'].join('\n')]);
    expect(at(w, 'deck-copied').text()).toBe('편성을 복사했다(이름·상대 — 총딜은 계산 전이다).');

    await calc(w);
    await at(w, 'deck-copy').trigger('click');
    await flushPromises();
    expect(disk.clipboard[1]).toBe(
      ['편성: 1. 리틀 머메이드 / 2. 크라운 / 3. 라피 : 레드 후드 / 4. 헬름 / 5. 앨리스', '상대: 크라켄 (약점 풍압)', `총딜 ${damageUnit(total(DECK))} (추정 · 실전 미대조 · 내 계정 육성 기준)`].join('\n'),
    );
    expect(at(w, 'deck-copied').text()).toBe('편성을 복사했다(이름·상대·추정 총딜).');
    // 화면이 넘긴 것은 글자뿐이다.
    expect(api.copyText).toHaveBeenLastCalledWith(disk.clipboard[1]);

    // 복사하지 못하면 무슨 일인지 말한다.
    api.copyText.mockRejectedValueOnce('다른 프로그램이 클립보드를 쓰고 있어 복사하지 못했다. 잠시 뒤에 다시 누른다');
    await at(w, 'deck-copy').trigger('click');
    await flushPromises();
    expect(at(w, 'deck-copy-error').text()).toBe('복사하지 못했다. 다른 프로그램이 클립보드를 쓰고 있어 복사하지 못했다. 잠시 뒤에 다시 누른다');
    expect(disk.clipboard).toHaveLength(2);
  });
});

describe('계정이 없을 때 · 다른 화면과의 관계', () => {
  it('계정이 없으면 계정 연결 안내가 보인다', async () => {
    const w = await render();
    await openDeck(w);
    expect(at(w, 'deck-need-account').find('[data-testid="empty-title"]').text()).toBe('아직 계정을 연결하지 않았다');
    await at(w, 'deck-need-account').find('[data-testid="empty-action"]').trigger('click');
    expect(currentPage(w)).toBe('settings');
  });

  it('다른 탭·다른 화면에 다녀와도 짜던 편성과 결과가 남고, 계산 중에는 메뉴에 「계산 중」이 뜬다', async () => {
    disk.addAccount('me', sampleAccount);
    let release: (rows: EngineRow[]) => void = () => {};
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    api.engineRunBatch.mockImplementationOnce((requests) => new Promise((resolve) => (release = () => resolve(requests.map((r) => engineRow(r))))));
    await at(w, 'deck-run').trigger('click');
    await flushPromises();
    expect(at(w, 'nav-tools').find('[data-testid="nav-busy"]').exists()).toBe(true);
    expect(at(w, 'progress-panel').exists() || w.text().includes('편성을 계산하는 중')).toBe(true);
    // 계산 중에는 자리를 바꾸는 단추가 꺼진다.
    expect(all(w, 'slot-remove')[0].attributes('disabled')).toBeDefined();
    // 다른 탭을 봐도 계산은 이어진다.
    await at(w, 'tool-suggest').trigger('click');
    await openPage(w, 'home');
    release([]);
    await idle(w);
    await openPage(w, 'tools');
    await at(w, 'tool-deck').trigger('click');
    expect(slotNames(w)).toEqual(DECK);
    expect(at(w, 'deck-total').text()).toBe(damageUnit(total(DECK)));
    expect(at(w, 'nav-tools').find('[data-testid="nav-busy"]').exists()).toBe(false);
  });
});
