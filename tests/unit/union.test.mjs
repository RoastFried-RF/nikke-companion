// 레이드 5덱(P-014)의 순수 함수와 흐름: 겹치지 않는 묶음 고르기(전수 탐색과 대조), 버스트 단계 세기와 「왜 더 못 만드는가」,
// 고정 읽기, 일부 고정한 덱 채우기, 덱마다의 후보 만들기, 그리고 가짜 엔진으로 전체 흐름(겹치지 않음·미보유 금지·예산·결정론·고정·덱별 조건).
// 실제 엔진으로는 tests/integration/union.engine.test.mjs가 본다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { InputError } from '../../src/core/compare.mjs';
import { renderUnionReport } from '../../src/core/render.mjs';
import {
  allocateDecks,
  completeDeck,
  deckCapacity,
  DEFAULT_DECKS,
  DEFAULT_UNION_BUDGET,
  normalizeLocked,
  planCandidates,
  shortageOf,
  solveAllocation,
  stageCounts,
  UNION_REPORT_KIND,
  UNION_UNSUPPORTED,
} from '../../src/core/union.mjs';

// ── 지어낸 카탈로그와 계정 ─────────────────────────────────────────────────────
// 이름은 「단계-번호」다: 1단계 8명, 2단계 8명, 3단계 12명, 어느 단계에서나 쓰는 니케 1명. 번호가 작을수록 많이 키웠다.
const ELEMENTS = ['작열', '풍압', '철갑', '전격', '수냉'];
function roster(n1, n2, n3, nA = 0) {
  const names = [];
  for (const [stage, count] of [['1', n1], ['2', n2], ['3', n3], ['A', nA]]) for (let i = 1; i <= count; i += 1) names.push({ name: `${stage}-${String(i).padStart(2, '0')}`, stage, i });
  return names;
}
function world(n1, n2, n3, nA = 0) {
  const list = roster(n1, n2, n3, nA);
  const catalog = {
    nikkes: Object.fromEntries(list.map(({ name, stage, i }) => [name, { burst_stage: stage, weapon_type: 'AR', element_code: ELEMENTS[i % ELEMENTS.length] }])),
    bosses: ['솔로 레이드 S40'],
  };
  // 번호가 작을수록 스킬 레벨이 높다(투자 점수 순서 = 번호 순서).
  const account = {
    schema_version: 1,
    is_test_data: true,
    name: '검증용',
    nikkes: Object.fromEntries(list.map(({ name, i }) => [name, { skill_levels: [10, 10, Math.max(1, 11 - i)], breakthrough: 3 }])),
  };
  return { catalog, account };
}
const BIG = world(8, 8, 12, 1);
const CONDITION = { schema_version: 1, content: 'solo_raid', boss: '솔로 레이드 S40' };
const elementCondition = (code) => ({ schema_version: 1, content: 'union_raid', enemy: { code } });
const now = () => new Date('2026-11-13T00:00:00Z');

const codes = (text) => [...text].reduce((sum, ch) => sum + ch.codePointAt(0), 0);
/** 가짜 엔진: 니케의 딜 = (이름 코드 합 % 97 + 20) × (자리 + 1) × 1000, 적 속성이 니케의 약점 상대면 두 배. `failOn`이 들면 오류. */
function fakeEngine(catalog, { log = [], failOn = null } = {}) {
  const BEATS = { 전격: '수냉', 수냉: '작열', 작열: '풍압', 풍압: '철갑', 철갑: '전격' };
  return async (requests) => {
    log.push(...requests);
    return requests.map((req) => {
      if (failOn && req.squad.includes(failOn)) return { error: { type: 'invalid_input', message: `스킬 미파싱: ${failOn}`, path: '/squad' } };
      const dmg = req.squad.map((n, i) => ((codes(n) % 97) + 20) * (i + 1) * 1000 * (req.enemy?.code && BEATS[catalog.nikkes[n].element_code] === req.enemy.code ? 2 : 1));
      const total = dmg.reduce((x, y) => x + y, 0);
      return { total_damage: total, members: req.squad.map((n, i) => ({ name: n, damage: dmg[i], share: dmg[i] / total })), warnings: [], spec: { profile: { ungrown: [] } }, evaluator: { repo: 'fake', commit: 'abc', dirty: false } };
    });
  };
}
const depsOf = (w, extra = {}) => ({ catalog: w.catalog, runBatch: fakeEngine(w.catalog, extra), now });
const namesOf = (deck) => deck.members.map((m) => m.name);
const allNames = (report) => report.decks.flatMap(namesOf);
const stripped = (report) => ({ ...report, generated_at: null, cache: null });

// ── 고르기: 전수 탐색과 같다 ────────────────────────────────────────────────────

/** 무차별 전수 탐색: 후보의 모든 부분집합을 보고(묶음마다 자리 수 이하, 서로 겹치지 않음) 덱 수 → 합계 순으로 가장 좋은 값. */
function bruteForce(groups, entries) {
  let best = { count: 0, total: 0 };
  const slotsOf = new Map(groups.map((g) => [g.key, g.slots]));
  for (let mask = 0; mask < 1 << entries.length; mask += 1) {
    const used = new Set();
    const perGroup = new Map();
    let ok = true;
    let total = 0;
    let count = 0;
    for (let i = 0; i < entries.length && ok; i += 1) {
      if (!(mask & (1 << i))) continue;
      const e = entries[i];
      if (!slotsOf.has(e.group)) ok = false;
      perGroup.set(e.group, (perGroup.get(e.group) ?? 0) + 1);
      if (perGroup.get(e.group) > (slotsOf.get(e.group) ?? 0)) ok = false;
      for (const m of e.members) {
        if (used.has(m)) ok = false;
        used.add(m);
      }
      total += e.total;
      count += 1;
    }
    if (ok && (count > best.count || (count === best.count && total > best.total))) best = { count, total };
  }
  return best;
}

