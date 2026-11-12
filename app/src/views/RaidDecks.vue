<script setup lang="ts">
// 레이드 5덱(P-014 — 편성 도구의 「레이드 5덱」 탭): 보유 니케를 겹치지 않게 다섯 덱으로 나눠 합계 총딜이 큰 배분을 찾는다.
//   상대      상대 하나에 다섯 덱(솔로 레이드 — 계산 도구에 든 보스, 없으면 속성만 정한 상대) 또는 덱마다 상대(유니온 레이드)
//   결과      덱 다섯의 초상화 줄 · 덱별 총딜 막대 · 합계 · 쓰지 않은 보유 니케
//   덱 고정   마음에 드는 덱을 고정하고 나머지만 다시 찾는다(고정한 덱의 니케는 다른 덱에 들어가지 않는다)
//   덱 빌더에서 열기   덱 하나를 자리 순서 그대로, 그 상대로 덱 빌더에 넘긴다
// 계산 규칙은 여기에 없다 — 루트의 순수 모듈(src/core/union.mjs)이 한다(후보 만들기 · 겹치지 않는 묶음 고르기 · 자리 순서).
// 숨기면 안 되는 표시(추정 · 미확인 값 · 속성 상성 미반영 · 지원하지 않음 · 검증용 데이터 · 덱을 다 만들지 못한 까닭 · 계산하지 못함)는
// 접힌 구획 밖이다.
import { computed, ref, shallowRef, watch } from 'vue';
import { errorMessage } from '../lib/backend';
import { runRaidDecks } from '../lib/compute';
import { FALLBACK_OPPONENT, OPPONENT_GROUPS, opponentOptions, resolveOpponent, useDecks } from '../lib/deck';
import { useEngineRun } from '../lib/engineRun';
import { damageUnit, engineLabel } from '../lib/format';
import { RUN_RAID, useNav } from '../lib/nav';
import { unusedOwned, usePlan } from '../lib/plan';
import { precisionOf, RAID_PRECISION, recallPrecision, rememberPrecision, type PrecisionKey } from '../lib/precision';
import { recall, remember } from '../lib/remember';
import { useShared } from '../lib/shared';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { AccountRead, DeckOpponent as Opponent, RaidDeck, RaidDecksReport } from '../types';
import DamageBar from '../ui/DamageBar.vue';
import DetailsFold from '../ui/DetailsFold.vue';
import EmptyState from '../ui/EmptyState.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import ProgressPanel from '../ui/ProgressPanel.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import StatusPill from '../ui/StatusPill.vue';
import DeckOpponent from './DeckOpponent.vue';

/** 덱의 수 — 게임의 레이드 편성 칸과 같다. */
const DECKS = 5;
const NUMBERS = Array.from({ length: DECKS }, (_, i) => i + 1);
const MODE_KEY = 'raid.mode';
const OPPONENT_KEY = 'raid.opponent';
const OPPONENTS_KEY = 'raid.opponents';
const PRECISION_KEY = 'raid.precision';
/** 「안 씀」 니케를 뺄지 기억하는 이름(요격전·편성 추천과 같은 이름을 쓴다). */
const EXCLUDE_KEY = 'recommend.exclude-unused';
/** single = 상대 하나에 다섯 덱(솔로 레이드) · each = 덱마다 상대(유니온 레이드). */
type Mode = 'single' | 'each';

const shared = useShared();
const nav = useNav();
const decks = useDecks();
const plan = usePlan();
const { catalog, info } = useNikkeCatalog();
const engine = useEngineRun(RUN_RAID);

// ── 계정 ──────────────────────────────────────────────────────────────────────
// 계정 문서는 통째로 갈아 끼운다 — 계산 코드에 보통 객체로 넘어가야 한다.
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

// ── 상대 ──────────────────────────────────────────────────────────────────────
const options = computed(() => opponentOptions(catalog.value));
const optionGroups = computed(() =>
  (['boss', 'preset', 'element'] as const).map((kind) => ({ kind, label: OPPONENT_GROUPS[kind], items: options.value.filter((o) => o.kind === kind) })).filter((g) => g.items.length > 0),
);
/** 처음 고르는 상대: 계산 도구에 든 솔로 레이드 보스가 있으면 그것, 없으면 속성 없음. */
const fallback = computed(() => options.value.find((o) => o.kind === 'preset')?.key ?? FALLBACK_OPPONENT);
const usable = (key: string | null | undefined): key is string => !!key && resolveOpponent(key, catalog.value) !== null;

