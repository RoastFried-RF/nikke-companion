// 부품 모아 보기의 보기 값. 수치는 전부 지어낸 것이다(계산 결과가 아니다) — 부품의 모양과 상태를 보는 데만 쓴다.
// 니케 이름과 보스 id는 실제 것이다: 이 PC에 초상화·보스 이미지가 있으면 그 그림이 뜬다.

/** 보스 5종(내장 보스 묶음의 id·이름·속성·약점 — 게임 화면에서 확인한 값, docs/intercept.md). */
export const SAMPLE_BOSSES = [
  { id: 'indivilia', name: '인디빌리아', element: '풍압', weakTo: '작열', totalDamage: 4_651_472_758 },
  { id: 'ultra', name: '울트라', element: '전격', weakTo: '철갑', totalDamage: 3_912_004_113 },
  { id: 'harvester', name: '하베스터', element: '작열', weakTo: '수냉', totalDamage: 5_204_880_021 },
  { id: 'kraken', name: '크라켄', element: '철갑', weakTo: '풍압', totalDamage: 1_061_233_907 },
  { id: 'mirror_container', name: '미러 컨테이너', element: '수냉', weakTo: '전격', totalDamage: null },
] as const;

/** 추천 1위 편성의 보기(지어낸 비중). */
export const SAMPLE_SQUAD = [
  { name: '라피 : 레드 후드', share: 0.46 },
  { name: '크라운', share: 0.21 },
  { name: '리틀 머메이드', share: 0.17 },
  { name: '헬름', share: 0.11 },
  { name: '앨리스', share: 0.05 },
] as const;

/** 이름이 긴 니케(말줄임 확인). */
export const SAMPLE_LONG_NAMES = ['스노우 화이트 : 이노센트 데이즈', '프리바티 : 언카인드 메이드', '맥스웰 : 오디너리 미케닉'] as const;

/** 엔진 카탈로그에 없는 이름 — 초상화가 없어 첫 글자로 그려지고 정보는 「모름」이다. */
export const SAMPLE_UNKNOWN_NAME = '이름만 있는 니케';

/** 2·3위 줄의 보기. */
export const SAMPLE_RUNNERS_UP = [
  { rank: 2, members: ['라피 : 레드 후드', '크라운', '리틀 머메이드', '프리카', '앨리스'], totalDamage: 4_480_112_003, relative: 0.963 },
  { rank: 3, members: ['앨리스', '크라운', '헬름', '리틀 머메이드', '프리카'], totalDamage: 4_102_598_432, relative: 0.882 },
] as const;

/**
 * 한 줄 요약의 보기에 넘기는 보스 항목(요격전 추천 결과의 보스 항목에서 요약이 읽는 칸만).
 * 약점 속성 니케가 누구인지는 지어내지 않는다 — 엔진 카탈로그를 읽었을 때만 `weak_pool`을 채운다(UiGallery.vue).
 */
export function sampleBossItem(weakOwned: string[] | null) {
  return {
    id: 'indivilia',
    name: '인디빌리아',
    status: 'computed',
    element: { code: '풍압', weak_to: '작열', reflected: true },
    weak_pool: weakOwned ? { element: '작열', owned: weakOwned } : null,
    ranking: [
      {
        rank: 1,
        name: '추천 1',
        total_damage: 4_651_472_758,
        members: SAMPLE_SQUAD.map((m) => ({ name: m.name, share: m.share, damage: Math.round(m.share * 4_651_472_758) })),
        placement: { changed: true, gain_ratio: 1.08 },
      },
    ],
  };
}
