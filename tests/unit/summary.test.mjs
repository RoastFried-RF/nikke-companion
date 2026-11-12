// 한 줄 요약(src/core/summary.mjs)의 규칙과 문장.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  CARRY_SHARE,
  PLACEMENT_GAIN,
  SUMMARY_NO_BREAKDOWN,
  SUMMARY_NO_SQUAD,
  SUMMARY_NOT_COMPUTED,
  summarizeInterceptBoss,
} from '../../src/core/summary.mjs';

/** 지어낸 보스 항목. 요격전 추천 결과(src/core/intercept.mjs)의 보스 항목에서 요약이 읽는 칸만 담는다. */
function boss({ members, weak = '작열', owned = ['라피 : 레드 후드', '앨리스'], reflected = true, placement = null, status = 'computed', pool = true } = {}) {
  const list = members ?? [
    ['라피 : 레드 후드', 0.62],
    ['크라운', 0.14],
    ['리틀 머메이드', 0.1],
    ['헬름', 0.08],
    ['프리카', 0.06],
  ];
  return {
    id: 'indivilia',
    name: '인디빌리아',
    status,
    element: { code: reflected ? '풍압' : null, weak_to: reflected ? weak : null, reflected },
    weak_pool: pool && reflected ? { element: weak, owned, pooled: owned, not_pooled: [], promoted: [] } : null,
    ranking: [
      {
        rank: 1,
        name: '후보 7',
        total_damage: 4_651_472_758,
        relative_to_best: 1,
        members: list.map(([name, share]) => ({ name, share, damage: Math.round(share * 4_651_472_758) })),
        placement,
      },
    ],
  };
}

const kinds = (summary) => summary.clauses.map((c) => c.kind);

test('약점 속성 딜러가 딜의 절반 이상을 내면 그렇게 말한다', () => {
  const s = summarizeInterceptBoss(boss());
  assert.equal(s.text, '약점 속성(작열) 딜러 중심 — 라피 : 레드 후드 혼자 딜의 62%.');
  assert.deepEqual(kinds(s), ['weak_carry', 'carry']);
  assert.deepEqual(s.facts.weak_members, ['라피 : 레드 후드']);
  assert.equal(s.facts.carry, true);
  assert.deepEqual(s.facts.top, { name: '라피 : 레드 후드', share: 0.62 });
  assert.equal(s.facts.squad, '후보 7');
});

test('약점 속성 니케 여럿이 합쳐 절반 이상이면 합을 말하고, 딜이 나뉜 것도 말한다', () => {
  const s = summarizeInterceptBoss(
    boss({
      members: [
        ['크라운', 0.3],
        ['라피 : 레드 후드', 0.28],
        ['앨리스', 0.27],
        ['헬름', 0.1],
        ['프리카', 0.05],
      ],
    }),
  );
  assert.equal(s.text, '약점 속성(작열) 니케가 딜의 55% — 크라운 30% · 라피 : 레드 후드 28%로 딜이 나뉜다.');
  assert.deepEqual(kinds(s), ['weak_majority', 'split']);
  assert.ok(Math.abs(s.facts.weak_share - 0.55) < 1e-9);
  assert.equal(s.facts.carry, false);
});

test('약점 속성 니케가 있어도 딜이 적으면 「뿐」이라고 말한다', () => {
  const s = summarizeInterceptBoss(
    boss({
      members: [
        ['크라운', 0.55],
        ['헬름', 0.2],
        ['앨리스', 0.12],
        ['리틀 머메이드', 0.08],
        ['프리카', 0.05],
      ],
    }),
  );
  assert.equal(s.text, '약점 속성(작열) 니케의 딜은 12%뿐 — 크라운 혼자 딜의 55%.');
  assert.deepEqual(kinds(s), ['weak_minor', 'carry']);
});

