// 육성 효율표(P-031) — 「무엇을 올리면 딜이 얼마나 오르나」를 후보를 손으로 쓰지 않고 보는 순수 모듈.
//   효율표          기준 편성의 니케마다 「한 단계 올릴 수 있는 것」(스킬 1·2·버스트, 돌파, 코어 강화, 소장품 단계, 오버로드 줄)을
//                   후보로 만들어 하나씩 계산하고 총딜 증가율 순으로 돌려준다. 이미 최대인 칸은 후보가 아니다
//   오버로드 바꿔 보기  니케 한 명의 부위별 옵션 줄(엔진이 받는 옵션 9종)을 바꾼 것으로 가상 적용해 총딜 변화를 본다
//   큐브            니케마다 큐브를 바꿔 본 총딜과 「이 편성에 맞는 큐브」(엔진은 요청의 육성 칸 `cube`로 큐브를 바꿔 받는다 —
//                   vendor/nikke-calc/docs/SIM-JSON.md §육성·§니케별 운용 `cube`, runner/spec.py `check_cube`)
//
// 계산은 전부 compareGrowth(src/core/growth.mjs)가 한다 — 후보는 그 함수의 업그레이드 후보이고, 가상 적용은 applyUpgrade다
// (계정 문서는 바뀌지 않는다). 여기에는 엔진 요청을 만드는 코드가 없다. `node:` 모듈을 import하지 않는다(웹뷰와 Node가 함께 쓴다).
// 형식은 docs/data-model.md §육성 효율표.
//
// 모르는 것 · 다루지 않는 것(결과의 caveats에도 적는다):
//   - 비용. 재화·필요 수량 표가 이 저장소에 없다 — 「효율」은 증가율의 순위일 뿐이다. 값을 지어내지 않는다.
//   - 어느 부위에 어느 오버로드 옵션이 붙었는지. 계정 상태는 옵션별 줄 수(와 줄 레벨)만 담는다 — 엔진도 그것만 쓴다.
//   - 보유 큐브. 계정에는 장착 중이던 큐브에서 본 레벨(하한)만 있다(`account.cubes`).
//   - 후보로 만들지 않는 칸: 호감도, 애장품 단계, 장비 등급·강화, 콘솔, 큐브 레벨, 소장품이 없는 니케의 소장품.
import { OVERLOAD_OPTIONS, overloadOptionId } from './account.mjs';
import { InputError, SQUAD_SIZE } from './compare.mjs';
import { deckKey, filledMembers } from './deck.mjs';
import { compareGrowth } from './growth.mjs';
import { engineAccess } from './runtime.mjs';

export const EFFICIENCY_SCHEMA_VERSION = 1;
/** 효율표가 한 번에 계산하는 후보 수의 기본 상한(니케 다섯의 후보는 많아야 75개다). */
export const DEFAULT_EFFICIENCY_LIMIT = 60;
/** 큐브 비교가 한 번에 계산하는 수의 기본 상한(니케 다섯 × 바꿔 볼 큐브 15종 = 75건이 다 들어간다). */
export const DEFAULT_CUBE_LIMIT = 80;

// 육성 칸의 범위 — 계정 상태의 검사(account.mjs의 validateAccount)·엔진 문서(SIM-JSON.md §육성)와 같다.
export const SKILL_LEVEL_MAX = 10;
export const BREAKTHROUGH_MAX = 3;
export const CORE_ENHANCEMENT_MAX = 7;
export const COLLECTION_LEVEL_MAX = 15;

/** 오버로드 옵션이 붙는 장비 부위(계정 상태의 `equipment` 키와 같다). */
export const OVERLOAD_PARTS = Object.freeze(['머리', '몸통', '팔', '다리']);
/** 부위 하나의 옵션 줄 수. */
export const LINES_PER_PART = 3;
export const OVERLOAD_LINE_MAX = OVERLOAD_PARTS.length * LINES_PER_PART;
/** 오버로드 줄의 레벨 범위(SIM-JSON.md §육성 `overload` — 레벨 1~15). */
export const OVERLOAD_LEVEL_MAX = 15;
/** 줄 수만 적힌 줄의 레벨. 엔진이 줄 수만 받았을 때 쓰는 레벨과 같다(SIM-JSON.md — 「줄 수만 주면 레벨 10」). 새로 더하는 줄도 이 레벨로 본다. */
export const DEFAULT_LINE_LEVEL = 10;
/** 계정에 니케의 큐브가 적혀 있지 않을 때 엔진이 끼우는 큐브(runner/spec.py `DEFAULT_CHAR["cube"]`). 통합 테스트가 실제 엔진과 대조한다. */
export const ENGINE_DEFAULT_CUBE = Object.freeze({ name: '렐릭 베어 큐브', level: 15 });

const OPTION_IDS = Object.keys(OVERLOAD_OPTIONS);
const SKILL_LABELS = ['스킬 1', '스킬 2', '버스트'];
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const entryOf = (account, name) => (isPlainObject(account?.nikkes) && Object.hasOwn(account.nikkes, name) && isPlainObject(account.nikkes[name]) ? account.nikkes[name] : null);
const unknownOf = (entry) => (Array.isArray(entry?.unknown) ? entry.unknown : []);

// ── 엔진의 큐브 표 → 카탈로그 ───────────────────────────────────────────────────

/**
 * 엔진의 큐브 표(`data/base_stat_tables/cube.json`)의 내용 → 카탈로그의 `cubes`.
 * `_`로 시작하는 키(주석·공통 스탯)와 `공통`(어떤 큐브를 껴도 붙는 두 번째 효과 — 큐브 이름이 아니다)은 뺀다.
 * `supported: false`는 엔진이 효과를 계산하지 못하는 큐브다(`unsupported`) — 요청에 넣으면 엔진이 오류로 끊는다.
 * Rust(app/src-tauri/src/engine.rs의 `catalog`)가 같은 규칙으로 같은 값을 낸다.
 * @returns {{name: string, skill: string|null, effect: string|null, max_level: number, supported: boolean}[]} 표의 순서 그대로
 */
