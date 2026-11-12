<script setup lang="ts">
// 부품 모아 보기 — 공통 부품(src/ui)과 그 상태를 한 화면에서 본다: 이미지 있음/없음, 긴 이름, 계산 중, 빈 상태, 오류.
// 개발 실행에서만 뜬다(main.ts). 여기의 수치는 지어낸 보기 값이다(samples.ts) — 계산 결과가 아니다.
import { summarizeInterceptBoss } from '@core/summary.mjs';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { damageUnit } from '../../lib/format';
import { infoLabel, loadNikkeCatalog, nikkeInfoFrom } from '../../lib/nikkeInfo';
import type { EngineCatalog, NikkeInfo } from '../../types';
import BossCard from '../BossCard.vue';
import BurstBadge from '../BurstBadge.vue';
import DamageBar from '../DamageBar.vue';
import DetailsFold from '../DetailsFold.vue';
import ElementChip from '../ElementChip.vue';
import EmptyState from '../EmptyState.vue';
import GameIcon from '../GameIcon.vue';
import NikkeTile from '../NikkeTile.vue';
import ProgressPanel from '../ProgressPanel.vue';
import RankRow from '../RankRow.vue';
import SkeletonBlock from '../SkeletonBlock.vue';
import StatusPill from '../StatusPill.vue';
import { SAMPLE_BOSSES, SAMPLE_LONG_NAMES, SAMPLE_RUNNERS_UP, SAMPLE_SQUAD, SAMPLE_UNKNOWN_NAME, sampleBossItem } from './samples';

const ELEMENTS = ['작열', '풍압', '철갑', '전격', '수냉'];
const BURSTS = ['1', '2', '3', 'A'];
const CLASSES = ['화력형', '지원형', '방어형'];
const CORPS = ['엘리시온', '미실리스', '테트라', '필그림', '어브노말'];
const WEAPONS = ['AR', 'SMG', 'SG', 'SR', 'MG', 'RL'];

/** 색 토큰 견본. 이름만 적는다 — 값은 styles/tokens.css에 있다. */
const SWATCHES = [
  ['배경', ['--nk-bg', '--nk-surface', '--nk-surface-raised', '--nk-surface-sunken', '--nk-border', '--nk-border-strong']],
  ['글자', ['--nk-text', '--nk-text-muted', '--nk-text-faint']],
  ['강조', ['--nk-accent', '--nk-accent-strong', '--nk-accent-soft']],
  ['속성', ['--nk-el-fire', '--nk-el-wind', '--nk-el-iron', '--nk-el-electric', '--nk-el-water', '--nk-el-unknown']],
  ['상태', ['--nk-ok', '--nk-estimate', '--nk-unknown', '--nk-error', '--nk-test', '--nk-neutral']],
] as const;

// ── 니케 정보: 엔진 카탈로그에서(읽지 못하면 전부 「모름」으로 보인다). ──
const catalog = ref<EngineCatalog | null>(null);
const catalogProblem = ref(false);
const info = (name: string): NikkeInfo => nikkeInfoFrom(catalog.value, name);

const boss = SAMPLE_BOSSES[0];
/** 보기 편성에서 이 보스의 약점 속성인 니케(카탈로그를 읽었을 때만 안다). */
const weakNames = computed<string[] | null>(() => (catalog.value ? SAMPLE_SQUAD.map((m): string => m.name).filter((n) => info(n).element === boss.weakTo) : null));
const isWeak = (name: string) => weakNames.value?.includes(name) === true;
const summary = computed(() => summarizeInterceptBoss(sampleBossItem(weakNames.value)));

const selectedBoss = ref<string>(boss.id);

// ── 진행 패널: 실제로 흘러가는 보기 하나. ──
const TOTAL = 60;
const tick = ref(0);
const running = ref(true);
let timer: ReturnType<typeof setInterval> | undefined;
const liveDone = computed(() => Math.min(TOTAL, Math.floor(tick.value / 2)));
function restart() {
  tick.value = 0;
  running.value = true;
}

const actions = ref(0);

