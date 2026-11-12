<script setup lang="ts">
// 버스트 흐름의 그림(P-032) — 편성 하나의 타임라인.
//   위: 한 줄 요약(「3분 동안 풀 버스트 9번, 평균 20초마다」), 버스트가 돌지 않으면 빨간 배지와 한 문장
//   가로 시간축(전투 시간) · 풀 버스트 구간의 띠 · 니케마다 한 줄(초상화 + 버스트를 쓴 때의 표시)
// 받은 값을 그리기만 한다(루트 src/core/burst.mjs가 계산 도구의 기록에서 읽은 것) — 시각을 고치거나 채우지 않는다.
// 계산 도구가 흐름을 주지 않은 편성은 그림 대신 그 사실을 적는다.
import { secondsText } from '@core/burst.mjs';
import { computed } from 'vue';
import type { BurstLine, NikkeInfo } from '../types';
import NikkeTile from '../ui/NikkeTile.vue';
import StatusPill from '../ui/StatusPill.vue';

const props = defineProps<{
  line: BurstLine;
  /** 전투 시간(초) — 시간축의 길이. */
  duration: number;
  /** 니케 정보(속성·버스트 단계)를 주는 함수. */
  info: (name: string) => NikkeInfo;
}>();

const flow = computed(() => (props.line.status === 'read' ? props.line.flow : null));
const sec = (v: number | null): string => secondsText(v ?? NaN) as string;

/** 시간축 위의 자리(왼쪽에서 몇 %). 전투 시간 밖의 값은 끝에 붙인다. */
function at(t: number): string {
  const ratio = props.duration > 0 ? Math.min(1, Math.max(0, t / props.duration)) : 0;
  return `${(ratio * 100).toFixed(3)}%`;
}
const span = (from: number, to: number | null) => ({ left: at(from), width: `calc(${at(to ?? props.duration)} - ${at(from)})` });

/** 눈금: 30초마다(1분 이하의 전투는 10초마다). 끝 눈금은 전투가 끝나는 때다. */
const ticks = computed(() => {
  const step = props.duration <= 60 ? 10 : 30;
  const out: { t: number; label: string; edge: 'start' | 'end' | 'mid' }[] = [];
  for (let t = 0; t < props.duration; t += step) out.push({ t, label: t === 0 ? '0' : t % 60 === 0 ? `${t / 60}분` : `${t}초`, edge: t === 0 ? 'start' : 'mid' });
  out.push({ t: props.duration, label: props.duration % 60 === 0 ? `${props.duration / 60}분` : `${props.duration}초`, edge: 'end' });
  return out;
});

const bands = computed(() => (flow.value?.full_bursts ?? []).map((fb) => ({ ...fb, style: span(fb.start, fb.end) })));

/** 단계별로 누가 몇 번 썼는지 한 줄씩. 아무도 쓰지 않은 단계는 그렇게 적는다. */
const stageUsers = computed(() =>
  ['1', '2', '3'].map((stage) => {
    const users = flow.value?.by_stage[stage] ?? [];
    return { stage, text: users.length ? users.map((u) => `${u.name} ${u.count}번`).join(' · ') : '쓴 니케 없음', empty: users.length === 0 };
  }),
);

const pill = computed(() => {
  if (!flow.value) return { label: '읽지 못함', detail: '계산 도구가 이 편성의 버스트 흐름을 주지 않았다.' };
  if (flow.value.status === 'none') return { label: '풀 버스트 없음', detail: '전투가 끝날 때까지 풀 버스트가 한 번도 열리지 않았다.' };
  if (flow.value.status === 'stalled') return { label: '버스트가 늦다', detail: '풀 버스트를 여는 동안 다음 단계의 버스트가 1초 넘게 늦은 적이 있다.' };
  return null;
});

const failure = computed(() => {
  const l = props.line;
  if (l.status === 'rejected') return l.reasons.join(' / ');
  if (l.status === 'failed') return l.error.message ?? '까닭을 알 수 없다';
  return '';
});
</script>

