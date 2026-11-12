<script setup lang="ts">
// 육성 효율(P-031 — 편성 도구의 「육성 효율」 탭): 「무엇을 올리면 딜이 얼마나 오르나」를 후보를 손으로 쓰지 않고 본다.
//   기준 편성(덱 빌더의 지금 편성 또는 요격전 1위 편성)과 상대를 고른다 →
//   육성 효율표        니케마다 한 단계 올릴 수 있는 것을 하나씩 계산해 총딜 증가율 순으로(초상화 · 무엇을 올리는지 · 막대)
//   오버로드 옵션 바꿔 보기  니케 한 명의 부위별 옵션 줄을 바꿔 그 편성의 총딜 변화를 본다(계정은 바뀌지 않는다)
//   큐브 바꿔 보기      니케마다 큐브를 바꿔 본 총딜과 「이 편성에 맞는 큐브」
// 계산 규칙은 여기에 없다 — 루트의 순수 모듈(src/core/efficiency.mjs)이 하고, 그 안에서 성장 비교(compareGrowth)를 그대로 쓴다.
// 숨기면 안 되는 표시(추정 · 비용을 모른다는 것 · 보유 큐브를 모른다는 것 · 지원하지 않음 · 계산하지 못함)는 접힌 구획 밖이다.
import { computed, ref, shallowRef, watch } from 'vue';
import { errorMessage } from '../lib/backend';
import { runCubeCompare, runEfficiency, runOverloadTrial } from '../lib/compute';
import { deckKey, FALLBACK_OPPONENT, normalizeSlots, opponentOptions, recallWorking, resolveOpponent, useDecks, type Slots } from '../lib/deck';
import {
  cubePreview,
  cubesOf,
  DEFAULT_CUBE,
  DEFAULT_CUBE_LIMIT,
  DEFAULT_EFFICIENCY_LIMIT,
  layoutParts,
  overloadOf,
  partsCheck,
  summarize,
  summaryText,
  trialKey,
  upgradePreview,
} from '../lib/efficiency';
import { useEngineRun } from '../lib/engineRun';
import { damageUnit, engineLabel, signedPercent } from '../lib/format';
import { RUN_EFFICIENCY, useNav } from '../lib/nav';
import { recall, remember } from '../lib/remember';
import { useShared } from '../lib/shared';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { AccountRead, CubeReport, EfficiencyReport, EngineVersion, OverloadPart, OverloadTrialReport } from '../types';
import DetailsFold from '../ui/DetailsFold.vue';
import EmptyState from '../ui/EmptyState.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import ProgressPanel from '../ui/ProgressPanel.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import StatusPill from '../ui/StatusPill.vue';
import CubeBoard from './CubeBoard.vue';
import DeckOpponent from './DeckOpponent.vue';
import EfficiencyList from './EfficiencyList.vue';
import OverloadEditor from './OverloadEditor.vue';

/** 기준 편성을 어디서 가져오는지 기억하는 이름. */
const SOURCE_KEY = 'efficiency.source';
type Source = 'deck' | 'intercept';

const shared = useShared();
const nav = useNav();
const decks = useDecks();
const { catalog, info } = useNikkeCatalog();
const engine = useEngineRun(RUN_EFFICIENCY);

// ── 계정 ──────────────────────────────────────────────────────────────────────
// 계정 문서는 통째로 갈아 끼운다 — 계산 코드에 보통 객체로 넘어가야 결과를 다시 쓸 수 있다.
const read = shallowRef<AccountRead | null>(null);
const loading = ref(false);
const accountError = ref('');
let readSeq = 0;
const accountName = computed(() => shared?.accountName.value ?? null);
const ready = computed(() => shared?.ready.value ?? true);

async function load(): Promise<void> {
  if (!shared || !accountName.value) {
    read.value = null;
    return;
  }
  const mine = ++readSeq;
  loading.value = true;
  accountError.value = '';
  try {
    const next = await shared.loadAccount();
    if (mine === readSeq) read.value = next;
  } catch (e) {
    if (mine === readSeq) accountError.value = errorMessage(e);
  } finally {
    if (mine === readSeq) loading.value = false;
  }
}
if (shared) watch([shared.accountName, shared.accountSavedAt], load, { immediate: true });

