<script setup lang="ts">
// 요격전 기록(P-029): 고른 보스에 대해 실제 대미지(모의전 또는 실전)·날짜·달성 단계를 손으로 적어 둔다.
// 같은 보스의 추정 총딜과 나란히 보이고 차이(비율)를 알린다. **추정치를 기록에 맞춰 고치지 않는다** — 차이를 보여 줄 뿐이다.
// 기록은 계정마다 따로, 이 PC의 계정 폴더에 남는다(lib/plan.ts — 저장은 Rust가 한다). 견주는 규칙은 루트의 순수 함수다.
import { computed, ref, watch } from 'vue';
import { damageUnit } from '../lib/format';
import { MODE_LABEL, recordCheck, recordsOf, today, usePlan } from '../lib/plan';
import type { InterceptBoss, PlanRecord } from '../types';
import StatusPill from '../ui/StatusPill.vue';

const props = defineProps<{
  boss: InterceptBoss;
  /** 이 보스의 추정 총딜(1위 편성). 계산하지 않았으면 null. */
  estimate: number | null;
}>();

const store = usePlan();

const damage = ref('');
const mode = ref<PlanRecord['mode']>('mock');
const date = ref(today());
const stage = ref('');
const error = ref('');
const busy = ref(false);

const records = computed(() => recordsOf(store?.plan.value, props.boss.id));
const check = computed(() => recordCheck(props.boss, store?.plan.value));

// 다른 보스로 바뀌면 적던 것과 오류를 비운다.
watch(
  () => props.boss.id,
  () => {
    damage.value = '';
    stage.value = '';
    error.value = '';
  },
);

async function add(): Promise<void> {
  if (!store || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.addRecord({ boss_id: props.boss.id, boss_name: props.boss.name, damage: damage.value, mode: mode.value, date: date.value, stage: stage.value });
    damage.value = '';
    stage.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function remove(id: string): Promise<void> {
  if (!store) return;
  try {
    await store.removeRecord(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** 기록이 추정의 몇 %인가(그 기록 하나와 지금의 추정). 추정이 없으면 빈 글. */
function ofEstimate(record: PlanRecord): string {
  if (!props.estimate) return '';
  return `추정의 ${Math.round((record.damage / props.estimate) * 100)}%`;
}
</script>

<template>
  <section v-if="store" class="records" aria-label="내 기록" data-testid="record-panel">
    <div class="records__head">
      <h3 class="records__title">내 기록</h3>
      <span class="records__hint">모의전이나 실전에서 본 대미지를 적어 두면 추정과 나란히 보인다. 추정치는 기록에 맞춰 고치지 않는다.</span>
    </div>

    <div v-if="check" class="records__compare" data-testid="record-compare">
      <span>추정 <strong data-testid="record-estimate">{{ damageUnit(check.estimate) }}</strong></span>
      <span>기록 <strong data-testid="record-actual">{{ damageUnit(check.actual) }}</strong></span>
      <StatusPill :label="check.text" tone="estimate" solid data-testid="record-diff" />
      <span class="records__hint" data-testid="record-detail">{{ check.detail }}</span>
    </div>
    <p v-else-if="records.length" class="records__hint" data-testid="record-no-estimate">이 보스의 추정 총딜이 아직 없어 견주지 못했다.</p>
    <p v-else class="records__hint" data-testid="record-none">아직 적어 둔 기록이 없다.</p>

    <form class="records__form" data-testid="record-form" @submit.prevent="add">
      <input
        v-model="damage"
        class="nk-input records__damage"
        type="text"
        inputmode="numeric"
        spellcheck="false"
        autocomplete="off"
        placeholder="대미지 — 1,234,567,890 또는 12.3억"
        aria-label="대미지"
        data-testid="record-damage"
      />
      <div class="nk-seg" role="radiogroup" aria-label="기록의 종류">
        <button
          v-for="(label, key) in MODE_LABEL"
          :key="key"
          type="button"
          role="radio"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': mode === key }"
          :aria-checked="mode === key"
          :data-testid="`record-mode-${key}`"
          @click="mode = key"
        >
          {{ label }}
        </button>
      </div>
      <input v-model="date" class="nk-input" type="date" aria-label="날짜" data-testid="record-date" />
      <input v-model="stage" class="nk-input records__stage" type="text" inputmode="numeric" autocomplete="off" placeholder="달성 단계(선택)" aria-label="달성 단계" data-testid="record-stage" />
      <button type="submit" class="nk-btn nk-btn--primary" :disabled="busy" data-testid="record-add">기록 적기</button>
    </form>
    <p v-if="error" class="nk-error" role="alert" data-testid="record-error"><strong>기록을 적지 못했다.</strong> {{ error }}</p>
    <p v-if="store.problem.value && !error" class="nk-note" role="status" data-testid="record-problem">{{ store.problem.value }}</p>

    <ul v-if="records.length" class="records__list" data-testid="record-list">
      <li v-for="r in records" :key="r.id" class="records__item" :data-mode="r.mode" data-testid="record-item">
        <span data-testid="record-item-date">{{ r.date }}</span>
        <StatusPill :label="MODE_LABEL[r.mode]" :tone="r.mode === 'real' ? 'ok' : 'neutral'" />
        <strong data-testid="record-item-damage">{{ damageUnit(r.damage) }}</strong>
        <span v-if="r.stage !== null" data-testid="record-item-stage">달성 단계 {{ r.stage }}</span>
        <span v-if="ofEstimate(r)" class="records__hint" data-testid="record-item-ratio">{{ ofEstimate(r) }}</span>
        <span class="records__spacer"></span>
        <button type="button" class="nk-btn nk-btn--quiet" :title="`${r.date}의 기록 지우기`" data-testid="record-remove" @click="remove(r.id)">지우기</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.records {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding-top: var(--nk-space-4);
  border-top: var(--nk-border-width) solid var(--nk-border);
}

.records__head,
.records__compare,
.records__form,
.records__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.records__title {
  margin: 0;
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-bold);
}

.records__hint {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  overflow-wrap: anywhere;
}

.records__damage {
  flex: 1;
  min-width: calc(var(--nk-tile-lg) * 2);
}

.records__stage {
  width: calc(var(--nk-tile-lg) + var(--nk-space-6));
}

.records__list {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.records__spacer {
  flex: 1;
}
</style>