const mode = ref<Mode>(recall(MODE_KEY) === 'each' ? 'each' : 'single');
function chooseMode(next: Mode): void {
  mode.value = next;
  remember(MODE_KEY, next);
}

const singlePick = ref<string | null>(recall(OPPONENT_KEY) || null);
const singleKey = computed<string | null>({
  get: () => (usable(singlePick.value) ? singlePick.value : fallback.value),
  set: (next) => {
    singlePick.value = next;
    remember(OPPONENT_KEY, next ?? '');
  },
});

function recallEach(): (string | null)[] {
  try {
    const saved = JSON.parse(recall(OPPONENTS_KEY) || '[]') as unknown;
    return NUMBERS.map((_, i) => (Array.isArray(saved) && typeof saved[i] === 'string' ? (saved[i] as string) : null));
  } catch {
    return NUMBERS.map(() => null);
  }
}
const eachPick = ref<(string | null)[]>(recallEach());
const eachKeys = computed(() => eachPick.value.map((key) => (usable(key) ? key : fallback.value)));
function chooseEach(index: number, event: Event): void {
  const next = [...eachKeys.value];
  next[index] = (event.target as HTMLSelectElement).value;
  eachPick.value = next;
  remember(OPPONENTS_KEY, JSON.stringify(next));
}

/** 덱마다의 상대의 열쇠(덱 1부터). 상대가 하나면 다섯이 모두 같다. */
const deckKeys = computed(() => (mode.value === 'single' ? NUMBERS.map(() => singleKey.value) : eachKeys.value));
const deckOpponents = computed(() => deckKeys.value.map((key) => resolveOpponent(key, catalog.value)));
const singleOpponent = computed(() => resolveOpponent(singleKey.value, catalog.value));
/** 지금 고른 상대를 견주는 열쇠 — 결과가 이 상대의 것인지 본다. */
const pickKey = computed(() => JSON.stringify([mode.value, mode.value === 'single' ? singleKey.value : eachKeys.value]));

// ── 계산 ──────────────────────────────────────────────────────────────────────
const precision = ref<PrecisionKey>(recallPrecision(PRECISION_KEY));
function choosePrecision(key: PrecisionKey): void {
  precision.value = key;
  rememberPrecision(PRECISION_KEY, key);
}
/** 「안 씀」으로 표시한 니케를 덱에서 빼는가(기본은 빼지 않는다). */
const excludeUnused = ref(recall(EXCLUDE_KEY) === 'on');
const unusedCount = computed(() => plan?.plan.value.unused?.length ?? 0);
function onExclude(event: Event): void {
  excludeUnused.value = (event.target as HTMLInputElement).checked;
  remember(EXCLUDE_KEY, excludeUnused.value ? 'on' : 'off');
}

/** 마지막 결과와, 그 결과를 낼 때의 상대(덱 1부터). */
interface Found {
  report: RaidDecksReport;
  key: string;
  opponents: (Opponent | null)[];
}
const found = shallowRef<Found | null>(null);
const report = computed(() => found.value?.report ?? null);
const fresh = computed(() => found.value !== null && found.value.key === pickKey.value);
const error = ref('');
/** 고정한 덱의 번호. 고정한 덱은 다시 찾을 때 그대로 두고, 그 니케는 다른 덱에 넣지 않는다. */
const pinned = ref<number[]>([]);
const isPinned = (deck: RaidDeck) => pinned.value.includes(deck.deck);
function togglePin(deck: RaidDeck): void {
  pinned.value = isPinned(deck) ? pinned.value.filter((n) => n !== deck.deck) : [...pinned.value, deck.deck].sort((a, b) => a - b);
}
/** 고정한 덱을 계산에 넘길 모양으로(자리 순서 그대로). */
const locked = computed(() =>
  (report.value?.decks ?? []).filter((d) => d.status === 'computed' && isPinned(d)).map((d) => ({ deck: d.deck, members: d.members.map((m) => m.name) as (string | null)[] })),
);

// 계정을 바꾸면 앞 계정으로 낸 결과와 고정은 치운다(다른 계정의 덱을 이 계정의 것처럼 보이지 않는다).
watch(accountName, () => {
  found.value = null;
  pinned.value = [];
  error.value = '';
});

