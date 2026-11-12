// 편성 탐색 2단계(배치 순서 탐색)와 시뮬 예산. 엔진은 가짜다 — 배치에 따라 총딜이 달라지게 만들었다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCandidates, suggestSquads, DEFAULT_BUDGET, DEFAULT_REFINE_TOP } from '../../src/core/candidates.mjs';
import { renderReport, searchLine } from '../../src/core/render.mjs';
import {
  burstOrderGroup, gainText, isChargeWeapon, pickBestPlacement, placementSignature, placementVariants, planRefinement, variantName, CAMERA_SLOT,
} from '../../src/core/search.mjs';

// 가짜 카탈로그: 이름 앞 글자가 버스트 단계, 무기는 차지형(SR·RL)과 비차지를 섞었다.
const plain = (stage, weapon) => ({ burst_stage: stage, weapon_type: weapon, is_charge: false });
const charge = (stage, weapon) => ({ burst_stage: stage, weapon_type: weapon, is_charge: true, full_charge_mult: 250 });
const catalog = {
  nikkes: {
    일1: plain('1', 'SMG'), 일2: charge('1', 'SR'),
    이1: plain('2', 'MG'), 이2: charge('2', 'SR'),
    삼1: plain('3', 'MG'), 삼2: charge('3', 'SR'), 삼3: charge('3', 'RL'), 삼4: plain('3', 'AR'), 삼5: plain('3', 'SG'),
    전1: charge('A', 'SR'),
    모름: { burst_stage: '3' }, // 무기 정보가 없는 니케
  },
  bosses: ['보스'],
};
const CHARGED = new Set(['일2', '이2', '삼2', '삼3', '전1']);
const stageOf = (name) => ({ 일: '1', 이: '2', 삼: '3', 전: '3', 모: '3' })[name[0]];
const condition = { schema_version: 1, content: 'solo_raid', boss: '보스' };
const grown = (skill) => ({ skill_levels: [skill, skill, skill] });
const account = {
  schema_version: 1,
  is_test_data: true,
  nikkes: { 일1: grown(10), 일2: grown(5), 이1: grown(10), 이2: grown(6), 삼1: grown(10), 삼2: grown(9), 삼3: grown(8), 삼4: grown(7), 삼5: grown(3) },
};
const now = () => new Date('2026-11-12T00:00:00Z');

const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
const comboKey = (members) => [...members].sort().join('|');

// ── 가짜 엔진 ─────────────────────────────────────────────────────────────────
// 총딜 = 멤버 값의 합 + 단계마다 「맨 앞에 선 멤버」의 값(버스트 선점) + 3번 자리에 선 차지 무기 멤버의 값(카메라).
// 엔진 문서가 말하는 두 가지(같은 단계 안의 순서, 3번 자리)만 결과를 바꾼다. 요청의 배치 순서(batch 안의 자리)와는 무관하다.
const SCORE = { 일1: 5000, 일2: 3000, 이1: 5000, 이2: 4000, 삼1: 5000, 삼2: 4500, 삼3: 4000, 삼4: 3500, 삼5: 1000 };
const LEAD = { 일1: 10, 일2: 300, 이1: 20, 이2: 200, 삼1: 30, 삼2: 500, 삼3: 100, 삼4: 50, 삼5: 400 };
const CAM = { 일2: 40, 이2: 60, 삼2: 5, 삼3: 70 };
function damageOf(squad) {
  let total = squad.reduce((s, n) => s + SCORE[n], 0);
  for (const stage of ['1', '2', '3']) {
    const lead = squad.find((n) => stageOf(n) === stage);
    if (lead) total += LEAD[lead];
  }
  return total + (CAM[squad[CAMERA_SLOT]] ?? 0);
}
/** 배치와 무관한 가짜 엔진의 총딜: 멤버 값의 합. */
const flatDamage = (squad) => squad.reduce((s, n) => s + SCORE[n], 0);

function fakeEngine({ log = [], damage = damageOf, failOn = null } = {}) {
  return async (requests) => {
    log.push(requests.map((r) => r.squad));
    return requests.map((req) => {
      if (failOn && failOn(req.squad)) return { error: { type: 'internal_error', message: '가짜 엔진 오류' } };
      const total = damage(req.squad);
      return {
        total_damage: total,
        members: req.squad.map((n) => ({ name: n, damage: total / 5, share: 0.2 })),
        warnings: [],
        spec: { profile: { ungrown: [] } },
        evaluator: { repo: 'fake', commit: 'abc', dirty: false },
      };
    });
  };
}
const depsOf = (options) => ({ catalog, runBatch: fakeEngine(options), now });
/** 한 조합의 120가지 배치 가운데 가짜 엔진이 내는 최고 총딜(탐색과 따로 센다). */
const bruteBest = (members, damage = damageOf) => Math.max(...perms(members).map(damage));