export function cubeCatalogFrom(raw) {
  if (!isPlainObject(raw)) return [];
  const out = [];
  for (const [name, row] of Object.entries(raw)) {
    if (name.startsWith('_') || name === '공통' || !isPlainObject(row)) continue;
    out.push({
      name,
      skill: typeof row['스킬명'] === 'string' ? row['스킬명'] : null,
      effect: typeof row.template === 'string' ? row.template : null,
      max_level: isPlainObject(row.values) ? Object.keys(row.values).length : 0,
      supported: !row.unsupported,
    });
  }
  return out;
}

/**
 * 카탈로그의 큐브를 바꿔 볼 수 있는 것과 없는 것으로 나눈다. 카탈로그에 큐브 목록이 없으면(`known: false`) 큐브 비교를 할 수 없다.
 * @returns {{known: boolean, supported: object[], unsupported: object[]}}
 */
export function cubeList(catalog) {
  const all = Array.isArray(catalog?.cubes) ? catalog.cubes.filter((c) => isText(c?.name)) : null;
  if (all === null) return { known: false, supported: [], unsupported: [] };
  return { known: true, supported: all.filter((c) => c.supported !== false && c.max_level >= 1), unsupported: all.filter((c) => !(c.supported !== false && c.max_level >= 1)) };
}

// ── 한 단계 올릴 수 있는 것(후보 만들기) ──────────────────────────────────────

/** 후보 종류의 순서. 상한에 걸리면 뒤의 종류부터 빠진다(딜과 먼 옵션이 뒤다 — 순서일 뿐 성능 판단이 아니다). */
export const CANDIDATE_KINDS = Object.freeze(['skill1', 'skill2', 'burst', 'breakthrough', 'core', 'collection', ...OPTION_IDS.map((id) => `overload:${id}`)]);

/** 소장품 단계 표기(`R0`~`R15`·`SR0`~`SR15`·`없음`)를 읽는다. 못 읽으면 null. */
export function readCollectionStage(value) {
  if (value === undefined || value === null || value === '없음') return { grade: null, level: null };
  const m = typeof value === 'string' ? /^(R|SR)(\d{1,2})$/.exec(value) : null;
  if (!m || Number(m[2]) > COLLECTION_LEVEL_MAX) return null;
  return { grade: m[1], level: Number(m[2]) };
}

/**
 * 니케 항목의 오버로드를 줄 목록으로. 계정 상태는 옵션별 줄 수(또는 줄별 레벨)만 담는다 — 부위는 모른다.
 *   lines      줄 수·줄 레벨을 읽었다(줄이 하나도 없어도 여기다)
 *   unknown    미확인 칸이다(`unknown`에 `overload`) — 계산은 줄 없음으로 한다
 *   aggregate  합산 수치(`equip_skills`)로만 적혀 있다 — 줄 단위로 바꿀 수 없다(지원하지 않음)
 *   unreadable 읽을 수 없는 표기다(모르는 옵션 이름, 범위 밖 레벨)
 * @returns {{status: 'lines'|'unknown'|'aggregate'|'unreadable', lines: {id: string, level: number}[], reason: string|null}}
 */
export function overloadState(entry) {
  if (unknownOf(entry).includes('overload')) {
    return { status: 'unknown', lines: [], reason: '오버로드가 미확인이다 — 지금 값은 옵션이 없는 것으로 계산한다.' };
  }
  const aggregate = isPlainObject(entry?.equip_skills) && Object.keys(entry.equip_skills).length > 0;
  if (aggregate) {
    return { status: 'aggregate', lines: [], reason: '오버로드가 옵션별 합산 수치로만 적혀 있어 줄 단위로 바꿔 볼 수 없다(지원하지 않음). 계정을 새로 받으면 줄 단위로 적힐 수 있다.' };
  }
  const written = entry?.overload;
  if (written === undefined) return { status: 'lines', lines: [], reason: null };
  if (!isPlainObject(written)) return { status: 'unreadable', lines: [], reason: '오버로드 표기를 읽을 수 없다.' };
  const byId = new Map();
  for (const [key, value] of Object.entries(written)) {
    const id = overloadOptionId(key);
    if (id === null) return { status: 'unreadable', lines: [], reason: `모르는 오버로드 옵션이다: ${key}` };
    let levels;
    if (Number.isInteger(value) && value >= 0) levels = Array.from({ length: value }, () => DEFAULT_LINE_LEVEL);
    else if (Array.isArray(value) && value.every((lv) => isInt(lv, 1, OVERLOAD_LEVEL_MAX))) levels = [...value];
    else return { status: 'unreadable', lines: [], reason: `오버로드 ${key}의 값을 읽을 수 없다.` };
    byId.set(id, [...(byId.get(id) ?? []), ...levels]);
  }
  const lines = [];
  for (const id of OPTION_IDS) for (const level of [...(byId.get(id) ?? [])].sort((a, b) => b - a)) lines.push({ id, level });
  return { status: 'lines', lines, reason: null };
}

/** 계정의 장비 기록에서 오버로드 장비인 부위. 장비를 적지 않은 니케는 모른다(null) — 네 부위 모두 놓을 수 있다고 본다. */
function overloadParts(entry) {
  if (!isPlainObject(entry?.equipment)) return null;
  // 계정 상태의 장비: `tier`가 없으면 오버로드 장비다(docs/data-model.md §계정 상태). 적지 않은 부위는 모른다 — 막지 않는다.
  return OVERLOAD_PARTS.filter((part) => !isPlainObject(entry.equipment[part]) || entry.equipment[part].tier === undefined);
}

/** 그 옵션을 계정이 어떤 이름·어떤 표기로 적었나(없으면 인게임 이름·줄 수 표기). */
function overloadKeyOf(entry, id) {
  const written = isPlainObject(entry?.overload) ? entry.overload : {};
  const key = Object.keys(written).find((k) => overloadOptionId(k) === id);
  return key === undefined ? { key: OVERLOAD_OPTIONS[id], byLevel: false } : { key, byLevel: Array.isArray(written[key]) };
}

