<script setup lang="ts">
// 요격전 추천 결과(docs/data-model.md §요격전 추천 결과)를 새 부품으로 그린다 — 데스크톱 앱의 요격전 화면과 오버레이가 함께 쓴다.
//   위: 보스 카드(이미지·이름·약점·1위 총딜) — 눌러서 고른다
//   아래: 고른 보스의 한 줄 요약, 큰 총딜 숫자와 「추정」 배지, 니케 타일 다섯(자리 순서대로, 약점 속성 강조, 딜 비중 막대),
//         2·3위 줄(누르면 그 편성의 타일로 바뀐다), 약점 속성인데 이번 계산에 들지 못한 니케, 접어 둔 「계산 조건」
// 숨기면 안 되는 표시(추정·미확인 값·속성 상성 미반영·검증용 데이터)는 접힌 구획 밖의 배지다.
// 수치를 고치거나 다시 계산하지 않는다 — 결과 문서의 값을 그린다. 한 줄 요약은 루트의 순수 함수(src/core/summary.mjs)가 만든다.
import { summarizeInterceptBoss } from '@core/summary.mjs';
import { computed, onActivated, ref, watch } from 'vue';
import { useDecks } from '../lib/deck';
import { engineLabel, localTime } from '../lib/format';
import { useNav } from '../lib/nav';
import { recordCheck, usePlan } from '../lib/plan';
import { recall, remember } from '../lib/remember';
import { findBoss, LAST_BOSS, useScreenTrack } from '../lib/screenTrack';
import { useNikkeCatalog } from '../lib/useNikkeCatalog';
import type { InterceptBoss, InterceptReport, RankingEntry } from '../types';
import BossCard from '../ui/BossCard.vue';
import DetailsFold from '../ui/DetailsFold.vue';
import ElementChip from '../ui/ElementChip.vue';
import StatusPill from '../ui/StatusPill.vue';
import RecordPanel from './RecordPanel.vue';
import SquadPanel from './SquadPanel.vue';

const props = withDefaults(
  defineProps<{
    report: InterceptReport;
    /** 좁은 창(오버레이)에서는 작은 타일로 그린다. */
    compact?: boolean;
  }>(),
  { compact: false },
);

const { catalog, info } = useNikkeCatalog();

const bosses = computed(() => props.report.bosses ?? []);
const picked = ref(recall(LAST_BOSS));
/** 고른 보스. 기억해 둔 보스가 이 결과에 없으면 첫 보스다(기억은 그대로 둔다). */
const boss = computed<InterceptBoss | null>(() => bosses.value.find((b) => b.id === picked.value) ?? bosses.value[0] ?? null);

function pick(id: string): void {
  picked.value = id;
  remember(LAST_BOSS, id);
}

// 덱 빌더에서 열기(P-030): 지금 보이는 편성을 덱 빌더로 넘기고 그 화면을 연다. 데스크톱 앱 창에서만 된다(오버레이 창에는 없다).
const decks = useDecks();
const nav = useNav();
function openInDeck(entry: RankingEntry): void {
  if (!decks || !nav) return;
  decks.openRanking(entry, boss.value?.id ?? null);
  nav.openTool('deck');
}

// 요격전 기록(P-029): 고른 보스의 가장 최근 기록과 추정 총딜의 차이. 기록이 없으면(또는 이 창에 기록이 없으면) null.
const planStore = usePlan();
const check = computed(() => recordCheck(boss.value, planStore?.plan.value));

// 다른 화면(홈의 보스 카드)에서 보스를 고르고 돌아왔으면 그 보스를 보인다.
onActivated(() => {
  const saved = recall(LAST_BOSS);
  if (saved) picked.value = saved;
});

// 자동 추적: 게임에서 인식한 보스를 따라갈 때마다(lib/screenTrack.ts의 followStep이 정한다) 그 보스를 고른다.
// 같은 인식이 이어지는 동안에는 불리지 않으므로, 그 사이에 손으로 고른 보스는 그대로 남는다.
// 이 결과에 없는 보스면 고른 보스를 바꾸지 않는다(화면이 「이 결과에 없다」고 알린다).
const track = useScreenTrack();
if (track) {
  let applied = track.target.value?.seq ?? 0;
  const followTarget = (): void => {
    const target = track.target.value;
    if (!target || target.seq === applied) return;
    applied = target.seq;
    const found = findBoss(bosses.value, target);
    if (found) pick(found.id);
  };
  watch(() => track.target.value?.seq, followTarget);
  // 다른 화면에 가 있는 동안 따라간 것도 돌아올 때 반영한다.
  onActivated(followTarget);
}

