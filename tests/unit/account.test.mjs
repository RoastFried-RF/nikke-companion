import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAccount, toEngineProfile } from '../../src/core/account.mjs';

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

test('엔진 프로필에는 편성 멤버의 육성 칸만 싣고 base는 ungrown이다', () => {
  const a = base();
  a.nikkes.크라운.unknown = ['overload'];
  a.nikkes.크라운.note = '메모';
  a.nikkes.헬름 = { skill_levels: [4, 4, 4] };
  const p = toEngineProfile(a, ['크라운']);
  assert.equal(p.base, 'ungrown');
  assert.deepEqual(p.chars, { 크라운: { skill_levels: [10, 10, 10], breakthrough: 3 } });
});
