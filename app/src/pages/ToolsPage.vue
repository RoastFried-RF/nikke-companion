<script setup lang="ts">
// 편성 도구(데스크톱 앱): 추천 · 덱 빌더 · 육성 효율 · 비교 · 성장.
//   추천 — 기본 계정의 니케로 총딜이 큰 편성을 찾는다(내장 전투 조건). 단추 하나 + 정밀도.
//   덱 빌더 — 초상화로 다섯 자리를 직접 짜고 바로 계산한다(views/DeckBuilder.vue — P-030).
//   육성 효율 — 무엇을 올리면 딜이 얼마나 오르는지(효율표), 오버로드 옵션·큐브 바꿔 보기(views/GrowthLab.vue — P-031).
//   비교 · 성장 — 견줄 편성과 육성 선택지를 직접 골라야 하는 계산이다. 고르는 곳은 설정의 「고급」이고,
//                 거기서 계산하거나 불러온 결과가 여기에 새 부품(니케 타일·딜 막대)으로 보인다.
// 계산은 루트의 suggestSquads(CLI의 `suggest`와 같은 함수)가 한다 — 화면에 계산 규칙을 다시 쓰지 않는다.
import { computed, ref, watch } from 'vue';
import { DEFAULT_CONDITION, DEFAULT_CONDITION_LABEL } from '../lib/builtin';
import { runSuggestWith } from '../lib/compute';
import { useEngineRun } from '../lib/engineRun';
import { RUN_SUGGEST, TOOL_TABS, useNav, type ToolTab } from '../lib/nav';
import { precisionOf, recallPrecision, rememberPrecision, SUGGEST_PRECISION, type PrecisionKey } from '../lib/precision';
import { recall, remember } from '../lib/remember';
import { useShared } from '../lib/shared';
import { useToolResults } from '../lib/toolResults';
import type { CompareReport } from '../types';
import EmptyState from '../ui/EmptyState.vue';
import ProgressPanel from '../ui/ProgressPanel.vue';
import DeckBuilder from '../views/DeckBuilder.vue';
import GrowthBoard from '../views/GrowthBoard.vue';
import GrowthLab from '../views/GrowthLab.vue';
import SquadBoard from '../views/SquadBoard.vue';

const PRECISION_KEY = 'tools.precision';
/** 자리 순서도 바꿔 볼지 기억하는 이름('off'면 끔). */
const ORDER_KEY = 'tools.order';

const shared = useShared();
const nav = useNav();
const results = useToolResults();
const engine = useEngineRun(RUN_SUGGEST);

/** 앱 밖에서(화면만 띄운 테스트) 쓰일 때의 탭. 앱 안에서는 탐색 상태(lib/nav.ts)의 것을 쓴다. */
const ownTab = ref<ToolTab>('suggest');
const tab = computed<ToolTab>(() => nav?.tool.value ?? ownTab.value);
/** 덱 빌더 탭을 한 번이라도 열었는가. 처음 열 때 만들고, 그 뒤에는 다른 탭을 봐도 남겨 둔다(숨기기만 한다). */
const deckSeen = ref(false);
/** 육성 효율 탭도 같다. */
const labSeen = ref(false);
watch(
  tab,
  (now) => {
    if (now === 'deck') deckSeen.value = true;
    if (now === 'efficiency') labSeen.value = true;
  },
  { immediate: true },
);
function openTab(next: ToolTab): void {
  if (nav) nav.openTool(next);
  else ownTab.value = next;
}

const precision = ref<PrecisionKey>(recallPrecision(PRECISION_KEY));
const tryOrder = ref(recall(ORDER_KEY) !== 'off');
const suggested = ref<CompareReport | null>(null);
const error = ref('');

const accountName = computed(() => shared?.accountName.value ?? null);
const compared = computed(() => results?.compare.value ?? null);
const growth = computed(() => results?.growth.value ?? null);

function choose(key: PrecisionKey): void {
  precision.value = key;
  rememberPrecision(PRECISION_KEY, key);
}

function onOrder(event: Event): void {
  tryOrder.value = (event.target as HTMLInputElement).checked;
  remember(ORDER_KEY, tryOrder.value ? 'on' : 'off');
}

/** 진행 패널의 값. 단계마다(편성 고르기 → 자리 순서) 건수가 새로 온다. */
const progress = computed(() => {
  const stage = engine.stage;
  const done = (stage?.used ?? 0) + (engine.progress?.done ?? 0);
  return {
    title: stage?.stage === 2 ? '자리 순서를 바꿔 보는 중' : '편성을 견줘 보는 중',
    detail: stage ? `${stage.stage}/${stage.stages}단계` : '',
    done,
    total: stage ? Math.max(stage.budget, done) : 0,
  };
});

async function run(): Promise<void> {
  if (!shared) return;
  const budget = precisionOf(SUGGEST_PRECISION, precision.value).budget;
  const refine = tryOrder.value;
  await engine.run<CompareReport>(
    async (deps) => {
      const read = await shared.loadAccount();
      return runSuggestWith({ account: read.account, condition: DEFAULT_CONDITION, budget, refine }, deps);
    },
    {
      start: () => {
        error.value = '';
      },
      done: (report) => {
        suggested.value = report;
      },
      // 실패해도 앞서 보이던 추천은 그대로 둔다.
      fail: (message) => {
        error.value = message;
      },
    },
  );
}
</script>

