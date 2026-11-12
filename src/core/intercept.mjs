// 요격전(이상 개체 요격전) 보스별 편성 추천: 계정 + 보스 묶음 → 보스마다 추천(suggestSquads) → 보스별 상위 편성.
// 형식 설명은 docs/data-model.md §보스 묶음·§요격전 추천 결과. 게임에서 확인한 사실과 모르는 것은 docs/intercept.md.
//
// 엔진(vendor/nikke-calc)에는 요격전 보스 프리셋이 없다(data/boss_presets.json은 솔로 레이드 S40뿐). 그래서 보스를
// 전투 조건의 적 설정(enemy)으로 표현한다. **확인된 칸만 넣는다** — 확인하지 못한 칸은 비워 엔진 기본 적 값으로
// 계산하고, 무엇이 미확인이고 무엇으로 계산했는지를 결과에 붙인다. 미확인을 0이나 확정값처럼 다루지 않는다.
import { validateAccount } from './account.mjs';
import { DEFAULT_PRIORITY_MIN, suggestSquads } from './candidates.mjs';
import { CAVEAT_NOT_VERIFIED, InputError } from './compare.mjs';
import { CONDITION_SCHEMA_VERSION, DEFAULT_DURATION, ENEMY_KEYS, ENGINE_FIXED_LEVEL, LEVEL_MAX, levelPlan } from './condition.mjs';
import { excludeNikkes, isExcludeList } from './exclude.mjs';
import { groupThousands } from './format.mjs';
import { engineAccess } from './runtime.mjs';

export const BOSS_BUNDLE_SCHEMA_VERSION = 1;
export const INTERCEPT_REPORT_SCHEMA_VERSION = 1;
/** 보스 묶음의 content. 전투 조건의 content와 같은 낱말이다(src/core/condition.mjs의 CONTENTS). */
export const INTERCEPT_CONTENTS = Object.freeze(['anomaly_interception', 'interception']);
export const CONTENT_LABELS = Object.freeze({ anomaly_interception: '이상 개체 요격전', interception: '요격전' });
export const DEFAULT_INTERCEPT_TOP = 3;
export const DEFAULT_INTERCEPT_BUDGET = 300;

/**
 * 속성 상성 — **엔진의 규칙을 옮겨 적은 것이다.** 정본: `vendor/nikke-calc/calculator/damage.py`의 `_CODE_ADVANTAGE`
 * (키 속성이 값 속성에 우월하다. `is_element_match(캐릭터 코드, 적 코드)`가 이 표로 우월 코드 보너스를 정한다).
 * 엔진 서브모듈을 올릴 때 함께 확인한다 — tests/integration/intercept.engine.test.mjs가 엔진의 표와 대조한다.
 * 작열 → 풍압 → 철갑 → 전격 → 수냉 → 작열(앞이 뒤에 우월).
 */
export const ELEMENT_ADVANTAGE = Object.freeze({ 전격: '수냉', 수냉: '작열', 작열: '풍압', 풍압: '철갑', 철갑: '전격' });
export const ELEMENTS = Object.freeze(Object.keys(ELEMENT_ADVANTAGE));
const WEAPON_TYPES = ['AR', 'SR', 'SMG', 'SG', 'MG', 'RL'];

/** 이 속성(`weak`)에 약한 적의 속성 — `weak`가 우월한 상대. 모르는 속성이면 null. */
export const codeWeakTo = (weak) => (Object.hasOwn(ELEMENT_ADVANTAGE, weak) ? ELEMENT_ADVANTAGE[weak] : null);
/** 이 속성(`code`)의 적이 약한 속성 — `code`에 우월한 속성. 모르는 속성이면 null. */
export const weaknessOf = (code) => ELEMENTS.find((e) => ELEMENT_ADVANTAGE[e] === code) ?? null;

/**
 * 적지 않은 적 칸을 엔진이 무엇으로 계산하는가 — **엔진의 기본 적을 옮겨 적은 것이다.**
 * 정본: `vendor/nikke-calc/calculator/timeline.py`의 `DEFAULT_ENEMY`. 통합 테스트가 엔진 결과의 `boss`(실제로 적용된 적)와 대조한다.
 * `code: null` = 속성 없음 — 어느 니케에도 우월 코드 보너스가 붙지 않는다.
 */
export const ENGINE_ENEMY_DEFAULTS = Object.freeze({
  def: 31784,
  code: null,
  core_px: 0,
  distance: null,
  has_parts: false,
  part_break_interval: 0,
  optimal_range_weapons: Object.freeze([]),
});

