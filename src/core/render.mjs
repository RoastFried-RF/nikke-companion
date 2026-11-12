// 비교 결과를 사람이 읽는 텍스트로 바꾼다. 오버레이 UI가 생기면 같은 결과 객체를 그쪽이 그린다.

import { formatDamage, groupThousands } from './format.mjs';

const num = (n) => groupThousands(Math.round(n));
const unit = (n) => formatDamage(Math.round(n));
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// 한글은 터미널에서 두 칸을 차지한다. 단위 글자(억·만·조) 때문에 열이 어긋나지 않게 폭으로 맞춘다.
const width = (s) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 2 : 1), 0);
const padStartWide = (s, w) => ' '.repeat(Math.max(0, w - width(s))) + s;

/**
 * 시뮬 결과 캐시 한 줄(+ 경고). 결과 문서에 `cache` 칸이 없으면(캐시가 생기기 전의 문서) 아무것도 내지 않는다.
 * 적중 = 엔진에 보내지 않고 채운 요청, 엔진 계산 = 엔진에 보낸 요청.
 */
export function cacheLines(cache) {
  if (cache === undefined) return [];
  if (cache === null) return ['캐시: 쓰지 않음'];
  return [
    `캐시: 적중 ${cache.hits}건 · 엔진 계산 ${cache.misses}건 · 새로 저장 ${cache.stored}건`,
    ...(cache.warnings ?? []).map((w) => `  ! ${w}`),
  ];
}

/**
 * 추천의 탐색 요약 한 줄(`suggestion.search` — docs/data-model.md §배치 탐색): 쓴 시뮬 횟수와 예산, 단계별 건수,
 * 예산이 모자라 못 본 것. 칸이 없으면(배치 탐색이 생기기 전의 문서) 빈 문자열. 오버레이도 같은 문장을 쓴다.
 */
export function searchLine(search) {
  if (!search) return '';
  const parts = [`1단계 조합 ${search.stage1.requested}건`];
  if (search.stage2) parts.push(`2단계 배치 ${search.stage2.requested}건`);
  let line = `탐색: 시뮬 ${search.sims}건 / 예산 ${search.budget}건 (${parts.join(' + ')}${search.stage2 ? '' : ' · 배치 탐색 끔'})`;
  const missed = [];
  if (search.stage1.skipped > 0) missed.push(`후보 ${search.stage1.skipped}개`);
  if (search.stage2?.skipped > 0) missed.push(`배치 변형 ${search.stage2.skipped}개`);
  if (missed.length) line += ` · 예산이 모자라 못 본 것: ${missed.join(', ')}`;
  if (search.stage2) line += ` · 배치를 바꾼 조합 ${search.stage2.improved}/${search.stage2.combos}개`;
  return line;
}

function headerLines(report) {
  const acct = report.account;
  return [
    `계정: ${acct.name ?? '(이름 없음)'}${acct.is_test_data ? '  [검증용 데이터]' : ''}`,
    `엔진: ${report.engine?.repo ?? '?'} @ ${report.engine?.commit?.slice(0, 8) ?? '버전 미확인'}`,
    ...cacheLines(report.cache),
    '가정:',
    ...report.assumptions.map((a) => `  - ${a}`),
  ];
}

// 증감은 음수일 수 있다. 단위 표기는 0 이상만 받으므로 부호를 따로 붙인다.
const signedUnit = (n) => `${n < 0 ? '-' : '+'}${unit(Math.abs(n))}`;
const signedPct = (x) => `${x < 0 ? '-' : '+'}${(Math.abs(x) * 100).toFixed(2)}%`;
const value = (v) => (v === null || v === undefined ? '(적지 않음)' : JSON.stringify(v));

/** 성장 투자 비교 결과(`compareGrowth`)를 텍스트로. */
export function renderGrowthReport(report) {
  const out = headerLines(report);
  const b = report.baseline;
  out.push('', `기준 편성: ${b.name}  총딜 ${unit(b.total_damage)} (${num(b.total_damage)})`);
  for (const m of b.members) {
    out.push(`      ${pct(m.share).padStart(6)}  ${padStartWide(unit(m.damage), 10)}  ${num(m.damage).padStart(15)}  ${m.name}`);
  }
  for (const n of b.notes) out.push(`      ! ${n}`);
  if (b.ungrown_members.length) out.push(`      ! 육성 정보가 비어 미육성으로 계산: ${b.ungrown_members.join(', ')}`);
  out.push('');

  if (report.ranking.length === 0) out.push('계산된 업그레이드 후보가 없다.');
  for (const r of report.ranking) {
    const rate = r.gain_rate === null ? '증가율 계산 불가' : signedPct(r.gain_rate);
    out.push(`${r.rank}위  ${r.name}  ${rate}  총딜 ${unit(r.total_before)} → ${unit(r.total_after)} (${signedUnit(r.gain)})`);
    for (const ch of r.changes) out.push(`      ${ch.nikke} ${ch.field}: ${value(ch.before)} → ${value(ch.after)}`);
    for (const m of r.members) if (m.gain !== 0) out.push(`      ${padStartWide(signedUnit(m.gain), 11)}  ${m.name}`);
    for (const n of r.notes) out.push(`      ! ${n}`);
  }
  if (report.rejected.length) {
    out.push('', '계산하지 않은 후보:');
    for (const r of report.rejected) out.push(`  - ${r.name}: ${r.reasons.join(' / ')}`);
  }
  if (report.failed.length) {
    out.push('', '엔진이 계산하지 못한 후보:');
    for (const f of report.failed) out.push(`  - ${f.name}: ${f.error.message}${f.error.path ? ` (${f.error.path})` : ''}`);
  }
  out.push('', '주의:');
  for (const c of report.caveats) out.push(`  - ${c}`);
  return out.join('\n');
}

/** 계정 가져오기 결과(`importProfileFile`)를 텍스트로. */
export function renderImportReport(report) {
  const s = report.summary;
  const out = [
    `계정: ${report.account.name}${report.account.is_test_data ? '  [검증용 데이터]' : '  [실제 계정 데이터]'}`,
    `입력: ${report.input.file} (${report.input.format}, 수집 ${report.input.fetched_at ?? '시각 미상'})`,
    `저장: ${report.output}`,
    `가져온 니케 ${s.imported}명 (프로필 ${s.roster}개 항목 · 건너뜀 ${s.skipped}개 · 미확인 칸이 있는 니케 ${s.with_unknown}명)`,
  ];
  if (report.unknown.length) {
    out.push('', '미확인으로 남긴 칸:');
    for (const u of report.unknown) out.push(`  - ${u.nikke}: ${u.fields.join(', ')}`);
  }
  if (report.skipped.length) {
    out.push('', '옮기지 않은 항목:');
    for (const k of report.skipped) out.push(`  - ${k.name}: ${k.reason}`);
  }
  if (report.warnings.length) {
    out.push('', '알림:');
    for (const w of report.warnings) out.push(`  - ${w}`);
  }
  out.push('', '주의:');
  for (const c of report.caveats) out.push(`  - ${c}`);
  return out.join('\n');
}

export function renderReport(report) {
  const out = headerLines(report);
  if (report.suggestion) {
    const s = report.suggestion;
    out.push(`후보: 조합 ${s.considered}개 중 ${s.generated}개 생성 → ${s.simulated}개 계산 → 상위 ${s.shown}개 표시`);
    const line = searchLine(s.search);
    if (line) out.push(line);
  }
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
