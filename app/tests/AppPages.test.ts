// 데스크톱 앱 창의 화면들: 요격전 · 내 니케 · 편성 도구 · 티어 · 설정. (홈과 화면 사이의 흐름은 AppShell.test.ts가 본다.)
// Rust 쪽(backend)은 가짜다: 계정 폴더는 가짜 디스크, 계산 도구의 실행도 가짜다. 추천은 루트의 실제 코드(src/core)가 하고,
// 보여 주는 결과는 실제 CLI가 만든 샘플(tests/fixtures)이다. 이미지는 지어낸 것도 쓰지 않는다(없는 이미지 — 대체 그림).
import { summarizeInterceptBoss } from '@core/summary.mjs';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import largeAccount from '../../data/samples/account.large.sample.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { damageUnit } from '../src/lib/format';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { INTERCEPT_PRECISION, SUGGEST_PRECISION } from '../src/lib/precision';
import { simCache } from '../src/lib/runtime';
import type { AccountDoc, EngineRow, InterceptReport, TierReport } from '../src/types';
import growthFixture from './fixtures/growth.sample.json';
import interceptFixture from './fixtures/intercept.sample.json';
import tierFixture from './fixtures/tier.sample.json';
import { ACCOUNT_PATH, catalog, CONDITION_PATH, documents, FAKE_EVALUATOR, fakeRow, sampleAccount, SQUADS_PATH, UPGRADES_PATH } from './helpers/fakeEngine';
import { currentPage, FakeDisk, installShell, openLegacy, openPage, openSection, widgetOf } from './helpers/shell';

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
const tier = tierFixture as unknown as TierReport;
const account = sampleAccount as unknown as AccountDoc;

const TIER_RESULT = 'D:\\결과\\tier.json';
const GROWTH_RESULT = 'D:\\결과\\growth.json';
const files: Record<string, unknown> = { ...documents, [TIER_RESULT]: tierFixture, [GROWTH_RESULT]: growthFixture };

let disk = new FakeDisk();
type Wrapper = ReturnType<typeof mount>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());

async function render() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

/** 계산이 끝날 때까지(메뉴의 「계산 중」 점이 사라질 때까지) 기다린다. */
async function idle(w: Wrapper): Promise<void> {
  await vi.waitFor(
    () => {
      if (at(w, 'nav-busy').exists()) throw new Error('아직 계산 중이다');
    },
    { timeout: 10000 },
  );
  await flushPromises();
}

/** 엔진 배치를 붙든다: 풀어 줄 때까지 계산이 끝나지 않는다. */
function holdEngine(): { calls: () => number; release: () => void; fail: (reason: string) => void } {
  const waiting: Array<{ finish: () => void; fail: (reason: string) => void }> = [];
  let open = false;
  let calls = 0;
  api.engineRunBatch.mockImplementation(
    (requests) =>
      new Promise<EngineRow[]>((resolve, reject) => {
        calls += 1;
        const finish = () => resolve(requests.map((r) => fakeRow(r)));
        if (open) finish();
        else waiting.push({ finish, fail: reject });
      }),
  );
  return {
    calls: () => calls,
    release: () => {
      open = true;
      for (const batch of waiting.splice(0)) batch.finish();
    },
    fail: (reason) => {
      for (const batch of waiting.splice(0)) batch.fail(reason);
    },
  };
}

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
  api.readJsonFile.mockImplementation(async (path) => {
    if (!(path in files)) throw `파일을 찾을 수 없다: ${path}`;
    return structuredClone(files[path]);
  });
  api.pickJsonFile.mockResolvedValue(null);
  api.loadReport.mockRejectedValue('결과 파일이 없다');
  api.onScreenTrack.mockResolvedValue(() => {});
  api.screenTrackStatus.mockResolvedValue({ enabled: false, interval_ms: 2000, state: 'off', message: '', recognition: null, read_at: null, capture_ms: null, failures: 0 });
  api.accountSyncStatus.mockImplementation(async (name) => ({
    name: name ?? 'me',
    cookie_saved: false,
    cookie_saved_at: null,
    profile_fetched_at: null,
    account_file: null,
    login_window_open: false,
    problems: [],
  }));
  api.extensionLinkStatus.mockResolvedValue({ enabled: false, listening: false, address: '127.0.0.1:47615', code: 'ABCD-2345', problem: null, pending: false, last: null, locked_seconds: 0 });
  api.onExtensionLink.mockResolvedValue(() => {});
});

// ── 요격전 ───────────────────────────────────────────────────────────────────

