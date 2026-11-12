import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateCandidates, suggestSquads, investmentScore, coversAllBurstStages,
  DEFAULT_LIMIT, INVEST_SCORE_MAX,
} from '../../src/core/candidates.mjs';
import { InputError } from '../../src/core/compare.mjs';

// 가짜 카탈로그: 이름 앞 글자가 버스트 단계다. '전'은 어느 단계에서나 쓰는 니케(A).
const names = ['일1', '일2', '일3', '일4', '이1', '이2', '이3', '이4', '이5', '삼1', '삼2', '삼3', '삼4', '삼5', '삼6', '삼7', '삼8', '전1'];
const stageOf = (n) => ({ 일: '1', 이: '2', 삼: '3', 전: 'A' })[n[0]];
const catalog = { nikkes: Object.fromEntries(names.map((n) => [n, { burst_stage: stageOf(n) }])), bosses: ['보스'] };
const condition = { schema_version: 1, content: 'solo_raid', boss: '보스' };

const grown = (skill, extra = {}) => ({ skill_levels: [skill, skill, skill], ...extra });
const accountOf = (nikkes) => ({ schema_version: 1, is_test_data: true, nikkes });
// 보유 16명(전1·삼8은 미보유). 육성 정도를 일부러 섞었다.
const big = accountOf({
  일1: grown(10, { breakthrough: 3, core_enhancement: 7 }), 일2: grown(7), 일3: grown(4), 일4: {},
  이1: grown(10, { breakthrough: 3 }), 이2: grown(9), 이3: grown(5), 이4: grown(2), 이5: {},
  삼1: grown(10, { breakthrough: 3, core_enhancement: 7, overload: { 공격력: 4 } }), 삼2: grown(10), 삼3: grown(8),
  삼4: grown(6), 삼5: grown(4), 삼6: grown(3, { unknown: ['overload'] }), 삼7: {},
});

// 생성기와 따로 세는 검사 — 생성기의 판정 함수를 믿지 않는다.
function assertValidSquad(squad, account, cat) {
  assert.equal(squad.members.length, 5, squad.name);
  assert.equal(new Set(squad.members).size, 5, `${squad.name}: 중복`);
  for (const m of squad.members) assert.ok(Object.hasOwn(account.nikkes, m), `${squad.name}: 미보유 ${m}`);
  const stages = squad.members.map((m) => cat.nikkes[m].burst_stage);
  const missing = ['1', '2', '3'].filter((s) => !stages.includes(s)).length;
  assert.ok(missing <= stages.filter((s) => s === 'A').length, `${squad.name}: 버스트 단계가 빈다 (${stages.join('')})`);
}

test('모든 후보는 보유 니케 5명, 중복 없음, 버스트 1·2·3단계 포함', () => {
  const { squads } = generateCandidates(big, catalog);
  assert.ok(squads.length > 0);
  for (const s of squads) {
    assertValidSquad(s, big, catalog);
    assert.deepEqual([...new Set(s.members.map(stageOf))].sort(), ['1', '2', '3'], '전 단계 니케가 없으면 세 단계가 실제로 다 있어야 한다');
  }
  // 같은 5명이 순서만 바뀌어 두 번 나오지 않는다.
  const keys = squads.map((s) => [...s.members].sort().join('|'));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(squads.map((s) => s.name), squads.map((_, i) => `후보 ${i + 1}`));
});

test('같은 입력이면 같은 후보가 같은 순서로 나온다 — 계정의 니케 나열 순서와도 무관하다', () => {
  const first = generateCandidates(big, catalog);
  assert.deepEqual(generateCandidates(big, catalog), first);
  assert.deepEqual(generateCandidates(structuredClone(big), catalog), first);
  const reversed = accountOf(Object.fromEntries(Object.entries(big.nikkes).reverse()));
  assert.deepEqual(generateCandidates(reversed, catalog), first);
  // 입력 문서를 바꾸지 않는다.
  const before = JSON.stringify(big);
  generateCandidates(big, catalog);
  assert.equal(JSON.stringify(big), before);
});

