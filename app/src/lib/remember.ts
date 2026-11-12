// 마지막으로 쓴 값(파일 경로·고른 탭·고른 보스)을 기억한다. 저장하지 못해도 동작에는 지장이 없다.
// 키는 모두 `nikke-companion.`으로 시작한다.

const PREFIX = 'nikke-companion.';

/** 기억해 둔 값. 없거나 읽지 못하면 빈 문자열. */
export function recall(name: string): string {
  try {
    return localStorage.getItem(PREFIX + name) ?? '';
  } catch {
    return '';
  }
}

/** 기억한다. 저장했으면 true(용량이 모자라는 등으로 못 했으면 false — 호출한 쪽은 그냥 계속한다). */
export function remember(name: string, value: string): boolean {
  try {
    localStorage.setItem(PREFIX + name, value);
    return true;
  } catch {
    return false;
  }
}

export function forget(name: string): void {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    // 지우지 못해도 된다.
  }
}