describe('요격전 화면', () => {
  async function withResult(report: InterceptReport = sample) {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.putIntercept(report);
    const w = await render();
    await openPage(w, 'intercept');
    return w;
  }

  it('위에 보스 5종 카드가 이름·약점·1위 총딜과 함께 보이고, 고른 보스가 표시된다', async () => {
    const w = await withResult();
    const cards = w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]');
    expect(cards.map((c) => c.find('[data-testid="boss-card-name"]').text())).toEqual(sample.bosses.map((b) => b.name));
    expect(cards.map((c) => c.find('[data-testid="element-chip-text"]').text())).toEqual(sample.bosses.map((b) => (b.element.weak_to ? `약점 ${b.element.weak_to}` : '약점 모름')));
    expect(cards.map((c) => c.find('[data-testid="boss-card-total"]').text())).toEqual(sample.bosses.map((b) => `총딜 ${damageUnit(b.ranking[0].total_damage)}`));
    expect(cards.map((c) => c.attributes('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    // 이미지가 없으면 보스의 속성 색 바탕에 이름 첫 글자다(오류가 아니다).
    expect(cards[0].attributes('data-image')).toBe('color');

    await cards[2].trigger('click');
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[2].name);
    expect(w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]').map((c) => c.attributes('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe(sample.bosses[2].id);
  });

  it('고른 보스의 1위: 한 줄 요약, 큰 총딜 숫자와 「추정」, 자리 순서대로 놓인 니케 타일 5개와 딜 비중 막대, 약점 속성 강조', async () => {
    const w = await withResult();
    const boss = sample.bosses[0];
    const best = boss.ranking[0];
    // 한 줄 요약은 루트의 순수 함수가 만든 문장 그대로다.
    expect(at(w, 'boss-summary').text()).toBe(summarizeInterceptBoss(boss).text);
    expect(at(w, 'squad-total').text()).toBe(damageUnit(best.total_damage));
    expect(w.find('[data-role="estimate"]').text()).toBe('추정');
    expect(at(w, 'squad-caption').text()).toBe('1위 편성');
    // 타일은 편성의 자리 순서 그대로다.
    const members = w.findAll('[data-testid="squad-member"]');
    expect(members.map((m) => m.find('[data-testid="nikke-tile-name"]').text())).toEqual(best.members.map((m) => m.name));
    expect(members.map((m) => m.find('[data-testid="damage-bar-percent"]').text())).toEqual(best.members.map((m) => `${Math.round(m.share * 100)}%`));
    // 약점 속성 니케만 강조한다(결과의 약점 속성 보유 목록).
    expect(members.map((m) => m.attributes('data-weak'))).toEqual(best.members.map((m) => (boss.weak_pool!.owned.includes(m.name) ? 'yes' : 'no')));
    expect(members.filter((m) => m.attributes('data-weak') === 'yes').every((m) => m.find('[data-testid="nikke-tile"]').classes().includes('tile--weak'))).toBe(true);
    // 속성·버스트 단계는 엔진 카탈로그에서 얻는다.
    expect(members[0].find('[data-testid="nikke-tile"]').attributes('data-element')).toBe(catalog.nikkes[best.members[0].name].element_code);
  });

  it('2·3위 줄을 누르면 그 편성의 타일로 바뀌고, 1위로 돌아갈 수 있다', async () => {
    const w = await withResult();
    const boss = sample.bosses[0];
    expect(texts(w, 'rank-row-place')).toEqual(['2위', '3위']);
    expect(texts(w, 'rank-row-total')).toEqual([damageUnit(boss.ranking[1].total_damage), damageUnit(boss.ranking[2].total_damage)]);

    await w.find('[data-testid="rank-pick"][data-rank="2"]').trigger('click');
    expect(at(w, 'squad-panel').attributes('data-rank')).toBe('2');
    expect(at(w, 'squad-total').text()).toBe(damageUnit(boss.ranking[1].total_damage));
    expect(at(w, 'squad-caption').text()).toBe(`2위 편성 — 1위의 ${Math.round(boss.ranking[1].relative_to_best * 100)}%`);
    expect(w.findAll('[data-testid="squad-member"]').map((m) => m.find('[data-testid="nikke-tile-name"]').text())).toEqual(boss.ranking[1].members.map((m) => m.name));
    // 순위 줄에는 나머지(1위·3위)가 남는다.
    expect(texts(w, 'rank-row-place')).toEqual(['1위', '3위']);
    await w.find('[data-testid="rank-pick"][data-rank="1"]').trigger('click');
    expect(at(w, 'squad-caption').text()).toBe('1위 편성');
    // 보스를 바꾸면 1위부터 보인다.
    await w.find('[data-testid="rank-pick"][data-rank="3"]').trigger('click');
    await w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]')[1].trigger('click');
    expect(at(w, 'squad-caption').text()).toBe('1위 편성');
  });

  it('약점 속성인데 이번 계산에 들지 못한 니케를 요약한다', async () => {
    const report = structuredClone(sample);
    report.bosses[0].weak_pool = { element: '작열', owned: ['라피 : 레드 후드', '앨리스', '모더니아', '아스카'], pooled: ['라피 : 레드 후드', '앨리스'], not_pooled: ['모더니아', '아스카'] };
    const w = await withResult(report);
    expect(at(w, 'weak-pool').text()).toContain('약점 속성(작열) 보유 니케 4명 가운데 2명을 이번 계산에 넣었다');
    expect(at(w, 'weak-left-out').text()).toBe('넣지 못한 니케 2명: 모더니아, 아스카');
    // 모두 들었으면 그 줄은 없다. 약점을 모르는 보스에는 요약 자체가 없다.
    await w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]')[1].trigger('click');
    expect(at(w, 'weak-pool').exists()).toBe(true);
    expect(at(w, 'weak-left-out').exists()).toBe(false);
    await w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]')[4].trigger('click');
    expect(at(w, 'weak-pool').exists()).toBe(false);
  });

  it('「계산 조건」은 접혀 있고 항목 수가 보인다 — 미확인 값은 접힌 줄 밖의 배지로도 알린다', async () => {
    const w = await withResult();
    const boss = sample.bosses[0];
    const fold = at(w, 'calc-conditions');
    expect(fold.element.tagName).toBe('DETAILS');
    expect((fold.element as HTMLDetailsElement).open).toBe(false);
    expect(fold.find('[data-testid="details-fold-summary"]').text()).toContain('계산 조건');
    const squadNotes = boss.ranking.reduce((n, e) => n + e.notes.length, 0);
    const items = boss.unconfirmed.length + boss.assumptions.length + sample.assumptions.length + boss.notes.length + squadNotes + boss.caveats.length + sample.caveats.length;
    expect(fold.find('[data-testid="details-fold-count"]').text()).toBe(String(items));
    expect(at(w, 'boss-unconfirmed').text()).toBe(`미확인 값 ${boss.unconfirmed.length}칸`);
    expect(at(w, 'boss-unconfirmed').element.closest('details')).toBeNull();
    expect(at(w, 'boss-info').text()).toContain('보상');
  });

  it('다시 계산은 단추 하나와 정밀도 셋(빠르게·보통·꼼꼼히 — 대략 걸리는 시간이 보인다)이고, 파일 경로를 넣는 칸이 없다', async () => {
    const w = await withResult();
    expect(w.find('[data-testid="page-intercept"] input').exists()).toBe(false);
    expect(w.findAll('[data-testid="page-intercept"] [data-testid^="run-"]')).toHaveLength(1);
    expect(at(w, 'run-intercept').text()).toBe('다시 계산');
    const choices = w.findAll('[data-testid^="precision-"]');
    expect(choices.map((c) => c.text().replace(/\s+/g, ' '))).toEqual(['빠르게 약 1분', '보통 약 3분', '꼼꼼히 약 6분']);
    // 처음에는 「보통」이다. 고른 것을 기억한다.
    expect(choices.map((c) => c.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);
    await at(w, 'precision-thorough').trigger('click');
    expect(localStorage.getItem('nikke-companion.intercept.precision')).toBe('thorough');
    expect(INTERCEPT_PRECISION.map((c) => c.budget)).toEqual([60, 150, 300]);
  });

  it('고른 정밀도만큼만 계산한다 — 계산 도구에 맡기는 편성 수가 그 한도를 넘지 않는다', async () => {
    const w = await withResult();
    await at(w, 'precision-fast').trigger('click');
    await at(w, 'run-intercept').trigger('click');
    await idle(w);
    const requested = api.engineRunBatch.mock.calls.reduce((n, call) => n + call[0].length, 0);
    expect(requested).toBeGreaterThan(0);
    expect(requested).toBeLessThanOrEqual(60);
    expect((disk.intercept as InterceptReport).sims.budget).toBe(60);
  });

  it('계산 중에는 진행 패널(어느 보스·진행·남은 시간 어림·중단)이 보이고 이전 결과는 그대로 남는다', async () => {
    const engine = holdEngine();
    const w = await withResult();
    const before = { boss: at(w, 'boss-name').text(), total: at(w, 'squad-total').text() };
    await at(w, 'precision-fast').trigger('click');
    await at(w, 'run-intercept').trigger('click');
    await vi.waitFor(() => expect(engine.calls()).toBeGreaterThan(0));
    await flushPromises();

    const panel = at(w, 'progress-panel');
    expect(panel.attributes('role')).toBe('status');
    expect(panel.find('[data-testid="progress-title"]').text()).toBe('인디빌리아 추천 편성을 찾는 중');
    expect(panel.find('[data-testid="progress-detail"]').text()).toBe('보스 1/5');
    expect(panel.find('[data-testid="progress-count"]').text()).toBe('0 / 60');
    // 처음 몇 건 전에는 남은 시간을 숫자로 말하지 않는다.
    expect(panel.find('[data-testid="progress-eta"]').text()).toBe('계산 중');
    expect(panel.find('[data-testid="progress-stop"]').text()).toBe('중단');
    // 이전 결과는 그대로다. 단추와 정밀도는 잠긴다.
    expect(at(w, 'stale-note').text()).toContain('이전 추천');
    expect({ boss: at(w, 'boss-name').text(), total: at(w, 'squad-total').text() }).toEqual(before);
    expect(at(w, 'run-intercept').attributes('disabled')).toBeDefined();
    expect(at(w, 'precision-normal').attributes('disabled')).toBeDefined();

    engine.release();
    await idle(w);
    expect(at(w, 'progress-panel').exists()).toBe(false);
    expect(at(w, 'stale-note').exists()).toBe(false);
  });

  it('중단하면 계산 도구를 멈추고 「중단했다」고 알린다 — 오류가 아니고, 이전 결과는 그대로다', async () => {
    const engine = holdEngine();
    api.engineCancel.mockImplementation(async () => {
      engine.fail('중단됨: 엔진 계산을 멈췄다');
      return true;
    });
    const w = await withResult();
    const before = at(w, 'squad-total').text();
    await at(w, 'run-intercept').trigger('click');
    await vi.waitFor(() => expect(engine.calls()).toBeGreaterThan(0));
    await flushPromises();
    await at(w, 'progress-stop').trigger('click');
    await idle(w);

    expect(api.engineCancel).toHaveBeenCalled();
    expect(at(w, 'stopped-note').text()).toBe('계산을 중단했다. 앞서 보이던 추천은 그대로다.');
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'squad-total').text()).toBe(before);
    expect(api.saveInterceptResult).not.toHaveBeenCalled();
  });

  it('계산이 실패하면 무슨 일이 있었고 무엇을 하면 되는지 알리고, 이전 결과를 둔다', async () => {
    const engine = holdEngine();
    const w = await withResult();
    const before = at(w, 'squad-total').text();
    await at(w, 'run-intercept').trigger('click');
    await vi.waitFor(() => expect(engine.calls()).toBeGreaterThan(0));
    engine.fail('엔진 시간 초과 (600초)');
    await idle(w);

    const error = at(w, 'error');
    expect(error.attributes('role')).toBe('alert');
    expect(error.text()).toContain('추천 편성을 찾지 못했다.');
    expect(error.text()).toContain('엔진 시간 초과 (600초)');
    expect(error.text()).toContain('다시 계산을 눌러 보고');
    expect(at(w, 'squad-total').text()).toBe(before);
    // 다시 누르면 앞의 오류는 사라진다.
    engine.release();
    await at(w, 'run-intercept').trigger('click');
    await idle(w);
    expect(at(w, 'error').exists()).toBe(false);
  });

  it('계정이 여럿인데 고르지 않았으면 계산 단추 대신 「계정 고르기」가 보인다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.addAccount('sub', documents[ACCOUNT_PATH]);
    const w = await render();
    await openPage(w, 'intercept');
    expect(at(w, 'run-intercept').exists()).toBe(false);
    expect(at(w, 'need-account').find('[data-testid="empty-title"]').text()).toBe('어느 계정으로 계산할지 고르지 않았다');
    await at(w, 'need-account').find('[data-testid="empty-action"]').trigger('click');
    await flushPromises();
    expect(at(w, 'default-account').exists()).toBe(true);
  });

  it('아직 계산하지 않았으면 「계산 전」 안내가 보인다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    const w = await render();
    await openPage(w, 'intercept');
    expect(at(w, 'hint').text()).toContain('보스 5종의 추천 편성을 아직 찾지 않았다');
    expect(at(w, 'run-intercept').text()).toBe('추천 계산');
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });
});

