<script setup lang="ts">
// 티어 결과(docs/data-model.md §티어 결과)를 새 부품으로 그린다: 등급마다 초상화 묶음, 평가 보류는 따로 묶어 사유와 함께.
// 숨기면 안 되는 표시는 접힌 구획 밖에 있다 — 임시 규칙(언제나), 평가 보류, 미지원 효과 있음(그 효과가 빠진 수치다).
// 등급을 매기거나 점수를 고치지 않는다 — 문서의 값을 그린다.
import { burstOrderGroup } from '@core/search.mjs';
import { STATUS_HOLD, STATUS_PREDICTED } from '@tier/evaluate.mjs';
import { computed, ref } from 'vue';
import { damageUnit, engineLabel, localTime, score3 } from '../lib/format';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { TierEntry, TierReport } from '../types';
import DetailsFold from '../ui/DetailsFold.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import StatusPill from '../ui/StatusPill.vue';

const props = defineProps<{ report: TierReport }>();

const { info } = useNikkeCatalog();

/** 버스트 단계 거르기의 값. 'all' = 전체, 'none' = 단계를 모름. 그 밖은 버스트 묶음('1'·'2'·'3'). */
const filter = ref('all');

/** 니케의 버스트 묶음 — 루트의 규칙(src/core/search.mjs의 burstOrderGroup: 모든 단계 니케는 3단계 묶음)을 그대로 쓴다. */
const groupOf = (e: TierEntry): string => burstOrderGroup({ burst_stage: e.burst_stage }) ?? 'none';

const entries = computed(() => props.report.entries ?? []);
/** 평가 보류인가. 등급이 없는 항목은 상태가 무엇이든 등급 묶음에 넣지 않는다. */
const isHold = (e: TierEntry) => e.status === STATUS_HOLD || e.tier === null || e.tier === undefined;

const filters = computed(() => {
  const counts = new Map<string, number>();
  for (const e of entries.value) counts.set(groupOf(e), (counts.get(groupOf(e)) ?? 0) + 1);
  const groups = ['1', '2', '3', 'none'].filter((g) => counts.has(g));
  return [
    { key: 'all', label: '전체', count: entries.value.length },
    ...groups.map((g) => ({ key: g, label: g === 'none' ? '단계 모름' : `버스트 ${g}`, count: counts.get(g) ?? 0 })),
  ];
});

const visible = computed(() => entries.value.filter((e) => filter.value === 'all' || groupOf(e) === filter.value));
const holds = computed(() => visible.value.filter(isHold));

/** 등급별 묶음 — 규칙 문서의 등급 순서. 규칙에 없는 등급 이름이 있으면 맨 뒤에 따로 묶는다(버리지 않는다). */
const groups = computed(() => {
  const graded = visible.value.filter((e) => !isHold(e));
  const tiers = props.report.rules?.tiers ?? [];
  const known = tiers.map((t, index) => ({ tier: t.tier, min: t.min as number | null, index, entries: graded.filter((e) => e.tier === t.tier) }));
  const names = new Set(tiers.map((t) => t.tier));
  const others = [...new Set(graded.filter((e) => !names.has(e.tier as string)).map((e) => e.tier as string))];
  const unknown = others.map((tier) => ({ tier, min: null as number | null, index: tiers.length, entries: graded.filter((e) => e.tier === tier) }));
  return [...known, ...unknown].filter((g) => g.entries.length > 0);
});

/** 등급 규칙이 임시인가. 문서가 임시가 아니라고 밝힌 경우(`false`)에만 표시를 내린다. */
const provisional = computed(() => props.report.rules?.provisional !== false);
const unsupportedCount = computed(() => entries.value.filter((e) => e.unsupported).length);
const holdCount = computed(() => entries.value.filter(isHold).length);
const usedReferences = computed(() => (props.report.references?.squads ?? []).filter((s) => s.status === 'used').length);
const generated = computed(() => localTime(props.report.generated_at));
const growthLabel = computed(() => {
  const growth = props.report.scenario?.growth;
  return growth === 'engine_default' ? '기본 육성 상태(계정 없음)' : (growth ?? '미확인');
});
const conditionCount = computed(() => (props.report.assumptions ?? []).length + (props.report.caveats ?? []).length);
</script>

