// 두 창(데스크톱 앱 창·오버레이 창)이 함께 보는 것 — 화면 쪽.
//
// 기본 계정의 이름, 계정 목록, 오버레이를 띄우는 때, 마지막 요격전 추천 결과. 디스크(계정 폴더)에 두는 일은 Rust가 한다
// (src-tauri/src/shared_state.rs). 여기에는 그것을 읽어 화면들에 내려 주는 상태가 있다:
//   - 앱 창이 계산을 끝내면 `publishIntercept`가 결과를 저장하고(Rust가 모든 창에 알린다),
//   - 오버레이 창은 그 알림을 받아 결과를 다시 읽는다. 앱을 다시 켜도 마지막 결과가 보인다.
//   - 다른 종류·다른 판의 결과는 한국어로 알리고 앞서 보이던 것을 그대로 둔다.
//   - 결과는 계정마다 따로다(P-033): 지금 쓰는 계정이 바뀌면 앞 계정의 결과를 치우고 그 계정의 것을 읽는다.
// 화면은 파일 경로를 다루지 않는다 — 계정은 이름으로만 가리킨다.

import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { AccountRead, InterceptReport, OverlayLaunch, SharedSnapshot } from '../types';
import {
  errorMessage,
  loadInterceptResult,
  onSharedState,
  readAccount,
  saveInterceptResult,
  setAccountHidden as backendSetAccountHidden,
  setDefaultAccount as backendSetDefaultAccount,
  setOverlayLaunch as backendSetOverlayLaunch,
  sharedState,
} from './backend';
import { checkInterceptReport } from './reports';

export interface Shared {
  /** Rust가 알려 준 상태. 아직 모르면 null. */
  snapshot: Ref<SharedSnapshot | null>;
  /** 처음 읽기(상태와 마지막 결과)가 끝났는가. 그 전에는 「계정 없음」으로 단정하지 않는다. */
  ready: Ref<boolean>;
  /** 지금 계산에 쓰는 계정의 이름. 없으면 null. */
  accountName: ComputedRef<string | null>;
  /** 그 계정을 마지막으로 저장한 시각(ISO). 모르면 null. */
  accountSavedAt: ComputedRef<string | null>;
  /** 상태를 읽지 못했거나 설정을 바꾸지 못했을 때의 문장. */
  problem: Ref<string>;
  /** 마지막 요격전 추천 결과. 없으면 null. */
  intercept: Ref<InterceptReport | null>;
  /** 지금 보이는 결과가 앞서 저장해 둔 것인가(이번에 계산한 것이 아니다). */
  restored: Ref<boolean>;
  /** 결과를 읽거나 저장하다 난 문제(다른 종류·다른 판·저장 실패). 앞서 보이던 결과는 그대로다. */
  interceptProblem: Ref<string>;
  /** 상태를 다시 읽는다. */
  refresh(): Promise<void>;
  /** 지금 쓰는 계정을 읽는다. 없거나 읽지 못하면 한국어 문장으로 던진다. */
  loadAccount(): Promise<AccountRead>;
  /** 기본 계정을 정한다. 못 하면 `problem`에 이유가 남고 false. */
  setDefaultAccount(name: string): Promise<boolean>;
  /** 계정을 목록에서 숨기거나 다시 보이게 한다(지우지 않는다). 못 하면 `problem`에 이유가 남고 false. */
  setAccountHidden(name: string, hidden: boolean): Promise<boolean>;
  /** 오버레이를 언제 띄울지 정한다. */
  setOverlayLaunch(mode: OverlayLaunch): Promise<boolean>;
  /**
   * 새 요격전 추천 결과를 보이고 저장한다(오버레이 창이 새 결과를 받는다).
   * 요격전 추천 결과가 아니면(다른 종류·다른 판) 한국어 문장으로 던지고 앞서 보이던 것을 그대로 둔다.
   * `account`는 계산에 쓴 계정의 이름이다 — 결과는 그 계정의 것으로 저장된다. 계산하는 동안 지금 쓰는 계정이 바뀌었으면
   * 화면에는 올리지 않는다(다른 계정의 결과를 이 계정의 것처럼 보이지 않는다). 주지 않으면 지금 쓰는 계정이다.
   */
  publishIntercept(report: unknown, account?: string | null): Promise<void>;
}