// ── 내 니케 ──────────────────────────────────────────────────────────────────

describe('내 니케 화면', () => {
  async function open(doc: unknown = documents[ACCOUNT_PATH]) {
    disk.addAccount('me', doc);
    const w = await render();
    await openPage(w, 'roster');
    return w;
  }
  const names = (w: Wrapper) => w.findAll('[data-testid="roster-item"]').map((i) => i.find('[data-testid="nikke-tile-name"]').text());

  it('보유 니케를 초상화 격자로 보인다 — 이름·속성·버스트 단계와 육성 요약(돌파·스킬·오버로드 줄 수)', async () => {
    const w = await open();
    const owned = Object.keys(account.nikkes);
    expect(names(w).sort()).toEqual([...owned].sort());
    const item = (name: string) => w.findAll('[data-testid="roster-item"]').find((i) => i.find('[data-testid="nikke-tile-name"]').text() === name)!;
    const red = item('라피 : 레드 후드');
    expect(red.find('[data-testid="nikke-tile"]').attributes('data-element')).toBe(catalog.nikkes['라피 : 레드 후드'].element_code);
    expect(red.find('[data-testid="burst-badge"]').attributes('data-stage')).toBe(String(catalog.nikkes['라피 : 레드 후드'].burst_stage));
    expect(red.find('[data-testid="roster-breakthrough"]').text()).toBe('3돌 +7');
    expect(red.find('[data-testid="roster-skills"]').text()).toBe('10/10/10');
    // 오버로드: 공격력 4줄 + 우월 코드 대미지 4줄 + 최대 장탄 수 2줄.
    expect(red.find('[data-testid="roster-overload"]').text()).toBe('10줄');
    // 초상화가 없으면 이름 첫 글자다.
    expect(red.find('[data-testid="nikke-tile"]').attributes('data-portrait')).toBe('initial');
    // 많이 키운 니케가 앞에 온다.
    expect(names(w).indexOf('라피 : 레드 후드')).toBeLessThan(names(w).indexOf('나가'));
  });

  it('모르는 칸은 값을 지어내지 않고 「미확인」으로 보인다', async () => {
    const w = await open();
    const item = (name: string) => w.findAll('[data-testid="roster-item"]').find((i) => i.find('[data-testid="nikke-tile-name"]').text() === name)!;
    // 미하라: 오버로드와 코어 강화가 미확인이다.
    const mihara = item('미하라');
    expect(mihara.find('[data-testid="roster-overload"]').text()).toBe('미확인');
    expect(mihara.find('[data-testid="roster-breakthrough"]').text()).toBe('2돌');
    expect(mihara.find('[data-testid="roster-item-unknown"]').text()).toBe('미확인');
    expect(mihara.find('[data-testid="roster-item-unknown"]').attributes('title')).toBe('받아 오지 못한 칸: 오버로드, 코어 강화');
    expect(at(w, 'roster-unknown').text()).toBe('미확인 칸이 있는 니케 1명');
    // 나가: 아무 칸도 적지 않았다 — 미확인이지 0이 아니다.
    const naga = item('나가');
    expect(naga.find('[data-testid="roster-skills"]').text()).toBe('미확인');
    expect(naga.attributes('data-grown')).toBe('no');
  });

  it('계정 요약(니케 수·동기화 레벨·마지막으로 받은 때)과 「계정 새로 받기」로 가는 단추', async () => {
    const doc = { ...structuredClone(account), account: { synchro_level: 412 } };
    const w = await open(doc);
    expect(at(w, 'roster-account').text()).toBe('검증용 샘플 계정');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'roster-count').text()).toBe(`니케 ${Object.keys(account.nikkes).length}명`);
    expect(at(w, 'roster-synchro').text()).toBe('동기화 레벨 412');
    expect(at(w, 'roster-fetched').text()).toMatch(/^마지막으로 받은 때 \d{4}-\d\d-\d\d \d\d:\d\d$/);

    await at(w, 'roster-refetch').trigger('click');
    await flushPromises();
    expect(currentPage(w)).toBe('settings');
    expect(at(w, 'step-fetch').exists()).toBe(true);
  });

  it('동기화 레벨을 모르면 그렇게 적는다', async () => {
    const w = await open();
    expect(at(w, 'roster-synchro').text()).toBe('동기화 레벨 미확인');
  });

  it('속성·버스트 단계·「육성한 것만」으로 거르고 이름으로 찾는다', async () => {
    const w = await open();
    const all = names(w);
    const elementOf = (name: string) => catalog.nikkes[name].element_code;
    const burstOf = (name: string) => String(catalog.nikkes[name].burst_stage);

    await w.find('[data-testid="filter-element"][data-element="작열"]').trigger('click');
    expect(names(w).sort()).toEqual(all.filter((n) => elementOf(n) === '작열').sort());
    expect(at(w, 'roster-shown').text()).toBe(`${names(w).length}명`);
    // 다시 누르면 풀린다.
    await w.find('[data-testid="filter-element"][data-element="작열"]').trigger('click');
    expect(names(w)).toEqual(all);

    await w.find('[data-testid="filter-burst"][data-burst="3"]').trigger('click');
    expect(names(w).sort()).toEqual(all.filter((n) => ['3', 'A'].includes(burstOf(n))).sort());
    await w.find('[data-testid="filter-burst"][data-burst="3"]').trigger('click');

    await at(w, 'filter-grown').setValue(true);
    expect(names(w)).not.toContain('나가');
    expect(names(w)).toContain('헬름');
    await at(w, 'filter-grown').setValue(false);

    await at(w, 'roster-search').setValue('레드');
    expect(names(w)).toEqual(['라피 : 레드 후드']);
    // 띄어쓰기를 달리 넣어도 찾는다.
    await at(w, 'roster-search').setValue('리틀머메');
    expect(names(w)).toEqual(['리틀 머메이드']);
    await at(w, 'roster-search').setValue('없는 이름');
    expect(at(w, 'roster-empty').text()).toBe('조건에 맞는 니케가 없다.');
  });

  it('니케가 많으면 한 판씩 그린다 — 초상화를 한꺼번에 묻지 않는다', async () => {
    // 엔진 카탈로그의 니케 100명을 가진 지어낸 계정.
    const many = { schema_version: 1, is_test_data: true, name: '많은 계정', nikkes: Object.fromEntries(Object.keys(catalog.nikkes).slice(0, 100).map((n) => [n, {}])) };
    const w = await open(many);
    expect(w.findAll('[data-testid="roster-item"]')).toHaveLength(48);
    expect(at(w, 'roster-count').text()).toBe('니케 100명');
    expect(at(w, 'roster-more').text()).toBe('더 보기 (남은 52명)');
    await at(w, 'roster-more').trigger('click');
    expect(w.findAll('[data-testid="roster-item"]')).toHaveLength(96);
    await at(w, 'roster-more').trigger('click');
    expect(w.findAll('[data-testid="roster-item"]')).toHaveLength(100);
    expect(at(w, 'roster-more').exists()).toBe(false);
    // 거르기를 바꾸면 첫 판부터 다시 그린다.
    await at(w, 'roster-search').setValue(' ');
    expect(w.findAll('[data-testid="roster-item"]')).toHaveLength(48);
  });

  it('보유 34명 검증용 계정도 그린다', async () => {
    const w = await open(largeAccount);
    expect(w.findAll('[data-testid="roster-item"]')).toHaveLength(Object.keys(largeAccount.nikkes).length);
  });

  it('계정이 없으면 「계정 연결하기」, 계정을 읽지 못하면 한국어 오류와 다시 받을 길을 보인다', async () => {
    const w = await render();
    await openPage(w, 'roster');
    expect(at(w, 'need-account').find('[data-testid="empty-action"]').text()).toBe('계정 연결하기');
    w.unmount();

    disk.addAccount('me', documents[ACCOUNT_PATH]);
    api.readAccount.mockRejectedValue('계정의 내용을 읽을 수 없다(형식이 깨졌다)');
    const broken = await render();
    await openPage(broken, 'roster');
    expect(at(broken, 'roster-error').attributes('role')).toBe('alert');
    expect(at(broken, 'roster-error').find('[data-testid="empty-title"]').text()).toBe('계정을 읽지 못했다');
    expect(at(broken, 'roster-error').find('[data-testid="empty-hint"]').text()).toContain('계정의 내용을 읽을 수 없다');
    expect(at(broken, 'roster-error').find('[data-testid="empty-hint"]').text()).toContain('계정을 새로 받아 본다');
  });

  it('계산에 쓸 계정을 바꾸면 그 계정의 니케로 바뀐다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.addAccount('sub', { schema_version: 1, is_test_data: true, name: '부계정', nikkes: { 크라운: {}, 헬름: {} } });
    disk.chosen = 'me';
    const w = await render();
    await openPage(w, 'roster');
    expect(at(w, 'roster-account').text()).toBe('검증용 샘플 계정');

    await openSection(w, 'account');
    await at(w, 'default-account').setValue('sub');
    await flushPromises();
    await openPage(w, 'roster');
    expect(at(w, 'roster-account').text()).toBe('부계정');
    expect(names(w).sort()).toEqual(['크라운', '헬름']);
  });
});

