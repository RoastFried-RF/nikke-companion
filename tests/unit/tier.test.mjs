// 자동 티어 2단계(src/tier/evaluate.mjs · rules.mjs · render.mjs). 엔진은 가짜다 — 팀 총딜이 「멤버 딜의 합 × 서포터 배율」이라
// 개인 딜이 0인 서포터도 팀 총딜을 올린다. 실제 엔진으로는 tests/integration/tier.engine.test.mjs가 확인한다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMemoryStore, withCache } from '../../src/core/cache.mjs';
import { InputError } from '../../src/core/compare.mjs';
import { loadCatalog, loadEngineData } from '../../src/runtime/node.mjs';
import {
  buildTier, planVariants, staticHold, tierRequest, validateReferences,
  DEFAULT_TIER_BUDGET, HOLD_REASONS, METHOD, STATUS_HOLD, STATUS_PREDICTED, TIER_SCHEMA_VERSION,
} from '../../src/tier/evaluate.mjs';
import { renderTierReport } from '../../src/tier/render.mjs';
import { gradeOf, isUnsupportedWarning, tierLabel, validateRules, UNSUPPORTED_FLAG } from '../../src/tier/rules.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

// ── 가짜 로스터 ───────────────────────────────────────────────────────────────
// dmg = 개인 딜, mult = 팀 전체에 곱해지는 배율(서포터). 팀 총딜 = round(딜의 합 × 배율의 곱).
const ROSTER = {
  서포1: { stage: '1', dmg: 0, mult: 1.3 },
  서포2: { stage: '1', dmg: 100, mult: 1.1 },
  서포3: { stage: '1', dmg: 0, mult: 1.5 }, // 개인 딜 0 — 팀 총딜로만 평가된다
  버퍼1: { stage: '2', dmg: 200, mult: 1.2 },
  버퍼2: { stage: '2', dmg: 300 },
  버퍼3: { stage: '2', dmg: 250 },
  딜1: { stage: '3', dmg: 1000 },
  딜2: { stage: '3', dmg: 800 },
  딜3: { stage: '3', dmg: 600 },
  딜4: { stage: '3', dmg: 900 },
  딜5: { stage: '3', dmg: 1200 },
  약딜: { stage: '3', dmg: 100 },
  전1: { stage: 'A', dmg: 700 },
  경고딜: { stage: '3', dmg: 950 }, // 편성에 있으면 엔진이 「효과 모델이 없는 …」 경고를 싣는다
  오류딜: { stage: '3', dmg: 5000 }, // 편성에 있으면 엔진이 오류를 낸다
  프리뷰딜: { stage: '3', dmg: 5000, preview: true },
  미파싱딜: { stage: '3', dmg: 5000 }, // 스킬 현황에 이름이 없다
  빈스킬딜: { stage: '3', dmg: 5000 }, // 스킬 효과 0개
  단계없음: { dmg: 5000 },
};
const catalog = {
  nikkes: Object.fromEntries(
    Object.entries(ROSTER).map(([name, n]) => [name, { burst_stage: n.stage, weapon_type: 'AR', ...(n.preview ? { preview: true } : {}) }]),
  ),
  bosses: ['가짜 보스'],
};
const engineData = {
  files: { 'data/parsed_nikke.json': 'a'.repeat(64), 'data/parsed_skills.json': 'b'.repeat(64) },
  skills: Object.fromEntries(Object.keys(ROSTER).filter((n) => n !== '미파싱딜').map((n) => [n, n === '빈스킬딜' ? 0 : 5])),
};
const team = (members) => Math.round(members.reduce((s, n) => s + ROSTER[n].dmg, 0) * members.reduce((p, n) => p * (ROSTER[n].mult ?? 1), 1));

const A = ['서포1', '버퍼1', '딜1', '딜2', '딜3'];
const B = ['서포2', '버퍼2', '딜4', '딜2', '딜3'];
const references = {
  schema_version: 1,
  version: 'test-ref-1',
  source: { summary: '가짜' },
  scenario: { id: 'fake-scenario', boss: '가짜 보스', duration: 120, growth: 'engine_default', growth_note: '가짜 기본 스펙' },
  squads: [
    { id: '기준A', members: A, source: '가짜 A' },
    { id: '기준B', members: B, source: '가짜 B' },
  ],
};
const rules = {
  schema_version: 1,
  version: 'test-rules-1',
  provisional: true,
  tiers: [
    { tier: 'S', min: 1.2 },
    { tier: 'A', min: 1.0 },
    { tier: 'B', min: 0.8 },
    { tier: 'C', min: 0 },
  ],
  unsupported_warning_markers: ['효과 모델이 없', '미지원'],
};
const now = () => new Date('2026-11-12T00:00:00Z');
const COMMIT = 'c'.repeat(40);
const UNSUPPORTED_WARNING = '효과 모델이 없는 보스 패턴: 가짜 패턴';
const PLAIN_WARNING = '기본 스펙(1층) 이탈 1명 — 딜1';

/** 가짜 엔진. `log`에 묶음별 요청이 쌓인다. */
function fakeEngine({ log = [], failOn = null, warnOn = null } = {}) {
  return async (requests) => {
    log.push(requests);
    return requests.map((req) => {
      const squad = req.squad;
      if (squad.includes('오류딜') || failOn?.(squad)) return { error: { type: 'internal_error', message: '가짜 엔진 오류', path: null } };
      if (squad.includes('미파싱딜')) return { error: { type: 'invalid_input', message: "스킬이 파싱되지 않은 캐릭터: ['미파싱딜']", path: null } };
      const total = team(squad);
      const warnings = [PLAIN_WARNING];
      if (squad.includes('경고딜') || warnOn?.(squad)) warnings.push(UNSUPPORTED_WARNING);
      return {
        total_damage: total,
        members: squad.map((n) => ({ name: n, damage: ROSTER[n].dmg, share: 0.2 })),
        warnings,
        spec: { preview: squad.filter((n) => ROSTER[n].preview) },
        evaluator: { repo: 'fake/engine', commit: COMMIT, dirty: false },
      };
    });
  };
}
const depsOf = (options = {}) => ({ catalog, runBatch: fakeEngine(options), now, engineData, ...(options.deps ?? {}) });
const build = (input = {}, options = {}) => buildTier({ references, rules, ...input }, depsOf(options));
const entryOf = (report, name) => report.entries.find((e) => e.name === name);
const sent = (log) => log.flat().map((r) => r.squad);