/**
 * 편성의 니케마다 「한 단계 올릴 수 있는 것」을 업그레이드 후보(growth.mjs의 후보 형식)로 만든다.
 * 계정 상태에 있고 엔진이 계산에 반영하는 칸만이다: 스킬 1·2·버스트 레벨(+1), 돌파(+1), 코어 강화(+1 — 돌파 3 뒤에만),
 * 소장품 단계(+1 — 같은 등급 안에서), 오버로드 줄(옵션마다 +1줄). 이미 최대인 칸, 미확인 칸, 더할 자리가 없는 것은 후보가 아니고
 * `excluded`에 까닭과 함께 남는다. 순서는 종류(CANDIDATE_KINDS) → 편성의 자리 순서다 — 같은 입력이면 같은 목록이다.
 *
 * @param {{account: object, members: (string|null)[], catalog?: object|null, only?: string|null}} input `only`를 주면 그 니케의 후보만 만든다
 * @returns {{candidates: {id: string, nikke: string, kind: string, label: string, from: string, to: string, upgrade: object, notes: string[]}[],
 *   excluded: {nikke: string, kind: string, label: string, code: 'max'|'unknown'|'locked'|'none'|'unsupported', reason: string}[]}}
 */
export function upgradeCandidates({ account, members, catalog = null, only = null }) {
  const names = filledMembers(members).filter((name) => only === null || only === undefined || name === only);
  const byKind = new Map(CANDIDATE_KINDS.map((kind) => [kind, []]));
  const excluded = [];
  const add = (nikke, kind, label, from, to, change, notes = []) => {
    const id = `${nikke} · ${label} ${from} → ${to}`;
    byKind.get(kind).push({ id, nikke, kind, label, from, to, upgrade: { name: id, nikke, ...change }, notes });
  };
  const skip = (nikke, kind, label, code, reason) => excluded.push({ nikke, kind, label, code, reason });

  for (const nikke of names) {
    const entry = entryOf(account, nikke);
    if (!entry) continue; // 보유하지 않은 니케 — 계산할 때 편성 검사가 걸러 낸다.
    const unknown = unknownOf(entry);

    // 스킬 1·2·버스트
    if (unknown.includes('skill_levels')) skip(nikke, 'skill1', '스킬', 'unknown', '스킬 레벨이 미확인이라 한 단계 위를 정할 수 없다.');
    else {
      const levels = Array.isArray(entry.skill_levels) && entry.skill_levels.length === 3 ? entry.skill_levels : [1, 1, 1];
      ['skill1', 'skill2', 'burst'].forEach((kind, i) => {
        const now = levels[i];
        if (!Number.isInteger(now) || now >= SKILL_LEVEL_MAX) skip(nikke, kind, SKILL_LABELS[i], 'max', `${SKILL_LABELS[i]} 레벨이 이미 최대(${SKILL_LEVEL_MAX})다.`);
        else add(nikke, kind, SKILL_LABELS[i], `Lv.${now}`, `Lv.${now + 1}`, { add: { skill_levels: [0, 1, 2].map((j) => (j === i ? 1 : 0)) } });
      });
    }

    // 돌파
    const breakthrough = unknown.includes('breakthrough') ? null : (entry.breakthrough ?? 0);
    if (breakthrough === null) skip(nikke, 'breakthrough', '돌파', 'unknown', '돌파가 미확인이라 한 단계 위를 정할 수 없다.');
    else if (breakthrough >= BREAKTHROUGH_MAX) skip(nikke, 'breakthrough', '돌파', 'max', `돌파가 이미 최대(${BREAKTHROUGH_MAX})다.`);
    else {
      const rarity = catalog?.nikkes?.[nikke]?.rarity;
      const notes = isText(rarity) && rarity !== 'SSR' ? [`${rarity} 등급 니케의 돌파 한도는 이 앱이 확인하지 못했다 — 게임에서 올릴 수 있는 단계인지 확인한다.`] : [];
      add(nikke, 'breakthrough', '돌파', `${breakthrough}`, `${breakthrough + 1}`, { add: { breakthrough: 1 } }, notes);
    }

    // 코어 강화 — 돌파 3 뒤에 열린다(엔진 calculator/base_stat.py의 캐릭터 구조 주석).
    if (unknown.includes('core_enhancement')) skip(nikke, 'core', '코어 강화', 'unknown', '코어 강화가 미확인이라 한 단계 위를 정할 수 없다.');
    else {
      const core = entry.core_enhancement ?? 0;
      if (core >= CORE_ENHANCEMENT_MAX) skip(nikke, 'core', '코어 강화', 'max', `코어 강화가 이미 최대(${CORE_ENHANCEMENT_MAX})다.`);
      else if (breakthrough === null || breakthrough < BREAKTHROUGH_MAX) skip(nikke, 'core', '코어 강화', 'locked', `코어 강화는 돌파 ${BREAKTHROUGH_MAX} 뒤에 열린다(지금 돌파 ${breakthrough ?? '미확인'}).`);
      else add(nikke, 'core', '코어 강화', `${core}`, `${core + 1}`, { add: { core_enhancement: 1 } });
    }

    // 소장품 단계 — 같은 등급 안에서 한 단계. 없는 니케와 R15는 후보가 아니다(다른 소장품을 얻는 일이다).
    if (unknown.includes('collection_stage')) skip(nikke, 'collection', '소장품', 'unknown', '소장품 단계가 미확인이라 한 단계 위를 정할 수 없다.');
    else {
      const stage = readCollectionStage(entry.collection_stage);
      if (stage === null) skip(nikke, 'collection', '소장품', 'unsupported', `소장품 단계 표기를 읽을 수 없다: ${String(entry.collection_stage)}`);
      else if (stage.grade === null) skip(nikke, 'collection', '소장품', 'none', '소장품이 없다(또는 계정에 적혀 있지 않다) — 어느 등급을 얻을지 알 수 없어 후보로 만들지 않는다.');
      else if (stage.level >= COLLECTION_LEVEL_MAX) {
        skip(nikke, 'collection', '소장품', 'max', stage.grade === 'R' ? `소장품이 R 등급의 최대(${COLLECTION_LEVEL_MAX})다 — SR은 다른 소장품이라 후보로 만들지 않는다.` : `소장품이 이미 최대(SR${COLLECTION_LEVEL_MAX})다.`);
      } else add(nikke, 'collection', '소장품', `${stage.grade}${stage.level}`, `${stage.grade}${stage.level + 1}`, { set: { collection_stage: `${stage.grade}${stage.level + 1}` } });
    }

    // 오버로드 줄 — 옵션마다 한 줄 더.
    const state = overloadState(entry);
    if (state.status !== 'lines') {
      skip(nikke, 'overload', '오버로드', state.status === 'unknown' ? 'unknown' : 'unsupported', state.status === 'unknown' ? '오버로드가 미확인이라 줄을 더할 기준이 없다.' : state.reason);
      continue;
    }
    const parts = overloadParts(entry);
    const capableParts = parts === null ? OVERLOAD_PARTS.length : parts.length;
    const room = capableParts * LINES_PER_PART - state.lines.length;
    if (room <= 0) {
      const why =
        capableParts === OVERLOAD_PARTS.length
          ? `오버로드 ${OVERLOAD_LINE_MAX}줄이 모두 찼다.`
          : `오버로드 장비가 ${capableParts}부위뿐이라 줄을 더 놓을 자리가 없다(부위마다 ${LINES_PER_PART}줄).`;
      skip(nikke, 'overload', '오버로드', 'max', why);
      continue;
    }
    for (const id of OPTION_IDS) {
      const count = state.lines.filter((line) => line.id === id).length;
      const label = `오버로드 ${OVERLOAD_OPTIONS[id]}`;
      if (count >= capableParts) {
        skip(nikke, `overload:${id}`, label, 'max', `${OVERLOAD_OPTIONS[id]} 옵션이 이미 ${count}줄이다(부위마다 한 줄로 본다).`);
        continue;
      }
      const { key, byLevel } = overloadKeyOf(entry, id);
      add(nikke, `overload:${id}`, label, `${count}줄`, `${count + 1}줄`, { add: { overload: { [key]: byLevel ? [DEFAULT_LINE_LEVEL] : 1 } } });
    }
  }
  return { candidates: CANDIDATE_KINDS.flatMap((kind) => byKind.get(kind)), excluded };
}

