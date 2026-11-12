<script setup lang="ts">
// 요격전 화면(설정 > 고급 — 파일 직접 고르기): 계정과 보스 묶음 파일을 골라 보스별 추천을 실행하고(루트의 recommendIntercept —
// CLI의 `intercept`와 같다), 보스를 골라 그 보스의 상위 편성을 본다. `intercept --json`이 만든 결과 파일도 불러온다.
// 진행 표시·오류 표시·중단은 추천·비교와 같은 것을 쓴다(lib/engineRun.ts, RunStatus, RunButtons).
//
// 결과는 두 창이 함께 보는 자리(lib/shared.ts)에 올린다: 여기서 계산하거나 불러온 결과가 요격전 화면과 오버레이에도 보이고,
// 디스크에 저장돼 앱을 다시 열면 그 결과와 마지막으로 고른 보스가 바로 보인다(계산에 몇 분이 걸린다).
// 요격전 화면이 계산한 결과도 여기에 같은 것으로 보인다 — 마지막 결과는 하나다.
import { computed, ref } from 'vue';
import InterceptView from '../components/InterceptView.vue';
import PathField from '../components/PathField.vue';
import ResultLoader from '../components/ResultLoader.vue';
import RunButtons from '../components/RunButtons.vue';
import RunStatus from '../components/RunStatus.vue';
import { onAccountAdopted } from '../lib/accountLink';
import { errorMessage } from '../lib/backend';
import { DEFAULT_INTERCEPT_BUDGET, DEFAULT_INTERCEPT_TOP, runIntercept } from '../lib/compute';
import { useEngineRun } from '../lib/engineRun';
import { recall, remember } from '../lib/remember';
import { checkInterceptReport } from '../lib/reports';
import { useResultFile } from '../lib/resultFile';
import { useShared } from '../lib/shared';
import type { InterceptReport } from '../types';

// 처음 보일 경로: 마지막으로 쓴 파일 → (계정은) 추천·비교에서 쓴 계정 → (개발 실행에서만) 샘플
const accountPath = ref(recall('intercept.account') || recall('compute.account') || (__DEV_SAMPLES__?.account ?? ''));
const bossesPath = ref(recall('intercept.bosses') || (__DEV_SAMPLES__?.bosses ?? ''));
/** 빈 칸이면 계산 코드의 기본값을 쓴다. 값의 범위는 계산 코드가 확인한다. */
const top = ref<number | ''>('');
const budget = ref<number | ''>('');

const shared = useShared();
/** 앱 밖에서(이 화면만 띄운 테스트) 쓰일 때의 결과. 앱 안에서는 두 창이 함께 보는 자리의 것을 쓴다. */
const own = ref<InterceptReport | null>(null);
const report = computed<InterceptReport | null>(() => (shared ? shared.intercept.value : own.value));
/** 지금 보이는 것이 앞서 저장해 둔 결과다(이번에 계산하거나 불러온 것이 아니다). */
const restored = computed(() => shared?.restored.value === true);
const error = ref('');
/** 사용자가 입력 칸을 펴거나 접었으면 그 값. 손대지 않았으면 null. */
const inputsChoice = ref<boolean | null>(null);
/**
 * 입력 칸을 펴 두나. 결과가 있으면 접어서 보스와 편성이 위에 보이게 한다 — 저장해 둔 결과가 뒤늦게 읽혀도(앱을 켠 직후) 그때 접힌다.
 * 사용자가 펴거나 접었으면 그 뜻을 따른다.
 */
const inputsOpen = computed<boolean>({
  get: () => inputsChoice.value ?? report.value === null,
  set: (open) => {
    inputsChoice.value = open;
  },
});

// 계정 화면이 계정 파일을 저장하면 그 경로가 계정 칸에 들어온다(계산은 시작하지 않는다).
onAccountAdopted((path) => {
  accountPath.value = path;
});

const engine = useEngineRun('intercept');
const file = useResultFile<InterceptReport>({ key: 'intercept.report-path', label: '요격전 추천 결과', check: checkInterceptReport });

const count = (value: number | ''): number | undefined => (value === '' ? undefined : value);

