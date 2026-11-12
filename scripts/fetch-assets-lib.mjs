// 리소스 받기의 규칙(scripts/fetch-assets.mjs가 쓴다): 받을 목록 만들기, 주소 규칙, 받기.
// 설명은 docs/ui-redesign.md §리소스.
//
// 원칙:
// - 받는 곳은 게임사가 웹에 공개하는 공식 도구 사이트의 CDN 한 곳이다 — 엔진(vendor/nikke-calc)이 초상화를 받는 곳과 같다.
//   다른 호스트의 주소는 받지 않는다. 다른 호스트로 넘기는 응답(리다이렉트)도 따라가지 않는다.
// - 주소는 엔진 스크레이퍼의 코드에서 **확인된 경로만** 만든다. 확인하지 못한 종류는 목록에 「받지 않는 것」으로 남긴다 —
//   주소를 추측해 두드려 보지 않는다.
// - 서버에 부담을 주지 않는다: 동시에 몇 개만, 요청 사이에 간격을 두고, 이미 있는 파일은 건너뛰고, 연달아 실패하면 멈춘다.
// - 받은 파일은 data/assets/(gitignore)에만 쓴다. 게임 이미지를 저장소에 넣지 않는다.
// - 설치된 게임 클라이언트의 파일은 건드리지 않는다(이 코드는 그 폴더를 알지도 못한다).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 받는 호스트. 엔진의 `scraper/cdn_path.py`의 `CDN_BASE`와 같아야 한다(tests/unit/fetch-assets.test.mjs가 대조한다). */
export const CDN_ORIGIN = 'https://sg-tools-cdn.blablalink.com';
/** 엔진의 `scraper/cdn_path.py`의 `LARGE_PRIMES`. 디렉터리 깊이마다 하나씩 쓴다. */
export const LARGE_PRIMES = Object.freeze([224737, 1000639, 2654435761, 2654435769, 1000621, 4294967291]);

export const MANIFEST_SCHEMA_VERSION = 1;
/** 받은 파일을 두는 곳(저장소 루트 기준). gitignore에 있다. */
export const ASSETS_DIR = 'data/assets';
export const MANIFEST_FILE = `${ASSETS_DIR}/manifest.json`;

/** 한 번에 보내는 요청 수와 요청 사이의 간격(밀리초). */
export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_DELAY_MS = 300;
/** 파일 하나의 최대 크기. 초상화 한 장은 수십 KB다. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 요청 하나의 시간 제한(밀리초). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** 연달아 이만큼 실패하면 남은 것을 받지 않고 멈춘다(주소 규칙이 바뀌었거나 서버가 막았다 — 계속 두드리지 않는다). */
export const MAX_CONSECUTIVE_FAILURES = 5;

export const KIND_LABELS = Object.freeze({
  portrait: '니케 초상화',
  element_icon: '속성 아이콘',
  burst_icon: '버스트 단계 아이콘',
  class_icon: '클래스 아이콘',
  corp_icon: '기업 아이콘',
  weapon_icon: '무기 종류 아이콘',
  boss_image: '이상 개체 보스 이미지',
  equip_icon: '장비 부위 아이콘',
});

/** 종류 → data/assets 아래의 폴더. 앱의 이미지 명령(app/src-tauri/src/assets.rs)이 읽는 자리와 같다. */
export const KIND_DIRS = Object.freeze({
  portrait: 'portraits',
  element_icon: 'icons/element',
  burst_icon: 'icons/burst',
  class_icon: 'icons/class',
  corp_icon: 'icons/corp',
  weapon_icon: 'icons/weapon',
  boss_image: 'bosses',
  equip_icon: 'icons/equip',
});

/** 초상화의 평문 경로. 엔진의 `scraper/cdn_fetch.py`의 `PORTRAIT_PATH`("/character/mi/mi_c{rid:03d}_00_s.webp")와 같다. */
export const PORTRAIT_PATH_TEMPLATE = '/character/mi/mi_c{rid:03d}_00_s.webp';
export const portraitPlainPath = (resourceId) => PORTRAIT_PATH_TEMPLATE.replace('{rid:03d}', String(resourceId).padStart(3, '0'));