// ── 기준 편성과 상대 ──────────────────────────────────────────────────────────
const source = ref<Source>(recall(SOURCE_KEY) === 'intercept' ? 'intercept' : 'deck');
/** 요격전 추천 결과에서 1위 편성이 있는 보스. */
const bosses = computed(() => (shared?.intercept.value?.bosses ?? []).filter((b) => (b.ranking ?? []).length > 0));
const bossId = ref<string | null>(null);
const boss = computed(() => bosses.value.find((b) => b.id === bossId.value) ?? bosses.value[0] ?? null);
// 요격전 결과가 없는데 「요격전 1위 편성」을 기억하고 있으면 덱 빌더의 편성으로 돌아간다.
watch(
  [bosses, ready],
  () => {
    if (ready.value && source.value === 'intercept' && bosses.value.length === 0) source.value = 'deck';
  },
  { immediate: true },
);

/** 덱 빌더에서 지금 짜고 있는 편성(덱 빌더를 아직 열지 않았으면 지난번에 짜던 것). */
const working = computed(() => decks?.working.value ?? recallWorking());
const squad = computed<Slots>(() => {
  if (source.value === 'intercept') return normalizeSlots(boss.value?.ranking[0]?.members.map((m) => m.name) ?? []);
  return working.value.slots;
});
const members = computed(() => squad.value.filter((m): m is string => m !== null));
const full = computed(() => members.value.length === squad.value.length);
const missing = computed(() => (read.value ? members.value.filter((m) => !Object.hasOwn(read.value!.account.nikkes, m)) : []));

const options = computed(() => opponentOptions(catalog.value));
/** 사용자가 직접 고른 상대. 고르지 않았으면 기준 편성을 따른다(덱 빌더의 상대 · 그 요격전 보스). */
const picked = ref<string | null>(null);
const defaultOpponent = computed(() => {
  const wanted = source.value === 'intercept' ? (boss.value ? `boss:${boss.value.id}` : null) : working.value.opponent;
  if (wanted && resolveOpponent(wanted, catalog.value)) return wanted;
  return options.value.find((o) => o.kind === 'preset')?.key ?? FALLBACK_OPPONENT;
});
const opponentKey = computed<string | null>({
  get: () => (picked.value && resolveOpponent(picked.value, catalog.value) ? picked.value : defaultOpponent.value),
  set: (next) => {
    picked.value = next;
  },
});
const opponent = computed(() => resolveOpponent(opponentKey.value, catalog.value));
const weakTo = computed(() => (opponent.value?.element.known ? opponent.value.element.weak_to : null));
const isWeak = (name: string) => weakTo.value !== null && info(name).element === weakTo.value;

function chooseSource(next: Source): void {
  source.value = next;
  picked.value = null;
  remember(SOURCE_KEY, next);
}
function chooseBoss(id: string): void {
  bossId.value = id;
  picked.value = null;
}

const key = computed(() => deckKey(squad.value, opponentKey.value));
const canRun = computed(() => full.value && missing.value.length === 0 && opponent.value !== null && read.value !== null && !engine.computing && !engine.busyElsewhere);
const whyNot = computed(() => {
  if (engine.busyElsewhere) return '다른 화면에서 계산이 돌고 있다 — 끝난 뒤에 누른다';
  if (!full.value) return `기준 편성의 다섯 자리가 모두 차야 계산할 수 있다(지금 ${members.value.length}명)`;
  if (missing.value.length) return `이 계정에 없는 니케가 기준 편성에 있다: ${missing.value.join(', ')}`;
  if (!opponent.value) return '상대를 먼저 고른다';
  return undefined;
});

// ── 계산 ──────────────────────────────────────────────────────────────────────
type Job = 'table' | 'overload' | 'cube';
const job = ref<Job>('table');
const error = ref('');
const JOB_TITLE: Record<Job, string> = { table: '한 단계씩 올려 보는 중', overload: '오버로드 옵션을 바꿔 계산하는 중', cube: '큐브를 바꿔 끼워 보는 중' };
const JOB_FAIL: Record<Job, string> = { table: '효율표를 계산하지 못했다.', overload: '바꾼 옵션으로 계산하지 못했다.', cube: '큐브를 견주지 못했다.' };
const progress = computed(() => ({ title: JOB_TITLE[job.value], done: engine.progress?.done ?? 0, total: engine.progress?.total ?? 0 }));
const input = () => ({ account: read.value!.account, opponent: opponent.value!, members: [...squad.value] });
const handlers = <T,>(done: (result: T) => void) => ({
  start: () => {
    error.value = '';
  },
  done,
  fail: (message: string) => {
    error.value = message;
  },
});