<template>
  <div class="tier" data-testid="tier-board">
    <div class="tier__meta">
      <!-- 임시 규칙 표시는 언제나 보인다 — 접히지 않고, 거르기를 바꿔도 남는다. -->
      <StatusPill
        v-if="provisional"
        label="임시 규칙"
        tone="unknown"
        solid
        detail="등급을 나누는 기준이 아직 대표 사례로 검증되지 않았다. 등급 경계는 바뀔 수 있다."
        data-testid="tier-provisional"
      />
      <StatusPill label="예측 평가 · 실전 미대조" tone="estimate" detail="계산으로 어림한 등급이다. 실제 전투 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
      <StatusPill v-if="holdCount" :label="`평가 보류 ${holdCount}명`" tone="unknown" data-testid="hold-pill" />
      <StatusPill v-if="unsupportedCount" :label="`미지원 효과 있음 ${unsupportedCount}명`" tone="error" data-testid="unsupported-pill" />
      <span class="tier__summary" data-testid="tier-summary">니케 {{ entries.length }}명 · 등급 {{ report.summary?.graded ?? '?' }}명</span>
      <span v-if="generated" class="tier__time" data-testid="generated-at">계산 {{ generated }}</span>
    </div>

    <p v-if="provisional" class="tier__note" role="note" data-testid="tier-provisional-note">
      등급 규칙 {{ report.rules?.version ?? '(버전 미확인)' }}은 임시다 — 대표 사례로 검증되지 않았다. 등급 경계는 바뀔 수 있다.
    </p>

    <div class="nk-seg" role="group" aria-label="버스트 단계" data-testid="burst-filter">
      <button
        v-for="f in filters"
        :key="f.key"
        type="button"
        class="nk-seg__item"
        :class="{ 'nk-seg__item--on': filter === f.key }"
        :aria-pressed="filter === f.key"
        :data-burst="f.key"
        data-testid="burst-option"
        @click="filter = f.key"
      >
        {{ f.label }} {{ f.count }}
      </button>
    </div>

    <p v-if="groups.length === 0" class="tier__none" data-testid="tier-empty">
      {{ filter === 'all' ? '등급을 매긴 니케가 없다.' : '이 버스트 단계에는 등급을 매긴 니케가 없다.' }}
    </p>

    <section v-for="g in groups" :key="g.tier" class="tier__group" :data-tier="g.tier" data-testid="tier-group">
      <div class="tier__grade" :data-grade-index="Math.min(g.index, 5)">
        <span class="tier__badge" data-testid="tier-badge">{{ g.tier }}</span>
        <span class="tier__count">{{ g.entries.length }}명</span>
        <span class="tier__min">{{ g.min === null ? '규칙에 없는 등급' : `${score3(g.min)} 이상` }}</span>
      </div>
      <ul class="tier__entries">
        <li
          v-for="e in g.entries"
          :key="e.name"
          class="tier__entry"
          :class="{ 'tier__entry--unsupported': e.unsupported }"
          :title="e.best ? `${e.best.reference}의 ${e.best.replaced} 자리: ${damageUnit(e.best.reference_total)} → ${damageUnit(e.best.total_damage)}` : undefined"
          data-testid="tier-entry"
        >
          <NikkeTile size="sm" :name="e.name" :element="info(e.name).element" :burst="e.burst_stage ?? info(e.name).burst" />
          <span class="tier__score" data-testid="entry-score">{{ score3(e.score) }}</span>
          <!-- 미지원 효과가 있는 항목은 눈에 띄어야 한다 — 그 효과가 빠진 수치다. -->
          <StatusPill v-for="flag in e.flags ?? []" :key="flag" :label="flag" tone="error" solid data-testid="entry-flag" />
          <StatusPill v-if="e.status !== STATUS_PREDICTED" :label="e.status_label ?? e.status" tone="neutral" data-testid="entry-status" />
        </li>
      </ul>
    </section>

    <!-- 평가 보류는 등급 묶음과 따로다. 등급이 없는 것이지 0점이 아니다. -->
    <section v-if="holds.length" class="tier__group tier__group--hold" data-testid="tier-holds">
      <div class="tier__grade">
        <span class="tier__badge tier__badge--hold">보류</span>
        <span class="tier__count">{{ holds.length }}명</span>
        <span class="tier__min">평가 보류 — 등급 없음(0점이 아니다)</span>
      </div>
      <ul class="tier__holds">
        <li v-for="e in holds" :key="e.name" class="tier__hold" data-testid="hold-entry">
          <NikkeTile size="xs" :name="e.name" :element="info(e.name).element" />
          <span class="tier__hold-name" data-testid="entry-name">{{ e.name }}</span>
          <span class="tier__hold-reason" data-testid="hold-reason">{{ e.hold?.message || (e.notes ?? []).join(' / ') || '사유 없음' }}</span>
        </li>
      </ul>
    </section>

    <DetailsFold summary="계산 조건" :count="conditionCount" data-testid="calc-conditions">
      <p class="nk-list__head">기준</p>
      <ul class="nk-list">
        <li data-testid="tier-scenario">상대: {{ report.scenario?.boss ?? '미확인' }} · {{ report.scenario?.duration ?? '?' }}초 · 육성 {{ growthLabel }}</li>
        <li data-testid="tier-versions">
          기준 편성 {{ report.references?.version ?? '버전 미확인' }} ({{ (report.references?.squads ?? []).length }}개 중 {{ usedReferences }}개 사용) · 등급 규칙
          {{ report.rules?.version ?? '버전 미확인' }}{{ provisional ? ' [임시]' : '' }}
        </li>
        <li data-testid="tier-engine">계산 도구: {{ engineLabel(report.engine) }} · 데이터 {{ report.engine_data?.version ?? '버전 미확인' }}</li>
        <li data-testid="tier-runs">계산 {{ report.sims?.used }}건 / 한도 {{ report.sims?.budget }}건</li>
      </ul>
      <p class="nk-list__head">등급 경계(점수 = 기준 편성 대비 팀 총딜 비율)</p>
      <ul class="nk-list" data-testid="tier-rules">
        <li v-for="t in report.rules?.tiers ?? []" :key="t.tier">{{ t.tier }}: {{ score3(t.min) }} 이상</li>
      </ul>
      <template v-if="(report.references?.squads ?? []).length">
        <p class="nk-list__head">기준 편성</p>
        <ul class="nk-list" data-testid="tier-references">
          <li v-for="s in report.references.squads" :key="s.id">
            {{ s.id }}: {{ (s.members ?? []).join(', ') }} —
            <template v-if="s.status === 'used'">{{ s.total_damage === null ? '계산하지 않음' : damageUnit(s.total_damage) }}</template>
            <template v-else>쓰지 못했다: {{ s.reason ?? '사유 없음' }}</template>
          </li>
        </ul>
      </template>
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
    </DetailsFold>
  </div>
