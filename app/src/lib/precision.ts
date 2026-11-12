// 정밀도 — 「얼마나 많이 계산해 볼지」의 일반 사용자용 이름(빠르게·보통·꼼꼼히).
// 안쪽 값은 계산 코드(src/core)가 받는 계산 횟수의 상한이다. 화면에는 숫자 대신 이름과 대략 걸리는 시간을 보인다.
//
// 걸리는 시간은 어림이다: 계산 한 번이 4~5초이고 동시에 네 개를 돌린다(.harness/progress.md §알아 둘 것) → 한 건에 약 1.2초.
// 앞서 계산해 둔 것이 있으면 훨씬 빨리 끝난다. 실제 남은 시간은 계산이 도는 동안 진행 패널이 다시 어림한다.

import { DEFAULT_BUDGET } from '@core/candidates.mjs';
import { DEFAULT_INTERCEPT_BUDGET } from '@core/intercept.mjs';
import { recall, remember } from './remember';

export type PrecisionKey = 'fast' | 'normal' | 'thorough';

export interface PrecisionChoice {
  key: PrecisionKey;
  label: string;
  /** 계산 횟수의 상한(계산 코드의 `budget`). */
  budget: number;
  /** 대략 걸리는 시간(「약 3분」). */
  time: string;
  /** 무엇이 다른지 한 줄. */
  hint: string;
}

/** 계산 한 건에 걸리는 시간의 어림(초). */
export const SECONDS_PER_RUN = 1.2;

/** 계산 횟수 → 「약 N분」. 1분이 안 되면 「1분 안쪽」. */
export function roughTime(budget: number): string {
  const seconds = budget * SECONDS_PER_RUN;
  if (seconds < 60) return '1분 안쪽';
  return `약 ${Math.round(seconds / 60)}분`;
}

function choices(budgets: Record<PrecisionKey, number>): PrecisionChoice[] {
  const make = (key: PrecisionKey, label: string, hint: string): PrecisionChoice => ({ key, label, budget: budgets[key], time: roughTime(budgets[key]), hint });
  return [
    make('fast', '빠르게', '편성을 조금만 견줘 본다'),
    make('normal', '보통', '대부분 이것으로 충분하다'),
    make('thorough', '꼼꼼히', '더 많은 편성과 자리 순서를 견줘 본다'),
  ];
}

/** 요격전(보스 5종 전체). 「꼼꼼히」가 계산 코드의 기본값이다. */
export const INTERCEPT_PRECISION: readonly PrecisionChoice[] = choices({ fast: 60, normal: 150, thorough: DEFAULT_INTERCEPT_BUDGET });

/** 편성 도구의 추천(조건 하나). 「꼼꼼히」가 계산 코드의 기본값이다. */
export const SUGGEST_PRECISION: readonly PrecisionChoice[] = choices({ fast: 40, normal: 80, thorough: DEFAULT_BUDGET });

/** 처음 고르는 정밀도. */
export const DEFAULT_PRECISION: PrecisionKey = 'normal';

const isKey = (value: string): value is PrecisionKey => value === 'fast' || value === 'normal' || value === 'thorough';

/** 기억해 둔 정밀도. 없거나 모르는 값이면 「보통」. */
export function recallPrecision(name: string): PrecisionKey {
  const saved = recall(name);
  return isKey(saved) ? saved : DEFAULT_PRECISION;
}

export function rememberPrecision(name: string, key: PrecisionKey): void {
  remember(name, key);
}

/** 고른 정밀도의 값. 모르는 이름이면 「보통」. */
export function precisionOf(list: readonly PrecisionChoice[], key: string): PrecisionChoice {
  return list.find((c) => c.key === key) ?? list.find((c) => c.key === DEFAULT_PRECISION) ?? list[0];
}
