<script setup lang="ts">
// 편성 순위 한 벌: 고른 편성의 큰 총딜 숫자와 「추정」 배지, 자리 순서대로 놓은 니케 타일 다섯(딜 비중 막대), 그 밖의 순위 줄.
// 처음에는 1위가 보인다. 순위 줄을 누르면 그 편성의 타일로 바뀐다. 수치를 고치거나 다시 계산하지 않는다 — 받은 값을 그린다.
import { computed, ref, watch } from 'vue';
import { damageUnit, percent } from '../lib/format';
import type { NikkeInfo, RankingEntry } from '../types';
import NikkeTile from '../ui/NikkeTile.vue';
import RankRow from '../ui/RankRow.vue';
import StatusPill from '../ui/StatusPill.vue';

const props = withDefaults(
  defineProps<{
    ranking: RankingEntry[];
    /** 니케 정보(속성·버스트 단계)를 주는 함수. 화면이 엔진 카탈로그에서 얻어 넘긴다. */
    info: (name: string) => NikkeInfo;
    /** 이 보스의 약점 속성인 니케의 이름. 강조할 것이 없으면 빈 목록. */
    weak?: string[];
    /** 타일 크기: 데스크톱 앱은 lg, 오버레이는 sm. */
    size?: 'lg' | 'sm';
  }>(),
  { weak: () => [], size: 'lg' },
);

/** 지금 타일로 보이는 편성(ranking의 몇 번째인가). */
const shown = ref(0);
// 다른 결과·다른 보스로 바뀌면 1위로 돌아간다.
watch(
  () => props.ranking,
  () => {
    shown.value = 0;
  },
);

const entry = computed<RankingEntry | null>(() => props.ranking[shown.value] ?? props.ranking[0] ?? null);
const isWeak = (name: string) => props.weak.includes(name);
/** 순위 줄: 지금 타일로 보이는 편성을 뺀 나머지. */
const others = computed(() => props.ranking.map((e, index) => ({ e, index })).filter(({ index }) => index !== shown.value));
const caption = computed(() => {
  const e = entry.value;
  if (!e) return '';
  if (e.rank === 1) return '1위 편성';
  const ratio = typeof e.relative_to_best === 'number' && Number.isFinite(e.relative_to_best) ? ` — 1위의 ${Math.round(e.relative_to_best * 100)}%` : '';
  return `${e.rank}위 편성${ratio}`;
});
</script>

<template>
  <section v-if="entry" class="squad" :data-rank="entry.rank" data-testid="squad-panel">
    <div class="squad__head">
      <span class="squad__total" data-testid="squad-total">{{ damageUnit(entry.total_damage) }}</span>
      <StatusPill label="추정" tone="estimate" solid detail="계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-role="estimate" />
      <span class="squad__caption" data-testid="squad-caption">{{ caption }}</span>
      <span class="squad__name" data-testid="squad-name">{{ entry.name }}</span>
    </div>

    <div class="squad__tiles" data-testid="squad-tiles">
      <div
        v-for="m in entry.members ?? []"
        :key="m.name"
        class="squad__member"
        :title="`${m.name} — ${damageUnit(m.damage)} (${percent(m.share)})`"
        :data-weak="isWeak(m.name) ? 'yes' : 'no'"
        data-testid="squad-member"
      >
        <NikkeTile :name="m.name" :size="size" :element="info(m.name).element" :burst="info(m.name).burst" :weak="isWeak(m.name)" :share="m.share ?? null" />
      </div>
    </div>

    <!-- 편성별 메모(계산 과정의 말)는 부모가 접어 둔 「계산 조건」에 빠짐없이 싣는다. 여기에는 결과를 읽을 때 꼭 알아야 하는 것만 둔다. -->
    <p v-if="(entry.ungrown_members ?? []).length" class="squad__notes" data-testid="squad-ungrown">
      육성 정보가 비어 키우지 않은 것으로 계산한 니케: {{ entry.ungrown_members.join(', ') }}
    </p>

    <div v-if="others.length" class="squad__ranks" data-testid="squad-ranks">
      <button
        v-for="{ e, index } in others"
        :key="`${e.rank}-${e.name}`"
        type="button"
        class="squad__pick"
        :title="`${e.rank}위 편성의 니케를 본다`"
        :data-rank="e.rank"
        data-testid="rank-pick"
        @click="shown = index"
      >
        <RankRow
          :rank="e.rank"
          :members="(e.members ?? []).map((m) => ({ name: m.name, element: info(m.name).element, weak: isWeak(m.name) }))"
          :total-damage="e.total_damage"
          :relative="e.rank === 1 ? null : e.relative_to_best"
        />
      </button>
    </div>
  </section>
  <p v-else class="squad__none" data-testid="squad-none">계산이 끝난 편성이 없다.</p>
</template>

<style scoped>
.squad {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
}

.squad__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--nk-space-2) var(--nk-space-4);
}

.squad__total {
  font-size: var(--nk-font-hero);
  font-weight: var(--nk-weight-heavy);
  line-height: var(--nk-line-tight);
}

.squad__caption {
  color: var(--nk-text);
  font-weight: var(--nk-weight-bold);
}

.squad__name {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
  overflow-wrap: anywhere;
}

.squad__tiles {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--nk-space-4);
}

.squad__notes {
  margin: 0;
  color: var(--nk-text-muted);
  overflow-wrap: anywhere;
}

.squad__ranks {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
}

.squad__pick {
  display: block;
  padding: 0;
  border: var(--nk-border-width) solid transparent;
  border-radius: var(--nk-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.squad__pick:hover {
  border-color: var(--nk-accent);
}

.squad__none {
  margin: 0;
  color: var(--nk-text-muted);
}
</style>
