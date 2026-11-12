// 육성 효율표(P-031)를 실제 엔진(vendor/nikke-calc)으로 돌리는 검증. 1분 안쪽이다(엔진 요청 서른 건 남짓).
// 계정은 검증용 샘플(data/samples/account.sample.json), 보스 값은 내장 묶음(data/intercept/anomaly.json)이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createMemoryStore, withCache } from '../../src/core/cache.mjs';
import { resolveOpponent } from '../../src/core/deck.mjs';
import {
  compareCubes,
  cubeCandidates,
  cubeCatalogFrom,
  cubeList,
  efficiencyTable,
  ENGINE_DEFAULT_CUBE,
  layoutOverload,
  overloadState,
  tryOverload,
  upgradeCandidates,
} from '../../src/core/efficiency.mjs';
import { compareGrowth } from '../../src/core/growth.mjs';
import { CUBE_TABLE_FILE, DEFAULT_ENGINE_DIR, engineVersion, nodeRuntime } from '../../src/runtime/node.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const account = read('data/samples/account.sample.json');
const bundle = read('data/intercept/anomaly.json');
const catalog = await nodeRuntime.loadCatalog();
const DECK = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];

// 메모리 캐시로 감싼 실제 런타임 — 기준 편성은 한 번만 계산된다(디스크에는 쓰지 않는다).
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

test('카탈로그의 큐브 목록은 엔진의 큐브 표에서 온다 — 엔진이 효과를 계산하지 못하는 큐브가 표시된다', () => {
  const raw = JSON.parse(fs.readFileSync(`${DEFAULT_ENGINE_DIR}/${CUBE_TABLE_FILE}`, 'utf8'));
  assert.deepEqual(catalog.cubes, cubeCatalogFrom(raw));
  const list = cubeList(catalog);
  assert.equal(list.known, true);
  assert.ok(list.supported.length >= 10, `바꿔 볼 수 있는 큐브 ${list.supported.length}종`);
  assert.ok(list.supported.some((c) => c.name === ENGINE_DEFAULT_CUBE.name), '엔진의 기본 큐브가 목록에 있다');
  assert.ok(list.supported.every((c) => c.max_level >= ENGINE_DEFAULT_CUBE.level));
  // 엔진의 표에 unsupported로 적힌 큐브만 지원하지 않는 것으로 나온다.
  const flagged = Object.entries(raw).filter(([k, v]) => !k.startsWith('_') && k !== '공통' && v.unsupported).map(([k]) => k);
  assert.deepEqual(list.unsupported.map((c) => c.name), flagged);
  assert.equal(Object.hasOwn(raw, '공통') && catalog.cubes.some((c) => c.name === '공통'), false);
});

test('효율표: 헬름의 한 단계 후보를 실제 엔진으로 계산해 증가율 순으로 낸다 — 다시 계산하면 엔진을 부르지 않는다', async () => {
  assert.ok(kraken, '내장 묶음에 크라켄이 있다');
  const made = upgradeCandidates({ account, members: DECK, catalog, only: '헬름' });
  // 샘플 계정의 헬름: 스킬 7/7/10 · 돌파 3 · 코어 강화 3 · 오버로드 공격력 2줄·우월 코드 2줄, 소장품은 적지 않았다.
  assert.deepEqual(made.candidates.map((c) => c.kind), ['skill1', 'skill2', 'core', 'overload:atk_pct', 'overload:element_bonus', 'overload:max_ammo_pct', 'overload:crit_rate', 'overload:crit_dmg', 'overload:charge_speed_pct', 'overload:charge_dmg_pct', 'overload:accuracy_pct', 'overload:def_pct']);
  assert.deepEqual(made.excluded.map((e) => [e.kind, e.code]), [['burst', 'max'], ['breakthrough', 'max'], ['collection', 'none']]);

  const limit = 6;
  const report = await efficiencyTable({ account, opponent: kraken, members: DECK }, { only: '헬름', limit }, { runtime });
  assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
  assert.equal(report.rows.length, limit);
  assert.equal(report.skipped.length, made.candidates.length - limit);
  assert.ok(report.baseline.total_damage > 0);
  assert.equal(report.engine.commit, engineVersion().commit);
  assert.deepEqual(report.cache.warnings, []);
  assert.equal(report.cache.misses, limit + 1);
  for (const [i, row] of report.rows.entries()) {
    assert.equal(row.nikke, '헬름');
    assert.ok(Number.isFinite(row.gain_rate), row.id);
    assert.ok(Math.abs(row.gain_rate - (row.total_after - report.baseline.total_damage) / report.baseline.total_damage) < 1e-12);
    if (i > 0) assert.ok(report.rows[i - 1].gain >= row.gain, '증가율이 큰 순이다');
  }
  // 한 단계 올린 것이 실제로 계산에 반영된다: 적어도 하나는 총딜이 는다.
  assert.ok(report.rows[0].gain > 0, `1위 ${report.rows[0].id} ${report.rows[0].gain}`);
  assert.equal(report.cost_known, false);

  // 효율표의 줄은 그 후보를 성장 비교(compareGrowth)에 손으로 준 것과 같은 값이다.
  const top = made.candidates.find((c) => c.id === report.rows[0].id);
  const direct = await compareGrowth({ account, condition: kraken.condition, squad: { name: '기준', members: DECK }, upgrades: [top.upgrade] }, { runtime });
  assert.equal(direct.ranking[0].total_after, report.rows[0].total_after);

  const before = calls.length;
  const again = await efficiencyTable({ account, opponent: kraken, members: DECK }, { only: '헬름', limit }, { runtime });
  assert.equal(calls.length, before, '같은 계산은 엔진을 다시 부르지 않는다');
  assert.deepEqual(again.rows, report.rows);
});

