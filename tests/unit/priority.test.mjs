// 후보 생성의 「우선 속성」(P-020): 요격전 추천이 보스의 약점 속성을 넘겨 보스마다 후보 풀이 달라지게 한다.
//   - 우선 속성을 주지 않으면 결과가 종전과 완전히 같다
//   - 주면 덜 키운 그 속성 니케도 버스트 단계마다 최소 인원이 후보 풀에 들고, 누가 그렇게 들었는지 남는다
//   - 후보 순서: limit·시뮬 예산으로 잘라도 우선 속성 니케가 든 후보가 먼저 잘리지 않는다
// 엔진은 가짜다: 적 속성에 우월한 니케의 딜이 세 배다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  generateCandidates, suggestSquads, investmentScore,
  DEFAULT_PRIORITY_MIN, PRIORITY_SCORE_BONUS, INVEST_SCORE_MAX, DEFAULT_STAGE_CAPS,
} from '../../src/core/candidates.mjs';
import { InputError } from '../../src/core/compare.mjs';
import { recommendIntercept, ELEMENT_ADVANTAGE } from '../../src/core/intercept.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const REAL = readJson('data/intercept/anomaly.json');
const SAMPLE = readJson('data/samples/bosses.anomaly.sample.json');

// ── 가짜 카탈로그·계정 ────────────────────────────────────────────────────────
// 이름 = 단계(일·이·삼) + 속성 첫 글자 + 번호. 속성은 카탈로그의 element_code에만 있다(생성기는 이름을 읽지 않는다).
const ELEMENT_OF = { 작: '작열', 풍: '풍압', 철: '철갑', 전: '전격', 수: '수냉' };
const STAGE_OF = { 일: '1', 이: '2', 삼: '3' };
const full = { skill_levels: [10, 10, 10], breakthrough: 3, core_enhancement: 7, overload: { 공격력: 12 } };
const high = (skill) => ({ skill_levels: [skill, skill, skill], breakthrough: 3, core_enhancement: 7 });
const low = (skill) => ({ skill_levels: [skill, skill, skill] });
// 보유 20명. 수냉 니케는 일부러 덜 키웠다 — 투자 점수만으로는 한 명도 후보 풀에 들지 못한다.
const NIKKES = {
  일철1: full, 일전1: high(10), 일풍1: high(9), 일수1: low(4), 일수2: {},
  이철1: full, 이전1: high(10), 이풍1: high(9), 이수1: low(4),
  삼철1: full, 삼전1: high(10), 삼풍1: high(9), 삼작1: high(8), 삼작2: high(7), 삼철2: high(6),
  삼수1: low(8), 삼수2: low(4), 삼수3: {}, 삼전2: low(9), 삼풍2: low(3),
};
const catalog = {
  nikkes: Object.fromEntries(Object.keys(NIKKES).map((n) => [n, { burst_stage: STAGE_OF[n[0]], element_code: ELEMENT_OF[n[1]], weapon_type: 'AR', is_charge: false }])),
  bosses: ['보스'],
};
const account = { schema_version: 1, is_test_data: true, name: '큰 가짜 계정', nikkes: NIKKES };
const elementOf = (name) => catalog.nikkes[name].element_code;
const hasElement = (members, element) => members.some((m) => elementOf(m) === element);
const now = () => new Date('2026-11-12T00:00:00Z');
const clone = (v) => structuredClone(v);
/** 속성 정보(element_code)만 뺀 카탈로그 — P-020 전의 생성기가 읽던 것과 같다(다른 칸은 그대로). */
const withoutElements = (cat) => ({ ...cat, nikkes: Object.fromEntries(Object.entries(cat.nikkes).map(([n, { element_code: _dropped, ...rest }]) => [n, rest])) });

/** 가짜 엔진. 멤버 딜 = 1000 × (적 속성에 우월하면 3). 받은 요청을 `log`에 남긴다. */
function fakeEngine(log = []) {
  return async (requests) => {
    log.push(...requests);
    return requests.map((req) => {
      const code = req.enemy?.code ?? null;
      const members = req.squad.map((name) => ({ name, damage: code !== null && ELEMENT_ADVANTAGE[elementOf(name)] === code ? 3000 : 1000 }));
      const total = members.reduce((s, m) => s + m.damage, 0);
      return {
        total_damage: total,
        members: members.map((m) => ({ ...m, share: m.damage / total })),
        warnings: [],
        spec: { profile: { ungrown: [] } },
        evaluator: { repo: 'fake', commit: 'abc', dirty: false },
      };
    });
  };
}
const depsOf = (log) => ({ catalog, runBatch: fakeEngine(log), now });
// 작열 보스(약점 수냉) — 수냉 니케가 우월하다.
const vsFire = { schema_version: 1, content: 'anomaly_interception', enemy: { code: '작열' } };

