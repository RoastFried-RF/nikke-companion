<script setup lang="ts">
// 설정 > 계정 연결: 계산에 쓸 계정 고르기와 계정 받기(크롬 확장 — 권장 · 붙여넣기 · 로그인 창).
// 받는 흐름(쿠키 → 계정 새로 받기 → 저장)은 screens/AccountScreen.vue다. 받은 계정은 곧바로 계산에 쓸 계정이 된다.
// 계정 여러 개(P-033): 받아 둔 계정들의 목록 — 계정마다 「이 계정 쓰기」와 「목록에서 숨기기」가 있다. **숨기기는 지우기가 아니다**:
// 계정·기록·저장한 편성은 그대로 남고, 다시 보이게 할 수 있다. 완전히 지우는 단추는 앱에 없다 — 어디에 있는지 알려 준다.
// 계산이 도는 동안에는 계정을 바꾸지 못한다(화면 위쪽의 계정 바꾸기와 같은 규칙 — 루트의 src/core/accounts.mjs).
import { accountChoices, accountFiles } from '@core/accounts.mjs';
import { computed, ref } from 'vue';
import { useEngineOwner } from '../../lib/engineRun';
import { localTime } from '../../lib/format';
import { useShared } from '../../lib/shared';
import AccountScreen from '../../screens/AccountScreen.vue';
import StatusPill from '../../ui/StatusPill.vue';

const shared = useShared();
const computingRun = useEngineOwner();
const choices = computed(() => accountChoices(shared?.snapshot.value ?? null, { computing: (computingRun?.value ?? null) !== null }));
const accounts = computed(() => choices.value.accounts);
/** 계정들이 있는 곳(Rust가 알려 준 글자 그대로). */
const where = computed(() => shared?.snapshot.value?.accounts_location ?? '');
/** 어느 계정의 「완전히 지우려면」을 펼쳐 보고 있는가. */
const removing = ref('');

async function onDefaultAccount(event: Event): Promise<void> {
  const name = (event.target as HTMLSelectElement).value;
  if (name) await shared?.setDefaultAccount(name);
}

async function hide(name: string, hidden: boolean): Promise<void> {
  await shared?.setAccountHidden(name, hidden);
}

