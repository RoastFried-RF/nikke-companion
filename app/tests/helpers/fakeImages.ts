// 테스트용 가짜 이미지와 가짜 이미지 명령. 게임 이미지를 쓰지 않는다 — 바이트는 코드로 만든 것이다(머리 바이트만 WebP·PNG 꼴).
import { mockIPC } from '@tauri-apps/api/mocks';
import type { GameImage, GameImageSource } from '../../src/types';
import { catalog } from './fakeEngine';

/** 머리 바이트 + 꼬리표(UTF-8)를 base64로. */
function encode(head: number[], tag: string): string {
  const bytes = [...head, ...new TextEncoder().encode(tag)];
  return btoa(String.fromCharCode(...bytes));
}

const WEBP_HEAD = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0x10, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0)));
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 코드로 만든 가짜 WebP의 base64. `tag`로 서로 구분한다. */
export const fakeWebpData = (tag: string): string => encode(WEBP_HEAD, tag);
export const fakePngData = (tag: string): string => encode(PNG_HEAD, tag);

export function fakeImage(tag: string, source: GameImageSource = 'engine', mime: 'image/webp' | 'image/png' = 'image/webp'): GameImage {
  return { found: true, mime, data: mime === 'image/webp' ? fakeWebpData(tag) : fakePngData(tag), source };
}

export const MISSING: GameImage = { found: false, mime: null, data: null, source: null };

/** 화면이 그리게 되는 주소. */
export const urlOf = (image: GameImage): string => `data:${image.mime};base64,${image.data}`;

export interface ImageWorld {
  /** 초상화가 있는 니케 이름. */
  portraits?: string[];
  /** 이미지가 있는 보스 id → 어디서 읽었나. */
  bosses?: Record<string, GameImageSource>;
  /** 아이콘이 있는 것: '종류:값' → 어디서 읽었나. */
  icons?: Record<string, GameImageSource>;
  /** 엔진 카탈로그를 읽지 못하게 할지. */
  catalogFails?: boolean;
}

/**
 * 이미지 명령과 카탈로그 명령을 흉내 낸다(Rust의 nikke_portrait·boss_image·game_icon·engine_catalog).
 * 돌려주는 `calls`에 부른 명령과 인자가 순서대로 쌓인다.
 */
export function mockImages(world: ImageWorld = {}): { calls: { cmd: string; args: Record<string, unknown> }[] } {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args });
    if (cmd === 'nikke_portrait') {
      const name = String(args.name);
      return world.portraits?.includes(name) ? fakeImage(`portrait:${name}`) : MISSING;
    }
    if (cmd === 'boss_image') {
      const source = world.bosses?.[String(args.id)];
      return source ? fakeImage(`boss:${String(args.id)}`, source, source === 'capture' ? 'image/png' : 'image/webp') : MISSING;
    }
    if (cmd === 'game_icon') {
      const key = `${String(args.kind)}:${String(args.key)}`;
      const source = world.icons?.[key];
      return source ? fakeImage(`icon:${key}`, source) : MISSING;
    }
    if (cmd === 'engine_catalog') {
      if (world.catalogFails) throw '엔진 폴더(vendor/nikke-calc)를 찾을 수 없다';
      return catalog;
    }
    throw `테스트가 흉내 내지 않은 명령: ${cmd}`;
  });
  return { calls };
}
