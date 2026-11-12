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
  /** 추천에서 뺀 니케(「안 씀」). 뺀 것이 없으면 이 칸이 없다. */
  excluded?: ExclusionNote | null;
}

/** 엔진 배치의 진행 상황(src-tauri/src/lib.rs의 EngineProgress). */
export interface EngineProgress {
  done: number;
  total: number;
}

/** 큐브 하나(엔진의 큐브 표에서 — 루트 src/core/efficiency.mjs의 cubeCatalogFrom). */
export interface CubeInfo {
  name: string;
  /** 큐브 효과의 이름. 표에 없으면 null. */
  skill: string | null;
  /** 효과의 문구(`{0}`에 레벨별 수치가 들어간다). 표에 없으면 null. */
  effect: string | null;
  max_level: number;
  /** 계산 도구가 이 큐브의 효과를 계산하는가. 아니면 바꿔 볼 수 없다(지원하지 않음). */
  supported: boolean;
}

/** 엔진이 아는 니케와 보스 프리셋. 계산 코드(src/core)가 이름·버스트 단계 확인에 쓴다. */
export interface EngineCatalog {
  nikkes: Record<string, Record<string, unknown>>;
  bosses: string[];
  /** 큐브 목록(P-031). 큐브 표를 읽지 못했으면 null — 그때는 큐브를 바꿔 볼 수 없다. */
  cubes?: CubeInfo[] | null;
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
  /** 요청마다 계산 도구의 텍스트 보기를 돌린다(버스트 흐름). 없는 런타임에서는 버스트 흐름을 읽지 못한다. */
  runViews?(requests: EngineRequest[], view: string, options?: { concurrency?: number }): Promise<EngineViewRow[]>;
}

/** 텍스트 보기 한 건의 결과: 계산 도구가 적은 글 그대로, 또는 그 건의 오류. */
export type EngineViewRow = { text: string } | { error: { type?: string; message?: string } };

// ── 버스트 흐름(P-032 — 루트 src/core/burst.mjs의 결과. docs/data-model.md §버스트 흐름) ──────────────

/** 버스트 사용 한 번. 시각은 전투 시작부터의 초다. */
export interface BurstUse {
  t: number;
  stage: string;
  name: string;
  /** 계산 도구가 「재진입」으로 적은 사용. */
  reenter: boolean;
}

/** 풀 버스트 한 번. `end`가 null이면 전투가 끝날 때까지 열려 있었다. */
export interface FullBurst {
  index: number;
  start: number;
  end: number | null;
  open: boolean;
  users: BurstUse[];
  chain_start: number | null;
  /** 이 풀 버스트를 여는 동안 버스트 사이가 가장 길게 벌어진 시간(초). */
  wait: number;
  waited_for: { stage: string; reenter: boolean } | null;
}

/** 한 편성의 버스트 흐름 요약. */
export interface BurstFlow {
  duration: number;
  count: number;
  first_at: number | null;
  first_use_at: number | null;
  average_period: number | null;
  uptime_seconds: number;
  uptime_ratio: number | null;
  full_bursts: FullBurst[];
  uses: BurstUse[];
  by_stage: Record<string, { name: string; count: number }[]>;
  by_member: { name: string; count: number; stages: string[]; uses: { t: number; stage: string; reenter: boolean }[] }[];
  pending: BurstUse[];
  tail_wait: number;
  stalls: { index: number; wait: number; stage: string | null }[];
  /** ok 잘 돈다 / stalled 다음 버스트가 늦는다 / none 풀 버스트가 한 번도 열리지 않았다. */
  status: 'ok' | 'stalled' | 'none';
  headline: string;
  problem: string | null;
}

/** 버스트 흐름 결과의 편성 한 줄: 읽음 · 거부됨(계산 전 검사) · 실패(계산 도구가 주지 않았다). */
export type BurstLine = { name: string; members: string[]; growth?: string } & (
  | { status: 'read'; flow: BurstFlow; unread: string[] }
  | { status: 'rejected'; reasons: string[] }
  | { status: 'failed'; error: { type?: string; message?: string } }
);

