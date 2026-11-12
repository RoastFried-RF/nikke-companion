// `suggest` 명령을 실제 엔진(vendor/nikke-calc)으로 돌리는 검증. 십여 초 걸린다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateCandidates } from '../../src/core/candidates.mjs';
import { loadCatalog, engineVersion } from '../../src/runtime/node.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ACCOUNT = 'data/samples/account.sample.json';
const CONDITION = 'data/samples/condition.solo-raid.json';
const account = JSON.parse(fs.readFileSync(path.join(ROOT, ACCOUNT), 'utf8'));
const catalog = loadCatalog();

// --no-cache: 이 테스트는 실제 엔진을 불러야 한다(캐시는 cache.engine.test.mjs가 임시 폴더로 확인한다).
const cli = (...args) => spawnSync(process.execPath, ['src/cli.mjs', 'suggest', '--no-cache', ...args], { cwd: ROOT, encoding: 'utf8' });

function assertValidMembers(members, label) {
  assert.equal(members.length, 5, label);
  assert.equal(new Set(members).size, 5, `${label}: 중복`);
  for (const m of members) assert.ok(m in account.nikkes, `${label}: 미보유 ${m}`);
  const stages = members.map((m) => catalog.nikkes[m].burst_stage);
  const missing = ['1', '2', '3'].filter((s) => !stages.includes(s)).length;
  assert.ok(missing <= stages.filter((s) => s === 'A').length, `${label}: 버스트 단계가 빈다 (${stages.join('')})`);
}

test('실제 카탈로그와 샘플 계정으로 만든 후보는 모두 조건을 지킨다 (엔진 호출 없음)', () => {
  const r = generateCandidates(account, catalog);
  assert.ok(r.squads.length > 0 && r.squads.length <= 30);
  for (const s of r.squads) assertValidMembers(s.members, s.name);
  assert.deepEqual(generateCandidates(account, catalog), r);
});

// 1단계(멤버 조합)만 본다 — `--no-refine`. 배치 탐색(2단계)은 아래의 다른 테스트가 실제 엔진으로 확인한다.
test('CLI suggest: 샘플 계정으로 후보를 만들어 실제 엔진으로 비교하고 상위 편성을 출력한다', () => {
  const out = path.join(os.tmpdir(), `nikke-suggest-${process.pid}.json`);
  try {
    const run = cli('--no-refine', '--account', ACCOUNT, '--condition', CONDITION, '--limit', '6', '--top', '3', '--json', out);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /\[검증용 데이터\]/);
    assert.match(run.stdout, /1위 {2}후보 \d+ {2}총딜 /);
    assert.match(run.stdout, /3위/);
    assert.doesNotMatch(run.stdout, /4위/);
    assert.match(run.stdout, /전수 탐색이 아니다/);
    assert.match(run.stdout, /개만 후보로 남겼다 \(limit 6\)/);
    assert.match(run.stdout, /후보 6개를 계산해 총딜 상위 3개만 표시한다/);

    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(report.engine.commit, engineVersion().commit, '결과의 엔진 버전은 실제 서브모듈 커밋이어야 한다');
    assert.equal(report.account.is_test_data, true);
    assert.equal(report.suggestion.generated, 6);
    assert.equal(report.suggestion.simulated, 6);
    assert.equal(report.suggestion.shown, 3);
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
    assert.equal(report.rejected.length, 0, JSON.stringify(report.rejected));
    assert.deepEqual(report.ranking.map((r) => r.rank), [1, 2, 3]);
    for (const [i, r] of report.ranking.entries()) {
      assertValidMembers(r.members.map((m) => m.name), r.name);
      assert.ok(Number.isInteger(r.total_damage) && r.total_damage > 0);
      assert.equal(r.members.reduce((s, m) => s + m.damage, 0), r.total_damage);
      if (i > 0) assert.ok(report.ranking[i - 1].total_damage >= r.total_damage, '총딜 내림차순');
    }
    // 표시된 편성은 생성기가 낸 후보 그대로다(같은 이름·같은 배치).
    const generated = new Map(generateCandidates(account, catalog, { limit: 6 }).squads.map((s) => [s.name, s.members]));
    for (const r of report.ranking) assert.deepEqual(r.members.map((m) => m.name), generated.get(r.name), r.name);
  } finally {
    fs.rmSync(out, { force: true });
  }
});

