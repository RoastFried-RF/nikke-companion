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

test('CLI suggest: 샘플 계정으로 후보를 만들어 실제 엔진으로 비교하고 상위 편성을 출력한다', () => {
  const out = path.join(os.tmpdir(), `nikke-suggest-${process.pid}.json`);
  try {
    const run = cli('--account', ACCOUNT, '--condition', CONDITION, '--limit', '6', '--top', '3', '--json', out);
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

test('CLI suggest: 잘못된 인자는 엔진을 부르기 전에 종료 코드 2', () => {
  const badLimit = cli('--account', ACCOUNT, '--condition', CONDITION, '--limit', '0');
  assert.equal(badLimit.status, 2);
  assert.match(badLimit.stderr, /입력 오류.*--limit/);
  const noCondition = cli('--account', ACCOUNT);
  assert.equal(noCondition.status, 2);
  assert.match(noCondition.stderr, /입력 오류.*--condition/);
});