export interface BurstReport {
  schema_version: number;
  kind: 'burst_flow';
  generated_at: string;
  account: { name: string | null; is_test_data?: boolean; updated_at?: string | null };
  condition: Record<string, unknown>;
  /** 전투 시간(초) — 시간축의 길이. */
  duration: number;
  source: { view: string; stall_gap_seconds: number };
  lines: BurstLine[];
  /** 두 편성을 견준 한 문장(둘 다 읽었을 때만). */
  comparison: { count_delta: number; text: string } | null;
  engine: EngineVersion;
  caveats: string[];
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

// ── 오버레이 위젯(P-028) — Rust 쪽 src-tauri/src/overlay_widget.rs와 같아야 한다 ──────────────

/** 위젯의 모양: 접힘(알약) · 한 줄 카드(기본) · 펼침. */
export type OverlayShape = 'collapsed' | 'card' | 'expanded';

/** 이상 개체 화면을 떠났을 때 위젯이 하는 일: 그대로 두기 · 접기 · 쉬기(창을 숨긴다 — 돌아오면 다시 뜬다). */
export type OverlayLeave = 'stay' | 'collapse' | 'hide';

/** 오버레이 설정(Rust의 Prefs). 앱 창의 설정 화면에서 바꾼다. */
export interface OverlayPrefs {
  /** 크기 배율(%). 80~150. */
  scale_percent: number;
  /** 불투명도(%). 40~100 — 기본은 불투명(100)이다. */
  opacity_percent: number;
  leave: OverlayLeave;
  /** 떠난 뒤 접거나 쉬기까지 기다리는 시간(초). */
  leave_after_sec: number;
  /** 앱을 켰을 때의 모양. */
  default_shape: OverlayShape;
  /** 클릭 통과를 켜 뒀는가(다음에 켤 때도 그대로다). */
  click_through: boolean;
}

/** 위젯의 지금 상태(Rust의 WidgetSnapshot). */
export interface WidgetSnapshot {
  shape: OverlayShape;
  /** 핀으로 고정했는가(자동 표시가 접거나 쉬게 하지 않는다). */
  pinned: boolean;
  /** 자동 표시가 쉬게 했는가(창이 숨겨져 있다 — 이상 개체 화면으로 돌아오면 다시 뜬다). */
  resting: boolean;
  prefs: OverlayPrefs;
  /** 설정·자리를 읽거나 저장하다 난 문제. 없으면 null. */
  problem: string | null;
}

/** 데스크톱 앱 창이 알리는 요격전 추천 계산의 진행(Rust의 Activity). 오버레이가 작게 보여 준다. */
export interface ComputeActivity {
  running: boolean;
  /** 무엇을 하는 중인지. */
  label: string;
  /** 끝난 건수와 전체 건수. 전체를 아직 모르면 0. */
  done: number;
  total: number;
  /** 시작한 뒤 흐른 시간(밀리초). */
  elapsed_ms: number;
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
  /** 이 보스를 계산한 전투 조건(보스 값 → 적 설정). 버스트 흐름(P-032)이 같은 조건으로 다시 돌린다. 옛 결과에는 없을 수 있다. */
  condition?: Record<string, unknown>;
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
  /** 추천에서 뺀 니케(「안 씀」). 뺀 것이 없으면 이 칸이 없다. */
  excluded?: ExclusionNote | null;
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

// ── 두 창이 함께 보는 것(src-tauri/src/shared_state.rs) ────────────────────────

/** 오버레이 창을 언제 띄우는가: 앱과 함께 · 게임을 찾았을 때 · 스스로 띄우지 않음. */
export type OverlayLaunch = 'with_app' | 'with_game' | 'manual';

/** 계정 폴더의 계정 하나(shared_state.rs의 AccountEntry). 내용은 없다. */
export interface AccountEntry {
  name: string;
  /** 마지막으로 저장한 시각(ISO, UTC). 모르면 null. */
  modified_at: string | null;
}

/** 두 창이 함께 보는 상태(shared_state.rs의 SharedSnapshot). 계정의 내용과 결과 문서는 싣지 않는다. */
export interface SharedSnapshot {
  /** 지금 계산에 쓰는 계정의 이름. 없으면 null. */
  default_account: string | null;
  /** 사용자가 고른 것인가(아니면 계정이 하나뿐이라 그것을 쓴다). */
  remembered: boolean;
  /** 고를 수 있는 계정(이름순) — 목록에서 숨긴 것은 빠진다. */
  accounts: AccountEntry[];
  /** 목록에서 숨긴 계정(P-033). 지운 것이 아니다 — 다시 보이게 할 수 있다. */
  hidden_accounts: AccountEntry[];
  /** 계정들이 있는 곳(사람이 읽는 글자 — 계정을 완전히 지우려는 사람에게 알려 주는 데만 쓴다). */
  accounts_location: string;
  overlay_launch: OverlayLaunch;
  /** 마지막 요격전 결과를 저장한 시각(ISO, UTC). 없으면 null. */
  intercept_saved_at: string | null;
  /** 읽다가 만난 문제(한국어 문장). */
  problems: string[];
}

/** 계정 한 명의 육성 칸(정본은 docs/data-model.md §계정 상태와 src/core/account.mjs). 적지 않은 칸은 없다. */
export interface AccountNikke {
  skill_levels?: number[];
  breakthrough?: number;
  core_enhancement?: number;
  /** 옵션 → 줄 수(손으로 적은 계정) 또는 줄별 레벨 목록(가져온 계정). */
  overload?: Record<string, number | number[]>;
  /** 가져오지 못해 모르는 칸의 이름. */
  unknown?: string[];
  [key: string]: unknown;
}

/** 계정 상태 문서. 화면은 보여 주기만 한다 — 형식 확인과 계산은 src/core가 한다. */
export interface AccountDoc {
  schema_version: number;
  is_test_data?: boolean;
  name?: string | null;
  source?: string | null;
  updated_at?: string | null;
  account?: { synchro_level?: number | null; [key: string]: unknown };
  nikkes: Record<string, AccountNikke>;
  [key: string]: unknown;
}

/** 읽은 계정(shared_state.rs의 read_account). */
export interface AccountRead {
  name: string;
  modified_at: string | null;
  account: AccountDoc;
}

// ── 디자인 기반(UI 개편 — docs/ui-redesign.md) ────────────────────────────────

/** 이미지를 어디서 읽었나(src-tauri/src/assets.rs의 ImageSource): 엔진 폴더 · 받아 둔 리소스 · 사용자의 캡처 조각. */
export type GameImageSource = 'engine' | 'assets' | 'capture';

/**
 * Rust가 이 PC의 파일에서 읽어 넘기는 이미지(src-tauri/src/assets.rs의 GameImage).
 * 없으면 `found: false`이고 나머지는 null이다 — 오류가 아니다. 화면이 대체 그림을 그린다.
 */
export interface GameImage {
  found: boolean;
  /** 'image/webp' 또는 'image/png'. */
  mime: string | null;
  /** 파일 내용(base64). */
  data: string | null;
  source: GameImageSource | null;
}

/** 아이콘의 종류. 값은 엔진 카탈로그의 낱말 그대로 넘긴다(속성 '작열', 버스트 '1'·'A', 클래스 '화력형', 기업 '필그림', 무기 'SR'). */
export type IconKind = 'element' | 'burst' | 'class' | 'corp' | 'weapon';

/**
 * 니케 한 명의 기본 정보(엔진 카탈로그에서 — lib/nikkeInfo.ts). 카탈로그에 없는 값은 null(「모름」)이다.
 * 값을 지어내지 않는다.
 */
export interface NikkeInfo {
  name: string;
  /** 엔진 카탈로그에 있는 이름인가. */
  known: boolean;
  /** 속성(작열·풍압·철갑·전격·수냉). */
  element: string | null;
  /** 버스트 단계('1'·'2'·'3'·'A'). */
  burst: string | null;
  /** 무기 종류(AR·SMG·SG·SR·MG·RL). */
  weapon: string | null;
  /** 기업. */
  corp: string | null;
  /** 클래스(화력형·지원형·방어형). */
  klass: string | null;
  /** 등급(SSR·SR·R). */
  rarity: string | null;
}

// ── 요격전 계획(P-029 — 루트 src/core/plan.mjs, docs/data-model.md §요격전 계획) ─────────────

/** 손으로 적은 요격전 기록 하나. */
export interface PlanRecord {
  id: string;
  boss_id: string;
  boss_name: string;
  /** 실제 대미지(정수). */
  damage: number;
  /** 모의전(`mock`) 또는 실전(`real`). */
  mode: 'mock' | 'real';
  /** 날짜(`YYYY-MM-DD`). */
  date: string;
  /** 달성 단계. 적지 않았으면 null. */
  stage: number | null;
  note: string | null;
  created_at: string | null;
}

/** 모듈 기록장의 기록 하나(P-033 — 루트 src/core/journal.mjs): 그날 돈 보스·달성 단계·얻은 것. 손으로 적은 값이다. */
export interface RewardEntry {
  id: string;
  /** 날짜(`YYYY-MM-DD`). */
  date: string;
  boss_id: string;
  boss_name: string;
  /** 달성 단계. 적지 않았으면 null. */
  stage: number | null;
  /** 얻은 장비의 수(부위 — 머리·몸통·팔·다리 — 마다). */
  gear: Record<string, number>;
  /** 얻은 커스텀 모듈의 수. */
  modules: number;
  note: string | null;
  created_at: string | null;
}

/** 기록들의 합(루트의 rewardSum). */
export interface RewardSum {
  /** 돈 횟수(적은 기록의 수). */
  runs: number;
  modules: number;
  gear: Record<string, number>;
  gear_total: number;
}

/** 주 하나 또는 달 하나의 합. */
export interface RewardPeriod extends RewardSum {
  key: string;
  /** 화면의 말(「11월 9일 ~ 11월 15일」 · 「2026년 11월」). */
  label: string;
  from: string;
  to: string | null;
}

/** 보스 하나를 몇 번 돌았는가. */
export interface RewardBossCount extends RewardSum {
  boss_id: string;
  boss_name: string;
  last_date: string | null;
  best_stage: number | null;
}

/** 기록장의 요약(루트의 journalSummary). */
export interface JournalSummary {
  total: RewardSum;
  this_week: RewardPeriod | null;
  this_month: RewardPeriod | null;
  weeks: RewardPeriod[];
  months: RewardPeriod[];
  bosses: RewardBossCount[];
  notes: string[];
}

/** 날짜 하나의 묶음: 그날의 보상 기록과 요격전 대미지 기록(P-029). */
export interface JournalDay {
  date: string;
  rewards: RewardEntry[];
  damages: PlanRecord[];
}

/** 니케에 붙이는 표시(P-033): 즐겨찾기 · 안 씀 · 없음. */
export type NikkeMark = 'favorite' | 'unused' | null;
/** 표시로 거르는 보기. 빈 글자는 전부다. */
export type MarkFilter = '' | 'favorite' | 'unused' | 'active';

/** 추천 계산에서 뺀 니케(루트 src/core/exclude.mjs) — 뺐다는 사실이 결과에 남는다. */
export interface ExclusionNote {
  reason: string;
  /** 화면의 말(「안 씀」). */
  label: string;
  names: string[];
  count: number;
  text: string;
}

/** 도구 링크 하나(P-033 — 저장소의 data/links/tools.json). `basis`는 한 줄 설명의 근거다. */
export interface ToolLink {
  id: string;
  name: string;
  description: string;
  url: string;
  basis: string;
  basis_label: string;
}

/** 이 앱이 하지 않는 것과 대신 안내할 도구. */
export interface UnsupportedTopic {
  id: string;
  topic: string;
  reason: string;
  links: ToolLink[];
}

/** 도구 목록 한 벌(루트의 readToolLinks). */
export interface ToolLinkBook {
  source: { title: string; where: string; checked_at?: string; note?: string; description_note?: string };
  links: ToolLink[];
  not_supported: UnsupportedTopic[];
}

/** 기본 브라우저로 연 도구(Rust의 tool_links::ToolLink). */
export interface OpenedLink {
  id: string;
  name: string;
  url: string;
}

/**
 * 계정마다 두는 요격전 계획: 즐겨찾기로 고른 니케와 요격전 기록(계정 폴더의 `<계정>.plan.json`).
 * P-033이 칸 둘을 더했다 — 「안 씀」으로 표시한 니케(`unused`)와 모듈 기록장(`rewards`). 예전 문서에는 없다(빈 목록으로 읽는다).
 */
export interface PlanDoc {
  schema_version: number;
  kind: string;
  favorites: string[];
  unused?: string[];
  records: PlanRecord[];
  rewards?: RewardEntry[];
}

/** 장비 한 칸의 상태. */
export type GearState = 'empty' | 'normal' | 'corp' | 'overload' | 'unrecorded' | 'unknown';

export interface GearSlot {
  part: string;
  state: GearState;
  label: string;
  tier: string | null;
  level: number | null;
  corp: string | null;
}

export interface GearRow {
  name: string;
  recorded: boolean;
  slots: GearSlot[];
  open: number;
}

export interface GearSummary {
  nikkes: number;
  recorded: number;
  unrecorded: number;
  open: number;
  by_part: Array<{ part: string; open: number; empty: number; normal: number; corp: number; overload: number }>;
  by_corp: Array<{ corp: string; open: number; nikkes: number }>;
  unknowns: string[];
}

export interface CorePick {
  basis: 'intercept' | 'favorites' | 'score' | 'none';
  names: string[];
  text: string;
}

export interface BossNeed {
  id: string;
  name: string;
  reward: string | null;
  part: string | null;
  /** 필요 칸 수. 보상이 장비 부위가 아니면 null. */
  need: number | null;
  reasons: Array<{ nikke: string; part: string; state: GearState; label: string; tier: string | null; level: number | null }>;
  note: string | null;
}

export interface BossPick {
  status: 'pick' | 'tie' | 'done' | 'no_data' | 'no_core';
  text: string;
  top: string[];
  max_need: number;
  bosses: BossNeed[];
  core: number;
  unrecorded: string[];
  unknowns: string[];
}

export interface RecordCheck {
  estimate: number;
  actual: number;
  ratio: number;
  diff_pct: number;
  direction: 'over' | 'under' | 'same';
  text: string;
  detail: string;
}

export interface Coverage {
  rule_text: string;
  elements: Array<{ element: string; count: number; names: string[]; bosses: Array<{ id: string; name: string }> }>;
  max: number;
  weakest: string[];
  unsure: string[];
}

// ── 덱 빌더(P-030 — 루트 src/core/deck.mjs, docs/data-model.md §덱 빌더) ─────────────────────

/** 고를 수 있는 상대 하나(이상 개체 보스 · 솔로 레이드 프리셋 · 속성만 정하기). */
export interface OpponentOption {
  /** `boss:<id>` · `preset:<이름>` · `element:<속성|none>`. */
  key: string;
  kind: 'boss' | 'preset' | 'element';
  id: string;
  label: string;
  weak_to: string | null;
}

/** 고른 상대 → 전투 조건과 함께 보여야 하는 것(resolveOpponent의 결과). */
export interface DeckOpponent extends OpponentOption {
  condition: Record<string, unknown>;
  element: { code: string | null; weak_to: string | null; reflected: boolean; known: boolean; code_source?: string | null; weak_to_source?: string | null };
  /** 확인하지 못해 기본값으로 계산하는 칸(요격전 화면의 「미확인 값」과 같은 것). */
  unconfirmed: { field: string; label: string; computed_as: unknown; text: string }[];
  /** 눈에 띄어야 하는 표시(「속성 상성 미반영」). */
  flags: string[];
  notes: string[];
  is_test_data: boolean;
}

/** 한 육성 기준의 계산 결과. 계산하지 못한 것은 0이 아니라 그렇게 적힌다. */
export type DeckOutcome =
  | { status: 'computed'; total_damage: number; members: ReportMember[]; notes: string[]; engine_warnings: string[]; ungrown_members: string[]; level: number | null }
  | { status: 'rejected'; reasons: string[] }
  | { status: 'failed'; error: { type?: string; message?: string; path?: string | null } };

/** 덱 계산 결과(evaluateDeck) — 한 편성을 두 육성 기준으로 계산한 것. */
export interface DeckReport {
  schema_version: number;
  kind: 'deck_report';
  generated_at: string;
  /** 어느 편성·어느 상대의 결과인지(자리 순서 포함). */
  key: string;
  account: { name?: string | null; is_test_data?: boolean; updated_at?: string | null };
  opponent: DeckOpponent;
  members: string[];
  results: { account: DeckOutcome; engine_default: DeckOutcome };
  /** 「내 계정 육성」 ÷ 「모두 최대 육성」과 그 한 줄. 둘 중 하나라도 계산하지 못했으면 null. */
  growth: { ratio: number; text: string } | null;
  /** 「모두 최대 육성」이 무엇인지 한 줄. */
  engine_default_spec: string;
  assumptions: string[];
  engine?: EngineVersion | null;
  cache?: CacheStats | null;
  caveats: string[];
}

/** 「한 명을 바꾼다면」의 결과(swapOne). */
export interface DeckSwapReport {
  kind: 'deck_swap';
  key: string;
  slot: number;
  /** 그 자리에 있던 니케. */
  out: string | null;
  group: string | null;
  baseline: DeckOutcome;
  /** 총딜이 큰 순. `change` +0.08 = 8% 증가(지금 편성을 계산하지 못했으면 null). */
  rows: { name: string; members: string[]; total_damage: number; change: number | null; engine_warnings: string[] }[];
  /** 계산하지 못한 니케(0으로 두지 않는다). */
  failed: { name: string; reason: string }[];
  /** 상한 때문에 보지 못한 니케. */
  skipped: string[];
  candidates: { total: number; limit: number; computed: number; failed: number; skipped: number };
  cache?: CacheStats | null;
  caveats: string[];
}

/** 「자리 순서 비교」의 결과(compareOrders). */
export interface DeckOrderReport {
  kind: 'deck_order';
  key: string;
  current: { members: string[]; total_damage: number };
  best: { members: string[]; total_damage: number };
  /** 지금 순서가 아닌 순서가 가장 좋았나. */
  changed: boolean;
  changes: string[];
  gain_ratio: number | null;
  gain_text: string | null;
  variants: { total: number; simulated: number; skipped: number; failed: number; limit: number };
  cache?: CacheStats | null;
  caveats: string[];
}

/** 저장한 편성 하나. 자리는 다섯이고 빈 자리는 null이다. */
export interface SavedDeck {
  /** 이름 붙인 목록의 항목에만 있다. */
  id?: string;
  name: string;
  members: (string | null)[];
  /** 상대의 열쇠(`boss:kraken` 등). 정하지 않았으면 null. */
  opponent: string | null;
  opponent_label: string | null;
  /** 저장할 때의 추정 총딜(내 계정 육성 기준). 계산하지 않았으면 null. */
  total_damage: number | null;
  saved_at: string | null;
}

/** 계정마다 두는 내 편성: 번호 칸 다섯(01~05)과 이름 붙인 목록(계정 폴더의 `<계정>.decks.json`). */
export interface DeckBook {
  schema_version: number;
  kind: string;
  slots: (SavedDeck | null)[];
  saved: SavedDeck[];
}

// ── 육성 효율표(P-031 — 루트 src/core/efficiency.mjs, docs/data-model.md §육성 효율표) ──────────

/** 효율표·큐브 비교의 기준 총딜과 멤버별 딜. */
export interface EfficiencyBaseline {
  total_damage: number;
  members: ReportMember[];
  notes: string[];
  engine_warnings: string[];
  ungrown_members: string[];
}

/** 한 단계 올릴 수 있는 것 하나(무엇을 어디서 어디로). */
export interface UpgradeStep {
  id: string;
  nikke: string;
  /** `skill1`·`skill2`·`burst`·`breakthrough`·`core`·`collection`·`overload:<옵션>`. */
  kind: string;
  label: string;
  from: string;
  to: string;
}

/** 효율표의 한 줄. `gain_rate` 0.012 = 총딜 1.2% 증가. */
export interface EfficiencyRow extends UpgradeStep {
  rank: number;
  total_after: number;
  gain: number;
  gain_rate: number | null;
  notes: string[];
  engine_warnings: string[];
}

/** 후보로 만들지 않은 칸과 까닭(이미 최대·미확인·잠김·없음·지원하지 않음). */
export interface ExcludedStep {
  nikke: string;
  kind: string;
  label: string;
  code: 'max' | 'unknown' | 'locked' | 'none' | 'unsupported';
  reason: string;
}

/** 육성 효율표(efficiencyTable). */
export interface EfficiencyReport {
  schema_version: number;
  kind: 'growth_efficiency';
  generated_at: string;
  /** 어느 편성·어느 상대의 결과인지. */
  key: string;
  /** 한 니케만 본 결과면 그 이름. */
  only: string | null;
  account: { name?: string | null; is_test_data?: boolean; updated_at?: string | null };
  members: string[];
  /** 올릴 것이 없어 계산하지 않았으면 null. */
  baseline: EfficiencyBaseline | null;
  rows: EfficiencyRow[];
  /** 계산하지 못한 것(0으로 두지 않는다). */
  failed: (UpgradeStep & { reason: string })[];
  /** 상한 때문에 보지 못한 것. */
  skipped: UpgradeStep[];
  excluded: ExcludedStep[];
  candidates: { total: number; limit: number; computed: number; failed: number; skipped: number };
  /** 비용은 모른다 — 언제나 false다. */
  cost_known: boolean;
  cost_note: string;
  assumptions: string[];
  engine?: EngineVersion | null;
  cache?: CacheStats | null;
  caveats: string[];
}

/** 오버로드 옵션 한 줄(옵션의 열쇠와 줄 레벨). */
export interface OverloadLine {
  id: string;
  level: number;
}

/** 장비 부위 하나의 옵션 줄 셋(빈 줄은 null). */
export interface OverloadPart {
  part: string;
  lines: (OverloadLine | null)[];
}

/** 옵션별로 묶은 줄(줄이 있는 옵션만). */
export interface OverloadOptionSummary {
  id: string;
  name: string;
  levels: number[];
}

/** 오버로드 옵션 바꿔 보기의 결과(tryOverload). */
export interface OverloadTrialReport {
  kind: 'overload_trial';
  /** 어느 편성·상대·니케·옵션의 결과인지. */
  key: string;
  nikke: string;
  /** computed 계산됨 · same 지금과 같다 · failed 계산하지 못함(0이 아니다). */
  status: 'computed' | 'same' | 'failed';
  before: { status: string; options: OverloadOptionSummary[]; count: number };
  after: { options: OverloadOptionSummary[]; count: number };
  total_before: number;
  total_after: number | null;
  gain: number | null;
  gain_rate: number | null;
  members: (ReportMember & { gain: number })[];
  reason: string | null;
  notes: string[];
  assumptions: string[];
  engine?: EngineVersion | null;
  cache?: CacheStats | null;
  caveats: string[];
}

/** 큐브 하나를 바꿔 본 줄. `change` +0.02 = 총딜 2% 증가. `owned_level`은 계정에서 본 보유 레벨(모르면 null). */
export interface CubeRow {
  cube: string;
  level: number;
  total_damage: number;
  gain: number;
  change: number | null;
  owned_level: number | null;
  engine_warnings: string[];
}

/** 큐브 비교에서 니케 한 명의 줄들. */
export interface CubeNikke {
  nikke: string;
  /** 지금 낀 것으로 계산되는 큐브. `source: 'default'`면 계정에 적혀 있지 않아 계산 도구의 기본 큐브다. */
  current: { name: string; level: number; source: 'account' | 'default'; owned_level: number | null };
  /** 총딜이 큰 순. */
  rows: CubeRow[];
  /** 지금 큐브보다 나은 것이 없으면 null. */
  best: { cube: string; level: number; change: number | null } | null;
}

/** 큐브 비교의 결과(compareCubes). */
export interface CubeReport {
  kind: 'cube_report';
  key: string;
  only: string | null;
  account: { name?: string | null; is_test_data?: boolean; updated_at?: string | null };
  members: string[];
  baseline: EfficiencyBaseline;
  nikkes: CubeNikke[];
  /** 「이 편성에 맞는 큐브」: 니케마다 고른 큐브와, 함께 끼웠을 때의 총딜. */
  recommendation: {
    picks: { nikke: string; cube: string; level: number; changed: boolean; alone_change: number | null; owned_level: number | null }[];
    status: 'computed' | 'unchanged' | 'failed';
    total_damage: number | null;
    gain: number | null;
    gain_rate: number | null;
    reason: string | null;
  };
  failed: { nikke: string; cube: string; reason: string }[];
  /** 상한 때문에 보지 못한 큐브. */
  skipped_cubes: string[];
  /** 계산 도구가 효과를 계산하지 못해 견주지 않은 큐브. */
  unsupported: string[];
  candidates: { total: number; limit: number; computed: number; failed: number; skipped: number };
  assumptions: string[];
  engine?: EngineVersion | null;
  cache?: CacheStats | null;
  caveats: string[];
}
