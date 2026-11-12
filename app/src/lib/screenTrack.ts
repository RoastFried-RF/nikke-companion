// 요격전 화면 자동 추적 — 화면 쪽.
//
// 게임 화면을 읽고 인식하는 일은 Rust가 한다(src-tauri/src/screen_track.rs·lib.rs의 추적 스레드). 여기에는
//   1) 인식 결과에 따라 **언제 보스를 바꾸고 언제 그대로 두는지**의 규칙(`followStep` — 순수 함수),
//   2) 보스를 따라갈 때 **언제 요격전 탭으로 옮기고 언제 미루는지**의 규칙(`tabMoveStep` — 순수 함수),
//   3) 스위치·주기·자동 이동 설정을 기억하고 Rust에 알리는 상태(`provideScreenTrack`)
// 가 있다. 이미지는 오지 않는다 — 인식 결과(화면 종류·보스·근거 문장)만 온다.
//
// 따라가기 규칙(`followStep`):
// - 스위치가 꺼져 있으면 아무것도 하지 않는다(들어온 상태를 무시한다). 다시 켜면 처음부터 따라간다.
// - 읽은 화면이 이상 개체 화면 + 보스이고, **마지막으로 따라간 것(화면 종류 + 보스)과 다르면** 그 보스를 따라간다
//   (요격전 탭으로 옮기고 그 보스를 고른다 — 옮기는 것은 App.vue, 고르는 것은 InterceptView.vue).
// - 같은 것이 이어지는 동안에는 화면을 다시 건드리지 않는다 — 그 사이에 사용자가 손으로 다른 보스나 다른 탭을 골랐으면
//   인식 결과가 바뀔 때까지 그대로다.
// - `unknown`(판단하지 않음)과 읽지 못한 상태(게임 없음·최소화·오버레이 숨김·읽기 실패)에서는 아무것도 바꾸지 않고,
//   마지막으로 따라간 것도 잊지 않는다: 보스를 넘기는 도중이나 팝업 때문에 잠깐 모르게 됐다가 같은 화면으로 돌아와도
//   손으로 고른 보스를 되돌리지 않는다.
// - `other`(이상 개체 화면이 아님)에서도 고른 보스는 바꾸지 않는다. 다만 이상 개체 화면을 떠난 것이므로 마지막으로
//   따라간 것은 잊는다 — 다시 들어오면 같은 보스여도 새로 따라간다.
//
// 탭 이동 규칙(`tabMoveStep`) — 보스를 따라갈 때 요격전 탭으로 옮길지:
// - 「인식하면 요격전 탭으로」가 꺼져 있거나 이미 요격전 탭이면 옮기지 않는다.
// - **어느 탭에서든 계산이 도는 동안에는 옮기지 않는다**(보고 있던 화면이 갑자기 바뀌지 않게). 보스는 요격전 화면의
//   선택에 반영되고, 탭 이동만 미뤄 둔다 — 화면에 「계산이 끝나면 요격전 탭으로 옮긴다」가 보인다.
// - 계산이 끝나면 그때 한 번 옮긴다. 그 전에 사용자가 요격전 탭을 직접 열었거나, 자동 이동·스위치를 껐거나,
//   게임이 이상 개체 화면을 떠났으면(`other`) 미뤄 둔 이동은 버린다.

import { inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue';
import { errorMessage, onScreenTrack, screenTrackStatus, setScreenTracking } from './backend';
import { recall, remember } from './remember';
import type { RecognizedBoss, ScreenKind, ScreenTrackStatus } from '../types';

/** 마지막으로 고른 요격전 보스(id)를 기억하는 이름. 손으로 골라도, 인식을 따라가도 여기에 적는다. */
export const LAST_BOSS = 'intercept.boss';
/** 자동 추적 스위치를 기억하는 이름('1'이면 켜짐). 기본은 꺼짐이다. */
export const TRACK_ENABLED = 'track.enabled';
/** 인식하면 요격전 탭으로 옮길지 기억하는 이름('0'이면 옮기지 않는다). 기본은 옮긴다. */
export const TRACK_AUTO_TAB = 'track.auto-tab';
/** 게임 화면을 읽는 주기(초)를 기억하는 이름. */
export const TRACK_INTERVAL = 'track.interval-sec';

/** 주기의 기본값과 범위(초). Rust(screen_track.rs)의 DEFAULT/MIN/MAX_INTERVAL_MS와 같다 — 범위는 Rust가 다시 확인한다. */
export const DEFAULT_INTERVAL_SEC = 2;
export const MIN_INTERVAL_SEC = 0.5;
export const MAX_INTERVAL_SEC = 60;

/** 화면이 준 주기(초)를 쓸 수 있는 값으로. 수가 아니면 기본값. */
export function clampIntervalSec(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_SEC;
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, n));
}

