// 요격전 계획(P-029)의 화면: 내 니케의 「장비 · 요격전 계획」(장비 칸·오늘 돌 보스·속성 커버리지·즐겨찾기), 요격전 화면의 기록 입력과
// 「추정 · 실전 미대조」 배지의 변화, 홈의 「오늘의 요격전」 카드. 규칙 자체는 루트의 단위 테스트(tests/unit/plan.test.mjs)가 본다.
// Rust 쪽(backend)은 가짜다: 계정 폴더는 가짜 디스크(기록·즐겨찾기도 거기에 둔다). 시험 계정은 지어낸 큰 샘플 계정
// (data/samples/account.large.sample.json)에 지어낸 장비(data/samples/gear.large.sample.json)를 얹은 것이다 — 실제 계정은 쓰지 않는다.
import { compareRecord, elementCoverage, catalogInfoOf } from '@core/plan.mjs';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bundle from '../../data/intercept/anomaly.json';
import largeAccount from '../../data/samples/account.large.sample.json';
import gearSample from '../../data/samples/gear.large.sample.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { damageUnit } from '../src/lib/format';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { simCache } from '../src/lib/runtime';
import type { AccountDoc, InterceptReport, PlanDoc } from '../src/types';
import interceptFixture from './fixtures/intercept.sample.json';
import { ACCOUNT_PATH, catalog, documents, FAKE_EVALUATOR, fakeRow } from './helpers/fakeEngine';
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
const sample = interceptFixture as unknown as InterceptReport;

let disk = new FakeDisk();
type Wrapper = ReturnType<typeof mount>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text().replace(/\s+/g, ' '));

async function render() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

/** 큰 샘플 계정에 지어낸 장비를 얹은 계정(검증용). */
function accountWithGear(): AccountDoc {
  const account = structuredClone(largeAccount) as unknown as AccountDoc;
  for (const [name, equipment] of Object.entries(gearSample.equipment)) account.nikkes[name] = { ...account.nikkes[name], equipment: structuredClone(equipment) };
  return account;
}

/** 샘플 결과의 보스 다섯을 이상 개체 보스 다섯(이름·보상·약점)으로 바꾼 지어낸 추천 결과. 편성과 수치는 샘플 그대로다. */
function anomalyReport(): InterceptReport {
  const report = structuredClone(sample);
  report.bosses.forEach((b, i) => {
    const real = bundle.bosses[i];
    b.id = real.id;
    b.name = real.name;
    b.reward = real.reward;
    b.element = { ...b.element, code: real.enemy.code, weak_to: real.weak_to };
    b.weak_pool = null;
  });
  return report;
}

async function openPlan(w: Wrapper): Promise<void> {
  await openPage(w, 'roster');
  await at(w, 'roster-view-plan').trigger('click');
  await flushPromises();
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
  api.readJsonFile.mockRejectedValue('없다');
  api.pickJsonFile.mockResolvedValue(null);
  api.loadReport.mockRejectedValue('결과가 없다');
  api.onScreenTrack.mockResolvedValue(() => {});
  api.screenTrackStatus.mockResolvedValue({ enabled: false, interval_ms: 2000, state: 'off', message: '', recognition: null, read_at: null, capture_ms: null, failures: 0 });
  api.accountSyncStatus.mockImplementation(async (name) => ({ name: name ?? 'me', cookie_saved: false, cookie_saved_at: null, profile_fetched_at: null, account_file: null, login_window_open: false, problems: [] }));
  api.extensionLinkStatus.mockResolvedValue({ enabled: false, listening: false, address: '127.0.0.1:47615', code: 'ABCD-2345', problem: null, pending: false, last: null, locked_seconds: 0 });
  api.onExtensionLink.mockResolvedValue(() => {});
});

// ── 내 니케 > 장비 · 요격전 계획 ─────────────────────────────────────────────

