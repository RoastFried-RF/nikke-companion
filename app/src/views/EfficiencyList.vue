<script setup lang="ts">
// 육성 효율표의 그림(P-031): 한 단계 올릴 수 있는 것마다 한 줄 — 니케 초상화 · 무엇을 올리는지 · 총딜 증가율 막대.
// 받은 결과(src/core/efficiency.mjs의 efficiencyTable)를 그리기만 한다 — 계산하지 않고 순서도 바꾸지 않는다.
// 숨기면 안 되는 것(상한 때문에 보지 못한 것 · 계산하지 못한 것 · 총딜이 주는 것)은 접힌 구획 밖이다.
import { computed } from 'vue';
import { damageUnit, signedPercent } from '../lib/format';
import type { EfficiencyReport, ExcludedStep, NikkeInfo } from '../types';
import DamageBar from '../ui/DamageBar.vue';
import DetailsFold from '../ui/DetailsFold.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import StatusPill from '../ui/StatusPill.vue';

const props = defineProps<{
  report: EfficiencyReport;
  info: (name: string) => NikkeInfo;
  /** 약점 속성(테두리를 그릴 니케를 정한다). 모르면 null. */
  weakTo?: string | null;
}>();

/** 막대의 기준: 가장 큰 증가율. 늘어난 것이 없으면 막대를 그리지 않는다. */
const best = computed(() => Math.max(0, ...props.report.rows.map((r) => (typeof r.gain_rate === 'number' ? r.gain_rate : 0))));
const barShare = (rate: number | null): number | null => (rate === null || best.value <= 0 ? null : Math.max(0, rate) / best.value);
const isWeak = (name: string) => !!props.weakTo && props.info(name).element === props.weakTo;

/** 후보로 만들지 않은 칸을 까닭의 종류로 묶는다. */
const CODE_LABEL: Record<ExcludedStep['code'], string> = {
  max: '이미 최대',
  unknown: '미확인이라 정할 수 없음',
  locked: '아직 열리지 않음',
  none: '없음',
  unsupported: '지원하지 않음',
};
const maxed = computed(() => props.report.excluded.filter((e) => e.code === 'max').length);
const unsure = computed(() => props.report.excluded.filter((e) => e.code === 'unknown' || e.code === 'unsupported'));
</script>