// ── 우선 속성 없음 = 종전과 같다 ──────────────────────────────────────────────

test('우선 속성을 주지 않으면 결과가 종전과 완전히 같다 — 카탈로그의 속성 정보는 읽지 않는다', async () => {
  // 속성 정보가 없는 카탈로그(P-020 전에 생성기가 본 것과 같다)로 만든 결과와 비교한다.
  const bare = withoutElements(catalog);
  const plain = generateCandidates(account, bare);
  assert.deepEqual(generateCandidates(account, catalog), plain);
  assert.deepEqual(generateCandidates(account, catalog, { priorityElement: undefined }), plain);
  assert.deepEqual(generateCandidates(account, catalog, { priorityElement: null, priorityMin: 3 }), plain);
  assert.equal(Object.hasOwn(plain.summary, 'priority'), false, '우선 속성 칸이 생기지 않는다');
  assert.deepEqual(Object.keys(plain.summary), ['owned', 'usable', 'pool', 'excluded', 'shapes', 'considered', 'generated', 'limit', 'truncated']);
  assert.doesNotMatch(plain.caveats.join('\n'), /우선 속성|순위 점수/);
  // 투자 점수 순 풀: 덜 키운 수냉 니케는 한 명도 없다.
  assert.deepEqual(plain.summary.pool, { 1: ['일철1', '일전1', '일풍1'], 2: ['이철1', '이전1', '이풍1'], 3: ['삼철1', '삼전1', '삼풍1', '삼작1', '삼작2'] });
  assert.ok(plain.squads.every((s) => !hasElement(s.members, '수냉')));
  // 후보는 투자 점수 합의 내림차순 그대로다.
  const sums = plain.squads.map((s) => s.members.reduce((t, m) => t + investmentScore(NIKKES[m]), 0));
  assert.deepEqual(sums, [...sums].sort((a, b) => b - a));

  // 추천(suggest)도 같다: 엔진에 가는 요청과 결과 문서가 속성 정보와 무관하다.
  const logA = [];
  const logB = [];
  const a = await suggestSquads({ account, condition: vsFire }, { budget: 40 }, { catalog: bare, runBatch: fakeEngine(logA), now });
  const b = await suggestSquads({ account, condition: vsFire }, { budget: 40 }, depsOf(logB));
  assert.deepEqual(logB.map((r) => r.squad), logA.map((r) => r.squad));
  assert.deepEqual(b.suggestion, a.suggestion);
  assert.deepEqual(b.caveats, a.caveats);
  assert.match(b.caveats.join('\n'), /시뮬 예산 40건이 모자라|후보 30개를 계산해/);
});

// ── 우선 속성: 후보 풀 ────────────────────────────────────────────────────────