// 육성 효율표
/** 한 니케만 볼 때 그 이름(없으면 편성 전체). 편성에서 빠진 니케를 가리키면 전체로 본다. */
const onlyPick = ref<string | null>(null);
const only = computed(() => (onlyPick.value && members.value.includes(onlyPick.value) ? onlyPick.value : null));
const table = shallowRef<EfficiencyReport | null>(null);
const tableFresh = computed(() => table.value !== null && table.value.key === key.value && table.value.only === only.value);
const preview = computed(() => upgradePreview(read.value?.account, squad.value, catalog.value, only.value));
const tableHint = computed(() => {
  const count = preview.value.candidates.length;
  if (count === 0) return '한 단계 올릴 수 있는 칸이 없다';
  const over = count - DEFAULT_EFFICIENCY_LIMIT;
  return `한 단계 올릴 수 있는 것 ${Math.min(count, DEFAULT_EFFICIENCY_LIMIT)}개를 하나씩 계산한다${over > 0 ? ` (${over}개는 한 번에 보는 수를 넘어 보지 않는다)` : ''}`;
});

async function runTable(): Promise<void> {
  if (!canRun.value) return;
  job.value = 'table';
  const args = { ...input(), only: only.value, limit: DEFAULT_EFFICIENCY_LIMIT };
  await engine.run<EfficiencyReport>((deps) => runEfficiency(args, deps), handlers((result) => (table.value = result)));
}

// 오버로드 옵션 바꿔 보기
const olPick = ref<string | null>(null);
const olNikke = computed(() => (olPick.value && members.value.includes(olPick.value) ? olPick.value : (members.value[0] ?? null)));
const olEntry = computed(() => (olNikke.value ? (read.value?.account.nikkes[olNikke.value] ?? null) : null));
const olRead = computed(() => overloadOf(olEntry.value));
const olEditable = computed(() => olRead.value.status === 'lines' || olRead.value.status === 'unknown');
const parts = ref<OverloadPart[]>(layoutParts([]));
// 니케를 바꾸거나 계정을 새로 읽으면 그 니케의 계정 값에서 다시 시작한다.
watch([olNikke, olEntry], () => (parts.value = layoutParts(olRead.value.lines)), { immediate: true });
const built = computed(() => partsCheck(parts.value));
const olChanged = computed(() => JSON.stringify(summarize(built.value.lines)) !== JSON.stringify(summarize(olRead.value.lines)));
const trial = shallowRef<OverloadTrialReport | null>(null);
const trialFresh = computed(() => trial.value !== null && trial.value.key === trialKey(squad.value, opponentKey.value, olNikke.value, built.value.lines));
function resetParts(): void {
  parts.value = layoutParts(olRead.value.lines);
}

async function runOverload(): Promise<void> {
  const nikke = olNikke.value;
  if (!canRun.value || !nikke || !olEditable.value || built.value.problems.length) return;
  job.value = 'overload';
  const args = { ...input(), nikke, parts: parts.value.map((p) => ({ part: p.part, lines: p.lines.map((l) => (l ? { ...l } : null)) })) };
  await engine.run<OverloadTrialReport>((deps) => runOverloadTrial(args, deps), handlers((result) => (trial.value = result)));
}