test('편성에 약점 속성 니케가 없으면 없다고 말한다', () => {
  const s = summarizeInterceptBoss(
    boss({
      members: [
        ['크라운', 0.4],
        ['헬름', 0.3],
        ['리틀 머메이드', 0.2],
        ['프리카', 0.1],
      ],
    }),
  );
  assert.equal(s.text, '약점 속성(작열) 니케 없는 편성 — 크라운 40% · 헬름 30%로 딜이 나뉜다.');
  assert.deepEqual(s.facts.weak_members, []);
  assert.equal(s.facts.weak_share, null);
});

test('기준: 절반(50%)부터 「혼자」, 5%부터 「자리 순서」', () => {
  assert.equal(CARRY_SHARE, 0.5);
  assert.equal(PLACEMENT_GAIN, 1.05);
  const at = (share) => summarizeInterceptBoss(boss({ members: [['크라운', share], ['헬름', (1 - share) / 2], ['프리카', (1 - share) / 2]], pool: false }));
  assert.deepEqual(kinds(at(0.5)), ['carry']);
  assert.deepEqual(kinds(at(0.4999)), ['split']);
  const moved = (gain, changed = true) =>
    summarizeInterceptBoss(boss({ placement: { changed, changes: [], gain_ratio: gain, original_total_damage: 1, original_members: [], variants: {} } }));
  assert.equal(moved(1.08).text, '약점 속성(작열) 딜러 중심 — 라피 : 레드 후드 혼자 딜의 62%, 자리 순서를 바꿔 딜 +8%.');
  assert.deepEqual(kinds(moved(1.05)), ['weak_carry', 'carry', 'placement']);
  // 5%에 못 미치면 「크게 바꿨다」고 하지 않는다. 재료(facts)에는 남는다.
  assert.deepEqual(kinds(moved(1.049)), ['weak_carry', 'carry']);
  assert.equal(moved(1.049).facts.placement_gain, 1.049);
  // 바꾸지 않았으면(1단계 배치 그대로) 비율이 있어도 말하지 않는다.
  assert.deepEqual(kinds(moved(1.3, false)), ['weak_carry', 'carry']);
  assert.equal(moved(1.3, false).facts.placement_gain, null);
  // 비율을 모르면(1단계 총딜 0) 말하지 않는다.
  assert.deepEqual(kinds(moved(null)), ['weak_carry', 'carry']);
});

test('결과에 없는 사실을 지어내지 않는다 — 누가 약점 속성인지 모르면 속성 이야기를 뺀다', () => {
  // weak_pool이 없는 결과(카탈로그에 속성 정보가 없었다).
  const s = summarizeInterceptBoss(boss({ pool: false }));
  assert.equal(s.text, '라피 : 레드 후드 혼자 딜의 62%.');
  assert.equal(s.facts.weak_members, null);
  // weak_pool이 다른 속성의 것이면(어긋난 결과) 쓰지 않는다.
  const odd = boss();
  odd.weak_pool.element = '수냉';
  assert.deepEqual(kinds(summarizeInterceptBoss(odd)), ['carry']);
  // 속성을 아는 함수를 주면 그것으로 판단한다. 한 명이라도 모르면 속성 이야기를 뺀다.
  const elements = { '라피 : 레드 후드': '작열', 크라운: '철갑', '리틀 머메이드': '수냉', 헬름: '수냉', 프리카: '풍압' };
  assert.deepEqual(kinds(summarizeInterceptBoss(boss({ pool: false }), { elementOf: (n) => elements[n] })), ['weak_carry', 'carry']);
  assert.deepEqual(kinds(summarizeInterceptBoss(boss({ pool: false }), { elementOf: (n) => (n === '프리카' ? null : elements[n]) })), ['carry']);
});

test('속성 상성을 반영하지 못한 보스는 그 사실을 문장 맨 앞에 둔다', () => {
  const s = summarizeInterceptBoss(boss({ reflected: false }));
  assert.equal(s.text, '속성 상성 미반영 — 라피 : 레드 후드 혼자 딜의 62%.');
  assert.equal(s.facts.element_reflected, false);
  assert.equal(s.facts.weak_element, null);
});

