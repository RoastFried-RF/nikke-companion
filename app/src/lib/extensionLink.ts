// 크롬 확장 연결 — 화면 쪽.
//
// 이 PC의 크롬 확장이 넘기는 세션 쿠키는 Rust의 수신부가 받아 엔진의 쿠키 파일에 쓴다(src-tauri/src/extension_link.rs).
// **쿠키는 화면을 지나가지 않는다** — 여기에 오는 것은 상태(켜짐·주소·연결 코드·마지막 요청의 결과·「받았다」)뿐이다.
// 여기에는
//   1) 상태를 들고 Rust에 켜기/끄기·코드 다시 만들기를 청하는 상태(`provideExtensionLink`),
//   2) 확장에서 쿠키를 받았을 때 **언제 계정 탭을 열고 언제 미루는지**의 규칙(`arrivalStep` — 순수 함수)
// 이 있다. 받은 뒤의 「계정 새로 받기」는 계정 화면이 잇는다(`claim`으로 차례를 가져간다 — 한 번만).
//
// 켜짐 여부와 연결 코드는 Rust가 기억한다(앱 설정 폴더) — 앱을 켤 때 계정 탭을 열지 않아도 수신부가 열려 있어야
// 확장의 단추가 통한다. 그래서 여기서는 localStorage에 아무것도 적지 않는다.
//
// 계정 탭 열기 규칙(`arrivalStep`) — 자동 추적의 탭 이동(lib/screenTrack.ts의 tabMoveStep)과 같은 생각이다:
// - 확장에서 쿠키를 받으면 계정 탭을 연다(사용자가 방금 확장의 단추를 눌렀다 — 진행이 보여야 한다).
// - 이미 계정 탭이면 아무것도 하지 않는다.
// - **어느 탭에서든 계산이 도는 동안에는 옮기지 않는다.** 미뤄 뒀다가 계산이 끝나면 한 번 옮긴다. 그 전에 사용자가
//   계정 탭을 직접 열었으면 미뤄 둔 이동은 버린다.

import { inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue';
import { errorMessage, extensionLinkNewCode, extensionLinkSet, extensionLinkStatus, extensionLinkTakePending, onExtensionLink } from './backend';
import type { ExtensionLinkStatus } from '../types';

// ── 계정 탭 열기 규칙(순수) ───────────────────────────────────────────────────

/** 미뤄 둔 이동이 있는가. */
export interface ArrivalState {
  readonly waiting: boolean;
}

export const NO_ARRIVAL: ArrivalState = Object.freeze({ waiting: false });

export interface ArrivalInput {
  /** 방금 확장에서 쿠키를 받았는가(그냥 다시 보는 것이면 false). */
  arrived: boolean;
  /** 어느 탭에서든 계산이 돌고 있는가. */
  computing: boolean;
  /** 계정 탭을 보고 있는가. */
  onAccount: boolean;
}

export interface ArrivalStep {
  state: ArrivalState;
  /** 지금 계정 탭을 열 것인가. */
  open: boolean;
}

export function arrivalStep(state: ArrivalState, input: ArrivalInput): ArrivalStep {
  const wanted = input.arrived || state.waiting;
  // 옮길 일이 없거나 이미 계정 탭이다(사용자가 직접 열었어도) — 미뤄 둔 것도 버린다.
  if (!wanted || input.onAccount) return { state: NO_ARRIVAL, open: false };
  // 계산 중에는 보고 있던 화면을 바꾸지 않는다.
  if (input.computing) return { state: { waiting: true }, open: false };
  return { state: NO_ARRIVAL, open: true };
}

// ── 상태 ─────────────────────────────────────────────────────────────────────

/** 확장에서 쿠키를 받았을 때 묻고 시키는 것(App.vue가 준다). */
export interface LinkHost {
  /** 어느 탭에서든 계산이 돌고 있는가. */
  computing(): boolean;
  /** 계정 탭을 보고 있는가. */
  onAccount(): boolean;
  /** 계정 탭을 연다. */
  openAccount(): void;
}

export interface ExtensionLink {
  /** Rust가 알려 준 상태. 아직 모르면 null. */
  status: Ref<ExtensionLinkStatus | null>;
  /** 켜기/끄기·코드 다시 만들기를 청하다 난 오류(한국어 문장). */
  problem: Ref<string>;
  /** 켜기/끄기·코드 다시 만들기를 청하는 중인가. */
  busy: Ref<boolean>;
  /** 확장에서 쿠키를 받았지만 계산 중이라 계정 탭을 아직 열지 않았다. */
  waiting: Ref<boolean>;
  setEnabled(on: boolean): Promise<void>;
  newCode(): Promise<void>;
  /** 받은 쿠키로 「계정 새로 받기」를 이을 차례를 가져간다. 가져갔으면 true(한 번만). */
  claim(): Promise<boolean>;
  /** 계산이 시작·끝나거나 탭이 바뀌었을 때 미뤄 둔 이동을 다시 본다. */
  settle(): void;
}

const KEY: InjectionKey<ExtensionLink> = Symbol('extension-link');

export function createExtensionLink(host: LinkHost): { link: ExtensionLink; start: () => Promise<void>; dispose: () => void } {
  const status = ref<ExtensionLinkStatus | null>(null);
  const problem = ref('');
  const busy = ref(false);
  const waiting = ref(false);

  let arrival: ArrivalState = NO_ARRIVAL;
  let unlisten: (() => void) | null = null;
  let disposed = false;

  function step(arrived: boolean): void {
    const next = arrivalStep(arrival, { arrived, computing: host.computing(), onAccount: host.onAccount() });
    arrival = next.state;
    waiting.value = next.state.waiting;
    if (next.open) host.openAccount();
  }

  /** 상태 하나를 반영한다. 받은 쿠키가 기다리고 있으면 계정 탭을 연다(규칙이 허락할 때). */
  function accept(next: ExtensionLinkStatus | null | undefined): void {
    if (!next) return;
    status.value = next;
    if (next.pending) step(true);
  }

  /** Rust에 무엇을 청하고 돌아온 상태를 반영한다. 겹쳐 청하지 않는다. */
  async function ask(what: string, request: () => Promise<ExtensionLinkStatus>): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    problem.value = '';
    try {
      accept(await request());
    } catch (e) {
      problem.value = `${what} 못했다: ${errorMessage(e)}`;
    } finally {
      busy.value = false;
    }
  }

  async function claim(): Promise<boolean> {
    const current = status.value;
    if (!current?.pending) return false;
    // 먼저 표시를 내린다 — 같은 차례를 두 번 가져가려 하지 않게.
    status.value = { ...current, pending: false };
    try {
      return await extensionLinkTakePending();
    } catch {
      return false;
    }
  }

  return {
    link: {
      status,
      problem,
      busy,
      waiting,
      setEnabled: (on) => ask(`크롬 확장 연결을 ${on ? '켜지' : '끄지'}`, () => extensionLinkSet(on)),
      newCode: () => ask('연결 코드를 다시 만들지', extensionLinkNewCode),
      claim,
      settle: () => step(false),
    },
    start: async () => {
      try {
        const stop = await onExtensionLink(accept);
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        // 이벤트를 듣지 못해도 상태는 물어서 보인다.
      }
      try {
        accept(await extensionLinkStatus());
      } catch {
        // 상태를 모르면 계정 화면이 「확인하지 못했다」로 보인다 — 켜기 단추는 눌러 볼 수 있다.
      }
    },
    dispose: () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    },
  };
}

/** App.vue가 부른다: 상태를 만들어 계정 화면에 내려 주고, 앱이 켜질 때 Rust의 상태를 읽는다(받아 둔 쿠키가 있으면 잇는다). */
export function provideExtensionLink(host: LinkHost): ExtensionLink {
  const { link, start, dispose } = createExtensionLink(host);
  provide(KEY, link);
  onMounted(start);
  onBeforeUnmount(dispose);
  return link;
}

/** 계정 화면이 부른다. App.vue 밖에서(화면만 따로) 쓰이면 null — 그때 크롬 확장 연결 칸은 없다. */
export function useExtensionLink(): ExtensionLink | null {
  return inject(KEY, null);
}
