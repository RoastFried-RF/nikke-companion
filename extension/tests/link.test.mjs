// 단추 한 번에 하는 일(lib/link.js) — 가짜 쿠키 목록과 가짜 요청으로만 돌린다. 브라우저도 오버레이도 띄우지 않는다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODE_ALPHABET, CODE_CHARS, describeReply, ENDPOINT, MESSAGES, normalizeCode, sendSession } from '../lib/link.js';

/** 지어낸 쿠키. 실제 계정의 값이 아니다. */
const TOKEN = 'FAKE-TOKEN-ext-link-45c48cce2e2d7fbd';
const OPENID = '64646464757575758686';
const HEADER = `game_token=${TOKEN}; game_openid=${OPENID}; lang=ko`;
const CODE = 'ABCD-2345';

const loggedIn = () => [
  { name: 'game_token', value: TOKEN, domain: '.blablalink.com', hostOnly: false },
  { name: 'game_openid', value: OPENID, domain: '.blablalink.com', hostOnly: false },
  { name: 'lang', value: 'ko', domain: 'api.blablalink.com', hostOnly: true },
  { name: 'other_site', value: 'never-sent', domain: '.example.com', hostOnly: false },
];

/** 가짜 오버레이: 받은 요청을 적어 두고 정해 둔 답을 준다. */
function fakeOverlay(status, body) {
  const calls = [];
  const post = async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => body };
  };
  return { calls, post };
}

/** 결과에 쿠키가 없다. */
function assertNoCookie(result) {
  const shown = JSON.stringify(result);
  for (const secret of [TOKEN, OPENID, HEADER, 'never-sent']) assert.ok(!shown.includes(secret), shown);
}

test('연결 코드 정리: 공백·붙임표·대소문자를 봐주고 모양이 다르면 빈 문자열', () => {
  for (const typed of ['ABCD-2345', 'abcd-2345', ' abcd 2345 ', 'ABCD2345', 'a-b-c-d-2-3-4-5']) {
    assert.equal(normalizeCode(typed), CODE, typed);
  }
  for (const typed of ['', 'ABCD-234', 'ABCD-23456', 'ABCD-234I', 'ABCD-234O', 'ABCD-2340', 'ABCD-2341', 'ABCD-234!', null, undefined, 12345678]) {
    assert.equal(normalizeCode(typed), '', String(typed));
  }
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(CODE_CHARS, 8);
});

test('로그인돼 있고 코드가 맞으면: 오버레이(127.0.0.1)에 Cookie 헤더 한 줄을 한 번 보내고 「오버레이가 받았다」', async () => {
  const overlay = fakeOverlay(200, { ok: true, result: 'received' });
  let asked = 0;
  const result = await sendSession({
    code: ' abcd 2345 ',
    getCookies: async () => {
      asked += 1;
      return loggedIn();
    },
    post: overlay.post,
  });
  assert.equal(result.state, 'received');
  assert.equal(result.ok, true);
  assert.equal(result.message, MESSAGES.received);
  assert.match(result.message, /오버레이가 받았다/);
  assertNoCookie(result);

  assert.equal(asked, 1);
  assert.equal(overlay.calls.length, 1);
  const [{ url, init }] = overlay.calls;
  assert.equal(url, ENDPOINT);
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.equal(new URL(url).protocol, 'http:');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json' });
  // 보내는 것은 코드와 헤더 한 줄뿐이다. 다른 사이트의 쿠키는 들어 있지 않다.
  assert.deepEqual(JSON.parse(init.body), { code: CODE, cookie: HEADER });
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.referrerPolicy, 'no-referrer');
});

test('blablalink에 로그인돼 있지 않으면 아무것도 보내지 않고 그렇게 알린다', async () => {
  for (const cookies of [[], loggedIn().filter((c) => c.name !== 'game_token'), loggedIn().filter((c) => c.name !== 'game_openid')]) {
    const overlay = fakeOverlay(200, { ok: true, result: 'received' });
    const result = await sendSession({ code: CODE, getCookies: async () => cookies, post: overlay.post });
    assert.equal(result.state, 'not_logged_in');
    assert.equal(result.ok, false);
    assert.match(result.message, /blablalink에 로그인돼 있지 않다/);
    assert.equal(overlay.calls.length, 0, '로그인돼 있지 않은데 요청을 보냈다');
    assertNoCookie(result);
  }
});

test('연결 코드가 없거나 모양이 다르면 쿠키를 읽지도 않는다', async () => {
  for (const code of ['', '   ', 'ABCD', 'ABCD-234O']) {
    const overlay = fakeOverlay(200, { ok: true, result: 'received' });
    let asked = 0;
    const result = await sendSession({
      code,
      getCookies: async () => {
        asked += 1;
        return loggedIn();
      },
      post: overlay.post,
    });
    assert.equal(result.state, 'no_code');
    assert.match(result.message, /연결 코드를 먼저 넣어라/);
    assert.equal(asked, 0, '코드가 없는데 쿠키를 읽었다');
    assert.equal(overlay.calls.length, 0);
  }
});

