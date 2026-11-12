<script setup lang="ts">
// 홈의 「오늘의 요격전」 카드(P-029): 오늘 돌 보스 한 줄 + 그 보스의 1위 편성 초상화 다섯 + 지난 기록. 누르면 요격전 화면의 그 보스로 간다.
// 계산은 루트의 순수 함수(src/core/plan.mjs)가 한다 — 여기서는 받은 값을 그릴 뿐이다. 추천 편성이 아직 없으면 없다고 적는다.
import { computed } from 'vue';
import { damageUnit } from '../lib/format';
import { bestOf, latestRecord, MODE_LABEL, planView, recordCheck } from '../lib/plan';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { AccountDoc, InterceptReport, PlanDoc } from '../types';
import NikkeTile from '../ui/NikkeTile.vue';
import StatusPill from '../ui/StatusPill.vue';
import BossFace from './BossFace.vue';

const props = defineProps<{
  account: AccountDoc;
  report: InterceptReport | null;
  plan: PlanDoc;
}>();

// 니케 정보(속성·버스트 단계·클래스·기업)는 이 카드가 그려질 때만 읽는다 — 계정이 없으면 카드도 없고 읽지도 않는다.
const { info } = useNikkeCatalog();

const emit = defineEmits<{
  /** 카드를 눌렀다. 급한 보스가 있으면 그 보스의 id, 없으면 null(요격전 화면만 연다). */
  (event: 'open', id: string | null): void;
}>();

const view = computed(() => planView(props.account, props.report, props.plan, info));
/** 가장 급한 보스(동률이면 앞의 것 — 문장에는 둘 다 적힌다). */
const target = computed(() => view.value.pick.bosses.find((b) => b.id === view.value.pick.top[0]) ?? null);
const boss = computed(() => (target.value ? ((props.report?.bosses ?? []).find((b) => b.id === target.value?.id) ?? null) : null));
const squad = computed(() => bestOf(boss.value));
const last = computed(() => (target.value ? latestRecord(props.plan, target.value.id) : null));
const check = computed(() => recordCheck(boss.value, props.plan));
const weak = computed(() => boss.value?.element?.weak_to ?? null);
</script>

<template>
  <section class="nk-card today" aria-label="오늘의 요격전" data-testid="today-card">
    <div class="nk-row">
      <h2 class="nk-subtitle">오늘의 요격전</h2>
      <StatusPill v-if="account.is_test_data" label="검증용 데이터" tone="test" solid data-testid="today-data-kind" />
    </div>

    <button type="button" class="today__open" :data-boss="target?.id ?? ''" :title="target ? `요격전 화면에서 ${target.name} 보기` : '요격전 화면 열기'" data-testid="today-open" @click="emit('open', target?.id ?? null)">
      <BossFace v-if="target" :id="target.id" :name="target.name" :element="boss?.element?.code ?? null" />
      <span class="today__body">
        <strong class="today__pick" :data-status="view.pick.status" data-testid="today-pick">{{ view.pick.text }}</strong>
        <span v-if="target" class="today__sub" data-testid="today-need">주력 니케의 {{ target.part }} 칸 가운데 {{ target.need }}칸이 오버로드가 아니다 · 보상 {{ target.reward }}</span>

        <span v-if="squad" class="today__squad" data-testid="today-squad">
          <span v-for="m in squad.members ?? []" :key="m.name" :title="m.name" data-testid="today-member">
            <NikkeTile :name="m.name" size="mini" :element="info(m.name).element" :burst="info(m.name).burst" :weak="weak !== null && info(m.name).element === weak" />
          </span>
          <span class="today__sub" data-testid="today-total">1위 편성 {{ damageUnit(squad.total_damage) }}</span>
          <StatusPill label="추정" tone="estimate" solid data-role="estimate" />
        </span>
        <span v-else-if="target" class="today__sub" data-testid="today-no-squad">이 보스의 추천 편성은 아직 없다 — 요격전 화면에서 계산한다.</span>

        <span v-if="last" class="today__sub" data-testid="today-record">
          지난 기록 {{ damageUnit(last.damage) }}({{ MODE_LABEL[last.mode] }} · {{ last.date }}{{ last.stage !== null ? ` · 달성 단계 ${last.stage}` : '' }}){{ check ? ` — ${check.text}` : '' }}
        </span>
        <span v-else-if="target" class="today__sub" data-testid="today-record">지난 기록 없음 — 요격전 화면에서 적어 둘 수 있다.</span>
      </span>
    </button>

    <p class="nk-muted" data-testid="today-basis">{{ view.core.text }} {{ view.pick.unknowns.join(' ') }}</p>
  </section>
</template>

<style scoped>
.today__open {
  display: flex;
  align-items: flex-start;
  gap: var(--nk-space-4);
  width: 100%;
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
  color: var(--nk-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.today__open:hover {
  border-color: var(--nk-accent);
}

.today__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--nk-space-3);
  min-width: 0;
}

.today__pick {
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-heavy);
  overflow-wrap: anywhere;
}

.today__sub {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  overflow-wrap: anywhere;
}

.today__squad {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}
</style>
