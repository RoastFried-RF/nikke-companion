// 이 앱의 엔진 런타임 — 루트 src/core/runtime.mjs의 계약을 Rust 명령으로 채운다.
// 웹뷰에는 Node가 없다. 엔진 프로세스 실행·엔진 데이터 읽기는 Rust(src-tauri/src/engine.rs)가 하고,
// 요청을 만들고 결과를 해석하는 계산은 루트의 src/core가 그대로 한다(Node CLI와 같은 코드).

import type { EngineRuntime } from '../types';
import { engineCatalog, engineRunBatch, engineVersion } from './backend';

export const tauriRuntime: EngineRuntime = {
  loadCatalog: () => engineCatalog(),
  engineVersion: () => engineVersion(),
  // 동시 실행 수·시간 제한·엔진 폴더는 Rust 쪽 설정이 정한다. 화면에서 넘기지 않는다.
  runBatch: (requests) => engineRunBatch(requests),
};