const EVIDENCE_PORTRAIT =
  'vendor/nikke-calc/scraper/cdn_fetch.py — PORTRAIT_PATH와 download_images()(256×512 썸네일, resource_id는 scraper/nikke_scraped.json의 id). ' +
  '주소 규칙은 vendor/nikke-calc/scraper/cdn_path.py — obfuscate()';

/**
 * 받지 않는 종류와 까닭. 엔진 스크레이퍼의 코드·주석(cdn_fetch.py·cdn_path.py·cdn_tables.py)과 받아 둔 표에서
 * 이 종류들의 CDN 경로를 찾지 못했다 — 주소를 추측하지 않는다. `instead`는 앱이 대신 쓰는 것이다.
 */
export const UNRESOLVED = Object.freeze([
  {
    kind: 'element_icon',
    wanted: ['작열', '수냉', '풍압', '전격', '철갑'],
    reason: 'CDN 경로가 엔진 스크레이퍼 코드에 없다',
    instead: '엔진 폴더에 이미 있는 image/icon/icn_element_*.webp(파일 이름은 vendor/nikke-calc/runner/squads.py의 ELEMENT_ICON에서 확인). 없으면 직접 그린 도형',
  },
  {
    kind: 'burst_icon',
    wanted: ['1', '2', '3', 'A'],
    reason: 'CDN 경로가 엔진 스크레이퍼 코드에 없다',
    instead: '엔진 폴더에 이미 있는 image/icon/icn_burst_*.webp(runner/squads.py의 BURST_ICON). 없으면 직접 그린 배지(I·II·III·A)',
  },
  {
    kind: 'class_icon',
    wanted: ['화력형', '지원형', '방어형'],
    reason: 'CDN 경로가 엔진 스크레이퍼 코드에 없다',
    instead: '엔진 폴더에 이미 있는 image/icon/icn_class_*.webp(runner/squads.py의 CLASS_ICON). 없으면 직접 그린 도형',
  },
  {
    kind: 'corp_icon',
    wanted: ['엘리시온', '미실리스', '테트라', '필그림', '어브노말'],
    reason: 'CDN 경로가 엔진 스크레이퍼 코드에 없다. 엔진 폴더의 icn_corp_01~05.webp는 어느 번호가 어느 기업인지 코드에서 확인하지 못했다',
    instead: '직접 그린 글자 배지',
  },
  {
    kind: 'weapon_icon',
    wanted: ['AR', 'SMG', 'SG', 'SR', 'MG', 'RL'],
    reason: 'CDN 경로도 엔진 폴더의 파일도 없다',
    instead: '직접 그린 글자 배지',
  },
  {
    kind: 'boss_image',
    wanted: ['indivilia', 'ultra', 'harvester', 'kraken', 'mirror_container'],
    reason: 'CDN 경로가 엔진 스크레이퍼 코드에 없다(엔진은 이상 개체 보스를 다루지 않는다)',
    instead: '사용자의 캡처에서 잘라 둔 data/captures/bosses/<보스 id>.png. 없으면 속성 색 대체',
  },
  {
    kind: 'equip_icon',
    wanted: ['머리', '몸통', '팔', '다리'],
    reason: '장비 표(/equip/ItemEquipTable-ko.json)의 경로는 있지만 아이콘 이미지의 경로는 없다',
    instead: '아직 쓰는 화면이 없다. 쓰게 되면 직접 그린 도형',
  },
]);

/** JS의 ToInt32. 파이썬 쪽의 `ctypes.c_int32((v * 33 + ord) & 0xFFFFFFFF)`와 같은 값이다. */
function djb2(text, seed) {
  let value = seed;
  for (const ch of text) value = (value * 33 + ch.codePointAt(0)) | 0;
  return value;
}

