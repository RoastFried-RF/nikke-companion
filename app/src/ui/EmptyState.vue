<script setup lang="ts">
// 빈 상태: 보여 줄 것이 없을 때 — 무슨 일인지 한마디, 무엇을 하면 되는지 한 줄, 그리고 단추 하나.
// 오류도 같은 모양이다(tone="error"): 무엇이 잘못됐는지와 다시 해 볼 단추 하나.
withDefaults(
  defineProps<{
    title: string;
    /** 무엇을 하면 되는지. */
    hint?: string;
    /** 단추의 글자. 주지 않으면 단추가 없다. */
    action?: string;
    tone?: 'neutral' | 'error';
    /** 단추를 누를 수 없는 동안(이미 하는 중). */
    busy?: boolean;
  }>(),
  { hint: '', action: '', tone: 'neutral', busy: false },
);

defineEmits<{ action: [] }>();
</script>

<template>
  <section class="empty" :class="`empty--${tone}`" :role="tone === 'error' ? 'alert' : undefined" :data-tone="tone" data-testid="empty-state">
    <p class="empty__title" data-testid="empty-title">{{ title }}</p>
    <p v-if="hint" class="empty__hint" data-testid="empty-hint">{{ hint }}</p>
    <button v-if="action" type="button" class="empty__action" :disabled="busy" data-testid="empty-action" @click="$emit('action')">{{ action }}</button>
  </section>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-6) var(--nk-space-5);
  border: var(--nk-border-width) dashed var(--nk-border-strong);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  text-align: center;
}

.empty--error {
  border-style: solid;
  border-color: var(--nk-error);
}

.empty__title {
  margin: 0;
  font-size: var(--nk-font-lg);
  font-weight: var(--nk-weight-bold);
  overflow-wrap: anywhere;
}

.empty--error .empty__title {
  color: var(--nk-error);
}

.empty__hint {
  margin: 0;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-md);
  line-height: var(--nk-line-normal);
  overflow-wrap: anywhere;
}

.empty__action {
  margin-top: var(--nk-space-2);
  padding: var(--nk-space-3) var(--nk-space-5);
  border: var(--nk-border-width) solid var(--nk-accent);
  border-radius: var(--nk-radius-md);
  background: var(--nk-accent);
  color: var(--nk-text-on-accent);
  font: inherit;
  font-weight: var(--nk-weight-bold);
  cursor: pointer;
}

.empty__action:hover:not(:disabled) {
  background: var(--nk-accent-strong);
  border-color: var(--nk-accent-strong);
}

.empty__action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
