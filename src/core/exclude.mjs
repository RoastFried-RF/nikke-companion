// 추천 계산에서 니케를 빼기(P-033): 「안 씀」으로 표시한 니케를 후보에서 빼고 계산하는 선택.
// 순수 모듈이다. 계정 문서를 바꾸지 않는다 — 뺀 사본을 돌려주고, **뺐다는 사실**(누구를 몇 명)을 결과에 실을 값으로 함께 돌려준다.
// 형식 설명은 docs/data-model.md §즐겨찾기와 「안 씀」.

/** 빼는 까닭과 화면의 말. */
export const EXCLUDE_REASONS = Object.freeze({ unused: '안 씀' });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** 뺄 이름 목록의 모양이 맞는가(이름의 배열). */
export function isExcludeList(names) {
  return Array.isArray(names) && names.every(isText);
}

/**
 * 계정에서 그 이름의 니케를 뺀 사본과, 실제로 뺀 것의 기록.
 * 계정이 갖지 않은 이름은 세지 않는다. 하나도 빼지 않았으면 받은 계정을 그대로 돌려주고 `excluded`는 null이다
 * (그때 결과 문서에는 아무 칸도 더해지지 않는다 — 빼지 않은 계산의 결과는 종전과 같다).
 * @param {any} account 계정 문서
 * @param {string[]} names 뺄 니케의 이름
 * @param {{reason?: keyof typeof EXCLUDE_REASONS}} [options]
 * @returns {{account: any, excluded: null | {reason: string, label: string, names: string[], count: number, text: string}}}
 */
export function excludeNikkes(account, names, { reason = 'unused' } = {}) {
  const wanted = new Set(isExcludeList(names) ? names : []);
  const nikkes = isPlainObject(account?.nikkes) ? account.nikkes : null;
  const removed = nikkes ? Object.keys(nikkes).filter((name) => wanted.has(name)) : [];
  if (removed.length === 0) return { account, excluded: null };
  const label = EXCLUDE_REASONS[reason] ?? reason;
  return {
    account: { ...account, nikkes: Object.fromEntries(Object.entries(nikkes).filter(([name]) => !wanted.has(name))) },
    excluded: {
      reason,
      label,
      names: removed,
      count: removed.length,
      text: `「${label}」으로 표시한 니케 ${removed.length}명을 빼고 계산했다: ${removed.join(', ')}.`,
    },
  };
}
