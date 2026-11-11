// `detect-changes` 명령을 실제 엔진 서브모듈(vendor/nikke-calc)의 커밋으로 돌리는 검증. 시뮬은 하지 않는다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { engineVersion, loadCatalog } from '../../src/core/engine.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cli = (...args) => spawnSync(process.execPath, ['src/cli.mjs', 'detect-changes', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

test('CLI detect-changes: 실제 엔진의 같은 커밋끼리는 변경이 없고, 니케 전원이 그대로다', () => {
  const run = cli('--from', 'HEAD', '--to', 'HEAD');
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  const head = engineVersion().commit;
  assert.equal(report.engine.from.commit, head);
  assert.equal(report.engine.to.commit, head);
  assert.deepEqual([report.added, report.changed, report.removed, report.hold], [[], [], [], []]);
  assert.equal(report.summary.unchanged, Object.keys(loadCatalog().nikkes).length);
});

test('CLI detect-changes: 실제 엔진의 직전 커밋과 비교한 결과가 형식에 맞다', () => {
  const run = cli('--from', 'HEAD~1', '--to', 'HEAD');
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.kind, 'data_changes');
  const { summary } = report;
  assert.deepEqual([summary.added, summary.changed, summary.removed], [report.added.length, report.changed.length, report.removed.length]);
  for (const e of [...report.added, ...report.changed]) assert.ok(['ready', 'hold'].includes(e.evaluation.status), e.name);
  assert.deepEqual(report.hold, [...report.added, ...report.changed].filter((e) => e.evaluation.status === 'hold').map((e) => e.name).sort());
});