// ── 편성 도구 ────────────────────────────────────────────────────────────────

describe('편성 도구 화면', () => {
  it('추천: 기본 계정과 내장 조건으로 단추 하나에 편성을 추천한다 — 1위의 타일과 딜 막대, 그 밖의 순위 줄', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    const w = await render();
    await openPage(w, 'tools');
    expect(texts(w, 'tool-suggest')).toEqual(['추천']);
    expect(at(w, 'account-line').text()).toBe('계정 me · 상대 솔로 레이드 기준 · 3분');
    expect(w.find('[data-testid="page-tools"] input[type="text"]').exists()).toBe(false);
    expect(w.findAll('[data-testid^="precision-"]').map((c) => c.find('.nk-seg__sub').text())).toEqual(SUGGEST_PRECISION.map((c) => c.time));

    await at(w, 'precision-fast').trigger('click');
    await at(w, 'run-suggest').trigger('click');
    await idle(w);
    expect(at(w, 'error').exists()).toBe(false);
    expect(at(w, 'squad-board').exists()).toBe(true);
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(w.findAll('[data-testid="squad-member"]')).toHaveLength(5);
    expect(w.findAll('[data-testid="squad-member"] [data-testid="damage-bar"]')).toHaveLength(5);
    expect(w.findAll('[data-testid="rank-row"]').length).toBeGreaterThan(0);
    expect(at(w, 'run-suggest').text()).toBe('다시 추천');
    // 계산한 편성 수는 「빠르게」의 한도를 넘지 않는다. 계정은 기본 계정, 파일은 읽지 않았다.
    const requested = api.engineRunBatch.mock.calls.reduce((n, call) => n + call[0].length, 0);
    expect(requested).toBeLessThanOrEqual(40);
    expect(api.readAccount).toHaveBeenCalledWith(null);
    expect(api.readJsonFile).not.toHaveBeenCalled();
  });

  it('추천: 「자리 순서도 바꿔 본다」를 끄면 편성 고르기만 한다. 끈 것을 기억한다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    const w = await render();
    await openPage(w, 'tools');
    expect((at(w, 'suggest-order').element as HTMLInputElement).checked).toBe(true);
    await at(w, 'suggest-order').setValue(false);
    expect(localStorage.getItem('nikke-companion.tools.order')).toBe('off');
    await at(w, 'precision-fast').trigger('click');
    await at(w, 'run-suggest').trigger('click');
    await idle(w);
    expect(api.engineRunBatch).toHaveBeenCalledTimes(1);
  });

  it('추천: 계정이 없으면 단추 대신 「계정 연결하기」가 보인다', async () => {
    const w = await render();
    await openPage(w, 'tools');
    expect(at(w, 'run-suggest').exists()).toBe(false);
    await at(w, 'need-account').find('[data-testid="empty-action"]').trigger('click');
    await flushPromises();
    expect(at(w, 'settings-account').exists()).toBe(true);
  });

  it('비교·성장: 직접 골라야 하는 계산이라 고를 곳(설정의 고급)을 알려 준다 — 탭을 기억한다', async () => {
    const w = await render();
    await openPage(w, 'tools');
    await at(w, 'tool-compare').trigger('click');
    expect(at(w, 'need-compare').find('[data-testid="empty-title"]').text()).toBe('견줄 편성을 아직 고르지 않았다');
    await at(w, 'tool-growth').trigger('click');
    expect(localStorage.getItem('nikke-companion.tools.tab')).toBe('growth');
    await at(w, 'need-growth').find('[data-testid="empty-action"]').trigger('click');
    await flushPromises();
    // 설정 > 고급의 성장 탭이 열린다.
    expect(currentPage(w)).toBe('settings');
    expect(at(w, 'tab-growth').attributes('aria-selected')).toBe('true');
    expect(at(w, 'screen-growth').exists()).toBe(true);
  });

  it('성장: 고급에서 계산한 결과가 니케 타일과 증가율 막대로 보인다', async () => {
    const w = await render();
    await openLegacy(w, 'growth');
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'condition-path').setValue(CONDITION_PATH);
    await at(w, 'squads-path').setValue(SQUADS_PATH);
    await at(w, 'upgrades-path').setValue(UPGRADES_PATH);
    await at(w, 'run-compute').trigger('click');
    await idle(w);
    expect(w.findAll('[data-testid="growth-entry"]').length).toBeGreaterThan(0);

    await openPage(w, 'tools');
    await at(w, 'tool-growth').trigger('click');
    expect(at(w, 'growth-board').exists()).toBe(true);
    expect(at(w, 'baseline').findAll('[data-testid="nikke-tile"]')).toHaveLength(5);
    const entries = w.findAll('[data-testid="growth-board"] [data-testid="growth-entry"]');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.find('[data-testid="damage-bar"]').exists())).toBe(true);
    expect(entries[0].find('[data-testid="gain-rate"]').text()).toMatch(/^[+-]\d+\.\d\d%$/);
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
  });
});

