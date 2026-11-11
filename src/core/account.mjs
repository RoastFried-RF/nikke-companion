// 계정 상태 — 보유 니케와 투자 상태. 형식 설명은 docs/data-model.md.
//
// `nikkes`에 있는 이름이 보유 니케다. 각 항목의 육성 칸은 엔진 프로필 칸과 이름·표기가 같다
// (vendor/nikke-calc/docs/SIM-JSON.md §육성). 적지 않은 칸은 엔진이 미육성 값으로 계산한다.
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

/**
 * 엔진 인라인 프로필을 만든다. 편성에 들어간 니케만 싣는다.
 * base는 항상 "ungrown" — 프로필에 없는 이름이 만렙 가상 캐릭터로 계산되는 일이 없게 한다.
 */
export function toEngineProfile(account, names) {
  const chars = {};
  for (const name of names) {
    const entry = account.nikkes[name];
    if (!entry) continue;
    chars[name] = Object.fromEntries(Object.entries(entry).filter(([k]) => GROWTH_FIELDS.includes(k)));
  }
  const profile = { base: 'ungrown', chars, _meta: { name: account.name ?? '계정' } };
  if (account.account?.console) profile._account = { console: account.account.console };
  return profile;
}