const best = (b: InterceptBoss) => (b.ranking ?? []).find((e) => e.rank === 1) ?? (b.ranking ?? [])[0] ?? null;
/** 보스 카드의 총딜: 1위 편성의 총딜. 계산하지 않았으면 null(「계산 전」). */
const bestTotal = (b: InterceptBoss): number | null => (b.status === 'computed' ? (best(b)?.total_damage ?? null) : null);

/** 계산에 쓰인 미확인 칸(기본값으로 계산한 칸). 약점은 계산 입력이 아니라서 뺀다 — CLI 표와 같다. */
const unconfirmedOf = (b: InterceptBoss) => (b.unconfirmed ?? []).filter((u) => u.field !== 'weak_to');

/** 이 보스의 약점 속성인 니케(편성 멤버 가운데). 결과의 약점 속성 보유 목록을 쓰고, 없으면 니케 정보의 속성으로 본다. */
const weakNames = computed<string[]>(() => {
  const b = boss.value;
  const weak = b?.element?.weak_to;
  if (!b || !weak) return [];
  if (b.weak_pool && b.weak_pool.element === weak) return b.weak_pool.owned ?? [];
  const members = new Set((b.ranking ?? []).flatMap((e) => (e.members ?? []).map((m) => m.name)));
  return [...members].filter((name) => info(name).element === weak);
});

const summary = computed(() => {
  const b = boss.value;
  if (!b) return '';
  // 결과에 약점 속성 보유 목록이 없으면 니케 정보의 속성으로 판단한다(그것도 모르면 속성 이야기를 하지 않는다).
  const options = b.weak_pool || !catalog.value ? {} : { elementOf: (name: string) => info(name).element };
  return summarizeInterceptBoss(b, options).text;
});

const weakPool = computed(() => boss.value?.weak_pool ?? null);

/** 보상·레벨·전투 시간 한 줄. 확인되지 않은 것은 그렇게 적는다. */
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
  parts.push(`전투 ${b.duration}초${(b.confirmed ?? []).includes('duration') ? '' : '(미확인 — 기본값)'}`);
  return parts.join(' · ');
}

/** 검증용인지 실제 계정인지. 결과가 밝히지 않았으면 모른다고 표시한다(실제 계정으로 단정하지 않는다). */
const dataKind = computed(() => {
  const flag = props.report.account?.is_test_data;
  if (flag === true) return { tone: 'test' as const, label: '검증용 데이터' };
  if (flag === false) return null;
  return { tone: 'unknown' as const, label: '데이터 구분 미확인' };
});

const generated = computed(() => localTime(props.report.generated_at));

/** 편성마다 남은 메모(자리 순서를 어떻게 바꿨는지 등 — 계산 과정의 말). 「계산 조건」에 빠짐없이 싣는다. */
const squadNotes = computed(() => (boss.value?.ranking ?? []).flatMap((e) => (e.notes ?? []).map((note) => `${e.rank}위 편성: ${note}`)));

/** 「계산 조건」에 든 항목의 수(접힌 줄에 보인다). */
const conditionCount = computed(() => {
  const b = boss.value;
  if (!b) return 0;
  return (
    unconfirmedOf(b).length +
    (b.assumptions ?? []).length +
    (props.report.assumptions ?? []).length +
    (b.notes ?? []).length +
    squadNotes.value.length +
    (b.caveats ?? []).length +
    (props.report.caveats ?? []).length +
    (b.rejected ?? []).length +
    (b.failed ?? []).length
  );
});
</script>