// ── 점수 ──────────────────────────────────────────────────────────────────────

test('가짜 엔진의 기준 편성 총딜 (아래 기대값의 바탕)', () => {
  assert.equal(team(A), 4056);
  assert.equal(team(B), 2970);
});

test('점수 = 같은 버스트 단계 자리에 바꿔 넣은 편성 총딜 ÷ 그 기준 편성 총딜의 최댓값', async () => {
  const log = [];
  const report = await build({ only: ['딜5'] }, { log });
  const e = entryOf(report, '딜5');

  // 3단계 자리: 기준A의 3·4·5번, 기준B의 3·4·5번 — 여섯 편성을 계산한다. 배치 순서는 그대로다.
  assert.deepEqual(
    e.comparisons.map((c) => [c.reference, c.slot, c.replaced]),
    [['기준A', 2, '딜1'], ['기준A', 3, '딜2'], ['기준A', 4, '딜3'], ['기준B', 2, '딜4'], ['기준B', 3, '딜2'], ['기준B', 4, '딜3']],
  );
  assert.deepEqual(sent(log), [
    A, B,
    ['서포1', '버퍼1', '딜5', '딜2', '딜3'], ['서포1', '버퍼1', '딜1', '딜5', '딜3'], ['서포1', '버퍼1', '딜1', '딜2', '딜5'],
    ['서포2', '버퍼2', '딜5', '딜2', '딜3'], ['서포2', '버퍼2', '딜4', '딜5', '딜3'], ['서포2', '버퍼2', '딜4', '딜2', '딜5'],
  ]);
  for (const c of e.comparisons) {
    const ref = c.reference === '기준A' ? A : B;
    const swapped = ref.map((m, i) => (i === c.slot ? '딜5' : m));
    assert.equal(c.total_damage, team(swapped));
    assert.equal(c.reference_total, team(ref));
    assert.equal(c.ratio, team(swapped) / team(ref));
  }
  // 가장 좋은 자리: 기준A의 딜3 자리 — (0+200+1000+800+1200)×1.56 = 4992, 4992/4056.
  assert.equal(e.score, 4992 / 4056);
  assert.equal(e.score, Math.max(...e.comparisons.map((c) => c.ratio)));
  assert.deepEqual(e.best, { reference: '기준A', slot: 4, replaced: '딜3', total_damage: 4992, reference_total: 4056, ratio: 4992 / 4056 });
  assert.equal(e.tier, 'S');
  assert.equal(e.status, STATUS_PREDICTED);
});

test('점수는 개인 딜이 아니라 팀 총딜 변화다 — 개인 딜 0인 서포터가 딜러보다 높을 수 있다', async () => {
  const report = await build({ only: ['서포3', '약딜', '딜5'] });
  const support = entryOf(report, '서포3');
  // 1단계 자리 두 곳: 기준A의 서포1 자리 2600×1.5×1.2 = 4680, 기준B의 서포2 자리 2600×1.5 = 3900.
  assert.deepEqual(support.comparisons.map((c) => [c.reference, c.replaced, c.total_damage]), [['기준A', '서포1', 4680], ['기준B', '서포2', 3900]]);
  assert.equal(support.score, 3900 / 2970);
  assert.equal(ROSTER.서포3.dmg, 0);
  assert.ok(support.score > entryOf(report, '딜5').score, '개인 딜 0인 서포터가 개인 딜 1위 딜러보다 점수가 높다');
  assert.ok(entryOf(report, '약딜').score < 1);
  // 순위는 점수 내림차순.
  assert.deepEqual(report.entries.map((e) => [e.rank, e.name]), [[1, '서포3'], [2, '딜5'], [3, '약딜']]);
});

test('전 단계(A) 니케는 3단계 자리에 바꿔 넣는다', async () => {
  const e = entryOf(await build({ only: ['전1'] }), '전1');
  assert.equal(e.burst_stage, 'A');
  assert.deepEqual([...new Set(e.comparisons.map((c) => c.replaced))].sort(), ['딜1', '딜2', '딜3', '딜4']);
});

test('엔진 요청은 표준 육성 조건(프로필 없음)·기대값 모드·시나리오의 보스와 시간이다', async () => {
  const log = [];
  await build({ only: ['딜5'] }, { log });
  for (const req of log.flat()) {
    assert.deepEqual(Object.keys(req).sort(), ['boss', 'sim', 'squad']);
    assert.deepEqual(req.sim, { expected: true, duration: 120 });
    assert.equal(req.boss, '가짜 보스');
    assert.equal('profile' in req, false, '프로필을 주지 않는다 = 엔진 기본 스펙');
  }
  assert.deepEqual(tierRequest({ boss: '보스', enemy: { code: '풍압' } }, ['가']), {
    squad: ['가'], sim: { expected: true, duration: 180 }, boss: '보스', enemy: { code: '풍압' },
  });
});

// ── 자기 자신 제외 ────────────────────────────────────────────────────────────

