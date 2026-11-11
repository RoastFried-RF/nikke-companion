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
  dirty?: boolean;
}

/** suggest 결과에만 붙는 후보 생성 요약. */
export interface SuggestionSummary {
  considered: number;
  generated: number;
  simulated: number;
  shown: number;
}

export interface CompareReport {
  schema_version: 1;
  generated_at?: string;
  account: { name?: string | null; is_test_data?: boolean; updated_at?: string | null };
  condition?: Record<string, unknown>;
  assumptions?: string[];
  engine?: EngineVersion | null;
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

/** Rust 쪽 오버레이 상태(src-tauri/src/lib.rs의 OverlaySnapshot). */
export interface OverlaySnapshot {
  visible: boolean;
  click_through: boolean;
  /** 등록하지 못한 전역 단축키의 설명. 비어 있으면 모두 등록됐다. */
  shortcut_problems: string[];
}
