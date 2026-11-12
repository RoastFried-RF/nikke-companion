<script setup lang="ts">
// 홈(데스크톱 앱): 지금 상태를 한눈에 — 계정 연결·게임 창·오버레이·자동 추적의 체크리스트와 다음에 할 일 단추 하나.
// 처음 쓰는 사람에게는 세 단계 안내(계정 연결 → 게임 켜기 → 요격전 화면 열기)가 보인다.
// 추천이 있으면 보스 5종의 1위 요약을 보인다(누르면 요격전 화면으로 간다).
// 계정이 있으면 「오늘의 요격전」 카드(P-029 — views/TodayCard.vue)가 보인다: 오늘 돌 보스 한 줄·그 보스의 1위 편성·지난 기록.
// 여기서는 아무것도 계산하지 않는다 — 다른 곳이 알려 준 상태를 보여 주고 그 화면으로 보낼 뿐이다.
import { computed, onActivated, ref, watch } from 'vue';
import { localTime } from '../lib/format';
import { useNav } from '../lib/nav';
import { usePlan } from '../lib/plan';
import { remember } from '../lib/remember';
import { LAST_BOSS, useScreenTrack } from '../lib/screenTrack';
import { useShared } from '../lib/shared';
import { useGameState, useOverlayState } from '../lib/status';
import type { AccountDoc, InterceptBoss } from '../types';
import BossCard from '../ui/BossCard.vue';
import StatusPill from '../ui/StatusPill.vue';
import TodayCard from '../views/TodayCard.vue';

const shared = useShared();
const nav = useNav();
const track = useScreenTrack();
const { overlay, problem: overlayProblem, setVisible } = useOverlayState();
const { game, problem: gameProblem } = useGameState();

const accountName = computed(() => shared?.accountName.value ?? null);
const report = computed(() => shared?.intercept.value ?? null);
const gameFound = computed(() => game.value?.state === 'found');
const overlayShown = computed(() => overlay.value?.visible === true);
const tracking = computed(() => track?.enabled.value === true);

type Tone = 'ok' | 'neutral' | 'unknown';
interface Check {
  key: string;
  label: string;
  done: boolean;
  state: string;
  tone: Tone;
  hint: string;
}

const checks = computed<Check[]>(() => [
  {
    key: 'account',
    label: '계정 연결',
    done: accountName.value !== null,
    state: accountName.value ? `연결됨 · ${accountName.value}` : '연결 안 됨',
    tone: accountName.value ? 'ok' : 'unknown',
    hint: accountName.value ? '이 계정의 니케로 추천을 계산한다.' : '계정을 연결해야 내 니케로 추천을 계산할 수 있다.',
  },
  {
    key: 'game',
    label: '게임 창',
    done: gameFound.value,
    state: game.value === null ? '확인 중' : gameFound.value ? '찾음' : game.value.state === 'minimized' ? '최소화됨' : '없음',
    tone: gameFound.value ? 'ok' : 'neutral',
    hint: gameFound.value ? '니케가 켜져 있다.' : '니케를 켜면 오버레이가 게임 위에 뜬다. 게임이 없어도 추천은 계산할 수 있다.',
  },
  {
    key: 'overlay',
    label: '오버레이',
    done: overlayShown.value,
    state: overlay.value === null ? '확인 중' : overlayShown.value ? '떠 있음' : '숨김',
    tone: overlayShown.value ? 'ok' : 'neutral',
    hint: '게임 위에 뜨는 작은 창이다. Alt+Shift+O로 숨기고 다시 띄운다.',
  },
  {
    key: 'track',
    label: '자동 추적',
    done: tracking.value,
    state: tracking.value ? '켜짐' : '꺼짐',
    tone: tracking.value ? 'ok' : 'neutral',
    hint: '켜 두면 게임에서 보고 있는 보스의 추천을 스스로 보여 준다. 게임 화면은 읽기만 한다.',
  },
]);

/** 처음 쓰는가: 계정도 추천도 아직 없다. */
const firstRun = computed(() => (shared?.ready.value ?? true) && !accountName.value && !report.value);

/** 다음에 할 일 하나. 위에서부터 아직 안 된 것을 고른다. */
const next = computed<{ label: string; why: string; act: () => void }>(() => {
  if (!accountName.value) return { label: '계정 연결하기', why: '먼저 계정을 연결한다.', act: () => nav?.openSettings('account') };
  if (!report.value) return { label: '요격전 추천 받기', why: '보스마다 추천 편성을 한 번 계산해 둔다.', act: () => nav?.openIntercept() };
  if (!tracking.value) {
    return { label: '자동 추적 켜기', why: '게임에서 보고 있는 보스의 추천이 스스로 보이게 한다.', act: () => void track?.setEnabled(true) };
  }
  if (!overlayShown.value) return { label: '오버레이 띄우기', why: '게임 위에서 추천을 본다.', act: () => void setVisible(true) };
  return { label: '요격전 추천 보기', why: '준비가 끝났다.', act: () => nav?.openIntercept() };
});

const STEPS = [
  { title: '계정 연결', text: '설정의 계정 연결에서 내 니케의 육성 상태를 받는다. 크롬 확장을 쓰면 단추 한 번이다.' },
  { title: '게임 켜기', text: '니케를 켠다. 오버레이가 게임 위에 작게 뜬다.' },
  { title: '요격전 화면 열기', text: '게임에서 이상 개체 요격전의 보스를 고르면, 그 보스의 추천 편성이 보인다.' },
];

const best = (b: InterceptBoss): number | null => (b.status === 'computed' ? ((b.ranking ?? []).find((e) => e.rank === 1) ?? (b.ranking ?? [])[0])?.total_damage ?? null : null);
const computedAt = computed(() => localTime(shared?.snapshot.value?.intercept_saved_at ?? report.value?.generated_at));

