<script setup lang="ts">
// 보스 얼굴(오버레이 위젯): 둥근 보스 이미지. 이미지가 없으면 보스의 속성 색 바탕에 이름 첫 글자 — 지어낸 그림을 쓰지 않는다.
// 이미지는 Rust가 이 PC의 정해진 폴더에서 읽어 넘긴다(lib/images.ts). 보스 id는 경로가 아니라 열쇠다.
import { computed } from 'vue';
import { bossImageUrl } from '../lib/images';
import { useImage } from '../ui/useImage';

const props = withDefaults(
  defineProps<{
    /** 보스 id(보스 묶음의 id — 이미지의 열쇠). */
    id: string;
    name: string;
    /** 보스 자신의 속성(이미지가 없을 때의 바탕색). 모르면 null. */
    element?: string | null;
    /** md 한 줄 카드 · sm 접힌 알약과 보스 고르기. */
    size?: 'md' | 'sm';
    /** 보스 이미지의 주소. 주지 않으면 스스로 불러오고, null이면 속성 색으로 그린다. */
    src?: string | null;
  }>(),
  { element: null, size: 'md', src: undefined },
);

const url = useImage(
  () => props.src,
  () => props.id || null,
  () => bossImageUrl(props.id),
);
const initial = computed(() => Array.from(props.name.trim())[0] ?? '?');
</script>

<template>
  <span class="face" :class="`face--${size}`" :data-boss="id" :data-element="element ?? undefined" :data-image="url ? 'image' : 'color'" data-testid="boss-face">
    <img v-if="url" class="face__image" :src="url" alt="" draggable="false" data-testid="boss-face-image" />
    <span v-else class="face__fallback" aria-hidden="true" data-testid="boss-face-fallback">{{ initial }}</span>
  </span>
</template>

<style scoped>
.face {
  --face-size: var(--nk-boss-face);
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--face-size);
  height: var(--face-size);
  border: var(--nk-border-width-strong) solid var(--nk-el);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-raised);
  overflow: hidden;
}

.face--sm {
  --face-size: var(--nk-boss-face-sm);
  border-width: var(--nk-border-width);
}

.face__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
}

.face__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--nk-el);
  color: var(--nk-text-on-bright);
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-heavy);
}

.face--sm .face__fallback {
  font-size: var(--nk-font-sm);
}
</style>