// ── 따라가기 규칙(순수) ──────────────────────────────────────────────────────

/** 따라가기 상태: 마지막으로 따라간 인식(화면 종류 + 보스 id). 없으면 null. */
export interface FollowState {
  readonly followed: string | null;
}

/** 아직 아무것도 따라가지 않았다. */
export const NOT_FOLLOWING: FollowState = Object.freeze({ followed: null });

export interface FollowStep {
  state: FollowState;
  /** 지금 따라가야 할 보스(탭을 옮기고 이 보스를 고른다). 화면을 건드리지 않아야 하면 null. */
  boss: RecognizedBoss | null;
}

const isAnomaly = (screen: ScreenKind): boolean => screen === 'anomaly_select' || screen === 'anomaly_squad';

/**
 * 추적 상태 하나를 받아 따라갈지 정한다. 입력을 바꾸지 않는다.
 * `switchOn`은 화면의 스위치다 — 꺼져 있으면 들어온 상태를 무시한다.
 */
export function followStep(state: FollowState, status: ScreenTrackStatus | null | undefined, switchOn: boolean): FollowStep {
  // 꺼져 있다: 무시하고, 다시 켰을 때 처음부터 따라가도록 잊는다.
  if (!switchOn || !status || !status.enabled) return { state: NOT_FOLLOWING, boss: null };
  // 읽지 않았거나 읽지 못했다: 그대로 둔다.
  if (status.state !== 'read' || !status.recognition) return { state, boss: null };
  const { screen, boss } = status.recognition;
  // 이상 개체 화면을 떠났다: 고른 보스는 그대로 두고, 따라간 것만 잊는다.
  if (screen === 'other') return { state: NOT_FOLLOWING, boss: null };
  // 판단하지 않았다(또는 보스 없는 이상 개체 화면 — 추측하지 않는다): 그대로 둔다.
  if (!isAnomaly(screen) || !boss) return { state, boss: null };
  const key = `${screen}:${boss.id}`;
  // 같은 결과가 이어진다: 화면을 다시 건드리지 않는다.
  if (key === state.followed) return { state, boss: null };
  return { state: { followed: key }, boss: { id: boss.id, name: boss.name } };
}

// ── 탭 이동 규칙(순수) ───────────────────────────────────────────────────────

/** 탭 이동 상태: 계산이 끝나면 요격전 탭으로 옮기려고 미뤄 둔 이동이 있는가. */
export interface TabMoveState {
  readonly pending: boolean;
}

/** 미뤄 둔 이동이 없다. */
export const NO_TAB_MOVE: TabMoveState = Object.freeze({ pending: false });

export interface TabMoveInput {
  /** 이번에 보스를 새로 따라갔다(`followStep`이 보스를 돌려줬다). */
  followed: boolean;
  /** 지금 따라가는 중이다: 스위치가 켜져 있고 마지막으로 따라간 것을 잊지 않았다. */
  following: boolean;
  /** 「인식하면 요격전 탭으로」가 켜져 있다. */
  autoTab: boolean;
  /** 어느 탭에서든 계산이 돌고 있다. */
  computing: boolean;
  /** 이미 요격전 탭을 보고 있다. */
  onIntercept: boolean;
}

export interface TabMoveStep {
  state: TabMoveState;
  /** 지금 요격전 탭으로 옮긴다. */
  move: boolean;
}

/**
 * 요격전 탭으로 옮길지 정한다. 입력을 바꾸지 않는다. 보스를 따라갈 때뿐 아니라 계산이 시작·끝나거나 사용자가 탭을
 * 옮기거나 설정을 바꿀 때에도 부른다(`followed: false`) — 미뤄 둔 이동을 그때 옮기거나 버린다.
 */
