<script setup lang="ts">
// 오버레이 위젯(P-028 — docs/ui-redesign.md §4b): 게임 위에 뜨는 작은 조각. 결과만 보여 준다 — 입력 칸·계산 단추·설정이 없다.
//
// 모양 셋:
//   접힘(알약)   보스 얼굴 · 이름 · 총딜 · 「추정」
//   한 줄 카드   보스 얼굴(44) · 이름 · 「약점 ○○」 · 총딜 · 「추정」 · 작은 초상화 다섯(버스트 배지, 약점 속성 니케는 속성 색 테두리)
//               + 어느 계정·언제의 결과인지 한 줄
//   펼침         한 줄 카드 + 한 줄 요약 + 눈에 띄어야 하는 표시(미확인 값·속성 상성 미반영·검증용) + 자리 순서 + 2·3위 + 보스 고르기 + 단축키
// 보여 줄 결과가 없으면(계정 없음·아직 계산 안 함·보고 있는 보스가 결과에 없음) 한 줄로 알리고 「앱 열기」만 둔다.
// 앱 창에서 계산이 돌고 있으면 진행을 작게 보인다. 이 그림은 받은 값을 그릴 뿐이다 — 계산하지 않고 Rust를 부르지 않는다.
// 「추정」 표시는 어느 모양에서나 보인다(줄이되 없애지 않는다).
import { estimateRemaining } from '@core/eta.mjs';
import { computed } from 'vue';
import { bestOf, bestTotal, unconfirmedOf } from '../lib/bossView';
import { damageUnit, localTime, percent } from '../lib/format';
import { WIDGET_SHORTCUTS } from '../lib/widget';
import type { ComputeActivity, InterceptBoss, InterceptReport, NikkeInfo, OverlayShape } from '../types';
import ElementChip from '../ui/ElementChip.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import RankRow from '../ui/RankRow.vue';
import StatusPill from '../ui/StatusPill.vue';
import BossFace from './BossFace.vue';

const props = withDefaults(
  defineProps<{
    shape: OverlayShape;
    /** 처음 읽기(저장해 둔 결과)가 끝났는가. 그 전에는 「없다」고 단정하지 않는다. */
    ready: boolean;
    /** 마지막 요격전 추천 결과. 없으면 null. */
    report: InterceptReport | null;
    /** 보여 줄 보스(결과 안의 것). 없으면 null. */
    boss: InterceptBoss | null;
    /** 게임에서 보고 있지만 결과에 없는 보스. */
    missing?: { id: string; name: string; element?: string | null } | null;
    /** 연결된 계정의 이름. 없으면 null(결과가 없을 때 계정부터 연결하라고 알린다). */
    accountName?: string | null;
    /** 결과를 저장한 시각(ISO). 모르면 결과에 적힌 계산 시각을 쓴다. */
    savedAt?: string | null;
    /** 니케 정보(속성·버스트 단계)를 주는 함수. */
    info: (name: string) => NikkeInfo;
    /** 이 보스의 약점 속성인 니케의 이름. */
    weak?: string[];
    /** 한 줄 요약. */
    summary?: string;
    /** 앱 창이 알린 계산 진행. */
    activity?: ComputeActivity | null;
    pinned?: boolean;
    clickThrough?: boolean;
    /** 알릴 문제(결과를 읽지 못했다·앱 창을 열지 못했다 등). */
    problems?: string[];
  }>(),
  { missing: null, accountName: null, savedAt: null, weak: () => [], summary: '', activity: null, pinned: false, clickThrough: false, problems: () => [] },
);

const emit = defineEmits<{
  /** 모양을 바꾼다('next'면 다음 모양). */
  shape: [shape: OverlayShape | 'next'];
  pin: [pinned: boolean];
  'open-app': [];
  hide: [];
  /** 보스를 고른다(펼침 모양의 보스 고르기). */
  pick: [id: string];
}>();

const running = computed(() => props.activity?.running === true);

/**
 * 무엇을 그릴까: 읽는 중 / 결과 / 보고 있는 보스가 결과에 없다 / 결과가 없다(계산 중·계정 없음·아직 계산 안 함).
 * 계산하지 않은 보스(결과에는 있지만 총딜이 없다)는 「결과에 없다」와 같이 알린다.
 */