test('limit을 넘지 않고(기본 30), 줄인 기준이 caveats에 적힌다', () => {
  const def = generateCandidates(big, catalog);
  assert.equal(DEFAULT_LIMIT, 30);
  assert.equal(def.squads.length, 30);
  assert.equal(def.summary.truncated, true);
  assert.ok(def.summary.considered > 30);

  for (const limit of [1, 4, 7]) {
    const r = generateCandidates(big, catalog, { limit });
    assert.equal(r.squads.length, limit);
    // 더 작은 limit의 결과는 기본 결과의 앞부분이다 — 잘라낸 것이지 다시 고른 것이 아니다.
    assert.deepEqual(r.squads, def.squads.slice(0, limit));
    const text = r.caveats.join('\n');
    assert.match(text, /전수 탐색이 아니다/);
    assert.match(text, /투자 점수/);
    assert.match(text, /버스트 1·2·3단계를 모두 갖춘 5인만/);
    assert.match(text, /1-1-3, 1-2-2, 2-1-2/);
    assert.match(text, new RegExp(`조합 ${r.summary.considered}개 중 투자 점수 합이 높은 ${limit}개만 후보로 남겼다 \\(limit ${limit}\\)`));
  }
});

test('limit보다 조합이 적으면 전부 쓰고 그렇게 적는다', () => {
  const small = accountOf({ 일1: {}, 이1: {}, 삼1: {}, 삼2: {}, 삼3: {}, 삼4: {} });
  const r = generateCandidates(small, catalog);
  assert.equal(r.squads.length, 4); // 일1·이1 + 삼 4명 중 3명
  assert.equal(r.summary.truncated, false);
  assert.match(r.caveats.join('\n'), /조합 4개를 모두 후보로 썼다 \(limit 30\)/);
  for (const s of r.squads) assertValidSquad(s, small, catalog);
});

test('투자 점수가 높은 니케가 먼저 쓰이고, 풀에서 빠진 니케는 이름이 적힌다', () => {
  const r = generateCandidates(big, catalog);
  assert.deepEqual(r.summary.pool, { 1: ['일1', '일2', '일3'], 2: ['이1', '이2', '이3'], 3: ['삼1', '삼2', '삼3', '삼4', '삼5'] });
  assert.deepEqual(r.summary.excluded, ['삼6', '이4', '삼7', '이5', '일4']);
  // 투자 점수 합이 가장 높은 5명: 이2(스킬 9)가 삼3(스킬 8)보다 높아 1-2-2 구성이 맨 앞에 온다.
  assert.deepEqual(r.squads[0].members, ['일1', '이1', '이2', '삼1', '삼2']);
  assert.deepEqual(r.squads[1].members, ['일1', '이1', '삼1', '삼2', '삼3']);
  const used = new Set(r.squads.flatMap((s) => s.members));
  for (const n of r.summary.excluded) assert.ok(!used.has(n), n);
  const text = r.caveats.join('\n');
  assert.match(text, /1단계 3\/4명, 2단계 3\/5명, 3단계 5\/7명/);
  assert.match(text, /후보 풀에 들지 못한 보유 니케: 삼6, 이4, 삼7, 이5, 일4\./);
  assert.match(text, /미확인 칸은 투자 점수에서 미육성으로 셌다: 삼6\./);
});

test('배치는 1→2→3단계 순이고 같은 단계 안에서는 투자 점수 순이다', () => {
  const order = Object.fromEntries(['일1', '일2', '일3', '이1', '이2', '이3', '삼1', '삼2', '삼3', '삼4', '삼5'].map((n, i) => [n, i]));
  for (const s of generateCandidates(big, catalog).squads) {
    const idx = s.members.map((m) => order[m]);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), s.members.join(','));
  }
});

