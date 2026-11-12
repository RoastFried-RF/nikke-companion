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
  /**
   * 우선 속성 요약(docs/data-model.md §후보 생성 §우선 속성). 우선 속성을 준 추천에만 있다 — 요격전 추천이 보스의 약점 속성을 넘긴다.
   * 단계(`"1"`·`"2"`·`"3"`)별 이름 목록: 풀에 든 우선 속성 니케 · 우선 속성 덕에 든 니케 · 밀려난 니케.
   */
  priority?: {
    element: string;
    min_per_stage: number;
    score_bonus: number;
    active: boolean;
    owned: string[];
    pool: Record<string, string[]>;
    promoted: Record<string, string[]>;
    displaced: Record<string, string[]>;
    short: { stage: string; wanted: number; available: number }[];
    guaranteed: number;
    candidates: number;
  };
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

/**
 * 인식한 화면 종류(src-tauri/src/recognize.rs의 ScreenKind).
 * `other`는 이상 개체 요격전 화면이 아니라는 뜻이고, `unknown`은 판단하지 않았다는 뜻이다
 * (표지가 일부만 보임, 두 보스의 색이 섞임, 지원하지 않는 화면 비율).
 */
export type ScreenKind = 'anomaly_select' | 'anomaly_squad' | 'other' | 'unknown';

/** 인식한 보스. `id`·`name`은 보스 묶음(data/intercept/anomaly.json)의 것과 같다. */
export interface RecognizedBoss {
  id: string;
  name: string;
}

/** 게임 화면 인식 결과(src-tauri/src/recognize.rs의 Recognition). 이미지는 오지 않는다. */
export interface ScreenRecognition {
  screen: ScreenKind;
  /** 이상 개체 화면(`anomaly_select`·`anomaly_squad`)일 때만 있다. 그 밖에는 null — 추측으로 채우지 않는다. */
  boss: RecognizedBoss | null;
  /** 0~1. 이상 개체 화면이면 0.5 이상, `unknown`이면 0. */
  confidence: number;
  /** 무엇을 보고 그렇게 판단했는지(한국어 문장들). */
  evidence: string[];
  /** 본 프레임의 크기(물리 픽셀). */
  width: number;
  height: number;
}

/**
 * 요격전 화면 자동 추적의 상태 이름(src-tauri/src/screen_track.rs의 TrackState).
 * `read`만 게임 화면을 읽은 것이고, 나머지는 읽지 않았거나(꺼짐·시작 전·오버레이 숨김·게임 없음·최소화) 읽지 못한 것(`failed`)이다.
 */
export type ScreenTrackState = 'off' | 'starting' | 'read' | 'overlay_hidden' | 'no_game' | 'minimized' | 'failed';