// ── 공통: 입력 검사와 결과의 머리 ──────────────────────────────────────────────

function requireOpponent(opponent) {
  if (!isPlainObject(opponent) || !isPlainObject(opponent.condition)) {
    throw new InputError('상대가 없다', [{ path: '/opponent', message: '상대(보스·프리셋·속성)를 골라야 한다' }]);
  }
}

function requireFull(members) {
  const names = filledMembers(members);
  if (!Array.isArray(members) || names.length !== SQUAD_SIZE) {
    throw new InputError('기준 편성이 덜 찼다', [{ path: '/members', message: `다섯 자리를 모두 채워야 계산한다 (지금 ${names.length}명)` }]);
  }
  return names;
}

function requireMember(names, nikke, path = '/nikke') {
  if (!names.includes(nikke)) throw new InputError('니케를 고르지 않았다', [{ path, message: `기준 편성에 있는 니케여야 한다: ${names.join(', ')}` }]);
}

function limitOf(options, fallback) {
  const limit = options.limit ?? fallback;
  if (!isPositiveInt(limit)) throw new InputError('옵션이 잘못됐다', [{ path: '/limit', message: 'limit은 1 이상의 정수여야 한다' }]);
  return limit;
}

const opponentBrief = (o) => ({
  key: o.key ?? null,
  kind: o.kind ?? null,
  id: o.id ?? null,
  label: o.label ?? null,
  element: o.element ?? null,
  unconfirmed: o.unconfirmed ?? [],
  flags: o.flags ?? [],
  notes: o.notes ?? [],
  is_test_data: o.is_test_data === true,
});

const baselineOf = (report) => ({
  total_damage: report.baseline.total_damage,
  members: report.baseline.members,
  notes: report.baseline.notes,
  engine_warnings: report.baseline.engine_warnings,
  ungrown_members: report.baseline.ungrown_members,
});

const SQUAD = '기준 편성';
const COST_NOTE = '비용은 모른다 — 재화와 필요 수량의 표가 이 앱에 없다. 순위는 「한 단계 올렸을 때 총딜이 얼마나 느는가」일 뿐이고, 싸게 올릴 수 있는지는 반영하지 않았다.';
const CAVEAT_ESTIMATE = '수치는 계산으로 어림한 값이다. 실제 전투 기록과 대조하지 않았다.';
const CAVEAT_ONE_SQUAD = '기준 편성 하나, 상대 하나에서의 총딜 변화다. 다른 편성·다른 상대에서는 순서가 달라질 수 있다.';
/** compareGrowth의 주의 문장 가운데 이 모듈이 제 말로 다시 적는 것. */
const REPLACED = ['기준 편성 하나에서의 총딜 변화다', '재화·비용은 고려하지 않았다', '후보는 하나씩 따로 적용했다', '수치는 시뮬레이션 추정치다'];
const keptCaveats = (report) => report.caveats.filter((c) => !REPLACED.some((head) => c.startsWith(head)));
const errorText = (error) => error?.message ?? '알 수 없는 오류';

// ── 육성 효율표 ────────────────────────────────────────────────────────────────

/**
 * 기준 편성의 니케마다 한 단계 올릴 수 있는 것을 하나씩 가상 적용해 총딜 증가율 순으로 돌려준다.
 * 엔진 요청은 기준 1건 + 계산한 후보 수다(compareGrowth 한 번 — 캐시에 있는 것은 엔진에 보내지 않는다).
 *
 * @param {{account: object, opponent: object, members: (string|null)[]}} input `opponent`는 deck.mjs의 resolveOpponent 결과
 * @param {{limit?: number, only?: string|null}} [options] 한 번에 계산할 후보 수의 상한(기본 60), 한 니케의 후보만 볼 때 그 이름
 * @param {object} [deps] compareGrowth와 같다
 * @returns {Promise<object>} docs/data-model.md §육성 효율표 §효율표
 */
