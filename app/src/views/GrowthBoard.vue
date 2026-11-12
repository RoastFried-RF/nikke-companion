<script setup lang="ts">
// 성장 투자 비교 결과(docs/data-model.md §성장 투자 비교)를 새 부품으로 그린다: 기준 편성의 니케 타일과 총딜,
// 육성 선택지마다 「총딜이 얼마나 느는가」의 막대. 숨기면 안 되는 표시(추정·검증용 데이터)는 접힌 구획 밖의 배지다.
// 수치를 고치거나 다시 계산하지 않는다 — 결과 문서의 값을 그린다.
import { computed } from 'vue';
import { damageUnit, engineLabel, localTime, signedDamageUnit, signedPercent } from '../lib/format';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { GrowthChange, GrowthReport } from '../types';
import DamageBar from '../ui/DamageBar.vue';
import DetailsFold from '../ui/DetailsFold.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import StatusPill from '../ui/StatusPill.vue';

const props = defineProps<{ report: GrowthReport }>();

const { info } = useNikkeCatalog();

/** 육성 칸의 이름(계정 문서의 키 → 화면의 말). 모르는 칸은 적힌 그대로 보인다. */
const FIELD_LABEL: Record<string, string> = {
  skill_levels: '스킬',
  breakthrough: '돌파',
  core_enhancement: '코어 강화',
  overload: '오버로드',
  collection_stage: '소장품',
  favorite_stage: '애장품',
  affinity: '호감도',
  cube: '큐브',
};

/** 육성 칸의 값. 적지 않았거나 미확인이던 칸은 그렇게 적는다. */
function shown(value: unknown): string {
  if (value === null || value === undefined) return '(적지 않음)';
  if (Array.isArray(value)) return value.join('/');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => `${key} ${Array.isArray(v) ? `${v.length}줄` : String(v)}`)
      .join(', ');
  }
  return String(value);
}

const changeText = (ch: GrowthChange) => `${ch.nikke} ${FIELD_LABEL[ch.field] ?? ch.field}: ${shown(ch.before)} → ${shown(ch.after)}`;

const dataKind = computed(() => {
  const flag = props.report.account?.is_test_data;
  if (flag === true) return { tone: 'test' as const, label: '검증용 데이터' };
  if (flag === false) return null;
  return { tone: 'unknown' as const, label: '데이터 구분 미확인' };
});

const generated = computed(() => localTime(props.report.generated_at));
const ranking = computed(() => props.report.ranking ?? []);
/** 막대의 기준: 가장 큰 증가율. 늘어난 것이 없으면 막대를 그리지 않는다(null). */
const bestRate = computed(() => Math.max(0, ...ranking.value.map((e) => (typeof e.gain_rate === 'number' ? e.gain_rate : 0))));
const barShare = (rate: number | null): number | null => (rate === null || bestRate.value <= 0 ? null : Math.max(0, rate) / bestRate.value);
const dropped = computed(() => (props.report.rejected ?? []).length + (props.report.failed ?? []).length);
const conditionCount = computed(() => (props.report.assumptions ?? []).length + (props.report.caveats ?? []).length + dropped.value);
</script>

