<script setup lang="ts">
// 설정 > 계산 도구: 총딜을 계산하는 프로그램(엔진)의 판과, 그 자리·실행 환경의 문제.
// 이 화면은 읽기만 한다 — 계산 도구의 자리는 화면이 정하지 못한다(Rust가 설정에서 읽는다).
import { onActivated, onMounted, ref } from 'vue';
import { accountSyncStatus, engineCatalog, engineVersion, errorMessage } from '../../lib/backend';
import { recallAuto, rememberAuto } from '../../lib/deck';
import { engineLabel } from '../../lib/format';
import { useShared } from '../../lib/shared';
import type { EngineVersion } from '../../types';
import StatusPill from '../../ui/StatusPill.vue';

const shared = useShared();
const version = ref<EngineVersion | null>(null);
const known = ref<number | null>(null);
const problems = ref<string[]>([]);
const checked = ref(false);

async function check(): Promise<void> {
  const found: string[] = [];
  const note = (message: string) => {
    if (!found.includes(message)) found.push(message);
  };
  try {
    version.value = await engineVersion();
  } catch (e) {
    version.value = null;
    note(errorMessage(e));
  }
  try {
    known.value = Object.keys((await engineCatalog()).nikkes ?? {}).length;
  } catch (e) {
    known.value = null;
    note(errorMessage(e));
  }
  try {
    for (const problem of (await accountSyncStatus(shared?.accountName.value ?? null)).problems) note(problem);
  } catch {
    // 계정 받기의 상태는 계정 연결 구획이 알린다.
  }
  problems.value = found;
  checked.value = true;
}

onMounted(check);
onActivated(check);

// 덱 빌더의 자동 계산(P-030): 다섯 자리가 차면 「계산」을 누르지 않아도 계산한다. 기본은 꺼짐 — 이 PC에 기억한다.
const autoDeck = ref(recallAuto());
function onAutoDeck(event: Event): void {
  autoDeck.value = (event.target as HTMLInputElement).checked;
  rememberAuto(autoDeck.value);
}
</script>

<template>
  <div class="section" data-testid="settings-engine">
    <section class="nk-card" aria-label="계산 도구">
      <div class="nk-row">
        <h2 class="nk-subtitle">계산 도구</h2>
        <StatusPill v-if="!checked" label="확인 중" data-testid="engine-state" />
        <StatusPill v-else-if="problems.length" :label="`문제 ${problems.length}건`" tone="error" solid data-testid="engine-state" />
        <StatusPill v-else label="문제없음" tone="ok" data-testid="engine-state" />
        <span class="nk-spacer"></span>
        <button type="button" class="nk-btn" data-testid="engine-recheck" @click="check">다시 확인</button>
      </div>
      <p class="nk-muted">총딜을 계산하는 프로그램이다. 이 앱은 그 프로그램에 편성을 넘기고 결과를 받아 보여 준다.</p>
      <ul class="nk-list">
        <li data-testid="engine-version">판: {{ version ? engineLabel(version) : '확인하지 못했다' }}</li>
        <li data-testid="engine-known">계산할 수 있는 니케: {{ known === null ? '확인하지 못했다' : `${known}명` }}</li>
      </ul>
      <template v-if="problems.length">
        <p class="nk-list__head">문제</p>
        <ul class="nk-list" data-testid="engine-problems">
          <li v-for="problem in problems" :key="problem" data-testid="engine-problem">{{ problem }}</li>
        </ul>
      </template>
    </section>

    <section class="nk-card" aria-label="덱 빌더" data-testid="settings-deck">
      <h2 class="nk-subtitle">덱 빌더</h2>
      <label class="section__check">
        <input type="checkbox" :checked="autoDeck" data-testid="deck-auto" @change="onAutoDeck" />
        다섯 자리가 차면 바로 계산한다
      </label>
      <p class="nk-muted">켜 두면 편성 도구의 덱 빌더에서 다섯 자리를 채우거나 바꿀 때마다 스스로 계산한다. 꺼 두면 「계산」을 눌렀을 때만 계산한다.</p>
    </section>
  </div>
</template>

<style scoped>
.section__check {
  display: inline-flex;
  align-items: center;
  gap: var(--nk-space-2);
  cursor: pointer;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
}
</style>