</template>

<style scoped>
.tier {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
}

.tier__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.tier__summary {
  font-weight: var(--nk-weight-bold);
}

.tier__time,
.tier__min {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
}

.tier__note,
.tier__none {
  margin: 0;
  color: var(--nk-text-muted);
}

.tier__group {
  display: flex;
  gap: var(--nk-space-4);
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
}

.tier__grade {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-2);
  width: var(--nk-tile-lg);
  --grade: var(--nk-neutral);
}

.tier__grade[data-grade-index='0'] {
  --grade: var(--nk-el-fire);
}

.tier__grade[data-grade-index='1'] {
  --grade: var(--nk-el-iron);
}

.tier__grade[data-grade-index='2'] {
  --grade: var(--nk-estimate);
}

.tier__grade[data-grade-index='3'] {
  --grade: var(--nk-ok);
}

.tier__grade[data-grade-index='4'] {
  --grade: var(--nk-el-water);
}

.tier__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--nk-tile-sm);
  height: var(--nk-tile-sm);
  border-radius: var(--nk-radius-md);
  background: var(--grade);
  color: var(--nk-text-on-bright);
  font-size: var(--nk-font-xl);
  font-weight: var(--nk-weight-heavy);
}

.tier__badge--hold {
  background: var(--nk-surface-raised);
  color: var(--nk-unknown);
  font-size: var(--nk-font-lg);
}

.tier__count {
  color: var(--nk-text-muted);
  font-weight: var(--nk-weight-bold);
}

.tier__min {
  text-align: center;
}

.tier__entries {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--nk-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tier__entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-2);
}

.tier__entry--unsupported {
  padding: var(--nk-space-2);
  border: var(--nk-border-width) dashed var(--nk-error);
  border-radius: var(--nk-radius-md);
}

.tier__score {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.tier__holds {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tier__hold {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.tier__hold-name {
  font-weight: var(--nk-weight-bold);
}

.tier__hold-reason {
  color: var(--nk-text-muted);
  overflow-wrap: anywhere;
}
</style>
