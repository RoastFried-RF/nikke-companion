// 런타임 계약 — 계산 모듈이 엔진을 쓰는 통로.
//
// 계산 모듈(account, condition, compare, candidates, growth, format, render)은 프로세스 실행·파일 읽기를
// 직접 하지 않는다. 엔진이 필요한 함수는 `deps.runtime`으로 아래 모양의 객체를 받는다:
//
//   runtime.loadCatalog()            → {nikkes, bosses, cubes}     (값 또는 Promise. cubes는 큐브 표를 읽지 못했으면 null —
//                                                                   큐브 바꿔 보기(efficiency.mjs)만 쓴다)
//   runtime.engineVersion()          → {repo, commit, dirty}       (값 또는 Promise. 모르면 commit·dirty가 null)
//   runtime.runBatch(requests, opts) → Promise<결과[]>  입력 순서 그대로, 줄마다 결과 또는 {error}
//
// 선택: runtime.runBatchWithStats(requests, opts) → Promise<{results, cache}> — 시뮬 결과 캐시로 감싼 런타임
// (`src/core/cache.mjs`의 withCache)에만 있다. 계산 모듈은 `engineAccess().runBatchWithStats`로 부른다.
//
// 선택: runtime.runViews(requests, view, opts) → Promise<({text} | {error})[]> — 엔진의 텍스트 보기(`--view <종류>`)를
// 요청마다 한 번씩 돌려 출력 글을 그대로 돌려준다(입력 순서). 엔진의 JSON 결과에 없는 것(버스트 흐름)을 읽는 길이다 —
// 지금은 버스트 흐름(src/core/burst.mjs)만 쓴다. 보기 종류는 런타임이 허용한 것만 받는다('burst').
//
// 구현: Node는 `src/runtime/node.mjs`, 데스크톱 앱은 `app/src/lib/runtime.ts`(Rust 명령 호출).
// 이 파일과 계산 모듈은 `node:` 모듈을 import하지 않는다(tests/unit/core-runtime.test.mjs가 확인한다).

export const ENGINE_REPO = 'Jgaram/nikke-calc';

const NO_RUNTIME =
  '엔진 런타임이 없다 — deps.runtime을 넘겨야 한다 (Node: src/runtime/node.mjs의 nodeRuntime, 앱: app/src/lib/runtime.ts의 tauriRuntime)';

/**
 * deps에서 엔진 접근 수단을 꺼낸다. `deps.catalog`·`deps.runBatch`를 직접 주면 런타임보다 먼저다
 * (테스트에서 엔진을 바꿔 끼울 때 쓴다).
 * @param {{runtime?: object, catalog?: object, runBatch?: Function}} [deps]
 */
export function engineAccess(deps = {}) {
  const runtime = deps.runtime ?? null;
  return {
    /** 엔진이 아는 니케와 보스 프리셋. */
    async catalog() {
      if (deps.catalog) return deps.catalog;
      if (typeof runtime?.loadCatalog !== 'function') throw new Error(NO_RUNTIME);
      return runtime.loadCatalog();
    },
    /** 요청 여러 건 → 결과 배열(입력 순서). */
    async runBatch(requests, options) {
      if (typeof deps.runBatch === 'function') return deps.runBatch(requests, options);
      if (typeof runtime?.runBatch !== 'function') throw new Error(NO_RUNTIME);
      return runtime.runBatch(requests, options);
    },
    /**
     * 요청 여러 건 → `{results, cache}`. `cache`는 캐시를 쓰는 런타임(src/core/cache.mjs의 withCache)일 때만
     * 통계 `{hits, misses, stored, warnings}`이고, 아니면 null(캐시를 쓰지 않았다)이다.
     */
    async runBatchWithStats(requests, options) {
      if (typeof deps.runBatch !== 'function' && typeof runtime?.runBatchWithStats === 'function') {
        return runtime.runBatchWithStats(requests, options);
      }
      return { results: await this.runBatch(requests, options), cache: null };
    },
    /**
     * 요청마다 엔진의 텍스트 보기를 돌려 `{text}` 또는 `{error: {type, message}}`를 입력 순서대로 받는다.
     * 런타임이 이 길을 주지 않으면 던진다 — 없는 값을 지어내지 않는다.
     */
    async runViews(requests, view, options) {
      if (typeof deps.runViews === 'function') return deps.runViews(requests, view, options);
      if (typeof runtime?.runViews !== 'function') throw new Error('이 런타임은 엔진의 텍스트 보기를 돌리지 못한다 — 버스트 흐름을 읽을 수 없다');
      return runtime.runViews(requests, view, options);
    },
    /** 엔진 버전. 런타임이 알려 주지 못하면 커밋은 null(버전 미확인)이다 — 값을 지어내지 않는다. */
    async version() {
      if (typeof runtime?.engineVersion !== 'function') return { repo: ENGINE_REPO, commit: null };
      return runtime.engineVersion();
    },
  };
}
