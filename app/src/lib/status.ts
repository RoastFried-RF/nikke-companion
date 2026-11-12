// 홈·설정 화면이 보는 두 가지 상태: 오버레이 창(보임·클릭 통과)과 게임 창(찾음·없음).
// 둘 다 Rust가 알려 주는 것을 듣기만 한다 — 게임 창은 읽기만 한다.

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { GameSnapshot, OverlaySnapshot } from '../types';
import { errorMessage, gameWindowStatus, onGameWindow, onOverlayState, overlayStatus, setOverlayVisible } from './backend';

/** 구독 하나를 화면이 사는 동안만 건다. */
function useLive<T>(read: () => Promise<T>, listen: (handler: (value: T) => void) => Promise<() => void>, what: string) {
  const value = ref<T | null>(null) as Ref<T | null>;
  const problem = ref('');
  let unlisten: (() => void) | null = null;
  let unmounted = false;

  onMounted(async () => {
    try {
      const stop = await listen((next) => {
        value.value = next;
      });
      if (unmounted) stop();
      else unlisten = stop;
      value.value = await read();
    } catch (e) {
      problem.value = `${what} 확인하지 못했다: ${errorMessage(e)}`;
    }
  });
  onBeforeUnmount(() => {
    unmounted = true;
    unlisten?.();
    unlisten = null;
  });
  return { value, problem };
}

/** 오버레이 창의 상태와 보이기/숨기기. */
export function useOverlayState() {
  const { value: overlay, problem } = useLive<OverlaySnapshot>(overlayStatus, onOverlayState, '오버레이 상태를');

  /** 오버레이를 보이거나 숨긴다(활성화하지 않는다). */
  async function setVisible(visible: boolean): Promise<void> {
    try {
      overlay.value = await setOverlayVisible(visible);
      problem.value = '';
    } catch (e) {
      problem.value = `오버레이를 ${visible ? '띄우지' : '숨기지'} 못했다: ${errorMessage(e)}`;
    }
  }
  return { overlay, problem, setVisible };
}

/** 게임 창의 상태. */
export function useGameState() {
  const { value: game, problem } = useLive<GameSnapshot>(gameWindowStatus, onGameWindow, '게임 창 상태를');
  return { game, problem };
}