function toggleRemoving(name: string): void {
  removing.value = removing.value === name ? '' : name;
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
      <p v-if="accounts.length === 0 && choices.hidden.length === 0" class="nk-muted" data-testid="no-accounts">
        아직 받은 계정이 없다. 아래에서 계정을 받으면 그 계정으로 요격전과 편성 도구를 계산한다.
      </p>
      <p v-else-if="accounts.length === 0" class="nk-muted" data-testid="all-hidden">
        받아 둔 계정을 모두 목록에서 숨겼다. 아래의 숨긴 계정에서 다시 보이게 하거나 계정을 새로 받는다.
      </p>
      <label v-else class="nk-row">
        <span>계정</span>
        <select
          class="nk-input"
          :value="shared?.accountName.value ?? ''"
          :disabled="choices.locked"
          :title="choices.locked_reason ?? undefined"
          aria-label="계산에 쓸 계정"
          data-testid="default-account"
          @change="onDefaultAccount"
        >
          <option v-if="!shared?.accountName.value" value="" disabled>계정을 고른다</option>
          <option v-for="a in accounts" :key="a.name" :value="a.name">{{ a.name }}{{ a.modified_at ? ` — ${localTime(a.modified_at)}에 받음` : '' }}</option>
        </select>
      </label>
      <p v-if="choices.locked" class="nk-muted" data-testid="account-locked">{{ choices.locked_reason }}</p>
    </section>

    <!-- 계정 여러 개(P-033): 본계·부계를 함께 두고 바꿔 쓴다. 추천·기록·저장한 편성은 계정마다 따로다. -->
    <section v-if="accounts.length + choices.hidden.length > 0" class="nk-card" aria-label="받아 둔 계정" data-testid="account-list-card">
      <div class="nk-row">
        <h2 class="nk-subtitle">받아 둔 계정</h2>
        <span class="nk-muted">마지막 요격전 추천 · 요격전 기록과 모듈 기록 · 즐겨찾기 · 저장한 편성은 계정마다 따로 남는다</span>
      </div>
      <p class="nk-muted" data-testid="account-more-hint">
        계정을 하나 더 두려면(부계) 아래의 계정 받기에서 다른 이름으로 저장한다. 계정이 둘 이상이면 화면 위쪽에서도 바꿀 수 있다.
      </p>
      <ul class="accounts" data-testid="account-list">
        <li v-for="a in accounts" :key="a.name" class="accounts__item" :data-current="a.current ? 'yes' : 'no'" data-testid="account-item">
          <div class="nk-row">
            <strong data-testid="account-item-name">{{ a.name }}</strong>
            <StatusPill v-if="a.current" label="지금 쓰는 계정" tone="ok" data-testid="account-item-current" />
            <span v-if="a.modified_at" class="nk-muted">{{ localTime(a.modified_at) }}에 받음</span>
            <span class="nk-spacer"></span>
            <button v-if="!a.current" type="button" class="nk-btn" :disabled="choices.locked" data-testid="account-use" @click="shared?.setDefaultAccount(a.name)">
              이 계정 쓰기
            </button>
            <button
              type="button"
              class="nk-btn nk-btn--quiet"
              :disabled="choices.locked"
              :title="`${a.name} 계정을 목록에서 숨긴다 — 지우지 않는다(다시 보이게 할 수 있다)`"
              data-testid="account-hide"
              @click="hide(a.name, true)"
            >
              목록에서 숨기기
            </button>
            <button type="button" class="nk-btn nk-btn--quiet" :aria-expanded="removing === a.name" data-testid="account-remove-how" @click="toggleRemoving(a.name)">
              완전히 지우려면
            </button>
          </div>
          <div v-if="removing === a.name" class="accounts__where" data-testid="account-where">
            <p>
              이 앱에는 계정을 지우는 단추가 없다(실수로 기록까지 잃지 않게). 완전히 지우려면 앱을 끄고 이 PC의 아래 위치에서 직접 지운다.
            </p>
            <p>위치: <code data-testid="account-where-dir">{{ where }}</code></p>
            <ul class="accounts__names">
              <li v-for="f in accountFiles(a.name)" :key="f.name" data-testid="account-where-item"><code>{{ f.name }}</code> — {{ f.label }}</li>
            </ul>
          </div>
        </li>
      </ul>

      <div v-if="choices.hidden.length" class="accounts__hidden" data-testid="account-hidden">
        <div class="nk-row">
          <h3 class="accounts__subtitle">숨긴 계정</h3>
          <span class="nk-muted">지운 것이 아니다 — 계정과 기록이 그대로 남아 있다</span>
        </div>
        <ul class="accounts">
          <li v-for="a in choices.hidden" :key="a.name" class="accounts__item" data-testid="account-hidden-item">
            <div class="nk-row">
              <strong>{{ a.name }}</strong>
              <StatusPill label="숨김" tone="neutral" />
              <span class="nk-spacer"></span>
              <button type="button" class="nk-btn" data-testid="account-unhide" @click="hide(a.name, false)">다시 보이기</button>
              <button type="button" class="nk-btn nk-btn--quiet" :aria-expanded="removing === a.name" data-testid="account-remove-how" @click="toggleRemoving(a.name)">
                완전히 지우려면
              </button>
            </div>
            <div v-if="removing === a.name" class="accounts__where" data-testid="account-where">
              <p>완전히 지우려면 앱을 끄고 이 PC의 아래 위치에서 직접 지운다(이 앱에는 지우는 단추가 없다).</p>
              <p>위치: <code data-testid="account-where-dir">{{ where }}</code></p>
              <ul class="accounts__names">
                <li v-for="f in accountFiles(a.name)" :key="f.name" data-testid="account-where-item"><code>{{ f.name }}</code> — {{ f.label }}</li>
              </ul>
            </div>
          </li>
        </ul>
      </div>
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

.accounts {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.accounts__item {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding: var(--nk-space-3) var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.accounts__item[data-current='yes'] {
  border-color: var(--nk-accent);
}

.accounts__hidden {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding-top: var(--nk-space-4);
  border-top: var(--nk-border-width) solid var(--nk-border);
}

.accounts__subtitle {
  margin: 0;
  font-size: var(--nk-font-md);
  font-weight: var(--nk-weight-bold);
}

.accounts__where {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  overflow-wrap: anywhere;
}

.accounts__where p {
  margin: 0;
}

.accounts__names {
  margin: 0;
  padding-left: var(--nk-space-5);
}
</style>
