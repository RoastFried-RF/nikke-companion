<script setup lang="ts">
// 아이콘 하나(속성·버스트 단계·클래스·기업·무기).
// 게임의 아이콘이 있으면(받아 둔 data/assets의 것, 없으면 엔진 폴더의 것 — Rust가 읽어 넘긴다) 그것을 쓰고,
// 없으면 직접 그린 단순한 도형·글자로 대신한다. 값을 모르면(null) 「?」다.
import { computed } from 'vue';
import { iconUrl } from '../lib/images';
import type { IconKind } from '../types';
import { useImage } from './useImage';

const props = withDefaults(
  defineProps<{
    kind: IconKind;
    /** 엔진 카탈로그의 낱말 그대로('작열', '1', '화력형', '필그림', 'SR'). 모르면 null. */
    value: string | null;
    size?: 'sm' | 'md' | 'lg';
    /** 그릴 이미지의 주소. 주지 않으면 스스로 불러오고, null이면 직접 그린 것만 쓴다. */
    src?: string | null;
  }>(),
  { size: 'md', src: undefined },
);

const url = useImage(
  () => props.src,
  () => (props.value ? `${props.kind}\u0000${props.value}` : null),
  () => iconUrl(props.kind, props.value ?? ''),
);

const KIND_LABELS: Record<IconKind, string> = { element: '속성', burst: '버스트', class: '클래스', corp: '기업', weapon: '무기' };
const BURST_MARKS: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III', A: 'A' };

/** 읽어 주는 말과 풍선 도움말. */
const label = computed(() => `${KIND_LABELS[props.kind]} ${props.value ?? '모름'}`);

/** 직접 그릴 때의 글자. 속성은 도형으로 그린다(글자 없음). */
const mark = computed(() => {
  if (!props.value) return '?';
  if (props.kind === 'burst') return BURST_MARKS[props.value] ?? '?';
  if (props.kind === 'weapon') return props.value;
  // 클래스·기업: 첫 글자.
  return Array.from(props.value)[0] ?? '?';
});

/** 속성마다 다른 도형(색을 못 보는 사람도 가릴 수 있게). 16×16 칸에 그린다. */
const ELEMENT_SHAPES: Record<string, string> = {
  작열: 'M8 1.5 L14.5 14 H1.5 Z',
  수냉: 'M8 1.5 C11 5.5 13 8 13 10.2 A5 5 0 0 1 3 10.2 C3 8 5 5.5 8 1.5 Z',
  풍압: 'M8 1 L15 8 L8 15 L1 8 Z',
  전격: 'M9.5 1 L3 9 H7.2 L6.2 15 L13 6.6 H8.8 Z',
  철갑: 'M8 1 L14 4.5 V11.5 L8 15 L2 11.5 V4.5 Z',
};
const shape = computed(() => (props.kind === 'element' && props.value ? (ELEMENT_SHAPES[props.value] ?? null) : null));
</script>

<template>
  <span
    class="icon"
    :class="[`icon--${size}`, `icon--${kind}`]"
    :data-kind="kind"
    :data-value="value ?? ''"
    :data-element="kind === 'element' ? (value ?? undefined) : undefined"
    :data-source="url ? 'image' : 'drawn'"
    :title="label"
    role="img"
    :aria-label="label"
    data-testid="game-icon"
  >
    <img v-if="url" class="icon__img" :src="url" alt="" draggable="false" data-testid="game-icon-image" />
    <svg v-else-if="shape" class="icon__shape" viewBox="0 0 16 16" aria-hidden="true" data-testid="game-icon-drawn">
      <path :d="shape" />
    </svg>
    <span v-else class="icon__mark" aria-hidden="true" data-testid="game-icon-drawn">{{ mark }}</span>
  </span>
</template>

<style scoped>
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--icon-size);
  height: var(--icon-size);
  line-height: 1;
  vertical-align: middle;
}

.icon--sm {
  --icon-size: var(--nk-icon-sm);
}

.icon--md {
  --icon-size: var(--nk-icon-md);
}

.icon--lg {
  --icon-size: var(--nk-icon-lg);
}

.icon__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

.icon__shape {
  width: 100%;
  height: 100%;
  fill: var(--nk-el);
}

/* 직접 그린 글자 배지: 버스트 단계·클래스·기업·무기. */
.icon__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 100%;
  height: 100%;
  padding: 0 var(--nk-space-1);
  border: var(--nk-border-width) solid var(--nk-border-strong);
  border-radius: var(--nk-radius-sm);
  background: var(--nk-surface-sunken);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-xs);
  font-weight: var(--nk-weight-heavy);
  letter-spacing: 0;
  white-space: nowrap;
}

.icon--burst .icon__mark {
  border-color: var(--nk-accent);
  background: var(--nk-accent);
  color: var(--nk-text-on-accent);
}
</style>
