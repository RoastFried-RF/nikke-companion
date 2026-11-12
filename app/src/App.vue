<script setup lang="ts">
// 데스크톱 앱 창의 틀: 왼쪽 메뉴(홈 · 요격전 · 내 니케 · 편성 도구 · 티어 · 설정)와 화면 하나.
// 계정 연결·계산·설정을 전부 이 창에서 한다(오버레이 창은 결과만 보여 준다 — Overlay.vue).
// 화면을 옮겨도 그 화면의 상태(입력·결과·도는 계산)는 남는다(KeepAlive). 마지막으로 본 화면을 기억한다.
// 메뉴에는 지금 화면과 계산 중인 화면이 표시된다.
import { computed, KeepAlive, onMounted, ref, watch } from 'vue';
import { provideAccountLink } from './lib/accountLink';
import { provideDecks } from './lib/deck';
import { setFollowGame, startupReportPath } from './lib/backend';
import { provideEngineOwner } from './lib/engineRun';
import { provideExtensionLink } from './lib/extensionLink';
import { pageOfRun, PAGES, provideNav } from './lib/nav';
import { providePlan } from './lib/plan';
import { provideScreenTrack } from './lib/screenTrack';
import { provideShared } from './lib/shared';
import { provideToolResults } from './lib/toolResults';
import HomePage from './pages/HomePage.vue';
import InterceptPage from './pages/InterceptPage.vue';
import RosterPage from './pages/RosterPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import TierPage from './pages/TierPage.vue';
import ToolsPage from './pages/ToolsPage.vue';
import NavIcon from './ui/NavIcon.vue';
import AccountSwitch from './views/AccountSwitch.vue';

/** 붙이기를 켜 두었는지 기억하는 localStorage 키(components/GamePanel.vue와 같다). */
const FOLLOW_KEY = 'nikke-companion.follow-game';

/** 실행 인자로 받은 비교 결과 파일 경로. 있으면 설정 > 고급의 추천·비교가 먼저 보인다. */
const startupPath = ref('');
/** 실행 인자를 확인한 뒤에 화면을 그린다(어느 화면을 먼저 보일지 그때 정해진다). */
const ready = ref(false);

const nav = provideNav();
const page = nav.page;
/** 지금 계산을 돌리는 화면의 이름(없으면 null). 계산은 한 번에 한 화면에서만 돈다. */
const computingRun = provideEngineOwner();
/** 메뉴의 어느 화면에서 계산이 도는가. */
const computingPage = computed(() => pageOfRun(computingRun.value));

// 두 창이 함께 보는 것(기본 계정·마지막 요격전 결과): 디스크에서 읽고, 계산이 끝나면 저장해 오버레이 창에 알린다.
const shared = provideShared();
// 요격전 계획(P-029): 계정마다 손으로 적어 두는 요격전 기록과 즐겨찾기. 기본 계정이 바뀌면 그 계정의 것을 읽는다.
providePlan(shared);
// 덱 빌더(P-030): 계정마다 저장하는 내 편성(번호 칸 다섯과 이름 붙인 목록), 요격전 추천에서 덱 빌더로 넘기는 편성.
provideDecks(shared);
// 고급에서 낸 비교·성장·티어 결과를 편성 도구·티어 화면에 올리는 자리.
provideToolResults();
// 계정 화면이 저장한 계정 파일의 경로를 고급의 계정 칸에 넣는 통로(lib/accountLink.ts).
provideAccountLink();

// 요격전 화면 자동 추적: 게임에서 이상 개체 보스를 보고 있으면 그 보스의 추천을 보인다(스위치는 설정 > 오버레이에 있다).
// 보스를 고르는 것은 요격전 화면이 하고, 여기서는 다른 화면을 보고 있을 때 요격전 화면으로 옮기기만 한다(끌 수 있다).
// 언제 옮기는지는 lib/screenTrack.ts의 규칙(tabMoveStep)이 정한다: 같은 인식이 이어지는 동안에는 다시 옮기지 않고,
// 어느 화면에서든 계산이 도는 동안에는 옮기지 않고 미뤄 뒀다가 계산이 끝나면 한 번 옮긴다.
const track = provideScreenTrack({
  computing: () => computingRun.value !== null,
  onIntercept: () => page.value === 'intercept',
  moveToIntercept: () => nav.openIntercept(),
});
// 계산이 시작·끝나거나 화면이 바뀌면 미뤄 둔 이동을 다시 보게 한다(계산이 끝났으면 그때 옮긴다).
watch([computingRun, page, nav.section], () => track.settle());

// 크롬 확장 연결: 이 PC의 크롬 확장이 쿠키를 넘기면(Rust의 수신부가 받는다 — 쿠키는 화면에 오지 않는다) 설정의 계정 연결을
// 열고, 계정 화면이 「계정 새로 받기」를 이어서 돌린다. 언제 여는지는 lib/extensionLink.ts의 규칙(arrivalStep)이 정한다:
// 계산이 도는 동안에는 옮기지 않고 미뤄 뒀다가 계산이 끝나면 한 번 옮긴다.
const extension = provideExtensionLink({
  computing: () => computingRun.value !== null,
  onAccount: () => page.value === 'settings' && nav.section.value === 'account',
  openAccount: () => nav.openSettings('account'),
});
watch([computingRun, page, nav.section], () => extension.settle());

