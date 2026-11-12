<script setup lang="ts">
// 오버레이 화면의 틀: 제목 줄, 오버레이 상태, 게임 창 칸, 탭(추천·비교 / 요격전 / 성장 / 티어 / 계정).
// 탭마다 화면 하나(src/screens)다. 탭을 옮겨도 화면의 상태(입력·결과·도는 계산)는 남는다(KeepAlive).
import { KeepAlive, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GamePanel from './components/GamePanel.vue';
import OverlayStatus from './components/OverlayStatus.vue';
import { provideAccountLink } from './lib/accountLink';
import { errorMessage, onOverlayState, overlayStatus, quitApp, startupReportPath } from './lib/backend';
import { provideEngineOwner } from './lib/engineRun';
import { provideExtensionLink } from './lib/extensionLink';
import { recall, remember } from './lib/remember';
import { provideScreenTrack } from './lib/screenTrack';
import AccountScreen from './screens/AccountScreen.vue';
import CompareScreen from './screens/CompareScreen.vue';
import GrowthScreen from './screens/GrowthScreen.vue';
import InterceptScreen from './screens/InterceptScreen.vue';
import TierScreen from './screens/TierScreen.vue';
import type { OverlaySnapshot } from './types';

/** 탭. `key`는 그 화면이 돌리는 계산의 이름이기도 하다(lib/engineRun.ts의 useEngineRun). */
const TABS = [
  { key: 'compare', label: '추천·비교' },
  { key: 'intercept', label: '요격전' },
  { key: 'growth', label: '성장' },
  { key: 'tier', label: '티어' },
  { key: 'account', label: '계정' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** 마지막으로 본 탭을 기억하는 이름. */
const LAST_TAB = 'tab';

const overlay = ref<OverlaySnapshot | null>(null);
/** 앱 전체의 오류(오버레이 상태·끝내기). 화면마다의 오류는 그 화면이 보인다. */
const error = ref('');
const tab = ref<TabKey>(TABS.find((t) => t.key === recall(LAST_TAB))?.key ?? 'compare');
/** 실행 인자로 받은 비교 결과 파일 경로. 있으면 추천·비교 탭이 먼저 보인다. */
const startupPath = ref('');
/** 실행 인자를 확인한 뒤에 화면을 그린다(어느 탭을 먼저 보일지 그때 정해진다). */
const ready = ref(false);
/** 지금 계산을 돌리는 탭(없으면 null). 계산은 한 번에 한 탭에서만 돈다. */
const computingTab = provideEngineOwner();
// 계정 화면이 저장한 계정 파일의 경로를 추천·비교, 요격전, 성장 화면의 계정 칸에 넣는 통로(lib/accountLink.ts).
provideAccountLink();

let unlisten: (() => void) | null = null;
let unmounted = false;

function select(key: TabKey): void {
  tab.value = key;
  remember(LAST_TAB, key);
}

// 요격전 화면 자동 추적: 게임에서 이상 개체 보스를 보고 있으면 그 보스의 추천을 보인다(스위치는 요격전 화면에 있다).
// 보스를 고르는 것은 요격전 화면이 하고, 여기서는 다른 탭을 보고 있을 때 요격전 탭으로 옮기기만 한다(끌 수 있다).
// 언제 옮기는지는 lib/screenTrack.ts의 규칙(tabMoveStep)이 정한다: 같은 인식이 이어지는 동안에는 다시 옮기지 않고,
// 어느 탭에서든 계산이 도는 동안에는 옮기지 않고 미뤄 뒀다가 계산이 끝나면 한 번 옮긴다. 여기서는 묻는 것에 답하고
// 시키는 대로 옮길 뿐이다.
const track = provideScreenTrack({
  computing: () => computingTab.value !== null,
  onIntercept: () => tab.value === 'intercept',
  moveToIntercept: () => select('intercept'),
});
// 계산이 시작·끝나거나 탭이 바뀌면 미뤄 둔 이동을 다시 보게 한다(계산이 끝났으면 그때 옮긴다).
watch([computingTab, tab], () => track.settle());

// 크롬 확장 연결: 이 PC의 크롬 확장이 쿠키를 넘기면(Rust의 수신부가 받는다 — 쿠키는 화면에 오지 않는다) 계정 탭을 열고,
// 계정 화면이 「계정 새로 받기」를 이어서 돌린다. 언제 여는지는 lib/extensionLink.ts의 규칙(arrivalStep)이 정한다:
// 계산이 도는 동안에는 옮기지 않고 미뤄 뒀다가 계산이 끝나면 한 번 옮긴다.
const extension = provideExtensionLink({
  computing: () => computingTab.value !== null,
  onAccount: () => tab.value === 'account',
  openAccount: () => select('account'),
});
watch([computingTab, tab], () => extension.settle());

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

  try {
    startupPath.value = (await startupReportPath()) ?? '';
  } catch {
    startupPath.value = '';
  }
  // 실행 인자는 비교 결과 파일이다 — 그 결과가 보이는 탭을 연다(기억해 둔 탭은 바꾸지 않는다).
  if (startupPath.value) tab.value = 'compare';
  ready.value = true;
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

    <nav class="tabs" role="tablist" aria-label="화면" data-testid="tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tabs__tab"
        :class="{ 'tabs__tab--active': tab === t.key }"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        :data-testid="`tab-${t.key}`"
        @click="select(t.key)"
      >
        {{ t.label }}
        <!-- 탭이 좁아 글자 대신 점으로 알린다(탭 다섯 개가 440px에 들어가야 한다). -->
        <span v-if="computingTab === t.key" class="tabs__busy" role="img" title="계산 중" aria-label="계산 중" data-testid="tab-busy"></span>
      </button>
    </nav>

    <p v-if="error" class="screen__error" role="alert" data-testid="error">{{ error }}</p>

    <!-- 계산 중에는 자동 추적이 탭을 옮기지 않는다. 어느 탭을 보고 있든 보이게 탭 줄 바로 아래에 둔다. -->
    <p v-if="track.pendingMove.value" class="screen__hint screen__hint--track" role="status" data-testid="track-pending-move">
      게임에서 보고 있는 보스: <strong>{{ track.target.value?.name }}</strong> — 계산이 끝나면 요격전 탭으로 옮긴다(계산 중에는 탭을 옮기지
      않는다).
    </p>

    <!-- 확장에서 쿠키를 받았는데 계산 중이라 계정 탭을 열지 않았다. 계정 탭을 직접 열면 곧바로 받는다. -->
    <p v-if="extension.waiting.value" class="screen__hint screen__hint--track" role="status" data-testid="link-pending-move">
      크롬 확장에서 쿠키를 받았다 — 계산이 끝나면 계정 탭으로 옮겨 계정을 새로 받는다(계정 탭을 지금 열어도 된다).
    </p>

    <template v-if="ready">
      <KeepAlive>
        <CompareScreen v-if="tab === 'compare'" :startup-path="startupPath" />
        <InterceptScreen v-else-if="tab === 'intercept'" />
        <GrowthScreen v-else-if="tab === 'growth'" />
        <TierScreen v-else-if="tab === 'tier'" />
        <AccountScreen v-else />
      </KeepAlive>
    </template>
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

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
}

.tabs__tab {
  flex: 1;
  min-width: 0;
  padding: 4px 4px 5px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.tabs__tab--active {
  border-color: var(--line);
  background: var(--panel-strong);
  color: var(--text);
}

.tabs__busy {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 2px;
  border-radius: 50%;
  background: var(--accent);
  animation: tabs-busy 1s ease-in-out infinite alternate;
}

@keyframes tabs-busy {
  from {
    opacity: 0.35;
  }

  to {
    opacity: 1;
  }
}
</style>
