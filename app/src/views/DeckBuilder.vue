<script setup lang="ts">
// 덱 빌더(P-030 — 편성 도구의 「덱 빌더」 탭): 보유 니케의 초상화에서 다섯을 골라 자리에 놓으면 그 편성의 총딜과 니케별 딜이 계산된다.
//   상대 고르기 → 다섯 자리(눌러 넣고, 끌거나 ◀ ▶로 자리를 바꾼다) → 「계산」 → 큰 총딜 숫자와 딜 비중 막대
//   육성 기준 둘을 나란히: 「내 계정 육성」 대 「모두 최대 육성」 — 덜 키워서 약한지 조합이 약한지 가늠한다
//   한 명을 바꾼다면(자리 하나를 골라 같은 버스트 단계의 보유 니케를 하나씩 넣어 본다) · 자리 순서 비교 · 내 편성 저장 · 편성 복사
// 계산 규칙은 여기에 없다 — 루트의 순수 모듈(src/core/deck.mjs)이 하고, 그 안에서 편성 비교(compareSquads)와 자리 변형(search.mjs)을 그대로 쓴다.
// 숨기면 안 되는 표시(추정·미확인 값·속성 상성 미반영·검증용·계산하지 못함)는 접힌 구획 밖의 배지와 문장이다.
import { computed, nextTick, onActivated, ref, shallowRef, watch } from 'vue';
import { copyText, errorMessage } from '../lib/backend';
import { runDeckEvaluate, runDeckOrder, runDeckSwap } from '../lib/compute';
import {
  burstCheck,
  deckKey,
  deckText,
  DEFAULT_ORDER_LIMIT,
  DEFAULT_SWAP_LIMIT,
  FALLBACK_OPPONENT,
  moveMember,
  normalizeSlots,
  opponentOptions,
  placeMember,
  recallAuto,
  recallWorking,
  rememberWorking,
  removeMember,
  resolveOpponent,
  swapPreview,
  useDecks,
  type DeckDraft,
  type Slots,
} from '../lib/deck';
import { useEngineOwner, useEngineRun } from '../lib/engineRun';
import { damageUnit, engineLabel } from '../lib/format';
import { RUN_DECK, useNav } from '../lib/nav';
import { rosterRows } from '../lib/roster';
import { useShared } from '../lib/shared';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { AccountRead, DeckOrderReport, DeckOutcome, DeckReport, DeckSwapReport, SavedDeck } from '../types';
import EmptyState from '../ui/EmptyState.vue';
import DetailsFold from '../ui/DetailsFold.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import ProgressPanel from '../ui/ProgressPanel.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import StatusPill from '../ui/StatusPill.vue';
import BurstPanel from './BurstPanel.vue';
import DeckBook from './DeckBook.vue';
import DeckOpponent from './DeckOpponent.vue';
import DeckRoster from './DeckRoster.vue';
import { usePlan } from '../lib/plan';

const shared = useShared();
const nav = useNav();
const decks = useDecks();
const { catalog, info } = useNikkeCatalog();
const engine = useEngineRun(RUN_DECK);
// 버스트 흐름 구획(BurstPanel)이 따로 도는 동안에도 이 화면의 계산 단추를 막는다 — 계산 자리는 하나다.
const owner = useEngineOwner();

// ── 계정 ──────────────────────────────────────────────────────────────────────
// 계정 문서는 통째로 갈아 끼운다(안쪽까지 지켜보지 않는다) — 계산 코드에 보통 객체로 넘어가야 결과를 캐시에 담을 수 있다.
const read = shallowRef<AccountRead | null>(null);
const loading = ref(false);
const accountError = ref('');
let readSeq = 0;
const accountName = computed(() => shared?.accountName.value ?? null);
/** 내 니케에서 붙인 표시(즐겨찾기 · 안 씀) — 보유 니케 격자의 거르기와 표시에 쓴다(P-033). 앱 밖에서는 null. */
const marks = usePlan();
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

const rows = computed(() => rosterRows(read.value?.account, catalog.value));
const owned = computed(() => new Set(rows.value.map((r) => r.name)));

// ── 짜는 편성과 상대 ──────────────────────────────────────────────────────────
const working = recallWorking();
const slots = ref<Slots>(working.slots);
const opponentKey = ref<string | null>(working.opponent);
const notice = ref('');

const options = computed(() => opponentOptions(catalog.value));
const opponent = computed(() => resolveOpponent(opponentKey.value, catalog.value));
// 처음에는(또는 기억해 둔 상대가 없어졌으면) 계산 도구의 솔로 레이드 보스를 고른다 — 편성 도구의 추천과 같은 기준이다.
watch(
  [catalog, opponent],
  () => {
    if (!catalog.value || opponent.value) return;
    opponentKey.value = options.value.find((o) => o.kind === 'preset')?.key ?? FALLBACK_OPPONENT;
  },
  { immediate: true },
);

