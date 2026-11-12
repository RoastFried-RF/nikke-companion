// 시뮬 결과 캐시 — 런타임(src/core/runtime.mjs의 계약)을 감싸 같은 엔진 판·같은 요청을 다시 계산하지 않게 한다.
// 형식과 무효화 규칙은 docs/data-model.md §시뮬 결과 캐시.
//
// 이 파일은 계산 모듈이다: `node:` 모듈을 import하지 않는다. 해시는 Web Crypto(`crypto.subtle`), 저장소는 주입받는다.
//
//   저장소 계약   store.get(key)        → 저장한 항목 | undefined   (값 또는 Promise. 호출자가 바꿔도 되는 사본)
//                 store.set(key, entry) → (값 또는 Promise)
//   구현: 메모리는 아래 `createMemoryStore`, 파일은 `src/runtime/node.mjs`의 `createFileCacheStore`.
//
// 원칙: 캐시는 속도만 바꾼다. 틀릴 수 있으면 쓰지 않고(엔진 판을 모르거나 작업 폴더가 dirty, 비결정론 요청),
// 저장소가 고장 나도 계산은 끝까지 한다(경고만 남긴다).

export const CACHE_SCHEMA_VERSION = 1;

/** 결과에 영향을 주지 않는 호출용 칸(요청 맨 위). 키를 만들 때 뺀다. `id`는 배치 결과 줄에 되돌려 받는 표시일 뿐이다. */
export const CALL_ONLY_FIELDS = Object.freeze(['id']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const messageOf = (e) => (e instanceof Error ? e.message : String(e));

/**
 * 키 순서와 무관한 JSON 표기. 객체의 키는 코드 단위 순으로 정렬하고(로케일과 무관), 배열 순서는 지킨다
 * (편성의 배치 순서가 결과를 바꾼다). 값이 undefined인 키는 JSON.stringify처럼 뺀다.
 * `null`은 그대로 둔다 — 엔진에서는 「적지 않음」과 같지만, 같은 요청을 다른 키로 보는 쪽(다시 계산)이
 * 다른 요청을 같은 키로 보는 쪽보다 안전하다.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 호출용 칸을 뺀 요청(얕은 복사). 키와 저장 항목의 `request`가 이것이다. */
export function normalizeRequest(request) {
  if (!isPlainObject(request)) return request;
  return Object.fromEntries(Object.entries(request).filter(([k]) => !CALL_ONLY_FIELDS.includes(k)));
}

/**
 * 엔진이 결정론을 보장하는 요청인가: 기대값 모드(`sim.expected: true`)이거나 시드(`sim.seed` 정수)를 줬다
 * (vendor/nikke-calc/docs/SIM-JSON.md §보장). 둘 다 없으면 실행마다 값이 다르다.
 */
export function isDeterministic(request) {
  const sim = isPlainObject(request) ? request.sim : null;
  return isPlainObject(sim) && (sim.expected === true || Number.isInteger(sim.seed));
}

/**
 * 저장하고 읽어도 되는 요청인가. 결정론이어야 하고, 요청 밖의 파일을 가리키지 않아야 한다 —
 * 이름으로 가리킨 육성 프로필(`profile` 문자열 → 엔진의 추적 밖 `profiles/`)과 보스 스크립트 파일 경로
 * (`boss`가 `.json`으로 끝남)는 엔진 커밋이 같아도 내용이 바뀔 수 있다.
 */
export function isCacheableRequest(request) {
  if (!isDeterministic(request)) return false;
  if (typeof request.profile === 'string') return false;
  if (typeof request.boss === 'string' && /\.json$/i.test(request.boss.trim())) return false;
  return true;
}

/** SHA-256(UTF-8) → 소문자 16진수 64자. Web Crypto가 없으면 던진다. */
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto(crypto.subtle)를 쓸 수 없다');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 해시에 넣는 글: 엔진 커밋 + 줄바꿈 + 정규화된 요청 JSON. */
const keyText = (commit, requestText) => `${commit}\n${requestText}`;

/**
 * 캐시 키 = 엔진 커밋 + 요청의 정규화된 JSON(키 순서와 무관, 호출용 칸 제외)의 SHA-256.
 * @param {string} commit 엔진 커밋(HEAD 해시)
 * @param {object} request 엔진 요청
 * @param {(text: string) => string | Promise<string>} [hash]
 */
export async function cacheKey(commit, request, hash = sha256Hex) {
  return hash(keyText(commit, canonicalJson(normalizeRequest(request))));
}

/**
 * 메모리 저장소. 프로세스(앱)가 살아 있는 동안만 남는다. 넣을 때와 꺼낼 때 복사하므로 돌려받은 결과를
 * 호출자가 바꿔도 저장된 값은 그대로다. `maxEntries`를 넘으면 가장 먼저 넣은 것부터 버린다.
 */
export function createMemoryStore({ maxEntries = 500 } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      return entry === undefined ? undefined : structuredClone(entry);
    },
    set(key, entry) {
      entries.delete(key);
      entries.set(key, structuredClone(entry));
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** 엔진 결과 줄을 저장해도 되는가: 오류가 아니고, 결과가 스스로 밝힌 평가기 판이 키의 엔진 판과 같다. */
function storableRow(row, commit) {
  if (!isPlainObject(row) || 'error' in row) return false;
  const evaluator = row.evaluator;
  if (evaluator === undefined || evaluator === null) return true; // 판을 밝히지 않는 런타임(테스트용 가짜)
  return isPlainObject(evaluator) && evaluator.commit === commit && (evaluator.dirty === false || evaluator.dirty === undefined);
}

/** 저장소에서 읽은 항목이 이 키·이 엔진 판·이 요청의 온전한 결과인가. */
function validEntry(entry, key, commit, requestText) {
  if (!isPlainObject(entry) || entry.cache_schema_version !== CACHE_SCHEMA_VERSION) return false;
  if (entry.key !== key || !isPlainObject(entry.engine) || entry.engine.commit !== commit) return false;
  if (canonicalJson(entry.request) !== requestText) return false; // 해시 충돌·손으로 고친 파일
  const result = entry.result;
  return storableRow(result, commit) && Number.isFinite(result.total_damage) && Array.isArray(result.members);
}

/** 엔진 버전으로 캐시를 쓸 수 있는지 본다. 쓸 수 없으면 이유(문장). */
function versionProblem(version) {
  if (!isPlainObject(version) || typeof version.commit !== 'string' || version.commit === '') {
    return '엔진 커밋을 알 수 없어 캐시를 쓰지 않았다';
  }
  if (version.dirty === true) return '엔진 작업 폴더에 커밋하지 않은 변경이 있어 캐시를 쓰지 않았다';
  if (version.dirty !== false) return '엔진 작업 폴더가 깨끗한지 확인할 수 없어 캐시를 쓰지 않았다';
  return null;
}

/**
 * 런타임을 감싸 시뮬 결과를 저장소에서 먼저 찾는다. 돌려주는 객체는 같은 런타임 계약(`runBatch`는 입력 순서의
 * 결과 배열)에 `runBatchWithStats`를 더한 것이다 — 계산 모듈은 `engineAccess().runBatchWithStats`로 통계를 받는다.
 *
 * 배치 한 번의 흐름:
 *   1. 엔진 버전을 묻는다. 커밋을 모르거나 작업 폴더가 dirty(또는 확인 불가)면 저장소를 건드리지 않고 그대로 계산한다.
 *   2. 저장해도 되는 요청(`isCacheableRequest`)만 키를 만들어 저장소에서 찾는다.
 *   3. 적중한 요청은 엔진에 보내지 않는다. 빗나간 요청만(같은 배치 안의 같은 요청은 한 번만) 엔진에 보낸다.
 *   4. 오류가 아닌 결과를 저장하고, 입력 순서대로 합쳐 돌려준다. 줄의 `id`는 입력 배치에서의 자리다.
 *
 * 통계 `{hits, misses, stored, warnings}`: hits = 엔진에 보내지 않고 채운 요청 수, misses = 엔진에 보낸 요청 수
 * (hits + misses = 요청 수), stored = 새로 저장한 수, warnings = 캐시를 못 쓴 이유·저장소 문제(문장).
 * 저장소가 던지거나 깨진 항목을 돌려줘도 실패하지 않는다 — 그 요청을 다시 계산하고 warnings에 적는다.
 *
 * @template {{runBatch: Function, engineVersion?: Function}} T
 * @param {T} runtime 감쌀 런타임
 * @param {{get: (key: string) => any, set: (key: string, entry: object) => any}} store 저장소
 * @param {{hash?: (text: string) => string | Promise<string>, now?: () => Date}} [options]
 */
export function withCache(runtime, store, options = {}) {
  const hash = options.hash ?? sha256Hex;
  const now = options.now ?? (() => new Date());

  /** @returns {Promise<{results: any[], cache: {hits: number, misses: number, stored: number, warnings: string[]}}>} */
  async function runBatchWithStats(requests, batchOptions) {
    const stats = { hits: 0, misses: 0, stored: 0, warnings: [] };
    if (!Array.isArray(requests) || requests.length === 0) return { results: [], cache: stats };

    const uncached = async (warning) => {
      stats.warnings.push(warning);
      stats.misses = requests.length;
      return { results: await runtime.runBatch(requests, batchOptions), cache: stats };
    };

    // 1. 엔진 판
    let version = null;
    try {
      version = typeof runtime.engineVersion === 'function' ? await runtime.engineVersion() : null;
    } catch {
      version = null;
    }
    const problem = versionProblem(version);
    if (problem) return uncached(problem);
    const commit = version.commit;

    // 2. 키
    /** @type {({key: string, text: string, request: object} | null)[]} 저장할 수 없는 요청은 null */
    let keyed;
    try {
      keyed = await Promise.all(
        requests.map(async (request) => {
          if (!isCacheableRequest(request)) return null;
          const normalized = normalizeRequest(request);
          const text = canonicalJson(normalized);
          const key = await hash(keyText(commit, text));
          if (typeof key !== 'string' || key === '') throw new Error('해시가 문자열이 아니다');
          return { key, text, request: normalized };
        }),
      );
    } catch (e) {
      return uncached(`캐시 키를 만들 수 없어 캐시를 쓰지 않았다: ${messageOf(e)}`);
    }

    // 3. 저장소에서 찾기 (같은 키는 한 번만 읽는다)
    const found = new Map();
    const unreadable = [];
    let invalid = 0;
    const uniqueKeys = new Map(keyed.filter(Boolean).map((k) => [k.key, k]));
    await Promise.all(
      [...uniqueKeys.values()].map(async ({ key, text }) => {
        let entry;
        try {
          entry = await store.get(key);
        } catch (e) {
          unreadable.push(messageOf(e));
          return;
        }
        if (entry === undefined || entry === null) return;
        if (validEntry(entry, key, commit, text)) found.set(key, entry.result);
        else invalid += 1;
      }),
    );
    if (unreadable.length) stats.warnings.push(`캐시를 읽지 못해 ${unreadable.length}건을 다시 계산했다: ${unreadable[0]}`);
    if (invalid) stats.warnings.push(`캐시 항목 ${invalid}건을 쓸 수 없어(깨졌거나 형식이 다르다) 다시 계산했다`);

    // 4. 빗나간 요청만 엔진에 보낸다
    const results = new Array(requests.length).fill(null);
    const withId = (row, i) => (isPlainObject(row) ? { ...row, id: i } : row);
    /** @type {{request: object, keyed: object | null, slots: number[]}[]} */
    const send = [];
    const pending = new Map();
    for (const [i, request] of requests.entries()) {
      const k = keyed[i];
      if (k && found.has(k.key)) {
        results[i] = withId(structuredClone(found.get(k.key)), i);
        stats.hits += 1;
      } else if (k && pending.has(k.key)) {
        pending.get(k.key).slots.push(i); // 같은 배치 안의 같은 요청 — 한 번만 계산한다
        stats.hits += 1;
      } else {
        const item = { request, keyed: k, slots: [i] };
        if (k) pending.set(k.key, item);
        send.push(item);
      }
    }
    if (send.length === 0) return { results, cache: stats };

    const rows = await runtime.runBatch(send.map((s) => s.request), batchOptions);
    if (!Array.isArray(rows) || rows.length !== send.length) {
      throw new Error(`엔진 런타임이 요청 ${send.length}건에 결과 ${Array.isArray(rows) ? rows.length : 0}건을 돌려줬다`);
    }
    stats.misses = send.length;

    // 5. 저장하고 입력 순서대로 합친다
    const unwritable = [];
    let versionChanged = 0;
    for (const [n, item] of send.entries()) {
      const row = rows[n];
      for (const [nth, i] of item.slots.entries()) results[i] = withId(nth === 0 ? row : structuredClone(row), i);
      if (!item.keyed || !isPlainObject(row) || 'error' in row) continue;
      if (!storableRow(row, commit)) {
        versionChanged += 1;
        continue;
      }
      const { id: _id, ...result } = row;
      try {
        await store.set(item.keyed.key, {
          cache_schema_version: CACHE_SCHEMA_VERSION,
          key: item.keyed.key,
          engine: { repo: version.repo ?? null, commit },
          request: item.keyed.request,
          result,
          stored_at: now().toISOString(),
        });
        stats.stored += 1;
      } catch (e) {
        unwritable.push(messageOf(e));
      }
    }
    if (versionChanged) stats.warnings.push(`결과가 밝힌 엔진 판이 계산 전에 확인한 판과 달라 ${versionChanged}건을 저장하지 않았다`);
    if (unwritable.length) stats.warnings.push(`캐시에 ${unwritable.length}건을 저장하지 못했다: ${unwritable[0]}`);
    return { results, cache: stats };
  }

  return {
    ...runtime,
    runBatch: async (requests, batchOptions) => (await runBatchWithStats(requests, batchOptions)).results,
    runBatchWithStats,
  };
}
