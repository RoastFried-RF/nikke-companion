// 덱 빌더(P-030) — 화면 쪽: 계정마다 두는 「내 편성」(번호 칸 다섯과 이름 붙인 목록)의 상태, 다른 화면에서 넘겨받는 편성,
// 그리고 루트의 순수 함수(src/core/deck.mjs)를 화면의 값으로 잇는 곳.
//
// 규칙은 전부 루트의 순수 모듈에 있다(자리에 넣고 빼기·버스트 구성·상대 → 전투 조건·저장 문서·복사할 글) — 여기에는 규칙이 없다.
// 디스크(계정 폴더의 `<계정>.decks.json`)에 두는 일은 Rust가 한다. 이 상태는 데스크톱 앱 창의 뿌리(App.vue)가 만들고,
// 기본 계정이 바뀌면 그 계정의 것을 다시 읽는다. 오버레이 창에는 없다(`useDecks()`가 null).
import {
  addSaved as coreAddSaved,
  BASIS_LABELS,
  burstCheck as coreBurstCheck,
  clearSlot as coreClearSlot,
  DECK_NAME_MAX,
  DECK_SIZE,
  DECK_SLOT_COUNT,
  deckFromRanking,
  deckKey as coreDeckKey,
  deckText as coreDeckText,
  DEFAULT_ORDER_LIMIT,
  DEFAULT_SWAP_LIMIT,
  emptyDeckBook,
  emptySlots as coreEmptySlots,
  listOpponents as coreListOpponents,
  moveMember as coreMoveMember,
  normalizeSlots as coreNormalizeSlots,
  OPPONENT_GROUPS,
  placeMember as corePlaceMember,
  readDeckBook,
  removeMember as coreRemoveMember,
  removeSaved as coreRemoveSaved,
  resolveOpponent as coreResolveOpponent,
  saveSlot as coreSaveSlot,
  slotLabel as coreSlotLabel,
  swapCandidates as coreSwapCandidates,
} from '@core/deck.mjs';
import { inject, onBeforeUnmount, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue';
import type { AccountDoc, DeckBook, DeckOpponent, EngineCatalog, OpponentOption, RankingEntry, SavedDeck } from '../types';
import { errorMessage, loadDecks, saveDecks } from './backend';
import { ANOMALY_BUNDLE } from './builtin';
import { recall, remember } from './remember';
import type { Shared } from './shared';

export { BASIS_LABELS, DECK_NAME_MAX, DECK_SIZE, DECK_SLOT_COUNT, DEFAULT_ORDER_LIMIT, DEFAULT_SWAP_LIMIT, OPPONENT_GROUPS };

export type Slots = (string | null)[];

/** 다른 화면이 덱 빌더에 넘기는 편성(요격전 추천의 「덱 빌더에서 열기」). */
export interface IncomingDeck {
  members: Slots;
  /** 상대의 열쇠. 없으면 고른 상대를 그대로 둔다. */
  opponent: string | null;
  /** 넘길 때마다 는다 — 같은 편성을 두 번 넘겨도 다시 받는다. */
  seq: number;
}

/** 저장할 편성(화면이 넘긴다). */
export interface DeckDraft {
  name?: string;
  members: Slots;
  opponent: string | null;
  opponent_label: string | null;
  total_damage: number | null;
}

export interface DeckStore {
  /** 지금 쓰는 계정의 내 편성. 계정이 없거나 아직 저장한 것이 없으면 빈 묶음이다. */
  book: Ref<DeckBook>;
  /** 처음 읽기가 끝났는가. */
  ready: Ref<boolean>;
  /** 읽거나 저장하다 난 문제(한국어 문장). */
  problem: Ref<string>;
  /** 다른 화면이 넘긴 편성. 덱 빌더가 받아 간다. */
  incoming: Ref<IncomingDeck | null>;
  /** 덱 빌더에서 지금 짜고 있는 편성과 고른 상대. 다른 화면(육성 효율)이 기준 편성으로 읽는다. */
  working: Ref<{ slots: Slots; opponent: string | null }>;
  /** 덱 빌더가 짜던 편성이 바뀔 때마다 알린다(이 PC에도 기억한다). */
  setWorking(slots: Slots, opponent: string | null): void;
  reload(): Promise<void>;
  /** 번호 칸에 저장한다. 값이 맞지 않으면 이유를 한국어 문장으로 던진다(아무것도 바뀌지 않는다). */
  saveSlot(index: number, deck: DeckDraft): Promise<void>;
  clearSlot(index: number): Promise<void>;
  /** 이름을 붙여 목록에 저장한다. */
  addSaved(deck: DeckDraft): Promise<void>;
  removeSaved(id: string): Promise<void>;
  /** 요격전 추천의 편성 한 줄을 덱 빌더에 넘긴다. */
  openRanking(entry: RankingEntry, bossId: string | null): void;
}

const KEY: InjectionKey<DeckStore> = Symbol('decks');

const blank = (): DeckBook => emptyDeckBook() as DeckBook;

export function createDeckStore(shared: Shared): { store: DeckStore; stop: () => void } {
  // 문서를 통째로 갈아 끼운다(안쪽을 고치지 않는다).
  const book = shallowRef<DeckBook>(blank());
  const ready = ref(false);
  const problem = ref('');
  const incoming = shallowRef<IncomingDeck | null>(null);
  // 덱 빌더를 아직 열지 않았어도 지난번에 짜던 편성을 안다(이 PC에 기억해 둔 것).
  const working = shallowRef<{ slots: Slots; opponent: string | null }>(recallWorking());
  /** 늦게 끝난 읽기가 나중 읽기를 덮지 않게 한다. */
  let seq = 0;
  let handed = 0;

  async function reload(): Promise<void> {
    const mine = ++seq;
    if (!shared.accountName.value) {
      book.value = blank();
      problem.value = '';
      ready.value = shared.ready.value;
      return;
    }
    try {
      const read = readDeckBook(await loadDecks(null));
      if (mine !== seq) return;
      book.value = read.book as DeckBook;
      problem.value = read.dropped > 0 ? `읽을 수 없는 저장한 편성 ${read.dropped}개는 뺐다.` : '';
    } catch (e) {
      if (mine !== seq) return;
      book.value = blank();
      problem.value = `저장한 편성을 읽지 못했다: ${errorMessage(e)}`;
    }
    ready.value = true;
  }

  /** 바꾼 묶음을 보이고 저장한다. 저장하지 못하면 되돌리고 알린다. */
  async function commit(next: DeckBook): Promise<void> {
    const before = book.value;
    seq += 1; // 도는 읽기가 방금 바꾼 것을 덮지 않게 한다.
    book.value = next;
    try {
      await saveDecks(null, next);
      problem.value = '';
    } catch (e) {
      book.value = before;
      problem.value = `편성을 저장하지 못했다: ${errorMessage(e)}`;
      throw new Error(problem.value);
    }
  }

  const now = () => new Date().toISOString();
  const store: DeckStore = {
    book,
    ready,
    problem,
    incoming,
    working,
    setWorking: (slots, opponent) => {
      working.value = { slots: normalizeSlots(slots), opponent };
      rememberWorking(slots, opponent);
    },
    reload,
    saveSlot: async (index, deck) => commit(coreSaveSlot(book.value, index, deck, { now: now() }) as DeckBook),
    clearSlot: (index) => commit(coreClearSlot(book.value, index) as DeckBook),
    addSaved: async (deck) => commit(coreAddSaved(book.value, deck, { now: now() }) as DeckBook),
    removeSaved: (id) => commit(coreRemoveSaved(book.value, id) as DeckBook),
    openRanking: (entry, bossId) => {
      const picked = deckFromRanking(entry, bossId) as { members: Slots; opponent: string | null };
      handed += 1;
      incoming.value = { members: picked.members, opponent: picked.opponent, seq: handed };
    },
  };

  // 기본 계정이 정해지거나 바뀌면 그 계정의 것을 읽는다.
  const stop = watch([shared.accountName, shared.ready], () => void reload(), { immediate: true });
  return { store, stop };
}

/** 데스크톱 앱 창의 뿌리(App.vue)가 부른다. */
export function provideDecks(shared: Shared): DeckStore {
  const { store, stop } = createDeckStore(shared);
  provide(KEY, store);
  onBeforeUnmount(stop);
  return store;
}

/** 화면들이 부른다. 뿌리 밖에서(오버레이 창, 화면만 따로 띄운 테스트) 쓰이면 null. */
export function useDecks(): DeckStore | null {
  return inject(KEY, null);
}

// ── 루트의 순수 함수를 화면의 값으로 ──────────────────────────────────────────

export const emptySlots = (): Slots => coreEmptySlots() as Slots;
export const normalizeSlots = (slots: unknown): Slots => coreNormalizeSlots(slots) as Slots;
export const placeMember = (slots: Slots, name: string, index: number | null = null) =>
  corePlaceMember(slots, name, index) as { slots: Slots; placed: number | null; problem: string | null };
export const removeMember = (slots: Slots, index: number): Slots => coreRemoveMember(slots, index) as Slots;
export const moveMember = (slots: Slots, from: number, to: number): Slots => coreMoveMember(slots, from, to) as Slots;
export const deckKey = (slots: Slots, opponent: string | null): string => coreDeckKey(slots, opponent) as string;
export const slotLabel = (index: number): string => coreSlotLabel(index) as string;

export interface BurstCheck {
  counts: Record<string, number>;
  missing: string[];
  uncovered: number;
  ok: boolean;
  full: boolean;
  text: string | null;
}
export const burstCheck = (slots: Slots, catalog: EngineCatalog | null): BurstCheck => coreBurstCheck(slots, catalog ?? { nikkes: {} }) as BurstCheck;

/** 상대 목록: 앱에 내장한 이상 개체 보스 → 계산 도구의 보스 프리셋 → 속성만 정하기. */
export function opponentOptions(catalog: EngineCatalog | null): OpponentOption[] {
  return coreListOpponents({ bundle: ANOMALY_BUNDLE, catalog }) as OpponentOption[];
}

/** 고른 상대의 전투 조건과 표시. 모르는 열쇠면 null. */
export function resolveOpponent(key: string | null, catalog: EngineCatalog | null): DeckOpponent | null {
  return (coreResolveOpponent(key, { bundle: ANOMALY_BUNDLE, catalog }) as DeckOpponent | null) ?? null;
}

/** 한 자리에 넣어 볼 니케의 수(계산 전에 「몇 명을 넣어 본다」를 말하는 데 쓴다). */
export function swapPreview(slots: Slots, slot: number, account: AccountDoc | null | undefined, catalog: EngineCatalog | null, limit: number = DEFAULT_SWAP_LIMIT) {
  return coreSwapCandidates({ members: slots, slot, account: account ?? { nikkes: {} }, catalog: catalog ?? { nikkes: {} }, limit }) as {
    out: string | null;
    group: string | null;
    candidates: string[];
    skipped: string[];
    total: number;
  };
}

/** 복사할 글: 자리 순서대로 이름, 상대, 총딜, 「추정」 표시. */
export function deckText(input: { members: Slots; opponent_label: string | null; weak_to: string | null; total_damage: number | null }): string {
  return coreDeckText(input) as string;
}

/** 저장한 편성의 니케 수. */
export const deckCount = (deck: SavedDeck): number => deck.members.filter((m) => m !== null).length;

// ── 이 PC에 기억해 두는 것(편성 저장과는 다르다 — 화면의 편의) ───────────────────

/** 짜던 편성과 고른 상대를 기억하는 이름. */
const WORKING = 'deck.working';
/** 「다섯 자리가 차면 바로 계산」(설정 > 계산 도구)을 기억하는 이름. 'on'이면 켬 — 기본은 끔. */
export const AUTO_KEY = 'deck.auto';
/** 처음 고르는 상대: 계산 도구의 솔로 레이드 프리셋이 있으면 그것(편성 도구의 추천과 같은 기준), 없으면 속성 없음. */
export const FALLBACK_OPPONENT = 'element:none';

export function recallWorking(): { slots: Slots; opponent: string | null } {
  try {
    const saved = JSON.parse(recall(WORKING) || 'null') as { slots?: unknown; opponent?: unknown } | null;
    return { slots: normalizeSlots(saved?.slots), opponent: typeof saved?.opponent === 'string' ? saved.opponent : null };
  } catch {
    return { slots: emptySlots(), opponent: null };
  }
}

export function rememberWorking(slots: Slots, opponent: string | null): void {
  remember(WORKING, JSON.stringify({ slots, opponent }));
}

export const recallAuto = (): boolean => recall(AUTO_KEY) === 'on';
export const rememberAuto = (on: boolean): void => {
  remember(AUTO_KEY, on ? 'on' : 'off');
};
