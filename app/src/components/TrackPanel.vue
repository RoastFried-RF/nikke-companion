<script setup lang="ts">
// 자동 추적 칸(요격전 화면): 스위치, 지금 인식한 화면·보스, 마지막으로 읽은 시각, 읽지 못한 이유.
// 근거와 설정(주기·자동 이동)은 펼쳐서 본다. 게임 화면을 읽는 일은 Rust가 한다 — 여기는 켜고 끄고 보여 줄 뿐이다.
// 인식이 안 되거나 게임이 없는 것은 오류가 아니라 상태로 보인다(오류 줄을 쌓지 않는다).
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue';
import { clockTime, MAX_INTERVAL_SEC, MIN_INTERVAL_SEC, summarize, useScreenTrack } from '../lib/screenTrack';

const track = useScreenTrack();

const summary = computed(() => (track ? summarize(track.enabled.value, track.status.value, track.target.value) : null));
const reading = computed(() => (track?.enabled.value ? track.status.value : null));
const readAt = computed(() => clockTime(reading.value?.read_at));
const evidence = computed(() => reading.value?.recognition?.evidence ?? []);
/** 읽기 한 번의 숫자들: 걸린 시간·프레임 크기·신뢰도. 읽은 적이 없으면 빈 문자열. */
const numbers = computed(() => {
  const status = reading.value;
  if (!status) return '';
  const parts: string[] = [];
  if (status.capture_ms !== null) parts.push(`캡처 1회 ${status.capture_ms}ms`);
  const seen = status.recognition;
  if (seen) parts.push(`프레임 ${seen.width}×${seen.height}`, `신뢰도 ${seen.confidence.toFixed(2)}`);
  return parts.join(' · ');
});

async function onSwitch(event: Event): Promise<void> {
  await track?.setEnabled((event.target as HTMLInputElement).checked);
}

async function onInterval(event: Event): Promise<void> {
  const box = event.target as HTMLInputElement;
  await track?.setIntervalSec(box.value);
  // 범위 밖이거나 수가 아닌 값은 실제로 쓰는 값으로 되돌려 보인다.
  if (track) box.value = String(track.intervalSec.value);
}

function onAutoTab(event: Event): void {
  track?.setAutoTab((event.target as HTMLInputElement).checked);
}

// 이벤트는 결과가 바뀔 때만 온다. 이 칸이 보이는 동안에는 주기마다 상태를 물어 「읽은 시각」과 근거를 최신으로 둔다
// (묻는 것은 캡처가 아니다 — Rust가 마지막으로 남긴 상태를 읽을 뿐이다).
let timer: ReturnType<typeof setInterval> | null = null;
let shown = false;

function stopTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function schedule(): void {
  stopTimer();
  if (!track || !shown || !track.enabled.value) return;
  timer = setInterval(() => void track.refresh(), Math.max(1000, track.intervalSec.value * 1000));
}

function appear(): void {
  shown = true;
  void track?.refresh();
  schedule();
}

function leave(): void {
  shown = false;
  stopTimer();
}

if (track) watch([track.enabled, track.intervalSec], schedule);
onMounted(appear);
onActivated(appear);
onDeactivated(leave);
onBeforeUnmount(leave);
</script>

<template>
  <section v-if="track && summary" class="track" aria-label="게임 화면 자동 추적" data-testid="track-panel">
    <div class="track__row">
      <label
        class="track__switch"
        title="켜 두면 게임 화면을 주기적으로 읽어, 이상 개체 요격전에서 보고 있는 보스의 추천을 보여 준다. 게임은 읽기만 하고 이미지는 저장하지 않는다"
      >
        <input type="checkbox" role="switch" :checked="track.enabled.value" data-testid="track-switch" @change="onSwitch" />
        자동 추적
      </label>
      <span class="track__dot" :class="`track__dot--${summary.tone}`" aria-hidden="true"></span>
      <span class="track__state" :data-tone="summary.tone" data-testid="track-state">{{ summary.text }}</span>
      <span class="track__spacer"></span>
      <span v-if="readAt" class="track__time" title="마지막으로 게임 화면을 읽은 시각" data-testid="track-read-at">읽음 {{ readAt }}</span>
    </div>
    <p v-if="summary.reason" class="track__reason" data-testid="track-reason">{{ summary.reason }}</p>
    <p v-if="track.problem.value" class="track__problem" role="status" data-testid="track-problem">{{ track.problem.value }}</p>

    <details class="fold" data-testid="track-details">
      <summary>인식 근거·설정</summary>
      <ul v-if="evidence.length" class="bullets" data-testid="track-evidence-list">
        <li v-for="(line, i) in evidence" :key="i" data-testid="track-evidence">{{ line }}</li>
      </ul>
      <p v-else class="track__none" data-testid="track-no-evidence">
        {{ track.enabled.value ? '지금 읽은 화면이 없다.' : '자동 추적을 켜면 여기에 인식 근거가 보인다.' }}
      </p>
      <div v-if="numbers" class="meta__line" data-testid="track-numbers">{{ numbers }}</div>
      <div class="track__row track__settings">
        <label class="panel__count" title="게임 화면을 읽는 간격(초)">
          주기(초)
          <input
            type="number"
            :min="MIN_INTERVAL_SEC"
            :max="MAX_INTERVAL_SEC"
            step="0.5"
            :value="track.intervalSec.value"
            aria-label="게임 화면을 읽는 주기(초)"
            data-testid="track-interval"
            @change="onInterval"
          />
        </label>
        <label class="track__switch" title="보스를 인식하면 다른 탭을 보고 있어도 요격전 탭으로 옮긴다">
          <input type="checkbox" :checked="track.autoTab.value" data-testid="track-auto-tab" @change="onAutoTab" />
          인식하면 요격전 탭으로
        </label>
      </div>
    </details>
  </section>
</template>

<style scoped>
.track {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-strong);
}

.track__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.track__settings {
  margin-top: 4px;
}

.track__switch {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  cursor: pointer;
}

.track__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
  opacity: 0.5;
}

.track__dot--on {
  background: var(--accent);
  opacity: 1;
}

.track__dot--warn {
  background: var(--warn);
  opacity: 1;
}

.track__dot--idle {
  opacity: 0.9;
}

.track__state {
  font-weight: 700;
}

.track__state[data-tone='off'] {
  color: var(--muted);
  font-weight: 400;
}

.track__spacer {
  flex: 1;
}

.track__time,
.track__none {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

.track__reason,
.track__problem {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.track__problem {
  color: var(--warn);
}
</style>