// 계정을 읽었으면, 그 계정에 없는 니케는 자리에서 뺀다(다른 계정에서 짜던 편성).
watch(owned, (names) => {
  if (!read.value) return;
  const kept = slots.value.map((name) => (name !== null && names.has(name) ? name : null));
  if (kept.some((name, i) => name !== slots.value[i])) {
    slots.value = kept;
    notice.value = '이 계정에 없는 니케는 자리에서 뺐다.';
  }
});

const key = computed(() => deckKey(slots.value, opponentKey.value));
// 짜던 편성을 기억한다. 앱 안에서는 내 편성의 상태가 맡는다 — 육성 효율 화면이 「덱 빌더의 지금 편성」으로 읽는다.
watch(key, () => (decks ? decks.setWorking(slots.value, opponentKey.value) : rememberWorking(slots.value, opponentKey.value)));
const members = computed(() => slots.value.filter((m): m is string => m !== null));
const full = computed(() => members.value.length === slots.value.length);
const burst = computed(() => burstCheck(slots.value, catalog.value));
const weakTo = computed(() => (opponent.value?.element.known ? opponent.value.element.weak_to : null));
const isWeak = (name: string) => weakTo.value !== null && info(name).element === weakTo.value;

function add(name: string): void {
  const placed = placeMember(slots.value, name);
  notice.value = placed.problem ?? '';
  if (!placed.problem) slots.value = placed.slots;
}
function remove(index: number): void {
  slots.value = removeMember(slots.value, index);
  notice.value = '';
}
function move(from: number, to: number): void {
  slots.value = moveMember(slots.value, from, to);
}
function clearAll(): void {
  slots.value = slots.value.map(() => null);
  notice.value = '';
}

// 자리끼리 끌어서 순서를 바꾼다(두 자리를 맞바꾼다).
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDragStart(index: number, event: DragEvent): void {
  if (slots.value[index] === null) return;
  dragFrom.value = index;
  // 끌기를 시작하려면 무엇이든 실어야 하는 브라우저가 있다. 값은 쓰지 않는다.
  event.dataTransfer?.setData('text/plain', String(index + 1));
}
function onDrop(index: number): void {
  if (dragFrom.value !== null) move(dragFrom.value, index);
  dragFrom.value = null;
  dragOver.value = null;
}
function onDragEnd(): void {
  dragFrom.value = null;
  dragOver.value = null;
}

// ── 계산 ──────────────────────────────────────────────────────────────────────
type Job = 'evaluate' | 'swap' | 'order';
const job = ref<Job>('evaluate');
const report = shallowRef<DeckReport | null>(null);
const swapReport = shallowRef<DeckSwapReport | null>(null);
const orderReport = shallowRef<DeckOrderReport | null>(null);
const error = ref('');
// 계정을 바꾸면 앞 계정으로 낸 결과는 치운다(P-033 — 같은 다섯이어도 계정마다 육성이 다르다. 결과는 계정마다 따로다).
watch(accountName, () => {
  report.value = null;
  swapReport.value = null;
  orderReport.value = null;
  error.value = '';
});

/** 보이는 결과가 지금 편성·지금 상대의 것인가. */
const fresh = computed(() => report.value !== null && report.value.key === key.value);
const swap = computed(() => (swapReport.value?.key === key.value ? swapReport.value : null));
const order = computed(() => (orderReport.value?.key === key.value ? orderReport.value : null));
const mine = computed<DeckOutcome | null>(() => report.value?.results.account ?? null);
const max = computed<DeckOutcome | null>(() => report.value?.results.engine_default ?? null);
const mineTotal = computed(() => (mine.value?.status === 'computed' ? mine.value.total_damage : null));
const maxTotal = computed(() => (max.value?.status === 'computed' ? max.value.total_damage : null));
/** 자리의 타일에 그릴 딜 비중: 지금 편성의 결과일 때만. */
const shares = computed(() => {
  const m = mine.value;
  return fresh.value && m?.status === 'computed' ? new Map(m.members.map((x) => [x.name, x.share])) : null;
});
const shareOf = (name: string): number | null | undefined => (shares.value ? (shares.value.get(name) ?? null) : undefined);

const canRun = computed(() => full.value && opponent.value !== null && read.value !== null && !engine.computing && !engine.busyElsewhere && owner.value === null);
const whyNot = computed(() => {
  if (engine.busyElsewhere) return '다른 화면에서 계산이 돌고 있다 — 끝난 뒤에 누른다';
  if (!opponent.value) return '상대를 먼저 고른다';
  if (!full.value) return `다섯 자리를 모두 채우면 계산할 수 있다(지금 ${members.value.length}명)`;
  return undefined;
});

/** 계산하지 못한 까닭을 한 문장으로. */
function outcomeProblem(outcome: DeckOutcome | null): string {
  if (!outcome || outcome.status === 'computed') return '';
  if (outcome.status === 'rejected') return outcome.reasons.join(' / ');
  return outcome.error.message ?? '까닭을 알 수 없다';
}