/** 씨앗이 정해진 난수(mulberry32) — 실행마다 같은 사례가 나온다. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCase(random, { pool, count, groups }) {
  const names = Array.from({ length: pool }, (_, i) => `n${i}`);
  const entries = Array.from({ length: count }, () => {
    const members = [];
    while (members.length < 5) {
      const pick = names[Math.floor(random() * names.length)];
      if (!members.includes(pick)) members.push(pick);
    }
    return { group: groups[Math.floor(random() * groups.length)].key, members, total: 1 + Math.floor(random() * 1000) };
  });
  return entries;
}

test('고르기: 묶음 하나(같은 조건의 덱들) — 작은 사례 200개에서 무차별 전수 탐색과 덱 수·합계가 같다', () => {
  const random = rng(20261113);
  for (let n = 0; n < 200; n += 1) {
    const slots = 1 + Math.floor(random() * 5);
    const groups = [{ key: 'free:0', slots }];
    const entries = randomCase(random, { pool: 12 + Math.floor(random() * 14), count: 4 + Math.floor(random() * 11), groups });
    const solved = solveAllocation(groups, entries);
    const brute = bruteForce(groups, entries);
    assert.deepEqual({ count: solved.count, total: solved.total }, brute, `사례 ${n}`);
    // 고른 것이 실제로 겹치지 않고, 합계가 맞고, 받은 후보 그대로다.
    const used = solved.picks.flatMap((p) => p.members);
    assert.equal(new Set(used).size, used.length, `사례 ${n}: 겹치는 니케`);
    assert.equal(solved.picks.reduce((s, p) => s + p.total, 0), solved.total);
    assert.ok(solved.picks.every((p) => entries.includes(p)));
    assert.ok(solved.picks.length <= slots);
  }
});

test('고르기: 묶음 여럿(고정한 덱 · 조건이 다른 덱들) — 작은 사례 150개에서 무차별 전수 탐색과 같다', () => {
  const random = rng(14);
  for (let n = 0; n < 150; n += 1) {
    const groups = [
      { key: 'deck:0', slots: 1 },
      { key: 'free:0', slots: 1 + Math.floor(random() * 2) },
      { key: 'free:1', slots: 1 + Math.floor(random() * 2) },
    ];
    const entries = randomCase(random, { pool: 14 + Math.floor(random() * 10), count: 6 + Math.floor(random() * 8), groups });
    const solved = solveAllocation(groups, entries);
    assert.deepEqual({ count: solved.count, total: solved.total }, bruteForce(groups, entries), `사례 ${n}`);
    for (const g of groups) assert.ok(solved.picks.filter((p) => p.group === g.key).length <= g.slots);
  }
});

test('고르기: 덱 수가 먼저다 — 큰 후보 하나보다 겹치지 않는 작은 후보 둘을 고른다. 같은 수면 합계가 큰 쪽이다', () => {
  const groups = [{ key: 'g', slots: 2 }];
  const big = { group: 'g', members: ['a', 'b', 'c', 'd', 'e'], total: 1000 };
  const left = { group: 'g', members: ['a', 'b', 'f', 'g', 'h'], total: 300 };
  const right = { group: 'g', members: ['c', 'd', 'i', 'j', 'k'], total: 300 };
  assert.deepEqual(solveAllocation(groups, [big, left, right]).picks, [left, right]);
  const other = { group: 'g', members: ['l', 'm', 'n', 'o', 'p'], total: 5 };
  // big + other(1005)가 left + right(600)보다 크다.
  assert.deepEqual(solveAllocation(groups, [big, left, right, other]).picks, [big, other]);
  // 자리가 하나면 가장 큰 것 하나.
  assert.deepEqual(solveAllocation([{ key: 'g', slots: 1 }], [left, big, right]).picks, [big]);
});

test('고르기: 후보가 없거나 자리가 없으면 빈 묶음이다. 다른 묶음의 후보는 그 자리에 들어가지 않는다', () => {
  assert.deepEqual(solveAllocation([], []), { picks: [], count: 0, total: 0, nodes: 1 });
  assert.equal(solveAllocation([{ key: 'g', slots: 3 }], []).count, 0);
  const only = { group: 'deck:1', members: ['a', 'b', 'c', 'd', 'e'], total: 9 };
  assert.equal(solveAllocation([{ key: 'deck:0', slots: 1 }], [only]).count, 0);
  assert.deepEqual(solveAllocation([{ key: 'deck:0', slots: 1 }, { key: 'deck:1', slots: 1 }], [only]).picks, [only]);
});

test('고르기: 같은 입력이면 같은 결과다(총딜이 같은 후보는 받은 순서가 앞선 쪽)', () => {
  const groups = [{ key: 'g', slots: 2 }];
  const e = (members, total) => ({ group: 'g', members, total });
  const entries = [e(['a', 'b', 'c', 'd', 'e'], 10), e(['a', 'f', 'g', 'h', 'i'], 10), e(['j', 'k', 'l', 'm', 'n'], 10), e(['o', 'p', 'q', 'r', 's'], 10)];
  const first = solveAllocation(groups, entries);
  assert.deepEqual(first.picks, [entries[0], entries[2]]);
  assert.deepEqual(solveAllocation(groups, entries), first);
});

// ── 버스트 단계와 「왜 더 못 만드는가」 ──────────────────────────────────────────

test('단계 세기와 덱 수의 상한: 덱마다 다섯 명이고 1·2·3단계가 한 명씩은 있어야 한다(어느 단계에서나 쓰는 니케는 빈 단계 하나를 채운다)', () => {
  const w = world(2, 3, 4, 1);
  assert.deepEqual(stageCounts([...Object.keys(w.account.nikkes), '모르는 니케'], w.catalog), { 1: 2, 2: 3, 3: 4, A: 1, unknown: 1 });
  assert.deepEqual(deckCapacity({ 1: 10, 2: 10, 3: 14, A: 0 }), { max: 6, by_size: 6, lacking: [] });
  // 인원은 다섯 덱어치인데 2단계가 둘뿐이다 → 두 덱, 모자란 것은 2단계.
  assert.deepEqual(deckCapacity({ 1: 10, 2: 2, 3: 13, A: 0 }), { max: 2, by_size: 5, lacking: ['2'] });
  // 어느 단계에서나 쓰는 니케가 모자란 단계를 메운다.
  assert.deepEqual(deckCapacity({ 1: 10, 2: 2, 3: 12, A: 1 }), { max: 3, by_size: 5, lacking: ['2'] });
  assert.deepEqual(deckCapacity({ 1: 1, 2: 1, 3: 2, A: 0 }), { max: 0, by_size: 0, lacking: [] });
  assert.deepEqual(deckCapacity({ 1: 0, 2: 3, 3: 3, A: 0 }), { max: 0, by_size: 1, lacking: ['1'] });
});

test('모자란 까닭: 남은 니케가 다섯이 안 되면 인원, 단계가 비면 그 단계, 둘 다 아니면 계산하지 못한 후보 때문이다', () => {
  const w = world(3, 1, 9);
  const owned = Object.keys(w.account.nikkes);
  assert.equal(shortageOf({ requested: 2, made: 2, unused: [], owned, catalog: w.catalog }), null);

  const size = shortageOf({ requested: 3, made: 2, unused: ['1-03', '3-07', '3-08'], owned, catalog: w.catalog });
  assert.equal(size.kind, 'size');
  assert.match(size.text, /덱 3개 중 2개만 만들었다 — 남은 보유 니케가 3명이라 다섯 명을 채울 수 없다/);
  // 보유 전체로도 한 덱뿐이다(2단계가 한 명) — 그 사실도 적는다.
  assert.equal(size.capacity, 1);
  assert.match(size.text, /보유 니케 전체\(1단계 3명 · 2단계 1명 · 3단계 9명\)로는 덱을 많아야 1개 만들 수 있다 — 버스트 2단계가 모자란다/);

  const stage = shortageOf({ requested: 2, made: 1, unused: ['1-02', '1-03', '3-04', '3-05', '3-06', '3-07'], owned, catalog: w.catalog });
  assert.equal(stage.kind, 'stage');
  assert.deepEqual(stage.lacking, ['2']);
  assert.deepEqual(stage.remaining, { 1: 2, 2: 0, 3: 4, A: 0, unknown: 0 });
  assert.match(stage.text, /남은 보유 니케 6명에 버스트 2단계가 모자란다\(1단계 2명 · 2단계 0명 · 3단계 4명\)/);

  const big = world(4, 4, 8);
  const search = shortageOf({ requested: 3, made: 2, unused: ['1-03', '2-03', '3-06', '3-07', '3-08'], owned: Object.keys(big.account.nikkes), catalog: big.catalog, uncomputed: 7 });
  assert.equal(search.kind, 'search');
  assert.match(search.text, /덱을 더 짤 수 있지만 계산된 후보 안에는 겹치지 않는 덱이 더 없었다\(계산하지 못한 후보 7개/);
  assert.equal(search.capacity, 3);
});

// ── 고정 ──────────────────────────────────────────────────────────────────────

test('고정 읽기: 덱 전체·일부 자리·번호 없는 항목, 그리고 잘못된 고정은 한국어 문장으로 거절한다', () => {
  assert.deepEqual(normalizeLocked(undefined, 3), [null, null, null]);
  const full = ['a', 'b', 'c', 'd', 'e'];
  const read = normalizeLocked({ decks: [{ deck: 2, members: full }, { members: [null, 'x', null, null, null] }, ['y']] }, 4);
  assert.deepEqual(read[1], { slots: full, names: full, full: true });
  // 번호가 없는 항목은 비어 있는 앞 번호부터.
  assert.deepEqual(read[0], { slots: [null, 'x', null, null, null], names: ['x'], full: false });
  assert.deepEqual(read[2], { slots: ['y', null, null, null, null], names: ['y'], full: false });
  assert.equal(read[3], null);
  // 아무도 고정하지 않은 항목은 없는 것과 같다.
  assert.deepEqual(normalizeLocked([{ deck: 1, members: [null, null, null, null, null] }], 2), [null, null]);

  const refuses = (locked, decks, pattern) => assert.throws(() => normalizeLocked(locked, decks), (e) => e instanceof InputError && pattern.test(e.message));
  refuses('덱', 2, /고정은/);
  refuses([{ deck: 1, members: ['a', 'a'] }], 2, /a을\(를\) 두 번 고정했다/);
  refuses([{ deck: 1, members: ['a'] }, { deck: 2, members: ['a'] }], 2, /두 번 고정했다/);
  refuses([{ deck: 3, members: ['a'] }], 2, /덱 번호는 1~2의 정수/);
  refuses([{ deck: 1, members: ['a'] }, { deck: 1, members: ['b'] }], 2, /덱 1을\(를\) 두 번 고정했다/);
  refuses([['a'], ['b'], ['c']], 2, /고정한 덱이 덱 수\(2\)보다 많다/);
  refuses([{ members: ['a', 'b', 'c', 'd', 'e', 'f'] }], 2, /다섯 자리/);
  refuses([{ members: [1] }], 2, /다섯 자리/);
});

test('일부 고정한 덱 채우기: 고정한 니케는 그 자리 그대로, 나머지는 버스트 1·2·3단계가 갖춰지게 많이 키운 니케로 채운다', () => {
  const w = world(3, 3, 6);
  const fixed = [null, null, '3-06', null, null];
  const rest = { ...w.account, nikkes: Object.fromEntries(Object.entries(w.account.nikkes).filter(([n]) => n !== '3-06')) };
  const made = completeDeck(fixed, rest, w.catalog, { limit: 4 });
  assert.equal(made.candidates.length, 4);
  assert.equal(made.uncovered, false);
  for (const c of made.candidates) {
    assert.equal(c.members[2], '3-06');
    assert.equal(new Set(c.members).size, 5);
    const stages = c.members.map((m) => w.catalog.nikkes[m].burst_stage);
    assert.ok(['1', '2', '3'].every((s) => stages.includes(s)), c.members.join());
  }
  // 첫 후보는 투자 점수 합이 가장 높은 조합이다(같은 합이면 먼저 만든 조합 — 풀은 많이 키운 순 · 이름순이다):
  // 번호 01 셋과 번호 02의 첫째(1-02). 빈 자리에는 1→2→3단계 순으로 놓인다.
  assert.deepEqual(made.candidates[0].members, ['1-01', '1-02', '3-06', '2-01', '3-01']);
  // 같은 입력이면 같은 후보다.
  assert.deepEqual(completeDeck(fixed, rest, w.catalog, { limit: 4 }), made);

  // 고정한 니케만으로 단계를 갖출 수 없으면(3단계 넷) 단계를 따지지 않고 채우고 그렇게 알린다.
  const four = ['3-01', '3-02', '3-03', '3-04', null];
  const noStage = completeDeck(four, { ...w.account, nikkes: Object.fromEntries(Object.entries(w.account.nikkes).filter(([n]) => !four.includes(n))) }, w.catalog);
  assert.equal(noStage.uncovered, true);
  assert.ok(noStage.candidates.length > 0);
  // 채울 니케가 없으면 후보가 없다.
  assert.deepEqual(completeDeck(fixed, { ...w.account, nikkes: {} }, w.catalog).candidates, []);
});

// ── 덱마다의 후보 ─────────────────────────────────────────────────────────────

test('후보 만들기: 덱마다 첫 후보(뼈대)끼리는 겹치지 않고, 뒤 덱의 후보에는 앞 덱 뼈대의 니케가 없다. 같은 입력이면 같은 후보다', () => {
  const slots = Array.from({ length: 5 }, () => ({ lock: null, priorityElement: null }));
  const plan = planCandidates({ account: BIG.account, catalog: BIG.catalog, slots, perTier: 20 });
  assert.equal(plan.tiers.length, 5);
  const backbones = plan.tiers.map((t) => t.candidates[0].members);
  assert.equal(new Set(backbones.flat()).size, 25);
  plan.tiers.forEach((tier, i) => {
    const earlier = new Set(backbones.slice(0, i).flat());
    assert.ok(tier.candidates.length > 0 && tier.candidates.length <= 20);
    for (const c of tier.candidates) assert.ok(!c.members.some((m) => earlier.has(m)), `덱 ${i + 1}의 후보에 앞 덱 뼈대의 니케가 있다`);
  });
  assert.deepEqual(planCandidates({ account: BIG.account, catalog: BIG.catalog, slots, perTier: 20 }), plan);
  assert.equal(plan.remaining.length, Object.keys(BIG.account.nikkes).length - 25);
});

test('후보 만들기: 드문 단계의 니케를 앞 덱이 다 쓰지 않는다 — 3단계가 일곱뿐이어도 세 덱이 모두 3단계를 갖는다', () => {
  // 1단계 6 · 2단계 6 · 3단계 5: 줄이지 않으면 첫 덱이 3단계 셋(1-1-3)을, 둘째 덱이 둘을 써서 셋째 덱에 3단계가 없다.
  const w = world(6, 6, 5);
  const slots = Array.from({ length: 3 }, () => ({ lock: null, priorityElement: null }));
  const plan = planCandidates({ account: w.account, catalog: w.catalog, slots, perTier: 5 });
  assert.deepEqual(plan.tiers.map((t) => t.reason), [null, null, null]);
  for (const tier of plan.tiers) assert.ok(tier.candidates[0].members.some((m) => w.catalog.nikkes[m].burst_stage === '3'));
  assert.deepEqual(plan.tiers[0].caps, { 1: 3, 2: 3, 3: 3 });
  assert.deepEqual(plan.tiers[0].held, ['3']);
});

test('후보 만들기: 더 만들 수 없는 덱에는 까닭이 남는다(어느 버스트 단계가 없는지)', () => {
  const w = world(3, 1, 9);
  const slots = Array.from({ length: 2 }, () => ({ lock: null, priorityElement: null }));
  const plan = planCandidates({ account: w.account, catalog: w.catalog, slots, perTier: 5 });
  assert.equal(plan.tiers[0].reason, null);
  assert.equal(plan.tiers[1].candidates.length, 0);
  assert.match(plan.tiers[1].reason, /버스트 2단계 니케를 보유하지 않았다/);
});

// ── 전체 흐름(가짜 엔진) ───────────────────────────────────────────────────────

test('5덱: 어떤 니케도 두 덱에 들어가지 않고 보유한 니케만 쓴다. 덱별 멤버·총딜·멤버별 딜, 합계, 쓰지 않은 니케, 가정, 엔진 버전이 결과에 있다', async () => {
  const log = [];
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 40 }, depsOf(BIG, { log }));
  assert.equal(report.kind, UNION_REPORT_KIND);
  assert.equal(report.schema_version, 1);
  assert.equal(report.requested, DEFAULT_DECKS);
  assert.equal(report.made, 5);
  assert.equal(report.mode, 'single');
  assert.equal(report.shortage, null);
  assert.equal(report.decks.length, 5);
  const names = allNames(report);
  assert.equal(names.length, 25);
  assert.equal(new Set(names).size, 25, '겹치는 니케가 있다');
  assert.ok(names.every((n) => Object.hasOwn(BIG.account.nikkes, n)));
  for (const d of report.decks) {
    assert.equal(d.status, 'computed');
    assert.equal(d.lock, 'none');
    assert.equal(d.members.length, 5);
    assert.ok(d.total_damage > 0);
    assert.equal(d.members.reduce((s, m) => s + m.damage, 0), d.total_damage);
    assert.ok(Math.abs(d.members.reduce((s, m) => s + m.share, 0) - 1) < 1e-9);
  }
  assert.equal(report.total_damage, report.decks.reduce((s, d) => s + d.total_damage, 0));
  // 조건이 같은 덱은 총딜이 큰 순으로 놓인다.
  const totals = report.decks.map((d) => d.total_damage);
  assert.deepEqual(totals, [...totals].sort((x, y) => y - x));
  // 쓰지 않은 보유 니케 = 보유 − 덱에 든 니케.
  assert.deepEqual([...report.unused].sort(), Object.keys(BIG.account.nikkes).filter((n) => !names.includes(n)).sort());
  assert.equal(report.unused.length, 29 - 25);
  assert.deepEqual(report.engine, { repo: 'fake', commit: 'abc', dirty: false });
  assert.equal(report.cache, null);
  assert.ok(report.assumptions.some((line) => line.includes('보스 프리셋: 솔로 레이드 S40')));
  assert.deepEqual(report.conditions.map((c) => c.decks), [[1, 2, 3, 4, 5]]);
  assert.equal(report.account.is_test_data, true);
  assert.equal(report.generated_at, '2026-11-13T00:00:00.000Z');
  // 엔진에 넘어간 편성은 모두 보유 니케 다섯 명이다.
  assert.ok(log.every((req) => req.squad.length === 5 && req.squad.every((n) => Object.hasOwn(BIG.account.nikkes, n))));
});

test('5덱: 시뮬 예산을 넘지 않는다(여러 예산에서) — 쓴 건수가 결과에 적히고 엔진 요청 수와 같다', async () => {
  for (const budget of [1, 3, 5, 6, 12, 25, 60, 200]) {
    const log = [];
    const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget }, depsOf(BIG, { log }));
    assert.ok(log.length <= budget, `예산 ${budget}: 요청 ${log.length}건`);
    assert.equal(report.search.sims, log.length);
    assert.equal(report.search.budget, budget);
    assert.equal(report.search.stage1.requested + (report.search.stage2?.requested ?? 0), log.length);
    const names = allNames(report);
    assert.equal(new Set(names).size, names.length);
    // 덱마다의 뼈대가 먼저 계산되므로 예산이 덱 수 이상이면 다섯 덱이 다 나온다.
    assert.equal(report.made, Math.min(5, budget - (report.search.stage2?.requested ?? 0) >= 5 ? 5 : report.made));
    if (budget >= 8) assert.equal(report.made, 5);
    if (budget < 5) assert.ok(report.made <= budget);
  }
});

test('5덱: 예산이 모자라 못 만든 덱은 빈 덱이고 까닭이 적힌다 — 남은 니케로 더 짤 수 있었다는 것도', async () => {
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 2, refine: false }, depsOf(BIG));
  assert.equal(report.made, 2);
  assert.deepEqual(report.decks.map((d) => d.status), ['computed', 'computed', 'empty', 'empty', 'empty']);
  assert.equal(report.decks[2].total_damage, null);
  assert.ok(report.decks[2].reason);
  assert.equal(report.shortage.kind, 'search');
  assert.match(report.shortage.text, /덱 5개 중 2개만 만들었다/);
  assert.ok(report.caveats.includes(report.shortage.text));
  assert.ok(report.caveats.some((c) => /예산이 모자라 만든 후보 계산 \d+건 중 \d+건/.test(c)));
});

test('5덱: 같은 입력이면 같은 결과다(계정의 니케 나열 순서가 달라도)', async () => {
  const first = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 30 }, depsOf(BIG));
  const second = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 30 }, depsOf(BIG));
  assert.deepEqual(stripped(second), stripped(first));
  const shuffled = { ...BIG.account, nikkes: Object.fromEntries(Object.entries(BIG.account.nikkes).reverse()) };
  const third = await allocateDecks({ account: shuffled, condition: CONDITION }, { budget: 30 }, depsOf(BIG));
  assert.deepEqual(third.decks, first.decks);
  assert.equal(third.total_damage, first.total_damage);
  // 받은 계정은 바뀌지 않는다.
  assert.deepEqual(Object.keys(BIG.account.nikkes).length, 29);
});

test('5덱: 계산한 후보 안에서 고른 묶음이 무차별 전수 탐색의 가장 좋은 합계와 같다(자리 순서를 바꾸지 않을 때)', async () => {
  const w = world(4, 4, 8);
  const log = [];
  const report = await allocateDecks({ account: w.account, condition: CONDITION }, { decks: 3, budget: 16, refine: false }, depsOf(w, { log }));
  assert.equal(log.length, 16);
  const engine = fakeEngine(w.catalog);
  const rows = await engine(log);
  const entries = log.map((req, i) => ({ group: 'free:0', members: req.squad, total: rows[i].total_damage }));
  const brute = bruteForce([{ key: 'free:0', slots: 3 }], entries);
  assert.equal(report.made, brute.count);
  assert.equal(report.total_damage, brute.total);
});

test('5덱: 후보를 어떻게 줄였는지와 지원하지 않는 것이 주의 문장에 적힌다', async () => {
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 20 }, depsOf(BIG));
  const text = report.caveats.join('\n');
  assert.match(text, /후보 덱은 덱 순서대로 만들었다/);
  assert.match(text, /버스트 단계별 투자 점수 상위\(1단계 3 · 2단계 3 · 3단계 5명\)/);
  assert.match(text, /투자 점수는 .*성능 추정이 아니다/);
  assert.match(text, /시뮬 예산 20건 중 \d+건을 썼다/);
  assert.match(text, /전체에서 가장 좋은 배분이라는 뜻이 아니다/);
  assert.match(text, /실제 레이드 기록과 대조하지 않았다/);
  assert.match(text, /지원하지 않음: 보스 패턴/);
  assert.match(text, /자리 순서/);
  assert.deepEqual(report.unsupported, [...UNION_UNSUPPORTED]);
  assert.ok(report.search.stage1.tiers.length === 5 && report.search.stage1.tiers.every((t) => t.kind === 'free'));
  assert.ok(report.search.examined > 0);
});

test('5덱: 자리 순서(2단계)는 덱의 니케를 바꾸지 않고 총딜을 낮추지 않는다. 끄면 후보 계산만 한다', async () => {
  const plain = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 15, refine: false }, depsOf(BIG));
  assert.equal(plain.search.stage2, null);
  assert.equal(plain.search.stage1.requested, 15);
  assert.ok(plain.decks.every((d) => d.placement === null));
  assert.ok(plain.caveats.some((c) => c.startsWith('자리 순서는 바꿔 보지 않았다')));

  const refined = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 40 }, depsOf(BIG));
  assert.ok(refined.search.stage2.requested > 0);
  assert.equal(refined.search.sims, refined.search.stage1.requested + refined.search.stage2.requested);
  for (const d of refined.decks) {
    assert.ok(d.placement, '고정하지 않은 덱에는 자리 순서 기록이 있다');
    assert.deepEqual([...namesOf(d)].sort(), [...d.placement.original_members].sort());
    assert.ok(d.total_damage >= d.placement.original_total_damage);
  }
  // 가짜 엔진은 뒤 자리일수록 딜이 커서 자리를 바꾸면 총딜이 달라진다 — 바꾼 덱이 하나는 있다.
  assert.ok(refined.search.stage2.improved >= 1);
  assert.equal(refined.decks.filter((d) => d.placement.changed).length, refined.search.stage2.improved);
});

test('5덱: 요청한 수만큼 만들 수 없으면 만든 만큼만 돌려주고 어느 버스트 단계가 모자라는지 적는다', async () => {
  // 2단계가 둘뿐이다: 다섯 덱을 청해도 두 덱이다.
  const w = world(6, 2, 12);
  const report = await allocateDecks({ account: w.account, condition: CONDITION }, { budget: 30 }, depsOf(w));
  assert.equal(report.requested, 5);
  assert.equal(report.made, 2);
  assert.deepEqual(report.decks.map((d) => d.status), ['computed', 'computed', 'empty', 'empty', 'empty']);
  assert.equal(report.shortage.kind, 'stage');
  assert.deepEqual(report.shortage.lacking, ['2']);
  assert.equal(report.shortage.capacity, 2);
  assert.match(report.shortage.text, /버스트 2단계가 모자란다/);
  assert.match(report.decks[2].reason, /버스트 2단계 니케를 보유하지 않았다/);
  assert.equal(report.unused.length, 20 - 10);

  // 한 덱도 만들 수 없어도 던지지 않는다 — 빈 결과와 까닭.
  const none = world(0, 3, 6);
  const empty = await allocateDecks({ account: none.account, condition: CONDITION }, { decks: 2, budget: 10 }, depsOf(none));
  assert.equal(empty.made, 0);
  assert.equal(empty.total_damage, 0);
  assert.deepEqual(empty.shortage.lacking, ['1']);
  assert.equal(empty.search.sims, 0);
  assert.deepEqual(empty.engine, { repo: 'Jgaram/nikke-calc', commit: null });
});

test('고정: 전체를 고정한 덱은 받은 자리 순서 그대로 계산되고, 그 니케는 다른 덱에 들어가지 않는다', async () => {
  const fixed = ['3-01', '1-01', '2-01', '3-02', '3-03'];
  const log = [];
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 30, locked: { decks: [{ deck: 2, members: fixed }] } }, depsOf(BIG, { log }));
  assert.equal(report.made, 5);
  const deck2 = report.decks[1];
  assert.equal(deck2.lock, 'full');
  assert.deepEqual(deck2.locked, fixed);
  assert.deepEqual(namesOf(deck2), fixed);
  assert.equal(deck2.placement, null);
  const names = allNames(report);
  assert.equal(new Set(names).size, 25);
  for (const d of report.decks.filter((x) => x.deck !== 2)) assert.ok(!namesOf(d).some((n) => fixed.includes(n)));
  // 고정한 덱이 맨 먼저 계산된다.
  assert.deepEqual(log[0].squad, fixed);
  assert.ok(report.caveats.some((c) => c.startsWith('고정한 덱 1개(덱 2)')));
  assert.ok(!report.unused.some((n) => fixed.includes(n)));
});

test('고정: 일부 자리만 고정하면 그 니케가 그 덱의 그 자리에 있고 나머지 자리를 찾는다', async () => {
  const locked = [{ deck: 1, members: [null, null, '3-09', null, '2-07'] }];
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 40, locked }, depsOf(BIG));
  assert.equal(report.made, 5);
  const deck1 = report.decks[0];
  assert.equal(deck1.lock, 'partial');
  assert.equal(namesOf(deck1)[2], '3-09');
  assert.equal(namesOf(deck1)[4], '2-07');
  assert.equal(new Set(allNames(report)).size, 25);
  for (const d of report.decks.slice(1)) assert.ok(!namesOf(d).includes('3-09') && !namesOf(d).includes('2-07'));
  assert.equal(report.search.stage1.tiers[0].kind, 'partial');
});

test('고정: 다섯 덱을 모두 고정하면 그 다섯만 계산한다. 보유하지 않은 니케는 고정할 수 없다', async () => {
  const first = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 20, refine: false }, depsOf(BIG));
  const locked = first.decks.map((d) => ({ deck: d.deck, members: namesOf(d) }));
  const log = [];
  const again = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 20, locked }, depsOf(BIG, { log }));
  assert.equal(log.length, 5);
  assert.deepEqual(again.decks.map(namesOf), first.decks.map(namesOf));
  assert.equal(again.total_damage, first.total_damage);
  assert.ok(again.decks.every((d) => d.lock === 'full'));

  await assert.rejects(
    allocateDecks({ account: BIG.account, condition: CONDITION }, { locked: [['1-01', '2-01', '3-01', '3-02', '없는 니케']] }, depsOf(BIG)),
    (e) => e instanceof InputError && /보유하지 않은 니케를 고정했다: 없는 니케/.test(e.message),
  );
});

test('고정: 계산하지 못한 고정 덱은 0이 아니라 「계산하지 못함」이고 까닭이 남는다 — 그 니케는 다른 덱에도 쓰이지 않는다', async () => {
  const fixed = ['1-01', '2-01', '3-01', '3-02', '3-03'];
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { decks: 3, budget: 20, locked: [fixed] }, depsOf(BIG, { failOn: '3-02' }));
  assert.equal(report.decks[0].status, 'failed');
  assert.equal(report.decks[0].total_damage, null);
  assert.match(report.decks[0].reason, /스킬 미파싱: 3-02/);
  assert.equal(report.made, 2);
  assert.ok(!allNames(report).some((n) => fixed.includes(n)));
  assert.ok(!report.unused.some((n) => fixed.includes(n)));
  assert.equal(report.failed[0].name, '고정한 덱 1');
});

test('덱별 조건: 덱마다 다른 조건을 받아 조건마다 따로 계산한다 — 조건이 같은 덱끼리만 자리를 바꾼다', async () => {
  const conditions = [elementCondition('풍압'), elementCondition('수냉'), elementCondition('풍압')];
  const log = [];
  const report = await allocateDecks({ account: BIG.account, conditions }, { decks: 3, budget: 30, refine: false }, depsOf(BIG, { log }));
  assert.equal(report.mode, 'per_deck');
  assert.equal(report.made, 3);
  assert.deepEqual(report.conditions.map((c) => [c.index, c.decks, c.condition.enemy.code]), [[0, [1, 3], '풍압'], [1, [2], '수냉']]);
  assert.deepEqual(report.decks.map((d) => d.condition_index), [0, 1, 0]);
  assert.equal(new Set(allNames(report)).size, 15);
  // 덱의 총딜은 그 덱의 조건으로 계산한 값이다(가짜 엔진으로 다시 계산해 견준다).
  const engine = fakeEngine(BIG.catalog);
  for (const d of report.decks) {
    const [row] = await engine([{ squad: namesOf(d), enemy: report.conditions[d.condition_index].condition.enemy }]);
    assert.equal(d.total_damage, row.total_damage, `덱 ${d.deck}`);
  }
  assert.ok(log.length <= 30);
  assert.ok(log.some((r) => r.enemy.code === '풍압') && log.some((r) => r.enemy.code === '수냉'));
  assert.ok(report.caveats.some((c) => c.startsWith('덱마다 조건이 다르다(서로 다른 조건 2종)')));
  // 조건이 같은 덱 1·3은 총딜이 큰 순이다.
  assert.ok(report.decks[0].total_damage >= report.decks[2].total_damage);
  // 조건 배열로 준 `condition`도 같다.
  const same = await allocateDecks({ account: BIG.account, condition: conditions }, { decks: 3, budget: 30, refine: false }, depsOf(BIG));
  assert.deepEqual(same.decks, report.decks);

  await assert.rejects(
    allocateDecks({ account: BIG.account, conditions: conditions.slice(0, 2) }, { decks: 3 }, depsOf(BIG)),
    (e) => e instanceof InputError && /덱별 조건은 덱 수\(3\)만큼/.test(e.message),
  );
});

test('「안 씀」: 뺀 니케는 어느 덱에도 없고 쓰지 않은 니케에도 없다 — 뺐다는 사실이 결과에 남는다. 고정한 니케는 빼지 않는다', async () => {
  const exclude = ['1-01', '3-01', '계정에 없는 니케'];
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 20, exclude }, depsOf(BIG));
  assert.ok(!allNames(report).includes('1-01') && !allNames(report).includes('3-01'));
  assert.ok(!report.unused.includes('1-01'));
  assert.deepEqual(report.excluded.names, ['1-01', '3-01']);
  assert.ok(report.caveats.includes(report.excluded.text));
  const plain = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 20 }, depsOf(BIG));
  assert.ok(!('excluded' in plain));

  const fixed = ['1-01', '2-01', '3-01', '3-02', '3-03'];
  const pinned = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 20, exclude: ['1-01', '1-02'], locked: [fixed] }, depsOf(BIG));
  assert.deepEqual(namesOf(pinned.decks[0]), fixed);
  assert.deepEqual(pinned.excluded.names, ['1-02']);
});

test('잘못된 입력은 한국어 문장의 입력 오류다', async () => {
  const refuses = (input, options, pattern) => assert.rejects(allocateDecks(input, options, depsOf(BIG)), (e) => e instanceof InputError && pattern.test(e.message));
  await refuses({ account: BIG.account, condition: CONDITION }, { decks: 0 }, /덱 수는 1~10/);
  await refuses({ account: BIG.account, condition: CONDITION }, { decks: 11 }, /덱 수는 1~10/);
  await refuses({ account: BIG.account, condition: CONDITION }, { budget: 0 }, /budget은 1 이상의 정수/);
  await refuses({ account: BIG.account, condition: CONDITION }, { refine: 'yes' }, /refine은 true 또는 false/);
  await refuses({ account: BIG.account, condition: CONDITION }, { exclude: '1-01' }, /exclude는 니케 이름의 목록/);
  await refuses({ account: BIG.account }, {}, /전투 조건이 없다/);
  await refuses({ account: BIG.account, condition: { ...CONDITION, boss: '없는 보스' } }, {}, /엔진에 없는 보스 프리셋/);
  await refuses({ account: { ...BIG.account, schema_version: 9 }, condition: CONDITION }, {}, /계정 상태가 잘못됐다/);
  assert.equal(DEFAULT_UNION_BUDGET, 100);
});

test('표(CLI): 덱별 멤버·총딜·합계, 쓰지 않은 니케, 모자란 까닭, 고정·빈 덱, 주의가 글로 나온다', async () => {
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 20 }, depsOf(BIG));
  const text = renderUnionReport(report);
  assert.match(text, /계정: 검증용 {2}\[검증용 데이터\]/);
  assert.match(text, /탐색: 시뮬 \d+건 \/ 예산 20건 \(후보 계산 \d+건 \+ 자리 순서 \d+건\)/);
  assert.match(text, /덱 5개 중 5개 · 합계 /);
  for (const d of report.decks) {
    assert.ok(text.includes(`덱 ${d.deck}  총딜 `), `덱 ${d.deck}`);
    for (const m of d.members) assert.ok(text.includes(m.name));
  }
  assert.ok(text.includes(`쓰지 않은 보유 니케 ${report.unused.length}명: ${report.unused.join(', ')}`));
  for (const c of report.caveats) assert.ok(text.includes(`  - ${c}`));

  // 다 만들지 못한 결과: 까닭이 합계 바로 아래에, 빈 덱과 고정한 덱이 그렇게 적힌다.
  const w = world(6, 2, 12);
  const fixed = ['1-01', '2-01', '3-01', '3-02', '3-03'];
  const short = renderUnionReport(await allocateDecks({ account: w.account, condition: CONDITION }, { budget: 12, locked: [fixed] }, depsOf(w)));
  assert.match(short, /덱 5개 중 2개 · 합계 /);
  assert.match(short, /!! 덱 5개 중 2개만 만들었다 — .*버스트 2단계가 모자란다/);
  assert.match(short, /덱 1 {2}\[고정\] {2}총딜 /);
  assert.match(short, /덱 3 {2}빈 덱 — /);

  // 덱별 조건이면 덱마다 어느 조건인지와 조건 목록이 나온다.
  const each = renderUnionReport(await allocateDecks({ account: BIG.account, conditions: [elementCondition('풍압'), elementCondition('수냉')] }, { decks: 2, budget: 8 }, depsOf(BIG)));
  assert.match(each, /덱 2 {2}\(조건 2\) {2}총딜 /);
  assert.match(each, /조건 2 \(덱 2\): 적 속성 수냉/);
});

test('진행 알림: 엔진 배치를 맡기기 직전에 단계와 그때까지 쓴 건수를 알린다', async () => {
  const stages = [];
  const report = await allocateDecks({ account: BIG.account, condition: CONDITION }, { budget: 24 }, { ...depsOf(BIG), onStage: (s) => stages.push(s) });
  assert.deepEqual(stages.map((s) => s.stage), [1, 2]);
  assert.deepEqual(stages[0], { stage: 1, stages: 2, requests: report.search.stage1.requested, used: 0, budget: 24 });
  assert.equal(stages[1].used, report.search.stage1.requested);
  assert.equal(stages[1].requests, report.search.stage2.requested);
});