onMounted(() => {
  loadNikkeCatalog().then(
    (loaded) => {
      catalog.value = loaded;
    },
    () => {
      catalogProblem.value = true;
    },
  );
  timer = setInterval(() => {
    if (running.value && liveDone.value < TOTAL) tick.value += 1;
  }, 500);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <main class="gallery" data-testid="ui-gallery">
    <header class="gallery__head">
      <h1 class="gallery__title">부품 모아 보기</h1>
      <p class="gallery__note">
        개발 실행에서만 보이는 화면이다. 여기의 숫자는 지어낸 보기 값이다 — 계산 결과가 아니다.
        <StatusPill label="검증용 데이터" tone="test" solid />
      </p>
      <p v-if="catalogProblem" class="gallery__note" data-testid="gallery-catalog-problem">
        니케 정보를 읽지 못했다 — 속성·버스트 단계가 「모름」으로 보인다(앱 창이 아닌 브라우저에서 열면 그렇다).
      </p>
    </header>

    <section class="gallery__section" data-section="tokens">
      <h2 class="gallery__heading">색</h2>
      <div v-for="[group, names] in SWATCHES" :key="group" class="gallery__row">
        <span class="gallery__label">{{ group }}</span>
        <span v-for="name in names" :key="name" class="swatch" :title="name" data-testid="gallery-swatch">
          <span class="swatch__color" :style="{ background: `var(${name})` }"></span>
          <span class="swatch__name">{{ name.replace('--nk-', '') }}</span>
        </span>
      </div>
    </section>

    <section class="gallery__section" data-section="status">
      <h2 class="gallery__heading">상태 알약</h2>
      <div class="gallery__row">
        <StatusPill label="연결됨" tone="ok" />
        <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 기록과 맞춰 본 적이 없다." />
        <StatusPill label="미확인 값 7칸" tone="unknown" />
        <StatusPill label="검증용 데이터" tone="test" />
        <StatusPill label="오류" tone="error" />
        <StatusPill label="고른 보스" tone="accent" />
        <StatusPill label="연결 안 됨" />
      </div>
      <div class="gallery__row">
        <StatusPill label="추정" tone="estimate" solid />
        <StatusPill label="미지원 효과 있음" tone="error" solid />
        <StatusPill label="속성 상성 미반영" tone="unknown" solid />
      </div>
    </section>

    <section class="gallery__section" data-section="element">
      <h2 class="gallery__heading">속성 칩</h2>
      <div class="gallery__row">
        <ElementChip v-for="el in ELEMENTS" :key="el" :element="el" />
        <ElementChip :element="null" />
      </div>
      <div class="gallery__row">
        <ElementChip v-for="el in ELEMENTS" :key="el" :element="el" label="약점" />
        <ElementChip :element="null" label="약점" />
      </div>
      <div class="gallery__row">
        <span class="gallery__label">아이콘만</span>
        <ElementChip v-for="el in ELEMENTS" :key="el" :element="el" dot />
        <ElementChip :element="null" dot />
        <span class="gallery__label">직접 그린 도형</span>
        <ElementChip v-for="el in ELEMENTS" :key="el" :element="el" dot :src="null" />
      </div>
    </section>

    <section class="gallery__section" data-section="icons">
      <h2 class="gallery__heading">버스트 배지 · 아이콘</h2>
      <div class="gallery__row">
        <span class="gallery__label">버스트</span>
        <BurstBadge v-for="b in BURSTS" :key="b" :stage="b" size="lg" />
        <BurstBadge :stage="null" size="lg" />
        <span class="gallery__label">직접 그린 배지</span>
        <BurstBadge v-for="b in BURSTS" :key="b" :stage="b" size="lg" :src="null" />
      </div>
      <div class="gallery__row">
        <span class="gallery__label">클래스</span>
        <GameIcon v-for="c in CLASSES" :key="c" kind="class" :value="c" size="lg" />
        <span class="gallery__label">기업</span>
        <GameIcon v-for="c in CORPS" :key="c" kind="corp" :value="c" size="lg" />
        <span class="gallery__label">무기</span>
        <GameIcon v-for="w in WEAPONS" :key="w" kind="weapon" :value="w" size="lg" />
        <GameIcon kind="weapon" :value="null" size="lg" />
      </div>
    </section>

    <section class="gallery__section" data-section="bar">
      <h2 class="gallery__heading">딜 막대</h2>
      <div class="gallery__bars">
        <DamageBar :share="0.62" />
        <DamageBar :share="0.08" />
        <DamageBar :share="1" />
        <DamageBar :share="0" />
        <DamageBar :share="null" />
        <span data-element="작열"><DamageBar :share="0.46" tone="element" /></span>
        <DamageBar :share="0.3" thin />
        <DamageBar :share="0.3" thin :percent="false" />
      </div>
    </section>

    <section class="gallery__section" data-section="tiles">
      <h2 class="gallery__heading">니케 타일</h2>
      <p class="gallery__caption">큰 타일 — 추천 1위(약점 속성 니케는 속성 색 테두리)</p>
      <div class="gallery__row gallery__row--top">
        <NikkeTile
          v-for="m in SAMPLE_SQUAD"
          :key="m.name"
          :name="m.name"
          :element="info(m.name).element"
          :burst="info(m.name).burst"
          :weak="isWeak(m.name)"
          :share="m.share"
        />
      </div>
      <p class="gallery__caption">긴 이름 · 초상화 없음 · 정보 모름 · 비중 모름</p>
      <div class="gallery__row gallery__row--top">
        <NikkeTile v-for="name in SAMPLE_LONG_NAMES" :key="name" :name="name" :element="info(name).element" :burst="info(name).burst" :share="0.2" />
        <NikkeTile :name="SAMPLE_SQUAD[1].name" :element="info(SAMPLE_SQUAD[1].name).element" :burst="info(SAMPLE_SQUAD[1].name).burst" :src="null" :share="0.21" />
        <NikkeTile :name="SAMPLE_UNKNOWN_NAME" :element="info(SAMPLE_UNKNOWN_NAME).element" :burst="info(SAMPLE_UNKNOWN_NAME).burst" :share="null" />
        <NikkeTile :name="SAMPLE_SQUAD[0].name" element="작열" burst="3" weak :src="null" />
      </div>
      <p class="gallery__caption">작은 타일 — 오버레이 위젯의 한 줄</p>
      <div class="gallery__row gallery__row--top gallery__widget">
        <NikkeTile
          v-for="m in SAMPLE_SQUAD"
          :key="m.name"
          size="sm"
          :name="m.name"
          :element="info(m.name).element"
          :burst="info(m.name).burst"
          :weak="isWeak(m.name)"
          :share="m.share"
        />
      </div>
      <div class="gallery__row gallery__row--top gallery__widget">
        <NikkeTile v-for="name in SAMPLE_LONG_NAMES" :key="name" size="sm" :name="name" :element="info(name).element" :burst="info(name).burst" :share="0.2" />
        <NikkeTile size="sm" :name="SAMPLE_UNKNOWN_NAME" :share="null" />
      </div>
      <p class="gallery__caption">얼굴만 — 순위 줄</p>
      <div class="gallery__row">
        <NikkeTile v-for="m in SAMPLE_SQUAD" :key="m.name" size="xs" :name="m.name" :element="info(m.name).element" :weak="isWeak(m.name)" />
        <NikkeTile size="xs" :name="SAMPLE_UNKNOWN_NAME" />
      </div>
      <p class="gallery__caption">
        니케 정보 — {{ SAMPLE_SQUAD[1].name }}: 속성 {{ infoLabel(info(SAMPLE_SQUAD[1].name).element) }} · 버스트 {{ infoLabel(info(SAMPLE_SQUAD[1].name).burst) }} · 무기
        {{ infoLabel(info(SAMPLE_SQUAD[1].name).weapon) }} · 기업 {{ infoLabel(info(SAMPLE_SQUAD[1].name).corp) }} / {{ SAMPLE_UNKNOWN_NAME }}: 속성
        {{ infoLabel(info(SAMPLE_UNKNOWN_NAME).element) }}
      </p>
    </section>

    <section class="gallery__section" data-section="boss">
      <h2 class="gallery__heading">보스 카드</h2>
      <div class="gallery__bosses">
        <BossCard
          v-for="b in SAMPLE_BOSSES"
          :key="b.id"
          :id="b.id"
          :name="b.name"
          :element="b.element"
          :weak-to="b.weakTo"
          :total-damage="b.totalDamage"
          :selected="selectedBoss === b.id"
          @select="selectedBoss = $event"
        />
      </div>
      <p class="gallery__caption">이미지 없음(속성 색으로 대신) · 속성 모름 · 긴 이름</p>
      <div class="gallery__bosses">
        <BossCard v-for="b in SAMPLE_BOSSES.slice(0, 3)" :key="b.id" :id="b.id" :name="b.name" :element="b.element" :weak-to="b.weakTo" :total-damage="b.totalDamage" :src="null" />
        <BossCard id="unknown-boss" name="속성을 모르는 보스" :total-damage="null" :src="null" />
        <BossCard id="long-name-boss" name="이름이 아주 긴 이상 개체 보스 시험용" element="수냉" weak-to="전격" :total-damage="987654321" :src="null" />
      </div>
    </section>

    <section class="gallery__section" data-section="summary">
      <h2 class="gallery__heading">한 줄 요약 · 추천 1위</h2>
      <p class="gallery__summary" data-testid="gallery-summary">{{ summary.text }}</p>
      <div class="gallery__row">
        <span class="gallery__hero" data-testid="gallery-hero">{{ damageUnit(boss.totalDamage) }}</span>
        <StatusPill label="추정 · 실전 미대조" tone="estimate" />
        <ElementChip :element="boss.weakTo" label="약점" />
      </div>
      <RankRow
        v-for="r in SAMPLE_RUNNERS_UP"
        :key="r.rank"
        :rank="r.rank"
        :members="r.members.map((name) => ({ name, element: info(name).element, weak: isWeak(name) }))"
        :total-damage="r.totalDamage"
        :relative="r.relative"
      />
      <RankRow :rank="4" :members="[{ name: SAMPLE_UNKNOWN_NAME, src: null }, { name: SAMPLE_LONG_NAMES[0], src: null }]" :total-damage="123456789" />
    </section>

    <section class="gallery__section" data-section="progress">
      <h2 class="gallery__heading">진행 패널</h2>
      <ProgressPanel
        title="인디빌리아 추천 편성을 찾는 중"
        detail="보스 1/5"
        :done="liveDone"
        :total="TOTAL"
        :elapsed-ms="tick * 500"
        :stopping="!running && liveDone < TOTAL"
        @stop="running = false"
      />
      <button type="button" class="gallery__button" data-testid="gallery-restart" @click="restart">진행 보기 다시 시작</button>
      <ProgressPanel title="처음 몇 건 — 남은 시간을 아직 말하지 않는다" :done="1" :total="60" :elapsed-ms="4000" />
      <ProgressPanel title="어림하는 중" detail="보스 3/5" :done="24" :total="60" :elapsed-ms="96000" />
      <ProgressPanel title="준비 중 — 전체 건수를 아직 모른다" :done="0" :total="0" :elapsed-ms="1200" />
      <ProgressPanel title="멈추는 중" :done="30" :total="60" :elapsed-ms="120000" stopping />
      <ProgressPanel title="중단할 수 없는 일" :done="60" :total="60" :elapsed-ms="240000" :stoppable="false" />
    </section>

    <section class="gallery__section" data-section="skeleton">
      <h2 class="gallery__heading">뼈대 화면</h2>
      <SkeletonBlock shape="cards" :count="5" />
      <SkeletonBlock shape="tiles" :count="5" />
      <SkeletonBlock shape="lines" :count="3" />
    </section>

    <section class="gallery__section" data-section="empty">
      <h2 class="gallery__heading">빈 상태 · 오류</h2>
      <EmptyState title="아직 계정을 연결하지 않았다" hint="계정을 한 번 연결하면 보유 니케로 보스마다 추천 편성을 찾아 준다." action="계정 연결하기" @action="actions += 1" />
      <EmptyState
        tone="error"
        title="추천 편성을 찾지 못했다"
        hint="계산을 시작하지 못했다. 설정에서 계산 도구의 자리를 확인한 뒤 다시 해 보라."
        action="다시 시도"
        @action="actions += 1"
      />
      <EmptyState title="이 보스는 아직 계산하지 않았다" hint="위의 보스 카드를 누르면 계산한다." />
      <p class="gallery__caption" data-testid="gallery-actions">단추를 누른 횟수: {{ actions }}</p>
    </section>

    <section class="gallery__section" data-section="fold">
      <h2 class="gallery__heading">접는 「자세히」</h2>
      <DetailsFold summary="계산 조건" :count="3">
        <ul class="gallery__list">
          <li>전투 시간 180초(기본값)</li>
          <li>레벨 400(상한) 기준</li>
          <li>크리티컬은 평균값으로 계산</li>
        </ul>
      </DetailsFold>
      <DetailsFold summary="주의" :count="2" tone="unknown" open>
        <ul class="gallery__list">
          <li>보스의 방어력·코어·파츠는 미확인 값이다 — 기본값으로 계산했다.</li>
          <li>보스 패턴은 계산에 없다.</li>
        </ul>
      </DetailsFold>
      <DetailsFold>
        접어 두어도 되는 것만 넣는다. 「추정 · 실전 미대조」는 접지 않고 항상 보이는 자리에 둔다.
      </DetailsFold>
    </section>
  </main>
</template>

<style scoped>
.gallery {
  height: 100%;
  padding: var(--nk-space-5);
  overflow-y: auto;
  background: var(--nk-bg);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
  line-height: var(--nk-line-normal);
}

.gallery__head {
  margin-bottom: var(--nk-space-5);
}

.gallery__title {
  margin: 0 0 var(--nk-space-2);
  font-size: var(--nk-font-xl);
  font-weight: var(--nk-weight-heavy);
}

.gallery__note {
  margin: 0;
  color: var(--nk-text-muted);
}

.gallery__section {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  margin-bottom: var(--nk-space-6);
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface-sunken);
}

.gallery__heading {
  margin: 0;
  color: var(--nk-accent-strong);
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-bold);
}