test('투자 점수: 미육성 0, 완전 육성 최대, 칸마다 같은 비중', () => {
  assert.equal(investmentScore({}), 0);
  assert.equal(investmentScore(undefined), 0);
  assert.equal(investmentScore({ skill_levels: [1, 1, 1], breakthrough: 0, core_enhancement: 0, unknown: ['overload'] }), 0);
  const quarter = INVEST_SCORE_MAX / 4;
  assert.equal(investmentScore({ skill_levels: [10, 10, 10] }), quarter);
  assert.equal(investmentScore({ breakthrough: 3 }), quarter);
  assert.equal(investmentScore({ core_enhancement: 7 }), quarter);
  assert.equal(investmentScore({ overload: { 공격력: 4, '우월 코드 대미지': 4, '최대 장탄 수': 4 } }), quarter);
  assert.equal(investmentScore({ overload: { 공격력: [10, 10, 15], '차지 속도': 0 } }), (quarter / 12) * 3);
  assert.equal(investmentScore({ skill_levels: [10, 10, 10], breakthrough: 3, core_enhancement: 7, overload: { 공격력: 99 } }), INVEST_SCORE_MAX);
});

test('전 단계(A) 니케는 비어 있는 단계 하나를 채우고, 한 편성에 두 번 들어가지 않는다', () => {
  // 1단계 니케가 없다 — 전1이 1단계 자리를 채워야만 편성이 된다.
  const acct = accountOf({ 전1: grown(10), 이1: {}, 이2: {}, 삼1: {}, 삼2: {}, 삼3: {} });
  const r = generateCandidates(acct, catalog);
  assert.ok(r.squads.length > 0);
  for (const s of r.squads) {
    assertValidSquad(s, acct, catalog);
    assert.equal(s.members[0], '전1');
  }
  assert.match(r.caveats.join('\n'), /어느 단계에서나 버스트를 쓰는 니케/);

  assert.equal(coversAllBurstStages(['전1', '이1', '삼1', '삼2', '삼3'], catalog), true);
  assert.equal(coversAllBurstStages(['전1', '삼1', '삼2', '삼3', '삼4'], catalog), false, 'A 한 명이 두 단계를 채우지는 못한다');
  assert.equal(coversAllBurstStages(['일1', '이1', '이2', '이3', '이4'], catalog), false);
});

test('단계가 비면 후보를 만들지 않고 이유를 적는다', () => {
  const noB1 = accountOf({ 이1: {}, 이2: {}, 삼1: {}, 삼2: {}, 삼3: {}, 삼4: {} });
  const r = generateCandidates(noB1, catalog);
  assert.deepEqual(r.squads, []);
  assert.match(r.caveats.join('\n'), /후보 편성을 만들 수 없다: 버스트 1단계 니케를 보유하지 않았다/);

  const tooFew = accountOf({ 일1: {}, 이1: {}, 삼1: {}, 삼2: {} });
  const few = generateCandidates(tooFew, catalog);
  assert.deepEqual(few.squads, []);
  assert.match(few.caveats.join('\n'), /보유 니케가 모자란다 \(쓸 수 있는 보유 니케 4명\)/);
});

test('흔한 단계 구성으로 못 만들 때만 드문 구성을 쓰고 그렇게 적는다', () => {
  const lopsided = accountOf({ 일1: {}, 일2: {}, 일3: {}, 이1: {}, 삼1: {} });
  const r = generateCandidates(lopsided, catalog);
  assert.deepEqual(r.squads.map((s) => s.members), [['일1', '일2', '일3', '이1', '삼1']]);
  assert.deepEqual(r.summary.shapes, ['2-2-1', '1-3-1', '3-1-1']);
  assert.match(r.caveats.join('\n'), /드문 구성\(2-2-1, 1-3-1, 3-1-1\)을 썼다/);
  // 흔한 구성으로 만들 수 있으면 드문 구성은 섞이지 않는다.
  for (const s of generateCandidates(big, catalog).squads) {
    const count = (st) => s.members.filter((m) => stageOf(m) === st).length;
    assert.ok(['1-1-3', '1-2-2', '2-1-2'].includes(`${count('1')}-${count('2')}-${count('3')}`), s.members.join(','));
  }
});

test('엔진이 모르는 이름은 후보에 넣지 않고 알린다', () => {
  const acct = accountOf({ ...big.nikkes, '없는 니케': grown(10, { breakthrough: 3, core_enhancement: 7 }) });
  const r = generateCandidates(acct, catalog);
  assert.ok(r.squads.every((s) => !s.members.includes('없는 니케')));
  assert.match(r.caveats.join('\n'), /엔진이 모르는 이름은 후보에서 뺐다: 없는 니케\./);
  assert.deepEqual(r.squads, generateCandidates(big, catalog).squads);
});