const kind = computed<'loading' | 'result' | 'missing' | 'computing' | 'no-account' | 'empty'>(() => {
  if (!props.ready) return 'loading';
  if (props.missing) return 'missing';
  if (props.boss) return props.boss.status === 'computed' && bestOf(props.boss) ? 'result' : 'missing';
  if (running.value) return 'computing';
  return props.accountName ? 'empty' : 'no-account';
});

/** 결과가 없는 보스(이름을 알릴 것). */
const absent = computed(() => props.missing ?? (props.boss ? { id: props.boss.id, name: props.boss.name, element: props.boss.element?.code ?? null } : null));

const notice = computed(() => {
  switch (kind.value) {
    case 'loading':
      return '저장해 둔 추천을 읽는 중';
    case 'missing':
      return running.value ? `${absent.value?.name} — 앱에서 추천을 계산하는 중` : `${absent.value?.name} 추천이 아직 없다 — 앱에서 계산한다`;
    case 'computing':
      return '앱에서 추천을 계산하는 중';
    case 'no-account':
      return '연결된 계정이 없다 — 앱에서 계정을 연결한다';
    default:
      return '아직 요격전 추천이 없다 — 앱에서 계산한다';
  }
});

const best = computed(() => bestOf(props.boss));
const members = computed(() => best.value?.members ?? []);
const total = computed(() => {
  const n = bestTotal(props.boss);
  return n === null ? '계산 전' : damageUnit(n);
});
/** 2·3위(펼침). */
const others = computed(() => (props.boss?.ranking ?? []).filter((e) => e !== best.value && e.rank <= 3).slice(0, 2));
const isWeak = (name: string) => props.weak.includes(name);

const unconfirmed = computed(() => unconfirmedOf(props.boss));
const flags = computed(() => props.boss?.flags ?? []);
/** 눈에 띄어야 하는 표시의 수(한 줄 카드의 짧은 배지). */
const cautions = computed(() => unconfirmed.value.length + flags.value.length);

/** 검증용인지 실제 계정인지. 결과가 밝히지 않았으면 모른다고 표시한다(실제 계정으로 단정하지 않는다). */
const dataKind = computed(() => {
  const flag = props.report?.account?.is_test_data;
  if (flag === true) return { tone: 'test' as const, label: '검증용 데이터' };
  if (flag === false) return null;
  return { tone: 'unknown' as const, label: '데이터 구분 미확인' };
});

/** 어느 계정·언제의 결과인가. */
const source = computed(() => {
  const name = props.report?.account?.name ?? '(이름 없음)';
  const time = localTime(props.savedAt ?? props.report?.generated_at);
  return time ? `${name} · ${time} 계산` : name;
});

const eta = computed(() => {
  const a = props.activity;
  return estimateRemaining({ done: a?.done ?? 0, total: a?.total ?? 0, elapsedMs: a?.elapsed_ms ?? 0 });
});
const progressKnown = computed(() => (props.activity?.total ?? 0) > 0);
const progressRatio = computed(() => {
  const a = props.activity;
  return a && a.total > 0 ? Math.min(1, Math.max(0, a.done / a.total)) : 0;
});
const progressText = computed(() => {
  const label = props.activity?.label ? `${props.activity.label} · ` : '';
  return `${label}${eta.value.text}`;
});

/** 알약의 풍선 도움말: 접힌 동안 보이지 않는 것(계정·시각·주의할 표시)을 여기에 적는다. */
const pillTitle = computed(() => {
  const parts = [`${props.boss?.name ?? ''} — 총딜 ${total.value}(추정)`, source.value];
  if (dataKind.value) parts.push(dataKind.value.label);
  if (cautions.value) parts.push(`확인할 표시 ${cautions.value}개 — 펼치면 보인다`);
  parts.push('누르면 한 줄 카드로 편다(Alt+Shift+M)');
  return parts.join('\n');
});
</script>

