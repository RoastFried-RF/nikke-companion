<script setup lang="ts">
// 비교 결과(docs/data-model.md §비교 결과)를 그린다. 수치를 고치거나 다시 계산하지 않는다 —
// 결과 파일에 있는 값을 서식만 입혀 보여 준다. CLI 표(src/core/render.mjs)와 같은 내용이다.
import { computed } from 'vue';
import { searchLine } from '@core/render.mjs';
import { damageRaw, damageUnit, percent } from '../lib/format';
import type { CompareReport } from '../types';

const props = defineProps<{ report: CompareReport }>();

const account = computed(() => props.report.account ?? {});
const ranking = computed(() => props.report.ranking ?? []);
const rejected = computed(() => props.report.rejected ?? []);
const failed = computed(() => props.report.failed ?? []);
const caveats = computed(() => props.report.caveats ?? []);
const assumptions = computed(() => props.report.assumptions ?? []);

/** 검증용인지 실제 계정인지. 결과 파일이 밝히지 않았으면 모른다고 표시한다. */
const dataKind = computed(() => {
  const flag = account.value.is_test_data;
  if (flag === true) return { key: 'test', label: '검증용 데이터' };
  if (flag === false) return { key: 'real', label: '실제 계정 데이터' };
  return { key: 'unknown', label: '데이터 구분 미확인' };
});

const engineLabel = computed(() => {
  const engine = props.report.engine;
  const repo = engine?.repo ?? '엔진 미확인';
  const commit = engine?.commit ? engine.commit.slice(0, 8) : '버전 미확인';
  return `${repo} @ ${commit}${engine?.dirty ? ' (수정된 작업 폴더)' : ''}`;
});

/** 시뮬 결과 캐시 한 줄 — CLI 표(src/core/render.mjs의 cacheLines)와 같은 문장. 결과에 칸이 없으면 그리지 않는다. */
const cacheLabel = computed(() => {
  const cache = props.report.cache;
  if (cache === undefined) return '';
  if (cache === null) return '쓰지 않음';
  return `적중 ${cache.hits}건 · 엔진 계산 ${cache.misses}건 · 새로 저장 ${cache.stored}건`;
});
const cacheWarnings = computed(() => props.report.cache?.warnings ?? []);

/**
 * 추천의 탐색 요약 한 줄(쓴 시뮬 횟수·예산·단계별 건수·예산으로 못 본 것) — CLI 표와 같은 문장을 루트의
 * src/core/render.mjs가 만든다. 결과에 칸이 없으면(비교 결과, 옛 추천 결과) 그리지 않는다.
 */
const searchLabel = computed(() => searchLine(props.report.suggestion?.search));

const conditionLabel = computed(() => {
  const c = props.report.condition ?? {};
  const parts: string[] = [];
  if (typeof c.boss === 'string') parts.push(c.boss);
  if (typeof c.duration === 'number') parts.push(`${c.duration}초`);
  return parts.join(' · ');
});

const generatedAt = computed(() => {
  const raw = props.report.generated_at;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
});

/** 1위 대비 막대의 너비. 표시용이며 0~100%로 자른다. */
function barWidth(relative: unknown): string {
  const x = typeof relative === 'number' && Number.isFinite(relative) ? relative : 0;
  return `${Math.min(100, Math.max(0, x * 100)).toFixed(1)}%`;
}
</script>