/** Rust가 넘기는 자동 추적 상태(src-tauri/src/screen_track.rs의 TrackStatus). 이미지는 오지 않는다. */
export interface ScreenTrackStatus {
  /** 자동 추적이 켜져 있는가. */
  enabled: boolean;
  /** 게임 화면을 읽는 주기(밀리초). */
  interval_ms: number;
  state: ScreenTrackState;
  /** 지금 상태를 설명하는 한국어 한 줄(읽지 않는 이유, 실패 원인, 인식한 화면). */
  message: string;
  /** 방금 읽은 화면의 인식 결과. `state`가 `read`일 때만 있다. */
  recognition: ScreenRecognition | null;
  /** 마지막으로 게임 화면을 읽은 시각(UTC, ISO 8601). 켠 뒤로 한 번도 읽지 못했으면 null. */
  read_at: string | null;
  /** 마지막 읽기에서 캡처 한 번에 걸린 시간(밀리초). */
  capture_ms: number | null;
  /** 연속으로 실패한 횟수. */
  failures: number;
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

// ── 요격전 추천 결과 — 정본은 docs/data-model.md §요격전 추천 결과와 src/core/intercept.mjs ──────────────

/** 보스의 속성과 약점(루트 src/core/intercept.mjs의 resolveElement). 한쪽만 확인됐으면 다른 쪽은 규칙으로 유도한 값이다. */
export interface BossElement {
  /** 보스 자신의 속성. 모르면 null — 속성 상성 미반영. */
  code: string | null;
  /** `bundle` = 보스 묶음에 적힌 값, `weak_to` = 약점에서 유도. */
  code_source: 'bundle' | 'weak_to' | null;
  weak_to: string | null;
  /** `bundle` = 보스 묶음에 적힌 값, `code` = 보스 속성에서 유도. */
  weak_to_source: 'bundle' | 'code' | null;
  /** 속성 상성을 계산에 반영했나. */
  reflected: boolean;
}

/** 미확인 칸 하나와 그 칸을 무엇으로 계산했는가. */
export interface UnconfirmedField {
  field: string;
  label: string;
  computed_as: unknown;
  /** 사람이 읽는 한 줄. */
  text: string;
}

/** 레벨을 어떻게 정했나(루트 src/core/condition.mjs의 levelPlan). */
export interface LevelPlan {
  mode: 'fixed' | 'cap';
  level: number;
  cap: number | null;
  synchro_level: number | null;
  /** 동기화 레벨을 몰라 상한으로 가정했다. */
  assumed: boolean;
  engine_policy?: string;
}

export interface InterceptBoss {
  id: string;
  name: string;
  element: BossElement;
  reward: string | null;
  level: LevelPlan;
  duration: number;
  source?: string;
  /** 확인된 칸의 이름. */
  confirmed: string[];
  unconfirmed: UnconfirmedField[];
  /** 눈에 띄어야 하는 표시(「속성 상성 미반영」). */
  flags: string[];
  status: 'computed' | 'not_computed';
  budget: number;
  sims: number;
  assumptions: string[];
  ranking: RankingEntry[];
  rejected: RejectedSquad[];
  failed: FailedSquad[];
  suggestion: SuggestionSummary | null;
  /**
   * 약점 속성 보유 니케가 후보 풀에 얼마나 들었나. 약점을 모르거나 계산하지 않았으면 null.
   * `promoted`는 약점 속성 우선 덕에 풀에 든 니케(투자 점수만으로는 풀에 없었을 니케) — 그 기능이 생기기 전의 결과 파일에는 없다.
   */
  weak_pool: { element: string; owned: string[]; pooled: string[]; not_pooled: string[]; promoted?: string[] } | null;
  notes: string[];
  caveats: string[];
}

export interface InterceptReport {
  schema_version: 1;
  kind: 'intercept_report';
  generated_at?: string;
  account: { name?: string | null; is_test_data?: boolean; updated_at?: string | null };
  content: string;
  bundle: { name: string | null; version: string | null; is_test_data: boolean; source: string; bosses: number };
  assumptions: string[];
  engine?: EngineVersion | null;
  cache?: CacheStats | null;
  top: number;
  sims: { budget: number; used: number; per_boss: { id: string; name: string; budget: number; used: number }[] };
  bosses: InterceptBoss[];
  caveats: string[];
}

/** 요격전 추천이 보스 하나의 계산을 시작하기 직전에 알리는 진행 상황(recommendIntercept의 `deps.onBoss`). */
export interface BossProgress {
  /** 0부터. */
  index: number;
  total: number;
  boss: { id: string; name: string };
  /** 이 보스에 돌아간 시뮬 예산. */
  budget: number;
}

// ── 성장 투자 비교 결과 — 정본은 docs/data-model.md §성장 투자 비교와 src/core/growth.mjs ─────────────────

export interface GrowthChange {
  nikke: string;
  /** 육성 칸의 이름(계정 문서의 키). */
  field: string;
  /** 적지 않았거나 미확인이던 칸이면 null. */
  before: unknown;
  after: unknown;
}

export interface GrowthEntry {
  rank: number;
  name: string;
  changes: GrowthChange[];
  total_before: number;
  total_after: number;
  gain: number;
  /** (적용 후 − 적용 전) / 적용 전. 적용 전 총딜이 0이면 null. */
  gain_rate: number | null;
  members: (ReportMember & { gain: number })[];
  notes: string[];
  engine_warnings: string[];
}

export interface GrowthReport {
  schema_version: 1;
  kind: 'growth';
  generated_at?: string;
  account: { name?: string | null; is_test_data?: boolean; updated_at?: string | null };
  condition?: Record<string, unknown>;
  assumptions?: string[];
  engine?: EngineVersion | null;
  cache?: CacheStats | null;
  baseline: {
    name: string;
    members: ReportMember[];
    total_damage: number;
    notes: string[];
    engine_warnings: string[];
    ungrown_members: string[];
  };
  ranking: GrowthEntry[];
  rejected: { name: string; reasons: string[] }[];
  failed: { name: string; changes?: GrowthChange[]; error: { type?: string | null; message: string; path?: string | null } }[];
  caveats: string[];
}

// ── 티어 결과 — 정본은 docs/data-model.md §티어 결과와 src/tier/evaluate.mjs ─────────────────────────────

/** 기준 편성 하나에 바꿔 넣은 결과. */
export interface TierComparison {
  reference: string;
  slot: number;
  /** 대신 들어간 자리의 원래 멤버. */
  replaced: string;
  total_damage: number;
  reference_total: number;
  ratio: number;
}

export interface TierEntry {
  name: string;
  /** 등급을 매긴 항목의 순위(점수 순). 평가 보류는 null. */
  rank: number | null;
  burst_stage: string | null;
  /** 「예측 평가」 · 「평가 보류」 (앞으로 「실측 대조 완료」가 더해질 수 있다). */
  status: string;
  /** 화면·표에 쓰는 상태 표기. 평가 보류는 사유가 괄호로 붙는다. */
  status_label: string;
  tier: string | null;
  tier_label: string | null;
  /** 팀 총딜 비율(1.0 = 기준 편성과 같다). 평가 보류는 null — 0점이 아니다. */
  score: number | null;
  /** 엔진이 효과 모델이 없다고 알린 효과가 있다 — 그 효과가 빠진 수치다. */
  unsupported: boolean;
  flags: string[];
  best: TierComparison | null;
  comparisons: TierComparison[];
  excluded_references: { reference: string; reason: string }[];
  hold: { code: string; label: string; message: string } | null;
  notes: string[];
  engine_warnings: string[];
}

export interface TierReport {
  schema_version: 1;
  kind: 'tier';
  generated_at?: string;
  method: { id: string; version: number };
  engine?: EngineVersion | null;
  /** 엔진 데이터 버전(데이터 파일 해시). 확인하지 못했으면 null. */
  engine_data: { version: string; files?: Record<string, string> } | null;
  scenario: { id?: string; boss: string; duration: number; enemy?: unknown; growth: string; growth_note?: string | null; expected?: boolean };
  assumptions: string[];
  references: {
    version: string;
    source?: unknown;
    squads: { id: string; members: string[]; source?: string | null; status: string; reason: string | null; total_damage: number | null }[];
  };
  rules: { version: string; provisional: boolean; tiers: { tier: string; min: number }[] };
  sims: { budget: number; used: number; baselines: number; variants: number; skipped_for_budget: number };
  cache?: CacheStats | null;
  summary: {
    requested: number;
    graded: number;
    hold: number;
    unsupported: number;
    by_tier: Record<string, number>;
    hold_by_reason: Record<string, number>;
  };
  entries: TierEntry[];
  caveats: string[];
}

// ── 계정 받기(src-tauri/src/account_sync.rs) ──────────────────────────────────
// 세션 쿠키의 내용은 이 타입들 어디에도 없다 — Rust가 화면에 넘기지 않는다.

/** 계정 받기의 지금 상태(account_sync.rs의 SyncStatus). 파일의 유무와 시각뿐이다. */
export interface SyncStatus {
  /** 확인한 이름. 쓸 수 없는 이름이면 빈 문자열이고 이유가 `problems`에 있다. */
  name: string;
  /** 쿠키 파일이 있는가. 내용은 오지 않는다. */
  cookie_saved: boolean;
  cookie_saved_at: string | null;
  /** 그 이름의 프로필을 마지막으로 받은 시각. */
  profile_fetched_at: string | null;
  /** 그 이름의 계정 파일 경로(있을 때만). */
  account_file: string | null;
  login_window_open: boolean;
  /** 엔진 폴더·수집 스크립트·python·계정 폴더의 문제(한국어 문장). */
  problems: string[];
}

/** 쿠키를 저장한 결과(account_sync.rs의 CookieSaved). 쿠키의 내용은 없다. */
export interface CookieSaved {
  saved_at: string | null;
  /** 저장한 쿠키의 수. */
  count: number;
}

/** 수집 스크립트가 낸 줄 하나(account_sync.rs의 FetchLine). 쿠키 값은 가려져 있다. */
export interface FetchLine {
  text: string;
  /** 경고 줄(`[!]`)인가. */
  warning: boolean;
}

/** 프로필 수집의 결과(account_sync.rs의 FetchOutcome). */
export interface FetchOutcome {
  name: string;
  profile_path: string;
  fetched_at: string | null;
  /** 스크립트가 낸 모든 줄(낸 차례대로). */
  lines: FetchLine[];
  /** 그 가운데 경고 줄. */
  warnings: string[];
  seconds: number;
}

/** 계정 받기 명령이 거부한 값(account_sync.rs의 SyncFailure). */
export interface SyncFailure {
  /** 실패의 종류: cookie_missing · cookie_invalid · cookie_rejected · not_logged_in · session_expired · network · timeout · stopped · … */
  kind: string;
  /** 한국어 문장. */
  message: string;
  /** 쿠키를 다시 받아야 하는가 — 쿠키를 받는 순서를 함께 보인다. */
  cookie_help: boolean;
  /** 수집 스크립트가 그때까지 낸 줄(수집 실패일 때만). */
  lines: FetchLine[];
  warnings: string[];
}

/** 받은 프로필과 변환에 쓸 엔진의 오버로드 옵션 표(account_sync.rs의 read_profile). 변환은 루트 src/core/import-profile.mjs가 한다. */
export interface FetchedProfile {
  path: string;
  profile: unknown;
  option_table: unknown;
}

/** 크롬 확장 연결의 수신부에 마지막으로 온 요청(extension_link.rs의 LinkActivity). 쿠키는 없다. */
export interface ExtensionLinkActivity {
  /** 언제(ISO, UTC). */
  at: string;
  /** 결과의 종류: received · wrong_code · locked · not_logged_in · cookie_rejected · busy · store_failed. */
  outcome: string;
  /** 한국어 문장. */
  message: string;
}

/** 크롬 확장 연결의 지금 상태(extension_link.rs의 LinkStatus). 쿠키는 없다 — 연결 코드는 쿠키가 아니다. */
export interface ExtensionLinkStatus {
  /** 사용자가 켜 두었는가(Rust가 기억한다). */
  enabled: boolean;
  /** 지금 듣고 있는가. 켜 두었는데 듣지 못하면 이유가 `problem`에 있다. */
  listening: boolean;
  /** 듣는 주소(이 PC 안에서만 닿는 주소와 포트). */
  address: string;
  /** 연결 코드(여덟 글자, 가운데 붙임표). 확장에 한 번 넣는다. */
  code: string;
  /** 열지 못한 이유(한국어 문장). */
  problem: string | null;
  /** 확장에서 쿠키를 받았고 화면이 아직 「계정 새로 받기」를 잇지 않았다. */
  pending: boolean;
  /** 마지막으로 온 요청. */
  last: ExtensionLinkActivity | null;
  /** 코드를 여러 번 틀려 막힌 시간이 얼마나 남았는가(초). 막혀 있지 않으면 0. */
  locked_seconds: number;
}

/** 계정 파일을 쓴 결과(account_sync.rs의 SavedAccount). */
export interface SavedAccount {
  path: string;
  /** 덮어쓰기 전에 남긴 옛 파일의 사본. 새로 만든 것이면 null. */
  backup: string | null;
}

/** 가져오기 결과 문서(루트 src/core/import-profile.mjs의 importReport — docs/data-model.md §계정 가져오기). */
export interface ImportReport {
  schema_version: number;
  kind: string;
  generated_at: string;
  input: { file: string | null; format: string; profile_name: string | null; fetched_at: string | null };
  /** 계정 파일을 쓴 경로. 아직 쓰지 않았으면 null. */
  output: string | null;
  account: { name: string; is_test_data: boolean; source: string; updated_at: string };
  summary: { roster: number; imported: number; skipped: number; with_unknown: number; unknown_fields: Record<string, number> };
  unknown: { nikke: string; fields: string[] }[];
  skipped: { name: string; reason: string }[];
  warnings: string[];
  caveats: string[];
}
