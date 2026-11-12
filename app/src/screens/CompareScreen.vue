<script setup lang="ts">
// 추천·비교 화면: 계산 실행(추천·비교), 비교 결과 파일 불러오기, 순위.
// 계산은 루트의 src/core가 하고(ComputePanel → lib/compute.ts), 이미 만든 비교 결과 파일도 읽어 보여 준다.
import { onMounted, ref, watch } from 'vue';
import ComputePanel from '../components/ComputePanel.vue';
import ReportView from '../components/ReportView.vue';
import { errorMessage, loadReport } from '../lib/backend';
import { recall, remember } from '../lib/remember';
import { useToolResults } from '../lib/toolResults';
import type { CompareReport } from '../types';

const props = defineProps<{
  /** 실행 인자로 받은 결과 파일 경로(없으면 빈 문자열). 기억해 둔 경로보다 먼저다. */
  startupPath?: string;
}>();

/** 마지막으로 불러온 파일 경로를 기억하는 이름. */
const LAST_PATH = 'report-path';

const path = ref('');
const report = ref<CompareReport | null>(null);
// 여기서 계산하거나 불러온 결과는 편성 도구의 비교 화면에도 올린다(새 부품으로 보인다). 치운 것은 올리지 않는다.
const results = useToolResults();
watch(report, (next) => {
  if (next && results) results.compare.value = next;
});
const loadedPath = ref('');
const error = ref('');
const loading = ref(false);
/** 엔진 계산이 도는 중. 그동안 결과 파일을 불러오지 않는다(끝난 계산이 불러온 결과를 덮지 않게). */
const computing = ref(false);

/** 늦게 끝난 이전 요청이 나중 요청의 결과를 덮지 않게 한다. */
let loadSeq = 0;

/** 계산을 시작할 때 보이던 결과. 계산을 중단하면 되돌린다 — 중단은 결과를 바꾸지 않는다. */
let beforeCompute: { report: CompareReport | null; loadedPath: string } | null = null;

function onComputeStart(): void {
  // 늦게 끝나는 파일 읽기가 계산 결과를 덮지 않게 한다. 앞서 보이던 순위도 치운다(새 계산의 결과로 오해하지 않게).
  loadSeq += 1;
  loading.value = false;
  computing.value = true;
  error.value = '';
  beforeCompute = { report: report.value, loadedPath: loadedPath.value };
  report.value = null;
  loadedPath.value = '';
}

function onComputeDone(computed: CompareReport): void {
  computing.value = false;
  beforeCompute = null;
  report.value = computed;
}

function onComputeFail(message: string): void {
  computing.value = false;
  beforeCompute = null;
  error.value = message;
}

/** 사용자가 계산을 중단했다. 오류가 아니다 — 계산 전에 보이던 결과를 그대로 다시 보인다. */
function onComputeCancel(): void {
  computing.value = false;
  report.value = beforeCompute?.report ?? null;
  loadedPath.value = beforeCompute?.loadedPath ?? '';
  beforeCompute = null;
}

async function load(): Promise<void> {
  if (computing.value) return;
  const target = path.value.trim();
  if (!target) {
    error.value = '비교 결과 파일 경로를 넣어야 한다.';
    return;
  }
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const loaded = await loadReport(target);
    if (seq !== loadSeq) return;
    report.value = loaded;
    loadedPath.value = target;
    remember(LAST_PATH, target);
  } catch (e) {
    if (seq !== loadSeq) return;
    // 읽지 못했으면 앞서 보이던 결과를 남겨 두지 않는다(다른 파일의 순위로 오해하지 않게).
    report.value = null;
    loadedPath.value = '';
    error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

onMounted(async () => {
  // 처음 보일 경로: 실행 인자 → 마지막으로 불러온 파일 → (개발 실행에서만) 샘플 결과
  const initial = props.startupPath || recall(LAST_PATH) || __DEV_SAMPLE_REPORT__;
  if (initial && !path.value) {
    path.value = initial;
    await load();
  }
});
</script>

<template>
  <div class="screen" data-testid="screen-compare">
    <ComputePanel :disabled="loading" @start="onComputeStart" @done="onComputeDone" @fail="onComputeFail" @cancel="onComputeCancel" />

    <form class="loader" @submit.prevent="load">
      <input
        v-model="path"
        class="loader__path"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="비교 결과 JSON 파일 경로"
        aria-label="비교 결과 JSON 파일 경로"
        data-testid="report-path"
      />
      <button class="panel__button" type="submit" :disabled="loading || computing" data-testid="load-report">
        {{ loading ? '읽는 중…' : '불러오기' }}
      </button>
    </form>

    <p v-if="error" class="screen__error" role="alert" data-testid="error">{{ error }}</p>

    <main class="screen__content">
      <ReportView v-if="report" :report="report" />
      <p v-else-if="!loading && !computing && !error" class="screen__hint" data-testid="hint">
        계정 파일과 전투 조건 파일을 골라 추천이나 비교를 실행한다. 이미 만든 비교 결과 파일(JSON)은 아래 칸에 경로를
        넣어 불러온다 — 결과 파일은 저장소 루트에서 <code>node src/cli.mjs compare … --json 결과.json</code>으로 만든다.
      </p>
    </main>
  </div>
</template>

<style scoped>
.loader {
  display: flex;
  gap: 6px;
}

.loader__path {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-strong);
}
</style>