export function tabMoveStep(state: TabMoveState, input: TabMoveInput): TabMoveStep {
  // 옮길 이유가 없다: 자동 이동이 꺼졌거나, 따라가는 것이 없거나(스위치 꺼짐·이상 개체 화면을 떠남), 이미 요격전 탭이다.
  if (!input.autoTab || !input.following || input.onIntercept) return { state: NO_TAB_MOVE, move: false };
  if (!input.followed && !state.pending) return { state: NO_TAB_MOVE, move: false };
  // 계산이 도는 동안에는 탭을 옮기지 않고 미뤄 둔다.
  if (input.computing) return { state: state.pending ? state : { pending: true }, move: false };
  return { state: NO_TAB_MOVE, move: true };
}

/** 결과의 보스 가운데 인식한 보스: id가 같은 것, 없으면 이름이 같은 것. 없으면 undefined. */
export function findBoss<T extends { id: string; name: string }>(bosses: readonly T[], target: { id: string; name: string }): T | undefined {
  return bosses.find((b) => b.id === target.id) ?? bosses.find((b) => b.name === target.name);
}

// ── 상태 표시(순수) ──────────────────────────────────────────────────────────

/** 화면 종류의 이름. */
export const SCREEN_LABEL: Record<ScreenKind, string> = {
  anomaly_select: '보스 선택 화면',
  anomaly_squad: '편성 화면',
  other: '이상 개체 화면 아님',
  unknown: '인식 못 함',
};

export interface TrackSummary {
  /** 점의 색: 꺼짐 / 보스를 인식함 / 읽고 있지만 볼 것이 없음 / 읽지 못함·모름. */
  tone: 'off' | 'on' | 'idle' | 'warn';
  /** 한눈에 볼 상태: 인식한 보스와 화면, 또는 인식 못 함·게임 없음 같은 이름. */
  text: string;
  /** 이유 한 줄(없으면 빈 문자열). */
  reason: string;
}

/** 추적 상태를 한 줄로. `target`은 마지막으로 따라간 보스다 — 지금 보스가 안 보이면 유지 중이라고 알린다. */
export function summarize(switchOn: boolean, status: ScreenTrackStatus | null, target: RecognizedBoss | null): TrackSummary {
  if (!switchOn) return { tone: 'off', text: '꺼짐', reason: '' };
  if (!status || !status.enabled) return { tone: 'idle', text: '상태 확인 중…', reason: '' };
  const kept = target ? `마지막 보스 ${target.name} 유지` : '';
  const why = (...parts: string[]) => parts.filter(Boolean).join(' — ');
  switch (status.state) {
    case 'starting':
      return { tone: 'idle', text: '게임 화면을 읽는 중…', reason: '' };
    case 'read': {
      const seen = status.recognition;
      if (!seen) return { tone: 'warn', text: SCREEN_LABEL.unknown, reason: why(status.message, kept) };
      if (isAnomaly(seen.screen) && seen.boss) return { tone: 'on', text: `${seen.boss.name} · ${SCREEN_LABEL[seen.screen]}`, reason: '' };
      if (seen.screen === 'other') return { tone: 'idle', text: SCREEN_LABEL.other, reason: kept };
      return { tone: 'warn', text: SCREEN_LABEL.unknown, reason: why(status.message, kept) };
    }
    case 'no_game':
      return { tone: 'warn', text: '게임 없음', reason: why(status.message, kept) };
    case 'minimized':
      return { tone: 'warn', text: '게임 창 최소화', reason: why(status.message, kept) };
    case 'overlay_hidden':
      return { tone: 'idle', text: '오버레이 숨김', reason: status.message };
    case 'failed':
      return { tone: 'warn', text: `읽기 실패${status.failures > 1 ? ` (연속 ${status.failures}회)` : ''}`, reason: why(status.message, kept) };
    default:
      return { tone: 'off', text: '꺼짐', reason: '' };
  }
}

