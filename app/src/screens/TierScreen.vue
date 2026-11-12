<script setup lang="ts">
// 티어 화면: `tier build --json`이 만든 결과 파일을 불러와 표로 보여 준다. 이 화면은 계산하지 않는다
// (전원 계산은 시뮬 1,800건쯤 — 수십 분이라 명령줄에서 돌린다).
// 읽지 못하거나 다른 종류·다른 판의 파일이면 오류만 보이고 앞서 보이던 표는 그대로 둔다.
import { onMounted, ref } from 'vue';
import ResultLoader from '../components/ResultLoader.vue';
import TierView from '../components/TierView.vue';
import { errorMessage } from '../lib/backend';
import { checkTierReport } from '../lib/reports';
import { useResultFile } from '../lib/resultFile';
import { useToolResults } from '../lib/toolResults';
import type { TierReport } from '../types';

// 여기서 불러온 표는 티어 화면에도 올린다(등급별 초상화 묶음으로 보인다). 티어 화면이 먼저 열어 둔 표가 있으면 그것부터 보인다.
const results = useToolResults();
const report = ref<TierReport | null>(results?.tier.value ?? null);
/** 지금 보이는 표의 파일 경로. */
const loadedPath = ref('');
const error = ref('');

// 처음 보일 경로: 마지막으로 불러온 파일 → (개발 실행에서만) 샘플 결과
const file = useResultFile<TierReport>({
  key: 'tier.report-path',
  label: '티어 결과',
  check: checkTierReport,
  initial: __DEV_SAMPLES__?.tier ?? '',
});

async function load(): Promise<void> {
  const target = file.path.trim();
  try {
    const loaded = await file.load();
    if (!loaded) return;
    report.value = loaded;
    if (results) results.tier.value = loaded;
    loadedPath.value = target;
    error.value = '';
  } catch (e) {
    // 앞서 보이던 표는 그대로 둔다.
    error.value = errorMessage(e);
  }
}

function fail(message: string): void {
  error.value = message;
}

onMounted(async () => {
  // 마지막으로 불러온 파일을 다시 연다(파일을 다시 만들었으면 새 내용이 보인다).
  if (file.path) await load();
});
</script>

<template>
  <div class="screen" data-testid="screen-tier">
    <section class="panel" aria-label="티어 결과 불러오기" data-testid="tier-panel">
      <ResultLoader
        v-model="file.path"
        title="티어 결과 파일 고르기"
        placeholder="티어 결과 JSON 파일 경로 (tier build --json)"
        :loading="file.loading"
        @load="load"
        @fail="fail"
      />
    </section>

    <p v-if="error" class="screen__error" role="alert" data-testid="error">{{ error }}</p>

    <main class="screen__content">
      <template v-if="report">
        <p v-if="error" class="screen__hint" data-testid="kept-note">아래는 앞서 불러온 표다: {{ loadedPath }}</p>
        <TierView :report="report" />
      </template>
      <p v-else-if="!file.loading && !error" class="screen__hint" data-testid="hint">
        티어 결과 파일을 불러와 등급표를 본다. 결과 파일은 저장소 루트에서 만든다 —
        <code>node src/cli.mjs tier build --json tier.json</code>(전원: 시뮬 1,800건쯤, 수십 분) 또는
        <code>--only "헬름,크라운"</code>으로 일부만.
      </p>
    </main>
  </div>
</template>
