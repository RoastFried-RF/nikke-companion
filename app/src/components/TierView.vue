<script setup lang="ts">
// 티어 결과(`tier build`가 만든 문서 — docs/data-model.md §티어 결과)를 표로 그린다.
// 등급별 묶음, 버스트 단계 필터, 평가 보류는 따로 묶어 사유와 함께, 버전·가정·주의 문구.
// 등급을 매기거나 점수를 고치지 않는다 — 문서의 값을 서식만 입혀 보여 준다. 등급 규칙이 임시라는 문구는 언제나 보인다.
import { computed, ref } from 'vue';
import { burstOrderGroup } from '@core/search.mjs';
import { STATUS_HOLD, STATUS_PREDICTED } from '@tier/evaluate.mjs';
import { cacheLabel, damageUnit, engineLabel, localTime, score3 } from '../lib/format';
import type { TierEntry, TierReport } from '../types';
import CaveatList from './CaveatList.vue';

const props = defineProps<{ report: TierReport }>();

/** 버스트 단계 필터의 값. 'all' = 전체, 'none' = 단계 미상. 그 밖은 버스트 묶음('1'·'2'·'3'). */
const filter = ref('all');

/** 니케의 버스트 묶음 — 루트의 규칙(src/core/search.mjs의 burstOrderGroup: 전 단계 니케는 3단계 묶음)을 그대로 쓴다. */
const groupOf = (e: TierEntry): string => burstOrderGroup({ burst_stage: e.burst_stage }) ?? 'none';

function burstLabel(e: TierEntry): string {
  const group = groupOf(e);
  if (group === 'none') return '단계 미상';
  return e.burst_stage === group ? `${group}단계` : `${group}단계(${e.burst_stage})`;
}

const entries = computed(() => props.report.entries ?? []);

/** 평가 보류인가. 등급이 없는 항목은 상태가 무엇이든 등급 표에 넣지 않는다. */
const isHold = (e: TierEntry) => e.status === STATUS_HOLD || e.tier === null || e.tier === undefined;

