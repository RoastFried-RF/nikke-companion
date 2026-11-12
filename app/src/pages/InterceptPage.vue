<script setup lang="ts">
// 요격전 화면(데스크톱 앱): 이상 개체 보스 5종의 추천 편성.
// 파일 경로를 묻지 않는다 — 계정은 기본 계정, 보스 값은 앱에 내장한 묶음(lib/builtin.ts)을 쓴다.
// 계산은 루트의 recommendIntercept(CLI의 `intercept`와 같은 함수)가 하고, 여기서는 단추 하나와 정밀도 셋 중 하나를 고를 뿐이다.
// 결과는 두 창이 함께 보는 자리(lib/shared.ts)에 올린다 — 디스크에 저장되고 오버레이 창이 받는다. 앱을 다시 켜도 보인다.
// 계산 중에는 진행 패널이 보이고 이전 결과는 그대로 남는다. 계정이 없으면 계산 단추 대신 「계정 연결」 안내가 보인다.
// P-033: 보기가 둘이다 — 「추천」(지금까지의 화면) · 「기록장」(views/JournalBoard.vue — 모듈 기록과 요격전 기록을 한 화면에서).
// 추천 계산에서 「안 씀」으로 표시한 니케를 빼는 선택이 있다(기본은 빼지 않는다 — 뺐으면 결과에 배지로 남는다).
// 결과는 계산에 쓴 계정의 것으로 저장한다(계정마다 따로다).
import { computed, ref } from 'vue';
import { announceWhile } from '../lib/activity';
import { ANOMALY_BUNDLE } from '../lib/builtin';
import { runInterceptWith } from '../lib/compute';
import { useEngineRun } from '../lib/engineRun';
import { localTime } from '../lib/format';
import { INTERCEPT_VIEWS, RUN_INTERCEPT, useNav, type InterceptView } from '../lib/nav';
import { unusedOwned, usePlan } from '../lib/plan';
import { INTERCEPT_PRECISION, precisionOf, recallPrecision, rememberPrecision, type PrecisionKey } from '../lib/precision';
import { findBoss, useScreenTrack } from '../lib/screenTrack';
import { useShared } from '../lib/shared';
import type { InterceptReport } from '../types';
import EmptyState from '../ui/EmptyState.vue';
import ProgressPanel from '../ui/ProgressPanel.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import StatusPill from '../ui/StatusPill.vue';
import InterceptResult from '../views/InterceptResult.vue';
import JournalBoard from '../views/JournalBoard.vue';
import { recall, remember } from '../lib/remember';

/** 고른 정밀도를 기억하는 이름. */
const PRECISION_KEY = 'intercept.precision';
/** 「안 씀」 니케를 추천에서 뺄지 기억하는 이름('on'이면 뺀다 — 편성 도구의 추천과 같은 이름을 쓴다). */
const EXCLUDE_KEY = 'recommend.exclude-unused';

const shared = useShared();
const nav = useNav();
const track = useScreenTrack();
const engine = useEngineRun(RUN_INTERCEPT);

const precision = ref<PrecisionKey>(recallPrecision(PRECISION_KEY));
const error = ref('');

// 보기(P-033): 추천 · 기록장. 앱을 켜면 추천부터다. 어느 보기인지는 탐색 상태(lib/nav.ts)가 쥔다 — 다른 화면이 보스의 추천을
// 보러 올 때(홈의 카드, 내 니케의 계획판, 자동 추적)는 추천 보기로 연다(nav.openIntercept). 앱 밖에서는 이 화면의 것을 쓴다.
const ownView = ref<InterceptView>('recommend');
const view = computed<InterceptView>(() => nav?.interceptView.value ?? ownView.value);
function show(next: InterceptView): void {
  if (nav) nav.interceptView.value = next;
  else ownView.value = next;
}