// ── 변형 규칙 ─────────────────────────────────────────────────────────────────

test('묶음과 차지 무기 판정: 전 단계(A)는 3단계 묶음, 무기 정보가 없으면 모름', () => {
  assert.equal(burstOrderGroup({ burst_stage: '1' }), '1');
  assert.equal(burstOrderGroup({ burst_stage: 'A' }), '3');
  assert.equal(burstOrderGroup({ burst_stage: '?' }), null);
  assert.equal(burstOrderGroup(undefined), null);
  assert.equal(isChargeWeapon(catalog.nikkes.삼2), true);
  assert.equal(isChargeWeapon({ full_charge_mult: 350 }), true, '엔진의 판정과 같이 full_charge_mult가 있으면 차지형');
  assert.equal(isChargeWeapon(catalog.nikkes.삼1), false);
  assert.equal(isChargeWeapon(catalog.nikkes.모름), null);
  assert.equal(CAMERA_SLOT, 2, '카메라는 3번 자리(squad[2])에서 출발한다');
});

test('서명은 단계별 순서와 3번 자리의 카메라 대상이다 — 그 밖의 자리 차이는 같은 배치로 본다', () => {
  const a = placementSignature(['일1', '이1', '삼1', '삼2', '삼3'], catalog);
  assert.deepEqual(a.orders, { 1: ['일1'], 2: ['이1'], 3: ['삼1', '삼2', '삼3'] });
  assert.equal(a.camera, null, '3번 자리가 비차지면 카메라 대상이 없다');
  // 단계가 다른 멤버끼리 자리를 바꿔도(3번 자리가 여전히 비차지) 서명이 같다.
  assert.equal(placementSignature(['이1', '일1', '삼1', '삼2', '삼3'], catalog).key, a.key);
  assert.equal(placementSignature(['삼1', '일1', '이1', '삼2', '삼3'], catalog).key, a.key);
  // 같은 단계 안의 순서가 바뀌거나 3번 자리에 차지 무기가 서면 다르다.
  assert.notEqual(placementSignature(['일1', '이1', '삼1', '삼3', '삼2'], catalog).key, a.key);
  const cam = placementSignature(['일1', '삼1', '삼2', '이1', '삼3'], catalog);
  assert.equal(cam.camera, '삼2');
  assert.deepEqual(cam.orders, a.orders);
  assert.notEqual(cam.key, a.key);
});

test('배치 변형: 같은 5명의 다른 배치이고, 서명마다 하나뿐이며, 원래 배치와 겹치지 않는다', () => {
  const original = ['일1', '이1', '삼1', '삼2', '삼3'];
  const variants = placementVariants(original, catalog);
  // 3단계 순서 3! = 6가지 × 3번 자리(비차지, 삼2, 삼3) 3가지 − 원래 배치 1 = 17. 순열 전체(119)가 아니다.
  assert.equal(variants.length, 17);
  const originalKey = placementSignature(original, catalog).key;
  const keys = new Set();
  for (const v of variants) {
    assert.equal(comboKey(v.members), comboKey(original), v.members.join(','));
    assert.equal(new Set(v.members).size, 5);
    const sig = placementSignature(v.members, catalog);
    assert.notEqual(sig.key, originalKey);
    assert.ok(!keys.has(sig.key), `서명이 겹친다: ${v.members.join(',')}`);
    keys.add(sig.key);
    assert.ok(v.changes.length > 0);
  }
  // 규칙으로 구별되는 배치를 빠짐없이 만든다: 120가지 순열의 서명 종류 = 변형 + 원래 배치.
  assert.equal(new Set(perms(original).map((p) => placementSignature(p, catalog).key)).size, variants.length + 1);
});

