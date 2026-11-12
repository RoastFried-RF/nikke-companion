// 계산 실행(편성 추천·비교, 요격전 보스별 추천, 성장 투자 비교): 파일 읽기 → 루트의 계산 코드(src/core) → 결과 문서.
// 계산 규칙은 여기에 없다. suggestSquads·compareSquads·recommendIntercept·compareGrowth에 런타임을 넘겨 부를 뿐이다
// (CLI의 suggest·compare·intercept·growth와 같은 길).

import { withCache } from '@core/cache.mjs';
import { DEFAULT_BUDGET, DEFAULT_LIMIT, DEFAULT_TOP, suggestSquads } from '@core/candidates.mjs';
import { compareSquads, InputError } from '@core/compare.mjs';
import { compareOrders, evaluateDeck, swapOne } from '@core/deck.mjs';
import { compareCubes, efficiencyTable, tryOverload } from '@core/efficiency.mjs';
import { compareGrowth } from '@core/growth.mjs';
import { DEFAULT_INTERCEPT_BUDGET, DEFAULT_INTERCEPT_TOP, recommendIntercept } from '@core/intercept.mjs';
import type {
  BossProgress,
  CompareReport,
  CubeReport,
  DeckOpponent,
  DeckOrderReport,
  DeckReport,
  DeckSwapReport,
  EfficiencyReport,
  EngineRuntime,
  GrowthReport,
  InterceptReport,
  OverloadPart,
  OverloadTrialReport,
  SearchStage,
  SimCacheStore,
} from '../types';
import { errorMessage, readJsonFile } from './backend';
import { simCache, tauriRuntime } from './runtime';

export { DEFAULT_BUDGET, DEFAULT_INTERCEPT_BUDGET, DEFAULT_INTERCEPT_TOP, DEFAULT_LIMIT, DEFAULT_TOP };

/** 계산에 필요한 바깥 일. 테스트에서 가짜로 바꿔 끼운다. */
export interface ComputeDeps {
  /** 엔진 실행·카탈로그·버전. 기본은 Rust 명령을 부르는 tauriRuntime. */
  runtime: EngineRuntime;
  /** JSON 파일 읽기. 기본은 Rust 명령 read_json_file. */
  readJson: (path: string) => Promise<unknown>;
  /**
   * 시뮬 결과 캐시의 저장소. 주면 런타임을 캐시로 감싸(같은 엔진 판·같은 요청은 엔진에 보내지 않는다) 결과에
   * `cache` 통계가 실린다. 주지 않으면 캐시 없이 계산한다(결과의 `cache`는 null). 기본은 메모리 저장소다.
   */
  cache?: SimCacheStore | null;
  /**
   * 추천이 엔진 배치를 맡기기 직전에 부른다(1단계 멤버 조합, 2단계 배치 변형) — 진행 표시용.
   * 계산 코드의 `deps.onStage`로 그대로 넘긴다.
   */
  onStage?: (stage: SearchStage) => void;
  /** 요격전 추천이 보스 하나의 계산을 시작하기 직전에 부른다 — 진행 표시용. 계산 코드의 `deps.onBoss`로 그대로 넘긴다. */
  onBoss?: (boss: BossProgress) => void;
  now?: () => Date;
}

export const defaultDeps: ComputeDeps = { runtime: tauriRuntime, readJson: readJsonFile, cache: simCache };

export interface SuggestInput {
  accountPath: string;
  conditionPath: string;
  /** 계산할 후보 편성 수. 주지 않으면 계산 코드의 기본값. */
  limit?: number;
  /** 표시할 상위 편성 수. 주지 않으면 계산 코드의 기본값. */
  top?: number;
  /** 상위 조합의 배치 순서도 탐색하나(2단계). 주지 않으면 계산 코드의 기본값(켬). */
  refine?: boolean;
  /** 전체 시뮬 횟수의 상한(1단계 + 2단계). 주지 않으면 계산 코드의 기본값. */
  budget?: number;
}

export interface CompareInput {
  accountPath: string;
  conditionPath: string;
  squadsPath: string;
}

/** 화면에 그대로 보일 수 있는 문장을 가진 오류. */
export class ComputeError extends Error {}

async function readInput(deps: ComputeDeps, label: string, path: string): Promise<unknown> {
  const target = path.trim();
  if (!target) throw new ComputeError(`${label} 파일 경로를 넣어야 한다.`);
  try {
    return await deps.readJson(target);
  } catch (e) {
    throw new ComputeError(`${label} 파일 — ${errorMessage(e)}`);
  }
}