/** 보스 카드를 누르면 그 보스를 고른 채 요격전 화면을 연다. */
function openBoss(id: string): void {
  remember(LAST_BOSS, id);
  nav?.openIntercept();
}

// ── 오늘의 요격전(P-029): 주력 니케의 장비와 보스의 보상 부위를 이은 한 줄 + 그 보스의 1위 편성 + 지난 기록 ──
const plan = usePlan();
const account = ref<AccountDoc | null>(null);
/** 늦게 끝난 읽기가 나중 읽기를 덮지 않게 한다. */
let accountSeq = 0;
async function loadAccount(): Promise<void> {
  const mine = ++accountSeq;
  if (!shared || !accountName.value) {
    account.value = null;
    return;
  }
  try {
    const read = await shared.loadAccount();
    if (mine === accountSeq) account.value = read.account;
  } catch {
    // 계정을 읽지 못하면 카드를 그리지 않는다(이유는 내 니케 화면이 알린다).
    if (mine === accountSeq) account.value = null;
  }
}
if (shared) watch([shared.accountName, shared.accountSavedAt], loadAccount, { immediate: true });
onActivated(() => {
  if (!account.value && accountName.value) void loadAccount();
});

/** 오늘의 요격전 카드를 누르면: 급한 보스가 있으면 그 보스를 고른 채, 없으면 그냥 요격전 화면을 연다. */
function openToday(id: string | null): void {
  if (id) remember(LAST_BOSS, id);
  nav?.openIntercept();
}
</script>

<template>
  <div class="nk-page" data-testid="page-home">
    <header class="nk-head">
      <h1 class="nk-title">홈</h1>
    </header>

    <p v-if="shared?.problem.value" class="nk-error" role="alert" data-testid="shared-problem">{{ shared.problem.value }}</p>

    <section v-if="firstRun" class="nk-card" aria-label="처음 쓰는 순서" data-testid="first-run">
      <h2 class="nk-subtitle">처음이라면 이 순서로</h2>
      <ol class="home__steps">
        <li v-for="(step, i) in STEPS" :key="step.title" class="home__step" data-testid="first-run-step">
          <span class="home__no">{{ i + 1 }}</span>
          <span class="home__step-body">
            <strong>{{ step.title }}</strong>
            <span class="nk-muted">{{ step.text }}</span>
          </span>
        </li>
      </ol>
    </section>

    <section class="nk-card" aria-label="지금 상태" data-testid="checklist">
      <h2 class="nk-subtitle">지금 상태</h2>
      <ul class="home__checks">
        <li v-for="check in checks" :key="check.key" class="home__check" :data-done="check.done ? 'yes' : 'no'" :data-testid="`check-${check.key}`">
          <span class="home__mark" aria-hidden="true">{{ check.done ? '✓' : '·' }}</span>
          <span class="home__check-label">{{ check.label }}</span>
          <StatusPill :label="check.state" :tone="check.tone" />
          <span class="nk-muted home__check-hint">{{ check.hint }}</span>
        </li>
      </ul>
      <p v-if="overlayProblem || gameProblem" class="nk-muted" role="status" data-testid="status-problem">{{ overlayProblem || gameProblem }}</p>
      <div class="nk-row">
        <button type="button" class="nk-btn nk-btn--primary" data-testid="next-action" @click="next.act()">{{ next.label }}</button>
        <span class="nk-muted" data-testid="next-why">{{ next.why }}</span>
      </div>
    </section>

    <TodayCard v-if="account && plan" :account="account" :report="report" :plan="plan.plan.value" @open="openToday" />

    <section v-if="report" class="nk-card" aria-label="요격전 추천" data-testid="home-bosses">
      <div class="nk-row">
        <h2 class="nk-subtitle">요격전 추천</h2>
        <StatusPill label="추정 · 실전 미대조" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." />
        <StatusPill v-if="report.account?.is_test_data" label="검증용 데이터" tone="test" solid />
        <span v-if="computedAt" class="nk-muted" data-testid="home-computed-at">마지막 계산 {{ computedAt }}</span>
      </div>
      <div class="home__bosses">
        <BossCard
          v-for="b in report.bosses ?? []"
          :id="b.id"
          :key="b.id"
          :name="b.name"
          :element="b.element?.code ?? null"
          :weak-to="b.element?.weak_to ?? null"
          :total-damage="best(b)"
          @select="openBoss"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.home__steps,
.home__checks {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.home__step {
  display: flex;
  align-items: flex-start;
  gap: var(--nk-space-4);
}

.home__no {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--nk-icon-lg);
  height: var(--nk-icon-lg);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-accent);
  color: var(--nk-text-on-accent);
  font-weight: var(--nk-weight-heavy);
}

.home__step-body {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-1);
}

.home__check {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.home__mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--nk-icon-md);
  height: var(--nk-icon-md);
  border: var(--nk-border-width) solid var(--nk-border-strong);
  border-radius: var(--nk-radius-pill);
  color: var(--nk-text-faint);
  font-weight: var(--nk-weight-heavy);
}

.home__check[data-done='yes'] .home__mark {
  border-color: var(--nk-ok);
  color: var(--nk-ok);
}

.home__check-label {
  min-width: calc(var(--nk-tile-sm) + var(--nk-space-6));
  font-weight: var(--nk-weight-bold);
}

.home__check-hint {
  flex: 1;
  min-width: calc(var(--nk-tile-lg) * 2);
}

.home__bosses {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--nk-boss-image) * 3), 1fr));
  gap: var(--nk-space-3);
}
</style>
