<script setup lang="ts">
// 요격전 보스별 추천 결과(docs/data-model.md §요격전 추천 결과)를 그린다: 보스를 골라 그 보스의 상위 편성을 본다.
// 게임을 하면서 보는 화면이라 보스 이름·약점 속성·1위 편성 5명이 접지 않은 상태에서 맨 위에 보인다.
// 수치를 고치거나 다시 계산하지 않는다 — 결과 문서의 값을 서식만 입혀 보여 준다. CLI 표(renderInterceptReport)와 같은 내용이다.
import { computed, ref } from 'vue';
import { CONTENT_LABELS } from '@core/intercept.mjs';
import { searchLine } from '@core/render.mjs';
import { cacheLabel, engineLabel, localTime } from '../lib/format';
import { recall, remember } from '../lib/remember';
import type { InterceptBoss, InterceptReport } from '../types';
import CaveatList from './CaveatList.vue';
import IssueBlocks from './IssueBlocks.vue';
import SquadRanking from './SquadRanking.vue';

const props = defineProps<{ report: InterceptReport }>();

/** 마지막으로 고른 보스(id)를 기억하는 이름. 다시 열면 그 보스가 보인다. */
const LAST_BOSS = 'intercept.boss';

/** 속성 이름 → 색을 정하는 CSS 이름. 표시용일 뿐이다(속성 상성 규칙은 루트의 src/core/intercept.mjs에 있다). */
const ELEMENT_CLASS: Record<string, string> = { 작열: 'fire', 수냉: 'water', 풍압: 'wind', 전격: 'electric', 철갑: 'iron' };
const elementClass = (element: string | null | undefined) => `element--${(element && ELEMENT_CLASS[element]) || 'none'}`;

const bosses = computed(() => props.report.bosses ?? []);
const picked = ref(recall(LAST_BOSS));
/** 고른 보스. 기억해 둔 보스가 이 결과에 없으면 첫 보스다(기억은 그대로 둔다). */
const boss = computed<InterceptBoss | null>(() => bosses.value.find((b) => b.id === picked.value) ?? bosses.value[0] ?? null);

function pick(id: string): void {
  picked.value = id;
  remember(LAST_BOSS, id);
}

/**
 * 계산에 쓰인 미확인 칸(엔진 기본값으로 계산한 칸). 약점은 계산 입력이 아니라서 뺀다 — CLI 표와 같다.
 * 보스 속성도 약점도 모르는 것은 「속성 상성 미반영」 표시(flags)가 따로 알린다.
 */
const unconfirmedOf = (b: InterceptBoss) => (b.unconfirmed ?? []).filter((u) => u.field !== 'weak_to');

const weakLabel = (b: InterceptBoss) => {
  const el = b.element;
  if (!el?.weak_to) return '약점 미확인';
  return `약점 ${el.weak_to}${el.weak_to_source === 'code' ? '(속성에서 유도)' : ''}`;
};

const codeLabel = (b: InterceptBoss) => {
  const el = b.element;
  if (!el?.code) return '속성 미확인';
  return `속성 ${el.code}${el.code_source === 'weak_to' ? '(약점에서 유도)' : ''}`;
};

/** 보상·레벨·전투 시간 한 줄 — CLI 표의 보스 머리 줄과 같은 내용. 확인되지 않은 것은 그렇게 적는다. */
function infoLine(b: InterceptBoss): string {
  const parts = [`보상 ${b.reward ?? '미확인'}`];
  const level = b.level;
  if (level) {
    parts.push(
      level.mode === 'fixed'
        ? `레벨 ${level.level}(상한 미확인)`
        : `레벨 ${level.level}(상한 ${level.cap}${level.assumed ? ' — 동기화 레벨을 몰라 상한으로 가정' : ''})`,
    );
  }
  parts.push(`전투 ${b.duration}초${(b.confirmed ?? []).includes('duration') ? '' : '(미확인 — 엔진 기본값)'}`);
  return parts.join(' · ');
}

/** 그 보스의 약점 속성 보유 니케. 순위의 멤버 가운데 이 이름에 「약점」 표시를 붙인다. */
const weakOwned = computed(() => boss.value?.weak_pool?.owned ?? []);

