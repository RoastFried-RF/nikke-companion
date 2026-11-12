// 덱 빌더(P-030)의 순수 함수: 편성 짜기·버스트 구성·상대 → 전투 조건·두 육성 기준·한 명 바꾸기·자리 순서·저장 문서·복사 글.
// 엔진은 가짜다(멤버와 자리에서 정해지는 값). 실제 엔진으로는 tests/integration/deck.engine.test.mjs가 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { withCache, createMemoryStore } from '../../src/core/cache.mjs';
import { compareSquads, GROWTH_ENGINE_DEFAULT, InputError } from '../../src/core/compare.mjs';
import {
  addSaved,
  burstCheck,
  clearSlot,
  compareOrders,
  DECK_SLOT_COUNT,
  deckFromRanking,
  deckKey,
  deckText,
  emptyDeckBook,
  emptySlots,
  evaluateDeck,
  growthLine,
  isFull,
  listOpponents,
  MAX_SAVED_DECKS,
  moveMember,
  placeMember,
  readDeckBook,
  removeMember,
  removeSaved,
  resolveOpponent,
  saveSlot,
  slotLabel,
  swapCandidates,
  swapOne,
} from '../../src/core/deck.mjs';
import { bossCondition, unconfirmedOf, validateBossBundle } from '../../src/core/intercept.mjs';
import { placementVariants } from '../../src/core/search.mjs';

const bundle = JSON.parse(fs.readFileSync(new URL('../../data/intercept/anomaly.json', import.meta.url), 'utf8'));

// 지어낸 카탈로그: 1단계 둘, 2단계 둘, 3단계 넷, 전 단계 하나. 「다」만 차지 무기다.
const stage = { 가: '1', 나: '2', 다: '3', 라: '3', 마: '3', 바: '2', 사: '3', 아: '1', 자: 'A', 차: '3' };
const catalog = {
  nikkes: Object.fromEntries(
    Object.entries(stage).map(([n, s]) => [n, { burst_stage: s, weapon_type: n === '다' ? 'SR' : 'AR', ...(n === '다' ? { full_charge_mult: 2.5 } : {}), element_code: '작열' }]),
  ),
  bosses: ['솔로 레이드 S40'],
};
// 「차」는 엔진은 알지만 보유하지 않았다. 「사」가 「마」보다 많이 키운 니케다.
const account = {
  schema_version: 1,
  is_test_data: true,
  name: '검증용',
  nikkes: { 가: {}, 나: {}, 다: {}, 라: {}, 마: { breakthrough: 1 }, 바: {}, 사: { breakthrough: 3 }, 아: {}, 자: {} },
};
const DECK = ['가', '나', '다', '라', '바'];
const now = () => new Date('2026-11-12T00:00:00Z');

/** 가짜 엔진: 총딜 = Σ 이름 코드 × (자리 + 1). 엔진 기본 스펙이면 두 배. 「마」가 들면 오류. */
function fakeEngine(log = []) {
  return async (requests) => {
    log.push(...requests);
    return requests.map((req) => {
      if (req.squad.includes('마')) return { error: { type: 'invalid_input', message: '스킬 미파싱: 마', path: '/squad' } };
      const scale = req.profile?.base === 'default' ? 2 : 1;
      const dmg = req.squad.map((n, i) => n.codePointAt(0) * (i + 1) * scale);
      const total = dmg.reduce((a, b) => a + b, 0);
      return { total_damage: total, members: req.squad.map((n, i) => ({ name: n, damage: dmg[i], share: dmg[i] / total })), warnings: [], spec: { profile: { ungrown: [] } }, evaluator: { repo: 'fake', commit: 'abc', dirty: false } };
    });
  };
}
const deps = (log) => ({ catalog, runBatch: fakeEngine(log), now });
const total = (members, scale = 1) => members.reduce((s, n, i) => s + n.codePointAt(0) * (i + 1) * scale, 0);
const kraken = () => resolveOpponent('boss:kraken', { bundle, catalog });

// ── 편성 짜기 ─────────────────────────────────────────────────────────────────

