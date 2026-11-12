// 시뮬 결과 캐시(src/core/cache.mjs)와 Node 파일 저장소(src/runtime/node.mjs). 엔진은 부르지 않는다 — 가짜 런타임.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CACHE_SCHEMA_VERSION,
  cacheKey,
  canonicalJson,
  createMemoryStore,
  isCacheableRequest,
  isDeterministic,
  normalizeRequest,
  sha256Hex,
  withCache,
} from '../../src/core/cache.mjs';
import { suggestSquads } from '../../src/core/candidates.mjs';
import { compareSquads } from '../../src/core/compare.mjs';
import { compareGrowth } from '../../src/core/growth.mjs';
import { cacheLines, renderGrowthReport, renderReport } from '../../src/core/render.mjs';
import { createFileCacheStore, DEFAULT_CACHE_DIR } from '../../src/runtime/node.mjs';

const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const CLEAN = { repo: 'fake/engine', commit: COMMIT, dirty: false };
const now = () => new Date('2026-11-12T00:00:00Z');

/** 기대값 모드(결정론) 요청. */
const req = (squad, extra = {}) => ({ squad, sim: { expected: true, duration: 180 }, ...extra });

/** 편성과 시뮬 칸에서 정해지는 가짜 총딜 — 같은 요청이면 같은 값, 배치 순서가 다르면 다른 값. */
function fakeRow(request, evaluator) {
  if (request.squad.includes('오류')) return { error: { type: 'invalid_input', message: '가짜 오류', path: '/squad' } };
  const damages = request.squad.map((name, slot) => [...name].reduce((s, ch) => s + ch.codePointAt(0), 0) * (slot + 1));
  const total = damages.reduce((a, b) => a + b, 0) + (request.sim?.duration ?? 0);
  return {
    total_damage: total,
    members: request.squad.map((name, i) => ({ name, damage: damages[i], share: damages[i] / total })),
    warnings: [],
    ...(evaluator === undefined ? {} : { evaluator }),
  };
}

/**
 * 호출을 적어 두는 가짜 런타임. 실제 런타임처럼 줄마다 `id`(받은 배치에서의 자리)를 붙인다.
 * `version`은 값이거나 함수(던질 수도 있다), `evaluator`는 결과 줄에 실을 평가기 판.
 */
function fakeRuntime({ version = CLEAN, evaluator } = {}) {
  const rt = {
    batches: [],
    options: [],
    versionCalls: 0,
    loadCatalog: () => ({ nikkes: {}, bosses: [] }),
    engineVersion: async () => {
      rt.versionCalls += 1;
      return typeof version === 'function' ? version() : version;
    },
    runBatch: async (requests, options) => {
      rt.batches.push(requests);
      rt.options.push(options);
      return requests.map((r, id) => ({ ...fakeRow(r, evaluator), id }));
    },
  };
  return rt;
}

const sent = (rt) => rt.batches.map((b) => b.map((r) => r.squad.join('')));
const totals = (results) => results.map((r) => r.total_damage ?? null);
const stats = (cache) => [cache.hits, cache.misses, cache.stored];

// ── 키 정규화 ─────────────────────────────────────────────────────────────────

test('정규화된 JSON은 키 순서와 무관하고 배열 순서는 지킨다', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.notEqual(canonicalJson(['가', '나']), canonicalJson(['나', '가']));
  // 값이 undefined인 키는 JSON.stringify처럼 없는 것으로 본다. 배열 안에서는 null이다.
  assert.equal(canonicalJson({ a: undefined, b: [undefined] }), '{"b":[null]}');
  assert.equal(canonicalJson('한글 "따옴표"'), JSON.stringify('한글 "따옴표"'));
  assert.equal(canonicalJson(180.0), '180');
  // 정렬은 로케일이 아니라 코드 단위 순이다.
  assert.equal(canonicalJson({ 나: 1, 가: 2, B: 3, a: 4 }), '{"B":3,"a":4,"가":2,"나":1}');
});

test('SHA-256은 Web Crypto로 계산한 표준 값이다', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(await sha256Hex('한글'), /^[0-9a-f]{64}$/);
});

