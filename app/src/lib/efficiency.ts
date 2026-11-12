// 육성 효율표(P-031) — 화면 쪽: 루트의 순수 함수(src/core/efficiency.mjs)를 화면의 값으로 잇는 곳.
// 규칙은 전부 루트의 순수 모듈에 있다(한 단계 올릴 수 있는 것 · 오버로드 줄을 부위에 놓기 · 큐브 목록) — 여기에는 규칙이 없다.
import { OVERLOAD_OPTIONS } from '@core/account.mjs';
import {
  cubeCandidates as coreCubeCandidates,
  cubeList as coreCubeList,
  currentCube as coreCurrentCube,
  DEFAULT_CUBE_LIMIT,
  DEFAULT_EFFICIENCY_LIMIT,
  DEFAULT_LINE_LEVEL,
  emptyOverloadParts as coreEmptyParts,
  ENGINE_DEFAULT_CUBE,
  layoutOverload as coreLayout,
  LINES_PER_PART,
  OVERLOAD_LEVEL_MAX,
  OVERLOAD_PARTS,
  overloadFromParts as coreFromParts,
  overloadState as coreOverloadState,
  overloadSummary as coreSummary,
  overloadTrialKey as coreTrialKey,
  upgradeCandidates as coreUpgradeCandidates,
} from '@core/efficiency.mjs';
import type { AccountDoc, AccountNikke, CubeInfo, EngineCatalog, ExcludedStep, OverloadLine, OverloadOptionSummary, OverloadPart, UpgradeStep } from '../types';

export { DEFAULT_CUBE_LIMIT, DEFAULT_EFFICIENCY_LIMIT, DEFAULT_LINE_LEVEL, LINES_PER_PART, OVERLOAD_LEVEL_MAX };

/** 장비 부위 넷(오버로드 옵션이 붙는 곳). */
export const PARTS: readonly string[] = OVERLOAD_PARTS;
/** 오버로드 옵션 9종: 열쇠와 게임에서 쓰는 이름(계산 도구가 받는 옵션 전부다). */
export const OPTIONS: { id: string; name: string }[] = Object.entries(OVERLOAD_OPTIONS as Record<string, string>).map(([id, name]) => ({ id, name }));
export const optionName = (id: string): string => (OVERLOAD_OPTIONS as Record<string, string>)[id] ?? id;
/** 계정에 니케의 큐브가 적혀 있지 않을 때 계산 도구가 끼우는 큐브. */
export const DEFAULT_CUBE: { name: string; level: number } = ENGINE_DEFAULT_CUBE;

const NO_ACCOUNT = { nikkes: {} };

/** 편성(또는 한 니케)에서 한 단계 올릴 수 있는 것과, 후보로 만들지 않은 칸. 계산 전에 「몇 개를 계산한다」를 말하는 데 쓴다. */
export function upgradePreview(account: AccountDoc | null | undefined, members: (string | null)[], catalog: EngineCatalog | null, only: string | null = null) {
  return coreUpgradeCandidates({ account: account ?? NO_ACCOUNT, members, catalog, only }) as unknown as { candidates: UpgradeStep[]; excluded: ExcludedStep[] };
}

export interface OverloadRead {
  /** lines 줄을 읽었다 · unknown 미확인 · aggregate 합산 수치뿐(지원하지 않음) · unreadable 읽을 수 없다. */
  status: 'lines' | 'unknown' | 'aggregate' | 'unreadable';
  lines: OverloadLine[];
  reason: string | null;
}

/** 계정에 적힌 니케의 오버로드를 줄 목록으로. */
export function overloadOf(entry: AccountNikke | null | undefined): OverloadRead {
  return coreOverloadState(entry ?? {}) as OverloadRead;
}

/** 줄 목록을 네 부위 × 세 줄에 놓는다(어느 부위인지는 계정 정보에 없다 — 차례로 놓을 뿐이다). */
export function layoutParts(lines: OverloadLine[]): OverloadPart[] {
  return (coreLayout(lines) as { parts: OverloadPart[] }).parts;
}

export const emptyParts = (): OverloadPart[] => coreEmptyParts() as OverloadPart[];

/** 화면에서 짠 부위별 줄을 모은 것: 줄 목록, 계산하지 못하게 하는 문제, 알릴 것. */
export function partsCheck(parts: OverloadPart[]): { lines: OverloadLine[]; count: number; problems: string[]; notes: string[] } {
  return coreFromParts(parts) as { lines: OverloadLine[]; count: number; problems: string[]; notes: string[] };
}

export const summarize = (lines: OverloadLine[]): OverloadOptionSummary[] => coreSummary(lines) as OverloadOptionSummary[];

/** 옵션별 줄을 한 줄 글로: 「공격력 3줄 · 우월 코드 대미지 2줄」. 줄이 없으면 「옵션 없음」. */
export function summaryText(options: OverloadOptionSummary[]): string {
  return options.length ? options.map((o) => `${o.name} ${o.levels.length}줄`).join(' · ') : '옵션 없음';
}

/** 바꿔 본 결과가 지금 화면의 것인지 견주는 열쇠. */
export const trialKey = (members: (string | null)[], opponent: string | null, nikke: string | null, lines: OverloadLine[]): string =>
  coreTrialKey(members, opponent, nikke, lines) as string;

/** 큐브 목록: 바꿔 볼 수 있는 것과 계산 도구가 효과를 계산하지 못하는 것. 목록을 읽지 못했으면 `known: false`. */
export function cubesOf(catalog: EngineCatalog | null): { known: boolean; supported: CubeInfo[]; unsupported: CubeInfo[] } {
  return coreCubeList(catalog ?? {}) as { known: boolean; supported: CubeInfo[]; unsupported: CubeInfo[] };
}

/** 니케가 지금 끼고 있는 것으로 계산되는 큐브. */
export function cubeOf(entry: AccountNikke | null | undefined): { name: string; level: number; source: 'account' | 'default' } {
  return coreCurrentCube(entry ?? {}) as { name: string; level: number; source: 'account' | 'default' };
}

/** 큐브 비교가 계산할 건수와 상한 때문에 보지 못할 큐브(누르기 전에 말한다). */
export function cubePreview(account: AccountDoc | null | undefined, members: (string | null)[], catalog: EngineCatalog | null, only: string | null = null, limit: number = DEFAULT_CUBE_LIMIT) {
  const made = coreCubeCandidates({ account: account ?? NO_ACCOUNT, members, catalog: catalog ?? {}, only, limit }) as unknown as { known: boolean; candidates: unknown[]; skipped_cubes: string[] };
  return { known: made.known, count: made.candidates.length, skipped: made.skipped_cubes };
}
