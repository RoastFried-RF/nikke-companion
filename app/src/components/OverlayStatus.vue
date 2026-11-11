<script setup lang="ts">
// 오버레이의 현재 상태를 보여 준다. 클릭 통과 중에는 창을 조작할 수 없으므로 눈에 띄게 표시하고
// 되돌리는 단축키를 함께 적는다.
import type { OverlaySnapshot } from '../types';

defineProps<{ state: OverlaySnapshot | null }>();
</script>

<template>
  <div class="status" :class="{ 'status--passthrough': state?.click_through }" data-testid="overlay-status">
    <template v-if="state === null">
      <span class="status__label" data-testid="status-unknown">오버레이 상태 확인 중…</span>
    </template>
    <template v-else>
      <div
        v-if="state.click_through"
        class="status__banner"
        role="status"
        aria-live="polite"
        data-testid="click-through-on"
      >
        <strong>클릭 통과 중</strong>
        <span>마우스 입력이 아래 프로그램으로 간다 · <kbd>Alt+Shift+C</kbd>로 해제</span>
      </div>
      <div v-else class="status__line" data-testid="click-through-off">
        <span class="status__dot" aria-hidden="true"></span>
        <strong>조작 가능</strong>
        <span class="status__keys"><kbd>Alt+Shift+C</kbd> 클릭 통과</span>
      </div>
      <div class="status__line status__line--sub">
        <span data-testid="visibility">창: {{ state.visible ? '보임' : '숨김' }}</span>
        <span class="status__keys"><kbd>Alt+Shift+O</kbd> 숨김/보임</span>
      </div>
      <ul v-if="state.shortcut_problems.length" class="status__problems" role="alert" data-testid="shortcut-problems">
        <li v-for="(p, i) in state.shortcut_problems" :key="i">{{ p }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
}

.status__label {
  color: var(--muted);
}

.status__line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status__line--sub {
  color: var(--muted);
}

.status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6ee7a0;
}

.status__keys {
  margin-left: auto;
  color: var(--muted);
  white-space: nowrap;
}

.status__banner {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 10px;
  border-radius: 6px;
  color: #fff;
  background: repeating-linear-gradient(
    -45deg,
    var(--passthrough),
    var(--passthrough) 10px,
    #c93a1c 10px,
    #c93a1c 20px
  );
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.status__banner strong {
  font-size: 15px;
  letter-spacing: 0.04em;
}

.status__problems {
  padding: 4px 8px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  color: var(--danger);
}

kbd {
  padding: 0 4px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font: inherit;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.08);
}

.status__banner kbd {
  border-color: rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.3);
}
</style>
