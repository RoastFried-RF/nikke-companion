// 계정 상태 — 보유 니케와 투자 상태. 형식 설명은 docs/data-model.md.
//
// `nikkes`에 있는 이름이 보유 니케다. 각 항목의 육성 칸은 엔진 프로필 칸과 이름·표기가 같다
// (vendor/nikke-calc/docs/SIM-JSON.md §육성). 적지 않은 칸은 미육성 값으로 계산한다(toEngineEntry가 채운다).
// `unknown`에는 아직 확인하지 못한 칸 이름을 적는다 — 결과에 "미확인"으로 드러난다.

export const ACCOUNT_SCHEMA_VERSION = 1;

/** 엔진에 그대로 넘기는 육성 칸. */
export const GROWTH_FIELDS = [
  'skill_levels', 'overload', 'breakthrough', 'core_enhancement', 'affinity',
  'collection_stage', 'favorite_stage', 'equip_skills', 'equipment', 'console', 'cube',
];
const META_FIELDS = ['unknown', 'note'];

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * 계정 문서를 검사한다. 엔진이 더 자세히 보는 칸(오버로드 옵션 이름 등)은 여기서 다시 검사하지 않고
 * 엔진 오류를 그대로 전달한다 — 같은 규칙을 두 곳에 적지 않기 위해서다.
 * @returns {{ok: boolean, errors: {path: string, message: string}[], warnings: string[]}}
 */
export function validateAccount(account, catalog) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });

  if (account === null || typeof account !== 'object' || Array.isArray(account)) {
    return { ok: false, errors: [{ path: '', message: '계정 문서는 객체여야 한다' }], warnings };
  }
  if (account.schema_version !== ACCOUNT_SCHEMA_VERSION) {
    err('/schema_version', `schema_version은 ${ACCOUNT_SCHEMA_VERSION}이어야 한다`);
  }
  if (typeof account.is_test_data !== 'boolean') {
    err('/is_test_data', '검증용 데이터인지 실제 계정인지 true/false로 밝혀야 한다');
  }
  if (account.nikkes === null || typeof account.nikkes !== 'object' || Array.isArray(account.nikkes)) {
    err('/nikkes', 'nikkes는 {니케 이름: 육성 상태} 객체여야 한다');
    return { ok: false, errors, warnings };
  }
  for (const [name, entry] of Object.entries(account.nikkes)) {
    const base = `/nikkes/${name}`;
    if (!(name in catalog.nikkes)) {
      err(base, `엔진이 모르는 니케다 — 정식 명칭인지 확인하라`);
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      err(base, '육성 상태는 객체여야 한다');
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!GROWTH_FIELDS.includes(key) && !META_FIELDS.includes(key)) err(`${base}/${key}`, '모르는 칸이다');
    }
    if ('skill_levels' in entry) {
      const s = entry.skill_levels;
      if (!Array.isArray(s) || s.length !== 3 || !s.every((v) => isInt(v, 1, 10))) {
        err(`${base}/skill_levels`, '스킬 레벨은 [1~10, 1~10, 1~10]이어야 한다');
      }
    }
    if ('breakthrough' in entry && !isInt(entry.breakthrough, 0, 3)) err(`${base}/breakthrough`, '돌파는 0~3');
    if ('core_enhancement' in entry && !isInt(entry.core_enhancement, 0, 7)) err(`${base}/core_enhancement`, '코어 강화는 0~7');
    if ('affinity' in entry && !isInt(entry.affinity, 1, 40)) err(`${base}/affinity`, '호감도는 1~40');
    if ('favorite_stage' in entry && !isInt(entry.favorite_stage, 0, 3)) err(`${base}/favorite_stage`, '애장품 단계는 0~3');
    if ('unknown' in entry) {
      const u = entry.unknown;
      if (!Array.isArray(u) || !u.every((k) => GROWTH_FIELDS.includes(k))) {
        err(`${base}/unknown`, `unknown에는 육성 칸 이름만 적는다: ${GROWTH_FIELDS.join(', ')}`);
      } else {
        const both = u.filter((k) => k in entry);
        if (both.length) err(`${base}/unknown`, `값을 적은 칸을 미확인으로 표시했다: ${both.join(', ')}`);
      }
    }
  }
  if (account.is_test_data === true) warnings.push('검증용 데이터다 — 실제 계정이 아니다');
  return { ok: errors.length === 0, errors, warnings };
}