// ── 티어 ─────────────────────────────────────────────────────────────────────

describe('티어 화면', () => {
  it('티어표가 없으면 불러올 곳(설정의 고급)을 알려 준다', async () => {
    const w = await render();
    await openPage(w, 'tier');
    expect(at(w, 'need-tier').find('[data-testid="empty-title"]').text()).toBe('티어표가 아직 없다');
    expect(api.readJsonFile).not.toHaveBeenCalled();
    await at(w, 'need-tier').find('[data-testid="empty-action"]').trigger('click');
    await flushPromises();
    expect(at(w, 'tab-tier').attributes('aria-selected')).toBe('true');
    expect(at(w, 'screen-tier').exists()).toBe(true);
  });

  it('고급에서 불러온 티어표를 등급별 초상화 묶음으로 보인다 — 평가 보류와 임시 규칙 표시를 유지한다', async () => {
    const w = await render();
    await openLegacy(w, 'tier');
    await at(w, 'result-path').setValue(TIER_RESULT);
    await at(w, 'load-result').trigger('click');
    await flushPromises();
    await openPage(w, 'tier');

    const board = at(w, 'tier-board');
    const graded = tier.entries.filter((e) => e.tier);
    const order = tier.rules.tiers.map((t) => t.tier).filter((t) => graded.some((e) => e.tier === t));
    expect(board.findAll('[data-testid="tier-group"]').map((g) => g.attributes('data-tier'))).toEqual(order);
    expect(board.findAll('[data-testid="tier-badge"]').map((b) => b.text())).toEqual(order);
    // 등급 안의 니케가 초상화 타일로 보인다.
    for (const group of board.findAll('[data-testid="tier-group"]')) {
      const expected = graded.filter((e) => e.tier === group.attributes('data-tier')).map((e) => e.name);
      expect(group.findAll('[data-testid="nikke-tile-name"]').map((n) => n.text())).toEqual(expected);
    }
    expect(board.findAll('[data-testid="tier-entry"]')).toHaveLength(graded.length);
    expect(at(w, 'tier-provisional').text()).toBe('임시 규칙');
    expect(at(w, 'hold-pill').text()).toBe(`평가 보류 ${tier.entries.length - graded.length}명`);
    expect(board.findAll('[data-testid="hold-entry"]').map((h) => h.find('[data-testid="entry-name"]').text())).toEqual(tier.entries.filter((e) => !e.tier).map((e) => e.name));
    // 계산 조건(가정·주의)은 접어 두되 빠짐없이.
    expect(board.findAll('[data-testid="caveat-item"]').map((c) => c.text())).toEqual(tier.caveats);
    expect(board.findAll('[data-testid="assumption-item"]').map((c) => c.text())).toEqual(tier.assumptions);
  });

  it('버스트 단계로 거른다 — 평가 보류도 함께 걸러진다', async () => {
    localStorage.setItem('nikke-companion.tier.report-path', TIER_RESULT);
    const w = await render();
    await openPage(w, 'tier');
    const first = w.findAll('[data-testid="burst-option"]')[1];
    await first.trigger('click');
    const stage = first.attributes('data-burst');
    const shown = w.findAll('[data-testid="tier-entry"] [data-testid="nikke-tile-name"]').map((n) => n.text());
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(tier.entries.filter((e) => e.tier).length);
    for (const name of shown) expect(tier.entries.find((e) => e.name === name)?.burst_stage).toBe(stage);
  });

  it('마지막으로 불러온 티어표를 앱을 다시 켜도 다시 연다 — 고급을 열지 않아도', async () => {
    localStorage.setItem('nikke-companion.tier.report-path', TIER_RESULT);
    const w = await render();
    await openPage(w, 'tier');
    expect(api.readJsonFile).toHaveBeenCalledWith(TIER_RESULT);
    expect(at(w, 'tier-board').exists()).toBe(true);
    expect(at(w, 'need-tier').exists()).toBe(false);
  });

  it('다시 열지 못하면(없는 것·다른 종류) 무슨 일인지와 할 일을 알린다', async () => {
    localStorage.setItem('nikke-companion.tier.report-path', GROWTH_RESULT);
    const w = await render();
    await openPage(w, 'tier');
    expect(at(w, 'error').text()).toContain('마지막으로 불러온 티어표를 열지 못했다.');
    expect(at(w, 'error').text()).toContain('티어 결과가 아니다');
    expect(at(w, 'error').text()).toContain('설정의 고급에서 티어표를 다시 불러온다');
    expect(at(w, 'tier-board').exists()).toBe(false);
  });
});

