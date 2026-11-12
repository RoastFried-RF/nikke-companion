// 티어 화면의 컴포넌트 테스트.
// 입력은 실제 CLI가 만든 샘플 결과다(fixtures/tier.sample.json — `npm run fixture -- tier`로 다시 만든다):
//   node src/cli.mjs tier build --no-cache --only "헬름,크라운,리틀 머메이드,라피 : 레드 후드,솔져 O.W.,리타,test_B1,앨리스" \
//     --budget 50 --json …
// 등급 6명(버스트 1·2·3단계), 평가 보류 2명(스킬 효과 없음: 엔진의 시험용 항목 test_B1 · 예산: 마지막 니케 앨리스).
// 지금 엔진·시나리오에서는 「미지원 효과」 경고가 실제로 나오지 않는다 — 그 표시는 샘플을 복사해 바꾼 결과로 본다.
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { formatDamage } from '@core/format.mjs';
import { STATUS_HOLD, STATUS_PREDICTED } from '@tier/evaluate.mjs';
import { tierLabel, UNSUPPORTED_FLAG } from '@tier/rules.mjs';
import TierView from '../src/components/TierView.vue';
import type { TierReport } from '../src/types';
import fixture from './fixtures/tier.sample.json';

const sample = fixture as unknown as TierReport;

/** 샘플을 복사해 일부만 바꾼다. 샘플에 없는 경우(미지원 효과 표시 등)를 만들 때만 쓴다. */
function variant(change: (report: TierReport) => void): TierReport {
  const copy = structuredClone(sample);
  change(copy);
  return copy;
}

const render = (report: TierReport = sample) => mount(TierView, { props: { report } });
type Wrapper = ReturnType<typeof render>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());
const groupNames = (w: Wrapper) =>
  w.findAll('[data-testid="tier-group"]').map((g) => [g.attributes('data-tier'), g.findAll('[data-testid="entry-name"]').map((n) => n.text())]);

async function filterBy(w: Wrapper, key: string): Promise<void> {
  await w.find(`[data-testid="burst-option"][data-burst="${key}"]`).trigger('click');
}

