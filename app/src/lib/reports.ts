// 결과 문서가 그 화면이 그릴 수 있는 종류·판인지 확인한다(요격전 추천·성장 비교·티어).
// 수치를 고치거나 채우지 않는다 — 맞지 않으면 한국어 문장으로 던지고, 화면은 앞서 보이던 것을 그대로 둔다.
// 종류는 `kind`, 판은 `schema_version`으로 가린다. 판 번호는 결과를 만드는 루트 모듈의 상수를 그대로 쓴다.

import { GROWTH_REPORT_SCHEMA_VERSION } from '@core/growth.mjs';
import { INTERCEPT_REPORT_SCHEMA_VERSION } from '@core/intercept.mjs';
import { TIER_SCHEMA_VERSION } from '@tier/evaluate.mjs';
import type { GrowthReport, InterceptReport, TierReport } from '../types';

/** 화면에 그대로 보일 수 있는 문장을 가진 오류. */
export class ReportFormatError extends Error {}

type Doc = Record<string, unknown>;

const isObject = (v: unknown): v is Doc => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

interface Spec {
  kind: string;
  /** 「…가 아니다」에 들어가는 이름. */
  label: string;
  /** 이 종류의 파일을 만드는 명령. */
  made: string;
  version: number;
  objects: string[];
  arrays: string[];
  /** 칸 안쪽의 모양. 문제가 있으면 그 칸의 경로를 돌려준다. */
  inner: (doc: Doc) => string | null;
}

/** 목록의 모든 항목이 객체이고 `texts` 칸이 문자열, `arrays` 칸이 배열인가. 아니면 그 항목의 경로. */
function badItem(list: unknown[], path: string, texts: string[], arrays: string[], objects: string[] = []): string | null {
  for (const [i, item] of list.entries()) {
    if (!isObject(item)) return `${path}[${i}]`;
    for (const key of texts) if (!isText(item[key])) return `${path}[${i}].${key}`;
    for (const key of arrays) if (!Array.isArray(item[key])) return `${path}[${i}].${key}`;
    for (const key of objects) if (!isObject(item[key])) return `${path}[${i}].${key}`;
  }
  return null;
}

const SPECS = {
  intercept_report: {
    kind: 'intercept_report',
    label: '요격전 추천 결과',
    made: 'node src/cli.mjs intercept … --json',
    version: INTERCEPT_REPORT_SCHEMA_VERSION,
    objects: ['account', 'bundle', 'sims'],
    arrays: ['bosses', 'caveats'],
    inner: (doc) => badItem(doc.bosses as unknown[], 'bosses', ['id', 'name'], ['ranking', 'unconfirmed', 'flags', 'notes'], ['element']),
  },
  growth: {
    kind: 'growth',
    label: '성장 비교 결과',
    made: 'node src/cli.mjs growth … --json',
    version: GROWTH_REPORT_SCHEMA_VERSION,
    objects: ['account', 'baseline'],
    arrays: ['ranking', 'rejected', 'failed', 'caveats'],
    inner: (doc) =>
      (Array.isArray((doc.baseline as Doc).members) ? null : 'baseline.members') ??
      badItem(doc.ranking as unknown[], 'ranking', ['name'], ['changes', 'members']),
  },
  tier: {
    kind: 'tier',
    label: '티어 결과',
    made: 'node src/cli.mjs tier build … --json',
    version: TIER_SCHEMA_VERSION,
    objects: ['rules', 'scenario', 'references', 'sims', 'summary'],
    arrays: ['entries', 'caveats'],
    inner: (doc) => {
      const tiers = (doc.rules as Doc).tiers;
      if (!Array.isArray(tiers)) return 'rules.tiers';
      return (
        badItem(tiers, 'rules.tiers', ['tier'], []) ??
        (Array.isArray((doc.references as Doc).squads) ? null : 'references.squads') ??
        badItem(doc.entries as unknown[], 'entries', ['name', 'status'], [])
      );
    },
  },
} satisfies Record<string, Spec>;

/** 다른 종류의 결과 파일을 넣었을 때 그것이 무엇인지 알려 주는 이름. */
function kindName(doc: Doc): string {
  const kind = doc.kind;
  if (kind === undefined || kind === null) {
    return Array.isArray(doc.ranking) ? '편성 비교 결과(추천·비교 탭에서 불러온다)' : '결과 종류(kind)가 없는 파일';
  }
  const known = Object.values(SPECS).find((s) => s.kind === kind);
  const shown = typeof kind === 'string' ? kind : JSON.stringify(kind);
  return known ? `${known.label}(kind: ${shown})` : `다른 종류의 결과(kind: ${shown})`;
}

function check<T>(spec: Spec, doc: unknown, path: string): T {
  const where = path ? `: ${path}` : '';
  if (!isObject(doc)) throw new ReportFormatError(`${spec.label}가 아니다(최상위가 JSON 객체가 아니다)${where}`);
  if (doc.kind !== spec.kind) {
    throw new ReportFormatError(`${spec.label}가 아니다 — 이 파일은 ${kindName(doc)}다. 이 화면은 \`${spec.made}\`이 만든 파일만 읽는다${where}`);
  }
  if (doc.schema_version !== spec.version) {
    const found = doc.schema_version === undefined ? '없음' : JSON.stringify(doc.schema_version);
    throw new ReportFormatError(`schema_version이 맞지 않는다: 파일은 ${found}, 이 화면이 읽는 판은 ${spec.version}이다${where}`);
  }
  const missing =
    spec.objects.find((key) => !isObject(doc[key])) ?? spec.arrays.find((key) => !Array.isArray(doc[key])) ?? spec.inner(doc);
  if (missing) throw new ReportFormatError(`${spec.label}가 아니다(${missing} 칸이 없거나 형식이 다르다)${where}`);
  return doc as T;
}

/** 요격전 추천 결과(`recommendIntercept`)인가. `path`는 오류 문장에 넣을 파일 경로(없으면 빈 문자열). */
export const checkInterceptReport = (doc: unknown, path = ''): InterceptReport => check<InterceptReport>(SPECS.intercept_report, doc, path);

/** 성장 비교 결과(`compareGrowth`)인가. */
export const checkGrowthReport = (doc: unknown, path = ''): GrowthReport => check<GrowthReport>(SPECS.growth, doc, path);

/** 티어 결과(`buildTier`)인가. */
export const checkTierReport = (doc: unknown, path = ''): TierReport => check<TierReport>(SPECS.tier, doc, path);
