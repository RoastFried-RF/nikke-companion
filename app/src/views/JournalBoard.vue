<script setup lang="ts">
// 기록장(P-033 — 모듈 기록): 요격전을 돌고 얻은 것을 날짜별로 손으로 적는다 — 보스 · 달성 단계 · 얻은 것(장비 부위별 수 · 커스텀 모듈 수).
// 위에 이번 주·이번 달·전체의 합과 보스별 횟수가 보이고, 아래에 날짜별 기록이 있다. 요격전 대미지 기록(P-029 — 보스의
// 「내 기록」에서 적는다)도 같은 날짜 아래에 나란히 보인다 — 한 화면에서 본다.
// 기록은 계정마다 따로, 이 PC에 남는다(lib/plan.ts — 저장은 Rust가 한다). 합과 묶음은 루트의 순수 함수(src/core/journal.mjs)가 만든다.
// **적은 것만 센다**: 보상이 나올 확률과 한 번에 얻는 수는 이 앱이 모른다 — 그 문장은 접지 않는다.
import { REWARD_PARTS, rewardText } from '@core/journal.mjs';
import { computed, ref } from 'vue';
import { damageUnit } from '../lib/format';
import { journalDays, journalSummary, MODE_LABEL, planBosses, today, usePlan } from '../lib/plan';
import { useShared } from '../lib/shared';
import type { PlanDoc, RewardSum } from '../types';
import DetailsFold from '../ui/DetailsFold.vue';
import StatusPill from '../ui/StatusPill.vue';

const store = usePlan();
const shared = useShared();

/** 고를 보스(추천 결과가 있으면 그 보스들, 없으면 앱에 든 보스 정보). */
const bosses = computed(() => planBosses(shared?.intercept.value ?? null));

const date = ref(today());
const bossId = ref('');
const stage = ref('');
const gear = ref<Record<string, string>>(Object.fromEntries(REWARD_PARTS.map((part) => [part, ''])));
const modules = ref('');
const error = ref('');
const busy = ref(false);

const boss = computed(() => bosses.value.find((b) => b.id === bossId.value) ?? null);
const blankPlan: PlanDoc = { schema_version: 1, kind: 'intercept_plan', favorites: [], records: [] };
const plan = computed(() => store?.plan.value ?? blankPlan);
const summary = computed(() => journalSummary(plan.value, today(), bosses.value));
const days = computed(() => journalDays(plan.value));
/** 보스별 횟수의 막대 길이를 정하는 가장 큰 횟수. */
const maxRuns = computed(() => Math.max(1, ...summary.value.bosses.map((b) => b.runs)));

/** 합 하나의 말: 「3번 · 커스텀 모듈 4 · 장비 5(머리 2 · 몸통 3)」. */
function sumText(sum: RewardSum): string {
  const parts = REWARD_PARTS.filter((part) => (sum.gear[part] ?? 0) > 0).map((part) => `${part} ${sum.gear[part]}`);
  return `${sum.runs}번 · 커스텀 모듈 ${sum.modules} · 장비 ${sum.gear_total}${parts.length ? `(${parts.join(' · ')})` : ''}`;
}