/** 확인 여부를 적어야 하는 칸(계산에 쓰이는 값)과 사람이 읽는 이름. `enemy` 안의 칸과 보스 항목의 칸이 섞여 있다. */
export const TRACKED_FIELDS = Object.freeze({
  code: '보스 속성',
  weak_to: '약점',
  level_cap: '레벨 상한',
  duration: '전투 시간',
  def: '방어력',
  core_px: '코어',
  distance: '교전 거리',
  has_parts: '파츠',
  part_break_interval: '파츠 파괴 주기',
  optimal_range_weapons: '적정 거리 무기군',
});
const TRACKED = Object.keys(TRACKED_FIELDS);
const BUNDLE_KEYS = ['schema_version', 'content', 'is_test_data', 'name', 'version', 'source', 'note', 'updated_at', 'bosses'];
const BOSS_KEYS = ['id', 'name', 'enemy', 'weak_to', 'level_cap', 'duration', 'reward', 'source', 'confirmation', 'note'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
const nonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** 보스 항목에서 추적 칸의 값. 적 칸은 `enemy` 안에 있다. 적지 않았으면 undefined. */
function fieldValue(boss, field) {
  return ENEMY_KEYS.includes(field) ? (isPlainObject(boss.enemy) ? boss.enemy[field] : undefined) : boss[field];
}

/**
 * 보스 묶음 문서를 검사한다. 오류는 한국어 문장과 JSON 경로로 돌려준다.
 *
 * 값의 형·범위는 엔진 요청 스키마(vendor/nikke-calc/runner/request.py의 `enemy`)와 같게 본다.
 * 확인 여부(`confirmation`): 추적 칸(TRACKED_FIELDS)은 빠짐없이 `confirmed`(값이 있다)나 `unconfirmed`(값이 없다)
 * 한쪽에 적혀야 한다 — 값을 적고 미확인이라 하거나, 값 없이 확인됐다 하거나, 어느 쪽에도 적지 않으면 오류다.
 * 약점과 보스 속성을 둘 다 적었으면 엔진의 속성 상성 규칙(ELEMENT_ADVANTAGE)과 맞아야 한다.
 * @returns {{ok: boolean, errors: {path: string, message: string}[], warnings: string[]}}
 */
export function validateBossBundle(bundle) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });

  if (!isPlainObject(bundle)) return { ok: false, errors: [{ path: '', message: '보스 묶음은 객체여야 한다' }], warnings };
  for (const k of Object.keys(bundle)) if (!BUNDLE_KEYS.includes(k)) err(`/${k}`, '모르는 칸이다');
  if (bundle.schema_version !== BOSS_BUNDLE_SCHEMA_VERSION) err('/schema_version', `schema_version은 ${BOSS_BUNDLE_SCHEMA_VERSION}이어야 한다`);
  if (!INTERCEPT_CONTENTS.includes(bundle.content)) err('/content', `content는 ${INTERCEPT_CONTENTS.join(' · ')} 중 하나여야 한다`);
  if (typeof bundle.is_test_data !== 'boolean') err('/is_test_data', '검증용 데이터인지 게임에서 확인한 값인지 true/false로 밝혀야 한다');
  if (!isText(bundle.source)) err('/source', '값의 출처를 적어야 한다(어디서 확인했는가)');
  if (!Array.isArray(bundle.bosses) || bundle.bosses.length === 0) {
    err('/bosses', 'bosses는 보스를 하나 이상 담은 배열이어야 한다');
    return { ok: false, errors, warnings };
  }

  const seen = { id: new Map(), name: new Map() };
  for (const [i, boss] of bundle.bosses.entries()) {
    const base = `/bosses/${i}`;
    if (!isPlainObject(boss)) {
      err(base, '보스는 객체여야 한다');
      continue;
    }
    for (const k of Object.keys(boss)) if (!BOSS_KEYS.includes(k)) err(`${base}/${k}`, '모르는 칸이다');
    for (const key of ['id', 'name']) {
      if (!isText(boss[key])) err(`${base}/${key}`, `${key}는 비어 있지 않은 문자열이어야 한다`);
      else if (seen[key].has(boss[key])) err(`${base}/${key}`, `같은 ${key}가 ${seen[key].get(boss[key])}번째 보스에도 있다: ${boss[key]}`);
      else seen[key].set(boss[key], i + 1);
    }
    if (!isText(boss.source)) err(`${base}/source`, '값의 출처를 적어야 한다(어디서 확인했는가)');
    if (boss.reward !== undefined && !isText(boss.reward)) err(`${base}/reward`, '보상은 비어 있지 않은 문자열이어야 한다');

    // ── 적 설정: 엔진 요청의 enemy와 같은 칸·형·범위.
    if (!isPlainObject(boss.enemy)) err(`${base}/enemy`, 'enemy(적 설정)는 객체여야 한다 — 확인한 칸이 없으면 {}');
    else {
      const e = boss.enemy;
      for (const k of Object.keys(e)) if (!ENEMY_KEYS.includes(k)) err(`${base}/enemy/${k}`, `모르는 칸이다. 쓸 수 있는 칸: ${ENEMY_KEYS.join(', ')}`);
      if ('def' in e && !(Number.isInteger(e.def) && e.def >= 0)) err(`${base}/enemy/def`, '방어력은 0 이상의 정수여야 한다');
      if ('code' in e && !ELEMENTS.includes(e.code)) err(`${base}/enemy/code`, `보스 속성은 ${ELEMENTS.join(' · ')} 중 하나여야 한다`);
      if ('core_px' in e && !nonNegative(e.core_px)) err(`${base}/enemy/core_px`, '코어 직경(px)은 0 이상의 수여야 한다');
      if ('distance' in e && !nonNegative(e.distance)) err(`${base}/enemy/distance`, '교전 거리는 0 이상의 수여야 한다');
      if ('has_parts' in e && typeof e.has_parts !== 'boolean') err(`${base}/enemy/has_parts`, '파츠 유무는 true/false여야 한다');
      if ('part_break_interval' in e && !nonNegative(e.part_break_interval)) err(`${base}/enemy/part_break_interval`, '파츠 파괴 주기(초)는 0 이상의 수여야 한다');
      if ('optimal_range_weapons' in e && !(Array.isArray(e.optimal_range_weapons) && e.optimal_range_weapons.every((w) => WEAPON_TYPES.includes(w)))) {
        err(`${base}/enemy/optimal_range_weapons`, `적정 거리 무기군은 ${WEAPON_TYPES.join(' · ')}의 배열이어야 한다`);
      }
    }
    if (boss.weak_to !== undefined && !ELEMENTS.includes(boss.weak_to)) err(`${base}/weak_to`, `약점은 ${ELEMENTS.join(' · ')} 중 하나여야 한다`);
    if (boss.level_cap !== undefined && !(Number.isInteger(boss.level_cap) && boss.level_cap >= 1 && boss.level_cap <= LEVEL_MAX)) {
      err(`${base}/level_cap`, `레벨 상한은 1~${LEVEL_MAX}의 정수여야 한다`);
    }
    if (boss.duration !== undefined && !(typeof boss.duration === 'number' && Number.isFinite(boss.duration) && boss.duration > 0)) {
      err(`${base}/duration`, '전투 시간(초)은 0보다 커야 한다');
    }

    // ── 약점 ↔ 보스 속성: 약점은 보스 속성에 우월한 속성이어야 한다(엔진의 속성 상성 규칙).
    const code = isPlainObject(boss.enemy) ? boss.enemy.code : undefined;
    if (ELEMENTS.includes(boss.weak_to) && ELEMENTS.includes(code) && codeWeakTo(boss.weak_to) !== code) {
      err(
        `${base}/weak_to`,
        `약점(${boss.weak_to})이 보스 속성(${code})에 우월한 속성이 아니다 — 엔진의 속성 상성 규칙으로는 ${code} 보스의 약점은 ${weaknessOf(code)}, ` +
          `${boss.weak_to}에 약한 보스의 속성은 ${codeWeakTo(boss.weak_to)}`,
      );
    }

    // ── 확인 여부.
    const conf = boss.confirmation;
    if (!isPlainObject(conf)) {
      err(`${base}/confirmation`, `confirmation은 {confirmed: [칸], unconfirmed: [칸]} 객체여야 한다. 칸: ${TRACKED.join(', ')}`);
      continue;
    }
    for (const k of Object.keys(conf)) if (!['confirmed', 'unconfirmed'].includes(k)) err(`${base}/confirmation/${k}`, '모르는 칸이다');
    let listsOk = true;
    for (const key of ['confirmed', 'unconfirmed']) {
      const list = conf[key];
      if (!Array.isArray(list) || !list.every((f) => TRACKED.includes(f))) {
        err(`${base}/confirmation/${key}`, `${key}에는 칸 이름만 적는다: ${TRACKED.join(', ')}`);
        listsOk = false;
      } else if (new Set(list).size !== list.length) {
        err(`${base}/confirmation/${key}`, '같은 칸을 두 번 적었다');
        listsOk = false;
      }
    }
    if (!listsOk) continue;
    for (const field of TRACKED) {
      const has = fieldValue(boss, field) !== undefined;
      const inConfirmed = conf.confirmed.includes(field);
      const inUnconfirmed = conf.unconfirmed.includes(field);
      const label = `${TRACKED_FIELDS[field]}(${field})`;
      if (inConfirmed && inUnconfirmed) err(`${base}/confirmation`, `${label}을(를) 확인됨과 미확인에 함께 적었다`);
      else if (inConfirmed && !has) err(`${base}/confirmation/confirmed`, `${label}을(를) 확인됨으로 적었지만 값이 없다`);
      else if (inUnconfirmed && has) err(`${base}/confirmation/unconfirmed`, `${label}을(를) 미확인으로 적었지만 값이 있다 — 확인하지 않은 값은 넣지 않는다`);
      else if (!inConfirmed && !inUnconfirmed) {
        err(`${base}/confirmation`, has ? `${label}에 값이 있는데 확인 여부를 적지 않았다 — confirmed에 적어라` : `${label}의 확인 여부를 적지 않았다 — 값을 모르면 unconfirmed에 적어라`);
      }
    }
  }
  if (bundle.is_test_data === true) warnings.push('검증용 보스 묶음이다 — 게임에서 확인한 값이 아니다');
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 보스의 속성과 약점을 정한다. 한쪽만 적혀 있으면 다른 쪽을 엔진의 속성 상성 규칙으로 유도한다
 * (`weak_to`만 있는 보스의 적 속성 = 그 약점이 우월한 상대). 둘 다 없으면 둘 다 null — 속성 상성을 반영할 수 없다.
 * @returns {{code: string|null, code_source: 'bundle'|'weak_to'|null, weak_to: string|null, weak_to_source: 'bundle'|'code'|null, reflected: boolean}}
 */
