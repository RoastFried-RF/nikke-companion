// 티어 결과(`buildTier` — src/tier/evaluate.mjs)를 사람이 읽는 텍스트로 바꾼다. 형식은 docs/data-model.md §티어 결과.
import { formatDamage } from '../core/format.mjs';
import { cacheLines } from '../core/render.mjs';

const unit = (n) => formatDamage(Math.round(n));
// 한글은 터미널에서 두 칸을 차지한다(src/core/render.mjs와 같은 기준).
const width = (s) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 2 : 1), 0);
const padEndWide = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)));

export function renderTierReport(report) {
  const sc = report.scenario;
  const refs = report.references.squads;
  const out = [
    `자동 티어 — ${report.entries.length}명 (등급 ${report.summary.graded}명 · 평가 보류 ${report.summary.hold}명)`,
    `엔진: ${report.engine?.repo ?? '?'} @ ${report.engine?.commit?.slice(0, 8) ?? '버전 미확인'} · 데이터 ${report.engine_data?.version ?? '버전 미확인'}`,
    `시나리오: ${sc.boss} · ${sc.duration}초 · 육성 ${sc.growth === 'engine_default' ? '엔진 기본 스펙(프로필 없음)' : sc.growth}`,
    `기준 편성 ${report.references.version} (${refs.length}개 중 ${refs.filter((r) => r.status === 'used').length}개 사용) · 등급 규칙 ${report.rules.version}${report.rules.provisional ? ' [임시]' : ''}`,
    `시뮬: ${report.sims.used}건 / 예산 ${report.sims.budget}건 (기준 편성 ${report.sims.baselines}건 + 바꿔 넣기 ${report.sims.variants}건)`,
    ...cacheLines(report.cache),
    `계산 시각: ${report.generated_at}`,
    '',
  ];

  const graded = report.entries.filter((e) => e.tier !== null);
  if (graded.length === 0) out.push('등급을 매긴 니케가 없다.');
  const nameWidth = Math.max(4, ...graded.map((e) => width(e.name)));
  const tierWidth = Math.max(4, ...graded.map((e) => width(e.tier_label)));
  for (const e of graded) {
    const b = e.best;
    out.push(
      `${String(e.rank).padStart(3)}  ${padEndWide(e.tier_label, tierWidth)}  ${e.score.toFixed(3)}  ${padEndWide(e.name, nameWidth)}  ` +
        `[${e.status}] ${b.reference}의 ${b.replaced} 자리: ${unit(b.reference_total)} → ${unit(b.total_damage)}`,
    );
    for (const n of e.notes) out.push(`       ! ${n}`);
  }

  const holds = report.entries.filter((e) => e.tier === null);
  if (holds.length) {
    out.push('', '평가 보류 (등급 없음 — 0점이 아니다):');
    for (const e of holds) out.push(`  - ${e.name}: ${e.status_label} — ${e.hold.message}`);
  }
  out.push('', '주의:');
  for (const c of report.caveats) out.push(`  - ${c}`);
  return out.join('\n');
}
