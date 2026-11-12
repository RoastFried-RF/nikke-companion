// 오버레이 위젯의 그림(src/views/OverlayWidget.vue — P-028): 모양 셋(접힘·한 줄 카드·펼침), 결과 없음·계산 중·오류,
// 보스가 바뀔 때, 긴 이름, 이미지 없음. 이 그림은 받은 값을 그릴 뿐이다 — Rust를 부르는 것은 이미지 명령뿐이다(가짜).
// 수치는 검증용 샘플(tests/fixtures/intercept.sample.json)이고, 이미지는 코드로 만든 가짜 바이트다.
import { clearMocks } from '@tauri-apps/api/mocks';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bestOf, bestTotal, summaryOf, unconfirmedOf, weakNamesOf } from '../src/lib/bossView';
import { damageUnit } from '../src/lib/format';
import { clearImageCache } from '../src/lib/images';
import { nikkeInfoFrom } from '../src/lib/nikkeInfo';
import { WIDGET_SHORTCUTS } from '../src/lib/widget';
import type { ComputeActivity, InterceptBoss, InterceptReport, NikkeInfo, OverlayShape } from '../src/types';
import OverlayWidget from '../src/views/OverlayWidget.vue';
import widgetSource from '../src/views/OverlayWidget.vue?raw';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog } from './helpers/fakeEngine';
import { fakeImage, mockImages, urlOf } from './helpers/fakeImages';

const sample = interceptFixture as unknown as InterceptReport;
const info = (name: string): NikkeInfo => nikkeInfoFrom(catalog, name);
const bossOf = (id: string): InterceptBoss => sample.bosses.find((b) => b.id === id)!;
const IDLE: ComputeActivity = { running: false, label: '', done: 0, total: 0, elapsed_ms: 0 };

type Props = InstanceType<typeof OverlayWidget>['$props'];

