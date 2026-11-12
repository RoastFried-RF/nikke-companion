<script setup lang="ts">
// 계정 받기의 실패 안내: Rust가 준 한국어 문장과, 쿠키 문제면 쿠키를 다시 받는 순서.
// 실패가 난 단계 바로 아래에 보인다(screens/AccountScreen.vue).
import type { SyncFailure } from '../types';

defineProps<{
  /** 실패가 난 단계(1 쿠키 받기 · 2 계정 새로 받기 · 3 변환·저장). */
  step: number;
  detail: SyncFailure;
}>();
</script>

<template>
  <div class="screen__error failure" role="alert" data-testid="account-error" :data-kind="detail.kind" :data-step="step">
    <p data-testid="account-error-message">{{ detail.message }}</p>
    <template v-if="detail.cookie_help">
      <p class="failure__title">쿠키를 다시 받는 순서</p>
      <ol class="failure__steps" data-testid="cookie-help">
        <li>브라우저에서 blablalink.com에 로그인한다(게임 계정 연동까지).</li>
        <li>F12 개발자 도구의 Network(네트워크) 탭을 열고 페이지를 새로 고친다.</li>
        <li>api.blablalink.com으로 가는 요청의 Cookie 헤더 값 전체를 복사한다.</li>
        <li>1단계의 붙여넣기 칸에 붙여넣고 「쿠키 저장」을 누른 뒤, 2단계의 「계정 새로 받기」를 다시 누른다.</li>
      </ol>
      <p class="failure__note">
        개발자 도구 대신 1단계의 크롬 확장으로 받아도 된다(「크롬 확장 연결」을 켜고 확장의 「오버레이로 보내기」 — 계정 받기까지
        이어진다). 비밀번호로 로그인하는 계정이면 1단계의 로그인 창에서 다시 로그인하고 「쿠키 가져오기」를 눌러도 된다.
      </p>
    </template>
  </div>
</template>

<style scoped>
.failure {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.failure p {
  margin: 0;
}

.failure__title {
  font-weight: 700;
}

.failure__steps {
  padding-left: 18px;
  list-style: decimal;
  font-size: 12px;
  color: var(--text);
}

.failure__steps li {
  margin-top: 2px;
  overflow-wrap: anywhere;
}

.failure__note {
  font-size: 12px;
  color: var(--text);
}
</style>