test('눌러 넣으면 첫 빈 자리에 들어가고, 같은 니케는 두 번 넣을 수 없다', () => {
  let slots = emptySlots();
  assert.deepEqual(slots, [null, null, null, null, null]);
  for (const name of ['가', '나']) slots = placeMember(slots, name).slots;
  assert.deepEqual(slots, ['가', '나', null, null, null]);

  const twice = placeMember(slots, '가');
  assert.match(twice.problem, /이미 편성에 있다 — 같은 니케를 두 번 넣을 수 없다/);
  assert.deepEqual(twice.slots, slots);
  assert.equal(twice.placed, null);

  // 자리를 골라 넣으면 그 자리의 니케를 갈아 끼운다. 다른 자리에 있는 니케는 넣지 못한다.
  assert.deepEqual(placeMember(slots, '다', 0).slots, ['다', '나', null, null, null]);
  assert.match(placeMember(slots, '나', 0).problem, /이미 편성에 있다/);

  for (const name of ['다', '라', '바']) slots = placeMember(slots, name).slots;
  assert.equal(isFull(slots), true);
  const over = placeMember(slots, '사');
  assert.match(over.problem, /다섯 자리가 모두 찼다/);
  assert.deepEqual(over.slots, DECK);
  assert.match(placeMember(slots, '사', 9).problem, /없는 자리/);
  assert.match(placeMember(slots, '').problem, /고르지 않았다/);
});

test('자리를 비우고, 두 자리를 맞바꾼다 — 받은 배열은 바꾸지 않는다', () => {
  const before = [...DECK];
  assert.deepEqual(removeMember(DECK, 1), ['가', null, '다', '라', '바']);
  assert.deepEqual(moveMember(DECK, 0, 4), ['바', '나', '다', '라', '가']);
  assert.deepEqual(moveMember(['가', null, null, null, null], 0, 2), [null, null, '가', null, null]);
  assert.deepEqual(moveMember(DECK, 2, 2), DECK);
  assert.deepEqual(moveMember(DECK, 2, 7), DECK);
  assert.deepEqual(DECK, before);
  // 같은 이름이 두 번 든 입력은 뒤의 것을 비운다.
  assert.deepEqual(removeMember(['가', '가', '나'], 4), ['가', null, '나', null, null]);
});

test('버스트 단계 구성: 무엇이 모자란지 바로 말한다', () => {
  const ok = burstCheck(DECK, catalog);
  assert.equal(ok.ok, true);
  assert.equal(ok.text, null);
  assert.deepEqual(ok.counts, { 1: 1, 2: 2, 3: 2, A: 0, unknown: 0 });

  // 1단계 없음.
  const no1 = burstCheck(['나', '바', '다', '라', '사'], catalog);
  assert.equal(no1.ok, false);
  assert.deepEqual(no1.missing, ['1']);
  assert.equal(no1.text, '버스트 1단계 니케가 없다. 풀 버스트가 열리지 않을 수 있다.');

  // 전 단계 니케는 빈 단계 하나를 채운다 — 둘이 비면 하나가 남는다.
  assert.equal(burstCheck(['자', '나', '다', '라', '사'], catalog).ok, true);
  const two = burstCheck(['자', '다', '라', '사', null], catalog);
  assert.equal(two.ok, false);
  assert.equal(two.uncovered, 1);
  assert.equal(two.text, '버스트 1·2단계 니케가 없다 — 어느 단계에서나 쓰는 니케 1명이 그중 1단계만 채운다.');

  // 자리가 덜 찼어도 지금 없는 단계를 말한다(「열리지 않을 수 있다」는 다 찼을 때만).
  const partial = burstCheck(['가', null, null, null, null], catalog);
  assert.equal(partial.full, false);
  assert.equal(partial.text, '버스트 2·3단계 니케가 없다.');
  assert.match(burstCheck(['가', '나', '다', '없는 니케', null], catalog).text, /버스트 단계를 모르는 니케가 1명 있다/);
});

// ── 상대 ──────────────────────────────────────────────────────────────────────