// 「안 씀」 니케 빼기(P-033): 내 니케 화면에서 표시한 니케를 추천에서 뺀다. 기본은 빼지 않는다.
const plan = usePlan();
const excludeUnused = ref(recall(EXCLUDE_KEY) === 'on');
/** 「안 씀」으로 표시한 니케의 수(표시한 이름의 수다 — 실제로 뺀 것은 결과에 적힌다). */
const unusedCount = computed(() => plan?.plan.value.unused?.length ?? 0);
function toggleExclude(): void {
  excludeUnused.value = !excludeUnused.value;
  remember(EXCLUDE_KEY, excludeUnused.value ? 'on' : 'off');
}

const report = computed<InterceptReport | null>(() => shared?.intercept.value ?? null);
const ready = computed(() => shared?.ready.value ?? true);
const accountName = computed(() => shared?.accountName.value ?? null);
/** 계정이 여럿인데 어느 것을 쓸지 고르지 않았다. */
const needsChoice = computed(() => !accountName.value && (shared?.snapshot.value?.accounts.length ?? 0) > 1);
const savedAt = computed(() => localTime(shared?.snapshot.value?.intercept_saved_at ?? report.value?.generated_at));

function choose(key: PrecisionKey): void {
  precision.value = key;
  rememberPrecision(PRECISION_KEY, key);
}

/** 진행 패널의 값: 보스마다 같은 몫을 받는다 — 끝낸 보스의 몫 + 지금 보스에서 끝난 건수. */
const progress = computed(() => {
  const boss = engine.boss;
  if (!boss) return { title: '계산을 준비하는 중', detail: '', done: 0, total: 0 };
  const inBoss = Math.min(boss.budget, (engine.stage?.used ?? 0) + (engine.progress?.done ?? 0));
  return {
    title: `${boss.boss.name} 추천 편성을 찾는 중`,
    detail: `보스 ${boss.index + 1}/${boss.total}`,
    done: boss.index * boss.budget + inBoss,
    total: boss.total * boss.budget,
  };
});

// 계산의 진행을 오버레이 창에도 알린다(오버레이가 작게 보여 준다 — 거기서는 계산을 시작하거나 멈추지 못한다).
announceWhile(() => ({
  running: engine.computing,
  label: progress.value.title,
  done: progress.value.done,
  total: progress.value.total,
  elapsed_ms: engine.elapsed * 1000,
}));

/**
 * 자동 추적이 따라간 보스의 추천을 보일 수 없을 때의 안내: 결과가 아직 없거나('none'), 결과에 그 보스가 없다('absent').
 * 보일 수 있으면 null. 어느 쪽이든 계산을 스스로 시작하지 않는다 — 계산은 사용자가 누른다.
 */
const trackedGap = computed<{ kind: 'none' | 'absent'; name: string } | null>(() => {
  const target = track?.enabled.value ? track.target.value : null;
  if (!target) return null;
  if (!report.value) return { kind: 'none', name: target.name };
  return findBoss(report.value.bosses ?? [], target) ? null : { kind: 'absent', name: target.name };
});

async function run(): Promise<void> {
  if (!shared) return;
  const budget = precisionOf(INTERCEPT_PRECISION, precision.value).budget;
  /** 이 계산에 쓴 계정의 이름 — 결과는 이 계정의 것으로 저장한다(계산하는 동안 계정이 바뀌어도). */
  let usedAccount: string | null = null;
  await engine.run<InterceptReport>(
    async (deps) => {
      const read = await shared.loadAccount();
      usedAccount = read.name;
      // 「안 씀」 니케를 빼기로 했으면 이 계정이 가진 것만 추려 넘긴다 — 뺀 것은 결과에 남는다(배지와 계산 조건).
      const exclude = excludeUnused.value ? unusedOwned(plan?.plan.value, read.account) : [];
      return runInterceptWith({ account: read.account, bundle: ANOMALY_BUNDLE, budget, ...(exclude.length ? { exclude } : {}) }, deps);
    },
    {
      // 이전 결과는 계산이 끝날 때까지 그대로 보인다.
      start: () => {
        error.value = '';
      },
      done: (computed) => {
        // 맞지 않는 문서면 던진다 — 알리고 앞서 보이던 결과를 둔다.
        shared.publishIntercept(computed, usedAccount).catch((e: unknown) => {
          error.value = e instanceof Error ? e.message : String(e);
        });
      },
      // 실패해도 앞서 보이던 결과는 그대로 둔다.
      fail: (message) => {
        error.value = message;
      },
    },
  );
}
</script>