export function resolveElement(boss) {
  const given = boss?.enemy?.code ?? null;
  const weak = boss?.weak_to ?? null;
  const code = given ?? (weak ? codeWeakTo(weak) : null);
  const weakTo = weak ?? (given ? weaknessOf(given) : null);
  return {
    code,
    code_source: given ? 'bundle' : code ? 'weak_to' : null,
    weak_to: weakTo,
    weak_to_source: weak ? 'bundle' : weakTo ? 'code' : null,
    reflected: code !== null,
  };
}

/**
 * 보스 하나 → 전투 조건. 확인된 칸만 싣는다: 적 설정(유도한 속성 포함), 전투 시간, 레벨 상한.
 * 적지 않은 칸은 조건에도 없다 — 엔진 기본값으로 계산된다(무엇인지는 `unconfirmedOf`).
 */
export function bossCondition(boss, content) {
  const enemy = { ...boss.enemy };
  const { code } = resolveElement(boss);
  if (code) enemy.code = code;
  const condition = { schema_version: CONDITION_SCHEMA_VERSION, content };
  if (Object.keys(enemy).length) condition.enemy = enemy;
  if (boss.duration !== undefined) condition.duration = boss.duration;
  if (boss.level_cap !== undefined) condition.level_cap = boss.level_cap;
  return condition;
}

