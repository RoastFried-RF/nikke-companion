<script setup lang="ts">
// 파일 경로 한 칸: 이름표 + 경로 입력란 + `고르기`. 고르기 창은 Rust 명령 하나로만 연다(lib/backend.ts).
import { errorMessage, pickJsonFile } from '../lib/backend';

const props = defineProps<{
  /** 칸의 이름(testid에 쓴다: `<name>-path`, `pick-<name>`). */
  name: string;
  label: string;
  /** 고르기 창의 제목. */
  title: string;
  placeholder: string;
  disabled?: boolean;
}>();

const path = defineModel<string>({ required: true });

const emit = defineEmits<{
  /** 입력란에서 Enter를 눌렀다. */
  enter: [];
  /** 고르기 창을 열지 못했다(경로는 직접 넣을 수 있다). */
  fail: [message: string];
}>();

async function pick(): Promise<void> {
  try {
    const picked = await pickJsonFile(props.title);
    if (picked) path.value = picked;
  } catch (e) {
    emit('fail', `파일 고르기 창을 열지 못했다: ${errorMessage(e)}`);
  }
}
</script>

<template>
  <div class="field">
    <span class="field__label">{{ label }}</span>
    <input
      v-model="path"
      class="field__path"
      type="text"
      spellcheck="false"
      autocomplete="off"
      :placeholder="placeholder"
      :aria-label="placeholder"
      :disabled="disabled"
      :data-testid="`${name}-path`"
      @keydown.enter.prevent="emit('enter')"
    />
    <button class="field__pick" type="button" :title="title" :disabled="disabled" :data-testid="`pick-${name}`" @click="pick">
      고르기
    </button>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.field__label {
  min-width: 28px;
  color: var(--muted);
  white-space: nowrap;
}

.field__path {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
}

.field__pick {
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.field__pick:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