<template>
  <div
    class="widget"
    :class="[`widget--${shape}`, `widget--${kind}`, { 'widget--passthrough': clickThrough }]"
    :data-shape="shape"
    :data-state="kind"
    data-testid="widget"
  >
    <!-- ── 결과가 없다: 한 줄로 알리고 「앱 열기」만 둔다(모양과 무관하게 한 줄이다) ── -->
    <div v-if="kind !== 'result'" class="notice" role="status" :data-kind="kind" data-testid="widget-notice">
      <span class="grip" data-tauri-drag-region title="끌어서 옮긴다" data-testid="widget-grip"></span>
      <BossFace v-if="kind === 'missing' && absent" :id="absent.id" :name="absent.name" :element="absent.element ?? null" size="sm" />
      <span class="notice__text" :title="notice" data-testid="widget-notice-text">{{ notice }}</span>
      <span v-if="running" class="busy busy--inline" :title="progressText" data-testid="widget-activity">
        <span class="busy__track" :class="{ 'busy__track--waiting': !progressKnown }" role="progressbar" aria-label="계산 진행">
          <span class="busy__fill" :style="{ width: `${progressRatio * 100}%` }" data-testid="widget-activity-fill"></span>
        </span>
        <span class="busy__eta" data-testid="widget-activity-eta">{{ eta.text }}</span>
      </span>
      <button v-if="kind !== 'loading'" type="button" class="tool tool--text" title="계산과 설정은 앱 창에서 한다" data-testid="open-app" @click="emit('open-app')">앱 열기</button>
      <button type="button" class="tool" title="오버레이 숨기기(Alt+Shift+O로 다시 띄운다)" aria-label="오버레이 숨기기" data-testid="widget-hide" @click="emit('hide')">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>

    <!-- ── 접힘(알약): 보스 얼굴·이름·총딜 ── -->
    <div v-else-if="shape === 'collapsed' && boss" class="capsule" data-testid="widget-pill">
      <span class="grip" data-tauri-drag-region title="끌어서 옮긴다" data-testid="widget-grip"></span>
      <button type="button" class="capsule__body" :title="pillTitle" data-testid="widget-open" @click="emit('shape', 'card')">
        <BossFace :id="boss.id" :name="boss.name" :element="boss.element?.code ?? null" size="sm" />
        <span class="capsule__name" data-testid="widget-boss">{{ boss.name }}</span>
        <span class="capsule__total" data-testid="widget-total">{{ total }}</span>
      </button>
      <StatusPill label="추정" tone="estimate" detail="수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
      <StatusPill v-if="running" label="계산 중" tone="accent" :detail="progressText" data-testid="widget-activity" />
      <StatusPill v-if="problems.length" label="문제 있음" tone="error" :detail="problems.join('\n')" data-testid="widget-error" />
      <StatusPill v-if="clickThrough" label="클릭 통과 · Alt+Shift+C" tone="unknown" detail="마우스 입력이 게임으로 간다. Alt+Shift+C로 끈다." data-testid="click-through-on" />
    </div>

    <!-- ── 한 줄 카드(펼침의 윗줄이기도 하다) ── -->
    <template v-else-if="boss">
      <div class="card" data-testid="widget-card">
        <span class="grip" data-tauri-drag-region title="끌어서 옮긴다" data-testid="widget-grip"></span>
        <button
          type="button"
          class="card__boss"
          :title="shape === 'card' ? '누르면 펼친다(Alt+Shift+M)' : '누르면 한 줄 카드로 줄인다(Alt+Shift+M)'"
          data-testid="widget-toggle"
          @click="emit('shape', shape === 'card' ? 'expanded' : 'card')"
        >
          <BossFace :id="boss.id" :name="boss.name" :element="boss.element?.code ?? null" />
          <span class="card__text">
            <span class="card__name" :title="boss.name" data-testid="widget-boss">{{ boss.name }}</span>
            <ElementChip :element="boss.element?.weak_to ?? null" label="약점" />
          </span>
        </button>
        <span class="card__score">
          <span class="card__total" title="1위 편성의 총딜" data-testid="widget-total">{{ total }}</span>
          <StatusPill label="추정" tone="estimate" solid detail="수치는 계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." data-testid="estimate-pill" />
        </span>
        <span class="card__squad" aria-label="1위 편성" data-testid="widget-squad">
          <span
            v-for="m in members"
            :key="m.name"
            class="card__member"
            :title="`${m.name} — ${damageUnit(m.damage)} (${percent(m.share)})`"
            :data-weak="isWeak(m.name) ? 'yes' : 'no'"
            data-testid="widget-member"
          >
            <NikkeTile :name="m.name" size="mini" :element="info(m.name).element" :burst="info(m.name).burst" :weak="isWeak(m.name)" />
          </span>
        </span>
      </div>

      <!-- 어느 계정·언제의 결과인지, 줄인 표시들, 그리고 단추 셋(고정·접기·숨기기). -->
      <div class="caption" data-testid="widget-meta">
        <span class="caption__source" :title="source" data-testid="widget-source">{{ source }}</span>
        <StatusPill v-if="dataKind" :label="dataKind.label" :tone="dataKind.tone" data-testid="data-kind" />
        <StatusPill
          v-if="shape === 'card' && cautions"
          :label="`확인할 표시 ${cautions}개`"
          tone="unknown"
          detail="확인하지 못한 값이나 반영하지 못한 것이 있다 — 펼치면 보인다."
          data-testid="widget-cautions"
        />
        <!-- 클릭 통과 중에는 풍선 도움말을 볼 수 없다(마우스가 지나간다) — 끄는 단축키를 글자로 적는다. -->
        <StatusPill v-if="clickThrough" label="클릭 통과 중 · Alt+Shift+C" tone="unknown" detail="마우스 입력이 게임으로 간다. Alt+Shift+C로 끈다." data-testid="click-through-on" />
        <span class="caption__tools">
          <button
            type="button"
            class="tool"
            :class="{ 'tool--on': pinned }"
            :title="pinned ? '고정됨 — 이상 개체 화면을 떠나도 그대로 둔다(누르면 푼다)' : '고정 — 이상 개체 화면을 떠나도 접거나 숨기지 않는다'"
            :aria-pressed="pinned"
            aria-label="고정"
            data-testid="widget-pin"
            @click="emit('pin', !pinned)"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 2h4l-1 5 2 2H5l2-2-1-5zM8 9v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="tool" title="알약으로 접는다(Alt+Shift+M으로 모양을 바꾼다)" aria-label="접기" data-testid="widget-collapse" @click="emit('shape', 'collapsed')">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
          <button type="button" class="tool" title="오버레이 숨기기(Alt+Shift+O로 다시 띄운다)" aria-label="오버레이 숨기기" data-testid="widget-hide" @click="emit('hide')">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
        </span>
      </div>

      <div v-if="running" class="busy" role="status" :title="progressText" data-testid="widget-activity">
        <span class="busy__label">앱에서 다시 계산하는 중</span>
        <span class="busy__track" :class="{ 'busy__track--waiting': !progressKnown }" role="progressbar" aria-label="계산 진행">
          <span class="busy__fill" :style="{ width: `${progressRatio * 100}%` }" data-testid="widget-activity-fill"></span>
        </span>
        <span class="busy__eta" data-testid="widget-activity-eta">{{ eta.text }}</span>
      </div>

      <!-- ── 펼침: 한 줄 요약, 눈에 띄어야 하는 표시, 자리 순서, 2·3위, 보스 고르기, 단축키 ── -->
      <div v-if="shape === 'expanded'" class="more" data-testid="widget-more">
        <p class="more__summary" data-testid="boss-summary">{{ summary }}</p>

        <div v-if="flags.length || unconfirmed.length || report?.bundle?.is_test_data" class="more__flags" data-testid="widget-flags">
          <StatusPill v-for="flag in flags" :key="flag" :label="flag" tone="unknown" solid data-testid="boss-flag" />
          <StatusPill
            v-if="unconfirmed.length"
            :label="`미확인 값 ${unconfirmed.length}칸`"
            tone="unknown"
            :detail="unconfirmed.map((u) => `${u.label}: ${u.text}`).join('\n')"
            data-testid="boss-unconfirmed"
          />
          <StatusPill v-if="report?.bundle?.is_test_data" label="검증용 보스 정보" tone="test" solid data-testid="bundle-kind" />
        </div>

        <div class="more__block" aria-label="자리 순서">
          <p class="more__label">자리 순서 — 편성 칸에 1번부터 이 순서로 놓는다(순서가 바뀌면 총딜이 달라진다)</p>
          <div class="more__seats" data-testid="widget-seats">
            <div v-for="(m, i) in members" :key="m.name" class="seat" :data-weak="isWeak(m.name) ? 'yes' : 'no'" data-testid="widget-seat">
              <span class="seat__no" data-testid="widget-seat-no">{{ i + 1 }}</span>
              <NikkeTile :name="m.name" size="sm" :element="info(m.name).element" :burst="info(m.name).burst" :weak="isWeak(m.name)" :share="m.share ?? null" />
            </div>
          </div>
        </div>

        <div v-if="others.length" class="more__ranks" data-testid="widget-ranks">
          <RankRow
            v-for="e in others"
            :key="`${e.rank}-${e.name}`"
            :rank="e.rank"
            :members="(e.members ?? []).map((m) => ({ name: m.name, element: info(m.name).element, weak: isWeak(m.name) }))"
            :total-damage="e.total_damage"
            :relative="e.relative_to_best"
          />
        </div>

        <div v-if="(report?.bosses ?? []).length > 1" class="more__bosses" role="group" aria-label="보스 고르기" data-testid="widget-bosses">
          <button
            v-for="b in report?.bosses ?? []"
            :key="b.id"
            type="button"
            class="pick"
            :class="{ 'pick--on': b.id === boss.id }"
            :title="`${b.name} — ${bestTotal(b) === null ? '계산 전' : `총딜 ${damageUnit(bestTotal(b))}`}`"
            :aria-pressed="b.id === boss.id"
            :data-boss="b.id"
            data-testid="widget-boss-pick"
            @click="emit('pick', b.id)"
          >
            <BossFace :id="b.id" :name="b.name" :element="b.element?.code ?? null" size="sm" />
          </button>
          <span class="more__spacer"></span>
          <button type="button" class="tool tool--text" title="계산과 설정은 앱 창에서 한다" data-testid="open-app" @click="emit('open-app')">앱 열기</button>
        </div>

        <p class="more__keys" data-testid="widget-shortcuts">
          <span v-for="s in WIDGET_SHORTCUTS" :key="s.keys" class="more__key" data-testid="widget-shortcut"><kbd>{{ s.keys }}</kbd> {{ s.what }}</span>
        </p>
      </div>

      <p v-for="(problem, i) in problems" :key="i" class="alert" role="alert" data-testid="widget-error">{{ problem }}</p>
    </template>

    <template v-if="kind !== 'result'">
      <p v-for="(problem, i) in problems" :key="i" class="alert" role="alert" data-testid="widget-error">{{ problem }}</p>
      <p v-if="clickThrough" class="alert alert--note" role="status" data-testid="click-through-on">클릭 통과 중 — 마우스 입력이 게임으로 간다. Alt+Shift+C로 끈다.</p>
    </template>
  </div>