const searchLabel = computed(() => searchLine(boss.value?.suggestion?.search));

/** 검증용인지 실제 계정인지. 결과 파일이 밝히지 않았으면 모른다고 표시한다. */
const dataKind = computed(() => {
  const flag = props.report.account?.is_test_data;
  if (flag === true) return { key: 'test', label: '검증용 데이터' };
  if (flag === false) return { key: 'real', label: '실제 계정 데이터' };
  return { key: 'unknown', label: '데이터 구분 미확인' };
});

const contentLabel = computed(() => (CONTENT_LABELS as Record<string, string>)[props.report.content] ?? props.report.content);
const cacheText = computed(() => cacheLabel(props.report.cache));
const generated = computed(() => localTime(props.report.generated_at));
const simsLine = computed(() => {
  const sims = props.report.sims;
  if (!sims) return '';
  const each = (sims.per_boss ?? []).map((p) => `${p.name} ${p.used}/${p.budget}`).join(' · ');
  return `시뮬 ${sims.used}건 / 예산 ${sims.budget}건${each ? ` (${each})` : ''}`;
});
</script>

<template>
  <div class="intercept">
    <div class="meta__row">
      <span class="meta__account" data-testid="account-name">{{ report.account?.name ?? '(이름 없음)' }}</span>
      <span class="badge" :class="`badge--${dataKind.key}`" data-testid="data-kind">{{ dataKind.label }}</span>
      <span v-if="report.bundle?.is_test_data" class="badge badge--test" data-testid="bundle-kind">검증용 보스 묶음</span>
      <span v-if="generated" class="meta__line" data-testid="generated-at">계산 {{ generated }}</span>
    </div>

    <p v-if="bosses.length === 0" class="empty" data-testid="boss-empty">결과에 보스가 없다.</p>

    <!-- 보스 고르기. 미확인 값이 있는 보스와 속성 상성 미반영 보스는 여기서부터 표시가 붙는다. -->
    <div v-else class="bosses" role="tablist" aria-label="보스">
      <button
        v-for="b in bosses"
        :key="b.id"
        class="bosses__tab"
        :class="[elementClass(b.element?.weak_to), { 'bosses__tab--active': b.id === boss?.id }]"
        type="button"
        role="tab"
        :aria-selected="b.id === boss?.id"
        :data-boss="b.id"
        data-testid="boss-tab"
        @click="pick(b.id)"
      >
        <span class="bosses__name">{{ b.name }}</span>
        <span class="bosses__sub">
          <span class="bosses__weak">{{ b.element?.weak_to ?? '약점 ?' }}</span>
          <span v-if="(b.flags ?? []).length" class="bosses__mark bosses__mark--flag" :title="b.flags.join(', ')" data-testid="boss-tab-flag">!</span>
          <span
            v-if="unconfirmedOf(b).length"
            class="bosses__mark bosses__mark--unconfirmed"
            :title="`미확인 값 ${unconfirmedOf(b).length}칸`"
            data-testid="boss-tab-unconfirmed"
          >
            ?
          </span>
        </span>
      </button>
    </div>

    <section v-if="boss" class="boss" :data-boss="boss.id" data-testid="boss">
      <div class="boss__head">
        <h2 class="boss__name" data-testid="boss-name">{{ boss.name }}</h2>
        <span class="boss__weak" :class="elementClass(boss.element?.weak_to)" data-testid="boss-weak">{{ weakLabel(boss) }}</span>
        <span class="boss__code" data-testid="boss-code">{{ codeLabel(boss) }}</span>
      </div>

      <!-- 눈에 띄어야 하는 표시: 속성 상성 미반영, 미확인 값(엔진 기본값으로 계산한 칸). -->
      <div v-if="(boss.flags ?? []).length || unconfirmedOf(boss).length" class="boss__alerts" data-testid="boss-alerts">
        <span v-for="flag in boss.flags ?? []" :key="flag" class="badge badge--danger" data-testid="boss-flag">{{ flag }}</span>
        <span v-if="unconfirmedOf(boss).length" class="badge badge--warn" data-testid="boss-unconfirmed">
          미확인 값 {{ unconfirmedOf(boss).length }}칸 — 확정값이 아니다
        </span>
      </div>

      <p v-if="boss.status !== 'computed'" class="empty" data-testid="boss-not-computed">계산하지 않았다.</p>
      <template v-else>
        <SquadRanking :ranking="boss.ranking ?? []" :marked="weakOwned" mark="약점" />
        <IssueBlocks :rejected="boss.rejected ?? []" :failed="boss.failed ?? []" noun="편성" />
      </template>

      <ul v-if="(boss.notes ?? []).length" class="notes">
        <li v-for="(n, i) in boss.notes" :key="i" data-testid="boss-note">{{ n }}</li>
      </ul>

      <div class="meta__line" data-testid="boss-info">{{ infoLine(boss) }}</div>
      <div v-if="searchLabel" class="meta__line" data-testid="boss-search">{{ searchLabel }}</div>

      <details v-if="unconfirmedOf(boss).length" class="fold" data-testid="unconfirmed">
        <summary>미확인 값 {{ unconfirmedOf(boss).length }}칸 — 이렇게 계산했다</summary>
        <ul class="bullets">
          <li v-for="u in unconfirmedOf(boss)" :key="u.field" data-testid="unconfirmed-item">{{ u.label }}: {{ u.text }}</li>
        </ul>
      </details>
    </section>

    <details class="fold" data-testid="intercept-info">
      <summary>계산 정보 — 엔진·예산·가정</summary>
      <div class="meta">
        <div class="meta__line" data-testid="content">
          콘텐츠: {{ contentLabel }} · 보스 {{ bosses.length }}종{{ report.bundle?.name ? ` · ${report.bundle.name}` : '' }}
          {{ report.bundle?.version ? `(${report.bundle.version})` : '' }}
        </div>
        <div class="meta__line" data-testid="bundle-source">보스 값의 출처: {{ report.bundle?.source ?? '미확인' }}</div>
        <div class="meta__line" data-testid="engine-version">엔진: {{ engineLabel(report.engine) }}</div>
        <div v-if="cacheText" class="meta__line" data-testid="cache">캐시: {{ cacheText }}</div>
        <div v-for="(w, i) in report.cache?.warnings ?? []" :key="i" class="meta__line meta__line--warn" data-testid="cache-warning">! {{ w }}</div>
        <div v-if="simsLine" class="meta__line" data-testid="sims">예산: {{ simsLine }}</div>
        <ul v-if="(report.assumptions ?? []).length" class="bullets" data-testid="assumptions">
          <li v-for="(a, i) in report.assumptions" :key="i">{{ a }}</li>
        </ul>
      </div>
    </details>

    <CaveatList :caveats="report.caveats ?? []" />
  </div>