/** 보스 하나를 그린다(약점 속성 니케·한 줄 요약은 오버레이 창의 틀이 넘기는 것과 같은 함수로 만든다). */
async function render(shape: OverlayShape, overrides: Partial<Props> = {}, report: InterceptReport | null = sample) {
  const boss = 'boss' in overrides ? (overrides.boss ?? null) : (report?.bosses[0] ?? null);
  const w = mount(OverlayWidget, {
    props: {
      shape,
      ready: true,
      report,
      boss,
      accountName: 'me',
      savedAt: '2026-11-12T06:00:00.000Z',
      info,
      weak: weakNamesOf(boss, info),
      summary: summaryOf(boss, true, info),
      activity: IDLE,
      ...overrides,
    },
  });
  await flushPromises();
  return w;
}
type Wrapper = Awaited<ReturnType<typeof render>>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const all = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`);

beforeEach(() => {
  clearImageCache();
  mockImages();
});
afterEach(() => clearMocks());

describe('모양 셋', () => {
  it('접힘(알약): 보스 얼굴·이름·총딜과 「추정」만 — 니케·요약·순위는 없다', async () => {
    const boss = bossOf('test-a');
    const w = await render('collapsed');
    expect(at(w, 'widget').attributes('data-shape')).toBe('collapsed');
    expect(at(w, 'widget').attributes('data-state')).toBe('result');
    expect(at(w, 'widget-pill').exists()).toBe(true);
    expect(at(w, 'boss-face').attributes('data-boss')).toBe('test-a');
    expect(at(w, 'widget-boss').text()).toBe(boss.name);
    expect(at(w, 'widget-total').text()).toBe(damageUnit(bestTotal(boss)));
    // 「추정」은 접혀 있어도 보인다.
    expect(at(w, 'estimate-pill').text()).toBe('추정');
    for (const hidden of ['widget-squad', 'widget-more', 'widget-meta', 'boss-summary', 'rank-row', 'nikke-tile']) expect(at(w, hidden).exists(), hidden).toBe(false);
    // 접힌 동안 안 보이는 것(어느 계정·언제, 검증용)은 풍선 도움말에 있다.
    const title = at(w, 'widget-open').attributes('title') ?? '';
    expect(title).toContain(sample.account.name);
    expect(title).toContain('검증용 데이터');
    expect(title).toContain('Alt+Shift+M');
    // 알약을 누르면 한 줄 카드로 편다.
    await at(w, 'widget-open').trigger('click');
    expect(w.emitted('shape')).toEqual([['card']]);
  });

  it('한 줄 카드(기본): 보스 얼굴·이름·「약점 ○○」·총딜·「추정」·작은 초상화 다섯(버스트 배지, 약점 속성 강조)', async () => {
    const boss = bossOf('test-a');
    const best = bestOf(boss)!;
    const w = await render('card');
    expect(at(w, 'widget').attributes('data-shape')).toBe('card');
    expect(at(w, 'widget-card').find('[data-testid="boss-face"]').classes()).toContain('face--md');
    expect(at(w, 'widget-boss').text()).toBe(boss.name);
    expect(at(w, 'widget-card').find('[data-testid="element-chip-text"]').text()).toBe(`약점 ${boss.element.weak_to}`);
    expect(at(w, 'widget-total').text()).toBe(damageUnit(best.total_damage));
    expect(at(w, 'estimate-pill').text()).toBe('추정');

    // 자리 순서대로 작은 초상화 다섯 — 이름은 풍선 도움말에, 버스트 배지는 타일 위에 있다.
    const members = all(w, 'widget-member');
    expect(members).toHaveLength(5);
    expect(members.map((m) => (m.attributes('title') ?? '').split(' — ')[0])).toEqual(best.members.map((m) => m.name));
    const tiles = at(w, 'widget-squad').findAll('[data-testid="nikke-tile"]');
    expect(tiles.every((t) => t.classes().includes('tile--mini'))).toBe(true);
    expect(tiles.map((t) => t.find('[data-testid="burst-badge"]').attributes('data-stage'))).toEqual(best.members.map((m) => info(m.name).burst ?? ''));
    // 얼굴만이다: 이름·딜 막대는 그리지 않는다(펼치면 보인다).
    expect(at(w, 'widget-squad').find('[data-testid="nikke-tile-name"]').exists()).toBe(false);
    expect(at(w, 'widget-squad').find('[data-testid="damage-bar"]').exists()).toBe(false);
    // 약점 속성(작열) 니케는 속성 색 테두리로 강조한다.
    const weak = weakNamesOf(boss, info);
    expect(weak.length).toBeGreaterThan(0);
    expect(members.map((m) => m.attributes('data-weak'))).toEqual(best.members.map((m) => (weak.includes(m.name) ? 'yes' : 'no')));
    expect(tiles.filter((t) => t.classes().includes('tile--weak'))).toHaveLength(best.members.filter((m) => weak.includes(m.name)).length);

    // 어느 계정·언제의 결과인지 작게 보인다. 검증용 데이터 표시도 있다.
    expect(at(w, 'widget-source').text()).toContain(sample.account.name);
    expect(at(w, 'widget-source').text()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} 계산$/);
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    // 펼침의 것은 없다.
    for (const hidden of ['widget-more', 'boss-summary', 'widget-seats', 'rank-row', 'widget-shortcuts']) expect(at(w, hidden).exists(), hidden).toBe(false);
  });

  it('펼침: 한 줄 카드 + 한 줄 요약 + 자리 순서 + 2·3위 + 보스 고르기 + 단축키 안내', async () => {
    const boss = bossOf('test-a');
    const best = bestOf(boss)!;
    const w = await render('expanded');
    expect(at(w, 'widget').attributes('data-shape')).toBe('expanded');
    // 윗줄은 한 줄 카드 그대로다.
    expect(at(w, 'widget-card').exists()).toBe(true);
    expect(all(w, 'widget-member')).toHaveLength(5);
    // 한 줄 요약은 루트의 순수 함수가 만든 문장이다.
    expect(at(w, 'boss-summary').text()).toBe(summaryOf(boss, true, info));
    expect(at(w, 'boss-summary').text().length).toBeGreaterThan(5);
    // 자리 순서: 1번부터 다섯, 이름과 딜 비중이 보인다.
    const seats = all(w, 'widget-seat');
    expect(seats.map((s) => s.find('[data-testid="widget-seat-no"]').text())).toEqual(['1', '2', '3', '4', '5']);
    expect(seats.map((s) => s.find('[data-testid="nikke-tile-name"]').text())).toEqual(best.members.map((m) => m.name));
    expect(seats.every((s) => s.find('[data-testid="damage-bar"]').exists())).toBe(true);
    expect(at(w, 'widget-more').text()).toContain('자리 순서 — 편성 칸에 1번부터 이 순서로 놓는다');
    // 2·3위.
    expect(all(w, 'rank-row').map((r) => r.attributes('data-rank'))).toEqual(['2', '3']);
    expect(all(w, 'rank-row-total').map((t) => t.text())).toEqual(boss.ranking.filter((e) => e.rank > 1).map((e) => damageUnit(e.total_damage)));
    // 보스 고르기: 결과의 보스 다섯, 지금 보스가 눌려 있다.
    const picks = all(w, 'widget-boss-pick');
    expect(picks.map((p) => p.attributes('data-boss'))).toEqual(sample.bosses.map((b) => b.id));
    expect(picks.map((p) => p.attributes('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    await picks[2].trigger('click');
    expect(w.emitted('pick')).toEqual([['test-c']]);
    // 단축키(보이기/숨기기·클릭 통과·모양 바꾸기)가 작게 안내된다.
    expect(all(w, 'widget-shortcut').map((s) => s.find('kbd').text())).toEqual(['Alt+Shift+O', 'Alt+Shift+C', 'Alt+Shift+M']);
    expect(all(w, 'widget-shortcut').map((s) => s.text())).toEqual(WIDGET_SHORTCUTS.map((s) => `${s.keys} ${s.what}`));
  });

  it('누르면 모양이 오간다: 카드의 보스를 누르면 펼치고, 펼친 것을 누르면 줄이고, 접기 단추는 알약으로', async () => {
    const card = await render('card');
    await at(card, 'widget-toggle').trigger('click');
    expect(card.emitted('shape')).toEqual([['expanded']]);
    await at(card, 'widget-collapse').trigger('click');
    expect(card.emitted('shape')).toEqual([['expanded'], ['collapsed']]);

    const expanded = await render('expanded');
    await at(expanded, 'widget-toggle').trigger('click');
    expect(expanded.emitted('shape')).toEqual([['card']]);
    // 단축키를 풍선 도움말로도 알린다.
    expect(at(card, 'widget-toggle').attributes('title')).toContain('Alt+Shift+M');
    expect(at(card, 'widget-hide').attributes('title')).toContain('Alt+Shift+O');
  });

  it('핀: 눌러서 고정하고 다시 눌러 푼다 — 고정 여부가 단추에 보인다', async () => {
    const loose = await render('card');
    expect(at(loose, 'widget-pin').attributes('aria-pressed')).toBe('false');
    await at(loose, 'widget-pin').trigger('click');
    expect(loose.emitted('pin')).toEqual([[true]]);

    const pinned = await render('card', { pinned: true });
    expect(at(pinned, 'widget-pin').attributes('aria-pressed')).toBe('true');
    expect(at(pinned, 'widget-pin').classes()).toContain('tool--on');
    expect(at(pinned, 'widget-pin').attributes('title')).toContain('이상 개체 화면을 떠나도 그대로 둔다');
    await at(pinned, 'widget-pin').trigger('click');
    expect(pinned.emitted('pin')).toEqual([[false]]);
  });

  it('숨기기 단추와 끌기 손잡이는 어느 모양에나 있다 — 끝내기는 없다', async () => {
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      const w = await render(shape);
      expect(at(w, 'widget-grip').attributes('data-tauri-drag-region'), shape).toBeDefined();
      if (shape !== 'collapsed') {
        await at(w, 'widget-hide').trigger('click');
        expect(w.emitted('hide'), shape).toHaveLength(1);
      }
      expect(at(w, 'quit').exists(), shape).toBe(false);
    }
    expect(widgetSource).not.toMatch(/끝내기|quit/i);
  });
});

describe('숨기면 안 되는 표시', () => {
  it('「추정」은 세 모양 모두에 있다', async () => {
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      const w = await render(shape);
      expect(at(w, 'estimate-pill').text(), shape).toBe('추정');
      expect(at(w, 'estimate-pill').attributes('title'), shape).toContain('실제 전투 기록과 맞춰 본 적이 없다');
    }
  });

  it('미확인 값·속성 상성 미반영·검증용 보스 정보는 펼침 모양에서 배지로 보인다 — 한 줄 카드에는 줄인 배지가 남는다', async () => {
    const boss = bossOf('test-e');
    const counted = unconfirmedOf(boss).length;
    expect(counted).toBeGreaterThan(0);
    expect(boss.flags).toEqual(['속성 상성 미반영']);

    const expanded = await render('expanded', { boss });
    expect(at(expanded, 'boss-flag').text()).toBe('속성 상성 미반영');
    expect(at(expanded, 'boss-unconfirmed').text()).toBe(`미확인 값 ${counted}칸`);
    // 칸별 내용은 풍선 도움말에 빠짐없이 있다.
    const detail = at(expanded, 'boss-unconfirmed').attributes('title') ?? '';
    for (const u of unconfirmedOf(boss)) expect(detail).toContain(`${u.label}: ${u.text}`);
    expect(at(expanded, 'bundle-kind').text()).toBe('검증용 보스 정보');
    expect(at(expanded, 'data-kind').text()).toBe('검증용 데이터');
    // 접힌 구획 안이 아니다.
    for (const id of ['boss-flag', 'boss-unconfirmed', 'bundle-kind', 'data-kind', 'estimate-pill']) expect(at(expanded, id).element.closest('details'), id).toBeNull();
    // 속성을 모르는 보스: 약점은 「모름」이고 한 줄 요약이 미반영을 말한다.
    expect(at(expanded, 'widget-card').find('[data-testid="element-chip-text"]').text()).toBe('약점 모름');
    expect(at(expanded, 'boss-summary').text()).toContain('속성 상성 미반영');

    // 한 줄 카드: 자세한 배지 대신 「확인할 표시 N개」가 남는다(없애지 않는다).
    const card = await render('card', { boss });
    expect(at(card, 'boss-unconfirmed').exists()).toBe(false);
    expect(at(card, 'widget-cautions').text()).toBe(`확인할 표시 ${counted + 1}개`);
    // 표시할 것이 없는 보스에는 그 배지가 없다.
    const clean = structuredClone(bossOf('test-a'));
    clean.unconfirmed = [];
    clean.flags = [];
    expect(at(await render('card', { boss: clean }), 'widget-cautions').exists()).toBe(false);
  });

  it('실제 계정의 결과에는 검증용 표시가 없고, 밝히지 않은 결과는 「데이터 구분 미확인」이다', async () => {
    const real = structuredClone(sample);
    real.account.is_test_data = false;
    real.bundle.is_test_data = false;
    const w = await render('expanded', {}, real);
    expect(at(w, 'data-kind').exists()).toBe(false);
    expect(at(w, 'bundle-kind').exists()).toBe(false);
    expect(at(w, 'estimate-pill').exists()).toBe(true);

    const unsaid = structuredClone(sample);
    delete unsaid.account.is_test_data;
    expect(at(await render('card', {}, unsaid), 'data-kind').text()).toBe('데이터 구분 미확인');
  });

  it('클릭 통과 중이면 어느 모양에서나 알리고 끄는 단축키를 적는다', async () => {
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      const w = await render(shape, { clickThrough: true });
      expect(at(w, 'widget').classes(), shape).toContain('widget--passthrough');
      expect(at(w, 'click-through-on').text(), shape).toContain('클릭 통과');
      expect(`${at(w, 'click-through-on').text()} ${at(w, 'click-through-on').attributes('title') ?? ''}`, shape).toContain('Alt+Shift+C');
    }
    const off = await render('card');
    expect(at(off, 'click-through-on').exists()).toBe(false);
    expect(at(off, 'widget').classes()).not.toContain('widget--passthrough');
  });
});

describe('결과 없음 · 계산 중 · 오류', () => {
  it('아직 계산하지 않았으면 한 줄로 알리고 「앱 열기」만 둔다 — 계산 단추가 없다', async () => {
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      const w = await render(shape, {}, null);
      expect(at(w, 'widget').attributes('data-state'), shape).toBe('empty');
      expect(at(w, 'widget-notice-text').text(), shape).toBe('아직 요격전 추천이 없다 — 앱에서 계산한다');
      expect(at(w, 'widget-notice').attributes('role')).toBe('status');
      for (const hidden of ['widget-card', 'widget-pill', 'widget-squad', 'widget-activity']) expect(at(w, hidden).exists(), hidden).toBe(false);
      // 단추는 「앱 열기」와 숨기기뿐이다.
      expect(w.findAll('button').map((b) => b.attributes('data-testid')), shape).toEqual(['open-app', 'widget-hide']);
      await at(w, 'open-app').trigger('click');
      expect(w.emitted('open-app'), shape).toHaveLength(1);
    }
  });

  it('계정이 없으면 계정부터 연결하라고 알린다', async () => {
    const w = await render('card', { accountName: null }, null);
    expect(at(w, 'widget').attributes('data-state')).toBe('no-account');
    expect(at(w, 'widget-notice-text').text()).toBe('연결된 계정이 없다 — 앱에서 계정을 연결한다');
    expect(at(w, 'open-app').text()).toBe('앱 열기');
  });

  it('저장해 둔 것을 읽기 전에는 「없다」고 단정하지 않는다', async () => {
    const w = await render('card', { ready: false, accountName: null }, null);
    expect(at(w, 'widget').attributes('data-state')).toBe('loading');
    expect(at(w, 'widget-notice-text').text()).toBe('저장해 둔 추천을 읽는 중');
    expect(at(w, 'open-app').exists()).toBe(false);
  });

  it('결과 없이 계산 중이면 한 줄과 작은 진행 막대·남은 시간 어림이 보인다', async () => {
    const activity: ComputeActivity = { running: true, label: '크라켄 추천 편성을 찾는 중', done: 30, total: 60, elapsed_ms: 30_000 };
    const w = await render('card', { activity }, null);
    expect(at(w, 'widget').attributes('data-state')).toBe('computing');
    expect(at(w, 'widget-notice-text').text()).toBe('앱에서 추천을 계산하는 중');
    expect(at(w, 'widget-activity-fill').attributes('style')).toContain('width: 50%');
    // 30건에 30초 → 남은 30건은 약 30초.
    expect(at(w, 'widget-activity-eta').text()).toBe('약 30초 남음');
    expect(at(w, 'widget-activity').attributes('title')).toContain('크라켄 추천 편성을 찾는 중');
    // 계산을 멈추는 단추는 없다 — 「앱 열기」뿐이다.
    expect(w.findAll('button').map((b) => b.attributes('data-testid'))).toEqual(['open-app', 'widget-hide']);

    // 처음 몇 건 전에는 숫자를 내지 않는다(「계산 중」), 전체를 모르면 막대를 채우지 않는다.
    const early = await render('card', { activity: { running: true, label: '', done: 0, total: 0, elapsed_ms: 500 } }, null);
    expect(at(early, 'widget-activity-eta').text()).toBe('계산 중');
    expect(at(early, 'widget-activity-fill').attributes('style')).toContain('width: 0%');
    expect(early.find('.busy__track').classes()).toContain('busy__track--waiting');
  });

  it('결과가 있는 채로 다시 계산 중이면 앞의 결과를 그대로 두고 진행을 작게 덧붙인다', async () => {
    const activity: ComputeActivity = { running: true, label: '울트라 추천 편성을 찾는 중', done: 45, total: 60, elapsed_ms: 90_000 };
    const card = await render('card', { activity });
    expect(at(card, 'widget').attributes('data-state')).toBe('result');
    expect(at(card, 'widget-boss').text()).toBe(bossOf('test-a').name);
    expect(at(card, 'widget-activity').text()).toContain('앱에서 다시 계산하는 중');
    expect(at(card, 'widget-activity-fill').attributes('style')).toContain('width: 75%');
    expect(at(card, 'widget-activity-eta').text()).toBe('약 30초 남음');
    // 접힌 알약에는 한마디로.
    const pill = await render('collapsed', { activity });
    expect(at(pill, 'widget-activity').text()).toBe('계산 중');
    expect(at(pill, 'widget-activity').attributes('title')).toContain('울트라 추천 편성을 찾는 중');
    // 계산이 끝나면 사라진다.
    await card.setProps({ activity: IDLE });
    expect(at(card, 'widget-activity').exists()).toBe(false);
  });

  it('게임에서 보고 있는 보스가 결과에 없으면 다른 보스의 편성을 보이지 않고 그 보스를 계산하라고 알린다', async () => {
    const w = await render('card', { boss: null, missing: { id: 'kraken', name: '크라켄', element: '철갑' } });
    expect(at(w, 'widget').attributes('data-state')).toBe('missing');
    expect(at(w, 'widget-notice-text').text()).toBe('크라켄 추천이 아직 없다 — 앱에서 계산한다');
    expect(at(w, 'boss-face').attributes('data-boss')).toBe('kraken');
    expect(at(w, 'boss-face').attributes('data-element')).toBe('철갑');
    expect(at(w, 'widget-squad').exists()).toBe(false);
    expect(at(w, 'open-app').exists()).toBe(true);
    // 그 보스를 계산하는 중이면 그렇게 알린다.
    const busy = await render('card', { boss: null, missing: { id: 'kraken', name: '크라켄' }, activity: { running: true, label: '', done: 3, total: 60, elapsed_ms: 4000 } });
    expect(at(busy, 'widget-notice-text').text()).toBe('크라켄 — 앱에서 추천을 계산하는 중');
    expect(at(busy, 'widget-activity').exists()).toBe(true);
  });

  it('계산하지 않은 보스는 총딜을 0으로 적지 않고 「아직 없다」고 알린다', async () => {
    const boss = structuredClone(bossOf('test-b'));
    boss.status = 'not_computed';
    boss.ranking = [];
    const w = await render('card', { boss });
    expect(at(w, 'widget').attributes('data-state')).toBe('missing');
    expect(at(w, 'widget-notice-text').text()).toBe(`${boss.name} 추천이 아직 없다 — 앱에서 계산한다`);
    expect(w.text()).not.toMatch(/총딜|0억|0만/);
  });

  it('문제(결과를 읽지 못했다·앱 창을 열지 못했다)는 한국어로 알린다 — 앞의 결과는 그대로 보인다', async () => {
    const problems = ['앞서 저장한 요격전 추천을 읽지 못했다: 요격전 추천 결과가 아니다', '앱 창을 열지 못했다: 앱 창을 찾을 수 없다'];
    const card = await render('card', { problems });
    expect(all(card, 'widget-error').map((e) => e.text())).toEqual(problems);
    expect(all(card, 'widget-error').every((e) => e.attributes('role') === 'alert')).toBe(true);
    expect(at(card, 'widget-boss').text()).toBe(bossOf('test-a').name);
    // 접힌 알약: 한마디 배지와 풍선 도움말.
    const pill = await render('collapsed', { problems });
    expect(at(pill, 'widget-error').text()).toBe('문제 있음');
    expect(at(pill, 'widget-error').attributes('title')).toContain('앱 창을 열지 못했다');
    // 결과가 없을 때도 알린다.
    const empty = await render('card', { problems }, null);
    expect(all(empty, 'widget-error').map((e) => e.text())).toEqual(problems);
    expect(at(empty, 'open-app').exists()).toBe(true);
  });
});

describe('보스가 바뀔 때', () => {
  it('다른 보스로 바뀌면 이름·약점·총딜·니케·요약이 그 보스의 것으로 바뀐다', async () => {
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      const w = await render(shape);
      expect(at(w, 'widget-boss').text()).toBe('시험 보스 A');
      const next = bossOf('test-d');
      await w.setProps({ boss: next, weak: weakNamesOf(next, info), summary: summaryOf(next, true, info) });
      await flushPromises();
      expect(at(w, 'widget-boss').text(), shape).toBe('시험 보스 D');
      expect(at(w, 'widget-total').text(), shape).toBe(damageUnit(bestTotal(next)));
      expect(at(w, 'boss-face').attributes('data-boss'), shape).toBe('test-d');
      if (shape === 'collapsed') continue;
      expect(at(w, 'widget-card').find('[data-testid="element-chip-text"]').text(), shape).toBe('약점 전격');
      expect(all(w, 'widget-member').map((m) => (m.attributes('title') ?? '').split(' — ')[0]), shape).toEqual(bestOf(next)!.members.map((m) => m.name));
      // 약점 속성(전격) 니케의 강조도 새 보스 기준이다.
      const weak = weakNamesOf(next, info);
      expect(all(w, 'widget-member').map((m) => m.attributes('data-weak')), shape).toEqual(bestOf(next)!.members.map((m) => (weak.includes(m.name) ? 'yes' : 'no')));
      if (shape === 'expanded') {
        expect(at(w, 'boss-summary').text()).toBe(summaryOf(next, true, info));
        expect(all(w, 'widget-boss-pick').map((p) => p.attributes('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false']);
      }
    }
  });

  it('보스가 결과에 없게 됐다가 다시 생기면 알림 줄과 카드를 오간다', async () => {
    const w = await render('card');
    await w.setProps({ boss: null, missing: { id: 'ultra', name: '울트라' } });
    expect(at(w, 'widget').attributes('data-state')).toBe('missing');
    expect(at(w, 'widget-card').exists()).toBe(false);
    await w.setProps({ boss: bossOf('test-b'), missing: null });
    expect(at(w, 'widget').attributes('data-state')).toBe('result');
    expect(at(w, 'widget-boss').text()).toBe('시험 보스 B');
  });
});

describe('긴 이름 · 이미지 없음', () => {
  it('긴 보스 이름·긴 니케 이름·긴 계정 이름은 한 줄로 줄이고 전체를 풍선 도움말에 둔다', async () => {
    const longBoss = '아주 긴 이름을 가진 시험용 이상 개체 보스 — 제2형태(강화)';
    const longNikke = '라피 : 레드 후드 — 아주 긴 이름의 검증용 니케';
    const report = structuredClone(sample);
    report.account.name = '이름이 아주 아주 아주 긴 검증용 계정의 이름이 여기에 들어간다';
    const boss = report.bosses[0];
    boss.name = longBoss;
    boss.ranking[0].members[3].name = longNikke;
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      const w = await render(shape, { boss }, report);
      expect(at(w, 'widget-boss').text(), shape).toBe(longBoss);
      if (shape === 'collapsed') {
        expect(at(w, 'widget-open').attributes('title'), shape).toContain(longBoss);
        continue;
      }
      expect(at(w, 'widget-boss').attributes('title'), shape).toBe(longBoss);
      expect(all(w, 'widget-member')[3].attributes('title'), shape).toContain(longNikke);
      expect(at(w, 'widget-source').attributes('title'), shape).toContain(report.account.name);
      // 다섯 장은 그대로 다섯 장이다(긴 이름이 줄을 밀어내지 않는다 — 이름은 타일 밖에 그리지 않는다).
      expect(all(w, 'widget-member'), shape).toHaveLength(5);
    }
    // 줄임표로 줄이는 모양이 스타일에 있다.
    expect(widgetSource).toMatch(/\.capsule__name,\s*\.card__name \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(widgetSource).toMatch(/\.caption__source \{[^}]*text-overflow: ellipsis;/);
    // 위젯의 상자 이름은 예전 전역 스타일(.meta·.badge·.block …)이나 부품의 뿌리(.pill·.chip·.tile)와 겹치지 않는다 — 겹치면 그 규칙이 걸려
    // 줄이 세로로 쌓인다(실제 창에서 본 결함).
    const classes = new Set([...widgetSource.matchAll(/class="([a-z_-]+)/g)].map((m) => m[1]));
    for (const taken of ['meta', 'badge', 'block', 'empty', 'notes', 'fold', 'bullets', 'issues', 'screen', 'panel', 'pill', 'chip', 'tile', 'rank', 'bar', 'boss']) {
      expect(classes.has(taken), taken).toBe(false);
    }
  });

  it('이미지가 없으면 대체 그림이다: 보스는 속성 색 바탕의 첫 글자, 니케는 이름 첫 글자 — 오류가 아니다', async () => {
    const boss = bossOf('test-a');
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      const w = await render(shape);
      const face = at(w, 'boss-face');
      expect(face.attributes('data-image'), shape).toBe('color');
      expect(face.attributes('data-element'), shape).toBe(boss.element.code);
      expect(face.find('[data-testid="boss-face-fallback"]').text(), shape).toBe('시');
      expect(at(w, 'widget-error').exists(), shape).toBe(false);
      if (shape === 'collapsed') continue;
      const tiles = at(w, 'widget-squad').findAll('[data-testid="nikke-tile"]');
      expect(tiles.map((t) => t.attributes('data-portrait')), shape).toEqual(['initial', 'initial', 'initial', 'initial', 'initial']);
      expect(tiles.map((t) => t.find('[data-testid="nikke-tile-initial"]').text()), shape).toEqual(bestOf(boss)!.members.map((m) => Array.from(m.name)[0]));
    }
  });

  it('이미지가 있으면 그것을 그린다(보스 이미지·초상화)', async () => {
    clearMocks();
    mockImages({ portraits: ['크라운', '앨리스'], bosses: { 'test-a': 'capture' } });
    const w = await render('card');
    const face = at(w, 'boss-face');
    expect(face.attributes('data-image')).toBe('image');
    expect(face.find('img').attributes('src')).toBe(urlOf(fakeImage('boss:test-a', 'capture', 'image/png')));
    const tiles = at(w, 'widget-squad').findAll('[data-testid="nikke-tile"]');
    const members = bestOf(bossOf('test-a'))!.members.map((m) => m.name);
    expect(tiles.map((t) => t.attributes('data-portrait'))).toEqual(members.map((name) => (['크라운', '앨리스'].includes(name) ? 'image' : 'initial')));
    expect(tiles[members.indexOf('크라운')].find('img').attributes('src')).toBe(urlOf(fakeImage('portrait:크라운')));
  });

  it('니케 정보를 모르면 버스트 단계는 「?」이고 약점 강조를 지어내지 않는다', async () => {
    const unknown = (name: string): NikkeInfo => ({ name, known: false, element: null, burst: null, weapon: null, corp: null, klass: null, rarity: null });
    const boss = structuredClone(bossOf('test-a'));
    delete (boss as Partial<InterceptBoss>).weak_pool;
    const w = await render('card', { boss, info: unknown, weak: weakNamesOf(boss, unknown), summary: summaryOf(boss, false, unknown) });
    expect(at(w, 'widget-squad').findAll('[data-testid="burst-badge"]').map((b) => b.attributes('data-stage'))).toEqual(['', '', '', '', '']);
    expect(all(w, 'widget-member').map((m) => m.attributes('data-weak'))).toEqual(['no', 'no', 'no', 'no', 'no']);
  });
});

describe('이 그림이 하지 않는 것', () => {
  it('입력 칸·계산 단추·설정이 없고, Rust 명령을 직접 부르지 않는다', () => {
    expect(widgetSource).not.toMatch(/<input|<select|<textarea|run-intercept|run-compute/);
    expect(widgetSource).not.toMatch(/lib\/(backend|compute|engineRun|accountSync|shared|screenTrack)'/);
    expect(widgetSource).not.toMatch(/invoke\(|engineRunBatch|announceActivity/);
  });

  it('세 모양 어디에도 계산을 시작하거나 멈추는 단추가 없다', async () => {
    const activity: ComputeActivity = { running: true, label: '찾는 중', done: 1, total: 9, elapsed_ms: 1000 };
    for (const shape of ['collapsed', 'card', 'expanded'] as const) {
      for (const report of [sample, null]) {
        const w = await render(shape, { activity }, report);
        for (const button of w.findAll('button')) {
          expect(button.attributes('data-testid'), shape).toMatch(/^(open-app|widget-(hide|open|toggle|pin|collapse|boss-pick))$/);
          expect(`${button.text()} ${button.attributes('title') ?? ''}`, shape).not.toMatch(/중단|다시 계산|추천 계산/);
        }
      }
    }
  });
});
