// 비교 결과 문서의 형식. 정본은 docs/data-model.md §비교 결과와 src/core/compare.mjs다.

export interface ReportMember {
  name: string;
  damage: number;
  /** 편성 총딜에서 차지하는 비중(0~1). */
  share: number;
}

export interface RankingEntry {
  rank: number;
  name: string;
  /** 정수 원값. 단위 표기는 표시 단계에서 한다. */
  total_damage: number;
  /** 1위 총딜 대비 비율(0~1). 1위는 1. */
  relative_to_best: number;
  members: ReportMember[];
  notes: string[];
  engine_warnings: string[];
  ungrown_members: string[];
  /**
   * 배치 탐색(추천의 2단계)의 결과. 2단계 대상이 아니었던 조합은 null, 배치 탐색을 하지 않은 결과에는 칸이 없다.
   * 배치로 얻은 차이는 `notes`에도 문장으로 실린다 — 화면은 그 메모를 그대로 보인다.
   */
  placement?: PlacementResult | null;
}

/** 한 멤버 조합의 배치 탐색 결과(루트 src/core/search.mjs의 pickBestPlacement). */
export interface PlacementResult {
  /** 1단계 배치가 아닌 다른 배치가 가장 좋았나. */
  changed: boolean;
  /** 바꾼 것(문장). */
  changes: string[];
  original_members: string[];
  original_total_damage: number;
  /** 1단계 배치 대비 총딜 비율(1 이상). 1단계 총딜이 0이면 null. */
  gain_ratio: number | null;
  variants: { total: number; simulated: number; skipped: number; failed: number };
}

/** 추천의 탐색 요약(루트 src/core/candidates.mjs의 suggestSquads). 정본은 docs/data-model.md §배치 탐색. */
export interface SearchSummary {
  /** 배치 탐색(2단계)을 했나. */
  refine: boolean;
  /** 전체 시뮬 횟수의 상한. */
  budget: number;
  refine_top: number | null;
  /** 엔진에 맡긴 요청 수(1단계 + 2단계). 예산을 넘지 않는다. */
  sims: number;
  stage1: { requested: number; skipped: number };
  stage2: { combos: number; variants: number; requested: number; skipped: number; improved: number } | null;
  best_stage1_total: number | null;
  best_total: number | null;
}

/** 추천이 엔진 배치를 맡기기 직전에 알리는 진행 상황(suggestSquads의 `deps.onStage`). */
export interface SearchStage {
  /** 1 = 멤버 조합, 2 = 배치 변형. */
  stage: 1 | 2;
  stages: 1 | 2;
  /** 이번 단계에 맡기는 요청 수. */
  requests: number;
  /** 이 단계 전까지 쓴 시뮬 횟수. */
  used: number;
  budget: number;
}

/** 시뮬 전에 걸러진 편성(미보유·중복·인원 수·모르는 이름). */
export interface RejectedSquad {
  name: string;
  members: string[];
  reasons: string[];
}

/** 엔진이 오류를 낸 편성. 순위에 없다. */
export interface FailedSquad {
  name: string;
  members?: string[];
  error: { type?: string | null; message: string; path?: string | null };
}

export interface EngineVersion {
  repo?: string | null;
  commit?: string | null;
  /** 추적 중인 엔진 파일에 커밋하지 않은 변경이 있나. 확인하지 못했으면 null. */
  dirty?: boolean | null;
}

/**
 * 시뮬 결과 캐시 통계(루트 src/core/cache.mjs). hits = 엔진에 보내지 않고 채운 요청, misses = 엔진에 보낸 요청,
 * stored = 새로 저장한 수, warnings = 캐시를 못 쓴 이유·저장소 문제.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  stored: number;
  warnings?: string[];
}

/** 시뮬 결과 캐시의 저장소 계약(루트 src/core/cache.mjs). */
export interface SimCacheStore {
  get(key: string): unknown;
  set(key: string, entry: object): unknown;
}

/** suggest 결과에만 붙는 후보 생성 요약. */
export interface SuggestionSummary {
  considered: number;
  generated: number;
  simulated: number;
  shown: number;
  /** 탐색 요약(시뮬 횟수·예산·단계별 건수). 배치 탐색이 생기기 전의 결과 파일에는 없다. */
  search?: SearchSummary;
}