const canRun = computed(() => read.value !== null && deckOpponents.value.every((o) => o !== null) && !engine.computing && !engine.busyElsewhere);
const whyNot = computed(() => {
  if (engine.busyElsewhere) return '다른 화면에서 계산이 돌고 있다 — 끝난 뒤에 누른다';
  if (!deckOpponents.value.every((o) => o !== null)) return '상대를 먼저 고른다';
  return undefined;
});
const runLabel = computed(() => {
  if (!report.value) return '5덱 찾기';
  return locked.value.length ? `고정한 덱 ${locked.value.length}개는 두고 다시 찾기` : '다시 찾기';
});

/** 진행 패널의 값. 단계마다(덱 후보 → 자리 순서) 건수가 새로 온다. */
const progress = computed(() => {
  const stage = engine.stage;
  const done = (stage?.used ?? 0) + (engine.progress?.done ?? 0);
  return {
    title: stage?.stage === 2 ? '고른 덱의 자리 순서를 바꿔 보는 중' : '덱 후보를 견줘 보는 중',
    detail: stage ? `${stage.stage}/${stage.stages}단계` : '',
    done,
    total: stage ? Math.max(stage.budget, done) : 0,
  };
});

async function run(): Promise<void> {
  if (!canRun.value || !read.value) return;
  const account = read.value.account;
  const opponents = deckOpponents.value as Opponent[];
  const key = pickKey.value;
  const condition = mode.value === 'single' ? opponents[0].condition : opponents.map((o) => o.condition);
  const budget = precisionOf(RAID_PRECISION, precision.value).budget;
  const keep = locked.value;
  // 「안 씀」 니케를 빼기로 했으면 이 계정이 가진 것만 추려 넘긴다 — 뺀 것은 결과에 남는다(배지와 계산 조건).
  const exclude = excludeUnused.value ? unusedOwned(plan?.plan.value, account) : [];
  await engine.run<RaidDecksReport>((deps) => runRaidDecks({ account, condition, decks: DECKS, budget, locked: keep, ...(exclude.length ? { exclude } : {}) }, deps), {
    start: () => {
      error.value = '';
    },
    done: (result) => {
      found.value = { report: result, key, opponents };
      // 고정은 계산된 덱에만 남긴다.
      pinned.value = pinned.value.filter((n) => result.decks.some((d) => d.deck === n && d.status === 'computed'));
    },
    // 실패해도 앞서 보이던 덱은 그대로 둔다.
    fail: (message) => {
      error.value = message;
    },
  });
}

// ── 결과를 그리는 값 ──────────────────────────────────────────────────────────
/** 그 덱을 계산한 상대(결과를 낼 때 고른 것). */
const opponentOf = (deck: RaidDeck): Opponent | null => found.value?.opponents[deck.deck - 1] ?? null;
const weakOf = (deck: RaidDeck) => {
  const o = opponentOf(deck);
  return o?.element.known ? o.element.weak_to : null;
};
const isWeak = (deck: RaidDeck, name: string) => weakOf(deck) !== null && info(name).element === weakOf(deck);
/** 덱별 총딜 막대의 기준: 가장 센 덱이 가득이다. */
const strongest = computed(() => Math.max(0, ...(report.value?.decks ?? []).map((d) => d.total_damage ?? 0)));
const barOf = (deck: RaidDeck) => (deck.total_damage !== null && strongest.value > 0 ? deck.total_damage / strongest.value : null);
const partOf = (deck: RaidDeck) => (deck.total_damage !== null && report.value && report.value.total_damage > 0 ? Math.round((deck.total_damage / report.value.total_damage) * 100) : null);
/** 결과에 상대가 여럿인가(덱마다 상대를 골랐다). */
const many = computed(() => (report.value?.conditions.length ?? 0) > 1);

function openInDeck(deck: RaidDeck): void {
  if (!decks || !nav || deck.status !== 'computed') return;
  decks.openDeck(deck.members.map((m) => m.name), opponentOf(deck)?.key ?? null);
  nav.openTool('deck');
}

