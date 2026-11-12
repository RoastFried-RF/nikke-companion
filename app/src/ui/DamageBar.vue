<script setup lang="ts">
// 딜 막대: 편성 총딜에서 차지하는 비중(0~1)을 막대와 %로. 숫자 표 대신 쓴다.
// 비중을 모르면(null·수가 아님) 빈 막대와 「–」 — 0%로 그리지 않는다.
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 비중(0~1). 모르면 null. */
    share: number | null;
    /** 막대의 색: 강조색 또는 (바깥에서 정한) 속성 색. */
    tone?: 'accent' | 'element';
    /** % 글자를 보일지. */
    percent?: boolean;
    thin?: boolean;
  }>(),
  { tone: 'accent', percent: true, thin: false },
);

const known = computed(() => typeof props.share === 'number' && Number.isFinite(props.share));
const ratio = computed(() => (known.value ? Math.min(1, Math.max(0, props.share as number)) : 0));
const text = computed(() => (known.value ? `${Math.round(ratio.value * 100)}%` : '–'));
const label = computed(() => (known.value ? `딜 비중 ${text.value}` : '딜 비중 모름'));
</script>

<template>
  <span class="bar" :class="[`bar--${tone}`, { 'bar--thin': thin, 'bar--unknown': !known }]" role="img" :aria-label="label" :title="label" data-testid="damage-bar">
    <span class="bar__track">
      <span class="bar__fill" :style="{ width: `${ratio * 100}%` }" data-testid="damage-bar-fill"></span>
    </span>
    <span v-if="percent" class="bar__percent" data-testid="damage-bar-percent">{{ text }}</span>
  </span>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: var(--nk-space-2);
  min-width: 0;
  font-family: var(--nk-font-family);
}

.bar__track {
  flex: 1;
  min-width: 0;
  height: var(--nk-bar-height);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-sunken);
  overflow: hidden;
}

.bar--thin .bar__track {
  height: var(--nk-bar-height-thin);
}

.bar__fill {
  display: block;
  height: 100%;
  border-radius: var(--nk-radius-pill);
  background: var(--nk-accent);
  transition: width var(--nk-duration) ease;
}

.bar--element .bar__fill {
  background: var(--nk-el);
}

.bar__percent {
  flex: none;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-xs);
  font-weight: var(--nk-weight-bold);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.bar--unknown .bar__percent {
  color: var(--nk-text-faint);
}
</style>
