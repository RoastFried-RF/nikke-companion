// 성장 비교 결과 화면의 컴포넌트 테스트.
// 입력은 실제 CLI가 만든 샘플 결과다(fixtures/growth.sample.json — `npm run fixture -- growth`로 다시 만든다):
//   node src/cli.mjs growth --no-cache --account data/samples/account.sample.json --condition data/samples/condition.solo-raid.json \
//     --squads data/samples/squads.sample.json --upgrades data/samples/upgrades.sample.json --json …
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { formatDamage, groupThousands } from '@core/format.mjs';
import GrowthView from '../src/components/GrowthView.vue';
import type { GrowthReport } from '../src/types';
import fixture from './fixtures/growth.sample.json';

const sample = fixture as unknown as GrowthReport;

/** 샘플을 복사해 일부만 바꾼다. 샘플에 없는 경우(총딜이 주는 후보 등)를 만들 때만 쓴다. */
function variant(change: (report: GrowthReport) => void): GrowthReport {
  const copy = structuredClone(sample);
  change(copy);
  return copy;
}

const render = (report: GrowthReport = sample) => mount(GrowthView, { props: { report } });
type Wrapper = ReturnType<typeof render>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());

describe('샘플 결과(실제 CLI 출력)', () => {
  it('fixture는 검증용 계정으로 만든 성장 비교 결과다', () => {
    expect(sample.kind).toBe('growth');
    expect(sample.schema_version).toBe(1);
    expect(sample.account.is_test_data).toBe(true);
    expect(sample.ranking).toHaveLength(4);
    expect(sample.rejected).toHaveLength(2);
  });

  it('기준 편성의 이름·총딜·멤버별 딜을 보인다', () => {
    const w = render();
    const baseline = at(w, 'baseline');
    expect(baseline.find('[data-testid="baseline-name"]').text()).toBe('A 레드후드-앨리스');
    expect(baseline.find('[data-testid="baseline-total"]').text()).toBe('34.63억');
    expect(baseline.find('[data-testid="baseline-raw"]').text()).toBe('(3,463,364,987)');
    expect(baseline.findAll('[data-testid="member-name"]').map((m) => m.text())).toEqual(['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스']);
    expect(baseline.findAll('[data-testid="member-unit"]').map((m) => m.text())).toEqual(sample.baseline.members.map((m) => formatDamage(m.damage)));
    expect(baseline.findAll('[data-testid="member-raw"]').map((m) => m.text())).toEqual(sample.baseline.members.map((m) => groupThousands(m.damage)));
    expect(baseline.find('[data-testid="engine-warnings"] summary').text()).toBe(`엔진 알림 ${sample.baseline.engine_warnings.length}건`);
  });

  it('업그레이드 후보를 증가율 순으로 보인다', () => {
    const w = render();
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위', '4위']);
    expect(texts(w, 'upgrade-name')).toEqual(['헬름 스킬 10/10/10', '앨리스 우월코드 +1줄', '크라운 공격력 +2줄', '헬름 코어 강화 +4']);
    expect(texts(w, 'gain-rate')).toEqual(['+0.93%', '+0.84%', '+0.78%', '+0.19%']);
  });

  it('적용 전후 총딜과 증가량을 단위 표기로 보인다 — 루트의 format.mjs가 낸 값과 같다', () => {
    const w = render();
    expect(texts(w, 'gain-total')).toEqual(
      sample.ranking.map((r) => `총딜 ${formatDamage(r.total_before)} → ${formatDamage(r.total_after)} (+${formatDamage(r.gain)})`),
    );
    expect(texts(w, 'gain-total')[0]).toBe('총딜 34.63억 → 34.95억 (+3,210만)');
  });

  it('후보가 바꾸는 육성 칸의 적용 전후 값을 보인다', () => {
    const w = render();
    const entries = w.findAll('[data-testid="growth-entry"]');
    expect(entries[0].findAll('[data-testid="change"]').map((c) => c.text())).toEqual(['헬름 skill_levels: [7,7,10] → [10,10,10]']);
    expect(entries[2].findAll('[data-testid="change"]').map((c) => c.text())).toEqual(['크라운 overload: {"공격력":2} → {"공격력":4}']);
    expect(entries[3].findAll('[data-testid="change"]').map((c) => c.text())).toEqual(['헬름 core_enhancement: 3 → 7']);
  });

  it('멤버별 증가량은 달라진 멤버만 보인다', () => {
    const w = render();
    const entries = w.findAll('[data-testid="growth-entry"]');
    // 헬름의 스킬은 팀 전체의 딜을 올린다.
    expect(entries[0].findAll('[data-testid="member-gain"]').map((m) => m.text())).toEqual(
      sample.ranking[0].members.map((m) => `+${formatDamage(m.gain)} ${m.name}`),
    );
    expect(entries[0].findAll('[data-testid="member-gain"]')).toHaveLength(5);
    // 앨리스의 오버로드는 앨리스의 딜만 올린다.
    expect(entries[1].findAll('[data-testid="member-gain"]').map((m) => m.text())).toEqual(['+2,896만 앨리스']);
  });

  it('계산하지 않은 후보와 사유를 보인다', () => {
    const w = render();
    const entries = w.findAll('[data-testid="rejected-entry"]');
    expect(entries.map((e) => e.find('.issues__name').text())).toEqual(['프리카 코어 강화 7 (기준 편성 밖)', '앨리스 스킬 +1 (범위 밖)']);
    expect(texts(w, 'rejected-reason')).toEqual(sample.rejected.map((r) => r.reasons.join(' / ')));
    expect(at(w, 'rejected').find('.block__title').text()).toBe('계산하지 않은 후보');
    expect(texts(w, 'upgrade-name')).not.toContain('프리카 코어 강화 7 (기준 편성 밖)');
    expect(at(w, 'failed').exists()).toBe(false);
  });

  it('계정·조건·엔진 버전·가정과 주의 문구를 보인다', () => {
    const w = render();
    expect(at(w, 'account-name').text()).toBe('검증용 샘플 계정');
    expect(at(w, 'data-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'condition').text()).toBe('조건: 솔로 레이드 S40 · 180초');
    expect(at(w, 'engine-version').text()).toBe('엔진: Jgaram/nikke-calc @ 67835ca3');
    expect(at(w, 'cache').text()).toBe('캐시: 쓰지 않음');
    expect(at(w, 'assumptions').find('summary').text()).toBe('가정 4개');
    expect(texts(w, 'caveat')).toEqual(sample.caveats);
    expect(sample.caveats).toContain('재화·비용은 고려하지 않았다. 증가율이 높다고 투자 효율이 높다는 뜻은 아니다.');
    expect(at(w, 'caveats').element.closest('details')).toBeNull();
  });
});

describe('샘플에 없는 경우(샘플을 복사해 바꾼 결과)', () => {
  it('총딜이 주는 후보는 음수로 적고 눈에 띄게 한다', () => {
    const w = render(
      variant((r) => {
        const e = r.ranking[3];
        e.total_after = e.total_before - 120_000_000;
        e.gain = -120_000_000;
        e.gain_rate = e.gain / e.total_before;
        e.members[0].gain = -120_000_000;
      }),
    );
    const last = w.findAll('[data-testid="growth-entry"]')[3];
    expect(last.find('[data-testid="gain-rate"]').text()).toBe('-3.46%');
    expect(last.find('[data-testid="gain"]').text()).toBe('(-1.20억)');
    expect(last.classes()).toContain('upgrade--loss');
    expect(last.findAll('[data-testid="member-gain"]')[0].text()).toBe('-1.20억 리틀 머메이드');
  });

  it('증가율을 낼 수 없으면(적용 전 총딜 0) 그렇게 적는다', () => {
    const w = render(variant((r) => void (r.ranking[0].gain_rate = null)));
    expect(texts(w, 'gain-rate')[0]).toBe('증가율 계산 불가');
  });

  it('적지 않았거나 미확인이던 칸의 적용 전 값은 그렇게 적는다', () => {
    const w = render(variant((r) => void (r.ranking[0].changes[0].before = null)));
    expect(w.findAll('[data-testid="change"]')[0].text()).toBe('헬름 skill_levels: (적지 않음) → [10,10,10]');
  });

  it('후보의 메모(미확인 칸을 미육성으로 계산 등)를 그 후보 안에 보인다', () => {
    const memo = '헬름: skill_levels의 적용 전 값이 미확인이라 미육성으로 계산했다 — 증가율이 실제보다 크게 나올 수 있다';
    const w = render(variant((r) => void (r.ranking[0].notes = [memo])));
    expect(w.findAll('[data-testid="growth-entry"]')[0].findAll('[data-testid="note"]').map((n) => n.text())).toEqual([memo]);
  });

  it('엔진이 계산하지 못한 후보를 오류 내용과 함께 보인다', () => {
    const w = render(
      variant((r) => {
        r.failed = [{ name: '크라운 돌파 +1', changes: [], error: { type: 'engine_error', message: '엔진 시간 초과 (60초)', path: null } }];
      }),
    );
    expect(at(w, 'failed').find('.block__title').text()).toBe('엔진이 계산하지 못한 후보');
    expect(texts(w, 'failed-reason')).toEqual(['엔진 시간 초과 (60초)']);
  });

  it('계산된 후보가 없으면 그렇게 적고, 기준 편성과 주의는 그대로 보인다', () => {
    const w = render(variant((r) => void (r.ranking = [])));
    expect(at(w, 'growth-empty').text()).toBe('계산된 업그레이드 후보가 없다.');
    expect(at(w, 'baseline-total').text()).toBe('34.63억');
    expect(w.findAll('[data-testid="caveat"]')).toHaveLength(sample.caveats.length);
  });

  it('기준 편성의 메모와 미육성으로 계산한 멤버를 보인다', () => {
    const w = render(
      variant((r) => {
        r.baseline.notes = ['버스트 1단계 니케가 없다 — 풀 버스트가 열리지 않을 수 있다'];
        r.baseline.ungrown_members = ['헬름'];
      }),
    );
    expect(texts(w, 'baseline-note')).toEqual(['버스트 1단계 니케가 없다 — 풀 버스트가 열리지 않을 수 있다']);
    expect(at(w, 'ungrown').text()).toBe('육성 정보가 비어 미육성으로 계산: 헬름');
  });

  it('수가 아닌 값은 지어내지 않고 값 오류로 표시한다', () => {
    const w = render(variant((r) => void ((r.ranking[0] as unknown as Record<string, unknown>).gain = null)));
    expect(w.findAll('[data-testid="gain"]')[0].text()).toBe('(값 오류)');
  });
});