test('캐시 키: 키 순서·호출용 칸(id)과 무관하고, 내용이나 엔진 커밋이 다르면 다르다', async () => {
  const base = { squad: ['가', '나'], sim: { expected: true, duration: 180 }, profile: { base: 'ungrown', chars: { 가: { breakthrough: 3 } } } };
  const key = await cacheKey(COMMIT, base);
  assert.match(key, /^[0-9a-f]{64}$/);

  const reordered = { profile: { chars: { 가: { breakthrough: 3 } }, base: 'ungrown' }, sim: { duration: 180, expected: true }, squad: ['가', '나'] };
  assert.equal(await cacheKey(COMMIT, reordered), key, '키 순서');
  assert.equal(await cacheKey(COMMIT, { ...base, id: 7 }), key, 'id');
  assert.equal(await cacheKey(COMMIT, { id: 's1', ...base }), key, 'id');
  assert.deepEqual(normalizeRequest({ id: 3, squad: ['가'] }), { squad: ['가'] });

  assert.notEqual(await cacheKey(OTHER_COMMIT, base), key, '엔진 커밋');
  assert.notEqual(await cacheKey(COMMIT, { ...base, squad: ['나', '가'] }), key, '배치 순서');
  assert.notEqual(await cacheKey(COMMIT, { ...base, sim: { expected: true, duration: 60 } }), key, '전투 시간');
  assert.notEqual(await cacheKey(COMMIT, { ...base, boss: '보스' }), key, '보스');
  assert.notEqual(await cacheKey(COMMIT, { ...base, profile: { base: 'ungrown', chars: { 가: { breakthrough: 2 } } } }), key, '육성');
  // 호출용 칸은 맨 위의 id뿐이다. 안쪽의 id는 내용이다.
  assert.notEqual(await cacheKey(COMMIT, { ...base, chars: { 가: { id: 1 } } }), await cacheKey(COMMIT, { ...base, chars: { 가: { id: 2 } } }));
  // 커밋과 요청의 경계가 섞이지 않는다.
  assert.notEqual(await cacheKey('ab', { squad: ['c'] }), await cacheKey('a', { squad: ['bc'] }));
});

// ── 저장 조건 ─────────────────────────────────────────────────────────────────

test('결정론 판정: 기대값 모드이거나 시드를 준 요청만', () => {
  assert.equal(isDeterministic({ squad: ['가'], sim: { expected: true } }), true);
  assert.equal(isDeterministic({ squad: ['가'], sim: { seed: 7 } }), true);
  assert.equal(isDeterministic({ squad: ['가'], sim: { seed: 0 } }), true);
  assert.equal(isDeterministic({ squad: ['가'], sim: { expected: false, seed: 7 } }), true);
  for (const sim of [undefined, {}, { expected: false }, { expected: 'true' }, { expected: 1 }, { seed: null }, { seed: '7' }, { seed: 1.5 }, { duration: 180 }]) {
    assert.equal(isDeterministic({ squad: ['가'], sim }), false, JSON.stringify(sim));
  }
  assert.equal(isDeterministic(null), false);
});

test('요청 밖의 파일을 가리키는 요청은 결정론이어도 저장 대상이 아니다', () => {
  assert.equal(isCacheableRequest(req(['가'], { profile: { base: 'ungrown', chars: {} }, boss: '솔로 레이드 S40' })), true);
  assert.equal(isCacheableRequest(req(['가'], { boss: { def: 1 } })), true);
  assert.equal(isCacheableRequest(req(['가'], { profile: 'me' })), false, '이름으로 가리킨 프로필 파일');
  assert.equal(isCacheableRequest(req(['가'], { boss: 'scripts/내 보스.JSON' })), false, '보스 스크립트 파일 경로');
  assert.equal(isCacheableRequest({ squad: ['가'] }), false);
});

test('결정론 요청은 저장되고 다음에는 엔진에 보내지 않는다', async () => {
  const store = createMemoryStore();
  const rt = fakeRuntime();
  const cached = withCache(rt, store, { now });
  const requests = [req(['가', '나']), req(['다']), { squad: ['라'], sim: { seed: 7, duration: 60 } }];

  const first = await cached.runBatchWithStats(requests, { concurrency: 2 });
  assert.deepEqual(stats(first.cache), [0, 3, 3]);
  assert.deepEqual(first.cache.warnings, []);
  assert.equal(store.size, 3);

  const second = await cached.runBatchWithStats(requests);
  assert.deepEqual(stats(second.cache), [3, 0, 0]);
  assert.equal(rt.batches.length, 1, '두 번째에는 엔진을 부르지 않는다');
  assert.deepEqual(second.results, first.results, '수치와 줄의 모양이 같다');
  assert.deepEqual(first.results.map((r) => r.id), [0, 1, 2]);
});

test('저장된 항목의 형식: 판·키·엔진·정규화된 요청·결과(id 없음)·저장 시각', async () => {
  const store = createMemoryStore();
  const cached = withCache(fakeRuntime({ evaluator: CLEAN }), store, { now });
  const request = { id: 'x', sim: { duration: 180, expected: true }, squad: ['가', '나'] };
  await cached.runBatch([request]);
  const key = await cacheKey(COMMIT, request);
  const entry = store.get(key);
  assert.deepEqual(Object.keys(entry), ['cache_schema_version', 'key', 'engine', 'request', 'result', 'stored_at']);
  assert.equal(entry.cache_schema_version, CACHE_SCHEMA_VERSION);
  assert.equal(entry.key, key);
  assert.deepEqual(entry.engine, { repo: 'fake/engine', commit: COMMIT });
  assert.deepEqual(entry.request, { sim: { duration: 180, expected: true }, squad: ['가', '나'] });
  assert.equal('id' in entry.result, false);
  assert.equal(entry.result.total_damage, fakeRow(request).total_damage);
  assert.deepEqual(entry.result.evaluator, CLEAN);
  assert.equal(entry.stored_at, '2026-11-12T00:00:00.000Z');
});

