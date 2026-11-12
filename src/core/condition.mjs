// 전투 조건 — 어떤 콘텐츠·보스·가정으로 계산하는가. 형식 설명은 docs/data-model.md.

export const CONDITION_SCHEMA_VERSION = 1;
/** anomaly_interception = 이상 개체 요격전, interception = 일반·특수 개체 요격전(docs/intercept.md). */
export const CONTENTS = ['solo_raid', 'union_raid', 'custom', 'anomaly_interception', 'interception'];
export const ENEMY_KEYS = ['def', 'code', 'core_px', 'distance', 'has_parts', 'part_break_interval', 'optimal_range_weapons'];
/** 전투 시간을 적지 않았을 때의 값(초) — 엔진 기본값과 같다(vendor/nikke-calc/docs/SIM-JSON.md `sim.duration`). */
export const DEFAULT_DURATION = 180;
/** 엔진 레벨 정책 `fixed`의 레벨 — vendor/nikke-calc/runner/spec.py `DEFAULT_CHAR["level"]`. */
export const ENGINE_FIXED_LEVEL = 400;
/** 엔진이 받는 캐릭터 레벨의 범위 — vendor/nikke-calc/docs/SIM-JSON.md §육성 `level`(1~1000). */
export const LEVEL_MAX = 1000;

const isLevel = (v) => Number.isInteger(v) && v >= 1 && v <= LEVEL_MAX;

