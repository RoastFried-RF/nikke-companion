<script setup lang="ts">
// 요격전 계획(P-029)의 그림 — 내 니케 화면의 한 구획:
//   오늘 돌 보스(한 문장 + 보스별 필요 칸 수 막대 + 접어 둔 근거), 장비 현황(초상화 옆 네 칸 + 부위별·기업별 요약), 속성 커버리지.
// 계산은 루트의 순수 함수(src/core/plan.mjs)가 한다 — 여기서는 받은 계정·추천 결과·계획에서 나온 값을 그릴 뿐이다.
// 계정에 없는 것(끼지 않은 장비의 수, 보상이 나올 확률)은 지어내지 않고 「모른다」고 적는다. 장비를 적지 않은 니케는 「기록 없음」이다.
import { computed, ref, watch } from 'vue';
import { planView } from '../lib/plan';
import type { AccountDoc, GearSlot, InterceptReport, NikkeInfo, PlanDoc } from '../types';
import DetailsFold from '../ui/DetailsFold.vue';
import ElementChip from '../ui/ElementChip.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import StatusPill from '../ui/StatusPill.vue';

/** 「전체」에서 한 번에 그리는 줄 수(초상화를 그만큼씩만 묻는다). */
const PAGE_SIZE = 40;

const props = defineProps<{
  account: AccountDoc;
  /** 마지막 요격전 추천. 없으면 null(주력은 즐겨찾기 → 많이 키운 순서로 고른다). */
  report: InterceptReport | null;
  plan: PlanDoc;
  info: (name: string) => NikkeInfo;
}>();

const emit = defineEmits<{
  /** 보스 이름을 눌렀다 — 요격전 화면의 그 보스로 간다. */
  (event: 'open-boss', id: string): void;
}>();

const view = computed(() => planView(props.account, props.report, props.plan, props.info));
const pick = computed(() => view.value.pick);
const coreNames = computed(() => new Set(view.value.core.names));

/** 장비 표에 누구를 보일까: 주력만 / 보유 니케 전체. */
const scope = ref<'core' | 'all'>('core');
const shownCount = ref(PAGE_SIZE);
watch(scope, () => (shownCount.value = PAGE_SIZE));

const summary = computed(() => (scope.value === 'core' ? view.value.coreSummary : view.value.summary));
const orderedRows = computed(() => {
  const rows = view.value.rows;
  const byName = new Map(rows.map((r) => [r.name, r]));
  const core = view.value.core.names.map((n) => byName.get(n)).filter((r) => r !== undefined);
  if (scope.value === 'core') return core;
  return [...core, ...rows.filter((r) => !coreNames.value.has(r.name))];
});
const visibleRows = computed(() => orderedRows.value.slice(0, shownCount.value));
const restRows = computed(() => Math.max(0, orderedRows.value.length - shownCount.value));

const reasonCount = computed(() => pick.value.bosses.reduce((s, b) => s + b.reasons.length, 0));
const barWidth = (value: number, max: number) => `${max > 0 ? Math.round((value / max) * 100) : 0}%`;

/** 칸의 색: 비어 있을수록 눈에 띈다. 기록이 없거나 모르는 칸은 회색이다. */
const TONE: Record<GearSlot['state'], string> = { empty: 'error', normal: 'unknown', corp: 'estimate', overload: 'ok', unrecorded: 'neutral', unknown: 'neutral' };

/** 칸 안의 짧은 말. */
function cellText(slot: GearSlot): string {
  const plus = slot.level === null ? '' : ` +${slot.level}`;
  if (slot.state === 'empty') return '미장착';
  if (slot.state === 'normal') return `${slot.tier ?? ''} 일반`.trim();
  if (slot.state === 'corp') return `${slot.tier ?? ''} 기업${plus}`.trim();
  if (slot.state === 'overload') return `오버로드${plus}`;
  return slot.label;
}

function cellTitle(name: string, slot: GearSlot): string {
  const maker = slot.corp ? ` · ${slot.corp}` : '';
  return `${name} — ${slot.part}: ${slot.label}${slot.tier ? ` ${slot.tier}` : ''}${slot.level === null ? '' : ` 강화 ${slot.level}`}${maker}`;
}

const weakestLine = computed(() => {
  const cov = view.value.coverage;
  if (!cov.weakest.length) return '';
  const parts = cov.elements
    .filter((e) => cov.weakest.includes(e.element))
    .map((e) => `${e.element}(${e.count}명${e.bosses.length ? ` — 약점이 ${e.element}인 ${e.bosses.map((b) => b.name).join('·')}` : ''})`);
  return `키운 딜러가 가장 적은 속성: ${parts.join(', ')}.`;
});
</script>