<template>
  <div class="nk-page" data-testid="page-intercept">
    <header class="nk-head">
      <h1 class="nk-title">요격전</h1>
      <div class="nk-seg" role="tablist" aria-label="요격전 보기" data-testid="intercept-views">
        <button
          v-for="v in INTERCEPT_VIEWS"
          :key="v.key"
          type="button"
          role="tab"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': view === v.key }"
          :aria-selected="view === v.key"
          :data-testid="`intercept-view-${v.key}`"
          @click="show(v.key)"
        >
          {{ v.label }}
        </button>
      </div>
      <span v-if="view === 'recommend'" class="nk-muted">이상 개체 요격전 — 보스마다 내 니케로 총딜이 가장 큰 편성을 찾는다</span>
      <span v-else class="nk-muted">요격전을 돌고 얻은 것과 대미지 기록 — 날짜별로, 주·월 합계와 보스별 횟수</span>
    </header>

    <SkeletonBlock v-if="!ready" shape="cards" :count="5" label="저장해 둔 추천을 읽는 중" />

    <template v-else>
      <!-- 계정이 없으면 계산 단추 대신 「계정 연결」 안내를 보인다. -->
      <EmptyState
        v-if="!accountName"
        :title="needsChoice ? '어느 계정으로 계산할지 고르지 않았다' : '아직 계정을 연결하지 않았다'"
        :hint="needsChoice ? '설정의 계정 연결에서 계산에 쓸 계정을 고른다.' : '계정을 한 번 연결하면 보유 니케로 보스마다 추천 편성을 찾아 준다.'"
        :action="needsChoice ? '계정 고르기' : '계정 연결하기'"
        data-testid="need-account"
        @action="nav?.openSettings('account')"
      />

      <!-- 기록장(P-033): 모듈 기록과 요격전 기록을 한 화면에서. 계산이 도는 중이면 한 줄로 알린다. -->
      <template v-else-if="view === 'journal'">
        <p v-if="engine.computing" class="nk-note" role="status" data-testid="journal-computing">추천을 계산하는 중이다 — 추천 보기에서 진행을 볼 수 있다.</p>
        <JournalBoard />
      </template>

      <section v-else class="nk-card" aria-label="추천 계산" data-testid="intercept-controls">
        <div class="nk-row">
          <span class="nk-muted" data-testid="account-line">계정 <strong>{{ accountName }}</strong></span>
          <span class="nk-spacer"></span>
          <div class="nk-seg" role="radiogroup" aria-label="정밀도">
            <button
              v-for="choice in INTERCEPT_PRECISION"
              :key="choice.key"
              type="button"
              role="radio"
              class="nk-seg__item"
              :class="{ 'nk-seg__item--on': precision === choice.key }"
              :aria-checked="precision === choice.key"
              :title="choice.hint"
              :disabled="engine.computing"
              :data-testid="`precision-${choice.key}`"
              @click="choose(choice.key)"
            >
              {{ choice.label }}
              <span class="nk-seg__sub">{{ choice.time }}</span>
            </button>
          </div>
          <!-- 누르면 켜지고 다시 누르면 꺼진다(입력 칸이 아니라 단추다 — 이 화면에는 기록 칸 말고 입력 칸을 두지 않는다). -->
          <button
            v-if="plan"
            type="button"
            class="nk-btn nk-btn--quiet"
            :class="{ 'intercept__toggle--on': excludeUnused }"
            :aria-pressed="excludeUnused"
            :disabled="engine.computing"
            title="내 니케 화면에서 「안 씀」으로 표시한 니케를 추천에서 뺀다 — 뺀 니케는 결과에 적힌다"
            data-testid="exclude-unused"
            @click="toggleExclude"
          >
            {{ excludeUnused ? '「안 씀」 니케 빼는 중' : '「안 씀」 니케 빼기' }} <span data-testid="unused-count">({{ unusedCount }}명)</span>
          </button>
          <button
            type="button"
            class="nk-btn nk-btn--primary"
            :disabled="engine.computing || engine.busyElsewhere"
            :title="engine.busyElsewhere ? '다른 화면에서 계산이 돌고 있다 — 끝난 뒤에 누른다' : undefined"
            data-testid="run-intercept"
            @click="run"
          >
            {{ report ? '다시 계산' : '추천 계산' }}
          </button>
        </div>
        <p v-if="engine.busyElsewhere" class="nk-muted" data-testid="busy-elsewhere">다른 화면에서 계산이 돌고 있다. 끝나면 여기서 계산할 수 있다.</p>
      </section>

      <template v-if="view === 'recommend' || !accountName">
      <ProgressPanel
        v-if="engine.computing"
        :title="progress.title"
        :detail="progress.detail"
        :done="progress.done"
        :total="progress.total"
        :elapsed-ms="engine.elapsed * 1000"
        :stopping="engine.stopping"
        @stop="engine.stop"
      />
      <p v-else-if="engine.stopped" class="nk-note" role="status" data-testid="stopped-note">계산을 중단했다. 앞서 보이던 추천은 그대로다.</p>

      <p v-if="error" class="nk-error" role="alert" data-testid="error">
        <strong>추천 편성을 찾지 못했다.</strong> {{ error }} 다시 계산을 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.
      </p>
      <p v-if="shared?.interceptProblem.value" class="nk-error" role="alert" data-testid="result-problem">{{ shared.interceptProblem.value }}</p>

      <p v-if="trackedGap" class="nk-note" role="status" data-testid="track-need-run">
        게임에서 보고 있는 보스: <strong>{{ trackedGap.name }}</strong> —
        <template v-if="trackedGap.kind === 'none'">아직 추천이 없다. 추천 계산을 누르면 찾아 준다</template>
        <template v-else>지금 추천에는 이 보스가 없다. 다시 계산을 누르면 찾아 준다</template>
        (스스로 계산을 시작하지 않는다).
      </p>

      <template v-if="report">
        <p v-if="engine.computing" class="nk-muted" data-testid="stale-note">아래는 이전 추천이다 — 새 계산이 끝나면 바뀐다.</p>
        <p v-else-if="shared?.restored.value" class="nk-muted" data-testid="restored-note">
          앞서 계산해 둔 추천이다{{ savedAt ? ` (${savedAt})` : '' }}. 계정을 새로 받았으면 다시 계산한다.
        </p>
        <InterceptResult :report="report" />
      </template>
      <div v-else-if="accountName && !engine.computing && !error" class="nk-card" data-testid="hint">
        <div class="nk-row">
          <StatusPill label="계산 전" />
          <span>보스 5종의 추천 편성을 아직 찾지 않았다. 정밀도를 고르고 「추천 계산」을 누른다 — 창을 닫지 않으면 다른 화면을 봐도 계속 계산한다.</span>
        </div>
      </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* 켜 둔 선택: 강조색 테두리(색만으로 알리지 않는다 — 글자도 「빼는 중」으로 바뀐다). */
.intercept__toggle--on {
  border-color: var(--nk-accent);
  background: var(--nk-accent-soft);
  color: var(--nk-text);
}
</style>
