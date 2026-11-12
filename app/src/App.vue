<script setup lang="ts">
// 오버레이 화면: 상태 표시, 게임 창(상태·화면 저장·붙이기), 계산 실행(추천·비교), 결과 파일 불러오기, 순위.
// 계산은 루트의 src/core가 하고(ComputePanel → lib/compute.ts), 이미 만든 비교 결과 파일도 읽어 보여 준다.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import ComputePanel from './components/ComputePanel.vue';
import GamePanel from './components/GamePanel.vue';
import OverlayStatus from './components/OverlayStatus.vue';
import ReportView from './components/ReportView.vue';
import { errorMessage, loadReport, onOverlayState, overlayStatus, quitApp, startupReportPath } from './lib/backend';
import type { CompareReport, OverlaySnapshot } from './types';

/** 마지막으로 불러온 파일 경로를 기억하는 localStorage 키. */
const LAST_PATH_KEY = 'nikke-companion.report-path';

const overlay = ref<OverlaySnapshot | null>(null);
const path = ref('');
const report = ref<CompareReport | null>(null);
const loadedPath = ref('');
const error = ref('');
const loading = ref(false);
/** 엔진 계산이 도는 중. 그동안 결과 파일을 불러오지 않는다(끝난 계산이 불러온 결과를 덮지 않게). */
const computing = ref(false);

let unlisten: (() => void) | null = null;
let unmounted = false;
/** 늦게 끝난 이전 요청이 나중 요청의 결과를 덮지 않게 한다. */
let loadSeq = 0;

function remembered(): string {
  try {
    return localStorage.getItem(LAST_PATH_KEY) ?? '';
  } catch {
    return '';
  }
}

function remember(value: string): void {
  try {
    localStorage.setItem(LAST_PATH_KEY, value);
  } catch {
    // 저장하지 못해도 동작에는 지장이 없다.
  }
}

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
    remember(target);
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

async function quit(): Promise<void> {
  try {
    await quitApp();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

onMounted(async () => {
  try {
    const stop = await onOverlayState((state) => {
      overlay.value = state;
    });
    if (unmounted) stop();
    else unlisten = stop;
    overlay.value = await overlayStatus();
  } catch (e) {
    error.value = `오버레이 상태를 확인하지 못했다: ${errorMessage(e)}`;
  }

  // 처음 보일 경로: 실행 인자 → 마지막으로 불러온 파일 → (개발 실행에서만) 샘플 결과
  let initial = '';
  try {
    initial = (await startupReportPath()) ?? '';
  } catch {
    initial = '';
  }
  initial = initial || remembered() || __DEV_SAMPLE_REPORT__;
  if (initial && !path.value) {
    path.value = initial;
    await load();
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  unlisten?.();
  unlisten = null;
});
</script>

<template>
  <div class="overlay" :class="{ 'overlay--passthrough': overlay?.click_through }" data-testid="overlay">
    <header class="titlebar" data-tauri-drag-region>
      <span class="titlebar__title" data-tauri-drag-region>니케 컴패니언</span>
      <button class="titlebar__close" type="button" title="끝내기" aria-label="끝내기" data-testid="quit" @click="quit">
        ×
      </button>
    </header>

    <OverlayStatus :state="overlay" />

    <GamePanel />

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
      <button class="loader__button" type="submit" :disabled="loading || computing" data-testid="load-report">
        {{ loading ? '읽는 중…' : '불러오기' }}
      </button>
    </form>

    <p v-if="error" class="error" role="alert" data-testid="error">{{ error }}</p>

    <main class="content">
      <ReportView v-if="report" :report="report" />
      <p v-else-if="!loading && !computing && !error" class="hint" data-testid="hint">
        계정 파일과 전투 조건 파일을 골라 추천이나 비교를 실행한다. 이미 만든 비교 결과 파일(JSON)은 아래 칸에 경로를
        넣어 불러온다 — 결과 파일은 저장소 루트에서 <code>node src/cli.mjs compare … --json 결과.json</code>으로 만든다.
      </p>
    </main>
  </div>
</template>

<style scoped>
.overlay {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 8px 10px 10px;
  border: 2px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}

/* 클릭 통과 중: 테두리 색을 바꾸고 바탕을 옅게 해 아래 화면이 더 보이게 한다. */
.overlay--passthrough {
  border-color: var(--passthrough);
  background: rgba(16, 19, 28, 0.6);
}

.titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: move;
  user-select: none;
}

.titlebar__title {
  flex: 1;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.titlebar__close {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  line-height: 1;
  cursor: pointer;
}

.titlebar__close:hover {
  border-color: var(--danger);
  color: var(--danger);
}

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

.loader__button {
  padding: 4px 12px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: rgba(124, 196, 255, 0.16);
  cursor: pointer;
  white-space: nowrap;
}

.loader__button:disabled {
  opacity: 0.6;
  cursor: default;
}

.error {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  color: var(--danger);
  overflow-wrap: anywhere;
}

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

.hint {
  margin: 0;
  color: var(--muted);
}

.hint code {
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