function dirToken(plain, prime) {
  const r = ((djb2(plain, prime) % prime) + prime) % prime;
  const letters = String.fromCharCode(97 + (Math.floor(r / 26) % 26)) + String.fromCharCode(97 + (r % 26));
  return `${letters}-${String(r % 99).padStart(2, '0')}`;
}

/**
 * 평문 경로 → CDN의 상대 경로. 엔진의 `scraper/cdn_path.py`의 `obfuscate()`를 그대로 옮겼다:
 * 디렉터리 토막은 djb2 해시(깊이별 소수)로 만든 `xx-99` 꼴, 파일 이름은 md5(평문 전체 경로) + 원래 확장자.
 */
export function obfuscate(plainPath) {
  const plain = String(plainPath).replace(/^\/+/, '');
  const segments = plain.split('/').filter(Boolean);
  if (segments.length === 0 || segments.length > LARGE_PRIMES.length + 1) throw new Error(`경로의 깊이가 규칙 밖이다: ${plainPath}`);
  return segments
    .map((segment, i) => {
      if (i < segments.length - 1) return dirToken(plain, LARGE_PRIMES[i]);
      const ext = segment.split('.').slice(1).join('.');
      return `${crypto.createHash('md5').update(plain, 'utf8').digest('hex')}.${ext}`;
    })
    .join('/');
}

/** 평문 경로 → 받을 주소. */
export const cdnUrl = (plainPath, origin = CDN_ORIGIN) => `${origin}/${obfuscate(plainPath)}`;

/**
 * 니케 이름 → 이미지 파일 이름(확장자 제외). 엔진의 `scraper/cdn_fetch.py`의 `safe_filename()`과 같다:
 * Windows에서 금지된 글자 `\ / : * ? " < > |`를 `_`로 바꾼다(예: 'D : 킬러 와이프' → 'D _ 킬러 와이프').
 * 앱의 Rust 쪽(app/src-tauri/src/assets.rs의 `safe_filename`)도 같은 규칙이다.
 */
export function safeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 받을 목록을 만든다. 네트워크를 쓰지 않는다.
 *
 * 받는 것은 초상화뿐이다(경로가 확인된 유일한 종류) — 그것도 엔진 폴더의 `image/`에 아직 없는 니케만.
 * 엔진 폴더에 이미 있는 초상화는 앱이 거기서 바로 읽는다(다시 받지 않는다).
 *
 * @param {{scraped: Record<string, {id: number}>, enginePortraits?: Iterable<string>, origin?: string, now?: () => Date}} input
 *   `scraped`는 엔진의 `scraper/nikke_scraped.json`(이름 → {id, …}), `enginePortraits`는 엔진 `image/` 폴더의 파일 이름들.
 */
export function buildManifest({ scraped, enginePortraits = [], origin = CDN_ORIGIN, now = () => new Date() }) {
  if (!isPlainObject(scraped)) throw new Error('캐릭터 목록(nikke_scraped.json)이 객체가 아니다');
  const have = new Set(enginePortraits);
  const entries = [];
  let present = 0;
  const skipped = [];
  for (const [name, entry] of Object.entries(scraped)) {
    const rid = entry?.id;
    if (!Number.isInteger(rid) || rid < 0) {
      skipped.push({ name, reason: 'id(resource_id)가 정수가 아니다' });
      continue;
    }
    const file = `${safeFilename(name)}.webp`;
    if (have.has(file)) {
      present += 1;
      continue;
    }
    const plain = portraitPlainPath(rid);
    entries.push({
      kind: 'portrait',
      name,
      resource_id: rid,
      plain_path: plain,
      url: cdnUrl(plain, origin),
      dest: `${ASSETS_DIR}/${KIND_DIRS.portrait}/${file}`,
      evidence: EVIDENCE_PORTRAIT,
    });
  }
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    kind: 'asset_manifest',
    generated_at: now().toISOString(),
    host: origin,
    host_note: '게임사가 웹에 공개하는 공식 도구 사이트의 CDN — 엔진(vendor/nikke-calc)이 초상화를 받는 곳과 같다. 다른 호스트의 주소는 받지 않는다.',
    dest_root: ASSETS_DIR,
    limits: { concurrency: DEFAULT_CONCURRENCY, delay_ms: DEFAULT_DELAY_MS, max_file_bytes: MAX_FILE_BYTES },
    entries,
    already_present: { portrait: present },
    skipped,
    unresolved: UNRESOLVED.map((u) => ({ ...u, label: KIND_LABELS[u.kind], wanted: [...u.wanted] })),
  };
}

