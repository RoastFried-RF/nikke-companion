<script setup lang="ts">
// 계산 실행: 계정 파일과 조건 파일을 골라 추천(suggest)·비교(compare)를 돌린다.
// 계산은 루트의 src/core가 하고(lib/compute.ts), 엔진 프로세스는 Rust가 띄운다. 결과는 부모가 그린다.
// 진행 표시·중단은 다른 계산 화면과 같은 것을 쓴다(lib/engineRun.ts, RunStatus, RunButtons).
import { reactive, ref } from 'vue';
import { DEFAULT_BUDGET, DEFAULT_LIMIT, DEFAULT_TOP, runCompare, runSuggest } from '../lib/compute';
import { useEngineRun } from '../lib/engineRun';
import { recall, remember } from '../lib/remember';
import type { CompareReport } from '../types';
import PathField from './PathField.vue';
import RunButtons from './RunButtons.vue';
import RunStatus from './RunStatus.vue';

type Mode = 'suggest' | 'compare';
type Field = 'account' | 'condition' | 'squads';

const props = defineProps<{
  /** 부모가 다른 일을 하는 중이면 실행을 막는다. */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  start: [];
  done: [report: CompareReport];
  fail: [message: string];
  /** 사용자가 중단했다. 결과도 오류도 아니다 — 부모는 계산 전의 화면으로 돌아간다. */
  cancel: [];
}>();

const FIELDS: Record<Field, { label: string; title: string; placeholder: string }> = {
  account: { label: '계정', title: '계정 상태 파일 고르기', placeholder: '계정 상태 JSON 파일 경로' },
  condition: { label: '조건', title: '전투 조건 파일 고르기', placeholder: '전투 조건 JSON 파일 경로' },
  squads: { label: '편성', title: '후보 편성 파일 고르기', placeholder: '후보 편성 JSON 파일 경로' },
};

/** 마지막으로 쓴 값을 기억하는 이름. */
const KEY = (name: string) => `compute.${name}`;

// 처음 보일 경로: 마지막으로 계산에 쓴 파일 → (개발 실행에서만) 샘플
const paths = reactive<Record<Field, string>>({
  account: recall(KEY('account')) || (__DEV_SAMPLES__?.account ?? ''),
  condition: recall(KEY('condition')) || (__DEV_SAMPLES__?.condition ?? ''),
  squads: recall(KEY('squads')) || (__DEV_SAMPLES__?.squads ?? ''),
});
const mode = ref<Mode>(recall(KEY('mode')) === 'compare' ? 'compare' : 'suggest');
/** 빈 칸이면 계산 코드의 기본값을 쓴다. 값의 범위는 계산 코드가 확인한다. */
const limit = ref<number | ''>('');
const top = ref<number | ''>('');
/** 전체 시뮬 횟수의 상한(추천의 1단계 + 2단계). 빈 칸이면 계산 코드의 기본값. */
const budget = ref<number | ''>('');
/** 상위 조합의 배치 순서도 탐색하나(추천의 2단계). 계산 코드의 기본값과 같이 켜 둔다. */
const refine = ref(recall(KEY('refine')) !== 'off');

const engine = useEngineRun('compare');

const count = (value: number | ''): number | undefined => (value === '' ? undefined : value);

async function run(): Promise<void> {
  if (props.disabled) return;
  const chosen = mode.value;
  await engine.run<CompareReport>(
    (deps) =>
      chosen === 'suggest'
        ? runSuggest(
            {
              accountPath: paths.account,
              conditionPath: paths.condition,
              limit: count(limit.value),
              top: count(top.value),
              refine: refine.value,
              budget: count(budget.value),
            },
            deps,
          )
        : runCompare({ accountPath: paths.account, conditionPath: paths.condition, squadsPath: paths.squads }, deps),
    {
      start: () => emit('start'),
      done: (report) => {
        remember(KEY('account'), paths.account.trim());
        remember(KEY('condition'), paths.condition.trim());
        if (chosen === 'compare') remember(KEY('squads'), paths.squads.trim());
        else remember(KEY('refine'), refine.value ? 'on' : 'off');
        remember(KEY('mode'), chosen);
        emit('done', report);
      },
      fail: (message) => emit('fail', message),
      cancel: () => emit('cancel'),
    },
  );
}
</script>

<template>
  <section class="compute" aria-label="계산 실행" data-testid="compute">
    <div class="compute__modes" role="radiogroup" aria-label="계산 방식">
      <label class="compute__mode">
        <input v-model="mode" type="radio" value="suggest" :disabled="engine.computing" data-testid="mode-suggest" />
        추천 <span class="compute__sub">보유 니케에서 후보 생성</span>
      </label>
      <label class="compute__mode">
        <input v-model="mode" type="radio" value="compare" :disabled="engine.computing" data-testid="mode-compare" />
        비교 <span class="compute__sub">편성 파일</span>
      </label>
    </div>

    <template v-for="field in (['account', 'condition', 'squads'] as const)" :key="field">
      <PathField
        v-if="field !== 'squads' || mode === 'compare'"
        v-model="paths[field]"
        :name="field"
        :label="FIELDS[field].label"
        :title="FIELDS[field].title"
        :placeholder="FIELDS[field].placeholder"
        :disabled="engine.computing"
        @enter="run"
        @fail="(message) => emit('fail', message)"
      />
    </template>

    <div class="compute__row compute__row--wrap">
      <template v-if="mode === 'suggest'">
        <label class="compute__count">
          후보
          <input
            v-model.number="limit"
            type="number"
            min="1"
            step="1"
            :placeholder="String(DEFAULT_LIMIT)"
            :disabled="engine.computing"
            aria-label="계산할 후보 편성 수"
            data-testid="suggest-limit"
          />
        </label>
        <label class="compute__count">
          표시
          <input
            v-model.number="top"
            type="number"
            min="1"
            step="1"
            :placeholder="String(DEFAULT_TOP)"
            :disabled="engine.computing"
            aria-label="표시할 상위 편성 수"
            data-testid="suggest-top"
          />
        </label>
        <label class="compute__count" title="엔진 시뮬 횟수의 상한 (멤버 조합 + 배치 탐색)">
          예산
          <input
            v-model.number="budget"
            type="number"
            min="1"
            step="1"
            :placeholder="String(DEFAULT_BUDGET)"
            :disabled="engine.computing"
            aria-label="전체 시뮬 횟수의 상한"
            data-testid="suggest-budget"
          />
        </label>
        <label class="compute__check" title="상위 조합의 배치 순서도 바꿔 가며 계산한다">
          <input v-model="refine" type="checkbox" :disabled="engine.computing" data-testid="suggest-refine" />
          배치 탐색
        </label>
      </template>
      <span class="compute__spacer"></span>
      <RunButtons :run="engine" :label="mode === 'suggest' ? '추천 실행' : '비교 실행'" :disabled="disabled" @run="run" @stop="engine.stop" />
    </div>

    <RunStatus :run="engine" />
  </section>
</template>

<style scoped>
.compute {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-strong);
}

.compute__modes {
  display: flex;
  gap: 12px;
}

.compute__mode {
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
  cursor: pointer;
}

.compute__sub {
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}

.compute__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compute__count {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
}

.compute__count input {
  width: 52px;
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
}

.compute__row--wrap {
  flex-wrap: wrap;
}

.compute__check {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--muted);
  white-space: nowrap;
  cursor: pointer;
}

.compute__spacer {
  flex: 1;
}
</style>
