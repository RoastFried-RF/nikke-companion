<script setup lang="ts">
// 계산 실행: 계정 파일과 조건 파일을 골라 추천(suggest)·비교(compare)를 돌린다.
// 계산은 루트의 src/core가 하고(lib/compute.ts), 엔진 프로세스는 Rust가 띄운다. 결과는 부모가 그린다.
import { onBeforeUnmount, reactive, ref } from 'vue';
import { errorMessage, onEngineProgress, pickJsonFile } from '../lib/backend';
import { DEFAULT_BUDGET, DEFAULT_LIMIT, DEFAULT_TOP, defaultDeps, runCompare, runSuggest, type ComputeDeps } from '../lib/compute';
import type { CompareReport, EngineProgress, SearchStage } from '../types';

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
}>();

const FIELDS: Record<Field, { label: string; title: string; placeholder: string }> = {
  account: { label: '계정', title: '계정 상태 파일 고르기', placeholder: '계정 상태 JSON 파일 경로' },
  condition: { label: '조건', title: '전투 조건 파일 고르기', placeholder: '전투 조건 JSON 파일 경로' },
  squads: { label: '편성', title: '후보 편성 파일 고르기', placeholder: '후보 편성 JSON 파일 경로' },
};

/** 마지막으로 쓴 값을 기억하는 localStorage 키. */
const KEY = (name: string) => `nikke-companion.compute.${name}`;

function remembered(name: string): string {
  try {
    return localStorage.getItem(KEY(name)) ?? '';
  } catch {
    return '';
  }
}

function remember(name: string, value: string): void {
  try {
    localStorage.setItem(KEY(name), value);
  } catch {
    // 저장하지 못해도 동작에는 지장이 없다.
  }
}

// 처음 보일 경로: 마지막으로 계산에 쓴 파일 → (개발 실행에서만) 샘플
const paths = reactive<Record<Field, string>>({
  account: remembered('account') || (__DEV_SAMPLES__?.account ?? ''),
  condition: remembered('condition') || (__DEV_SAMPLES__?.condition ?? ''),
  squads: remembered('squads') || (__DEV_SAMPLES__?.squads ?? ''),
});
const mode = ref<Mode>(remembered('mode') === 'compare' ? 'compare' : 'suggest');
/** 빈 칸이면 계산 코드의 기본값을 쓴다. 값의 범위는 계산 코드가 확인한다. */
const limit = ref<number | ''>('');
const top = ref<number | ''>('');
/** 전체 시뮬 횟수의 상한(추천의 1단계 + 2단계). 빈 칸이면 계산 코드의 기본값. */
const budget = ref<number | ''>('');
/** 상위 조합의 배치 순서도 탐색하나(추천의 2단계). 계산 코드의 기본값과 같이 켜 둔다. */
const refine = ref(remembered('refine') !== 'off');

const computing = ref(false);
/** 엔진에 넘긴 요청 수와 끝난 수. 엔진을 부르기 전에는 null. */
const progress = ref<EngineProgress | null>(null);
/** 추천이 지금 어느 단계인지와 쓴 예산(계산 코드가 단계마다 알려 준다). 비교에서는 null. */
const stage = ref<SearchStage | null>(null);
const elapsed = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function stopTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

async function pick(field: Field): Promise<void> {
  try {
    const picked = await pickJsonFile(FIELDS[field].title);
    if (picked) paths[field] = picked;
  } catch (e) {
    emit('fail', `파일 고르기 창을 열지 못했다: ${errorMessage(e)}`);
  }
}

const count = (value: number | ''): number | undefined => (value === '' ? undefined : value);

async function run(): Promise<void> {
  if (computing.value || props.disabled) return;
  computing.value = true;
  progress.value = null;
  stage.value = null;
  elapsed.value = 0;
  emit('start');

  const startedAt = Date.now();
  timer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
  }, 1000);

  let unlisten: (() => void) | null = null;
  try {
    try {
      unlisten = await onEngineProgress((p) => {
        // 여러 프로세스가 따로 알려 오므로 순서가 뒤바뀔 수 있다. 줄어들지 않게 한다.
        if (progress.value) progress.value = { total: p.total, done: Math.max(progress.value.done, p.done) };
      });
    } catch {
      // 진행 건수를 받지 못해도 계산은 한다. 경과 시간만 보인다.
      unlisten = null;
    }
    const deps: ComputeDeps = {
      ...defaultDeps,
      runtime: {
        ...defaultDeps.runtime,
        runBatch: (requests, options) => {
          progress.value = { done: 0, total: requests.length };
          return defaultDeps.runtime.runBatch(requests, options);
        },
      },
      // 단계가 바뀌면 앞 단계의 건수를 지운다. 이 단계의 요청이 모두 캐시에 있으면 엔진을 부르지 않는다.
      onStage: (s) => {
        stage.value = s;
        progress.value = null;
      },
    };
    const report =
      mode.value === 'suggest'
        ? await runSuggest(
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
        : await runCompare({ accountPath: paths.account, conditionPath: paths.condition, squadsPath: paths.squads }, deps);
    remember('account', paths.account.trim());
    remember('condition', paths.condition.trim());
    if (mode.value === 'compare') remember('squads', paths.squads.trim());
    else remember('refine', refine.value ? 'on' : 'off');
    remember('mode', mode.value);
    emit('done', report);
  } catch (e) {
    emit('fail', errorMessage(e));
  } finally {
    unlisten?.();
    stopTimer();
    computing.value = false;
    progress.value = null;
    stage.value = null;
  }
}