<template>
  <div class="eff" data-testid="eff-board">
    <div v-if="report.baseline" class="nk-row">
      <span class="nk-muted">지금 총딜</span>
      <strong data-testid="eff-baseline">{{ damageUnit(report.baseline.total_damage) }}</strong>
      <StatusPill label="추정" tone="estimate" detail="계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." />
      <span class="nk-muted" data-testid="eff-count">한 단계씩 올려 본 것 {{ report.rows.length }}개 — 총딜이 많이 느는 순서</span>
    </div>

    <p v-if="report.candidates.total === 0" class="nk-note" role="status" data-testid="eff-none">
      {{ report.only ? `${report.only}에게는` : '이 편성에는' }} 한 단계 올릴 수 있는 칸이 없다 — 볼 수 있는 칸이 모두 최대이거나, 계정에 적혀 있지 않아 정할 수 없다.
    </p>

    <ol v-if="report.rows.length" class="eff__list" data-testid="eff-rows">
      <li v-for="row in report.rows" :key="row.id" class="eff__row" :class="{ 'eff__row--loss': row.gain < 0 }" :data-id="row.id" :data-nikke="row.nikke" :data-kind="row.kind" data-testid="eff-row">
        <span class="eff__rank" data-testid="eff-rank">{{ row.rank }}</span>
        <NikkeTile :name="row.nikke" size="mini" :element="info(row.nikke).element" :burst="info(row.nikke).burst" :weak="isWeak(row.nikke)" />
        <span class="eff__what">
          <strong data-testid="eff-nikke">{{ row.nikke }}</strong>
          <span data-testid="eff-step">{{ row.label }} {{ row.from }} → {{ row.to }}</span>
        </span>
        <span class="eff__bar"><DamageBar :share="barShare(row.gain_rate)" :percent="false" /></span>
        <strong class="eff__rate" :data-tone="row.gain > 0 ? 'ok' : row.gain < 0 ? 'error' : 'neutral'" data-testid="eff-rate">
          {{ row.gain_rate === null ? '–' : signedPercent(row.gain_rate) }}
        </strong>
        <span class="nk-muted eff__total" data-testid="eff-total">{{ damageUnit(row.total_after) }}</span>
        <StatusPill v-if="row.gain < 0" label="총딜이 준다" tone="error" data-testid="eff-loss" />
        <p v-for="(note, i) in row.notes" :key="i" class="eff__note" data-testid="eff-row-note">{{ note }}</p>
      </li>
    </ol>

    <!-- 상한 때문에 못 본 것과 계산하지 못한 것은 접지 않고 적는다. -->
    <p v-if="report.skipped.length" class="nk-note" data-testid="eff-skipped">
      한 번에 {{ report.candidates.limit }}개까지만 계산한다. 올릴 수 있는 {{ report.candidates.total }}개 가운데 {{ report.skipped.length }}개는 보지 못했다 — 니케 한 명만 골라 다시 보면 그 니케의 것은 모두
      계산한다. 보지 못한 것:
      <span v-for="s in report.skipped" :key="s.id" class="eff__chip" data-testid="eff-skipped-item">{{ s.nikke }} {{ s.label }}</span>
    </p>
    <p v-if="report.failed.length" class="nk-note" data-testid="eff-failed">
      계산하지 못한 것 {{ report.failed.length }}개(0으로 치지 않고 뺐다):
      <span v-for="f in report.failed" :key="f.id" class="eff__chip" data-testid="eff-failed-item">{{ f.nikke }} {{ f.label }} — {{ f.reason }}</span>
    </p>
    <p v-if="unsure.length" class="nk-note" data-testid="eff-unsure">
      계정 정보로는 정할 수 없어 보지 않은 칸 {{ unsure.length }}개:
      <span v-for="(e, i) in unsure" :key="i" class="eff__chip" data-testid="eff-unsure-item">{{ e.nikke }} {{ e.label }} — {{ CODE_LABEL[e.code] }}</span>
    </p>

    <DetailsFold v-if="report.excluded.length" :summary="`올려 보지 않은 칸 — 이미 최대 ${maxed}개 포함`" :count="report.excluded.length" data-testid="eff-excluded">
      <ul class="nk-list">
        <li v-for="(e, i) in report.excluded" :key="i" :data-code="e.code" data-testid="eff-excluded-item">{{ e.nikke }} — {{ e.reason }}</li>
      </ul>
    </DetailsFold>
  </div>
</template>

<style scoped>
.eff {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
}

.eff__list {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.eff__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-2) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
}

.eff__row--loss {
  border-color: var(--nk-error);
}

.eff__rank {
  min-width: var(--nk-space-6);
  color: var(--nk-text-faint);
  font-weight: var(--nk-weight-bold);
  text-align: right;
}

.eff__what {
  display: flex;
  flex-direction: column;
  min-width: calc(var(--nk-tile-lg) * 2);
  overflow-wrap: anywhere;
}

.eff__bar {
  flex: 1;
  min-width: var(--nk-tile-lg);
}

.eff__rate {
  min-width: calc(var(--nk-tile-sm) + var(--nk-space-4));
  color: var(--nk-tone);
  font-size: var(--nk-font-lg);
  text-align: right;
}

.eff__total {
  min-width: var(--nk-tile-sm);
  text-align: right;
}

.eff__note {
  flex-basis: 100%;
  margin: 0;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.eff__chip {
  display: inline-block;
  margin-right: var(--nk-space-3);
}
</style>