test('상대 목록: 이상 개체 보스 5종 → 엔진의 프리셋 → 약점 속성 다섯 + 속성 없음', () => {
  const list = listOpponents({ bundle, catalog });
  assert.deepEqual(list.filter((o) => o.kind === 'boss').map((o) => o.label), ['인디빌리아', '울트라', '하베스터', '크라켄', '미러 컨테이너']);
  assert.deepEqual(list.filter((o) => o.kind === 'preset').map((o) => o.key), ['preset:솔로 레이드 S40']);
  assert.deepEqual(list.filter((o) => o.kind === 'element').map((o) => o.label), ['약점 전격', '약점 수냉', '약점 작열', '약점 풍압', '약점 철갑', '속성 없음']);
  assert.equal(list.find((o) => o.key === 'boss:kraken').weak_to, '풍압');
  assert.equal(new Set(list.map((o) => o.key)).size, list.length);
  // 묶음도 카탈로그도 없으면 속성만 남는다.
  assert.equal(listOpponents().length, 6);
});

test('이상 개체 보스: 요격전 추천과 같은 전투 조건·같은 미확인 칸이다', () => {
  assert.equal(validateBossBundle(bundle).ok, true);
  const boss = bundle.bosses.find((b) => b.id === 'kraken');
  const o = kraken();
  assert.deepEqual(o.condition, bossCondition(boss, bundle.content));
  assert.deepEqual(o.unconfirmed, unconfirmedOf(boss).filter((u) => u.field !== 'weak_to'));
  assert.equal(o.unconfirmed.length, 7);
  assert.equal(o.element.weak_to, '풍압');
  assert.equal(o.element.code, '철갑');
  assert.deepEqual(o.flags, []);
  assert.equal(o.is_test_data, false);
  assert.match(o.notes.join(' '), /보스 패턴 미반영/);
  assert.equal(resolveOpponent('boss:없는보스', { bundle, catalog }), null);
});

test('솔로 레이드 프리셋: 엔진의 프리셋 이름 그대로 — 속성·약점은 모른다고 적는다', () => {
  const o = resolveOpponent('preset:솔로 레이드 S40', { bundle, catalog });
  assert.deepEqual(o.condition, { schema_version: 1, content: 'solo_raid', boss: '솔로 레이드 S40' });
  assert.equal(o.element.known, false);
  assert.equal(o.element.weak_to, null);
  assert.deepEqual(o.unconfirmed, []);
  assert.match(o.notes[0], /따로 알지 못한다/);
  // 엔진에 없는 프리셋은 고를 수 없다.
  assert.equal(resolveOpponent('preset:없는 프리셋', { bundle, catalog }), null);
});

test('속성만 정하기: 약점 속성 → 적 속성(엔진의 상성 규칙), 나머지는 전부 미확인이다. 속성 없음은 「속성 상성 미반영」', () => {
  const fire = resolveOpponent('element:작열', { bundle, catalog });
  assert.deepEqual(fire.condition, { schema_version: 1, content: 'custom', enemy: { code: '풍압' } });
  assert.equal(fire.element.weak_to, '작열');
  assert.deepEqual(fire.flags, []);
  // 고른 속성은 미확인이 아니다. 레벨 상한·전투 시간·방어력·코어·거리·파츠 둘·적정 거리 = 8칸.
  assert.deepEqual(fire.unconfirmed.map((u) => u.field), ['level_cap', 'duration', 'def', 'core_px', 'distance', 'has_parts', 'part_break_interval', 'optimal_range_weapons']);

  const none = resolveOpponent('element:none', { bundle, catalog });
  assert.deepEqual(none.condition, { schema_version: 1, content: 'custom' });
  assert.deepEqual(none.flags, ['속성 상성 미반영']);
  assert.equal(none.unconfirmed[0].field, 'code');
  assert.match(none.unconfirmed[0].text, /속성 상성 미반영/);
  assert.equal(none.unconfirmed.length, 9);

  for (const bad of ['element:불', 'element:', '크라켄', '', null, 'x:y']) assert.equal(resolveOpponent(bad, { bundle, catalog }), null, String(bad));
});

// ── 바로 계산 ─────────────────────────────────────────────────────────────────

