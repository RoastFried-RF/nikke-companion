// 앱에 내장한 입력 — 데스크톱 앱의 화면은 파일 경로를 묻지 않는다(docs/ui-redesign.md §3 원칙 1).
// 다른 값으로 계산하려면 설정의 「고급」에서 직접 고른다.

// 이상 개체 요격전의 보스 5종. 게임 화면에서 확인한 값만 담은 묶음이다(CLI의 `intercept`가 기본으로 읽는 것과 같은 문서).
// 저장소 루트의 문서를 그대로 가져온다 — 복제하지 않는다.
import anomalyBundle from '../../../data/intercept/anomaly.json';

/** 요격전 화면이 계산에 쓰는 보스 묶음(docs/data-model.md §보스 묶음). */
export const ANOMALY_BUNDLE: { name: string; bosses: { id: string; name: string; weak_to?: string; enemy?: { code?: string } }[] } = anomalyBundle;

/**
 * 편성 도구의 추천이 쓰는 전투 조건: 계산 도구가 아는 보스 프리셋 하나(솔로 레이드 기준, 3분).
 * 저장소의 `data/samples/condition.solo-raid.json`과 같은 내용이다.
 */
export const DEFAULT_CONDITION = Object.freeze({
  schema_version: 1,
  content: 'solo_raid',
  boss: '솔로 레이드 S40',
  duration: 180,
});

/** 그 조건을 화면에 적을 때의 이름. */
export const DEFAULT_CONDITION_LABEL = '솔로 레이드 기준 · 3분';