// 큐브
const cubes = computed(() => cubesOf(catalog.value));
const cubePick = ref<string | null>(null);
const cubeOnly = computed(() => (cubePick.value && members.value.includes(cubePick.value) ? cubePick.value : null));
const cubeReport = shallowRef<CubeReport | null>(null);
const cubeFresh = computed(() => cubeReport.value !== null && cubeReport.value.key === key.value && cubeReport.value.only === cubeOnly.value);
// 계정을 바꾸면 앞 계정으로 낸 결과 셋은 치운다(P-033 — 같은 편성이어도 계정마다 육성이 다르다).
watch(accountName, () => {
  table.value = null;
  trial.value = null;
  cubeReport.value = null;
});
const cubePlan = computed(() => cubePreview(read.value?.account, squad.value, catalog.value, cubeOnly.value));
const cubeHint = computed(() => {
  if (!cubes.value.known) return '큐브 목록을 읽지 못해 큐브를 바꿔 볼 수 없다';
  if (cubePlan.value.count === 0) return '바꿔 볼 큐브가 없다';
  return `큐브를 하나씩 바꿔 끼워 ${cubePlan.value.count}번 계산한다${cubePlan.value.skipped.length ? ` (큐브 ${cubePlan.value.skipped.length}종은 한 번에 보는 수를 넘어 보지 않는다)` : ''}`;
});

async function runCubes(): Promise<void> {
  if (!canRun.value || !cubes.value.known || cubePlan.value.count === 0) return;
  job.value = 'cube';
  const args = { ...input(), only: cubeOnly.value, limit: DEFAULT_CUBE_LIMIT };
  await engine.run<CubeReport>((deps) => runCubeCompare(args, deps), handlers((result) => (cubeReport.value = result)));
}

/** 「계산 조건」에 든 것: 지금 보이는 결과들의 가정과 주의(같은 문장은 한 번만). */
const conditions = computed(() => {
  const reports: { assumptions: string[]; caveats: string[]; engine?: EngineVersion | null }[] = [];
  if (tableFresh.value && table.value) reports.push(table.value);
  if (trialFresh.value && trial.value) reports.push(trial.value);
  if (cubeFresh.value && cubeReport.value) reports.push(cubeReport.value);
  const uniq = (lists: string[][]) => [...new Set(lists.flat())];
  return { assumptions: uniq(reports.map((r) => r.assumptions)), caveats: uniq(reports.map((r) => r.caveats)), engine: reports[0]?.engine ?? null };
});
const conditionCount = computed(() => (opponent.value?.unconfirmed.length ?? 0) + (opponent.value?.notes.length ?? 0) + conditions.value.assumptions.length + conditions.value.caveats.length);
</script>

