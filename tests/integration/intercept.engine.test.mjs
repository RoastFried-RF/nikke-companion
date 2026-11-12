// 요격전(이상 개체) 보스별 편성 추천을 실제 엔진(vendor/nikke-calc)으로 확인한다. 수십 초 걸린다.
//   - 옮겨 적은 엔진 규칙(속성 상성 표, 기본 적)이 엔진의 것과 같은가
//   - 속성 상성과 레벨이 실제 계산에 반영되는가
//   - 샘플 계정 + 실제 보스 묶음(data/intercept/anomaly.json)으로 보스 5종의 추천이 나오는가
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toEngineProfile } from '../../src/core/account.mjs';
import { levelPlan, toEngineBase, validateCondition, ENGINE_FIXED_LEVEL } from '../../src/core/condition.mjs';
import { bossCondition, validateBossBundle, ELEMENT_ADVANTAGE, ENGINE_ENEMY_DEFAULTS } from '../../src/core/intercept.mjs';
import { DEFAULT_ENGINE_DIR, engineVersion, loadCatalog, nodeRuntime } from '../../src/runtime/node.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ACCOUNT = 'data/samples/account.sample.json';
const BOSSES = 'data/intercept/anomaly.json';
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const account = readJson(ACCOUNT);
const bundle = readJson(BOSSES);
const catalog = loadCatalog();
const bossNamed = (name) => bundle.bosses.find((b) => b.name === name);
const damageOf = (result, name) => result.members.find((m) => m.name === name).damage;

