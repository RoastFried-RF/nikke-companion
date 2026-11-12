<script setup lang="ts">
// 설정 > 오버레이: 언제 띄우는가(앱과 함께·게임을 찾았을 때·직접), 지금 띄우기/숨기기, 위젯의 모양과 보기(크기 배율·불투명도·
// 기본 모양·클릭 통과), 이상 개체 화면을 떠났을 때(자동 숨김), 자리 초기화, 자동 추적·자동 이동, 게임 창에 붙이기, 단축키 안내.
// 오버레이 창 자체에는 설정이 없다 — 여기서 정한다. 값의 범위와 기억은 Rust가 맡는다(lib/widget.ts).
import { computed } from 'vue';
import GamePanel from '../../components/GamePanel.vue';
import TrackPanel from '../../components/TrackPanel.vue';
import { useShared } from '../../lib/shared';
import { useOverlayState } from '../../lib/status';
import { clampSetting, DEFAULT_PREFS, LEAVE_AFTER_RANGE, LEAVES, OPACITY_RANGE, SCALE_RANGE, SHAPES, useWidget } from '../../lib/widget';
import type { OverlayLaunch } from '../../types';
import StatusPill from '../../ui/StatusPill.vue';

const LAUNCH_CHOICES: { key: OverlayLaunch; label: string; hint: string }[] = [
  { key: 'with_app', label: '앱과 함께 띄우기', hint: '앱을 켜면 오버레이도 바로 뜬다.' },
  { key: 'with_game', label: '게임을 찾았을 때 띄우기', hint: '니케가 켜져 있을 때만 뜬다.' },
  { key: 'manual', label: '직접 띄우기', hint: '아래 단추나 단축키로 띄운다.' },
];

const SHORTCUTS = [
  { keys: 'Alt+Shift+O', what: '오버레이 숨기기 / 다시 띄우기' },
  { keys: 'Alt+Shift+C', what: '클릭 통과 — 오버레이를 눌러도 게임이 눌린다' },
  { keys: 'Alt+Shift+M', what: '오버레이 모양 바꾸기 — 접힘 → 한 줄 카드 → 펼침' },
  { keys: 'Alt+Shift+S', what: '지금 게임 화면 저장' },
];

const shared = useShared();
const { overlay, problem, setVisible } = useOverlayState();
const widget = useWidget();
const launch = computed<OverlayLaunch>(() => shared?.snapshot.value?.overlay_launch ?? 'with_app');
const prefs = computed(() => widget.snapshot.value?.prefs ?? DEFAULT_PREFS);
const shape = computed(() => widget.snapshot.value?.shape ?? DEFAULT_PREFS.default_shape);
const shapeLabel = computed(() => SHAPES.find((s) => s.key === shape.value)?.label ?? '');
/** 오버레이가 지금 눈에 보이는가(숨기지 않았고 쉬고 있지도 않다). */
const resting = computed(() => widget.snapshot.value?.resting === true);

/** 수를 고르는 칸: 범위 안의 값으로 맞춰 알리고, 칸에는 실제로 쓰는 값을 되돌려 보인다. */
async function onNumber(event: Event, key: 'scale_percent' | 'opacity_percent' | 'leave_after_sec', range: { min: number; max: number; fallback: number }): Promise<void> {
  const box = event.target as HTMLInputElement;
  const value = clampSetting(box.value, range);
  await widget.setPrefs({ [key]: value });
  box.value = String(prefs.value[key]);
}

async function onClickThrough(event: Event): Promise<void> {
  const box = event.target as HTMLInputElement;
  await widget.setPrefs({ click_through: box.checked });
  // 바꾸지 못했으면(오버레이가 숨겨져 있다 등) 실제 값으로 되돌려 보인다.
  box.checked = prefs.value.click_through;
}
</script>

