<script setup lang="ts">
// 진행 패널: 무엇을 하는 중인지, 진행 막대, 남은 시간 어림, 중단 단추.
// 남은 시간은 루트의 순수 함수(src/core/eta.mjs)가 어림한다 — 처음 몇 건 전에는 「계산 중」만 말한다.
import { estimateRemaining } from '@core/eta.mjs';
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 무엇을 하는 중인지(「크라켄 추천 편성을 찾는 중」). */
    title: string;
    /** 덧붙이는 한 줄(「보스 2/5」). */
    detail?: string;
    /** 끝난 건수와 전체 건수. 전체를 아직 모르면 total을 0으로 준다(막대가 「준비 중」으로 그려진다). */
    done: number;
    total: number;
    /** 시작한 뒤 흐른 시간(밀리초). */
    elapsedMs: number;
    /** 중단 단추를 보일지. */
    stoppable?: boolean;
    /** 중단을 눌러 멈추는 중인가(단추가 눌리지 않는다). */
    stopping?: boolean;
  }>(),
  { detail: '', stoppable: true, stopping: false },
);

defineEmits<{ stop: [] }>();

const known = computed(() => Number.isFinite(props.total) && props.total > 0);
const ratio = computed(() => (known.value ? Math.min(1, Math.max(0, props.done / props.total)) : 0));
const eta = computed(() => estimateRemaining({ done: props.done, total: props.total, elapsedMs: props.elapsedMs }));
const count = computed(() => (known.value ? `${Math.min(props.done, props.total)} / ${props.total}` : '준비 중'));
</script>

<template>
  <section class="progress" role="status" aria-live="polite" :data-state="eta.state" data-testid="progress-panel">
    <div class="progress__head">
      <span class="progress__title" data-testid="progress-title">{{ title }}</span>
      <span v-if="detail" class="progress__detail" data-testid="progress-detail">{{ detail }}</span>
    </div>
    <div
      class="progress__track"
      :class="{ 'progress__track--waiting': !known }"
      role="progressbar"
      aria-valuemin="0"
      :aria-valuemax="known ? total : undefined"
      :aria-valuenow="known ? Math.min(done, total) : undefined"
      data-testid="progress-bar"
    >
      <span class="progress__fill" :style="{ width: `${ratio * 100}%` }" data-testid="progress-fill"></span>
    </div>
    <div class="progress__foot">
      <span class="progress__count" data-testid="progress-count">{{ count }}</span>
      <span class="progress__eta" data-testid="progress-eta">{{ stopping ? '멈추는 중' : eta.text }}</span>
      <button v-if="stoppable" type="button" class="progress__stop" :disabled="stopping" data-testid="progress-stop" @click="$emit('stop')">중단</button>
    </div>
  </section>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
}

.progress__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--nk-space-2) var(--nk-space-3);
}

.progress__title {
  font-weight: var(--nk-weight-bold);
  overflow-wrap: anywhere;
}

.progress__detail {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.progress__track {
  height: var(--nk-bar-height);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-sunken);
  overflow: hidden;
}

.progress__fill {
  display: block;
  height: 100%;
  border-radius: var(--nk-radius-pill);
  background: var(--nk-accent);
  transition: width var(--nk-duration) ease;
}

/* 전체 건수를 아직 모를 때: 막대 전체가 옅게 깜박인다. */
.progress__track--waiting {
  background: var(--nk-accent-soft);
  animation: progress-wait var(--nk-duration-shimmer) ease-in-out infinite;
}

@keyframes progress-wait {
  50% {
    opacity: 0.4;
  }
}

.progress__foot {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  font-variant-numeric: tabular-nums;
}

.progress__eta {
  margin-right: auto;
  color: var(--nk-accent-strong);
  font-weight: var(--nk-weight-bold);
}

.progress__stop {
  padding: var(--nk-space-2) var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border-strong);
  border-radius: var(--nk-radius-md);
  background: transparent;
  color: var(--nk-text);
  font: inherit;
  cursor: pointer;
}

.progress__stop:hover:not(:disabled) {
  border-color: var(--nk-error);
  color: var(--nk-error);
}

.progress__stop:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .progress__track--waiting {
    animation: none;
  }
}
</style>
