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

/** Rust 쪽 오버레이 상태(src-tauri/src/lib.rs의 OverlaySnapshot). */
export interface OverlaySnapshot {
  visible: boolean;
  click_through: boolean;
  /** 등록하지 못한 전역 단축키의 설명. 비어 있으면 모두 등록됐다. */
  shortcut_problems: string[];
}