/** 진행 줄 앞에 붙이는 단계 이름. 배치 탐색을 끈 추천(단계가 하나)과 비교에서는 붙이지 않는다. */
function stageLabel(s: SearchStage | null): string {
  if (!s || s.stages < 2) return '';
  return `${s.stage}/${s.stages}단계(${s.stage === 1 ? '멤버 조합' : '배치'}) `;
}

onBeforeUnmount(stopTimer);
</script>

<template>
  <section class="compute" aria-label="계산 실행" data-testid="compute">
    <div class="compute__modes" role="radiogroup" aria-label="계산 방식">
      <label class="compute__mode">
        <input v-model="mode" type="radio" value="suggest" :disabled="computing" data-testid="mode-suggest" />
        추천 <span class="compute__sub">보유 니케에서 후보 생성</span>
      </label>
      <label class="compute__mode">
        <input v-model="mode" type="radio" value="compare" :disabled="computing" data-testid="mode-compare" />
        비교 <span class="compute__sub">편성 파일</span>
      </label>
    </div>

    <template v-for="field in (['account', 'condition', 'squads'] as const)" :key="field">
      <div v-if="field !== 'squads' || mode === 'compare'" class="compute__row">
        <span class="compute__label">{{ FIELDS[field].label }}</span>
        <input
          v-model="paths[field]"
          class="compute__path"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :placeholder="FIELDS[field].placeholder"
          :aria-label="FIELDS[field].placeholder"
          :disabled="computing"
          :data-testid="`${field}-path`"
          @keydown.enter.prevent="run"
        />
        <button
          class="compute__pick"
          type="button"
          :title="FIELDS[field].title"
          :disabled="computing"
          :data-testid="`pick-${field}`"
          @click="pick(field)"
        >
          고르기
        </button>
      </div>
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
            :disabled="computing"
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
            :disabled="computing"
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
            :disabled="computing"
            aria-label="전체 시뮬 횟수의 상한"
            data-testid="suggest-budget"
          />
        </label>
        <label class="compute__check" title="상위 조합의 배치 순서도 바꿔 가며 계산한다">
          <input v-model="refine" type="checkbox" :disabled="computing" data-testid="suggest-refine" />
          배치 탐색
        </label>
      </template>
      <span class="compute__spacer"></span>
      <button class="compute__run" type="button" :disabled="computing || disabled" data-testid="run-compute" @click="run">
        {{ computing ? '계산 중…' : mode === 'suggest' ? '추천 실행' : '비교 실행' }}
      </button>
    </div>

    <p v-if="computing" class="compute__progress" role="status" aria-live="polite" data-testid="compute-progress">
      <template v-if="progress">
        엔진 계산 중 — {{ stageLabel(stage) }}{{ progress.done }}/{{ progress.total }}건 끝남
        <span
          class="compute__bar"
          role="progressbar"
          aria-valuemin="0"
          :aria-valuemax="progress.total"
          :aria-valuenow="progress.done"
        >
          <span class="compute__bar-fill" :style="{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }"></span>
        </span>
      </template>
      <template v-else-if="stage">{{ stageLabel(stage) }}계산 준비 중</template>
      <template v-else>입력 파일과 엔진 데이터를 읽는 중</template>
      <!-- 예산은 엔진에 맡긴 요청 수로 센다(캐시에서 채운 요청도 센다) — 계산 코드가 단계마다 알려 준 값이다. -->
      <span v-if="stage" class="compute__budget" data-testid="compute-budget">
        예산 {{ stage.budget }}건 중 {{ stage.used + stage.requests }}건
      </span>
      <span class="compute__elapsed" data-testid="compute-elapsed">{{ elapsed }}초</span>
    </p>
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

.compute__label {
  width: 28px;
  color: var(--muted);
}

.compute__path {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
}

.compute__pick,
.compute__run {
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.compute__run {
  border-color: var(--gold);
  background: rgba(255, 196, 64, 0.16);
  font-weight: 700;
}

.compute__pick:disabled,
.compute__run:disabled {
  opacity: 0.6;
  cursor: default;
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

.compute__budget {
  color: var(--muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.compute__spacer {
  flex: 1;
}

.compute__progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0;
  color: var(--accent);
}

.compute__bar {
  flex: 1;
  min-width: 48px;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}

.compute__bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.compute__elapsed {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
</style>
