<script setup lang="ts">
// 설정(데스크톱 앱): 계정 연결 · 오버레이 · 계산 도구 · 다른 도구 · 고급. 구획마다 화면 하나다(pages/settings, pages/AdvancedPage.vue).
// 「다른 도구」(P-033)는 커뮤니티 도구 목록이다 — 누르면 기본 브라우저로 열고, 이 앱이 하지 않는 것을 어느 도구가 하는지 알려 준다.
// 구획을 옮겨도 그 화면의 상태(받는 중인 계정·고급의 입력과 결과·도는 계산)는 남는다(KeepAlive).
// 파일을 직접 고르는 길은 「고급」에만 있다.
import { computed, KeepAlive, ref } from 'vue';
import { SETTINGS_SECTIONS, useNav, type SettingsSection } from '../lib/nav';
import { useShared } from '../lib/shared';
import AdvancedPage from './AdvancedPage.vue';
import AccountSection from './settings/AccountSection.vue';
import EngineSection from './settings/EngineSection.vue';
import LinksSection from './settings/LinksSection.vue';
import OverlaySection from './settings/OverlaySection.vue';

defineProps<{
  /** 실행 인자로 받은 비교 결과 파일 경로(없으면 빈 문자열) — 고급의 추천·비교 탭이 불러온다. */
  startupPath?: string;
}>();

const shared = useShared();
const nav = useNav();

/** 앱 밖에서(화면만 띄운 테스트) 쓰일 때의 구획. */
const ownSection = ref<SettingsSection>('account');
const section = computed<SettingsSection>(() => nav?.section.value ?? ownSection.value);
function open(key: SettingsSection): void {
  if (nav) nav.openSettings(key);
  else ownSection.value = key;
}
</script>

<template>
  <div class="nk-page settings" data-testid="page-settings">
    <header class="nk-head">
      <h1 class="nk-title">설정</h1>
      <div class="nk-seg" role="tablist" aria-label="설정 구획">
        <button
          v-for="s in SETTINGS_SECTIONS"
          :key="s.key"
          type="button"
          role="tab"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': section === s.key }"
          :aria-selected="section === s.key"
          :data-testid="`section-${s.key}`"
          @click="open(s.key)"
        >
          {{ s.label }}
        </button>
      </div>
    </header>

    <p v-if="shared?.problem.value" class="nk-error" role="alert" data-testid="shared-problem">{{ shared.problem.value }}</p>

    <KeepAlive>
      <AccountSection v-if="section === 'account'" />
      <OverlaySection v-else-if="section === 'overlay'" />
      <EngineSection v-else-if="section === 'engine'" />
      <LinksSection v-else-if="section === 'links'" />
      <AdvancedPage v-else :startup-path="startupPath" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
}
</style>