test('compareSquads: growth가 engine_default인 편성은 계정 프로필 대신 엔진 기본 스펙으로 보낸다 — 주지 않으면 종전과 같다', async () => {
  const log = [];
  const condition = { schema_version: 1, content: 'custom' };
  const report = await compareSquads({ account, condition, squads: [{ name: '계정', members: DECK }, { name: '최대', members: DECK, growth: GROWTH_ENGINE_DEFAULT }] }, deps(log));
  assert.equal(log[0].profile.base, 'ungrown');
  assert.deepEqual(Object.keys(log[0].profile.chars), DECK);
  assert.deepEqual(log[1].profile, { base: 'default', chars: {}, _meta: { name: '엔진 기본 스펙' } });
  assert.equal(log[1].profile_level, 'fixed');
  const [max, mine] = report.ranking;
  assert.equal(max.name, '최대');
  assert.equal(max.growth, GROWTH_ENGINE_DEFAULT);
  assert.equal(max.level, 400);
  assert.equal('growth' in mine, false);
  assert.match(max.notes.join(' '), /육성 기준: 엔진 기본 스펙 — 계정의 육성 값을 쓰지 않았다/);
  assert.match(report.caveats.join('\n'), /「전부 최대」가 아니다/);

  // 레벨 상한이 있으면 상한 레벨로(계정의 동기화 레벨이 아니다) — 엔진 정책 sync에 실어 보낸다.
  const capped = [];
  await compareSquads(
    { account: { ...account, account: { synchro_level: 250 } }, condition: { ...condition, level_cap: 300 }, squads: [{ members: DECK, growth: GROWTH_ENGINE_DEFAULT }, { members: DECK }] },
    deps(capped),
  );
  assert.equal(capped[0].profile_level, 'sync');
  assert.equal(capped[0].profile._account.synchro_level, 300);
  assert.equal(capped[1].profile._account.synchro_level, 250);

  // 육성 기준을 주지 않은 비교의 결과에는 새 칸도 새 문장도 없다.
  const plain = await compareSquads({ account, condition, squads: [{ members: DECK }] }, deps());
  assert.equal(plain.caveats.some((c) => c.includes('엔진 기본 스펙')), false);
  assert.deepEqual(Object.keys(plain.ranking[0]).sort(), ['engine_warnings', 'members', 'name', 'notes', 'rank', 'relative_to_best', 'total_damage', 'ungrown_members']);
  // 모르는 육성 기준은 계산하지 않는다.
  const odd = await compareSquads({ account, condition, squads: [{ members: DECK, growth: 'max' }, { members: DECK }] }, deps());
  assert.match(odd.rejected[0].reasons.join(), /모르는 육성 기준/);
});

test('바로 계산: 두 육성 기준을 한 번에 계산해 나란히 둔다', async () => {
  const log = [];
  const report = await evaluateDeck({ account, opponent: kraken(), members: DECK }, deps(log));
  assert.equal(log.length, 2);
  assert.equal(report.kind, 'deck_report');
  assert.equal(report.key, deckKey(DECK, 'boss:kraken'));
  assert.deepEqual(report.members, DECK);
  assert.equal(report.results.account.status, 'computed');
  assert.equal(report.results.account.total_damage, total(DECK));
  assert.equal(report.results.engine_default.total_damage, total(DECK, 2));
  assert.deepEqual(report.results.account.members.map((m) => m.name), DECK);
  assert.ok(Math.abs(report.results.account.members.reduce((s, m) => s + m.share, 0) - 1) < 1e-9);
  assert.equal(report.growth.ratio, 0.5);
  assert.match(report.growth.text, /^지금 육성으로는 모두 최대 육성일 때의 50%다 — 같은 조합을 끝까지 키우면 /);
  assert.equal(report.opponent.unconfirmed.length, 7);
  assert.equal(report.account.is_test_data, true);
  assert.match(report.caveats[0], /어림한 값이다. 실제 전투 기록과 대조하지 않았다/);
  assert.match(report.caveats.join('\n'), /보스 패턴 미반영/);
  assert.match(report.caveats.join('\n'), /지원하지 않음: /);
  assert.match(report.caveats.join('\n'), /「전부 최대」가 아니다/);
  // 같은 입력이면 같은 문서다(시각 고정).
  assert.deepEqual(await evaluateDeck({ account, opponent: kraken(), members: DECK }, deps()), report);
});