export async function efficiencyTable({ account, opponent, members }, options = {}, deps = {}) {
  requireOpponent(opponent);
  const names = requireFull(members);
  const limit = limitOf(options, DEFAULT_EFFICIENCY_LIMIT);
  const only = options.only ?? null;
  if (only !== null) requireMember(names, only, '/only');
  const catalog = await engineAccess(deps).catalog();

  const made = upgradeCandidates({ account, members: names, catalog, only });
  const picked = made.candidates.slice(0, limit);
  const skipped = made.candidates.slice(limit).map((c) => ({ id: c.id, nikke: c.nikke, kind: c.kind, label: c.label, from: c.from, to: c.to }));
  const byId = new Map(picked.map((c) => [c.id, c]));
  const head = {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    kind: 'growth_efficiency',
    key: deckKey(names, opponent.key),
    only,
    opponent: opponentBrief(opponent),
    members: names,
    cost_known: false,
    cost_note: COST_NOTE,
  };
  const caveats = (more = []) => [
    COST_NOTE,
    CAVEAT_ESTIMATE,
    CAVEAT_ONE_SQUAD,
    '한 단계씩 따로 올려 본 값이다. 여럿을 함께 올린 효과는 각각의 합과 다를 수 있고, 두 단계 이상 올렸을 때의 순서는 보지 않았다.',
    `새 오버로드 줄은 레벨 ${DEFAULT_LINE_LEVEL}으로 본다(계산 도구가 줄 수만 받았을 때 쓰는 레벨). 한 옵션은 부위마다 한 줄(많아야 ${OVERLOAD_PARTS.length}줄), 모두 ${OVERLOAD_LINE_MAX}줄까지로 본다.`,
    '후보로 만들지 않는 것: 호감도, 애장품 단계, 장비 등급·강화, 콘솔, 큐브 레벨, 소장품이 없는 니케의 소장품 — 「한 단계」를 정할 수 없거나 계정 정보에 없다.',
    ...(opponent.notes ?? []),
    ...more,
  ];

  if (picked.length === 0) {
    // 올릴 수 있는 칸이 없으면 계산할 것이 없다 — 기준 총딜도 계산하지 않는다(0이 아니라 null).
    return {
      ...head,
      generated_at: (deps.now ?? (() => new Date()))().toISOString(),
      account: { name: account?.name ?? null, is_test_data: account?.is_test_data, updated_at: account?.updated_at ?? null },
      baseline: null,
      rows: [],
      failed: [],
      skipped,
      excluded: made.excluded,
      candidates: { total: made.candidates.length, limit, computed: 0, failed: 0, skipped: skipped.length },
      assumptions: [],
      engine: null,
      cache: null,
      caveats: caveats(),
    };
  }

  const report = await compareGrowth(
    { account, condition: opponent.condition, squad: { name: SQUAD, members: names }, upgrades: picked.map((c) => c.upgrade) },
    { ...deps, catalog },
  );
  const rows = report.ranking.map((r) => {
    const c = byId.get(r.name);
    return {
      rank: r.rank,
      id: c.id,
      nikke: c.nikke,
      kind: c.kind,
      label: c.label,
      from: c.from,
      to: c.to,
      total_after: r.total_after,
      gain: r.gain,
      gain_rate: r.gain_rate,
      notes: [...c.notes, ...r.notes],
      engine_warnings: r.engine_warnings,
    };
  });
  const failedRow = (name, reason) => {
    const c = byId.get(name);
    return { id: c.id, nikke: c.nikke, kind: c.kind, label: c.label, from: c.from, to: c.to, reason };
  };
  const failed = [...report.rejected.map((r) => failedRow(r.name, r.reasons.join(' / '))), ...report.failed.map((f) => failedRow(f.name, errorText(f.error)))];
  const more = [];
  if (skipped.length) more.push(`한 번에 ${limit}개까지만 계산한다. 올릴 수 있는 ${made.candidates.length}개 가운데 ${skipped.length}개는 보지 못했다 — 니케 한 명만 골라 다시 보면 그 니케의 것은 모두 계산한다.`);
  if (failed.length) more.push(`계산하지 못한 것 ${failed.length}개 — 0으로 두지 않고 뺐다.`);
  return {
    ...head,
    generated_at: report.generated_at,
    account: report.account,
    baseline: baselineOf(report),
    rows,
    failed,
    skipped,
    excluded: made.excluded,
    candidates: { total: made.candidates.length, limit, computed: rows.length, failed: failed.length, skipped: skipped.length },
    assumptions: report.assumptions,
    engine: report.engine,
    cache: report.cache,
    caveats: caveats([...more, ...keptCaveats(report)]),
  };
}

// ── 오버로드 옵션 바꿔 보기 ────────────────────────────────────────────────────

/** 빈 부위 넷(부위마다 줄 셋 — 빈 줄은 null). */
export const emptyOverloadParts = () => OVERLOAD_PARTS.map((part) => ({ part, lines: Array.from({ length: LINES_PER_PART }, () => null) }));

/**
 * 줄 목록을 네 부위 × 세 줄에 차례로 놓는다. **어느 부위에 어느 옵션이 붙었는지는 계정 정보에 없다** — 화면에 놓을 자리를 정하는
 * 것일 뿐이고(같은 옵션은 되도록 서로 다른 부위에), 계산은 옵션별 줄 수와 레벨만 쓴다.
 * @param {{id: string, level: number}[]} lines
 * @returns {{parts: {part: string, lines: ({id: string, level: number}|null)[]}[], overflow: {id: string, level: number}[]}} 열두 줄을 넘는 줄은 `overflow`
 */
export function layoutOverload(lines) {
  const parts = emptyOverloadParts();
  const overflow = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const free = (p) => p.lines.includes(null);
    const target = parts.find((p) => free(p) && !p.lines.some((l) => l?.id === line.id)) ?? parts.find(free);
    if (!target) {
      overflow.push({ id: line.id, level: line.level });
      continue;
    }
    target.lines[target.lines.indexOf(null)] = { id: line.id, level: line.level };
  }
  return { parts, overflow };
}

/**
 * 화면에서 짠 부위별 줄 → 계정 상태의 `overload`(옵션 9종을 모두 적는다 — 줄이 없는 옵션은 `[]`).
 * @param {{part?: string, lines: ({id: string, level: number}|null)[]}[]} parts
 * @returns {{overload: Record<string, number[]>, lines: {id: string, level: number}[], count: number, problems: string[], notes: string[]}}
 *   `problems`가 있으면 계산하지 않는다. `notes`는 계산은 하되 알릴 것(같은 부위에 같은 옵션 두 줄)
 */