/** 받을 것의 종류별 개수: `[{kind, label, count}]`(종류 이름순). */
export function countByKind(manifest) {
  const counts = new Map();
  for (const entry of manifest.entries ?? []) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([kind, count]) => ({ kind, label: KIND_LABELS[kind] ?? kind, count }));
}

/**
 * 목록의 한 줄을 받아도 되는지 본다. 받으면 안 되는 까닭(한국어)을 돌려주고, 괜찮으면 null.
 * - 주소의 출처(프로토콜·호스트·포트)가 정해진 한 곳과 정확히 같아야 한다. 사용자 정보(`user@`)가 든 주소도 거부한다.
 * - 저장 위치는 `data/assets/` 아래의 상대 경로여야 한다(위로 올라가는 경로·절대 경로 거부).
 */
export function entryProblem(entry, { origin = CDN_ORIGIN, root }) {
  if (!isPlainObject(entry) || typeof entry.url !== 'string' || typeof entry.dest !== 'string') return '목록의 줄에 url·dest가 없다';
  let url;
  try {
    url = new URL(entry.url);
  } catch {
    return `주소를 읽을 수 없다: ${entry.url}`;
  }
  if (url.origin !== origin || url.username !== '' || url.password !== '') return `정해진 호스트(${origin})의 주소가 아니다: ${entry.url}`;
  const dest = entry.dest.replaceAll('\\', '/');
  if (path.isAbsolute(entry.dest) || /^[A-Za-z]:/.test(dest) || dest.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    return `저장 위치가 ${ASSETS_DIR}/ 아래의 상대 경로가 아니다: ${entry.dest}`;
  }
  if (!dest.startsWith(`${ASSETS_DIR}/`)) return `저장 위치가 ${ASSETS_DIR}/ 아래가 아니다: ${entry.dest}`;
  if (root !== undefined) {
    const base = path.resolve(root, ASSETS_DIR);
    const target = path.resolve(root, dest);
    if (target !== base && !target.startsWith(base + path.sep)) return `저장 위치가 ${ASSETS_DIR}/ 밖이다: ${entry.dest}`;
  }
  return null;
}