<template>
  <div class="growth" data-testid="growth-board">
    <div class="growth__meta">
      <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
      <StatusPill v-if="dataKind" :label="dataKind.label" :tone="dataKind.tone" solid data-testid="data-kind" />
      <StatusPill v-if="dropped" :label="`계산하지 못한 선택지 ${dropped}개`" tone="unknown" data-testid="dropped-pill" />
      <span class="growth__account" data-testid="account-name">{{ report.account?.name ?? '(이름 없음)' }}</span>
      <span v-if="generated" class="growth__time" data-testid="generated-at">계산 {{ generated }}</span>
    </div>

    <section class="growth__card" data-testid="baseline">
      <div class="growth__head">
        <span class="growth__label">기준 편성</span>
        <span class="growth__name" data-testid="baseline-name">{{ report.baseline.name }}</span>
        <span class="growth__total" data-testid="baseline-total">{{ damageUnit(report.baseline.total_damage) }}</span>
      </div>
      <div class="growth__tiles">
        <NikkeTile
          v-for="m in report.baseline.members ?? []"
          :key="m.name"
          size="sm"
          :name="m.name"
          :element="info(m.name).element"
          :burst="info(m.name).burst"
          :share="m.share ?? null"
        />
      </div>
      <ul v-if="(report.baseline.notes ?? []).length || (report.baseline.ungrown_members ?? []).length" class="nk-list">
        <li v-for="(n, i) in report.baseline.notes ?? []" :key="i" data-testid="baseline-note">{{ n }}</li>
        <li v-if="(report.baseline.ungrown_members ?? []).length" data-testid="ungrown">
          육성 정보가 비어 키우지 않은 것으로 계산한 니케: {{ report.baseline.ungrown_members.join(', ') }}
        </li>
      </ul>
    </section>

    <p v-if="ranking.length === 0" class="growth__none" data-testid="growth-empty">계산이 끝난 육성 선택지가 없다.</p>
    <ol v-else class="growth__list">
      <li
        v-for="entry in ranking"
        :key="`${entry.rank}-${entry.name}`"
        class="growth__entry"
        :class="{ 'growth__entry--loss': entry.gain < 0 }"
        :data-rank="entry.rank"
        data-testid="growth-entry"
      >
        <div class="growth__head">
          <span class="growth__rank" data-testid="rank">{{ entry.rank }}위</span>
          <span class="growth__name" data-testid="upgrade-name">{{ entry.name }}</span>
          <span class="growth__rate" data-testid="gain-rate">{{ entry.gain_rate === null ? '증가율을 낼 수 없다' : signedPercent(entry.gain_rate) }}</span>
          <StatusPill v-if="entry.gain < 0" label="총딜이 준다" tone="error" data-testid="loss-pill" />
        </div>
        <DamageBar :share="barShare(entry.gain_rate)" :percent="false" />
        <p class="growth__line" data-testid="gain-total">
          총딜 {{ damageUnit(entry.total_before) }} → {{ damageUnit(entry.total_after) }}
          <span data-testid="gain">({{ signedDamageUnit(entry.gain) }})</span>
        </p>
        <ul class="nk-list">
          <li v-for="(ch, i) in entry.changes ?? []" :key="i" data-testid="change">{{ changeText(ch) }}</li>
          <li v-for="(n, i) in entry.notes ?? []" :key="`n${i}`" data-testid="upgrade-note">{{ n }}</li>
        </ul>
      </li>
    </ol>

    <DetailsFold summary="계산 조건" :count="conditionCount" :tone="dropped ? 'unknown' : 'neutral'" data-testid="calc-conditions">
      <template v-if="(report.assumptions ?? []).length">
        <p class="nk-list__head">가정</p>
        <ul class="nk-list" data-testid="assumptions">
          <li v-for="(a, i) in report.assumptions" :key="i" data-testid="assumption-item">{{ a }}</li>
        </ul>
      </template>
      <template v-if="(report.caveats ?? []).length">
        <p class="nk-list__head">주의</p>
        <ul class="nk-list" data-testid="caveats">
          <li v-for="(c, i) in report.caveats" :key="i" data-testid="caveat-item">{{ c }}</li>
        </ul>
      </template>
      <template v-if="dropped">
        <p class="nk-list__head">계산하지 못한 선택지</p>
        <ul class="nk-list" data-testid="issues">
          <li v-for="r in report.rejected ?? []" :key="`r-${r.name}`" data-testid="rejected-item">{{ r.name }}: {{ (r.reasons ?? []).join(' / ') }}</li>
          <li v-for="f in report.failed ?? []" :key="`f-${f.name}`" data-testid="failed-item">{{ f.name }}: {{ f.error?.message }}</li>
        </ul>
      </template>
      <p class="nk-list__head">계산 정보</p>
      <ul class="nk-list">
        <li data-testid="engine-version">계산 도구: {{ engineLabel(report.engine) }}</li>
      </ul>
    </DetailsFold>
  </div>
</template>

<style scoped>
.growth {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
}

.growth__meta,
.growth__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--nk-space-2) var(--nk-space-3);
}

.growth__account,
.growth__name {
  font-weight: var(--nk-weight-bold);
}

.growth__time,
.growth__label {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
}

.growth__card,
.growth__entry {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding: var(--nk-space-4) var(--nk-space-5);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
}

.growth__entry--loss {
  border-color: var(--nk-error);
}

.growth__total,
.growth__rate {
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-heavy);
}

.growth__rate {
  color: var(--nk-accent-strong);
}

.growth__entry--loss .growth__rate {
  color: var(--nk-error);
}

.growth__rank {
  color: var(--nk-text-muted);
  font-weight: var(--nk-weight-bold);
}

.growth__tiles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-3);
}

.growth__list {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.growth__line,
.growth__none {
  margin: 0;
  color: var(--nk-text-muted);
}
</style>