export function overloadFromParts(parts) {
  const problems = [];
  const notes = [];
  const byId = new Map(OPTION_IDS.map((id) => [id, []]));
  const list = Array.isArray(parts) ? parts : [];
  if (list.length > OVERLOAD_PARTS.length) problems.push(`부위는 ${OVERLOAD_PARTS.length}개까지다`);
  list.forEach((p, i) => {
    const name = isText(p?.part) ? p.part : `${i + 1}번째 부위`;
    const filled = (Array.isArray(p?.lines) ? p.lines : []).filter((l) => l !== null && l !== undefined);
    if (filled.length > LINES_PER_PART) problems.push(`${name}: 옵션은 ${LINES_PER_PART}줄까지다`);
    const seen = new Set();
    for (const line of filled) {
      if (!isPlainObject(line) || !byId.has(line.id)) {
        problems.push(`${name}: 모르는 옵션이다(${String(line?.id)})`);
        continue;
      }
      if (!isInt(line.level, 1, OVERLOAD_LEVEL_MAX)) {
        problems.push(`${name}: ${OVERLOAD_OPTIONS[line.id]} 줄의 레벨은 1~${OVERLOAD_LEVEL_MAX}이어야 한다`);
        continue;
      }
      if (seen.has(line.id)) notes.push(`${name}에 ${OVERLOAD_OPTIONS[line.id]} 옵션이 두 줄 이상이다 — 게임에서 되는 조합인지 이 앱은 확인하지 못했다. 계산은 그대로 한다.`);
      seen.add(line.id);
      byId.get(line.id).push(line.level);
    }
  });
  const overload = {};
  const lines = [];
  for (const id of OPTION_IDS) {
    const levels = byId.get(id).sort((a, b) => b - a);
    overload[OVERLOAD_OPTIONS[id]] = levels;
    for (const level of levels) lines.push({ id, level });
  }
  return { overload, lines, count: lines.length, problems, notes: [...new Set(notes)] };
}

/** 줄 목록을 옵션별로 묶은 요약(줄이 있는 옵션만, 옵션 표의 순서). */
export function overloadSummary(lines) {
  return OPTION_IDS.map((id) => ({ id, name: OVERLOAD_OPTIONS[id], levels: (Array.isArray(lines) ? lines : []).filter((l) => l.id === id).map((l) => l.level) })).filter((o) => o.levels.length > 0);
}

/** 바꿔 본 것이 지금 값과 같은가를 견주는 열쇠(편성·상대·니케·옵션별 줄 레벨). */
export function overloadTrialKey(members, opponentKey, nikke, lines) {
  return JSON.stringify([deckKey(members, opponentKey), nikke ?? null, overloadSummary(lines).map((o) => [o.id, o.levels])]);
}

/**
 * 니케 한 명의 오버로드 옵션 줄을 화면에서 짠 것으로 바꿨을 때의 총딜. 계정 문서는 바꾸지 않는다(applyUpgrade — 복사본에 적용).
 * 엔진 요청은 기준 1건 + 바꾼 것 1건이다. 지금 값과 같으면 계산하지 않고 `status: 'same'`이다.
 *
 * @param {{account: object, opponent: object, members: (string|null)[], nikke: string, parts: object[]}} input `parts`는 overloadFromParts의 입력
 * @param {object} [deps] compareGrowth와 같다
 * @returns {Promise<object>} docs/data-model.md §육성 효율표 §오버로드 옵션 바꿔 보기
 */
export async function tryOverload({ account, opponent, members, nikke, parts }, deps = {}) {
  requireOpponent(opponent);
  const names = requireFull(members);
  requireMember(names, nikke);
  const entry = entryOf(account, nikke);
  const state = overloadState(entry);
  if (state.status === 'aggregate' || state.status === 'unreadable') {
    throw new InputError('오버로드를 바꿔 볼 수 없다', [{ path: `/nikkes/${nikke}/overload`, message: state.reason }]);
  }
  const built = overloadFromParts(parts);
  if (built.problems.length) throw new InputError('오버로드 옵션이 잘못됐다', built.problems.map((message) => ({ path: '/parts', message })));
  const catalog = await engineAccess(deps).catalog();

  const name = `${nikke} 오버로드 바꿔 보기`;
  const report = await compareGrowth(
    { account, condition: opponent.condition, squad: { name: SQUAD, members: names }, upgrades: [{ name, nikke, set: { overload: built.overload } }] },
    { ...deps, catalog },
  );
  const done = report.ranking[0] ?? null;
  const rejected = report.rejected[0] ?? null;
  const failed = report.failed[0] ?? null;
  const before = report.baseline.total_damage;
  // 옵션별 줄 레벨이 지금과 같으면(표기만 다른 것 포함) 달라지는 것이 없다.
  const sameLines = JSON.stringify(overloadSummary(state.lines)) === JSON.stringify(overloadSummary(built.lines));
  let outcome;
  if (sameLines || (rejected && rejected.reasons.some((r) => r.startsWith('현재 상태와 같다')))) {
    outcome = { status: 'same', total_after: before, gain: 0, gain_rate: before > 0 ? 0 : null, members: report.baseline.members.map((m) => ({ ...m, gain: 0 })), engine_warnings: [], reason: '지금 계정의 옵션과 같다 — 달라지는 것이 없다.' };
  } else if (done) {
    outcome = { status: 'computed', total_after: done.total_after, gain: done.gain, gain_rate: done.gain_rate, members: done.members, engine_warnings: done.engine_warnings, reason: null };
  } else {
    // 계산하지 못한 것은 0이 아니다.
    outcome = { status: 'failed', total_after: null, gain: null, gain_rate: null, members: [], engine_warnings: [], reason: rejected ? rejected.reasons.join(' / ') : errorText(failed?.error) };
  }
  return {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    kind: 'overload_trial',
    generated_at: report.generated_at,
    key: overloadTrialKey(names, opponent.key, nikke, built.lines),
    account: report.account,
    opponent: opponentBrief(opponent),
    members: names,
    nikke,
    before: { status: state.status, options: overloadSummary(state.lines), count: state.lines.length },
    after: { options: overloadSummary(built.lines), count: built.count },
    total_before: before,
    ...outcome,
    notes: [...built.notes, ...(done?.notes ?? []), ...(state.status === 'unknown' ? [state.reason] : [])],
    assumptions: report.assumptions,
    engine: report.engine,
    cache: report.cache,
    caveats: [
      '계정은 바뀌지 않는다 — 여기서만 바꿔 본 값이다.',
      CAVEAT_ESTIMATE,
      '어느 부위에 어느 옵션이 붙었는지는 계정 정보에 없다. 계산은 옵션별 줄 수와 줄 레벨만 쓴다 — 같은 줄을 다른 부위로 옮겨도 총딜은 같다.',
      `줄 수만 적힌 줄은 레벨 ${DEFAULT_LINE_LEVEL}으로 본다(계산 도구가 줄 수만 받았을 때 쓰는 레벨).`,
      '장비의 등급·강화는 그대로 두고 옵션만 바꿨다. 옵션을 얻는 데 드는 재화와 확률은 모른다.',
      CAVEAT_ONE_SQUAD,
      ...(opponent.notes ?? []),
      ...keptCaveats(report),
    ],
  };
}