test('계산하지 않은 보스·편성이 없는 보스·비중이 없는 결과', () => {
  assert.equal(summarizeInterceptBoss(boss({ status: 'not_computed' })).text, SUMMARY_NOT_COMPUTED);
  assert.equal(summarizeInterceptBoss({ status: 'computed', ranking: [] }).text, SUMMARY_NO_SQUAD);
  assert.equal(summarizeInterceptBoss({}).text, SUMMARY_NO_SQUAD);
  assert.equal(summarizeInterceptBoss(null).text, SUMMARY_NO_SQUAD);
  // 비중이 0이거나 없는 멤버뿐이면 딜 구성을 말하지 않는다.
  const zero = boss({ members: [['크라운', 0], ['헬름', 0]], pool: false });
  assert.equal(summarizeInterceptBoss(zero).text, SUMMARY_NO_BREAKDOWN);
  const missing = boss({ pool: false });
  for (const m of missing.ranking[0].members) delete m.share;
  assert.equal(summarizeInterceptBoss(missing).text, SUMMARY_NO_BREAKDOWN);
  // 그래도 약점 속성 니케가 편성에 없다는 것은 비중 없이 말할 수 있다.
  assert.equal(summarizeInterceptBoss(boss({ members: [['크라운', 0], ['헬름', 0]] })).text, '약점 속성(작열) 니케 없는 편성.');
});

test('한 문장이다 — 마침표 하나로 끝나고, 개발 용어가 없다', () => {
  const samples = [
    boss(),
    boss({ reflected: false }),
    boss({ pool: false }),
    boss({ members: [['크라운', 0.4], ['헬름', 0.3], ['앨리스', 0.3]], placement: { changed: true, gain_ratio: 1.12 } }),
    boss({ status: 'not_computed' }),
  ];
  for (const b of samples) {
    const { text } = summarizeInterceptBoss(b);
    assert.match(text, /[^.]\.$/, text);
    assert.equal(text.split('.').length, 2, text);
    assert.doesNotMatch(text, /시뮬|예산|파일|JSON|undefined|null|NaN/, text);
  }
});

test('입력을 바꾸지 않는다(멤버 순서 포함)', () => {
  const b = boss({
    members: [
      ['헬름', 0.1],
      ['라피 : 레드 후드', 0.6],
      ['크라운', 0.3],
    ],
  });
  const before = JSON.stringify(b);
  summarizeInterceptBoss(b);
  assert.equal(JSON.stringify(b), before);
});

test('실제 CLI가 만든 요격전 결과(앱의 테스트 입력)의 보스마다 문장이 나온다', () => {
  const report = JSON.parse(fs.readFileSync(new URL('../../app/tests/fixtures/intercept.sample.json', import.meta.url), 'utf8'));
  assert.equal(report.kind, 'intercept_report');
  for (const b of report.bosses) {
    const s = summarizeInterceptBoss(b);
    assert.match(s.text, /[^.]\.$/, b.name);
    const best = b.ranking[0];
    // 문장에 나온 이름은 모두 1위 편성의 멤버다.
    const names = best.members.map((m) => m.name);
    if (s.facts.top) assert.ok(names.includes(s.facts.top.name), b.name);
    for (const name of s.facts.weak_members ?? []) {
      assert.ok(names.includes(name), b.name);
      assert.ok(b.weak_pool.owned.includes(name), b.name);
    }
    // 속성을 반영하지 못한 보스(검증용 보스 E)는 그 사실이 문장에 있다.
    assert.equal(s.text.startsWith('속성 상성 미반영'), b.element.reflected === false, b.name);
    // 문장의 비중은 결과의 비중을 반올림한 것이다.
    if (s.facts.carry) assert.ok(s.text.includes(`${Math.round(s.facts.top.share * 100)}%`), b.name);
  }
});
