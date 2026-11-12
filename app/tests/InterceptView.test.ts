// 요격전 결과 화면의 컴포넌트 테스트.
// 입력은 실제 CLI가 만든 샘플 결과다(fixtures/intercept.sample.json — `npm run fixture -- intercept`로 다시 만든다):
//   node src/cli.mjs intercept --no-cache --account data/samples/account.sample.json \
//     --bosses data/samples/bosses.anomaly.sample.json --budget 40 --top 3 --json …
// 검증용 보스 묶음의 보스 5종: A(적 설정을 여러 칸 채움) · B(속성과 약점만) · C·D(약점만 — 속성은 유도) · E(둘 다 모름).
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatDamage, groupThousands } from '@core/format.mjs';
import { searchLine } from '@core/render.mjs';
import InterceptView from '../src/components/InterceptView.vue';
import type { InterceptBoss, InterceptReport } from '../src/types';
import fixture from './fixtures/intercept.sample.json';

const sample = fixture as unknown as InterceptReport;

/** 샘플을 복사해 일부만 바꾼다. 샘플에 없는 경우(계산하지 않은 보스 등)를 만들 때만 쓴다. */
function variant(change: (report: InterceptReport) => void): InterceptReport {
  const copy = structuredClone(sample);
  change(copy);
  return copy;
}

const render = (report: InterceptReport = sample) => mount(InterceptView, { props: { report } });
type Wrapper = ReturnType<typeof render>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());
const bossOf = (id: string): InterceptBoss => sample.bosses.find((b) => b.id === id)!;

async function pick(w: Wrapper, id: string): Promise<void> {
  await w.find(`[data-testid="boss-tab"][data-boss="${id}"]`).trigger('click');
}

beforeEach(() => localStorage.clear());