// ── 큐브 ──────────────────────────────────────────────────────────────────────

/**
 * 니케가 지금 끼고 있는 것으로 계산되는 큐브. 계정에 적혀 있으면 그것(`source: 'account'`), 없으면 엔진의 기본 큐브다
 * (`source: 'default'` — 계정을 받을 때 니케별 큐브는 옮기지 않는다: 엔진 문서 HARNESS.md 「큐브 — API가 장착 중인 것만 준다」).
 */
export function currentCube(entry) {
  const written = unknownOf(entry).includes('cube') ? undefined : entry?.cube;
  if (isText(written)) return { name: written, level: ENGINE_DEFAULT_CUBE.level, source: 'account' };
  if (isPlainObject(written) && isText(written.name)) {
    return { name: written.name, level: isPositiveInt(written.level) ? written.level : ENGINE_DEFAULT_CUBE.level, source: 'account' };
  }
  return { ...ENGINE_DEFAULT_CUBE, source: 'default' };
}

/**
 * 니케마다 바꿔 볼 큐브를 업그레이드 후보로 만든다: 엔진이 효과를 계산하는 큐브 가운데 지금 낀 것이 아닌 것.
 * 레벨은 지금 낀 큐브의 레벨로 맞춘다(그 큐브의 최대 레벨을 넘지 않게) — 큐브 종류만 견주려는 것이다.
 * 순서는 큐브(표의 순서) → 편성의 자리 순서다. `limit`에 걸리면 큐브를 통째로 뒤에서부터 뺀다(니케마다 같은 큐브들을 견준다).
 *
 * @param {{account: object, members: (string|null)[], catalog: object, only?: string|null, limit?: number}} input
 * @returns {{known: boolean, targets: string[], current: Record<string, object>, candidates: object[], skipped_cubes: string[], skipped: number, unsupported: string[]}}
 */
export function cubeCandidates({ account, members, catalog, only = null, limit = DEFAULT_CUBE_LIMIT }) {
  const list = cubeList(catalog);
  const targets = filledMembers(members).filter((name) => (only === null || only === undefined || name === only) && entryOf(account, name));
  const current = Object.fromEntries(targets.map((name) => [name, currentCube(entryOf(account, name))]));
  const unsupported = list.unsupported.map((c) => c.name);
  if (!list.known || targets.length === 0) return { known: list.known, targets, current, candidates: [], skipped_cubes: [], skipped: 0, unsupported };
  const perCube = Math.max(1, targets.length);
  const cap = Math.max(1, Math.floor((isPositiveInt(limit) ? limit : DEFAULT_CUBE_LIMIT) / perCube));
  const pairs = (cubes) => cubes.flatMap((cube) => targets.filter((nikke) => current[nikke].name !== cube.name).map((nikke) => ({ cube, nikke })));
  const candidates = pairs(list.supported.slice(0, cap)).map(({ cube, nikke }) => {
    const level = Math.min(current[nikke].level, cube.max_level);
    const id = `${nikke} · 큐브 ${cube.name}`;
    return { id, nikke, cube: cube.name, level, upgrade: { name: id, nikke, set: { cube: { name: cube.name, level } } } };
  });
  const rest = list.supported.slice(cap);
  return { known: true, targets, current, candidates, skipped_cubes: rest.map((c) => c.name), skipped: pairs(rest).length, unsupported };
}

/**
 * 니케마다 큐브를 하나씩 바꿔 본 총딜과, 니케마다 가장 좋았던 큐브를 함께 끼운 「이 편성에 맞는 큐브」.
 * 엔진 요청은 기준 1건 + 바꿔 본 수(+ 추천이 둘 이상 바뀌면 함께 끼운 1건)다.
 *
 * @param {{account: object, opponent: object, members: (string|null)[]}} input
 * @param {{limit?: number, only?: string|null}} [options] 한 번에 계산할 수의 상한(기본 80), 한 니케만 볼 때 그 이름
 * @param {object} [deps] compareGrowth와 같다
 * @returns {Promise<object>} docs/data-model.md §육성 효율표 §큐브
 */