test('바로 계산: 같은 편성·같은 상대는 캐시에서 바로 나온다(엔진을 다시 부르지 않는다)', async () => {
  const log = [];
  const runtime = withCache(
    { loadCatalog: () => catalog, engineVersion: () => ({ repo: 'fake', commit: 'abc', dirty: false }), runBatch: fakeEngine(log) },
    createMemoryStore(),
  );
  const first = await evaluateDeck({ account, opponent: kraken(), members: DECK }, { runtime, now });
  assert.deepEqual(first.cache, { hits: 0, misses: 2, stored: 2, warnings: [] });
  const again = await evaluateDeck({ account, opponent: kraken(), members: DECK }, { runtime, now });
  assert.deepEqual(again.cache, { hits: 2, misses: 0, stored: 0, warnings: [] });
  assert.equal(log.length, 2);
  assert.deepEqual(again.results, first.results);
  // 상대가 다르거나 자리 순서가 다르면 다른 계산이다.
  await evaluateDeck({ account, opponent: resolveOpponent('element:작열', { bundle, catalog }), members: DECK }, { runtime, now });
  await evaluateDeck({ account, opponent: kraken(), members: moveMember(DECK, 2, 3) }, { runtime, now });
  assert.equal(log.length, 6);
});

test('바로 계산: 덜 찬 편성·상대 없음은 계산하지 않고, 엔진이 계산하지 못한 편성은 0이 아니라 「계산하지 못함」이다', async () => {
  await assert.rejects(evaluateDeck({ account, opponent: kraken(), members: ['가', '나', null, null, null] }, deps()), (e) => e instanceof InputError && /다섯 자리를 모두 채워야 계산한다 \(지금 2명\)/.test(e.message));
  await assert.rejects(evaluateDeck({ account, opponent: null, members: DECK }, deps()), /상대/);

  const failed = await evaluateDeck({ account, opponent: kraken(), members: ['가', '나', '다', '라', '마'] }, deps());
  assert.equal(failed.results.account.status, 'failed');
  assert.equal(failed.results.account.error.message, '스킬 미파싱: 마');
  assert.equal('total_damage' in failed.results.account, false);
  assert.equal(failed.growth, null);

  // 보유하지 않은 니케가 든 편성은 엔진에 보내지 않는다.
  const log = [];
  const rejected = await evaluateDeck({ account, opponent: kraken(), members: ['가', '나', '다', '라', '차'] }, deps(log));
  assert.equal(log.length, 0);
  assert.equal(rejected.results.account.status, 'rejected');
  assert.match(rejected.results.account.reasons.join(), /보유하지 않은 니케: 차/);
});

test('육성 비교 한 줄: 비율만 말하고, 기준 이상이면 그렇게 말한다 — 둘 중 하나라도 없으면 말하지 않는다', () => {
  assert.equal(growthLine(760000000, 1000000000).text, '지금 육성으로는 모두 최대 육성일 때의 76%다 — 같은 조합을 끝까지 키우면 10.00억까지 오른다. 그 값도 낮으면 조합을 바꿔 본다.');
  assert.match(growthLine(12, 10).text, /120%다 — 이 편성은 기준만큼\(또는 그 이상\) 키웠다/);
  for (const [a, b] of [[null, 10], [10, 0], [10, Number.NaN], [-1, 10]]) assert.equal(growthLine(a, b), null);
});

// ── 한 명을 바꾼다면 ──────────────────────────────────────────────────────────

test('바꿔 볼 니케: 같은 버스트 묶음의 보유 니케만, 많이 키운 순으로 상한까지', () => {
  // 3번 자리 「다」(3단계): 편성에 없는 3단계 보유 니케 사·마와 전 단계 니케 자(3단계 묶음). 「차」는 미보유다.
  const all = swapCandidates({ members: DECK, slot: 2, account, catalog });
  assert.deepEqual(all, { out: '다', group: '3', candidates: ['사', '마', '자'], skipped: [], total: 3 });
  const capped = swapCandidates({ members: DECK, slot: 2, account, catalog, limit: 1 });
  assert.deepEqual(capped.candidates, ['사']);
  assert.deepEqual(capped.skipped, ['마', '자']);
  assert.deepEqual(swapCandidates({ members: DECK, slot: 0, account, catalog }).candidates, ['아']);
  // 빈 자리·없는 자리에는 넣어 볼 것이 없다.
  assert.deepEqual(swapCandidates({ members: ['가', null, null, null, null], slot: 1, account, catalog }).candidates, []);
  assert.equal(swapCandidates({ members: DECK, slot: 9, account, catalog }).out, null);
});