<template>
  <div class="lab" data-testid="growth-lab">
    <SkeletonBlock v-if="!ready || (loading && !read)" shape="tiles" :count="5" label="계정을 읽는 중" />

    <EmptyState
      v-else-if="!accountName"
      title="아직 계정을 연결하지 않았다"
      hint="계정을 연결하면 무엇을 올릴 때 딜이 가장 많이 오르는지 계산해 볼 수 있다."
      action="계정 연결하기"
      data-testid="lab-need-account"
      @action="nav?.openSettings('account')"
    />

    <EmptyState
      v-else-if="accountError && !read"
      tone="error"
      title="계정을 읽지 못했다"
      :hint="`${accountError} 설정의 계정 연결에서 계정을 새로 받아 본다.`"
      action="계정 연결 열기"
      data-testid="lab-account-error"
      @action="nav?.openSettings('account')"
    />

    <template v-else-if="read">
      <!-- 기준 편성 -->
      <section class="nk-card" aria-label="기준 편성" data-testid="lab-squad">
        <div class="nk-row">
          <h2 class="nk-subtitle">기준 편성</h2>
          <div class="nk-seg" role="radiogroup" aria-label="기준 편성을 가져올 곳">
            <button type="button" role="radio" class="nk-seg__item" :class="{ 'nk-seg__item--on': source === 'deck' }" :aria-checked="source === 'deck'" :disabled="engine.computing" data-testid="lab-source-deck" @click="chooseSource('deck')">
              덱 빌더의 지금 편성
            </button>
            <button
              type="button"
              role="radio"
              class="nk-seg__item"
              :class="{ 'nk-seg__item--on': source === 'intercept' }"
              :aria-checked="source === 'intercept'"
              :disabled="engine.computing || bosses.length === 0"
              :title="bosses.length === 0 ? '요격전 화면에서 추천을 계산하면 고를 수 있다' : undefined"
              data-testid="lab-source-intercept"
              @click="chooseSource('intercept')"
            >
              요격전 1위 편성
            </button>
          </div>
          <span class="nk-spacer"></span>
          <StatusPill v-if="read.account.is_test_data" label="검증용 데이터" tone="test" solid data-testid="data-kind" />
          <span class="nk-muted" data-testid="account-line">계정 <strong>{{ read.account.name ?? read.name }}</strong></span>
        </div>

        <div v-if="source === 'intercept'" class="nk-seg" role="radiogroup" aria-label="보스">
          <button
            v-for="b in bosses"
            :key="b.id"
            type="button"
            role="radio"
            class="nk-seg__item"
            :class="{ 'nk-seg__item--on': boss?.id === b.id }"
            :aria-checked="boss?.id === b.id"
            :disabled="engine.computing"
            :data-id="b.id"
            data-testid="lab-boss"
            @click="chooseBoss(b.id)"
          >
            {{ b.name }}
          </button>
        </div>

        <div v-if="members.length" class="lab__tiles" data-testid="lab-members">
          <span v-for="(name, i) in squad" :key="i" class="lab__member" :data-name="name ?? undefined" data-testid="lab-member">
            <NikkeTile v-if="name" :name="name" size="sm" :element="info(name).element" :burst="info(name).burst" :weak="isWeak(name)" />
            <span v-else class="nk-muted">빈 자리</span>
          </span>
        </div>
        <p v-if="!full" class="nk-note" role="status" data-testid="lab-need-squad">
          {{ source === 'deck' ? `덱 빌더의 편성이 아직 다섯 명이 아니다(지금 ${members.length}명). 덱 빌더에서 다섯 자리를 채우거나, 요격전 추천을 계산한 뒤 「요격전 1위 편성」을 고른다.` : '이 보스의 추천 편성이 다섯 명이 아니다.' }}
          <button v-if="source === 'deck'" type="button" class="nk-btn" data-testid="lab-open-deck" @click="nav?.openTool('deck')">덱 빌더 열기</button>
        </p>
        <p v-if="missing.length" class="nk-note" role="status" data-testid="lab-missing">이 계정에 없는 니케가 기준 편성에 있어 계산할 수 없다: {{ missing.join(', ') }}</p>
        <p v-if="engine.busyElsewhere" class="nk-muted" data-testid="busy-elsewhere">다른 화면에서 계산이 돌고 있다. 끝나면 여기서 계산할 수 있다.</p>
      </section>

      <DeckOpponent v-model="opponentKey" :options="options" :opponent="opponent" :disabled="engine.computing" />

      <!-- 진행 · 중단 · 오류(세 계산이 함께 쓴다) -->
      <ProgressPanel
        v-if="engine.computing"
        :title="progress.title"
        :done="progress.done"
        :total="progress.total"
        :elapsed-ms="engine.elapsed * 1000"
        :stopping="engine.stopping"
        @stop="engine.stop"
      />
      <p v-else-if="engine.stopped" class="nk-note" role="status" data-testid="stopped-note">계산을 중단했다. 앞서 보이던 결과는 그대로다.</p>
      <p v-if="error" class="nk-error" role="alert" data-testid="lab-error">
        <strong>{{ JOB_FAIL[job] }}</strong> {{ error }} 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.
      </p>

      <!-- 육성 효율표 -->
      <section class="nk-card" aria-label="육성 효율표" data-testid="eff-panel" :data-fresh="tableFresh ? 'yes' : 'no'">
        <div class="nk-row">
          <h2 class="nk-subtitle">육성 효율표</h2>
          <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
          <StatusPill label="비용 미반영" tone="unknown" detail="재화와 필요 수량의 표가 이 앱에 없다. 순위는 총딜이 느는 정도만 본 것이다." data-testid="cost-pill" />
          <span class="nk-spacer"></span>
          <button type="button" class="nk-btn nk-btn--primary" :disabled="!canRun || preview.candidates.length === 0" :title="whyNot ?? tableHint" data-testid="eff-run" @click="runTable">
            {{ tableFresh ? '다시 계산' : '효율표 계산' }}
          </button>
        </div>
        <!-- 비용을 모른다는 것은 언제나 보인다(접지 않는다). -->
        <p class="lab__cost" data-testid="eff-cost">
          비용은 모른다 — 재화와 필요 수량의 표가 이 앱에 없다. 아래 순위는 「한 단계 올렸을 때 총딜이 얼마나 느는가」일 뿐이고, 싸게 올릴 수 있는지는 반영하지 않았다.
        </p>
        <div class="nk-seg" role="radiogroup" aria-label="볼 니케">
          <button type="button" role="radio" class="nk-seg__item" :class="{ 'nk-seg__item--on': only === null }" :aria-checked="only === null" :disabled="engine.computing" data-name="" data-testid="eff-only" @click="onlyPick = null">
            편성 전체
          </button>
          <button
            v-for="name in members"
            :key="name"
            type="button"
            role="radio"
            class="nk-seg__item"
            :class="{ 'nk-seg__item--on': only === name }"
            :aria-checked="only === name"
            :disabled="engine.computing"
            :data-name="name"
            data-testid="eff-only"
            @click="onlyPick = name"
          >
            {{ name }}
          </button>
        </div>
        <p class="nk-muted" data-testid="eff-hint">
          스킬 1·2·버스트 레벨, 돌파, 코어 강화, 소장품 단계, 오버로드 줄을 한 단계씩 올려 본다. 이미 최대인 칸은 보지 않는다. {{ tableHint }}.
        </p>
        <template v-if="table">
          <p v-if="!tableFresh" class="nk-note" role="status" data-testid="eff-stale">기준 편성이나 상대, 볼 니케가 바뀌었다 — 아래 표는 바꾸기 전의 것이다. 「효율표 계산」을 누르면 다시 계산한다.</p>
          <div :class="{ 'lab__stale': !tableFresh }">
            <EfficiencyList :report="table" :info="info" :weak-to="weakTo" />
          </div>
          <p v-if="tableFresh && table.cache && table.cache.misses === 0" class="nk-muted" data-testid="eff-reused">앞서 계산해 둔 결과를 바로 가져왔다.</p>
        </template>
      </section>

      <!-- 오버로드 옵션 바꿔 보기 -->
      <section class="nk-card" aria-label="오버로드 옵션 바꿔 보기" data-testid="ol-panel">
        <div class="nk-row">
          <h2 class="nk-subtitle">오버로드 옵션 바꿔 보기</h2>
          <StatusPill label="추정" tone="estimate" detail="계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." />
          <span class="nk-spacer"></span>
          <button type="button" class="nk-btn" :disabled="engine.computing || !olChanged" data-testid="ol-reset" @click="resetParts">계정 값으로 되돌리기</button>
          <button
            type="button"
            class="nk-btn nk-btn--primary"
            :disabled="!canRun || !olEditable || built.problems.length > 0"
            :title="whyNot ?? '이 옵션으로 바꿨을 때 편성의 총딜을 계산한다 — 계정은 바뀌지 않는다'"
            data-testid="ol-run"
            @click="runOverload"
          >
            바꿔서 계산
          </button>
        </div>
        <div class="nk-seg" role="radiogroup" aria-label="옵션을 바꿔 볼 니케">
          <button
            v-for="name in members"
            :key="name"
            type="button"
            role="radio"
            class="nk-seg__item"
            :class="{ 'nk-seg__item--on': olNikke === name }"
            :aria-checked="olNikke === name"
            :disabled="engine.computing"
            :data-name="name"
            data-testid="ol-nikke"
            @click="olPick = name"
          >
            {{ name }}
          </button>
        </div>
        <p class="nk-muted" data-testid="ol-help">
          계정은 바뀌지 않는다 — 여기서만 바꿔 본다. 어느 부위에 어느 옵션이 붙었는지는 계정 정보에 없어 줄 수에 맞춰 차례로 놓았다(같은 줄을 다른 부위로 옮겨도 총딜은 같다). 줄 수만 적힌 줄은 레벨 10으로 본다.
        </p>
        <template v-if="olNikke">
          <p v-if="olRead.status === 'unknown'" class="nk-note" data-testid="ol-unknown">
            <StatusPill label="미확인" tone="unknown" /> {{ olNikke }}의 오버로드는 계정에서 확인하지 못했다 — 빈 줄에서 시작하고, 지금 값은 옵션이 없는 것으로 계산한다(늘어나는 정도가 실제보다 크게 나올 수 있다).
          </p>
          <p v-if="!olEditable" class="nk-note" data-testid="ol-unsupported"><StatusPill label="지원하지 않음" tone="unknown" /> {{ olRead.reason }}</p>
          <template v-else>
            <OverloadEditor v-model:parts="parts" :disabled="engine.computing" />
            <p class="lab__summary" data-testid="ol-summary">
              <span class="nk-muted">지금</span> <span data-testid="ol-before">{{ summaryText(summarize(olRead.lines)) }}</span>
              <span class="nk-muted">→ 바꾼 것</span> <strong data-testid="ol-after">{{ summaryText(summarize(built.lines)) }}</strong>
              <span class="nk-muted" data-testid="ol-count">({{ built.count }}줄)</span>
            </p>
            <p v-for="(p, i) in built.problems" :key="`p${i}`" class="nk-error" role="alert" data-testid="ol-problem">{{ p }}</p>
            <p v-for="(n, i) in built.notes" :key="`n${i}`" class="nk-note" data-testid="ol-note">{{ n }}</p>
          </template>
        </template>

        <div v-if="trial && trial.nikke === olNikke" class="lab__result" :class="{ 'lab__stale': !trialFresh }" :data-fresh="trialFresh ? 'yes' : 'no'" :data-status="trial.status" data-testid="ol-result">
          <p v-if="!trialFresh" class="nk-note" role="status" data-testid="ol-stale">옵션이나 편성, 상대가 바뀌었다 — 아래 숫자는 바꾸기 전의 것이다.</p>
          <template v-if="trial.status === 'computed'">
            <span class="nk-row">
              <span class="nk-muted">총딜</span>
              <span data-testid="ol-total">{{ damageUnit(trial.total_before) }} → {{ damageUnit(trial.total_after) }}</span>
              <strong class="lab__change" :data-tone="(trial.gain ?? 0) > 0 ? 'ok' : (trial.gain ?? 0) < 0 ? 'error' : 'neutral'" data-testid="ol-change">{{ trial.gain_rate === null ? '–' : signedPercent(trial.gain_rate) }}</strong>
              <StatusPill label="추정" tone="estimate" solid />
            </span>
            <span class="nk-muted" data-testid="ol-what">{{ summaryText(trial.before.options) }} → {{ summaryText(trial.after.options) }}</span>
          </template>
          <p v-else-if="trial.status === 'same'" class="nk-note" data-testid="ol-same">지금 계정의 옵션과 같다 — 달라지는 것이 없다({{ damageUnit(trial.total_before) }}).</p>
          <p v-else class="nk-note" data-testid="ol-failed"><StatusPill label="계산하지 못함" tone="error" solid /> 이 옵션으로는 계산하지 못했다(0으로 치지 않는다). {{ trial.reason }}</p>
          <p v-for="(n, i) in trial.notes" :key="i" class="nk-muted" data-testid="ol-result-note">{{ n }}</p>
        </div>
      </section>

      <!-- 큐브 바꿔 보기 -->
      <section class="nk-card" aria-label="큐브 바꿔 보기" data-testid="cube-panel" :data-fresh="cubeFresh ? 'yes' : 'no'">
        <div class="nk-row">
          <h2 class="nk-subtitle">큐브 바꿔 보기</h2>
          <StatusPill label="추정" tone="estimate" detail="계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." />
          <StatusPill v-if="cubes.unsupported.length" :label="`지원하지 않는 큐브 ${cubes.unsupported.length}종`" tone="unknown" :detail="`계산 도구가 효과를 계산하지 못해 견주지 않는다: ${cubes.unsupported.map((c) => c.name).join(', ')}`" data-testid="cube-unsupported-pill" />
          <span class="nk-spacer"></span>
          <button type="button" class="nk-btn nk-btn--primary" :disabled="!canRun || !cubes.known || cubePlan.count === 0" :title="whyNot ?? cubeHint" data-testid="cube-run" @click="runCubes">
            {{ cubeFresh ? '다시 견주기' : '큐브 견줘 보기' }}
          </button>
        </div>
        <div class="nk-seg" role="radiogroup" aria-label="큐브를 바꿔 볼 니케">
          <button type="button" role="radio" class="nk-seg__item" :class="{ 'nk-seg__item--on': cubeOnly === null }" :aria-checked="cubeOnly === null" :disabled="engine.computing" data-name="" data-testid="cube-only" @click="cubePick = null">
            편성 전체
          </button>
          <button
            v-for="name in members"
            :key="name"
            type="button"
            role="radio"
            class="nk-seg__item"
            :class="{ 'nk-seg__item--on': cubeOnly === name }"
            :aria-checked="cubeOnly === name"
            :disabled="engine.computing"
            :data-name="name"
            data-testid="cube-only"
            @click="cubePick = name"
          >
            {{ name }}
          </button>
        </div>
        <!-- 큐브를 어떻게 계산하는지와 한계는 언제나 보인다. -->
        <p class="nk-muted" data-testid="cube-help">
          계산 도구는 니케마다 큐브를 바꿔 계산할 수 있다. 계정에 니케의 큐브가 적혀 있지 않으면 기본 큐브({{ DEFAULT_CUBE.name }} Lv.{{ DEFAULT_CUBE.level }})를 낀 것으로 계산한다. 계정 정보에는 계정을 받을 때 끼고 있던 큐브만
          있다 — 추천한 큐브를 갖고 있는지, 몇 레벨인지는 이 앱이 모른다. 바꿔 본 큐브는 지금 큐브와 같은 레벨로 계산한다. {{ cubeHint }}.
        </p>
        <p v-if="catalog && !cubes.known" class="nk-note" data-testid="cube-unknown">큐브 목록을 읽지 못해 큐브를 바꿔 볼 수 없다. 설정의 계산 도구에서 문제를 확인한다.</p>
        <template v-if="cubeReport">
          <p v-if="!cubeFresh" class="nk-note" role="status" data-testid="cube-stale">기준 편성이나 상대, 볼 니케가 바뀌었다 — 아래는 바꾸기 전의 것이다. 「큐브 견줘 보기」를 누르면 다시 계산한다.</p>
          <div :class="{ 'lab__stale': !cubeFresh }">
            <CubeBoard :report="cubeReport" :info="info" />
          </div>
        </template>
      </section>

      <DetailsFold summary="계산 조건" :count="conditionCount" :tone="opponent && (opponent.unconfirmed.length || opponent.flags.length) ? 'unknown' : 'neutral'" data-testid="lab-conditions">
        <template v-if="opponent">
          <p class="nk-list__head">상대</p>
          <ul class="nk-list">
            <li v-for="(n, i) in opponent.notes" :key="`n${i}`" data-testid="opponent-note">{{ n }}</li>
          </ul>
          <template v-if="opponent.unconfirmed.length">
            <p class="nk-list__head">미확인 값 — 이렇게 계산했다</p>
            <ul class="nk-list" data-testid="unconfirmed">
              <li v-for="u in opponent.unconfirmed" :key="u.field" data-testid="unconfirmed-item">{{ u.label }}: {{ u.text }}</li>
            </ul>
          </template>
        </template>
        <template v-if="conditions.assumptions.length">
          <p class="nk-list__head">가정</p>
          <ul class="nk-list" data-testid="assumptions">
            <li v-for="(a, i) in conditions.assumptions" :key="`a${i}`" data-testid="assumption-item">{{ a }}</li>
          </ul>
        </template>
        <template v-if="conditions.caveats.length">
          <p class="nk-list__head">주의</p>
          <ul class="nk-list" data-testid="caveats">
            <li v-for="(c, i) in conditions.caveats" :key="`c${i}`" data-testid="caveat-item">{{ c }}</li>
          </ul>
        </template>
        <template v-if="conditions.engine">
          <p class="nk-list__head">계산 정보</p>
          <ul class="nk-list">
            <li data-testid="engine-version">계산 도구: {{ engineLabel(conditions.engine) }}</li>
          </ul>
        </template>
      </DetailsFold>
    </template>
  </div>
</template>

<style scoped>
.lab {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-5);
  min-width: 0;
}

.lab__tiles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-3);
}

.lab__member {
  display: inline-flex;
  align-items: center;
}

.lab__cost {
  margin: 0;
  color: var(--nk-unknown);
  overflow-wrap: anywhere;
}

.lab__stale {
  opacity: 0.55;
}

.lab__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-2);
  margin: 0;
  overflow-wrap: anywhere;
}

.lab__result {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-accent);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.lab__change {
  color: var(--nk-tone);
  font-size: var(--nk-font-lg);
}
</style>
