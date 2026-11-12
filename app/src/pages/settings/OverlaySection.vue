<script setup lang="ts">
// 설정 > 오버레이: 언제 띄우는가(앱과 함께·게임을 찾았을 때·직접), 지금 띄우기/숨기기, 자동 추적·자동 이동,
// 게임 창에 붙이기, 단축키 안내. 오버레이 창 자체에는 설정이 없다 — 여기서 정한다.
import { computed } from 'vue';
import GamePanel from '../../components/GamePanel.vue';
import TrackPanel from '../../components/TrackPanel.vue';
import { useShared } from '../../lib/shared';
import { useOverlayState } from '../../lib/status';
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
  { keys: 'Alt+Shift+S', what: '지금 게임 화면 저장' },
];

const shared = useShared();
const { overlay, problem, setVisible } = useOverlayState();
const launch = computed<OverlayLaunch>(() => shared?.snapshot.value?.overlay_launch ?? 'with_app');
</script>

<template>
  <div class="section" data-testid="settings-overlay">
    <section class="nk-card" aria-label="오버레이를 띄우는 때">
      <div class="nk-row">
        <h2 class="nk-subtitle">오버레이</h2>
        <StatusPill :label="overlay === null ? '확인 중' : overlay.visible ? '떠 있음' : '숨김'" :tone="overlay?.visible ? 'ok' : 'neutral'" data-testid="overlay-state" />
        <StatusPill v-if="overlay?.click_through" label="클릭 통과 중" tone="unknown" data-testid="overlay-passthrough" />
        <span class="nk-spacer"></span>
        <button type="button" class="nk-btn" :disabled="overlay === null" data-testid="overlay-toggle" @click="setVisible(!overlay?.visible)">
          {{ overlay?.visible ? '오버레이 숨기기' : '오버레이 띄우기' }}
        </button>
      </div>
      <p class="nk-muted">게임 위에 뜨는 작은 창이다 — 게임에서 보고 있는 보스의 추천을 보여 준다. 계산과 설정은 이 앱 창에서 한다.</p>
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
      <p class="nk-muted">붙이기를 켜면 오버레이가 게임 창의 오른쪽 위 안쪽에 머물며 게임 창을 따라간다. 게임 창은 건드리지 않는다.</p>
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
</style>
