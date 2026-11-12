// 리소스 받기(scripts/fetch-assets.mjs·fetch-assets-lib.mjs).
// 실제 CDN을 부르지 않는다: 받기는 이 PC의 가짜 서버(127.0.0.1의 빈 포트)로만 확인하고, 이미지는 코드로 만든 가짜 바이트다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ASSETS_DIR,
  buildManifest,
  CDN_ORIGIN,
  cdnUrl,
  countByKind,
  DEFAULT_CONCURRENCY,
  DEFAULT_DELAY_MS,
  entryProblem,
  KIND_DIRS,
  KIND_LABELS,
  LARGE_PRIMES,
  looksLikeImage,
  obfuscate,
  PORTRAIT_PATH_TEMPLATE,
  portraitPlainPath,
  runFetch,
  safeFilename,
  UNRESOLVED,
} from '../../scripts/fetch-assets-lib.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ENGINE = path.join(ROOT, 'vendor', 'nikke-calc');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** 코드로 만든 가짜 WebP(머리 바이트만 맞는다 — 게임 이미지가 아니다). */
const fakeWebp = (fill = 7, size = 64) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([size, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(size, fill)]);

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-assets-test-'));
}

/** 가짜 서버. `routes`는 경로 → 처리기. 요청 시각과 동시에 처리 중이던 수를 적는다. */
async function fakeServer(routes) {
  const log = { hits: [], inFlight: 0, maxInFlight: 0 };
  const server = http.createServer((req, res) => {
    log.hits.push({ url: req.url, at: Date.now(), method: req.method });
    log.inFlight += 1;
    log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
    res.on('close', () => {
      log.inFlight -= 1;
    });
    const handler = routes[req.url];
    if (!handler) {
      res.writeHead(404).end('not found');
      return;
    }
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, log, close: () => new Promise((resolve) => server.close(resolve)) };
}

const serveImage = (bytes, delayMs = 0) => (_req, res) => {
  setTimeout(() => res.writeHead(200, { 'content-type': 'image/webp', 'content-length': bytes.length }).end(bytes), delayMs);
};

/** 가짜 캐릭터 목록(이름과 번호는 지어낸 것이다). */
const SCRAPED = { 가나: { id: 7 }, 'D : 킬러': { id: 12 }, 다라: { id: 345 }, 마바: { id: 1001 } };

// ── 주소 규칙 ─────────────────────────────────────────────────────────────────

test('받는 호스트와 경로 규칙의 상수가 엔진 스크레이퍼의 것과 같다', () => {
  const cdnPath = read('vendor/nikke-calc/scraper/cdn_path.py');
  assert.match(cdnPath, new RegExp(`CDN_BASE = "${CDN_ORIGIN.replaceAll('.', '\\.')}"`));
  assert.match(cdnPath, new RegExp(`LARGE_PRIMES = \\[${LARGE_PRIMES.join(', ')}\\]`));
  const cdnFetch = read('vendor/nikke-calc/scraper/cdn_fetch.py');
  assert.ok(cdnFetch.includes(`PORTRAIT_PATH = "${PORTRAIT_PATH_TEMPLATE}"`), 'PORTRAIT_PATH');
  assert.equal(CDN_ORIGIN, 'https://sg-tools-cdn.blablalink.com');
});

test('평문 경로 → CDN 경로: 엔진의 cdn_path.obfuscate()가 낸 값과 같다', () => {
  // 기대값은 엔진의 파이썬 함수를 직접 돌려 얻었다(네트워크 없이 — 2026-11-12).
  const vectors = {
    '/character/mi/mi_c010_00_s.webp': 'ds-16/yt-22/67e341816e80e0c1e13903e5de58875b.webp',
    '/character/mi/mi_c836_00_s.webp': 'ur-89/qz-56/960b9f87a34c6593c9759704cf1f3988.webp',
    '/character/character_id_map.json': 'kx-19/bc64a706accd3c7ec1f9a9f2afd8f1bc.json',
    '/roledata/10-v2-ko.json': 'wz-58/78be524ae3b87701bbd14a8115fb9e36.json',
    '/equip/ko/cube_1.json': 'pl-11/vp-81/1ddf23510a92571ac2a9126dde09afdb.json',
    'a/b/c/d/e/f.tar.gz': 'gg-85/dv-14/hq-62/bd-29/jw-35/3c6ec7a2f23aeb3a1f45927d75ae7584.tar.gz',
    'single.webp': '266d84ee04ca92c7387e68b004a90c30.webp',
  };
  for (const [plain, expected] of Object.entries(vectors)) assert.equal(obfuscate(plain), expected, plain);
  assert.equal(cdnUrl('/character/mi/mi_c010_00_s.webp'), 'https://sg-tools-cdn.blablalink.com/ds-16/yt-22/67e341816e80e0c1e13903e5de58875b.webp');
  // 규칙이 다루지 못하는 깊이는 주소를 지어내지 않고 멈춘다.
  assert.throws(() => obfuscate('a/b/c/d/e/f/g/h.webp'), /깊이/);
  assert.throws(() => obfuscate(''), /깊이/);
});

test('초상화 경로의 번호는 세 자리로 채운다(엔진의 {rid:03d})', () => {
  assert.equal(portraitPlainPath(7), '/character/mi/mi_c007_00_s.webp');
  assert.equal(portraitPlainPath(10), '/character/mi/mi_c010_00_s.webp');
  assert.equal(portraitPlainPath(836), '/character/mi/mi_c836_00_s.webp');
  assert.equal(portraitPlainPath(1001), '/character/mi/mi_c1001_00_s.webp');
});

test('파일 이름 규칙은 엔진의 safe_filename과 같다 — 금지 글자 아홉 개를 _로', () => {
  assert.equal(safeFilename('D : 킬러 와이프'), 'D _ 킬러 와이프');
  assert.equal(safeFilename('a\\b/c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(safeFilename('E.H.'), 'E.H.');
  assert.equal(safeFilename('아스카 : WILLE'), '아스카 _ WILLE');
  // 엔진 코드의 금지 글자 목록과 같은지 대조한다.
  assert.ok(read('vendor/nikke-calc/scraper/cdn_fetch.py').includes(`for ch in r'\\/:*?"<>|':`));
  // 엔진 폴더에 실제로 있는 파일 이름과 맞는다(이름에 ':'가 든 니케).
  if (fs.existsSync(path.join(ENGINE, 'image'))) {
    const catalog = JSON.parse(read('vendor/nikke-calc/scraper/nikke_scraped.json'));
    const withColon = Object.keys(catalog).filter((name) => name.includes(':'));
    assert.ok(withColon.length > 10);
    for (const name of withColon) assert.ok(fs.existsSync(path.join(ENGINE, 'image', `${safeFilename(name)}.webp`)), name);
  }
});

// ── 받을 목록 ─────────────────────────────────────────────────────────────────

test('목록: 엔진 폴더에 없는 초상화만 받는다 — 줄마다 종류·이름·주소·저장 위치·근거', () => {
  const manifest = buildManifest({ scraped: SCRAPED, enginePortraits: ['가나.webp', 'D _ 킬러.webp'], now: () => new Date('2026-11-12T00:00:00Z') });
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.kind, 'asset_manifest');
  assert.equal(manifest.host, CDN_ORIGIN);
  assert.equal(manifest.dest_root, 'data/assets');
  assert.equal(manifest.generated_at, '2026-11-12T00:00:00.000Z');
  assert.deepEqual(manifest.already_present, { portrait: 2 });
  assert.deepEqual(manifest.limits, { concurrency: DEFAULT_CONCURRENCY, delay_ms: DEFAULT_DELAY_MS, max_file_bytes: 2 * 1024 * 1024 });
  assert.deepEqual(
    manifest.entries.map((e) => [e.kind, e.name, e.resource_id, e.plain_path, e.dest]),
    [
      ['portrait', '다라', 345, '/character/mi/mi_c345_00_s.webp', 'data/assets/portraits/다라.webp'],
      ['portrait', '마바', 1001, '/character/mi/mi_c1001_00_s.webp', 'data/assets/portraits/마바.webp'],
    ],
  );
  for (const entry of manifest.entries) {
    assert.equal(entry.url, `${CDN_ORIGIN}/${obfuscate(entry.plain_path)}`);
    assert.match(entry.evidence, /vendor\/nikke-calc\/scraper\/cdn_fetch\.py — PORTRAIT_PATH/);
    assert.match(entry.evidence, /cdn_path\.py — obfuscate\(\)/);
    assert.equal(entryProblem(entry, { root: ROOT }), null);
  }
  assert.deepEqual(countByKind(manifest), [{ kind: 'portrait', label: '니케 초상화', count: 2 }]);
});

test('목록: 번호가 이상한 캐릭터는 주소를 지어내지 않고 뺀다', () => {
  const manifest = buildManifest({ scraped: { 가: { id: 1 }, 나: {}, 다: { id: '12' }, 라: { id: -3 } } });
  assert.deepEqual(manifest.entries.map((e) => e.name), ['가']);
  assert.deepEqual(manifest.skipped.map((s) => s.name), ['나', '다', '라']);
  assert.throws(() => buildManifest({ scraped: [] }), /객체가 아니다/);
});

test('주소를 확인하지 못한 종류는 받지 않고 까닭과 대신 쓰는 것을 적는다', () => {
  const manifest = buildManifest({ scraped: SCRAPED });
  assert.deepEqual(
    manifest.unresolved.map((u) => u.kind),
    ['element_icon', 'burst_icon', 'class_icon', 'corp_icon', 'weapon_icon', 'boss_image', 'equip_icon'],
  );
  for (const u of manifest.unresolved) {
    assert.ok(u.wanted.length > 0 && u.reason && u.instead && u.label === KIND_LABELS[u.kind], u.kind);
    // 받는 목록에는 그 종류가 한 줄도 없다.
    assert.equal(manifest.entries.filter((e) => e.kind === u.kind).length, 0, u.kind);
  }
  assert.equal(UNRESOLVED.length, 7);
  // 받을 대상(작업 설명)의 종류는 모두 폴더가 정해져 있다 — 사람이 직접 넣어도 앱이 읽는다.
  assert.deepEqual(Object.keys(KIND_DIRS).sort(), Object.keys(KIND_LABELS).sort());
  // 엔진 폴더의 아이콘 파일 이름은 엔진 코드에서 확인한 것이다.
  const squads = read('vendor/nikke-calc/runner/squads.py');
  for (const file of ['icn_element_fire.webp', 'icn_burst_all.webp', 'icn_class_attacker.webp']) assert.ok(squads.includes(file), file);
});

test('실제 엔진 데이터로 만든 목록: 주소는 모두 정해진 호스트이고 저장 위치는 data/assets 아래다', () => {
  const scraped = JSON.parse(read('vendor/nikke-calc/scraper/nikke_scraped.json'));
  const all = buildManifest({ scraped, enginePortraits: [] });
  assert.equal(all.entries.length, Object.keys(scraped).length);
  assert.ok(all.entries.length > 150);
  for (const entry of all.entries) {
    assert.equal(new URL(entry.url).origin, CDN_ORIGIN);
    assert.ok(entry.dest.startsWith('data/assets/portraits/') && entry.dest.endsWith('.webp'));
    assert.equal(entryProblem(entry, { root: ROOT }), null, entry.name);
  }
  assert.equal(new Set(all.entries.map((e) => e.dest)).size, all.entries.length, '저장 위치가 겹치지 않는다');
  assert.equal(new Set(all.entries.map((e) => e.url)).size, all.entries.length, '주소가 겹치지 않는다');
});

// ── 받아도 되는 줄인가 ────────────────────────────────────────────────────────

test('다른 호스트의 주소는 거부한다', () => {
  const ok = { kind: 'portrait', name: '가', url: `${CDN_ORIGIN}/aa-01/x.webp`, dest: 'data/assets/portraits/가.webp' };
  assert.equal(entryProblem(ok, { root: ROOT }), null);
  const bad = [
    'https://example.com/aa-01/x.webp',
    'http://sg-tools-cdn.blablalink.com/aa-01/x.webp', // https가 아니다
    'https://sg-tools-cdn.blablalink.com.evil.example/x.webp',
    'https://evil.example/sg-tools-cdn.blablalink.com/x.webp',
    'https://sg-tools-cdn.blablalink.com:8443/x.webp',
    'https://user:pw@sg-tools-cdn.blablalink.com/x.webp',
    'https://sg-tools-cdn.blablalink.com@evil.example/x.webp',
    'file:///C:/Windows/win.ini',
    '//evil.example/x.webp',
    'not a url',
  ];
  for (const url of bad) assert.match(entryProblem({ ...ok, url }, { root: ROOT }) ?? '', /정해진 호스트|읽을 수 없다/, url);
  assert.match(entryProblem({ kind: 'portrait', name: '가' }, { root: ROOT }), /url·dest/);
  assert.match(entryProblem(null, { root: ROOT }), /url·dest/);
});

test('data/assets 밖으로 나가는 저장 위치는 거부한다', () => {
  const ok = { kind: 'portrait', name: '가', url: `${CDN_ORIGIN}/aa-01/x.webp` };
  const bad = [
    'data/assets/../accounts/me.json',
    'data/assets/portraits/../../../x.webp',
    '../x.webp',
    'data/accounts/x.webp',
    'data/assets',
    'data/assetsX/x.webp',
    '/etc/x.webp',
    'C:\\Windows\\x.webp',
    'C:/Windows/x.webp',
    'data\\assets\\..\\accounts\\x.webp',
    'data/assets//x.webp',
    'data/assets/./x.webp',
  ];
  for (const dest of bad) assert.match(entryProblem({ ...ok, dest }, { root: ROOT }) ?? '', /저장 위치/, dest);
  assert.equal(entryProblem({ ...ok, dest: 'data/assets/icons/element/fire.webp' }, { root: ROOT }), null);
  assert.equal(entryProblem({ ...ok, dest: 'data\\assets\\portraits\\가.webp' }, { root: ROOT }), null);
});

test('이미지인지는 첫 바이트로 본다', () => {
  assert.equal(looksLikeImage(fakeWebp(), 'a.webp'), true);
  assert.equal(looksLikeImage(Buffer.from('<html>오류</html>'), 'a.webp'), false);
  assert.equal(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'a.png'), true);
  assert.equal(looksLikeImage(fakeWebp(), 'a.png'), false);
  assert.equal(looksLikeImage(fakeWebp(), 'a.exe'), false);
  assert.equal(looksLikeImage(Buffer.alloc(0), 'a.webp'), false);
});

// ── 받기(가짜 서버) ───────────────────────────────────────────────────────────

test('받기: 가짜 서버에서 받아 data/assets에 쓰고, 이미 있는 파일은 건너뛰고, 실패는 목록으로 돌려준다', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 주소의 경로는 호스트와 무관하다 — 공식 CDN용 목록에서 경로를 얻어 가짜 서버에 같은 경로로 차려 둔다.
  const official = buildManifest({ scraped: SCRAPED });
  assert.equal(official.entries.length, 4);
  const pathOf = (name) => new URL(official.entries.find((e) => e.name === name).url).pathname;
  const live = await fakeServer({
    [pathOf('가나')]: serveImage(fakeWebp(1)),
    [pathOf('D : 킬러')]: serveImage(fakeWebp(2)),
    // '다라'는 서버에 없다(404). '마바'는 이미 받아 둔 것으로 한다.
  });
  t.after(() => live.close());
  // 가짜 서버의 주소로 목록을 만든다(테스트만 호스트를 바꿀 수 있다 — 명령줄 도구에는 그 길이 없다).
  const rebuilt = buildManifest({ scraped: SCRAPED, origin: live.origin });
  assert.deepEqual(rebuilt.entries.map((e) => new URL(e.url).pathname), official.entries.map((e) => new URL(e.url).pathname));

  const existing = path.join(root, 'data/assets/portraits/마바.webp');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, fakeWebp(9));

  const events = [];
  const report = await runFetch(rebuilt, { root, origin: live.origin, delayMs: 0, onEvent: (e) => events.push(e.type) });
  assert.equal(report.total, 4);
  assert.deepEqual(report.downloaded.map((d) => d.name).sort(), ['D : 킬러', '가나']);
  assert.deepEqual(report.skipped.map((d) => d.name), ['마바']);
  assert.deepEqual(report.failed.map((f) => [f.name, f.reason]), [['다라', '응답 404']]);
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.not_attempted, []);
  assert.equal(report.halted, false);
  assert.deepEqual(events.sort(), ['downloaded', 'downloaded', 'failed', 'skipped']);
  // 파일 이름은 엔진 규칙대로(':' → '_')이고 내용은 서버가 준 그대로다.
  assert.deepEqual(fs.readFileSync(path.join(root, 'data/assets/portraits/가나.webp')), fakeWebp(1));
  assert.deepEqual(fs.readFileSync(path.join(root, 'data/assets/portraits/D _ 킬러.webp')), fakeWebp(2));
  // 이미 있던 파일은 건드리지 않았고, 그 주소로는 요청도 가지 않았다.
  assert.deepEqual(fs.readFileSync(existing), fakeWebp(9));
  assert.equal(live.log.hits.length, 3);
  assert.ok(live.log.hits.every((h) => h.method === 'GET'));
  // 쓰다 만 파일이 남지 않는다.
  assert.deepEqual(fs.readdirSync(path.join(root, 'data/assets/portraits')).sort(), ['D _ 킬러.webp', '가나.webp', '마바.webp']);

  // 다시 돌리면 받은 것은 건너뛰고 실패한 것만 다시 시도한다.
  const again = await runFetch(rebuilt, { root, origin: live.origin, delayMs: 0 });
  assert.equal(again.downloaded.length, 0);
  assert.equal(again.skipped.length, 3);
  assert.equal(again.failed.length, 1);
  assert.equal(live.log.hits.length, 4);
});

