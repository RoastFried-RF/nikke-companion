// 편성 도구·티어 화면이 보여 주는 결과의 자리.
// 비교·성장·티어 결과는 설정의 「고급」(파일 직접 고르기)에서 계산하거나 불러오고, 그 화면이 여기에 올린다.
// 편성 도구·티어 화면은 올라온 결과를 새 부품(타일·막대·배지)으로 그린다 — 다시 계산하지 않는다.

import { inject, provide, shallowRef, type InjectionKey, type ShallowRef } from 'vue';
import type { CompareReport, GrowthReport, TierReport } from '../types';

export interface ToolResults {
  /** 편성 비교(또는 고급에서 돌린 추천) 결과. */
  compare: ShallowRef<CompareReport | null>;
  growth: ShallowRef<GrowthReport | null>;
  tier: ShallowRef<TierReport | null>;
}

const KEY: InjectionKey<ToolResults> = Symbol('tool-results');

export function provideToolResults(): ToolResults {
  const results: ToolResults = { compare: shallowRef(null), growth: shallowRef(null), tier: shallowRef(null) };
  provide(KEY, results);
  return results;
}

/** 화면들이 부른다. 앱 밖에서(화면만 따로 띄운 테스트 등) 쓰이면 null. */
export function useToolResults(): ToolResults | null {
  return inject(KEY, null);
}
