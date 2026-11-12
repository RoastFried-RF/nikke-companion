// 매일 쓰는 편의 기능(P-033)의 화면: 계정 여러 개(위쪽에서 바꾸기·숨기기·계정마다 따로 두는 것), 즐겨찾기와 「안 씀」(거르기·추천에서 빼기),
// 모듈 기록장(요격전 기록과 한 화면), 도구 링크(목록의 도구만 기본 브라우저로 — 이 앱이 하지 않는 것).
// 규칙 자체는 루트의 단위 테스트(tests/unit/journal·marks·links.test.mjs)가, 실제 엔진은 tests/integration/exclude.engine.test.mjs가 본다.
// Rust 쪽(backend)은 가짜다: 계정 폴더는 가짜 디스크(tests/helpers/shell.ts — Rust의 규칙을 흉내 낸다), 계산 도구는 가짜 엔진이다.
// 계정은 검증용 샘플(data/samples/account.sample.json)과 그 일부다 — 실제 계정은 쓰지 않는다. 브라우저도 실제로 열지 않는다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toolLinks from '../../data/links/tools.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { openLink, TOOL_LINKS } from '../src/lib/links';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { today } from '../src/lib/plan';
import { simCache } from '../src/lib/runtime';
import { createShared } from '../src/lib/shared';
import type { AccountDoc, EngineRequest, InterceptReport, PlanDoc } from '../src/types';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog, FAKE_EVALUATOR, fakeRow, sampleAccount } from './helpers/fakeEngine';
import { FakeDisk, installShell, openPage, openSection } from './helpers/shell';

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
const sample = interceptFixture as unknown as InterceptReport;
const main = sampleAccount as unknown as AccountDoc;
/** 부계: 샘플 계정의 니케 다섯만 가진 지어낸 계정(검증용). */
const sub: AccountDoc = {
  ...structuredClone(main),
  name: '검증용 부계',
  nikkes: Object.fromEntries(Object.entries(main.nikkes).filter(([name]) => ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '나가'].includes(name))),
};

let disk = new FakeDisk();
type Wrapper = ReturnType<typeof mount>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text().replace(/\s+/g, ' '));
const planOf = (name: string) => disk.plans.get(name) as PlanDoc;

async function render() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

async function click(w: Wrapper, testid: string): Promise<void> {
  await at(w, testid).trigger('click');
  await flushPromises();
}

/** 도는 계산이 끝날 때까지 기다린다(왼쪽 메뉴의 「계산 중」 표시가 사라질 때까지). */
async function idle(w: Wrapper): Promise<void> {
  await vi.waitFor(
    () => {
      if (at(w, 'nav-busy').exists()) throw new Error('아직 계산 중이다');
    },
    { timeout: 10000 },
  );
  await flushPromises();
}

/** 화면 위쪽의 계정 바꾸기로 계정을 고른다. */
async function switchTo(w: Wrapper, name: string): Promise<void> {
  await at(w, 'account-switch-select').setValue(name);
  await flushPromises();
}

const blankPlan = (over: Partial<PlanDoc> = {}): PlanDoc => ({ schema_version: 1, kind: 'intercept_plan', favorites: [], unused: [], records: [], rewards: [], ...over });

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
  api.accountSyncStatus.mockImplementation(async (name) => ({ name: name ?? 'main', cookie_saved: false, cookie_saved_at: null, profile_fetched_at: null, account_file: null, login_window_open: false, problems: [] }));
  api.extensionLinkStatus.mockResolvedValue({ enabled: false, listening: false, address: '127.0.0.1:47615', code: 'ABCD-2345', problem: null, pending: false, last: null, locked_seconds: 0 });
  api.onExtensionLink.mockResolvedValue(() => {});
});

// ── 계정 여러 개 ─────────────────────────────────────────────────────────────

