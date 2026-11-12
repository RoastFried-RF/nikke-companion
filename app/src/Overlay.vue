<script setup lang="ts">
// 오버레이 창(게임 위에 뜨는 작은 위젯 — P-028)의 틀. 그림은 views/OverlayWidget.vue가 그리고, 여기서는 잇기만 한다:
//   - 보이는 것은 데스크톱 앱 창이 저장한 마지막 요격전 추천이다(lib/shared.ts — 앱 창이 새로 계산하면 Rust가 알리고 다시 읽는다).
//   - 자동 추적이 켜져 있으면 게임에서 보고 있는 보스를 따라 고른다(보기만 한다 — 켜고 끄는 것은 앱 창의 설정이다).
//   - 모양(접힘·한 줄 카드·펼침)·핀·쉬는 중은 Rust가 쥐고 있다(lib/widget.ts). 누르거나 단축키(Alt+Shift+M)로 바뀌고,
//     이상 개체 화면을 떠나면 Rust의 규칙이 잠시 뒤 접거나 쉬게 한다.
//   - 창은 위젯만큼만 크다: 위젯의 크기를 재서 Rust에 알린다(overlayFit) — 빈 투명 영역이 게임 클릭을 가로막지 않게.
// 이 창은 결과만 보여 준다 — 계산 실행·계정 받기·설정은 데스크톱 앱 창(App.vue)에서 한다(권한도 그렇게 나뉘어 있다:
// src-tauri/capabilities/overlay.json). 앱을 끝내지도 않는다(숨기기만 있다 — 앱 창을 닫으면 앱이 끝난다).
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue';
import { useActivity } from './lib/activity';
import { summaryOf, weakNamesOf } from './lib/bossView';
import { errorMessage, onOverlayState, overlayFit, overlayStatus, showAppWindow, startOverlayDrag } from './lib/backend';
import { ANOMALY_BUNDLE } from './lib/builtin';
import { recall, remember } from './lib/remember';
import { findBoss, LAST_BOSS, provideScreenTrack } from './lib/screenTrack';
import { provideShared } from './lib/shared';
import { useNikkeCatalog } from './lib/useNikkeCatalog';
import { DEFAULT_PREFS, fitRequest, useWidget } from './lib/widget';
import type { InterceptBoss, OverlayShape, OverlaySnapshot } from './types';
import OverlayWidget from './views/OverlayWidget.vue';

/** 기억해 둔 보스가 바뀌었다는 알림(다른 창이 골랐다)의 열쇠 — lib/remember.ts의 머리말과 같다. */
const LAST_BOSS_KEY = `nikke-companion.${LAST_BOSS}`;
/** 이만큼 움직인 뒤에야 끌기로 본다(논리 픽셀) — 그 전에 놓으면 누른 것이다. */
const DRAG_THRESHOLD = 4;

const overlay = ref<OverlaySnapshot | null>(null);
/** 오버레이 상태·앱 열기의 오류. */
const error = ref('');

const shared = provideShared();
// 자동 추적은 보기만 한다: 켜고 끄는 것은 앱 창의 설정이고, 여기서는 Rust가 알려 주는 보스를 따라 고를 뿐이다.
// 이 창에는 화면이 하나뿐이라 옮길 곳이 없다.
const track = provideScreenTrack({ computing: () => false, onIntercept: () => true, moveToIntercept: () => {} }, { passive: true });
const widget = useWidget();
const activity = useActivity();
const { catalog, info } = useNikkeCatalog();

const report = computed(() => shared.intercept.value);
const shape = computed<OverlayShape>(() => widget.snapshot.value?.shape ?? DEFAULT_PREFS.default_shape);
const prefs = computed(() => widget.snapshot.value?.prefs ?? DEFAULT_PREFS);

/** 고른 보스(id). 손으로 고르거나(펼침의 보스 고르기·앱 창) 자동 추적을 따라가며 바뀐다. */
const picked = ref(recall(LAST_BOSS));
/** 게임에서 보고 있지만 지금 결과에 없는 보스 — 앱 창에서 계산하라고 알린다. */
const unmatched = ref<{ id: string; name: string; element: string | null } | null>(null);

/** 자동 추적이 따라간 보스를 고른다. 결과에 없으면 고른 보스는 그대로 두고 「없다」고 알린다. */
function follow(): void {
  const target = track.enabled.value ? track.target.value : null;
  if (!target) {
    unmatched.value = null;
    return;
  }
  const found = report.value ? findBoss(report.value.bosses ?? [], target) : undefined;
  if (found) {
    picked.value = found.id;
    unmatched.value = null;
  } else {
    const known = ANOMALY_BUNDLE.bosses.find((b) => b.id === target.id);
    unmatched.value = { id: target.id, name: target.name, element: known?.enemy?.code ?? null };
  }
}
watch([() => track.target.value?.seq, () => track.enabled.value, report], follow, { immediate: true });

const boss = computed<InterceptBoss | null>(() => {
  if (unmatched.value) return null;
  const bosses = report.value?.bosses ?? [];
  return bosses.find((b) => b.id === picked.value) ?? bosses[0] ?? null;
});

function pick(id: string): void {
  picked.value = id;
  unmatched.value = null;
  remember(LAST_BOSS, id);
}

