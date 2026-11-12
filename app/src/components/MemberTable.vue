<script setup lang="ts">
// 편성 멤버별 딜: 이름 · 비중 · 단위 표기 · 원값. 배치 순서 그대로 그린다. 수치는 결과 문서의 값에 서식만 입힌다.
import { damageRaw, damageUnit, percent } from '../lib/format';
import type { ReportMember } from '../types';

defineProps<{
  members: ReportMember[];
  /** 표시를 붙일 멤버 이름(요격전: 보스의 약점 속성 니케). */
  marked?: string[];
  /** 그 표시의 글자. */
  mark?: string;
}>();
</script>

<template>
  <table class="members">
    <tbody>
      <tr
        v-for="(m, i) in members"
        :key="`${i}-${m.name}`"
        :class="{ 'members__row--marked': marked?.includes(m.name) }"
        data-testid="member"
      >
        <td class="members__name">
          <span data-testid="member-name">{{ m.name }}</span>
          <span v-if="marked?.includes(m.name)" class="members__mark" data-testid="member-mark">{{ mark }}</span>
        </td>
        <td class="members__num" data-testid="member-share">{{ percent(m.share) }}</td>
        <td class="members__num members__unit" data-testid="member-unit">{{ damageUnit(m.damage) }}</td>
        <td class="members__num members__raw" data-testid="member-raw">{{ damageRaw(m.damage) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.members {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.members td {
  padding: 1px 0;
}

.members__name {
  overflow-wrap: anywhere;
}

.members__mark {
  margin-left: 6px;
  padding: 0 5px;
  border: 1px solid var(--gold);
  border-radius: 999px;
  color: var(--gold);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.members__num {
  padding-left: 8px;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.members__unit {
  font-weight: 700;
}

.members__raw {
  color: var(--muted);
}
</style>
