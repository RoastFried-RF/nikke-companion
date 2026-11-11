// 비교 결과를 사람이 읽는 텍스트로 바꾼다. 오버레이 UI가 생기면 같은 결과 객체를 그쪽이 그린다.

import { formatDamage, groupThousands } from './format.mjs';

const num = (n) => groupThousands(Math.round(n));
const unit = (n) => formatDamage(Math.round(n));
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// 한글은 터미널에서 두 칸을 차지한다. 단위 글자(억·만·조) 때문에 열이 어긋나지 않게 폭으로 맞춘다.
const width = (s) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 2 : 1), 0);
const padStartWide = (s, w) => ' '.repeat(Math.max(0, w - width(s))) + s;

export function renderReport(report) {
  const out = [];
  const acct = report.account;
  out.push(`계정: ${acct.name ?? '(이름 없음)'}${acct.is_test_data ? '  [검증용 데이터]' : ''}`);
  out.push(`엔진: ${report.engine?.repo ?? '?'} @ ${report.engine?.commit?.slice(0, 8) ?? '버전 미확인'}`);
  out.push('가정:');
  for (const a of report.assumptions) out.push(`  - ${a}`);
  out.push('');

  if (report.ranking.length === 0) out.push('계산된 편성이 없다.');
  for (const r of report.ranking) {
    const rel = r.rank === 1 ? '기준' : `1위 대비 ${pct(r.relative_to_best)}`;
    out.push(`${r.rank}위  ${r.name}  총딜 ${unit(r.total_damage)} (${num(r.total_damage)})  · ${rel}`);
    for (const m of r.members) {
      out.push(`      ${pct(m.share).padStart(6)}  ${padStartWide(unit(m.damage), 10)}  ${num(m.damage).padStart(15)}  ${m.name}`);
    }
    for (const n of r.notes) out.push(`      ! ${n}`);
    if (r.ungrown_members.length) out.push(`      ! 육성 정보가 비어 미육성으로 계산: ${r.ungrown_members.join(', ')}`);
  }
  if (report.rejected.length) {
    out.push('', '계산하지 않은 편성:');
    for (const r of report.rejected) out.push(`  - ${r.name}: ${r.reasons.join(' / ')}`);
  }
  if (report.failed.length) {
    out.push('', '엔진이 계산하지 못한 편성:');
    for (const f of report.failed) out.push(`  - ${f.name}: ${f.error.message}${f.error.path ? ` (${f.error.path})` : ''}`);
  }
  out.push('', '주의:');
  for (const c of report.caveats) out.push(`  - ${c}`);
  return out.join('\n');
}