test('오버로드 바꿔 보기: 헬름의 옵션 줄을 바꾸면 총딜이 달라지고, 그대로 두면 달라지지 않는다 — 계정은 그대로다', async () => {
  const snapshot = JSON.stringify(account);
  const state = overloadState(account.nikkes.헬름);
  assert.equal(state.status, 'lines');
  const parts = layoutOverload(state.lines).parts;
  // 그대로: 줄 수 표기(2줄)와 줄별 레벨 표기([10, 10])는 같은 값이다 — 실제 엔진에서도 총딜이 같다.
  const same = await tryOverload({ account, opponent: kraken, members: DECK, nikke: '헬름', parts }, { runtime });
  assert.equal(same.status, 'same');
  const explicit = await compareGrowth(
    { account, condition: kraken.condition, squad: { name: '기준', members: DECK }, upgrades: [{ name: '줄별 레벨로 적기', nikke: '헬름', set: { overload: { 공격력: [10, 10], '우월 코드 대미지': [10, 10] } } }] },
    { runtime },
  );
  assert.equal(explicit.ranking[0].gain, 0, '줄 수만 적은 줄은 레벨 10이다');

  // 팔에 공격력 레벨 15 한 줄을 더한다.
  parts[2].lines[0] = { id: 'atk_pct', level: 15 };
  const report = await tryOverload({ account, opponent: kraken, members: DECK, nikke: '헬름', parts }, { runtime });
  assert.equal(report.status, 'computed', JSON.stringify(report.reason));
  assert.equal(report.total_before, same.total_before);
  assert.notEqual(report.total_after, report.total_before);
  assert.ok(report.gain > 0, `공격력 한 줄을 더하면 총딜이 는다: ${report.gain}`);
  assert.deepEqual(report.after.options.map((o) => [o.name, o.levels]), [['공격력', [15, 10, 10]], ['우월 코드 대미지', [10, 10]]]);
  assert.equal(JSON.stringify(account), snapshot);
});

test('큐브: 엔진은 요청으로 큐브를 바꿔 받는다 — 헬름의 큐브를 바꿔 보고, 기본 큐브를 직접 적은 값은 적지 않은 값과 같다', async () => {
  // 계정에 큐브가 없으면 엔진의 기본 큐브로 계산된다: 그 큐브를 직접 적어도 총딜이 같다(ENGINE_DEFAULT_CUBE가 엔진과 맞는지).
  const explicit = await compareGrowth(
    { account, condition: kraken.condition, squad: { name: '기준', members: DECK }, upgrades: [{ name: '기본 큐브를 직접', nikke: '헬름', set: { cube: { ...ENGINE_DEFAULT_CUBE } } }] },
    { runtime },
  );
  assert.equal(explicit.failed.length, 0, JSON.stringify(explicit.failed));
  assert.equal(explicit.ranking[0].gain, 0);

  // 상한 3건 → 한 명에게 큐브 세 종까지(기본 큐브 포함 — 바꿔 보는 것은 둘).
  const made = cubeCandidates({ account, members: DECK, catalog, only: '헬름', limit: 3 });
  assert.equal(made.candidates.length, 2);
  const report = await compareCubes({ account, opponent: kraken, members: DECK }, { only: '헬름', limit: 3 }, { runtime });
  assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
  assert.deepEqual(report.nikkes.map((n) => n.nikke), ['헬름']);
  assert.deepEqual(report.nikkes[0].current, { ...ENGINE_DEFAULT_CUBE, source: 'default', owned_level: null });
  assert.deepEqual(report.nikkes[0].rows.map((r) => r.cube).sort(), made.candidates.map((c) => c.cube).sort());
  for (const row of report.nikkes[0].rows) assert.ok(row.total_damage > 0 && Number.isFinite(row.change));
  // 큐브를 바꾸면 계산이 달라진다(엔진이 큐브를 실제로 반영한다).
  assert.ok(report.nikkes[0].rows.some((r) => r.gain !== 0), JSON.stringify(report.nikkes[0].rows.map((r) => [r.cube, r.gain])));
  assert.equal(report.skipped_cubes.length, cubeList(catalog).supported.length - 3);
  assert.ok(['computed', 'unchanged'].includes(report.recommendation.status));
  assert.equal(report.recommendation.picks[0].changed, report.nikkes[0].best !== null);
  assert.match(report.caveats[0], /^보유 큐브는 모른다/);

  // 엔진이 효과를 계산하지 못하는 큐브를 요청하면 엔진이 끊는다 — 그래서 후보로 만들지 않는다.
  const unsupported = cubeList(catalog).unsupported[0];
  if (unsupported) {
    const blocked = await compareGrowth(
      { account, condition: kraken.condition, squad: { name: '기준', members: DECK }, upgrades: [{ name: '지원하지 않는 큐브', nikke: '헬름', set: { cube: { name: unsupported.name, level: 15 } } }] },
      { runtime },
    );
    assert.equal(blocked.failed.length, 1);
    assert.match(blocked.failed[0].error.message, /미지원|효과 모델이 없는/);
  }
});
