// 표시용 숫자 서식. 결과 JSON의 원값은 건드리지 않는다 — 표시 단계에서만 쓴다.

const UNITS = [
  { value: 1e12, suffix: '조' },
  { value: 1e8, suffix: '억' },
];

// ICU 로캘 데이터에 기대지 않도록 직접 묶는다.
export function groupThousands(int) {
  return String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 대미지를 한국어 단위로 줄여 적는다. 반올림이 아니라 버림이다(실제보다 크게 보이지 않게).
 *   1조 이상      → 조 단위 소수 둘째 자리  '12.34조'
 *   1억 이상      → 억 단위 소수 둘째 자리  '45.67억'
 *   1만 이상      → 만 단위 정수            '5,373만'
 *   1만 미만      → 그대로                  '9,999'
 * 0 이상의 안전한 정수만 받는다. 그 밖의 값은 RangeError.
 */
export function formatDamage(n) {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`대미지는 0 이상의 정수여야 한다: ${String(n)}`);
  }
  for (const { value, suffix } of UNITS) {
    if (n >= value) {
      // 부동소수 나눗셈 오차를 피하려고 단위의 1/100까지 정수로 내린 뒤 나눈다.
      const hundredths = Math.floor(n / (value / 100));
      const whole = Math.floor(hundredths / 100);
      const frac = String(hundredths % 100).padStart(2, '0');
      return `${groupThousands(whole)}.${frac}${suffix}`;
    }
  }
  if (n >= 1e4) return `${groupThousands(Math.floor(n / 1e4))}만`;
  return groupThousands(n);
}
