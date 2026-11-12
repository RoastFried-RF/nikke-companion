<script setup lang="ts">
// 내 니케(데스크톱 앱): 기본 계정의 보유 니케를 초상화 격자로 — 이름·속성·버스트 단계와 육성 요약(돌파·스킬·오버로드 줄 수).
// 속성·버스트 단계·「육성한 것만」으로 거르고 이름으로 찾는다. 계정을 고치지 않는다 — 계정에 적힌 값을 보여 줄 뿐이다.
// 초상화는 한꺼번에 묻지 않는다: 처음에는 한 판만 그리고, 아래로 내리거나 「더 보기」를 누르면 다음 판을 그린다.
import { computed, onActivated, ref, watch } from 'vue';
import { errorMessage } from '../lib/backend';
import { localTime } from '../lib/format';
import { useNav } from '../lib/nav';
import { breakthroughLabel, filterRoster, overloadLabel, rosterRows, skillsLabel, type RosterFilter } from '../lib/roster';
import { useShared } from '../lib/shared';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { AccountRead } from '../types';
import EmptyState from '../ui/EmptyState.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import StatusPill from '../ui/StatusPill.vue';

/** 한 번에 그리는 타일 수(초상화를 그만큼씩만 묻는다). */
const PAGE_SIZE = 48;
const ELEMENTS = ['작열', '풍압', '철갑', '전격', '수냉'];
const BURSTS = ['1', '2', '3'];

const shared = useShared();
const nav = useNav();
const { catalog } = useNikkeCatalog();

const read = ref<AccountRead | null>(null);
const loading = ref(false);
const error = ref('');
const filter = ref<RosterFilter>({ element: '', burst: '', grownOnly: false, query: '' });
const shownCount = ref(PAGE_SIZE);
/** 늦게 끝난 읽기가 나중 읽기를 덮지 않게 한다. */
let seq = 0;

const accountName = computed(() => shared?.accountName.value ?? null);
const ready = computed(() => shared?.ready.value ?? true);

async function load(): Promise<void> {
  if (!shared || !accountName.value) {
    read.value = null;
    return;
  }
  const mine = ++seq;
  loading.value = true;
  error.value = '';
  try {
    const next = await shared.loadAccount();
    if (mine === seq) read.value = next;
  } catch (e) {
    if (mine === seq) error.value = errorMessage(e);
  } finally {
    if (mine === seq) loading.value = false;
  }
}

// 계정이 바뀌거나 새로 받았으면 다시 읽는다.
if (shared) watch([shared.accountName, shared.accountSavedAt], load, { immediate: true });
// 다른 화면에서 계정을 새로 받고 돌아왔을 때도 본다.
onActivated(() => {
  if (!read.value && accountName.value) void load();
});

const rows = computed(() => rosterRows(read.value?.account, catalog.value));
const filtered = computed(() => filterRoster(rows.value, filter.value));
const visible = computed(() => filtered.value.slice(0, shownCount.value));
const rest = computed(() => Math.max(0, filtered.value.length - shownCount.value));
// 거르기를 바꾸면 첫 판부터 다시 그린다.
watch(filter, () => (shownCount.value = PAGE_SIZE), { deep: true });

function more(): void {
  shownCount.value += PAGE_SIZE;
}

/** 목록 끝에 가까워지면 다음 판을 그린다. */
function onScroll(event: Event): void {
  const box = event.target as HTMLElement;
  if (rest.value > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - box.clientHeight / 2) more();
}

const synchro = computed(() => read.value?.account?.account?.synchro_level ?? null);
const fetchedAt = computed(() => localTime(read.value?.account?.updated_at ?? read.value?.modified_at));
const withUnknown = computed(() => rows.value.filter((r) => r.unknown.length > 0).length);

function toggle(key: 'element' | 'burst', value: string): void {
  filter.value[key] = filter.value[key] === value ? '' : value;
}
</script>

