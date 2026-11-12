// 부품 모아 보기 화면을 띄울지 정한다. 개발 실행에서만 뜬다 — 빌드한 앱에는 그 화면이 들어가지도 않는다(main.ts).

/** 주소에 붙이는 표시: 개발 서버 주소 뒤에 `?gallery`. */
export const GALLERY_QUERY = 'gallery';

/**
 * 부품 모아 보기를 띄울 것인가.
 * @param dev 개발 실행인가(`import.meta.env.DEV`). 아니면 무엇을 붙여도 false다.
 * @param search 주소의 `?` 뒤(`window.location.search`).
 * @param flag 개발 실행을 시작할 때 준 환경 변수 `VITE_UI_GALLERY`의 값('1'이면 주소에 표시가 없어도 띄운다 —
 *   Tauri 창은 주소를 고칠 수 없어서 이 길을 둔다).
 */
export function galleryRequested(dev: boolean, search: string, flag?: unknown): boolean {
  if (!dev) return false;
  if (flag === '1' || flag === 'true') return true;
  try {
    return new URLSearchParams(search).has(GALLERY_QUERY);
  } catch {
    return false;
  }
}
