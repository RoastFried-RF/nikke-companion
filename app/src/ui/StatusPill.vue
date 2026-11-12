<script setup lang="ts">
// 상태 알약: 「연결됨」·「추정」·「미확인 3칸」·「검증용 데이터」·「오류」 같은 짧은 상태 한마디.
// 추정·미확인·검증용 표시는 줄이되 숨기지 않는다(프로젝트 원칙) — 눈에 띄는 색의 알약으로 항상 보인다.
export type StatusTone = 'ok' | 'estimate' | 'unknown' | 'error' | 'test' | 'accent' | 'neutral';

withDefaults(
  defineProps<{
    label: string;
    /** ok 연결됨·정상 / estimate 추정(실전 미대조) / unknown 미확인 값 / error 오류 / test 검증용 데이터 / accent 고른 것 / neutral 그 밖. */
    tone?: StatusTone;
    /** 풍선 도움말(무엇이 추정이고 무엇이 미확인인지). */
    detail?: string;
    /** 채운 알약(더 눈에 띈다). 기본은 테두리만. */
    solid?: boolean;
  }>(),
  { tone: 'neutral', detail: undefined, solid: false },
);
</script>

<template>
  <span class="pill" :class="{ 'pill--solid': solid }" :data-tone="tone" :title="detail" data-testid="status-pill">
    <span class="pill__dot" aria-hidden="true"></span>
    <span class="pill__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-2);
  padding: var(--nk-space-1) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-tone);
  border-radius: var(--nk-radius-pill);
  color: var(--nk-tone);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-bold);
  line-height: var(--nk-line-tight);
  white-space: nowrap;
}

.pill__dot {
  width: var(--nk-space-3);
  height: var(--nk-space-3);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-tone);
}

.pill--solid {
  background: var(--nk-tone);
  color: var(--nk-text-on-bright);
}

.pill--solid .pill__dot {
  background: var(--nk-text-on-bright);
}
</style>