/** ISO 시각을 현지 시각 'HH:MM:SS'로. 읽을 수 없으면 빈 문자열. */
export function clockTime(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── 상태(App.vue가 하나 만들어 화면들에 내려 준다) ───────────────────────────

/** 따라간 보스. `seq`는 따라갈 때마다 하나씩 는다 — 같은 보스를 다시 따라가도 화면이 알아챈다. */
export interface TrackTarget extends RecognizedBoss {
  seq: number;
}

export interface ScreenTrack {
  /** 스위치(기억한다, 기본 꺼짐). */
  enabled: Ref<boolean>;
  /** 인식하면 요격전 탭으로 옮길지(기억한다, 기본 켜짐). */
  autoTab: Ref<boolean>;
  /** 게임 화면을 읽는 주기(초, 기억한다, 기본 2). */
  intervalSec: Ref<number>;
  /** Rust가 알려 준 마지막 상태. 아직 모르면 null. */
  status: Ref<ScreenTrackStatus | null>;
  /** 켜거나 끄지 못했을 때의 문장. 인식 실패는 여기가 아니라 `status`에 상태로 온다. */
  problem: Ref<string>;
  /** 마지막으로 따라간 보스. 스위치를 끄면 null. */
  target: Ref<TrackTarget | null>;
  /** 계산이 도는 중이라 요격전 탭으로 옮기는 것을 미뤄 뒀다 — 계산이 끝나면 옮긴다. */
  pendingMove: Ref<boolean>;
  setEnabled(on: boolean): Promise<void>;
  setAutoTab(on: boolean): void;
  setIntervalSec(sec: unknown): Promise<void>;
  /** 지금 상태를 Rust에 물어 반영한다(읽은 시각·근거가 최신이 된다). 꺼져 있으면 아무것도 하지 않는다. */
  refresh(): Promise<void>;
  /** 계산이 시작·끝났거나 탭이 바뀌었다: 미뤄 둔 탭 이동을 다시 본다(`tabMoveStep`). */
  settle(): void;
}

/** 자동 추적이 탭을 옮길 때 묻고 시키는 것(App.vue가 준다). */
export interface TrackHost {
  /** 어느 탭에서든 계산이 돌고 있는가. */
  computing(): boolean;
  /** 요격전 탭을 보고 있는가. */
  onIntercept(): boolean;
  /** 요격전 탭으로 옮긴다. */
  moveToIntercept(): void;
}

const KEY: InjectionKey<ScreenTrack> = Symbol('screen-track');

/**
 * 자동 추적 상태를 만든다. 보스를 따라갈 때 탭을 옮길지는 `tabMoveStep`이 정하고, 옮기는 것은 `host`(App.vue)가 한다.
 * `start`는 기억해 둔 스위치가 켜져 있으면 Rust의 추적을 켠다. `dispose`는 이벤트 구독을 끊는다.
 */
export function createScreenTrack(
  host: TrackHost,
  options: { /** 보기만 한다(오버레이 창): 켜고 끄는 것은 앱 창이 하고, 여기서는 Rust가 알려 주는 상태를 따라갈 뿐이다. */ passive?: boolean } = {},
): { track: ScreenTrack; start: () => Promise<void>; dispose: () => void } {
  const enabled = ref(options.passive ? false : recall(TRACK_ENABLED) === '1');
  const autoTab = ref(recall(TRACK_AUTO_TAB) !== '0');
  const intervalSec = ref(clampIntervalSec(recall(TRACK_INTERVAL) || DEFAULT_INTERVAL_SEC));
  const status = ref<ScreenTrackStatus | null>(null);
  const problem = ref('');
  const target = ref<TrackTarget | null>(null);
  const pendingMove = ref(false);

  let follow: FollowState = NOT_FOLLOWING;
  let tabMove: TabMoveState = NO_TAB_MOVE;
  let seq = 0;
  /** 설정을 Rust에 알린 횟수. 늦게 돌아온 응답이 그 뒤의 설정을 덮지 않게 한다. */
  let generation = 0;
  let unlisten: (() => void) | null = null;
  let listening: Promise<void> | null = null;
  let disposed = false;

  /** 탭 이동 규칙을 한 번 돌린다: 옮기라고 하면 옮기고, 미뤄 둔 이동이 있는지를 화면에 알린다. */
  function stepTabMove(followed: boolean): void {
    const step = tabMoveStep(tabMove, {
      followed,
      following: enabled.value && follow.followed !== null,
      autoTab: autoTab.value,
      computing: host.computing(),
      onIntercept: host.onIntercept(),
    });
    tabMove = step.state;
    pendingMove.value = step.state.pending;
    if (step.move) host.moveToIntercept();
  }

  /** 상태 하나를 반영한다: 표시를 바꾸고, 규칙이 따라가라고 하면 따라간다. */
  function accept(next: ScreenTrackStatus | null | undefined): void {
    if (!next) return;
    status.value = next;
    const step = followStep(follow, next, enabled.value);
    follow = step.state;
    if (step.boss) {
      // 보스는 탭을 옮기지 못하는 동안(계산 중)에도 요격전 화면의 선택에 반영한다.
      remember(LAST_BOSS, step.boss.id);
      target.value = { ...step.boss, seq: ++seq };
    }
    // 따라가지 않았어도 돌린다 — 이상 개체 화면을 떠났으면 미뤄 둔 이동을 버린다.
    stepTabMove(step.boss !== null);
  }

  /** 이벤트 구독을 한 번만 건다. 꺼져 있는 동안 온 이벤트는 버린다. */
  function listen(): Promise<void> {
    listening ??= onScreenTrack((next) => {
      if (enabled.value) accept(next);
    }).then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
      },
      (e) => {
        listening = null; // 다음에 다시 건다.
        throw e;
      },
    );
    return listening;
  }

  /** 지금 스위치·주기를 Rust에 알리고 돌아온 상태를 반영한다. */
  async function push(): Promise<void> {
    const on = enabled.value;
    const mine = ++generation;
    try {
      if (on) await listen();
      const next = await setScreenTracking(on, Math.round(intervalSec.value * 1000));
      if (mine !== generation) return;
      problem.value = '';
      accept(next);
    } catch (e) {
      if (mine !== generation) return;
      problem.value = `자동 추적을 ${on ? '켜지' : '끄지'} 못했다: ${errorMessage(e)}`;
    }
  }

  async function setEnabled(on: boolean): Promise<void> {
    enabled.value = on;
    remember(TRACK_ENABLED, on ? '1' : '0');
    if (!on) {
      // 끄면 따라가던 것을 잊는다 — 다시 켜면 지금 화면부터 새로 따라간다.
      follow = NOT_FOLLOWING;
      target.value = null;
      stepTabMove(false);
    }
    await push();
  }

  function setAutoTab(on: boolean): void {
    autoTab.value = on;
    remember(TRACK_AUTO_TAB, on ? '1' : '0');
    // 끄면 미뤄 둔 이동을 버린다.
    stepTabMove(false);
  }

  async function setIntervalSec(sec: unknown): Promise<void> {
    intervalSec.value = clampIntervalSec(sec);
    remember(TRACK_INTERVAL, String(intervalSec.value));
    // 꺼져 있으면 기억만 한다 — 켤 때 함께 알린다.
    if (enabled.value) await push();
  }

  async function refresh(): Promise<void> {
    if (!enabled.value) return;
    const mine = generation;
    try {
      const next = await screenTrackStatus();
      if (mine === generation && enabled.value) accept(next);
    } catch {
      // 물어보지 못해도 이벤트로 온 상태가 그대로 보인다.
    }
  }

  /** 보기만 하는 쪽: Rust가 알려 준 켜짐 여부를 그대로 따른다. 꺼졌으면 따라가던 것을 잊는다. */
  function follow_rust(next: ScreenTrackStatus | null | undefined): void {
    if (!next) return;
    enabled.value = next.enabled;
    if (!next.enabled) {
      follow = NOT_FOLLOWING;
      target.value = null;
      status.value = next;
      return;
    }
    accept(next);
  }

  /** 보기만 하는 쪽의 시작: 알림을 듣고 지금 상태를 한 번 묻는다. Rust에 아무것도 시키지 않는다. */
  async function watchOnly(): Promise<void> {
    try {
      const stop = await onScreenTrack(follow_rust);
      if (disposed) stop();
      else unlisten = stop;
    } catch {
      // 알림을 듣지 못해도 물어서 읽은 상태는 보인다.
    }
    try {
      follow_rust(await screenTrackStatus());
    } catch {
      // 상태를 모르면 꺼진 것으로 보인다.
    }
  }

  return {
    track: { enabled, autoTab, intervalSec, status, problem, target, pendingMove, setEnabled, setAutoTab, setIntervalSec, refresh, settle: () => stepTabMove(false) },
    start: async () => {
      if (options.passive) await watchOnly();
      else if (enabled.value) await push();
    },
    dispose: () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    },
  };
}

/** App.vue가 부른다: 상태를 만들어 아래 화면들에 내려 주고, 기억해 둔 스위치가 켜져 있으면 추적을 켠다. */
export function provideScreenTrack(host: TrackHost, options: { passive?: boolean } = {}): ScreenTrack {
  const { track, start, dispose } = createScreenTrack(host, options);
  provide(KEY, track);
  onMounted(start);
  onBeforeUnmount(dispose);
  return track;
}

/** 화면들이 부른다. App.vue 밖에서(컴포넌트만 따로) 쓰이면 null — 그때 자동 추적은 없다. */
export function useScreenTrack(): ScreenTrack | null {
  return inject(KEY, null);
}
