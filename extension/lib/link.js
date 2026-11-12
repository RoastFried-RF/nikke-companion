// 오버레이에 넘기기 — 단추 한 번에 하는 일 전체. chrome API와 fetch는 밖에서 받는다(tests/link.test.mjs가 가짜로 끼운다).
//
// 하는 일(sendSession):
//   1. 연결 코드를 확인한다(없으면 여기서 끝 — 쿠키를 읽지 않는다)
//   2. 「api.blablalink.com 요청에 실릴 쿠키」를 읽는다(getCookies — popup.js가 chrome.cookies.getAll을 넘긴다)
//   3. Cookie 헤더 한 줄로 만든다(cookie-header.js). game_token·game_openid가 없으면 보내지 않는다
//   4. 이 PC의 오버레이(127.0.0.1)에 한 번 보낸다. 다른 곳에는 보내지 않는다
//   5. 오버레이의 답을 사람이 읽을 문장으로 바꾼다
//
// 쿠키는 이 함수의 지역 변수로만 있다가 사라진다 — 저장하지 않고, 돌려주는 결과(상태·문장)에도 넣지 않는다.

import { buildCookieHeader } from './cookie-header.js';

/** 오버레이의 수신부. app/src-tauri/src/extension_link.rs의 DEFAULT_PORT·SESSION_PATH와 같아야 한다. */
export const OVERLAY_PORT = 47615;
export const OVERLAY_ORIGIN = `http://127.0.0.1:${OVERLAY_PORT}`;
export const SESSION_PATH = '/nikke-companion/v1/session';
export const ENDPOINT = `${OVERLAY_ORIGIN}${SESSION_PATH}`;

/** 연결 코드를 기억하는 이름(팝업의 localStorage). 쿠키는 기억하지 않는다. */
export const CODE_KEY = 'nikke-companion.link-code';

/** 연결 코드에 쓰는 글자(extension_link.rs의 CODE_ALPHABET과 같다 — 헷갈리는 I·O·0·1은 없다). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_CHARS = 8;

/** 오버레이가 답하기를 기다리는 시간(밀리초). */
export const SEND_TIMEOUT_MS = 5000;

/**
 * 사람이 넣은 연결 코드를 정리한다: 공백·붙임표를 빼고 대문자로. 모양이 맞으면 `ABCD-EFGH`, 아니면 빈 문자열.
 */
export function normalizeCode(text) {
  const raw = String(text ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
  if (raw.length !== CODE_CHARS) return '';
  for (const ch of raw) if (!CODE_ALPHABET.includes(ch)) return '';
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** 결과의 종류마다 팝업에 보일 문장. */
export const MESSAGES = {
  received: '오버레이가 받았다 — 오버레이의 계정 화면에서 계정 받기가 이어진다.',
  overlay_off: '오버레이가 꺼져 있다 — 니케 컴패니언 오버레이를 켜고, 계정 화면에서 「크롬 확장 연결」을 켠 뒤 다시 눌러라.',
  wrong_code: '연결 코드가 틀리다 — 오버레이 계정 화면에 보이는 코드를 다시 넣어라.',
  locked: '코드를 여러 번 틀려 오버레이가 잠시 막았다 — 조금 뒤에 다시 하라.',
  not_logged_in: 'blablalink에 로그인돼 있지 않다 — 이 브라우저에서 blablalink.com에 로그인하고 게임 계정을 연동한 뒤 다시 눌러라.',
  no_code: '연결 코드를 먼저 넣어라 — 오버레이 계정 화면의 「크롬 확장 연결」에 보이는 여덟 글자다.',
  busy: '오버레이가 지금 계정을 받는 중이다 — 끝난 뒤에 다시 눌러라.',
  cookie_rejected: '오버레이가 쿠키를 받아들이지 않았다(형식이 맞지 않는다) — blablalink에 다시 로그인한 뒤 눌러라.',
  store_failed: '오버레이가 쿠키를 저장하지 못했다 — 오버레이의 계정 화면에 보이는 문제를 확인하라.',
  cookies_unreadable: '브라우저의 쿠키를 읽지 못했다 — 확장을 다시 로드한 뒤 눌러라.',
  unexpected: '오버레이가 아닌 답이 왔다 — 127.0.0.1의 그 포트를 다른 프로그램이 쓰고 있을 수 있다. 오버레이의 계정 화면을 확인하라.',
};

/** 결과 하나. `state`는 MESSAGES의 이름, `message`는 팝업에 보일 문장이다. 쿠키는 들어가지 않는다. */
function outcome(state, extra = '') {
  return { state, ok: state === 'received', message: `${MESSAGES[state]}${extra}` };
}

/** 오버레이가 준 답(상태 코드와 JSON)을 결과로. */
export function describeReply(status, body) {
  const reason = body !== null && typeof body === 'object' ? body.reason : undefined;
  if (status === 200 && body !== null && typeof body === 'object' && body.ok === true && body.result === 'received') return outcome('received');
  if (reason === 'wrong_code') return outcome('wrong_code');
  if (reason === 'locked') {
    const seconds = Number(body.retry_after_seconds);
    return outcome('locked', Number.isFinite(seconds) && seconds > 0 ? ` (${Math.ceil(seconds)}초 남음)` : '');
  }
  if (reason === 'not_logged_in') return outcome('not_logged_in');
  if (reason === 'busy') return outcome('busy');
  if (reason === 'cookie_rejected') return outcome('cookie_rejected');
  if (reason === 'store_failed') return outcome('store_failed');
  return outcome('unexpected', typeof reason === 'string' && /^[a-z_]{1,40}$/.test(reason) ? ` (${reason})` : ` (HTTP ${Number(status) || 0})`);
}

/**
 * 단추를 눌렀을 때 하는 일. 결과(`{state, ok, message}`)를 돌려준다 — 던지지 않는다.
 *
 * @param {object} deps
 * @param {string} deps.code 사용자가 넣은 연결 코드
 * @param {() => Promise<object[]>} deps.getCookies api.blablalink.com 요청에 실릴 쿠키 목록을 읽는다
 * @param {(url: string, init: object) => Promise<{status: number, json: () => Promise<unknown>}>} deps.post fetch와 같은 모양
 */
export async function sendSession({ code, getCookies, post }) {
  const linkCode = normalizeCode(code);
  if (!linkCode) return outcome('no_code');

  let cookies;
  try {
    cookies = await getCookies();
  } catch {
    return outcome('cookies_unreadable');
  }
  const built = buildCookieHeader(cookies);
  if (!built.ok) {
    // 로그인돼 있지 않으면 아무것도 보내지 않는다. 너무 긴 것은 쿠키가 아닌 것이 섞인 것이다.
    return built.reason === 'not_logged_in' ? outcome('not_logged_in') : outcome('cookie_rejected');
  }

  let response;
  try {
    response = await post(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: linkCode, cookie: built.header }),
      // 브라우저가 이 요청에 다른 것을 얹거나 다른 곳으로 따라가지 않게 한다.
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    // 연결이 거절됐다(수신부가 닫혀 있다) — 오버레이가 꺼져 있거나 「크롬 확장 연결」이 꺼져 있다.
    return outcome('overlay_off');
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return describeReply(response.status, body);
}