test('받기: 한 번에 조금씩 — 동시 요청 수를 넘지 않고 요청 사이에 간격을 둔다', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scraped = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`니케${i}`, { id: 100 + i }]));
  const paths = buildManifest({ scraped }).entries.map((e) => new URL(e.url).pathname);
  const server = await fakeServer(Object.fromEntries(paths.map((p) => [p, serveImage(fakeWebp(), 60)])));
  t.after(() => server.close());
  const manifest = buildManifest({ scraped, origin: server.origin });

  // 요청을 보낸 시각은 보내는 쪽에서 잰다(서버에 닿은 시각은 연결 사정에 따라 흔들린다).
  const starts = [];
  const timedFetch = (url, init) => {
    starts.push(Date.now());
    return fetch(url, init);
  };
  const report = await runFetch(manifest, { root, origin: server.origin, concurrency: 2, delayMs: 40, fetchImpl: timedFetch });
  assert.equal(report.downloaded.length, 6);
  assert.ok(server.log.maxInFlight <= 2, `동시에 ${server.log.maxInFlight}개`);
  assert.equal(starts.length, 6);
  // 요청 여섯 건 사이의 간격 다섯 번(타이머의 1ms 안팎 오차만 봐준다). 이웃한 요청도 붙어서 나가지 않는다.
  assert.ok(starts.at(-1) - starts[0] >= 5 * 40 - 10, `여섯 건이 ${starts.at(-1) - starts[0]}ms 안에 시작됐다`);
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= 40 - 10, `${i}번째 간격 ${starts[i] - starts[i - 1]}ms`);

  // 동시 요청 수는 4를 넘길 수 없다(큰 값을 줘도).
  const root2 = tempRoot();
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  server.log.maxInFlight = 0;
  await runFetch(manifest, { root: root2, origin: server.origin, concurrency: 64, delayMs: 0 });
  assert.ok(server.log.maxInFlight <= 4, `동시에 ${server.log.maxInFlight}개`);
  assert.equal(DEFAULT_CONCURRENCY, 2);
  assert.ok(DEFAULT_DELAY_MS >= 200);
});