/** 받은 내용이 그 확장자의 이미지인가(첫 바이트들로 본다). 오류 페이지 같은 것을 이미지로 저장하지 않는다. */
export function looksLikeImage(bytes, dest) {
  const ext = path.extname(dest).toLowerCase();
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (ext === '.webp') return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (ext === '.png') return bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG';
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 목록대로 받는다. 이미 있는 파일은 건너뛰고, 실패는 모아서 돌려준다(하나가 실패해도 나머지는 받는다).
 * 연달아 `maxConsecutiveFailures`건이 실패하면 남은 것은 받지 않는다(`not_attempted`).
 *
 * @param {object} manifest `buildManifest`의 결과
 * @param {{root: string, origin?: string, fetchImpl?: typeof fetch, concurrency?: number, delayMs?: number, maxBytes?: number,
 *   timeoutMs?: number, maxConsecutiveFailures?: number, onEvent?: (event: object) => void}} options
 *   `root`는 저장소 루트. `origin`은 받아도 되는 단 하나의 출처다 — 명령줄 도구는 이것을 바꾸는 길을 주지 않는다(테스트의 가짜 서버용).
 * @returns {Promise<{total: number, downloaded: object[], skipped: object[], failed: object[], rejected: object[], not_attempted: object[]}>}
 */
export async function runFetch(manifest, options) {
  const {
    root,
    origin = CDN_ORIGIN,
    fetchImpl = globalThis.fetch,
    concurrency = DEFAULT_CONCURRENCY,
    delayMs = DEFAULT_DELAY_MS,
    maxBytes = MAX_FILE_BYTES,
    timeoutMs = REQUEST_TIMEOUT_MS,
    maxConsecutiveFailures = MAX_CONSECUTIVE_FAILURES,
    onEvent = () => {},
  } = options ?? {};
  if (typeof root !== 'string' || root === '') throw new Error('저장소 루트(root)를 줘야 한다');
  if (manifest?.host !== origin) throw new Error(`목록의 호스트(${manifest?.host})가 정해진 호스트(${origin})와 다르다 — 받지 않는다`);
  const workers = Math.max(1, Math.min(4, Math.floor(concurrency) || 1));
  const gap = Math.max(0, delayMs);

  const report = { total: manifest.entries.length, downloaded: [], skipped: [], failed: [], rejected: [], not_attempted: [] };
  const brief = (entry) => ({ kind: entry?.kind ?? null, name: entry?.name ?? null, url: entry?.url ?? null, dest: entry?.dest ?? null });
  const queue = [];
  for (const entry of manifest.entries) {
    const problem = entryProblem(entry, { origin, root });
    if (problem) {
      report.rejected.push({ ...brief(entry), reason: problem });
      onEvent({ type: 'rejected', entry, reason: problem });
      continue;
    }
    const target = path.resolve(root, entry.dest);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      report.skipped.push(brief(entry));
      onEvent({ type: 'skipped', entry });
      continue;
    }
    queue.push({ entry, target });
  }

  let nextStart = 0; // 다음 요청을 시작해도 되는 시각 — 일꾼들이 함께 쓴다(요청 사이의 간격).
  let consecutive = 0;
  let halted = false;

  async function fetchOne({ entry, target }) {
    const response = await fetchImpl(entry.url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200) {
      // 다른 곳으로 넘기는 응답(3xx)도 따라가지 않는다 — 정해진 호스트 밖의 주소일 수 있다.
      throw new Error(response.status >= 300 && response.status < 400 ? `다른 주소로 넘기는 응답(${response.status}) — 따라가지 않는다` : `응답 ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`너무 크다(${declared}바이트 — 한도 ${maxBytes})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error('빈 응답');
    if (bytes.length > maxBytes) throw new Error(`너무 크다(${bytes.length}바이트 — 한도 ${maxBytes})`);
    if (!looksLikeImage(bytes, entry.dest)) throw new Error('받은 내용이 그 형식의 이미지가 아니다');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    fs.writeFileSync(part, bytes);
    fs.renameSync(part, target);
    return bytes.length;
  }

  async function worker() {
    while (queue.length > 0) {
      if (halted) return;
      const job = queue.shift();
      const wait = nextStart - Date.now();
      nextStart = Math.max(Date.now(), nextStart) + gap;
      if (wait > 0) await sleep(wait);
      if (halted) {
        queue.unshift(job);
        return;
      }
      try {
        const bytes = await fetchOne(job);
        consecutive = 0;
        report.downloaded.push({ ...brief(job.entry), bytes });
        onEvent({ type: 'downloaded', entry: job.entry, bytes });
      } catch (e) {
        const reason = e?.name === 'TimeoutError' ? `시간 초과(${timeoutMs}ms)` : String(e?.message ?? e);
        report.failed.push({ ...brief(job.entry), reason });
        onEvent({ type: 'failed', entry: job.entry, reason });
        consecutive += 1;
        if (consecutive >= maxConsecutiveFailures) halted = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, () => worker()));
  for (const job of queue) report.not_attempted.push(brief(job.entry));
  report.halted = halted;
  return report;
}
