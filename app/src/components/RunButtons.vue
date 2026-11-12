<script setup lang="ts">
// 계산의 실행·중단 단추. 추천·비교, 요격전, 성장 비교가 같은 단추를 쓴다.
// 중단 단추는 계산이 도는 동안에만 있다. 다른 화면이 계산 중이면 실행할 수 없다(엔진 배치 자리는 하나다).
import type { EngineRun } from '../lib/engineRun';

defineProps<{
  run: EngineRun;
  /** 실행 단추의 글자(계산 중이 아닐 때). */
  label: string;
  /** 부모가 다른 일을 하는 중이면 실행을 막는다. */
  disabled?: boolean;
}>();

defineEmits<{ run: []; stop: [] }>();
</script>

<template>
  <button
    v-if="run.computing"
    class="run-stop"
    type="button"
    title="도는 계산을 멈춘다 (엔진 프로세스를 끝낸다)"
    :disabled="run.stopping"
    data-testid="stop-compute"
    @click="$emit('stop')"
  >
    {{ run.stopping ? '중단하는 중…' : '중단' }}
  </button>
  <button
    class="run-start"
    type="button"
    :title="run.busyElsewhere ? '다른 탭의 계산이 도는 중이다 — 끝나거나 중단한 뒤에 실행할 수 있다' : undefined"
    :disabled="run.computing || run.busyElsewhere || disabled"
    data-testid="run-compute"
    @click="$emit('run')"
  >
    {{ run.computing ? '계산 중…' : label }}
  </button>
</template>

<style scoped>
.run-start,
.run-stop {
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.run-start {
  border-color: var(--gold);
  background: rgba(255, 196, 64, 0.16);
  font-weight: 700;
}

.run-stop {
  border-color: var(--danger);
  color: var(--danger);
}

.run-start:disabled,
.run-stop:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
