<script setup lang="ts">
// 덱 빌더의 「내 편성」: 번호 칸 다섯(01~05 — 게임의 편성 칸과 같은 수)과 이름을 붙인 저장 목록.
// 보여 주고 단추를 누른 것을 알릴 뿐이다 — 저장(계정마다, 다시 켜도 남는다)은 부모가 lib/deck.ts의 상태로 한다.
// 저장한 총딜은 저장할 때의 추정치다(「추정」을 붙인다). 계산하지 않고 저장한 편성은 「계산 전」이다.
import { ref } from 'vue';
import { DECK_NAME_MAX, deckCount, slotLabel } from '../lib/deck';
import { damageUnit, localTime } from '../lib/format';
import type { DeckBook, NikkeInfo, SavedDeck } from '../types';
import NikkeTile from '../ui/NikkeTile.vue';

defineProps<{
  book: DeckBook;
  /** 지금 짠 편성을 저장할 수 있는가(니케가 한 명 이상 있다). */
  canSave: boolean;
  info: (name: string) => NikkeInfo;
}>();

const emit = defineEmits<{
  'save-slot': [index: number];
  'clear-slot': [index: number];
  add: [name: string];
  remove: [id: string];
  load: [deck: SavedDeck];
}>();

const name = ref('');

function add(): void {
  const trimmed = name.value.trim();
  if (!trimmed) return;
  emit('add', trimmed);
  name.value = '';
}

const totalLabel = (deck: SavedDeck): string => (deck.total_damage === null ? '계산 전' : `${damageUnit(deck.total_damage)} · 추정`);
</script>

<template>
  <section class="nk-card" aria-label="내 편성" data-testid="deck-book">
    <div class="nk-row">
      <h2 class="nk-subtitle">내 편성</h2>
      <span class="nk-muted">계정마다 따로 저장한다. 앱을 다시 켜도 남는다.</span>
    </div>

    <ul class="book__slots" data-testid="book-slots">
      <li v-for="(deck, i) in book.slots" :key="i" class="book__slot" :data-index="i" :data-filled="deck ? 'yes' : 'no'" data-testid="book-slot">
        <div class="nk-row">
          <strong class="book__no" data-testid="book-slot-no">{{ slotLabel(i) }}</strong>
          <span v-if="deck" class="book__name" data-testid="book-slot-name">{{ deck.name }}</span>
          <span v-else class="nk-muted" data-testid="book-slot-empty">비어 있다</span>
        </div>
        <template v-if="deck">
          <div class="book__tiles" data-testid="book-slot-tiles">
            <template v-for="(m, k) in deck.members" :key="k">
              <NikkeTile v-if="m" :name="m" size="xs" :element="info(m).element" :burst="info(m).burst" />
              <span v-else class="book__gap" title="빈 자리" aria-label="빈 자리"></span>
            </template>
          </div>
          <span class="nk-muted" data-testid="book-slot-info">
            {{ deck.opponent_label ? `상대 ${deck.opponent_label}` : '상대 미정' }} · {{ totalLabel(deck) }}<template v-if="deckCount(deck) < deck.members.length"> · {{ deckCount(deck) }}명</template>
          </span>
        </template>
        <div class="nk-row">
          <button type="button" class="nk-btn" :disabled="!canSave" :title="canSave ? `지금 편성을 ${slotLabel(i)}번 칸에 저장한다` : '니케를 한 명 이상 넣으면 저장할 수 있다'" data-testid="book-save" @click="emit('save-slot', i)">
            {{ deck ? '덮어쓰기' : '여기에 저장' }}
          </button>
          <button v-if="deck" type="button" class="nk-btn" data-testid="book-load" @click="emit('load', deck)">불러오기</button>
          <button v-if="deck" type="button" class="nk-btn nk-btn--quiet" data-testid="book-clear" @click="emit('clear-slot', i)">비우기</button>
        </div>
      </li>
    </ul>

    <div class="nk-row" data-testid="saved-form">
      <input
        v-model="name"
        class="nk-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :maxlength="DECK_NAME_MAX"
        placeholder="이름을 붙여 저장 (예: 솔레 1덱)"
        aria-label="저장할 편성의 이름"
        data-testid="saved-name"
        @keydown.enter="add"
      />
      <button type="button" class="nk-btn" :disabled="!canSave || !name.trim()" data-testid="saved-add" @click="add">이름 붙여 저장</button>
    </div>

    <p v-if="book.saved.length === 0" class="nk-muted" data-testid="saved-empty">이름을 붙여 저장한 편성이 아직 없다.</p>
    <ul v-else class="book__list" data-testid="saved-list">
      <li v-for="deck in book.saved" :key="deck.id" class="book__row" :data-id="deck.id" data-testid="saved-item">
        <strong class="book__name" data-testid="saved-item-name">{{ deck.name }}</strong>
        <div class="book__tiles">
          <template v-for="(m, k) in deck.members" :key="k">
            <NikkeTile v-if="m" :name="m" size="xs" :element="info(m).element" :burst="info(m).burst" />
            <span v-else class="book__gap" title="빈 자리" aria-label="빈 자리"></span>
          </template>
        </div>
        <span class="nk-muted" data-testid="saved-item-info">
          {{ deck.opponent_label ? `상대 ${deck.opponent_label}` : '상대 미정' }} · {{ totalLabel(deck) }}<template v-if="deck.saved_at"> · {{ localTime(deck.saved_at) }}</template>
        </span>
        <span class="nk-spacer"></span>
        <button type="button" class="nk-btn" data-testid="saved-load" @click="emit('load', deck)">불러오기</button>
        <button type="button" class="nk-btn nk-btn--quiet" data-testid="saved-remove" @click="deck.id && emit('remove', deck.id)">지우기</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.book__slots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--nk-tile-lg) * 2), 1fr));
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.book__slot {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  min-width: 0;
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.book__slot[data-filled='no'] {
  border-style: dashed;
  background: transparent;
}

.book__no {
  color: var(--nk-accent-strong);
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-heavy);
}

.book__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book__tiles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-2);
}

.book__gap {
  width: var(--nk-tile-xs);
  height: var(--nk-tile-xs);
  border: var(--nk-border-width) dashed var(--nk-border-strong);
  border-radius: var(--nk-radius-sm);
}

.book__list {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.book__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-3) var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
}
</style>