test('대상이 이미 든 기준 편성은 대조에서 빼고 다른 기준 편성으로 평가한다 — 자기 자신과 비교한 1.0이 나오지 않는다', async () => {
  const log = [];
  const report = await build({ only: ['딜1'] }, { log });
  const e = entryOf(report, '딜1');
  assert.deepEqual(e.excluded_references, [{ reference: '기준A', reason: 'self' }]);
  assert.ok(e.comparisons.length > 0);
  assert.ok(e.comparisons.every((c) => c.reference === '기준B'), '기준A(딜1이 든 편성)와는 비교하지 않는다');
  assert.ok(e.comparisons.every((c) => c.replaced !== '딜1'));
  // 기준B의 딜3 자리: (100+300+900+800+1000)×1.1 = 3410.
  assert.equal(e.score, 3410 / 2970);
  assert.notEqual(e.score, 1);
  assert.ok(e.notes.some((n) => n.includes('기준A') && n.includes('이미 들어 있어')));
  // 엔진에 간 편성에 같은 니케가 두 번 든 것이 없고, 기준 편성 그대로를 「바꿔 넣은 편성」으로 다시 계산하지도 않는다.
  const squads = sent(log);
  for (const s of squads) assert.equal(new Set(s).size, s.length, s.join(','));
  assert.equal(squads.filter((s) => s.join() === A.join()).length, 1, '기준A는 기준 계산 한 번뿐이다');
});

test('모든 기준 편성에 든 니케는 대조할 편성이 없어 평가 보류다 (1.0을 주지 않는다)', async () => {
  const e = entryOf(await build({ only: ['딜2'] }), '딜2');
  assert.equal(e.status, STATUS_HOLD);
  assert.equal(e.hold.code, 'no_comparison');
  assert.equal(e.score, null);
  assert.equal(e.tier, null);
  assert.deepEqual(e.excluded_references.map((x) => x.reason), ['self', 'self']);
});

test('planVariants: 같은 단계 자리가 없는 기준 편성은 건너뛴다', () => {
  const refs = [{ id: 'X', members: ['서포1', '서포2', '딜1', '딜2', '딜3'] }, { id: 'Y', members: A }];
  const plan = planVariants('버퍼3', refs, catalog);
  assert.deepEqual(plan.excluded, [{ reference: 'X', reason: 'no_slot' }]);
  assert.deepEqual(plan.variants, [{ reference: 'Y', slot: 1, replaced: '버퍼1', members: ['서포1', '버퍼3', '딜1', '딜2', '딜3'] }]);
});

// ── 평가 보류 ─────────────────────────────────────────────────────────────────

test('미파싱·효과 없음·프리뷰·단계 미상은 시뮬 없이 평가 보류다 — 등급도 점수도 없다(0점이 아니다)', async () => {
  const log = [];
  const names = ['미파싱딜', '빈스킬딜', '프리뷰딜', '단계없음'];
  const report = await build({ only: names }, { log });
  assert.deepEqual(log, [], '보류할 니케뿐이면 엔진을 부르지 않는다');
  assert.deepEqual(report.entries.map((e) => [e.name, e.hold.code]), [
    ['미파싱딜', 'skills_unparsed'], ['빈스킬딜', 'skills_empty'], ['프리뷰딜', 'preview'], ['단계없음', 'no_burst_stage'],
  ]);
  for (const e of report.entries) {
    assert.equal(e.status, STATUS_HOLD);
    assert.equal(e.status_label, `평가 보류(${HOLD_REASONS[e.hold.code]})`);
    assert.equal(e.score, null, '누락을 0점으로 치지 않는다');
    assert.equal(e.tier, null);
    assert.equal(e.tier_label, null);
    assert.equal(e.rank, null);
    assert.ok(e.hold.message.length > 0);
    assert.deepEqual(e.notes, [e.hold.message]);
  }
  assert.deepEqual(report.summary, {
    requested: 4, graded: 0, hold: 4, unsupported: 0,
    by_tier: { S: 0, A: 0, B: 0, C: 0 },
    hold_by_reason: { skills_unparsed: 1, skills_empty: 1, preview: 1, no_burst_stage: 1 },
  });
  assert.ok(report.caveats.some((c) => c.includes('평가 보류 4명은 등급이 없다') && c.includes('0점으로 친 것이 아니다')));
  assert.deepEqual(report.sims, { budget: DEFAULT_TIER_BUDGET, used: 0, baselines: 0, variants: 0, skipped_for_budget: 0 });
});

test('시뮬이 오류를 낸 니케는 평가 보류다 — 일부 자리만 실패해도 등급을 매기지 않는다', async () => {
  const all = await build({ only: ['오류딜', '딜5'] });
  const failed = entryOf(all, '오류딜');
  assert.equal(failed.status, STATUS_HOLD);
  assert.equal(failed.status_label, '평가 보류(시뮬 오류)');
  assert.equal(failed.hold.code, 'sim_error');
  assert.equal(failed.hold.errors.length, 6);
  assert.match(failed.hold.message, /시뮬 6건 중 6건이 오류를 냈다: 가짜 엔진 오류/);
  assert.equal(failed.score, null);
  assert.equal(entryOf(all, '딜5').tier, 'S', '한 니케의 오류가 다른 니케를 막지 않는다');

  // 여섯 자리 가운데 하나만 실패 — 빠진 자리가 최댓값이었을 수 있으므로 보류.
  const partial = await build({ only: ['딜5'] }, { failOn: (squad) => squad.join() === ['서포1', '버퍼1', '딜1', '딜2', '딜5'].join() });
  const e = entryOf(partial, '딜5');
  assert.equal(e.hold.code, 'sim_error');
  assert.deepEqual(e.hold.errors.map((x) => [x.reference, x.slot, x.replaced]), [['기준A', 4, '딜3']]);
  assert.equal(e.tier, null);
});

test('스킬 현황을 받지 못하면 미파싱은 엔진 오류로 드러나 평가 보류가 되고, 데이터 버전은 지어내지 않는다', async () => {
  const report = await buildTier({ references, rules, only: ['미파싱딜'] }, { catalog, runBatch: fakeEngine(), now });
  const e = entryOf(report, '미파싱딜');
  assert.equal(e.hold.code, 'sim_error');
  assert.match(e.hold.message, /스킬이 파싱되지 않은 캐릭터/);
  assert.equal(report.engine_data, null);
  assert.ok(report.caveats.some((c) => c.includes('엔진 데이터 버전') && c.includes('확인하지 못했다')));
});

