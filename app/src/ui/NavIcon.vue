<script setup lang="ts">
// 왼쪽 메뉴의 아이콘. 직접 그린 도형이다(게임 이미지가 아니다) — 글자 색을 따른다.
defineProps<{
  /** home · target · people · squad · tier · gear */
  name: string;
}>();
</script>

<template>
  <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true" :data-icon="name" data-testid="nav-icon">
    <path v-if="name === 'home'" d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    <template v-else-if="name === 'target'">
      <path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'people'">
      <circle cx="8" cy="8" r="3.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6zM15.5 20c0-1.8-.5-3.4-1.4-4.6.9-.6 1.9-.9 2.9-.9 2.8 0 5 2.2 5 5.5z" />
    </template>
    <template v-else-if="name === 'squad'">
      <rect x="2.5" y="5" width="3.2" height="14" rx="1" />
      <rect x="6.6" y="5" width="3.2" height="14" rx="1" />
      <rect x="10.7" y="5" width="3.2" height="14" rx="1" />
      <rect x="14.8" y="5" width="3.2" height="14" rx="1" />
      <rect x="18.9" y="5" width="3.2" height="14" rx="1" />
    </template>
    <template v-else-if="name === 'tier'">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="13" height="4" rx="1" />
      <rect x="3" y="16" width="8" height="4" rx="1" />
    </template>
    <template v-else>
      <!-- 톱니바퀴: 고리 둘과 톱니 여덟. -->
      <path
        d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2" />
    </template>
  </svg>
</template>

<style scoped>
.nav-icon {
  flex: none;
  width: var(--nk-icon-lg);
  height: var(--nk-icon-lg);
  fill: currentColor;
}
</style>
