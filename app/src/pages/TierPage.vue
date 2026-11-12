<script setup lang="ts">
// 티어(데스크톱 앱): 자동 티어표를 등급별 초상화 묶음으로 보인다.
// 이 화면은 계산하지 않는다(니케 전원의 계산은 수십 분이라 명령줄에서 돌린다). 티어표는 설정의 「고급」에서 불러오고,
// 마지막으로 불러온 것을 앱을 다시 켜도 다시 연다. 다른 종류·다른 판이면 한국어로 알리고 앞서 보이던 표를 둔다.
import { computed, onMounted, ref } from 'vue';
import { errorMessage, readJsonFile } from '../lib/backend';
import { useNav } from '../lib/nav';
import { recall } from '../lib/remember';
import { checkTierReport } from '../lib/reports';
import { useToolResults } from '../lib/toolResults';
import type { TierReport } from '../types';
import EmptyState from '../ui/EmptyState.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import TierBoard from '../views/TierBoard.vue';

/** 고급의 티어 탭이 마지막으로 불러온 자리를 기억하는 이름(screens/TierScreen.vue와 같다). */
const LAST_TIER = 'tier.report-path';

const nav = useNav();
const results = useToolResults();

const own = ref<TierReport | null>(null);
const loading = ref(false);
const error = ref('');

const report = computed<TierReport | null>(() => results?.tier.value ?? own.value);

onMounted(async () => {
  // 고급에서 이미 불러온 표가 있으면 그것을 쓴다. 없으면 마지막으로 불러온 것을 다시 연다.
  if (report.value) return;
  const last = recall(LAST_TIER) || (__DEV_SAMPLES__?.tier ?? '');
  if (!last) return;
  loading.value = true;
  try {
    const loaded = checkTierReport(await readJsonFile(last), '');
    if (results) results.tier.value = loaded;
    else own.value = loaded;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="nk-page" data-testid="page-tier">
    <header class="nk-head">
      <h1 class="nk-title">티어</h1>
      <span class="nk-muted">계산으로 매긴 등급이다 — 기준 편성의 한 자리에 그 니케를 넣었을 때 팀 총딜이 얼마나 달라지는가</span>
    </header>

    <SkeletonBlock v-if="loading" shape="tiles" :count="6" label="티어표를 읽는 중" />

    <template v-else>
      <p v-if="error" class="nk-error" role="alert" data-testid="error">
        <strong>마지막으로 불러온 티어표를 열지 못했다.</strong> {{ error }} 설정의 고급에서 티어표를 다시 불러온다.
      </p>
      <TierBoard v-if="report" :report="report" />
      <EmptyState
        v-else
        title="티어표가 아직 없다"
        hint="티어표는 설정의 고급에서 불러온다. 한 번 불러오면 다음부터는 여기에 바로 보인다."
        action="고급 설정 열기"
        data-testid="need-tier"
        @action="nav?.openAdvanced('tier')"
      />
    </template>
  </div>
</template>
