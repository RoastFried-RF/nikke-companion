<script setup lang="ts">
// 덱 빌더의 「상대」: 이상 개체 보스 5종 · 계산 도구에 든 솔로 레이드 보스 · 속성만 정하기(약점 속성 다섯 + 속성 없음).
// 고르기만 한다 — 고른 상대를 전투 조건으로 바꾸는 것은 루트의 순수 함수(src/core/deck.mjs의 resolveOpponent)다.
// 고른 상대의 표시(약점·속성 상성 미반영·미확인 값 N칸·검증용)는 요격전 화면과 같은 배지다(접힌 구획 밖).
import { computed } from 'vue';
import { OPPONENT_GROUPS } from '../lib/deck';
import type { DeckOpponent, OpponentOption } from '../types';
import ElementChip from '../ui/ElementChip.vue';
import StatusPill from '../ui/StatusPill.vue';

const props = withDefaults(
  defineProps<{
    options: OpponentOption[];
    /** 고른 상대의 열쇠. */
    modelValue: string | null;
    /** 고른 상대(전투 조건과 표시). 아직 정하지 못했으면 null. */
    opponent: DeckOpponent | null;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

defineEmits<{ 'update:modelValue': [key: string] }>();

const KINDS = ['boss', 'preset', 'element'] as const;
const groups = computed(() =>
  KINDS.map((kind) => ({ kind, label: OPPONENT_GROUPS[kind], items: props.options.filter((o) => o.kind === kind) })).filter((g) => g.items.length > 0),
);
</script>

<template>
  <section class="nk-card" aria-label="상대" data-testid="deck-opponent">
    <div v-for="g in groups" :key="g.kind" class="opp__group" :data-kind="g.kind" data-testid="opponent-group">
      <span class="opp__label">{{ g.label }}</span>
      <div class="nk-seg" role="radiogroup" :aria-label="g.label">
        <button
          v-for="o in g.items"
          :key="o.key"
          type="button"
          role="radio"
          class="nk-seg__item"
          :class="{ 'nk-seg__item--on': modelValue === o.key }"
          :aria-checked="modelValue === o.key"
          :disabled="disabled"
          :data-key="o.key"
          :data-element="o.weak_to ?? undefined"
          data-testid="opponent-option"
          @click="$emit('update:modelValue', o.key)"
        >
          {{ o.label }}
          <span v-if="o.kind === 'boss' && o.weak_to" class="nk-seg__sub">약점 {{ o.weak_to }}</span>
        </button>
      </div>
    </div>

    <div v-if="opponent" class="nk-row" data-testid="opponent-chosen">
      <strong data-testid="opponent-name">상대 {{ opponent.label }}</strong>
      <ElementChip v-if="opponent.element.known && opponent.element.weak_to" :element="opponent.element.weak_to" label="약점" />
      <span v-else-if="!opponent.element.known" class="nk-muted" data-testid="opponent-element-unknown">약점 속성은 이 화면이 알지 못한다</span>
      <!-- 눈에 띄어야 하는 표시: 속성 상성 미반영, 미확인 값(기본값으로 계산하는 칸), 검증용 — 요격전 화면과 같다. 접지 않는다. -->
      <StatusPill v-for="flag in opponent.flags" :key="flag" :label="flag" tone="unknown" solid data-testid="opponent-flag" />
      <StatusPill
        v-if="opponent.unconfirmed.length"
        :label="`미확인 값 ${opponent.unconfirmed.length}칸`"
        tone="unknown"
        detail="게임 화면에서 확인하지 못한 값이다. 기본값으로 계산했다 — 확정값이 아니다."
        data-testid="opponent-unconfirmed"
      />
      <StatusPill v-if="opponent.is_test_data" label="검증용 보스 정보" tone="test" solid data-testid="opponent-test" />
    </div>
    <p v-else class="nk-muted" data-testid="opponent-none">상대를 고른다 — 보스를 고르거나, 약점 속성만 정해도 된다.</p>
  </section>
</template>

<style scoped>
.opp__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.opp__label {
  flex: none;
  min-width: calc(var(--nk-tile-lg) + var(--nk-space-3));
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
  font-weight: var(--nk-weight-bold);
}
</style>
