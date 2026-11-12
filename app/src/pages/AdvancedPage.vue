<script setup lang="ts">
// 설정 > 고급: 파일 직접 고르기.
// 데스크톱 앱의 화면들은 파일 경로를 묻지 않는다(기본 계정 + 내장 보스 묶음·전투 조건). 다른 계정 파일·보스 묶음·전투 조건·
// 편성 파일·업그레이드 후보로 계산하거나 CLI가 만든 결과 파일을 불러오는 길은 여기에만 있다 — 예전 오버레이의 화면 넷이다.
// 여기서 낸 요격전 결과는 요격전 화면·오버레이가, 비교·성장·티어 결과는 편성 도구·티어 화면이 새 부품으로 보여 준다.
import { computed, KeepAlive, ref } from 'vue';
import { ADVANCED_TABS, useNav, type AdvancedTab } from '../lib/nav';
import { useEngineOwner } from '../lib/engineRun';
import CompareScreen from '../screens/CompareScreen.vue';
import GrowthScreen from '../screens/GrowthScreen.vue';
import InterceptScreen from '../screens/InterceptScreen.vue';
import TierScreen from '../screens/TierScreen.vue';

defineProps<{
  /** 실행 인자로 받은 비교 결과 파일 경로(없으면 빈 문자열). */
  startupPath?: string;
}>();

const nav = useNav();
/** 앱 밖에서(화면만 띄운 테스트) 쓰일 때의 탭. */
const ownTab = ref<AdvancedTab>('compare');
const tab = computed<AdvancedTab>(() => nav?.advanced.value ?? ownTab.value);
/** 지금 계산을 돌리는 화면의 이름(없으면 null). */
const computing = useEngineOwner();

function select(key: AdvancedTab): void {
  if (nav) nav.openAdvanced(key);
  else ownTab.value = key;
}
</script>

<template>
  <div class="advanced" data-testid="advanced">
    <p class="advanced__note" data-testid="advanced-note">
      파일을 직접 골라 계산하거나, 명령줄 도구가 만든 결과 파일을 불러온다. 여기서 낸 결과는 요격전·편성 도구·티어 화면에도 보인다.
    </p>

    <nav class="tabs" role="tablist" aria-label="고급 화면" data-testid="tabs">
      <button
        v-for="t in ADVANCED_TABS"
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
        <span v-if="computing === t.key" class="tabs__busy" role="img" title="계산 중" aria-label="계산 중" data-testid="tab-busy"></span>
      </button>
    </nav>

    <KeepAlive>
      <CompareScreen v-if="tab === 'compare'" :startup-path="startupPath" />
      <InterceptScreen v-else-if="tab === 'intercept'" />
      <GrowthScreen v-else-if="tab === 'growth'" />
      <TierScreen v-else />
    </KeepAlive>
  </div>
</template>

<style scoped>
.advanced {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.advanced__note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
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
