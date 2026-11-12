// 니케 정보: 이름 → 속성·버스트 단계·무기·기업·클래스·등급. 엔진 카탈로그(lib/backend.ts의 engineCatalog — 이미 있는 명령)에서 읽는다.
// 카탈로그에 없는 값은 null(「모름」)이다 — 값을 지어내지 않는다.

import { engineCatalog } from './backend';
import type { EngineCatalog, NikkeInfo } from '../types';

/** 모르는 값을 화면에 적을 때의 낱말. */
export const UNKNOWN_LABEL = '모름';

/** 카탈로그의 칸 이름(엔진의 니케 데이터). */
const FIELDS = {
  element: 'element_code',
  burst: 'burst_stage',
  weapon: 'weapon_type',
  corp: 'manufacturer',
  klass: 'class',
  rarity: 'rarity',
} as const;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** 카탈로그에서 니케 한 명의 정보를 읽는다. 카탈로그가 없거나 그 이름이 없으면 전부 null이고 `known: false`다. */
export function nikkeInfoFrom(catalog: EngineCatalog | null | undefined, name: string): NikkeInfo {
  const nikkes = catalog?.nikkes;
  const entry = nikkes && typeof nikkes === 'object' && Object.hasOwn(nikkes, name) ? nikkes[name] : null;
  const row = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
  const read = (field: keyof typeof FIELDS) => (row ? text(row[FIELDS[field]]) : null);
  return {
    name,
    known: row !== null,
    element: read('element'),
    burst: read('burst'),
    weapon: read('weapon'),
    corp: read('corp'),
    klass: read('klass'),
    rarity: read('rarity'),
  };
}

/** 화면에 적을 값: 있으면 그대로, 없으면 「모름」. */
export function infoLabel(value: string | null | undefined): string {
  return text(value) ?? UNKNOWN_LABEL;
}

let pending: Promise<EngineCatalog> | null = null;

/** 엔진 카탈로그. 한 번 읽어 두고 다시 쓴다. 읽지 못하면 거부되고, 다음에 다시 읽는다. */
export function loadNikkeCatalog(): Promise<EngineCatalog> {
  if (!pending) {
    const loading = engineCatalog();
    pending = loading;
    loading.catch(() => {
      if (pending === loading) pending = null;
    });
  }
  return pending;
}

/** 이름으로 니케 정보를 얻는다. 카탈로그를 읽지 못해도 거부하지 않는다 — 전부 「모름」인 정보가 온다. */
export async function nikkeInfo(name: string): Promise<NikkeInfo> {
  try {
    return nikkeInfoFrom(await loadNikkeCatalog(), name);
  } catch {
    return nikkeInfoFrom(null, name);
  }
}

/** 여러 명을 한 번에(카탈로그는 한 번만 읽는다). 순서는 입력 그대로다. */
export async function nikkeInfos(names: readonly string[]): Promise<NikkeInfo[]> {
  let catalog: EngineCatalog | null = null;
  try {
    catalog = await loadNikkeCatalog();
  } catch {
    catalog = null;
  }
  return names.map((name) => nikkeInfoFrom(catalog, name));
}

/** 읽어 둔 카탈로그를 버린다(엔진 데이터가 바뀐 뒤, 테스트 사이). */
export function clearNikkeCatalog(): void {
  pending = null;
}