async function calc(): Promise<void> {
  const chosen = opponent.value;
  const account = read.value?.account;
  if (!canRun.value || !chosen || !account) return;
  const input = { account, opponent: chosen, members: [...slots.value] };
  job.value = 'evaluate';
  await engine.run<DeckReport>((deps) => runDeckEvaluate(input, deps), {
    start: () => {
      error.value = '';
    },
    done: (result) => {
      report.value = result;
    },
    fail: (message) => {
      error.value = message;
    },
  });
}

async function trySwap(slot: number): Promise<void> {
  const chosen = opponent.value;
  const account = read.value?.account;
  if (!canRun.value || !chosen || !account) return;
  const input = { account, opponent: chosen, members: [...slots.value], slot, limit: DEFAULT_SWAP_LIMIT };
  job.value = 'swap';
  await engine.run<DeckSwapReport>((deps) => runDeckSwap(input, deps), {
    start: () => {
      error.value = '';
    },
    done: (result) => {
      swapReport.value = result;
    },
    fail: (message) => {
      error.value = message;
    },
  });
}

async function tryOrder(): Promise<void> {
  const chosen = opponent.value;
  const account = read.value?.account;
  if (!canRun.value || !chosen || !account) return;
  const input = { account, opponent: chosen, members: [...slots.value], limit: DEFAULT_ORDER_LIMIT };
  job.value = 'order';
  await engine.run<DeckOrderReport>((deps) => runDeckOrder(input, deps), {
    start: () => {
      error.value = '';
    },
    done: (result) => {
      orderReport.value = result;
    },
    fail: (message) => {
      error.value = message;
    },
  });
}

const JOB_TITLE: Record<Job, string> = { evaluate: '편성을 계산하는 중', swap: '한 명씩 바꿔 넣어 보는 중', order: '자리 순서를 바꿔 보는 중' };
const progress = computed(() => ({ title: JOB_TITLE[job.value], done: engine.progress?.done ?? 0, total: engine.progress?.total ?? 0 }));

// 자동 계산(설정 > 계산 도구에서 켠다): 다섯 자리가 차면 스스로 계산한다. 같은 편성을 두 번 시도하지 않는다.
const auto = ref(recallAuto());
onActivated(() => {
  auto.value = recallAuto();
});
let attempted = '';
watch(
  [auto, key, canRun, fresh],
  () => {
    if (!auto.value || !canRun.value || fresh.value || attempted === key.value) return;
    attempted = key.value;
    void calc();
  },
  { immediate: true },
);

/** 한 자리를 바꿔 볼 때 몇 명을 넣어 보는지(누르기 전에 풍선 도움말로). */
function swapHint(slot: number): string {
  const preview = swapPreview(slots.value, slot, read.value?.account, catalog.value);
  if (preview.total === 0) return '이 자리에 넣어 볼 수 있는 다른 보유 니케가 없다';
  return `같은 버스트 단계의 보유 니케 ${preview.candidates.length}명을 하나씩 넣어 계산한다${preview.skipped.length ? ` (${preview.skipped.length}명은 한 번에 보는 수를 넘어 보지 않는다)` : ''}`;
}

/** 총딜 변화를 '+5.3%'·'−2.6%'로. 모르면 「–」. */
function changeText(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return '–';
  return `${change < 0 ? '−' : '+'}${(Math.abs(change) * 100).toFixed(1)}%`;
}

function applySwap(slot: number, name: string): void {
  const placed = placeMember(slots.value, name, slot);
  notice.value = placed.problem ?? '';
  if (!placed.problem) slots.value = placed.slots;
}
function applyOrder(next: string[]): void {
  slots.value = normalizeSlots(next);
}
/** 가장 좋은 순서가 지금보다 얼마나 큰가(+6.0%). */
const orderGain = computed(() => (order.value?.gain_ratio ? changeText(order.value.gain_ratio - 1) : '–'));

// ── 버스트 흐름(P-032) ────────────────────────────────────────────────────────
// 지금 편성의 버스트 순환을 타임라인으로 본다. 자리 순서를 바꾼 편성이나 한 명을 바꾼 편성을 고르면 둘을 위아래로 견준다.
const burstPanel = ref<InstanceType<typeof BurstPanel> | null>(null);
const burstOther = ref<{ name: string; members: string[] } | null>(null);
// 편성이나 상대가 바뀌면 견주던 편성은 지운다(바꾸기 전 편성에서 나온 것이다).
watch(key, () => {
  burstOther.value = null;
});
const burstSquads = computed(() => (full.value ? [{ name: '지금 편성', members: members.value }, ...(burstOther.value ? [burstOther.value] : [])] : []));
// 계정도 열쇠에 든다(P-033): 같은 다섯이어도 계정이 다르면 육성이 달라 버스트 흐름이 다를 수 있다.
const burstKey = computed(() => JSON.stringify([accountName.value, key.value, burstOther.value?.members ?? null]));
const burstBlocked = computed(() => {
  if (!opponent.value) return '상대를 먼저 고른다';
  if (!full.value) return `다섯 자리를 모두 채우면 버스트 흐름을 볼 수 있다(지금 ${members.value.length}명)`;
  return undefined;
});
/** 지금 편성과 다른 편성(가장 좋은 자리 순서·한 명을 바꾼 편성)의 버스트 흐름을 견준다. */
async function compareBurst(name: string, other: string[]): Promise<void> {
  burstOther.value = { name, members: [...other] };
  await nextTick();
  await burstPanel.value?.run();
}

