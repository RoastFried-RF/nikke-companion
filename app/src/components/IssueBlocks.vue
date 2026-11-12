<script setup lang="ts">
// 순위에 없는 항목: 시뮬 전에 걸러진 것(사유)과 엔진이 계산하지 못한 것(오류 내용·위치).
// 비교·요격전은 편성, 성장 비교는 업그레이드 후보다. 없으면 그 구역을 그리지 않는다.
defineProps<{
  rejected: { name: string; reasons?: string[]; members?: string[] }[];
  failed: { name: string; members?: string[]; error?: { message?: string; path?: string | null } }[];
  /** 「계산하지 않은 …」에 들어가는 낱말. */
  noun: string;
}>();
</script>

<template>
  <section v-if="rejected.length" class="block" data-testid="rejected">
    <h2 class="block__title">계산하지 않은 {{ noun }}</h2>
    <ul class="issues">
      <li v-for="(r, i) in rejected" :key="i" data-testid="rejected-entry">
        <div class="issues__name">{{ r.name }}</div>
        <div class="issues__reason" data-testid="rejected-reason">{{ (r.reasons ?? []).join(' / ') }}</div>
        <div v-if="(r.members ?? []).length" class="issues__members">{{ r.members?.join(', ') }}</div>
      </li>
    </ul>
  </section>

  <section v-if="failed.length" class="block block--failed" data-testid="failed">
    <h2 class="block__title">엔진이 계산하지 못한 {{ noun }}</h2>
    <ul class="issues">
      <li v-for="(f, i) in failed" :key="i" data-testid="failed-entry">
        <div class="issues__name">{{ f.name }}</div>
        <div class="issues__reason" data-testid="failed-reason">
          {{ f.error?.message ?? '오류 내용 없음' }}<template v-if="f.error?.path"> ({{ f.error.path }})</template>
        </div>
        <div v-if="(f.members ?? []).length" class="issues__members">{{ f.members?.join(', ') }}</div>
      </li>
    </ul>
  </section>
</template>
