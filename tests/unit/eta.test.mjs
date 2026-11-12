// 남은 시간 어림(src/core/eta.mjs)의 규칙과 문장.
import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateRemaining, ETA_MIN_DONE, ETA_TEXT_DONE, ETA_TEXT_SOON, ETA_TEXT_WARMING, formatRemaining } from '../../src/core/eta.mjs';

test('처음 몇 건 전에는 숫자를 내지 않고 「계산 중」만 말한다', () => {
  assert.equal(ETA_MIN_DONE, 3);
  for (const done of [0, 1, 2]) {
    assert.deepEqual(estimateRemaining({ done, total: 60, elapsedMs: 9000 }), { state: 'warming', remaining_ms: null, text: '계산 중' });
  }
  // 세 건째부터 어림한다.
  assert.equal(estimateRemaining({ done: 3, total: 60, elapsedMs: 9000 }).state, 'estimating');
  assert.equal(ETA_TEXT_WARMING, '계산 중');
});

test('평균 속도로 남은 시간을 어림한다: 경과 ÷ 끝난 건수 × 남은 건수', () => {
  // 10건에 40초 → 건당 4초, 50건 남음 → 200초.
  const eta = estimateRemaining({ done: 10, total: 60, elapsedMs: 40_000 });
  assert.equal(eta.state, 'estimating');
  assert.equal(eta.remaining_ms, 200_000);
  assert.equal(eta.text, '약 3분 30초 남음');
  // 절반이 끝났으면 남은 시간은 경과 시간과 같다.
  assert.equal(estimateRemaining({ done: 30, total: 60, elapsedMs: 123_456 }).remaining_ms, 123_456);
  // 마지막 한 건.
  assert.equal(estimateRemaining({ done: 59, total: 60, elapsedMs: 59_000 }).text, ETA_TEXT_SOON);
});

test('전부 끝났으면 「끝남」이고 남은 시간은 0이다', () => {
  assert.deepEqual(estimateRemaining({ done: 60, total: 60, elapsedMs: 240_000 }), { state: 'done', remaining_ms: 0, text: ETA_TEXT_DONE });
  // 세 건이 안 되는 계산도 끝나면 끝난 것이다.
  assert.equal(estimateRemaining({ done: 2, total: 2, elapsedMs: 8000 }).state, 'done');
  // 끝난 건수가 전체를 넘는 보고도 끝난 것으로 본다.
  assert.equal(estimateRemaining({ done: 61, total: 60, elapsedMs: 1 }).state, 'done');
});

test('모르는 것을 지어내지 않는다 — 전체 건수·경과 시간이 없거나 이상하면 「계산 중」', () => {
  const warming = { state: 'warming', remaining_ms: null, text: '계산 중' };
  assert.deepEqual(estimateRemaining({ done: 5, total: 0, elapsedMs: 1000 }), warming);
  assert.deepEqual(estimateRemaining({ done: 5, total: 60, elapsedMs: 0 }), warming);
  assert.deepEqual(estimateRemaining({ done: 5, total: 60 }), warming);
  assert.deepEqual(estimateRemaining({ done: 5, total: 60, elapsedMs: Number.NaN }), warming);
  assert.deepEqual(estimateRemaining({ done: -1, total: 60, elapsedMs: 1000 }), warming);
  assert.deepEqual(estimateRemaining({ done: '5', total: 60, elapsedMs: 1000 }), warming);
  assert.deepEqual(estimateRemaining(null), warming);
  assert.deepEqual(estimateRemaining(undefined), warming);
});

test('어림을 시작하는 건수를 바꿀 수 있다(잘못된 값이면 기본 3건)', () => {
  assert.equal(estimateRemaining({ done: 1, total: 10, elapsedMs: 4000 }, { minDone: 1 }).state, 'estimating');
  assert.equal(estimateRemaining({ done: 4, total: 10, elapsedMs: 4000 }, { minDone: 5 }).state, 'warming');
  assert.equal(estimateRemaining({ done: 2, total: 10, elapsedMs: 4000 }, { minDone: 0 }).state, 'warming');
  assert.equal(estimateRemaining({ done: 3, total: 10, elapsedMs: 4000 }, { minDone: 2.5 }).state, 'estimating');
});

test('남은 시간의 표기: 자잘한 단위는 버린다', () => {
  const cases = [
    [0, '곧 끝남'],
    [4999, '곧 끝남'],
    [5000, '약 5초 남음'],
    [5001, '약 10초 남음'],
    [42_000, '약 45초 남음'],
    [55_000, '약 55초 남음'],
    [56_000, '약 1분 남음'],
    [60_000, '약 1분 남음'],
    [74_000, '약 1분 남음'],
    [75_000, '약 1분 30초 남음'],
    [105_000, '약 2분 남음'],
    [200_000, '약 3분 30초 남음'],
    [599_000, '약 10분 남음'],
    [600_000, '약 10분 남음'],
    [1_290_000, '약 22분 남음'],
    [3_570_000, '약 1시간 남음'],
    [3_600_000, '약 1시간 남음'],
    [4_500_000, '약 1시간 15분 남음'],
    [7_200_000, '약 2시간 남음'],
  ];
  for (const [ms, text] of cases) assert.equal(formatRemaining(ms), text, `${ms}ms`);
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, '60000']) assert.equal(formatRemaining(bad), '계산 중', String(bad));
});

test('문구에 개발 용어를 쓰지 않는다', () => {
  for (const ms of [0, 5000, 60_000, 200_000, 1_290_000, 4_500_000]) {
    assert.doesNotMatch(formatRemaining(ms), /시뮬|예산|파일|JSON|ms|sec/i);
  }
});
