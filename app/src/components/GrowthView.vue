<script setup lang="ts">
// 성장 투자 비교 결과(docs/data-model.md §성장 투자 비교)를 그린다: 기준 편성과 업그레이드 후보의 증가율 순위.
// 수치를 고치거나 다시 계산하지 않는다 — 결과 문서의 값을 서식만 입혀 보여 준다. CLI 표(renderGrowthReport)와 같은 내용이다.
import { damageRaw, damageUnit, signedDamageUnit, signedPercent } from '../lib/format';
import type { GrowthReport } from '../types';
import CaveatList from './CaveatList.vue';
import IssueBlocks from './IssueBlocks.vue';
import MemberTable from './MemberTable.vue';
import ReportMeta from './ReportMeta.vue';

defineProps<{ report: GrowthReport }>();

/** 육성 칸의 값. 적지 않았거나 미확인이던 칸은 그렇게 적는다(CLI 표와 같다). */
const shown = (v: unknown): string => (v === null || v === undefined ? '(적지 않음)' : JSON.stringify(v));
</script>

<template>
  <div class="growth">
    <ReportMeta
      :account="report.account"
      :condition="report.condition"
      :engine="report.engine"
      :cache="report.cache"
      :generated-at="report.generated_at"
      :assumptions="report.assumptions"
    />

    <section class="block baseline" data-testid="baseline">
      <h2 class="block__title">기준 편성</h2>
      <div class="baseline__head">
        <span class="baseline__name" data-testid="baseline-name">{{ report.baseline.name }}</span>
        <span class="baseline__unit" data-testid="baseline-total">{{ damageUnit(report.baseline.total_damage) }}</span>
        <span class="baseline__raw" data-testid="baseline-raw">({{ damageRaw(report.baseline.total_damage) }})</span>
      </div>
      <MemberTable :members="report.baseline.members ?? []" />
      <ul v-if="(report.baseline.notes ?? []).length || (report.baseline.ungrown_members ?? []).length" class="notes">
        <li v-for="(n, i) in report.baseline.notes ?? []" :key="i" data-testid="baseline-note">{{ n }}</li>
        <li v-if="(report.baseline.ungrown_members ?? []).length" data-testid="ungrown">
          육성 정보가 비어 미육성으로 계산: {{ report.baseline.ungrown_members.join(', ') }}
        </li>
      </ul>
      <details v-if="(report.baseline.engine_warnings ?? []).length" class="fold" data-testid="engine-warnings">
        <summary>엔진 알림 {{ report.baseline.engine_warnings.length }}건</summary>
        <ul class="bullets">
          <li v-for="(w, i) in report.baseline.engine_warnings" :key="i">{{ w }}</li>
        </ul>
      </details>
    </section>

    <section class="block" aria-label="증가율 순위">
      <h2 class="block__title">업그레이드 후보 — 총딜 증가율 순</h2>
      <p v-if="(report.ranking ?? []).length === 0" class="empty" data-testid="growth-empty">계산된 업그레이드 후보가 없다.</p>
      <ol v-else class="upgrades">
        <li
          v-for="entry in report.ranking"
          :key="`${entry.rank}-${entry.name}`"
          class="upgrade"
          :class="{ 'upgrade--best': entry.rank === 1, 'upgrade--loss': entry.gain < 0 }"
          data-testid="growth-entry"
        >
          <div class="upgrade__head">
            <span class="upgrade__rank" data-testid="rank">{{ entry.rank }}위</span>
            <span class="upgrade__name" data-testid="upgrade-name">{{ entry.name }}</span>
            <span class="upgrade__rate" data-testid="gain-rate">
              {{ entry.gain_rate === null ? '증가율 계산 불가' : signedPercent(entry.gain_rate) }}
            </span>
          </div>
          <div class="upgrade__total" data-testid="gain-total">
            총딜 {{ damageUnit(entry.total_before) }} → {{ damageUnit(entry.total_after) }}
            <span class="upgrade__gain" data-testid="gain">({{ signedDamageUnit(entry.gain) }})</span>
          </div>
          <ul class="upgrade__changes">
            <li v-for="(ch, i) in entry.changes ?? []" :key="i" data-testid="change">
              {{ ch.nikke }} <span class="upgrade__field">{{ ch.field }}</span>: {{ shown(ch.before) }} → {{ shown(ch.after) }}
            </li>
          </ul>
          <ul class="upgrade__members">
            <template v-for="(m, i) in entry.members ?? []" :key="i">
              <li v-if="m.gain !== 0" data-testid="member-gain">
                <span class="upgrade__member-gain">{{ signedDamageUnit(m.gain) }}</span> {{ m.name }}
              </li>
            </template>
          </ul>
          <ul v-if="(entry.notes ?? []).length" class="notes">
            <li v-for="(n, i) in entry.notes" :key="i" data-testid="note">{{ n }}</li>
          </ul>
        </li>
      </ol>
    </section>

    <IssueBlocks :rejected="report.rejected ?? []" :failed="report.failed ?? []" noun="후보" />

    <CaveatList :caveats="report.caveats ?? []" />
  </div>
</template>

<style scoped>
.growth {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.baseline__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}

.baseline__name {
  flex: 1;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.baseline__unit {
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.baseline__raw {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.upgrades {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upgrade {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
}

.upgrade--best {
  border-color: rgba(255, 196, 64, 0.6);
}

.upgrade__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.upgrade__rank {
  font-weight: 800;
  color: var(--accent);
}

.upgrade--best .upgrade__rank {
  color: var(--gold);
}

.upgrade__name {
  flex: 1;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.upgrade__rate {
  font-size: 16px;
  font-weight: 800;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.upgrade--loss .upgrade__rate,
.upgrade--loss .upgrade__gain {
  color: var(--danger);
}

.upgrade__total {
  font-variant-numeric: tabular-nums;
}

.upgrade__gain {
  font-weight: 700;
}

.upgrade__changes,
.upgrade__members {
  margin-top: 4px;
  color: var(--muted);
}

.upgrade__changes li,
.upgrade__members li {
  overflow-wrap: anywhere;
}

.upgrade__field {
  font-family: Consolas, monospace;
}

.upgrade__member-gain {
  display: inline-block;
  min-width: 72px;
  color: var(--text);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