test('엔진이 결과에서 프리뷰라고 알린 니케도 평가 보류다', async () => {
  // 카탈로그에는 표시가 없는데 엔진 결과의 spec.preview에 이름이 실린 경우.
  const plain = { ...catalog, nikkes: { ...catalog.nikkes, 프리뷰딜: { burst_stage: '3' } } };
  const report = await buildTier({ references, rules, only: ['프리뷰딜'] }, { catalog: plain, runBatch: fakeEngine(), now, engineData });
  assert.equal(entryOf(report, '프리뷰딜').hold.code, 'preview');
});

test('staticHold: 보류 사유가 없으면 null', () => {
  assert.equal(staticHold('딜1', catalog, engineData.skills), null);
  assert.equal(staticHold('미파싱딜', catalog, null), null, '스킬 현황이 없으면 여기서는 알 수 없다');
  assert.equal(staticHold('프리뷰딜', catalog, null).code, 'preview');
});

test('등급을 매긴 항목은 예측 평가이고, 실측 대조 완료는 어디에도 쓰지 않는다', async () => {
  const report = await build({ only: Object.keys(ROSTER) });
  for (const e of report.entries) {
    assert.ok([STATUS_PREDICTED, STATUS_HOLD].includes(e.status), e.name);
    assert.equal(e.status === STATUS_PREDICTED, e.tier !== null, e.name);
    assert.equal(e.status === STATUS_PREDICTED, typeof e.score === 'number', e.name);
    assert.equal(e.status === STATUS_HOLD, e.hold !== null, e.name);
  }
  assert.equal(STATUS_PREDICTED, '예측 평가');
  assert.equal(STATUS_HOLD, '평가 보류');
  assert.doesNotMatch(JSON.stringify(report), /실측 대조 완료/);
  assert.equal(report.summary.graded + report.summary.hold, Object.keys(ROSTER).length);
  assert.equal(Object.values(report.summary.by_tier).reduce((s, n) => s + n, 0), report.summary.graded);
});

// ── 미지원 효과 경고 ──────────────────────────────────────────────────────────

test('엔진 경고에 「효과 모델이 없다」는 종류가 있으면 notes에 남기고 등급에 미지원 효과 있음 표시를 붙인다', async () => {
  const report = await build({ only: ['경고딜', '딜5'] });
  const flagged = entryOf(report, '경고딜');
  assert.equal(flagged.status, STATUS_PREDICTED);
  assert.equal(flagged.unsupported, true);
  assert.deepEqual(flagged.flags, [UNSUPPORTED_FLAG]);
  assert.equal(flagged.tier_label, `${flagged.tier} (미지원 효과 있음)`);
  assert.deepEqual(flagged.notes.filter((n) => n.startsWith('미지원 효과')), [`미지원 효과(엔진 경고): ${UNSUPPORTED_WARNING}`], '같은 경고는 한 번만 적는다');

  const clean = entryOf(report, '딜5');
  assert.equal(clean.unsupported, false);
  assert.deepEqual(clean.flags, []);
  assert.equal(clean.tier_label, clean.tier);
  assert.ok(clean.engine_warnings.includes(PLAIN_WARNING), '다른 종류의 경고는 표시를 붙이지 않고 그대로 싣는다');
  assert.equal(clean.notes.some((n) => n.startsWith('미지원 효과')), false);

  assert.equal(report.summary.unsupported, 1);
  assert.ok(report.caveats.some((c) => c.includes("항목 1개의 등급에는 '미지원 효과 있음' 표시가 붙었다")));
  assert.match(renderTierReport(report), /\(미지원 효과 있음\)/);
});

test('기준 편성 시뮬의 미지원 경고는 그 편성과 대조한 항목 모두에 붙는다', async () => {
  const report = await build({ only: ['딜5', '딜1'] }, { warnOn: (squad) => squad.join() === A.join() });
  assert.equal(entryOf(report, '딜5').unsupported, true, '기준A와 대조했다');
  assert.equal(entryOf(report, '딜1').unsupported, false, '기준A는 대조에서 뺐다(자기 자신)');
});

test('isUnsupportedWarning · tierLabel', () => {
  assert.equal(isUnsupportedWarning('효과 모델이 없는 보스 패턴: x', rules), true);
  assert.equal(isUnsupportedWarning('큐브 x: 효과 모델이 없는(미지원) 큐브다', rules), true);
  assert.equal(isUnsupportedWarning(PLAIN_WARNING, rules), false);
  assert.equal(isUnsupportedWarning(null, rules), false);
  assert.equal(tierLabel('S', false), 'S');
  assert.equal(tierLabel('S', true), 'S (미지원 효과 있음)');
});

// ── 등급 경계 ─────────────────────────────────────────────────────────────────

test('gradeOf: 경계는 「이상」이고 규칙 문서에서 읽는다', () => {
  assert.deepEqual(gradeOf(1.2, rules), { tier: 'S', min: 1.2 });
  assert.equal(gradeOf(1.2 - 1e-9, rules).tier, 'A');
  assert.equal(gradeOf(5, rules).tier, 'S');
  assert.equal(gradeOf(1.0, rules).tier, 'A');
  assert.equal(gradeOf(0.9999999, rules).tier, 'B');
  assert.equal(gradeOf(0.8, rules).tier, 'B');
  assert.equal(gradeOf(0.7999, rules).tier, 'C');
  assert.equal(gradeOf(0, rules).tier, 'C');
  // 수가 아닌 점수에는 등급을 지어내지 않는다.
  for (const bad of [NaN, Infinity, -0.1, null, undefined, '1.0']) assert.equal(gradeOf(bad, rules), null, String(bad));
});