test('오버레이가 꺼져 있으면(연결이 거절된다) 「오버레이가 꺼져 있다」', async () => {
  for (const error of [new TypeError('Failed to fetch'), new DOMException('The operation timed out.', 'TimeoutError')]) {
    const result = await sendSession({
      code: CODE,
      getCookies: async () => loggedIn(),
      post: async () => {
        throw error;
      },
    });
    assert.equal(result.state, 'overlay_off');
    assert.match(result.message, /오버레이가 꺼져 있다/);
    assert.match(result.message, /크롬 확장 연결/);
    assertNoCookie(result);
  }
});

test('오버레이의 답을 가려 알린다: 코드가 틀리다 · 잠시 막혔다 · 로그인돼 있지 않다 · 받는 중 · 저장 실패', async () => {
  const cases = [
    { status: 401, body: { ok: false, reason: 'wrong_code' }, state: 'wrong_code', says: /연결 코드가 틀리다/ },
    { status: 429, body: { ok: false, reason: 'locked', retry_after_seconds: 42 }, state: 'locked', says: /잠시 막았다.*42초 남음/ },
    { status: 422, body: { ok: false, reason: 'not_logged_in' }, state: 'not_logged_in', says: /blablalink에 로그인돼 있지 않다/ },
    { status: 409, body: { ok: false, reason: 'busy' }, state: 'busy', says: /계정을 받는 중/ },
    { status: 422, body: { ok: false, reason: 'cookie_rejected' }, state: 'cookie_rejected', says: /받아들이지 않았다/ },
    { status: 500, body: { ok: false, reason: 'store_failed' }, state: 'store_failed', says: /저장하지 못했다/ },
  ];
  for (const { status, body, state, says } of cases) {
    const overlay = fakeOverlay(status, body);
    const result = await sendSession({ code: CODE, getCookies: async () => loggedIn(), post: overlay.post });
    assert.equal(result.state, state);
    assert.equal(result.ok, false);
    assert.match(result.message, says);
    assertNoCookie(result);
  }
  // 네 가지 안내는 서로 다른 문장이다.
  const four = [MESSAGES.received, MESSAGES.overlay_off, MESSAGES.wrong_code, MESSAGES.not_logged_in];
  assert.equal(new Set(four).size, 4);
});

test('오버레이가 아닌 것이 답하면(다른 프로그램이 그 포트를 쓴다) 받았다고 하지 않는다', async () => {
  const cases = [
    { status: 200, body: { ok: true } },
    { status: 200, body: { result: 'received' } },
    { status: 200, body: 'received' },
    { status: 200, body: null },
    { status: 404, body: { ok: false, reason: 'not_found' } },
    { status: 403, body: { ok: false, reason: 'origin' } },
    { status: 502, body: { message: `echo ${HEADER}` } },
    { status: 200, body: { ok: false, reason: `<script>${TOKEN}</script>` } },
  ];
  for (const { status, body } of cases) {
    const result = describeReply(status, body);
    assert.equal(result.state, 'unexpected', JSON.stringify(body));
    assert.equal(result.ok, false);
    // 답에 실려 온 글자를 그대로 보이지 않는다(정해진 낱말 모양의 사유와 상태 코드만).
    assertNoCookie(result);
    assert.ok(!result.message.includes('<script>'));
  }
  // 답의 본문을 읽지 못해도 던지지 않는다.
  const result = await sendSession({
    code: CODE,
    getCookies: async () => loggedIn(),
    post: async () => ({
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }),
  });
  assert.equal(result.state, 'unexpected');
});

test('브라우저의 쿠키를 읽지 못하면 그렇게 알리고 보내지 않는다', async () => {
  const overlay = fakeOverlay(200, { ok: true, result: 'received' });
  const result = await sendSession({
    code: CODE,
    getCookies: async () => {
      throw new Error(`No host permissions for cookies at url: ${HEADER}`);
    },
    post: overlay.post,
  });
  assert.equal(result.state, 'cookies_unreadable');
  assert.equal(overlay.calls.length, 0);
  assertNoCookie(result);
});

test('쿠키가 너무 길면(쿠키가 아닌 것이 섞였다) 보내지 않는다', async () => {
  const overlay = fakeOverlay(200, { ok: true, result: 'received' });
  const cookies = [...loggedIn(), { name: 'pad', value: 'x'.repeat(20000), domain: '.blablalink.com', hostOnly: false }];
  const result = await sendSession({ code: CODE, getCookies: async () => cookies, post: overlay.post });
  assert.equal(result.state, 'cookie_rejected');
  assert.equal(overlay.calls.length, 0);
});

test('모든 결과에 한국어 문장이 있다', () => {
  for (const [state, message] of Object.entries(MESSAGES)) {
    assert.match(message, /[가-힣]/, state);
  }
});