test('받기: 다른 호스트·밖으로 나가는 저장 위치가 섞인 목록은 그 줄만 거부하고 요청을 보내지 않는다', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const other = await fakeServer({ '/x.webp': serveImage(fakeWebp()) });
  t.after(() => other.close());
  const server = await fakeServer({ '/ok.webp': serveImage(fakeWebp(3)) });
  t.after(() => server.close());
  const manifest = {
    host: server.origin,
    entries: [
      { kind: 'portrait', name: '남의 호스트', url: `${other.origin}/x.webp`, dest: 'data/assets/portraits/a.webp' },
      { kind: 'portrait', name: '밖으로', url: `${server.origin}/ok.webp`, dest: 'data/assets/../../escape.webp' },
      { kind: 'portrait', name: '정상', url: `${server.origin}/ok.webp`, dest: 'data/assets/portraits/ok.webp' },
    ],
  };
  const report = await runFetch(manifest, { root, origin: server.origin, delayMs: 0 });
  assert.deepEqual(report.rejected.map((r) => r.name), ['남의 호스트', '밖으로']);
  assert.match(report.rejected[0].reason, /정해진 호스트/);
  assert.match(report.rejected[1].reason, /저장 위치/);
  assert.deepEqual(report.downloaded.map((d) => d.name), ['정상']);
  assert.equal(other.log.hits.length, 0, '다른 호스트로는 요청이 가지 않는다');
  assert.equal(fs.existsSync(path.join(root, '..', 'escape.webp')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escape.webp')), false);

  // 목록 자체의 호스트가 다르면 아무것도 받지 않는다. 기본 호스트는 공식 CDN 한 곳이다.
  await assert.rejects(runFetch({ ...manifest, host: other.origin }, { root, origin: server.origin }), /정해진 호스트/);
  await assert.rejects(runFetch(manifest, { root }), /정해진 호스트\(https:\/\/sg-tools-cdn\.blablalink\.com\)/);
  await assert.rejects(runFetch(manifest, {}), /root/);
});

test('받기: 다른 주소로 넘기는 응답은 따라가지 않고, 이미지가 아닌 응답·빈 응답·너무 큰 응답은 저장하지 않는다', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const elsewhere = await fakeServer({ '/moved.webp': serveImage(fakeWebp()) });
  t.after(() => elsewhere.close());
  const server = await fakeServer({
    '/redirect.webp': (_req, res) => res.writeHead(302, { location: `${elsewhere.origin}/moved.webp` }).end(),
    '/html.webp': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>오류 페이지</html>'),
    '/empty.webp': (_req, res) => res.writeHead(200).end(),
    '/big.webp': serveImage(fakeWebp(1, 5000)),
    '/slow.webp': serveImage(fakeWebp(), 400),
  });
  t.after(() => server.close());
  const entry = (name) => ({ kind: 'portrait', name, url: `${server.origin}/${name}.webp`, dest: `data/assets/portraits/${name}.webp` });
  const manifest = { host: server.origin, entries: ['redirect', 'html', 'empty', 'big', 'slow'].map(entry) };
  const report = await runFetch(manifest, { root, origin: server.origin, delayMs: 0, concurrency: 1, maxBytes: 1024, timeoutMs: 150, maxConsecutiveFailures: 99 });
  assert.deepEqual(report.downloaded, []);
  const reasons = Object.fromEntries(report.failed.map((f) => [f.name, f.reason]));
  assert.match(reasons.redirect, /따라가지 않는다/);
  assert.match(reasons.html, /이미지가 아니다/);
  assert.match(reasons.empty, /빈 응답/);
  assert.match(reasons.big, /너무 크다/);
  assert.match(reasons.slow, /시간 초과/);
  assert.equal(elsewhere.log.hits.length, 0, '넘겨진 주소로는 요청이 가지 않는다');
  assert.equal(fs.existsSync(path.join(root, 'data/assets/portraits')), false, '아무것도 쓰지 않았다');
});

