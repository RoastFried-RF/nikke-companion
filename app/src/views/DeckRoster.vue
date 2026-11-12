<script setup lang="ts">
// 덱 빌더의 「보유 니케」 격자: 초상화를 눌러 편성에 넣는다. 속성·버스트 단계·이름으로 거른다.
// 편성에 이미 든 니케는 누를 수 없다(같은 니케를 두 번 넣을 수 없다). 초상화는 한 판씩만 그린다.
import { computed, ref, watch } from 'vue';
import { filterRoster, type RosterFilter, type RosterRow } from '../lib/roster';
import NikkeTile from '../ui/NikkeTile.vue';

const props = withDefaults(
  defineProps<{
    rows: RosterRow[];
    /** 지금 편성에 든 니케의 이름. */
    picked: string[];
    /** 상대의 약점 속성(그 속성 니케에 테두리). 모르면 null. */
    weakTo?: string | null;
    disabled?: boolean;
  }>(),
  { weakTo: null, disabled: false },
);

defineEmits<{ pick: [name: string] }>();

/** 한 번에 그리는 타일 수(초상화를 그만큼씩만 묻는다). */
const PAGE_SIZE = 60;
const ELEMENTS = ['작열', '풍압', '철갑', '전격', '수냉'];
const BURSTS = ['1', '2', '3'];

const filter = ref<RosterFilter>({ element: '', burst: '', grownOnly: false, query: '' });
const shownCount = ref(PAGE_SIZE);
const filtered = computed(() => filterRoster(props.rows, filter.value));
const visible = computed(() => filtered.value.slice(0, shownCount.value));
const rest = computed(() => Math.max(0, filtered.value.length - shownCount.value));
watch(filter, () => (shownCount.value = PAGE_SIZE), { deep: true });

function toggle(key: 'element' | 'burst', value: string): void {
  filter.value[key] = filter.value[key] === value ? '' : value;
}
</script>

<template>
  <section class="nk-card" aria-label="보유 니케" data-testid="deck-roster">
    <div class="nk-row">
      <h2 class="nk-subtitle">보유 니케</h2>
      <span class="nk-muted">눌러서 빈 자리에 넣는다</span>
      <span class="nk-spacer"></span>
      <span class="nk-muted" data-testid="deck-roster-count">{{ filtered.length }}명</span>
    </div>
    <div class="nk-row" aria-label="거르기">
      <input
        v-model="filter.query"
        class="nk-input"
        type="search"
        spellcheck="false"
        autocomplete="off"
        placeholder="이름으로 찾기"
        aria-label="이름으로 찾기"
        data-testid="deck-search"
      />
      <div class="nk-seg" role="group" aria-label="속성">
        <button
          v-for="el in ELEMENTS"
          :key="el"
          type="button"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': filter.element === el }"
          :aria-pressed="filter.element === el"
          :data-element="el"
          data-testid="deck-filter-element"
          @click="toggle('element', el)"
        >
          {{ el }}
        </button>
      </div>
      <div class="nk-seg" role="group" aria-label="버스트 단계">
        <button
          v-for="b in BURSTS"
          :key="b"
          type="button"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': filter.burst === b }"
          :aria-pressed="filter.burst === b"
          :data-burst="b"
          data-testid="deck-filter-burst"
          @click="toggle('burst', b)"
        >
          버스트 {{ b }}
        </button>
      </div>
    </div>

    <p v-if="filtered.length === 0" class="nk-note" data-testid="deck-roster-empty">조건에 맞는 니케가 없다.</p>
    <ul v-else class="pick" data-testid="deck-grid">
      <li v-for="row in visible" :key="row.name">
        <button
          type="button"
          class="pick__item"
          :disabled="disabled || picked.includes(row.name)"
          :data-name="row.name"
          :data-in="picked.includes(row.name) ? 'yes' : 'no'"
          :title="picked.includes(row.name) ? `${row.name} — 이미 편성에 있다` : `${row.name} — 편성에 넣기`"
          data-testid="deck-pick"
          @click="$emit('pick', row.name)"
        >
          <NikkeTile :name="row.name" size="sm" :element="row.info.element" :burst="row.info.burst" :weak="!!weakTo && row.info.element === weakTo" />
        </button>
      </li>
    </ul>
    <button v-if="rest > 0" type="button" class="nk-btn" data-testid="deck-roster-more" @click="shownCount += PAGE_SIZE">더 보기 (남은 {{ rest }}명)</button>
  </section>
</template>

<style scoped>
.pick {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--nk-tile-sm) + var(--nk-space-5)), 1fr));
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.pick__item {
  display: flex;
  justify-content: center;
  width: 100%;
  padding: var(--nk-space-2);
  border: var(--nk-border-width) solid transparent;
  border-radius: var(--nk-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.pick__item:hover:not(:disabled) {
  border-color: var(--nk-accent);
  background: var(--nk-accent-soft);
}

.pick__item:disabled {
  cursor: default;
}

/* 이미 편성에 든 니케: 흐리게 + 테두리(색만으로 알리지 않는다 — 풍선 도움말에 적혀 있다). */
.pick__item[data-in='yes'] {
  border-color: var(--nk-border-strong);
  opacity: 0.35;
}
</style>
