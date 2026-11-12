// 화면이 니케 정보(속성·버스트 단계)를 얻는 길: 엔진 카탈로그를 한 번 읽어 두고(lib/nikkeInfo.ts) 이름으로 찾는다.
// 카탈로그를 읽지 못했거나 아직 읽는 중이면 모든 값이 null(「모름」)이다 — 값을 지어내지 않는다.

import { onMounted, shallowRef } from 'vue';
import type { EngineCatalog, NikkeInfo } from '../types';
import { loadNikkeCatalog, nikkeInfoFrom } from './nikkeInfo';

export function useNikkeCatalog() {
  const catalog = shallowRef<EngineCatalog | null>(null);
  onMounted(() => {
    loadNikkeCatalog().then(
      (loaded) => {
        catalog.value = loaded;
      },
      () => {
        // 읽지 못하면 「모름」으로 그린다.
      },
    );
  });
  const info = (name: string): NikkeInfo => nikkeInfoFrom(catalog.value, name);
  return { catalog, info };
}
