<script setup lang="ts">
// 화면 위쪽의 계정 바꾸기(P-033 — 계정 여러 개): 고를 계정이 둘 이상일 때만 보인다(본계·부계).
// 바꾸면 그 계정의 것이 보인다 — 니케, 마지막 요격전 추천, 요격전 기록·모듈 기록, 저장한 편성은 계정마다 따로다.
// 계산이 도는 동안에는 바꾸지 못한다(도는 계산의 결과가 다른 계정의 것으로 남지 않게). 숨기기·다시 보이기는 설정의 계정 연결에 있다.
// 규칙(무엇을 보이고 언제 막는가)은 루트의 순수 함수(src/core/accounts.mjs)다.
import { accountChoices } from '@core/accounts.mjs';
import { computed } from 'vue';
import { useNav } from '../lib/nav';
import { useShared } from '../lib/shared';
import StatusPill from '../ui/StatusPill.vue';

const props = withDefaults(
  defineProps<{
    /** 어느 화면에서든 계산이 돌고 있는가. */
    computing?: boolean;
  }>(),
  { computing: false },
);

const shared = useShared();
const nav = useNav();

const choices = computed(() => accountChoices(shared?.snapshot.value ?? null, { computing: props.computing }));

async function onChange(event: Event): Promise<void> {
  const name = (event.target as HTMLSelectElement).value;
  if (name && name !== choices.value.current) await shared?.setDefaultAccount(name);
}
</script>

<template>
  <div v-if="choices.show" class="switch" aria-label="계정 바꾸기" data-testid="account-switch">
    <label class="switch__pick">
      <span class="switch__label">계정</span>
      <select
        class="nk-input"
        :value="choices.current ?? ''"
        :disabled="choices.locked"
        :title="choices.locked_reason ?? '계정을 바꾸면 그 계정의 니케·추천·기록·저장한 편성이 보인다'"
        aria-label="계산에 쓸 계정 바꾸기"
        data-testid="account-switch-select"
        @change="onChange"
      >
        <option v-if="!choices.current" value="" disabled>계정을 고른다</option>
        <option v-for="a in choices.accounts" :key="a.name" :value="a.name">{{ a.name }}</option>
      </select>
    </label>
    <StatusPill v-if="choices.needs_choice" label="계정을 골라야 한다" tone="unknown" data-testid="account-switch-need" />
    <span v-if="choices.locked" class="switch__note" data-testid="account-switch-locked">{{ choices.locked_reason }}</span>
    <span v-else class="switch__note">추천 · 기록 · 저장한 편성은 계정마다 따로다</span>
    <span class="switch__spacer"></span>
    <button type="button" class="nk-btn nk-btn--quiet" data-testid="account-switch-manage" @click="nav?.openSettings('account')">계정 관리</button>
  </div>
</template>

<style scoped>
.switch {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-2) var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface);
}

.switch__pick {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-3);
}

.switch__label {
  color: var(--nk-text-muted);
  font-weight: var(--nk-weight-bold);
}

.switch__note {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.switch__spacer {
  flex: 1;
}
</style>