describe('내 니케의 장비 · 요격전 계획', () => {
  it('니케마다 초상화 옆에 네 칸(머리·몸통·팔·다리)이 계정에 적힌 상태 그대로 보인다', async () => {
    disk.addAccount('me', accountWithGear());
    const w = await render();
    await openPlan(w);
    // 추천도 즐겨찾기도 없으면 많이 키운 순서로 위에서 열 명이 주력이다 — 기준이 한 줄로 적혀 있다.
    expect(at(w, 'core-basis').text()).toBe('주력 기준: 많이 키운 순서로 위에서 10명(요격전 추천도 즐겨찾기도 아직 없다).');
    const rows = w.findAll('[data-testid="gear-row"]');
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.find('[data-testid="nikke-tile"]').exists()).toBe(true);
      expect(row.findAll('[data-testid="gear-cell"]').map((c) => c.attributes('data-part'))).toEqual(['머리', '몸통', '팔', '다리']);
      expect(row.attributes('data-core')).toBe('yes');
    }
    const rowOf = (name: string) => rows.find((r) => r.find('[data-testid="gear-row-name"]').text() === name)!;
    const cells = (name: string) => rowOf(name).findAll('[data-testid="gear-cell"]');
    expect(cells('크라운').map((c) => c.attributes('data-state'))).toEqual(['overload', 'overload', 'corp', 'normal']);
    const states = (name: string) => cells(name).map((c) => c.find('.plan__cell-state').text());
    expect(states('크라운')).toEqual(['오버로드 +5', '오버로드 +4', 'T9 기업 +3', 'T9 일반']);
    expect(cells('크라운').map((c) => c.find('.plan__cell-part').text())).toEqual(['머리', '몸통', '팔', '다리']);
    expect(states('리타')).toEqual(['미장착', 'T9 일반', 'T9 일반', '미장착']);
    // 장비를 적지 않은 니케는 「기록 없음」이다 — 미장착으로 그리지 않는다.
    expect(cells('아스카 : WILLE').map((c) => c.attributes('data-state'))).toEqual(['unrecorded', 'unrecorded', 'unrecorded', 'unrecorded']);
    expect(cells('아스카 : WILLE')[0].text()).toContain('기록 없음');
    // 검증용 계정이라는 표시가 있다.
    expect(at(w, 'plan-data-kind').text()).toBe('검증용 데이터');

    // 「전체」로 바꾸면 보유 니케가 모두 나온다(주력이 앞).
    await at(w, 'gear-scope-all').trigger('click');
    expect(w.findAll('[data-testid="gear-row"]')).toHaveLength(Object.keys(largeAccount.nikkes).length);
    expect(w.findAll('[data-testid="gear-row"]').slice(0, 10).every((r) => r.attributes('data-core') === 'yes')).toBe(true);
  });

  it('부위별·기업별로 오버로드가 아닌 칸을 세고, 계정에 없는 것은 없다고 적는다', async () => {
    disk.addAccount('me', accountWithGear());
    const w = await render();
    await openPlan(w);
    // 주력 열 명: 머리 5 · 몸통 1 · 팔 3 · 다리 4.
    expect(texts(w, 'gear-part')).toEqual(['머리 5칸', '몸통 1칸', '팔 3칸', '다리 4칸']);
    const corps = w.findAll('[data-testid="gear-corp"]');
    expect(corps.length).toBeGreaterThan(0);
    const total = corps.reduce((s, c) => s + Number(/(\d+)칸/.exec(c.text())![1]), 0);
    expect(total).toBe(13);
    for (const c of corps) expect(Object.values(catalog.nikkes).some((n) => n.manufacturer === c.attributes('data-corp'))).toBe(true);
    expect(at(w, 'gear-unrecorded').text()).toContain('장비가 계정에 적혀 있지 않은 니케 1명은 세지 않았다');
    expect(at(w, 'gear-unknown').text()).toBe('가지고 있지만 끼지 않은 장비의 수는 계정 정보에 없다 — 세지 않았다.');
    await at(w, 'gear-scope-all').trigger('click');
    const recorded = Object.keys(gearSample.equipment).length;
    expect(at(w, 'gear-unrecorded').text()).toContain(`니케 ${Object.keys(largeAccount.nikkes).length - recorded}명은 세지 않았다`);
  });

  it('오늘 돌 보스: 한 문장과 보스별 필요 칸 수 막대, 접어 둔 근거, 모른다는 사실', async () => {
    disk.addAccount('me', accountWithGear());
    const w = await render();
    await openPlan(w);
    expect(at(w, 'boss-pick').text()).toBe('머리 장비가 가장 급하다 → 울트라');
    const needs = w.findAll('[data-testid="boss-need"]');
    expect(needs.map((n) => n.find('[data-testid="boss-need-open"]').text())).toEqual(bundle.bosses.map((b) => b.name));
    expect(needs.map((n) => n.find('[data-testid="boss-need-count"]').text())).toEqual(['1칸', '5칸', '4칸', '세지 않음', '3칸']);
    expect(needs.map((n) => n.attributes('data-top'))).toEqual(['no', 'yes', 'no', 'no', 'no']);
    // 막대의 길이는 가장 많은 칸 수에 견준 것이다.
    expect(needs.map((n) => (n.find('.plan__fill').element as HTMLElement).style.width)).toEqual(['20%', '100%', '80%', '0%', '60%']);
    // 근거는 접혀 있고(내용은 있다) 어느 니케의 어느 부위인지 적혀 있다.
    const fold = at(w, 'pick-reasons');
    expect(fold.element.tagName).toBe('DETAILS');
    expect((fold.element as HTMLDetailsElement).open).toBe(false);
    const ultra = fold.findAll('[data-testid="pick-reason"]').filter((li) => li.attributes('data-boss') === 'ultra').map((li) => li.text());
    expect(ultra.sort()).toEqual(['도로시 : 세렌디피티: 머리 미장착', '리타: 머리 미장착', '리틀 머메이드: 머리 기업 장비(T9)', '스노우 화이트 : 이노센트 데이즈: 머리 기업 장비(T9)', '홍련 : 흑영: 머리 일반 등급(T7)'].sort());
    expect(fold.find('[data-testid="pick-note"]').text()).toContain('커스텀 모듈');
    // 모르는 것은 접힌 구획 밖에 적는다 — 언제 다 모이는지는 말하지 않는다.
    expect(at(w, 'pick-unknown').text()).toBe('보상이 나올 확률과 한 번에 얻는 수는 모른다 — 언제 다 모이는지는 어림하지 않는다.');
    expect(at(w, 'pick-unknown').element.closest('details')).toBeNull();
    expect(at(w, 'pick-unrecorded').text()).toContain('아스카 : WILLE');
    expect(at(w, 'today-boss').text()).not.toMatch(/예상|며칠/);

    // 보스 이름을 누르면 요격전 화면으로 간다(그 보스를 고른 채).
    await needs[1].find('[data-testid="boss-need-open"]').trigger('click');
    await flushPromises();
    expect(currentPage(w)).toBe('intercept');
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('ultra');
  });

  it('장비가 계정에 적혀 있지 않으면 지어내지 않는다 — 「기록 없음」과 알 수 없다는 문장', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openPlan(w);
    expect(at(w, 'boss-pick').text()).toBe('주력 니케의 장비가 계정에 적혀 있지 않아 어느 보스가 급한지 알 수 없다.');
    expect(new Set(w.findAll('[data-testid="gear-cell"]').map((c) => c.attributes('data-state')))).toEqual(new Set(['unrecorded']));
    expect(texts(w, 'gear-part')).toEqual(['머리 0칸', '몸통 0칸', '팔 0칸', '다리 0칸']);
    expect(at(w, 'gear-unrecorded').text()).toContain('니케 10명은 세지 않았다');
    expect(w.findAll('[data-testid="boss-need"]').every((n) => n.attributes('data-top') === 'no')).toBe(true);
  });

  it('주력의 기준: 요격전 추천이 있으면 보스마다 1위 편성에 든 니케, 없으면 즐겨찾기 — 별을 누르면 저장되고 다시 켜도 남는다', async () => {
    disk.addAccount('me', accountWithGear());
    const w = await render();
    await openPage(w, 'roster');
    const item = (wrapper: Wrapper, name: string) => wrapper.findAll('[data-testid="roster-item"]').find((li) => li.find('[data-testid="nikke-tile"]').attributes('data-name') === name || li.text().includes(name))!;
    const star = item(w, '헬름').find('[data-testid="roster-fav"]');
    expect(star.attributes('aria-pressed')).toBe('false');
    await star.trigger('click');
    await flushPromises();
    expect(item(w, '헬름').find('[data-testid="roster-fav"]').attributes('aria-pressed')).toBe('true');
    expect((disk.plans.get('me') as PlanDoc).favorites).toEqual(['헬름']);

    await at(w, 'roster-view-plan').trigger('click');
    await flushPromises();
    expect(at(w, 'core-basis').text()).toBe('주력 기준: 즐겨찾기로 고른 니케 1명(요격전 추천이 아직 없다).');
    expect(texts(w, 'gear-row-name')).toEqual(['헬름']);
    expect(at(w, 'boss-pick').text()).toBe('머리 장비가 가장 급하다 → 울트라');
    w.unmount();

    // 다시 켜도 즐겨찾기와 고른 구획이 남아 있다.
    const again = await render();
    await openPage(again, 'roster');
    expect(at(again, 'core-basis').text()).toContain('즐겨찾기로 고른 니케 1명');
    again.unmount();

    // 요격전 추천이 생기면 그 1위 편성의 니케가 주력이다(즐겨찾기보다 앞선다).
    disk.putIntercept(anomalyReport());
    const third = await render();
    await openPage(third, 'roster');
    expect(at(third, 'core-basis').text()).toBe('주력 기준: 요격전 추천에서 보스마다 1위 편성에 든 니케 6명.');
    expect(texts(third, 'gear-row-name')).toEqual(['리틀 머메이드', '크라운', '나가', '라피 : 레드 후드', '앨리스', '프리카']);
    // 칸 수가 같으면(머리 1 · 팔 1 · 다리 1) 더 비어 있는 쪽이 앞이다: 다리는 일반 등급, 머리·팔은 기업 장비.
    expect(at(third, 'boss-pick').text()).toBe('다리 장비가 가장 급하다 → 하베스터');
  });

  it('속성 커버리지: 속성 다섯마다 키운 딜러의 수가 막대로 보이고 기준이 적혀 있다', async () => {
    disk.addAccount('me', accountWithGear());
    const w = await render();
    await openPlan(w);
    const expected = elementCoverage(largeAccount, { infoOf: catalogInfoOf(catalog), bosses: bundle.bosses });
    const rows = w.findAll('[data-testid="coverage-row"]');
    expect(rows.map((r) => r.attributes('data-element'))).toEqual(['작열', '풍압', '철갑', '전격', '수냉']);
    expect(rows.map((r) => r.find('[data-testid="coverage-count"]').text())).toEqual(expected.elements.map((e) => `${e.count}명`));
    expect(rows.map((r) => r.find('[data-testid="coverage-bosses"]').text())).toEqual(['약점인 보스 인디빌리아', '약점인 보스 크라켄', '약점인 보스 울트라', '약점인 보스 미러 컨테이너', '약점인 보스 하베스터']);
    expect(rows.map((r) => r.attributes('data-weakest') === 'yes')).toEqual(expected.elements.map((e) => expected.weakest.includes(e.element)));
    expect(rows.map((r) => (r.find('.plan__fill').element as HTMLElement).style.width)).toEqual(expected.elements.map((e) => `${Math.round((e.count / expected.max) * 100)}%`));
    expect(at(w, 'coverage-rule').text()).toBe('키운 딜러 = 화력형이고 돌파 3 이상, 스킬 셋이 모두 7 이상인 니케. 어림 기준이다.');
    if (expected.weakest.length) expect(at(w, 'coverage-weakest').text()).toContain(`키운 딜러가 가장 적은 속성: ${expected.weakest[0]}`);
  });
});