export function ownedNames(account) {
  return Object.keys(account.nikkes);
}

/** 이 니케에서 값이 없는 것으로 계산되는 칸 — 명시적 미확인과 그냥 비워 둔 칸을 구분해 돌려준다. */
export function unconfirmedFields(account, name) {
  return account.nikkes[name]?.unknown ?? [];
}

// 오버로드 옵션의 엔진 키 ↔ 인게임 이름(vendor/nikke-calc/docs/SIM-JSON.md §육성).
export const OVERLOAD_OPTIONS = {
  atk_pct: '공격력',
  element_bonus: '우월 코드 대미지',
  max_ammo_pct: '최대 장탄 수',
  crit_rate: '크리티컬 확률',
  crit_dmg: '크리티컬 대미지',
  charge_speed_pct: '차지 속도',
  charge_dmg_pct: '차지 대미지',
  accuracy_pct: '명중률',
  def_pct: '방어력',
};

/** 오버로드 옵션 이름 → 엔진 키. 공백은 무시하고, 앞부분만 적어도 하나로 정해지면 받는다. 못 정하면 null. */
export function overloadOptionId(name) {
  const s = String(name).replace(/\s+/g, '');
  if (s === '') return null;
  if (Object.hasOwn(OVERLOAD_OPTIONS, s)) return s;
  const hits = Object.entries(OVERLOAD_OPTIONS).filter(([, ko]) => ko.replace(/\s+/g, '').startsWith(s));
  return hits.length === 1 ? hits[0][0] : null;
}

// 미육성 값 — 엔진 `runner/spec.py`의 UNGROWN과 같다. 엔진 서브모듈을 올릴 때 함께 확인한다
// (tests/integration/compare.engine.test.mjs가 실제 엔진의 미육성 결과와 대조한다).
const UNGROWN = {
  breakthrough: 0,
  core_enhancement: 0,
  affinity: 1,
  skill_levels: [1, 1, 1],
  collection_stage: '없음',
  favorite_stage: 0,
};
const NO_EQUIPMENT = Object.fromEntries(['머리', '몸통', '팔', '다리'].map((part) => [part, { tier: '없음' }]));
const hasLines = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'number' && v > 0);

/**
 * 계정의 니케 항목 하나를 엔진 프로필 항목으로 바꾼다.
 *
 * 엔진은 프로필에 **항목이 있는** 니케의 적지 않은 칸을 미육성이 아니라 기본 스펙(돌파 3 · 스킬 10/10/10 ·
 * 오버로드 장비 등)으로 계산한다. 그대로 넘기면 비워 둔 칸·미확인 칸이 만렙으로 계산되므로,
 * 적지 않은 칸을 여기서 미육성 값으로 채운다.
 *   - 오버로드: 적지 않은 옵션은 0줄.
 *   - 장비: 적지 않았고 오버로드 줄도 없으면 미장착. 오버로드 줄을 적었으면 엔진 기본 오버로드 장비.
 */
export function toEngineEntry(entry) {
  const growth = Object.fromEntries(Object.entries(entry).filter(([k]) => GROWTH_FIELDS.includes(k)));
  const out = { ...UNGROWN, ...growth };
  const covered = new Set([
    ...Object.keys(growth.overload ?? {}).map(overloadOptionId),
    ...Object.keys(growth.equip_skills ?? {}),
  ]);
  out.overload = { ...(growth.overload ?? {}) };
  for (const id of Object.keys(OVERLOAD_OPTIONS)) if (!covered.has(id)) out.overload[id] = 0;
  const invested = [...Object.values(growth.overload ?? {}), ...Object.values(growth.equip_skills ?? {})].some(hasLines);
  if (!('equipment' in growth) && !invested) out.equipment = NO_EQUIPMENT;
  return out;
}

/**
 * 엔진 인라인 프로필을 만든다. 편성에 들어간 니케만 싣는다.
 * base는 항상 "ungrown" — 프로필에 없는 이름이 만렙 가상 캐릭터로 계산되는 일이 없게 한다.
 */
export function toEngineProfile(account, names) {
  const chars = {};
  for (const name of names) {
    const entry = account.nikkes[name];
    if (!entry) continue;
    chars[name] = toEngineEntry(entry);
  }
  const profile = { base: 'ungrown', chars, _meta: { name: account.name ?? '계정' } };
  if (account.account?.console) profile._account = { console: account.account.console };
  return profile;
}
