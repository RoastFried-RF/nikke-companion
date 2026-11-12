// 자동 티어의 등급 규칙 — 점수(팀 총딜 비율) → 등급, 그리고 「미지원 효과」 경고 판정.
// 규칙의 값은 data/tier/rules.json(버전 있음)에 있고, 이 파일은 그 문서를 검사하고 적용하는 순수 함수만 갖는다
// (`node:` 모듈을 import하지 않는다 — 파일은 호출하는 쪽이 읽어 넘긴다). 방법·가정은 docs/tier-method.md.

export const RULES_SCHEMA_VERSION = 1;

/** 등급을 매긴 항목에 미지원 효과 경고가 있을 때 붙이는 표시. */
export const UNSUPPORTED_FLAG = '미지원 효과 있음';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * 등급 규칙 문서를 검사한다.
 *   tiers: 위 등급부터. `min`은 그 등급의 아래 경계(이상)이고 엄격히 내려가야 하며, 마지막 등급은 0이어야 한다
 *   (0 이상의 모든 점수가 등급 하나에 들어가게).
 * @returns {{ok: boolean, errors: {path: string, message: string}[]}}
 */
export function validateRules(rules) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObject(rules)) return { ok: false, errors: [{ path: '', message: '등급 규칙은 객체여야 한다' }] };
  if (rules.schema_version !== RULES_SCHEMA_VERSION) err('/schema_version', `schema_version은 ${RULES_SCHEMA_VERSION}이어야 한다`);
  if (!nonEmptyString(rules.version)) err('/version', '규칙 버전(문자열)이 필요하다');
  if (typeof rules.provisional !== 'boolean') err('/provisional', 'provisional(임시 규칙인가)은 true 또는 false여야 한다');

  if (!Array.isArray(rules.tiers) || rules.tiers.length === 0) {
    err('/tiers', '등급을 하나 이상 적어야 한다');
  } else {
    const seen = new Set();
    rules.tiers.forEach((t, i) => {
      if (!isObject(t) || !nonEmptyString(t.tier)) return err(`/tiers/${i}/tier`, '등급 이름(문자열)이 필요하다');
      if (seen.has(t.tier)) err(`/tiers/${i}/tier`, `등급 이름이 겹친다: ${t.tier}`);
      seen.add(t.tier);
      if (!(typeof t.min === 'number' && Number.isFinite(t.min) && t.min >= 0)) {
        return err(`/tiers/${i}/min`, '아래 경계 min은 0 이상의 수여야 한다');
      }
      const prev = rules.tiers[i - 1];
      if (i > 0 && typeof prev?.min === 'number' && !(t.min < prev.min)) {
        err(`/tiers/${i}/min`, `경계는 위 등급에서 아래 등급으로 엄격히 내려가야 한다 (${prev.min} → ${t.min})`);
      }
    });
    const last = rules.tiers[rules.tiers.length - 1];
    if (isObject(last) && typeof last.min === 'number' && last.min !== 0) {
      err(`/tiers/${rules.tiers.length - 1}/min`, '마지막 등급의 min은 0이어야 한다 — 0 이상의 모든 점수가 등급을 받아야 한다');
    }
  }

  const markers = rules.unsupported_warning_markers;
  if (!Array.isArray(markers) || markers.length === 0 || !markers.every(nonEmptyString)) {
    err('/unsupported_warning_markers', '미지원 효과 경고를 알아보는 문구(빈 문자열이 아닌 문자열)를 하나 이상 적어야 한다');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 점수 → 등급. 경계는 「이상」이다: `score >= min`인 가장 위 등급.
 * 점수가 수가 아니거나 음수면 null — 등급을 지어내지 않는다(호출한 쪽이 평가 보류로 남긴다).
 * @param {number} score 팀 총딜 비율(1.0 = 기준 편성과 같다)
 * @param {{tiers: {tier: string, min: number}[]}} rules 검사를 지난 규칙
 * @returns {{tier: string, min: number} | null}
 */
export function gradeOf(score, rules) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) return null;
  const found = rules.tiers.find((t) => score >= t.min);
  return found ? { tier: found.tier, min: found.min } : null;
}

/**
 * 엔진 경고 한 줄이 「효과 모델이 없다(미지원)」는 종류인가. 엔진은 이 종류를 구조화된 칸이 아니라 사람용 문장으로만
 * 알리므로(vendor/nikke-calc/docs/SIM-JSON.md §warnings) 규칙 문서의 문구로 알아본다.
 */
export function isUnsupportedWarning(warning, rules) {
  return typeof warning === 'string' && rules.unsupported_warning_markers.some((marker) => warning.includes(marker));
}

/** 화면·표에 쓰는 등급 표기. 미지원 효과가 있으면 표시를 붙인다. */
export function tierLabel(tier, unsupported) {
  return unsupported ? `${tier} (${UNSUPPORTED_FLAG})` : tier;
}
