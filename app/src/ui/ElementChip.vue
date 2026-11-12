<script setup lang="ts">
// 속성 칩: 속성 아이콘 + 글자(「약점 작열」, 「풍압」). 속성 색 테두리.
// `dot`이면 글자 없이 아이콘만(니케 타일의 오른쪽 위 속성 점). 속성을 모르면 「모름」이다.
import { computed } from 'vue';
import GameIcon from './GameIcon.vue';

const props = withDefaults(
  defineProps<{
    /** 속성(작열·풍압·철갑·전격·수냉). 모르면 null. */
    element: string | null;
    /** 속성 앞에 붙이는 말(「약점」). */
    label?: string;
    /** 글자 없이 아이콘만. */
    dot?: boolean;
    /** 아이콘 이미지의 주소. 주지 않으면 스스로 불러오고, null이면 직접 그린 도형만 쓴다. */
    src?: string | null;
  }>(),
  { label: '', dot: false, src: undefined },
);

const text = computed(() => [props.label, props.element ?? '모름'].filter(Boolean).join(' '));
</script>

<template>
  <span
    class="chip"
    :class="{ 'chip--dot': dot, 'chip--unknown': !element }"
    :data-element="element ?? undefined"
    :title="dot ? text : undefined"
    data-testid="element-chip"
  >
    <GameIcon kind="element" :value="element" size="sm" :src="src" />
    <span v-if="!dot" class="chip__text" data-testid="element-chip-text">{{ text }}</span>
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-2);
  padding: var(--nk-space-1) var(--nk-space-3) var(--nk-space-1) var(--nk-space-2);
  border: var(--nk-border-width) solid var(--nk-el);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-sunken);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-bold);
  line-height: var(--nk-line-tight);
  white-space: nowrap;
}

.chip--unknown {
  border-style: dashed;
  border-color: var(--nk-el-unknown);
  color: var(--nk-text-muted);
}

/* 아이콘만: 어두운 동그란 바탕 위의 속성 아이콘. */
.chip--dot {
  padding: var(--nk-space-1);
  border-color: var(--nk-surface-sunken);
  background: var(--nk-surface-sunken);
}
</style>