async function show(next: InterceptReport): Promise<void> {
  error.value = '';
  inputsOpen.value = false;
  if (!shared) {
    own.value = next;
    return;
  }
  try {
    // 보이고, 디스크에 저장하고, 오버레이 창에 알린다. 저장하지 못해도 화면에는 보인다(그 사실은 요격전 화면이 알린다).
    await shared.publishIntercept(next);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(): Promise<void> {
  await engine.run<InterceptReport>(
    (deps) =>
      runIntercept({ accountPath: accountPath.value, bossesPath: bossesPath.value, top: count(top.value), budget: count(budget.value) }, deps),
    {
      start: () => {
        // 늦게 끝나는 파일 읽기가 계산 결과를 덮지 않게 한다. 이전 결과는 계산이 끝날 때까지 그대로 보인다.
        file.abandon();
        error.value = '';
      },
      done: (computed) => {
        remember('intercept.account', accountPath.value.trim());
        remember('intercept.bosses', bossesPath.value.trim());
        void show(computed);
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
    if (loaded) await show(loaded);
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
  <div class="screen" data-testid="screen-intercept">
    <section class="panel" aria-label="요격전 추천 실행" data-testid="intercept-panel">
      <div class="panel__row">
        <button
          class="panel__toggle"
          type="button"
          :aria-expanded="inputsOpen"
          aria-controls="intercept-inputs"
          data-testid="toggle-inputs"
          @click="inputsOpen = !inputsOpen"
        >
          {{ inputsOpen ? '▾' : '▸' }} 입력
        </button>
        <span class="panel__spacer"></span>
        <RunButtons :run="engine" label="요격전 추천 실행" :disabled="file.loading" @run="run" @stop="engine.stop" />
      </div>

      <div v-show="inputsOpen" id="intercept-inputs" class="panel__fold-body" data-testid="intercept-inputs">
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
          v-model="bossesPath"
          name="bosses"
          label="보스"
          title="보스 묶음 파일 고르기"
          placeholder="보스 묶음 JSON 파일 경로"
          :disabled="engine.computing"
          @enter="run"
          @fail="fail"
        />
        <div class="panel__row">
          <label class="panel__count" title="보스마다 보일 상위 편성 수">
            표시
            <input
              v-model.number="top"
              type="number"
              min="1"
              step="1"
              :placeholder="String(DEFAULT_INTERCEPT_TOP)"
              :disabled="engine.computing"
              aria-label="보스별 표시할 상위 편성 수"
              data-testid="intercept-top"
            />
          </label>
          <label class="panel__count" title="엔진 시뮬 횟수의 상한 — 보스 수로 나눈다">
            예산
            <input
              v-model.number="budget"
              type="number"
              min="1"
              step="1"
              :placeholder="String(DEFAULT_INTERCEPT_BUDGET)"
              :disabled="engine.computing"
              aria-label="전체 시뮬 횟수의 상한"
              data-testid="intercept-budget"
            />
          </label>
        </div>
        <ResultLoader
          v-model="file.path"
          title="요격전 추천 결과 파일 고르기"
          placeholder="요격전 추천 결과 JSON 파일 경로"
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
        <p v-else-if="restored" class="screen__hint" data-testid="restored-note">
          앞서 본 결과를 다시 보였다(다시 계산하지 않았다). 계정이나 보스 값이 바뀌었으면 다시 실행한다.
        </p>
        <InterceptView :report="report" />
      </template>
      <p v-else-if="!engine.computing && !file.loading && !error" class="screen__hint" data-testid="hint">
        계정 파일과 보스 묶음 파일을 골라 요격전 추천을 실행한다 — 보스마다 보유 니케로 총딜이 가장 큰 편성을 찾는다(기본 예산이면
        몇 분 걸린다). 이상 개체 요격전의 보스 묶음은 저장소의 <code>data/intercept/anomaly.json</code>이다. 이미 만든 결과는
        결과 칸에서 불러온다 — <code>node src/cli.mjs intercept … --json 결과.json</code>.
      </p>
    </main>
  </div>
</template>
