<script setup lang="ts">
// 순위 줄: 2·3위 편성의 한 줄 요약 — 순위, 멤버 얼굴 다섯, 총딜, 1위 대비 비율.
import { computed } from 'vue';
import { damageUnit } from '../lib/format';
import NikkeTile from './NikkeTile.vue';

export interface RankMember {
  name: string;
  element?: string | null;
  /** 이 보스의 약점 속성 니케인가. */
  weak?: boolean;
  /** 초상화의 주소(주지 않으면 타일이 스스로 불러온다). */
  src?: string | null;
}

const props = withDefaults(
  defineProps<{
    rank: number;
    members: RankMember[];
    totalDamage: number;
    /** 1위 총딜 대비 비율(0~1). 모르면 null. */
    relative?: number | null;
  }>(),
  { relative: null },
);

const total = computed(() => damageUnit(props.totalDamage));
const ratio = computed(() =>
  typeof props.relative === 'number' && Number.isFinite(props.relative) ? `1위의 ${Math.round(props.relative * 100)}%` : null,
);
const names = computed(() => props.members.map((m) => m.name).join(', '));
</script>

<template>
  <div class="rank" :data-rank="rank" data-testid="rank-row">
    <span class="rank__place" data-testid="rank-row-place">{{ rank }}위</span>
    <span class="rank__members" :title="names" data-testid="rank-row-members">
      <NikkeTile v-for="m in members" :key="m.name" :name="m.name" size="xs" :element="m.element ?? null" :weak="m.weak === true" :src="m.src" />
    </span>
    <span class="rank__total" data-testid="rank-row-total">{{ total }}</span>
    <span v-if="ratio" class="rank__ratio" data-testid="rank-row-ratio">{{ ratio }}</span>
  </div>
</template>

<style scoped>
.rank {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
  min-width: 0;
  padding: var(--nk-space-2) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
}

.rank__place {
  flex: none;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-heavy);
}

.rank__members {
  display: flex;
  gap: var(--nk-space-2);
  min-width: 0;
  overflow: hidden;
}

.rank__total {
  margin-left: auto;
  flex: none;
  font-weight: var(--nk-weight-bold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rank__ratio {
  flex: none;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