/** 필터 단추: 전체와, 결과에 있는 버스트 묶음. */
const filters = computed(() => {
  const counts = new Map<string, number>();
  for (const e of entries.value) counts.set(groupOf(e), (counts.get(groupOf(e)) ?? 0) + 1);
  const groups = ['1', '2', '3', 'none'].filter((g) => counts.has(g));
  return [
    { key: 'all', label: '전체', count: entries.value.length },
    ...groups.map((g) => ({ key: g, label: g === 'none' ? '단계 미상' : `${g}단계`, count: counts.get(g) ?? 0 })),
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
  const unknown = others.map((tier) => ({ tier, min: null, index: tiers.length, entries: graded.filter((e) => e.tier === tier) }));
  return [...known, ...unknown].filter((g) => g.entries.length > 0);
});

/** 상태마다 다르게 그린다: 예측 평가 / 평가 보류 / 그 밖(앞으로 더해질 「실측 대조 완료」 등). */
function statusKey(e: TierEntry): 'predicted' | 'hold' | 'other' {
  if (e.status === STATUS_PREDICTED) return 'predicted';
  if (e.status === STATUS_HOLD) return 'hold';
  return 'other';
}

/** 등급 규칙이 임시인가. 문서가 임시가 아니라고 밝힌 경우(`false`)에만 주의 문구를 내린다. */
const provisional = computed(() => props.report.rules?.provisional !== false);

const usedReferences = computed(() => (props.report.references?.squads ?? []).filter((s) => s.status === 'used').length);
const cacheText = computed(() => cacheLabel(props.report.cache));
const generated = computed(() => localTime(props.report.generated_at));
const growthLabel = computed(() => {
  const growth = props.report.scenario?.growth;
  return growth === 'engine_default' ? '엔진 기본 스펙(프로필 없음)' : (growth ?? '미확인');
});
</script>

<template>
  <div class="tier">
    <!-- 등급 규칙이 임시라는 문구는 스크롤해도 맨 위에 남는다. -->
    <p v-if="provisional" class="tier__provisional" role="note" data-testid="tier-provisional">
      등급 규칙 {{ report.rules?.version ?? '(버전 미확인)' }}은 <strong>임시</strong>다 — 대표 사례로 검증되지 않았다. 등급 경계는 바뀔 수
      있다.
    </p>

    <header class="meta">
      <div class="meta__row">
        <span class="meta__account" data-testid="tier-summary">
          자동 티어 — {{ entries.length }}명 (등급 {{ report.summary?.graded ?? '?' }}명 · 평가 보류 {{ report.summary?.hold ?? '?' }}명)
        </span>
      </div>
      <div class="meta__line" data-testid="tier-engine">
        엔진: {{ engineLabel(report.engine) }} · 데이터 {{ report.engine_data?.version ?? '버전 미확인' }}
      </div>
      <div class="meta__line" data-testid="tier-scenario">
        시나리오: {{ report.scenario?.boss ?? '미확인' }} · {{ report.scenario?.duration ?? '?' }}초 · 육성 {{ growthLabel }}
      </div>
      <div class="meta__line" data-testid="tier-versions">
        기준 편성 {{ report.references?.version ?? '버전 미확인' }} ({{ (report.references?.squads ?? []).length }}개 중 {{ usedReferences }}개 사용) ·
        등급 규칙 {{ report.rules?.version ?? '버전 미확인' }}{{ provisional ? ' [임시]' : '' }} · 방법 {{ report.method?.id ?? '?' }} v{{
          report.method?.version ?? '?'
        }}
      </div>
      <div class="meta__line" data-testid="tier-sims">
        시뮬: {{ report.sims?.used }}건 / 예산 {{ report.sims?.budget }}건 (기준 편성 {{ report.sims?.baselines }}건 + 바꿔 넣기
        {{ report.sims?.variants }}건)
      </div>
      <div v-if="cacheText" class="meta__line" data-testid="cache">캐시: {{ cacheText }}</div>
      <div v-if="generated" class="meta__line" data-testid="generated-at">계산 시각: {{ generated }}</div>

      <details v-if="(report.assumptions ?? []).length" class="fold" data-testid="assumptions">
        <summary>가정 {{ report.assumptions.length }}개</summary>
        <ul class="bullets">
          <li v-for="(a, i) in report.assumptions" :key="i">{{ a }}</li>
        </ul>
      </details>
      <details class="fold" data-testid="tier-rules">
        <summary>등급 경계 (점수 = 팀 총딜 비율){{ provisional ? ' — 임시' : '' }}</summary>
        <ul class="bullets">
          <li v-for="t in report.rules?.tiers ?? []" :key="t.tier">{{ t.tier }}: {{ score3(t.min) }} 이상</li>
        </ul>
      </details>
      <details v-if="(report.references?.squads ?? []).length" class="fold" data-testid="tier-references">
        <summary>기준 편성 {{ report.references.squads.length }}개</summary>
        <ul class="bullets">
          <li v-for="s in report.references.squads" :key="s.id">
            {{ s.id }}: {{ (s.members ?? []).join(', ') }} —
            <template v-if="s.status === 'used'">{{ s.total_damage === null ? '계산하지 않음' : damageUnit(s.total_damage) }}</template>
            <template v-else>쓰지 못했다: {{ s.reason ?? '사유 없음' }}</template>
          </li>
        </ul>
      </details>
    </header>

    <div class="filters" role="group" aria-label="버스트 단계" data-testid="burst-filter">
      <button
        v-for="f in filters"
        :key="f.key"
        class="filters__button"
        :class="{ 'filters__button--active': filter === f.key }"
        type="button"
        :aria-pressed="filter === f.key"
        :data-burst="f.key"
        data-testid="burst-option"
        @click="filter = f.key"
      >
        {{ f.label }} <span class="filters__count">{{ f.count }}</span>
      </button>
    </div>

    <p v-if="groups.length === 0" class="empty" data-testid="tier-empty">
      {{ filter === 'all' ? '등급을 매긴 니케가 없다.' : '이 버스트 단계에는 등급을 매긴 니케가 없다.' }}
    </p>

    <section v-for="g in groups" :key="g.tier" class="group" :data-tier="g.tier" data-testid="tier-group">
      <h2 class="group__head">
        <span class="group__tier" :class="`group__tier--${Math.min(g.index, 7)}`" data-testid="tier-name">{{ g.tier }}</span>
        <span class="group__min">{{ g.min === null ? '규칙에 없는 등급' : `${score3(g.min)} 이상` }}</span>
        <span class="group__count">{{ g.entries.length }}명</span>
      </h2>
      <ul class="rows">
        <li
          v-for="e in g.entries"
          :key="e.name"
          class="row"
          :class="[`row--${statusKey(e)}`, { 'row--unsupported': e.unsupported }]"
          data-testid="tier-entry"
        >
          <details>
            <summary class="row__main">
              <span class="row__rank" data-testid="entry-rank">{{ e.rank ?? '-' }}</span>
              <span class="row__name" data-testid="entry-name">{{ e.name }}</span>
              <span class="row__burst" data-testid="entry-burst">{{ burstLabel(e) }}</span>
              <span class="row__score" data-testid="entry-score">{{ score3(e.score) }}</span>
              <span class="badge" :class="statusKey(e) === 'predicted' ? 'badge--accent' : 'badge--muted'" data-testid="entry-status">
                {{ e.status_label ?? e.status }}
              </span>
              <!-- 미지원 효과가 있는 항목은 눈에 띄어야 한다 — 그 효과가 빠진 수치다. -->
              <span v-for="flag in e.flags ?? []" :key="flag" class="badge badge--danger" data-testid="entry-flag">{{ flag }}</span>
            </summary>
            <div v-if="e.best" class="row__detail" data-testid="entry-best">
              {{ e.best.reference }}의 {{ e.best.replaced }} 자리: {{ damageUnit(e.best.reference_total) }} →
              {{ damageUnit(e.best.total_damage) }}
            </div>
            <ul v-if="(e.comparisons ?? []).length > 1" class="row__detail row__comparisons">
              <li v-for="(c, i) in e.comparisons" :key="i" data-testid="entry-comparison">
                {{ score3(c.ratio) }} — {{ c.reference }}의 {{ c.replaced }} 자리
              </li>
            </ul>
            <ul v-if="(e.notes ?? []).length" class="notes">
              <li v-for="(n, i) in e.notes" :key="i" data-testid="entry-note">{{ n }}</li>
            </ul>
          </details>
        </li>
      </ul>
    </section>

    <!-- 평가 보류는 등급 표와 따로 묶는다. 등급이 없는 것이지 0점이 아니다. -->
    <section v-if="holds.length" class="group group--hold" data-testid="tier-holds">
      <h2 class="group__head">
        <span class="group__tier group__tier--hold">평가 보류</span>
        <span class="group__min">등급 없음 — 0점이 아니다</span>
        <span class="group__count">{{ holds.length }}명</span>
      </h2>
      <ul class="rows">
        <li v-for="e in holds" :key="e.name" class="row row--hold" data-testid="hold-entry">
          <div class="row__main">
            <span class="row__name" data-testid="entry-name">{{ e.name }}</span>
            <span class="row__burst" data-testid="entry-burst">{{ burstLabel(e) }}</span>
            <span class="badge badge--warn" data-testid="entry-status">{{ e.status_label ?? e.status }}</span>
          </div>
          <div class="row__reason" data-testid="hold-reason">{{ e.hold?.message || (e.notes ?? []).join(' / ') || '사유 없음' }}</div>
        </li>
      </ul>
    </section>

    <CaveatList :caveats="report.caveats ?? []" />
  </div>
</template>

<style scoped>
.tier {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tier__provisional {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 5px 8px;
  border: 1px solid var(--warn);
  border-radius: 6px;
  background: #2b2110;
  color: var(--warn);
  font-size: 12px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.filters__button {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}

.filters__button--active {
  border-color: var(--accent);
  color: var(--text);
  background: rgba(124, 196, 255, 0.16);
}

.filters__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}

.group__tier {
  min-width: 34px;
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
}

/* 등급 색은 규칙 문서의 순서로 정한다(이름으로 정하지 않는다). */
.group__tier--0 {
  color: #ffc440;
}

.group__tier--1 {
  color: #ffd98a;
}

.group__tier--2 {
  color: #ff9f7a;
}

.group__tier--3 {
  color: #7cc4ff;
}

.group__tier--4 {
  color: #8fd6a6;
}

.group__tier--hold {
  color: var(--warn);
}

.group__count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.row {
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 12px;
}

.row--unsupported {
  border: 1px solid var(--danger);
  background: rgba(255, 122, 122, 0.1);
}

.row__main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}

summary.row__main {
  cursor: pointer;
  list-style: none;
}

summary.row__main::-webkit-details-marker {
  display: none;
}

.row__rank {
  min-width: 18px;
  color: var(--muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.row__name {
  /* 이름에 최소 폭을 줘서, 표시가 많아 좁아지면 이름을 쪼개지 않고 표시가 다음 줄로 넘어가게 한다. */
  flex: 1 1 120px;
  min-width: 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.row__burst {
  color: var(--muted);
  white-space: nowrap;
}

.row__score {
  min-width: 40px;
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.row__detail {
  margin: 2px 0 0 26px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.row__reason {
  color: var(--warn);
  overflow-wrap: anywhere;
}

.row .notes {
  margin: 2px 0 0 26px;
}

.row .badge {
  padding: 0 6px;
  font-size: 10px;
}
</style>