</template>

<style scoped>
/* 정보 영역은 불투명하다 — 게임 화면이 비쳐 글자가 묻히지 않게(docs/ui-redesign.md §3). */
.widget {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  box-sizing: border-box;
  width: var(--nk-widget-width);
  padding: var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-border-strong);
  border-radius: var(--nk-radius-lg);
  background: var(--nk-surface);
  box-shadow: var(--nk-shadow-card);
  color: var(--nk-text);
  font-family: var(--nk-font-family);
  font-size: var(--nk-font-md);
  line-height: var(--nk-line-tight);
  user-select: none;
}

/* 접힌 알약과 한 줄 알림은 내용만큼만 넓다. */
.widget--collapsed.widget--result {
  width: max-content;
  max-width: var(--nk-widget-pill-max);
  padding: var(--nk-space-2) var(--nk-space-4) var(--nk-space-2) var(--nk-space-2);
  border-radius: var(--nk-radius-pill);
}

.widget--loading,
.widget--missing,
.widget--computing,
.widget--no-account,
.widget--empty {
  width: max-content;
  max-width: var(--nk-widget-width);
}

/* 클릭 통과 중: 테두리 색으로 알린다(글자로도 알린다 — 색만으로 알리지 않는다). */
.widget--passthrough {
  border-color: var(--nk-unknown);
}