test('잘못된 limit은 InputError다', () => {
  for (const limit of [0, -1, 2.5, '3', NaN]) assert.throws(() => generateCandidates(big, catalog, { limit }), InputError, String(limit));
  assert.throws(() => generateCandidates(big, catalog, { stageCaps: { 3: 0 } }), InputError);
});

// 가짜 엔진: 요청 순서가 뒤일수록 총딜이 높다 — 투자 점수 순위와 엔진 순위가 다를 때를 본다.
function fakeEngine(log = []) {
  return async (requests) => {
    log.push(...requests);
    return requests.map((req, i) => ({
      total_damage: (i + 1) * 1000,
      members: req.squad.map((n) => ({ name: n, damage: (i + 1) * 200, share: 0.2 })),
      warnings: [],
      spec: { profile: { ungrown: [] } },
      evaluator: { repo: 'fake', commit: 'abc', dirty: false },
    }));
  };
}
const now = () => new Date('2026-11-12T00:00:00Z');

// 1단계(멤버 조합)만 본다 — 배치 탐색(2단계)을 끈다. 2단계는 search.test.mjs가 확인한다.
test('suggest: 후보를 엔진으로 비교해 총딜 상위 top개만 남기고, 생성 기준을 결과에 싣는다', async () => {
  const log = [];
  const report = await suggestSquads({ account: big, condition }, { limit: 8, top: 3, refine: false }, { catalog, runBatch: fakeEngine(log), now });
  assert.equal(log.length, 8, '후보 수만큼만 엔진을 부른다');
  for (const req of log) for (const m of req.squad) assert.ok(Object.hasOwn(big.nikkes, m), m);
  assert.deepEqual(report.ranking.map((r) => [r.rank, r.name, r.total_damage]), [[1, '후보 8', 8000], [2, '후보 7', 7000], [3, '후보 6', 6000]]);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.failed.length, 0);
  assert.deepEqual(
    { generated: report.suggestion.generated, simulated: report.suggestion.simulated, top: report.suggestion.top, shown: report.suggestion.shown, limit: report.suggestion.limit },
    { generated: 8, simulated: 8, top: 3, shown: 3, limit: 8 },
  );
  const text = report.caveats.join('\n');
  assert.match(text, /전수 탐색이 아니다/);
  assert.match(text, /개만 후보로 남겼다 \(limit 8\)/);
  assert.match(text, /후보 8개를 계산해 총딜 상위 3개만 표시한다/);
  assert.match(text, /실제 게임 기록과 대조하지 않았다/);
});

test('suggest: 후보를 만들 수 없거나 계정·옵션이 잘못되면 엔진을 부르지 않고 InputError다', async () => {
  const log = [];
  const deps = { catalog, runBatch: fakeEngine(log), now };
  await assert.rejects(
    suggestSquads({ account: accountOf({ 이1: {}, 삼1: {} }), condition }, {}, deps),
    (e) => e instanceof InputError && /버스트 1단계 니케를 보유하지 않았다/.test(e.message),
  );
  await assert.rejects(suggestSquads({ account: { ...big, schema_version: 9 }, condition }, {}, deps), InputError);
  await assert.rejects(suggestSquads({ account: accountOf({ ...big.nikkes, '없는 니케': {} }), condition }, {}, deps), InputError);
  await assert.rejects(suggestSquads({ account: big, condition }, { top: 0 }, deps), InputError);
  for (const bad of [{ budget: 0 }, { budget: 1.5 }, { budget: '120' }, { refine: 'yes' }, { refineTop: 0 }]) {
    await assert.rejects(suggestSquads({ account: big, condition }, bad, deps), InputError, JSON.stringify(bad));
  }
  await assert.rejects(suggestSquads({ account: big, condition: { ...condition, boss: '없는 보스' } }, {}, deps), InputError);
  assert.equal(log.length, 0);
});