<template>
  <div class="plan" data-testid="plan-board">
    <section class="nk-card" aria-label="오늘 돌 보스" data-testid="today-boss">
      <div class="nk-row">
        <h2 class="nk-subtitle">오늘 돌 보스</h2>
        <StatusPill v-if="account.is_test_data" label="검증용 데이터" tone="test" solid data-testid="plan-data-kind" />
      </div>
      <p class="plan__pick" :data-status="pick.status" data-testid="boss-pick">{{ pick.text }}</p>
      <p class="nk-muted" data-testid="core-basis">{{ view.core.text }}</p>

      <ul class="plan__needs" data-testid="boss-needs">
        <li v-for="b in pick.bosses" :key="b.id" class="plan__need" :data-boss="b.id" :data-top="pick.top.includes(b.id) ? 'yes' : 'no'" data-testid="boss-need">
          <button type="button" class="nk-btn nk-btn--quiet plan__boss" :title="`요격전 화면에서 ${b.name} 보기`" data-testid="boss-need-open" @click="emit('open-boss', b.id)">
            {{ b.name }}
          </button>
          <span class="nk-muted plan__reward" data-testid="boss-need-reward">{{ b.reward ?? '보상 미확인' }}</span>
          <span class="plan__bar" aria-hidden="true"><span class="plan__fill" :style="{ width: barWidth(b.need ?? 0, pick.max_need) }"></span></span>
          <span class="plan__count" data-testid="boss-need-count">{{ b.need === null ? '세지 않음' : `${b.need}칸` }}</span>
        </li>
      </ul>

      <p v-if="pick.unrecorded.length" class="nk-note" data-testid="pick-unrecorded">
        장비가 계정에 적혀 있지 않아 세지 못한 주력 니케 {{ pick.unrecorded.length }}명: {{ pick.unrecorded.join(', ') }}
      </p>
      <!-- 모르는 것은 접지 않는다. -->
      <p v-for="line in pick.unknowns" :key="line" class="nk-muted" data-testid="pick-unknown">{{ line }}</p>

      <DetailsFold summary="근거 — 어느 니케의 어느 부위인가" :count="reasonCount" data-testid="pick-reasons">
        <template v-for="b in pick.bosses" :key="b.id">
          <p class="nk-list__head">{{ b.name }} — {{ b.reward ?? '보상 미확인' }}</p>
          <ul class="nk-list">
            <li v-for="r in b.reasons" :key="r.nikke" :data-boss="b.id" data-testid="pick-reason">{{ r.nikke }}: {{ r.part }} {{ r.label }}{{ r.tier ? `(${r.tier})` : '' }}</li>
            <li v-if="b.note" data-testid="pick-note">{{ b.note }}</li>
            <li v-else-if="!b.reasons.length" data-testid="pick-none">주력 니케의 {{ b.part }} 칸 가운데 오버로드가 아닌 것으로 적힌 칸이 없다.</li>
          </ul>
        </template>
        <p class="nk-muted">급한 순서: 오버로드가 아닌 칸이 많은 보스가 앞이다. 칸 수가 같으면 더 비어 있는 쪽(미장착 · 일반 등급 · 기업 장비 순)이 앞이고, 그래도 같으면 함께 적는다.</p>
      </DetailsFold>
    </section>

    <section class="nk-card" aria-label="장비 현황" data-testid="gear-status">
      <div class="nk-row">
        <h2 class="nk-subtitle">장비 현황</h2>
        <span class="nk-muted">계정에 적힌 값 그대로다.</span>
        <span class="nk-spacer"></span>
        <div class="nk-seg" role="group" aria-label="보일 니케">
          <button type="button" class="nk-seg__item" :class="{ 'nk-seg__item--on': scope === 'core' }" :aria-pressed="scope === 'core'" data-testid="gear-scope-core" @click="scope = 'core'">
            주력 {{ view.core.names.length }}명
          </button>
          <button type="button" class="nk-seg__item" :class="{ 'nk-seg__item--on': scope === 'all' }" :aria-pressed="scope === 'all'" data-testid="gear-scope-all" @click="scope = 'all'">
            전체 {{ view.rows.length }}명
          </button>
        </div>
      </div>

      <div class="nk-row" data-testid="gear-by-part">
        <span class="nk-muted">오버로드가 아닌 칸 — 부위별</span>
        <span v-for="p in summary.by_part" :key="p.part" class="plan__chip" :data-part="p.part" :title="`미장착 ${p.empty} · 일반 등급 ${p.normal} · 기업 장비 ${p.corp} · 오버로드 ${p.overload}`" data-testid="gear-part">
          {{ p.part }} <strong>{{ p.open }}칸</strong>
        </span>
      </div>
      <div class="nk-row" data-testid="gear-by-corp">
        <span class="nk-muted">기업별</span>
        <span v-for="c in summary.by_corp" :key="c.corp" class="plan__chip" :data-corp="c.corp" data-testid="gear-corp">{{ c.corp }} <strong>{{ c.open }}칸</strong>(니케 {{ c.nikkes }}명)</span>
        <span v-if="!summary.by_corp.length" class="nk-muted" data-testid="gear-corp-none">없음</span>
      </div>
      <p v-if="summary.unrecorded" class="nk-note" data-testid="gear-unrecorded">
        장비가 계정에 적혀 있지 않은 니케 {{ summary.unrecorded }}명은 세지 않았다(끼지 않은 것으로 치지 않는다). 계정을 새로 받으면 채워진다.
      </p>
      <p v-for="line in summary.unknowns" :key="line" class="nk-muted" data-testid="gear-unknown">{{ line }}</p>

      <ul class="plan__rows" data-testid="gear-rows">
        <li v-for="row in visibleRows" :key="row.name" class="plan__row" :data-core="coreNames.has(row.name) ? 'yes' : 'no'" data-testid="gear-row">
          <NikkeTile :name="row.name" size="xs" :element="info(row.name).element" :burst="info(row.name).burst" />
          <span class="plan__name" :title="row.name" data-testid="gear-row-name">{{ row.name }}</span>
          <StatusPill v-if="coreNames.has(row.name)" label="주력" tone="accent" data-testid="gear-row-core" />
          <span class="nk-spacer"></span>
          <span
            v-for="slot in row.slots"
            :key="slot.part"
            class="plan__cell"
            :data-part="slot.part"
            :data-state="slot.state"
            :data-tone="TONE[slot.state]"
            :title="cellTitle(row.name, slot)"
            data-testid="gear-cell"
          >
            <span class="plan__cell-part">{{ slot.part }}</span>
            <span class="plan__cell-state">{{ cellText(slot) }}</span>
          </span>
        </li>
      </ul>
      <button v-if="restRows > 0" type="button" class="nk-btn" data-testid="gear-more" @click="shownCount += PAGE_SIZE">더 보기 (남은 {{ restRows }}명)</button>
    </section>

    <section class="nk-card" aria-label="속성 커버리지" data-testid="coverage">
      <div class="nk-row">
        <h2 class="nk-subtitle">속성 커버리지</h2>
        <span class="nk-muted" data-testid="coverage-rule">{{ view.coverage.rule_text }} 어림 기준이다.</span>
      </div>
      <ul class="plan__needs">
        <li
          v-for="el in view.coverage.elements"
          :key="el.element"
          class="plan__need"
          :data-element="el.element"
          :data-weakest="view.coverage.weakest.includes(el.element) ? 'yes' : 'no'"
          :title="el.names.join(', ')"
          data-testid="coverage-row"
        >
          <ElementChip :element="el.element" />
          <span class="nk-muted plan__reward" data-testid="coverage-bosses">{{ el.bosses.length ? `약점인 보스 ${el.bosses.map((b) => b.name).join('·')}` : '약점인 보스 없음' }}</span>
          <span class="plan__bar" aria-hidden="true"><span class="plan__fill plan__fill--element" :style="{ width: barWidth(el.count, view.coverage.max) }"></span></span>
          <span class="plan__count" data-testid="coverage-count">{{ el.count }}명</span>
        </li>
      </ul>
      <p v-if="weakestLine" class="nk-note" data-testid="coverage-weakest">{{ weakestLine }}</p>
      <p v-if="view.coverage.unsure.length" class="nk-muted" data-testid="coverage-unsure">
        속성이나 클래스를 몰라 세지 못한 니케 {{ view.coverage.unsure.length }}명: {{ view.coverage.unsure.join(', ') }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
}