/* 끌어서 옮기는 손잡이. */
.grip {
  flex: none;
  align-self: stretch;
  width: var(--nk-space-3);
  min-height: var(--nk-icon-md);
  border-radius: var(--nk-radius-sm);
  background: var(--nk-border-strong);
  opacity: 0.6;
  cursor: move;
}

.grip:hover {
  opacity: 1;
}

/* 이름을 고를 때: 예전 전역 스타일(style.css의 .meta 등)과 부품의 뿌리(.pill·.chip·.tile)와 겹치지 않게 한다 —
   겹치면 그 규칙이 이 상자에도 걸린다. */
.notice,
.capsule,
.card,
.caption,
.busy {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
  min-width: 0;
}

.notice__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capsule__body,
.card__boss {
  display: flex;
  align-items: center;
  gap: var(--nk-space-3);
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.capsule__name,
.card__name {
  min-width: 0;
  overflow: hidden;
  font-weight: var(--nk-weight-heavy);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capsule__total,
.card__total {
  flex: none;
  font-weight: var(--nk-weight-heavy);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.card__boss {
  flex: 1;
  overflow: hidden;
}

.card__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--nk-space-2);
  min-width: 0;
  overflow: hidden;
}

.card__name {
  max-width: 100%;
  font-size: var(--nk-font-lg);
}

.card__score {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--nk-space-2);
}