test('등급 경계를 바꾸면 같은 점수의 등급이 바뀌고, 규칙 버전이 결과에 실린다', async () => {
  const first = await build({ only: ['딜5', '약딜'] });
  assert.deepEqual(first.entries.map((e) => [e.name, e.tier]), [['딜5', 'S'], ['약딜', 'B']]);
  assert.deepEqual(first.rules, { version: 'test-rules-1', provisional: true, tiers: rules.tiers });

  const moved = { ...rules, version: 'test-rules-2', tiers: [{ tier: '상', min: 1.3 }, { tier: '중', min: 0.9 }, { tier: '하', min: 0 }] };
  const second = await buildTier({ references, rules: moved, only: ['딜5', '약딜'] }, depsOf());
  assert.deepEqual(second.entries.map((e) => [e.name, e.tier, e.score]), first.entries.map((e) => [e.name, e.name === '딜5' ? '중' : '하', e.score]));
  assert.equal(second.rules.version, 'test-rules-2');
  assert.deepEqual(second.summary.by_tier, { 상: 0, 중: 1, 하: 1 });
});

test('규칙이 임시라는 사실을 caveats에 적는다. 검증된 규칙(provisional: false)이면 적지 않는다', async () => {
  const provisional = await build({ only: ['딜5'] });
  assert.ok(provisional.caveats.some((c) => c.includes('등급 규칙 test-rules-1은 임시다') && c.includes('대표 사례로 검증되지 않았다')));
  const settled = await buildTier({ references, rules: { ...rules, provisional: false }, only: ['딜5'] }, depsOf());
  assert.equal(settled.caveats.some((c) => c.includes('임시다')), false);
  assert.match(renderTierReport(provisional), /등급 규칙 test-rules-1 \[임시\]/);
});

test('validateRules: 잘못된 규칙 문서를 짚는다', () => {
  assert.deepEqual(validateRules(rules), { ok: true, errors: [] });
  const paths = (doc) => validateRules(doc).errors.map((e) => e.path);
  assert.deepEqual(paths(null), ['']);
  assert.deepEqual(paths({ ...rules, schema_version: 2 }), ['/schema_version']);
  assert.deepEqual(paths({ ...rules, version: '' }), ['/version']);
  assert.deepEqual(paths({ ...rules, provisional: undefined }), ['/provisional']);
  assert.deepEqual(paths({ ...rules, tiers: [] }), ['/tiers']);
  assert.deepEqual(paths({ ...rules, tiers: [{ tier: 'S', min: 1 }, { tier: 'A', min: 1 }, { tier: 'B', min: 0 }] }), ['/tiers/1/min'], '경계가 내려가지 않는다');
  assert.deepEqual(paths({ ...rules, tiers: [{ tier: 'S', min: 1 }, { tier: 'S', min: 0 }] }), ['/tiers/1/tier'], '이름이 겹친다');
  assert.deepEqual(paths({ ...rules, tiers: [{ tier: 'S', min: 1 }, { tier: 'A', min: 0.5 }] }), ['/tiers/1/min'], '마지막 경계가 0이 아니다');
  assert.deepEqual(paths({ ...rules, tiers: [{ tier: 'S', min: '1' }, { tier: 'A', min: 0 }] }), ['/tiers/0/min']);
  assert.deepEqual(paths({ ...rules, unsupported_warning_markers: [] }), ['/unsupported_warning_markers']);
  assert.deepEqual(paths({ ...rules, unsupported_warning_markers: [''] }), ['/unsupported_warning_markers']);
});

// ── 결과에 실리는 것 ──────────────────────────────────────────────────────────

test('결과에 엔진 커밋·데이터 버전·시나리오·기준 편성 버전·규칙 버전·계산 시각·시뮬 횟수가 실린다', async () => {
  const report = await build({ only: ['딜5', '서포3'] });
  assert.equal(report.schema_version, TIER_SCHEMA_VERSION);
  assert.equal(report.kind, 'tier');
  assert.deepEqual(report.method, { ...METHOD });
  assert.equal(report.generated_at, '2026-11-12T00:00:00.000Z');
  assert.deepEqual(report.engine, { repo: 'fake/engine', commit: COMMIT, dirty: false });
  assert.match(report.engine_data.version, /^sha256:[0-9a-f]{16}$/);
  assert.deepEqual(report.engine_data.files, engineData.files);
  assert.deepEqual(report.scenario, {
    id: 'fake-scenario', boss: '가짜 보스', duration: 120, enemy: null, growth: 'engine_default', growth_note: '가짜 기본 스펙', expected: true,
  });
  assert.equal(report.references.version, 'test-ref-1');
  assert.deepEqual(report.references.squads, [
    { id: '기준A', members: A, source: '가짜 A', status: 'used', reason: null, total_damage: 4056 },
    { id: '기준B', members: B, source: '가짜 B', status: 'used', reason: null, total_damage: 2970 },
  ]);
  assert.equal(report.rules.version, 'test-rules-1');
  assert.deepEqual(report.sims, { budget: DEFAULT_TIER_BUDGET, used: 10, baselines: 2, variants: 8, skipped_for_budget: 0 });
  assert.equal(report.cache, null, '캐시로 감싸지 않은 런타임이면 null');
  assert.ok(report.assumptions.some((a) => a.includes('엔진 기본 스펙')));
  assert.ok(report.caveats.some((c) => c.includes('실제 게임 기록과 대조하지 않았다')));

  // 데이터 파일 해시가 달라지면 데이터 버전이 달라진다.
  const changed = { ...engineData, files: { ...engineData.files, 'data/parsed_skills.json': 'd'.repeat(64) } };
  const other = await buildTier({ references, rules, only: ['딜5'] }, { ...depsOf(), engineData: () => changed });
  assert.notEqual(other.engine_data.version, report.engine_data.version);
});