/**
 * 미확인 칸과 그 칸을 무엇으로 계산했는가. 순서는 TRACKED_FIELDS 순서다.
 * `computed_as`는 실제로 계산에 쓴 값(엔진 기본값, 또는 규칙으로 유도한 값), `text`는 사람이 읽는 한 줄이다.
 * 약점은 계산 입력이 아니다(상성은 보스 속성으로 정한다) — 보스 속성에서 유도한 값이나 null을 싣는다.
 * @returns {{field: string, label: string, computed_as: unknown, text: string}[]}
 */
export function unconfirmedOf(boss) {
  const element = resolveElement(boss);
  const d = ENGINE_ENEMY_DEFAULTS;
  const describe = {
    code: () =>
      element.code
        ? { computed_as: element.code, text: `${element.code} — 약점 ${element.weak_to}에서 엔진의 속성 상성 규칙으로 정했다(화면에서 확인한 값이 아니다)` }
        : { computed_as: null, text: '속성 없음(엔진 기본값) — 속성 상성 미반영' },
    weak_to: () =>
      element.weak_to
        ? { computed_as: element.weak_to, text: `${element.weak_to} — 보스 속성 ${element.code}에서 엔진의 속성 상성 규칙으로 정했다(화면에서 확인한 값이 아니다)` }
        : { computed_as: null, text: '모른다 — 속성 상성 미반영' },
    level_cap: () => ({ computed_as: ENGINE_FIXED_LEVEL, text: `상한을 몰라 엔진 정책 fixed(레벨 ${ENGINE_FIXED_LEVEL})로 계산` }),
    duration: () => ({ computed_as: DEFAULT_DURATION, text: `${DEFAULT_DURATION}초(엔진 기본값)` }),
    def: () => ({ computed_as: d.def, text: `${groupThousands(d.def)}(엔진 기본값 — 솔로 레이드 Lv 400 보스 방어력)` }),
    core_px: () => ({ computed_as: d.core_px, text: `코어 없음(엔진 기본값 ${d.core_px})` }),
    distance: () => ({ computed_as: d.distance, text: '거리 없음(엔진 기본값 — 니케별 적정 거리를 따지지 않는다)' }),
    has_parts: () => ({ computed_as: d.has_parts, text: '파츠 없음(엔진 기본값)' }),
    part_break_interval: () => ({ computed_as: d.part_break_interval, text: `파츠 파괴 없음(엔진 기본값 ${d.part_break_interval})` }),
    optimal_range_weapons: () => ({ computed_as: [...d.optimal_range_weapons], text: '적정 거리 보너스 없음(엔진 기본값 — 빈 목록)' }),
  };
  return TRACKED.filter((field) => fieldValue(boss, field) === undefined).map((field) => ({ field, label: TRACKED_FIELDS[field], ...describe[field]() }));
}