.card__total {
  font-size: var(--nk-font-lg);
}

.card__squad {
  display: flex;
  flex: none;
  gap: var(--nk-space-2);
}

.card__member {
  display: inline-flex;
}

.caption__tools {
  display: flex;
  flex: none;
  gap: var(--nk-space-2);
  margin-left: auto;
}

.tool {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: var(--nk-space-1) var(--nk-space-2);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-sm);
  background: transparent;
  color: var(--nk-text-muted);
  font: inherit;
  font-size: var(--nk-font-sm);
  cursor: pointer;
}

.tool:hover {
  border-color: var(--nk-accent);
  color: var(--nk-text);
}

.tool--on {
  border-color: var(--nk-accent);
  background: var(--nk-accent-soft);
  color: var(--nk-text);
}

.tool--text {
  padding: var(--nk-space-1) var(--nk-space-3);
  white-space: nowrap;
}

.caption {
  flex-wrap: wrap;
  gap: var(--nk-space-2) var(--nk-space-3);
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
}

.caption__source {
  flex: 1;
  min-width: var(--nk-tile-lg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.busy {
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.busy--inline {
  display: inline-flex;
  flex: none;
}

.busy__label {
  flex: none;
}

.busy__track {
  flex: 1;
  min-width: var(--nk-tile-sm);
  height: var(--nk-bar-height-thin);
  border-radius: var(--nk-radius-pill);
  background: var(--nk-surface-sunken);
  overflow: hidden;
}

.busy__fill {
  display: block;
  height: 100%;
  border-radius: var(--nk-radius-pill);
  background: var(--nk-accent);
  transition: width var(--nk-duration) ease;
}

/* 전체를 아직 모른다: 막대를 옅게 채워 「도는 중」임을 알린다. */
.busy__track--waiting {
  background: var(--nk-accent-soft);
}

.busy__eta {
  flex: none;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.more {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding-top: var(--nk-space-3);
  border-top: var(--nk-border-width) solid var(--nk-border);
}

.more__summary {
  margin: 0;
  line-height: var(--nk-line-normal);
  overflow-wrap: anywhere;
}

.more__flags,
.more__bosses,
.more__keys {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-2) var(--nk-space-3);
}

.more__block {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
}

.more__label {
  margin: 0;
  color: var(--nk-text-muted);
  font-size: var(--nk-font-sm);
}

.more__seats {
  display: flex;
  gap: var(--nk-space-3);
}

.seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--nk-space-1);
}

.seat__no {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-xs);
  font-weight: var(--nk-weight-heavy);
}

.more__ranks {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
}

.more__spacer {
  flex: 1;
}

.pick {
  display: inline-flex;
  padding: var(--nk-space-1);
  border: var(--nk-border-width) solid transparent;
  border-radius: var(--nk-radius-pill);
  background: transparent;
  cursor: pointer;
}

.pick:hover,
.pick--on {
  border-color: var(--nk-accent);
}

.pick--on {
  background: var(--nk-accent-soft);
}

.more__keys {
  margin: 0;
  color: var(--nk-text-faint);
  font-size: var(--nk-font-xs);
}

.more__key kbd {
  padding: 0 var(--nk-space-2);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-sm);
  color: var(--nk-text-muted);
  font: inherit;
}

.alert {
  margin: 0;
  padding: var(--nk-space-2) var(--nk-space-3);
  border: var(--nk-border-width) solid var(--nk-error);
  border-radius: var(--nk-radius-sm);
  color: var(--nk-error);
  font-size: var(--nk-font-sm);
  overflow-wrap: anywhere;
}

.alert--note {
  border-color: var(--nk-unknown);
  color: var(--nk-unknown);
}
</style>