test('엔진 커밋을 모르거나 작업 폴더가 dirty면 caveats에 적는다', async () => {
  const dirty = async (requests) => (await fakeEngine()(requests)).map((r) => ({ ...r, evaluator: { repo: 'fake/engine', commit: COMMIT, dirty: true } }));
  const a = await buildTier({ references, rules, only: ['딜5'] }, { catalog, runBatch: dirty, now, engineData });
  assert.ok(a.caveats.some((c) => c.includes('커밋하지 않은 변경')));
  const unknown = async (requests) => (await fakeEngine()(requests)).map(({ evaluator: _e, ...r }) => r);
  const b = await buildTier({ references, rules, only: ['딜5'] }, { catalog, runBatch: unknown, now, engineData });
  assert.equal(b.engine.commit, null);
  assert.ok(b.caveats.some((c) => c.includes('엔진 커밋을 확인하지 못했다')));
});

test('캐시로 감싼 런타임이면 캐시 통계가 실리고, 두 번째 계산은 엔진을 부르지 않는다(P-012의 캐시)', async () => {
  const log = [];
  const base = {
    loadCatalog: () => catalog,
    engineVersion: () => ({ repo: 'fake/engine', commit: COMMIT, dirty: false }),
    runBatch: fakeEngine({ log }),
  };
  const runtime = withCache(base, createMemoryStore());
  const first = await buildTier({ references, rules, only: ['딜5', '서포3'] }, { runtime, now, engineData, batchSize: 3 });
  assert.deepEqual(first.cache, { hits: 0, misses: 10, stored: 10, warnings: [] });
  assert.deepEqual(log.map((batch) => batch.length), [2, 3, 3, 2], '묶음으로 나눠 맡긴다(기준 2 + 바꿔 넣기 8)');
  const second = await buildTier({ references, rules, only: ['딜5', '서포3'] }, { runtime, now, engineData, batchSize: 3 });
  assert.deepEqual(second.cache, { hits: 10, misses: 0, stored: 0, warnings: [] });
  assert.equal(log.flat().length, 10, '두 번째에는 엔진에 아무것도 가지 않았다');
  assert.deepEqual({ ...second, cache: null }, { ...first, cache: null }, '캐시 통계 말고는 같은 결과다');
  // 캐시 적중도 시뮬 횟수(예산)에 센다 — 캐시가 차 있든 비어 있든 같은 결과가 나오게.
  assert.equal(second.sims.used, 10);
});

test('같은 입력이면 같은 결과다', async () => {
  const names = ['딜5', '서포3', '약딜', '경고딜', '오류딜', '미파싱딜', '딜1', '전1', '버퍼3'];
  const a = await build({ only: names });
  const b = await build({ only: names });
  assert.deepEqual(a, b);
  // 등급을 매긴 항목은 점수 내림차순(같으면 이름 순), 보류는 그 뒤에 입력 순서대로.
  const graded = a.entries.filter((e) => e.tier !== null);
  for (let i = 1; i < graded.length; i += 1) assert.ok(graded[i - 1].score >= graded[i].score);
  assert.deepEqual(graded.map((e) => e.rank), graded.map((_, i) => i + 1));
  assert.deepEqual(a.entries.filter((e) => e.tier === null).map((e) => e.name), ['오류딜', '미파싱딜']);
  // 니케를 적은 순서가 달라도 니케별 점수·등급은 같다.
  const c = await build({ only: [...names].reverse() });
  const core = (r) => Object.fromEntries(r.entries.map((e) => [e.name, [e.status_label, e.tier, e.score]]));
  assert.deepEqual(core(c), core(a));
  // 같은 이름을 두 번 적어도 한 번만 평가한다.
  assert.equal((await build({ only: ['딜5', '딜5', ' 딜5 '] })).entries.length, 1);
});

test('only를 주지 않으면 엔진이 아는 전원을 평가한다', async () => {
  const report = await build();
  assert.deepEqual(report.entries.map((e) => e.name).sort(), Object.keys(ROSTER).sort());
  assert.equal(report.summary.requested, Object.keys(ROSTER).length);
});

// ── 시뮬 예산 ─────────────────────────────────────────────────────────────────

test('시뮬 예산을 넘지 않고, 예산 때문에 못 본 니케는 평가 보류(예산)로 남는다', async () => {
  const log = [];
  // 기준 2 + 딜5 6건 = 8. 서포3(2건)은 들어가고 약딜(6건)은 남은 2건에 안 들어간다.
  const report = await build({ only: ['딜5', '약딜', '서포3'], budget: 10 }, { log });
  assert.equal(log.flat().length, 10);
  assert.ok(report.sims.used <= report.sims.budget);
  assert.deepEqual(report.sims, { budget: 10, used: 10, baselines: 2, variants: 8, skipped_for_budget: 1 });
  const skipped = entryOf(report, '약딜');
  assert.equal(skipped.status, STATUS_HOLD);
  assert.equal(skipped.status_label, '평가 보류(예산)');
  assert.equal(skipped.hold.code, 'budget');
  assert.equal(skipped.hold.needed, 6);
  assert.equal(skipped.hold.remaining, 2);
  assert.equal(skipped.score, null);
  assert.equal(skipped.tier, null);
  assert.equal(entryOf(report, '딜5').tier, 'S');
  assert.equal(entryOf(report, '서포3').status, STATUS_PREDICTED, '뒤의 니케가 남은 예산에 들어가면 계산한다');
  assert.ok(report.caveats.some((c) => c.includes('시뮬 예산 10건이 모자라 1명을 계산하지 못했다(평가 보류(예산))')));
  // 예산이 넉넉할 때와 점수가 같다 — 일부 자리만 계산한 점수를 내지 않는다.
  const full = await build({ only: ['딜5', '약딜', '서포3'] });
  assert.equal(entryOf(report, '딜5').score, entryOf(full, '딜5').score);
  assert.equal(entryOf(report, '서포3').score, entryOf(full, '서포3').score);
});