test('배치 변형의 순서: 단계 안 순서만 → 3번 자리만 → 둘 다. 한 축만 바꾼 변형은 다른 축을 그대로 둔다', () => {
  const original = ['일1', '이1', '삼1', '삼2', '삼3'];
  const base = placementSignature(original, catalog);
  const variants = placementVariants(original, catalog);
  assert.deepEqual(variants.map((v) => v.tier), [1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  for (const v of variants) {
    const sig = placementSignature(v.members, catalog);
    if (v.tier === 1) {
      assert.equal(sig.camera, base.camera, '순서만 바꾼 변형은 3번 자리의 카메라 대상이 같다');
      assert.deepEqual(v.order_changed, ['3']);
      assert.equal(v.camera_changed, false);
      assert.match(v.changes.join(' / '), /^버스트 3단계 순서 삼\d → 삼\d → 삼\d$/);
    } else if (v.tier === 2) {
      assert.deepEqual(sig.orders, base.orders, '3번 자리만 바꾼 변형은 단계 안 순서가 같다');
      assert.deepEqual(v.order_changed, []);
      assert.equal(v.members[CAMERA_SLOT], sig.camera);
      assert.match(v.changes.join(' / '), /^3번 자리\(카메라\) 삼[23]$/);
    } else {
      assert.equal(v.camera_changed, true);
      assert.deepEqual(v.order_changed, ['3']);
    }
  }
  // 순서만 바꾼 첫 변형은 원래 자리 틀(1·2·3·3·3단계)을 그대로 쓴다.
  assert.deepEqual(variants[0].members, ['일1', '이1', '삼1', '삼3', '삼2']);
  // 3번 자리에 차지 무기가 오게 되는 순서는 비차지 멤버를 3번 자리로 옮겨 카메라를 그대로 둔다.
  const lead2 = variants.find((v) => v.tier === 1 && v.members.indexOf('삼2') < v.members.indexOf('삼1'));
  assert.ok(!CHARGED.has(lead2.members[CAMERA_SLOT]), lead2.members.join(','));
});

test('배치 변형: 단계 구성이 달라도 같은 규칙이고, 같은 입력이면 같은 변형이 같은 순서로 나온다', () => {
  // 1-2-2: 2단계 2! × 3단계 2! = 4가지 순서 × 3번 자리(원래 삼2, 이2, 비차지) 3가지 − 1 = 11.
  const squad = ['일1', '이1', '이2', '삼2', '삼4'];
  const variants = placementVariants(squad, catalog);
  assert.equal(variants.length, 11);
  assert.deepEqual(placementVariants(squad, catalog), variants);
  assert.deepEqual(placementVariants([...squad], structuredClone(catalog)), variants);
  // 순서만 바꾼 변형: 한 묶음만 바꾼 것(뒤 단계부터)이 두 묶음을 바꾼 것보다 먼저다.
  assert.deepEqual(variants.filter((v) => v.tier === 1).map((v) => v.order_changed), [['3'], ['2'], ['2', '3']]);
  // 입력을 바꾸지 않는다.
  assert.deepEqual(squad, ['일1', '이1', '이2', '삼2', '삼4']);

  // 전 단계(A) 니케는 3단계 묶음에서 순서를 다툰다.
  const withA = placementVariants(['일1', '이1', '전1', '삼1', '삼4'], catalog);
  assert.ok(withA.some((v) => v.changes.some((c) => /^버스트 3단계 순서 삼1 → 전1 → 삼4$/.test(c))));
  // 무기 정보가 없는 니케는 3번 자리 후보에서 빼지 않는다.
  const unknown = placementVariants(['일1', '이1', '삼1', '삼4', '모름'], catalog);
  assert.ok(unknown.some((v) => v.tier === 2 && v.members[CAMERA_SLOT] === '모름'));
  // 바꿀 것이 없는 편성(묶음이 모두 한 명, 전원 비차지)은 변형이 없다.
  assert.deepEqual(placementVariants(['일1', '이1', '삼1'], catalog), []);
});

test('예산 나누기: 순위 순으로 돌아가며 하나씩 고르고, 남은 예산을 넘지 않는다', () => {
  const combos = [
    { name: '후보 1', members: ['일1', '이1', '삼1', '삼2', '삼3'] }, // 변형 17개
    { name: '후보 2', members: ['일1', '이1', '이2', '삼2', '삼4'] }, // 변형 11개
    { name: '후보 3', members: ['일1', '이1', '삼1', '삼4', '삼5'] }, // 3! × 1 − 1 = 5개
  ];
  const all = planRefinement(combos, catalog, 1000);
  assert.deepEqual(all.plan.map((p) => p.selected.length), [17, 11, 5]);
  assert.deepEqual({ total: all.total, requested: all.requested, skipped: all.skipped }, { total: 33, requested: 33, skipped: 0 });

  const tight = planRefinement(combos, catalog, 8);
  assert.deepEqual(tight.plan.map((p) => p.selected.length), [3, 3, 2]);
  assert.deepEqual({ total: tight.total, requested: tight.requested, skipped: tight.skipped }, { total: 33, requested: 8, skipped: 25 });
  for (const [i, p] of tight.plan.entries()) assert.deepEqual(p.selected, all.plan[i].variants.slice(0, p.selected.length), '앞 순서의 변형부터 고른다');

  // 변형이 적은 조합이 다 차면 남은 예산은 다른 조합으로 간다.
  assert.deepEqual(planRefinement(combos, catalog, 20).plan.map((p) => p.selected.length), [8, 7, 5]);
  for (const none of [0, -3]) assert.deepEqual(planRefinement(combos, catalog, none).requested, 0);
  assert.equal(variantName('후보 2', 3), '후보 2 · 배치 변형 3');
});

test('가장 좋은 배치 고르기: 원래 배치를 언제나 후보에 넣고, 같은 총딜이면 원래 배치 → 먼저 계산한 변형 순이다', () => {
  const members = ['일1', '이1', '삼1', '삼2', '삼3'];
  const entry = (name, order, total) => ({
    name, total_damage: total, members: order.map((n) => ({ name: n, damage: total / 5, share: 0.2 })), notes: ['기존 메모'], engine_warnings: [], ungrown_members: [],
  });
  const original = entry('후보 1', members, 1000);
  const { plan } = planRefinement([{ name: '후보 1', members }], catalog, 4);
  const item = plan[0];
  const computedOf = (totals) => new Map(totals.map((t, i) => [variantName('후보 1', i + 1), entry(variantName('후보 1', i + 1), item.selected[i].members, t)]));

  // 변형이 모두 낮거나 같으면 원래 배치 그대로다.
  const kept = pickBestPlacement(original, item, computedOf([900, 1000, 999, 1000]));
  assert.equal(kept.total_damage, 1000);
  assert.deepEqual(kept.members, original.members);
  assert.equal(kept.placement.changed, false);
  assert.equal(kept.placement.gain_ratio, 1);
  assert.deepEqual(kept.placement.variants, { total: 17, simulated: 4, skipped: 13, failed: 0 });
  assert.deepEqual(kept.notes.slice(0, 1), ['기존 메모'], '원래 메모를 지우지 않는다');
  assert.match(kept.notes.at(-1), /1단계 배치가 가장 좋다 \(1단계 대비 100\.0%\)\. 예산이 모자라 변형 13개는 계산하지 못했다\.$/);

  // 더 높은 변형이 둘이면 먼저 계산한 쪽이다. 이름은 조합 이름 그대로다.
  const moved = pickBestPlacement(original, item, computedOf([1200, 900, 1200, 1100]));
  assert.equal(moved.name, '후보 1');
  assert.equal(moved.total_damage, 1200);
  assert.deepEqual(moved.members.map((m) => m.name), item.selected[0].members);
  assert.deepEqual(moved.placement.changes, item.selected[0].changes);
  assert.equal(moved.placement.gain_ratio, 1.2);
  assert.deepEqual(moved.placement.original_members, members);
  assert.equal(moved.placement.original_total_damage, 1000);
  assert.match(moved.notes.at(-1), /^배치 탐색: 배치를 바꿔 총딜이 1단계 배치의 120\.0%가 됐다 \(변형 4개 계산\)\. 바꾼 것 — 버스트 3단계 순서 삼1 → 삼3 → 삼2\./);

  // 엔진이 계산하지 못한 변형(결과 없음)은 세지 않고 알린다. 원래 총딜이 0이면 비율은 null이다.
  const partial = computedOf([900, 950]);
  const some = pickBestPlacement(original, item, partial);
  assert.deepEqual(some.placement.variants, { total: 17, simulated: 2, skipped: 13, failed: 2 });
  assert.match(some.notes.at(-1), /변형 2개는 엔진이 계산하지 못했다\.$/);
  assert.equal(pickBestPlacement(entry('후보 1', members, 0), item, new Map()).placement.gain_ratio, null);
  // 입력 항목을 바꾸지 않는다.
  assert.deepEqual(original.notes, ['기존 메모']);
});

test('비율 표기: 차이가 작아 100.0%로 보이면 차이가 드러날 때까지 자릿수를 늘린다', () => {
  assert.equal(gainText(1.117), '111.7%');
  assert.equal(gainText(1.0006), '100.1%');
  assert.equal(gainText(1.0002), '100.02%');
  assert.equal(gainText(1.000004), '100.0004%');
  assert.equal(gainText(1.0000000001), '100.0000%');
});

// ── 2단계 추천 ────────────────────────────────────────────────────────────────

test('기본값: 배치 탐색을 하고, 예산 120 · 상위 5개 조합', async () => {
  assert.equal(DEFAULT_BUDGET, 120);
  assert.equal(DEFAULT_REFINE_TOP, 5);
  const log = [];
  const report = await suggestSquads({ account, condition }, {}, depsOf({ log }));
  assert.equal(log.length, 2, '엔진 배치는 두 번: 1단계 조합, 2단계 배치');
  assert.equal(log[0].length, 30);
  assert.ok(log[0].length + log[1].length <= 120, `시뮬 ${log[0].length + log[1].length}건`);
  const s = report.suggestion.search;
  assert.deepEqual({ refine: s.refine, budget: s.budget, refine_top: s.refine_top, sims: s.sims }, { refine: true, budget: 120, refine_top: 5, sims: log[0].length + log[1].length });
  assert.equal(s.stage2.combos, 5);
});

test('2단계는 1단계 상위 K개 조합에만 적용하고, 원래 배치를 포함해 가장 좋은 배치를 고른다', async () => {
  const stage1 = await suggestSquads({ account, condition }, { limit: 12, top: 12, refine: false }, depsOf());
  const log = [];
  const report = await suggestSquads({ account, condition }, { limit: 12, top: 12, budget: 1000 }, depsOf({ log }));

  // 1단계 요청은 생성기가 낸 후보 그대로다.
  const generated = generateCandidates(account, catalog, { limit: 12 }).squads;
  assert.deepEqual(log[0], generated.map((s) => s.members));
  // 2단계 요청은 1단계 총딜 상위 5개 조합의 멤버로만 만든 배치다.
  const top5 = stage1.ranking.slice(0, 5);
  const top5Keys = new Set(top5.map((r) => comboKey(r.members.map((m) => m.name))));
  assert.equal(top5Keys.size, 5);
  for (const squad of log[1]) assert.ok(top5Keys.has(comboKey(squad)), `상위 5개 밖의 조합을 계산했다: ${squad.join(',')}`);
  assert.equal(new Set(log[1].map(comboKey)).size, 5, '상위 5개 조합 모두에 변형을 계산했다');
  // 1단계에서 계산한 원래 배치를 2단계에서 다시 계산하지 않는다(결과는 그대로 후보에 들어간다).
  const stage1Sequences = new Set(log[0].map((s) => s.join('|')));
  for (const squad of log[1]) assert.ok(!stage1Sequences.has(squad.join('|')), squad.join(','));

  // 조합마다 결과는 원래 배치 이상이고, 예산이 넉넉하면 규칙으로 구별되는 모든 배치 가운데 최고다.
  const before = new Map(stage1.ranking.map((r) => [r.name, r]));
  for (const r of report.ranking) {
    const original = before.get(r.name);
    assert.ok(r.total_damage >= original.total_damage, r.name);
    const members = r.members.map((m) => m.name);
    assert.equal(comboKey(members), comboKey(original.members.map((m) => m.name)), '이름이 같으면 같은 멤버 조합이다');
    assert.equal(r.total_damage, damageOf(members), '순위의 배치로 계산한 총딜이다');
    if (top5Keys.has(comboKey(members))) {
      assert.equal(r.total_damage, bruteBest(members), `${r.name}: 120가지 배치의 최고와 같아야 한다`);
      assert.deepEqual(r.placement.original_members, generated.find((s) => s.name === r.name).members);
      assert.equal(r.placement.original_total_damage, original.total_damage);
      assert.equal(r.placement.variants.skipped, 0);
    } else {
      assert.equal(r.placement, null, `${r.name}: 2단계 대상이 아니다`);
      assert.equal(r.total_damage, original.total_damage);
      assert.deepEqual(r.members, original.members);
      assert.ok(!r.notes.some((n) => n.startsWith('배치 탐색')));
    }
  }
  // 2단계 뒤의 최고 총딜은 1단계 최고 이상이다 — 이 가짜 엔진에서는 실제로 더 높다.
  assert.ok(report.ranking[0].total_damage > stage1.ranking[0].total_damage);
  assert.equal(report.suggestion.search.best_stage1_total, stage1.ranking[0].total_damage);
  assert.equal(report.suggestion.search.best_total, report.ranking[0].total_damage);
  assert.equal(report.suggestion.simulated, 12);
  assert.equal(report.rejected.length + report.failed.length, 0);
});

test('순위는 멤버 조합마다 가장 좋은 배치 하나만 보이고, 배치로 얻은 차이를 메모로 남긴다', async () => {
  const report = await suggestSquads({ account, condition }, { limit: 12, top: 12, budget: 1000 }, depsOf());
  assert.equal(report.ranking.length, 12);
  assert.equal(new Set(report.ranking.map((r) => comboKey(r.members.map((m) => m.name)))).size, 12, '같은 조합이 두 번 나오지 않는다');
  assert.deepEqual(report.ranking.map((r) => r.rank), Array.from({ length: 12 }, (_, i) => i + 1));
  for (const r of report.ranking) assert.match(r.name, /^후보 \d+$/, '변형 이름이 순위에 새지 않는다');
  for (const [i, r] of report.ranking.entries()) {
    if (i > 0) assert.ok(report.ranking[i - 1].total_damage >= r.total_damage, '총딜 내림차순');
    assert.equal(r.relative_to_best, r.total_damage / report.ranking[0].total_damage);
  }

  const refined = report.ranking.filter((r) => r.placement);
  assert.equal(refined.length, 5);
  const changed = refined.filter((r) => r.placement.changed);
  assert.ok(changed.length > 0);
  assert.equal(report.suggestion.search.stage2.improved, changed.length);
  for (const r of refined) {
    const p = r.placement;
    assert.equal(p.gain_ratio, r.total_damage / p.original_total_damage);
    assert.ok(p.gain_ratio >= 1);
    const memo = r.notes.filter((n) => n.startsWith('배치 탐색'));
    assert.equal(memo.length, 1, r.name);
    if (p.changed) {
      assert.ok(p.gain_ratio > 1);
      assert.notDeepEqual(r.members.map((m) => m.name), p.original_members);
      assert.ok(p.changes.length > 0);
      assert.ok(memo[0].includes(`1단계 배치의 ${gainText(p.gain_ratio)}가 됐다`), memo[0]);
      assert.ok(memo[0].includes(`변형 ${p.variants.simulated}개 계산`), memo[0]);
      for (const c of p.changes) assert.ok(memo[0].includes(c), memo[0]);
    } else {
      assert.equal(p.gain_ratio, 1);
      assert.deepEqual(r.members.map((m) => m.name), p.original_members);
      assert.match(memo[0], /1단계 배치가 가장 좋다 \(1단계 대비 100\.0%\)/);
    }
  }
  // 표에도 메모와 탐색 요약이 보인다.
  const text = renderReport(report);
  assert.match(text, /^ {6}! 배치 탐색: 배치를 바꿔 총딜이 1단계 배치의 1\d\d\.\d%가 됐다/m);
  assert.match(text, /^탐색: 시뮬 \d+건 \/ 예산 1000건 \(1단계 조합 12건 \+ 2단계 배치 \d+건\) · 배치를 바꾼 조합 \d\/5개$/m);
  assert.match(report.caveats.join('\n'), /배치 탐색\(2단계\): 1단계 총딜 상위 5개 조합에만.*GAMEPLAY\.md §버스트 사용 순서와 배치, CONTROL\.md §카메라/);
});

test('배치가 결과를 바꾸지 않으면 1단계 배치를 그대로 두고 그렇게 적는다', async () => {
  const stage1 = await suggestSquads({ account, condition }, { limit: 6, top: 6, refine: false }, depsOf({ damage: flatDamage }));
  const report = await suggestSquads({ account, condition }, { limit: 6, top: 6 }, depsOf({ damage: flatDamage }));
  assert.deepEqual(report.ranking.map((r) => [r.name, r.total_damage, r.members]), stage1.ranking.map((r) => [r.name, r.total_damage, r.members]));
  for (const r of report.ranking.filter((x) => x.placement)) {
    assert.equal(r.placement.changed, false);
    assert.equal(r.placement.gain_ratio, 1);
    assert.match(r.notes.at(-1), /^배치 탐색: 변형 \d+개를 계산했지만 1단계 배치가 가장 좋다/);
  }
  assert.equal(report.suggestion.search.stage2.improved, 0);
});

test('refineTop으로 2단계 대상 조합 수를 바꾼다', async () => {
  const log = [];
  const report = await suggestSquads({ account, condition }, { limit: 8, top: 8, refineTop: 2, budget: 1000 }, depsOf({ log }));
  assert.equal(new Set(log[1].map(comboKey)).size, 2);
  assert.equal(report.ranking.filter((r) => r.placement).length, 2);
  assert.equal(report.suggestion.search.refine_top, 2);
  assert.equal(report.suggestion.search.stage2.combos, 2);
  // 후보가 K개보다 적으면 있는 만큼만 본다.
  const few = await suggestSquads({ account, condition }, { limit: 3, top: 8, budget: 1000 }, depsOf());
  assert.equal(few.suggestion.search.stage2.combos, 3);
});

test('시뮬 횟수는 예산을 넘지 않고, 건너뛴 배치 변형의 수를 caveats에 적는다', async () => {
  for (const budget of [9, 10, 20, 37, 120]) {
    const log = [];
    const report = await suggestSquads({ account, condition }, { limit: 8, top: 8, budget }, depsOf({ log }));
    const sims = log.flat().length;
    assert.ok(sims <= budget, `예산 ${budget}에 시뮬 ${sims}건`);
    const s = report.suggestion.search;
    assert.equal(s.sims, sims);
    assert.equal(s.stage1.requested, 8);
    assert.equal(s.stage2.requested, sims - 8);
    assert.equal(s.stage2.variants, s.stage2.requested + s.stage2.skipped);
    const text = report.caveats.join('\n');
    if (s.stage2.skipped > 0) {
      assert.equal(sims, budget, '변형이 남았으면 예산을 다 쓴다');
      assert.ok(text.includes(`시뮬 예산 ${budget}건이 모자라 배치 변형 ${s.stage2.variants}개 중 ${s.stage2.skipped}개를 계산하지 못했다.`), text);
      assert.match(renderReport(report), new RegExp(`예산이 모자라 못 본 것: 배치 변형 ${s.stage2.skipped}개`));
    } else {
      assert.doesNotMatch(text, /계산하지 못했다/);
    }
    // 조합별 메모의 숫자를 더하면 전체와 같다.
    const refined = report.ranking.filter((r) => r.placement);
    assert.equal(refined.reduce((n, r) => n + r.placement.variants.simulated, 0), s.stage2.requested);
    assert.equal(refined.reduce((n, r) => n + r.placement.variants.skipped, 0), s.stage2.skipped);
    for (const r of refined) {
      const p = r.placement.variants;
      assert.equal(/예산이 모자라 변형 (\d+)개는 계산하지 못했다/.exec(r.notes.at(-1))?.[1], p.skipped > 0 ? String(p.skipped) : undefined, r.notes.at(-1));
    }
  }
  // 예산 20, 후보 8: 2단계 12건을 상위 5개 조합이 돌아가며 나눠 갖는다.
  const log = [];
  const report = await suggestSquads({ account, condition }, { limit: 8, top: 8, budget: 20 }, depsOf({ log }));
  assert.equal(log[1].length, 12);
  const stage1 = await suggestSquads({ account, condition }, { limit: 8, top: 8, refine: false }, depsOf());
  const perCombo = stage1.ranking.slice(0, 5).map((r) => report.ranking.find((x) => x.name === r.name).placement.variants.simulated);
  assert.deepEqual(perCombo, [3, 3, 2, 2, 2]);
});

test('예산이 후보 수보다 작으면 1단계부터 줄이고, 못 본 후보와 변형의 수를 적는다', async () => {
  const log = [];
  const report = await suggestSquads({ account, condition }, { limit: 8, top: 8, budget: 5 }, depsOf({ log }));
  assert.equal(log.length, 1, '2단계에 쓸 예산이 없으면 엔진을 다시 부르지 않는다');
  assert.deepEqual(log[0], generateCandidates(account, catalog, { limit: 8 }).squads.slice(0, 5).map((s) => s.members), '투자 점수 합이 높은 앞쪽 후보부터 계산한다');
  const s = report.suggestion.search;
  assert.deepEqual(s.stage1, { requested: 5, skipped: 3 });
  assert.equal(s.stage2.requested, 0);
  assert.ok(s.stage2.skipped > 0);
  assert.equal(s.sims, 5);
  assert.equal(report.suggestion.generated, 8);
  assert.equal(report.suggestion.simulated, 5);
  const text = report.caveats.join('\n');
  assert.match(text, /시뮬 예산 5건이 모자라 후보 3개\(투자 점수 합이 낮은 쪽\)를 계산하지 못했다\./);
  assert.ok(text.includes(`배치 변형 ${s.stage2.variants}개 중 ${s.stage2.skipped}개를 계산하지 못했다.`));
  for (const r of report.ranking) {
    assert.equal(r.placement.changed, false);
    assert.match(r.notes.at(-1), /^배치 탐색: 계산한 변형이 없다 \(1단계 배치 그대로\)\. 예산이 모자라 변형 \d+개는 계산하지 못했다\.$/);
  }
  assert.match(renderReport(report), /예산이 모자라 못 본 것: 후보 3개, 배치 변형 \d+개/);
  // 배치 탐색을 꺼도 예산은 지킨다.
  const plainLog = [];
  const plainReport = await suggestSquads({ account, condition }, { limit: 8, top: 8, budget: 5, refine: false }, depsOf({ log: plainLog }));
  assert.equal(plainLog.flat().length, 5);
  assert.deepEqual(plainReport.suggestion.search.stage1, { requested: 5, skipped: 3 });
});

test('같은 입력이면 같은 결과가 같은 순서로 나온다', async () => {
  const run = async (acct) => {
    const log = [];
    const report = await suggestSquads({ account: acct, condition }, { limit: 10, top: 10, budget: 40 }, depsOf({ log }));
    return { report, log };
  };
  const first = await run(account);
  const second = await run(structuredClone(account));
  assert.deepEqual(second.report, first.report);
  assert.deepEqual(second.log, first.log, '엔진에 맡기는 요청도 같은 순서다');
  // 계정 문서의 니케 나열 순서와도 무관하다.
  const reversed = { ...account, nikkes: Object.fromEntries(Object.entries(account.nikkes).reverse()) };
  const third = await run(reversed);
  assert.deepEqual(third.report, first.report);
  assert.deepEqual(third.log, first.log);
  // 입력 문서를 바꾸지 않는다.
  const before = JSON.stringify(account);
  await run(account);
  assert.equal(JSON.stringify(account), before);
});

test('배치 탐색을 끄면 1단계 결과 그대로이고, 끈 사실을 적는다', async () => {
  const log = [];
  const report = await suggestSquads({ account, condition }, { limit: 8, top: 3, refine: false }, depsOf({ log }));
  assert.equal(log.length, 1);
  assert.equal(log[0].length, 8);
  const generated = new Map(generateCandidates(account, catalog, { limit: 8 }).squads.map((s) => [s.name, s.members]));
  for (const r of report.ranking) {
    assert.deepEqual(r.members.map((m) => m.name), generated.get(r.name));
    assert.ok(!('placement' in r));
    assert.ok(!r.notes.some((n) => n.startsWith('배치 탐색')));
  }
  const s = report.suggestion.search;
  assert.deepEqual({ refine: s.refine, refine_top: s.refine_top, stage2: s.stage2, sims: s.sims }, { refine: false, refine_top: null, stage2: null, sims: 8 });
  assert.match(report.caveats.join('\n'), /배치 탐색\(2단계\)을 하지 않았다/);
  assert.match(renderReport(report), /^탐색: 시뮬 8건 \/ 예산 120건 \(1단계 조합 8건 · 배치 탐색 끔\)$/m);
  // 켰을 때의 1위는 껐을 때의 1위 이상이다.
  const refined = await suggestSquads({ account, condition }, { limit: 8, top: 3 }, depsOf());
  assert.ok(refined.ranking[0].total_damage >= report.ranking[0].total_damage);
});

test('엔진이 변형 하나를 계산하지 못해도 그 조합은 순위에 남고, 실패한 변형이 이름과 함께 남는다', async () => {
  // 1단계 배치는 통과시키고, 2단계의 첫 변형(후보 1의 변형 1)만 실패시킨다.
  const stage1 = new Set(generateCandidates(account, catalog, { limit: 6 }).squads.map((s) => s.members.join('|')));
  let failedOnce = false;
  const failOn = (squad) => {
    if (stage1.has(squad.join('|')) || failedOnce) return false;
    failedOnce = true;
    return true;
  };
  const report = await suggestSquads({ account, condition }, { limit: 6, top: 6, budget: 1000 }, depsOf({ failOn }));
  assert.equal(report.ranking.length, 6);
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].name, /^후보 \d+ · 배치 변형 1$/);
  const combo = report.ranking.find((r) => r.name === report.failed[0].name.split(' · ')[0]);
  assert.equal(combo.placement.variants.failed, 1);
  assert.match(combo.notes.at(-1), /변형 1개는 엔진이 계산하지 못했다\.$/);
  assert.ok(combo.total_damage >= combo.placement.original_total_damage);
});

