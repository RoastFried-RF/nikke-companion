// 쿠키 목록 → Cookie 헤더 한 줄. 순수 모듈이다: chrome API·네트워크·저장소를 모른다(tests/cookie-header.test.mjs).
//
// 규칙은 오버레이의 Rust 쪽(app/src-tauri/src/cookie.rs의 header_from_browser_cookies)과 같다:
// - 그 호스트로 가는 요청에 실릴 도메인의 쿠키만 쓴다(다른 사이트의 쿠키는 섞이지 않는다)
// - `이름=값` 꼴로 쓸 수 없는 쿠키는 뺀다
// - game_token·game_openid가 없으면(값이 비어도) 로그인돼 있지 않은 것이다 — 헤더를 만들지 않는다
//
// 세션 쿠키는 계정 접근권이다. 이 모듈은 값을 기록하지도 저장하지도 않고, 돌려주는 오류에는 쿠키 이름만 들어간다.

/** 수집에 꼭 필요한 쿠키(cookie.rs의 REQUIRED_COOKIES와 같다). */
export const REQUIRED_COOKIES = ['game_token', 'game_openid'];

/** 엔진의 수집 스크립트가 요청을 보내는 곳(cookie.rs의 API_HOST와 같다). */
export const API_HOST = 'api.blablalink.com';

/** 「이 주소로 가는 요청에 실릴 쿠키」를 브라우저에 물을 때 쓰는 주소(login_window.rs의 COOKIE_URL과 같다). */
export const COOKIE_URL = 'https://api.blablalink.com/api/game/proxy/';

/** 헤더 한 줄의 최대 글자 수(cookie.rs의 MAX_COOKIE_CHARS와 같다). */
export const MAX_COOKIE_CHARS = 16 * 1024;

/**
 * 쿠키의 도메인이 그 호스트로 가는 요청에 실리는 도메인인가: 호스트와 같거나 그 윗도메인이다.
 * 맨 앞의 점은 무시한다(`.blablalink.com`). 점이 없는 도메인(`com`)은 받지 않는다.
 * `hostOnly`(도메인 속성 없이 심은 쿠키)면 호스트와 정확히 같아야 한다.
 */
export function domainMatches(cookieDomain, host, hostOnly = false) {
  if (typeof cookieDomain !== 'string' || typeof host !== 'string') return false;
  const domain = cookieDomain.trim().replace(/^\.+/, '').toLowerCase();
  const target = host.trim().toLowerCase();
  if (!domain || !domain.includes('.')) return false;
  if (hostOnly) return target === domain;
  return target === domain || target.endsWith(`.${domain}`);
}

/** 쿠키 이름으로 쓸 수 있는가: 비지 않고, 구분 글자가 없는 눈에 보이는 ASCII. */
function validName(name) {
  return typeof name === 'string' && /^[\x21-\x7e]+$/.test(name) && !/[=;,"]/.test(name);
}

/** 쿠키 값으로 쓸 수 있는가: `;`가 없는 눈에 보이는 ASCII(빈 값도 된다). */
function validValue(value) {
  return typeof value === 'string' && /^[\x21-\x7e]*$/.test(value) && !value.includes(';');
}

/**
 * 브라우저의 쿠키 목록(chrome.cookies.getAll이 주는 모양: `{name, value, domain, hostOnly}`)을
 * `host`로 가는 요청에 실릴 Cookie 헤더 한 줄로 만든다.
 *
 * 돌려주는 것:
 * - `{ ok: true, header, count }`
 * - `{ ok: false, reason: 'not_logged_in', missing }` — 필수 쿠키가 없다(`missing`은 쿠키 이름)
 * - `{ ok: false, reason: 'too_long', chars }`
 */
export function buildCookieHeader(cookies, host = API_HOST) {
  const list = Array.isArray(cookies) ? cookies : [];
  const usable = list.filter(
    (c) => c !== null && typeof c === 'object' && domainMatches(c.domain, host, c.hostOnly === true) && validName(c.name) && validValue(c.value),
  );
  const missing = REQUIRED_COOKIES.filter((required) => !usable.some((c) => c.name === required && c.value !== ''));
  if (missing.length > 0) return { ok: false, reason: 'not_logged_in', missing };
  const header = usable.map((c) => `${c.name}=${c.value}`).join('; ');
  if (header.length > MAX_COOKIE_CHARS) return { ok: false, reason: 'too_long', chars: header.length };
  return { ok: true, header, count: usable.length };
}
