<script setup lang="ts">
// 결과 문서의 머리 정보: 계정(검증용/실제), 조건, 엔진 버전, 시뮬 결과 캐시, 계산 시각, 가정.
// 비교·요격전·성장 화면이 함께 쓴다. 화면마다 더 보일 줄은 기본 슬롯에 넣는다(계산 시각과 가정 사이).
import { computed } from 'vue';
import { cacheLabel, engineLabel, localTime } from '../lib/format';
import type { CacheStats, EngineVersion } from '../types';

const props = defineProps<{
  account?: { name?: string | null; is_test_data?: boolean } | null;
  condition?: Record<string, unknown>;
  engine?: EngineVersion | null;
  /** 캐시를 쓰지 않은 계산이면 null, 캐시가 생기기 전의 결과 파일에는 없다(undefined). */
  cache?: CacheStats | null;
  generatedAt?: string;
  assumptions?: string[];
}>();

/** 검증용인지 실제 계정인지. 결과 파일이 밝히지 않았으면 모른다고 표시한다. */
const dataKind = computed(() => {
  const flag = props.account?.is_test_data;
  if (flag === true) return { key: 'test', label: '검증용 데이터' };
  if (flag === false) return { key: 'real', label: '실제 계정 데이터' };
  return { key: 'unknown', label: '데이터 구분 미확인' };
});

const conditionLabel = computed(() => {
  const c = props.condition ?? {};
  const parts: string[] = [];
  if (typeof c.boss === 'string') parts.push(c.boss);
  if (typeof c.duration === 'number') parts.push(`${c.duration}초`);
  return parts.join(' · ');
});

const cacheText = computed(() => cacheLabel(props.cache));
const cacheWarnings = computed(() => props.cache?.warnings ?? []);
const generated = computed(() => localTime(props.generatedAt));
</script>

<template>
  <header class="meta">
    <div class="meta__row">
      <span class="meta__account" data-testid="account-name">{{ account?.name ?? '(이름 없음)' }}</span>
      <span class="badge" :class="`badge--${dataKind.key}`" data-testid="data-kind">{{ dataKind.label }}</span>
    </div>
    <div v-if="conditionLabel" class="meta__line" data-testid="condition">조건: {{ conditionLabel }}</div>
    <div class="meta__line" data-testid="engine-version">엔진: {{ engineLabel(engine) }}</div>
    <div v-if="cacheText" class="meta__line" data-testid="cache">캐시: {{ cacheText }}</div>
    <div v-for="(w, i) in cacheWarnings" :key="`cache-warning-${i}`" class="meta__line meta__line--warn" data-testid="cache-warning">
      ! {{ w }}
    </div>
    <div v-if="generated" class="meta__line" data-testid="generated-at">계산 시각: {{ generated }}</div>
    <slot></slot>
    <details v-if="(assumptions ?? []).length" class="fold" data-testid="assumptions">
      <summary>가정 {{ assumptions?.length }}개</summary>
      <ul class="bullets">
        <li v-for="(a, i) in assumptions" :key="i">{{ a }}</li>
      </ul>
    </details>
  </header>
</template>
