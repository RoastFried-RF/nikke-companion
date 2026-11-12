<script setup lang="ts">
// 니케 타일: 세로로 긴 초상화, 왼쪽 위 버스트 단계 배지, 오른쪽 위 속성 점, 이름(길면 말줄임), 딜 비중 막대와 %.
// 보스의 약점 속성 니케면 속성 색 테두리로 강조한다.
//
// 크기 셋: lg(데스크톱 앱의 추천 1위) · sm(오버레이 위젯의 한 줄) · xs(순위 줄의 얼굴만 — 이름·막대·배지 없음).
// 초상화가 없으면(그림이 없는 니케·엔진 카탈로그에 없는 이름) 이름의 첫 글자로 대신한다.
import { computed } from 'vue';
import { portraitUrl } from '../lib/images';
import BurstBadge from './BurstBadge.vue';
import DamageBar from './DamageBar.vue';
import ElementChip from './ElementChip.vue';
import { useImage } from './useImage';

const props = withDefaults(
  defineProps<{
    name: string;
    size?: 'lg' | 'sm' | 'xs';
    /** 속성. 모르면 null(속성 점이 「모름」으로 그려진다). */
    element?: string | null;
    /** 버스트 단계('1'·'2'·'3'·'A'). 모르면 null. */
    burst?: string | null;
    /** 이 보스의 약점 속성 니케인가. */
    weak?: boolean;
    /** 딜 비중(0~1). 주지 않으면 막대를 그리지 않고, null이면 「모름」 막대를 그린다. */
    share?: number | null;
    /** 초상화의 주소. 주지 않으면 스스로 불러오고, null이면 첫 글자로 그린다. */
    src?: string | null;
  }>(),
  { size: 'lg', element: null, burst: null, weak: false, share: undefined, src: undefined },
);

const url = useImage(
  () => props.src,
  () => props.name || null,
  () => portraitUrl(props.name),
);

/** 초상화 대신 그리는 첫 글자. */
const initial = computed(() => Array.from(props.name.trim())[0] ?? '?');
const title = computed(() => {
  const parts = [props.name];
  if (props.weak && props.element) parts.push(`약점 속성(${props.element})`);
  return parts.join(' — ');
});
</script>

<template>
  <figure
    class="tile"
    :class="[`tile--${size}`, { 'tile--weak': weak }]"
    :data-element="element ?? undefined"
    :data-weak="weak ? 'true' : 'false'"
    :data-portrait="url ? 'image' : 'initial'"
    :title="title"
    data-testid="nikke-tile"
  >
    <div class="tile__frame">
      <img v-if="url" class="tile__image" :src="url" :alt="name" draggable="false" data-testid="nikke-tile-image" />
      <span v-else class="tile__initial" aria-hidden="true" data-testid="nikke-tile-initial">{{ initial }}</span>
      <template v-if="size !== 'xs'">
        <BurstBadge class="tile__burst" :stage="burst" :size="size === 'lg' ? 'md' : 'sm'" />
        <ElementChip class="tile__element" :element="element" dot />
      </template>
    </div>
    <figcaption v-if="size !== 'xs'" class="tile__name" data-testid="nikke-tile-name">{{ name }}</figcaption>
    <DamageBar v-if="size !== 'xs' && share !== undefined" class="tile__share" :share="share" :tone="weak ? 'element' : 'accent'" :thin="size === 'sm'" />
  </figure>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  width: var(--tile-width);
  min-width: 0;
  margin: 0;
  font-family: var(--nk-font-family);
}

.tile--lg {
  --tile-width: var(--nk-tile-lg);
  --tile-ratio: 3 / 5;
}

.tile--sm {
  --tile-width: var(--nk-tile-sm);
  --tile-ratio: 4 / 5;
}

.tile--xs {
  --tile-width: var(--nk-tile-xs);
  --tile-ratio: 1 / 1;
}

.tile__frame {
  position: relative;
  aspect-ratio: var(--tile-ratio);
  border: var(--nk-border-width-strong) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
  overflow: hidden;
}

.tile--xs .tile__frame {
  border-width: var(--nk-border-width);
  border-radius: var(--nk-radius-pill);
}

/* 약점 속성 니케: 속성 색 테두리와 빛. */
.tile--weak .tile__frame {
  border-color: var(--nk-el);
  box-shadow: 0 0 var(--nk-glow-width) var(--nk-el);
}

.tile__image {
  display: block;
  width: 100%;
  height: 100%;
  /* 초상화는 세로로 길다(256×512) — 얼굴이 있는 위쪽을 보인다. */
  object-fit: cover;
  object-position: center top;
  user-select: none;
}

.tile__initial {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-xl);
  font-weight: var(--nk-weight-heavy);
}

.tile--sm .tile__initial {
  font-size: var(--nk-font-lg);
}

.tile--xs .tile__initial {
  font-size: var(--nk-font-sm);
}

.tile__burst {
  position: absolute;
  top: var(--nk-space-2);
  left: var(--nk-space-2);
}

.tile__element {
  position: absolute;
  top: var(--nk-space-2);
  right: var(--nk-space-2);
}

.tile--sm .tile__burst {
  top: var(--nk-space-1);
  left: var(--nk-space-1);
}

.tile--sm .tile__element {
  top: var(--nk-space-1);
  right: var(--nk-space-1);
}

.tile__name {
  overflow: hidden;
  color: var(--nk-text);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-bold);
  line-height: var(--nk-line-tight);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile--sm .tile__name {
  font-size: var(--nk-font-xs);
  font-weight: var(--nk-weight-regular);
}
</style>