// ── 복사 ──────────────────────────────────────────────────────────────────────
const copied = ref('');
const copyError = ref('');
async function copy(): Promise<void> {
  copied.value = '';
  copyError.value = '';
  const text = deckText({
    members: slots.value,
    opponent_label: opponent.value?.label ?? null,
    weak_to: weakTo.value,
    total_damage: fresh.value ? mineTotal.value : null,
  });
  try {
    await copyText(text);
    copied.value = fresh.value && mineTotal.value !== null ? '편성을 복사했다(이름·상대·추정 총딜).' : '편성을 복사했다(이름·상대 — 총딜은 계산 전이다).';
  } catch (e) {
    copyError.value = errorMessage(e);
  }
}
watch(key, () => {
  copied.value = '';
  copyError.value = '';
});

// ── 내 편성 ───────────────────────────────────────────────────────────────────
const bookError = ref('');
const draft = (name?: string): DeckDraft => ({
  ...(name ? { name } : {}),
  members: [...slots.value],
  opponent: opponentKey.value,
  opponent_label: opponent.value?.label ?? null,
  total_damage: fresh.value ? mineTotal.value : null,
});
async function keep(action: () => Promise<void>): Promise<void> {
  bookError.value = '';
  try {
    await action();
  } catch (e) {
    bookError.value = errorMessage(e);
  }
}
const saveSlot = (index: number) => keep(() => decks!.saveSlot(index, draft()));
const clearSlot = (index: number) => keep(() => decks!.clearSlot(index));
const addSaved = (name: string) => keep(() => decks!.addSaved(draft(name)));
const removeSaved = (id: string) => keep(() => decks!.removeSaved(id));

/** 저장한 편성이나 다른 화면이 넘긴 편성을 자리에 놓는다. 이 계정에 없는 니케는 빼고 그렇게 알린다. */
function place(next: Slots, nextOpponent: string | null): void {
  const normal = normalizeSlots(next);
  const missing = read.value ? normal.filter((m): m is string => m !== null && !owned.value.has(m)) : [];
  slots.value = normal.map((m) => (m !== null && missing.includes(m) ? null : m));
  if (nextOpponent && resolveOpponent(nextOpponent, catalog.value)) opponentKey.value = nextOpponent;
  notice.value = missing.length ? `이 계정에 없는 니케는 뺐다: ${missing.join(', ')}.` : '';
}
const loadDeck = (deck: SavedDeck) => place(deck.members, deck.opponent);

// 요격전 추천의 「덱 빌더에서 열기」: 넘겨받은 편성을 놓는다.
let taken = 0;
if (decks) {
  watch(
    () => decks.incoming.value,
    (incoming) => {
      if (!incoming || incoming.seq === taken) return;
      taken = incoming.seq;
      place(incoming.members, incoming.opponent);
    },
    { immediate: true },
  );
}

/** 「계산 조건」에 든 항목 수. */
const conditionCount = computed(
  () => (opponent.value?.unconfirmed.length ?? 0) + (opponent.value?.notes.length ?? 0) + (fresh.value ? (report.value?.assumptions.length ?? 0) + (report.value?.caveats.length ?? 0) : 0),
);
const warnings = computed(() => {
  if (!fresh.value) return [];
  const out: string[] = [];
  for (const o of [mine.value, max.value]) if (o?.status === 'computed') for (const w of [...o.notes, ...o.engine_warnings]) if (!out.includes(w)) out.push(w);
  return out;
});
</script>

