// 엔진 계산 한 번의 실행 상태: 진행 건수·단계·경과 시간, 중단, 오류와 중단의 구분.
// 추천·비교(ComputePanel), 요격전, 성장 비교가 모두 이 하나를 쓴다 — 진행 표시(RunStatus)와 단추(RunButtons)도 같다.
// 계산 자체는 lib/compute.ts의 함수가 하고(루트 src/core), 여기서는 그 함수에 넘길 deps를 감싸 진행을 듣는다.

import { computed, inject, onBeforeUnmount, provide, reactive, ref, type InjectionKey, type Ref } from 'vue';
import type { BossProgress, EngineProgress, SearchStage } from '../types';
import { engineCancel, errorMessage, onEngineProgress } from './backend';
import { defaultDeps, type ComputeDeps } from './compute';

/** 중단을 눌렀는데 엔진 배치가 아직 시작 전이면 다시 청하는 간격(밀리초). */
const STOP_RETRY_MS = 100;

/** 중단으로 끝낼 때 계산 코드에 던지는 값. 화면에는 보이지 않는다(중단은 `stopping`으로 가린다). */
const STOPPED = '중단됨';

/**
 * 지금 계산을 돌리는 화면의 이름(없으면 null). 엔진 배치 자리는 하나라서(Rust의 BatchSlot) 한 번에 한 화면만 계산한다.
 * 앱(App.vue)이 하나 만들어 내려 주고, 탭에 "계산 중" 표시를 하는 데도 쓴다.
 */
const ENGINE_OWNER: InjectionKey<Ref<string | null>> = Symbol('engine-owner');

export function provideEngineOwner(): Ref<string | null> {
  const owner = ref<string | null>(null);
  provide(ENGINE_OWNER, owner);
  return owner;
}

export interface RunHandlers<T> {
  /** 계산을 시작했다(입력을 읽기 전). */
  start?: () => void;
  done: (result: T) => void;
  /** 화면에 그대로 보일 수 있는 한국어 문장. */
  fail: (message: string) => void;
  /** 사용자가 중단했다. 결과도 오류도 아니다 — 화면은 계산 전 그대로다. */
  cancel?: () => void;
}

/**
 * @param name 이 계산을 돌리는 화면의 이름(탭 이름). 다른 화면이 계산 중이면 `busyElsewhere`가 true이고 `run`은 아무것도 하지 않는다.
 */
