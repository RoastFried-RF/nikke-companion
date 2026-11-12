// 게임 이미지(초상화·보스·아이콘)를 화면이 그릴 수 있는 주소로 바꾸고 기억해 둔다.
// 이미지는 Rust가 이 PC의 파일에서 읽어 넘긴다(lib/backend.ts) — 여기서는 네트워크를 쓰지 않는다.
// 돌려주는 주소는 `data:` 주소다(CSP의 img-src가 허용하는 것). 없는 이미지는 null — 부품이 대체 그림을 그린다.

import { bossImage, gameIcon, nikkePortrait } from './backend';
import type { GameImage, IconKind } from '../types';

/** 화면에 그릴 수 있는 형식. Rust가 첫 바이트로 확인해 이 둘만 넘긴다 — 여기서도 한 번 더 본다. */
const IMAGE_TYPES = ['image/webp', 'image/png'];

/** Rust가 넘긴 이미지 → `data:` 주소. 없거나 그릴 수 없는 형식이면 null. */
export function toDataUrl(image: GameImage | null | undefined): string | null {
  if (!image || image.found !== true || typeof image.mime !== 'string' || typeof image.data !== 'string') return null;
  if (!IMAGE_TYPES.includes(image.mime) || image.data === '') return null;
  return `data:${image.mime};base64,${image.data}`;
}

/** 한 번 받은 것은 다시 묻지 않는다(「없음」도 기억한다). 묻다가 실패한 것(명령을 부를 수 없다 등)은 기억하지 않는다. */
const cache = new Map<string, Promise<string | null>>();

function remembered(key: string, load: () => Promise<GameImage>): Promise<string | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  let pending: Promise<string | null>;
  try {
    pending = load().then(toDataUrl, () => {
      cache.delete(key);
      return null;
    });
  } catch {
    // 명령을 부르는 것 자체가 실패했다(Tauri 밖의 브라우저 등) — 없는 것으로 그린다.
    return Promise.resolve(null);
  }
  cache.set(key, pending);
  return pending;
}

/** 니케 초상화의 주소. 그림이 없거나 엔진 카탈로그에 없는 이름이면 null. */
export function portraitUrl(name: string): Promise<string | null> {
  return remembered(`portrait\u0000${name}`, () => nikkePortrait(name));
}

/** 보스 이미지의 주소. 없으면 null(부품이 속성 색으로 대신한다). */
export function bossImageUrl(id: string): Promise<string | null> {
  return remembered(`boss\u0000${id}`, () => bossImage(id));
}

/** 아이콘의 주소. 없으면 null(부품이 직접 그린 아이콘을 쓴다). */
export function iconUrl(kind: IconKind, key: string): Promise<string | null> {
  return remembered(`icon\u0000${kind}\u0000${key}`, () => gameIcon(kind, key));
}

/** 기억해 둔 것을 버린다(리소스를 새로 받은 뒤, 테스트 사이). */
export function clearImageCache(): void {
  cache.clear();
}
