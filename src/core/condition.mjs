// 전투 조건 — 어떤 콘텐츠·보스·가정으로 계산하는가. 형식 설명은 docs/data-model.md.

export const CONDITION_SCHEMA_VERSION = 1;
export const CONTENTS = ['solo_raid', 'union_raid', 'custom'];
const ENEMY_KEYS = ['def', 'code', 'core_px', 'distance', 'has_parts', 'part_break_interval', 'optimal_range_weapons'];

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
  return { ok: errors.length === 0, errors };
}

/**
 * 모든 편성 요청에 공통으로 들어가는 엔진 요청 칸.
 * 편성끼리 비교하려면 같은 값이 나와야 하므로 항상 기대값 모드(결정론)로 돌린다.
 * 레벨은 계정 상태가 아니라 콘텐츠가 정한다 — 엔진 기본 정책 `fixed`(솔로 레이드 = 400 고정)를 쓴다.
 */
export function toEngineBase(condition) {
  const base = { sim: { expected: true, duration: condition.duration ?? 180 }, profile_level: 'fixed' };
  if (condition.boss) base.boss = condition.boss;
  if (condition.enemy) base.enemy = condition.enemy;
  return base;
}

/** 결과와 함께 보여 줄 계산 가정. */
export function assumptionsOf(condition) {
  return [
    `전투 ${condition.duration ?? 180}초, 크리티컬·코어 히트는 기대값으로 계산(결정론)`,
    condition.boss ? `보스 프리셋: ${condition.boss}` : '보스 지정 없음 — 엔진 기본 적',
    '캐릭터 레벨은 엔진 정책 fixed(400)',
    '운용(조작·버스트 순서)은 엔진의 캐릭터별 기본값',
  ];
}