/** 앱 창에서 보스를 고르면(같은 저장소를 쓴다) 따라 바꾼다. */
function onStorage(event: StorageEvent): void {
  if (event.key === LAST_BOSS_KEY && event.newValue) {
    picked.value = event.newValue;
    unmatched.value = null;
  }
}

const weak = computed(() => weakNamesOf(boss.value, info));
const summary = computed(() => summaryOf(boss.value, catalog.value !== null, info));
const problems = computed(() => [error.value, shared.interceptProblem.value, widget.problem.value, widget.snapshot.value?.problem ?? ''].filter(Boolean));

async function openApp(): Promise<void> {
  try {
    await showAppWindow();
    error.value = '';
  } catch (e) {
    error.value = `앱 창을 열지 못했다: ${errorMessage(e)}`;
  }
}

// ── 창 크기를 위젯에 맞춘다 ──
const root = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
/** 마지막으로 잰 크기(알려야 할 것)와 Rust가 받아들인 크기. */
let wanted: { width: number; height: number } | null = null;
let fitted = '';
/** 알림이 가는 중인가. 한 번에 하나만 보낸다 — 겹쳐 보내면 먼저 잰 크기가 나중에 닿아 창이 옛 크기로 남을 수 있다. */
let fitting = false;

const sizeKey = (size: { width: number; height: number }) => `${size.width}x${size.height}`;

/** 잰 크기를 Rust에 알린다 — 가는 동안 크기가 또 바뀌었으면 이어서 마지막 것을 알린다. 못 알렸으면 다음에 잴 때 다시 알린다. */
async function sendFit(): Promise<void> {
  fitting = true;
  try {
    while (wanted && sizeKey(wanted) !== fitted) {
      const next = wanted;
      await overlayFit(next.width, next.height);
      fitted = sizeKey(next);
    }
  } catch {
    // 맞추지 못했다: 받아들인 크기는 그대로 두고, 다음에 다시 알린다.
  } finally {
    fitting = false;
  }
}

/** 위젯의 크기를 재서 Rust에 알린다(달라졌을 때만). 잴 수 없으면(아직 그려지지 않았다) 아무것도 하지 않는다. */
function fit(): void {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const size = fitRequest(rect.width, rect.height);
  if (!size) return;
  wanted = size;
  if (!fitting && sizeKey(size) !== fitted) void sendFit();
}

// ── 끌어서 옮긴다: 위젯 어디든(단추 위에서도) 누른 채 조금 움직이면 창을 끈다. 움직이지 않고 놓으면 그냥 누른 것이다. ──
let press: { x: number; y: number } | null = null;

function onMouseDown(event: MouseEvent): void {
  press = event.button === 0 ? { x: event.screenX, y: event.screenY } : null;
}

function onMouseMove(event: MouseEvent): void {
  if (!press) return;
  // 단추를 뗐다(창 밖에서 놓았다): 끌기가 아니다.
  if ((event.buttons & 1) === 0) {
    press = null;
    return;
  }
  if (Math.abs(event.screenX - press.x) < DRAG_THRESHOLD && Math.abs(event.screenY - press.y) < DRAG_THRESHOLD) return;
  press = null;
  startOverlayDrag().catch(() => {
    // 끌지 못해도 손잡이로 옮길 수 있다.
  });
}

function onMouseUp(): void {
  press = null;
}

let unlisten: (() => void) | null = null;
let unmounted = false;

onMounted(async () => {
  window.addEventListener('storage', onStorage);
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(() => fit());
    observer.observe(root.value);
  }
  fit();
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

// 모양·내용·배율이 바뀌어 다시 그렸으면 창 크기도 다시 맞춘다.
onUpdated(fit);

onBeforeUnmount(() => {
  unmounted = true;
  unlisten?.();
  unlisten = null;
  observer?.disconnect();
  observer = null;
  window.removeEventListener('storage', onStorage);
});
</script>

<template>
  <div
    ref="root"
    class="overlay"
    :class="{ 'overlay--passthrough': overlay?.click_through }"
    :style="{ zoom: prefs.scale_percent / 100, opacity: prefs.opacity_percent / 100 }"
    :data-scale="prefs.scale_percent"
    :data-opacity="prefs.opacity_percent"
    data-testid="overlay"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <OverlayWidget
      :shape="shape"
      :ready="shared.ready.value"
      :report="report"
      :boss="boss"
      :missing="unmatched"
      :account-name="shared.accountName.value"
      :saved-at="shared.snapshot.value?.intercept_saved_at ?? null"
      :info="info"
      :weak="weak"
      :summary="summary"
      :activity="activity"
      :pinned="widget.snapshot.value?.pinned ?? false"
      :click-through="overlay?.click_through ?? false"
      :problems="problems"
      @shape="widget.setShape"
      @pin="widget.setPinned"
      @open-app="openApp"
      @hide="widget.hide"
      @pick="pick"
    />
  </div>
</template>

<style scoped>
/* 창은 이 상자만큼만 크다(lib.rs의 overlay_fit) — 상자의 크기는 창의 크기와 무관하게 내용이 정한다. */
.overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: max-content;
  color: var(--nk-text);
}
</style>