export interface CompareReport {
  schema_version: 1;
  generated_at?: string;
  account: { name?: string | null; is_test_data?: boolean; updated_at?: string | null };
  condition?: Record<string, unknown>;
  assumptions?: string[];
  engine?: EngineVersion | null;
  /** 캐시를 쓰지 않은 계산이면 null, 캐시가 생기기 전의 결과 파일에는 없다. */
  cache?: CacheStats | null;
  ranking: RankingEntry[];
  rejected: RejectedSquad[];
  failed: FailedSquad[];
  caveats: string[];
  suggestion?: SuggestionSummary;
}

/** 엔진 배치의 진행 상황(src-tauri/src/lib.rs의 EngineProgress). */
export interface EngineProgress {
  done: number;
  total: number;
}

/** 엔진이 아는 니케와 보스 프리셋. 계산 코드(src/core)가 이름·버스트 단계 확인에 쓴다. */
export interface EngineCatalog {
  nikkes: Record<string, Record<string, unknown>>;
  bosses: string[];
}

/** 엔진 요청·결과 한 건. 모양은 엔진의 JSON 계약이고 화면 코드는 해석하지 않는다. */
export type EngineRequest = Record<string, unknown>;
export type EngineRow = Record<string, unknown>;

/**
 * 계산 코드에 넘기는 런타임(루트 src/core/runtime.mjs의 계약).
 * Node CLI는 src/runtime/node.mjs를, 이 앱은 Rust 명령을 부르는 lib/runtime.ts를 넘긴다.
 */
export interface EngineRuntime {
  loadCatalog(): Promise<EngineCatalog> | EngineCatalog;
  engineVersion(): Promise<EngineVersion> | EngineVersion;
  /** 결과는 입력 순서 그대로다. 줄마다 결과 또는 `{error}`. */
  runBatch(requests: EngineRequest[], options?: { concurrency?: number }): Promise<EngineRow[]>;
}

/** 화면 위의 사각형(물리 픽셀). x·y는 화면 좌표의 왼쪽 위다. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 게임 창의 정보(src-tauri/src/game_window.rs의 GameWindowInfo). 좌표와 크기는 물리 픽셀이다. */
export interface GameWindowInfo {
  hwnd: number;
  pid: number;
  process_name: string;
  title: string;
  /** 제목 표시줄·테두리를 뺀 게임 화면 영역. */
  client: ScreenRect;
  /** 창 전체에서 보이는 부분. */
  frame: ScreenRect;
  minimized: boolean;
  /** 지금 입력을 받는 창인가. */
  foreground: boolean;
  /** 창이 놓인 모니터의 배율(1 = 100%). */
  scale_factor: number;
}

/** 게임 창의 상태(src-tauri/src/game_window.rs의 GameWindowState). */
export type GameWindowState = 'found' | 'minimized' | 'launcher_only' | 'missing' | 'unavailable';

/** Rust가 넘기는 게임 창 상태와 붙이기 여부(src-tauri/src/lib.rs의 GameSnapshot). */
export interface GameSnapshot {
  state: GameWindowState;
  /** `found`·`minimized`일 때만 있다. */
  window: GameWindowInfo | null;
  /** 한국어 설명. */
  message: string;
  /** 오버레이를 게임 창에 붙여 따라가게 하는 중인가. */
  follow: boolean;
}

/** 저장한 캡처 하나(src-tauri/src/capture.rs의 CaptureRecord). */
export interface CaptureRecord {
  /** 저장한 PNG의 절대 경로. */
  path: string;
  width: number;
  height: number;
  /** 찍은 시각(UTC, ISO 8601). */
  captured_at: string;
  /** 캡처 방식. 지금은 Windows.Graphics.Capture 하나뿐이다. */
  method: 'wgc';
  window: GameWindowInfo;
}

/** 단축키로 저장한 결과(src-tauri/src/lib.rs의 GameCaptureOutcome). 둘 중 하나만 있다. */
export interface GameCaptureOutcome {
  capture: CaptureRecord | null;
  error: string | null;
}

/** Rust 쪽 오버레이 상태(src-tauri/src/lib.rs의 OverlaySnapshot). */
export interface OverlaySnapshot {
  visible: boolean;
  click_through: boolean;
  /** 등록하지 못한 전역 단축키의 설명. 비어 있으면 모두 등록됐다. */
  shortcut_problems: string[];
}