test('CLI suggest --refine: 배치 탐색 뒤의 1위 총딜은 --no-refine의 1위 이상이고, 시뮬 횟수는 예산을 넘지 않는다', () => {
  // 두 실행이 임시 캐시 폴더를 함께 쓴다 — 1단계의 여섯 후보는 한 번만 실제 엔진으로 계산한다(전부 실제 엔진 결과다).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-refine-'));
  const BUDGET = 16;
  const run = (name, ...args) => {
    const out = path.join(dir, `${name}.json`);
    const r = spawnSync(
      process.execPath,
      ['src/cli.mjs', 'suggest', '--cache-dir', path.join(dir, 'cache'), '--account', ACCOUNT, '--condition', CONDITION, '--limit', '6', '--top', '6', '--json', out, ...args],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    return { stdout: r.stdout, report: JSON.parse(fs.readFileSync(out, 'utf8')) };
  };
  try {
    const plain = run('plain', '--no-refine');
    assert.equal(plain.report.cache.misses, 6, '1단계 후보를 실제 엔진으로 계산했다');
    assert.equal(plain.report.suggestion.search.stage2, null);
    assert.match(plain.stdout, /^탐색: 시뮬 6건 \/ 예산 120건 \(1단계 조합 6건 · 배치 탐색 끔\)$/m);

    // --refine은 기본이다(적지 않아도 같다). 예산은 1단계 6건 + 2단계 10건.
    const refined = run('refined', '--budget', String(BUDGET));
    const search = refined.report.suggestion.search;
    assert.equal(search.refine, true);
    assert.equal(search.budget, BUDGET);
    assert.ok(search.sims <= BUDGET, `시뮬 ${search.sims}건`);
    assert.deepEqual(search.stage1, { requested: 6, skipped: 0 });
    assert.equal(search.stage2.combos, 5);
    assert.equal(search.stage2.requested, BUDGET - 6);
    assert.equal(refined.report.cache.hits + refined.report.cache.misses, search.sims, '엔진에 맡긴 요청 수가 곧 시뮬 횟수다');
    assert.equal(refined.report.cache.misses, search.stage2.requested, '배치 변형은 모두 실제 엔진으로 새로 계산했다');
    assert.equal(refined.report.failed.length, 0, JSON.stringify(refined.report.failed));

    // 수락 조건: --refine 결과의 1위 총딜 ≥ --no-refine 1위 총딜.
    assert.ok(refined.report.ranking[0].total_damage >= plain.report.ranking[0].total_damage);
    assert.equal(search.best_stage1_total, plain.report.ranking[0].total_damage);
    assert.equal(search.best_total, refined.report.ranking[0].total_damage);

    // 조합마다 한 줄이고, 조합별 총딜은 1단계 이상이다. 2단계 대상에는 배치 메모가 있다.
    const before = new Map(plain.report.ranking.map((r) => [r.name, r]));
    assert.equal(new Set(refined.report.ranking.map((r) => [...r.members.map((m) => m.name)].sort().join('|'))).size, refined.report.ranking.length);
    let refinedCombos = 0;
    for (const r of refined.report.ranking) {
      const original = before.get(r.name);
      assertValidMembers(r.members.map((m) => m.name), r.name);
      assert.deepEqual(r.members.map((m) => m.name).sort(), original.members.map((m) => m.name).sort(), r.name);
      assert.ok(r.total_damage >= original.total_damage, r.name);
      if (r.placement === null) continue;
      refinedCombos += 1;
      assert.equal(r.placement.original_total_damage, original.total_damage);
      assert.deepEqual(r.placement.original_members, original.members.map((m) => m.name));
      assert.equal(r.placement.changed, r.total_damage > original.total_damage);
      assert.equal(r.notes.filter((n) => n.startsWith('배치 탐색')).length, 1);
    }
    assert.equal(refinedCombos, 5);
    if (search.stage2.skipped > 0) {
      assert.ok(refined.report.caveats.some((c) => c.includes(`배치 변형 ${search.stage2.variants}개 중 ${search.stage2.skipped}개를 계산하지 못했다`)));
    }
    assert.match(refined.stdout, /^탐색: 시뮬 16건 \/ 예산 16건 \(1단계 조합 6건 \+ 2단계 배치 10건\)/m);
    assert.match(refined.stdout, /! 배치 탐색: /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI suggest: 잘못된 인자는 엔진을 부르기 전에 종료 코드 2', () => {
  const badLimit = cli('--account', ACCOUNT, '--condition', CONDITION, '--limit', '0');
  assert.equal(badLimit.status, 2);
  assert.match(badLimit.stderr, /입력 오류.*--limit/);
  const badBudget = cli('--account', ACCOUNT, '--condition', CONDITION, '--budget', '0');
  assert.equal(badBudget.status, 2);
  assert.match(badBudget.stderr, /입력 오류.*--budget/);
  const both = cli('--account', ACCOUNT, '--condition', CONDITION, '--refine', '--no-refine');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /입력 오류.*--refine과 --no-refine을 함께 줄 수 없다/);
  const noCondition = cli('--account', ACCOUNT);
  assert.equal(noCondition.status, 2);
  assert.match(noCondition.stderr, /입력 오류.*--condition/);
});
