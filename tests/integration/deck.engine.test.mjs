// 덱 빌더(P-030)를 실제 엔진(vendor/nikke-calc)으로 돌리는 검증. 수십 초 걸린다(엔진 요청 열 건 남짓).
// 계정은 검증용 샘플(data/samples/account.sample.json), 보스 값은 내장 묶음(data/intercept/anomaly.json)이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createMemoryStore, withCache } from '../../src/core/cache.mjs';
import { compareSquads } from '../../src/core/compare.mjs';
import { compareOrders, deckText, evaluateDeck, resolveOpponent, swapOne } from '../../src/core/deck.mjs';
import { placementVariants } from '../../src/core/search.mjs';
import { engineVersion, nodeRuntime } from '../../src/runtime/node.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const account = read('data/samples/account.sample.json');
const bundle = read('data/intercept/anomaly.json');
const catalog = await nodeRuntime.loadCatalog();
const DECK = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];

// 메모리 캐시로 감싼 실제 런타임 — 「같은 편성·같은 상대는 캐시로 바로 나온다」를 실제 엔진 판으로 본다(디스크에는 쓰지 않는다).
const calls = [];
const runtime = withCache(
  {
    ...nodeRuntime,
    runBatch: async (requests, options) => {
      calls.push(requests.length);
      return nodeRuntime.runBatch(requests, options);
    },
  },
  createMemoryStore(),
);
const kraken = resolveOpponent('boss:kraken', { bundle, catalog });

test('바로 계산: 샘플 계정의 편성을 크라켄 상대로 두 육성 기준으로 계산한다 — 다시 계산하면 엔진을 부르지 않는다', async () => {
  assert.ok(kraken, '내장 묶음에 크라켄이 있다');
  const report = await evaluateDeck({ account, opponent: kraken, members: DECK }, { runtime });
  const mine = report.results.account;
  const max = report.results.engine_default;
  assert.equal(mine.status, 'computed', JSON.stringify(mine));
  assert.equal(max.status, 'computed', JSON.stringify(max));
  assert.ok(mine.total_damage > 0 && max.total_damage > 0);
  assert.deepEqual(mine.members.map((m) => m.name), DECK);
  assert.ok(Math.abs(mine.members.reduce((s, m) => s + m.share, 0) - 1) < 1e-6);
  // 샘플 계정은 소장품·애장품·큐브를 적지 않았다 — 엔진 기본 스펙보다 낮아야 한다.
  assert.ok(max.total_damage > mine.total_damage, `${max.total_damage} > ${mine.total_damage}`);
  assert.ok(report.growth.ratio > 0 && report.growth.ratio < 1);
  assert.equal(report.engine.commit, engineVersion().commit);
  assert.equal(max.level, 400);
  assert.equal(report.opponent.unconfirmed.length, 7);
  assert.deepEqual(report.cache.warnings, []);
  assert.equal(report.cache.misses, 2);

  // 엔진 기본 스펙 편성의 값은 프로필 없이 돌린 값(= 엔진의 기본 스펙)과 같다.
  const [bare] = await nodeRuntime.runBatch([{ squad: DECK, sim: { expected: true, duration: 180 }, enemy: kraken.condition.enemy }]);
  assert.equal(bare.error, undefined, JSON.stringify(bare.error));
  assert.equal(max.total_damage, bare.total_damage);

  const before = calls.length;
  const again = await evaluateDeck({ account, opponent: kraken, members: DECK }, { runtime });
  assert.equal(calls.length, before, '같은 편성·같은 상대는 엔진을 다시 부르지 않는다');
  assert.deepEqual(again.cache, { hits: 2, misses: 0, stored: 0, warnings: [] });
  assert.deepEqual(again.results, report.results);

  assert.match(deckText({ members: DECK, opponent_label: kraken.label, weak_to: kraken.element.weak_to, total_damage: mine.total_damage }), /상대: 크라켄 \(약점 풍압\)\n총딜 \d+\.\d\d억 \(추정 · 실전 미대조 · 내 계정 육성 기준\)$/);
});

test('한 명을 바꾼다면: 5번 자리(앨리스)에 같은 버스트 묶음의 보유 니케를 넣어 본다', async () => {
  const report = await swapOne({ account, opponent: kraken, members: DECK, slot: 4 }, {}, { runtime });
  assert.equal(report.out, '앨리스');
  assert.equal(report.group, '3');
  // 샘플 계정의 3단계 보유 니케 가운데 편성에 없는 것.
  const expected = Object.keys(account.nikkes).filter((n) => !DECK.includes(n) && ['3', 'A'].includes(catalog.nikkes[n].burst_stage));
  assert.deepEqual([...report.rows.map((r) => r.name), ...report.failed.map((f) => f.name)].sort(), [...expected].sort());
  assert.equal(report.baseline.status, 'computed');
  for (const row of report.rows) {
    assert.ok(row.total_damage > 0);
    assert.ok(Math.abs(row.change - (row.total_damage - report.baseline.total_damage) / report.baseline.total_damage) < 1e-12);
    assert.equal(row.members[4], row.name);
  }
  assert.deepEqual(report.skipped, []);
});

test('자리 순서 비교: 자리 변형 셋을 계산해 지금 순서 이상인 순서를 낸다', async () => {
  const report = await compareOrders({ account, opponent: kraken, members: DECK }, { limit: 3 }, { runtime });
  const all = placementVariants(DECK, catalog);
  assert.equal(report.variants.total, all.length);
  assert.equal(report.variants.simulated, 3);
  assert.equal(report.variants.skipped, all.length - 3);
  assert.ok(report.best.total_damage >= report.current.total_damage);
  assert.deepEqual([...report.best.members].sort(), [...DECK].sort());
  assert.equal(report.changed, report.best.total_damage > report.current.total_damage);
  if (report.changed) assert.ok(report.changes.length > 0);
});

test('엔진 기본 스펙 + 레벨 상한: 상한 레벨로 계산된다(엔진 정책 sync)', async () => {
  const condition = { schema_version: 1, content: 'custom', level_cap: 300 };
  const report = await compareSquads({ account, condition, squads: [{ name: '최대', members: DECK, growth: 'engine_default' }] }, { runtime: nodeRuntime });
  assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
  assert.equal(report.ranking[0].level, 300);
  assert.match(report.ranking[0].engine_warnings.join('\n'), /동기화 소대 레벨 300/);
});
