// 확장의 권한과 모양을 파일 그대로 읽어 확인한다: 쿠키 권한 하나와 호스트 권한 둘뿐이고, 백그라운드에서 돌지 않으며,
// 쿠키를 읽는 것은 팝업의 단추를 눌렀을 때 한 번, 보내는 곳은 이 PC의 오버레이(127.0.0.1) 하나다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

/** 확장에 실리는 코드 파일(테스트는 뺀다). */
const SHIPPED = ['popup.js', 'lib/cookie-header.js', 'lib/link.js'];
/** 주석을 뺀 코드. */
const code = (source) =>
  source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');
const shipped = Object.fromEntries(SHIPPED.map((file) => [file, code(read(file))]));

test('Manifest V3이고 권한은 cookies 하나, 호스트 권한은 blablalink와 127.0.0.1 둘뿐이다', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['cookies']);
  assert.deepEqual(manifest.host_permissions, ['https://*.blablalink.com/*', 'http://127.0.0.1/*']);
  // 나중에 권한을 더 받아 낼 길도 없다.
  for (const key of ['optional_permissions', 'optional_host_permissions']) {
    assert.equal(key in manifest, false, key);
  }
});

test('다른 사이트의 쿠키·탭 내용·방문 기록에 닿는 권한이 없다', () => {
  const all = [...manifest.permissions, ...manifest.host_permissions];
  const forbidden = [
    'tabs',
    'activeTab',
    'history',
    'scripting',
    'webRequest',
    'webRequestBlocking',
    'declarativeNetRequest',
    'declarativeNetRequestWithHostAccess',
    'webNavigation',
    'storage',
    'unlimitedStorage',
    'bookmarks',
    'downloads',
    'topSites',
    'sessions',
    'browsingData',
    'clipboardRead',
    'clipboardWrite',
    'nativeMessaging',
    'debugger',
    'management',
    'proxy',
    'identity',
    'alarms',
    'background',
    'notifications',
    'offscreen',
    'pageCapture',
    'tabCapture',
    'desktopCapture',
  ];
  for (const name of forbidden) assert.equal(all.includes(name), false, name);
  // 모든 사이트에 걸리는 호스트 권한이 없다.
  for (const host of manifest.host_permissions) {
    assert.doesNotMatch(host, /^<all_urls>$|^\*:\/\/|:\/\/\*\/|^(https?|\*):\/\/\*\.?\//, host);
  }
  // 호스트 권한의 대상은 두 곳이다.
  const hosts = manifest.host_permissions.map((p) => p.replace(/^[a-z*]+:\/\//, '').replace(/\/.*$/, ''));
  assert.deepEqual(hosts, ['*.blablalink.com', '127.0.0.1']);
  // 오버레이 쪽은 https가 아닌 루프백 주소 그대로다(이름 풀이를 거치지 않는다).
  assert.match(manifest.host_permissions[1], /^http:\/\/127\.0\.0\.1\//);
});

test('백그라운드에서 스스로 돌지 않는다 — 서비스 워커·콘텐츠 스크립트·외부 연결이 없고 팝업 하나뿐이다', () => {
  for (const key of [
    'background',
    'content_scripts',
    'externally_connectable',
    'web_accessible_resources',
    'devtools_page',
    'options_page',
    'options_ui',
    'chrome_url_overrides',
    'declarative_net_request',
    'omnibox',
    'commands',
    'side_panel',
    'sandbox',
    'content_security_policy',
    'key',
    'update_url',
  ]) {
    assert.equal(key in manifest, false, key);
  }
  assert.deepEqual(Object.keys(manifest).sort(), ['action', 'description', 'host_permissions', 'manifest_version', 'minimum_chrome_version', 'name', 'permissions', 'version']);
  assert.deepEqual(manifest.action, { default_title: '니케 컴패니언 연결', default_popup: 'popup.html' });
  // 스스로 다시 도는 장치(타이머·알람·시작 이벤트)가 코드에 없다.
  for (const [file, source] of Object.entries(shipped)) {
    assert.doesNotMatch(source, /setInterval|setTimeout|chrome\.alarms|chrome\.runtime\.on|chrome\.tabs|chrome\.history|chrome\.scripting|chrome\.webRequest|chrome\.storage|chrome\.cookies\.on|navigator\.serviceWorker|importScripts/, file);
  }
});

test('팝업은 단추 「오버레이로 보내기」, 상태 한 줄, 연결 코드 입력 칸이다', () => {
  const html = read('popup.html');
  assert.equal(html.match(/<button\b/g).length, 1);
  assert.match(html, /<button id="send" type="button">오버레이로 보내기<\/button>/);
  assert.equal(html.match(/<input\b/g).length, 1);
  assert.match(html, /<input id="code" type="text"[^>]*autocomplete="off"/);
  assert.match(html, /<label for="code">연결 코드<\/label>/);
  assert.equal(html.match(/role="status"/g).length, 1);
  assert.match(html, /<p id="status" role="status"/);
  // 스크립트는 확장 안의 파일 하나다 — 밖에서 받아 오는 코드·인라인 스크립트가 없다.
  assert.deepEqual(html.match(/<script\b[^>]*>/g), ['<script type="module" src="popup.js">']);
  assert.doesNotMatch(html, /https?:\/\/|\son[a-z]+=/);
  assert.doesNotMatch(read('popup.css'), /url\(|@import|https?:\/\//);
});

test('쿠키를 읽는 것은 단추를 눌렀을 때 한 번 — api.blablalink.com 요청에 실릴 쿠키만 묻는다', () => {
  const popup = shipped['popup.js'];
  // chrome.cookies를 쓰는 곳은 한 줄이고, 주소 하나로 물어 본다(저장소 전체를 읽지 않는다).
  const uses = Object.values(shipped).join('\n').match(/chrome\.cookies\.\w+\([^)]*\)/g);
  assert.deepEqual(uses, ['chrome.cookies.getAll({ url: COOKIE_URL })']);
  assert.equal(popup.match(/chrome\./g).length, 1);
  // 그 한 줄은 단추의 click 처리 안에 있다.
  const click = popup.slice(popup.indexOf("sendButton.addEventListener('click'"));
  assert.ok(click.includes('chrome.cookies.getAll({ url: COOKIE_URL })'));
  assert.equal(popup.slice(0, popup.indexOf("sendButton.addEventListener('click'")).includes('chrome.'), false);
  assert.equal(popup.match(/addEventListener\('click'/g).length, 1);
  // lib/는 chrome API를 모른다(밖에서 받는다).
  assert.doesNotMatch(shipped['lib/cookie-header.js'], /chrome\.|fetch\(|localStorage|document\.|window\./);
  assert.doesNotMatch(shipped['lib/link.js'], /chrome\.|\bfetch\(|localStorage|document\.|window\./);
});

test('보내는 곳은 이 PC의 오버레이 하나다 — 다른 주소로 가는 요청이 없다', () => {
  const popup = shipped['popup.js'];
  // 네트워크 요청은 한 곳: lib/link.js가 준 주소(ENDPOINT)로 가는 fetch.
  assert.equal(popup.match(/\bfetch\(/g).length, 1);
  assert.match(popup, /post: \(url, init\) => fetch\(url, \{ \.\.\.init, signal: AbortSignal\.timeout\(SEND_TIMEOUT_MS\) \}\)/);
  assert.equal(shipped['lib/link.js'].match(/\bpost\(/g).length, 1);
  assert.match(shipped['lib/link.js'], /response = await post\(ENDPOINT, \{/);
  for (const [file, source] of Object.entries(shipped)) {
    assert.doesNotMatch(source, /XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.connection|new Image\(|import\(/, file);
    // 코드에 적힌 주소는 둘뿐이다: 쿠키를 묻는 주소(요청을 보내지 않는다)와 오버레이.
    const urls = source.match(/https?:\/\/[^\s'"`]+/g) ?? [];
    for (const url of urls) {
      assert.match(url, /^(https:\/\/api\.blablalink\.com\/api\/game\/proxy\/|http:\/\/127\.0\.0\.1:\$\{OVERLAY_PORT\})$/, `${file}: ${url}`);
    }
  }
});

test('쿠키를 저장하지 않는다 — 기억하는 것은 연결 코드 하나다', () => {
  const popup = shipped['popup.js'];
  // 저장소에 쓰는 곳은 한 줄, 연결 코드다.
  const writes = Object.values(shipped).join('\n').match(/localStorage\.setItem\([^)]*\)|sessionStorage|indexedDB|document\.cookie|caches\./g);
  assert.deepEqual(writes, ['localStorage.setItem(CODE_KEY, code)']);
  assert.match(popup, /function rememberCode\(code\) \{\s*try \{\s*if \(code\) localStorage\.setItem\(CODE_KEY, code\);/);
  // 쿠키를 로그로 남기지 않는다.
  for (const [file, source] of Object.entries(shipped)) {
    assert.doesNotMatch(source, /console\.|alert\(|debugger/, file);
  }
  // 상태 줄에는 lib/link.js가 준 정해진 문장만 들어간다(HTML로 넣지 않는다).
  assert.doesNotMatch(popup, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('확장 폴더에는 실행되는 다른 코드가 없다', () => {
  const files = [];
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== 'tests') walk(join(dir, entry.name), `${path}/`);
      } else files.push(path);
    }
  };
  walk(root);
  assert.deepEqual(files.sort(), ['README.md', 'lib/cookie-header.js', 'lib/link.js', 'manifest.json', 'package.json', 'popup.css', 'popup.html', 'popup.js']);
  // package.json은 Node가 lib/*.js를 모듈로 읽게 할 뿐이다 — 받아 올 의존성이 없다.
  const pkg = JSON.parse(read('package.json'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(key in pkg, false, key);
  }
});