/** 「계산 조건」에 든 것: 상대의 메모와 미확인 값, 덱별 메모, 가정, 주의. */
const usedOpponents = computed(() => {
  const seen = new Set<string>();
  return (found.value?.opponents ?? []).filter((o): o is Opponent => o !== null && !seen.has(o.key) && !!seen.add(o.key));
});
const deckNotes = computed(() => (report.value?.decks ?? []).flatMap((d) => d.notes.map((n) => `덱 ${d.deck}: ${n}`)));
const conditionCount = computed(
  () =>
    usedOpponents.value.reduce((sum, o) => sum + o.notes.length + o.unconfirmed.length, 0) + deckNotes.value.length + (report.value?.assumptions.length ?? 0) + (report.value?.caveats.length ?? 0),
);
const foldTone = computed(() => (usedOpponents.value.some((o) => o.unconfirmed.length || o.flags.length) ? 'unknown' : 'neutral'));
</script>

<template>
  <div class="raid" data-testid="raid-decks">
    <SkeletonBlock v-if="!ready || (loading && !read)" shape="tiles" :count="5" label="계정을 읽는 중" />

    <EmptyState
      v-else-if="!accountName"
      title="아직 계정을 연결하지 않았다"
      hint="계정을 연결하면 보유 니케를 겹치지 않게 다섯 덱으로 나눠 볼 수 있다."
      action="계정 연결하기"
      data-testid="raid-need-account"
      @action="nav?.openSettings('account')"
    />

    <EmptyState
      v-else-if="accountError && !read"
      tone="error"
      title="계정을 읽지 못했다"
      :hint="`${accountError} 설정의 계정 연결에서 계정을 새로 받아 본다.`"
      action="계정 연결 열기"
      data-testid="raid-account-error"
      @action="nav?.openSettings('account')"
    />

    <template v-else-if="read">
      <!-- 상대: 하나(솔로 레이드) 또는 덱마다(유니온 레이드) -->
      <section class="nk-card" aria-label="레이드의 상대" data-testid="raid-target">
        <div class="nk-row">
          <h2 class="nk-subtitle">상대</h2>
          <div class="nk-seg" role="radiogroup" aria-label="상대를 고르는 방법">
            <button
              type="button"
              role="radio"
              class="nk-seg__item"
              :class="{ 'nk-seg__item--on': mode === 'single' }"
              :aria-checked="mode === 'single'"
              :disabled="engine.computing"
              title="솔로 레이드처럼 보스 하나를 다섯 덱으로 친다"
              data-testid="raid-mode-single"
              @click="chooseMode('single')"
            >
              상대 하나에 다섯 덱
            </button>
            <button
              type="button"
              role="radio"
              class="nk-seg__item"
              :class="{ 'nk-seg__item--on': mode === 'each' }"
              :aria-checked="mode === 'each'"
              :disabled="engine.computing"
              title="유니온 레이드처럼 덱마다 다른 보스를 친다"
              data-testid="raid-mode-each"
              @click="chooseMode('each')"
            >
              덱마다 상대 고르기
            </button>
          </div>
          <span class="nk-spacer"></span>
          <StatusPill v-if="read.account.is_test_data" label="검증용 데이터" tone="test" solid data-testid="data-kind" />
          <span class="nk-muted" data-testid="account-line">계정 <strong>{{ read.account.name ?? read.name }}</strong></span>
        </div>
        <p class="nk-muted" data-testid="raid-target-help">
          {{
            mode === 'single'
              ? '솔로 레이드: 계산 도구에 든 보스를 고른다. 이번 시즌의 보스가 목록에 없으면 「속성만 정하기」에서 약점 속성을 고른다 — 그때 속성 말고는 확인하지 못한 값으로 계산한다.'
              : '유니온 레이드: 덱마다 칠 보스의 약점 속성을 고른다. 상대가 같은 덱끼리는 총딜이 큰 순서로 놓인다.'
          }}
        </p>
        <div v-if="mode === 'each'" class="raid__each" data-testid="raid-each">
          <label v-for="(n, i) in NUMBERS" :key="n" class="raid__pick" :data-deck="n" data-testid="raid-each-row">
            <span class="raid__no">덱 {{ n }}</span>
            <select class="nk-input" :value="eachKeys[i]" :disabled="engine.computing" :aria-label="`덱 ${n}의 상대`" data-testid="raid-each-select" @change="chooseEach(i, $event)">
              <optgroup v-for="g in optionGroups" :key="g.kind" :label="g.label">
                <option v-for="o in g.items" :key="o.key" :value="o.key">{{ o.label }}</option>
              </optgroup>
            </select>
            <!-- 숨기면 안 되는 표시: 그 상대의 미확인 값과 속성 상성 미반영(접지 않는다). -->
            <StatusPill
              v-if="deckOpponents[i]?.unconfirmed.length"
              :label="`미확인 값 ${deckOpponents[i]!.unconfirmed.length}칸`"
              tone="unknown"
              :detail="deckOpponents[i]!.unconfirmed.map((u) => `${u.label}: ${u.text}`).join('\n')"
              data-testid="raid-each-unconfirmed"
            />
            <StatusPill v-for="flag in deckOpponents[i]?.flags ?? []" :key="flag" :label="flag" tone="unknown" data-testid="raid-each-flag" />
          </label>
        </div>
      </section>

      <DeckOpponent v-if="mode === 'single'" v-model="singleKey" :options="options" :opponent="singleOpponent" :disabled="engine.computing" />

      <!-- 찾기 -->
      <section class="nk-card" aria-label="다섯 덱 찾기" data-testid="raid-controls">
        <div class="nk-row">
          <div class="nk-seg" role="radiogroup" aria-label="정밀도">
            <button
              v-for="choice in RAID_PRECISION"
              :key="choice.key"
              type="button"
              role="radio"
              class="nk-seg__item"
              :class="{ 'nk-seg__item--on': precision === choice.key }"
              :aria-checked="precision === choice.key"
              :title="choice.hint"
              :disabled="engine.computing"
              :data-testid="`raid-precision-${choice.key}`"
              @click="choosePrecision(choice.key)"
            >
              {{ choice.label }}
              <span class="nk-seg__sub">{{ choice.time }}</span>
            </button>
          </div>
          <label v-if="plan" class="raid__check" title="내 니케 화면에서 「안 씀」으로 표시한 니케를 덱에서 뺀다 — 뺀 니케는 결과에 적힌다. 고정한 덱의 니케는 빼지 않는다">
            <input type="checkbox" :checked="excludeUnused" :disabled="engine.computing" data-testid="raid-exclude-unused" @change="onExclude" />
            「안 씀」 니케 빼기 <span class="nk-muted" data-testid="raid-unused-count">({{ unusedCount }}명)</span>
          </label>
          <span class="nk-spacer"></span>
          <button type="button" class="nk-btn nk-btn--primary" :disabled="!canRun" :title="whyNot ?? '보유 니케를 겹치지 않게 다섯 덱으로 나눈다'" data-testid="raid-run" @click="run">
            {{ runLabel }}
          </button>
        </div>
        <p class="nk-muted" data-testid="raid-help">
          한 니케는 한 덱에만 들어간다. 덱마다 많이 키운 니케부터 후보를 만들어 계산하고, 겹치지 않는 묶음 가운데 합계가 가장 큰 것을 고른다. 마음에 드는 덱은 「고정」하고 나머지만 다시 찾을 수 있다.
        </p>
        <p v-if="engine.busyElsewhere" class="nk-muted" data-testid="busy-elsewhere">다른 화면에서 계산이 돌고 있다. 끝나면 여기서 계산할 수 있다.</p>
      </section>

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
      <p v-else-if="engine.stopped" class="nk-note" role="status" data-testid="stopped-note">계산을 중단했다. 앞서 보이던 덱은 그대로다.</p>

      <p v-if="error" class="nk-error" role="alert" data-testid="raid-error">
        <strong>다섯 덱을 찾지 못했다.</strong> {{ error }} 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.
      </p>

      <!-- 결과 -->
      <section v-if="report" class="nk-card" aria-label="레이드 5덱" data-testid="raid-result" :data-fresh="fresh ? 'yes' : 'no'">
        <div class="nk-row">
          <h2 class="nk-subtitle">레이드 5덱</h2>
          <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 레이드 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
          <StatusPill
            :label="`지원하지 않음 ${report.unsupported.length}가지`"
            tone="unknown"
            :detail="`이 계산이 다루지 않는 것: ${report.unsupported.join(' / ')}`"
            data-testid="unsupported-pill"
          />
          <StatusPill v-if="report.account.is_test_data" label="검증용 데이터" tone="test" solid data-testid="result-data-kind" />
          <StatusPill v-if="report.excluded" :label="`안 씀 ${report.excluded.count}명 제외`" tone="unknown" :detail="report.excluded.text" data-testid="excluded-pill" />
        </div>

        <p v-if="!fresh" class="nk-note" role="status" data-testid="raid-stale">상대를 바꿨다 — 아래 덱은 바꾸기 전의 상대로 찾은 것이다. 다시 찾으면 지금 상대로 계산한다.</p>
        <p v-else-if="engine.computing" class="nk-muted" data-testid="stale-note">아래는 이전에 찾은 덱이다 — 새 계산이 끝나면 바뀐다.</p>

        <div class="raid__sum" :class="{ 'raid__stale': !fresh }" data-testid="raid-sum">
          <span class="nk-muted">덱 {{ report.made }}개의 합계</span>
          <strong class="nk-hero" data-testid="raid-total">{{ damageUnit(report.total_damage) }}</strong>
          <StatusPill label="추정" tone="estimate" solid data-role="estimate" />
        </div>
        <!-- 지원하지 않는 것은 접지 않는다: 이 합계가 무엇이 아닌지. -->
        <p class="raid__limit" data-testid="raid-limit">
          덱별 총딜 어림의 합이다 — 레이드의 점수가 아니다. 보스의 패턴과 체력, 점수 규칙은 계산하지 않는다(지원하지 않음).
        </p>
        <!-- 요청한 수만큼 만들지 못했으면 까닭을 접지 않는다. -->
        <p v-if="report.shortage" class="nk-note" role="status" data-testid="raid-shortage">
          <StatusPill :label="`덱 ${report.made} / ${report.requested}개`" tone="unknown" solid data-testid="raid-shortage-pill" />
          {{ report.shortage.text }}
        </p>

        <ol class="raid__decks" :class="{ 'raid__stale': !fresh }">
          <li v-for="deck in report.decks" :key="deck.deck" class="raid__deck" :data-deck="deck.deck" :data-status="deck.status" :data-pinned="isPinned(deck) ? 'yes' : 'no'" data-testid="raid-deck">
            <div class="raid__head">
              <strong class="raid__no" data-testid="raid-deck-no">덱 {{ deck.deck }}</strong>
              <StatusPill v-if="isPinned(deck) || deck.lock !== 'none'" label="고정" tone="accent" solid data-testid="raid-deck-pinned" />
              <span v-if="many && opponentOf(deck)" class="nk-muted" data-testid="raid-deck-opponent">상대 {{ opponentOf(deck)!.label }}</span>
              <span class="nk-spacer"></span>
              <template v-if="deck.status === 'computed'">
                <button
                  type="button"
                  class="nk-btn"
                  :aria-pressed="isPinned(deck)"
                  :disabled="engine.computing"
                  :title="isPinned(deck) ? '고정을 풀면 다시 찾을 때 이 덱도 새로 짠다' : '이 덱을 그대로 두고 나머지 덱만 다시 찾는다 — 이 덱의 니케는 다른 덱에 들어가지 않는다'"
                  data-testid="raid-pin"
                  @click="togglePin(deck)"
                >
                  {{ isPinned(deck) ? '고정 풀기' : '고정' }}
                </button>
                <button v-if="decks && nav" type="button" class="nk-btn" title="이 덱을 자리 순서 그대로 덱 빌더로 가져간다" data-testid="raid-open-deck" @click="openInDeck(deck)">덱 빌더에서 열기</button>
              </template>
            </div>

            <template v-if="deck.status === 'computed'">
              <div class="raid__tiles" data-testid="raid-deck-members">
                <NikkeTile
                  v-for="m in deck.members"
                  :key="m.name"
                  :name="m.name"
                  size="sm"
                  :element="info(m.name).element"
                  :burst="info(m.name).burst"
                  :weak="isWeak(deck, m.name)"
                  :share="m.share"
                  :data-name="m.name"
                  data-testid="raid-member"
                />
              </div>
              <div class="raid__total">
                <strong data-testid="raid-deck-total">{{ damageUnit(deck.total_damage) }}</strong>
                <span class="nk-muted" data-testid="raid-deck-part">합계의 {{ partOf(deck) ?? '–' }}%</span>
                <DamageBar class="raid__bar" :share="barOf(deck)" :percent="false" data-testid="raid-deck-bar" />
              </div>
            </template>
            <!-- 채우지 못한 덱과 계산하지 못한 덱: 0으로 두지 않고 그렇게 적는다. -->
            <p v-else class="nk-note" data-testid="raid-deck-empty">
              <StatusPill :label="deck.status === 'failed' ? '계산하지 못함' : '빈 덱'" :tone="deck.status === 'failed' ? 'error' : 'unknown'" solid />
              {{ deck.reason }}
              <span v-if="deck.locked" class="nk-muted">고정한 니케: {{ deck.locked.filter((m) => m !== null).join(', ') }}</span>
            </p>
          </li>
        </ol>

        <div class="raid__unused" data-testid="raid-unused">
          <p class="nk-list__head" data-testid="raid-unused-head">쓰지 않은 보유 니케 {{ report.unused.length }}명</p>
          <p v-if="report.unused.length === 0" class="nk-muted">보유 니케를 모두 덱에 넣었다.</p>
          <ul v-else class="raid__chips">
            <li v-for="name in report.unused" :key="name" class="raid__chip" :data-name="name" data-testid="raid-unused-item">
              <NikkeTile :name="name" size="xs" :element="info(name).element" :burst="info(name).burst" />
              <span>{{ name }}</span>
            </li>
          </ul>
        </div>
        <p v-if="report.failed.length" class="nk-note" data-testid="raid-failed">
          <StatusPill :label="`계산하지 못한 후보 ${report.failed.length}개`" tone="error" /> 계산 도구가 계산하지 못한 후보는 0으로 치지 않고 뺐다.
        </p>
        <p v-if="fresh && report.cache && report.cache.misses === 0" class="nk-muted" data-testid="raid-reused">앞서 계산해 둔 결과를 바로 가져왔다.</p>

        <DetailsFold summary="계산 조건" :count="conditionCount" :tone="foldTone" data-testid="raid-conditions">
          <template v-for="o in usedOpponents" :key="o.key">
            <p class="nk-list__head">상대 — {{ o.label }}</p>
            <ul class="nk-list">
              <li v-for="(n, i) in o.notes" :key="`n${i}`" data-testid="opponent-note">{{ n }}</li>
              <li v-for="u in o.unconfirmed" :key="u.field" data-testid="unconfirmed-item">미확인 값 — {{ u.label }}: {{ u.text }}</li>
            </ul>
          </template>
          <template v-if="deckNotes.length">
            <p class="nk-list__head">덱별 메모</p>
            <ul class="nk-list">
              <li v-for="(n, i) in deckNotes" :key="`d${i}`" data-testid="deck-note">{{ n }}</li>
            </ul>
          </template>
          <p class="nk-list__head">가정</p>
          <ul class="nk-list" data-testid="assumptions">
            <li v-for="(a, i) in report.assumptions" :key="`a${i}`" data-testid="assumption-item">{{ a }}</li>
          </ul>
          <p class="nk-list__head">주의</p>
          <ul class="nk-list" data-testid="caveats">
            <li v-for="(c, i) in report.caveats" :key="`c${i}`" data-testid="caveat-item">{{ c }}</li>
          </ul>
          <template v-if="report.engine">
            <p class="nk-list__head">계산 정보</p>
            <ul class="nk-list">
              <li data-testid="engine-version">계산 도구: {{ engineLabel(report.engine) }}</li>
            </ul>
          </template>
        </DetailsFold>
      </section>
    </template>
  </div>
</template>

<style scoped>
.raid {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-5);
  min-width: 0;
}

.raid__each {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
}

.raid__pick,
.raid__check {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.raid__check {
  cursor: pointer;
}

.raid__no {
  flex: none;
  color: var(--nk-text);
  font-weight: var(--nk-weight-bold);
}

.raid__sum {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--nk-space-3);
}

.raid__limit {
  margin: 0;
  color: var(--nk-unknown);
  overflow-wrap: anywhere;
}

.raid__stale {
  opacity: 0.55;
}

.raid__decks {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.raid__deck {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.raid__deck[data-pinned='yes'] {
  border-color: var(--nk-accent);
}

.raid__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.raid__tiles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-3);
}

.raid__total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
  font-size: var(--nk-font-lg);
}

.raid__bar {
  flex: 1;
  min-width: var(--nk-tile-lg);
}

.raid__unused {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
}

.raid__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.raid__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-2);
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}
</style>