<template>
  <div class="nk-page" data-testid="page-tools">
    <header class="nk-head">
      <h1 class="nk-title">편성 도구</h1>
      <div class="nk-seg" role="tablist" aria-label="편성 도구">
        <button
          v-for="t in TOOL_TABS"
          :key="t.key"
          type="button"
          role="tab"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': tab === t.key }"
          :aria-selected="tab === t.key"
          :data-testid="`tool-${t.key}`"
          @click="openTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>
    </header>

    <!-- 추천 ─────────────────────────────────────────────────────────────── -->
    <template v-if="tab === 'suggest'">
      <EmptyState
        v-if="(shared?.ready.value ?? true) && !accountName"
        title="아직 계정을 연결하지 않았다"
        hint="계정을 연결하면 보유 니케로 총딜이 큰 편성을 찾아 준다."
        action="계정 연결하기"
        data-testid="need-account"
        @action="nav?.openSettings('account')"
      />
      <section v-else class="nk-card" aria-label="편성 추천" data-testid="suggest-controls">
        <div class="nk-row">
          <span class="nk-muted" data-testid="account-line">계정 <strong>{{ accountName }}</strong> · 상대 {{ DEFAULT_CONDITION_LABEL }}</span>
          <span class="nk-spacer"></span>
          <div class="nk-seg" role="radiogroup" aria-label="정밀도">
            <button
              v-for="choice in SUGGEST_PRECISION"
              :key="choice.key"
              type="button"
              role="radio"
              class="nk-seg__item"
              :class="{ 'nk-seg__item--on': precision === choice.key }"
              :aria-checked="precision === choice.key"
              :title="choice.hint"
              :disabled="engine.computing"
              :data-testid="`precision-${choice.key}`"
              @click="choose(choice.key)"
            >
              {{ choice.label }}
              <span class="nk-seg__sub">{{ choice.time }}</span>
            </button>
          </div>
          <label class="tools__check" title="같은 다섯 명이라도 자리 순서에 따라 총딜이 달라진다 — 상위 편성의 자리 순서를 바꿔 가며 견준다">
            <input type="checkbox" :checked="tryOrder" :disabled="engine.computing" data-testid="suggest-order" @change="onOrder" />
            자리 순서도 바꿔 본다
          </label>
          <button
            type="button"
            class="nk-btn nk-btn--primary"
            :disabled="engine.computing || engine.busyElsewhere"
            :title="engine.busyElsewhere ? '다른 화면에서 계산이 돌고 있다 — 끝난 뒤에 누른다' : undefined"
            data-testid="run-suggest"
            @click="run"
          >
            {{ suggested ? '다시 추천' : '편성 추천' }}
          </button>
        </div>
        <p v-if="engine.busyElsewhere" class="nk-muted" data-testid="busy-elsewhere">다른 화면에서 계산이 돌고 있다. 끝나면 여기서 계산할 수 있다.</p>
      </section>

      <ProgressPanel
        v-if="engine.computing"
        :title="progress.title"
        :detail="progress.detail"
        :done="progress.done"
        :total="progress.total"
        :elapsed-ms="engine.elapsed * 1000"
        :stopping="engine.stopping"
        @stop="engine.stop"
      />
      <p v-else-if="engine.stopped" class="nk-note" role="status" data-testid="stopped-note">계산을 중단했다. 앞서 보이던 추천은 그대로다.</p>

      <p v-if="error" class="nk-error" role="alert" data-testid="error">
        <strong>편성을 추천하지 못했다.</strong> {{ error }} 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.
      </p>

      <template v-if="suggested">
        <p v-if="engine.computing" class="nk-muted" data-testid="stale-note">아래는 이전 추천이다 — 새 계산이 끝나면 바뀐다.</p>
        <SquadBoard :report="suggested" />
      </template>
    </template>

    <!-- 덱 빌더 ───────────────────────────────────────────────────────────── -->
    <!-- 탭을 옮겨도 짜던 편성과 결과가 남게 숨기기만 한다(계산이 도는 동안 다른 탭을 봐도 끊기지 않는다). -->
    <DeckBuilder v-if="deckSeen" v-show="tab === 'deck'" />

    <!-- 육성 효율 ─────────────────────────────────────────────────────────── -->
    <!-- 덱 빌더처럼 숨기기만 한다(계산이 도는 동안 다른 탭을 봐도 끊기지 않고, 바꿔 보던 옵션이 남는다). -->
    <GrowthLab v-if="labSeen" v-show="tab === 'efficiency'" />

    <!-- 비교 ─────────────────────────────────────────────────────────────── -->
    <template v-if="tab === 'compare'">
      <SquadBoard v-if="compared" :report="compared" />
      <EmptyState
        v-else
        title="견줄 편성을 아직 고르지 않았다"
        hint="비교는 견줄 편성을 직접 골라야 한다. 설정의 고급에서 편성을 골라 계산하면 결과가 여기에 보인다."
        action="고급 설정 열기"
        data-testid="need-compare"
        @action="nav?.openAdvanced('compare')"
      />
    </template>

    <!-- 성장 ─────────────────────────────────────────────────────────────── -->
    <template v-if="tab === 'growth'">
      <GrowthBoard v-if="growth" :report="growth" />
      <EmptyState
        v-else
        title="견줄 육성 선택지를 아직 고르지 않았다"
        hint="성장 비교는 기준 편성과 육성 선택지를 직접 골라야 한다. 설정의 고급에서 골라 계산하면 결과가 여기에 보인다."
        action="고급 설정 열기"
        data-testid="need-growth"
        @action="nav?.openAdvanced('growth')"
      />
    </template>
  </div>
</template>

<style scoped>
.tools__check {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-2);
  cursor: pointer;
}
</style>