export function useEngineRun(name: string) {
  const owner = inject(ENGINE_OWNER, () => ref<string | null>(null), true);

  const computing = ref(false);
  /** 사용자가 중단을 눌렀다. 이 실행은 어떻게 끝나든 '중단됨'이다. */
  const stopping = ref(false);
  /** 마지막 실행이 중단으로 끝났다. 다음 실행을 시작하면 지운다. */
  const stopped = ref(false);
  /** 엔진에 넘긴 요청 수와 끝난 수. 엔진을 부르기 전에는 null. */
  const progress = ref<EngineProgress | null>(null);
  /** 추천이 지금 어느 단계인지와 쓴 예산(계산 코드가 단계마다 알려 준다). 단계가 없는 계산에서는 null. */
  const stage = ref<SearchStage | null>(null);
  /** 요격전 추천이 지금 어느 보스를 계산하는지. 그 밖의 계산에서는 null. */
  const boss = ref<BossProgress | null>(null);
  const elapsed = ref(0);
  /** 다른 화면이 계산을 돌리고 있다. */
  const busyElsewhere = computed(() => owner.value !== null && owner.value !== name);

  /** Rust에 맡긴 엔진 배치가 아직 돌아오지 않았다(멈출 것이 있다). */
  let engineBusy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function stopTimer(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  /**
   * 도는 계산을 멈춘다. Rust가 엔진 프로세스를 모두 끝내고 배치 호출이 '중단됨' 오류로 돌아오면 `run`이 마무리한다.
   * 엔진 배치 사이(파일 읽기·캐시 확인 중)에 눌렀으면 멈출 프로세스가 없다 — 다음 배치를 엔진에 보내지 않고 끝낸다.
   */
  async function stop(): Promise<void> {
    if (!computing.value || stopping.value) return;
    stopping.value = true;
    // 배치 호출이 Rust에 닿기 직전에 눌렀으면 Rust는 "도는 배치 없음"으로 답한다. 그 배치가 돌아올 때까지 다시 청한다.
    while (computing.value && engineBusy) {
      try {
        if (await engineCancel()) return;
      } catch {
        // 중단 명령을 보내지 못했다. 계산은 끝까지 가지만 결과는 쓰지 않는다(이 실행은 중단으로 끝난다).
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, STOP_RETRY_MS));
    }
  }

  /**
   * 계산을 돌린다. `task`는 진행을 듣도록 감싼 deps를 받아 lib/compute.ts의 함수를 부른다.
   * 끝나면 `done`·`fail`·`cancel` 가운데 하나만 불린다. 이미 계산 중이면(이 화면이든 다른 화면이든) 아무것도 하지 않는다.
   */
  async function run<T>(task: (deps: ComputeDeps) => Promise<T>, on: RunHandlers<T>): Promise<void> {
    if (computing.value || owner.value !== null) return;
    owner.value = name;
    computing.value = true;
    stopping.value = false;
    stopped.value = false;
    progress.value = null;
    stage.value = null;
    boss.value = null;
    elapsed.value = 0;
    on.start?.();

    const startedAt = Date.now();
    timer = setInterval(() => {
      elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
    }, 1000);

    let unlisten: (() => void) | null = null;
    try {
      try {
        unlisten = await onEngineProgress((p) => {
          // 여러 프로세스가 따로 알려 오므로 순서가 뒤바뀔 수 있다. 줄어들지 않게 한다.
          if (progress.value) progress.value = { total: p.total, done: Math.max(progress.value.done, p.done) };
        });
      } catch {
        // 진행 건수를 받지 못해도 계산은 한다. 경과 시간만 보인다.
        unlisten = null;
      }
      const deps: ComputeDeps = {
        ...defaultDeps,
        runtime: {
          ...defaultDeps.runtime,
          runBatch: async (requests, options) => {
            // 중단을 누른 뒤에는 엔진을 띄우지 않는다.
            if (stopping.value) throw STOPPED;
            progress.value = { done: 0, total: requests.length };
            engineBusy = true;
            try {
              return await defaultDeps.runtime.runBatch(requests, options);
            } finally {
              engineBusy = false;
            }
          },
        },
        // 단계가 바뀌면 앞 단계의 건수를 지운다. 이 단계의 요청이 모두 캐시에 있으면 엔진을 부르지 않는다.
        onStage: (s) => {
          stage.value = s;
          progress.value = null;
        },
        // 보스가 바뀌면 앞 보스의 단계와 건수를 지운다.
        onBoss: (b) => {
          boss.value = b;
          stage.value = null;
          progress.value = null;
        },
      };
      const result = await task(deps);
      // 중단을 눌렀으면 마침 끝난 계산도 결과로 쓰지 않는다 — 누른 뒤의 화면은 언제나 '중단됨'이다.
      if (stopping.value) {
        stopped.value = true;
        on.cancel?.();
        return;
      }
      on.done(result);
    } catch (e) {
      // 중단으로 엔진이 낸 오류('중단됨', 죽은 프로세스의 오류)는 오류로 보이지 않는다.
      if (stopping.value) {
        stopped.value = true;
        on.cancel?.();
      } else {
        on.fail(errorMessage(e));
      }
    } finally {
      unlisten?.();
      stopTimer();
      computing.value = false;
      stopping.value = false;
      progress.value = null;
      stage.value = null;
      boss.value = null;
      if (owner.value === name) owner.value = null;
    }
  }

  onBeforeUnmount(stopTimer);

  return reactive({ computing, stopping, stopped, progress, stage, boss, elapsed, busyElsewhere, run, stop });
}

export type EngineRun = ReturnType<typeof useEngineRun>;