// ── 설정 ─────────────────────────────────────────────────────────────────────

describe('설정 화면', () => {
  it('구획 넷이 있다: 계정 연결 · 오버레이 · 계산 도구 · 고급. 마지막으로 본 구획을 기억한다', async () => {
    const w = await render();
    await openPage(w, 'settings');
    expect(w.findAll('[data-testid^="section-"]').map((s) => s.text())).toEqual(['계정 연결', '오버레이', '계산 도구', '고급']);
    expect(at(w, 'section-account').attributes('aria-selected')).toBe('true');
    await openSection(w, 'overlay');
    expect(localStorage.getItem('nikke-companion.settings.section')).toBe('overlay');
    w.unmount();
    const again = await render();
    await openPage(again, 'settings');
    expect(at(again, 'settings-overlay').exists()).toBe(true);
  });

  it('계정 연결: 받는 방법 셋(크롬 확장 — 권장, 붙여넣기, 로그인 창)과 계산에 쓸 계정 고르기', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.addAccount('sub', documents[ACCOUNT_PATH]);
    const w = await render();
    await openSection(w, 'account');
    expect(w.findAll('[data-testid^="way-"]').map((el) => el.attributes('data-testid'))).toEqual(['way-extension', 'way-paste', 'way-login']);
    expect(at(w, 'way-extension').text()).toContain('권장');
    // 둘인데 고르지 않았다 — 어느 것을 쓸지 추측하지 않는다.
    expect(at(w, 'account-state').text()).toBe('연결 안 됨');
    expect(at(w, 'default-account').findAll('option').map((o) => o.attributes('value'))).toEqual(['', 'me', 'sub']);

    await at(w, 'default-account').setValue('sub');
    await flushPromises();
    expect(api.setDefaultAccount).toHaveBeenCalledWith('sub');
    expect(disk.chosen).toBe('sub');
    expect(at(w, 'account-state').text()).toBe('연결됨 · sub');
  });

  it('계정 연결: 바꾸지 못하면 이유를 알린다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.addAccount('sub', documents[ACCOUNT_PATH]);
    api.setDefaultAccount.mockRejectedValue("'sub' 계정을 찾을 수 없다. 설정의 계정 연결에서 계정을 새로 받아라");
    const w = await render();
    await openSection(w, 'account');
    await at(w, 'default-account').setValue('sub');
    await flushPromises();
    expect(at(w, 'shared-problem').text()).toBe("기본 계정을 정하지 못했다: 'sub' 계정을 찾을 수 없다. 설정의 계정 연결에서 계정을 새로 받아라");
  });

  it('오버레이: 언제 띄울지 셋 중 하나를 고르고(디스크에 기억), 지금 띄우거나 숨긴다', async () => {
    const w = await render();
    await openSection(w, 'overlay');
    expect(w.findAll('[data-testid^="launch-"]').map((c) => c.attributes('aria-checked'))).toEqual(['true', 'false', 'false']);
    await at(w, 'launch-with_game').trigger('click');
    await flushPromises();
    expect(api.setOverlayLaunch).toHaveBeenCalledWith('with_game');
    expect(disk.launch).toBe('with_game');
    expect(w.findAll('[data-testid^="launch-"]').map((c) => c.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);

    expect(at(w, 'overlay-state').text()).toBe('떠 있음');
    expect(at(w, 'overlay-toggle').text()).toBe('오버레이 숨기기');
    await at(w, 'overlay-toggle').trigger('click');
    await flushPromises();
    expect(api.setOverlayVisible).toHaveBeenCalledWith(false);
    expect(at(w, 'overlay-state').text()).toBe('숨김');
    expect(at(w, 'overlay-toggle').text()).toBe('오버레이 띄우기');
  });

  it('오버레이: 자동 추적·자동 이동, 게임 창에 붙이기, 단축키 안내가 있다', async () => {
    api.overlayStatus.mockResolvedValue({ visible: true, click_through: true, shortcut_problems: ['단축키 Alt+Shift+S(게임 화면 저장)를 등록하지 못했다'] });
    const w = await render();
    await openSection(w, 'overlay');
    expect(at(w, 'track-switch').exists()).toBe(true);
    expect(at(w, 'track-auto-tab').exists()).toBe(true);
    expect(at(w, 'game-panel').exists()).toBe(true);
    // P-028: 오버레이 모양 바꾸기(Alt+Shift+M)가 더해졌다.
    expect(w.findAll('[data-testid="shortcut"]').map((s) => s.find('kbd').text())).toEqual(['Alt+Shift+O', 'Alt+Shift+C', 'Alt+Shift+M', 'Alt+Shift+S']);
    expect(at(w, 'overlay-passthrough').text()).toBe('클릭 통과 중');
    expect(at(w, 'shortcut-problems').text()).toContain('등록하지 못했다');
  });

  // ── P-028: 오버레이 위젯의 설정(크기 배율·불투명도·자동 숨김·기본 모양·클릭 통과·자리 초기화) ──

  it('오버레이 설정: 기본 모양 셋 중 하나를 고른다 — 지금 모양과 고정 여부도 보인다', async () => {
    const w = await render();
    await openSection(w, 'overlay');
    expect(w.findAll('[data-testid^="shape-"]').map((c) => c.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(texts(w, 'widget-shape-now')).toEqual(['지금 한 줄 카드']);
    expect(at(w, 'widget-pinned').exists()).toBe(false);

    await at(w, 'shape-expanded').trigger('click');
    await flushPromises();
    expect(api.setOverlayPrefs).toHaveBeenLastCalledWith({ default_shape: 'expanded' });
    expect(w.findAll('[data-testid^="shape-"]').map((c) => c.attributes('aria-checked'))).toEqual(['false', 'false', 'true']);
    // 기본 모양을 바꿔도 지금 모양은 그대로다(다음에 켤 때의 모양이다).
    expect(texts(w, 'widget-shape-now')).toEqual(['지금 한 줄 카드']);

    // 오버레이에서 모양을 바꾸거나(누르기·Alt+Shift+M) 고정하면 여기에도 보인다.
    widgetOf(disk).set({ shape: 'collapsed', pinned: true });
    await flushPromises();
    expect(texts(w, 'widget-shape-now')).toEqual(['지금 접힘']);
    expect(at(w, 'widget-pinned').text()).toBe('고정됨');
  });

  it('오버레이 설정: 크기 배율과 불투명도 — 기본은 100%·불투명이고, 범위 밖의 값은 범위 안으로 맞춘다', async () => {
    const w = await render();
    await openSection(w, 'overlay');
    expect(at(w, 'scale-now').text()).toBe('100%');
    expect(at(w, 'opacity-now').text()).toBe('100%');
    const scale = at(w, 'scale-range');
    expect([scale.attributes('min'), scale.attributes('max')]).toEqual(['80', '150']);
    expect([at(w, 'opacity-range').attributes('min'), at(w, 'opacity-range').attributes('max')]).toEqual(['40', '100']);

    await scale.setValue('125');
    await flushPromises();
    expect(api.setOverlayPrefs).toHaveBeenLastCalledWith({ scale_percent: 125 });
    expect(at(w, 'scale-now').text()).toBe('125%');

    await at(w, 'opacity-range').setValue('70');
    await flushPromises();
    expect(api.setOverlayPrefs).toHaveBeenLastCalledWith({ opacity_percent: 70 });
    expect(at(w, 'opacity-now').text()).toBe('70%');
    // 다른 칸은 건드리지 않는다(바꿀 칸만 넘긴다).
    expect(widgetOf(disk).state.prefs).toMatchObject({ scale_percent: 125, opacity_percent: 70, leave: 'collapse', default_shape: 'card' });
  });

  it('오버레이 설정: 자동 숨김 — 그대로 두기·접기·숨기기와 기다리는 시간', async () => {
    const w = await render();
    await openSection(w, 'overlay');
    expect(w.findAll('[data-testid^="leave-"][role="radio"]').map((c) => c.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);
    const after = at(w, 'leave-after');
    expect((after.element as HTMLInputElement).value).toBe('8');
    expect(at(w, 'leave-settings').text()).toContain('핀으로 고정해 두면 그대로 둔다');
    expect(at(w, 'leave-settings').text()).toContain('화면을 알아보지 못하는 동안에는 바꾸지 않는다');

    await at(w, 'leave-hide').trigger('click');
    await flushPromises();
    expect(api.setOverlayPrefs).toHaveBeenLastCalledWith({ leave: 'hide' });
    expect(w.findAll('[data-testid^="leave-"][role="radio"]').map((c) => c.attributes('aria-checked'))).toEqual(['false', 'false', 'true']);

    // 범위(2~120초) 밖의 값은 범위 안으로 맞춰 알리고, 칸에는 실제로 쓰는 값을 보인다.
    await after.setValue('999');
    await flushPromises();
    expect(api.setOverlayPrefs).toHaveBeenLastCalledWith({ leave_after_sec: 120 });
    expect((after.element as HTMLInputElement).value).toBe('120');
    await after.setValue('글자');
    await flushPromises();
    expect(api.setOverlayPrefs).toHaveBeenLastCalledWith({ leave_after_sec: 8 });

    // 그대로 두기로 하면 시간 칸은 쓰지 않는다.
    await at(w, 'leave-stay').trigger('click');
    await flushPromises();
    expect(at(w, 'leave-after').attributes('disabled')).toBeDefined();
  });

  it('오버레이 설정: 클릭 통과를 켜고 끈다 — 바꾸지 못하면 이유를 알리고 스위치를 되돌린다', async () => {
    const w = await render();
    await openSection(w, 'overlay');
    const box = at(w, 'click-through-switch');
    expect((box.element as HTMLInputElement).checked).toBe(false);
    await box.setValue(true);
    await flushPromises();
    expect(api.setOverlayPrefs).toHaveBeenLastCalledWith({ click_through: true });
    expect((box.element as HTMLInputElement).checked).toBe(true);
    expect(at(w, 'widget-problem').exists()).toBe(false);

    // 오버레이를 숨긴 동안에는 바꾸지 못한다(Rust가 거부한다).
    await at(w, 'overlay-toggle').trigger('click');
    await flushPromises();
    await box.setValue(false);
    await flushPromises();
    expect(at(w, 'widget-problem').text()).toBe('오버레이 설정을 바꾸지 못했다: 오버레이가 숨겨져 있어 클릭 통과를 바꾸지 못했다. 오버레이를 띄운 뒤에 바꾼다');
    expect(at(w, 'widget-problem').attributes('role')).toBe('alert');
    expect((box.element as HTMLInputElement).checked).toBe(true);
  });

  it('오버레이 설정: 자리 초기화 단추가 있고, 쉬는 중(자동으로 숨겨 둠)이면 그렇게 알리고 깨울 수 있다', async () => {
    const w = await render();
    await openSection(w, 'overlay');
    await at(w, 'reset-position').trigger('click');
    await flushPromises();
    expect(api.resetOverlayPosition).toHaveBeenCalledTimes(1);
    expect(widgetOf(disk).resets).toBe(1);
    expect(at(w, 'widget-settings').text()).toContain('끌어서 옮긴 자리는 기억한다. 화면 밖으로 나가면 안쪽으로 되돌린다.');

    expect(at(w, 'overlay-resting').exists()).toBe(false);
    widgetOf(disk).set({ resting: true });
    await flushPromises();
    // 숨긴 것이 아니다: 「떠 있음」 옆에 「쉬는 중」이 붙는다.
    expect(at(w, 'overlay-state').text()).toBe('떠 있음');
    expect(at(w, 'overlay-resting').text()).toBe('쉬는 중');
    await at(w, 'overlay-wake').trigger('click');
    await flushPromises();
    expect(api.setOverlayVisible).toHaveBeenLastCalledWith(true);
  });

  it('오버레이 설정: 설정을 기억하다 난 문제(Rust가 알린 것)를 그대로 보인다', async () => {
    const w = await render();
    await openSection(w, 'overlay');
    widgetOf(disk).set({ problem: '오버레이 설정을(를) 저장하지 못했다 (디스크가 가득 찼다)' });
    await flushPromises();
    expect(at(w, 'widget-problem').text()).toContain('저장하지 못했다');
  });

  it('계산 도구: 판과 계산할 수 있는 니케 수를 보이고, 문제가 있으면 그대로 알린다', async () => {
    const w = await render();
    await openSection(w, 'engine');
    await flushPromises();
    expect(at(w, 'engine-state').text()).toBe('문제없음');
    expect(at(w, 'engine-version').text()).toBe('판: fake/engine @ ffffffff');
    expect(at(w, 'engine-known').text()).toBe(`계산할 수 있는 니케: ${Object.keys(catalog.nikkes).length}명`);

    api.engineVersion.mockRejectedValue('엔진 폴더(vendor/nikke-calc)를 찾을 수 없다 (설정 파일: C:\\설정\\settings.json)');
    api.engineCatalog.mockRejectedValue('엔진 폴더(vendor/nikke-calc)를 찾을 수 없다 (설정 파일: C:\\설정\\settings.json)');
    api.accountSyncStatus.mockResolvedValue({ name: 'me', cookie_saved: false, cookie_saved_at: null, profile_fetched_at: null, account_file: null, login_window_open: false, problems: ['수집 스크립트를 실행할 수 없다 (python): program not found'] });
    await at(w, 'engine-recheck').trigger('click');
    await flushPromises();
    expect(at(w, 'engine-state').text()).toBe('문제 2건');
    expect(texts(w, 'engine-problem')).toEqual(['엔진 폴더(vendor/nikke-calc)를 찾을 수 없다 (설정 파일: C:\\설정\\settings.json)', '수집 스크립트를 실행할 수 없다 (python): program not found']);
    expect(at(w, 'engine-version').text()).toBe('판: 확인하지 못했다');
  });

  it('고급: 파일을 직접 고르는 칸은 여기에만 있다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.putIntercept(sample);
    localStorage.setItem('nikke-companion.tier.report-path', TIER_RESULT);
    const w = await render();
    // 다른 화면에는 파일 경로를 넣는 칸이 없다.
    for (const page of ['home', 'intercept', 'roster', 'tools', 'tier'] as const) {
      await openPage(w, page);
      expect(w.findAll('[data-testid$="-path"]'), page).toHaveLength(0);
      expect(w.findAll('[data-testid^="pick-"]'), page).toHaveLength(0);
    }
    for (const section of ['account', 'overlay', 'engine'] as const) {
      await openSection(w, section);
      expect(w.findAll('[data-testid$="-path"]'), section).toHaveLength(0);
    }
    await openSection(w, 'advanced');
    expect(at(w, 'advanced-note').text()).toContain('파일을 직접 골라 계산하거나');
    expect(w.findAll('[data-testid$="-path"]').length).toBeGreaterThan(0);
    for (const key of ['compare', 'intercept', 'growth', 'tier'] as const) {
      await openLegacy(w, key);
      expect(at(w, `screen-${key}`).exists()).toBe(true);
    }
  });

  it('구획을 옮겨도 그 화면의 상태(고급의 입력)는 남는다', async () => {
    const w = await render();
    await openLegacy(w, 'compare');
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await openSection(w, 'overlay');
    await openPage(w, 'home');
    await openLegacy(w, 'compare');
    expect((at(w, 'account-path').element as HTMLInputElement).value).toBe(ACCOUNT_PATH);
  });
});
