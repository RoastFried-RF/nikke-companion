<script setup lang="ts">
// 버스트 단계 배지(I · II · III · A). 게임의 아이콘이 있으면 그것, 없으면 직접 그린 배지(GameIcon).
// 단계를 모르면 「?」 — 지어내지 않는다.
import GameIcon from './GameIcon.vue';

withDefaults(
  defineProps<{
    /** 엔진 카탈로그의 값: '1' · '2' · '3' · 'A'(모든 단계). 모르면 null. */
    stage: string | null;
    size?: 'sm' | 'md' | 'lg';
    /** 아이콘 이미지의 주소. 주지 않으면 스스로 불러오고, null이면 직접 그린 배지만 쓴다. */
    src?: string | null;
  }>(),
  { size: 'md', src: undefined },
);
</script>

<template>
  <span class="burst" :data-stage="stage ?? ''" data-testid="burst-badge">
    <GameIcon kind="burst" :value="stage" :size="size" :src="src" />
  </span>
</template>

<style scoped>
.burst {
  display: inline-flex;
  flex: none;
}
</style>