export async function compareCubes({ account, opponent, members }, options = {}, deps = {}) {
  requireOpponent(opponent);
  const names = requireFull(members);
  const limit = limitOf(options, DEFAULT_CUBE_LIMIT);
  const only = options.only ?? null;
  if (only !== null) requireMember(names, only, '/only');
  const catalog = await engineAccess(deps).catalog();
  const made = cubeCandidates({ account, members: names, catalog, only, limit });
  if (!made.known) throw new InputError('큐브 목록이 없다', [{ path: '/catalog/cubes', message: '계산 도구에서 큐브 목록을 읽지 못했다 — 큐브를 바꿔 볼 수 없다' }]);
  if (made.candidates.length === 0) throw new InputError('바꿔 볼 큐브가 없다', [{ path: '/catalog/cubes', message: '계산 도구가 효과를 계산하는 다른 큐브가 없다' }]);

  const squad = { name: SQUAD, members: names };
  const byId = new Map(made.candidates.map((c) => [c.id, c]));
  const report = await compareGrowth({ account, condition: opponent.condition, squad, upgrades: made.candidates.map((c) => c.upgrade) }, { ...deps, catalog });
  const before = report.baseline.total_damage;
  const observed = isPlainObject(account?.account?.cubes) ? account.account.cubes : {};
  const ownedLevel = (cube) => (isPositiveInt(observed[cube]) ? observed[cube] : null);

  const failed = [
    ...report.rejected.map((r) => ({ nikke: byId.get(r.name).nikke, cube: byId.get(r.name).cube, reason: r.reasons.join(' / ') })),
    ...report.failed.map((f) => ({ nikke: byId.get(f.name).nikke, cube: byId.get(f.name).cube, reason: errorText(f.error) })),
  ];
  // 순위는 총딜이 큰 순(같으면 후보 순서 — 안정 정렬)이라 니케별로 걸러도 순서가 정해져 있다.
  const nikkes = made.targets.map((nikke) => {
    const rows = report.ranking
      .filter((r) => byId.get(r.name).nikke === nikke)
      .map((r) => {
        const c = byId.get(r.name);
        return { cube: c.cube, level: c.level, total_damage: r.total_after, gain: r.gain, change: r.gain_rate, owned_level: ownedLevel(c.cube), engine_warnings: r.engine_warnings };
      });
    const top = rows[0] ?? null;
    // 지금 큐브보다 총딜이 큰 것이 있을 때만 바꾸라고 한다.
    const best = top && top.gain > 0 ? top : null;
    return { nikke, current: { ...made.current[nikke], owned_level: ownedLevel(made.current[nikke].name) }, rows, best: best ? { cube: best.cube, level: best.level, change: best.change } : null };
  });

  // 이 편성에 맞는 큐브: 니케마다 가장 좋았던 큐브(없으면 지금 그대로). 둘 이상 바뀌면 함께 끼운 것을 한 번 더 계산한다.
  const picks = nikkes.map((n) => ({
    nikke: n.nikke,
    cube: n.best?.cube ?? n.current.name,
    level: n.best?.level ?? n.current.level,
    changed: n.best !== null,
    alone_change: n.best?.change ?? null,
    owned_level: ownedLevel(n.best?.cube ?? n.current.name),
  }));
  const changed = picks.filter((p) => p.changed);
  let together = { status: 'unchanged', total_damage: before, gain: 0, gain_rate: before > 0 ? 0 : null, reason: null };
  let cache = report.cache;
  if (changed.length === 1) {
    const row = nikkes.find((n) => n.nikke === changed[0].nikke).rows[0];
    together = { status: 'computed', total_damage: row.total_damage, gain: row.gain, gain_rate: row.change, reason: null };
  } else if (changed.length > 1) {
    const name = '추천 큐브를 함께';
    const again = await compareGrowth(
      { account, condition: opponent.condition, squad, upgrades: [{ name, changes: changed.map((p) => ({ nikke: p.nikke, set: { cube: { name: p.cube, level: p.level } } })) }] },
      { ...deps, catalog },
    );
    const row = again.ranking[0] ?? null;
    if (row) together = { status: 'computed', total_damage: row.total_after, gain: row.gain, gain_rate: row.gain_rate, reason: null };
    else together = { status: 'failed', total_damage: null, gain: null, gain_rate: null, reason: again.rejected[0]?.reasons.join(' / ') ?? errorText(again.failed[0]?.error) };
    if (cache && again.cache) {
      cache = { hits: cache.hits + again.cache.hits, misses: cache.misses + again.cache.misses, stored: cache.stored + again.cache.stored, warnings: [...cache.warnings, ...again.cache.warnings] };
    }
  }

  const levels = [...new Set(made.candidates.map((c) => c.level))].sort((a, b) => a - b);
  const caveats = [
    '보유 큐브는 모른다 — 계정 정보에는 계정을 받을 때 끼고 있던 큐브와 그 레벨만 있다. 추천한 큐브를 갖고 있는지, 몇 레벨인지는 직접 확인한다.',
    `큐브의 종류만 견줬다: 바꿔 본 큐브는 지금 낀 큐브와 같은 레벨(Lv.${levels.join('·')})로 계산했다. 실제 보유 레벨이 낮으면 차이가 줄거나 뒤집힐 수 있다.`,
    `계정에 니케의 큐브가 적혀 있지 않으면 계산 도구의 기본 큐브(${ENGINE_DEFAULT_CUBE.name} Lv.${ENGINE_DEFAULT_CUBE.level})를 낀 것으로 계산한다 — 계정을 받을 때 니케별 큐브는 옮기지 않는다.`,
    '한 큐브를 몇 명이 함께 낄 수 있는지는 이 앱이 모른다 — 같은 큐브가 여러 니케에게 추천될 수 있다.',
    '니케마다 큐브 하나씩만 바꿔 본 값이다. 「함께 끼우면」은 니케마다 가장 좋았던 것을 한꺼번에 끼워 한 번 더 계산한 값이고, 모든 조합을 본 것이 아니다.',
    CAVEAT_ESTIMATE,
    CAVEAT_ONE_SQUAD,
  ];
  if (made.unsupported.length) caveats.push(`지원하지 않음: ${made.unsupported.join(', ')} — 계산 도구가 효과를 계산하지 못하는 큐브라 견주지 않았다.`);
  if (made.skipped_cubes.length) caveats.push(`한 번에 ${limit}건까지만 계산한다. 보지 못한 큐브 ${made.skipped_cubes.length}종: ${made.skipped_cubes.join(', ')} — 니케 한 명만 골라 다시 보면 더 많이 견준다.`);
  if (failed.length) caveats.push(`계산하지 못한 것 ${failed.length}건 — 0으로 두지 않고 뺐다.`);
  return {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    kind: 'cube_report',
    generated_at: report.generated_at,
    key: deckKey(names, opponent.key),
    only,
    account: report.account,
    opponent: opponentBrief(opponent),
    members: names,
    baseline: baselineOf(report),
    nikkes,
    recommendation: { picks, ...together },
    failed,
    skipped_cubes: made.skipped_cubes,
    unsupported: made.unsupported,
    candidates: { total: made.candidates.length + made.skipped, limit, computed: report.ranking.length, failed: failed.length, skipped: made.skipped },
    assumptions: report.assumptions,
    engine: report.engine,
    cache,
    caveats: [...caveats, ...(opponent.notes ?? []), ...keptCaveats(report)],
  };
}
