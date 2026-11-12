// 요격전 후보의 「우선 속성」(P-020)을 실제 엔진(vendor/nikke-calc)으로 확인한다. 1분쯤 걸린다(시뮬 80건).
//   - 큰 시험 계정(data/samples/account.large.sample.json)이 약속한 모양인가 — 속성과 버스트 단계는 엔진 카탈로그에서 읽는다
//   - 속성이 다른 두 보스의 1위 편성 멤버가 서로 다르게 나오는가(약점 속성을 우선하지 않으면 두 보스의 1위가 같다)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateAccount } from '../../src/core/account.mjs';
import { DEFAULT_STAGE_CAPS, generateCandidates, investmentScore, suggestSquads } from '../../src/core/candidates.mjs';
import { bossCondition, recommendIntercept, validateBossBundle, ELEMENTS } from '../../src/core/intercept.mjs';
import { loadCatalog, nodeRuntime } from '../../src/runtime/node.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const account = readJson('data/samples/account.large.sample.json');
const bundle = readJson('data/intercept/anomaly.json');
const catalog = loadCatalog();
const elementOf = (name) => catalog.nikkes[name].element_code;
const stageOf = (name) => catalog.nikkes[name].burst_stage;
const membersOf = (entry) => entry.members.map((m) => m.name);
const sameSet = (a, b) => [...a].sort().join('|') === [...b].sort().join('|');

test('큰 시험 계정: 검증용 표시, 엔진이 아는 이름 25명 이상, 속성·버스트 단계가 고르고 육성 정도가 다르다', () => {
  assert.equal(account.is_test_data, true);
  assert.deepEqual(validateAccount(account, catalog).errors, []);
  const names = Object.keys(account.nikkes);
  assert.ok(names.length >= 25, `보유 ${names.length}명`);
  for (const n of names) assert.ok(Object.hasOwn(catalog.nikkes, n), `엔진 카탈로그에 없는 이름: ${n}`);
  // 다섯 속성 × 버스트 1·2·3단계마다 한 명 이상 — 속성과 단계는 엔진 카탈로그의 값이다(계정 파일에 적지 않는다).
  for (const element of ELEMENTS) {
    for (const stage of ['1', '2', '3']) {
      const have = names.filter((n) => elementOf(n) === element && stageOf(n) === stage);
      assert.ok(have.length >= 1, `${element} ${stage}단계 니케가 없다`);
    }
    // 속성마다 3단계에 많이 키운 니케와 덜 키운 니케가 함께 있다.
    const scores = names.filter((n) => elementOf(n) === element && stageOf(n) === '3').map((n) => investmentScore(account.nikkes[n]));
    assert.ok(scores.length >= 2 && Math.max(...scores) > Math.min(...scores), `${element} 3단계의 육성 정도가 같다`);
  }
  assert.ok(new Set(names.map((n) => investmentScore(account.nikkes[n]))).size >= 8, '육성 정도가 여러 가지다');
  // 보유 수가 후보 풀보다 훨씬 많다 — 투자 점수만으로는 단계마다 절반 넘게 풀에 들지 못한다.
  for (const stage of ['1', '2', '3']) assert.ok(names.filter((n) => stageOf(n) === stage).length >= 2 * DEFAULT_STAGE_CAPS[stage], `${stage}단계`);
  const plain = generateCandidates(account, catalog);
  assert.ok(plain.summary.excluded.length >= 20);
});