.plan__pick {
  margin: 0;
  font-size: var(--nk-font-xl);
  font-weight: var(--nk-weight-heavy);
  overflow-wrap: anywhere;
}

.plan__needs,
.plan__rows {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan__need {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
}

.plan__boss {
  flex: none;
  min-width: calc(var(--nk-tile-lg) + var(--nk-space-5));
  text-align: left;
}

.plan__need[data-top='yes'] .plan__boss {
  border-color: var(--nk-accent);
  color: var(--nk-text);
  font-weight: var(--nk-weight-bold);
}

.plan__reward {
  flex: none;
  min-width: calc(var(--nk-tile-lg) + var(--nk-space-7));
}

.plan__bar {
  flex: 1;
  height: var(--nk-bar-height);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-sunken);
  overflow: hidden;
}

.plan__fill {
  display: block;
  height: 100%;
  border-radius: var(--nk-radius-pill);
  background: var(--nk-accent);
}

.plan__fill--element {
  background: var(--nk-el);
}

.plan__count {
  flex: none;
  min-width: var(--nk-tile-sm);
  font-weight: var(--nk-weight-bold);
  text-align: right;
}

.plan__need[data-weakest='yes'] .plan__count {
  color: var(--nk-unknown);
}

.plan__chip {
  padding: var(--nk-space-1) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-sunken);
}

.plan__row {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-2) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.plan__name {
  min-width: 0;
  overflow: hidden;
  font-weight: var(--nk-weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan__cell {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  width: calc(var(--nk-tile-sm) + var(--nk-space-6));
  padding: var(--nk-space-1) var(--nk-space-2);
  border: var(--nk-border-width) solid var(--nk-tone);
  border-radius: var(--nk-radius-sm);
  background: var(--nk-surface-sunken);
}

.plan__cell-part {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-xs);
}

.plan__cell-state {
  color: var(--nk-tone);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-bold);
  white-space: nowrap;
}
</style>