test('비결정론 요청과 오류 결과는 저장하지도 읽지도 않는다', async () => {
  const store = createMemoryStore();
  const rt = fakeRuntime();
  const cached = withCache(rt, store);
  const requests = [
    { squad: ['가'] }, // sim 없음 — 실행마다 다르다
    { squad: ['나'], sim: { duration: 180 } },
    { squad: ['다'], sim: { expected: false } },
    req(['오류']),
    req(['라'], { profile: 'me' }),
    req(['마']),
  ];
  const first = await cached.runBatchWithStats(requests);
  assert.deepEqual(stats(first.cache), [0, 6, 1], '저장되는 것은 결정론이고 오류가 아닌 한 건뿐이다');
  assert.equal(first.results[3].error.message, '가짜 오류');
  assert.deepEqual(first.cache.warnings, []);

  const second = await cached.runBatchWithStats(requests);
  assert.deepEqual(stats(second.cache), [1, 5, 0]);
  assert.deepEqual(sent(rt)[1], ['가', '나', '다', '오류', '라'], '저장하지 않은 요청은 매번 엔진에 간다');
  assert.equal(second.results[3].error.message, '가짜 오류');
  assert.equal(store.size, 1);
});

test('엔진 커밋이 다르면 다른 키다 — 엔진이 바뀌면 옛 결과를 쓰지 않는다', async () => {
  const store = createMemoryStore();
  let commit = COMMIT;
  const rt = fakeRuntime({ version: () => ({ repo: 'fake/engine', commit, dirty: false }) });
  const cached = withCache(rt, store);
  const requests = [req(['가']), req(['나'])];
  await cached.runBatch(requests);

  commit = OTHER_COMMIT;
  const after = await cached.runBatchWithStats(requests);
  assert.deepEqual(stats(after.cache), [0, 2, 2]);
  assert.equal(store.size, 4);

  commit = COMMIT;
  assert.deepEqual(stats((await cached.runBatchWithStats(requests)).cache), [2, 0, 0], '원래 판으로 돌아오면 그 판의 결과를 쓴다');
  assert.equal(rt.versionCalls, 3, '엔진 버전은 배치마다 다시 묻는다');
});

test('엔진 작업 폴더가 dirty이거나 커밋을 모르면 저장하지도 읽지도 않는다', async () => {
  const cases = [
    [{ repo: 'r', commit: COMMIT, dirty: true }, /커밋하지 않은 변경/],
    [{ repo: 'r', commit: null, dirty: null }, /엔진 커밋을 알 수 없어/],
    [{ repo: 'r', commit: '', dirty: false }, /엔진 커밋을 알 수 없어/],
    [{ repo: 'r', commit: COMMIT }, /깨끗한지 확인할 수 없어/],
    [{ repo: 'r', commit: COMMIT, dirty: null }, /깨끗한지 확인할 수 없어/],
    [null, /엔진 커밋을 알 수 없어/],
    [() => { throw new Error('git 없음'); }, /엔진 커밋을 알 수 없어/],
  ];
  for (const [version, warning] of cases) {
    // 깨끗한 판에서 저장해 둔 결과가 있어도 읽지 않는다.
    const calls = [];
    const inner = createMemoryStore();
    const store = { get: (k) => (calls.push('get'), inner.get(k)), set: (k, e) => (calls.push('set'), inner.set(k, e)) };
    const requests = [req(['가']), req(['나'])];
    await withCache(fakeRuntime(), store).runBatch(requests);
    calls.length = 0;

    const rt = fakeRuntime({ version });
    const { results, cache } = await withCache(rt, store).runBatchWithStats(requests, { concurrency: 3 });
    assert.deepEqual(stats(cache), [0, 2, 0], JSON.stringify(version));
    assert.equal(cache.warnings.length, 1);
    assert.match(cache.warnings[0], warning);
    assert.deepEqual(calls, [], '저장소를 건드리지 않는다');
    assert.deepEqual(rt.batches, [requests], '요청을 그대로 엔진에 보낸다');
    assert.deepEqual(rt.options, [{ concurrency: 3 }]);
    assert.deepEqual(totals(results), requests.map((r) => fakeRow(r).total_damage));
  }

  // engineVersion이 없는 런타임도 같다.
  const bare = { runBatch: async (requests) => requests.map((r) => fakeRow(r)) };
  const { cache } = await withCache(bare, createMemoryStore()).runBatchWithStats([req(['가'])]);
  assert.deepEqual(stats(cache), [0, 1, 0]);
  assert.match(cache.warnings[0], /엔진 커밋을 알 수 없어/);
});