test('속성이 다른 두 보스(크라켄·미러 컨테이너)의 1위 편성 멤버가 서로 다르다 — 덜 키운 약점 속성 니케가 후보에 들어 1위 편성에 든다', async () => {
  const two = { ...bundle, bosses: bundle.bosses.filter((b) => ['크라켄', '미러 컨테이너'].includes(b.name)) };
  assert.deepEqual(validateBossBundle(two).errors, []);
  assert.deepEqual(two.bosses.map((b) => [b.name, b.enemy.code, b.weak_to]), [['크라켄', '철갑', '풍압'], ['미러 컨테이너', '수냉', '전격']]);

  const budget = 40; // 보스마다 20건 — 1단계(멤버 조합)에 다 쓴다
  const report = await recommendIntercept({ account, bundle: two }, { budget, top: 3 }, { runtime: nodeRuntime });
  assert.equal(report.sims.budget, budget);
  assert.ok(report.sims.used <= budget, `시뮬 ${report.sims.used}건`);
  assert.equal(report.cache, null, '캐시 없이 실제 엔진으로 계산했다');
  const [kraken, mirror] = report.bosses;

  for (const b of [kraken, mirror]) {
    const weak = b.element.weak_to;
    assert.equal(b.status, 'computed', b.name);
    assert.deepEqual(b.failed, [], b.name);
    assert.ok(b.sims <= b.budget && b.budget === 20, b.name);
    assert.equal(b.ranking.length, 3, b.name);
    // 약점 속성이 우선 속성으로 넘어갔고, 단계마다 약점 속성 니케가 min(2, 보유 수)명 이상 후보 풀에 들었다.
    assert.equal(b.suggestion.priority.element, weak, b.name);
    assert.equal(b.suggestion.priority.active, true, b.name);
    for (const stage of ['1', '2', '3']) {
      const owned = Object.keys(account.nikkes).filter((n) => elementOf(n) === weak && stageOf(n) === stage).length;
      const pooled = b.suggestion.pool[stage].filter((n) => elementOf(n) === weak).length;
      assert.ok(pooled >= Math.min(2, owned), `${b.name} ${stage}단계: 약점 ${weak} ${pooled}/${owned}명`);
    }
    // 투자 점수만으로는 풀에 없었을 니케가 이름과 함께 남는다.
    assert.ok(b.weak_pool.promoted.length >= 1, b.name);
    for (const n of b.weak_pool.promoted) assert.equal(elementOf(n), weak, n);
    assert.match(b.notes.join('\n'), new RegExp(`약점 속성\\(${weak}\\) 우선으로 후보 풀에 넣은 니케: `), b.name);
    assert.match(b.caveats.join('\n'), /우선 속성이 아니었으면 그 단계의 후보 풀에 들지 못했을 니케/, b.name);
    // 1위 편성에 약점 속성 니케가 있고, 그 가운데 우선 속성 덕에 풀에 든(덜 키운) 니케가 있다.
    const top = membersOf(b.ranking[0]);
    assert.ok(top.some((n) => elementOf(n) === weak), `${b.name} 1위: ${top.join(', ')}`);
    assert.ok(top.some((n) => b.weak_pool.promoted.includes(n)), `${b.name} 1위에 우선 속성으로 든 니케가 없다: ${top.join(', ')}`);
  }

  // 두 보스의 후보 풀이 다르고, 1위 편성의 멤버가 다르다.
  assert.notDeepEqual(kraken.suggestion.pool, mirror.suggestion.pool);
  assert.ok(!sameSet(membersOf(kraken.ranking[0]), membersOf(mirror.ranking[0])), `두 보스의 1위가 같다: ${membersOf(kraken.ranking[0]).join(', ')}`);
  assert.match(report.caveats.join('\n'), /후보 편성은 보스마다 다르다/);

  // 견줌: 우선 속성 없이(종전 방식) 같은 예산으로 돌리면 두 보스의 후보가 같고 1위 편성도 같다 — 약점 속성을 우선한 쪽의 1위 총딜이 더 크다.
  const plain = [];
  for (const b of two.bosses) {
    plain.push(await suggestSquads({ account, condition: bossCondition(b, two.content) }, { top: 1, budget: 20 }, { runtime: nodeRuntime, catalog }));
  }
  assert.deepEqual(plain[0].suggestion.pool, plain[1].suggestion.pool);
  assert.equal(Object.hasOwn(plain[0].suggestion, 'priority'), false);
  assert.ok(sameSet(membersOf(plain[0].ranking[0]), membersOf(plain[1].ranking[0])), '우선 속성이 없으면 두 보스의 1위 편성이 같다');
  assert.ok(kraken.ranking[0].total_damage > plain[0].ranking[0].total_damage, `크라켄: ${kraken.ranking[0].total_damage} ≤ ${plain[0].ranking[0].total_damage}`);
  assert.ok(mirror.ranking[0].total_damage > plain[1].ranking[0].total_damage, `미러 컨테이너: ${mirror.ranking[0].total_damage} ≤ ${plain[1].ranking[0].total_damage}`);
});
