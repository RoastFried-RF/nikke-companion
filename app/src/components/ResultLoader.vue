<script setup lang="ts">
// 결과 파일 불러오기 한 줄: 경로 칸(+ 고르기)과 `불러오기`. 읽기와 검사는 부모가 한다(lib/resultFile.ts).
import PathField from './PathField.vue';

defineProps<{
  /** 고르기 창의 제목과 입력란의 안내 글. */
  title: string;
  placeholder: string;
  loading?: boolean;
  disabled?: boolean;
}>();

const path = defineModel<string>({ required: true });

defineEmits<{ load: []; fail: [message: string] }>();
</script>

<template>
  <div class="loader">
    <PathField
      v-model="path"
      class="loader__field"
      name="result"
      label="결과"
      :title="title"
      :placeholder="placeholder"
      :disabled="disabled"
      @enter="$emit('load')"
      @fail="(message) => $emit('fail', message)"
    />
    <button class="panel__button" type="button" :disabled="loading || disabled" data-testid="load-result" @click="$emit('load')">
      {{ loading ? '읽는 중…' : '불러오기' }}
    </button>
  </div>
</template>

<style scoped>
.loader {
  display: flex;
  align-items: center;
  gap: 6px;
}

.loader__field {
  flex: 1;
  min-width: 0;
}
</style>