export function validateCondition(condition, catalog) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) {
    return { ok: false, errors: [{ path: '', message: '전투 조건은 객체여야 한다' }] };
  }
  if (condition.schema_version !== CONDITION_SCHEMA_VERSION) {
    err('/schema_version', `schema_version은 ${CONDITION_SCHEMA_VERSION}이어야 한다`);
  }
  if (!CONTENTS.includes(condition.content)) err('/content', `content는 ${CONTENTS.join(' · ')} 중 하나여야 한다`);
  if (condition.boss !== undefined) {
    if (typeof condition.boss !== 'string') err('/boss', '보스는 엔진 프리셋 이름이어야 한다');
    else if (!catalog.bosses.includes(condition.boss)) {
      err('/boss', `엔진에 없는 보스 프리셋이다. 사용 가능: ${catalog.bosses.join(', ')}`);
    }
  }
  if (condition.duration !== undefined && !(typeof condition.duration === 'number' && condition.duration > 0)) {
    err('/duration', '전투 시간(초)은 0보다 커야 한다');
  }
  if (condition.enemy !== undefined) {
    if (condition.enemy === null || typeof condition.enemy !== 'object') err('/enemy', 'enemy는 객체여야 한다');
    else for (const k of Object.keys(condition.enemy)) if (!ENEMY_KEYS.includes(k)) err(`/enemy/${k}`, '모르는 칸이다');
  }
  if (condition.level_cap !== undefined && !isLevel(condition.level_cap)) {
    err('/level_cap', `레벨 상한은 1~${LEVEL_MAX}의 정수여야 한다`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 이 조건에서 캐릭터 레벨을 무엇으로 계산하는가.
 *
 * 엔진의 레벨 정책은 둘이다(vendor/nikke-calc/runner/spec.py `LEVEL_MODES`, docs/HARNESS.md §레벨 정책):
 * `fixed`(400 고정 — 솔로 레이드)와 `sync`(프로필의 `_account.synchro_level`, 편성 전원 같은 값).
 *
 *   - `level_cap`이 없는 조건: 종전 그대로 `fixed`.
 *   - `level_cap`이 있는 조건(이상 개체 요격전의 "최대 레벨 400 제한" — 고정이 아니라 상한):
 *       계정에 동기화 레벨(`account.synchro_level`)이 있으면 min(동기화 레벨, 상한).
 *       없으면 상한 값으로 **가정**한다(`assumed: true`) — 실제 레벨이 더 낮으면 총딜이 과대다. 결과의 caveats에 적힌다.
 *
 * 계산할 레벨이 400이면 엔진에는 `fixed`로, 아니면 `sync`에 그 레벨을 실어 보낸다(`engine_policy`).
 * @returns {{mode: 'fixed'|'cap', level: number, cap: number|null, synchro_level: number|null, assumed: boolean, engine_policy: 'fixed'|'sync'}}
 */
export function levelPlan(condition, account) {
  const cap = condition?.level_cap;
  if (!isLevel(cap)) {
    return { mode: 'fixed', level: ENGINE_FIXED_LEVEL, cap: null, synchro_level: null, assumed: false, engine_policy: 'fixed' };
  }
  const sync = account?.account?.synchro_level;
  const known = isLevel(sync);
  const level = known ? Math.min(sync, cap) : cap;
  return {
    mode: 'cap',
    level,
    cap,
    synchro_level: known ? sync : null,
    assumed: !known,
    engine_policy: level === ENGINE_FIXED_LEVEL ? 'fixed' : 'sync',
  };
}

/**
 * 모든 편성 요청에 공통으로 들어가는 엔진 요청 칸.
 * 편성끼리 비교하려면 같은 값이 나와야 하므로 항상 기대값 모드(결정론)로 돌린다.
 * 레벨은 `levelPlan`이 정한다 — 주지 않으면 엔진 기본 정책 `fixed`(솔로 레이드 = 400 고정)다.
 * `sync`일 때는 프로필에도 그 레벨을 실어야 한다(`toEngineProfile(account, names, level)`).
 */
export function toEngineBase(condition, level = null) {
  const base = { sim: { expected: true, duration: condition.duration ?? DEFAULT_DURATION }, profile_level: level?.engine_policy ?? 'fixed' };
  if (condition.boss) base.boss = condition.boss;
  if (condition.enemy) base.enemy = condition.enemy;
  return base;
}

/** 레벨을 어떻게 정했는지 한 문장. */
export function levelText(level) {
  if (!level || level.mode === 'fixed') return `캐릭터 레벨은 엔진 정책 fixed(${ENGINE_FIXED_LEVEL})`;
  if (level.assumed) {
    return `캐릭터 레벨 ${level.level} — 콘텐츠의 레벨 상한 ${level.cap}으로 가정했다(계정에 동기화 레벨 account.synchro_level이 없다)`;
  }
  return level.synchro_level > level.cap
    ? `캐릭터 레벨 ${level.level} — 계정의 동기화 레벨 ${level.synchro_level}에 콘텐츠의 레벨 상한 ${level.cap}을 적용했다(편성 전원 같은 레벨)`
    : `캐릭터 레벨 ${level.level} — 계정의 동기화 레벨(콘텐츠의 레벨 상한 ${level.cap} 이하, 편성 전원 같은 레벨)`;
}

/** 레벨 때문에 결과와 함께 알려야 하는 한계. 없으면 빈 배열. */
export function levelCaveats(level) {
  if (!level || level.mode === 'fixed') return [];
  if (level.assumed) {
    return [
      `레벨 상한 ${level.cap}: 계정에 동기화 레벨(account.synchro_level)이 없어 전원을 레벨 ${level.cap}으로 계산했다 — ` +
        '실제 레벨이 상한보다 낮으면 총딜이 실제보다 크게 나온다. 계정 파일의 account.synchro_level에 인게임 동기화 레벨을 적으면 반영된다.',
    ];
  }
  return [
    `편성 전원을 레벨 ${level.level}(동기화 레벨 ${level.synchro_level}, 상한 ${level.cap})로 계산했다 — ` +
      '동기화 소대 밖의 니케도 같은 레벨로 본다(엔진 레벨 정책 sync의 가정).',
  ];
}

/** 결과와 함께 보여 줄 계산 가정. */
export function assumptionsOf(condition, level = null) {
  return [
    `전투 ${condition.duration ?? DEFAULT_DURATION}초, 크리티컬·코어 히트는 기대값으로 계산(결정론)`,
    condition.boss ? `보스 프리셋: ${condition.boss}` : '보스 지정 없음 — 엔진 기본 적',
    levelText(level),
    '운용(조작·버스트 순서)은 엔진의 캐릭터별 기본값',
  ];
}
