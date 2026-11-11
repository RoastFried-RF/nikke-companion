import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAccount, toEngineProfile, toEngineEntry } from '../../src/core/account.mjs';

const catalog = { nikkes: { 크라운: { burst_stage: '2' }, 헬름: { burst_stage: '3' } }, bosses: [] };
const base = () => ({ schema_version: 1, is_test_data: true, nikkes: { 크라운: { skill_levels: [10, 10, 10], breakthrough: 3 } } });

test('올바른 계정은 통과하고 검증용 데이터임을 경고로 알린다', () => {
  const r = validateAccount(base(), catalog);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /검증용/);
});

test('검증용 여부를 밝히지 않으면 오류다', () => {
  const a = base();
  delete a.is_test_data;
  const r = validateAccount(a, catalog);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, '/is_test_data');
});

test('엔진이 모르는 니케 이름은 경로와 함께 오류다', () => {
  const a = base();
  a.nikkes['없는 니케'] = {};
  const r = validateAccount(a, catalog);
  assert.deepEqual(r.errors.map((e) => e.path), ['/nikkes/없는 니케']);
});

test('범위를 벗어난 값과 모르는 칸을 잡는다', () => {
  const a = base();
  a.nikkes.크라운 = { skill_levels: [10, 11, 10], breakthrough: 4, core_enhancement: 8, level: 400 };
  const paths = validateAccount(a, catalog).errors.map((e) => e.path).sort();
  assert.deepEqual(paths, [
    '/nikkes/크라운/breakthrough',
    '/nikkes/크라운/core_enhancement',
    '/nikkes/크라운/level',
    '/nikkes/크라운/skill_levels',
  ]);
});

test('값을 적은 칸을 미확인으로 표시하면 오류다', () => {
  const a = base();
  a.nikkes.크라운.unknown = ['breakthrough'];
  assert.equal(validateAccount(a, catalog).ok, false);
});

test('엔진 프로필에는 편성 멤버만 싣고 base는 ungrown이며 메타 칸은 넘기지 않는다', () => {
  const a = base();
  a.nikkes.크라운.unknown = ['overload'];
  a.nikkes.크라운.note = '메모';
  a.nikkes.헬름 = { skill_levels: [4, 4, 4] };
  const p = toEngineProfile(a, ['크라운']);
  assert.equal(p.base, 'ungrown');
  assert.deepEqual(Object.keys(p.chars), ['크라운']);
  assert.deepEqual(p.chars.크라운.skill_levels, [10, 10, 10]);
  assert.equal(p.chars.크라운.breakthrough, 3);
  assert.ok(!('unknown' in p.chars.크라운) && !('note' in p.chars.크라운));
});

// 엔진은 항목이 있는 니케의 적지 않은 칸을 기본 스펙(만렙)으로 계산한다. 그대로 넘기면 안 된다.
test('적지 않은 칸은 미육성 값으로 채운다: 빈 항목은 장비 미장착·오버로드 0줄', () => {
  const e = toEngineEntry({});
  assert.deepEqual(
    { breakthrough: e.breakthrough, core_enhancement: e.core_enhancement, affinity: e.affinity, skill_levels: e.skill_levels, collection_stage: e.collection_stage, favorite_stage: e.favorite_stage },
    { breakthrough: 0, core_enhancement: 0, affinity: 1, skill_levels: [1, 1, 1], collection_stage: '없음', favorite_stage: 0 },
  );
  assert.deepEqual(Object.keys(e.equipment), ['머리', '몸통', '팔', '다리']);
  assert.ok(Object.values(e.equipment).every((g) => g.tier === '없음'));
  assert.equal(Object.keys(e.overload).length, 9);
  assert.ok(Object.values(e.overload).every((v) => v === 0));
});

test('오버로드 줄을 적으면 그 옵션만 남기고 나머지는 0줄, 장비는 엔진 기본(오버로드 장비)에 맡긴다', () => {
  const e = toEngineEntry({ overload: { 공격력: 2, '우월 코드 대미지': [10, 12] } });
  assert.equal(e.overload.공격력, 2);
  assert.deepEqual(e.overload['우월 코드 대미지'], [10, 12]);
  assert.ok(!('atk_pct' in e.overload) && !('element_bonus' in e.overload), '같은 옵션을 두 표기로 넣으면 엔진이 거절한다');
  assert.equal(Object.keys(e.overload).length, 9);
  assert.equal(e.overload.crit_rate, 0);
  assert.ok(!('equipment' in e));
});

test('장비를 직접 적었으면 그대로 넘기고, 오버로드가 전부 0줄이면 미장착으로 본다', () => {
  const gear = { 머리: { tier: 'T9', level: 5 } };
  assert.deepEqual(toEngineEntry({ equipment: gear }).equipment, gear);
  assert.ok(Object.values(toEngineEntry({ overload: { 공격력: 0 } }).equipment).every((g) => g.tier === '없음'));
});

test('equip_skills로 적은 옵션은 overload에 다시 넣지 않는다', () => {
  const e = toEngineEntry({ equip_skills: { atk_pct: 12.5 } });
  assert.ok(!('atk_pct' in e.overload));
  assert.equal(Object.keys(e.overload).length, 8);
  assert.ok(!('equipment' in e));
});