<template>
  <article class="burst" :data-status="flow ? flow.status : line.status" :data-name="line.name" data-testid="burst-line">
    <div class="nk-row">
      <strong class="burst__name" data-testid="burst-name">{{ line.name }}</strong>
      <!-- 버스트가 돌지 않는 편성은 빨간 배지로 — 접지 않는다. -->
      <StatusPill v-if="pill" :label="pill.label" tone="error" solid :detail="pill.detail" data-testid="burst-pill" />
      <span v-if="flow" class="burst__headline" data-testid="burst-headline">{{ flow.headline }}</span>
    </div>

    <template v-if="flow">
      <p v-if="flow.problem" class="nk-error" role="alert" data-testid="burst-problem">{{ flow.problem }}</p>
      <p class="nk-muted" data-testid="burst-stats">
        <template v-if="flow.first_at !== null">첫 풀 버스트 {{ sec(flow.first_at) }}초 · 풀 버스트가 열려 있던 시간 {{ sec(flow.uptime_seconds) }}초</template>
        <template v-else-if="flow.first_use_at !== null">첫 버스트 {{ sec(flow.first_use_at) }}초 — 풀 버스트까지 이어지지 않았다</template>
        <template v-else>버스트를 쓴 기록이 없다</template>
      </p>

      <div class="burst__chart" role="img" :aria-label="`${line.name}의 버스트 흐름 — ${flow.headline}`" data-testid="burst-chart">
        <span class="burst__label nk-muted">전투 시간</span>
        <div class="burst__axis" data-testid="burst-axis">
          <span v-for="tick in ticks" :key="tick.t" class="burst__tick" :data-edge="tick.edge" :style="{ left: at(tick.t) }" data-testid="burst-tick">{{ tick.label }}</span>
        </div>

        <span class="burst__label">풀 버스트</span>
        <div class="burst__track" data-testid="burst-bands">
          <span
            v-for="band in bands"
            :key="band.index"
            class="burst__band"
            :style="band.style"
            :data-start="band.start"
            :data-end="band.end ?? ''"
            :data-late="band.waited_for ? 'yes' : 'no'"
            :title="`${band.index}번째 풀 버스트 — ${sec(band.start)}초부터 ${band.end === null ? '전투가 끝날 때까지' : `${sec(band.end)}초까지`}${band.waited_for ? ` (다음 버스트를 ${sec(band.wait)}초 기다렸다)` : ''}`"
            data-testid="burst-band"
          ></span>
        </div>

        <template v-for="member in flow.by_member" :key="member.name">
          <span class="burst__label burst__who" :title="member.name" data-testid="burst-who">
            <NikkeTile :name="member.name" size="mini" :element="info(member.name).element" :burst="info(member.name).burst" />
            <span class="burst__who-name">{{ member.name }}</span>
          </span>
          <div class="burst__track burst__track--member" :data-name="member.name" :data-count="member.count" data-testid="burst-member">
            <span v-for="band in bands" :key="`b${band.index}`" class="burst__shade" :style="band.style" aria-hidden="true"></span>
            <span
              v-for="(use, i) in member.uses"
              :key="i"
              class="burst__mark"
              :class="{ 'burst__mark--again': use.reenter }"
              :style="{ left: at(use.t) }"
              :data-t="use.t"
              :data-stage="use.stage"
              :title="`${sec(use.t)}초 — ${use.stage}단계 버스트${use.reenter ? '(재진입)' : ''}`"
              data-testid="burst-mark"
            ></span>
            <span v-if="member.count === 0" class="burst__idle nk-muted" data-testid="burst-idle">버스트를 쓰지 않았다</span>
          </div>
        </template>
      </div>

      <ul class="burst__stages" data-testid="burst-stage-users">
        <li v-for="s in stageUsers" :key="s.stage" class="burst__stage" :data-stage="s.stage" :data-empty="s.empty ? 'yes' : 'no'" data-testid="burst-stage">
          <strong>{{ s.stage }}단계</strong> {{ s.text }}
        </li>
      </ul>
    </template>

    <!-- 계산 도구가 주지 않은 흐름은 그리지 않는다(어림해 채우지 않는다). -->
    <p v-else class="nk-note" role="status" data-testid="burst-unread">
      이 편성의 버스트 흐름은 읽지 못했다 — 어림해 그리지 않는다. {{ failure }}
    </p>
  </article>
</template>

<style scoped>
.burst {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  min-width: 0;
}

.burst__name {
  font-size: var(--nk-font-md);
}

.burst__headline {
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-bold);
}

.burst__chart {
  display: grid;
  grid-template-columns: calc(var(--nk-tile-mini) * 4) minmax(0, 1fr);
  align-items: center;
  gap: var(--nk-space-2) var(--nk-space-3);
}

.burst__label {
  font-size: var(--nk-font-sm);
  min-width: 0;
}

.burst__who {
  display: flex;
  align-items: center;
  gap: var(--nk-space-2);
}

.burst__who-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.burst__axis {
  position: relative;
  height: var(--nk-space-5);
  border-bottom: var(--nk-border-width) solid var(--nk-border);
}

.burst__tick {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  color: var(--nk-text-faint);
  font-size: var(--nk-font-xs);
  white-space: nowrap;
}

.burst__tick[data-edge='start'] {
  transform: none;
}

.burst__tick[data-edge='end'] {
  transform: translateX(-100%);
}

.burst__track {
  position: relative;
  height: var(--nk-space-5);
  border-radius: var(--nk-radius-sm);
  background: var(--nk-surface-sunken);
  overflow: hidden;
}

.burst__track--member {
  height: var(--nk-tile-mini);
}

.burst__band {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--nk-radius-sm);
  background: var(--nk-accent);
}

.burst__band[data-late='yes'] {
  background: var(--nk-error);
}

.burst__shade {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--nk-accent-soft);
}

.burst__mark {
  position: absolute;
  top: 50%;
  width: var(--nk-space-3);
  height: var(--nk-space-5);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-text);
  transform: translate(-50%, -50%);
}

.burst__mark--again {
  border: var(--nk-border-width-strong) solid var(--nk-text);
  background: transparent;
}

.burst__idle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 var(--nk-space-3);
  font-size: var(--nk-font-xs);
}

.burst__stages {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-2) var(--nk-space-5);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.burst__stage[data-empty='yes'] {
  color: var(--nk-error);
}
</style>
