// 시뮬 결과 캐시(src/core/cache.mjs + src/runtime/node.mjs의 파일 저장소)를 실제 엔진으로 확인한다. 십여 초 걸린다.
// 캐시 폴더는 테스트마다 임시 폴더다 — 저장소의 data/cache/sim은 건드리지 않는다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CACHE_SCHEMA_VERSION, cacheKey, withCache } from '../../src/core/cache.mjs';
import { compareSquads } from '../../src/core/compare.mjs';
import { createFileCacheStore, engineVersion, nodeRuntime } from '../../src/runtime/node.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ACCOUNT = 'data/samples/account.sample.json';
const CONDITION = 'data/samples/condition.solo-raid.json';
const SQUADS = 'data/samples/squads.sample.json';
const UPGRADES = 'data/samples/upgrades.sample.json';
const sample = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const account = sample(ACCOUNT);
const condition = sample(CONDITION);
const { squads } = sample(SQUADS);

const tempDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `nikke-cache-${label}-`));
const cacheFiles = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json')).map(String).sort() : [];

/** 엔진에 실제로 간 요청을 세는 Node 런타임. */
function countingRuntime() {
  const rt = {
    ...nodeRuntime,
    engineCalls: 0,
    sent: [],
    runBatch: (requests, options) => {
      rt.engineCalls += 1;
      rt.sent.push(...requests);
      return nodeRuntime.runBatch(requests, options);
    },
  };
  return rt;
}

