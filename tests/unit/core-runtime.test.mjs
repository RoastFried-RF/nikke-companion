// 계산 모듈이 Node 없이(웹뷰에서) 돌 수 있는지의 정적 검사와, 런타임 주입 계약.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { suggestSquads } from '../../src/core/candidates.mjs';
import { compareSquads } from '../../src/core/compare.mjs';
import { compareGrowth } from '../../src/core/growth.mjs';
import { engineAccess, ENGINE_REPO } from '../../src/core/runtime.mjs';
import { createNodeRuntime, nodeRuntime } from '../../src/runtime/node.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CORE = path.join(ROOT, 'src/core');
/** 웹뷰와 Node CLI가 함께 쓰는 계산 모듈. */
const PURE_MODULES = ['account', 'condition', 'compare', 'candidates', 'search', 'growth', 'format', 'render', 'cache'];

/** 주석을 뺀 소스. 문자열 안의 `//`(경로 등)는 건드리지 않게 줄 맨 앞·공백 뒤의 주석만 지운다. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** 정적 import·export from·동적 import()가 가리키는 모듈 이름. */
function specifiers(source) {
  const found = [];
  const patterns = [
    /\bimport\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) found.push(m[1]);
  return found;
}

/** 시작 파일에서 상대 경로 import를 따라가며 닿는 모든 파일. */
function reachable(entries) {
  const seen = new Map();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const source = code(fs.readFileSync(file, 'utf8'));
    seen.set(file, source);
    for (const spec of specifiers(source)) {
      if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
    }
  }
  return seen;
}

test('정적 검사가 import 문을 실제로 잡아낸다', () => {
  const sample = [
    "import fs from 'node:fs';",
    "import { a,\n  b } from './x.mjs';",
    "import './side.mjs';",
    "export { c } from \"../y.mjs\";",
    "const m = await import('node:os');",
    "// import z from 'node:zlib';",
  ].join('\n');
  assert.deepEqual(specifiers(code(sample)).sort(), ['../y.mjs', './side.mjs', './x.mjs', 'node:fs', 'node:os']);
});