test('결과가 밝힌 평가기 판이 확인한 판과 다르면 저장하지 않는다', async () => {
  for (const evaluator of [{ repo: 'fake/engine', commit: OTHER_COMMIT, dirty: false }, { repo: 'fake/engine', commit: COMMIT, dirty: true }, { repo: 'fake/engine', commit: null, dirty: null }]) {
    const store = createMemoryStore();
    const { results, cache } = await withCache(fakeRuntime({ evaluator }), store).runBatchWithStats([req(['가']), req(['나'])]);
    assert.deepEqual(stats(cache), [0, 2, 0], JSON.stringify(evaluator));
    assert.match(cache.warnings[0], /엔진 판이 계산 전에 확인한 판과 달라 2건을 저장하지 않았다/);
    assert.equal(store.size, 0);
    assert.equal(results[0].total_damage, fakeRow(req(['가'])).total_damage, '결과는 그대로 돌려준다');
  }
});

// ── 부분 적중 합치기 ───────────────────────────────────────────────────────────

test('배치에서 적중한 요청은 엔진에 보내지 않고, 빗나간 요청만 보낸 뒤 입력 순서대로 합친다', async () => {
  const store = createMemoryStore();
  const rt = fakeRuntime();
  const cached = withCache(rt, store);
  await cached.runBatch([req(['나']), req(['라'])]);

  const requests = [req(['가']), req(['나']), req(['다']), req(['라']), req(['마'])];
  const { results, cache } = await cached.runBatchWithStats(requests, { concurrency: 4 });
  assert.deepEqual(sent(rt)[1], ['가', '다', '마'], '빗나간 요청만, 입력 순서대로');
  assert.deepEqual(rt.options[1], { concurrency: 4 }, '실행 옵션은 그대로 넘긴다');
  assert.deepEqual(stats(cache), [2, 3, 3]);
  assert.deepEqual(results.map((r) => r.members[0].name), ['가', '나', '다', '라', '마']);
  assert.deepEqual(totals(results), requests.map((r) => fakeRow(r).total_damage));
  // 줄의 id는 엔진에 보낸 배치가 아니라 입력 배치에서의 자리다.
  assert.deepEqual(results.map((r) => r.id), [0, 1, 2, 3, 4]);

  // runBatch(계약의 함수)는 같은 결과 배열만 돌려준다.
  const plain = await cached.runBatch(requests);
  assert.deepEqual(plain, results);
  assert.equal(rt.batches.length, 2, '모두 적중하면 엔진을 부르지 않는다');
});

test('오류와 저장할 수 없는 요청이 섞여도 자리가 어긋나지 않는다', async () => {
  const rt = fakeRuntime();
  const cached = withCache(rt, createMemoryStore());
  const requests = [req(['가']), req(['오류']), { squad: ['다'] }, req(['라'])];
  await cached.runBatch([requests[3]]);
  const { results, cache } = await cached.runBatchWithStats(requests);
  assert.deepEqual(sent(rt)[1], ['가', '오류', '다']);
  assert.deepEqual(stats(cache), [1, 3, 1]);
  assert.equal(results[0].members[0].name, '가');
  assert.equal(results[1].error.type, 'invalid_input');
  assert.equal(results[2].members[0].name, '다');
  assert.equal(results[3].members[0].name, '라');
  assert.deepEqual(results.map((r) => r.id), [0, 1, 2, 3]);
});

test('같은 배치 안의 같은 요청은 한 번만 계산한다. 비결정론 요청은 합치지 않는다', async () => {
  const rt = fakeRuntime();
  const cached = withCache(rt, createMemoryStore());
  const a = req(['가', '나']);
  const sameAsA = { id: 'again', sim: { duration: 180, expected: true }, squad: ['가', '나'] };
  const random = { squad: ['다'] };
  const { results, cache } = await cached.runBatchWithStats([a, random, sameAsA, random]);
  assert.deepEqual(sent(rt)[0], ['가나', '다', '다']);
  assert.deepEqual(stats(cache), [1, 3, 1]);
  assert.equal(cache.hits + cache.misses, 4, '적중 + 엔진 계산 = 요청 수');
  assert.equal(results[2].total_damage, results[0].total_damage);
  assert.deepEqual(results.map((r) => r.id), [0, 1, 2, 3]);
  assert.notEqual(results[2], results[0], '자리마다 다른 객체다');
  results[2].members[0].damage = -1;
  assert.notEqual(results[0].members[0].damage, -1);
});

test('빈 배치는 엔진도 저장소도 부르지 않는다', async () => {
  const rt = fakeRuntime();
  const { results, cache } = await withCache(rt, createMemoryStore()).runBatchWithStats([]);
  assert.deepEqual(results, []);
  assert.deepEqual(cache, { hits: 0, misses: 0, stored: 0, warnings: [] });
  assert.equal(rt.batches.length + rt.versionCalls, 0);
});