onMounted(async () => {
  try {
    startupPath.value = (await startupReportPath()) ?? '';
  } catch {
    startupPath.value = '';
  }
  // 실행 인자는 비교 결과 파일이다 — 그 결과가 보이는 화면(설정 > 고급 > 추천·비교)을 연다(기억해 둔 화면은 바꾸지 않는다).
  if (startupPath.value) {
    nav.advanced.value = 'compare';
    nav.section.value = 'advanced';
    page.value = 'settings';
  }
  ready.value = true;
  // 지난번에 붙이기를 켜 두었으면 다시 켠다(오버레이가 게임 창을 따라간다). 못 켜도 설정의 오버레이에서 다시 켤 수 있다.
  try {
    if (localStorage.getItem(FOLLOW_KEY) === '1') await setFollowGame(true);
  } catch {
    // 붙이기는 설정 > 오버레이에서 켠다.
  }
});
</script>

<template>
  <div class="app" data-testid="app">
    <nav class="nav" aria-label="메뉴" data-testid="nav">
      <div class="nav__brand">니케 컴패니언</div>
      <button
        v-for="p in PAGES"
        :key="p.key"
        type="button"
        class="nav__item"
        :class="{ 'nav__item--on': page === p.key }"
        :aria-current="page === p.key ? 'page' : undefined"
        :title="p.label"
        :data-testid="`nav-${p.key}`"
        @click="nav.go(p.key)"
      >
        <NavIcon :name="p.icon" />
        <span class="nav__label">{{ p.label }}</span>
        <span v-if="computingPage === p.key" class="nav__busy" role="img" title="계산 중" aria-label="계산 중" data-testid="nav-busy"></span>
      </button>
    </nav>

    <main class="app__main" data-testid="app-main">
      <!-- 계정 여러 개(P-033): 고를 계정이 둘 이상이면 어느 화면에서든 위쪽에서 바꾼다. 계산 중에는 바꾸지 못한다. -->
      <AccountSwitch :computing="computingRun !== null" />

      <!-- 계산 중에는 자동 추적이 화면을 옮기지 않는다. 어느 화면을 보고 있든 보이게 맨 위에 둔다. -->
      <p v-if="track.pendingMove.value" class="nk-note" role="status" data-testid="track-pending-move">
        게임에서 보고 있는 보스: <strong>{{ track.target.value?.name }}</strong> — 계산이 끝나면 요격전 화면으로 옮긴다(계산 중에는 화면을 옮기지
        않는다).
      </p>

      <!-- 확장에서 쿠키를 받았는데 계산 중이라 계정 연결을 열지 않았다. 직접 열면 곧바로 받는다. -->
      <p v-if="extension.waiting.value" class="nk-note" role="status" data-testid="link-pending-move">
        크롬 확장에서 쿠키를 받았다 — 계산이 끝나면 설정의 계정 연결로 옮겨 계정을 새로 받는다(지금 열어도 된다).
      </p>

      <template v-if="ready">
        <KeepAlive>
          <HomePage v-if="page === 'home'" />
          <InterceptPage v-else-if="page === 'intercept'" />
          <RosterPage v-else-if="page === 'roster'" />
          <ToolsPage v-else-if="page === 'tools'" />
          <TierPage v-else-if="page === 'tier'" />
          <SettingsPage v-else :startup-path="startupPath" />
        </KeepAlive>
      </template>
    </main>
  </div>
</template>

<style scoped>
/* 창 전체를 불투명한 어두운 바탕으로 채운다(오버레이 창과 달리 투명하지 않다). */
.app {
  display: flex;
  height: 100%;
  background: var(--nk-bg);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
  line-height: var(--nk-line-normal);
}

.nav {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--nk-space-2);
  width: calc(var(--nk-tile-lg) + var(--nk-space-4));
  padding: var(--nk-space-4) var(--nk-space-3);
  border-right: var(--nk-border-width) solid var(--nk-border);
  background: var(--nk-surface);
}

.nav__brand {
  padding: 0 var(--nk-space-2) var(--nk-space-4);
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-heavy);
  text-align: center;
}

.nav__item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-2);
  padding: var(--nk-space-3) var(--nk-space-2);
  border: var(--nk-border-width) solid transparent;
  border-radius: var(--nk-radius-md);
  background: transparent;
  color: var(--nk-text-muted);
  font: inherit;
  cursor: pointer;
}

.nav__item:hover {
  color: var(--nk-text);
}

.nav__item--on {
  border-color: var(--nk-accent);
  background: var(--nk-accent-soft);
  color: var(--nk-text);
  font-weight: var(--nk-weight-bold);
}

.nav__label {
  font-size: var(--nk-font-sm);
  white-space: nowrap;
}

.nav__busy {
  position: absolute;
  top: var(--nk-space-2);
  right: var(--nk-space-2);
  width: var(--nk-space-3);
  height: var(--nk-space-3);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-estimate);
  animation: nav-busy 1s ease-in-out infinite alternate;
}

.app__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
  padding: var(--nk-space-5) var(--nk-space-6);
  overflow-y: auto;
}

@keyframes nav-busy {
  from {
    opacity: 0.35;
  }

  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nav__busy {
    animation: none;
  }
}
</style>