test('계산 모듈 파일에 node: import가 없다', () => {
  for (const name of PURE_MODULES) {
    const file = path.join(CORE, `${name}.mjs`);
    const source = code(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(specifiers(source).filter((s) => s.startsWith('node:')), [], `${name}.mjs`);
    assert.doesNotMatch(source, /['"]node:/, `${name}.mjs`);
  }
});

test('계산 모듈이 가져오는 파일을 끝까지 따라가도 Node 전용 모듈·전역에 닿지 않는다', () => {
  const files = reachable(PURE_MODULES.map((name) => path.join(CORE, `${name}.mjs`)));
  assert.ok(files.size >= PURE_MODULES.length);
  for (const [file, source] of files) {
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');
    assert.ok(rel.startsWith('src/core/'), `계산 모듈은 src/core 안의 파일만 가져온다: ${rel}`);
    for (const spec of specifiers(source)) {
      // 상대 경로가 아닌 이름(node:fs, fs, child_process, npm 패키지)은 웹뷰에서 풀리지 않는다.
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${rel}: '${spec}'를 가져온다`);
    }
    assert.doesNotMatch(source, /\bprocess\.(env|argv|cwd|platform|exit|stdout|stderr)\b|\bBuffer\.|\b__dirname\b|\brequire\s*\(/, rel);
  }
  // 옮긴 엔진 어댑터가 계산 모듈 쪽에 남아 있지 않다.
  assert.equal(fs.existsSync(path.join(CORE, 'engine.mjs')), false);
  assert.ok(![...files.keys()].some((f) => f.includes(`${path.sep}runtime${path.sep}`)), 'src/runtime은 주입받는다 — import하지 않는다');
});

test('Node 런타임은 계약의 세 함수를 갖는다', () => {
  for (const rt of [nodeRuntime, createNodeRuntime({ engineDir: 'x', python: 'y', concurrency: 1 })]) {
    assert.deepEqual(Object.keys(rt).sort(), ['engineVersion', 'loadCatalog', 'runBatch']);
    for (const fn of Object.values(rt)) assert.equal(typeof fn, 'function');
  }
});

// ── 런타임 주입 ───────────────────────────────────────────────────────────────

const stage = { 가: '1', 나: '2', 다: '3', 라: '3', 마: '3' };
const catalog = { nikkes: Object.fromEntries(Object.entries(stage).map(([n, s]) => [n, { burst_stage: s }])), bosses: ['보스'] };
const account = { schema_version: 1, is_test_data: true, nikkes: { 가: {}, 나: {}, 다: {}, 라: {}, 마: {} } };
const condition = { schema_version: 1, content: 'solo_raid', boss: '보스' };
const now = () => new Date('2026-11-12T00:00:00Z');
const MEMBERS = ['가', '나', '다', '라', '마'];

/** 웹뷰의 런타임처럼 모든 함수가 비동기인 가짜 런타임. evaluator를 주지 않아 engineVersion까지 불린다. */
function fakeRuntime(calls = []) {
  return {
    loadCatalog: async () => (calls.push('loadCatalog'), catalog),
    engineVersion: async () => (calls.push('engineVersion'), { repo: 'fake/engine', commit: 'f'.repeat(40) }),
    runBatch: async (requests, options) => {
      calls.push(['runBatch', requests.length, options]);
      return requests.map((req, i) => ({
        total_damage: 100 + i,
        members: req.squad.map((name) => ({ name, damage: (100 + i) / 5, share: 0.2 })),
        warnings: [],
      }));
    },
  };
}

test('compareSquads는 주입받은 런타임으로 카탈로그·엔진 실행·버전을 얻는다', async () => {
  const calls = [];
  const report = await compareSquads({ account, condition, squads: [{ members: MEMBERS }] }, { runtime: fakeRuntime(calls), now, concurrency: 2 });
  assert.deepEqual(calls, ['loadCatalog', ['runBatch', 1, { concurrency: 2 }], 'engineVersion']);
  assert.equal(report.ranking[0].total_damage, 100);
  assert.deepEqual(report.engine, { repo: 'fake/engine', commit: 'f'.repeat(40) });
});

test('suggestSquads·compareGrowth도 같은 런타임으로 돈다', async () => {
  const calls = [];
  const suggested = await suggestSquads({ account, condition }, { top: 1 }, { runtime: fakeRuntime(calls), now });
  assert.equal(suggested.ranking.length, 1);
  assert.equal(calls.filter((c) => c === 'loadCatalog').length, 1, '카탈로그는 한 번만 읽는다');

  const growth = await compareGrowth(
    { account, condition, squad: { members: MEMBERS }, upgrades: [{ nikke: '가', add: { core_enhancement: 1 } }] },
    { runtime: fakeRuntime(), now },
  );
  assert.equal(growth.ranking.length, 1);
  assert.equal(growth.engine.repo, 'fake/engine');
});

test('deps.catalog·deps.runBatch를 직접 주면 런타임보다 먼저다', async () => {
  const calls = [];
  const runBatch = async (requests) => requests.map((req) => ({ total_damage: 7, members: req.squad.map((name) => ({ name, damage: 0, share: 0 })) }));
  const report = await compareSquads({ account, condition, squads: [{ members: MEMBERS }] }, { runtime: fakeRuntime(calls), catalog, runBatch, now });
  assert.equal(report.ranking[0].total_damage, 7);
  assert.deepEqual(calls, ['engineVersion']);
});

test('런타임이 없으면 무엇이 빠졌는지 알리고 멈춘다. 버전은 지어내지 않는다', async () => {
  await assert.rejects(compareSquads({ account, condition, squads: [{ members: MEMBERS }] }), /엔진 런타임이 없다/);
  await assert.rejects(suggestSquads({ account, condition }), /엔진 런타임이 없다/);
  await assert.rejects(engineAccess({ catalog }).runBatch([]), /엔진 런타임이 없다/);
  assert.deepEqual(await engineAccess().version(), { repo: ENGINE_REPO, commit: null });
});
