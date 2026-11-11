// 비교 결과 화면의 컴포넌트 테스트.
// 입력은 실제 CLI가 만든 샘플 결과다(fixtures/compare.sample.json — `npm run fixture`로 다시 만든다):
//   node src/cli.mjs compare --account data/samples/account.sample.json \
//     --condition data/samples/condition.solo-raid.json --squads data/samples/squads.sample.json --json …
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { formatDamage, groupThousands } from '@core/format.mjs';
import ReportView from '../src/components/ReportView.vue';
import type { CompareReport } from '../src/types';
import fixture from './fixtures/compare.sample.json';

const sample = fixture as unknown as CompareReport;

/** 샘플을 복사해 일부만 바꾼다. 샘플에 없는 경우(엔진 실패 등)를 만들 때만 쓴다. */
function variant(change: (report: CompareReport) => void): CompareReport {
  const copy = structuredClone(sample);
  change(copy);
  return copy;
}

const render = (report: CompareReport = sample) => mount(ReportView, { props: { report } });
const texts = (wrapper: ReturnType<typeof render>, testid: string) =>
  wrapper.findAll(`[data-testid="${testid}"]`).map((el) => el.text());

describe('샘플 결과(실제 CLI 출력)', () => {
  it('fixture는 schema_version 1의 검증용 결과다', () => {
    expect(sample.schema_version).toBe(1);
    expect(sample.account.is_test_data).toBe(true);
    expect(sample.ranking.length).toBeGreaterThan(0);
  });

  it('순위와 편성 이름을 순서대로 그린다', () => {
    const w = render();
    expect(texts(w, 'rank')).toEqual(['1위', '2위', '3위']);
    expect(texts(w, 'squad-name')).toEqual(['A 레드후드-앨리스', 'B 레드후드-미하라', 'C 프리카-앨리스']);
  });

  it('총딜을 단위 표기와 원값으로 함께 보인다', () => {
    const w = render();
    expect(texts(w, 'total-unit')).toEqual(['34.63억', '29.84억', '2.21억']);
    expect(texts(w, 'total-raw')).toEqual(['(3,463,364,987)', '(2,984,942,122)', '(221,490,701)']);
  });

  it('단위 표기는 루트의 src/core/format.mjs가 낸 값과 같다', () => {
    const w = render();
    expect(texts(w, 'total-unit')).toEqual(sample.ranking.map((r) => formatDamage(r.total_damage)));
    expect(texts(w, 'member-unit')).toEqual(
      sample.ranking.flatMap((r) => r.members.map((m) => formatDamage(m.damage))),
    );
    expect(texts(w, 'member-raw')).toEqual(
      sample.ranking.flatMap((r) => r.members.map((m) => groupThousands(m.damage))),
    );
  });

  it('1위는 기준, 나머지는 1위 대비 비율을 보인다', () => {
    expect(texts(render(), 'relative')).toEqual(['기준', '1위 대비 86.2%', '1위 대비 6.4%']);
  });

  it('멤버별 딜과 비중을 편성 배치 순서대로 보인다', () => {
    const first = render().findAll('[data-testid="ranking-entry"]')[0];
    const rows = first.findAll('[data-testid="member"]').map((row) => ({
      name: row.find('[data-testid="member-name"]').text(),
      share: row.find('[data-testid="member-share"]').text(),
      unit: row.find('[data-testid="member-unit"]').text(),
      raw: row.find('[data-testid="member-raw"]').text(),
    }));
    expect(rows).toEqual([
      { name: '리틀 머메이드', share: '18.0%', unit: '6.23억', raw: '623,422,784' },
      { name: '크라운', share: '5.8%', unit: '2.00억', raw: '200,542,686' },
      { name: '라피 : 레드 후드', share: '65.9%', unit: '22.82억', raw: '2,282,230,601' },
      { name: '헬름', share: '2.9%', unit: '1.01억', raw: '101,502,335' },
      { name: '앨리스', share: '7.4%', unit: '2.55억', raw: '255,666,581' },
    ]);
  });

  it('1억 미만 멤버 딜은 만 단위로 적는다', () => {
    const second = render().findAll('[data-testid="ranking-entry"]')[1];
    const mihara = second.findAll('[data-testid="member"]').find((row) => row.text().includes('미하라'));
    expect(mihara?.find('[data-testid="member-unit"]').text()).toBe('7,820만');
    expect(mihara?.find('[data-testid="member-raw"]').text()).toBe('78,203,076');
  });

  it('편성별 메모를 그 편성 안에 보인다', () => {
    const entries = render().findAll('[data-testid="ranking-entry"]');
    expect(entries[0].findAll('[data-testid="note"]')).toHaveLength(0);
    expect(entries[1].findAll('[data-testid="note"]').map((n) => n.text())).toEqual([
      '미하라: 미확인 칸(overload, core_enhancement)은 미육성 값으로 계산했다',
    ]);
    expect(entries[2].findAll('[data-testid="note"]').map((n) => n.text())).toEqual([
      '버스트 1단계 니케가 없다 — 풀 버스트가 열리지 않을 수 있다',
      '미하라: 미확인 칸(overload, core_enhancement)은 미육성 값으로 계산했다',
    ]);
  });

  it('엔진 알림을 편성마다 건수와 함께 보인다', () => {
    const warnings = render().findAll('[data-testid="engine-warnings"]');
    expect(warnings).toHaveLength(3);
    expect(warnings[0].find('summary').text()).toBe('엔진 알림 4건');
    expect(warnings[0].text()).toContain('스킬 레벨이 10 미만인 캐릭터: 헬름 7/7/10');
  });

  it('계산하지 않은 편성과 사유를 보인다', () => {
    const w = render();
    const entries = w.findAll('[data-testid="rejected-entry"]');
    expect(entries).toHaveLength(2);
    expect(entries[0].text()).toContain('D 미보유 포함');
    expect(entries[1].text()).toContain('E 중복');
    expect(texts(w, 'rejected-reason')).toEqual(['보유하지 않은 니케: 홍련', '같은 니케를 두 번 넣었다: 크라운']);
    // 걸러진 편성은 순위에 없다
    expect(texts(w, 'squad-name')).not.toContain('D 미보유 포함');
  });

  it('엔진이 실패한 편성이 없으면 그 구역을 그리지 않는다', () => {
    expect(sample.failed).toEqual([]);
    expect(render().find('[data-testid="failed"]').exists()).toBe(false);
  });

  it('주의 문구를 모두 보인다', () => {
    expect(texts(render(), 'caveat')).toEqual(sample.caveats);
    expect(sample.caveats).toContain('수치는 시뮬레이션 추정치다. 실제 게임 기록과 대조하지 않았다.');
  });

  it('검증용 데이터임을 표시한다', () => {
    const w = render();
    expect(w.find('[data-testid="data-kind"]').text()).toBe('검증용 데이터');
    expect(w.find('[data-testid="data-kind"]').classes()).toContain('badge--test');
    expect(w.find('[data-testid="account-name"]').text()).toBe('검증용 샘플 계정');
  });

  it('엔진 버전(저장소와 커밋 앞 8자)을 보인다', () => {
    expect(render().find('[data-testid="engine-version"]').text()).toBe('엔진: Jgaram/nikke-calc @ 67835ca3');
  });

  it('조건과 가정을 보인다', () => {
    const w = render();
    expect(w.find('[data-testid="condition"]').text()).toBe('조건: 솔로 레이드 S40 · 180초');
    expect(w.find('[data-testid="assumptions"] summary').text()).toBe('가정 4개');
    expect(w.find('[data-testid="assumptions"]').text()).toContain('보스 프리셋: 솔로 레이드 S40');
  });
});