test('한 명을 바꾼다면: 하나씩 넣어 계산하고 총딜 변화 순으로 — 계산하지 못한 니케와 상한 때문에 못 본 니케를 적는다', async () => {
  const log = [];
  const report = await swapOne({ account, opponent: kraken(), members: DECK, slot: 2 }, { limit: 2 }, deps(log));
  // 지금 편성 + 넣어 본 둘(사·마). 「마」는 가짜 엔진이 계산하지 못한다.
  assert.deepEqual(log.map((r) => r.squad[2]), ['다', '사', '마']);
  assert.equal(report.kind, 'deck_swap');
  assert.equal(report.out, '다');
  assert.equal(report.baseline.total_damage, total(DECK));
  assert.deepEqual(report.rows.map((r) => r.name), ['사']);
  const swapped = ['가', '나', '사', '라', '바'];
  assert.deepEqual(report.rows[0].members, swapped);
  assert.equal(report.rows[0].total_damage, total(swapped));
  assert.ok(Math.abs(report.rows[0].change - (total(swapped) - total(DECK)) / total(DECK)) < 1e-12);
  assert.deepEqual(report.failed, [{ name: '마', reason: '스킬 미파싱: 마' }]);
  assert.deepEqual(report.skipped, ['자']);
  assert.deepEqual(report.candidates, { total: 3, limit: 2, computed: 1, failed: 1, skipped: 1 });
  assert.match(report.caveats.join('\n'), /한 번에 2명까지만 계산한다\(많이 키운 순\). 보지 못한 니케 1명: 자\./);
  assert.match(report.caveats.join('\n'), /계산하지 못한 니케 1명 — 0으로 두지 않고 뺐다: 마\./);

  // 총딜이 큰 순이다(늘어나는 것이 위).
  const wide = await swapOne({ account: { ...account, nikkes: { ...account.nikkes, 마: undefined, 차: {} } }, opponent: kraken(), members: DECK, slot: 2 }, {}, deps()).catch((e) => e);
  assert.ok(wide instanceof InputError, '계정이 잘못되면 계산하지 않는다');
  const two = await swapOne({ account, opponent: kraken(), members: DECK, slot: 1 }, {}, deps());
  assert.deepEqual(two.rows.map((r) => r.name), []); // 2단계 보유 니케는 나·바뿐이고 둘 다 편성에 있다
  assert.equal(two.candidates.total, 0);
  await assert.rejects(swapOne({ account, opponent: kraken(), members: DECK, slot: 7 }, {}, deps()), /바꿀 자리가 없다/);
  await assert.rejects(swapOne({ account, opponent: kraken(), members: DECK, slot: 0 }, { limit: 0 }, deps()), /limit/);
});

// ── 자리 순서 비교 ────────────────────────────────────────────────────────────

