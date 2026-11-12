<script setup lang="ts">
// 접는 「자세히」 구획: 경고·계산 조건처럼 늘 볼 필요는 없는 것을 접어 둔다.
// 접어 두어도 되는 것만 넣는다 — 「추정·실전 미대조」와 미확인·검증용 표시는 접지 않고 밖에 둔다(StatusPill).
withDefaults(
  defineProps<{
    /** 접힌 줄에 보이는 말. */
    summary?: string;
    /** 안에 든 항목 수(「주의 4」처럼 접힌 줄에 보인다). 주지 않으면 보이지 않는다. */
    count?: number;
    /** 처음부터 펴 둘지. */
    open?: boolean;
    /** 접힌 줄의 색(안에 경고가 들었으면 unknown·error). */
    tone?: 'neutral' | 'unknown' | 'error';
  }>(),
  { summary: '자세히', count: undefined, open: false, tone: 'neutral' },
);

defineEmits<{ toggle: [open: boolean] }>();
</script>

<template>
  <details class="fold" :open="open" :data-tone="tone" data-testid="details-fold" @toggle="$emit('toggle', ($event.target as HTMLDetailsElement).open)">
    <summary class="fold__summary" data-testid="details-fold-summary">
      <span class="fold__label">{{ summary }}</span>
      <span v-if="count !== undefined" class="fold__count" data-testid="details-fold-count">{{ count }}</span>
    </summary>
    <div class="fold__body" data-testid="details-fold-body">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.fold {
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-sm);
}

.fold__summary {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-3) var(--nk-space-4);
  color: var(--nk-tone);
  font-weight: var(--nk-weight-bold);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.fold__summary::-webkit-details-marker {
  display: none;
}

/* 접힘·펼침 표시(직접 그린 꺾쇠). */
.fold__summary::before {
  content: '';
  width: var(--nk-space-2);
  height: var(--nk-space-2);
  border-right: var(--nk-border-width-strong) solid currentColor;
  border-bottom: var(--nk-border-width-strong) solid currentColor;
  transform: rotate(-45deg);
  transition: transform var(--nk-duration) ease;
}

.fold[open] > .fold__summary::before {
  transform: rotate(45deg);
}

.fold__count {
  padding: 0 var(--nk-space-3);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-raised);
  color: var(--nk-text);
  font-variant-numeric: tabular-nums;
}

.fold__body {
  padding: 0 var(--nk-space-4) var(--nk-space-4);
  color: var(--nk-text-muted);
  line-height: var(--nk-line-normal);
  overflow-wrap: anywhere;
}
</style>
