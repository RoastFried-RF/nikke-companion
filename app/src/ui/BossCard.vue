<script setup lang="ts">
// 보스 카드: 보스 이미지(없으면 보스의 속성 색 바탕에 이름 첫 글자), 이름, 약점 칩, 총딜.
// 요격전 화면 위쪽에 보스마다 한 장씩 놓고 눌러서 고른다. 총딜을 아직 모르면 「계산 전」이다(0으로 적지 않는다).
import { computed } from 'vue';
import { damageUnit } from '../lib/format';
import { bossImageUrl } from '../lib/images';
import ElementChip from './ElementChip.vue';
import { useImage } from './useImage';

const props = withDefaults(
  defineProps<{
    /** 보스 id(보스 묶음의 id — 이미지의 열쇠). */
    id: string;
    name: string;
    /** 보스 자신의 속성(카드의 테마 색). 모르면 null. */
    element?: string | null;
    /** 약점 속성. 모르면 null. */
    weakTo?: string | null;
    /** 추천 1위 편성의 총딜. 아직 계산하지 않았으면 null. */
    totalDamage?: number | null;
    selected?: boolean;
    /** 보스 이미지의 주소. 주지 않으면 스스로 불러오고, null이면 속성 색으로 그린다. */
    src?: string | null;
  }>(),
  { element: null, weakTo: null, totalDamage: null, selected: false, src: undefined },
);

defineEmits<{ select: [id: string] }>();

const url = useImage(
  () => props.src,
  () => props.id || null,
  () => bossImageUrl(props.id),
);

const initial = computed(() => Array.from(props.name.trim())[0] ?? '?');
const total = computed(() => (props.totalDamage === null ? null : damageUnit(props.totalDamage)));
</script>

<template>
  <button
    type="button"
    class="boss"
    :class="{ 'boss--selected': selected }"
    :data-boss="id"
    :data-element="element ?? undefined"
    :data-image="url ? 'image' : 'color'"
    :aria-pressed="selected"
    data-testid="boss-card"
    @click="$emit('select', id)"
  >
    <span class="boss__art">
      <img v-if="url" class="boss__image" :src="url" alt="" draggable="false" data-testid="boss-card-image" />
      <span v-else class="boss__fallback" aria-hidden="true" data-testid="boss-card-fallback">{{ initial }}</span>
    </span>
    <span class="boss__body">
      <span class="boss__name" data-testid="boss-card-name">{{ name }}</span>
      <ElementChip :element="weakTo" label="약점" />
      <span v-if="total !== null" class="boss__total" data-testid="boss-card-total">총딜 {{ total }}</span>
      <span v-else class="boss__total boss__total--none" data-testid="boss-card-total">계산 전</span>
    </span>
  </button>
</template>

<style scoped>
.boss {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
  min-width: 0;
  padding: var(--nk-space-3);
  border: var(--nk-border-width-strong) solid var(--nk-border);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--nk-duration) ease;
}

.boss:hover {
  border-color: var(--nk-border-strong);
}

.boss:focus-visible {
  outline: var(--nk-border-width-strong) solid var(--nk-accent-strong);
  outline-offset: var(--nk-space-1);
}

.boss--selected,
.boss--selected:hover {
  border-color: var(--nk-accent);
  background: var(--nk-surface-raised);
}

.boss__art {
  flex: none;
  width: var(--nk-boss-image);
  height: var(--nk-boss-image);
  border-radius: var(--nk-radius-md);
  overflow: hidden;
  /* 이미지가 없을 때 보이는 바탕: 보스의 속성 색. */
  background: var(--nk-el);
}

.boss__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

.boss__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--nk-text-on-bright);
  font-size: var(--nk-font-xl);
  font-weight: var(--nk-weight-heavy);
}

.boss__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--nk-space-2);
  min-width: 0;
}

.boss__name {
  max-width: 100%;
  overflow: hidden;
  font-size: var(--nk-font-md);
  font-weight: var(--nk-weight-bold);
  line-height: var(--nk-line-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.boss__total {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  font-variant-numeric: tabular-nums;
  line-height: var(--nk-line-tight);
  white-space: nowrap;
}

.boss__total--none {
  color: var(--nk-text-faint);
}
</style>
