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

/** 증감을 부호와 단위 표기로('+3,210만', '-1.20억'). 단위 표기는 0 이상만 받으므로 부호를 따로 붙인다(CLI 표와 같다). */
export function signedDamageUnit(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return INVALID_NUMBER;
  return `${n < 0 ? '-' : '+'}${damageUnit(Math.abs(n))}`;
}

/** 증가율(0.0093 = 0.93%)을 부호와 함께 소수 둘째 자리까지('+0.93%'). CLI의 성장 비교 표와 같은 자릿수다. */
export function signedPercent(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return INVALID_NUMBER;
  return `${x < 0 ? '-' : '+'}${(Math.abs(x) * 100).toFixed(2)}%`;
}

/** 티어 점수(팀 총딜 비율)를 소수 셋째 자리까지('1.182'). CLI의 티어 표와 같은 자릿수다. */
export function score3(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return INVALID_NUMBER;
  return x.toFixed(3);
}

/** 엔진 버전 한 줄('Jgaram/nikke-calc @ 67835ca3'). 모르는 것은 모른다고 적는다. */
export function engineLabel(engine: { repo?: string | null; commit?: string | null; dirty?: boolean | null } | null | undefined): string {
  const repo = engine?.repo ?? '엔진 미확인';
  const commit = engine?.commit ? engine.commit.slice(0, 8) : '버전 미확인';
  return `${repo} @ ${commit}${engine?.dirty ? ' (수정된 작업 폴더)' : ''}`;
}

/**
 * 시뮬 결과 캐시 한 줄 — CLI 표(src/core/render.mjs의 cacheLines)와 같은 문장.
 * 결과에 칸이 없으면(캐시가 생기기 전의 문서) 빈 문자열이다.
 */
export function cacheLabel(cache: { hits: number; misses: number; stored: number } | null | undefined): string {
  if (cache === undefined) return '';
  if (cache === null) return '쓰지 않음';
  return `적중 ${cache.hits}건 · 엔진 계산 ${cache.misses}건 · 새로 저장 ${cache.stored}건`;
}

/** 결과 문서의 시각(ISO 8601)을 현지 시각 'YYYY-MM-DD HH:MM'으로. 읽을 수 없으면 적힌 그대로. */
export function localTime(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