test('예산이 기준 편성 계산에도 모자라면 엔진을 부르지 않고 전원이 평가 보류(예산)다', async () => {
  const log = [];
  const report = await build({ only: ['딜5', '미파싱딜'], budget: 1 }, { log });
  assert.deepEqual(log, []);
  assert.deepEqual(report.sims, { budget: 1, used: 0, baselines: 0, variants: 0, skipped_for_budget: 1 });
  assert.equal(entryOf(report, '딜5').status_label, '평가 보류(예산)');
  assert.equal(entryOf(report, '미파싱딜').hold.code, 'skills_unparsed', '시뮬 없이 아는 사유가 먼저다');
});

test('예산이 딱 맞으면 전부 계산한다. 잘못된 예산은 입력 오류다', async () => {
  const exact = await build({ only: ['딜5'], budget: 8 });
  assert.equal(exact.sims.used, 8);
  assert.equal(entryOf(exact, '딜5').tier, 'S');
  for (const bad of [0, -1, 1.5, '10']) await assert.rejects(build({ only: ['딜5'], budget: bad }), InputError, String(bad));
});

// ── 기준 편성 ─────────────────────────────────────────────────────────────────

test('쓸 수 없는 기준 편성은 대조에서 빼고 이유를 남긴다. 하나도 못 쓰면 멈춘다', async () => {
  const withBad = {
    ...references,
    squads: [...references.squads, { id: '프리뷰편성', members: ['서포1', '버퍼1', '딜1', '딜4', '프리뷰딜'] }, { id: '오류편성', members: ['서포1', '버퍼1', '딜1', '딜4', '오류딜'] }],
  };
  const log = [];
  const report = await buildTier({ references: withBad, rules, only: ['딜5'] }, depsOf({ log }));
  const byId = Object.fromEntries(report.references.squads.map((s) => [s.id, s]));
  assert.equal(byId.프리뷰편성.status, 'unusable');
  assert.match(byId.프리뷰편성.reason, /프리뷰딜: 프리뷰/);
  assert.equal(byId.오류편성.status, 'unusable');
  assert.match(byId.오류편성.reason, /엔진이 기준 편성을 계산하지 못했다: 가짜 엔진 오류/);
  assert.equal(sent(log).some((s) => s.includes('프리뷰딜')), false, '쓸 수 없는 것을 아는 기준 편성은 계산하지 않는다');
  assert.ok(entryOf(report, '딜5').comparisons.every((c) => ['기준A', '기준B'].includes(c.reference)));
  assert.equal(report.caveats.filter((c) => c.startsWith('기준 편성 ') && c.includes('쓰지 못했다')).length, 2);
  assert.equal(report.sims.baselines, 3, '오류편성은 계산해 보고서야 알았다');

  const onlyBad = { ...references, squads: [{ id: '오류편성', members: ['서포1', '버퍼1', '딜1', '딜4', '오류딜'] }] };
  await assert.rejects(buildTier({ references: onlyBad, rules, only: ['딜5'] }, depsOf()), /기준 편성을 하나도 계산하지 못했다/);
  const onlyPreview = { ...references, squads: [{ id: '프리뷰편성', members: ['서포1', '버퍼1', '딜1', '딜4', '프리뷰딜'] }] };
  await assert.rejects(buildTier({ references: onlyPreview, rules, only: ['딜5'] }, depsOf()), InputError);
});

test('validateReferences: 잘못된 기준 편성 문서를 짚는다', () => {
  assert.deepEqual(validateReferences(references, catalog), { ok: true, errors: [] });
  const paths = (doc) => validateReferences(doc, catalog).errors.map((e) => e.path);
  assert.deepEqual(paths([]), ['']);
  assert.deepEqual(paths({ ...references, schema_version: 9 }), ['/schema_version']);
  assert.deepEqual(paths({ ...references, version: undefined }), ['/version']);
  assert.deepEqual(paths({ ...references, scenario: undefined }), ['/scenario']);
  assert.deepEqual(paths({ ...references, scenario: { ...references.scenario, boss: '없는 보스' } }), ['/scenario/boss']);
  assert.deepEqual(paths({ ...references, scenario: { ...references.scenario, duration: 0 } }), ['/scenario/duration']);
  assert.deepEqual(paths({ ...references, scenario: { ...references.scenario, growth: 'my_account' } }), ['/scenario/growth']);
  assert.deepEqual(paths({ ...references, squads: [] }), ['/squads']);
  assert.deepEqual(paths({ ...references, squads: [{ id: 'X', members: ['서포1', '버퍼1'] }] }), ['/squads/0/members']);
  assert.deepEqual(paths({ ...references, squads: [{ id: 'X', members: ['딜1', '딜1', '딜2', '딜3', '딜4'] }] }), ['/squads/0/members']);
  assert.deepEqual(paths({ ...references, squads: [references.squads[0], { ...references.squads[1], id: '기준A' }] }), ['/squads/1/id']);
});

test('입력 오류: 모르는 니케·빈 목록·잘못된 문서는 엔진을 부르기 전에 멈춘다', async () => {
  const log = [];
  await assert.rejects(build({ only: ['없는 니케'] }, { log }), (e) => e instanceof InputError && /없는 니케/.test(e.message));
  await assert.rejects(build({ only: [] }, { log }), InputError);
  await assert.rejects(buildTier({ references, rules: { ...rules, tiers: [] }, only: ['딜5'] }, depsOf({ log })), /등급 규칙이 잘못됐다/);
  await assert.rejects(buildTier({ references: { ...references, squads: [] }, rules, only: ['딜5'] }, depsOf({ log })), /기준 편성이 잘못됐다/);
  assert.deepEqual(log, []);
});

test('진행 보고: 묶음이 끝날 때마다 onProgress를 부른다', async () => {
  const seen = [];
  await buildTier({ references, rules, only: ['딜5'] }, { ...depsOf(), batchSize: 4, onProgress: (p) => seen.push([p.done, p.total]) });
  assert.deepEqual(seen, [[2, 2], [6, 8], [8, 8]]);
});

// ── 표 ────────────────────────────────────────────────────────────────────────

