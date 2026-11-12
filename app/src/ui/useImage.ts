// 부품이 이미지를 얻는 한 가지 길: 주소를 직접 받았으면 그것을, 아니면 스스로 불러온다(lib/images.ts).
// 불러오는 동안과 없을 때는 null — 부품이 대체 그림을 그린다.

import { ref, watch, type Ref } from 'vue';

/**
 * @param given 부품이 받은 주소. `undefined`면 스스로 불러오고, `null`이면 「없음」으로 그린다(불러오지 않는다).
 * @param key 무엇을 불러올지 가리키는 열쇠(이름·id·종류와 값). 불러올 것이 없으면 null. 이것이 바뀌면 다시 불러온다.
 * @param load 스스로 불러오는 함수. 주소를 직접 받았거나 열쇠가 없으면 부르지 않는다.
 */
export function useImage(given: () => string | null | undefined, key: () => string | null, load: () => Promise<string | null>): Ref<string | null> {
  const url = ref<string | null>(null);
  let turn = 0;
  watch(
    [given, key],
    ([explicit, wanted]) => {
      const mine = ++turn;
      if (explicit !== undefined) {
        url.value = explicit;
        return;
      }
      url.value = null;
      if (wanted === null) return;
      load().then(
        (found) => {
          // 그 사이에 다른 것을 그리게 됐으면 버린다.
          if (mine === turn) url.value = found;
        },
        () => {
          if (mine === turn) url.value = null;
        },
      );
    },
    { immediate: true },
  );
  return url;
}
