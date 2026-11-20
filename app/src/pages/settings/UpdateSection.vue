<script setup lang="ts">
import { useUpdates } from '../../lib/updates';
const updates = useUpdates();
</script>

<template>
  <section v-if="updates" class="nk-card" aria-label="앱 정보·업데이트">
    <h2 class="nk-subtitle">앱 정보·업데이트</h2>
    <p>현재 판 {{ updates.version }}</p>
    <p v-if="updates.phase.value === 'development'">개발 실행에서는 업데이트하지 않는다.</p>
    <template v-else>
      <label>
        <input type="checkbox" :checked="updates.automatic.value" @change="updates.setAutomatic(($event.target as HTMLInputElement).checked)" />
        켜질 때 업데이트 확인
      </label>
      <p role="status" aria-live="polite">
        <template v-if="updates.phase.value === 'checking'">새 판을 확인하는 중…</template>
        <template v-else-if="updates.phase.value === 'latest'">최신 판을 사용하고 있다.</template>
        <template v-else-if="updates.phase.value === 'failed'">업데이트를 마치지 못했으니 잠시 후 다시 시도해 주세요.</template>
        <template v-else-if="updates.phase.value === 'available'">새 판 {{ updates.available.value?.version }}</template>
        <template v-else-if="updates.phase.value === 'downloading'">
          내려받는 중 · {{ updates.bytes.value.toLocaleString() }} 바이트
          <progress aria-label="내려받은 양" :value="updates.total.value ? updates.bytes.value : undefined" :max="updates.total.value" />
        </template>
      </p>
      <template v-if="updates.phase.value === 'available'">
        <p class="notes">{{ updates.available.value?.body?.trim().split(/\r?\n/).slice(0, 5).join('\n') }}</p>
        <button type="button" :disabled="!updates.canInstall.value" @click="updates.install">설치하고 다시 시작</button>
        <span v-if="!updates.canInstall.value">{{ updates.accountWork.value ? '계정 연결 작업이 끝나면 설치할 수 있다.' : '계산이 끝나면 설치할 수 있다.' }}</span>
      </template>
      <button v-else type="button" :disabled="['loading', 'checking', 'downloading'].includes(updates.phase.value)" @click="updates.check()">업데이트 확인</button>
    </template>
  </section>
</template>

<style scoped>
.notes { white-space: pre-line; }
</style>
