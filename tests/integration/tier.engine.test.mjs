// `tier build` 명령을 실제 엔진(vendor/nikke-calc)으로 돌리는 검증. --only 네 명만 계산한다(시뮬 27건 — 1분 안쪽).
// 캐시 폴더는 임시 폴더다 — 저장소의 data/cache/sim은 건드리지 않는다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { engineVersion, loadCatalog, nodeRuntime } from '../../src/runtime/node.mjs';
import { tierRequest } from '../../src/tier/evaluate.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const references = read('data/tier/reference-squads.json');
const rules = read('data/tier/rules.json');
const catalog = loadCatalog();

// 헬름: 3단계 딜러(기준 편성에 없다) · 크라운: 2단계 서포터(기준 편성 S40_퀸유키코에 있다) ·
// 리틀 머메이드: 1단계 서포터(같은 편성에 있다) · test_B1: 엔진의 시험용 항목(스킬 효과 0개 → 평가 보류).
const ONLY = ['헬름', '크라운', '리틀 머메이드', 'test_B1'];

test('CLI tier build --only: 실제 엔진으로 네 명을 계산해 등급 또는 평가 보류가 나온다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-tier-'));
  const run = (name, ...args) => {
    const out = path.join(dir, `${name}.json`);
    const r = spawnSync(
      process.execPath,
      ['src/cli.mjs', 'tier', 'build', '--cache-dir', path.join(dir, 'cache'), '--only', ONLY.join(','), '--json', out, ...args],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    return { stdout: r.stdout, report: JSON.parse(fs.readFileSync(out, 'utf8')) };
  };
  try {
    const version = engineVersion();
    const { stdout, report } = run('first');

    // 결과에 실리는 판과 조건.
    assert.equal(report.kind, 'tier');
    assert.equal(report.engine.commit, version.commit, '결과의 엔진 버전은 실제 서브모듈 커밋이어야 한다');
    assert.match(report.engine_data.version, /^sha256:[0-9a-f]{16}$/);
    assert.deepEqual(Object.keys(report.engine_data.files).sort(), ['data/parsed_nikke.json', 'data/parsed_skills.json']);
    assert.equal(report.scenario.boss, references.scenario.boss);
    assert.equal(report.scenario.duration, references.scenario.duration);
    assert.equal(report.scenario.growth, 'engine_default');
    assert.equal(report.references.version, references.version);
    assert.equal(report.rules.version, rules.version);
    assert.deepEqual(report.rules.tiers.map((t) => [t.tier, t.min]), rules.tiers.map((t) => [t.tier, t.min]));
    assert.ok(Math.abs(Date.parse(report.generated_at) - Date.now()) < 10 * 60_000, '계산 시각');
    assert.ok(report.caveats.some((c) => c.includes(`등급 규칙 ${rules.version}은 임시다`)));
    assert.ok(report.caveats.some((c) => c.includes('실제 게임 기록과 대조하지 않았다')));

    // 기준 편성은 모두 실제 엔진으로 계산됐다.
    assert.equal(report.references.squads.length, references.squads.length);
    for (const s of report.references.squads) {
      assert.equal(s.status, 'used', `${s.id}: ${s.reason}`);
      assert.ok(Number.isInteger(s.total_damage) && s.total_damage > 0, s.id);
    }
    const refTotal = Object.fromEntries(report.references.squads.map((s) => [s.id, s.total_damage]));
    const refMembers = Object.fromEntries(report.references.squads.map((s) => [s.id, s.members]));

    // 니케마다 등급(예측 평가) 또는 평가 보류다.
    assert.deepEqual(report.entries.map((e) => e.name).sort(), [...ONLY].sort());
    const tiers = rules.tiers.map((t) => t.tier);
    for (const e of report.entries) {
      if (e.status === '예측 평가') {
        assert.ok(tiers.includes(e.tier), `${e.name}: ${e.tier}`);
        assert.ok(e.score > 0 && Number.isFinite(e.score), e.name);
        assert.equal(e.hold, null);
        assert.equal(e.score, Math.max(...e.comparisons.map((c) => c.ratio)), e.name);
        assert.equal(e.best.ratio, e.score);
        for (const c of e.comparisons) {
          assert.equal(c.reference_total, refTotal[c.reference]);
          assert.equal(c.ratio, c.total_damage / c.reference_total, '점수는 팀 총딜 비율이다');
          assert.equal(refMembers[c.reference][c.slot], c.replaced);
          assert.equal(catalog.nikkes[c.replaced].burst_stage, catalog.nikkes[e.name].burst_stage, '같은 버스트 단계 자리에 바꿔 넣는다');
          assert.equal(refMembers[c.reference].includes(e.name), false, '자기가 든 기준 편성과는 비교하지 않는다');
        }
      } else {
        assert.equal(e.status, '평가 보류', e.name);
        assert.equal(e.tier, null);
        assert.equal(e.score, null, '누락을 0점으로 치지 않는다');
        assert.ok(e.hold.message.length > 0);
      }
    }
    assert.doesNotMatch(JSON.stringify(report), /실측 대조 완료/);
    const entry = (name) => report.entries.find((e) => e.name === name);

    // 스킬 효과가 없는 항목은 시뮬 없이 평가 보류다.
    assert.equal(entry('test_B1').status_label, '평가 보류(스킬 효과 없음)');
    // 지금 엔진 데이터에서는 나머지 셋이 등급을 받는다(엔진이 계산하지 못하면 여기서 드러난다).
    for (const name of ['헬름', '크라운', '리틀 머메이드']) assert.equal(entry(name).status, '예측 평가', `${name}: ${entry(name).hold?.message}`);
    // 크라운·리틀 머메이드는 S40_퀸유키코의 멤버다 — 그 편성은 대조에서 빠진다.
    for (const name of ['크라운', '리틀 머메이드']) {
      assert.deepEqual(entry(name).excluded_references, [{ reference: 'S40_퀸유키코', reason: 'self' }]);
      assert.ok(entry(name).notes.some((n) => n.includes('S40_퀸유키코') && n.includes('이미 들어 있어')));
    }
    // 헬름(3단계)은 다섯 기준 편성의 3단계 자리 전부와 비교한다.
    assert.deepEqual([...new Set(entry('헬름').comparisons.map((c) => c.reference))], references.squads.map((s) => s.id));

    // 시뮬 횟수와 캐시: 처음에는 전부 실제 엔진으로 계산했다.
    const variants = report.entries.reduce((n, e) => n + e.comparisons.length, 0);
    assert.deepEqual(report.sims, { budget: 2000, used: 5 + variants, baselines: 5, variants, skipped_for_budget: 0 });
    assert.deepEqual(report.cache, { hits: 0, misses: report.sims.used, stored: report.sims.used, warnings: [] });

    // 표.
    assert.match(stdout, /^자동 티어 — 4명 \(등급 3명 · 평가 보류 1명\)$/m);
    assert.match(stdout, new RegExp(`^엔진: Jgaram/nikke-calc @ ${version.commit.slice(0, 8)} · 데이터 sha256:`, 'm'));
    assert.match(stdout, /\[예측 평가\]/);
    assert.match(stdout, /^ {2}- test_B1: 평가 보류\(스킬 효과 없음\)/m);
    assert.match(stdout, /대표 사례로 검증되지 않았다/);

    // 헬름의 가장 좋은 자리를 캐시 없이 엔진에 직접 물어 본 값과 같다(표준 육성 조건 = 프로필 없는 요청).
    const best = entry('헬름').best;
    const swapped = refMembers[best.reference].map((m, i) => (i === best.slot ? '헬름' : m));
    const [swappedRow, baseRow] = await nodeRuntime.runBatch([
      tierRequest(references.scenario, swapped),
      tierRequest(references.scenario, refMembers[best.reference]),
    ]);
    assert.equal(swappedRow.total_damage, best.total_damage);
    assert.equal(baseRow.total_damage, best.reference_total);
    assert.equal(swappedRow.spec.baseline, 'default', '육성 프로필 없이 엔진 기본 스펙으로 계산했다');
    assert.equal(swappedRow.expected, true);

    // 같은 입력이면 같은 결과다 — 두 번째는 엔진을 부르지 않고(전부 캐시 적중) 항목이 같다.
    const again = run('again').report;
    assert.deepEqual(again.cache, { hits: report.sims.used, misses: 0, stored: 0, warnings: [] });
    assert.deepEqual(again.entries, report.entries);
    assert.deepEqual(again.references, report.references);
    assert.deepEqual(again.sims, report.sims);

    // 시뮬 예산: 기준 5건 뒤 7건이 남는다 — 헬름(12건)은 못 보고, 크라운(5건)은 보고, 리틀 머메이드(5건)는 못 본다.
    const tight = run('tight', '--budget', '12');
    assert.ok(tight.report.sims.used <= 12, `시뮬 ${tight.report.sims.used}건`);
    assert.equal(tight.report.cache.hits + tight.report.cache.misses, tight.report.sims.used, '엔진에 맡긴 요청 수가 곧 시뮬 횟수다');
    const tightEntry = (name) => tight.report.entries.find((e) => e.name === name);
    assert.equal(tightEntry('헬름').status_label, '평가 보류(예산)');
    assert.equal(tightEntry('리틀 머메이드').status_label, '평가 보류(예산)');
    assert.equal(tightEntry('크라운').score, entry('크라운').score, '예산 안에서 계산한 니케의 점수는 예산과 무관하다');
    assert.equal(tight.report.sims.skipped_for_budget, 2);
    assert.match(tight.stdout, /^ {2}- 헬름: 평가 보류\(예산\)/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