test('자리 순서 비교: P-013의 자리 변형을 계산해 가장 좋은 순서와 지금 순서의 차이를 낸다', async () => {
  // 가짜 엔진은 뒤 자리일수록 딜이 크다 — 같은 단계 안에서 이름 코드가 큰 니케가 앞에 선 편성은 순서를 바꾸면 오른다.
  const ORDER = ['가', '바', '라', '다', '나'];
  const variants = placementVariants(ORDER, catalog);
  assert.ok(variants.length >= 3);
  const log = [];
  const report = await compareOrders({ account, opponent: kraken(), members: ORDER }, {}, deps(log));
  // 지금 순서 + 변형 전부.
  assert.equal(log.length, 1 + variants.length);
  assert.deepEqual(log.slice(1).map((r) => r.squad), variants.map((v) => v.members));
  const best = [ORDER, ...variants.map((v) => v.members)].reduce((a, b) => (total(b) > total(a) ? b : a));
  assert.notDeepEqual(best, ORDER);
  assert.deepEqual(report.best.members, best);
  assert.equal(report.best.total_damage, total(best));
  assert.deepEqual(report.current, { members: ORDER, total_damage: total(ORDER) });
  assert.equal(report.changed, true);
  assert.ok(report.gain_ratio > 1);
  assert.ok(Math.abs(report.gain_ratio - total(best) / total(ORDER)) < 1e-12);
  assert.match(report.gain_text, /^1\d\d\.\d+%$/);
  assert.ok(report.changes.length > 0);
  assert.deepEqual(report.variants, { total: variants.length, simulated: variants.length, skipped: 0, failed: 0, limit: 24 });
  assert.deepEqual([...report.best.members].sort(), [...ORDER].sort());

  // 지금 순서가 이미 가장 좋으면 그렇게 말한다(바꾼 것이 없다).
  const kept = await compareOrders({ account, opponent: kraken(), members: DECK }, {}, deps());
  assert.equal(kept.changed, false);
  assert.deepEqual(kept.best.members, DECK);
  assert.deepEqual(kept.changes, []);
  assert.equal(kept.gain_ratio, 1);

  // 상한: 앞에서부터 그만큼만 계산하고, 못 본 수를 적는다.
  const few = [];
  const capped = await compareOrders({ account, opponent: kraken(), members: ORDER }, { limit: 1 }, deps(few));
  assert.equal(few.length, 2);
  assert.equal(capped.variants.skipped, variants.length - 1);
  assert.match(capped.caveats.join('\n'), new RegExp(`한 번에 1가지까지만 계산한다. 자리 변형 ${variants.length}가지 중 ${variants.length - 1}가지는 보지 못했다`));
  assert.ok(capped.best.total_damage >= capped.current.total_damage);

  // 지금 편성을 계산하지 못하면 견줄 것이 없다.
  await assert.rejects(compareOrders({ account, opponent: kraken(), members: ['가', '나', '다', '라', '마'] }, {}, deps()), /지금 편성을 계산하지 못했다.*스킬 미파싱/);
});

// ── 내 편성 ───────────────────────────────────────────────────────────────────

test('내 편성: 다섯 칸(01~05)과 이름 붙인 목록 — 저장하고 비우고 지운다', () => {
  let book = emptyDeckBook();
  assert.equal(book.slots.length, DECK_SLOT_COUNT);
  assert.deepEqual([0, 4].map(slotLabel), ['01', '05']);
  const deck = { members: DECK, opponent: 'boss:kraken', opponent_label: '크라켄', total_damage: 123 };
  const saved = saveSlot(book, 1, deck, { now: '2026-11-12T00:00:00.000Z' });
  assert.deepEqual(saved.slots[1], { name: '편성 02', members: DECK, opponent: 'boss:kraken', opponent_label: '크라켄', total_damage: 123, saved_at: '2026-11-12T00:00:00.000Z' });
  assert.deepEqual(book.slots, [null, null, null, null, null], '받은 묶음은 바꾸지 않는다');
  book = saveSlot(saved, 1, { ...deck, name: '크라켄용', members: ['가', null, null, null, null], total_damage: null });
  assert.equal(book.slots[1].name, '크라켄용');
  assert.deepEqual(book.slots[1].members, ['가', null, null, null, null]);
  assert.equal(book.slots[1].total_damage, null);
  assert.deepEqual(clearSlot(book, 1).slots, [null, null, null, null, null]);
  assert.throws(() => saveSlot(book, 5, deck), /칸은 01~05/);

  book = addSaved(book, { ...deck, name: ' 솔레 1덱 ' });
  book = addSaved(book, { ...deck, name: '솔레 2덱' });
  assert.deepEqual(book.saved.map((d) => [d.id, d.name]), [['d2', '솔레 2덱'], ['d1', '솔레 1덱']]);
  book = removeSaved(book, 'd1');
  book = addSaved(book, { ...deck, name: '셋째' });
  assert.deepEqual(book.saved.map((d) => d.id), ['d3', 'd2']);

  // 저장하지 않는 것: 이름 없는 목록 항목, 빈 편성, 같은 니케 두 번, 다섯 자리가 아닌 것, 너무 긴 이름.
  assert.throws(() => addSaved(book, deck), /이름을 적어야 한다/);
  assert.throws(() => saveSlot(book, 0, { members: [null, null, null, null, null] }), /빈 편성/);
  assert.throws(() => saveSlot(book, 0, { members: ['가', '가', null, null, null] }), /두 번/);
  assert.throws(() => saveSlot(book, 0, { members: ['가'] }), /다섯 자리/);
  assert.throws(() => saveSlot(book, 0, { members: DECK, name: '가'.repeat(31) }), /30자/);
  let full = emptyDeckBook();
  for (let i = 0; i < MAX_SAVED_DECKS; i += 1) full = addSaved(full, { ...deck, name: `덱 ${i}` });
  assert.throws(() => addSaved(full, { ...deck, name: '넘침' }), /50개까지/);
});