/** 계산 코드가 던진 것을 화면 문장으로. CLI의 "입력 오류 — …" / "실행 오류 — …"와 같은 구분이다. */
function asComputeError(e: unknown): ComputeError {
  if (e instanceof ComputeError) return e;
  if (e instanceof InputError) return new ComputeError(`입력 오류 — ${e.message}`);
  return new ComputeError(`실행 오류 — ${errorMessage(e)}`);
}

function coreDeps(deps: ComputeDeps): object {
  // 캐시는 주어진 런타임의 바깥을 감싼다 — 런타임의 runBatch는 저장소에 없던 요청만 받는다(진행 건수도 그 수다).
  const runtime = deps.cache ? withCache(deps.runtime, deps.cache) : deps.runtime;
  return {
    runtime,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.onStage ? { onStage: deps.onStage } : {}),
    ...(deps.onBoss ? { onBoss: deps.onBoss } : {}),
  };
}

/**
 * 계정 + 전투 조건 → 후보 편성 생성 → 엔진 비교(1단계) → 상위 조합의 배치 탐색(2단계) → 상위 편성.
 * CLI의 `suggest`와 같은 함수(`suggestSquads`)다 — 배치 변형 규칙과 시뮬 예산도 그 함수가 정한다.
 */
export async function runSuggest(input: SuggestInput, deps: ComputeDeps = defaultDeps): Promise<CompareReport> {
  try {
    const account = await readInput(deps, '계정', input.accountPath);
    const condition = await readInput(deps, '전투 조건', input.conditionPath);
    return await suggestWith({ account, condition, limit: input.limit, top: input.top, refine: input.refine, budget: input.budget }, deps);
  } catch (e) {
    throw asComputeError(e);
  }
}

/** 추천 계산의 선택 값(주지 않으면 계산 코드의 기본값). */
export interface SuggestOptions {
  limit?: number;
  top?: number;
  refine?: boolean;
  budget?: number;
}

async function suggestWith(input: { account: unknown; condition: unknown } & SuggestOptions, deps: ComputeDeps): Promise<CompareReport> {
  const report = await suggestSquads(
    { account: input.account as object, condition: input.condition as object },
    { limit: input.limit, top: input.top, refine: input.refine, budget: input.budget },
    coreDeps(deps),
  );
  return report as unknown as CompareReport;
}

/**
 * 이미 읽어 둔 계정과 전투 조건으로 추천을 계산한다 — 데스크톱 앱의 편성 도구가 쓴다(기본 계정 + 내장 조건, 파일 경로 없음).
 * `runSuggest`와 같은 함수(`suggestSquads`)를 부른다.
 */
export async function runSuggestWith(
  input: { account: unknown; condition: unknown } & SuggestOptions,
  deps: ComputeDeps = defaultDeps,
): Promise<CompareReport> {
  try {
    return await suggestWith(input, deps);
  } catch (e) {
    throw asComputeError(e);
  }
}

export interface InterceptInput {
  accountPath: string;
  /** 보스 묶음 파일(docs/data-model.md §보스 묶음). CLI의 `--bosses`. */
  bossesPath: string;
  /** 보스별 표시 수. 주지 않으면 계산 코드의 기본값. */
  top?: number;
  /** 전체 시뮬 횟수의 상한(보스 수로 나눈다). 주지 않으면 계산 코드의 기본값. */
  budget?: number;
}

/**
 * 계정 + 보스 묶음 → 보스마다 추천(멤버 조합 + 배치 탐색) → 보스별 상위 편성.
 * CLI의 `intercept`와 같은 함수(`recommendIntercept`)다 — 보스를 전투 조건으로 바꾸는 규칙, 예산 나누기,
 * 미확인 칸의 처리도 그 함수가 정한다.
 */
export async function runIntercept(input: InterceptInput, deps: ComputeDeps = defaultDeps): Promise<InterceptReport> {
  try {
    const account = await readInput(deps, '계정', input.accountPath);
    const bundle = await readInput(deps, '보스 묶음', input.bossesPath);
    return await interceptWith({ account, bundle, top: input.top, budget: input.budget }, deps);
  } catch (e) {
    throw asComputeError(e);
  }
}

async function interceptWith(input: { account: unknown; bundle: unknown; top?: number; budget?: number }, deps: ComputeDeps): Promise<InterceptReport> {
  const report = await recommendIntercept(
    { account: input.account as object, bundle: input.bundle as object },
    { top: input.top, budget: input.budget },
    coreDeps(deps),
  );
  return report as unknown as InterceptReport;
}