<template>
  <div class="section" data-testid="settings-overlay">
    <section class="nk-card" aria-label="오버레이를 띄우는 때">
      <div class="nk-row">
        <h2 class="nk-subtitle">오버레이</h2>
        <StatusPill :label="overlay === null ? '확인 중' : overlay.visible ? '떠 있음' : '숨김'" :tone="overlay?.visible ? 'ok' : 'neutral'" data-testid="overlay-state" />
        <StatusPill
          v-if="overlay?.visible && resting"
          label="쉬는 중"
          tone="neutral"
          detail="이상 개체 화면이 아니라서 잠시 숨겨 뒀다 — 이상 개체 화면으로 돌아오면 다시 뜬다. 지금 보려면 「오버레이 깨우기」를 누른다."
          data-testid="overlay-resting"
        />
        <StatusPill v-if="overlay?.click_through" label="클릭 통과 중" tone="unknown" data-testid="overlay-passthrough" />
        <span class="nk-spacer"></span>
        <button v-if="overlay?.visible && resting" type="button" class="nk-btn" data-testid="overlay-wake" @click="setVisible(true)">오버레이 깨우기</button>
        <button type="button" class="nk-btn" :disabled="overlay === null" data-testid="overlay-toggle" @click="setVisible(!overlay?.visible)">
          {{ overlay?.visible ? '오버레이 숨기기' : '오버레이 띄우기' }}
        </button>
      </div>
      <p class="nk-muted">게임 위에 뜨는 작은 위젯이다 — 게임에서 보고 있는 보스의 추천을 보여 준다. 계산과 설정은 이 앱 창에서 한다.</p>
      <p v-if="problem" class="nk-error" role="alert" data-testid="overlay-problem">{{ problem }}</p>
      <div class="nk-seg" role="radiogroup" aria-label="오버레이를 띄우는 때">
        <button
          v-for="choice in LAUNCH_CHOICES"
          :key="choice.key"
          type="button"
          role="radio"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': launch === choice.key }"
          :aria-checked="launch === choice.key"
          :data-testid="`launch-${choice.key}`"
          @click="shared?.setOverlayLaunch(choice.key)"
        >
          {{ choice.label }}
          <span class="nk-seg__sub">{{ choice.hint }}</span>
        </button>
      </div>
    </section>

    <section class="nk-card" aria-label="오버레이의 모양과 보기" data-testid="widget-settings">
      <div class="nk-row">
        <h2 class="nk-subtitle">모양 · 보기</h2>
        <StatusPill v-if="widget.snapshot.value" :label="`지금 ${shapeLabel}`" tone="accent" data-testid="widget-shape-now" />
        <StatusPill v-if="widget.snapshot.value?.pinned" label="고정됨" tone="neutral" detail="오버레이의 핀을 눌러 고정했다 — 이상 개체 화면을 떠나도 그대로 둔다." data-testid="widget-pinned" />
      </div>
      <p class="nk-muted">오버레이를 누르거나 단축키(Alt+Shift+M)로 모양을 바꾼다. 창은 위젯만큼만 크다 — 위젯 밖은 그대로 게임이 눌린다.</p>
      <p v-if="widget.problem.value" class="nk-error" role="alert" data-testid="widget-problem">{{ widget.problem.value }}</p>
      <p v-else-if="widget.snapshot.value?.problem" class="nk-error" role="alert" data-testid="widget-problem">{{ widget.snapshot.value.problem }}</p>

      <p class="section__label">앱을 켰을 때의 모양</p>
      <div class="nk-seg" role="radiogroup" aria-label="기본 모양">
        <button
          v-for="choice in SHAPES"
          :key="choice.key"
          type="button"
          role="radio"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': prefs.default_shape === choice.key }"
          :aria-checked="prefs.default_shape === choice.key"
          :data-testid="`shape-${choice.key}`"
          @click="widget.setPrefs({ default_shape: choice.key })"
        >
          {{ choice.label }}
          <span class="nk-seg__sub">{{ choice.hint }}</span>
        </button>
      </div>

      <div class="section__grid">
        <label class="section__field">
          <span class="section__label">크기 배율 <strong data-testid="scale-now">{{ prefs.scale_percent }}%</strong></span>
          <input
            type="range"
            class="section__range"
            :min="SCALE_RANGE.min"
            :max="SCALE_RANGE.max"
            :step="SCALE_RANGE.step"
            :value="prefs.scale_percent"
            data-testid="scale-range"
            @change="onNumber($event, 'scale_percent', SCALE_RANGE)"
          />
        </label>
        <label class="section__field">
          <span class="section__label">불투명도 <strong data-testid="opacity-now">{{ prefs.opacity_percent }}%</strong></span>
          <input
            type="range"
            class="section__range"
            :min="OPACITY_RANGE.min"
            :max="OPACITY_RANGE.max"
            :step="OPACITY_RANGE.step"
            :value="prefs.opacity_percent"
            data-testid="opacity-range"
            @change="onNumber($event, 'opacity_percent', OPACITY_RANGE)"
          />
          <span class="nk-muted">기본은 불투명(100%)이다 — 낮추면 게임 화면이 비쳐 글자가 덜 읽힌다.</span>
        </label>
      </div>

      <label class="section__check" title="켜면 오버레이를 눌러도 게임이 눌린다. 그동안 오버레이는 단축키로만 다룬다(Alt+Shift+C로 끈다)">
        <input type="checkbox" :checked="prefs.click_through" :disabled="overlay === null" data-testid="click-through-switch" @change="onClickThrough" />
        <span>클릭 통과 — 오버레이를 눌러도 게임이 눌린다(Alt+Shift+C)</span>
      </label>

      <div class="nk-row">
        <span class="nk-muted">끌어서 옮긴 자리는 기억한다. 화면 밖으로 나가면 안쪽으로 되돌린다.</span>
        <span class="nk-spacer"></span>
        <button type="button" class="nk-btn" data-testid="reset-position" @click="widget.resetPosition()">자리 초기화</button>
      </div>
    </section>

    <section class="nk-card" aria-label="자동 숨김" data-testid="leave-settings">
      <h2 class="nk-subtitle">자동 숨김</h2>
      <p class="nk-muted">
        자동 추적을 켜 두면, 게임이 이상 개체 화면이 아니게 됐을 때 잠시 뒤 오버레이를 접거나 숨긴다. 이상 개체 화면으로 돌아오면 되돌린다.
        오버레이의 핀으로 고정해 두면 그대로 둔다. 화면을 알아보지 못하는 동안에는 바꾸지 않는다.
      </p>
      <div class="nk-seg" role="radiogroup" aria-label="이상 개체 화면을 떠났을 때">
        <button
          v-for="choice in LEAVES"
          :key="choice.key"
          type="button"
          role="radio"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': prefs.leave === choice.key }"
          :aria-checked="prefs.leave === choice.key"
          :data-testid="`leave-${choice.key}`"
          @click="widget.setPrefs({ leave: choice.key })"
        >
          {{ choice.label }}
          <span class="nk-seg__sub">{{ choice.hint }}</span>
        </button>
      </div>
      <label class="section__inline">
        <span class="section__label">떠난 뒤 기다리는 시간(초)</span>
        <input
          type="number"
          class="nk-input section__number"
          :min="LEAVE_AFTER_RANGE.min"
          :max="LEAVE_AFTER_RANGE.max"
          :step="LEAVE_AFTER_RANGE.step"
          :value="prefs.leave_after_sec"
          :disabled="prefs.leave === 'stay'"
          data-testid="leave-after"
          @change="onNumber($event, 'leave_after_sec', LEAVE_AFTER_RANGE)"
        />
      </label>
    </section>

    <section class="nk-card" aria-label="자동 추적">
      <h2 class="nk-subtitle">자동 추적 · 자동 이동</h2>
      <p class="nk-muted">
        켜 두면 게임 화면을 주기적으로 읽어, 이상 개체 요격전에서 보고 있는 보스의 추천을 스스로 보여 준다. 게임은 읽기만 하고 화면을 저장하지
        않는다. 계산이 도는 동안에는 보던 화면을 옮기지 않는다.
      </p>
      <TrackPanel />
    </section>

    <section class="nk-card" aria-label="게임 창">
      <h2 class="nk-subtitle">게임 창 · 붙이기</h2>
      <p class="nk-muted">
        붙이기를 켜면 오버레이가 게임 창을 따라간다 — 처음에는 게임 화면의 오른쪽 위 안쪽이고, 끌어 둔 자리(게임 창 기준)를 기억한다. 게임 창은
        건드리지 않는다.
      </p>
      <GamePanel />
    </section>

    <section class="nk-card" aria-label="단축키" data-testid="shortcuts">
      <h2 class="nk-subtitle">단축키</h2>
      <ul class="section__keys">
        <li v-for="s in SHORTCUTS" :key="s.keys" data-testid="shortcut"><kbd>{{ s.keys }}</kbd> {{ s.what }}</li>
      </ul>
      <ul v-if="overlay?.shortcut_problems.length" class="nk-list" data-testid="shortcut-problems">
        <li v-for="item in overlay.shortcut_problems" :key="item">{{ item }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-height: 0;
}

.section__keys {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.section__label {
  margin: 0;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.section__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--nk-space-5);
}

.section__field {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  min-width: 0;
}

.section__range {
  width: 100%;
  accent-color: var(--nk-accent);
}

.section__check,
.section__inline {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
}

.section__number {
  width: var(--nk-tile-lg);
}
</style>
