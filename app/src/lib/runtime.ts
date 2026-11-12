// 이 앱의 엔진 런타임 — 루트 src/core/runtime.mjs의 계약을 Rust 명령으로 채운다.
// 웹뷰에는 Node가 없다. 엔진 프로세스 실행·엔진 데이터 읽기는 Rust(src-tauri/src/engine.rs)가 하고,
// 요청을 만들고 결과를 해석하는 계산은 루트의 src/core가 그대로 한다(Node CLI와 같은 코드).

import { createMemoryStore } from '@core/cache.mjs';
import type { EngineRuntime, SimCacheStore } from '../types';
import { engineCatalog, engineRunBatch, engineVersion } from './backend';

/**
 * 시뮬 결과 캐시의 저장소(루트 src/core/cache.mjs의 저장소 계약). 이 앱은 메모리 저장소만 쓴다 —
 * 앱이 켜져 있는 동안 같은 엔진 판·같은 요청을 다시 계산하지 않고, 앱을 끄면 사라진다(파일에 쓰지 않는다).
 * 계산을 실행하는 쪽(lib/compute.ts)이 런타임을 이 저장소로 감싼다.
 */
export const simCache: SimCacheStore & { clear(): void; readonly size: number } = createMemoryStore();

export const tauriRuntime: EngineRuntime = {
  loadCatalog: () => engineCatalog(),
  engineVersion: () => engineVersion(),
  // 동시 실행 수·시간 제한·엔진 폴더는 Rust 쪽 설정이 정한다. 화면에서 넘기지 않는다.
  runBatch: (requests) => engineRunBatch(requests),
};
