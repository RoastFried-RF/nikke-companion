<script setup lang="ts">
// 게임 창 칸: 게임 창 상태(찾음/없음/최소화, 크기), 지금 화면 저장, 오버레이를 게임 창에 붙이기.
// 게임 창을 찾고 화면을 찍는 일은 Rust가 한다(게임은 읽기만 한다). 저장할 폴더도 Rust가 정한다.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  captureGame,
  errorMessage,
  gameWindowStatus,
  onGameCapture,
  onGameWindow,
  setFollowGame,
} from '../lib/backend';
import type { CaptureRecord, GameSnapshot, GameWindowState } from '../types';

/** 붙이기를 켜 두었는지 기억하는 localStorage 키. */
const FOLLOW_KEY = 'nikke-companion.follow-game';

const STATE_LABEL: Record<GameWindowState, string> = {
  found: '찾음',
  minimized: '최소화됨',
  launcher_only: '없음 (런처만 떠 있다)',
  missing: '없음',
  unavailable: '확인 불가',
};

const game = ref<GameSnapshot | null>(null);
/** 상태를 읽지 못했거나 붙이기를 바꾸지 못했을 때의 오류. */
const problem = ref('');
const saving = ref(false);
const saved = ref<CaptureRecord | null>(null);
const captureError = ref('');

const unlisten: Array<() => void> = [];
let unmounted = false;

const found = computed(() => game.value?.state === 'found');
const size = computed(() => {
  const client = game.value?.window?.client;
  return client && game.value?.state === 'found' ? `${client.width}×${client.height}` : '';
});
const scale = computed(() => {
  const factor = game.value?.window?.scale_factor;
  return factor && game.value?.state === 'found' ? `배율 ${Math.round(factor * 100)}%` : '';
});

function rememberedFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberFollow(on: boolean): void {
  try {
    localStorage.setItem(FOLLOW_KEY, on ? '1' : '0');
  } catch {
    // 기억하지 못해도 동작에는 지장이 없다.
  }
}

function showCapture(record: CaptureRecord | null, error: string | null): void {
  saved.value = record;
  captureError.value = record ? '' : (error ?? '저장하지 못했다.');
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    showCapture(await captureGame(), null);
  } catch (e) {
    showCapture(null, errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function follow(on: boolean): Promise<boolean> {
  problem.value = '';
  try {
    game.value = await setFollowGame(on);
    rememberFollow(on);
    return true;
  } catch (e) {
    problem.value = `붙이기를 바꾸지 못했다: ${errorMessage(e)}`;
    return false;
  }
}

async function onFollowChange(event: Event): Promise<void> {
  const box = event.target as HTMLInputElement;
  // 바꾸지 못했으면 체크 표시를 실제 상태로 되돌린다.
  if (!(await follow(box.checked))) box.checked = game.value?.follow ?? false;
}

onMounted(async () => {
  try {
    const stops = await Promise.all([
      onGameWindow((snapshot) => {
        game.value = snapshot;
      }),
      onGameCapture((outcome) => showCapture(outcome.capture, outcome.error)),
    ]);
    if (unmounted) stops.forEach((stop) => stop());
    else unlisten.push(...stops);
    game.value = await gameWindowStatus();
    // 지난번에 붙이기를 켜 두었으면 다시 켠다.
    if (rememberedFollow() && !game.value.follow) await follow(true);
  } catch (e) {
    problem.value = `게임 창 상태를 확인하지 못했다: ${errorMessage(e)}`;
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  unlisten.splice(0).forEach((stop) => stop());
});
</script>

<template>
  <section class="game" aria-label="게임 창" data-testid="game-panel">
    <div class="game__row">
      <span class="game__dot" :class="{ 'game__dot--on': found }" aria-hidden="true"></span>
      <span v-if="game === null" class="game__state" data-testid="game-state">게임 창 확인 중…</span>
      <template v-else>
        <span class="game__state" :title="game.message" data-testid="game-state">
          게임 창: <strong>{{ STATE_LABEL[game.state] }}</strong>
        </span>
        <span v-if="size" class="game__size" data-testid="game-size">{{ size }}</span>
        <span v-if="scale" class="game__sub" data-testid="game-scale">{{ scale }}</span>
        <span v-if="found && game.window?.foreground" class="game__sub" data-testid="game-foreground">전경</span>
      </template>
    </div>
    <p v-if="game && !found" class="game__message" data-testid="game-message">{{ game.message }}</p>

    <div class="game__row">
      <button
        class="game__save"
        type="button"
        :disabled="!found || saving"
        title="지금 게임 화면을 PNG로 저장한다"
        data-testid="capture-game"
        @click="save"
      >
        {{ saving ? '저장 중…' : '화면 저장' }}
      </button>
      <span class="game__sub"><kbd>Alt+Shift+S</kbd></span>
      <span class="game__spacer"></span>
      <label class="game__follow" title="오버레이를 게임 창의 오른쪽 위 안쪽에 두고 게임 창을 따라가게 한다. 게임 창은 건드리지 않는다">
        <input
          type="checkbox"
          :checked="game?.follow ?? false"
          :disabled="game === null"
          data-testid="follow-game"
          @change="onFollowChange"
        />
        게임 창에 붙이기
      </label>
    </div>

    <p v-if="saved" class="game__saved" role="status" aria-live="polite" data-testid="capture-saved">
      저장했다 ({{ saved.width }}×{{ saved.height }}): <span class="game__path">{{ saved.path }}</span>
    </p>
    <p v-if="captureError" class="game__error" role="alert" data-testid="capture-error">{{ captureError }}</p>
    <p v-if="problem" class="game__error" role="alert" data-testid="game-error">{{ problem }}</p>
  </section>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-strong);
  font-size: 12px;
}

.game__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.game__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}

.game__dot--on {
  background: #6ee7a0;
}

.game__size {
  font-variant-numeric: tabular-nums;
}

.game__sub,
.game__message {
  color: var(--muted);
}

.game__message,
.game__saved,
.game__error {
  margin: 0;
  overflow-wrap: anywhere;
}

.game__spacer {
  flex: 1;
}

.game__save {
  padding: 3px 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: rgba(124, 196, 255, 0.16);
  cursor: pointer;
  white-space: nowrap;
}

.game__save:disabled {
  opacity: 0.6;
  cursor: default;
}

.game__follow {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.game__saved {
  color: #6ee7a0;
}

.game__path {
  color: var(--text);
  user-select: text;
}

.game__error {
  padding: 4px 8px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  color: var(--danger);
}

kbd {
  padding: 0 4px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font: inherit;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.08);
}
</style>