describe('샘플 결과(실제 CLI 출력)', () => {
  it('fixture는 등급 6명·평가 보류 2명의 티어 결과다', () => {
    expect(sample.kind).toBe('tier');
    expect(sample.schema_version).toBe(1);
    expect(sample.summary).toMatchObject({ requested: 8, graded: 6, hold: 2, unsupported: 0 });
    expect(sample.summary.hold_by_reason).toEqual({ skills_empty: 1, budget: 1 });
    expect(sample.rules.provisional).toBe(true);
    expect(sample.entries.filter((e) => e.status === STATUS_PREDICTED)).toHaveLength(6);
    expect(sample.entries.filter((e) => e.status === STATUS_HOLD)).toHaveLength(2);
  });

  it('등급별로 묶어 규칙의 등급 순서대로, 묶음 안에서는 점수 순으로 보인다', () => {
    const w = render();
    expect(groupNames(w)).toEqual([
      ['SSS', ['라피 : 레드 후드']],
      ['SS', ['크라운']],
      ['S', ['리틀 머메이드', '리타', '헬름']],
      ['D', ['솔져 O.W.']],
    ]);
    // 해당 니케가 없는 등급(A·B·C)은 그리지 않는다.
    expect(texts(w, 'tier-name')).toEqual(['SSS', 'SS', 'S', 'D']);
    const groups = w.findAll('[data-testid="tier-group"]');
    expect(groups[0].find('.group__min').text()).toBe('1.050 이상');
    expect(groups[2].find('.group__count').text()).toBe('3명');
  });

  it('순위·점수(소수 셋째 자리)·버스트 단계를 줄마다 보인다', () => {
    const w = render();
    const rows = w.findAll('[data-testid="tier-entry"]').map((row) => ({
      rank: row.find('[data-testid="entry-rank"]').text(),
      name: row.find('[data-testid="entry-name"]').text(),
      burst: row.find('[data-testid="entry-burst"]').text(),
      score: row.find('[data-testid="entry-score"]').text(),
    }));
    expect(rows).toEqual([
      { rank: '1', name: '라피 : 레드 후드', burst: '3단계', score: '1.182' },
      { rank: '2', name: '크라운', burst: '2단계', score: '1.030' },
      { rank: '3', name: '리틀 머메이드', burst: '1단계', score: '0.958' },
      { rank: '4', name: '리타', burst: '1단계', score: '0.955' },
      { rank: '5', name: '헬름', burst: '3단계', score: '0.952' },
      { rank: '6', name: '솔져 O.W.', burst: '1단계', score: '0.645' },
    ]);
  });

  it('status별로 다르게 그린다 — 예측 평가는 등급 표에, 평가 보류는 따로 묶어 사유와 함께', () => {
    const w = render();
    // 예측 평가: 등급 묶음 안에서 점수와 함께.
    const graded = w.findAll('[data-testid="tier-entry"]');
    expect(graded).toHaveLength(6);
    for (const row of graded) {
      expect(row.classes()).toContain('row--predicted');
      expect(row.find('[data-testid="entry-status"]').text()).toBe('예측 평가');
      expect(row.find('[data-testid="entry-status"]').classes()).toContain('badge--accent');
    }
    // 평가 보류: 등급 묶음 밖의 구역에, 사유를 적은 상태 표기와 사유 문장. 점수·순위는 없다.
    const holds = at(w, 'tier-holds');
    expect(holds.find('.group__head').text()).toContain('평가 보류');
    expect(holds.find('.group__head').text()).toContain('등급 없음 — 0점이 아니다');
    const rows = holds.findAll('[data-testid="hold-entry"]');
    expect(rows.map((r) => r.find('[data-testid="entry-name"]').text())).toEqual(['test_B1', '앨리스']);
    expect(rows.map((r) => r.find('[data-testid="entry-status"]').text())).toEqual(['평가 보류(스킬 효과 없음)', '평가 보류(예산)']);
    expect(rows.map((r) => r.find('[data-testid="hold-reason"]').text())).toEqual([
      '파싱된 스킬 효과가 하나도 없다. 스킬 0개로 계산된다',
      '시뮬 9건이 필요한데 예산 50건 중 3건만 남았다',
    ]);
    for (const row of rows) {
      expect(row.classes()).toContain('row--hold');
      expect(row.find('[data-testid="entry-status"]').classes()).toContain('badge--warn');
      expect(row.find('[data-testid="entry-score"]').exists()).toBe(false);
      expect(row.element.closest('[data-testid="tier-group"]')).toBeNull();
    }
    // 보류 항목은 어느 등급 묶음에도 없다.
    expect(groupNames(w).flatMap(([, names]) => names)).not.toContain('앨리스');
  });

  it('규칙이 임시라는 주의 문구가 언제나 보인다 — 접히지 않고, 필터를 바꿔도 남는다', async () => {
    const w = render();
    const banner = at(w, 'tier-provisional');
    expect(banner.text()).toBe('등급 규칙 2026-11-12.1은 임시다 — 대표 사례로 검증되지 않았다. 등급 경계는 바뀔 수 있다.');
    expect(banner.element.closest('details')).toBeNull();
    expect(at(w, 'tier-versions').text()).toContain('등급 규칙 2026-11-12.1 [임시]');
    for (const key of ['1', '2', '3', 'all']) {
      await filterBy(w, key);
      expect(at(w, 'tier-provisional').exists()).toBe(true);
    }
  });

  it('버스트 단계 필터: 결과에 있는 단계와 인원을 보이고, 고른 단계의 니케만 남긴다(평가 보류도)', async () => {
    const w = render();
    expect(texts(w, 'burst-option')).toEqual(['전체 8', '1단계 4', '2단계 1', '3단계 3']);
    expect(w.find('[data-testid="burst-option"][data-burst="all"]').attributes('aria-pressed')).toBe('true');

    await filterBy(w, '1');
    expect(groupNames(w)).toEqual([
      ['S', ['리틀 머메이드', '리타']],
      ['D', ['솔져 O.W.']],
    ]);
    expect(at(w, 'tier-holds').findAll('[data-testid="entry-name"]').map((n) => n.text())).toEqual(['test_B1']);
    expect(w.find('[data-testid="burst-option"][data-burst="1"]').attributes('aria-pressed')).toBe('true');

    await filterBy(w, '2');
    expect(groupNames(w)).toEqual([['SS', ['크라운']]]);
    expect(at(w, 'tier-holds').exists()).toBe(false);

    await filterBy(w, '3');
    expect(groupNames(w)).toEqual([
      ['SSS', ['라피 : 레드 후드']],
      ['S', ['헬름']],
    ]);
    expect(at(w, 'tier-holds').findAll('[data-testid="entry-name"]').map((n) => n.text())).toEqual(['앨리스']);

    await filterBy(w, 'all');
    expect(w.findAll('[data-testid="tier-entry"]')).toHaveLength(6);
  });

  it('버전과 조건을 보인다: 엔진·데이터, 시나리오, 기준 편성·등급 규칙·방법, 시뮬 횟수, 계산 시각', () => {
    const w = render();
    expect(at(w, 'tier-summary').text()).toBe('자동 티어 — 8명 (등급 6명 · 평가 보류 2명)');
    expect(at(w, 'tier-engine').text()).toBe('엔진: Jgaram/nikke-calc @ 67835ca3 · 데이터 sha256:6b9f8225c2a5f426');
    expect(at(w, 'tier-scenario').text()).toBe('시나리오: 솔로 레이드 S40 · 180초 · 육성 엔진 기본 스펙(프로필 없음)');
    expect(at(w, 'tier-versions').text().replace(/\s+/g, ' ')).toBe(
      '기준 편성 2026-11-12.1 (5개 중 5개 사용) · 등급 규칙 2026-11-12.1 [임시] · 방법 team-swap-ratio v1',
    );
    expect(at(w, 'tier-sims').text().replace(/\s+/g, ' ')).toBe('시뮬: 47건 / 예산 50건 (기준 편성 5건 + 바꿔 넣기 42건)');
    expect(at(w, 'cache').text()).toBe('캐시: 쓰지 않음');
    expect(at(w, 'generated-at').text()).toMatch(/^계산 시각: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('가정·등급 경계·기준 편성을 펼쳐 볼 수 있다', () => {
    const w = render();
    expect(at(w, 'assumptions').find('summary').text()).toBe('가정 4개');
    expect(at(w, 'assumptions').findAll('li').map((li) => li.text())).toEqual(sample.assumptions);
    expect(at(w, 'tier-rules').find('summary').text()).toBe('등급 경계 (점수 = 팀 총딜 비율) — 임시');
    expect(at(w, 'tier-rules').findAll('li').map((li) => li.text())).toEqual(sample.rules.tiers.map((t) => `${t.tier}: ${t.min.toFixed(3)} 이상`));
    const refs = at(w, 'tier-references');
    expect(refs.find('summary').text()).toBe('기준 편성 5개');
    const first = sample.references.squads[0];
    expect(refs.findAll('li')[0].text().replace(/\s+/g, ' ')).toBe(`${first.id}: ${first.members.join(', ')} — ${formatDamage(first.total_damage as number)}`);
  });

  it('주의 문구를 모두, 접지 않고 보인다', () => {
    const w = render();
    expect(texts(w, 'caveat')).toEqual(sample.caveats);
    expect(at(w, 'caveats').element.closest('details')).toBeNull();
    expect(sample.caveats).toContain('평가 보류 2명은 등급이 없다. 0점으로 친 것이 아니다.');
  });

  it('줄을 펼치면 점수가 나온 자리와 메모를 보인다', () => {
    const w = render();
    const top = w.findAll('[data-testid="tier-entry"]')[0];
    const best = sample.entries[0].best!;
    expect(top.find('[data-testid="entry-best"]').text().replace(/\s+/g, ' ')).toBe(
      `S40_앨리스모더니아의 앨리스 자리: ${formatDamage(best.reference_total)} → ${formatDamage(best.total_damage)}`,
    );
    expect(top.findAll('[data-testid="entry-comparison"]')).toHaveLength(sample.entries[0].comparisons.length);
    expect(top.findAll('[data-testid="entry-note"]').map((n) => n.text())).toEqual([
      '기준 편성 S40_브리드라피에 이미 들어 있어 그 편성은 대조에서 뺐다(자기 자신과 비교하지 않는다).',
    ]);
  });

  it('샘플에는 미지원 효과 표시가 붙은 항목이 없다', () => {
    const w = render();
    expect(at(w, 'entry-flag').exists()).toBe(false);
    expect(w.find('.row--unsupported').exists()).toBe(false);
  });
});

describe('샘플에 없는 경우(샘플을 복사해 바꾼 결과)', () => {
  it('미지원 효과 표시가 있는 항목은 눈에 띈다 — 접지 않은 줄에 표시가 붙고 줄 전체가 강조된다', () => {
    const warning = '헬름: 효과 모델이 없는 스킬 효과 1개를 계산에서 뺐다';
    const w = render(
      variant((r) => {
        // buildTier가 미지원 경고를 본 항목에 적는 칸 그대로다(src/tier/evaluate.mjs).
        const e = r.entries.find((x) => x.name === '헬름')!;
        e.unsupported = true;
        e.flags = [UNSUPPORTED_FLAG];
        e.tier_label = tierLabel(e.tier as string, true);
        e.notes = [...e.notes, `미지원 효과(엔진 경고): ${warning}`];
        r.summary.unsupported = 1;
      }),
    );
    const rows = w.findAll('[data-testid="tier-entry"]');
    const helm = rows.find((row) => row.find('[data-testid="entry-name"]').text() === '헬름')!;
    expect(helm.classes()).toContain('row--unsupported');
    const flag = helm.find('[data-testid="entry-flag"]');
    expect(flag.text()).toBe('미지원 효과 있음');
    expect(flag.classes()).toContain('badge--danger');
    // 줄을 펼치지 않아도 보인다(요약 줄 안에 있다).
    expect(flag.element.closest('summary')).not.toBeNull();
    expect(helm.findAll('[data-testid="entry-note"]').at(-1)?.text()).toBe(`미지원 효과(엔진 경고): ${warning}`);
    // 다른 항목에는 붙지 않는다.
    expect(w.findAll('[data-testid="entry-flag"]')).toHaveLength(1);
    expect(w.findAll('.row--unsupported')).toHaveLength(1);
  });

  it('임시가 아니라고 밝힌 규칙에서만 임시 문구를 내린다. 밝히지 않았으면 임시로 본다', () => {
    const settled = render(variant((r) => void (r.rules.provisional = false)));
    expect(at(settled, 'tier-provisional').exists()).toBe(false);
    expect(at(settled, 'tier-versions').text()).not.toContain('[임시]');

    const unstated = render(variant((r) => void delete (r.rules as unknown as Record<string, unknown>).provisional));
    expect(at(unstated, 'tier-provisional').exists()).toBe(true);
  });

  it('등급을 매긴 니케가 하나도 없어도 임시 문구·평가 보류·주의는 보인다', () => {
    const w = render(variant((r) => void (r.entries = r.entries.filter((e) => e.status === STATUS_HOLD))));
    expect(at(w, 'tier-empty').text()).toBe('등급을 매긴 니케가 없다.');
    expect(at(w, 'tier-provisional').exists()).toBe(true);
    expect(w.findAll('[data-testid="hold-entry"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="caveat"]')).toHaveLength(sample.caveats.length);
  });

  it('전 단계(A) 니케는 3단계 묶음으로 센다 — 루트의 규칙 그대로', async () => {
    const w = render(variant((r) => void (r.entries.find((e) => e.name === '크라운')!.burst_stage = 'A')));
    expect(texts(w, 'burst-option')).toEqual(['전체 8', '1단계 4', '3단계 4']);
    await filterBy(w, '3');
    expect(groupNames(w).flatMap(([, names]) => names)).toContain('크라운');
    const crown = w.findAll('[data-testid="tier-entry"]').find((row) => row.find('[data-testid="entry-name"]').text() === '크라운')!;
    expect(crown.find('[data-testid="entry-burst"]').text()).toBe('3단계(A)');
  });

  it('버스트 단계를 모르는 항목은 단계 미상으로 따로 고를 수 있다', async () => {
    const w = render(
      variant((r) => {
        const e = r.entries.find((x) => x.name === 'test_B1')!;
        e.burst_stage = null;
        e.status_label = '평가 보류(버스트 단계 미상)';
      }),
    );
    expect(texts(w, 'burst-option')).toEqual(['전체 8', '1단계 3', '2단계 1', '3단계 3', '단계 미상 1']);
    await filterBy(w, 'none');
    expect(w.findAll('[data-testid="tier-entry"]')).toHaveLength(0);
    expect(at(w, 'tier-empty').text()).toBe('이 버스트 단계에는 등급을 매긴 니케가 없다.');
    expect(w.findAll('[data-testid="hold-entry"]').map((r) => r.find('[data-testid="entry-burst"]').text())).toEqual(['단계 미상']);
  });

  it('모르는 상태(앞으로 더해질 실측 대조 완료 등)는 예측 평가와 다르게 그린다', () => {
    const w = render(
      variant((r) => {
        const e = r.entries[0];
        e.status = '실측 대조 완료';
        e.status_label = '실측 대조 완료(솔로 레이드 S40)';
      }),
    );
    const top = w.findAll('[data-testid="tier-entry"]')[0];
    expect(top.find('[data-testid="entry-status"]').text()).toBe('실측 대조 완료(솔로 레이드 S40)');
    expect(top.find('[data-testid="entry-status"]').classes()).not.toContain('badge--accent');
    expect(top.classes()).toContain('row--other');
  });

  it('쓰지 못한 기준 편성과 확인하지 못한 데이터 버전을 그렇게 적는다', () => {
    const w = render(
      variant((r) => {
        r.engine_data = null;
        r.references.squads[1].status = 'unusable';
        r.references.squads[1].reason = '프리뷰(출시 전 카드 기준) 니케가 들어 있다: 크라운';
        r.references.squads[1].total_damage = null;
      }),
    );
    expect(at(w, 'tier-engine').text()).toBe('엔진: Jgaram/nikke-calc @ 67835ca3 · 데이터 버전 미확인');
    expect(at(w, 'tier-versions').text()).toContain('(5개 중 4개 사용)');
    expect(at(w, 'tier-references').findAll('li')[1].text()).toContain('쓰지 못했다: 프리뷰(출시 전 카드 기준) 니케가 들어 있다: 크라운');
  });

  it('규칙에 없는 등급 이름의 항목도 버리지 않고 따로 묶는다', () => {
    const w = render(variant((r) => void (r.entries[0].tier = 'EX')));
    expect(groupNames(w).at(-1)).toEqual(['EX', ['라피 : 레드 후드']]);
    expect(w.findAll('[data-testid="tier-entry"]')).toHaveLength(6);
  });
});
