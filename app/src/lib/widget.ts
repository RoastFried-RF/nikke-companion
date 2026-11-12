// 오버레이 위젯의 상태 — 화면 쪽(P-028).
//
// 모양(접힘·한 줄 카드·펼침)·핀·쉬는 중·설정은 Rust가 쥐고 있다(src-tauri/src/overlay_widget.rs의 규칙, lib.rs의 접착 코드).
// 단축키(Alt+Shift+M)·자동 표시(이상 개체 화면을 떠나면 접거나 쉰다)·앱 창의 설정이 바꾸면 `overlay-widget` 이벤트가 온다.
// 여기에는 그것을 듣고 화면에 내려 주는 상태와, 화면이 시키는 일(오버레이 창: 모양·핀·숨기기 / 앱 창: 설정·자리 초기화)이 있다.
// 언제 접고 언제 쉬는지는 화면이 판단하지 않는다 — Rust의 순수 규칙(`AutoShow`)이 정한다.

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { OverlayLeave, OverlayPrefs, OverlayShape, WidgetSnapshot } from '../types';
import {
  errorMessage,
  onOverlayWidget,
  overlayHide,
  overlayPin,
  overlayShape,
  overlayWidget,
  resetOverlayPosition,
  setOverlayPrefs,
} from './backend';

/** 모양 셋(설정 화면의 고르기와 안내에 쓴다). */
export const SHAPES: { key: OverlayShape; label: string; hint: string }[] = [
  { key: 'collapsed', label: '접힘', hint: '보스 이미지·이름·총딜만' },
  { key: 'card', label: '한 줄 카드', hint: '보스와 니케 다섯' },
  { key: 'expanded', label: '펼침', hint: '한 줄 요약·2·3위·자리 순서까지' },
];

/** 이상 개체 화면을 떠났을 때 하는 일(설정 화면의 고르기). */
export const LEAVES: { key: OverlayLeave; label: string; hint: string }[] = [
  { key: 'stay', label: '그대로 두기', hint: '바꾸지 않는다' },
  { key: 'collapse', label: '접기', hint: '알약 모양으로 줄인다' },
  { key: 'hide', label: '숨기기', hint: '돌아오면 다시 뜬다' },
];

/** 설정의 범위와 기본값. Rust(overlay_widget.rs)의 상수와 같다 — 범위는 Rust가 다시 확인한다. */
export const SCALE_RANGE = { min: 80, max: 150, step: 5, fallback: 100 } as const;
export const OPACITY_RANGE = { min: 40, max: 100, step: 5, fallback: 100 } as const;
export const LEAVE_AFTER_RANGE = { min: 2, max: 120, step: 1, fallback: 8 } as const;

/** Rust의 상태를 아직 모를 때 그리는 기본값(Rust의 기본값과 같다). */
export const DEFAULT_PREFS: OverlayPrefs = Object.freeze({
  scale_percent: SCALE_RANGE.fallback,
  opacity_percent: OPACITY_RANGE.fallback,
  leave: 'collapse',
  leave_after_sec: LEAVE_AFTER_RANGE.fallback,
  default_shape: 'card',
  click_through: false,
});

/** 오버레이에 작게 안내하는 단축키(Rust의 SHORTCUTS와 같다). */
export const WIDGET_SHORTCUTS = [
  { keys: 'Alt+Shift+O', what: '숨기기 / 보이기' },
  { keys: 'Alt+Shift+C', what: '클릭 통과' },
  { keys: 'Alt+Shift+M', what: '모양 바꾸기' },
] as const;

/** 다음 모양: 접힘 → 한 줄 카드 → 펼침 → 접힘(Rust의 `Shape::next`와 같다 — 화면은 안내 문구에만 쓴다). */
export function nextShape(shape: OverlayShape): OverlayShape {
  return shape === 'collapsed' ? 'card' : shape === 'card' ? 'expanded' : 'collapsed';
}

/** 화면이 준 수를 범위 안의 정수로. 수가 아니면 기본값. */
export function clampSetting(value: unknown, range: { min: number; max: number; fallback: number }): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

/**
 * 화면이 잰 위젯의 크기를 Rust에 알릴 값으로(논리 픽셀, 소수는 올린다). 잴 수 없었으면(0·수가 아님 — 아직 그려지지
 * 않았다) null — 그때는 창을 건드리지 않는다. 범위는 Rust가 다시 확인한다.
 */
export function fitRequest(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

export interface Widget {
  /** Rust가 알려 준 상태. 아직 모르면 null. */
  snapshot: Ref<WidgetSnapshot | null>;
  /** 상태를 읽지 못했거나 시킨 일을 하지 못했을 때의 문장. */
  problem: Ref<string>;
  /** 모양을 바꾼다('next'면 다음 모양). */
  setShape(shape: OverlayShape | 'next'): Promise<void>;
  setPinned(pinned: boolean): Promise<void>;
  /** 오버레이를 숨긴다(앱은 끝나지 않는다). */
  hide(): Promise<void>;
  /** 설정을 바꾼다(앱 창). 바꿀 칸만 넘긴다. */
  setPrefs(patch: Partial<OverlayPrefs>): Promise<boolean>;
  /** 끌어 둔 자리를 잊고 기본 자리로 되돌린다(앱 창). */
  resetPosition(): Promise<boolean>;
}

/** 위젯 상태를 화면이 사는 동안 듣는다. 오버레이 창과 앱 창의 설정 화면이 함께 쓴다(부르는 명령은 저마다 다르다). */
export function useWidget(): Widget {
  const snapshot = ref<WidgetSnapshot | null>(null);
  const problem = ref('');
  let unlisten: (() => void) | null = null;
  let unmounted = false;

  async function ask(what: string, request: () => Promise<WidgetSnapshot>): Promise<boolean> {
    try {
      snapshot.value = await request();
      problem.value = '';
      return true;
    } catch (e) {
      problem.value = `${what} 못했다: ${errorMessage(e)}`;
      return false;
    }
  }

  onMounted(async () => {
    try {
      const stop = await onOverlayWidget((next) => {
        snapshot.value = next;
      });
      if (unmounted) stop();
      else unlisten = stop;
    } catch {
      // 알림을 듣지 못해도 물어서 읽은 상태는 보인다.
    }
    await ask('오버레이의 모양을 확인하지', overlayWidget);
  });
  onBeforeUnmount(() => {
    unmounted = true;
    unlisten?.();
    unlisten = null;
  });

  return {
    snapshot,
    problem,
    setShape: async (shape) => void (await ask('오버레이의 모양을 바꾸지', () => overlayShape(shape))),
    setPinned: async (pinned) => void (await ask(pinned ? '오버레이를 고정하지' : '오버레이의 고정을 풀지', () => overlayPin(pinned))),
    hide: async () => {
      try {
        await overlayHide();
        problem.value = '';
      } catch (e) {
        problem.value = `오버레이를 숨기지 못했다: ${errorMessage(e)}`;
      }
    },
    setPrefs: (patch) => ask('오버레이 설정을 바꾸지', () => setOverlayPrefs(patch)),
    resetPosition: () => ask('오버레이의 자리를 되돌리지', resetOverlayPosition),
  };
}
