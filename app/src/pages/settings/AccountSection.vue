<script setup lang="ts">
// 설정 > 계정 연결: 계산에 쓸 계정 고르기와 계정 받기(크롬 확장 — 권장 · 붙여넣기 · 로그인 창).
// 받는 흐름(쿠키 → 계정 새로 받기 → 저장)은 screens/AccountScreen.vue다. 받은 계정은 곧바로 계산에 쓸 계정이 된다.
import { computed } from 'vue';
import { localTime } from '../../lib/format';
import { useShared } from '../../lib/shared';
import AccountScreen from '../../screens/AccountScreen.vue';
import StatusPill from '../../ui/StatusPill.vue';

const shared = useShared();
const accounts = computed(() => shared?.snapshot.value?.accounts ?? []);

async function onDefaultAccount(event: Event): Promise<void> {
  const name = (event.target as HTMLSelectElement).value;
  if (name) await shared?.setDefaultAccount(name);
}
</script>

<template>
  <div class="section" data-testid="settings-account">
    <section class="nk-card" aria-label="계산에 쓸 계정" data-testid="default-account-card">
      <div class="nk-row">
        <h2 class="nk-subtitle">계산에 쓸 계정</h2>
        <StatusPill v-if="shared?.accountName.value" :label="`연결됨 · ${shared.accountName.value}`" tone="ok" data-testid="account-state" />
        <StatusPill v-else label="연결 안 됨" tone="unknown" data-testid="account-state" />
      </div>
      <p v-if="accounts.length === 0" class="nk-muted" data-testid="no-accounts">
        아직 받은 계정이 없다. 아래에서 계정을 받으면 그 계정으로 요격전과 편성 도구를 계산한다.
      </p>
      <label v-else class="nk-row">
        <span>계정</span>
        <select class="nk-input" :value="shared?.accountName.value ?? ''" aria-label="계산에 쓸 계정" data-testid="default-account" @change="onDefaultAccount">
          <option v-if="!shared?.accountName.value" value="" disabled>계정을 고른다</option>
          <option v-for="a in accounts" :key="a.name" :value="a.name">{{ a.name }}{{ a.modified_at ? ` — ${localTime(a.modified_at)}에 받음` : '' }}</option>
        </select>
      </label>
    </section>
    <AccountScreen />
  </div>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-height: 0;
}
</style>