/**
 * 전체 시뮬 예산을 보스 수로 나눈다. 합은 정확히 `total`이고, 나머지는 앞 보스부터 한 건씩 받는다.
 * 예산이 보스 수보다 적으면 뒤쪽 보스는 0건이다(계산하지 않는다 — 결과의 caveats에 적힌다).
 */
export function splitBudget(total, count) {
  if (!isPositiveInt(count)) return [];
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

/** `--boss` 선택: id나 이름이 정확히 같은 보스 하나. 주지 않으면 전부. */
export function selectBosses(bundle, selector) {
  if (selector === undefined || selector === null) return bundle.bosses;
  const found = typeof selector === 'string' ? bundle.bosses.filter((b) => b.id === selector || b.name === selector) : [];
  if (found.length === 0) {
    throw new InputError('보스를 찾을 수 없다', [{ path: '/boss', message: `그 이름이나 id의 보스가 없다. 있는 보스: ${bundle.bosses.map((b) => `${b.name}(${b.id})`).join(', ')}` }]);
  }
  return found;
}

function mergeCacheStats(all) {
  const used = all.filter(Boolean);
  if (used.length === 0) return null;
  return {
    hits: used.reduce((s, c) => s + c.hits, 0),
    misses: used.reduce((s, c) => s + c.misses, 0),
    stored: used.reduce((s, c) => s + c.stored, 0),
    warnings: [...new Set(used.flatMap((c) => c.warnings ?? []))],
  };
}

/** 보스별 주의 문장을 하나의 목록으로. 계산한 모든 보스에 공통인 문장은 한 번만, 일부 보스의 것은 `[보스 이름]`을 붙인다. */
function mergeCaveats(items) {
  const where = new Map();
  // 비교 결과의 일반 문장(「실제 게임 기록과 대조하지 않았다」)은 뺀다 — 요격전 쪽의 더 구체적인 문장이 맨 앞에 있다.
  for (const it of items) for (const c of it.caveats) if (c !== CAVEAT_NOT_VERIFIED) where.set(c, [...(where.get(c) ?? []), it.name]);
  return [...where].map(([text, names]) => (names.length === items.length ? text : `[${names.join(', ')}] ${text}`));
}

/**
 * 약점 속성 니케가 후보 풀에 얼마나 들었나. 후보 생성기에 약점 속성을 우선 속성으로 넘기므로(src/core/candidates.mjs)
 * 버스트 단계마다 최소 인원이 풀에 든다. `promoted`는 그 우선 덕에 든 니케(투자 점수만으로는 풀에 없었을 니케)다.
 */
function weakPool(element, account, catalog, suggestion) {
  if (!element.weak_to || !suggestion?.pool) return null;
  const elementOf = (name) => catalog.nikkes[name]?.element_code;
  if (!Object.keys(account.nikkes).some((n) => typeof elementOf(n) === 'string')) return null; // 카탈로그에 속성 정보가 없다
  const owned = Object.keys(account.nikkes).filter((n) => elementOf(n) === element.weak_to).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pooled = new Set(Object.values(suggestion.pool).flat());
  const promoted = new Set(Object.values(suggestion.priority?.promoted ?? {}).flat());
  return {
    element: element.weak_to,
    owned,
    pooled: owned.filter((n) => pooled.has(n)),
    not_pooled: owned.filter((n) => !pooled.has(n)),
    promoted: owned.filter((n) => promoted.has(n)),
  };
}

/**
 * 보스 묶음의 보스마다 보유 니케로 추천(suggestSquads — 멤버 조합 + 배치 탐색 + 캐시)을 돌린다.
 *
 * - 보스마다 후보가 다르다: 그 보스의 약점 속성을 후보 생성의 우선 속성으로 넘긴다(`generateCandidates`의 `priorityElement` —
 *   약점 속성 니케를 단계별 후보 풀에 최소 인원 보장하고 후보 순서에서 앞에 둔다). 적 속성을 모르는 보스는 우선 속성 없이 돌린다.
 * - 전체 시뮬 예산(`budget`, 기본 300)을 계산할 보스 수로 나눠 보스마다 그만큼만 쓴다(`splitBudget`).
 * - 보스마다 총딜 상위 `top`개(기본 3) 편성, 멤버별 딜, 1위 대비 비율.
 * - 미확인 칸이 있는 보스에는 무엇이 미확인이고 무엇으로 계산했는지(`unconfirmed`)가 붙는다. 보스 속성을 모르면
 *   계산은 하되 `flags`에 「속성 상성 미반영」이 붙는다.
 * - 같은 입력이면 `generated_at`·`cache` 말고는 같은 문서가 나온다.
 *
 * @param {{account: object, bundle: object, boss?: string}} input `boss`는 이름이나 id(주지 않으면 전부)
 * @param {{top?: number, budget?: number, exclude?: string[]}} [options] `exclude`(니케 이름의 목록 — P-033의 「안 씀」)를 주면
 *   그 니케들을 뺀 계정으로 모든 보스를 계산하고, 실제로 뺀 것이 있으면 결과에 `excluded`와 caveats 한 줄이 남는다
 *   (주지 않거나 뺀 것이 없으면 결과가 종전과 같다)
 * @param {object} [deps] suggestSquads와 같다. 더해서 `onBoss({index, total, boss: {id, name}, budget})` — 그 보스의 계산 직전에 부른다
 */
export async function recommendIntercept({ account: given, bundle, boss: selector }, options = {}, deps = {}) {
  if (options.exclude !== undefined && !isExcludeList(options.exclude)) {
    throw new InputError('요격전 추천 옵션이 잘못됐다', [{ path: '/exclude', message: 'exclude는 니케 이름의 목록이어야 한다' }]);
  }
  const top = options.top ?? DEFAULT_INTERCEPT_TOP;
  if (!isPositiveInt(top)) throw new InputError('요격전 추천 옵션이 잘못됐다', [{ path: '/top', message: 'top은 1 이상의 정수여야 한다' }]);
  const budget = options.budget ?? DEFAULT_INTERCEPT_BUDGET;
  if (!isPositiveInt(budget)) throw new InputError('요격전 추천 옵션이 잘못됐다', [{ path: '/budget', message: 'budget은 1 이상의 정수여야 한다' }]);

  const v = validateBossBundle(bundle);
  if (!v.ok) throw new InputError('보스 묶음이 잘못됐다', v.errors);
  const engine = engineAccess(deps);
  const catalog = await engine.catalog();
  const a = validateAccount(given, catalog);
  if (!a.ok) throw new InputError('계정 상태가 잘못됐다', a.errors);
  // 뺄 니케(「안 씀」)가 있으면 그 니케들이 없는 계정으로 모든 보스를 계산한다. 받은 계정은 바꾸지 않는다.
  const cut = excludeNikkes(given, options.exclude ?? []);
  const account = cut.account;

  const selected = selectBosses(bundle, selector);
  const shares = splitBudget(budget, selected.length);
  const onBoss = typeof deps.onBoss === 'function' ? deps.onBoss : () => {};

  const bosses = [];
  const caches = [];
  let evaluator = null;
  for (const [i, b] of selected.entries()) {
    const element = resolveElement(b);
    const condition = bossCondition(b, bundle.content);
    const unconfirmed = unconfirmedOf(b);
    const item = {
      id: b.id,
      name: b.name,
      element,
      reward: b.reward ?? null,
      // 레벨: 상한이 확인된 보스는 계정의 동기화 레벨을 상한까지 반영한다(src/core/condition.mjs의 levelPlan).
      level: levelPlan(condition, account),
      duration: condition.duration ?? DEFAULT_DURATION,
      source: b.source,
      condition,
      confirmed: TRACKED.filter((f) => fieldValue(b, f) !== undefined),
      unconfirmed,
      // 표와 화면에서 눈에 띄어야 하는 표시.
      flags: element.reflected ? [] : ['속성 상성 미반영'],
      status: 'computed',
      budget: shares[i],
      sims: 0,
      assumptions: [],
      ranking: [],
      rejected: [],
      failed: [],
      suggestion: null,
      weak_pool: null,
      notes: [],
      caveats: [],
    };
    if (!element.reflected) {
      item.notes.push(
        '속성 상성 미반영 — 보스 속성과 약점을 몰라 적 속성 없이 계산했다. 어느 니케에도 우월 코드 보너스가 붙지 않았다. ' +
          '실제로는 약점 속성 니케의 딜이 더 크므로 순위가 달라질 수 있다.',
      );
    } else if (element.code_source === 'weak_to') {
      item.notes.push(`보스 속성(${element.code})은 화면에서 확인한 값이 아니다 — 약점(${element.weak_to})에서 엔진의 속성 상성 규칙으로 정했다.`);
    }

    if (shares[i] === 0) {
      item.status = 'not_computed';
      item.notes.push(`시뮬 예산 ${budget}건이 보스 ${selected.length}종에 돌아가지 않아 계산하지 못했다.`);
      bosses.push(item);
      continue;
    }

    onBoss({ index: i, total: selected.length, boss: { id: b.id, name: b.name }, budget: shares[i] });
    // 후보 풀을 보스마다 다르게: 이 보스의 약점 속성(보스 속성에 우월한 속성)을 후보 생성의 우선 속성으로 넘긴다.
    // 적 속성을 모르는 보스(`reflected: false`)는 우선 속성 없이 돌린다 — 투자 점수로만 고른 후보다.
    const suggestOptions = { top, budget: shares[i] };
    if (element.reflected && element.weak_to) suggestOptions.priorityElement = element.weak_to;
    const report = await suggestSquads({ account, condition }, suggestOptions, { ...deps, catalog });
    evaluator ??= report.engine ?? null;
    caches.push(report.cache);
    item.sims = report.suggestion.search.sims;
    item.assumptions = report.assumptions;
    item.ranking = report.ranking;
    item.rejected = report.rejected;
    item.failed = report.failed;
    item.suggestion = report.suggestion;
    item.caveats = report.caveats;
    item.weak_pool = weakPool(element, account, catalog, report.suggestion);
    const priority = report.suggestion.priority ?? null;
    if (item.weak_pool?.promoted.length) {
      item.notes.push(
        `약점 속성(${element.weak_to}) 우선으로 후보 풀에 넣은 니케: ${item.weak_pool.promoted.join(', ')} — 투자 점수만으로는 풀에 들지 못했을 니케다.`,
      );
    }
    if (item.weak_pool?.not_pooled.length) {
      item.notes.push(
        `약점 속성(${element.weak_to}) 보유 니케 ${item.weak_pool.owned.length}명 중 ${item.weak_pool.not_pooled.length}명은 후보 풀에 들지 못했다` +
          `(${item.weak_pool.not_pooled.join(', ')}) — 약점 속성 니케는 버스트 단계마다 최소 ${priority?.min_per_stage ?? DEFAULT_PRIORITY_MIN}명까지만 보장한다.`,
      );
    }
    if (priority && priority.owned.length === 0) {
      item.notes.push(`약점 속성(${element.weak_to}) 니케를 보유하지 않았다 — 후보는 투자 점수로만 골랐다.`);
    }
    bosses.push(item);
  }

  const computed = bosses.filter((b) => b.status === 'computed');
  const skipped = bosses.filter((b) => b.status === 'not_computed');
  const noElement = bosses.filter((b) => !b.element.reflected);
  const withUnconfirmed = bosses.filter((b) => b.unconfirmed.some((u) => u.field !== 'weak_to'));
  const used = bosses.reduce((s, b) => s + b.sims, 0);
  const shareText = [...new Set(shares)].length === 1 ? `${shares[0]}건씩` : `${Math.min(...shares)}~${Math.max(...shares)}건씩`;

  const caveats = [
    '수치는 시뮬레이션 추정치다. 실제 요격전 기록과 대조하지 않았다 — 인게임 모의전 대미지와 맞는지 확인된 적이 없다.',
    '보스 패턴 미반영: 무적·보호막·특수 기믹, 단계별 체력은 계산에 없다. 엔진에 요격전 보스 프리셋·패턴 스크립트가 없어 보스를 적 설정(속성·방어력 등)만으로 표현했다.',
  ];
  if (withUnconfirmed.length) {
    caveats.push(
      `미확인 값이 있는 보스 ${withUnconfirmed.length}종(${withUnconfirmed.map((b) => b.name).join(', ')}): 확인하지 못한 칸은 비워 두고 엔진 기본 적 값으로 계산했다 — ` +
        '확정값이 아니다. 실제 방어력·코어·파츠·거리·전투 시간에 따라 총딜과 순위가 달라질 수 있다. 칸별 내용은 보스마다 적혀 있다.',
    );
  }
  if (noElement.length) {
    caveats.push(`속성 상성 미반영: ${noElement.map((b) => b.name).join(', ')} — 보스 속성과 약점을 몰라 우월 코드 보너스 없이 계산했다.`);
  }
  caveats.push(`전체 시뮬 예산 ${budget}건을 보스 ${selected.length}종에 ${shareText} 나눴다(보스마다 그 안에서 멤버 조합 → 배치 순으로 쓴다). 실제로 쓴 것은 ${used}건이다.`);
  if (skipped.length) caveats.push(`시뮬 예산 ${budget}건이 보스 수보다 적어 계산하지 못한 보스: ${skipped.map((b) => b.name).join(', ')}.`);
  caveats.push(
    `후보 편성은 보스마다 다르다: 보스의 약점 속성 니케를 버스트 단계별 후보 풀에 최소 ${DEFAULT_PRIORITY_MIN}명씩 넣고(보유 수가 모자라면 있는 만큼) ` +
      '후보 순서에서도 앞에 둔다 — 덜 키운 약점 속성 니케도 후보에 든다(누가 그렇게 들었는지는 보스마다 적혀 있다). ' +
      '시뮬 예산이 모자라면 후보 순서의 뒤쪽부터 계산하지 않으므로 약점 속성 니케가 든 후보가 먼저 잘리지 않는다. ' +
      '우선은 어림 규칙이다 — 실제 순위는 엔진이 계산한 총딜로 정한다. 적 속성을 모르는 보스는 투자 점수로만 후보를 고른다.',
  );
  caveats.push(...mergeCaveats(computed));
  caveats.push(...v.warnings);
  if (cut.excluded) caveats.push(cut.excluded.text);

  return {
    schema_version: INTERCEPT_REPORT_SCHEMA_VERSION,
    kind: 'intercept_report',
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
    account: { name: account.name ?? null, is_test_data: account.is_test_data, updated_at: account.updated_at ?? null },
    content: bundle.content,
    bundle: {
      name: bundle.name ?? null,
      version: bundle.version ?? null,
      is_test_data: bundle.is_test_data,
      source: bundle.source,
      bosses: bundle.bosses.length,
    },
    assumptions: [
      `${CONTENT_LABELS[bundle.content]} — 보스는 엔진 프리셋이 아니라 전투 조건의 적 설정으로 표현했다(보스 묶음에서 확인된 칸만 넣었다)`,
      '크리티컬·코어 히트는 기대값으로 계산(결정론)',
      '운용(조작·버스트 순서)은 엔진의 캐릭터별 기본값',
      '전투 시간·캐릭터 레벨은 보스마다 적혀 있다(확인된 값이 없으면 엔진 기본값)',
    ],
    engine: evaluator ?? (await engine.version()),
    // 시뮬 결과 캐시 통계(보스별 통계의 합). 캐시를 쓰지 않는 런타임이면 null이다.
    cache: mergeCacheStats(caches),
    top,
    sims: { budget, used, per_boss: bosses.map((b) => ({ id: b.id, name: b.name, budget: b.budget, used: b.sims })) },
    bosses,
    caveats,
    // 뺐다는 사실(누구를 몇 명). 뺀 것이 없으면 이 칸이 없다.
    ...(cut.excluded ? { excluded: cut.excluded } : {}),
  };
}