test('감싼 런타임은 계약의 함수를 그대로 갖고, 엔진이 결과 수를 맞추지 않으면 멈춘다', async () => {
  const rt = fakeRuntime();
  const cached = withCache(rt, createMemoryStore());
  assert.deepEqual(await cached.loadCatalog(), { nikkes: {}, bosses: [] });
  assert.deepEqual(await cached.engineVersion(), CLEAN);
  assert.equal(typeof cached.runBatch, 'function');
  assert.equal(typeof cached.runBatchWithStats, 'function');

  const short = withCache({ ...fakeRuntime(), runBatch: async () => [] }, createMemoryStore());
  await assert.rejects(short.runBatch([req(['가'])]), /요청 1건에 결과 0건/);
  // 엔진 실행 오류는 삼키지 않는다 — 캐시가 가리는 것은 저장소 문제뿐이다.
  const broken = withCache({ ...fakeRuntime(), runBatch: async () => { throw new Error('엔진 시간 초과'); } }, createMemoryStore());
  await assert.rejects(broken.runBatch([req(['가'])]), /엔진 시간 초과/);
});

// ── 깨진 저장소 ───────────────────────────────────────────────────────────────

test('저장소가 읽기에서 던지면 캐시 없이 계산하고 경고를 남긴다', async () => {
  const rt = fakeRuntime();
  const store = { get: () => { throw new Error('디스크 오류'); }, set: () => {} };
  const requests = [req(['가']), req(['나'])];
  const { results, cache } = await withCache(rt, store).runBatchWithStats(requests);
  assert.deepEqual(totals(results), requests.map((r) => fakeRow(r).total_damage));
  assert.deepEqual(stats(cache), [0, 2, 2]);
  assert.deepEqual(cache.warnings, ['캐시를 읽지 못해 2건을 다시 계산했다: 디스크 오류']);
});

test('저장소가 쓰기에서 던져도 결과는 돌려주고 경고를 남긴다', async () => {
  const store = { get: async () => undefined, set: async () => { throw new Error('쓰기 금지'); } };
  const { results, cache } = await withCache(fakeRuntime(), store).runBatchWithStats([req(['가']), req(['나']), req(['다'])]);
  assert.equal(results.length, 3);
  assert.deepEqual(stats(cache), [0, 3, 0]);
  assert.deepEqual(cache.warnings, ['캐시에 3건을 저장하지 못했다: 쓰기 금지']);
});

test('저장소가 아예 저장소가 아니어도 실패하지 않는다', async () => {
  for (const store of [null, {}, { get: 'x', set: 1 }]) {
    const { results, cache } = await withCache(fakeRuntime(), store).runBatchWithStats([req(['가'])]);
    assert.equal(results[0].total_damage, fakeRow(req(['가'])).total_damage);
    assert.deepEqual(stats(cache), [0, 1, 0]);
    assert.equal(cache.warnings.length, 2, '읽기와 쓰기 경고');
  }
});

test('깨진 항목은 적중으로 치지 않고 다시 계산해 덮어쓴다', async () => {
  const request = req(['가', '나']);
  const key = await cacheKey(COMMIT, request);
  const good = { cache_schema_version: 1, key, engine: { repo: 'fake/engine', commit: COMMIT }, request, result: fakeRow(request), stored_at: 'x' };
  const wrongTotal = { ...fakeRow(request), total_damage: 1 };
  const broken = [
    'text',
    42,
    [],
    {},
    { ...good, cache_schema_version: 2 },
    { ...good, key: 'f'.repeat(64) },
    { ...good, engine: { repo: 'fake/engine', commit: OTHER_COMMIT } },
    { ...good, engine: null },
    { ...good, request: req(['나', '가']) }, // 다른 요청의 결과가 이 키에 들어 있다
    { ...good, result: null },
    { ...good, result: { error: { message: 'x' } } },
    { ...good, result: { members: [] } },
    { ...good, result: { total_damage: '100', members: [] } },
    { ...good, result: { total_damage: 100 } },
    { ...good, result: { ...wrongTotal, evaluator: { repo: 'fake/engine', commit: OTHER_COMMIT, dirty: false } } },
  ];
  for (const entry of broken) {
    const store = createMemoryStore();
    store.set(key, entry);
    const rt = fakeRuntime();
    const { results, cache } = await withCache(rt, store).runBatchWithStats([request]);
    const label = JSON.stringify(entry).slice(0, 80);
    assert.deepEqual(stats(cache), [0, 1, 1], label);
    assert.deepEqual(cache.warnings, ['캐시 항목 1건을 쓸 수 없어(깨졌거나 형식이 다르다) 다시 계산했다'], label);
    assert.equal(results[0].total_damage, fakeRow(request).total_damage, label);
    assert.equal(rt.batches.length, 1, label);
    // 덮어쓴 뒤에는 적중한다.
    assert.deepEqual(stats((await withCache(rt, store).runBatchWithStats([request])).cache), [1, 0, 0], label);
  }

  // 온전한 항목은 적중한다(위 항목들이 걸러진 것이 형식 때문임을 확인).
  const store = createMemoryStore();
  store.set(key, good);
  const rt = fakeRuntime();
  assert.deepEqual(stats((await withCache(rt, store).runBatchWithStats([request])).cache), [1, 0, 0]);
  assert.equal(rt.batches.length, 0);
});

