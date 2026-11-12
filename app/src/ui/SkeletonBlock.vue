<script setup lang="ts">
// 뼈대 화면: 내용이 오기 전에 자리를 미리 그려 둔다(타일 줄·카드 줄·글줄). 내용이 오면 같은 자리에 들어간다.
withDefaults(
  defineProps<{
    /** tiles 니케 타일 한 줄 / cards 보스 카드 줄 / lines 글줄. */
    shape?: 'tiles' | 'cards' | 'lines';
    count?: number;
    /** 읽어 주는 말. */
    label?: string;
  }>(),
  { shape: 'lines', count: 3, label: '불러오는 중' },
);
</script>

<template>
  <div class="skeleton" :class="`skeleton--${shape}`" role="status" aria-busy="true" :aria-label="label" data-testid="skeleton">
    <span v-for="n in count" :key="n" class="skeleton__item" aria-hidden="true" data-testid="skeleton-item"></span>
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  gap: var(--nk-space-3);
  min-width: 0;
}

.skeleton--lines {
  flex-direction: column;
}

.skeleton__item {
  display: block;
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
  animation: skeleton-pulse var(--nk-duration-shimmer) ease-in-out infinite;
}

.skeleton--lines .skeleton__item {
  height: var(--nk-space-4);
  border-radius: var(--nk-radius-sm);
}

.skeleton--lines .skeleton__item:last-child {
  width: 60%;
}

.skeleton--tiles .skeleton__item {
  flex: none;
  width: var(--nk-tile-lg);
  aspect-ratio: 3 / 5;
}

.skeleton--cards .skeleton__item {
  flex: 1;
  min-width: 0;
  height: calc(var(--nk-boss-image) + var(--nk-space-5));
  border-radius: var(--nk-radius-lg);
}

@keyframes skeleton-pulse {
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton__item {
    animation: none;
  }
}
</style>