describe('샘플에 없는 경우(샘플을 복사해 바꾼 결과)', () => {
  it('엔진이 실패한 편성을 오류 내용·위치와 함께 보인다', () => {
    const w = render(
      variant((r) => {
        r.failed = [
          {
            name: 'F 엔진 오류',
            members: ['크라운', '헬름'],
            error: { type: 'invalid_input', message: '알 수 없는 니케: ???', path: '/squad/2' },
          },
          { name: 'G 위치 없음', error: { type: 'engine_error', message: '엔진 시간 초과 (60초)', path: null } },
        ];
      }),
    );
    expect(w.find('[data-testid="failed"]').exists()).toBe(true);
    const entries = w.findAll('[data-testid="failed-entry"]');
    expect(entries).toHaveLength(2);
    expect(entries[0].text()).toContain('F 엔진 오류');
    expect(texts(w, 'failed-reason')).toEqual(['알 수 없는 니케: ??? (/squad/2)', '엔진 시간 초과 (60초)']);
    // 실패한 편성은 순위에 없다
    expect(texts(w, 'squad-name')).not.toContain('F 엔진 오류');
  });

  it('실제 계정 결과에는 검증용 표시를 하지 않는다', () => {
    const w = render(variant((r) => void (r.account.is_test_data = false)));
    expect(w.find('[data-testid="data-kind"]').text()).toBe('실제 계정 데이터');
    expect(w.find('[data-testid="data-kind"]').classes()).not.toContain('badge--test');
    expect(w.find('.badge--test').exists()).toBe(false);
  });

  it('검증용 여부가 없으면 미확인으로 표시한다(실제 계정으로 단정하지 않는다)', () => {
    const w = render(variant((r) => void delete r.account.is_test_data));
    expect(w.find('[data-testid="data-kind"]').text()).toBe('데이터 구분 미확인');
  });

  it('엔진 커밋을 모르면 버전 미확인으로 적는다', () => {
    const w = render(variant((r) => void (r.engine = { repo: 'Jgaram/nikke-calc', commit: null })));
    expect(w.find('[data-testid="engine-version"]').text()).toBe('엔진: Jgaram/nikke-calc @ 버전 미확인');
  });

  it('수정된 엔진 작업 폴더로 계산한 결과임을 적는다', () => {
    const w = render(variant((r) => void (r.engine!.dirty = true)));
    expect(w.find('[data-testid="engine-version"]').text()).toContain('(수정된 작업 폴더)');
  });

  it('계산된 편성이 없으면 그렇게 적고, 걸러진 편성과 주의는 그대로 보인다', () => {
    const w = render(variant((r) => void (r.ranking = [])));
    expect(w.find('[data-testid="ranking-empty"]').text()).toBe('계산된 편성이 없다.');
    expect(w.findAll('[data-testid="rejected-entry"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="caveat"]')).toHaveLength(3);
  });

  it('미육성으로 계산한 멤버를 메모로 보인다', () => {
    const w = render(variant((r) => void (r.ranking[0].ungrown_members = ['헬름', '앨리스'])));
    expect(w.find('[data-testid="ungrown"]').text()).toBe('육성 정보가 비어 미육성으로 계산: 헬름, 앨리스');
  });

  it('추천(suggest) 결과면 후보 생성 요약을 보인다', () => {
    const w = render(
      variant((r) => void (r.suggestion = { considered: 30, generated: 6, simulated: 6, shown: 5 })),
    );
    expect(w.find('[data-testid="suggestion"]').text()).toBe(
      '후보: 조합 30개 중 6개 생성 → 6개 계산 → 상위 5개 표시',
    );
    expect(render().find('[data-testid="suggestion"]').exists()).toBe(false);
  });

  it('수가 아닌 값은 지어내지 않고 값 오류로 표시한다', () => {
    const w = render(
      variant((r) => {
        (r.ranking[0] as unknown as Record<string, unknown>).total_damage = null;
        (r.ranking[0].members[0] as unknown as Record<string, unknown>).damage = -5;
      }),
    );
    expect(texts(w, 'total-unit')[0]).toBe('값 오류');
    expect(texts(w, 'total-raw')[0]).toBe('(값 오류)');
    expect(texts(w, 'member-unit')[0]).toBe('값 오류');
  });
});