test('renderTierReport: 판·시나리오·시뮬 횟수·등급·보류·주의가 보인다', async () => {
  const text = renderTierReport(await build({ only: ['서포3', '딜5', '미파싱딜'], budget: 50 }));
  assert.match(text, /^자동 티어 — 3명 \(등급 2명 · 평가 보류 1명\)$/m);
  assert.match(text, /^엔진: fake\/engine @ cccccccc · 데이터 sha256:[0-9a-f]{16}$/m);
  assert.match(text, /^시나리오: 가짜 보스 · 120초 · 육성 엔진 기본 스펙\(프로필 없음\)$/m);
  assert.match(text, /^기준 편성 test-ref-1 \(2개 중 2개 사용\) · 등급 규칙 test-rules-1 \[임시\]$/m);
  assert.match(text, /^시뮬: 10건 \/ 예산 50건 \(기준 편성 2건 \+ 바꿔 넣기 8건\)$/m);
  assert.match(text, /^캐시: 쓰지 않음$/m);
  assert.match(text, /^ {2}1 {2}S +1\.313 {2}서포3 +\[예측 평가\] 기준B의 서포2 자리: /m);
  assert.match(text, /^ {2}- 미파싱딜: 평가 보류\(스킬 미파싱\) — /m);
  assert.match(text, /대표 사례로 검증되지 않았다/);
});

// ── 저장소의 데이터 파일과 모듈 ───────────────────────────────────────────────

test('data/tier의 규칙·기준 편성 파일은 형식이 맞고, 실제 엔진 카탈로그의 이름과 버스트 단계로 쓸 수 있다 (엔진 호출 없음)', () => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const realRules = read('data/tier/rules.json');
  const realRefs = read('data/tier/reference-squads.json');
  const real = loadCatalog();
  const data = loadEngineData();

  assert.deepEqual(validateRules(realRules), { ok: true, errors: [] });
  assert.equal(realRules.provisional, true, '대표 사례로 검증하기 전에는 임시 규칙이다');
  assert.deepEqual(validateReferences(realRefs, real), { ok: true, errors: [] });
  assert.ok(realRefs.squads.length >= 3, '기준 편성 여러 개');
  assert.ok(typeof realRefs.source?.summary === 'string' && realRefs.source.summary.includes('snapshot.py'), '출처를 적는다');

  // 기준 편성은 모두 평가 가능한 니케로만 이뤄지고 버스트 1·2·3단계를 갖춘다.
  for (const s of realRefs.squads) {
    assert.ok(typeof s.source === 'string' && s.source.length > 0, `${s.id}: 출처`);
    for (const m of s.members) assert.equal(staticHold(m, real, data.skills), null, `${s.id}: ${m}`);
    const stages = new Set(s.members.map((m) => real.nikkes[m].burst_stage));
    for (const stage of ['1', '2', '3']) assert.ok(stages.has(stage), `${s.id}: ${stage}단계`);
  }
  // 전원 계산에 필요한 시뮬 횟수는 기본 예산 안이다.
  const usable = realRefs.squads.map((s) => ({ id: s.id, members: s.members }));
  let sims = usable.length;
  for (const name of Object.keys(real.nikkes)) {
    if (staticHold(name, real, data.skills) === null) sims += planVariants(name, usable, real).variants.length;
  }
  assert.ok(sims > 1000 && sims <= DEFAULT_TIER_BUDGET, `전원 계산 ${sims}건`);

  // 엔진 데이터 현황: 파일별 내용 해시와 니케별 파싱된 효과 수.
  assert.deepEqual(Object.keys(data.files).sort(), ['data/parsed_nikke.json', 'data/parsed_skills.json']);
  for (const hash of Object.values(data.files)) assert.match(hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(loadEngineData(), data);
  assert.equal(staticHold('test_B1', real, data.skills)?.code, 'skills_empty');
});

test('티어 계산 모듈은 node: 모듈을 가져오지 않는다 (웹뷰에서도 돌 수 있게)', () => {
  for (const name of ['evaluate', 'rules', 'render']) {
    const source = fs.readFileSync(path.join(ROOT, 'src/tier', `${name}.mjs`), 'utf8');
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(imports.every((s) => s.startsWith('./') || s.startsWith('../')), `${name}.mjs: ${imports.join(', ')}`);
    assert.ok(imports.every((s) => !s.includes('/runtime/') || s.endsWith('core/runtime.mjs')), `${name}.mjs는 src/runtime을 가져오지 않는다`);
    assert.doesNotMatch(source, /['"]node:|\bprocess\.|\brequire\s*\(/, `${name}.mjs`);
  }
});

// ── CLI ───────────────────────────────────────────────────────────────────────

test('CLI tier: 잘못된 인자는 엔진을 부르기 전에 종료 코드 2', () => {
  // 엔진을 실행하려 하면 실패하게 해 둔다 — 아래는 모두 그 전에 끝나야 한다.
  const cli = (...args) =>
    spawnSync(process.execPath, ['src/cli.mjs', 'tier', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NIKKE_PYTHON: path.join(ROOT, '없는-파이썬.exe') } });
  const noSub = cli('--only', '헬름');
  assert.equal(noSub.status, 2);
  assert.match(noSub.stderr, /입력 오류.*하위 명령은 build뿐이다/);
  const unknown = cli('build', '--no-cache', '--only', '없는 니케,헬름');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /입력 오류.*'없는 니케'/);
  const badBudget = cli('build', '--no-cache', '--only', '헬름', '--budget', '0');
  assert.equal(badBudget.status, 2);
  assert.match(badBudget.stderr, /입력 오류.*--budget/);
  const emptyOnly = cli('build', '--no-cache', '--only');
  assert.equal(emptyOnly.status, 2);
  assert.match(emptyOnly.stderr, /입력 오류.*--only/);
  const noRules = cli('build', '--no-cache', '--only', '헬름', '--rules', path.join(ROOT, 'data/tier/없는-규칙.json'));
  assert.equal(noRules.status, 2);
  assert.match(noRules.stderr, /입력 오류.*파일을 읽을 수 없다/);
});
