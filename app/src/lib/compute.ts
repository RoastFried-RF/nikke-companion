// 편성 추천·비교 실행: 파일 읽기 → 루트의 계산 코드(src/core) → 비교 결과.
// 계산 규칙은 여기에 없다. suggestSquads·compareSquads에 런타임을 넘겨 부를 뿐이다(CLI의 suggest·compare와 같은 길).

import { withCache } from '@core/cache.mjs';
import { DEFAULT_BUDGET, DEFAULT_LIMIT, DEFAULT_TOP, suggestSquads } from '@core/candidates.mjs';
import { compareSquads, InputError } from '@core/compare.mjs';
import type { CompareReport, EngineRuntime, SearchStage, SimCacheStore } from '../types';
import { errorMessage, readJsonFile } from './backend';
import { simCache, tauriRuntime } from './runtime';

export { DEFAULT_BUDGET, DEFAULT_LIMIT, DEFAULT_TOP };

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
  return { runtime, ...(deps.now ? { now: deps.now } : {}), ...(deps.onStage ? { onStage: deps.onStage } : {}) };
}

/**
 * 계정 + 전투 조건 → 후보 편성 생성 → 엔진 비교(1단계) → 상위 조합의 배치 탐색(2단계) → 상위 편성.
 * CLI의 `suggest`와 같은 함수(`suggestSquads`)다 — 배치 변형 규칙과 시뮬 예산도 그 함수가 정한다.
 */
export async function runSuggest(input: SuggestInput, deps: ComputeDeps = defaultDeps): Promise<CompareReport> {
  try {
    const account = await readInput(deps, '계정', input.accountPath);
    const condition = await readInput(deps, '전투 조건', input.conditionPath);
    const report = await suggestSquads(
      { account: account as object, condition: condition as object },
      { limit: input.limit, top: input.top, refine: input.refine, budget: input.budget },
      coreDeps(deps),
    );
    return report as unknown as CompareReport;
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