.gallery__caption {
  margin: var(--nk-space-2) 0 0;
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
}

.gallery__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.gallery__row--top {
  align-items: flex-start;
}

/* 오버레이 위젯의 폭을 흉내 낸다: 작은 타일 다섯이 한 줄에 들어가야 한다. */
.gallery__widget {
  flex-wrap: nowrap;
  width: fit-content;
  padding: var(--nk-space-3);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
}

.gallery__label {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
}

.gallery__bars {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--nk-space-3) var(--nk-space-5);
}

.gallery__bosses {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--nk-tile-lg) * 2), 1fr));
  gap: var(--nk-space-3);
}

.gallery__summary {
  margin: 0;
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-bold);
}

.gallery__hero {
  font-size: var(--nk-font-hero);
  font-weight: var(--nk-weight-heavy);
  font-variant-numeric: tabular-nums;
  line-height: var(--nk-line-tight);
}

.gallery__button {
  align-self: flex-start;
  padding: var(--nk-space-2) var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border-strong);
  border-radius: var(--nk-radius-md);
  background: transparent;
  color: var(--nk-text-muted);
  font: inherit;
  cursor: pointer;
}

.gallery__list {
  margin: 0;
  padding-left: var(--nk-space-5);
  list-style: disc;
}

.swatch {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-1);
}

.swatch__color {
  width: var(--nk-space-7);
  height: var(--nk-space-7);
  border: var(--nk-border-width) solid var(--nk-border-strong);
  border-radius: var(--nk-radius-md);
}

.swatch__name {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-xs);
}
</style>
