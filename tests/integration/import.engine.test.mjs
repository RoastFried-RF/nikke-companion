// 가져온 계정이 실제 엔진(vendor/nikke-calc)에서 계산되는지 확인한다. 수십 초 걸린다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toEngineProfile, validateAccount } from '../../src/core/account.mjs';
import { compareSquads } from '../../src/core/compare.mjs';
import { toEngineBase } from '../../src/core/condition.mjs';
import { runBatch, loadCatalog, nodeRuntime } from '../../src/runtime/node.mjs';
import { importProfile } from '../../src/runtime/import-profile.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sample = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/samples', f), 'utf8'));
const profile = sample('profile.sample.json');
const condition = sample('condition.solo-raid.json');
const members = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];

test('샘플 프로필을 실제 엔진 데이터로 가져오면 모두 옮겨지고 검사를 통과한다', () => {
  const { account, skipped, unknown, warnings } = importProfile(profile);
  assert.deepEqual([skipped, unknown, warnings], [[], [], []]);
  assert.equal(validateAccount(account, loadCatalog()).ok, true);
  // 줄 단위로 옮겨졌다(엔진의 실제 옵션 표와 수치가 맞는다).
  for (const name of members) assert.ok('overload' in account.nikkes[name] && !('equip_skills' in account.nikkes[name]), name);
});

test('가져온 계정으로 편성 비교가 끝까지 돌고, 엔진 프로필을 그대로 넘긴 계산과 총딜이 같다', async () => {
  const { account } = importProfile(profile);
  const report = await compareSquads({ account, condition, squads: [{ name: '가져온 계정', members }] }, { runtime: nodeRuntime });
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.rejected, []);
  assert.equal(report.ranking.length, 1);
  assert.deepEqual(report.ranking[0].ungrown_members, []);
  assert.ok(report.ranking[0].total_damage > 0);

  // 기준: 프로필 항목을 엔진 표기 그대로(합산 수치 `equip_skills`) 인라인으로 넘긴 계산.
  // 인라인 요청은 장비 안의 주석 키(`_track`)를 받지 않으므로 그것만 뗀다.
  const chars = {};
  for (const name of members) {
    const entry = structuredClone(profile.chars[name]);
    for (const gear of Object.values(entry.equipment)) delete gear._track;
    chars[name] = entry;
  }
  const direct = { base: 'ungrown', chars, _account: { console: profile._account.console } };
  const [a, b] = await runBatch([
    { ...toEngineBase(condition), squad: members, profile: direct },
    { ...toEngineBase(condition), squad: members, profile: toEngineProfile(account, members) },
  ]);
  assert.equal(a.error, undefined, JSON.stringify(a.error));
  assert.equal(b.error, undefined, JSON.stringify(b.error));
  assert.equal(b.total_damage, a.total_damage, '변환이 계산 값을 바꾸면 안 된다');
  assert.equal(b.total_damage, report.ranking[0].total_damage);
  assert.deepEqual(b.members.map((m) => [m.name, m.damage]), a.members.map((m) => [m.name, m.damage]));
});
