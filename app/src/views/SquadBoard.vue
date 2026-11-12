<script setup lang="ts">
// 편성 추천·비교 결과(docs/data-model.md §비교 결과)를 새 부품으로 그린다: 1위의 큰 총딜 숫자와 니케 타일, 그 밖의 순위 줄,
// 접어 둔 「계산 조건」. 숨기면 안 되는 표시(추정·검증용 데이터·계산하지 못한 편성)는 접힌 구획 밖의 배지다.
// 수치를 고치거나 다시 계산하지 않는다 — 결과 문서의 값을 그린다.
import { computed } from 'vue';
import { engineLabel, localTime } from '../lib/format';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { CompareReport } from '../types';
import DetailsFold from '../ui/DetailsFold.vue';
import StatusPill from '../ui/StatusPill.vue';
import SquadPanel from './SquadPanel.vue';

const props = defineProps<{ report: CompareReport }>();

const { info } = useNikkeCatalog();

/** 검증용인지 실제 계정인지. 결과가 밝히지 않았으면 모른다고 표시한다(실제 계정으로 단정하지 않는다). */
const dataKind = computed(() => {
  const flag = props.report.account?.is_test_data;
  if (flag === true) return { tone: 'test' as const, label: '검증용 데이터' };
  if (flag === false) return null;
  return { tone: 'unknown' as const, label: '데이터 구분 미확인' };
});

const generated = computed(() => localTime(props.report.generated_at));
const dropped = computed(() => (props.report.rejected ?? []).length + (props.report.failed ?? []).length);
/** 계산 알림(계산 도구가 편성마다 남긴 말)을 모두 모은다 — 버리지 않는다. */
const warnings = computed(() => (props.report.ranking ?? []).flatMap((e) => (e.engine_warnings ?? []).map((w) => `${e.name}: ${w}`)));
/** 편성마다 남은 메모(자리 순서를 어떻게 바꿨는지 등 — 계산 과정의 말). 「계산 조건」에 빠짐없이 싣는다. */
const squadNotes = computed(() => (props.report.ranking ?? []).flatMap((e) => (e.notes ?? []).map((note) => `${e.rank}위 편성: ${note}`)));
const conditionCount = computed(
  () => (props.report.assumptions ?? []).length + (props.report.caveats ?? []).length + squadNotes.value.length + dropped.value + warnings.value.length,
);
const made = computed(() => {
  const s = props.report.suggestion;
  if (!s) return '';
  return `보유 니케 ${s.considered}명에서 편성 ${s.generated}개를 만들어 ${s.simulated}개를 계산하고 상위 ${s.shown}개를 보인다.`;
});
</script>

<template>
  <div class="board" data-testid="squad-board">
    <div class="board__meta">
      <!-- 「추정 · 실전 미대조」는 언제나 보인다(접지 않는다). -->
      <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
      <StatusPill v-if="dataKind" :label="dataKind.label" :tone="dataKind.tone" solid data-testid="data-kind" />
      <StatusPill v-if="dropped" :label="`계산하지 못한 편성 ${dropped}개`" tone="unknown" data-testid="dropped-pill" />
      <StatusPill
        v-if="report.excluded"
        :label="`${report.excluded.label} ${report.excluded.count}명 제외`"
        tone="unknown"
        :detail="report.excluded.text"
        data-testid="excluded-pill"
      />
      <span class="board__account" data-testid="account-name">{{ report.account?.name ?? '(이름 없음)' }}</span>
      <span v-if="generated" class="board__time" data-testid="generated-at">계산 {{ generated }}</span>
    </div>

    <p v-if="made" class="board__made" data-testid="made">{{ made }}</p>

    <section class="board__card">
      <SquadPanel :ranking="report.ranking ?? []" :info="info" />
    </section>

    <DetailsFold summary="계산 조건" :count="conditionCount" :tone="dropped ? 'unknown' : 'neutral'" data-testid="calc-conditions">
      <template v-if="(report.assumptions ?? []).length">
        <p class="nk-list__head">가정</p>
        <ul class="nk-list" data-testid="assumptions">
          <li v-for="(a, i) in report.assumptions" :key="i" data-testid="assumption-item">{{ a }}</li>
        </ul>
      </template>
      <template v-if="(report.caveats ?? []).length || squadNotes.length">
        <p class="nk-list__head">주의</p>
        <ul class="nk-list" data-testid="caveats">
          <li v-for="(n, i) in squadNotes" :key="`s${i}`" data-testid="squad-note">{{ n }}</li>
          <li v-for="(c, i) in report.caveats ?? []" :key="i" data-testid="caveat-item">{{ c }}</li>
        </ul>
      </template>
      <template v-if="dropped">
        <p class="nk-list__head">계산하지 못한 편성</p>
        <ul class="nk-list" data-testid="issues">
          <li v-for="r in report.rejected ?? []" :key="`r-${r.name}`" data-testid="rejected-item">{{ r.name }}: {{ (r.reasons ?? []).join(' / ') }}</li>
          <li v-for="f in report.failed ?? []" :key="`f-${f.name}`" data-testid="failed-item">{{ f.name }}: {{ f.error?.message }}</li>
        </ul>
      </template>
      <template v-if="warnings.length">
        <p class="nk-list__head">계산 알림</p>
        <ul class="nk-list" data-testid="warnings">
          <li v-for="(w, i) in warnings" :key="i" data-testid="warning-item">{{ w }}</li>
        </ul>
      </template>
      <p class="nk-list__head">계산 정보</p>
      <ul class="nk-list">
        <li data-testid="engine-version">계산 도구: {{ engineLabel(report.engine) }}</li>
        <li v-if="report.cache" data-testid="reused">앞서 계산해 둔 것을 다시 쓴 편성 {{ report.cache.hits }}건 · 새로 계산한 편성 {{ report.cache.misses }}건</li>
      </ul>
    </DetailsFold>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
}

.board__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.board__account {
  font-weight: var(--nk-weight-bold);
}

.board__time {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
}

.board__made {
  margin: 0;
  color: var(--nk-text-muted);
}

.board__card {
  padding: var(--nk-space-5);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
}
</style>