test('해시를 쓸 수 없으면 캐시 없이 계산하고 경고를 남긴다', async () => {
  const rt = fakeRuntime();
  const hash = async () => { throw new Error('Web Crypto(crypto.subtle)를 쓸 수 없다'); };
  const { results, cache } = await withCache(rt, createMemoryStore(), { hash }).runBatchWithStats([req(['가'])]);
  assert.equal(results[0].total_damage, fakeRow(req(['가'])).total_damage);
  assert.deepEqual(stats(cache), [0, 1, 0]);
  assert.match(cache.warnings[0], /캐시 키를 만들 수 없어 캐시를 쓰지 않았다: Web Crypto/);
});

// ── 저장소 ────────────────────────────────────────────────────────────────────

test('메모리 저장소: 복사해서 넣고 꺼낸다. 한도를 넘으면 먼저 넣은 것부터 버린다', () => {
  const store = createMemoryStore({ maxEntries: 2 });
  const entry = { result: { members: [{ damage: 1 }] } };
  store.set('a', entry);
  entry.result.members[0].damage = 99;
  const read = store.get('a');
  assert.equal(read.result.members[0].damage, 1);
  read.result.members[0].damage = 50;
  assert.equal(store.get('a').result.members[0].damage, 1);
  assert.equal(store.get('없음'), undefined);

  store.set('b', {});
  store.set('a', { again: true }); // 다시 넣으면 최근 것이 된다
  store.set('c', {});
  assert.equal(store.size, 2);
  assert.equal(store.get('b'), undefined);
  assert.deepEqual(store.get('a'), { again: true });
  store.clear();
  assert.equal(store.size, 0);
});