describe('계정 여러 개', () => {
  function twoAccounts(): void {
    disk.addAccount('main', main);
    disk.addAccount('sub', sub);
    disk.chosen = 'main';
  }

  it('계정이 하나면 위쪽에 바꾸는 칸이 없고, 둘이면 어느 화면에서든 보인다', async () => {
    disk.addAccount('main', main);
    const one = await render();
    expect(at(one, 'account-switch').exists()).toBe(false);
    one.unmount();

    disk.addAccount('sub', sub);
    disk.chosen = 'main';
    const w = await render();
    for (const page of ['home', 'intercept', 'roster', 'tools', 'tier', 'settings'] as const) {
      await openPage(w, page);
      expect(at(w, 'account-switch').exists(), page).toBe(true);
    }
    const select = at(w, 'account-switch-select');
    expect((select.element as HTMLSelectElement).value).toBe('main');
    expect(select.findAll('option').map((o) => o.text())).toEqual(['main', 'sub']);
    expect(at(w, 'account-switch').text()).toContain('추천 · 기록 · 저장한 편성은 계정마다 따로다');
    // 「계정 관리」는 설정의 계정 연결을 연다.
    await openPage(w, 'home');
    await click(w, 'account-switch-manage');
    expect(at(w, 'settings-account').exists()).toBe(true);
  });

  it('바꾸면 그 계정의 니케·추천·기록·저장한 편성이 보인다 — 계정마다 따로다', async () => {
    twoAccounts();
    disk.saveIntercept(sample, 'main');
    disk.plans.set('main', blankPlan({ rewards: [{ id: 'm1', date: '2026-11-12', boss_id: 'kraken', boss_name: '크라켄', stage: 4, gear: { 머리: 0, 몸통: 0, 팔: 0, 다리: 0 }, modules: 2, note: null, created_at: null }] }));
    disk.decks.set('main', { schema_version: 1, kind: 'deck_book', slots: [{ name: '본계 편성', members: ['크라운', '헬름', null, null, null], opponent: null, opponent_label: null, total_damage: null, saved_at: null }, null, null, null, null], saved: [] });
    const w = await render();

    // 본계: 추천이 보이고, 니케는 여덟.
    await openPage(w, 'intercept');
    expect(at(w, 'account-line').text()).toBe('계정 main');
    expect(at(w, 'estimate-pill').exists()).toBe(true);
    await openPage(w, 'roster');
    expect(at(w, 'roster-count').text()).toBe('니케 8명');

    // 부계로 바꾼다: 니케는 다섯, 추천은 아직 없고(본계의 추천이 따라오지 않는다), 기록장도 비어 있다.
    await switchTo(w, 'sub');
    expect(api.setDefaultAccount).toHaveBeenCalledWith('sub');
    expect(at(w, 'roster-count').text()).toBe('니케 5명');
    await openPage(w, 'intercept');
    expect(at(w, 'account-line').text()).toBe('계정 sub');
    expect(at(w, 'estimate-pill').exists()).toBe(false);
    expect(at(w, 'hint').text()).toContain('아직 찾지 않았다');
    await click(w, 'intercept-view-journal');
    expect(at(w, 'journal-account').text()).toBe('계정 sub');
    expect(at(w, 'journal-empty').exists()).toBe(true);
    expect(at(w, 'journal-total-text').text()).toBe('0번 · 커스텀 모듈 0 · 장비 0');
    // 저장한 편성도 이 계정의 것(없다)이다.
    await openPage(w, 'tools');
    await click(w, 'tool-deck');
    expect(w.text()).not.toContain('본계 편성');

    // 부계로 추천을 계산하면 부계의 것으로 저장된다 — 본계의 것은 그대로다.
    await openPage(w, 'intercept');
    await click(w, 'intercept-view-recommend');
    await click(w, 'precision-fast');
    await click(w, 'run-intercept');
    await idle(w);
    expect(at(w, 'estimate-pill').exists()).toBe(true);
    expect((disk.intercepts.get('sub')?.doc as InterceptReport).account.name).toBe('검증용 부계');
    expect(disk.intercepts.get('main')?.doc).toEqual(sample);
    expect(api.saveInterceptResult.mock.calls.at(-1)?.[1]).toBe('sub');

    // 본계로 돌아가면 본계의 추천·기록·편성이 그대로 있다.
    await switchTo(w, 'main');
    expect(at(w, 'account-line').text()).toBe('계정 main');
    expect(at(w, 'restored-note').exists()).toBe(true);
    await click(w, 'intercept-view-journal');
    expect(texts(w, 'journal-reward-text')).toEqual(['커스텀 모듈 2']);
    await openPage(w, 'tools');
    expect(w.text()).toContain('본계 편성');
    w.unmount();

    // 앱을 다시 켜도 마지막으로 고른 계정과 그 계정의 것이 보인다.
    const again = await render();
    expect((at(again, 'account-switch-select').element as HTMLSelectElement).value).toBe('main');
  });

  it('덱 빌더의 계산 결과도 계정을 바꾸면 치운다 — 같은 다섯이어도 계정마다 육성이 다르다', async () => {
    twoAccounts();
    const w = await render();
    await openPage(w, 'tools');
    await click(w, 'tool-deck');
    // 두 계정이 모두 가진 다섯으로 짠다.
    for (const name of ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '나가']) {
      await w.findAll('[data-testid="deck-pick"]').find((b) => b.attributes('data-name') === name)!.trigger('click');
    }
    await flushPromises();
    await click(w, 'deck-run');
    await idle(w);
    expect(at(w, 'deck-error').exists()).toBe(false);
    expect(at(w, 'deck-total').exists()).toBe(true);

    await switchTo(w, 'sub');
    // 편성은 그대로다(이 계정에도 있는 니케들이다). 총딜은 앞 계정의 것이라 보이지 않는다 — 다시 계산해야 한다.
    expect(w.findAll('[data-testid="deck-pick"]').filter((b) => b.attributes('data-in') === 'yes')).toHaveLength(5);
    expect(at(w, 'deck-total').exists()).toBe(false);
    expect(at(w, 'deck-stale').exists()).toBe(false);
    await click(w, 'deck-run');
    await idle(w);
    expect(at(w, 'deck-total').exists()).toBe(true);
  });

  it('계산이 도는 동안에는 계정을 바꾸지 못한다 — 위쪽에서도 설정에서도', async () => {
    twoAccounts();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    api.engineRunBatch.mockImplementation(async (requests) => {
      await gate;
      return requests.map((r) => fakeRow(r));
    });
    const w = await render();
    await openPage(w, 'intercept');
    await click(w, 'precision-fast');
    await click(w, 'run-intercept');
    await vi.waitFor(() => expect(api.engineRunBatch).toHaveBeenCalled());
    await flushPromises();

    const select = at(w, 'account-switch-select');
    expect(select.attributes('disabled')).toBeDefined();
    expect(at(w, 'account-switch-locked').text()).toBe('계산이 도는 동안에는 계정을 바꾸지 않는다 — 끝난 뒤에 바꾼다.');
    await openSection(w, 'account');
    expect(at(w, 'default-account').attributes('disabled')).toBeDefined();
    expect(at(w, 'account-locked').text()).toContain('계산이 도는 동안에는 계정을 바꾸지 않는다');
    expect(w.findAll('[data-testid="account-use"], [data-testid="account-hide"]').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    expect(api.setDefaultAccount).not.toHaveBeenCalled();

    open();
    await idle(w);
    expect(at(w, 'account-switch-select').attributes('disabled')).toBeUndefined();
    expect(at(w, 'account-switch-locked').exists()).toBe(false);
    // 결과는 계산을 시작한 계정의 것으로 저장됐다.
    expect(api.saveInterceptResult.mock.calls.at(-1)?.[1]).toBe('main');
    expect(disk.intercepts.has('main')).toBe(true);
    expect(disk.intercepts.has('sub')).toBe(false);
  });

  it('설정의 계정 목록: 숨기기는 지우기가 아니다 — 다시 보이게 할 수 있고, 지우려면 어디에 있는지 알려 준다', async () => {
    twoAccounts();
    disk.plans.set('sub', blankPlan({ favorites: ['크라운'] }));
    const w = await render();
    await openSection(w, 'account');
    expect(texts(w, 'account-item-name')).toEqual(['main', 'sub']);
    const item = (name: string) => w.findAll('[data-testid="account-item"]').find((li) => li.find('[data-testid="account-item-name"]').text() === name)!;
    expect(item('main').find('[data-testid="account-item-current"]').text()).toBe('지금 쓰는 계정');
    expect(item('main').find('[data-testid="account-use"]').exists()).toBe(false);
    expect(at(w, 'account-more-hint').text()).toContain('다른 이름으로 저장한다');

    // 「이 계정 쓰기」로도 바꾼다.
    await item('sub').find('[data-testid="account-use"]').trigger('click');
    await flushPromises();
    expect(at(w, 'account-state').text()).toBe('연결됨 · sub');

    // 부계를 숨긴다: 목록에서 빠지고 「숨긴 계정」으로 간다. 계정과 기록은 그대로 남아 있다.
    await item('sub').find('[data-testid="account-hide"]').trigger('click');
    await flushPromises();
    expect(api.setAccountHidden).toHaveBeenCalledWith('sub', true);
    expect(texts(w, 'account-item-name')).toEqual(['main']);
    expect(at(w, 'account-hidden').text()).toContain('지운 것이 아니다');
    expect(w.findAll('[data-testid="account-hidden-item"]').map((li) => li.find('strong').text())).toEqual(['sub']);
    expect(disk.accounts.has('sub')).toBe(true);
    expect(planOf('sub').favorites).toEqual(['크라운']);
    // 쓰던 계정을 숨겼으니 남은 계정(하나)을 쓴다. 고를 계정이 하나라 위쪽의 바꾸는 칸은 사라진다.
    expect(at(w, 'account-state').text()).toBe('연결됨 · main');
    expect(at(w, 'account-switch').exists()).toBe(false);
    expect(at(w, 'default-account').findAll('option').map((o) => o.element.value)).toEqual(['main']);

    // 완전히 지우려면: 앱에는 지우는 단추가 없다 — 어디에 무엇이 있는지 알려 준다.
    await w.find('[data-testid="account-hidden-item"] [data-testid="account-remove-how"]').trigger('click');
    expect(at(w, 'account-where').text()).toContain('이 앱에는 지우는 단추가 없다');
    expect(at(w, 'account-where-dir').text()).toBe('C:\\가짜\\계정 폴더');
    expect(w.findAll('[data-testid="account-where-item"]').map((li) => li.find('code').text())).toEqual(['sub.json', 'sub.intercept.json', 'sub.plan.json', 'sub.decks.json', 'sub.json.bak']);
    expect(w.findAll('button').some((b) => /^(지우기|삭제|계정 지우기)$/.test(b.text()))).toBe(false);

    // 다시 보이게 하면 목록으로 돌아온다(쓰는 계정은 그대로다 — 고르지 않았다).
    await click(w, 'account-unhide');
    expect(api.setAccountHidden).toHaveBeenLastCalledWith('sub', false);
    expect(texts(w, 'account-item-name')).toEqual(['main', 'sub']);
    expect(at(w, 'account-hidden').exists()).toBe(false);
    expect(at(w, 'account-switch').exists()).toBe(true);
    w.unmount();

    // 숨긴 것은 다시 켜도 숨겨져 있다.
    disk.hidden.add('sub');
    const again = await render();
    await openSection(again, 'account');
    expect(texts(again, 'account-item-name')).toEqual(['main']);
    // 모두 숨기면 그렇게 말한다.
    disk.hidden.add('main');
    disk.emit();
    await flushPromises();
    expect(at(again, 'all-hidden').text()).toContain('모두 목록에서 숨겼다');
    expect(at(again, 'account-state').text()).toBe('연결 안 됨');
  });

  it('계산하는 동안 쓰는 계정이 바뀌었으면 결과를 계산한 계정의 것으로만 저장하고 화면에는 올리지 않는다', async () => {
    twoAccounts();
    const { shared, start, dispose } = createShared();
    await start();
    expect(shared.accountName.value).toBe('main');
    // main으로 계산을 시작한 뒤 sub로 바뀌었다(계정을 새로 받는 흐름이 기본 계정을 바꾼 경우).
    await shared.setDefaultAccount('sub');
    await flushPromises();
    await shared.publishIntercept(structuredClone(sample), 'main');
    expect(shared.intercept.value).toBeNull();
    expect(shared.interceptProblem.value).toContain('main 계정의 것으로 저장했다');
    expect(disk.intercepts.get('main')?.doc).toEqual(sample);
    expect(disk.intercepts.has('sub')).toBe(false);
    // 그 계정으로 돌아가면 보인다.
    await shared.setDefaultAccount('main');
    await flushPromises();
    expect(shared.intercept.value).toEqual(sample);
    expect(shared.restored.value).toBe(true);
    expect(shared.interceptProblem.value).toBe('');
    dispose();
  });
});