<template>
  <div class="deck" data-testid="deck-builder">
    <SkeletonBlock v-if="!ready || (loading && !read)" shape="tiles" :count="5" label="계정을 읽는 중" />

    <EmptyState
      v-else-if="!accountName"
      title="아직 계정을 연결하지 않았다"
      hint="계정을 연결하면 보유 니케로 편성을 짜고 총딜을 계산해 볼 수 있다."
      action="계정 연결하기"
      data-testid="deck-need-account"
      @action="nav?.openSettings('account')"
    />

    <EmptyState
      v-else-if="accountError && !read"
      tone="error"
      title="계정을 읽지 못했다"
      :hint="`${accountError} 설정의 계정 연결에서 계정을 새로 받아 본다.`"
      action="계정 연결 열기"
      data-testid="deck-account-error"
      @action="nav?.openSettings('account')"
    />

    <template v-else-if="read">
      <DeckOpponent v-model="opponentKey" :options="options" :opponent="opponent" :disabled="engine.computing" />

      <!-- 결과: 편성 위에 큰 총딜 숫자. 「추정 · 실전 미대조」는 언제나 보인다. -->
      <section class="nk-card" aria-label="계산 결과" data-testid="deck-result" :data-fresh="fresh ? 'yes' : 'no'">
        <div class="nk-row">
          <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
          <StatusPill v-if="read.account.is_test_data" label="검증용 데이터" tone="test" solid data-testid="data-kind" />
          <span class="nk-muted" data-testid="account-line">계정 <strong>{{ read.account.name ?? read.name }}</strong></span>
          <span class="nk-spacer"></span>
          <button type="button" class="nk-btn" :disabled="members.length === 0" data-testid="deck-copy" @click="copy">편성 복사</button>
          <button type="button" class="nk-btn nk-btn--primary" :disabled="!canRun" :title="whyNot" data-testid="deck-run" @click="calc">
            {{ fresh ? '다시 계산' : '계산' }}
          </button>
        </div>
        <p v-if="copied" class="nk-muted" role="status" data-testid="deck-copied">{{ copied }}</p>
        <p v-if="copyError" class="nk-error" role="alert" data-testid="deck-copy-error"><strong>복사하지 못했다.</strong> {{ copyError }}</p>
        <p v-if="engine.busyElsewhere" class="nk-muted" data-testid="busy-elsewhere">다른 화면에서 계산이 돌고 있다. 끝나면 여기서 계산할 수 있다.</p>

        <template v-if="report">
          <p v-if="!fresh" class="nk-note" role="status" data-testid="deck-stale">편성이나 상대가 바뀌었다 — 아래 숫자는 바꾸기 전의 것이다. 「계산」을 누르면 지금 편성으로 다시 계산한다.</p>
          <div class="deck__bases" :class="{ 'deck__bases--stale': !fresh }">
            <div class="deck__basis" data-basis="account" data-testid="basis-account">
              <span class="deck__basis-label">내 계정 육성</span>
              <template v-if="mineTotal !== null">
                <span class="nk-row">
                  <span class="nk-hero" data-testid="deck-total">{{ damageUnit(mineTotal) }}</span>
                  <StatusPill label="추정" tone="estimate" solid detail="계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-role="estimate" />
                </span>
              </template>
              <template v-else>
                <StatusPill label="계산하지 못함" tone="error" solid data-testid="deck-failed-pill" />
                <span class="nk-muted" data-testid="deck-failed">이 편성은 계산하지 못했다 — 지원하지 않는 니케나 효과가 있을 수 있다. 0으로 치지 않는다. {{ outcomeProblem(mine) }}</span>
              </template>
            </div>
            <div class="deck__basis" data-basis="max" data-testid="basis-max">
              <span class="deck__basis-label" title="계산 도구의 기본 스펙: 돌파 3 · 스킬 10/10/10 · 오버로드 장비 5강 · 소장품·애장품·큐브 포함. 코어 강화는 0이다 — 전부 최대는 아니다.">
                모두 최대 육성 <span class="nk-seg__sub">계산 도구의 기본 스펙</span>
              </span>
              <template v-if="maxTotal !== null">
                <span class="nk-row">
                  <span class="deck__max" data-testid="deck-total-max">{{ damageUnit(maxTotal) }}</span>
                  <StatusPill label="추정" tone="estimate" />
                </span>
              </template>
              <template v-else>
                <StatusPill label="계산하지 못함" tone="error" data-testid="deck-max-failed-pill" />
                <span class="nk-muted" data-testid="deck-max-failed">이 기준으로는 계산하지 못했다. {{ outcomeProblem(max) }}</span>
              </template>
            </div>
          </div>
          <p v-if="report.growth" class="deck__growth" data-testid="deck-growth">{{ report.growth.text }}</p>
          <p v-if="fresh && mine?.status === 'computed' && mine.ungrown_members.length" class="nk-muted" data-testid="deck-ungrown">
            육성 정보가 비어 키우지 않은 것으로 계산한 니케: {{ mine.ungrown_members.join(', ') }}
          </p>
          <p v-if="fresh && report.cache && report.cache.misses === 0" class="nk-muted" data-testid="deck-reused">앞서 계산해 둔 결과를 바로 가져왔다.</p>
        </template>
        <div v-else-if="!engine.computing" class="nk-row" data-testid="deck-hint">
          <StatusPill label="계산 전" />
          <span>{{ full ? '「계산」을 누르면 이 편성의 총딜과 니케별 딜이 나온다.' : '아래 보유 니케에서 다섯 명을 골라 자리에 놓는다.' }}</span>
        </div>

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
        <p v-if="error" class="nk-error" role="alert" data-testid="deck-error">
          <strong>계산하지 못했다.</strong> {{ error }} 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.
        </p>
      </section>

      <!-- 다섯 자리 -->
      <section class="nk-card" aria-label="편성" data-testid="deck-slots">
        <div class="nk-row">
          <h2 class="nk-subtitle">편성</h2>
          <span class="nk-muted" data-testid="deck-count">{{ members.length }} / {{ slots.length }}명 — 자리끼리 끌거나 ◀ ▶로 순서를 바꾼다</span>
          <span class="nk-spacer"></span>
          <button type="button" class="nk-btn" :disabled="!canRun" :title="whyNot ?? '같은 다섯 명의 자리 순서를 바꿔 가며 계산해 가장 좋은 순서를 찾는다'" data-testid="order-run" @click="tryOrder">자리 순서 비교</button>
          <button type="button" class="nk-btn nk-btn--quiet" :disabled="members.length === 0 || engine.computing" data-testid="deck-clear" @click="clearAll">모두 비우기</button>
        </div>

        <ol class="deck__row">
          <li
            v-for="(name, i) in slots"
            :key="i"
            class="deck__slot"
            :class="{ 'deck__slot--over': dragOver === i && dragFrom !== null && dragFrom !== i }"
            :data-index="i"
            :data-filled="name ? 'yes' : 'no'"
            :data-name="name ?? undefined"
            :draggable="name !== null && !engine.computing"
            data-testid="deck-slot"
            @dragstart="onDragStart(i, $event)"
            @dragover.prevent="dragOver = i"
            @drop.prevent="onDrop(i)"
            @dragend="onDragEnd"
          >
            <span class="deck__no" data-testid="slot-no">{{ i + 1 }}번</span>
            <template v-if="name">
              <NikkeTile :name="name" size="lg" :element="info(name).element" :burst="info(name).burst" :weak="isWeak(name)" :share="shareOf(name)" />
              <div class="deck__moves">
                <button type="button" class="deck__mini" :disabled="i === 0 || engine.computing" :title="`${name} — 앞 자리로`" :aria-label="`${name} — 앞 자리로`" data-testid="slot-left" @click="move(i, i - 1)">◀</button>
                <button type="button" class="deck__mini" :disabled="engine.computing" :title="`${name} — 자리에서 빼기`" data-testid="slot-remove" @click="remove(i)">빼기</button>
                <button type="button" class="deck__mini" :disabled="i === slots.length - 1 || engine.computing" :title="`${name} — 뒷 자리로`" :aria-label="`${name} — 뒷 자리로`" data-testid="slot-right" @click="move(i, i + 1)">▶</button>
              </div>
              <button type="button" class="deck__mini deck__mini--wide" :disabled="!canRun" :title="whyNot ?? swapHint(i)" data-testid="slot-swap" @click="trySwap(i)">바꿔 본다면</button>
            </template>
            <span v-else class="deck__empty" data-testid="slot-empty">빈 자리</span>
          </li>
        </ol>

        <!-- 버스트 단계 구성: 모자란 것이 있으면 바로 보인다(다 찼는데 모자라면 경고색). -->
        <p v-if="burst.text" class="deck__burst" :data-ok="'no'" :data-tone="burst.full ? 'unknown' : 'neutral'" role="status" data-testid="deck-burst">{{ burst.text }}</p>
        <p v-else-if="members.length" class="deck__burst" data-ok="yes" data-tone="ok" data-testid="deck-burst">버스트 1·2·3단계가 모두 있다.</p>
        <p v-if="notice" class="nk-note" role="status" data-testid="deck-notice">{{ notice }}</p>
      </section>

      <!-- 한 명을 바꾼다면 -->
      <section v-if="swap" class="nk-card" aria-label="한 명을 바꾼다면" data-testid="swap-panel" :data-slot="swap.slot">
        <div class="nk-row">
          <h2 class="nk-subtitle">한 명을 바꾼다면</h2>
          <span class="nk-muted" data-testid="swap-head">{{ swap.slot + 1 }}번 자리의 {{ swap.out }} 대신 — 총딜이 큰 순서</span>
          <StatusPill label="추정" tone="estimate" />
        </div>
        <p v-if="swap.baseline.status !== 'computed'" class="nk-note" data-testid="swap-no-baseline">지금 편성을 계산하지 못해 얼마나 달라지는지는 알 수 없다. {{ outcomeProblem(swap.baseline) }}</p>
        <p v-if="swap.candidates.total === 0" class="nk-note" data-testid="swap-none">이 자리에 넣어 볼 수 있는 보유 니케가 없다(같은 버스트 단계의 다른 니케가 없다).</p>
        <ul v-else class="deck__swaps" data-testid="swap-rows">
          <li v-for="row in swap.rows" :key="row.name" class="deck__swap" :data-name="row.name" :data-up="row.change !== null && row.change > 0 ? 'yes' : 'no'" data-testid="swap-row">
            <NikkeTile :name="row.name" size="mini" :element="info(row.name).element" :burst="info(row.name).burst" :weak="isWeak(row.name)" />
            <span class="deck__swap-name" data-testid="swap-name">{{ row.name }}</span>
            <strong class="deck__change" :data-tone="row.change !== null && row.change > 0 ? 'ok' : 'neutral'" data-testid="swap-change">{{ changeText(row.change) }}</strong>
            <span class="nk-muted" data-testid="swap-total">{{ damageUnit(row.total_damage) }}</span>
            <span class="nk-spacer"></span>
            <button type="button" class="nk-btn nk-btn--quiet" :disabled="!canRun" title="지금 편성과 이 니케로 바꾼 편성의 버스트 흐름을 위아래로 견준다" data-testid="swap-burst" @click="compareBurst(`${row.name}(으)로 바꾼 편성`, row.members)">버스트 흐름 견주기</button>
            <button type="button" class="nk-btn" :disabled="engine.computing" data-testid="swap-apply" @click="applySwap(swap.slot, row.name)">이 니케로 바꾸기</button>
          </li>
        </ul>
        <!-- 상한 때문에 못 본 것과 계산하지 못한 것은 접지 않고 적는다. -->
        <p v-if="swap.skipped.length" class="nk-note" data-testid="swap-skipped">
          한 번에 {{ swap.candidates.limit }}명까지만 넣어 본다(많이 키운 순). 보지 못한 니케 {{ swap.skipped.length }}명: {{ swap.skipped.join(', ') }}
        </p>
        <p v-if="swap.failed.length" class="nk-note" data-testid="swap-failed">
          계산하지 못한 니케 {{ swap.failed.length }}명(지원하지 않음 — 0으로 치지 않고 뺐다):
          <span v-for="f in swap.failed" :key="f.name" data-testid="swap-failed-item">{{ f.name }} — {{ f.reason }} </span>
        </p>
        <p class="nk-muted">한 명만 바꾼 값이다. 나머지 넷과 자리 순서는 그대로 두고 계산했다.</p>
      </section>

      <!-- 자리 순서 비교 -->
      <section v-if="order" class="nk-card" aria-label="자리 순서 비교" data-testid="order-panel" :data-changed="order.changed ? 'yes' : 'no'">
        <div class="nk-row">
          <h2 class="nk-subtitle">자리 순서 비교</h2>
          <StatusPill label="추정" tone="estimate" />
        </div>
        <template v-if="order.changed">
          <div class="nk-row">
            <span class="nk-muted">가장 좋은 순서</span>
            <span class="deck__order" data-testid="order-best">
              <span v-for="(name, i) in order.best.members" :key="name" class="deck__order-item" :title="`${i + 1}번 ${name}`" data-testid="order-member" :data-name="name">
                <NikkeTile :name="name" size="mini" :element="info(name).element" :burst="info(name).burst" :weak="isWeak(name)" />
              </span>
            </span>
            <strong class="deck__change" data-tone="ok" data-testid="order-gain">지금 순서보다 {{ orderGain }}</strong>
            <span class="nk-muted" data-testid="order-total">{{ damageUnit(order.current.total_damage) }} → {{ damageUnit(order.best.total_damage) }}</span>
            <span class="nk-spacer"></span>
            <button type="button" class="nk-btn nk-btn--quiet" :disabled="!canRun" title="지금 순서와 가장 좋은 순서의 버스트 흐름을 위아래로 견준다" data-testid="order-burst" @click="compareBurst('가장 좋은 자리 순서', order.best.members)">버스트 흐름 견주기</button>
            <button type="button" class="nk-btn nk-btn--primary" :disabled="engine.computing" data-testid="order-apply" @click="applyOrder(order.best.members)">이 순서로 바꾸기</button>
          </div>
          <p class="nk-muted" data-testid="order-changes">바꾼 것: {{ order.changes.join(', ') }}</p>
        </template>
        <p v-else class="nk-note" data-testid="order-kept">
          <template v-if="order.variants.total === 0">이 다섯 명에게는 바꿔 볼 자리 순서가 없다.</template>
          <template v-else>견줘 본 {{ order.variants.simulated }}가지 가운데 지금 순서가 가장 좋다({{ damageUnit(order.current.total_damage) }}).</template>
        </p>
        <p v-if="order.variants.skipped > 0" class="nk-note" data-testid="order-skipped">
          한 번에 {{ order.variants.limit }}가지까지만 견준다. 바꿔 볼 수 있는 {{ order.variants.total }}가지 가운데 {{ order.variants.skipped }}가지는 보지 못했다.
        </p>
        <p v-if="order.variants.failed > 0" class="nk-note" data-testid="order-failed">{{ order.variants.failed }}가지는 계산하지 못했다(0으로 치지 않고 뺐다).</p>
        <p class="nk-muted">같은 버스트 단계 안의 순서와 3번 자리에 누가 서는지만 바꿔 본다 — 모든 순서를 본 것이 아니다.</p>
      </section>

      <!-- 버스트 흐름: 지금 편성(과 견줄 편성)의 버스트 순환을 타임라인으로 -->
      <BurstPanel
        ref="burstPanel"
        :run-name="RUN_DECK"
        :condition="opponent?.condition ?? null"
        :load-account="() => read!.account"
        :squads="burstSquads"
        :state-key="burstKey"
        :blocked="burstBlocked"
      />

      <DeckRoster :rows="rows" :picked="members" :weak-to="weakTo" :disabled="engine.computing" :plan="marks?.plan.value ?? null" @pick="add" />

      <template v-if="decks">
        <p v-if="decks.problem.value || bookError" class="nk-error" role="alert" data-testid="book-problem">{{ bookError || decks.problem.value }}</p>
        <DeckBook :book="decks.book.value" :can-save="members.length > 0" :info="info" @save-slot="saveSlot" @clear-slot="clearSlot" @add="addSaved" @remove="removeSaved" @load="loadDeck" />
      </template>

      <DetailsFold summary="계산 조건" :count="conditionCount" :tone="opponent && (opponent.unconfirmed.length || opponent.flags.length) ? 'unknown' : 'neutral'" data-testid="deck-conditions">
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
        <template v-if="fresh && report">
          <p class="nk-list__head">가정</p>
          <ul class="nk-list" data-testid="assumptions">
            <li v-for="(a, i) in report.assumptions" :key="`a${i}`" data-testid="assumption-item">{{ a }}</li>
            <li data-testid="max-spec">모두 최대 육성 = {{ report.engine_default_spec }}</li>
          </ul>
          <p class="nk-list__head">주의</p>
          <ul class="nk-list" data-testid="caveats">
            <li v-for="(c, i) in report.caveats" :key="`c${i}`" data-testid="caveat-item">{{ c }}</li>
            <li v-for="(w, i) in warnings" :key="`w${i}`" data-testid="warning-item">{{ w }}</li>
          </ul>
          <p class="nk-list__head">계산 정보</p>
          <ul class="nk-list">
            <li data-testid="engine-version">계산 도구: {{ engineLabel(report.engine) }}</li>
            <li v-if="report.cache" data-testid="reused">앞서 계산해 둔 것을 다시 쓴 편성 {{ report.cache.hits }}건 · 새로 계산한 편성 {{ report.cache.misses }}건</li>
          </ul>
        </template>
      </DetailsFold>
    </template>
  </div>