<template>
  <div class="result" :class="{ 'result--compact': compact }" data-testid="intercept-result">
    <div class="result__meta">
      <!-- 「추정 · 실전 미대조」는 언제나 보인다(접지 않는다). -->
      <!-- 고른 보스에 손으로 적은 기록이 있으면 「기록과 ○○% 차이」로 바뀐다(추정이라는 사실은 그대로 적는다 — 추정치를 고치지 않는다). -->
      <StatusPill
        :label="check ? `추정 · ${check.text}` : '추정 · 실전 미대조'"
        tone="estimate"
        :detail="check ? check.detail : '수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다.'"
        :data-checked="check ? 'yes' : 'no'"
        data-testid="estimate-pill"
      />
      <StatusPill v-if="dataKind" :label="dataKind.label" :tone="dataKind.tone" solid data-testid="data-kind" />
      <StatusPill v-if="report.bundle?.is_test_data" label="검증용 보스 정보" tone="test" solid data-testid="bundle-kind" />
      <span class="result__account" data-testid="account-name">{{ report.account?.name ?? '(이름 없음)' }}</span>
      <span v-if="generated" class="result__time" data-testid="generated-at">계산 {{ generated }}</span>
    </div>

    <p v-if="bosses.length === 0" class="result__none" data-testid="boss-empty">결과에 보스가 없다.</p>

    <div v-else class="result__bosses" role="group" aria-label="보스" data-testid="boss-cards">
      <BossCard
        v-for="b in bosses"
        :id="b.id"
        :key="b.id"
        :name="b.name"
        :element="b.element?.code ?? null"
        :weak-to="b.element?.weak_to ?? null"
        :total-damage="bestTotal(b)"
        :selected="b.id === boss?.id"
        @select="pick"
      />
    </div>

    <section v-if="boss" class="result__boss" :data-boss="boss.id" data-testid="boss-detail">
      <div class="result__head">
        <h2 class="result__name" data-testid="boss-name">{{ boss.name }}</h2>
        <ElementChip :element="boss.element?.weak_to ?? null" label="약점" />
        <!-- 눈에 띄어야 하는 표시: 속성 상성 미반영, 미확인 값(기본값으로 계산한 칸). 접힌 구획 밖에 둔다. -->
        <StatusPill v-for="flag in boss.flags ?? []" :key="flag" :label="flag" tone="unknown" solid data-testid="boss-flag" />
        <StatusPill
          v-if="unconfirmedOf(boss).length"
          :label="`미확인 값 ${unconfirmedOf(boss).length}칸`"
          tone="unknown"
          detail="게임 화면에서 확인하지 못한 값이다. 기본값으로 계산했다 — 확정값이 아니다."
          data-testid="boss-unconfirmed"
        />
      </div>

      <p class="result__summary" data-testid="boss-summary">{{ summary }}</p>

      <p v-if="boss.status !== 'computed'" class="result__none" data-testid="boss-not-computed">이 보스는 아직 계산하지 않았다.</p>
      <SquadPanel v-else :ranking="boss.ranking ?? []" :info="info" :weak="weakNames" :size="compact ? 'sm' : 'lg'" :deck-link="!!decks && !!nav" @open-deck="openInDeck" />

      <p v-if="weakPool" class="result__weak" data-testid="weak-pool">
        약점 속성({{ weakPool.element }}) 보유 니케 {{ (weakPool.owned ?? []).length }}명 가운데 {{ (weakPool.pooled ?? []).length }}명을 이번 계산에 넣었다.
        <template v-if="(weakPool.not_pooled ?? []).length">
          <span data-testid="weak-left-out">
            넣지 못한 니케 {{ weakPool.not_pooled.length }}명: {{ weakPool.not_pooled.join(', ') }}
          </span>
        </template>
      </p>

      <!-- 손으로 적는 기록(데스크톱 앱 창에서만 — 오버레이에는 없다). -->
      <RecordPanel :boss="boss" :estimate="bestTotal(boss)" />

      <DetailsFold summary="계산 조건" :count="conditionCount" :tone="unconfirmedOf(boss).length || (boss.flags ?? []).length ? 'unknown' : 'neutral'" data-testid="calc-conditions">
        <p class="nk-list__head">보스</p>
        <ul class="nk-list">
          <li data-testid="boss-info">{{ infoLine(boss) }}</li>
          <li data-testid="boss-code">
            보스 속성 {{ boss.element?.code ?? '미확인' }}{{ boss.element?.code_source === 'weak_to' ? '(약점에서 유도)' : '' }} · 약점
            {{ boss.element?.weak_to ?? '미확인' }}{{ boss.element?.weak_to_source === 'code' ? '(속성에서 유도)' : '' }}
          </li>
          <li data-testid="boss-runs">이 보스에 쓴 계산 {{ boss.sims }}건 / 한도 {{ boss.budget }}건</li>
        </ul>

        <template v-if="unconfirmedOf(boss).length">
          <p class="nk-list__head">미확인 값 — 이렇게 계산했다</p>
          <ul class="nk-list" data-testid="unconfirmed">
            <li v-for="u in unconfirmedOf(boss)" :key="u.field" data-testid="unconfirmed-item">{{ u.label }}: {{ u.text }}</li>
          </ul>
        </template>

        <template v-if="(boss.assumptions ?? []).length || (report.assumptions ?? []).length">
          <p class="nk-list__head">가정</p>
          <ul class="nk-list" data-testid="assumptions">
            <li v-for="(a, i) in boss.assumptions ?? []" :key="`b${i}`" data-testid="assumption-item">{{ a }}</li>
            <li v-for="(a, i) in report.assumptions ?? []" :key="`r${i}`" data-testid="assumption-item">{{ a }}</li>
          </ul>
        </template>

        <template v-if="(boss.notes ?? []).length || squadNotes.length || (boss.caveats ?? []).length || (report.caveats ?? []).length">
          <p class="nk-list__head">주의</p>
          <ul class="nk-list" data-testid="caveats">
            <li v-for="(n, i) in boss.notes ?? []" :key="`n${i}`" data-testid="boss-note">{{ n }}</li>
            <li v-for="(n, i) in squadNotes" :key="`s${i}`" data-testid="squad-note">{{ n }}</li>
            <li v-for="(c, i) in boss.caveats ?? []" :key="`b${i}`" data-testid="caveat-item">{{ c }}</li>
            <li v-for="(c, i) in report.caveats ?? []" :key="`r${i}`" data-testid="caveat-item">{{ c }}</li>
          </ul>
        </template>

        <template v-if="(boss.rejected ?? []).length || (boss.failed ?? []).length">
          <p class="nk-list__head">계산하지 못한 편성</p>
          <ul class="nk-list" data-testid="issues">
            <li v-for="r in boss.rejected ?? []" :key="`r-${r.name}`" data-testid="rejected-item">{{ r.name }}: {{ (r.reasons ?? []).join(' / ') }}</li>
            <li v-for="f in boss.failed ?? []" :key="`f-${f.name}`" data-testid="failed-item">{{ f.name }}: {{ f.error?.message }}</li>
          </ul>
        </template>

        <p class="nk-list__head">계산 정보</p>
        <ul class="nk-list">
          <li data-testid="bundle-source">보스 정보의 출처: {{ report.bundle?.source ?? '미확인' }}</li>
          <li data-testid="engine-version">계산 도구: {{ engineLabel(report.engine) }}</li>
          <li v-if="report.cache" data-testid="reused">앞서 계산해 둔 것을 다시 쓴 편성 {{ report.cache.hits }}건 · 새로 계산한 편성 {{ report.cache.misses }}건</li>
        </ul>
      </DetailsFold>
    </section>
  </div>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-5);
  min-width: 0;
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
}

.result__meta,
.result__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.result__account {
  font-weight: var(--nk-weight-bold);
}

.result__time {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
}

.result__bosses {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--nk-boss-image) * 3), 1fr));
  gap: var(--nk-space-3);
}

.result__boss {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  padding: var(--nk-space-5);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
}

.result--compact .result__boss {
  padding: var(--nk-space-4);
}

.result__name {
  margin: 0;
  font-size: var(--nk-font-xl);
  font-weight: var(--nk-weight-heavy);
}

.result__summary {
  margin: 0;
  font-size: var(--nk-font-lg);
  overflow-wrap: anywhere;
}

.result__weak,
.result__none {
  margin: 0;
  color: var(--nk-text-muted);
  overflow-wrap: anywhere;
}
</style>
