// 한 줄 요약: 요격전 추천 결과의 보스 하나 → 일반 사용자가 읽을 한 문장.
// 순수 함수다. 웹뷰와 Node가 함께 쓴다. 규칙은 docs/ui-redesign.md §한 줄 요약.
//
// **결과에 있는 것만 말한다.** 재료는 보스 항목(src/core/intercept.mjs의 `bosses[i]`)의 네 가지뿐이다:
//   - 1위 편성의 멤버별 딜 비중(`ranking[0].members[].share`)
//   - 약점 속성과, 보유 니케 가운데 그 속성인 니케(`element.weak_to`, `weak_pool.owned`)
//   - 속성 상성을 반영했는가(`element.reflected`)
//   - 자리 순서를 바꿔 얻은 차이(`ranking[0].placement.changed`·`gain_ratio`)
// 재료가 없는 말은 하지 않는다 — 누가 약점 속성인지 모르면 속성 이야기를 빼고, 비중이 없으면 비중 이야기를 뺀다.
// 보스 패턴·실전 기록처럼 결과에 없는 것은 문장에 넣지 않는다.

/** 한 명이 이만큼(편성 총딜의 절반) 이상 내면 「혼자」라고 말한다. 약점 속성 니케의 합에도 같은 기준을 쓴다. */
export const CARRY_SHARE = 0.5;
/** 자리 순서로 딜이 이만큼(5%) 이상 늘었을 때만 말한다. 그보다 작으면 「크게 바꿨다」고 하지 않는다. */
export const PLACEMENT_GAIN = 1.05;

export const SUMMARY_NOT_COMPUTED = '아직 계산하지 않은 보스다.';
export const SUMMARY_NO_SQUAD = '계산이 끝난 편성이 없다.';
export const SUMMARY_NO_BREAKDOWN = '1위 편성의 딜 구성은 결과에 없다.';

const isShare = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const percent = (ratio) => `${Math.round(ratio * 100)}%`;

/** 1위 편성. `rank`가 1인 항목, 없으면 맨 앞. */
function bestOf(ranking) {
  if (!Array.isArray(ranking) || ranking.length === 0) return null;
  return ranking.find((entry) => entry?.rank === 1) ?? ranking[0];
}

/**
 * 이름 → 약점 속성 니케인가(모르면 null을 돌려주는 함수, 아예 알 길이 없으면 null).
 * 결과의 `weak_pool.owned`는 「보유 니케 가운데 약점 속성인 니케 전부」다 — 편성 멤버는 모두 보유 니케이므로
 * 그 목록에 없으면 약점 속성이 아니다. `weak_pool`이 없는 결과(속성을 모르는 보스 등)에서는 알 수 없다.
 */
function weakTest(boss, options) {
  const weak = boss?.element?.weak_to ?? null;
  if (!weak) return null;
  if (typeof options.elementOf === 'function') {
    return (name) => {
      const element = options.elementOf(name);
      return typeof element === 'string' ? element === weak : null;
    };
  }
  const owned = boss?.weak_pool?.owned;
  if (!Array.isArray(owned) || boss.weak_pool.element !== weak) return null;
  const set = new Set(owned);
  return (name) => set.has(name);
}

/**
 * 보스 하나의 한 줄 요약.
 *
 * 문장은 최대 세 토막이다(있는 것만, 이 순서로): ① 속성 — 약점 속성 딜러가 중심인가 ② 딜 구성 — 누가 절반 이상을 내는가
 * ③ 자리 순서 — 순서를 바꿔 딜이 5% 이상 늘었는가. `facts`는 문장을 만든 재료다(화면이 배지·강조에 그대로 쓴다).
 *
 * @param {object} boss 요격전 추천 결과의 보스 항목
 * @param {{elementOf?: (name: string) => string|null|undefined}} [options] 니케의 속성을 아는 함수(엔진 카탈로그).
 *   주지 않으면 결과의 `weak_pool.owned`로 판단한다.
 * @returns {{text: string, clauses: {kind: string, text: string}[], facts: object}}
 */
