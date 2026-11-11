// 실제 엔진(vendor/nikke-calc)을 부르는 검증. 수십 초 걸린다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareSquads } from '../../src/core/compare.mjs';
import { runBatch, loadCatalog, engineVersion, nodeRuntime } from '../../src/runtime/node.mjs';
import { toEngineProfile } from '../../src/core/account.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sample = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/samples', f), 'utf8'));
const account = sample('account.sample.json');
const condition = sample('condition.solo-raid.json');
const { squads } = sample('squads.sample.json');
// 계산 모듈은 엔진을 직접 부르지 않는다 — Node 런타임을 넘긴다.
const deps = { runtime: nodeRuntime };

test('엔진 카탈로그에 샘플 계정의 니케와 보스 프리셋이 있다', () => {
  const catalog = loadCatalog();
  for (const name of Object.keys(account.nikkes)) assert.ok(name in catalog.nikkes, name);
  assert.ok(catalog.bosses.includes(condition.boss));
  assert.match(engineVersion().commit, /^[0-9a-f]{40}$/);
});

test('배치는 입력 순서를 지키고, 한 건의 오류가 다른 건을 막지 않는다', async () => {
  const results = await runBatch([
    { squad: ['크라운', '헬름'], sim: { expected: true, duration: 30 } },
    { squad: ['없는 니케'] },
    { squad: ['헬름', '크라운'], sim: { expected: true, duration: 30 } },
  ]);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0].members.map((m) => m.name), ['크라운', '헬름']);
  assert.equal(results[1].error.type, 'invalid_input');
  assert.equal(results[1].error.path, '/squad/0');
  assert.deepEqual(results[2].members.map((m) => m.name), ['헬름', '크라운']);
});

test('샘플 계정으로 편성 비교가 끝까지 돈다: 순위·제외·엔진 버전·결정론', async () => {
  const first = await compareSquads({ account, condition, squads }, deps);
  assert.equal(first.ranking.length, 3);
  assert.deepEqual(first.rejected.map((r) => r.name).sort(), ['D 미보유 포함', 'E 중복']);
  assert.equal(first.failed.length, 0);
  for (const r of first.ranking) {
    assert.ok(Number.isInteger(r.total_damage) && r.total_damage > 0);
    assert.equal(r.members.length, 5);
    assert.equal(r.members.reduce((s, m) => s + m.damage, 0), r.total_damage);
  }
  assert.ok(first.ranking[0].total_damage >= first.ranking[1].total_damage);
  assert.equal(first.engine.commit, engineVersion().commit, '결과의 엔진 버전은 실제 서브모듈 커밋이어야 한다');
  // 추천 결과에 미보유 니케가 섞이지 않는다.
  for (const r of first.ranking) for (const m of r.members) assert.ok(m.name in account.nikkes, m.name);

  const second = await compareSquads({ account, condition, squads }, deps);
  assert.deepEqual(second.ranking.map((r) => [r.name, r.total_damage]), first.ranking.map((r) => [r.name, r.total_damage]), '같은 입력이면 같은 수치가 나와야 한다');
});

test('육성 상태가 결과에 반영된다: 스킬 레벨을 낮추면 총딜이 내려간다', async () => {
  const squad = [squads[0]];
  const weaker = structuredClone(account);
  weaker.nikkes['라피 : 레드 후드'].skill_levels = [1, 1, 1];
  const [a, b] = await Promise.all([
    compareSquads({ account, condition, squads: squad }, deps),
    compareSquads({ account: weaker, condition, squads: squad }, deps),
  ]);
  assert.ok(b.ranking[0].total_damage < a.ranking[0].total_damage);
});

test('빈 항목으로 보유한 니케는 엔진의 미육성과 같은 값으로 계산된다 (만렙으로 계산되지 않는다)', async () => {
  const squad = ['나가', '크라운'];
  const acct = { schema_version: 1, is_test_data: true, nikkes: { 나가: {}, 크라운: { unknown: ['overload', 'skill_levels'] } } };
  const sim = { expected: true, duration: 60 };
  const [ours, engineUngrown, engineDefault] = await runBatch([
    { squad, sim, profile: toEngineProfile(acct, squad) },
    { squad, sim, profile: { base: 'ungrown', chars: {} } },
    { squad, sim },
  ]);
  assert.equal(ours.error, undefined, JSON.stringify(ours.error));
  assert.equal(ours.total_damage, engineUngrown.total_damage, '우리가 채운 미육성 값이 엔진의 UNGROWN과 달라졌다');
  assert.ok(ours.total_damage < engineDefault.total_damage);
});

test('CLI: 표를 출력하고 결과 JSON을 쓴다. 입력 오류는 종료 코드 2', () => {
  const out = path.join(os.tmpdir(), `nikke-report-${process.pid}.json`);
  const args = (extra = {}) => {
    const o = { account: 'data/samples/account.sample.json', condition: 'data/samples/condition.solo-raid.json', squads: 'data/samples/squads.sample.json', json: out, ...extra };
    return ['src/cli.mjs', 'compare', ...Object.entries(o).flatMap(([k, v]) => [`--${k}`, v])];
  };
  try {
    const ok = spawnSync(process.execPath, args(), { cwd: ROOT, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /1위/);
    assert.match(ok.stdout, /\[검증용 데이터\]/);
    assert.match(ok.stdout, /보유하지 않은 니케: 홍련/);
    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(report.schema_version, 1);
    assert.equal(report.ranking[0].rank, 1);

    const bad = spawnSync(process.execPath, args({ account: 'data/samples/없는파일.json' }), { cwd: ROOT, encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /입력 오류/);
  } finally {
    fs.rmSync(out, { force: true });
  }
});