/** `node src/cli.mjs <명령> …`. `env`로 엔진 실행 파일을 바꿔 "엔진을 부르면 실패"하게 만들 수 있다. */
function cli(command, args, env = {}) {
  return spawnSync(process.execPath, ['src/cli.mjs', command, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
}
/** 엔진을 한 번이라도 실행하려 하면 "엔진을 실행할 수 없다"로 끝나게 하는 환경. */
const NO_ENGINE = { NIKKE_PYTHON: path.join(os.tmpdir(), '없는-파이썬-nikke-cache-test.exe') };

const numbers = (report) => report.ranking.map((r) => [r.name, r.total_damage, r.members.map((m) => [m.name, m.damage])]);

test('같은 compare를 두 번 돌리면 두 번째는 엔진 호출 0건이고 수치가 같다 (실제 엔진, 파일 저장소)', async () => {
  const dir = tempDir('compare');
  try {
    const version = engineVersion();
    assert.match(version.commit, /^[0-9a-f]{40}$/);
    assert.equal(version.dirty, false, '엔진 서브모듈에 커밋하지 않은 변경이 있으면 캐시를 쓰지 않는다 — 이 테스트는 깨끗한 서브모듈이 필요하다');

    const rt = countingRuntime();
    const first = await compareSquads({ account, condition, squads }, { runtime: withCache(rt, createFileCacheStore(dir)) });
    assert.equal(first.ranking.length, 3);
    assert.deepEqual(first.cache, { hits: 0, misses: 3, stored: 3, warnings: [] });
    assert.equal(rt.engineCalls, 1);
    assert.equal(rt.sent.length, 3);
    assert.equal(cacheFiles(dir).length, 3);

    // 두 번째 — 다른 프로세스가 읽는 것처럼 저장소 객체를 새로 만든다.
    const second = await compareSquads({ account, condition, squads }, { runtime: withCache(rt, createFileCacheStore(dir)) });
    assert.deepEqual(second.cache, { hits: 3, misses: 0, stored: 0, warnings: [] });
    assert.equal(rt.engineCalls, 1, '두 번째에는 엔진을 부르지 않는다');
    assert.equal(rt.sent.length, 3);
    assert.deepEqual(numbers(second), numbers(first));
    assert.deepEqual(second.ranking, first.ranking, '순위·메모·엔진 알림까지 같다');
    assert.deepEqual(second.rejected, first.rejected);
    assert.deepEqual(second.engine, first.engine, '엔진 판은 저장된 결과가 밝힌 값이다');
    assert.equal(second.engine.commit, version.commit);

    // 캐시에서 읽은 수치는 캐시 없이 지금 다시 계산한 수치와 같다.
    const fresh = await compareSquads({ account, condition, squads }, { runtime: nodeRuntime });
    assert.equal(fresh.cache, null);
    assert.deepEqual(numbers(fresh), numbers(second));

    // 저장된 항목: 키 = 엔진 커밋 + 정규화된 요청, 내용은 docs/data-model.md §시뮬 결과 캐시.
    const key = await cacheKey(version.commit, rt.sent[0]);
    const file = path.join(dir, key.slice(0, 2), `${key}.json`);
    assert.ok(fs.existsSync(file), '첫 요청의 키로 만든 파일이 있다');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(entry.cache_schema_version, CACHE_SCHEMA_VERSION);
    assert.equal(entry.key, key);
    assert.deepEqual(entry.engine, { repo: version.repo, commit: version.commit });
    assert.deepEqual(entry.request, rt.sent[0]);
    assert.equal('id' in entry.result, false);
    assert.equal(entry.result.evaluator.commit, version.commit);
    assert.equal(entry.result.evaluator.dirty, false);
    assert.ok(Number.isInteger(entry.result.total_damage) && entry.result.total_damage > 0);
    assert.ok(!Number.isNaN(Date.parse(entry.stored_at)));

    // 편성을 하나 더하면(같은 5명, 배치 순서만 다름) 그것만 엔진에 간다.
    const reordered = { name: 'A 순서 바꿈', members: [...squads[0].members].reverse() };
    const more = await compareSquads({ account, condition, squads: [...squads, reordered] }, { runtime: withCache(rt, createFileCacheStore(dir)) });
    assert.deepEqual(more.cache, { hits: 3, misses: 1, stored: 1, warnings: [] });
    assert.equal(rt.engineCalls, 2);
    assert.deepEqual(rt.sent.at(-1).squad, reordered.members);
    const byName = Object.fromEntries(more.ranking.map((r) => [r.name, r.total_damage]));
    for (const r of first.ranking) assert.equal(byName[r.name], r.total_damage, r.name);
    assert.ok(Number.isInteger(byName['A 순서 바꿈']) && byName['A 순서 바꿈'] > 0);

    // 캐시 파일이 깨져도 실패하지 않는다: 그 건만 다시 계산하고 경고를 남긴다.
    fs.writeFileSync(file, '{"cache_schema_version": 1, "resu', 'utf8');
    const repaired = await compareSquads({ account, condition, squads }, { runtime: withCache(rt, createFileCacheStore(dir)) });
    assert.equal(repaired.cache.hits, 2);
    assert.equal(repaired.cache.misses, 1);
    assert.equal(repaired.cache.stored, 1);
    assert.equal(repaired.cache.warnings.length, 1);
    assert.match(repaired.cache.warnings[0], /^캐시를 읽지 못해 1건을 다시 계산했다: 캐시 파일이 JSON이 아니다/);
    assert.deepEqual(numbers(repaired), numbers(first));
    assert.equal(rt.engineCalls, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: compare·suggest·growth는 기본으로 캐시를 쓰고 표에 한 줄로 보인다. --no-cache로 끈다', () => {
  const dir = tempDir('cli');
  const out = path.join(dir, 'report.json');
  const cacheDir = path.join(dir, 'sim');
  const compareArgs = ['--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--json', out];
  const readReport = () => JSON.parse(fs.readFileSync(out, 'utf8'));
  try {
    // 처음: 모두 계산해 저장한다.
    const first = cli('compare', [...compareArgs, '--cache-dir', cacheDir]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^캐시: 적중 0건 · 엔진 계산 3건 · 새로 저장 3건$/m);
    const firstReport = readReport();
    assert.deepEqual(firstReport.cache, { hits: 0, misses: 3, stored: 3, warnings: [] });
    assert.equal(cacheFiles(cacheDir).length, 3);

    // 다시: 다른 프로세스인데도 엔진을 부르지 않는다 — 엔진 실행 파일이 없어도 성공한다.
    const second = cli('compare', [...compareArgs, '--cache-dir', cacheDir], NO_ENGINE);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /^캐시: 적중 3건 · 엔진 계산 0건 · 새로 저장 0건$/m);
    const secondReport = readReport();
    assert.deepEqual(secondReport.cache, { hits: 3, misses: 0, stored: 0, warnings: [] });
    assert.deepEqual(numbers(secondReport), numbers(firstReport));
    assert.deepEqual({ ...secondReport, generated_at: null, cache: null }, { ...firstReport, generated_at: null, cache: null });
    // 표도 캐시 줄 말고는 같다.
    const withoutCacheLine = (text) => text.split('\n').filter((l) => !l.startsWith('캐시:')).join('\n');
    assert.equal(withoutCacheLine(second.stdout), withoutCacheLine(first.stdout));

    // 위 "엔진 실행 파일이 없어도 성공"이 뜻이 있으려면, 같은 환경에서 캐시가 없을 때는 실패해야 한다.
    const noEngine = cli('compare', [...compareArgs, '--no-cache'], NO_ENGINE);
    assert.equal(noEngine.status, 1);
    assert.match(noEngine.stderr, /실행 오류 — 엔진을 실행할 수 없다/);

    // growth: 기준 편성(A)은 compare가 이미 계산했다 — 후보 4건만 엔진에 간다.
    const growth = cli('growth', ['--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--upgrades', UPGRADES, '--json', out, '--cache-dir', cacheDir]);
    assert.equal(growth.status, 0, growth.stderr);
    assert.match(growth.stdout, /^캐시: 적중 1건 · 엔진 계산 4건 · 새로 저장 4건$/m);
    const growthReport = readReport();
    assert.deepEqual(growthReport.cache, { hits: 1, misses: 4, stored: 4, warnings: [] });
    assert.equal(growthReport.baseline.total_damage, firstReport.ranking.find((r) => r.name === growthReport.baseline.name).total_damage);
    assert.equal(cacheFiles(cacheDir).length, 7);
    const growthAgain = cli('growth', ['--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--upgrades', UPGRADES, '--json', out, '--cache-dir', cacheDir], NO_ENGINE);
    assert.equal(growthAgain.status, 0, growthAgain.stderr);
    assert.match(growthAgain.stdout, /^캐시: 적중 5건 · 엔진 계산 0건 · 새로 저장 0건$/m);
    assert.deepEqual(readReport().ranking, growthReport.ranking);

    // suggest: 처음에는 계산하고, 다시 돌리면 엔진 없이 같은 순위다.
    const suggestArgs = ['--account', ACCOUNT, '--condition', CONDITION, '--limit', '4', '--top', '2', '--json', out, '--cache-dir', cacheDir];
    const suggest = cli('suggest', suggestArgs);
    assert.equal(suggest.status, 0, suggest.stderr);
    const suggestReport = readReport();
    assert.equal(suggestReport.cache.hits + suggestReport.cache.misses, 4);
    assert.equal(suggestReport.cache.stored, suggestReport.cache.misses);
    assert.deepEqual(suggestReport.cache.warnings, []);
    const suggestAgain = cli('suggest', suggestArgs, NO_ENGINE);
    assert.equal(suggestAgain.status, 0, suggestAgain.stderr);
    assert.match(suggestAgain.stdout, /^캐시: 적중 4건 · 엔진 계산 0건 · 새로 저장 0건$/m);
    assert.deepEqual(numbers(readReport()), numbers(suggestReport));

    // --no-cache: 읽지도 쓰지도 않는다. 수치는 캐시에서 읽은 것과 같다(실제 엔진으로 다시 계산).
    const before = cacheFiles(cacheDir);
    const off = cli('compare', [...compareArgs, '--no-cache', '--cache-dir', cacheDir]);
    assert.equal(off.status, 0, off.stderr);
    assert.match(off.stdout, /^캐시: 쓰지 않음$/m);
    const offReport = readReport();
    assert.equal(offReport.cache, null);
    assert.deepEqual(numbers(offReport), numbers(firstReport));
    assert.deepEqual(cacheFiles(cacheDir), before, '--no-cache는 캐시 폴더를 건드리지 않는다');

    // 캐시 폴더를 쓸 수 없어도(폴더 자리에 파일) 계산은 끝까지 하고 경고를 보인다.
    const notADir = path.join(dir, '폴더가 아니다');
    fs.writeFileSync(notADir, 'x');
    const broken = cli('compare', [...compareArgs, '--cache-dir', notADir]);
    assert.equal(broken.status, 0, broken.stderr);
    assert.match(broken.stdout, /^캐시: 적중 0건 · 엔진 계산 3건 · 새로 저장 0건$/m);
    assert.match(broken.stdout, /^ {2}! 캐시에 3건을 저장하지 못했다: 캐시 파일을 쓸 수 없다/m);
    const brokenReport = readReport();
    assert.deepEqual(numbers(brokenReport), numbers(firstReport));
    assert.ok(brokenReport.cache.warnings.length >= 1);

    // 값이 빠진 --cache-dir는 입력 오류다(엔진을 부르기 전).
    const missing = cli('compare', ['--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--cache-dir']);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /입력 오류.*--cache-dir/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('data/cache/는 .gitignore에 있다', () => {
  const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(ignored.includes('data/cache/'));
});
