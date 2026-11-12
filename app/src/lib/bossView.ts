// 요격전 추천 결과의 보스 하나에서 위젯이 그릴 값을 꺼낸다(P-028 — 오버레이 위젯).
// 수치를 고치거나 다시 계산하지 않는다 — 결과 문서의 값을 읽을 뿐이다. 한 줄 요약은 루트의 순수 함수(src/core/summary.mjs)가 만든다.

import { summarizeInterceptBoss } from '@core/summary.mjs';
import type { InterceptBoss, NikkeInfo, RankingEntry } from '../types';

/** 1위 편성. 없으면 null. */
export function bestOf(boss: InterceptBoss | null | undefined): RankingEntry | null {
  const ranking = boss?.ranking ?? [];
  return ranking.find((e) => e.rank === 1) ?? ranking[0] ?? null;
}

/** 1위 편성의 총딜. 계산하지 않은 보스면 null(「계산 전」 — 0으로 적지 않는다). */
export function bestTotal(boss: InterceptBoss | null | undefined): number | null {
  if (!boss || boss.status !== 'computed') return null;
  return bestOf(boss)?.total_damage ?? null;
}

/** 계산에 쓰인 미확인 칸(기본값으로 계산한 칸). 약점은 계산 입력이 아니라서 뺀다 — 앱 창의 요격전 화면·CLI 표와 같다. */
export function unconfirmedOf(boss: InterceptBoss | null | undefined) {
  return (boss?.unconfirmed ?? []).filter((u) => u.field !== 'weak_to');
}

/** 이 보스의 약점 속성인 니케(편성 멤버 가운데). 결과의 약점 속성 보유 목록을 쓰고, 없으면 니케 정보의 속성으로 본다. */
export function weakNamesOf(boss: InterceptBoss | null | undefined, info: (name: string) => NikkeInfo): string[] {
  const weak = boss?.element?.weak_to;
  if (!boss || !weak) return [];
  if (boss.weak_pool && boss.weak_pool.element === weak) return boss.weak_pool.owned ?? [];
  const members = new Set((boss.ranking ?? []).flatMap((e) => (e.members ?? []).map((m) => m.name)));
  return [...members].filter((name) => info(name).element === weak);
}

/**
 * 한 줄 요약. 결과에 약점 속성 보유 목록이 없으면 니케 정보의 속성으로 판단한다 — 니케 정보도 모르면(`known`이 false)
 * 속성 이야기를 하지 않는다.
 */
export function summaryOf(boss: InterceptBoss | null | undefined, known: boolean, info: (name: string) => NikkeInfo): string {
  if (!boss) return '';
  const options = boss.weak_pool || !known ? {} : { elementOf: (name: string) => info(name).element };
  return summarizeInterceptBoss(boss, options).text;
}