<template>
  <div class="nk-page roster" data-testid="page-roster">
    <header class="nk-head">
      <h1 class="nk-title">내 니케</h1>
    </header>

    <SkeletonBlock v-if="!ready || (loading && !read)" shape="tiles" :count="8" label="계정을 읽는 중" />

    <EmptyState
      v-else-if="!accountName"
      title="아직 계정을 연결하지 않았다"
      hint="계정을 연결하면 보유 니케와 육성 상태가 여기에 보인다."
      action="계정 연결하기"
      data-testid="need-account"
      @action="nav?.openSettings('account')"
    />

    <EmptyState
      v-else-if="error && !read"
      tone="error"
      title="계정을 읽지 못했다"
      :hint="`${error} 설정의 계정 연결에서 계정을 새로 받아 본다.`"
      action="계정 연결 열기"
      data-testid="roster-error"
      @action="nav?.openSettings('account')"
    />

    <template v-else-if="read">
      <section class="nk-card" aria-label="계정 요약" data-testid="roster-summary">
        <div class="nk-row">
          <strong data-testid="roster-account">{{ read.account.name ?? read.name }}</strong>
          <StatusPill v-if="read.account.is_test_data" label="검증용 데이터" tone="test" solid data-testid="data-kind" />
          <span data-testid="roster-count">니케 {{ rows.length }}명</span>
          <span data-testid="roster-synchro">동기화 레벨 {{ synchro ?? '미확인' }}</span>
          <span v-if="fetchedAt" class="nk-muted" data-testid="roster-fetched">마지막으로 받은 때 {{ fetchedAt }}</span>
          <StatusPill
            v-if="withUnknown"
            :label="`미확인 칸이 있는 니케 ${withUnknown}명`"
            tone="unknown"
            detail="받아 오지 못한 육성 칸이 있다. 그 칸은 키우지 않은 것으로 계산된다."
            data-testid="roster-unknown"
          />
          <span class="nk-spacer"></span>
          <button type="button" class="nk-btn" data-testid="roster-refetch" @click="nav?.openSettings('account')">계정 새로 받기</button>
        </div>
      </section>

      <section class="nk-row" aria-label="거르기" data-testid="roster-filters">
        <input
          v-model="filter.query"
          class="nk-input"
          type="search"
          spellcheck="false"
          autocomplete="off"
          placeholder="이름으로 찾기"
          aria-label="이름으로 찾기"
          data-testid="roster-search"
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
            data-testid="filter-element"
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
            data-testid="filter-burst"
            @click="toggle('burst', b)"
          >
            버스트 {{ b }}
          </button>
        </div>
        <label class="roster__check">
          <input v-model="filter.grownOnly" type="checkbox" data-testid="filter-grown" />
          육성한 것만
        </label>
        <span class="nk-muted" data-testid="roster-shown">{{ filtered.length }}명</span>
      </section>

      <p v-if="filtered.length === 0" class="nk-note" data-testid="roster-empty">조건에 맞는 니케가 없다.</p>

      <div v-else class="roster__scroll" data-testid="roster-scroll" @scroll.passive="onScroll">
        <ul class="roster__grid" data-testid="roster-grid">
          <li v-for="row in visible" :key="row.name" class="roster__item" :data-grown="row.grown ? 'yes' : 'no'" data-testid="roster-item">
            <NikkeTile :name="row.name" :element="row.info.element" :burst="row.info.burst" />
            <span class="roster__growth" data-testid="roster-growth">
              <span title="돌파(+코어 강화)" data-testid="roster-breakthrough">{{ breakthroughLabel(row) }}</span>
              <span title="스킬 레벨" data-testid="roster-skills">{{ skillsLabel(row) }}</span>
              <span title="오버로드 옵션 줄 수" data-testid="roster-overload">{{ overloadLabel(row) }}</span>
            </span>
            <StatusPill v-if="row.unknown.length" label="미확인" tone="unknown" :detail="`받아 오지 못한 칸: ${row.unknown.join(', ')}`" data-testid="roster-item-unknown" />
          </li>
        </ul>
        <button v-if="rest > 0" type="button" class="nk-btn" data-testid="roster-more" @click="more">더 보기 (남은 {{ rest }}명)</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.roster {
  flex: 1;
  min-height: 0;
}

.roster__check {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-2);
  cursor: pointer;
}

.roster__scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-height: 0;
  overflow-y: auto;
}

.roster__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--nk-tile-lg) + var(--nk-space-5)), 1fr));
  gap: var(--nk-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.roster__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-2);
  padding: var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface);
}

.roster__item[data-grown='no'] {
  opacity: 0.6;
}

.roster__growth {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}
</style>