</template>

<style scoped>
.deck {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-5);
  min-width: 0;
}

.deck__bases {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--nk-tile-lg) * 2.5), 1fr));
  gap: var(--nk-space-4);
}

.deck__bases--stale {
  opacity: 0.55;
}

.deck__basis {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  min-width: 0;
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.deck__basis[data-basis='account'] {
  border-color: var(--nk-accent);
}

.deck__basis-label {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--nk-space-3);
  color: var(--nk-text-muted);
  font-weight: var(--nk-weight-bold);
}

.deck__max {
  font-size: var(--nk-font-xl);
  font-weight: var(--nk-weight-heavy);
  line-height: var(--nk-line-tight);
}

.deck__growth {
  margin: 0;
  font-size: var(--nk-font-lg);
  overflow-wrap: anywhere;
}

.deck__row {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--nk-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.deck__slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-2);
  min-width: calc(var(--nk-tile-lg) + var(--nk-space-5));
  min-height: calc(var(--nk-tile-lg) * 2);
  padding: var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.deck__slot[data-filled='no'] {
  justify-content: center;
  border-style: dashed;
  background: transparent;
}

.deck__slot[draggable='true'] {
  cursor: grab;
}

.deck__slot--over {
  border-color: var(--nk-accent);
  background: var(--nk-accent-soft);
}