/** 엔진의 파이썬 모듈에서 값을 읽는다(시뮬을 돌리지 않는다). 출력은 ASCII JSON이라 콘솔 인코딩과 무관하다. */
function enginePython(code) {
  const run = spawnSync(process.env.NIKKE_PYTHON ?? 'python', ['-c', code], {
    cwd: DEFAULT_ENGINE_DIR,
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('옮겨 적은 속성 상성 표는 엔진의 것(calculator/damage.py의 _CODE_ADVANTAGE)과 같다', () => {
  const engineTable = enginePython('import json; from calculator.damage import _CODE_ADVANTAGE; print(json.dumps(_CODE_ADVANTAGE))');
  assert.deepEqual({ ...ELEMENT_ADVANTAGE }, engineTable);
  // 실제 보스 묶음의 다섯 보스: 약점이 보스 속성에 우월하다 — 엔진의 표로 직접 확인한다.
  assert.deepEqual(validateBossBundle(bundle).errors, []);
  assert.equal(bundle.bosses.length, 5);
  for (const b of bundle.bosses) assert.equal(engineTable[b.weak_to], b.enemy.code, `${b.name}: 약점 ${b.weak_to} → 보스 속성 ${b.enemy.code}`);
});

test('속성 상성과 레벨이 실제 계산에 반영된다 — 같은 편성, 적 속성만 다른 두 보스', async () => {
  // 앨리스(작열)는 인디빌리아(풍압, 약점 작열)에, 리틀 머메이드(풍압)는 크라켄(철갑, 약점 풍압)에 우월하다.
  const squad = ['리틀 머메이드', '크라운', '프리카', '헬름', '앨리스'];
  assert.equal(catalog.nikkes['앨리스'].element_code, '작열');
  assert.equal(catalog.nikkes['리틀 머메이드'].element_code, '풍압');
  const indivilia = bossCondition(bossNamed('인디빌리아'), bundle.content);
  const kraken = bossCondition(bossNamed('크라켄'), bundle.content);
  assert.deepEqual([indivilia.enemy, kraken.enemy], [{ code: '풍압' }, { code: '철갑' }], '두 조건은 적 속성만 다르다');
  assert.deepEqual({ ...indivilia, enemy: null }, { ...kraken, enemy: null });
  for (const c of [indivilia, kraken]) assert.equal(validateCondition(c, catalog).ok, true);

  const requestOf = (condition, acct) => {
    const level = levelPlan(condition, acct);
    return { ...toEngineBase(condition, level), squad, profile: toEngineProfile(acct, squad, level) };
  };
  const noElement = { schema_version: 1, content: bundle.content, level_cap: 400 }; // 속성을 모르는 보스의 조건
  const lowLevel = { ...account, account: { synchro_level: 258 } }; // docs/intercept.md: 캡처한 계정의 니케 레벨
  const [vsWind, vsIron, vsNone, vsWindLow] = await nodeRuntime.runBatch([
    requestOf(indivilia, account),
    requestOf(kraken, account),
    requestOf(noElement, account),
    requestOf(indivilia, lowLevel),
  ]);
  for (const r of [vsWind, vsIron, vsNone, vsWindLow]) assert.equal(r.error, undefined, JSON.stringify(r.error));

  // 우위인 니케의 딜은 우위일 때 더 크다.
  assert.ok(damageOf(vsWind, '앨리스') > damageOf(vsIron, '앨리스'), '앨리스(작열)는 풍압 보스에서 더 큰 딜');
  assert.ok(damageOf(vsIron, '리틀 머메이드') > damageOf(vsWind, '리틀 머메이드'), '리틀 머메이드(풍압)는 철갑 보스에서 더 큰 딜');
  // 우위가 아닌 쪽의 딜은 속성 없는 적과 같다 — 속성을 모르면 아무에게도 보너스가 붙지 않는다(속성 상성 미반영).
  assert.equal(damageOf(vsIron, '앨리스'), damageOf(vsNone, '앨리스'));
  assert.equal(damageOf(vsWind, '리틀 머메이드'), damageOf(vsNone, '리틀 머메이드'));
  assert.ok(vsWind.total_damage > vsNone.total_damage && vsIron.total_damage > vsNone.total_damage);

  // 엔진이 실제로 적용한 적: 적지 않은 칸은 옮겨 적은 기본값(ENGINE_ENEMY_DEFAULTS)과 같다.
  const applied = (r) => Object.fromEntries(Object.keys(ENGINE_ENEMY_DEFAULTS).map((k) => [k, r.boss[k]]));
  assert.deepEqual(applied(vsNone), { ...ENGINE_ENEMY_DEFAULTS, optimal_range_weapons: [] });
  assert.deepEqual(applied(vsWind), { ...ENGINE_ENEMY_DEFAULTS, optimal_range_weapons: [], code: '풍압' });
  assert.equal(vsWind.duration, 180);

  // 레벨: 동기화 레벨을 모르면 상한 400(= 엔진 정책 fixed), 258이면 sync 258 — 딜이 낮아진다.
  assert.equal(ENGINE_FIXED_LEVEL, 400);
  assert.equal(vsWind.spec.profile.level_mode, 'fixed');
  assert.equal(vsWindLow.spec.profile.level_mode, 'sync');
  assert.ok(vsWindLow.total_damage < vsWind.total_damage, `레벨 258: ${vsWindLow.total_damage} < 레벨 400: ${vsWind.total_damage}`);
  for (const name of squad) assert.ok(damageOf(vsWindLow, name) < damageOf(vsWind, name), name);
});

test('CLI intercept: 샘플 계정 + 실제 보스 묶음으로 보스 5종의 추천이 나온다 (실제 엔진, 작은 예산)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-intercept-'));
  const BUDGET = 15; // 보스마다 3건
  const run = (name, env = {}) => {
    const out = path.join(dir, `${name}.json`);
    const r = spawnSync(
      process.execPath,
      ['src/cli.mjs', 'intercept', '--account', ACCOUNT, '--budget', String(BUDGET), '--top', '2', '--cache-dir', path.join(dir, 'cache'), '--json', out],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } },
    );
    assert.equal(r.status, 0, r.stderr);
    return { stdout: r.stdout, stderr: r.stderr, report: JSON.parse(fs.readFileSync(out, 'utf8')) };
  };
  try {
    const first = run('first'); // --bosses를 주지 않았다 — 기본이 data/intercept/anomaly.json이다
    const report = first.report;
    assert.equal(report.kind, 'intercept_report');
    assert.equal(report.schema_version, 1);
    assert.equal(report.content, 'anomaly_interception');
    assert.equal(report.engine.commit, engineVersion().commit, '결과의 엔진 버전은 실제 서브모듈 커밋이어야 한다');
    assert.equal(report.account.is_test_data, true);
    assert.equal(report.bundle.is_test_data, false);
    assert.equal(report.bundle.source, bundle.source);
    assert.equal(report.sims.budget, BUDGET);
    assert.ok(report.sims.used <= BUDGET);
    assert.equal(report.cache.hits + report.cache.misses, report.sims.used, '엔진에 맡긴 요청 수가 곧 시뮬 횟수다');
    assert.equal(report.cache.misses, report.sims.used, '첫 실행은 모두 실제 엔진으로 계산했다');

    assert.deepEqual(report.bosses.map((b) => b.name), ['인디빌리아', '울트라', '하베스터', '크라켄', '미러 컨테이너']);
    for (const [i, b] of report.bosses.entries()) {
      const src = bundle.bosses[i];
      assert.equal(b.status, 'computed', b.name);
      assert.deepEqual([b.element.code, b.element.weak_to, b.reward], [src.enemy.code, src.weak_to, src.reward]);
      assert.deepEqual(b.flags, []);
      assert.equal(b.budget, 3);
      assert.ok(b.sims <= 3);
      assert.equal(b.failed.length, 0, JSON.stringify(b.failed));
      assert.equal(b.rejected.length, 0, JSON.stringify(b.rejected));
      assert.deepEqual(b.ranking.map((r) => r.rank), [1, 2]);
      assert.equal(b.ranking[0].relative_to_best, 1);
      for (const r of b.ranking) {
        assert.equal(r.members.length, 5);
        assert.equal(new Set(r.members.map((m) => m.name)).size, 5);
        for (const m of r.members) assert.ok(m.name in account.nikkes, `${b.name}: 미보유 ${m.name}`);
        assert.ok(Number.isInteger(r.total_damage) && r.total_damage > 0);
        assert.equal(r.members.reduce((s, m) => s + m.damage, 0), r.total_damage);
      }
      assert.ok(b.ranking[0].total_damage >= b.ranking[1].total_damage);
      assert.equal(b.ranking[1].relative_to_best, b.ranking[1].total_damage / b.ranking[0].total_damage);
      // 미확인 칸과 계산한 값이 붙어 있다.
      assert.deepEqual(b.unconfirmed.map((u) => u.field), ['duration', 'def', 'core_px', 'distance', 'has_parts', 'part_break_interval', 'optimal_range_weapons']);
      assert.equal(b.level.cap, 400);
      assert.equal(b.level.assumed, true, '샘플 계정에는 동기화 레벨이 없다');
    }
    // 보스마다 조건이 다르게 들어갔다: 같은 후보 편성의 총딜이 보스에 따라 다르다.
    const totals = report.bosses.map((b) => b.ranking[0].total_damage);
    assert.ok(new Set(totals).size > 1, `보스별 1위 총딜: ${totals.join(', ')}`);

    const text = report.caveats.join('\n');
    assert.match(text, /실제 요격전 기록과 대조하지 않았다/);
    assert.match(text, /보스 패턴 미반영/);
    assert.match(text, /미확인 값이 있는 보스 5종/);
    assert.match(text, /전체 시뮬 예산 15건을 보스 5종에 3건씩 나눴다/);
    assert.match(text, /시뮬 예산 3건이 모자라 후보 \d+개/);
    assert.match(text, /레벨 상한 400: 계정에 동기화 레벨\(account\.synchro_level\)이 없어 전원을 레벨 400으로 계산했다/);

    assert.match(first.stdout, /^계정: 검증용 샘플 계정 {2}\[검증용 데이터\]$/m);
    assert.match(first.stdout, /^■ 인디빌리아 {2}속성 풍압 · 약점 작열 · 보상 몸통 장비 /m);
    assert.match(first.stdout, /^■ 크라켄 {2}속성 철갑 · 약점 풍압 · 보상 커스텀 모듈 /m);
    assert.match(first.stdout, /^ {4}\? 방어력: 31,784\(엔진 기본값/m);
    assert.match(first.stdout, /^ {2}1위 {2}후보 \d+ {2}총딜 /m);
    assert.doesNotMatch(first.stdout, /3위/);
    assert.match(first.stderr, /보스 5\/5 미러 컨테이너 — 시뮬 예산 3건/);

    // 같은 입력이면 같은 결과다. 두 번째는 캐시에서 채워져 엔진 없이도(없는 python) 같은 수치가 나온다.
    const second = run('second', { NIKKE_PYTHON: path.join(os.tmpdir(), '없는-파이썬-nikke-intercept-test.exe') });
    assert.equal(second.report.cache.hits, report.sims.used);
    assert.equal(second.report.cache.misses, 0);
    const stable = (r) => ({ ...r, generated_at: null, cache: null });
    assert.deepEqual(stable(second.report), stable(report));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI intercept: --boss로 한 보스만, 샘플 보스 묶음의 속성 미상 보스는 속성 상성 미반영으로 표시된다', () => {
  const run = spawnSync(
    process.execPath,
    ['src/cli.mjs', 'intercept', '--no-cache', '--account', ACCOUNT, '--bosses', 'data/samples/bosses.anomaly.sample.json', '--boss', '시험 보스 E', '--budget', '2', '--top', '1'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /보스 1종 {2}\[검증용 보스 묶음\]/);
  assert.match(run.stdout, /^■ 시험 보스 E {2}속성 미확인 · 약점 미확인 .*\n {2}!! 속성 상성 미반영 !!$/m);
  assert.match(run.stdout, /^ {2}1위 {2}후보 \d+ {2}총딜 /m);
  assert.match(run.stdout, /^캐시: 쓰지 않음$/m);
  assert.equal((run.stdout.match(/^■ /gm) ?? []).length, 1);
});

test('CLI intercept: 잘못된 인자·보스 묶음은 엔진을 부르기 전에 종료 코드 2', () => {
  const cli = (...args) => spawnSync(process.execPath, ['src/cli.mjs', 'intercept', '--no-cache', ...args], { cwd: ROOT, encoding: 'utf8' });
  const noAccount = cli();
  assert.equal(noAccount.status, 2);
  assert.match(noAccount.stderr, /입력 오류.*--account/);
  const badBudget = cli('--account', ACCOUNT, '--budget', '0');
  assert.equal(badBudget.status, 2);
  assert.match(badBudget.stderr, /입력 오류.*--budget/);
  const noBoss = cli('--account', ACCOUNT, '--boss', '없는 보스');
  assert.equal(noBoss.status, 2);
  assert.match(noBoss.stderr, /입력 오류 — 보스를 찾을 수 없다.*인디빌리아\(indivilia\)/);
  // 전투 조건 파일은 보스 묶음이 아니다 — 어느 칸이 틀렸는지 경로와 함께 알린다.
  const notBundle = cli('--account', ACCOUNT, '--bosses', 'data/samples/condition.solo-raid.json');
  assert.equal(notBundle.status, 2);
  assert.match(notBundle.stderr, /입력 오류 — 보스 묶음이 잘못됐다: .*\/content content는 anomaly_interception · interception 중 하나여야 한다/);
});