<template>
  <div class="report">
    <header class="meta">
      <div class="meta__row">
        <span class="meta__account" data-testid="account-name">{{ account.name ?? '(이름 없음)' }}</span>
        <span class="badge" :class="`badge--${dataKind.key}`" data-testid="data-kind">{{ dataKind.label }}</span>
      </div>
      <div v-if="conditionLabel" class="meta__line" data-testid="condition">조건: {{ conditionLabel }}</div>
      <div class="meta__line" data-testid="engine-version">엔진: {{ engineLabel }}</div>
      <div v-if="cacheLabel" class="meta__line" data-testid="cache">캐시: {{ cacheLabel }}</div>
      <div v-for="(w, i) in cacheWarnings" :key="`cache-warning-${i}`" class="meta__line meta__line--warn" data-testid="cache-warning">
        ! {{ w }}
      </div>
      <div v-if="generatedAt" class="meta__line" data-testid="generated-at">계산 시각: {{ generatedAt }}</div>
      <div v-if="report.suggestion" class="meta__line" data-testid="suggestion">
        후보: 조합 {{ report.suggestion.considered }}개 중 {{ report.suggestion.generated }}개 생성 →
        {{ report.suggestion.simulated }}개 계산 → 상위 {{ report.suggestion.shown }}개 표시
      </div>
      <div v-if="searchLabel" class="meta__line" data-testid="search">{{ searchLabel }}</div>
      <details v-if="assumptions.length" class="fold" data-testid="assumptions">
        <summary>가정 {{ assumptions.length }}개</summary>
        <ul class="bullets">
          <li v-for="(a, i) in assumptions" :key="i">{{ a }}</li>
        </ul>
      </details>
    </header>

    <section class="block" aria-label="순위">
      <p v-if="ranking.length === 0" class="empty" data-testid="ranking-empty">계산된 편성이 없다.</p>
      <ol v-else class="ranking">
        <li
          v-for="entry in ranking"
          :key="`${entry.rank}-${entry.name}`"
          class="squad"
          :class="{ 'squad--best': entry.rank === 1 }"
          data-testid="ranking-entry"
        >
          <div class="squad__head">
            <span class="squad__rank" data-testid="rank">{{ entry.rank }}위</span>
            <span class="squad__name" data-testid="squad-name">{{ entry.name }}</span>
            <span class="squad__relative" data-testid="relative">
              {{ entry.rank === 1 ? '기준' : `1위 대비 ${percent(entry.relative_to_best)}` }}
            </span>
          </div>
          <div class="squad__total">
            <span class="squad__unit" data-testid="total-unit">{{ damageUnit(entry.total_damage) }}</span>
            <span class="squad__raw" data-testid="total-raw">({{ damageRaw(entry.total_damage) }})</span>
          </div>
          <div class="bar" aria-hidden="true">
            <div class="bar__fill" :style="{ width: barWidth(entry.relative_to_best) }"></div>
          </div>

          <table class="members">
            <tbody>
              <tr v-for="(m, i) in entry.members ?? []" :key="`${i}-${m.name}`" data-testid="member">
                <td class="members__name" data-testid="member-name">{{ m.name }}</td>
                <td class="members__num" data-testid="member-share">{{ percent(m.share) }}</td>
                <td class="members__num members__unit" data-testid="member-unit">{{ damageUnit(m.damage) }}</td>
                <td class="members__num members__raw" data-testid="member-raw">{{ damageRaw(m.damage) }}</td>
              </tr>
            </tbody>
          </table>

          <ul v-if="(entry.notes ?? []).length || (entry.ungrown_members ?? []).length" class="notes">
            <li v-for="(n, i) in entry.notes ?? []" :key="i" data-testid="note">{{ n }}</li>
            <li v-if="(entry.ungrown_members ?? []).length" data-testid="ungrown">
              육성 정보가 비어 미육성으로 계산: {{ entry.ungrown_members.join(', ') }}
            </li>
          </ul>

          <details v-if="(entry.engine_warnings ?? []).length" class="fold" data-testid="engine-warnings">
            <summary>엔진 알림 {{ entry.engine_warnings.length }}건</summary>
            <ul class="bullets">
              <li v-for="(w, i) in entry.engine_warnings" :key="i">{{ w }}</li>
            </ul>
          </details>
        </li>
      </ol>
    </section>

    <section v-if="rejected.length" class="block" data-testid="rejected">
      <h2 class="block__title">계산하지 않은 편성</h2>
      <ul class="issues">
        <li v-for="(r, i) in rejected" :key="i" data-testid="rejected-entry">
          <div class="issues__name">{{ r.name }}</div>
          <div class="issues__reason" data-testid="rejected-reason">{{ (r.reasons ?? []).join(' / ') }}</div>
          <div v-if="(r.members ?? []).length" class="issues__members">{{ r.members.join(', ') }}</div>
        </li>
      </ul>
    </section>

    <section v-if="failed.length" class="block block--failed" data-testid="failed">
      <h2 class="block__title">엔진이 계산하지 못한 편성</h2>
      <ul class="issues">
        <li v-for="(f, i) in failed" :key="i" data-testid="failed-entry">
          <div class="issues__name">{{ f.name }}</div>
          <div class="issues__reason" data-testid="failed-reason">
            {{ f.error?.message ?? '오류 내용 없음' }}<template v-if="f.error?.path"> ({{ f.error.path }})</template>
          </div>
          <div v-if="(f.members ?? []).length" class="issues__members">{{ f.members?.join(', ') }}</div>
        </li>
      </ul>
    </section>

    <section class="block block--caveats" data-testid="caveats">
      <h2 class="block__title">주의</h2>
      <p v-if="caveats.length === 0" class="empty">결과 파일에 주의 문구가 없다.</p>
      <ul v-else class="bullets">
        <li v-for="(c, i) in caveats" :key="i" data-testid="caveat">{{ c }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.report {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta__account {
  font-size: 14px;
  font-weight: 700;
}

.meta__line {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.meta__line--warn {
  color: var(--warn);
}

.badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid var(--line);
}

.badge--test {
  color: #1a1300;
  background: var(--warn);
  border-color: var(--warn);
}

.badge--real {
  color: var(--accent);
  border-color: var(--accent);
}

.badge--unknown {
  color: var(--muted);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.block__title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.02em;
}

.block--failed .block__title {
  color: var(--danger);
}

.empty {
  margin: 0;
  color: var(--muted);
}

.ranking {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.squad {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.squad--best {
  border-color: rgba(255, 196, 64, 0.6);
}

.squad__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.squad__rank {
  font-weight: 800;
  color: var(--accent);
}

.squad--best .squad__rank {
  color: var(--gold);
}

.squad__name {
  flex: 1;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.squad__relative {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

.squad__total {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}

.squad__unit {
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.squad__raw {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.bar {
  height: 4px;
  margin: 4px 0 6px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.bar__fill {
  height: 100%;
  background: var(--accent);
}

.squad--best .bar__fill {
  background: var(--gold);
}

.members {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.members td {
  padding: 1px 0;
}

.members__name {
  overflow-wrap: anywhere;
}

.members__num {
  padding-left: 8px;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.members__unit {
  font-weight: 700;
}

.members__raw {
  color: var(--muted);
}

.notes {
  margin-top: 6px;
  color: var(--warn);
  font-size: 12px;
}

.notes li::before {
  content: '! ';
  font-weight: 800;
}

.fold {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
}

.fold summary {
  cursor: pointer;
}

.bullets {
  padding-left: 14px;
  list-style: disc;
  font-size: 12px;
}

.bullets li {
  margin-top: 2px;
  overflow-wrap: anywhere;
}

.issues {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.issues__name {
  font-weight: 700;
}

.issues__reason {
  color: var(--warn);
  overflow-wrap: anywhere;
}

.block--failed .issues__reason {
  color: var(--danger);
}

.issues__members {
  color: var(--muted);
}

.block--caveats {
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
</style>