.deck__no {
  align-self: flex-start;
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-bold);
}

.deck__empty {
  color: var(--nk-text-faint);
}

.deck__moves {
  display: flex;
  gap: var(--nk-space-2);
}

.deck__mini {
  padding: var(--nk-space-1) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-sm);
  background: transparent;
  color: var(--nk-text-muted);
  font: inherit;
  font-size: var(--nk-font-sm);
  cursor: pointer;
}

.deck__mini:hover:not(:disabled) {
  border-color: var(--nk-accent);
  color: var(--nk-text);
}

.deck__mini:disabled {
  opacity: 0.4;
  cursor: default;
}

.deck__mini--wide {
  align-self: stretch;
}

.deck__burst {
  margin: 0;
  color: var(--nk-tone);
  font-weight: var(--nk-weight-bold);
  overflow-wrap: anywhere;
}

.deck__swaps {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.deck__swap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-2) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
}

.deck__swap-name {
  min-width: calc(var(--nk-tile-lg) * 1.5);
  font-weight: var(--nk-weight-bold);
}

.deck__change {
  min-width: calc(var(--nk-tile-sm) + var(--nk-space-3));
  color: var(--nk-tone);
  font-size: var(--nk-font-lg);
}

.deck__order {
  display: inline-flex;
  gap: var(--nk-space-2);
}

.deck__order-item {
  display: inline-flex;
}
</style>
