<script setup lang="ts">
// 성장 비교 화면: 계정·전투 조건·기준 편성·업그레이드 후보 파일을 골라 성장 투자 비교를 실행한다
// (루트의 compareGrowth — CLI의 `growth`와 같다). `growth --json`이 만든 결과 파일도 불러온다.
// 진행 표시·오류 표시·중단은 추천·비교와 같은 것을 쓴다(lib/engineRun.ts, RunStatus, RunButtons).
import { ref } from 'vue';
import GrowthView from '../components/GrowthView.vue';
import PathField from '../components/PathField.vue';
import ResultLoader from '../components/ResultLoader.vue';
import RunButtons from '../components/RunButtons.vue';
import RunStatus from '../components/RunStatus.vue';
import { errorMessage } from '../lib/backend';
import { runGrowth } from '../lib/compute';
import { useEngineRun } from '../lib/engineRun';
import { recall, remember } from '../lib/remember';
import { checkGrowthReport } from '../lib/reports';
import { useResultFile } from '../lib/resultFile';
import type { GrowthReport } from '../types';

// 처음 보일 경로: 마지막으로 쓴 파일 → 추천·비교에서 쓴 파일(계정·조건·편성) → (개발 실행에서만) 샘플
const accountPath = ref(recall('growth.account') || recall('compute.account') || (__DEV_SAMPLES__?.account ?? ''));
const conditionPath = ref(recall('growth.condition') || recall('compute.condition') || (__DEV_SAMPLES__?.condition ?? ''));
const squadsPath = ref(recall('growth.squads') || recall('compute.squads') || (__DEV_SAMPLES__?.squads ?? ''));
/** 기준 편성의 이름. 비우면 편성 파일의 첫 편성이다. */
const squadName = ref(recall('growth.squad'));
const upgradesPath = ref(recall('growth.upgrades') || (__DEV_SAMPLES__?.upgrades ?? ''));

const report = ref<GrowthReport | null>(null);
const error = ref('');
/** 입력 칸을 펴 두나. 결과가 나오면 접는다. */
const inputsOpen = ref(true);

const engine = useEngineRun('growth');
const file = useResultFile<GrowthReport>({ key: 'growth.report-path', label: '성장 비교 결과', check: checkGrowthReport });

function show(next: GrowthReport): void {
  report.value = next;
  error.value = '';
  inputsOpen.value = false;
}

async function run(): Promise<void> {
  await engine.run<GrowthReport>(
    (deps) =>
      runGrowth(
        {
          accountPath: accountPath.value,
          conditionPath: conditionPath.value,
          squadsPath: squadsPath.value,
          squadName: squadName.value,
          upgradesPath: upgradesPath.value,
        },
        deps,
      ),
    {
      start: () => {
        // 늦게 끝나는 파일 읽기가 계산 결과를 덮지 않게 한다. 이전 결과는 계산이 끝날 때까지 그대로 보인다.
        file.abandon();
        error.value = '';
      },
      done: (computed) => {
        remember('growth.account', accountPath.value.trim());
        remember('growth.condition', conditionPath.value.trim());
        remember('growth.squads', squadsPath.value.trim());
        remember('growth.squad', squadName.value.trim());
        remember('growth.upgrades', upgradesPath.value.trim());
        show(computed);
      },
      // 오류가 나도 앞서 보이던 결과는 그대로 둔다.
      fail: (message) => {
        error.value = message;
      },
    },
  );
}

async function load(): Promise<void> {
  if (engine.computing) return;
  try {
    const loaded = await file.load();
    if (loaded) show(loaded);
  } catch (e) {
    // 읽지 못했거나 다른 종류·다른 판의 파일이다. 앞서 보이던 결과는 그대로 둔다.
    error.value = errorMessage(e);
  }
}

function fail(message: string): void {
  error.value = message;
}
</script>

<template>
  <div class="screen" data-testid="screen-growth">
    <section class="panel" aria-label="성장 비교 실행" data-testid="growth-panel">
      <div class="panel__row">
        <button
          class="panel__toggle"
          type="button"
          :aria-expanded="inputsOpen"
          aria-controls="growth-inputs"
          data-testid="toggle-inputs"
          @click="inputsOpen = !inputsOpen"
        >
          {{ inputsOpen ? '▾' : '▸' }} 입력
        </button>
        <span class="panel__spacer"></span>
        <RunButtons :run="engine" label="성장 비교 실행" :disabled="file.loading" @run="run" @stop="engine.stop" />
      </div>

      <div v-show="inputsOpen" id="growth-inputs" class="panel__fold-body" data-testid="growth-inputs">
        <PathField
          v-model="accountPath"
          name="account"
          label="계정"
          title="계정 상태 파일 고르기"
          placeholder="계정 상태 JSON 파일 경로"
          :disabled="engine.computing"
          @enter="run"
          @fail="fail"
        />
        <PathField
          v-model="conditionPath"
          name="condition"
          label="조건"
          title="전투 조건 파일 고르기"
          placeholder="전투 조건 JSON 파일 경로"
          :disabled="engine.computing"
          @enter="run"
          @fail="fail"
        />
        <PathField
          v-model="squadsPath"
          name="squads"
          label="편성"
          title="기준 편성이 든 편성 파일 고르기"
          placeholder="기준 편성이 든 편성 JSON 파일 경로"
          :disabled="engine.computing"
          @enter="run"
          @fail="fail"
        />
        <div class="panel__row">
          <span class="panel__label">기준</span>
          <input
            v-model="squadName"
            class="panel__text"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="기준 편성 이름 (비우면 편성 파일의 첫 편성)"
            aria-label="기준 편성 이름"
            :disabled="engine.computing"
            data-testid="growth-squad"
            @keydown.enter.prevent="run"
          />
        </div>
        <PathField
          v-model="upgradesPath"
          name="upgrades"
          label="후보"
          title="업그레이드 후보 파일 고르기"
          placeholder="업그레이드 후보 JSON 파일 경로"
          :disabled="engine.computing"
          @enter="run"
          @fail="fail"
        />
        <ResultLoader
          v-model="file.path"
          title="성장 비교 결과 파일 고르기"
          placeholder="성장 비교 결과 JSON 파일 경로"
          :loading="file.loading"
          :disabled="engine.computing"
          @load="load"
          @fail="fail"
        />
      </div>

      <RunStatus :run="engine" />
    </section>

    <p v-if="error" class="screen__error" role="alert" data-testid="error">{{ error }}</p>

    <main class="screen__content">
      <template v-if="report">
        <p v-if="engine.computing" class="screen__hint" data-testid="stale-note">
          아래는 이전 결과다 — 새 계산이 끝나면 바뀐다.
        </p>
        <GrowthView :report="report" />
      </template>
      <p v-else-if="!engine.computing && !file.loading && !error" class="screen__hint" data-testid="hint">
        계정·전투 조건·편성 파일과 업그레이드 후보 파일을 골라 성장 비교를 실행한다 — 후보를 하나씩 계정에 가상으로 적용해
        기준 편성의 총딜이 얼마나 느는지 순서대로 보인다(재화·비용은 보지 않는다). 후보 파일의 형식은
        <code>data/samples/upgrades.sample.json</code>을 참고한다. 이미 만든 결과는 결과 칸에서 불러온다 —
        <code>node src/cli.mjs growth … --json 결과.json</code>.
      </p>
    </main>
  </div>
</template>