/**
 * 이미 읽어 둔 계정과 보스 묶음으로 보스별 추천을 계산한다 — 데스크톱 앱의 요격전 화면이 쓴다(기본 계정 + 내장 보스 묶음,
 * 파일 경로 없음). `runIntercept`와 같은 함수(`recommendIntercept`)를 부른다.
 */
export async function runInterceptWith(
  input: { account: unknown; bundle: unknown; top?: number; budget?: number },
  deps: ComputeDeps = defaultDeps,
): Promise<InterceptReport> {
  try {
    return await interceptWith(input, deps);
  } catch (e) {
    throw asComputeError(e);
  }
}

export interface GrowthInput {
  accountPath: string;
  conditionPath: string;
  /** 기준 편성이 든 편성 파일. */
  squadsPath: string;
  /** 기준 편성의 이름. 비우면 파일의 첫 편성이다(CLI의 `--squad`). */
  squadName?: string;
  /** 업그레이드 후보 파일. */
  upgradesPath: string;
}

type SquadDoc = { name?: string; members: string[] };

/** 편성 파일에서 기준 편성 하나를 고른다. 이름을 주지 않으면 첫 편성이다 — CLI(src/cli.mjs의 pickSquad)와 같다. */
function pickSquad(squadsDoc: unknown, name: string | undefined): SquadDoc {
  const squads = Array.isArray(squadsDoc) ? squadsDoc : (squadsDoc as { squads?: unknown } | null)?.squads;
  if (!Array.isArray(squads) || squads.length === 0) {
    throw new InputError('기준 편성이 없다', [{ path: '편성 파일', message: '편성을 하나 이상 담은 파일이어야 한다' }]);
  }
  if (name === undefined) return squads[0] as SquadDoc;
  const found = squads.find((s) => (s as SquadDoc | null)?.name === name);
  if (!found) {
    const names = squads.map((s) => (s as SquadDoc | null)?.name ?? '(이름 없음)').join(', ');
    throw new InputError('기준 편성이 없다', [{ path: '기준 편성 이름', message: `그 이름의 편성이 없다. 있는 이름: ${names}` }]);
  }
  return found as SquadDoc;
}

/**
 * 계정 + 전투 조건 + 기준 편성 + 업그레이드 후보 → 후보마다 기준 편성의 적용 전후 총딜 → 증가율 순위.
 * CLI의 `growth`와 같은 함수(`compareGrowth`)다.
 */
export async function runGrowth(input: GrowthInput, deps: ComputeDeps = defaultDeps): Promise<GrowthReport> {
  try {
    const account = await readInput(deps, '계정', input.accountPath);
    const condition = await readInput(deps, '전투 조건', input.conditionPath);
    const squadsDoc = await readInput(deps, '편성', input.squadsPath);
    const upgradesDoc = await readInput(deps, '업그레이드 후보', input.upgradesPath);
    const squadName = input.squadName?.trim() || undefined;
    // CLI와 같다: 후보 배열 그대로이거나 {upgrades: [...]}.
    const upgrades = Array.isArray(upgradesDoc) ? upgradesDoc : (upgradesDoc as { upgrades?: unknown } | null)?.upgrades;
    const report = await compareGrowth(
      { account: account as object, condition: condition as object, squad: pickSquad(squadsDoc, squadName), upgrades: upgrades as object[] },
      coreDeps(deps),
    );
    return report as unknown as GrowthReport;
  } catch (e) {
    throw asComputeError(e);
  }
}

/** 계정 + 전투 조건 + 후보 편성 파일 → 엔진 비교 → 순위. */
export async function runCompare(input: CompareInput, deps: ComputeDeps = defaultDeps): Promise<CompareReport> {
  try {
    const account = await readInput(deps, '계정', input.accountPath);
    const condition = await readInput(deps, '전투 조건', input.conditionPath);
    const squadsDoc = await readInput(deps, '편성', input.squadsPath);
    // CLI와 같다: 편성 배열 그대로이거나 {squads: [...]}.
    const squads = Array.isArray(squadsDoc) ? squadsDoc : (squadsDoc as { squads?: unknown } | null)?.squads;
    const report = await compareSquads(
      { account: account as object, condition: condition as object, squads: squads as { name?: string; members: string[] }[] },
      coreDeps(deps),
    );
    return report as unknown as CompareReport;
  } catch (e) {
    throw asComputeError(e);
  }
}