// ── 즐겨찾기 · 안 씀 ─────────────────────────────────────────────────────────

describe('즐겨찾기와 「안 씀」', () => {
  const item = (w: Wrapper, name: string) => w.findAll('[data-testid="roster-item"]').find((li) => li.find('[data-testid="nikke-tile"]').attributes('data-name') === name || li.text().includes(name))!;
  const shownNames = (w: Wrapper) => w.findAll('[data-testid="roster-item"]').map((li) => li.find('[data-testid="nikke-tile-name"]').text());

  it('내 니케: 별과 「안 씀」을 붙이고 뗀다 — 둘은 함께 붙지 않고, 표시로 거른다', async () => {
    disk.addAccount('main', main);
    const w = await render();
    await openPage(w, 'roster');
    expect(at(w, 'roster-marks').text()).toBe('즐겨찾기 0명 · 안 씀 0명');

    const unused = () => item(w, '나가').find('[data-testid="roster-unused"]');
    expect(unused().attributes('aria-pressed')).toBe('false');
    expect(unused().attributes('title')).toContain('계정은 바뀌지 않는다');
    await unused().trigger('click');
    await flushPromises();
    expect(unused().attributes('aria-pressed')).toBe('true');
    expect(item(w, '나가').attributes('data-mark')).toBe('unused');
    expect(planOf('main').unused).toEqual(['나가']);

    await item(w, '크라운').find('[data-testid="roster-fav"]').trigger('click');
    await item(w, '미하라').find('[data-testid="roster-unused"]').trigger('click');
    await flushPromises();
    expect(at(w, 'roster-marks').text()).toBe('즐겨찾기 1명 · 안 씀 2명');

    // 즐겨찾기인 니케를 「안 씀」으로 표시하면 별이 내려간다.
    await item(w, '크라운').find('[data-testid="roster-unused"]').trigger('click');
    await flushPromises();
    expect(item(w, '크라운').find('[data-testid="roster-fav"]').attributes('aria-pressed')).toBe('false');
    expect(planOf('main').favorites).toEqual([]);
    // 다시 별을 누르면 「안 씀」이 내려간다.
    await item(w, '크라운').find('[data-testid="roster-fav"]').trigger('click');
    await flushPromises();
    expect(planOf('main')).toMatchObject({ favorites: ['크라운'], unused: ['나가', '미하라'] });
    // 계정 문서는 그대로다 — 표시일 뿐이다.
    expect(disk.accounts.get('main')?.doc).toEqual(main);

    // 거르기: 즐겨찾기만 · 안 씀만 · 안 씀 빼고. 다시 누르면 풀린다.
    const mark = (key: string) => w.findAll('[data-testid="filter-mark"]').find((b) => b.attributes('data-mark') === key)!;
    expect(texts(w, 'filter-mark')).toEqual(['즐겨찾기', '안 씀', '안 씀 빼고']);
    await mark('favorite').trigger('click');
    expect(shownNames(w)).toEqual(['크라운']);
    await mark('unused').trigger('click');
    expect(shownNames(w).sort()).toEqual(['나가', '미하라']);
    expect(at(w, 'roster-shown').text()).toBe('2명');
    await mark('active').trigger('click');
    expect(shownNames(w)).toHaveLength(6);
    expect(shownNames(w)).not.toContain('나가');
    await mark('active').trigger('click');
    expect(shownNames(w)).toHaveLength(8);
    w.unmount();

    // 다시 켜도 표시가 남아 있다.
    const again = await render();
    await openPage(again, 'roster');
    expect(item(again, '나가').find('[data-testid="roster-unused"]').attributes('aria-pressed')).toBe('true');
    expect(item(again, '크라운').find('[data-testid="roster-fav"]').attributes('aria-pressed')).toBe('true');
  });

  it('덱 빌더의 보유 니케: 표시가 보이고 표시로 거른다 — 「안 씀」 니케도 넣을 수는 있다', async () => {
    disk.addAccount('main', main);
    disk.plans.set('main', blankPlan({ favorites: ['크라운'], unused: ['나가'] }));
    const w = await render();
    await openPage(w, 'tools');
    await click(w, 'tool-deck');
    const pick = (name: string) => w.findAll('[data-testid="deck-pick"]').find((b) => b.attributes('data-name') === name)!;
    const names = () => w.findAll('[data-testid="deck-pick"]').map((b) => b.attributes('data-name'));
    expect(names()).toHaveLength(8);
    expect(pick('크라운').find('[data-testid="deck-pick-mark"]').text()).toBe('★ 즐겨찾기');
    expect(pick('나가').find('[data-testid="deck-pick-mark"]').text()).toBe('안 씀');
    expect(pick('나가').attributes('title')).toBe('나가 · 안 씀으로 표시한 니케 — 편성에 넣기');
    expect(pick('헬름').find('[data-testid="deck-pick-mark"]').exists()).toBe(false);

    const mark = (key: string) => w.findAll('[data-testid="deck-filter-mark"]').find((b) => b.attributes('data-mark') === key)!;
    await mark('favorite').trigger('click');
    expect(names()).toEqual(['크라운']);
    await mark('active').trigger('click');
    expect(names()).toHaveLength(7);
    expect(names()).not.toContain('나가');
    expect(at(w, 'deck-roster-count').text()).toBe('7명');
    await mark('unused').trigger('click');
    expect(names()).toEqual(['나가']);
    // 표시는 거르기일 뿐이다 — 손으로 짜는 편성에는 넣을 수 있다.
    await pick('나가').trigger('click');
    await flushPromises();
    expect(pick('나가').attributes('data-in')).toBe('yes');
  });

  it('요격전 추천: 「안 씀」 니케를 빼는 선택 — 빼면 어느 편성에도 없고, 뺐다는 사실이 결과에 배지로 남는다', async () => {
    disk.addAccount('main', main);
    disk.plans.set('main', blankPlan({ unused: ['앨리스', '계정에 없는 니케'] }));
    const squads = () => api.engineRunBatch.mock.calls.flatMap(([requests]) => (requests as EngineRequest[]).map((r) => r.squad as string[]));
    const w = await render();
    await openPage(w, 'intercept');
    await click(w, 'precision-fast');

    // 기본은 빼지 않는다: 단추가 꺼져 있고, 계산에 앨리스가 든 편성이 있다. 결과에 표시도 없다.
    const toggle = () => at(w, 'exclude-unused');
    expect(toggle().element.tagName).toBe('BUTTON');
    expect(toggle().attributes('aria-pressed')).toBe('false');
    expect(toggle().text()).toBe('「안 씀」 니케 빼기 (2명)');
    await click(w, 'run-intercept');
    await idle(w);
    expect(squads().some((s) => s.includes('앨리스'))).toBe(true);
    expect(at(w, 'excluded-pill').exists()).toBe(false);
    expect((disk.intercept as InterceptReport).excluded).toBeUndefined();

    // 켜고 다시 계산한다.
    api.engineRunBatch.mockClear();
    await toggle().trigger('click');
    expect(toggle().attributes('aria-pressed')).toBe('true');
    expect(toggle().text()).toBe('「안 씀」 니케 빼는 중 (2명)');
    expect(localStorage.getItem('nikke-companion.recommend.exclude-unused')).toBe('on');
    await click(w, 'run-intercept');
    await idle(w);
    expect(at(w, 'error').exists()).toBe(false);
    expect(squads().length).toBeGreaterThan(0);
    expect(squads().every((s) => !s.includes('앨리스'))).toBe(true);
    // 뺐다는 사실: 접힌 구획 밖의 배지(누구를 뺐는지는 풍선 도움말)와 계산 조건의 한 줄, 그리고 저장된 결과.
    const pill = at(w, 'excluded-pill');
    expect(pill.text()).toBe('안 씀 1명 제외');
    expect(pill.attributes('title')).toBe('「안 씀」으로 표시한 니케 1명을 빼고 계산했다: 앨리스.');
    expect(pill.element.closest('details')).toBeNull();
    expect(texts(w, 'caveat-item')).toContain('「안 씀」으로 표시한 니케 1명을 빼고 계산했다: 앨리스.');
    const saved = disk.intercept as InterceptReport;
    expect(saved.excluded).toMatchObject({ reason: 'unused', label: '안 씀', names: ['앨리스'], count: 1 });
    expect(w.findAll('[data-testid="nikke-tile-name"]').every((n) => n.text() !== '앨리스')).toBe(true);
    w.unmount();

    // 앱을 다시 켜도 선택과 배지가 남아 있다.
    const again = await render();
    await openPage(again, 'intercept');
    expect(at(again, 'exclude-unused').attributes('aria-pressed')).toBe('true');
    expect(at(again, 'excluded-pill').text()).toBe('안 씀 1명 제외');
  });

  it('편성 도구의 추천에도 같은 선택이 있다', async () => {
    disk.addAccount('main', main);
    disk.plans.set('main', blankPlan({ unused: ['앨리스'] }));
    const squads = () => api.engineRunBatch.mock.calls.flatMap(([requests]) => (requests as EngineRequest[]).map((r) => r.squad as string[]));
    const w = await render();
    await openPage(w, 'tools');
    await click(w, 'precision-fast');
    expect(at(w, 'suggest-unused-count').text()).toBe('(1명)');
    const box = at(w, 'suggest-exclude-unused');
    expect((box.element as HTMLInputElement).checked).toBe(false);
    await box.setValue(true);
    await click(w, 'run-suggest');
    await idle(w);
    expect(at(w, 'error').exists()).toBe(false);
    expect(squads().length).toBeGreaterThan(0);
    expect(squads().every((s) => !s.includes('앨리스'))).toBe(true);
    expect(at(w, 'excluded-pill').text()).toBe('안 씀 1명 제외');
    expect(at(w, 'excluded-pill').element.closest('details')).toBeNull();
    // 끄고 다시 추천하면 표시가 사라지고 앨리스가 돌아온다.
    api.engineRunBatch.mockClear();
    simCache.clear();
    await at(w, 'suggest-exclude-unused').setValue(false);
    await click(w, 'run-suggest');
    await idle(w);
    expect(at(w, 'excluded-pill').exists()).toBe(false);
    expect(squads().some((s) => s.includes('앨리스'))).toBe(true);
  });
});