test('내 편성: 디스크의 문서를 읽는다 — 다시 읽어도 같고, 읽을 수 없는 편성은 빼고 센다', () => {
  let book = saveSlot(emptyDeckBook(), 0, { members: DECK, name: '하나' }, { now: '2026-11-12T00:00:00.000Z' });
  book = addSaved(book, { members: DECK, name: '둘', opponent: 'element:작열' });
  const round = readDeckBook(JSON.parse(JSON.stringify(book)));
  assert.deepEqual(round, { book, dropped: 0 });

  assert.deepEqual(readDeckBook(null), { book: emptyDeckBook(), dropped: 0 });
  for (const other of [{ kind: 'intercept_plan', schema_version: 1 }, { kind: 'deck_book', schema_version: 2, slots: [], saved: [] }, [1], 'x']) {
    assert.deepEqual(readDeckBook(other).book, emptyDeckBook());
  }
  const dirty = {
    schema_version: 1,
    kind: 'deck_book',
    slots: [{ members: ['가', '가', null, null, null] }, book.slots[0], '글자'],
    saved: [book.saved[0], { ...book.saved[0] }, { members: DECK, name: 'id 없음' }, { id: 'd9', members: 'x' }],
  };
  const read = readDeckBook(dirty);
  assert.equal(read.dropped, 5);
  assert.deepEqual(read.book.slots, [null, book.slots[0], null, null, null]);
  assert.deepEqual(read.book.saved, [book.saved[0]]);
});

test('요격전 추천의 편성을 가져온다: 자리 순서 그대로, 상대는 그 보스', () => {
  const entry = { members: DECK.map((name) => ({ name, damage: 1, share: 0.2 })) };
  assert.deepEqual(deckFromRanking(entry, 'kraken'), { members: DECK, opponent: 'boss:kraken' });
  assert.deepEqual(deckFromRanking({ members: ['가', '나'] }), { members: ['가', '나', null, null, null], opponent: null });
  assert.deepEqual(deckFromRanking(null).members, [null, null, null, null, null]);
});

test('편성을 글자로: 자리 순서대로 이름, 상대, 총딜, 「추정」 표시', () => {
  assert.equal(
    deckText({ members: DECK, opponent_label: '크라켄', weak_to: '풍압', total_damage: 2562132901 }),
    ['편성: 1. 가 / 2. 나 / 3. 다 / 4. 라 / 5. 바', '상대: 크라켄 (약점 풍압)', '총딜 25.62억 (추정 · 실전 미대조 · 내 계정 육성 기준)'].join('\n'),
  );
  // 계산하지 않았으면 총딜을 지어내지 않는다. 빈 자리는 빈 자리다.
  assert.equal(deckText({ members: ['가', null, '다'], opponent_label: '약점 작열', weak_to: '작열' }), ['편성: 1. 가 / 2. (빈 자리) / 3. 다 / 4. (빈 자리) / 5. (빈 자리)', '상대: 약점 작열', '총딜 계산 전'].join('\n'));
  assert.match(deckText({ members: DECK }), /상대: 정하지 않음/);
  assert.match(deckText({ members: DECK, total_damage: 10, basis: 'engine_default' }), /모두 최대 육성 기준/);
});
