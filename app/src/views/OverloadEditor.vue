<script setup lang="ts">
// 오버로드 옵션 고르기(P-031): 장비 부위 넷 × 옵션 줄 셋. 줄마다 옵션(계산 도구가 받는 9종 또는 빈 줄)과 줄 레벨을 고른다.
// 고르기만 한다 — 계정을 바꾸지 않고, 계산은 이 값을 받은 화면이 맡긴다(src/core/efficiency.mjs의 tryOverload).
import { DEFAULT_LINE_LEVEL, OPTIONS, OVERLOAD_LEVEL_MAX } from '../lib/efficiency';
import type { OverloadPart } from '../types';

const props = withDefaults(defineProps<{ parts: OverloadPart[]; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ 'update:parts': [parts: OverloadPart[]] }>();

const LEVELS = Array.from({ length: OVERLOAD_LEVEL_MAX }, (_, i) => i + 1);

/** 한 줄을 바꾼 새 부위 목록을 올려 보낸다(받은 것은 고치지 않는다). */
function change(partIndex: number, lineIndex: number, next: { id: string; level: number } | null): void {
  emit(
    'update:parts',
    props.parts.map((p, i) => (i === partIndex ? { part: p.part, lines: p.lines.map((line, j) => (j === lineIndex ? next : line)) } : p)),
  );
}

function onOption(partIndex: number, lineIndex: number, event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  const now = props.parts[partIndex].lines[lineIndex];
  change(partIndex, lineIndex, id === '' ? null : { id, level: now?.level ?? DEFAULT_LINE_LEVEL });
}

function onLevel(partIndex: number, lineIndex: number, event: Event): void {
  const now = props.parts[partIndex].lines[lineIndex];
  if (now) change(partIndex, lineIndex, { id: now.id, level: Number((event.target as HTMLSelectElement).value) });
}
</script>

<template>
  <div class="ol" data-testid="ol-editor">
    <fieldset v-for="(p, pi) in parts" :key="p.part" class="ol__part" :data-part="p.part" :disabled="disabled" data-testid="ol-part">
      <legend class="ol__name">{{ p.part }}</legend>
      <div v-for="(line, li) in p.lines" :key="li" class="ol__line" :data-filled="line ? 'yes' : 'no'" data-testid="ol-line">
        <select class="nk-input ol__option" :value="line?.id ?? ''" :aria-label="`${p.part} ${li + 1}번째 줄의 옵션`" data-testid="ol-option" @change="onOption(pi, li, $event)">
          <option value="">빈 줄</option>
          <option v-for="o in OPTIONS" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <select class="nk-input ol__level" :value="line?.level ?? DEFAULT_LINE_LEVEL" :disabled="!line" :aria-label="`${p.part} ${li + 1}번째 줄의 레벨`" data-testid="ol-level" @change="onLevel(pi, li, $event)">
          <option v-for="lv in LEVELS" :key="lv" :value="lv">Lv.{{ lv }}</option>
        </select>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.ol {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--nk-tile-lg) * 2.4), 1fr));
  gap: var(--nk-space-4);
}

.ol__part {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  min-width: 0;
  margin: 0;
  padding: var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.ol__name {
  padding: 0 var(--nk-space-2);
  color: var(--nk-text-muted);
  font-weight: var(--nk-weight-bold);
}

.ol__line {
  display: flex;
  gap: var(--nk-space-2);
}

.ol__option {
  flex: 1;
  min-width: 0;
}

.ol__line[data-filled='no'] .ol__option {
  color: var(--nk-text-faint);
}
</style>