// ── 모듈 기록장 ──────────────────────────────────────────────────────────────

describe('모듈 기록장', () => {
  async function openJournal(): Promise<Wrapper> {
    const w = await render();
    await openPage(w, 'intercept');
    await click(w, 'intercept-view-journal');
    return w;
  }

  async function write(w: Wrapper, input: { date?: string; boss?: string; stage?: string; gear?: Record<string, string>; modules?: string }): Promise<void> {
    await at(w, 'journal-date').setValue(input.date ?? today());
    if (input.boss !== undefined) await at(w, 'journal-boss').setValue(input.boss);
    await at(w, 'journal-stage').setValue(input.stage ?? '');
    for (const field of w.findAll('[data-testid="journal-gear"]')) await field.setValue(input.gear?.[field.attributes('data-part') ?? ''] ?? '');
    await at(w, 'journal-modules').setValue(input.modules ?? '');
    await at(w, 'journal-form').trigger('submit');
    await flushPromises();
  }

  it('요격전 화면의 「기록장」: 날짜·보스·달성 단계·얻은 것을 적으면 저장되고, 주·월 합계와 보스별 횟수가 보인다', async () => {
    disk.addAccount('main', main);
    const w = await openJournal();
    expect(at(w, 'intercept-view-journal').attributes('aria-selected')).toBe('true');
    expect(at(w, 'journal-board').exists()).toBe(true);
    // 보스는 이상 개체 다섯(앱에 든 보스 정보), 부위는 넷, 날짜는 오늘이다.
    expect(at(w, 'journal-boss').findAll('option').map((o) => o.text())).toEqual(['보스를 고른다', '인디빌리아', '울트라', '하베스터', '크라켄', '미러 컨테이너']);
    expect(w.findAll('[data-testid="journal-gear"]').map((f) => f.attributes('data-part'))).toEqual(['머리', '몸통', '팔', '다리']);
    expect((at(w, 'journal-date').element as HTMLInputElement).value).toBe(today());
    expect(at(w, 'journal-empty').text()).toBe('아직 적어 둔 기록이 없다.');
    expect(texts(w, 'journal-boss-runs')).toEqual(['0번', '0번', '0번', '0번', '0번']);
    // 모르는 것과 정한 것은 접지 않는다.
    const notes = w.findAll('[data-testid="journal-note"]');
    expect(notes.map((n) => n.text())).toEqual([
      '손으로 적은 것만 센다 — 보상이 나올 확률과 한 번에 얻는 수는 이 앱이 모른다.',
      '주는 월요일부터 일요일까지로 묶었다(달력 기준이다 — 게임의 초기화 시각과 다를 수 있다).',
    ]);
    expect(notes.every((n) => n.element.closest('details') === null)).toBe(true);

    await at(w, 'journal-boss').setValue('ultra');
    expect(at(w, 'journal-boss-reward').text()).toContain('울트라의 보상: 머리 장비');
    await write(w, { boss: 'ultra', stage: '3', gear: { 머리: '1' } });
    await write(w, { boss: 'kraken', stage: '4', modules: '2' });
    await write(w, { date: '2025-01-05', boss: 'kraken', modules: '1' });
    expect(at(w, 'journal-error').exists()).toBe(false);

    // 저장: 계정 폴더의 계획 문서(rewards)에 — 요격전 기록·즐겨찾기와 같은 문서다.
    expect(planOf('main').rewards).toMatchObject([
      { id: 'm1', date: today(), boss_id: 'ultra', boss_name: '울트라', stage: 3, gear: { 머리: 1, 몸통: 0, 팔: 0, 다리: 0 }, modules: 0 },
      { id: 'm2', date: today(), boss_id: 'kraken', boss_name: '크라켄', stage: 4, modules: 2 },
      { id: 'm3', date: '2025-01-05', boss_id: 'kraken', stage: null, modules: 1 },
    ]);
    expect(api.savePlan).toHaveBeenCalledTimes(3);

    // 합: 이번 주·이번 달에는 오늘 적은 둘, 전체에는 셋.
    expect(at(w, 'journal-week-text').text()).toBe('2번 · 커스텀 모듈 2 · 장비 1(머리 1)');
    expect(at(w, 'journal-month-text').text()).toBe('2번 · 커스텀 모듈 2 · 장비 1(머리 1)');
    expect(at(w, 'journal-total-text').text()).toBe('3번 · 커스텀 모듈 3 · 장비 1(머리 1)');
    // 보스별 횟수(많이 돈 순서).
    const counts = w.findAll('[data-testid="journal-boss-count"]');
    expect(counts.map((c) => [c.attributes('data-boss'), c.find('[data-testid="journal-boss-runs"]').text()])).toEqual([
      ['kraken', '2번'],
      ['ultra', '1번'],
      ['indivilia', '0번'],
      ['harvester', '0번'],
      ['mirror_container', '0번'],
    ]);
    expect(counts[0].find('[data-testid="journal-boss-detail"]').text()).toContain(`마지막 ${today()} · 가장 높은 달성 단계 4 · 커스텀 모듈 3 · 장비 0`);
    expect(counts[2].find('[data-testid="journal-boss-detail"]').text()).toBe('아직 적은 것이 없다');
    // 주별·월별 합은 접어 둔다.
    const fold = at(w, 'journal-periods');
    expect(fold.element.tagName).toBe('DETAILS');
    expect(fold.findAll('[data-testid="journal-week-item"]')).toHaveLength(2);
    expect(fold.findAll('[data-testid="journal-month-item"]').at(-1)?.text()).toBe('2025년 1월 — 1번 · 커스텀 모듈 1 · 장비 0');

    // 날짜별: 최근이 앞, 같은 날에는 나중에 적은 것이 앞.
    expect(texts(w, 'journal-day-date')).toEqual([today(), '2025-01-05']);
    const first = w.findAll('[data-testid="journal-day"]')[0];
    const line = (li: (typeof first)) => [li.find('strong').text(), li.find('[data-testid="journal-reward-stage"]').text(), li.find('[data-testid="journal-reward-text"]').text()];
    expect(first.findAll('[data-testid="journal-reward"]').map(line)).toEqual([
      ['크라켄', '달성 단계 4', '커스텀 모듈 2'],
      ['울트라', '달성 단계 3', '머리 장비 1'],
    ]);
    expect(first.findAll('[data-testid="journal-reward"]').every((li) => li.find('[data-testid="status-pill"]').text() === '보상')).toBe(true);

    // 지우면 합에서도 빠진다.
    await first.find('[data-testid="journal-reward-remove"]').trigger('click');
    await flushPromises();
    expect(planOf('main').rewards?.map((r) => r.id)).toEqual(['m1', 'm3']);
    expect(at(w, 'journal-week-text').text()).toBe('1번 · 커스텀 모듈 0 · 장비 1(머리 1)');
    w.unmount();

    // 앱을 다시 켜도 남아 있다.
    const again = await openJournal();
    expect(at(again, 'journal-total-text').text()).toBe('2번 · 커스텀 모듈 1 · 장비 1(머리 1)');
  });

  it('요격전 대미지 기록(P-029)과 한 화면에서 본다 — 같은 날짜 아래에 나란히', async () => {
    disk.addAccount('main', main);
    disk.saveIntercept(sample, 'main');
    disk.plans.set(
      'main',
      blankPlan({
        records: [
          { id: 'r1', boss_id: 'test-a', boss_name: '검증용 보스 A', damage: 4_153_000_000, mode: 'mock', date: '2026-11-10', stage: 4, note: null, created_at: null },
          { id: 'r2', boss_id: 'test-b', boss_name: '검증용 보스 B', damage: 900_000_000, mode: 'real', date: '2026-11-09', stage: null, note: null, created_at: null },
        ],
        rewards: [{ id: 'm1', date: '2026-11-10', boss_id: 'test-a', boss_name: '검증용 보스 A', stage: 4, gear: { 머리: 0, 몸통: 1, 팔: 0, 다리: 0 }, modules: 0, note: null, created_at: null }],
      }),
    );
    const w = await openJournal();
    // 추천 결과가 있으면 보스 목록은 그 결과의 보스들이다.
    expect(at(w, 'journal-boss').findAll('option').map((o) => o.text()).slice(1)).toEqual(sample.bosses.map((b) => b.name));
    const days = w.findAll('[data-testid="journal-day"]');
    expect(days.map((d) => d.attributes('data-date'))).toEqual(['2026-11-10', '2026-11-09']);
    expect(days[0].find('[data-testid="journal-reward-text"]').text()).toBe('몸통 장비 1');
    const damage = days[0].find('[data-testid="journal-damage"]');
    expect(damage.find('[data-testid="status-pill"]').text()).toBe('모의전');
    expect(damage.find('strong').text()).toBe('검증용 보스 A');
    expect(damage.find('[data-testid="journal-damage-value"]').text()).toBe('대미지 41.53억');
    expect(damage.text()).toContain('달성 단계 4');
    expect(days[1].find('[data-testid="journal-reward"]').exists()).toBe(false);
    expect(days[1].find('[data-testid="journal-damage-value"]').text()).toBe('대미지 9.00억');
    // 대미지 기록은 합(얻은 것)에 세지 않는다.
    expect(at(w, 'journal-total-text').text()).toBe('1번 · 커스텀 모듈 0 · 장비 1(몸통 1)');

    // 여기서 지운 대미지 기록은 추천 보기의 「내 기록」에서도 사라진다(같은 문서다).
    await days[1].find('[data-testid="journal-damage-remove"]').trigger('click');
    await flushPromises();
    expect(planOf('main').records.map((r) => r.id)).toEqual(['r1']);
    expect(w.findAll('[data-testid="journal-day"]').map((d) => d.attributes('data-date'))).toEqual(['2026-11-10']);
    await click(w, 'intercept-view-recommend');
    expect(at(w, 'record-panel').exists()).toBe(true);
    expect(at(w, 'estimate-pill').text()).toContain('추정');
  });

  it('값이 맞지 않으면 이유를 말하고 적지 않는다 — 저장하지 못하면 되돌린다', async () => {
    disk.addAccount('main', main);
    const w = await openJournal();
    await write(w, { stage: '4', modules: '2' });
    expect(at(w, 'journal-error').text()).toContain('기록을 적지 못했다. 어느 보스를 돌았는지 고르지 않았다');
    await write(w, { boss: 'kraken', stage: '사' });
    expect(at(w, 'journal-error').text()).toContain('달성 단계는 1~99의 정수다');
    await write(w, { boss: 'kraken', gear: { 머리: '많이' } });
    expect(at(w, 'journal-error').text()).toContain('부위마다 0~99의 정수다');
    await write(w, { boss: 'kraken', modules: '1000' });
    expect(at(w, 'journal-error').text()).toContain('커스텀 모듈의 수는 0~999의 정수다');
    await write(w, { boss: 'kraken', date: '' });
    expect(at(w, 'journal-error').text()).toContain('날짜는 2026-11-12처럼 적는다');
    expect(api.savePlan).not.toHaveBeenCalled();
    expect(at(w, 'journal-empty').exists()).toBe(true);

    api.savePlan.mockRejectedValueOnce('요격전 기록을(를) 저장하지 못했다 (디스크가 가득 찼다)');
    await write(w, { boss: 'kraken', modules: '1' });
    expect(at(w, 'journal-error').text()).toContain('저장하지 못했다');
    expect(at(w, 'journal-reward').exists()).toBe(false);
    // 얻은 것이 없어도 돈 것은 적을 수 있다(횟수에 든다).
    await write(w, { boss: 'kraken' });
    expect(at(w, 'journal-error').exists()).toBe(false);
    expect(at(w, 'journal-reward-text').text()).toBe('얻은 것 없음');
    expect(at(w, 'journal-total-text').text()).toBe('1번 · 커스텀 모듈 0 · 장비 0');
  });

  it('기록장 보기는 다른 화면에 다녀와도 남고, 다른 화면에서 보스를 보러 오면 추천 보기로 열린다', async () => {
    disk.addAccount('main', main);
    disk.saveIntercept(sample, 'main');
    const w = await openJournal();
    expect(at(w, 'intercept-controls').exists()).toBe(false);
    // 왼쪽 메뉴로 다른 화면에 다녀와도 보던 보기(기록장)가 남는다.
    await openPage(w, 'home');
    await openPage(w, 'intercept');
    expect(at(w, 'journal-board').exists()).toBe(true);
    // 홈의 보스 카드를 눌러 오면(그 보스의 추천을 보려는 것이다) 추천 보기다.
    await openPage(w, 'home');
    await w.find('[data-testid="home-bosses"] [data-testid="boss-card"]').trigger('click');
    await flushPromises();
    expect(at(w, 'page-intercept').exists()).toBe(true);
    expect(at(w, 'journal-board').exists()).toBe(false);
    expect(at(w, 'intercept-controls').exists()).toBe(true);
    expect(at(w, 'intercept-view-recommend').attributes('aria-selected')).toBe('true');
  });
});

