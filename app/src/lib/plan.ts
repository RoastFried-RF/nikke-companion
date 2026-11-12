// 요격전 계획(P-029) — 화면 쪽: 계정마다 두는 요격전 기록·즐겨찾기의 상태와, 루트의 순수 함수(src/core/plan.mjs)를 화면의 값으로 잇는 곳.
//
// 계산은 전부 루트의 순수 모듈이 한다(장비 상태·주력 선정·보스 추천·기록 비교·속성 커버리지) — 여기에는 규칙이 없다.
// 디스크(계정 폴더의 `<계정>.plan.json`)에 두는 일은 Rust가 한다. 이 상태는 데스크톱 앱 창의 뿌리(App.vue)가 만들고,
// 기본 계정이 바뀌면 그 계정의 것을 다시 읽는다. 오버레이 창에는 없다(`usePlan()`이 null).
import {
  addRecord as coreAddRecord,
  bestSquad,
  elementCoverage,
  emptyPlan,
  gearRows,
  gearSummary,
  latestRecord as coreLatestRecord,
  parseDamage,
  pickCore,
  readPlan,
  recommendBoss,
  recordCheck as coreRecordCheck,
  recordsOf as coreRecordsOf,
  removeRecord as coreRemoveRecord,
  toggleFavorite as coreToggleFavorite,
} from '@core/plan.mjs';
import { inject, onBeforeUnmount, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue';
import type {
  AccountDoc,
  BossPick,
  CorePick,
  Coverage,
  GearRow,
  GearSummary,
  InterceptBoss,
  InterceptReport,
  NikkeInfo,
  PlanDoc,
  PlanRecord,
  RankingEntry,
  RecordCheck,
} from '../types';
import { errorMessage, loadPlan, savePlan } from './backend';
import { ANOMALY_BUNDLE } from './builtin';
import type { Shared } from './shared';

/** 기록 입력 칸의 값(화면이 넘긴다). 대미지는 사용자가 적은 글자 그대로다. */
export interface RecordInput {
  boss_id: string;
  boss_name: string;
  damage: string;
  mode: 'mock' | 'real';
  date: string;
  stage: string;
}

export interface PlanStore {
  /** 지금 쓰는 계정의 계획. 계정이 없거나 아직 적은 것이 없으면 빈 계획이다. */
  plan: Ref<PlanDoc>;
  /** 처음 읽기가 끝났는가. */
  ready: Ref<boolean>;
  /** 읽거나 저장하다 난 문제(한국어 문장). */
  problem: Ref<string>;
  reload(): Promise<void>;
  /** 기록을 하나 더하고 저장한다. 값이 맞지 않으면 이유를 한국어 문장으로 던진다(아무것도 바뀌지 않는다). */
  addRecord(input: RecordInput): Promise<void>;
  removeRecord(id: string): Promise<void>;
  toggleFavorite(name: string): Promise<void>;
}

const KEY: InjectionKey<PlanStore> = Symbol('plan');

const blank = (): PlanDoc => emptyPlan() as PlanDoc;

export function createPlanStore(shared: Shared): { store: PlanStore; stop: () => void } {
  // 문서를 통째로 갈아 끼운다(안쪽을 고치지 않는다) — 그래서 안쪽까지 지켜보지 않는다. Rust에 넘기는 것도 보통 객체다.
  const plan = shallowRef<PlanDoc>(blank());
  const ready = ref(false);
  const problem = ref('');
  /** 늦게 끝난 읽기가 나중 읽기를 덮지 않게 한다. */
  let seq = 0;

  async function reload(): Promise<void> {
    const mine = ++seq;
    if (!shared.accountName.value) {
      plan.value = blank();
      problem.value = '';
      ready.value = shared.ready.value;
      return;
    }
    try {
      const read = readPlan(await loadPlan(null));
      if (mine !== seq) return;
      plan.value = read.plan as PlanDoc;
      problem.value = read.dropped > 0 ? `읽을 수 없는 요격전 기록 ${read.dropped}건은 뺐다.` : '';
    } catch (e) {
      if (mine !== seq) return;
      plan.value = blank();
      problem.value = `요격전 기록을 읽지 못했다: ${errorMessage(e)}`;
    }
    ready.value = true;
  }

  /** 바꾼 계획을 보이고 저장한다. 저장하지 못하면 되돌리고 알린다. */
  async function commit(next: PlanDoc): Promise<void> {
    const before = plan.value;
    seq += 1; // 도는 읽기가 방금 바꾼 것을 덮지 않게 한다.
    plan.value = next;
    try {
      await savePlan(null, next);
      problem.value = '';
    } catch (e) {
      plan.value = before;
      problem.value = `요격전 기록을 저장하지 못했다: ${errorMessage(e)}`;
      throw new Error(problem.value);
    }
  }

  const store: PlanStore = {
    plan,
    ready,
    problem,
    reload,
    addRecord: async (input) => {
      const stage = input.stage.trim();
      const next = coreAddRecord(
        plan.value,
        {
          boss_id: input.boss_id,
          boss_name: input.boss_name,
          damage: parseDamage(input.damage),
          mode: input.mode,
          date: input.date,
          stage: stage === '' ? null : /^\d+$/.test(stage) ? Number(stage) : Number.NaN,
        },
        { now: new Date().toISOString() },
      ) as PlanDoc;
      await commit(next);
    },
    removeRecord: (id) => commit(coreRemoveRecord(plan.value, id) as PlanDoc),
    toggleFavorite: (name) => commit(coreToggleFavorite(plan.value, name) as PlanDoc),
  };

  // 기본 계정이 정해지거나 바뀌면 그 계정의 것을 읽는다.
  const stop = watch([shared.accountName, shared.ready], () => void reload(), { immediate: true });
  return { store, stop };
}

/** 데스크톱 앱 창의 뿌리(App.vue)가 부른다. */
export function providePlan(shared: Shared): PlanStore {
  const { store, stop } = createPlanStore(shared);
  provide(KEY, store);
  onBeforeUnmount(stop);
  return store;
}

/** 화면들이 부른다. 뿌리 밖에서(오버레이 창, 화면만 따로 띄운 테스트) 쓰이면 null. */
export function usePlan(): PlanStore | null {
  return inject(KEY, null);
}

// ── 루트의 순수 함수를 화면의 값으로 ──────────────────────────────────────────

type InfoOf = (name: string) => NikkeInfo;

/** 오늘의 날짜(이 PC의 시각) — 기록 입력 칸의 기본값. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 보스 목록: 추천 결과가 있으면 그 보스들, 없으면 앱에 내장한 보스 정보. */
export function planBosses(report: InterceptReport | null): Array<{ id: string; name: string; reward: string | null; weak_to: string | null }> {
  if (report?.bosses?.length) return report.bosses.map((b) => ({ id: b.id, name: b.name, reward: b.reward ?? null, weak_to: b.element?.weak_to ?? null }));
  const bundle = ANOMALY_BUNDLE as { bosses?: Array<{ id: string; name: string; reward?: string; weak_to?: string }> };
  return (bundle.bosses ?? []).map((b) => ({ id: b.id, name: b.name, reward: b.reward ?? null, weak_to: b.weak_to ?? null }));
}

export interface PlanView {
  core: CorePick;
  rows: GearRow[];
  /** 주력 니케의 장비 요약. */
  coreSummary: GearSummary;
  /** 보유 니케 전체의 장비 요약. */
  summary: GearSummary;
  pick: BossPick;
  coverage: Coverage;
}

/** 계정·추천 결과·계획에서 화면이 그릴 값 한 벌을 만든다(전부 루트의 순수 함수). */
export function planView(account: AccountDoc, report: InterceptReport | null, plan: PlanDoc, info: InfoOf): PlanView {
  const infoOf = (name: string) => {
    const i = info(name);
    return { element: i.element, klass: i.klass, corp: i.corp };
  };
  const bosses = planBosses(report);
  const rows = gearRows(account) as GearRow[];
  const core = pickCore({ report, favorites: plan.favorites, account }) as CorePick;
  const coreSet = new Set(core.names);
  return {
    core,
    rows,
    coreSummary: gearSummary(rows.filter((r) => coreSet.has(r.name)), { infoOf }) as GearSummary,
    summary: gearSummary(rows, { infoOf }) as GearSummary,
    pick: recommendBoss({ bosses, rows, core: core.names }) as BossPick,
    coverage: elementCoverage(account, { infoOf, bosses }) as Coverage,
  };
}

/** 한 보스의 기록(최근이 앞). */
export function recordsOf(plan: PlanDoc | null | undefined, bossId: string): PlanRecord[] {
  return plan ? (coreRecordsOf(plan, bossId) as PlanRecord[]) : [];
}

/** 한 보스의 가장 최근 기록. */
export function latestRecord(plan: PlanDoc | null | undefined, bossId: string): PlanRecord | null {
  return plan ? ((coreLatestRecord(plan, bossId) as PlanRecord | null) ?? null) : null;
}

/** 보스의 추정 총딜과 가장 최근 기록의 차이. 기록이나 추정이 없으면 null. */
export function recordCheck(boss: InterceptBoss | null | undefined, plan: PlanDoc | null | undefined): RecordCheck | null {
  return boss && plan ? ((coreRecordCheck(boss, plan) as RecordCheck | null) ?? null) : null;
}

/** 보스의 1위 편성. 계산하지 않았으면 null. */
export function bestOf(boss: InterceptBoss | null | undefined): RankingEntry | null {
  return (bestSquad(boss) as RankingEntry | null) ?? null;
}

/** 기록 한 줄의 말: 「9.40억 · 모의전 · 2026-11-12 · 달성 단계 4」의 재료. */
export const MODE_LABEL: Record<PlanRecord['mode'], string> = { mock: '모의전', real: '실전' };
