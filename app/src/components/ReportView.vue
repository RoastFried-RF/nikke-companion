<script setup lang="ts">
// 비교 결과(docs/data-model.md §비교 결과)를 그린다. 수치를 고치거나 다시 계산하지 않는다 —
// 결과 파일에 있는 값을 서식만 입혀 보여 준다. CLI 표(src/core/render.mjs)와 같은 내용이다.
import { computed } from 'vue';
import { searchLine } from '@core/render.mjs';
import type { CompareReport } from '../types';
import CaveatList from './CaveatList.vue';
import IssueBlocks from './IssueBlocks.vue';
import ReportMeta from './ReportMeta.vue';
import SquadRanking from './SquadRanking.vue';

const props = defineProps<{ report: CompareReport }>();

/**
 * 추천의 탐색 요약 한 줄(쓴 시뮬 횟수·예산·단계별 건수·예산으로 못 본 것) — CLI 표와 같은 문장을 루트의
 * src/core/render.mjs가 만든다. 결과에 칸이 없으면(비교 결과, 옛 추천 결과) 그리지 않는다.
 */
const searchLabel = computed(() => searchLine(props.report.suggestion?.search));
</script>

<template>
  <div class="report">
    <ReportMeta
      :account="report.account"
      :condition="report.condition"
      :engine="report.engine"
      :cache="report.cache"
      :generated-at="report.generated_at"
      :assumptions="report.assumptions"
    >
      <div v-if="report.suggestion" class="meta__line" data-testid="suggestion">
        후보: 조합 {{ report.suggestion.considered }}개 중 {{ report.suggestion.generated }}개 생성 →
        {{ report.suggestion.simulated }}개 계산 → 상위 {{ report.suggestion.shown }}개 표시
      </div>
      <div v-if="searchLabel" class="meta__line" data-testid="search">{{ searchLabel }}</div>
    </ReportMeta>

    <section class="block" aria-label="순위">
      <SquadRanking :ranking="report.ranking ?? []" />
    </section>

    <IssueBlocks :rejected="report.rejected ?? []" :failed="report.failed ?? []" noun="편성" />

    <CaveatList :caveats="report.caveats ?? []" />
  </div>
</template>

<style scoped>
.report {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
