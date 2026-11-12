// 내 니케 화면의 목록: 계정 문서 → 한 명씩의 줄(속성·버스트 단계·육성 요약), 거르기.
// 계정을 고치거나 계산하지 않는다 — 문서에 적힌 값을 읽어 보여 줄 뿐이다. 적지 않았거나 모르는 칸은 null(「미확인」)이다.

import { investmentScore } from '@core/candidates.mjs';
import type { AccountDoc, AccountNikke, EngineCatalog, NikkeInfo } from '../types';
import { nikkeInfoFrom } from './nikkeInfo';

/** 미확인 칸의 이름(계정 문서의 키 → 화면의 말). */
const FIELD_LABEL: Record<string, string> = {
  skill_levels: '스킬',
  breakthrough: '돌파',
  core_enhancement: '코어 강화',
  overload: '오버로드',
  collection_stage: '소장품',
  favorite_stage: '애장품',
  affinity: '호감도',
  cube: '큐브',
};

export interface RosterRow {
  name: string;
  info: NikkeInfo;
  /** 돌파(0~3). 적지 않았거나 미확인이면 null. */
  breakthrough: number | null;
  /** 코어 강화(0~7). */
  core: number | null;
  /** 스킬 레벨 셋. */
  skills: number[] | null;
  /** 오버로드 옵션의 줄 수(모든 부위 합). */
  overloadLines: number | null;
  /** 가져오지 못해 모르는 칸(화면의 말). */
  unknown: string[];
  /** 무엇이든 키운 흔적이 있는가(「육성한 것만」 거르기). */
  grown: boolean;
  /** 정렬에 쓰는 투자 점수(루트의 investmentScore — 성능 추정이 아니다). */
  score: number;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** 오버로드 옵션의 줄 수: 손으로 적은 계정은 옵션 → 줄 수, 가져온 계정은 옵션 → 줄별 레벨 목록이다. */
export function overloadLines(overload: AccountNikke['overload']): number | null {
  if (overload === undefined || overload === null || typeof overload !== 'object') return null;
  let lines = 0;
  for (const value of Object.values(overload)) {
    if (Array.isArray(value)) lines += value.length;
    else if (isCount(value)) lines += value;
  }
  return lines;
}

function rowOf(name: string, entry: AccountNikke, catalog: EngineCatalog | null): RosterRow {
  const unknownKeys = Array.isArray(entry.unknown) ? entry.unknown.filter((k): k is string => typeof k === 'string') : [];
  const known = (key: string) => !unknownKeys.includes(key);
  const breakthrough = known('breakthrough') && isCount(entry.breakthrough) ? entry.breakthrough : null;
  const core = known('core_enhancement') && isCount(entry.core_enhancement) ? entry.core_enhancement : null;
  const skills = known('skill_levels') && Array.isArray(entry.skill_levels) && entry.skill_levels.every(isCount) ? [...entry.skill_levels] : null;
  const lines = known('overload') ? overloadLines(entry.overload) : null;
  let score = 0;
  try {
    score = Number(investmentScore(entry)) || 0;
  } catch {
    score = 0;
  }
  return {
    name,
    info: nikkeInfoFrom(catalog, name),
    breakthrough,
    core,
    skills,
    overloadLines: lines,
    unknown: unknownKeys.map((k) => FIELD_LABEL[k] ?? k),
    grown: (breakthrough ?? 0) > 0 || (core ?? 0) > 0 || (lines ?? 0) > 0 || (skills ?? []).some((level) => level > 1),
    score,
  };
}

/** 계정의 보유 니케를 줄로. 많이 키운 순(투자 점수) → 이름순이다. */
export function rosterRows(account: AccountDoc | null | undefined, catalog: EngineCatalog | null): RosterRow[] {
  const nikkes = account?.nikkes;
  if (!nikkes || typeof nikkes !== 'object') return [];
  return Object.entries(nikkes)
    .map(([name, entry]) => rowOf(name, entry !== null && typeof entry === 'object' ? entry : {}, catalog))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'));
}

export interface RosterFilter {
  /** 속성(작열 등). 빈 문자열이면 전부. */
  element: string;
  /** 버스트 단계('1'·'2'·'3'). 전 단계(A) 니케는 어느 단계를 골라도 남는다. 빈 문자열이면 전부. */
  burst: string;
  grownOnly: boolean;
  /** 이름의 일부. */
  query: string;
}

export const NO_FILTER: RosterFilter = Object.freeze({ element: '', burst: '', grownOnly: false, query: '' });

/** 거른 목록. 입력을 바꾸지 않는다. */
export function filterRoster(rows: readonly RosterRow[], filter: RosterFilter): RosterRow[] {
  const query = filter.query.trim().toLowerCase().replaceAll(' ', '');
  return rows.filter((row) => {
    if (filter.element && row.info.element !== filter.element) return false;
    if (filter.burst && row.info.burst !== filter.burst && row.info.burst !== 'A') return false;
    if (filter.grownOnly && !row.grown) return false;
    if (query && !row.name.toLowerCase().replaceAll(' ', '').includes(query)) return false;
    return true;
  });
}

/** 스킬 레벨 셋을 '10/10/10'으로. 모르면 「미확인」. */
export function skillsLabel(row: RosterRow): string {
  return row.skills ? row.skills.join('/') : '미확인';
}

/** 돌파를 '3돌 +7'(코어 강화가 있으면)로. 모르면 「미확인」. */
export function breakthroughLabel(row: RosterRow): string {
  if (row.breakthrough === null) return '미확인';
  return `${row.breakthrough}돌${row.core ? ` +${row.core}` : ''}`;
}

/** 오버로드 줄 수를 'N줄'로. 모르면 「미확인」. */
export function overloadLabel(row: RosterRow): string {
  return row.overloadLines === null ? '미확인' : `${row.overloadLines}줄`;
}