// ── 요격전 화면의 기록 ───────────────────────────────────────────────────────

describe('요격전 기록', () => {
  async function withResult() {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.putIntercept(sample);
    const w = await render();
    await openPage(w, 'intercept');
    return w;
  }

  async function write(w: Wrapper, damage: string, options: { mode?: 'mock' | 'real'; date?: string; stage?: string } = {}): Promise<void> {
    await at(w, 'record-damage').setValue(damage);
    if (options.mode) await at(w, `record-mode-${options.mode}`).trigger('click');
    await at(w, 'record-date').setValue(options.date ?? '2026-11-12');
    await at(w, 'record-stage').setValue(options.stage ?? '');
    await at(w, 'record-form').trigger('submit');
    await flushPromises();
  }

  it('기록이 없으면 배지는 「추정 · 실전 미대조」이고, 입력 칸의 날짜는 오늘이다', async () => {
    const w = await withResult();
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(at(w, 'record-none').text()).toBe('아직 적어 둔 기록이 없다.');
    expect((at(w, 'record-date').element as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(at(w, 'record-mode-mock').attributes('aria-checked')).toBe('true');
  });

  it('대미지·날짜·달성 단계를 적으면 추정 총딜과 나란히 보이고 배지가 「기록과 ○○% 차이」로 바뀐다 — 추정치는 그대로다', async () => {
    const w = await withResult();
    const boss = sample.bosses[0];
    const estimate = boss.ranking[0].total_damage;
    const totalBefore = at(w, 'squad-total').text();
    const cardBefore = texts(w, 'boss-card-total');

    await write(w, '41.53억', { date: '2026-11-10', stage: '4' });
    const check = compareRecord(estimate, { damage: 4_153_000_000, mode: 'mock', date: '2026-11-10' })!;
    expect(check.text).toBe('기록과 12% 차이');
    expect(at(w, 'record-error').exists()).toBe(false);
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 기록과 12% 차이');
    expect(at(w, 'estimate-pill').attributes('data-checked')).toBe('yes');
    expect(at(w, 'estimate-pill').element.closest('details')).toBeNull();
    // 나란히: 추정과 기록, 차이.
    expect(at(w, 'record-estimate').text()).toBe(damageUnit(estimate));
    expect(at(w, 'record-actual').text()).toBe('41.53억');
    expect(at(w, 'record-diff').text()).toBe('기록과 12% 차이');
    expect(at(w, 'record-detail').text()).toBe(check.detail);
    expect(at(w, 'record-detail').text()).toContain('추정이 기록보다 12% 크다');
    // 목록에 날짜·종류·대미지·달성 단계가 있다.
    const item = at(w, 'record-item');
    expect(item.find('[data-testid="record-item-date"]').text()).toBe('2026-11-10');
    expect(item.text()).toContain('모의전');
    expect(item.find('[data-testid="record-item-damage"]').text()).toBe('41.53억');
    expect(item.find('[data-testid="record-item-stage"]').text()).toBe('달성 단계 4');
    // 추정치를 기록에 맞춰 고치지 않는다: 큰 총딜 숫자와 보스 카드의 총딜은 그대로다. 저장된 추천 결과도 바뀌지 않았다.
    expect(at(w, 'squad-total').text()).toBe(totalBefore);
    expect(texts(w, 'boss-card-total')).toEqual(cardBefore);
    expect(disk.intercept).toEqual(sample);
    expect(w.find('[data-role="estimate"]').text()).toBe('추정');
    // 입력 칸은 비워진다. 디스크(계정 폴더)에 기록이 남았다.
    expect((at(w, 'record-damage').element as HTMLInputElement).value).toBe('');
    const saved = disk.plans.get('me') as PlanDoc;
    expect(saved.kind).toBe('intercept_plan');
    expect(saved.records).toHaveLength(1);
    expect(saved.records[0]).toMatchObject({ boss_id: boss.id, boss_name: boss.name, damage: 4_153_000_000, mode: 'mock', date: '2026-11-10', stage: 4 });

    // 다른 보스에는 기록이 없다 — 그 보스의 배지는 그대로 「실전 미대조」다.
    await w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]')[1].trigger('click');
    await flushPromises();
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(at(w, 'record-item').exists()).toBe(false);
    await w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]')[0].trigger('click');
    await flushPromises();
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 기록과 12% 차이');
  });

  it('가장 최근 기록으로 견준다 — 실전 기록을 더 적으면 그것과의 차이로 바뀌고, 지우면 되돌아간다', async () => {
    const w = await withResult();
    const estimate = sample.bosses[0].ranking[0].total_damage;
    await write(w, '41.53억', { date: '2026-11-10' });
    await write(w, '5,814,340,948', { mode: 'real', date: '2026-11-12', stage: '5' });
    const check = compareRecord(estimate, { damage: 5_814_340_948, mode: 'real', date: '2026-11-12' })!;
    expect(check.direction).toBe('under');
    expect(at(w, 'estimate-pill').text()).toBe(`추정 · ${check.text}`);
    expect(at(w, 'record-detail').text()).toContain('실전');
    expect(w.findAll('[data-testid="record-item"]').map((li) => li.find('[data-testid="record-item-date"]').text())).toEqual(['2026-11-12', '2026-11-10']);
    expect(w.findAll('[data-testid="record-item"]')[0].attributes('data-mode')).toBe('real');

    await w.findAll('[data-testid="record-remove"]')[0].trigger('click');
    await flushPromises();
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 기록과 12% 차이');
    await w.findAll('[data-testid="record-remove"]')[0].trigger('click');
    await flushPromises();
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect((disk.plans.get('me') as PlanDoc).records).toEqual([]);
  });

  it('읽을 수 없는 값은 적지 않고 무엇이 틀렸는지 말한다', async () => {
    const w = await withResult();
    await write(w, '많음');
    expect(at(w, 'record-error').text()).toContain('기록을 적지 못했다.');
    expect(at(w, 'record-error').text()).toContain('대미지를 읽을 수 없다');
    expect(disk.plans.has('me')).toBe(false);
    await write(w, '10억', { stage: '사' });
    expect(at(w, 'record-error').text()).toContain('달성 단계는 1~99의 정수다');
    await write(w, '10억', { date: '' });
    expect(at(w, 'record-error').text()).toContain('날짜는 2026-11-12처럼 적는다');
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(api.savePlan).not.toHaveBeenCalled();

    // 저장하지 못하면 알리고 화면의 기록을 되돌린다.
    api.savePlan.mockRejectedValueOnce('요격전 기록을(를) 저장하지 못했다 (디스크가 가득 찼다)');
    await write(w, '10억');
    expect(at(w, 'record-error').text()).toContain('저장하지 못했다');
    expect(at(w, 'record-item').exists()).toBe(false);
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
  });

  it('앱을 다시 켜도 기록과 배지가 남아 있다. 기록은 계정마다 따로다', async () => {
    const w = await withResult();
    await write(w, '41.53억', { date: '2026-11-10', stage: '4' });
    w.unmount();

    const again = await render();
    await openPage(again, 'intercept');
    expect(at(again, 'estimate-pill').text()).toBe('추정 · 기록과 12% 차이');
    expect(at(again, 'record-item').find('[data-testid="record-item-damage"]').text()).toBe('41.53억');
    again.unmount();

    // 다른 계정을 기본 계정으로 고르면 그 계정의 기록(없다)이 보인다.
    disk.addAccount('sub', documents[ACCOUNT_PATH]);
    disk.chosen = 'sub';
    const other = await render();
    await openPage(other, 'intercept');
    expect(at(other, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(at(other, 'record-item').exists()).toBe(false);
    expect(api.loadPlan).toHaveBeenCalled();
  });
});

// ── 홈의 「오늘의 요격전」 ────────────────────────────────────────────────────

describe('홈의 오늘의 요격전 카드', () => {
  it('계정이 없으면 카드가 없다', async () => {
    const w = await render();
    await openPage(w, 'home');
    expect(at(w, 'today-card').exists()).toBe(false);
  });

  it('추천 한 줄 + 그 보스의 1위 편성 초상화 다섯 + 지난 기록이 보이고, 누르면 요격전 화면의 그 보스로 간다', async () => {
    const report = anomalyReport();
    const harvester = report.bosses.find((b) => b.id === 'harvester')!;
    disk.addAccount('me', accountWithGear());
    disk.putIntercept(report);
    disk.plans.set('me', {
      schema_version: 1,
      kind: 'intercept_plan',
      favorites: [],
      records: [{ id: 'r1', boss_id: 'harvester', boss_name: '하베스터', damage: 2_000_000_000, mode: 'real', date: '2026-11-11', stage: 3, note: null, created_at: null }],
    });
    const w = await render();
    await openPage(w, 'home');
    expect(at(w, 'today-pick').text()).toBe('다리 장비가 가장 급하다 → 하베스터');
    expect(at(w, 'today-need').text()).toContain('다리 칸 가운데 1칸이 오버로드가 아니다');
    expect(at(w, 'today-need').text()).toContain('보상 다리 장비');
    const members = w.findAll('[data-testid="today-member"]');
    expect(members.map((m) => m.attributes('title'))).toEqual(harvester.ranking[0].members.map((m) => m.name));
    expect(members.every((m) => m.find('[data-testid="nikke-tile"]').exists())).toBe(true);
    expect(at(w, 'today-total').text()).toBe(`1위 편성 ${damageUnit(harvester.ranking[0].total_damage)}`);
    expect(at(w, 'today-card').find('[data-role="estimate"]').text()).toBe('추정');
    const check = compareRecord(harvester.ranking[0].total_damage, { damage: 2_000_000_000, mode: 'real', date: '2026-11-11' })!;
    expect(at(w, 'today-record').text()).toBe(`지난 기록 20.00억(실전 · 2026-11-11 · 달성 단계 3) — ${check.text}`);
    expect(at(w, 'today-basis').text()).toContain('요격전 추천에서 보스마다 1위 편성에 든 니케 6명');
    expect(at(w, 'today-basis').text()).toContain('언제 다 모이는지는 어림하지 않는다');

    await at(w, 'today-open').trigger('click');
    await flushPromises();
    expect(currentPage(w)).toBe('intercept');
    expect(at(w, 'boss-name').text()).toBe('하베스터');
    expect(at(w, 'estimate-pill').text()).toBe(`추정 · ${check.text}`);
  });

  it('추천이나 기록이 아직 없으면 없다고 적는다', async () => {
    disk.addAccount('me', accountWithGear());
    const w = await render();
    await openPage(w, 'home');
    expect(at(w, 'today-pick').text()).toBe('머리 장비가 가장 급하다 → 울트라');
    expect(at(w, 'today-squad').exists()).toBe(false);
    expect(at(w, 'today-no-squad').text()).toBe('이 보스의 추천 편성은 아직 없다 — 요격전 화면에서 계산한다.');
    expect(at(w, 'today-record').text()).toBe('지난 기록 없음 — 요격전 화면에서 적어 둘 수 있다.');
    expect(at(w, 'today-data-kind').text()).toBe('검증용 데이터');
    await at(w, 'today-open').trigger('click');
    await flushPromises();
    expect(currentPage(w)).toBe('intercept');
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('ultra');
  });

  it('장비 기록이 없는 계정에서는 급한 보스를 지어내지 않는다', async () => {
    disk.addAccount('me', largeAccount);
    const w = await render();
    await openPage(w, 'home');
    expect(at(w, 'today-pick').text()).toBe('주력 니케의 장비가 계정에 적혀 있지 않아 어느 보스가 급한지 알 수 없다.');
    expect(at(w, 'today-open').attributes('data-boss')).toBe('');
    expect(at(w, 'today-squad').exists()).toBe(false);
    expect(at(w, 'today-record').exists()).toBe(false);
  });
});