test('단계마다 엔진을 부르기 직전에 진행 상황(단계·요청 수·쓴 예산)을 알린다', async () => {
  const stagesSeen = [];
  const log = [];
  const deps = { ...depsOf({ log }), onStage: (s) => stagesSeen.push({ ...s, batchesBefore: log.length }) };
  await suggestSquads({ account, condition }, { limit: 8, budget: 20 }, deps);
  assert.deepEqual(stagesSeen, [
    { stage: 1, stages: 2, requests: 8, used: 0, budget: 20, batchesBefore: 0 },
    { stage: 2, stages: 2, requests: 12, used: 8, budget: 20, batchesBefore: 1 },
  ]);
  stagesSeen.length = 0;
  await suggestSquads({ account, condition }, { limit: 8, refine: false }, deps);
  assert.deepEqual(stagesSeen.map(({ batchesBefore, ...s }) => s), [{ stage: 1, stages: 1, requests: 8, used: 0, budget: 120 }]);
});

test('탐색 요약 줄: 칸이 없는 옛 결과 문서에서는 아무것도 내지 않는다', () => {
  assert.equal(searchLine(undefined), '');
  assert.equal(searchLine(null), '');
  assert.equal(
    searchLine({ budget: 120, sims: 24, stage1: { requested: 6, skipped: 0 }, stage2: { combos: 5, variants: 30, requested: 18, skipped: 12, improved: 2 } }),
    '탐색: 시뮬 24건 / 예산 120건 (1단계 조합 6건 + 2단계 배치 18건) · 예산이 모자라 못 본 것: 배치 변형 12개 · 배치를 바꾼 조합 2/5개',
  );
});