// ── 도구 링크 ────────────────────────────────────────────────────────────────

describe('도구 링크', () => {
  async function openLinks(): Promise<Wrapper> {
    const w = await render();
    await openSection(w, 'links');
    return w;
  }

  it('커뮤니티 도구 열셋이 이름·한 줄 설명·주소와 함께 보이고, 출처가 모음집 글임을 적었다', async () => {
    const w = await openLinks();
    expect(at(w, 'section-links').text()).toBe('다른 도구');
    const items = w.findAll('[data-testid="link-item"]');
    expect(items).toHaveLength(13);
    expect(items.map((li) => [li.find('[data-testid="link-name"]').text(), li.find('[data-testid="link-url"]').text()])).toEqual(toolLinks.links.map((l) => [l.name, l.url]));
    expect(items.map((li) => li.find('[data-testid="link-description"]').text())).toEqual(toolLinks.links.map((l) => l.description));
    expect(items.every((li) => li.find('[data-testid="link-description"]').text().length > 0)).toBe(true);
    expect(at(w, 'links-source').text()).toContain('출처: 니케 마이너 갤러리의 글 「니케 유용한 툴 모음집」');
    expect(at(w, 'links-source').text()).toContain('이 앱은 이 사이트들의 내용을 가져오지 않는다');
    // 열어 본 기록에 기능이 남아 있지 않은 도구에는 그렇게 표시한다.
    expect(items.filter((li) => li.find('[data-testid="link-basis"]').exists()).map((li) => li.attributes('data-link'))).toEqual(toolLinks.links.filter((l) => l.basis === 'category').map((l) => l.id));
    // 화면을 여는 것만으로는 아무것도 열리지 않고, 가져오지도 않는다.
    expect(api.openToolLink).not.toHaveBeenCalled();
  });

  it('누르면 그 도구의 id만 넘겨 기본 브라우저로 연다 — 화면에 바깥으로 가는 링크나 주소 칸은 없다', async () => {
    api.openToolLink.mockImplementation(async (id: string) => {
      disk.opened.push(id);
      const link = toolLinks.links.find((l) => l.id === id)!;
      return { id, name: link.name, url: link.url };
    });
    const w = await openLinks();
    const item = (id: string) => w.findAll('[data-testid="link-item"]').find((li) => li.attributes('data-link') === id)!;
    await item('nikke-gear').find('[data-testid="link-open"]').trigger('click');
    await flushPromises();
    expect(api.openToolLink).toHaveBeenCalledTimes(1);
    expect(api.openToolLink.mock.calls[0]).toEqual(['nikke-gear']);
    expect(at(w, 'links-opened').text()).toBe('니케 장비 현황 — 기본 브라우저로 열었다.');

    // 단추마다 넘기는 것은 목록의 id다 — 열셋을 모두 눌러 본다.
    for (const li of w.findAll('[data-testid="link-item"]')) {
      await li.find('[data-testid="link-open"]').trigger('click');
      await flushPromises();
    }
    expect(disk.opened.slice(1)).toEqual(toolLinks.links.map((l) => l.id));
    for (const [arg, ...rest] of api.openToolLink.mock.calls) {
      expect(rest).toEqual([]);
      expect(toolLinks.links.some((l) => l.id === arg)).toBe(true);
      expect(String(arg)).not.toMatch(/[:/.]/);
    }
    // 바깥으로 가는 링크(a 태그)·주소를 적는 칸·붙여넣는 칸이 없다.
    const section = at(w, 'settings-links');
    expect(section.findAll('a')).toHaveLength(0);
    expect(section.findAll('input, textarea, select, iframe, form')).toHaveLength(0);
  });

  it('목록에 없는 것은 열지 않는다 — 화면 코드가 주소를 넘겨도 Rust에 가지 않는다', async () => {
    for (const bad of ['https://evil.example/', 'letsdoro.com', 'file:///C:/Windows/System32/calc.exe', '', 'unknown-tool', '../letsdoro']) {
      await expect(openLink(bad)).rejects.toThrow('목록에 없는 도구다 — 열지 않았다');
    }
    expect(api.openToolLink).not.toHaveBeenCalled();
    // 목록에 있는 id는 넘어간다.
    await openLink('letsdoro');
    expect(api.openToolLink.mock.calls).toEqual([['letsdoro']]);
    expect(TOOL_LINKS.links).toHaveLength(13);
  });

  it('열지 못하면 무슨 일인지와 무엇을 하면 되는지를 말한다', async () => {
    api.openToolLink.mockRejectedValueOnce('기본 브라우저로 열지 못했다 (오류 번호 31). 주소를 직접 브라우저에 적어 연다');
    const w = await openLinks();
    await w.find('[data-testid="link-open"]').trigger('click');
    await flushPromises();
    expect(at(w, 'links-error').text()).toBe('열지 못했다. 기본 브라우저로 열지 못했다 (오류 번호 31). 주소를 직접 브라우저에 적어 연다');
    expect(at(w, 'links-opened').exists()).toBe(false);
    // 주소는 글자로 보이므로 직접 적어 열 수 있다.
    expect(w.find('[data-testid="link-url"]').text()).toBe('https://letsdoro.com/');
  });

  it('이 앱이 하지 않는 것: PVP 계산 · 통계·랭킹 · 스토리 열람 · 유니온 구인 — 까닭을 적고 해당 도구로 안내한다', async () => {
    const w = await openLinks();
    const box = at(w, 'links-unsupported');
    expect(box.find('h2').text()).toBe('이 앱이 하지 않는 것');
    const topics = box.findAll('[data-testid="unsupported-item"]');
    expect(topics.map((t) => t.find('[data-testid="unsupported-topic"]').text())).toEqual(['PVP 계산', '통계·랭킹', '스토리 열람', '유니온 구인']);
    expect(topics.every((t) => t.find('[data-testid="unsupported-pill"]').text() === '지원하지 않음')).toBe(true);
    const reason = (i: number) => topics[i].find('[data-testid="unsupported-reason"]').text();
    expect(reason(0)).toBe('이 앱의 계산 도구는 PVP(아레나)를 계산하지 않는다 — 지원하지 않음.');
    expect(reason(1)).toContain('서버 데이터가 필요하다');
    expect(reason(2)).toContain('스토리 자료가 없다');
    expect(reason(3)).toContain('다른 플레이어와 이어지지 않는다');
    // 접지 않는다.
    expect(box.element.closest('details')).toBeNull();
    expect(box.find('details').exists()).toBe(false);
    // 안내하는 도구는 목록에 있는 것이고, 누르면 그 id로 연다.
    const buttons = (i: number) => topics[i].findAll('[data-testid="unsupported-open"]');
    expect(buttons(0).map((b) => b.text())).toEqual(['NIKKE PvP META 열기', 'NIKKE Arena Tools 열기']);
    expect(buttons(2).map((b) => b.text())).toEqual(['니케 금서고 열기']);
    expect(buttons(3).map((b) => b.text())).toEqual(['도로파티 열기']);
    await buttons(3)[0].trigger('click');
    await flushPromises();
    expect(api.openToolLink.mock.calls).toEqual([['doroparty']]);
  });
});
