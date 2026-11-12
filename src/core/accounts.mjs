// 계정 여러 개(P-033): 계정을 바꾸는 칸에 보일 것과, 계정마다 따로 두는 것의 이름.
// 순수 모듈이다. 계정 폴더를 읽고 쓰는 일은 앱의 Rust(app/src-tauri/src/shared_state.rs)가 한다 — 여기에는 그 상태
// (공유 상태 한 벌)를 화면의 값으로 옮기는 규칙만 있다. 형식 설명은 docs/data-model.md §계정 여러 개.

/**
 * 계정마다 계정 폴더에 따로 두는 것(이름의 꼬리와 화면의 말). 계정을 목록에서 숨겨도 이것들은 지워지지 않는다 —
 * 완전히 지우려면 사람이 계정 폴더에서 직접 지운다(앱에는 지우는 명령이 없다).
 */
export const ACCOUNT_FILES = Object.freeze([
  { suffix: '.json', label: '계정(니케와 육성 상태)' },
  { suffix: '.intercept.json', label: '마지막 요격전 추천' },
  { suffix: '.plan.json', label: '요격전 기록 · 모듈 기록 · 즐겨찾기와 「안 씀」 표시' },
  { suffix: '.decks.json', label: '덱 빌더에서 저장한 편성' },
  { suffix: '.json.bak', label: '계정을 새로 받기 전의 사본' },
]);

/** 그 계정의 것들의 이름(계정 폴더 안). */
export function accountFiles(name) {
  return ACCOUNT_FILES.map((f) => ({ name: `${name}${f.suffix}`, label: f.label }));
}

/**
 * 계정을 바꾸는 칸에 보일 것.
 * - `accounts`: 고를 수 있는 계정(숨기지 않은 것 — 이름순), 지금 쓰는 계정에 `current`.
 * - `hidden`: 목록에서 숨긴 계정(다시 보이게 할 수 있다).
 * - `show`: 화면 위쪽에 바꾸는 칸을 보일 것인가(고를 계정이 둘 이상일 때만).
 * - `needs_choice`: 계정이 여럿인데 어느 것을 쓸지 정해지지 않았다.
 * - `locked`: 계산이 도는 동안에는 바꾸지 못한다(도는 계산의 결과가 다른 계정의 것으로 남지 않게).
 * @param {any} snapshot 공유 상태(`{default_account, accounts, hidden_accounts}`)
 * @param {{computing?: boolean}} [options]
 */
export function accountChoices(snapshot, { computing = false } = {}) {
  const list = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  const hidden = Array.isArray(snapshot?.hidden_accounts) ? snapshot.hidden_accounts : [];
  const current = typeof snapshot?.default_account === 'string' ? snapshot.default_account : null;
  return {
    current,
    accounts: list.map((a) => ({ name: a.name, modified_at: a.modified_at ?? null, current: a.name === current })),
    hidden: hidden.map((a) => ({ name: a.name, modified_at: a.modified_at ?? null })),
    show: list.length > 1,
    needs_choice: current === null && list.length > 1,
    locked: computing === true,
    locked_reason: computing === true ? '계산이 도는 동안에는 계정을 바꾸지 않는다 — 끝난 뒤에 바꾼다.' : null,
  };
}