test('받기: 연달아 실패하면 멈추고 남은 것은 시도하지 않는다', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = await fakeServer({});
  t.after(() => server.close());
  const manifest = {
    host: server.origin,
    entries: Array.from({ length: 10 }, (_, i) => ({ kind: 'portrait', name: `n${i}`, url: `${server.origin}/n${i}.webp`, dest: `data/assets/portraits/n${i}.webp` })),
  };
  const report = await runFetch(manifest, { root, origin: server.origin, delayMs: 0, concurrency: 1, maxConsecutiveFailures: 3 });
  assert.equal(report.failed.length, 3);
  assert.equal(report.not_attempted.length, 7);
  assert.equal(report.halted, true);
  assert.equal(server.log.hits.length, 3, '멈춘 뒤에는 서버를 두드리지 않는다');
});

// ── 명령줄 도구 ───────────────────────────────────────────────────────────────

const SCRIPT = path.join(ROOT, 'scripts', 'fetch-assets.mjs');
const BLOCK_NETWORK = new URL('../helpers/block-network.mjs', import.meta.url).href;
/** 네트워크를 쓰려 하면 곧바로 죽는 프로세스로 도구를 돌린다. */
const runCli = (...args) => spawnSync(process.execPath, ['--import', BLOCK_NETWORK, SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });

