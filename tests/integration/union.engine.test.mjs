// 레이드 5덱(P-014)을 실제 엔진(vendor/nikke-calc)으로 돌리는 검증. 엔진 요청 서른 건 남짓 — 30~40초쯤 걸린다.
// 계정은 큰 시험 계정(data/samples/account.large.sample.json — 지어낸 계정 34명, 버스트 단계 10·10·14)이다.
// 본다: 겹치지 않는 덱이 셋 이상 나온다 · 예산을 넘지 않는다 · 같은 입력은 캐시로 바로 나오고 결과가 같다 · 고정한 덱 ·
//       솔로 레이드의 「속성만 정한 상대」(엔진에 프리셋이 없는 보스)와 미확인 표시.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createMemoryStore, withCache } from '../../src/core/cache.mjs';
import { resolveOpponent } from '../../src/core/deck.mjs';
import { allocateDecks } from '../../src/core/union.mjs';
import { engineVersion, nodeRuntime } from '../../src/runtime/node.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const account = read('data/samples/account.large.sample.json');
const condition = read('data/samples/condition.solo-raid.json');
const before = JSON.stringify(account);
const catalog = await nodeRuntime.loadCatalog();

// 메모리 캐시로 감싼 실제 런타임(디스크에는 쓰지 않는다). 엔진에 실제로 넘어간 편성을 적어 둔다.
const sent = [];
const runtime = withCache(
  {
    ...nodeRuntime,
    runBatch: async (requests, options) => {
      sent.push(...requests.map((r) => r.squad));
      return nodeRuntime.runBatch(requests, options);
    },
  },
  createMemoryStore(),
);
const BUDGET = 12;
const namesOf = (deck) => deck.members.map((m) => m.name);
const owned = new Set(Object.keys(account.nikkes));
let first = null;

test('큰 시험 계정: 솔로 레이드 프리셋 상대로 겹치지 않는 덱을 셋 이상(여기서는 다섯) 낸다 — 예산 안에서', async () => {
  assert.equal(account.is_test_data, true);
  const report = await allocateDecks({ account, condition }, { budget: BUDGET }, { runtime });
  first = report;
  assert.ok(report.made >= 3, `덱 ${report.made}개`);
  assert.equal(report.made, 5);
  const computed = report.decks.filter((d) => d.status === 'computed');
  const names = computed.flatMap(namesOf);
  assert.equal(names.length, computed.length * 5);
  assert.equal(new Set(names).size, names.length, '어떤 니케도 두 덱에 들어가지 않는다');
  assert.ok(names.every((n) => owned.has(n)), '보유한 니케만 쓴다');
  for (const d of computed) {
    assert.ok(d.total_damage > 0);
    assert.ok(Math.abs(d.members.reduce((s, m) => s + m.share, 0) - 1) < 1e-6);
    assert.ok(d.members.every((m) => m.damage >= 0));
  }
  assert.ok(Math.abs(report.total_damage - computed.reduce((s, d) => s + d.total_damage, 0)) < 1);
  // 예산: 엔진에 넘어간 요청 수가 예산 이하이고 결과에 적힌 수와 같다.
  assert.ok(sent.length <= BUDGET, `요청 ${sent.length}건`);
  assert.equal(report.search.sims, sent.length);
  assert.equal(report.cache.misses, sent.length);
  assert.ok(sent.every((squad) => squad.length === 5 && squad.every((n) => owned.has(n))));
  // 쓰지 않은 보유 니케, 가정, 엔진 버전, 캐시 통계.
  assert.equal(report.unused.length, owned.size - names.length);
  assert.ok(report.unused.every((n) => owned.has(n) && !names.includes(n)));
  assert.ok(report.assumptions.some((line) => line.includes('보스 프리셋: 솔로 레이드 S40')));
  assert.equal(report.engine.commit, engineVersion().commit);
  assert.deepEqual(report.cache.warnings, []);
  assert.equal(report.shortage, null);
  assert.ok(report.caveats.some((c) => c.startsWith('후보 덱은 덱 순서대로 만들었다')));
  // 받은 계정은 바뀌지 않는다.
  assert.equal(JSON.stringify(account), before);
});

test('같은 입력이면 같은 결과다 — 두 번째는 엔진을 부르지 않는다(캐시)', async () => {
  const count = sent.length;
  const again = await allocateDecks({ account, condition }, { budget: BUDGET }, { runtime });
  assert.equal(sent.length, count, '엔진을 다시 부르지 않는다');
  assert.equal(again.cache.misses, 0);
  assert.equal(again.cache.hits, again.search.sims);
  assert.deepEqual(again.decks, first.decks);
  assert.equal(again.total_damage, first.total_damage);
  assert.deepEqual(again.unused, first.unused);
  assert.deepEqual(again.search, first.search);
  assert.deepEqual(again.caveats, first.caveats);
});

test('덱 고정: 한 덱을 고정하고 나머지만 다시 찾는다 — 고정한 덱은 그대로이고 그 니케는 다른 덱에 없다', async () => {
  const pinned = namesOf(first.decks[1]);
  const report = await allocateDecks({ account, condition }, { decks: 3, budget: 6, refine: false, locked: { decks: [{ deck: 1, members: pinned }] } }, { runtime });
  assert.equal(report.made, 3);
  assert.equal(report.decks[0].lock, 'full');
  assert.deepEqual(namesOf(report.decks[0]), pinned);
  // 고정한 덱의 총딜은 같은 자리 순서의 계산 값 그대로다(첫 실행에서 이미 계산한 편성이다).
  assert.equal(report.decks[0].total_damage, first.decks[1].total_damage);
  const names = report.decks.flatMap(namesOf);
  assert.equal(new Set(names).size, 15);
  for (const d of report.decks.slice(1)) assert.ok(!namesOf(d).some((n) => pinned.includes(n)));
  assert.ok(report.search.sims <= 6);
});

test('솔로 레이드: 엔진에 프리셋이 없는 보스는 속성만 정해 계산한다 — 미확인 칸이 따라오고, 약점 속성 니케가 후보에 든다', async () => {
  // 덱 빌더·화면이 쓰는 「속성만 정하기」와 같은 길: 약점 풍압 → 적 속성 철갑.
  const opponent = resolveOpponent('element:풍압', { catalog });
  assert.equal(opponent.condition.enemy.code, '철갑');
  assert.ok(opponent.unconfirmed.length > 0, '방어력·코어 같은 칸은 미확인이다');
  assert.ok(opponent.unconfirmed.every((u) => u.field !== 'code'));
  const report = await allocateDecks({ account, condition: opponent.condition }, { decks: 3, budget: 8, refine: false }, { runtime });
  assert.ok(report.made >= 3);
  const names = report.decks.flatMap(namesOf);
  assert.equal(new Set(names).size, names.length);
  assert.ok(report.assumptions.some((line) => line.includes('보스 지정 없음')));
  assert.ok(report.caveats.some((c) => c.startsWith('적 속성이 조건에 적힌 덱은')));
  // 약점 속성(풍압) 니케가 실제로 계산된 덱에 들어 있다.
  assert.ok(names.some((n) => catalog.nikkes[n].element_code === '풍압'), names.join(', '));
  assert.ok(report.search.sims <= 8);
});
