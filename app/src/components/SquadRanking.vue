<script setup lang="ts">
// 편성 순위: 순위 · 이름 · 1위 대비 · 총딜(단위 표기와 원값) · 멤버별 딜 · 메모 · 엔진 알림.
// 비교 결과 화면(ReportView)과 요격전 화면(InterceptView)이 함께 쓴다. 수치를 고치거나 다시 계산하지 않는다.
import { damageRaw, damageUnit, percent } from '../lib/format';
import type { RankingEntry } from '../types';
import MemberTable from './MemberTable.vue';

defineProps<{
  ranking: RankingEntry[];
  /** 표시를 붙일 멤버 이름과 그 글자(요격전: 보스의 약점 속성 니케). */
  marked?: string[];
  mark?: string;
}>();

/** 1위 대비 막대의 너비. 표시용이며 0~100%로 자른다. */
function barWidth(relative: unknown): string {
  const x = typeof relative === 'number' && Number.isFinite(relative) ? relative : 0;
  return `${Math.min(100, Math.max(0, x * 100)).toFixed(1)}%`;
}
</script>

<template>
  <p v-if="ranking.length === 0" class="empty" data-testid="ranking-empty">계산된 편성이 없다.</p>
  <ol v-else class="ranking">
    <li
      v-for="entry in ranking"
      :key="`${entry.rank}-${entry.name}`"
      class="squad"
      :class="{ 'squad--best': entry.rank === 1 }"
      data-testid="ranking-entry"
    >
      <div class="squad__head">
        <span class="squad__rank" data-testid="rank">{{ entry.rank }}위</span>
        <span class="squad__name" data-testid="squad-name">{{ entry.name }}</span>
        <span class="squad__relative" data-testid="relative">
          {{ entry.rank === 1 ? '기준' : `1위 대비 ${percent(entry.relative_to_best)}` }}
        </span>
      </div>
      <div class="squad__total">
        <span class="squad__unit" data-testid="total-unit">{{ damageUnit(entry.total_damage) }}</span>
        <span class="squad__raw" data-testid="total-raw">({{ damageRaw(entry.total_damage) }})</span>
      </div>
      <div class="bar" aria-hidden="true">
        <div class="bar__fill" :style="{ width: barWidth(entry.relative_to_best) }"></div>
      </div>

      <MemberTable :members="entry.members ?? []" :marked="marked" :mark="mark" />

      <ul v-if="(entry.notes ?? []).length || (entry.ungrown_members ?? []).length" class="notes">
        <li v-for="(n, i) in entry.notes ?? []" :key="i" data-testid="note">{{ n }}</li>
        <li v-if="(entry.ungrown_members ?? []).length" data-testid="ungrown">
          육성 정보가 비어 미육성으로 계산: {{ entry.ungrown_members.join(', ') }}
        </li>
      </ul>

      <details v-if="(entry.engine_warnings ?? []).length" class="fold" data-testid="engine-warnings">
        <summary>엔진 알림 {{ entry.engine_warnings.length }}건</summary>
        <ul class="bullets">
          <li v-for="(w, i) in entry.engine_warnings" :key="i">{{ w }}</li>
        </ul>
      </details>
    </li>
  </ol>
</template>

<style scoped>
.ranking {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.squad {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.squad--best {
  border-color: rgba(255, 196, 64, 0.6);
}

.squad__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.squad__rank {
  font-weight: 800;
  color: var(--accent);
}

.squad--best .squad__rank {
  color: var(--gold);
}

.squad__name {
  flex: 1;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.squad__relative {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

.squad__total {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}

.squad__unit {
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.squad__raw {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.bar {
  height: 4px;
  margin: 4px 0 6px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.bar__fill {
  height: 100%;
  background: var(--accent);
}

.squad--best .bar__fill {
  background: var(--gold);
}
</style>
