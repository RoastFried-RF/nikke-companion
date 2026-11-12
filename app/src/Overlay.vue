<script setup lang="ts">
// 오버레이 창(게임 위에 뜨는 작은 창)의 틀: 제목 줄, 오버레이 상태, 마지막 요격전 추천 결과.
// 이 창은 결과만 보여 준다 — 계산 실행·계정 받기·설정은 데스크톱 앱 창(App.vue)에서 한다(권한도 그렇게 나뉘어 있다:
// src-tauri/capabilities/overlay.json). 결과는 두 창이 함께 보는 자리(lib/shared.ts)에서 온다: 앱 창이 계산을 끝내면
// Rust가 알리고, 이 창이 디스크의 결과를 다시 읽는다. 자동 추적이 켜져 있으면 게임에서 보고 있는 보스를 따라 고른다.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import OverlayStatus from './components/OverlayStatus.vue';
import { errorMessage, onOverlayState, overlayStatus, quitApp, showAppWindow } from './lib/backend';
import { findBoss, provideScreenTrack } from './lib/screenTrack';
import { provideShared } from './lib/shared';
import type { OverlaySnapshot } from './types';
import EmptyState from './ui/EmptyState.vue';
import InterceptResult from './views/InterceptResult.vue';

const overlay = ref<OverlaySnapshot | null>(null);
/** 오버레이 상태·끝내기·앱 열기의 오류. */
const error = ref('');

const shared = provideShared();
// 자동 추적은 보기만 한다: 켜고 끄는 것은 앱 창의 설정이고, 여기서는 Rust가 알려 주는 보스를 따라 고를 뿐이다.
// 이 창에는 화면이 하나뿐이라 옮길 곳이 없다.
const track = provideScreenTrack({ computing: () => false, onIntercept: () => true, moveToIntercept: () => {} }, { passive: true });

const report = computed(() => shared.intercept.value);
/** 게임에서 보고 있는 보스가 지금 결과에 없다(또는 결과가 아직 없다) — 앱 창에서 계산하라고 알린다. */
const missing = computed(() => {
  const target = track.enabled.value ? track.target.value : null;
  if (!target) return null;
  if (!report.value) return target.name;
  return findBoss(report.value.bosses ?? [], target) ? null : target.name;
});

let unlisten: (() => void) | null = null;
let unmounted = false;

async function quit(): Promise<void> {
  try {
    await quitApp();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function openApp(): Promise<void> {
  try {
    await showAppWindow();
    error.value = '';
  } catch (e) {
    error.value = `앱 창을 열지 못했다: ${errorMessage(e)}`;
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
      <button class="titlebar__open" type="button" title="계산과 설정은 앱 창에서 한다" data-testid="open-app" @click="openApp">앱 열기</button>
      <button class="titlebar__close" type="button" title="끝내기" aria-label="끝내기" data-testid="quit" @click="quit">×</button>
    </header>

    <OverlayStatus :state="overlay" />

    <p v-if="error" class="screen__error" role="alert" data-testid="error">{{ error }}</p>
    <p v-if="shared.interceptProblem.value" class="screen__error" role="alert" data-testid="result-problem">{{ shared.interceptProblem.value }}</p>

    <p v-if="missing" class="overlay__note" role="status" data-testid="track-need-run">
      게임에서 보고 있는 보스: <strong>{{ missing }}</strong> — 아직 이 보스의 추천이 없다. 앱 창의 요격전에서 계산한다.
    </p>

    <main class="overlay__content">
      <InterceptResult v-if="report" :report="report" compact />
      <EmptyState
        v-else-if="shared.ready.value"
        title="아직 요격전 추천이 없다"
        hint="앱 창의 요격전에서 추천을 계산하면 여기에 보인다."
        action="앱 열기"
        data-testid="overlay-empty"
        @action="openApp"
      />
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
  /* 정보 영역은 불투명하다 — 게임 화면이 비쳐 글자가 묻히지 않게(docs/ui-redesign.md §3). */
  background: var(--nk-bg);
}

/* 클릭 통과 중: 테두리 색을 바꾸고 바탕을 옅게 해 아래 화면이 더 보이게 한다. */
.overlay--passthrough {
  border-color: var(--passthrough);
  background: var(--nk-scrim);
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

.titlebar__open {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
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

.overlay__note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.overlay__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
