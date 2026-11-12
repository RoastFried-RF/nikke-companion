<script setup lang="ts">
// 요격전 화면: 계정과 보스 묶음 파일을 골라 보스별 추천을 실행하고(루트의 recommendIntercept — CLI의 `intercept`와 같다),
// 보스를 골라 그 보스의 상위 편성을 본다. `intercept --json`이 만든 결과 파일도 불러온다.
// 진행 표시·오류 표시·중단은 추천·비교와 같은 것을 쓴다(lib/engineRun.ts, RunStatus, RunButtons).
//
// 가장 자주 보는 화면이라 마지막 결과를 기억한다: 앱을 다시 열면 그 결과와 마지막으로 고른 보스가 바로 보인다
// (계산에 몇 분이 걸린다). 기억은 이 PC의 웹뷰 저장소에만 있고 저장소 폴더에는 쓰지 않는다.
//
// 자동 추적(TrackPanel): 켜 두면 게임에서 보고 있는 이상 개체 보스를 Rust가 인식해 알려 주고, 이 화면이 그 보스를 고른다
// (규칙은 lib/screenTrack.ts). 추천 결과가 없거나 그 보스가 결과에 없으면 「추천을 먼저 실행하라」고 알릴 뿐,
// 계산을 스스로 시작하지 않는다.
import { computed, ref } from 'vue';
import InterceptView from '../components/InterceptView.vue';
import PathField from '../components/PathField.vue';
import ResultLoader from '../components/ResultLoader.vue';
import RunButtons from '../components/RunButtons.vue';
import RunStatus from '../components/RunStatus.vue';
import TrackPanel from '../components/TrackPanel.vue';
import { onAccountAdopted } from '../lib/accountLink';
import { errorMessage } from '../lib/backend';
import { DEFAULT_INTERCEPT_BUDGET, DEFAULT_INTERCEPT_TOP, runIntercept } from '../lib/compute';
import { useEngineRun } from '../lib/engineRun';
import { forget, recall, remember } from '../lib/remember';
import { checkInterceptReport } from '../lib/reports';
import { useResultFile } from '../lib/resultFile';
import { findBoss, useScreenTrack } from '../lib/screenTrack';
import type { InterceptReport } from '../types';

/** 마지막 결과 문서를 기억하는 이름. */
const SAVED_REPORT = 'intercept.report';

/** 기억해 둔 마지막 결과. 없거나, 이 판이 읽을 수 없는 문서면(옛 판 등) 버리고 null. */
function savedReport(): InterceptReport | null {
  const raw = recall(SAVED_REPORT);
  if (!raw) return null;
  try {
    return checkInterceptReport(JSON.parse(raw));
  } catch {
    forget(SAVED_REPORT);
    return null;
  }
}

// 처음 보일 경로: 마지막으로 쓴 파일 → (계정은) 추천·비교에서 쓴 계정 → (개발 실행에서만) 샘플
const accountPath = ref(recall('intercept.account') || recall('compute.account') || (__DEV_SAMPLES__?.account ?? ''));
const bossesPath = ref(recall('intercept.bosses') || (__DEV_SAMPLES__?.bosses ?? ''));
/** 빈 칸이면 계산 코드의 기본값을 쓴다. 값의 범위는 계산 코드가 확인한다. */
const top = ref<number | ''>('');
const budget = ref<number | ''>('');

const report = ref<InterceptReport | null>(savedReport());
/** 지금 보이는 것이 기억해 둔 결과다(이번에 계산하거나 불러온 것이 아니다). */
const restored = ref(report.value !== null);
const error = ref('');
/** 입력 칸을 펴 두나. 결과가 있으면 접어서 보스와 편성이 위에 보이게 한다. */
const inputsOpen = ref(report.value === null);

// 계정 화면이 계정 파일을 저장하면 그 경로가 계정 칸에 들어온다(계산은 시작하지 않는다).
onAccountAdopted((path) => {
  accountPath.value = path;
});

const engine = useEngineRun('intercept');
const file = useResultFile<InterceptReport>({ key: 'intercept.report-path', label: '요격전 추천 결과', check: checkInterceptReport });

const track = useScreenTrack();
/**
 * 자동 추적이 따라간 보스의 추천을 보일 수 없을 때의 안내: 결과가 아직 없거나('none'), 결과에 그 보스가 없다('absent').
 * 보일 수 있으면 null. 어느 쪽이든 계산을 스스로 시작하지 않는다 — 실행은 사용자가 누른다.
 */
const trackedGap = computed<{ kind: 'none' | 'absent'; name: string } | null>(() => {
  const target = track?.enabled.value ? track.target.value : null;
  if (!target) return null;
  if (!report.value) return { kind: 'none', name: target.name };
  return findBoss(report.value.bosses ?? [], target) ? null : { kind: 'absent', name: target.name };
});

const count = (value: number | ''): number | undefined => (value === '' ? undefined : value);

function show(next: InterceptReport): void {
  report.value = next;
  restored.value = false;
  error.value = '';
  inputsOpen.value = false;
  // 저장하지 못해도(용량 등) 화면은 그대로다 — 다음에 열 때 다시 계산하거나 불러오면 된다.
  // 그때 앞서 기억해 둔 옛 결과가 대신 나오지 않게 지운다.
  if (!remember(SAVED_REPORT, JSON.stringify(next))) forget(SAVED_REPORT);
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

    <TrackPanel />

    <p v-if="error" class="screen__error" role="alert" data-testid="error">{{ error }}</p>

    <main class="screen__content">
      <p v-if="trackedGap" class="screen__hint screen__hint--track" role="status" data-testid="track-need-run">
        게임에서 보고 있는 보스: <strong>{{ trackedGap.name }}</strong> —
        <template v-if="trackedGap.kind === 'none'">추천 결과가 아직 없다. 요격전 추천을 먼저 실행하라</template>
        <template v-else>지금 결과에는 이 보스가 없다. 이 보스가 든 보스 묶음으로 요격전 추천을 먼저 실행하라</template>
        (자동으로 계산을 시작하지 않는다).
      </p>
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