test('--list는 네트워크 없이 받을 것의 종류별 개수와 출처를 보여 주고, 아무것도 쓰지 않는다', () => {
  const manifestFile = path.join(ROOT, ASSETS_DIR, 'manifest.json');
  const before = fs.existsSync(manifestFile) ? fs.statSync(manifestFile).mtimeMs : null;
  const out = runCli('--list');
  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stderr, /NETWORK-ATTEMPT/);
  assert.match(out.stdout, /받을 것/);
  assert.match(out.stdout, /출처: https:\/\/sg-tools-cdn\.blablalink\.com/);
  assert.match(out.stdout, /저장: data\/assets\//);
  assert.match(out.stdout, /합계: \d+개/);
  assert.match(out.stdout, /받지 않는 것/);
  for (const label of ['속성 아이콘 5종', '버스트 단계 아이콘 4종', '기업 아이콘 5종', '무기 종류 아이콘 6종', '이상 개체 보스 이미지 5종']) assert.ok(out.stdout.includes(label), label);
  // 주소를 한 줄씩 늘어놓지 않는다(개수만).
  assert.doesNotMatch(out.stdout, /blablalink\.com\/[a-z]{2}-\d{2}\//);
  const after = fs.existsSync(manifestFile) ? fs.statSync(manifestFile).mtimeMs : null;
  assert.equal(after, before, '--list는 목록 파일을 쓰지 않는다');
});

test('인자가 없거나 틀리면 쓰는 법을 보여 주고 아무것도 하지 않는다', () => {
  const none = runCli();
  assert.equal(none.status, 2);
  assert.match(none.stdout, /--list/);
  const bad = runCli('--host', 'https://example.com');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /모르는 인자/);
  const both = runCli('--list', '--run');
  assert.equal(both.status, 2);
  assert.doesNotMatch(`${none.stderr}${bad.stderr}${both.stderr}`, /NETWORK-ATTEMPT/);
});