// ── 덱 빌더(P-030) ────────────────────────────────────────────────────────────
// 손으로 짠 편성 하나를 계산한다. 규칙은 전부 루트의 src/core/deck.mjs에 있다(그 안에서 compareSquads를 부른다) —
// 여기서는 런타임(캐시 포함)을 넘겨 부를 뿐이다. 같은 편성·같은 상대는 캐시에서 바로 나온다.

/** 덱 계산의 입력: 읽어 둔 계정, 고른 상대(resolveOpponent의 결과), 다섯 자리. */
export interface DeckInput {
  account: unknown;
  opponent: DeckOpponent;
  members: (string | null)[];
}

/** 편성 하나를 「내 계정 육성」과 「모두 최대 육성」 둘로 계산한다. */
export async function runDeckEvaluate(input: DeckInput, deps: ComputeDeps = defaultDeps): Promise<DeckReport> {
  try {
    return (await evaluateDeck({ account: input.account as object, opponent: input.opponent, members: input.members }, coreDeps(deps))) as unknown as DeckReport;
  } catch (e) {
    throw asComputeError(e);
  }
}

/** 한 자리에 같은 버스트 묶음의 보유 니케를 하나씩 넣어 계산한다(`limit`명까지). */
export async function runDeckSwap(input: DeckInput & { slot: number; limit?: number }, deps: ComputeDeps = defaultDeps): Promise<DeckSwapReport> {
  try {
    const report = await swapOne(
      { account: input.account as object, opponent: input.opponent, members: input.members, slot: input.slot },
      { limit: input.limit },
      coreDeps(deps),
    );
    return report as unknown as DeckSwapReport;
  } catch (e) {
    throw asComputeError(e);
  }
}

// ── 육성 효율표(P-031) ────────────────────────────────────────────────────────
// 규칙은 전부 루트의 src/core/efficiency.mjs에 있다(그 안에서 성장 비교 compareGrowth를 부른다 — 계정은 바뀌지 않는다).

/** 편성의 니케마다 한 단계 올릴 수 있는 것을 하나씩 계산해 총딜 증가율 순으로(`limit`개까지, `only`면 그 니케만). */
export async function runEfficiency(input: DeckInput & { only?: string | null; limit?: number }, deps: ComputeDeps = defaultDeps): Promise<EfficiencyReport> {
  try {
    const report = await efficiencyTable(
      { account: input.account as object, opponent: input.opponent, members: input.members },
      { only: input.only ?? null, limit: input.limit },
      coreDeps(deps),
    );
    return report as unknown as EfficiencyReport;
  } catch (e) {
    throw asComputeError(e);
  }
}

/** 니케 한 명의 오버로드 옵션 줄을 화면에서 짠 것으로 바꿨을 때의 총딜(가상 적용). */
export async function runOverloadTrial(input: DeckInput & { nikke: string; parts: OverloadPart[] }, deps: ComputeDeps = defaultDeps): Promise<OverloadTrialReport> {
  try {
    const report = await tryOverload(
      { account: input.account as object, opponent: input.opponent, members: input.members, nikke: input.nikke, parts: input.parts },
      coreDeps(deps),
    );
    return report as unknown as OverloadTrialReport;
  } catch (e) {
    throw asComputeError(e);
  }
}

/** 니케마다 큐브를 바꿔 본 총딜과 「이 편성에 맞는 큐브」(`limit`건까지, `only`면 그 니케만). */
export async function runCubeCompare(input: DeckInput & { only?: string | null; limit?: number }, deps: ComputeDeps = defaultDeps): Promise<CubeReport> {
  try {
    const report = await compareCubes(
      { account: input.account as object, opponent: input.opponent, members: input.members },
      { only: input.only ?? null, limit: input.limit },
      coreDeps(deps),
    );
    return report as unknown as CubeReport;
  } catch (e) {
    throw asComputeError(e);
  }
}

/** 같은 다섯의 자리 변형을 계산해 가장 좋은 순서를 찾는다(`limit`가지까지). */
export async function runDeckOrder(input: DeckInput & { limit?: number }, deps: ComputeDeps = defaultDeps): Promise<DeckOrderReport> {
  try {
    const report = await compareOrders({ account: input.account as object, opponent: input.opponent, members: input.members }, { limit: input.limit }, coreDeps(deps));
    return report as unknown as DeckOrderReport;
  } catch (e) {
    throw asComputeError(e);
  }
}