async function add(): Promise<void> {
  if (!store || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.addReward({ date: date.value, boss_id: bossId.value, boss_name: boss.value?.name ?? bossId.value, stage: stage.value, gear: { ...gear.value }, modules: modules.value });
    // 날짜와 보스는 남긴다(같은 날 여러 번 적기 쉽게). 수는 비운다.
    stage.value = '';
    modules.value = '';
    gear.value = Object.fromEntries(REWARD_PARTS.map((part) => [part, '']));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function remove(kind: 'reward' | 'damage', id: string): Promise<void> {
  if (!store) return;
  try {
    if (kind === 'reward') await store.removeReward(id);
    else await store.removeRecord(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <section v-if="store" class="nk-card journal" aria-label="기록장" data-testid="journal-board">
    <div class="nk-row">
      <h2 class="nk-subtitle">기록장</h2>
      <span class="nk-muted">요격전을 돌고 얻은 것을 적어 둔다 — 지금 쓰는 계정의 기록이고, 이 PC에 남는다</span>
      <span class="nk-spacer"></span>
      <span v-if="shared?.accountName.value" class="nk-muted" data-testid="journal-account">계정 <strong>{{ shared.accountName.value }}</strong></span>
    </div>

    <form class="journal__form" data-testid="journal-form" @submit.prevent="add">
      <input v-model="date" class="nk-input" type="date" aria-label="날짜" data-testid="journal-date" />
      <select v-model="bossId" class="nk-input" aria-label="보스" data-testid="journal-boss">
        <option value="" disabled>보스를 고른다</option>
        <option v-for="b in bosses" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
      <input v-model="stage" class="nk-input journal__num" type="text" inputmode="numeric" autocomplete="off" placeholder="달성 단계" aria-label="달성 단계" data-testid="journal-stage" />
      <label v-for="part in REWARD_PARTS" :key="part" class="journal__field">
        <span>{{ part }} 장비</span>
        <input v-model="gear[part]" class="nk-input journal__count" type="text" inputmode="numeric" autocomplete="off" placeholder="0" :aria-label="`${part} 장비 수`" :data-part="part" data-testid="journal-gear" />
      </label>
      <label class="journal__field">
        <span>커스텀 모듈</span>
        <input v-model="modules" class="nk-input journal__count" type="text" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="커스텀 모듈 수" data-testid="journal-modules" />
      </label>
      <button type="submit" class="nk-btn nk-btn--primary" :disabled="busy" data-testid="journal-add">기록 적기</button>
    </form>
    <p v-if="boss" class="nk-muted" data-testid="journal-boss-reward">
      {{ boss.name }}의 보상: {{ boss.reward ?? '모름' }} — 얻은 만큼만 적는다(비워 두면 0이다).
    </p>
    <p v-if="error" class="nk-error" role="alert" data-testid="journal-error"><strong>기록을 적지 못했다.</strong> {{ error }}</p>
    <p v-if="store.problem.value && !error" class="nk-note" role="status" data-testid="journal-problem">{{ store.problem.value }}</p>

    <!-- 합: 이번 주 · 이번 달 · 전체 -->
    <div class="journal__sums" data-testid="journal-sums">
      <div v-if="summary.this_week" class="journal__sum" data-testid="journal-week">
        <span class="journal__sum-title">이번 주 <span class="nk-muted">{{ summary.this_week.label }}</span></span>
        <strong data-testid="journal-week-text">{{ sumText(summary.this_week) }}</strong>
      </div>
      <div v-if="summary.this_month" class="journal__sum" data-testid="journal-month">
        <span class="journal__sum-title">이번 달 <span class="nk-muted">{{ summary.this_month.label }}</span></span>
        <strong data-testid="journal-month-text">{{ sumText(summary.this_month) }}</strong>
      </div>
      <div class="journal__sum" data-testid="journal-total">
        <span class="journal__sum-title">전체</span>
        <strong data-testid="journal-total-text">{{ sumText(summary.total) }}</strong>
      </div>
    </div>
    <!-- 모르는 것과 정한 것은 접지 않는다. -->
    <p v-for="note in summary.notes" :key="note" class="nk-muted journal__note" data-testid="journal-note">{{ note }}</p>

    <!-- 보스별 횟수 -->
    <div class="journal__bosses" aria-label="보스별 횟수" data-testid="journal-bosses">
      <h3 class="journal__title">보스별 횟수</h3>
      <ul class="journal__list">
        <li v-for="b in summary.bosses" :key="b.boss_id" class="journal__boss" :data-boss="b.boss_id" data-testid="journal-boss-count">
          <span class="journal__boss-name">{{ b.boss_name }}</span>
          <span class="journal__bar" aria-hidden="true"><span class="journal__bar-fill" :style="{ width: `${Math.round((b.runs / maxRuns) * 100)}%` }"></span></span>
          <strong data-testid="journal-boss-runs">{{ b.runs }}번</strong>
          <span class="nk-muted" data-testid="journal-boss-detail">
            <template v-if="b.runs > 0">
              마지막 {{ b.last_date }}{{ b.best_stage !== null ? ` · 가장 높은 달성 단계 ${b.best_stage}` : '' }} · 커스텀 모듈 {{ b.modules }} · 장비 {{ b.gear_total }}
            </template>
            <template v-else>아직 적은 것이 없다</template>
          </span>
        </li>
      </ul>
    </div>

    <DetailsFold v-if="summary.weeks.length || summary.months.length" summary="주별 · 월별 합" :count="summary.weeks.length + summary.months.length" data-testid="journal-periods">
      <ul class="journal__list">
        <li v-for="w in summary.weeks" :key="`w-${w.key}`" data-testid="journal-week-item">{{ w.label }} — {{ sumText(w) }}</li>
        <li v-for="m in summary.months" :key="`m-${m.key}`" data-testid="journal-month-item">{{ m.label }} — {{ sumText(m) }}</li>
      </ul>
    </DetailsFold>

    <!-- 날짜별: 보상 기록과 요격전 대미지 기록(P-029)을 한 화면에서 본다 -->
    <div class="journal__days" aria-label="날짜별 기록" data-testid="journal-days">
      <div class="nk-row">
        <h3 class="journal__title">날짜별 기록</h3>
        <span class="nk-muted">대미지 기록은 추천 보기에서 보스를 고르고 「내 기록」에 적는다</span>
      </div>
      <p v-if="days.length === 0" class="nk-muted" data-testid="journal-empty">아직 적어 둔 기록이 없다.</p>
      <div v-for="day in days" :key="day.date" class="journal__day" :data-date="day.date" data-testid="journal-day">
        <h4 class="journal__date" data-testid="journal-day-date">{{ day.date }}</h4>
        <ul class="journal__list">
          <li v-for="r in day.rewards" :key="r.id" class="journal__item" data-kind="reward" data-testid="journal-reward">
            <StatusPill label="보상" tone="accent" />
            <strong>{{ r.boss_name }}</strong>
            <span v-if="r.stage !== null" data-testid="journal-reward-stage">달성 단계 {{ r.stage }}</span>
            <span data-testid="journal-reward-text">{{ rewardText(r) }}</span>
            <span class="nk-spacer"></span>
            <button type="button" class="nk-btn nk-btn--quiet" :title="`${r.date}의 ${r.boss_name} 보상 기록 지우기`" data-testid="journal-reward-remove" @click="remove('reward', r.id)">지우기</button>
          </li>
          <li v-for="d in day.damages" :key="d.id" class="journal__item" data-kind="damage" data-testid="journal-damage">
            <StatusPill :label="MODE_LABEL[d.mode]" :tone="d.mode === 'real' ? 'ok' : 'neutral'" />
            <strong>{{ d.boss_name }}</strong>
            <span data-testid="journal-damage-value">대미지 {{ damageUnit(d.damage) }}</span>
            <span v-if="d.stage !== null">달성 단계 {{ d.stage }}</span>
            <span class="nk-spacer"></span>
            <button type="button" class="nk-btn nk-btn--quiet" :title="`${d.date}의 ${d.boss_name} 대미지 기록 지우기`" data-testid="journal-damage-remove" @click="remove('damage', d.id)">지우기</button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.journal {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
}

.journal__form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.journal__field {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-2);
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.journal__num {
  width: calc(var(--nk-tile-lg) + var(--nk-space-4));
}

.journal__count {
  width: var(--nk-tile-sm);
}

.journal__sums {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-3);
}

.journal__sum {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--nk-space-2);
  min-width: calc(var(--nk-tile-lg) * 2);
  padding: var(--nk-space-3) var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.journal__sum-title {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-bold);
}

.journal__note {
  margin: 0;
  font-size: var(--nk-font-sm);
}

.journal__title {
  margin: 0;
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-bold);
}

.journal__bosses,
.journal__days,
.journal__day {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
}

.journal__list {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.journal__boss,
.journal__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.journal__boss-name {
  width: calc(var(--nk-tile-lg) + var(--nk-space-6));
  font-weight: var(--nk-weight-bold);
}

.journal__bar {
  flex: 1;
  min-width: var(--nk-tile-lg);
  height: var(--nk-bar-height);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-sunken);
  overflow: hidden;
}

.journal__bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--nk-radius-pill);
  background: var(--nk-accent);
}

.journal__date {
  margin: 0;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-md);
  font-weight: var(--nk-weight-bold);
}
</style>