test('명령줄 도구에는 받는 호스트를 바꾸는 길이 없고, 실제로 받는 것은 --run뿐이다', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const code = source.replace(/(^|\s)\/\/[^\n]*/g, '$1');
  // 호스트를 넘기는 인자·환경 변수가 없다 — runFetch에 넘기는 것은 저장소 루트와 진행 알림뿐이다.
  assert.doesNotMatch(code, /process\.env|origin\s*:|--host|--origin|--url/);
  assert.match(code, /runFetch\(manifest, \{\s*root: ROOT,\s*onEvent:/);
  assert.equal(code.match(/runFetch\(/g).length, 1);
  // 받기 앞에는 --list·--manifest의 끝이 있다.
  const main = code.slice(code.indexOf('async function main('));
  assert.ok(main.indexOf("if (argv[0] === '--list') return 0;") < main.indexOf('runFetch('));
  assert.ok(main.indexOf("if (argv[0] === '--manifest') return 0;") < main.indexOf('runFetch('));
  // 도구도 규칙 모듈도 게임 클라이언트의 폴더나 쿠키·계정 파일을 알지 못한다.
  const lib = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-assets-lib.mjs'), 'utf8').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  for (const text of [code, lib]) assert.doesNotMatch(text, /session_cookie|profiles\/|data\/accounts|Program Files|AppData|\.unity3d|assetbundle/i);
  // 받은 것은 저장소에 들어가지 않는다.
  assert.ok(read('.gitignore').split(/\r?\n/).includes('data/assets/'));
});