</template>

<style scoped>
.intercept {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 속성 색. 표시용이다. */
.element--fire {
  --element: #ff7a5c;
}

.element--water {
  --element: #5cb8ff;
}

.element--wind {
  --element: #6fdc8c;
}

.element--electric {
  --element: #c79bff;
}

.element--iron {
  --element: #ffd24d;
}

.element--none {
  --element: var(--muted);
}

.bosses {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.bosses__tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  /* 이름 길이대로 자리를 잡고, 한 줄에 다 못 들어가면 다음 줄로 넘긴다(이름을 자르지 않는다). */
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--element);
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.bosses__tab--active {
  border-color: var(--element);
  background: rgba(255, 255, 255, 0.08);
}

.bosses__name {
  max-width: 100%;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bosses__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.bosses__weak {
  color: var(--element);
}

.bosses__mark {
  display: inline-block;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 999px;
  font-weight: 800;
  line-height: 14px;
  text-align: center;
}

.bosses__mark--flag {
  background: var(--danger);
  color: #2a0505;
}

.bosses__mark--unconfirmed {
  background: var(--warn);
  color: #1a1300;
}

.boss {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.boss__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.boss__name {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.boss__weak {
  padding: 1px 8px;
  border: 1px solid var(--element);
  border-radius: 999px;
  color: var(--element);
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
}

.boss__code {
  color: var(--muted);
  font-size: 12px;
}

.boss__alerts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.boss .notes {
  margin-top: 0;
}
</style>
