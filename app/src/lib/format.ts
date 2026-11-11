// 표시용 서식. 대미지 단위 표기는 저장소 루트의 src/core/format.mjs를 그대로 쓴다(CLI와 같은 결과).
// 여기에는 단위 규칙을 다시 적지 않는다.

import { formatDamage as coreFormatDamage, groupThousands as coreGroupThousands } from '@core/format.mjs';

export const formatDamage: (n: number) => string = coreFormatDamage;
export const groupThousands: (n: number | string) => string = coreGroupThousands;

/** 결과 파일의 수치가 수가 아닐 때의 표시. 값을 지어내지 않는다. */
export const INVALID_NUMBER = '값 오류';

/** 단위 표기('34.63억'). CLI 표(render.mjs)처럼 정수로 맞춘 뒤 넘긴다. */
export function damageUnit(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return INVALID_NUMBER;
  try {
    return formatDamage(Math.round(n));
  } catch {
    return INVALID_NUMBER;
  }
}

/** 원값('3,463,364,987'). */
export function damageRaw(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return INVALID_NUMBER;
  return groupThousands(Math.round(n));
}

/** 비율(0~1)을 '86.2%'로. */
export function percent(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return INVALID_NUMBER;
  return `${(x * 100).toFixed(1)}%`;
}
