// 쿠키 목록 → Cookie 헤더 한 줄(lib/cookie-header.js). 쿠키는 모두 지어낸 값이다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_HOST, buildCookieHeader, COOKIE_URL, domainMatches, MAX_COOKIE_CHARS, REQUIRED_COOKIES } from '../lib/cookie-header.js';

/** 지어낸 쿠키. 실제 계정의 값이 아니다. */
const TOKEN = 'FAKE-TOKEN-ext-unit-8f14e45fceea167a';
const OPENID = '31313131424242425353';

/** chrome.cookies.getAll이 주는 모양의 쿠키. */
const cookie = (name, value, domain, extra = {}) => ({ name, value, domain, hostOnly: !domain.startsWith('.'), path: '/', secure: true, httpOnly: false, ...extra });

const loggedIn = () => [
  cookie('game_token', TOKEN, '.blablalink.com', { httpOnly: true }),
  cookie('game_openid', OPENID, '.blablalink.com'),
  cookie('game_gameid', '29080', '.blablalink.com'),
  cookie('lang', 'ko', 'api.blablalink.com'),
];

test('로그인된 브라우저의 쿠키는 이름=값을 "; "로 이은 한 줄이 된다', () => {
  const built = buildCookieHeader(loggedIn());
  assert.deepEqual(built, {
    ok: true,
    header: `game_token=${TOKEN}; game_openid=${OPENID}; game_gameid=29080; lang=ko`,
    count: 4,
  });
  assert.ok(!/[\r\n]/.test(built.header));
});

test('도메인이 맞는 쿠키만 쓴다 — 다른 사이트·다른 하위 도메인의 쿠키는 섞이지 않는다', () => {
  const built = buildCookieHeader([
    ...loggedIn(),
    cookie('tracker', 'should-not-be-sent', '.google.com'),
    cookie('www_only', 'nope', 'www.blablalink.com'),
    cookie('deeper', 'nope', '.x.api.blablalink.com'),
    cookie('lookalike', 'nope', '.evilblablalink.com'),
    cookie('suffix', 'nope', '.blablalink.com.evil.example'),
    cookie('tld', 'nope', '.com'),
    // 도메인 속성 없이 blablalink.com에 심은 쿠키는 api.blablalink.com 요청에 실리지 않는다.
    cookie('apex_host_only', 'nope', 'blablalink.com'),
    { name: 'no_domain', value: 'nope' },
  ]);
  assert.equal(built.ok, true);
  assert.equal(built.header, `game_token=${TOKEN}; game_openid=${OPENID}; game_gameid=29080; lang=ko`);
  assert.equal(built.count, 4);
});

test('도메인 판정: 호스트와 같거나 그 윗도메인일 때만 맞는다', () => {
  for (const domain of ['api.blablalink.com', '.blablalink.com', 'blablalink.com', ' .BlablaLink.com ']) {
    assert.equal(domainMatches(domain, API_HOST), true, domain);
  }
  for (const domain of ['www.blablalink.com', 'evilblablalink.com', 'blablalink.com.evil.example', 'x.api.blablalink.com', 'google.com', 'com', '.com', '', '.', null, undefined, 42]) {
    assert.equal(domainMatches(domain, API_HOST), false, String(domain));
  }
  // hostOnly 쿠키는 그 호스트에만 실린다.
  assert.equal(domainMatches('api.blablalink.com', API_HOST, true), true);
  assert.equal(domainMatches('blablalink.com', API_HOST, true), false);
});

test('game_token·game_openid가 없으면 로그인돼 있지 않은 것이다 — 헤더를 만들지 않는다', () => {
  const cases = [
    { cookies: [], missing: ['game_token', 'game_openid'] },
    { cookies: [cookie('lang', 'ko', '.blablalink.com')], missing: ['game_token', 'game_openid'] },
    { cookies: loggedIn().filter((c) => c.name !== 'game_token'), missing: ['game_token'] },
    { cookies: loggedIn().filter((c) => c.name !== 'game_openid'), missing: ['game_openid'] },
    // 값이 빈 필수 쿠키는 없는 것이다.
    { cookies: loggedIn().map((c) => (c.name === 'game_token' ? { ...c, value: '' } : c)), missing: ['game_token'] },
    // 필수 쿠키가 다른 사이트의 것이면 없는 것이다.
    { cookies: loggedIn().map((c) => (c.name === 'game_token' ? { ...c, domain: '.example.com' } : c)), missing: ['game_token'] },
    // 이름이 비슷한 쿠키는 필수 쿠키가 아니다.
    { cookies: [cookie('xgame_token', TOKEN, '.blablalink.com'), cookie('game_openid', OPENID, '.blablalink.com')], missing: ['game_token'] },
    { cookies: null, missing: ['game_token', 'game_openid'] },
    { cookies: 'game_token=x', missing: ['game_token', 'game_openid'] },
  ];
  for (const { cookies, missing } of cases) {
    const built = buildCookieHeader(cookies);
    assert.deepEqual(built, { ok: false, reason: 'not_logged_in', missing });
    // 실패한 결과에는 쿠키의 이름만 있다 — 값은 없다.
    const shown = JSON.stringify(built);
    assert.ok(!shown.includes(TOKEN) && !shown.includes(OPENID), shown);
  }
  assert.deepEqual(REQUIRED_COOKIES, ['game_token', 'game_openid']);
});

test('이름=값 꼴로 쓸 수 없는 쿠키는 뺀다(빈 값은 쓴다)', () => {
  const built = buildCookieHeader([
    ...loggedIn().slice(0, 2),
    cookie('', 'no-name', '.blablalink.com'),
    cookie('bad name', 'x', '.blablalink.com'),
    cookie('semi', 'a;b', '.blablalink.com'),
    cookie('eq=', 'x', '.blablalink.com'),
    cookie('newline', 'a\nb', '.blablalink.com'),
    cookie('space', 'a b', '.blablalink.com'),
    cookie('한글', 'x', '.blablalink.com'),
    cookie('value_kr', '값', '.blablalink.com'),
    cookie('not_text', 42, '.blablalink.com'),
    cookie('empty_ok', '', '.blablalink.com'),
    null,
    'text',
  ]);
  assert.equal(built.ok, true);
  assert.equal(built.header, `game_token=${TOKEN}; game_openid=${OPENID}; empty_ok=`);
});

test('너무 긴 것은 쿠키가 아닌 것이 섞인 것으로 보고 만들지 않는다', () => {
  const built = buildCookieHeader([...loggedIn(), cookie('pad', 'x'.repeat(MAX_COOKIE_CHARS), '.blablalink.com')]);
  assert.equal(built.ok, false);
  assert.equal(built.reason, 'too_long');
  assert.ok(built.chars > MAX_COOKIE_CHARS);
  assert.ok(!JSON.stringify(built).includes(TOKEN));
});

test('쿠키를 묻는 주소는 수집 스크립트가 요청을 보내는 곳이다', () => {
  assert.equal(API_HOST, 'api.blablalink.com');
  assert.equal(new URL(COOKIE_URL).host, API_HOST);
  assert.equal(new URL(COOKIE_URL).protocol, 'https:');
});

test('입력을 바꾸지 않는다', () => {
  const cookies = loggedIn();
  const before = JSON.stringify(cookies);
  buildCookieHeader(cookies);
  assert.equal(JSON.stringify(cookies), before);
});