const KEY: InjectionKey<Shared> = Symbol('shared');

export function createShared(): { shared: Shared; start: () => Promise<void>; dispose: () => void } {
  const snapshot = ref<SharedSnapshot | null>(null);
  const ready = ref(false);
  const problem = ref('');
  const intercept = ref<InterceptReport | null>(null);
  const restored = ref(false);
  const interceptProblem = ref('');

  /** 지금 보이는 결과가 저장된 시각. 알림이 같은 시각이면 다시 읽지 않는다. */
  let shownSavedAt: string | null = null;
  /** 지금 보이는 결과가 어느 계정의 것인가. 처음 읽기 전에는 undefined다. */
  let shownAccount: string | null | undefined;
  let unlisten: (() => void) | null = null;
  let disposed = false;
  /** 늦게 끝난 읽기가 더 나중의 결과를 덮지 않게 한다. */
  let readSeq = 0;

  const accountName = computed(() => snapshot.value?.default_account ?? null);
  const accountSavedAt = computed(() => {
    const name = accountName.value;
    return snapshot.value?.accounts.find((a) => a.name === name)?.modified_at ?? null;
  });

  /** 저장해 둔 결과를 읽어 보인다. 읽을 수 없으면 알리고 앞서 보이던 것을 둔다. */
  async function readIntercept(savedAt: string | null): Promise<void> {
    const mine = ++readSeq;
    try {
      const doc = await loadInterceptResult();
      if (mine !== readSeq) return;
      if (doc === null || doc === undefined) {
        shownSavedAt = savedAt;
        return;
      }
      intercept.value = checkInterceptReport(doc);
      restored.value = true;
      interceptProblem.value = '';
      shownSavedAt = savedAt;
    } catch (e) {
      if (mine !== readSeq) return;
      shownSavedAt = savedAt;
      interceptProblem.value = `앞서 저장한 요격전 추천을 읽지 못했다: ${errorMessage(e)}`;
    }
  }

  /** 이 창이 결과를 저장하는 중인가. 그동안 오는 알림은 이 창의 저장이 낸 것이다 — 방금 보인 결과를 다시 읽지 않는다. */
  let saving = 0;

  /**
   * 상태 하나를 반영한다. 지금 쓰는 계정이 바뀌었으면 앞 계정의 결과를 치우고 그 계정의 것을 읽는다(결과는 계정마다 따로다).
   * 계정이 그대로인데 다른 창이 새 결과를 저장했으면 다시 읽는다.
   */
  function accept(next: SharedSnapshot | null | undefined): void {
    if (!next) return;
    snapshot.value = next;
    const account = next.default_account ?? null;
    if (shownAccount !== undefined && account !== shownAccount) {
      shownAccount = account;
      readSeq += 1; // 앞 계정의 결과를 읽던 것이 늦게 끝나도 올리지 않는다.
      intercept.value = null;
      restored.value = false;
      interceptProblem.value = '';
      void readIntercept(next.intercept_saved_at ?? null);
      return;
    }
    if (saving === 0 && next.intercept_saved_at && next.intercept_saved_at !== shownSavedAt) void readIntercept(next.intercept_saved_at);
  }

  async function refresh(): Promise<void> {
    try {
      const next = await sharedState();
      problem.value = next.problems.join(' ');
      // 처음 읽기(켜질 때)에서는 상태만 둔다 — 결과는 그 뒤에 한 번 읽는다. 그 뒤로는 계정이 바뀌었는지도 본다.
      if (shownAccount === undefined) snapshot.value = next;
      else accept(next);
    } catch (e) {
      problem.value = `계정 상태를 확인하지 못했다: ${errorMessage(e)}`;
    }
  }

  async function change(what: string, request: () => Promise<SharedSnapshot>): Promise<boolean> {
    try {
      accept(await request());
      problem.value = '';
      return true;
    } catch (e) {
      problem.value = `${what} 못했다: ${errorMessage(e)}`;
      return false;
    }
  }

  async function publishIntercept(report: unknown, account: string | null = null): Promise<void> {
    // 맞지 않는 문서는 보이지도 저장하지도 않는다 — 던진 문장을 화면이 보이고, 앞서 보이던 결과는 그대로다.
    const checked = checkInterceptReport(report);
    // 계산에 쓴 계정이 지금 쓰는 계정이 아니면(계산하는 동안 바뀌었다) 저장만 하고 화면에는 올리지 않는다.
    const mine = account === null || account === accountName.value;
    if (!mine) {
      try {
        accept(await saveInterceptResult(checked, account));
        interceptProblem.value = `계산하는 동안 계정이 바뀌었다 — 방금 끝난 추천은 ${account} 계정의 것으로 저장했다(그 계정으로 바꾸면 보인다).`;
      } catch (e) {
        interceptProblem.value = `방금 끝난 추천(${account} 계정)을 저장하지 못했다: ${errorMessage(e)}`;
      }
      return;
    }
    readSeq += 1; // 늦게 끝나는 읽기가 새 결과를 덮지 않게 한다.
    intercept.value = checked;
    restored.value = false;
    interceptProblem.value = '';
    saving += 1;
    try {
      const next = await saveInterceptResult(checked, account);
      shownSavedAt = next.intercept_saved_at;
      accept(next);
    } catch (e) {
      // 화면에는 새 결과가 보인다. 저장만 못 했다 — 앱을 다시 켜면 보이지 않고 오버레이에도 가지 않는다.
      interceptProblem.value = `이 결과를 저장하지 못했다(앱을 다시 켜면 보이지 않는다): ${errorMessage(e)}`;
    } finally {
      saving -= 1;
    }
  }

  const shared: Shared = {
    snapshot,
    ready,
    accountName,
    accountSavedAt,
    problem,
    intercept,
    restored,
    interceptProblem,
    refresh,
    loadAccount: () => readAccount(null),
    setDefaultAccount: (name) => change('기본 계정을 정하지', () => backendSetDefaultAccount(name)),
    setAccountHidden: (name, hidden) =>
      change(hidden ? '계정을 목록에서 숨기지' : '계정을 다시 보이게 하지', () => backendSetAccountHidden(name, hidden)),
    setOverlayLaunch: (mode) => change('오버레이 설정을 바꾸지', () => backendSetOverlayLaunch(mode)),
    publishIntercept,
  };

  return {
    shared,
    start: async () => {
      try {
        const stop = await onSharedState(accept);
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        // 알림을 듣지 못해도 물어서 읽은 상태는 보인다.
      }
      await refresh();
      // 여기서부터 계정이 바뀌는 것을 본다(처음 읽기는 아래에서 한 번 한다).
      shownAccount = snapshot.value?.default_account ?? null;
      await readIntercept(snapshot.value?.intercept_saved_at ?? null);
      ready.value = true;
    },
    dispose: () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    },
  };
}

/** 창의 뿌리(App.vue·Overlay.vue)가 부른다: 상태를 만들어 화면들에 내려 주고, 켜질 때 디스크의 것을 읽는다. */
export function provideShared(): Shared {
  const { shared, start, dispose } = createShared();
  provide(KEY, shared);
  onMounted(start);
  onBeforeUnmount(dispose);
  return shared;
}

/** 화면들이 부른다. 뿌리 밖에서(화면만 따로 띄운 테스트 등) 쓰이면 null. */
export function useShared(): Shared | null {
  return inject(KEY, null);
}
