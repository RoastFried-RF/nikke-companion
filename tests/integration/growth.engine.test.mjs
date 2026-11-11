// `growth` 명령을 실제 엔진(vendor/nikke-calc)으로 돌리는 검증. 십여 초 걸린다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { engineVersion } from '../../src/runtime/node.mjs';
import { gainRate } from '../../src/core/growth.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ACCOUNT = 'data/samples/account.sample.json';
const CONDITION = 'data/samples/condition.solo-raid.json';
const SQUADS = 'data/samples/squads.sample.json';
const UPGRADES = 'data/samples/upgrades.sample.json';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const cli = (...args) => spawnSync(process.execPath, ['src/cli.mjs', 'growth', ...args], { cwd: ROOT, encoding: 'utf8' });

test('CLI growth: 샘플 계정에 업그레이드 후보를 가상 적용해 실제 엔진으로 전후 총딜과 증가율을 낸다', () => {
  const out = path.join(os.tmpdir(), `nikke-growth-${process.pid}.json`);
  const accountBefore = read(ACCOUNT);
  try {
    const run = cli('--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--squad', 'A 레드후드-앨리스', '--upgrades', UPGRADES, '--json', out);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /\[검증용 데이터\]/);
    assert.match(run.stdout, /기준 편성: A 레드후드-앨리스 {2}총딜 /);
    assert.match(run.stdout, /1위 {2}.+ {2}\+\d+\.\d{2}% {2}총딜 .+ → .+ \(\+.+\)/);
    assert.match(run.stdout, /기준 편성에 없는 니케만 바꾼다\(프리카\)/);
    assert.match(run.stdout, /재화·비용은 고려하지 않았다/);

    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(report.kind, 'growth');
    assert.equal(report.account.is_test_data, true);
    assert.equal(report.engine.commit, engineVersion().commit, '결과의 엔진 버전은 실제 서브모듈 커밋이어야 한다');
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed));

    const base = report.baseline;
    assert.ok(Number.isInteger(base.total_damage) && base.total_damage > 0);
    assert.deepEqual(base.members.map((m) => m.name), ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스']);
    assert.equal(base.members.reduce((s, m) => s + m.damage, 0), base.total_damage);

    // 계산한 후보 4건: 전후 총딜·증가량·증가율이 서로 맞고 증가율 내림차순이다.
    assert.deepEqual(
      report.ranking.map((r) => r.name).sort(),
      ['앨리스 우월코드 +1줄', '크라운 공격력 +2줄', '헬름 스킬 10/10/10', '헬름 코어 강화 +4'],
    );
    for (const [i, r] of report.ranking.entries()) {
      assert.equal(r.rank, i + 1);
      assert.equal(r.total_before, base.total_damage);
      assert.ok(Number.isInteger(r.total_after) && r.total_after > r.total_before, `${r.name}: 육성을 올렸으면 총딜이 올라야 한다`);
      assert.equal(r.gain, r.total_after - r.total_before);
      assert.equal(r.gain_rate, gainRate(r.total_before, r.total_after));
      assert.equal(r.members.reduce((s, m) => s + m.damage, 0), r.total_after);
      assert.equal(r.members.reduce((s, m) => s + m.gain, 0), r.gain);
      if (i > 0) assert.ok(report.ranking[i - 1].gain_rate >= r.gain_rate, '증가율 내림차순');
    }
    // 가상 적용한 값이 실제로 엔진에 갔다: 바꾼 니케 자신의 딜이 오른다.
    const by = Object.fromEntries(report.ranking.map((r) => [r.name, r]));
    const own = (name, nikke) => by[name].members.find((m) => m.name === nikke).gain;
    assert.ok(own('크라운 공격력 +2줄', '크라운') > 0);
    assert.ok(own('앨리스 우월코드 +1줄', '앨리스') > 0);
    assert.ok(own('헬름 코어 강화 +4', '헬름') > 0);
    assert.deepEqual(by['앨리스 우월코드 +1줄'].changes[0].after, { 공격력: 4, '우월 코드 대미지': 4, '차지 속도': 2 });

    // 계산할 수 없는 후보 2건은 사유와 함께 제외된다.
    assert.deepEqual(report.rejected.map((r) => r.name).sort(), ['앨리스 스킬 +1 (범위 밖)', '프리카 코어 강화 7 (기준 편성 밖)']);

    assert.equal(read(ACCOUNT), accountBefore, '계정 파일은 그대로다');
  } finally {
    fs.rmSync(out, { force: true });
  }
});

test('CLI growth: 잘못된 인자는 엔진을 부르기 전에 종료 코드 2', () => {
  const noUpgrades = cli('--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS);
  assert.equal(noUpgrades.status, 2);
  assert.match(noUpgrades.stderr, /입력 오류.*--upgrades/);
  const noSquad = cli('--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--squad', '없는 편성', '--upgrades', UPGRADES);
  assert.equal(noSquad.status, 2);
  assert.match(noSquad.stderr, /입력 오류.*그 이름의 편성이 없다/);
  // 기준 편성에 문제가 있으면(미보유 포함) 계산하지 않는다.
  const badSquad = cli('--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--squad', 'D 미보유 포함', '--upgrades', UPGRADES);
  assert.equal(badSquad.status, 2);
  assert.match(badSquad.stderr, /기준 편성이 잘못됐다.*보유하지 않은 니케: 홍련/);
});