describe('샘플 결과(실제 CLI 출력)', () => {
  it('fixture는 검증용 계정·검증용 보스 묶음으로 만든 요격전 추천 결과다', () => {
    expect(sample.kind).toBe('intercept_report');
    expect(sample.schema_version).toBe(1);
    expect(sample.account.is_test_data).toBe(true);
    expect(sample.bundle.is_test_data).toBe(true);
    expect(sample.bosses.map((b) => b.id)).toEqual(['test-a', 'test-b', 'test-c', 'test-d', 'test-e']);
    expect(sample.bosses.every((b) => b.status === 'computed' && b.ranking.length === 3)).toBe(true);
  });

  it('접지 않은 상태에서 보스 이름·약점 속성·1위 편성 5명이 보인다', () => {
    const w = render();
    const visible = (testid: string) => w.findAll(`[data-testid="${testid}"]`).filter((el) => el.element.closest('details') === null);
    expect(visible('boss-name').map((el) => el.text())).toEqual(['시험 보스 A']);
    expect(visible('boss-weak').map((el) => el.text())).toEqual(['약점 작열']);
    const best = w.findAll('[data-testid="ranking-entry"]')[0];
    expect(best.element.closest('details')).toBeNull();
    expect(best.find('[data-testid="rank"]').text()).toBe('1위');
    const members = best.findAll('[data-testid="member-name"]');
    expect(members.map((m) => m.text())).toEqual(['리틀 머메이드', '크라운', '나가', '라피 : 레드 후드', '앨리스']);
    expect(members.every((m) => m.element.closest('details') === null)).toBe(true);
  });

  it('보스 목록에 보스 5종이 약점 속성과 함께 보이고, 고른 보스가 표시된다', () => {
    const w = render();
    const tabs = w.findAll('[data-testid="boss-tab"]');
    expect(tabs.map((t) => t.find('.bosses__name').text())).toEqual(sample.bosses.map((b) => b.name));
    expect(tabs.map((t) => t.find('.bosses__weak').text())).toEqual(['작열', '풍압', '수냉', '전격', '약점 ?']);
    expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
  });

  it('보스를 고르면 그 보스의 상위 편성(멤버·총딜·멤버별 딜)을 보인다', async () => {
    const w = render();
    await pick(w, 'test-b');
    const b = bossOf('test-b');
    expect(at(w, 'boss-name').text()).toBe('시험 보스 B');
    expect(at(w, 'boss-weak').text()).toBe('약점 풍압');
    expect(at(w, 'boss-code').text()).toBe('속성 철갑');
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위']);
    expect(texts(w, 'total-unit')).toEqual(b.ranking.map((r) => formatDamage(r.total_damage)));
    expect(texts(w, 'total-raw')).toEqual(b.ranking.map((r) => `(${groupThousands(r.total_damage)})`));
    expect(texts(w, 'total-unit')[0]).toBe('27.89억');
    expect(texts(w, 'relative')).toEqual(['기준', '1위 대비 97.8%', '1위 대비 97.6%']);
    // 멤버별 딜은 편성 배치 순서 그대로다.
    const first = w.findAll('[data-testid="ranking-entry"]')[0];
    expect(first.findAll('[data-testid="member-name"]').map((m) => m.text())).toEqual(b.ranking[0].members.map((m) => m.name));
    expect(first.findAll('[data-testid="member-unit"]').map((m) => m.text())).toEqual(b.ranking[0].members.map((m) => formatDamage(m.damage)));
    expect(first.findAll('[data-testid="member-raw"]').map((m) => m.text())).toEqual(b.ranking[0].members.map((m) => groupThousands(m.damage)));
    expect(w.findAll('[data-testid="boss-tab"]').map((t) => t.attributes('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false']);
  });

  it('보스의 약점 속성 니케에는 편성 안에서 표시가 붙는다', () => {
    const w = render();
    expect(bossOf('test-a').weak_pool?.owned).toEqual(['라피 : 레드 후드', '앨리스']);
    const first = w.findAll('[data-testid="ranking-entry"]')[0];
    const marked = first
      .findAll('[data-testid="member"]')
      .filter((row) => row.find('[data-testid="member-mark"]').exists())
      .map((row) => row.find('[data-testid="member-name"]').text());
    expect(marked).toEqual(['라피 : 레드 후드', '앨리스']);
    expect(first.find('[data-testid="member-mark"]').text()).toBe('약점');
  });

  it('미확인 값이 있는 보스는 눈에 띄게 표시하고, 무엇을 무엇으로 계산했는지 보인다', async () => {
    const w = render();
    // 보스 A: 거리·파츠 파괴 주기·적정 거리 무기군 세 칸이 미확인이다.
    const badge = at(w, 'boss-unconfirmed');
    expect(badge.text()).toBe('미확인 값 3칸 — 확정값이 아니다');
    expect(badge.classes()).toContain('badge--warn');
    expect(badge.element.closest('details')).toBeNull();
    expect(texts(w, 'unconfirmed-item')).toEqual(bossOf('test-a').unconfirmed.map((u) => `${u.label}: ${u.text}`));
    expect(texts(w, 'unconfirmed-item')[0]).toBe('교전 거리: 거리 없음(엔진 기본값 — 니케별 적정 거리를 따지지 않는다)');

    await pick(w, 'test-b');
    expect(at(w, 'boss-unconfirmed').text()).toBe('미확인 값 7칸 — 확정값이 아니다');
    expect(texts(w, 'unconfirmed-item')).toContain('방어력: 31,784(엔진 기본값 — 솔로 레이드 Lv 400 보스 방어력)');
    // 보스 목록에서도 미확인 값이 있는 보스마다 표시가 붙는다(이 묶음은 다섯 보스 모두).
    for (const tab of w.findAll('[data-testid="boss-tab"]')) {
      expect(tab.find('[data-testid="boss-tab-unconfirmed"]').exists()).toBe(true);
    }
  });

  it('"속성 상성 미반영" 보스는 눈에 띄게 표시한다 — 보스 목록과 보스 머리 양쪽에', async () => {
    const w = render();
    // 다른 보스에는 없다.
    expect(at(w, 'boss-flag').exists()).toBe(false);
    const tabs = w.findAll('[data-testid="boss-tab"]');
    expect(tabs.map((t) => t.find('[data-testid="boss-tab-flag"]').exists())).toEqual([false, false, false, false, true]);
    expect(tabs[4].find('[data-testid="boss-tab-flag"]').attributes('title')).toBe('속성 상성 미반영');

    await pick(w, 'test-e');
    const flag = at(w, 'boss-flag');
    expect(flag.text()).toBe('속성 상성 미반영');
    expect(flag.classes()).toContain('badge--danger');
    expect(flag.element.closest('details')).toBeNull();
    expect(at(w, 'boss-weak').text()).toBe('약점 미확인');
    expect(at(w, 'boss-code').text()).toBe('속성 미확인');
    expect(texts(w, 'boss-note')[0]).toMatch(/^속성 상성 미반영 — 보스 속성과 약점을 몰라 적 속성 없이 계산했다/);
    // 약점을 모르므로 약점 속성 표시는 어느 멤버에도 붙지 않는다.
    expect(at(w, 'member-mark').exists()).toBe(false);
    // 계산은 했다 — 편성은 보인다.
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위']);
  });

  it('유도한 보스 속성은 유도한 값이라고 적는다', async () => {
    const w = render();
    await pick(w, 'test-c');
    expect(at(w, 'boss-weak').text()).toBe('약점 수냉');
    expect(at(w, 'boss-code').text()).toBe('속성 작열(약점에서 유도)');
    expect(texts(w, 'boss-note')).toEqual(['보스 속성(작열)은 화면에서 확인한 값이 아니다 — 약점(수냉)에서 엔진의 속성 상성 규칙으로 정했다.']);
  });

  it('보상·레벨·전투 시간을 확인 여부와 함께 한 줄로 보인다', async () => {
    const w = render();
    expect(at(w, 'boss-info').text()).toBe('보상 시험 보상 A · 레벨 400(상한 400 — 동기화 레벨을 몰라 상한으로 가정) · 전투 120초');
    await pick(w, 'test-d');
    expect(at(w, 'boss-info').text()).toBe('보상 미확인 · 레벨 200(상한 200 — 동기화 레벨을 몰라 상한으로 가정) · 전투 180초(미확인 — 엔진 기본값)');
    await pick(w, 'test-e');
    expect(at(w, 'boss-info').text()).toBe('보상 미확인 · 레벨 400(상한 미확인) · 전투 180초(미확인 — 엔진 기본값)');
  });

  it('보스별 탐색 요약은 CLI 표와 같은 문장이다', () => {
    const w = render();
    expect(at(w, 'boss-search').text()).toBe(searchLine(bossOf('test-a').suggestion?.search));
    expect(at(w, 'boss-search').text()).toMatch(/^탐색: 시뮬 8건 \/ 예산 8건/);
  });

  it('검증용 계정·검증용 보스 묶음임을 표시하고 계산 시각을 보인다', () => {
    const w = render();
    expect(at(w, 'account-name').text()).toBe('검증용 샘플 계정');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'bundle-kind').text()).toBe('검증용 보스 묶음');
    expect(at(w, 'generated-at').text()).toMatch(/^계산 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('계산 정보(콘텐츠·출처·엔진·예산·가정)와 주의 문구를 모두 보인다', () => {
    const w = render();
    expect(at(w, 'content').text()).toContain('콘텐츠: 이상 개체 요격전 · 보스 5종 · 검증용 보스 묶음');
    expect(at(w, 'bundle-source').text()).toBe('보스 값의 출처: 검증용으로 지어낸 값 — 게임에서 확인한 값이 아니다');
    expect(at(w, 'engine-version').text()).toBe('엔진: Jgaram/nikke-calc @ 67835ca3');
    expect(at(w, 'cache').text()).toBe('캐시: 쓰지 않음');
    expect(at(w, 'sims').text()).toBe(
      '예산: 시뮬 40건 / 예산 40건 (시험 보스 A 8/8 · 시험 보스 B 8/8 · 시험 보스 C 8/8 · 시험 보스 D 8/8 · 시험 보스 E 8/8)',
    );
    expect(at(w, 'assumptions').findAll('li').map((li) => li.text())).toEqual(sample.assumptions);
    // 주의 문구는 접지 않는다.
    expect(texts(w, 'caveat')).toEqual(sample.caveats);
    expect(at(w, 'caveats').element.closest('details')).toBeNull();
    expect(sample.caveats.some((c) => c.includes('실제 요격전 기록과 대조하지 않았다'))).toBe(true);
  });
});

describe('마지막으로 고른 보스', () => {
  it('고른 보스를 기억해 다시 열면 그 보스가 보인다', async () => {
    const first = render();
    await pick(first, 'test-d');
    expect(at(first, 'boss-name').text()).toBe('시험 보스 D');
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('test-d');
    first.unmount();

    const second = render();
    expect(at(second, 'boss-name').text()).toBe('시험 보스 D');
    expect(at(second, 'boss-weak').text()).toBe('약점 전격');
    expect(second.find('[data-testid="boss-tab"][data-boss="test-d"]').attributes('aria-selected')).toBe('true');
    expect(texts(second, 'total-unit')).toEqual(bossOf('test-d').ranking.map((r) => formatDamage(r.total_damage)));
  });

  it('기억해 둔 보스가 이 결과에 없으면 첫 보스를 보인다', () => {
    localStorage.setItem('nikke-companion.intercept.boss', 'kraken');
    const w = render();
    expect(at(w, 'boss-name').text()).toBe('시험 보스 A');
    // 기억은 지우지 않는다 — 그 보스가 든 결과를 다시 열면 그 보스가 보인다.
    expect(localStorage.getItem('nikke-companion.intercept.boss')).toBe('kraken');
  });

  it('결과가 바뀌어도 고른 보스가 그 결과에 있으면 그대로 보인다', async () => {
    const w = render();
    await pick(w, 'test-c');
    await w.setProps({ report: variant((r) => void (r.bosses[2].ranking[0].total_damage = 1_234_567_890)) });
    expect(at(w, 'boss-name').text()).toBe('시험 보스 C');
    expect(texts(w, 'total-unit')[0]).toBe('12.34억');
  });
});

describe('샘플에 없는 경우(샘플을 복사해 바꾼 결과)', () => {
  it('미확인 값이 없고 속성이 확인된 보스에는 표시가 없다', () => {
    const w = render(
      variant((r) => {
        r.bosses[0].unconfirmed = [];
        r.bosses[0].flags = [];
      }),
    );
    expect(at(w, 'boss-alerts').exists()).toBe(false);
    expect(at(w, 'unconfirmed').exists()).toBe(false);
    const tab = w.findAll('[data-testid="boss-tab"]')[0];
    expect(tab.find('[data-testid="boss-tab-unconfirmed"]').exists()).toBe(false);
    expect(tab.find('[data-testid="boss-tab-flag"]').exists()).toBe(false);
  });

  it('약점만 미확인으로 남은 칸은 미확인 값으로 세지 않는다(계산 입력이 아니다) — 속성 상성 미반영 표시가 알린다', async () => {
    const w = render();
    await pick(w, 'test-e');
    const e = bossOf('test-e');
    expect(e.unconfirmed.map((u) => u.field)).toContain('weak_to');
    expect(at(w, 'boss-unconfirmed').text()).toBe(`미확인 값 ${e.unconfirmed.length - 1}칸 — 확정값이 아니다`);
    expect(texts(w, 'unconfirmed-item').some((t) => t.startsWith('약점:'))).toBe(false);
  });

  it('예산이 모자라 계산하지 않은 보스는 그렇게 적고 사유를 보인다', () => {
    const w = render(
      variant((r) => {
        const b = r.bosses[0];
        b.status = 'not_computed';
        b.ranking = [];
        b.suggestion = null;
        b.notes = ['시뮬 예산 3건이 보스 5종에 돌아가지 않아 계산하지 못했다.'];
      }),
    );
    expect(at(w, 'boss-not-computed').text()).toBe('계산하지 않았다.');
    expect(at(w, 'ranking-entry').exists()).toBe(false);
    expect(at(w, 'ranking-empty').exists()).toBe(false);
    expect(texts(w, 'boss-note')).toEqual(['시뮬 예산 3건이 보스 5종에 돌아가지 않아 계산하지 못했다.']);
    expect(at(w, 'boss-search').exists()).toBe(false);
  });

  it('엔진이 계산하지 못한 편성과 걸러진 편성을 그 보스 안에 보인다', () => {
    const w = render(
      variant((r) => {
        r.bosses[0].failed = [{ name: '후보 9', members: ['크라운'], error: { type: 'engine_error', message: '엔진 시간 초과 (60초)', path: null } }];
        r.bosses[0].rejected = [{ name: '후보 10', members: ['홍련'], reasons: ['보유하지 않은 니케: 홍련'] }];
      }),
    );
    expect(texts(w, 'failed-reason')).toEqual(['엔진 시간 초과 (60초)']);
    expect(texts(w, 'rejected-reason')).toEqual(['보유하지 않은 니케: 홍련']);
  });

  it('유도한 약점은 유도한 값이라고 적는다', () => {
    const w = render(
      variant((r) => {
        r.bosses[0].element = { code: '풍압', code_source: 'bundle', weak_to: '작열', weak_to_source: 'code', reflected: true };
      }),
    );
    expect(at(w, 'boss-weak').text()).toBe('약점 작열(속성에서 유도)');
  });

  it('실제 계정·실제 보스 묶음의 결과에는 검증용 표시를 하지 않는다', () => {
    const w = render(
      variant((r) => {
        r.account.is_test_data = false;
        r.bundle.is_test_data = false;
      }),
    );
    expect(at(w, 'data-kind').text()).toBe('실제 계정 데이터');
    expect(at(w, 'bundle-kind').exists()).toBe(false);
    expect(w.find('.badge--test').exists()).toBe(false);
  });

  it('보스가 없는 결과는 그렇게 적는다', () => {
    const w = render(variant((r) => void (r.bosses = [])));
    expect(at(w, 'boss-empty').text()).toBe('결과에 보스가 없다.');
    expect(at(w, 'boss').exists()).toBe(false);
  });

  it('수가 아닌 값은 지어내지 않고 값 오류로 표시한다', () => {
    const w = render(variant((r) => void ((r.bosses[0].ranking[0] as unknown as Record<string, unknown>).total_damage = null)));
    expect(texts(w, 'total-unit')[0]).toBe('값 오류');
  });
});
