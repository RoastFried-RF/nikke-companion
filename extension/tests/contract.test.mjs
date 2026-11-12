// 확장과 오버레이의 수신부(app/src-tauri/src/extension_link.rs)가 맞물리는 곳을 두 쪽의 파일을 읽어 맞춰 본다.
// 실제 브라우저와 실제 오버레이로 주고받는 것은 사람이 확인한다(extension/README.md §사람이 확인할 것).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { API_HOST, COOKIE_URL, MAX_COOKIE_CHARS, REQUIRED_COOKIES } from '../lib/cookie-header.js';
import { CODE_ALPHABET, CODE_CHARS, describeReply, ENDPOINT, OVERLAY_ORIGIN, OVERLAY_PORT, SESSION_PATH } from '../lib/link.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rust = (file) => readFileSync(join(repo, 'app', 'src-tauri', 'src', file), 'utf8');
const linkRs = rust('extension_link.rs');
const cookieRs = rust('cookie.rs');
const loginRs = rust('login_window.rs');
const manifest = JSON.parse(readFileSync(join(repo, 'extension', 'manifest.json'), 'utf8'));

test('주소: 확장이 보내는 곳이 수신부가 듣는 곳이다(127.0.0.1의 그 포트, 그 경로)', () => {
  assert.ok(linkRs.includes(`pub const DEFAULT_PORT: u16 = ${OVERLAY_PORT};`));
  assert.ok(linkRs.includes(`pub const SESSION_PATH: &str = "${SESSION_PATH}";`));
  assert.equal(OVERLAY_ORIGIN, `http://127.0.0.1:${OVERLAY_PORT}`);
  assert.equal(ENDPOINT, `http://127.0.0.1:${OVERLAY_PORT}${SESSION_PATH}`);
  // 수신부는 그 주소(루프백)에만 묶는다.
  assert.ok(linkRs.includes('TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))'));
  // 확장의 호스트 권한이 그 주소를 덮는다(포트를 적지 않은 패턴은 모든 포트에 맞는다).
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
});

test('요청의 모양: POST · application/json · {code, cookie}', () => {
  assert.ok(linkRs.includes('pub const CONTENT_TYPE: &str = "application/json";'));
  assert.ok(linkRs.includes('const BODY_FIELDS: [&str; 2] = ["code", "cookie"];'));
  assert.match(linkRs, /if fields\.len\(\) != BODY_FIELDS\.len\(\) \{\s*return Err\(Reply::BadRequest\);/);
  assert.ok(linkRs.includes('if head.method != "POST" {'));
  // 수신부는 확장의 출처만 받는다 — 확장의 요청에는 브라우저가 이 출처를 붙인다.
  assert.ok(linkRs.includes('pub const EXTENSION_ORIGIN: &str = "chrome-extension://";'));
  // 확장이 만들 수 있는 가장 긴 본문이 수신부의 크기 제한 안에 든다.
  const max = Number(/pub const MAX_BODY_BYTES: usize = (\d+) \* 1024;/.exec(linkRs)[1]) * 1024;
  const longest = JSON.stringify({ code: 'ABCD-2345', cookie: 'x'.repeat(MAX_COOKIE_CHARS) }).length;
  assert.ok(longest < max, `${longest} < ${max}`);
});

test('연결 코드: 글자와 길이가 같다', () => {
  assert.ok(linkRs.includes(`pub const CODE_ALPHABET: &[u8; 32] = b"${CODE_ALPHABET}";`));
  assert.ok(linkRs.includes(`pub const CODE_CHARS: usize = ${CODE_CHARS};`));
});

test('답의 사유: 수신부가 내는 낱말을 확장이 안내로 바꾼다', () => {
  // 수신부가 내는 사유 전부.
  const reasons = [...linkRs.slice(linkRs.indexOf('pub fn reason(self)'), linkRs.indexOf('pub fn body(self)')).matchAll(/=> "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(reasons.sort(), [
    'bad_request',
    'busy',
    'content_type',
    'cookie_rejected',
    'host',
    'length_required',
    'locked',
    'method',
    'not_found',
    'not_logged_in',
    'origin',
    'received',
    'store_failed',
    'timeout',
    'too_large',
    'wrong_code',
  ]);
  assert.ok(linkRs.includes('r#"{"ok":true,"result":"received"}"#'));
  // 사람이 가려 봐야 하는 것은 저마다의 안내가 있고, 나머지(모양이 다른 요청 — 확장은 보내지 않는다)는 「오버레이가 아닌 답」이다.
  const named = { wrong_code: 'wrong_code', locked: 'locked', not_logged_in: 'not_logged_in', busy: 'busy', cookie_rejected: 'cookie_rejected', store_failed: 'store_failed' };
  for (const reason of reasons) {
    if (reason === 'received') continue;
    assert.equal(describeReply(400, { ok: false, reason }).state, named[reason] ?? 'unexpected', reason);
  }
  assert.equal(describeReply(200, { ok: true, result: 'received' }).state, 'received');
});

test('쿠키 규칙: 필수 쿠키·호스트·길이 제한·묻는 주소가 오버레이의 Rust 쪽과 같다', () => {
  assert.ok(cookieRs.includes(`pub const REQUIRED_COOKIES: [&str; 2] = ["${REQUIRED_COOKIES[0]}", "${REQUIRED_COOKIES[1]}"];`));
  assert.ok(cookieRs.includes(`pub const API_HOST: &str = "${API_HOST}";`));
  assert.ok(cookieRs.includes('pub const MAX_COOKIE_CHARS: usize = 16 * 1024;'));
  assert.equal(MAX_COOKIE_CHARS, 16 * 1024);
  assert.ok(loginRs.includes(`pub const COOKIE_URL: &str = "${COOKIE_URL}";`));
  // 받은 헤더는 붙여넣기와 같은 정리·검사를 거친다.
  assert.match(linkRs, /pub fn store_in_engine\(engine_dir: &Path, cookie: &str\) -> Stored \{\s*match account_sync::store_pasted_cookie\(engine_dir, cookie\) \{/);
});
