// P-004 수락 테스트. 구현하는 쪽은 이 파일을 고치지 않는다(.harness/tasks.json의 protected).
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDamage } from '../../src/core/format.mjs';
import { renderReport } from '../../src/core/render.mjs';

test('1억 이상은 억 단위 소수 둘째 자리까지, 버림', () => {
  assert.equal(formatDamage(4567032358), '45.67억');
  assert.equal(formatDamage(817282443), '8.17억');
  assert.equal(formatDamage(100000000), '1.00억');
  assert.equal(formatDamage(999999999999), '9,999.99억');
});

test('1조 이상은 조 단위 소수 둘째 자리까지, 버림', () => {
  assert.equal(formatDamage(1000000000000), '1.00조');
  assert.equal(formatDamage(12345678901234), '12.34조');
});

test('1만 이상 1억 미만은 만 단위 정수, 버림', () => {
  assert.equal(formatDamage(53731778), '5,373만');
  assert.equal(formatDamage(99999999), '9,999만');
  assert.equal(formatDamage(10000), '1만');
});

test('1만 미만은 그대로', () => {
  assert.equal(formatDamage(9999), '9,999');
  assert.equal(formatDamage(0), '0');
});

test('음수·정수가 아닌 값·유한하지 않은 값은 RangeError', () => {
  for (const v of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', null, undefined]) {
    assert.throws(() => formatDamage(v), RangeError, String(v));
  }
});

test('결과 표는 총딜을 단위 표기로 보여 주고 원값도 함께 남긴다', () => {
  const text = renderReport({
    account: { name: '시험', is_test_data: true },
    engine: { repo: 'x', commit: 'abcdef123456' },
    assumptions: [],
    ranking: [
      { rank: 1, name: 'A', total_damage: 4567032358, relative_to_best: 1, members: [{ name: '가', damage: 4567032358, share: 1 }], notes: [], ungrown_members: [] },
    ],
    rejected: [],
    failed: [],
    caveats: [],
  });
  assert.match(text, /45\.67억/);
  assert.match(text, /4,567,032,358/);
});