export function summarizeInterceptBoss(boss, options = {}) {
  const facts = {
    status: boss?.status ?? null,
    squad: null,
    weak_element: boss?.element?.weak_to ?? null,
    element_reflected: boss?.element?.reflected !== false,
    weak_members: null,
    weak_share: null,
    top: null,
    carry: false,
    placement_gain: null,
  };
  const only = (kind, text) => ({ text, clauses: [{ kind, text }], facts });

  if (boss?.status === 'not_computed') return only('not_computed', SUMMARY_NOT_COMPUTED);
  const best = bestOf(boss?.ranking);
  if (!best) return only('no_squad', SUMMARY_NO_SQUAD);
  facts.squad = best.name ?? null;

  const members = (Array.isArray(best.members) ? best.members : [])
    .filter((m) => typeof m?.name === 'string' && isShare(m.share))
    .sort((a, b) => b.share - a.share);
  const top = members[0] ?? null;
  if (top) facts.top = { name: top.name, share: top.share };

  const clauses = [];

  // ① 속성.
  if (!facts.element_reflected) {
    clauses.push({ kind: 'element_not_reflected', text: '속성 상성 미반영' });
  } else {
    const isWeak = weakTest(boss, options);
    const squadNames = (Array.isArray(best.members) ? best.members : []).map((m) => m?.name).filter((n) => typeof n === 'string');
    const verdicts = isWeak ? squadNames.map((name) => [name, isWeak(name)]) : [];
    // 한 명이라도 속성을 모르면 「약점 속성 니케가 몇 %」를 말할 수 없다.
    if (isWeak && verdicts.length > 0 && verdicts.every(([, v]) => v !== null)) {
      const weakNames = verdicts.filter(([, v]) => v).map(([name]) => name);
      const weakSet = new Set(weakNames);
      const weakShare = members.filter((m) => weakSet.has(m.name)).reduce((sum, m) => sum + m.share, 0);
      facts.weak_members = weakNames;
      const label = `약점 속성(${facts.weak_element})`;
      if (weakNames.length === 0) {
        clauses.push({ kind: 'weak_absent', text: `${label} 니케 없는 편성` });
      } else if (members.length > 0) {
        facts.weak_share = weakShare;
        if (weakShare >= CARRY_SHARE && top && weakSet.has(top.name)) clauses.push({ kind: 'weak_carry', text: `${label} 딜러 중심` });
        else if (weakShare >= CARRY_SHARE) clauses.push({ kind: 'weak_majority', text: `${label} 니케가 딜의 ${percent(weakShare)}` });
        else clauses.push({ kind: 'weak_minor', text: `${label} 니케의 딜은 ${percent(weakShare)}뿐` });
      }
    }
  }

  // ② 딜 구성.
  if (top && top.share >= CARRY_SHARE) {
    facts.carry = true;
    clauses.push({ kind: 'carry', text: `${top.name} 혼자 딜의 ${percent(top.share)}` });
  } else if (members.length >= 2) {
    const [a, b] = members;
    clauses.push({ kind: 'split', text: `${a.name} ${percent(a.share)} · ${b.name} ${percent(b.share)}로 딜이 나뉜다` });
  } else if (top) {
    clauses.push({ kind: 'split', text: `${top.name}의 딜이 ${percent(top.share)}` });
  }

  // ③ 자리 순서.
  const placement = best.placement;
  if (placement?.changed === true && typeof placement.gain_ratio === 'number' && Number.isFinite(placement.gain_ratio)) {
    facts.placement_gain = placement.gain_ratio;
    if (placement.gain_ratio >= PLACEMENT_GAIN) {
      clauses.push({ kind: 'placement', text: `자리 순서를 바꿔 딜 +${Math.round((placement.gain_ratio - 1) * 100)}%` });
    }
  }

  if (clauses.length === 0) return only('no_breakdown', SUMMARY_NO_BREAKDOWN);
  const [first, ...rest] = clauses.map((c) => c.text);
  const text = rest.length ? `${first} — ${rest.join(', ')}.` : `${first}.`;
  return { text, clauses, facts };
}
