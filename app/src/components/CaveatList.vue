<script setup lang="ts">
// 결과 문서의 주의 문구. 접지 않는다 — 수치가 무엇을 뜻하지 않는지는 언제나 보여야 한다.
defineProps<{ caveats: string[] }>();
</script>

<template>
  <section class="block block--caveats" data-testid="caveats">
    <h2 class="block__title">주의</h2>
    <p v-if="caveats.length === 0" class="empty">결과 파일에 주의 문구가 없다.</p>
    <ul v-else class="bullets">
      <li v-for="(c, i) in caveats" :key="i" data-testid="caveat">{{ c }}</li>
    </ul>
  </section>
</template>
