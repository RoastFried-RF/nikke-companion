// 요격전 추천 계산의 진행을 두 창이 함께 본다(P-028).
//
// 계산은 데스크톱 앱 창에서만 돈다. 오버레이는 그 진행을 작게 보여 줄 뿐이다 — 시작하지도 멈추지도 못한다.
//   - 앱 창: 요격전 화면이 `announceWhile`로 진행(무엇을 하는 중인지·끝난 건수·전체·흐른 시간)을 Rust에 알린다.
//   - 오버레이 창: `useActivity`가 Rust가 전해 주는 것을 듣는다(켜질 때 한 번 묻는다).
// 알리지 못해도 계산에는 지장이 없다(오버레이에 진행이 안 보일 뿐이다).

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import type { ComputeActivity } from '../types';
import { announceActivity, computeActivity, onComputeActivity } from './backend';

/** 계산이 돌고 있지 않다. */
export const IDLE: ComputeActivity = Object.freeze({ running: false, label: '', done: 0, total: 0, elapsed_ms: 0 });

/** 진행을 Rust에 알린다. 못 알려도(앱 밖·명령 실패) 조용히 넘어간다 — 계산을 막지 않는다. */
function announce(activity: ComputeActivity): void {
  try {
    void announceActivity(activity).catch(() => {});
  } catch {
    // 앱 밖(브라우저의 개발 서버 등)에서는 알릴 곳이 없다.
  }
}

/**
 * 계산이 도는 동안 진행을 알린다(앱 창의 요격전 화면이 부른다). `source`가 주는 값이 바뀔 때마다 알리고,
 * 화면이 내려가면 「끝났다」고 알린다. 계산을 시작하지 않는다 — 있는 진행을 전할 뿐이다.
 */
export function announceWhile(source: () => ComputeActivity): void {
  let last = '';
  const send = (activity: ComputeActivity): void => {
    const next = activity.running ? activity : IDLE;
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    announce(next);
  };
  watch(source, send, { immediate: true });
  onBeforeUnmount(() => send(IDLE));
}

/** 앱 창이 알린 진행을 듣는다(오버레이 창). 아직 모르면 「돌고 있지 않다」로 그린다. */
export function useActivity(): Ref<ComputeActivity> {
  const activity = ref<ComputeActivity>(IDLE);
  let unlisten: (() => void) | null = null;
  let unmounted = false;

  onMounted(async () => {
    try {
      const stop = await onComputeActivity((next) => {
        activity.value = next;
      });
      if (unmounted) stop();
      else unlisten = stop;
      activity.value = await computeActivity();
    } catch {
      // 진행을 모르면 그리지 않는다.
    }
  });
  onBeforeUnmount(() => {
    unmounted = true;
    unlisten?.();
    unlisten = null;
  });
  return activity;
}