test('적중한 결과를 호출자가 바꿔도 저장된 값은 그대로다', async () => {
  const store = createMemoryStore();
  const cached = withCache(fakeRuntime(), store);
  const request = req(['가']);
  const [first] = await cached.runBatch([request]);
  first.members[0].damage = -1;
  const [second] = await cached.runBatch([request]);
  assert.equal(second.members[0].damage, fakeRow(request).members[0].damage);
  second.total_damage = -1;
  assert.equal((await cached.runBatch([request]))[0].total_damage, fakeRow(request).total_damage);
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-cache-test-'));
}

test('파일 저장소: 기본 폴더는 data/cache/sim이고, 항목은 <키 앞 두 글자>/<키>.json에 쓴다', async () => {
  assert.equal(path.relative(path.resolve(import.meta.dirname, '../..'), DEFAULT_CACHE_DIR).replaceAll('\\', '/'), 'data/cache/sim');
  assert.equal(createFileCacheStore().dir, DEFAULT_CACHE_DIR);

  const root = tempDir();
  try {
    const dir = path.join(root, '아직 없는 폴더', 'sim');
    const store = createFileCacheStore(dir);
    const key = await sha256Hex('x');
    assert.equal(store.get(key), undefined, '폴더가 없으면 빗나감이다');
    assert.equal(fs.existsSync(dir), false, '읽기만 해서는 폴더를 만들지 않는다');

    store.set(key, { 한글: '값', n: 1 });
    const file = path.join(dir, key.slice(0, 2), `${key}.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { 한글: '값', n: 1 });
    assert.deepEqual(store.get(key), { 한글: '값', n: 1 });
    store.set(key, { n: 2 });
    assert.deepEqual(store.get(key), { n: 2 });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${key}.json`], '임시 파일이 남지 않는다');

    // 키가 해시가 아니면 경로로 쓰지 않는다.
    assert.throws(() => store.get('../../etc/passwd'), /캐시 키가 16진수 해시가 아니다/);
    assert.throws(() => store.set('..', {}), /캐시 키가 16진수 해시가 아니다/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('파일 저장소로 감싼 런타임: 다른 프로세스가 만든 것처럼 새 저장소 객체에서도 적중한다', async () => {
  const dir = tempDir();
  try {
    const requests = [req(['가', '나']), req(['다'])];
    const rt = fakeRuntime({ evaluator: CLEAN });
    const first = await withCache(rt, createFileCacheStore(dir)).runBatchWithStats(requests);
    assert.deepEqual(stats(first.cache), [0, 2, 2]);
    const second = await withCache(rt, createFileCacheStore(dir)).runBatchWithStats(requests);
    assert.deepEqual(stats(second.cache), [2, 0, 0]);
    assert.deepEqual(second.cache.warnings, []);
    assert.deepEqual(second.results, first.results);
    assert.equal(rt.batches.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('깨진 캐시 파일: 실패하지 않고 다시 계산해 경고를 남기고, 파일을 고쳐 쓴다', async () => {
  const dir = tempDir();
  try {
    const requests = [req(['가', '나']), req(['다'])];
    const rt = fakeRuntime();
    await withCache(rt, createFileCacheStore(dir)).runBatch(requests);
    const key = await cacheKey(COMMIT, requests[0]);
    const file = path.join(dir, key.slice(0, 2), `${key}.json`);
    fs.writeFileSync(file, '{"cache_schema_version": 1, "resu', 'utf8'); // 쓰다 만 파일

    const { results, cache } = await withCache(rt, createFileCacheStore(dir)).runBatchWithStats(requests);
    assert.deepEqual(stats(cache), [1, 1, 1]);
    assert.equal(cache.warnings.length, 1);
    assert.match(cache.warnings[0], /^캐시를 읽지 못해 1건을 다시 계산했다: 캐시 파일이 JSON이 아니다/);
    assert.deepEqual(totals(results), requests.map((r) => fakeRow(r).total_damage));
    assert.deepEqual(sent(rt)[1], ['가나']);

    const again = await withCache(rt, createFileCacheStore(dir)).runBatchWithStats(requests);
    assert.deepEqual(stats(again.cache), [2, 0, 0]);
    assert.deepEqual(again.cache.warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('캐시 폴더를 쓸 수 없으면(폴더 자리에 파일) 캐시 없이 계산하고 경고를 남긴다', async () => {
  const root = tempDir();
  try {
    const notADir = path.join(root, 'sim');
    fs.writeFileSync(notADir, '폴더가 아니다');
    const requests = [req(['가']), req(['나'])];
    for (let round = 0; round < 2; round += 1) {
      const rt = fakeRuntime();
      const { results, cache } = await withCache(rt, createFileCacheStore(notADir)).runBatchWithStats(requests);
      assert.deepEqual(totals(results), requests.map((r) => fakeRow(r).total_damage));
      assert.deepEqual(stats(cache), [0, 2, 0]);
      assert.ok(cache.warnings.length >= 1);
      assert.match(cache.warnings.at(-1), /^캐시에 2건을 저장하지 못했다: 캐시 파일을 쓸 수 없다/);
    }
    assert.equal(fs.readFileSync(notADir, 'utf8'), '폴더가 아니다');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 결과 문서와 표 ─────────────────────────────────────────────────────────────

const stage = { 가: '1', 나: '2', 다: '3', 라: '3', 마: '3', 바: '3' };
const catalog = { nikkes: Object.fromEntries(Object.entries(stage).map(([n, s]) => [n, { burst_stage: s }])), bosses: ['보스'] };
const account = { schema_version: 1, is_test_data: true, nikkes: Object.fromEntries(Object.keys(stage).map((n) => [n, {}])) };
const condition = { schema_version: 1, content: 'solo_raid', boss: '보스' };
const SQUADS = [
  { name: 'A', members: ['가', '나', '다', '라', '마'] },
  { name: 'B', members: ['가', '나', '다', '라', '바'] },
];

/** 카탈로그를 주고 평가기 판을 결과에 싣는 가짜 엔진. */
function engineRuntime() {
  return { ...fakeRuntime({ evaluator: CLEAN }), loadCatalog: async () => catalog };
}

test('비교 결과에 cache가 실린다: 처음에는 모두 계산, 두 번째에는 엔진 호출 0건이고 수치가 같다', async () => {
  const rt = engineRuntime();
  const runtime = withCache(rt, createMemoryStore());
  const first = await compareSquads({ account, condition, squads: SQUADS }, { runtime, now });
  assert.deepEqual(first.cache, { hits: 0, misses: 2, stored: 2, warnings: [] });

  const second = await compareSquads({ account, condition, squads: SQUADS }, { runtime, now });
  assert.deepEqual(second.cache, { hits: 2, misses: 0, stored: 0, warnings: [] });
  assert.equal(rt.batches.length, 1);
  assert.deepEqual(second.ranking, first.ranking);
  assert.deepEqual(second.engine, CLEAN, '엔진 판은 저장된 결과가 밝힌 값이다');
  assert.deepEqual({ ...second, cache: null }, { ...first, cache: null }, 'cache 말고는 같은 문서다');

  // 편성 하나를 더하면 그것만 계산한다.
  const more = await compareSquads({ account, condition, squads: [...SQUADS, { name: 'C', members: ['나', '가', '다', '라', '마'] }] }, { runtime, now });
  assert.deepEqual(more.cache, { hits: 2, misses: 1, stored: 1, warnings: [] });
  assert.deepEqual(sent(rt)[1], ['나가다라마']);
  assert.deepEqual(more.ranking.map((r) => r.name).sort(), ['A', 'B', 'C']);
});

test('캐시로 감싸지 않은 런타임이면 cache는 null이다. deps.runBatch를 직접 줘도 같다', async () => {
  const plain = await compareSquads({ account, condition, squads: SQUADS }, { runtime: engineRuntime(), now });
  assert.equal(plain.cache, null);

  const rt = engineRuntime();
  const runBatch = async (requests) => requests.map((r) => fakeRow(r));
  const direct = await compareSquads({ account, condition, squads: SQUADS }, { runtime: withCache(rt, createMemoryStore()), runBatch, now });
  assert.equal(direct.cache, null);
  assert.equal(rt.batches.length, 0);
});

test('추천(suggest)과 성장 비교(growth)의 결과에도 cache가 실리고 서로의 결과를 다시 쓴다', async () => {
  const rt = engineRuntime();
  const runtime = withCache(rt, createMemoryStore());
  const suggested = await suggestSquads({ account, condition }, { top: 2 }, { runtime, now });
  // 추천은 두 단계(멤버 조합 → 배치 변형)로 엔진을 부른다. 결과의 cache는 두 단계를 더한 값이다.
  const { sims, stage1, stage2 } = suggested.suggestion.search;
  assert.equal(stage1.requested, suggested.suggestion.generated);
  assert.ok(stage2.requested > 0, '배치 변형도 계산했다');
  assert.equal(sims, stage1.requested + stage2.requested);
  assert.equal(rt.batches.length, 2);
  assert.deepEqual(suggested.cache, { hits: 0, misses: sims, stored: sims, warnings: [] });
  assert.deepEqual((await suggestSquads({ account, condition }, { top: 2 }, { runtime, now })).cache, { hits: sims, misses: 0, stored: 0, warnings: [] });
  assert.equal(rt.batches.length, 2, '두 번째 추천은 엔진을 부르지 않는다');

  // 배치 탐색을 끄면 1단계만이다 — 이미 계산한 후보라 모두 적중한다.
  const plain = await suggestSquads({ account, condition }, { top: 2, refine: false }, { runtime, now });
  assert.deepEqual(plain.cache, { hits: stage1.requested, misses: 0, stored: 0, warnings: [] });

  const input = { account, condition, squad: SQUADS[0], upgrades: [{ nikke: '가', add: { core_enhancement: 1 } }, { nikke: '나', set: { breakthrough: 3 } }] };
  const growth = await compareGrowth(input, { runtime: withCache(rt, createMemoryStore()), now });
  assert.deepEqual(growth.cache, { hits: 0, misses: 3, stored: 3, warnings: [] });
  const shared = withCache(rt, createMemoryStore());
  await compareSquads({ account, condition, squads: [SQUADS[0]] }, { runtime: shared, now });
  // 기준 편성은 비교에서 이미 계산했다 — 성장 비교는 후보 2건만 계산한다.
  const after = await compareGrowth(input, { runtime: shared, now });
  assert.deepEqual(after.cache, { hits: 1, misses: 2, stored: 2, warnings: [] });
  assert.deepEqual(after.ranking, growth.ranking);
  assert.equal((await compareGrowth(input, { runtime: engineRuntime(), now })).cache, null);
});

test('저장소가 깨져도 비교는 끝까지 되고 경고가 결과에 남는다', async () => {
  const store = { get: () => { throw new Error('읽을 수 없다'); }, set: () => { throw new Error('쓸 수 없다'); } };
  const report = await compareSquads({ account, condition, squads: SQUADS }, { runtime: withCache(engineRuntime(), store), now });
  assert.equal(report.ranking.length, 2);
  assert.deepEqual(report.cache, {
    hits: 0,
    misses: 2,
    stored: 0,
    warnings: ['캐시를 읽지 못해 2건을 다시 계산했다: 읽을 수 없다', '캐시에 2건을 저장하지 못했다: 쓸 수 없다'],
  });
  const text = renderReport(report);
  assert.match(text, /^캐시: 적중 0건 · 엔진 계산 2건 · 새로 저장 0건$/m);
  assert.match(text, /^ {2}! 캐시를 읽지 못해 2건을 다시 계산했다: 읽을 수 없다$/m);
  assert.match(text, /^ {2}! 캐시에 2건을 저장하지 못했다: 쓸 수 없다$/m);
});

test('표 출력에 캐시가 한 줄로 보인다', async () => {
  assert.deepEqual(cacheLines({ hits: 3, misses: 1, stored: 1, warnings: [] }), ['캐시: 적중 3건 · 엔진 계산 1건 · 새로 저장 1건']);
  assert.deepEqual(cacheLines({ hits: 3, misses: 1, stored: 1 }), ['캐시: 적중 3건 · 엔진 계산 1건 · 새로 저장 1건']);
  assert.deepEqual(cacheLines(null), ['캐시: 쓰지 않음']);
  assert.deepEqual(cacheLines(undefined), [], '캐시 칸이 없던 때의 결과 문서');

  const runtime = withCache(engineRuntime(), createMemoryStore());
  await compareSquads({ account, condition, squads: SQUADS }, { runtime, now });
  const lines = renderReport(await compareSquads({ account, condition, squads: SQUADS }, { runtime, now })).split('\n');
  assert.equal(lines.filter((l) => l.startsWith('캐시:')).length, 1);
  assert.equal(lines[2], '캐시: 적중 2건 · 엔진 계산 0건 · 새로 저장 0건');
  assert.match(lines[1], /^엔진: /);

  const plain = renderReport(await compareSquads({ account, condition, squads: SQUADS }, { runtime: engineRuntime(), now }));
  assert.match(plain, /^캐시: 쓰지 않음$/m);

  const growth = await compareGrowth({ account, condition, squad: SQUADS[0], upgrades: [{ nikke: '가', add: { core_enhancement: 1 } }] }, { runtime, now });
  assert.match(renderGrowthReport(growth), /^캐시: 적중 1건 · 엔진 계산 1건 · 새로 저장 1건$/m);
});
