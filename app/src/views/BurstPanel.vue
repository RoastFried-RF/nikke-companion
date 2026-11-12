<script setup lang="ts">
// 버스트 흐름 보기(P-032) — 덱 빌더와 요격전 상세가 함께 쓰는 구획.
//   「버스트 흐름 보기」를 누르면 편성의 버스트 순환을 타임라인으로 그린다. 편성을 둘 받으면 위아래로 놓고 견준 한 문장을 적는다.
// 계산 도구의 결과에는 버스트 흐름이 없어, 같은 조건으로 한 번 더 돌려 그 기록을 읽는다(편성마다 몇 초 — lib/compute.ts의 runBurstFlow).
// 규칙은 루트의 순수 모듈(src/core/burst.mjs)에 있다. 여기서는 단추와 진행, 그림(BurstTimeline)을 놓을 뿐이다.
// 「추정 · 실전 미대조」와 버스트가 돌지 않는다는 표시는 접힌 구획 밖에 있다.
import { computed, ref, shallowRef } from 'vue';
import { runBurstFlow } from '../lib/compute';
import { useEngineOwner, useEngineRun } from '../lib/engineRun';
import { engineLabel } from '../lib/format';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { BurstReport } from '../types';
import DetailsFold from '../ui/DetailsFold.vue';
import ProgressPanel from '../ui/ProgressPanel.vue';
import StatusPill from '../ui/StatusPill.vue';
import BurstTimeline from './BurstTimeline.vue';

const props = withDefaults(
  defineProps<{
    /** 이 계산을 돌리는 화면의 이름(lib/nav.ts의 RUN_*) — 한 번에 한 화면만 계산한다. */
    runName: string;
    /** 전투 조건. 없으면 볼 수 없다. */
    condition: Record<string, unknown> | null;
    /** 계산에 쓸 계정을 준다(읽어 둔 것 또는 그때 읽는다). */
    loadAccount: () => Promise<unknown> | unknown;
    /** 볼 편성: 하나(지금 편성) 또는 둘(둘째가 견줄 편성). 비어 있으면 볼 수 없다. */
    squads: { name: string; members: string[] }[];
    /** 편성·상대가 바뀌면 달라지는 열쇠 — 바뀌기 전의 그림은 보이지 않는다. */
    stateKey: string;
    /** 볼 수 없는 까닭(단추의 풍선 도움말과 안내 문장). */
    blocked?: string;
  }>(),
  { blocked: undefined },
);

const { info } = useNikkeCatalog();
const engine = useEngineRun(props.runName);
const owner = useEngineOwner();

const report = shallowRef<BurstReport | null>(null);
const shownKey = ref('');
const error = ref('');

/** 보이는 그림이 지금 편성·지금 상대의 것인가. */
const fresh = computed(() => report.value !== null && shownKey.value === props.stateKey);
const canRun = computed(() => props.squads.length > 0 && props.condition !== null && owner.value === null);
const whyNot = computed(() => {
  if (owner.value !== null && !engine.computing) return '다른 계산이 돌고 있다 — 끝난 뒤에 누른다';
  return props.blocked;
});

async function run(): Promise<void> {
  const condition = props.condition;
  if (!canRun.value || !condition) return;
  const squads = props.squads.map((s) => ({ name: s.name, members: [...s.members] }));
  const key = props.stateKey;
  await engine.run<BurstReport>(async (deps) => runBurstFlow({ account: await props.loadAccount(), condition, squads }, deps), {
    start: () => {
      error.value = '';
    },
    done: (result) => {
      report.value = result;
      shownKey.value = key;
    },
    fail: (message) => {
      error.value = message;
    },
  });
}

defineExpose({ run });
</script>

<template>
  <section class="nk-card" aria-label="버스트 흐름" data-testid="burst-panel" :data-fresh="fresh ? 'yes' : 'no'">
    <div class="nk-row">
      <h2 class="nk-subtitle">버스트 흐름</h2>
      <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="계산 도구가 편성을 돌려 본 기록이다. 실제 전투와 맞춰 본 적이 없다." data-testid="burst-estimate" />
      <span class="nk-muted" data-testid="burst-lead">{{ squads.length > 1 ? `두 편성을 위아래로 견준다: ${squads[0].name} · ${squads[1].name}` : '풀 버스트가 몇 번, 얼마마다 열리는지와 누가 버스트를 쓰는지' }}</span>
      <span class="nk-spacer"></span>
      <button type="button" class="nk-btn" :disabled="!canRun" :title="whyNot" data-testid="burst-run" @click="run">{{ fresh ? '다시 보기' : '버스트 흐름 보기' }}</button>
    </div>

    <ProgressPanel
      v-if="engine.computing"
      title="버스트 흐름을 읽는 중"
      :done="engine.progress?.done ?? 0"
      :total="engine.progress?.total ?? 0"
      :elapsed-ms="engine.elapsed * 1000"
      :stopping="engine.stopping"
      @stop="engine.stop"
    />
    <p v-else-if="engine.stopped" class="nk-note" role="status" data-testid="burst-stopped">읽기를 중단했다.</p>
    <p v-if="error" class="nk-error" role="alert" data-testid="burst-error"><strong>버스트 흐름을 읽지 못했다.</strong> {{ error }} 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.</p>

    <template v-if="fresh && report">
      <p v-if="report.comparison" class="burst-panel__compare" data-testid="burst-compare">{{ report.lines[0].name }} → {{ report.lines[1].name }}: {{ report.comparison.text }}</p>
      <div class="burst-panel__lines" data-testid="burst-lines">
        <BurstTimeline v-for="(line, i) in report.lines" :key="i" :line="line" :duration="report.duration" :info="info" />
      </div>
      <p class="nk-muted" data-testid="burst-legend">띠는 풀 버스트가 열려 있던 구간(빨간 띠는 다음 버스트를 기다리다 늦게 열린 것), 줄의 표시는 그 니케가 버스트를 쓴 때다.</p>
      <DetailsFold summary="버스트 흐름의 조건" :count="report.caveats.length" data-testid="burst-conditions">
        <ul class="nk-list" data-testid="burst-caveats">
          <li v-for="(c, i) in report.caveats" :key="i" data-testid="burst-caveat">{{ c }}</li>
          <li data-testid="burst-engine">계산 도구: {{ engineLabel(report.engine) }}</li>
        </ul>
      </DetailsFold>
    </template>
    <p v-else-if="!engine.computing && !error" class="nk-muted" data-testid="burst-hint">
      <template v-if="blocked">{{ blocked }}</template>
      <template v-else-if="report">편성이나 상대가 바뀌었다 — 「버스트 흐름 보기」를 누르면 지금 것으로 다시 읽는다.</template>
      <template v-else>「버스트 흐름 보기」를 누르면 이 편성의 버스트 순환을 시간축 위에 그린다(편성 하나에 몇 초).</template>
    </p>
  </section>
</template>

<style scoped>
.burst-panel__lines {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-6);
}

.burst-panel__compare {
  margin: 0;
  font-weight: var(--nk-weight-bold);
}
</style>