test('우선 속성을 주면 덜 키운 그 속성 니케가 단계마다 최소 2명 후보 풀에 들고, 누가 그렇게 들었는지 남는다', () => {
  assert.equal(DEFAULT_PRIORITY_MIN, 2);
  assert.equal(PRIORITY_SCORE_BONUS, INVEST_SCORE_MAX / 8);
  const r = generateCandidates(account, catalog, { priorityElement: '수냉' });
  // 원래 풀(투자 점수 상위)은 그대로 있고, 수냉 니케가 뒤에 더해졌다 — 2단계는 보유가 1명뿐이라 1명만.
  assert.deepEqual(r.summary.pool, {
    1: ['일철1', '일전1', '일풍1', '일수1', '일수2'],
    2: ['이철1', '이전1', '이풍1', '이수1'],
    3: ['삼철1', '삼전1', '삼풍1', '삼작1', '삼작2', '삼수1', '삼수2'],
  });
  assert.deepEqual(r.summary.priority, {
    element: '수냉',
    min_per_stage: 2,
    score_bonus: PRIORITY_SCORE_BONUS,
    active: true,
    owned: ['삼수1', '삼수2', '이수1', '일수1', '삼수3', '일수2'],
    pool: { 1: ['일수1', '일수2'], 2: ['이수1'], 3: ['삼수1', '삼수2'] },
    promoted: { 1: ['일수1', '일수2'], 2: ['이수1'], 3: ['삼수1', '삼수2'] },
    displaced: { 1: [], 2: [], 3: [] },
    short: [{ stage: '2', wanted: 2, available: 1 }],
    guaranteed: r.summary.priority.guaranteed,
    candidates: r.squads.filter((s) => hasElement(s.members, '수냉')).length,
  });
  // 최소 인원을 넘는 수냉 니케(삼수3)는 풀 밖이다 — 이름이 적힌다.
  assert.ok(r.summary.excluded.includes('삼수3'));
  assert.ok(!r.squads.some((s) => s.members.includes('삼수3')));

  const text = r.caveats.join('\n');
  assert.match(text, /우선 속성 수냉: 그 속성 니케는 투자 점수에 3402점\(만점의 1\/8 — 어림 규칙이다/);
  assert.match(text, /버스트 단계마다 후보 풀에 최소 2명을 넣었다\(보유 수가 모자라면 있는 만큼\)\. 풀에 든 우선 속성 니케: 1단계 일수1, 일수2 · 2단계 이수1 · 3단계 삼수1, 삼수2\./);
  assert.match(text, /우선 속성이 아니었으면 그 단계의 후보 풀에 들지 못했을 니케\(투자 점수가 낮아도 넣었다\): 1단계 일수1, 일수2 · 2단계 이수1 · 3단계 삼수1, 삼수2\./);
  assert.match(text, /우선 속성 수냉 니케가 모자라 최소 2명을 채우지 못한 단계: 2단계\(보유 1명\)\./);
  assert.match(text, /1단계 5\/5명, 2단계 4\/4명, 3단계 7\/11명/);
  assert.match(text, /후보 풀에 들지 못한 보유 니케: .*삼수3/);
  assert.match(text, /후보 순서: 우선 속성\(수냉\) 니케가 든 조합과 순위 점수 합이 높은 조합을 번갈아 앞에 뒀다/);
  assert.match(text, /우선 속성 니케가 든 후보가 먼저 잘리지 않는다/);
  assert.match(text, new RegExp(`조합 ${r.summary.considered}개 중 위 순서로 30개만 후보로 남겼다 \\(limit 30\\) — 그중 ${r.summary.priority.candidates}개에 우선 속성 니케가 들었다`));
  assert.doesNotMatch(text, /밀려/);

  // 모든 후보는 여전히 보유 5명·중복 없음·버스트 1·2·3단계.
  for (const s of r.squads) {
    assert.equal(new Set(s.members).size, 5, s.name);
    assert.deepEqual([...new Set(s.members.map((m) => catalog.nikkes[m].burst_stage))].sort(), ['1', '2', '3'], s.name);
  }
  assert.deepEqual(r.squads.map((s) => s.name), r.squads.map((_, i) => `후보 ${i + 1}`));
});

test('보유 수가 모자란 단계: 있는 만큼만 넣고, 한 명도 없는 단계는 그대로 두고 그렇게 적는다', () => {
  // 작열 니케는 3단계에만 있고 이미 풀 안이다 — 1·2단계는 0명, 풀은 종전과 같다.
  const fire = generateCandidates(account, catalog, { priorityElement: '작열' });
  const plain = generateCandidates(account, catalog);
  assert.deepEqual(fire.summary.pool, { ...plain.summary.pool, 3: ['삼철1', '삼작1', '삼작2', '삼전1', '삼풍1'] }, '같은 다섯 명 — 순위 점수 순으로 작열이 앞선다');
  assert.deepEqual(fire.summary.priority.pool, { 1: [], 2: [], 3: ['삼작1', '삼작2'] });
  assert.deepEqual(fire.summary.priority.promoted, { 1: [], 2: [], 3: [] });
  assert.deepEqual(fire.summary.priority.short, [{ stage: '1', wanted: 2, available: 0 }, { stage: '2', wanted: 2, available: 0 }]);
  assert.match(fire.caveats.join('\n'), /우선 속성 작열 니케가 모자라 최소 2명을 채우지 못한 단계: 1단계\(보유 0명\), 2단계\(보유 0명\)\./);
  assert.doesNotMatch(fire.caveats.join('\n'), /들지 못했을 니케/);
  // 풀은 같아도 순서는 작열 쪽이 앞선다: 순위 점수로 삼작1·삼작2가 삼전1·삼풍1을 앞지른다.
  assert.deepEqual(fire.squads[0].members.filter((m) => m[0] === '삼'), ['삼철1', '삼작1', '삼작2']);

  // 최소 인원을 3으로 올리면 3단계에 수냉 세 명이 다 든다. 1로 내리면 단계마다 한 명.
  const three = generateCandidates(account, catalog, { priorityElement: '수냉', priorityMin: 3 });
  assert.deepEqual(three.summary.priority.pool, { 1: ['일수1', '일수2'], 2: ['이수1'], 3: ['삼수1', '삼수2', '삼수3'] });
  assert.deepEqual(three.summary.priority.short.map((s) => [s.stage, s.available]), [['1', 2], ['2', 1]]);
  const one = generateCandidates(account, catalog, { priorityElement: '수냉', priorityMin: 1 });
  assert.deepEqual(one.summary.priority.pool, { 1: ['일수1'], 2: ['이수1'], 3: ['삼수1'] });
  assert.deepEqual(one.summary.priority.short, []);
});

test('그 속성의 보유 니케가 없으면(또는 카탈로그에 속성이 없으면) 후보는 우선 속성 없이 만든 것과 같다', () => {
  const plain = generateCandidates(account, catalog);
  const bare = withoutElements(catalog);
  for (const r of [generateCandidates(account, catalog, { priorityElement: '없는 속성' }), generateCandidates(account, bare, { priorityElement: '수냉' })]) {
    assert.deepEqual(r.squads, plain.squads);
    assert.deepEqual(r.summary.pool, plain.summary.pool);
    assert.equal(r.summary.priority.active, false);
    assert.deepEqual(r.summary.priority.owned, []);
    assert.equal(r.summary.priority.candidates, 0);
    assert.equal(r.summary.priority.guaranteed, 0);
    assert.match(r.caveats.join('\n'), /그 속성의 보유 니케가 없다\(또는 카탈로그에 속성 정보가 없다\) — 후보는 우선 속성 없이 만든 것과 같다/);
    assert.match(r.caveats.join('\n'), /투자 점수 합이 높은 30개만 후보로 남겼다/);
  }
});

test('순위 점수: 육성 정도가 비슷하면 우선 속성 니케가 앞서고, 밀려난 니케는 이름이 적힌다', () => {
  // 3단계 여섯 명의 투자 점수가 촘촘하다 — 전격 우선이면 삼전1(스킬 5)이 순위 점수로 둘째가 된다. 삼전2(스킬 9, 미돌파)는 여전히 멀다.
  const tight = {
    schema_version: 1,
    is_test_data: true,
    nikkes: { 일철1: full, 이철1: full, 삼철1: high(10), 삼풍1: high(9), 삼작1: high(8), 삼작2: high(7), 삼철2: high(6), 삼전1: high(5), 삼전2: low(9), 삼수1: {} },
  };
  const plain = generateCandidates(tight, catalog);
  assert.deepEqual(plain.summary.pool[3], ['삼철1', '삼풍1', '삼작1', '삼작2', '삼철2']);
  const r = generateCandidates(tight, catalog, { priorityElement: '전격' });
  // 삼전1: 스킬 5라 투자 점수로는 6위지만 +3402로 삼풍1(스킬 9) 위에 선다 — 5위였던 삼철2가 밀려난다. 삼전2는 최소 2명 보장으로 더해졌다.
  assert.deepEqual(r.summary.pool[3], ['삼철1', '삼전1', '삼풍1', '삼작1', '삼작2', '삼전2']);
  assert.deepEqual(r.summary.priority.promoted[3], ['삼전1', '삼전2']);
  assert.deepEqual(r.summary.priority.displaced[3], ['삼철2']);
  assert.match(r.caveats.join('\n'), /우선 속성 니케에 순위가 밀려 그 단계의 후보 풀에서 빠진 니케: 3단계 삼철2\./);
  // 같은 단계 안의 배치도 순위 점수 순이다.
  const order = Object.fromEntries(r.summary.pool[3].map((n, i) => [n, i]));
  for (const s of r.squads) {
    const idx = s.members.filter((m) => m[0] === '삼').map((m) => order[m]);
    assert.deepEqual(idx, [...idx].sort((x, y) => x - y), s.members.join(','));
  }
});

// ── 우선 속성: 후보 순서와 예산 ───────────────────────────────────────────────

test('후보 순서: 앞에서 몇 개를 자르든 절반 이상이 우선 속성 니케가 든 후보이고, 풀의 우선 속성 니케는 저마다 앞쪽 후보에 든다', () => {
  const all = generateCandidates(account, catalog, { priorityElement: '수냉', limit: 5000 });
  assert.equal(all.summary.truncated, false);
  const withWater = all.squads.map((s) => hasElement(s.members, '수냉'));
  const totalWater = withWater.filter(Boolean).length;
  assert.equal(all.summary.priority.candidates, totalWater);
  assert.ok(totalWater > 30 && totalWater < all.squads.length, '수냉이 든 조합과 들지 않은 조합이 모두 넉넉하다');
  let seen = 0;
  for (let n = 1; n <= all.squads.length; n += 1) {
    if (withWater[n - 1]) seen += 1;
    assert.ok(seen >= Math.min(Math.ceil(n / 2), totalWater), `앞 ${n}개 중 수냉이 든 후보 ${seen}개`);
  }
  // 보장 후보: 풀에 든 수냉 니케 다섯은 저마다 맨 앞의 보장 후보에 든다(번갈아 뽑으므로 앞 2×보장 수 안).
  const g = all.summary.priority.guaranteed;
  assert.ok(g >= 1 && g <= 5);
  const front = new Set(all.squads.slice(0, 2 * g).flatMap((s) => s.members));
  for (const name of ['일수1', '일수2', '이수1', '삼수1', '삼수2']) assert.ok(front.has(name), `${name}이 앞 ${2 * g}개 후보에 없다`);
  // 맨 앞은 우선 속성 쪽, 둘째 안에는 순위 점수 합이 가장 높은 조합(= 우선 속성 없는 생성의 1위)이 있다.
  assert.equal(withWater[0], true);
  const best = generateCandidates(account, catalog).squads[0].members.join('|');
  assert.ok(all.squads.slice(0, 2).some((s) => s.members.join('|') === best));
  // 조합이 두 번 나오지 않는다.
  assert.equal(new Set(all.squads.map((s) => [...s.members].sort().join('|'))).size, all.squads.length);

  // 더 작은 limit의 결과는 앞부분이다 — 잘라낸 것이지 다시 고른 것이 아니다.
  for (const limit of [1, 2, 7, 30]) {
    const r = generateCandidates(account, catalog, { priorityElement: '수냉', limit });
    assert.deepEqual(r.squads, all.squads.slice(0, limit));
    assert.equal(r.summary.priority.candidates, withWater.slice(0, limit).filter(Boolean).length);
    assert.ok(r.summary.priority.candidates >= Math.ceil(limit / 2));
  }
});

test('후보 순서: 덜 키운 우선 속성 니케가 여럿 든 조합도 앞쪽에 온다 — 둘 든 조합부터 인원수별로 돌아가며', () => {
  const r = generateCandidates(account, catalog, { priorityElement: '수냉' });
  const count = (s) => s.members.filter((m) => elementOf(m) === '수냉').length;
  const counts = r.squads.map(count);
  // 순위 점수 합 순으로만 뽑으면 수냉이 한 명 든 조합만 30개 안에 든다(수냉 니케는 모두 덜 키웠다). 둘~다섯 든 조합이 모두 있다.
  for (const k of [2, 3, 4, 5]) assert.ok(counts.includes(k), `수냉 ${k}명 든 후보가 없다: ${counts.join(' ')}`);
  // 우선 줄은 번갈아 뽑는 짝수 번째(0, 2, 4, …)다: 보장 후보 뒤에 둘 → 셋 → 넷 → 다섯 → 둘 … 순으로 온다
  // (다섯 든 조합은 일수1·일수2·이수1·삼수1·삼수2 하나뿐이라 둘째 바퀴에는 없다).
  const g = r.summary.priority.guaranteed;
  const lane = counts.filter((_, i) => i % 2 === 0).slice(g, g + 8);
  assert.deepEqual(lane, [2, 3, 4, 5, 2, 3, 4, 2]);
});

test('후보 순서: 우선 속성 니케가 모두 잘 키운 니케이면 앞쪽 후보는 순위 점수 합 상위 그대로다 — 작은 예산을 낭비하지 않는다', () => {
  // 실제 엔진에서 본 문제의 재현: 한 명만 든 조합까지 인원수별로 돌리면, 잘 키운 수냉 딜러 하나를 뺀 조합이 앞에 와서
  // 보스당 8건 같은 작은 예산에서 가장 좋은 조합(둘 다 든 것)이 잘린다.
  const nikkes = { 일철1: full, 이철1: full, 이전1: high(7), 이풍1: {}, 삼수1: full, 삼수2: full, 삼전1: high(7), 삼풍1: low(4) };
  const small = { schema_version: 1, is_test_data: true, nikkes };
  const r = generateCandidates(small, catalog, { priorityElement: '수냉' });
  assert.deepEqual(r.summary.priority.promoted, { 1: [], 2: [], 3: [] }, '풀은 투자 점수로 고른 것과 같다');
  assert.equal(r.summary.priority.guaranteed, 1, '수냉 둘이 한 조합에 든다');
  const rank = (n) => investmentScore(nikkes[n]) + (elementOf(n) === '수냉' ? PRIORITY_SCORE_BONUS : 0);
  const sum = (s) => s.members.reduce((t, m) => t + rank(m), 0);
  const byRankSum = [...r.squads].sort((a, b) => sum(b) - sum(a)); // 안정 정렬 — 같은 합이면 후보 순서
  for (const n of [1, 2, 4, 6, 8]) {
    assert.deepEqual(r.squads.slice(0, n).map((s) => s.name).sort(), byRankSum.slice(0, n).map((s) => s.name).sort(), `앞 ${n}개`);
  }
  // 수냉 둘이 다 든 조합이 한 명만 든 조합보다 먼저 온다(앞 8개 안의 한 명짜리는 순위 점수 합이 높아서 든 것뿐이다).
  const both = (s) => s.members.includes('삼수1') && s.members.includes('삼수2');
  assert.ok(r.squads.slice(0, 8).filter(both).length >= 6);
});

test('같은 입력이면 같은 후보가 같은 순서로 나온다 — 우선 속성이 있어도, 계정의 나열 순서가 달라도', () => {
  const first = generateCandidates(account, catalog, { priorityElement: '수냉' });
  assert.deepEqual(generateCandidates(clone(account), clone(catalog), { priorityElement: '수냉' }), first);
  const reversed = { ...account, nikkes: Object.fromEntries(Object.entries(NIKKES).reverse()) };
  assert.deepEqual(generateCandidates(reversed, catalog, { priorityElement: '수냉' }), first);
  const before = JSON.stringify([account, catalog]);
  generateCandidates(account, catalog, { priorityElement: '수냉' });
  assert.equal(JSON.stringify([account, catalog]), before, '입력을 바꾸지 않는다');
});

test('잘못된 우선 속성 옵션은 InputError다', () => {
  for (const priorityElement of ['', '  ', 3, {}, []]) {
    assert.throws(() => generateCandidates(account, catalog, { priorityElement }), (e) => e instanceof InputError && /우선 속성은 비어 있지 않은 문자열/.test(e.message), JSON.stringify(priorityElement));
  }
  for (const priorityMin of [0, -1, 1.5, '2']) {
    assert.throws(() => generateCandidates(account, catalog, { priorityElement: '수냉', priorityMin }), (e) => e instanceof InputError && /최소 인원은 1 이상의 정수/.test(e.message), String(priorityMin));
  }
});

test('suggest: 우선 속성을 주면 덜 키운 그 속성 니케가 든 편성이 계산되고, 엔진이 속성 우위에 딜을 더 주면 1위가 된다', async () => {
  const promoted = ['일수1', '일수2', '이수1', '삼수1', '삼수2'];
  // 우선 속성 없이: 수냉 니케는 엔진에 한 번도 가지 않는다 — 1위는 속성 우위가 하나도 없는 편성이다.
  const plainLog = [];
  const plain = await suggestSquads({ account, condition: vsFire }, { budget: 60, top: 3 }, depsOf(plainLog));
  assert.ok(plainLog.every((req) => !hasElement(req.squad, '수냉')));
  assert.equal(plain.ranking[0].total_damage, 5000);

  const log = [];
  const report = await suggestSquads({ account, condition: vsFire }, { budget: 60, top: 3, priorityElement: '수냉' }, depsOf(log));
  const top = report.ranking[0];
  const water = top.members.filter((m) => elementOf(m.name) === '수냉').map((m) => m.name);
  assert.ok(water.length >= 2, `1위 편성의 수냉 니케: ${water.join(', ')}`);
  for (const n of water) assert.ok(promoted.includes(n), `${n}은 덜 키워서 원래는 풀에 없던 니케다`);
  assert.ok(top.total_damage > plain.ranking[0].total_damage);
  assert.ok(top.members.filter((m) => elementOf(m.name) === '수냉').every((m) => m.damage === 3000));
  // 계산한 후보 중 수냉 니케가 가장 많이 든 편성이 1위다.
  const count = (squad) => squad.filter((n) => elementOf(n) === '수냉').length;
  assert.equal(water.length, Math.max(...log.map((req) => count(req.squad))));
  // 풀에 든 수냉 니케는 저마다 계산된 편성에 들었다.
  const simulated = new Set(log.flatMap((req) => req.squad));
  for (const n of promoted) assert.ok(simulated.has(n), n);
  // 결과에 우선 속성 요약과 문장이 실린다. 예산도 지킨다.
  assert.equal(report.suggestion.priority.element, '수냉');
  assert.deepEqual(report.suggestion.priority.promoted, { 1: ['일수1', '일수2'], 2: ['이수1'], 3: ['삼수1', '삼수2'] });
  assert.match(report.caveats.join('\n'), /우선 속성이 아니었으면 그 단계의 후보 풀에 들지 못했을 니케/);
  assert.ok(log.length <= 60);
  assert.equal(report.suggestion.search.sims, log.length);
});

test('suggest: 시뮬 예산이 모자라도 우선 속성 니케가 든 후보가 먼저 잘리지 않는다', async () => {
  for (const budget of [1, 2, 3, 6, 11]) {
    const log = [];
    const report = await suggestSquads({ account, condition: vsFire }, { budget, top: 3, refine: false, priorityElement: '수냉' }, depsOf(log));
    assert.equal(log.length, budget, '예산만큼만 엔진에 맡긴다');
    const water = log.filter((req) => hasElement(req.squad, '수냉')).length;
    assert.ok(water >= Math.ceil(budget / 2), `예산 ${budget}건 중 수냉이 든 후보 ${water}건`);
    // 엔진에 간 것은 후보 순서의 앞부분 그대로다.
    const generated = generateCandidates(account, catalog, { priorityElement: '수냉' });
    assert.deepEqual(log.map((req) => req.squad), generated.squads.slice(0, budget).map((s) => s.members));
    assert.equal(report.suggestion.search.stage1.skipped, 30 - budget);
    assert.match(report.caveats.join('\n'), new RegExp(`시뮬 예산 ${budget}건이 모자라 후보 ${30 - budget}개\\(후보 순서의 뒤쪽 — 우선 속성 니케가 든 후보와 순위 점수 합이 높은 후보를 번갈아 앞에 둔 순서다\\)를 계산하지 못했다`));
    assert.ok(hasElement(report.ranking[0].members.map((m) => m.name), '수냉'), '수냉이 든 편성이 1위다');
  }
  // 배치 탐색(2단계)을 켜도 전체 요청 수는 예산을 넘지 않는다.
  const log = [];
  const refined = await suggestSquads({ account, condition: vsFire }, { budget: 37, priorityElement: '수냉' }, depsOf(log));
  assert.ok(log.length <= 37);
  assert.equal(refined.suggestion.search.sims, log.length);
  assert.equal(refined.suggestion.search.stage1.requested, 30);
});

// ── 요격전 추천: 보스마다 약점 속성을 우선 속성으로 ──────────────────────────────

test('요격전 추천은 보스마다 약점 속성을 우선 속성으로 넘긴다 — 후보 풀과 1위 편성이 보스마다 다르다', async () => {
  const log = [];
  const report = await recommendIntercept({ account, bundle: REAL }, { budget: 100, top: 2 }, depsOf(log));
  for (const [i, b] of report.bosses.entries()) {
    const src = REAL.bosses[i];
    assert.equal(b.suggestion.priority.element, src.weak_to, b.name);
    assert.equal(b.suggestion.priority.min_per_stage, DEFAULT_PRIORITY_MIN);
    // 풀에 든 약점 속성 니케 수 = 단계마다 min(2, 보유 수) 이상.
    for (const s of ['1', '2', '3']) {
      const have = Object.keys(NIKKES).filter((n) => catalog.nikkes[n].burst_stage === s && elementOf(n) === src.weak_to).length;
      const pooled = b.suggestion.pool[s].filter((n) => elementOf(n) === src.weak_to).length;
      assert.ok(pooled >= Math.min(2, have), `${b.name} ${s}단계: 약점 ${src.weak_to} ${pooled}/${have}명`);
      assert.ok(b.suggestion.pool[s].length <= DEFAULT_STAGE_CAPS[s] + 2);
    }
    // 그 보스에 보낸 요청의 절반 이상(1단계 기준)에 약점 속성 니케가 들었고, 1위에는 약점 속성 니케가 있다.
    const sent = log.filter((req) => req.enemy.code === src.enemy.code);
    assert.equal(sent.length, b.sims);
    assert.ok(b.sims <= b.budget);
    if (b.suggestion.priority.active) {
      const stage1 = sent.slice(0, b.suggestion.search.stage1.requested);
      assert.ok(stage1.filter((req) => hasElement(req.squad, src.weak_to)).length >= Math.ceil(stage1.length / 2), b.name);
      assert.ok(hasElement(b.ranking[0].members.map((m) => m.name), src.weak_to), b.name);
    }
    assert.deepEqual(b.weak_pool.promoted, Object.keys(NIKKES).filter((n) => Object.values(b.suggestion.priority.promoted).flat().includes(n)).sort());
  }
  // 하베스터(약점 수냉): 덜 키운 수냉 니케가 풀에 들고 이름이 남는다. 1위 편성은 수냉 니케로 찬다.
  const harvester = report.bosses.find((b) => b.name === '하베스터');
  assert.deepEqual(harvester.weak_pool, {
    element: '수냉',
    owned: ['삼수1', '삼수2', '삼수3', '이수1', '일수1', '일수2'],
    pooled: ['삼수1', '삼수2', '이수1', '일수1', '일수2'],
    not_pooled: ['삼수3'],
    promoted: ['삼수1', '삼수2', '이수1', '일수1', '일수2'],
  });
  assert.match(harvester.notes.join('\n'), /약점 속성\(수냉\) 우선으로 후보 풀에 넣은 니케: 삼수1, 삼수2, 이수1, 일수1, 일수2 — 투자 점수만으로는 풀에 들지 못했을 니케다/);
  assert.match(harvester.notes.join('\n'), /보유 니케 6명 중 1명은 후보 풀에 들지 못했다\(삼수3\)/);
  assert.ok(harvester.ranking[0].members.filter((m) => elementOf(m.name) === '수냉').length >= 2);
  // 보스마다 풀이 다르고 1위 편성 멤버도 다르다.
  const pools = new Set(report.bosses.map((b) => JSON.stringify(b.suggestion.pool)));
  assert.ok(pools.size >= 3, `서로 다른 후보 풀 ${pools.size}가지`);
  const tops = report.bosses.map((b) => b.ranking[0].members.map((m) => m.name).sort().join('|'));
  assert.notEqual(tops[2], tops[0], '하베스터(약점 수냉)와 인디빌리아(약점 작열)의 1위 편성이 다르다');
  assert.notEqual(tops[2], tops[3], '하베스터와 크라켄(약점 풍압)의 1위 편성이 다르다');

  const text = report.caveats.join('\n');
  assert.match(text, /후보 편성은 보스마다 다르다: 보스의 약점 속성 니케를 버스트 단계별 후보 풀에 최소 2명씩 넣고\(보유 수가 모자라면 있는 만큼\)/);
  assert.match(text, /약점 속성 니케가 든 후보가 먼저 잘리지 않는다/);
  assert.match(text, /\[하베스터\] 우선 속성이 아니었으면 그 단계의 후보 풀에 들지 못했을 니케\(투자 점수가 낮아도 넣었다\): 1단계 일수1, 일수2 · 2단계 이수1 · 3단계 삼수1, 삼수2\./);
  assert.ok(report.sims.used <= 100);
  assert.equal(report.sims.used, log.length);
});

test('요격전 추천: 적 속성을 모르는 보스는 우선 속성 없이 돌린다 — 후보가 추천(suggest)의 것과 같다', async () => {
  const log = [];
  const report = await recommendIntercept({ account, bundle: SAMPLE }, { budget: 50 }, depsOf(log));
  const [a, , c, , e] = report.bosses;
  // E: 속성도 약점도 모른다 — 우선 속성 칸이 없고, 엔진에 간 편성은 투자 점수로만 고른 후보의 앞부분이다.
  assert.equal(e.element.reflected, false);
  assert.equal(Object.hasOwn(e.suggestion, 'priority'), false);
  assert.equal(e.weak_pool, null);
  const plain = generateCandidates(account, catalog);
  assert.deepEqual(e.suggestion.pool, plain.summary.pool);
  const sentE = log.filter((req) => req.enemy === undefined);
  assert.deepEqual(sentE.slice(0, e.suggestion.search.stage1.requested).map((req) => req.squad), plain.squads.slice(0, e.suggestion.search.stage1.requested).map((s) => s.members));
  assert.doesNotMatch(e.caveats.join('\n'), /우선 속성/);
  // A(약점 작열 — 묶음에 적힘), C(약점 수냉 — 약점만 적힘, 속성은 규칙으로 정함)는 약점을 우선 속성으로 받는다.
  assert.equal(a.suggestion.priority.element, '작열');
  assert.equal(c.suggestion.priority.element, '수냉');
  assert.deepEqual(c.suggestion.priority.pool, { 1: ['일수1', '일수2'], 2: ['이수1'], 3: ['삼수1', '삼수2'] });
  assert.match(report.caveats.join('\n'), /적 속성을 모르는 보스는 투자 점수로만 후보를 고른다/);
  // 약점 속성 니케가 하나도 없는 계정: 우선 속성은 넘기지만 후보는 그대로이고, 그렇게 적는다.
  const noWater = { ...account, nikkes: Object.fromEntries(Object.entries(NIKKES).filter(([n]) => elementOf(n) !== '수냉')) };
  const none = await recommendIntercept({ account: noWater, bundle: REAL, boss: '하베스터' }, { budget: 8 }, depsOf());
  assert.equal(none.bosses[0].suggestion.priority.active, false);
  assert.deepEqual(none.bosses[0].weak_pool, { element: '수냉', owned: [], pooled: [], not_pooled: [], promoted: [] });
  assert.match(none.bosses[0].notes.join('\n'), /약점 속성\(수냉\) 니케를 보유하지 않았다 — 후보는 투자 점수로만 골랐다/);
});

test('요격전 추천: 같은 입력이면 같은 결과이고 예산을 지킨다 — 우선 속성이 있어도', async () => {
  for (const budget of [7, 23, 100]) {
    const log = [];
    const first = await recommendIntercept({ account, bundle: REAL }, { budget }, depsOf(log));
    assert.ok(log.length <= budget);
    assert.equal(first.sims.used, log.length);
    for (const p of first.sims.per_boss) assert.ok(p.used <= p.budget, p.name);
    const reversed = { ...account, nikkes: Object.fromEntries(Object.entries(NIKKES).reverse()) };
    assert.deepEqual(await recommendIntercept({ account: reversed, bundle: clone(REAL) }, { budget }, depsOf()), first);
  }
});
