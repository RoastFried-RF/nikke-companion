// 편성 비교: 계정 상태 + 전투 조건 + 후보 편성 → 엔진 시뮬 → 순위와 근거.
// 형식 설명은 docs/data-model.md §비교 결과.
import { validateAccount, toEngineProfile, unconfirmedFields } from './account.mjs';
import { validateCondition, toEngineBase, assumptionsOf } from './condition.mjs';
import { runBatch as defaultRunBatch, loadCatalog, engineVersion } from './engine.mjs';

export const REPORT_SCHEMA_VERSION = 1;
export const SQUAD_SIZE = 5;

export class InputError extends Error {
  constructor(what, errors) {
    super(`${what}: ${errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`);
    this.what = what;
    this.errors = errors;
  }
}

/** 시뮬 전에 걸러야 하는 편성 문제. 하나라도 있으면 그 편성은 계산하지 않는다. */
export function squadProblems(squad, account, catalog) {
  const problems = [];
  const members = squad?.members;
  if (!Array.isArray(members) || members.some((m) => typeof m !== 'string')) return ['members는 니케 이름 배열이어야 한다'];
  if (members.length !== SQUAD_SIZE) problems.push(`편성은 ${SQUAD_SIZE}명이어야 한다 (지금 ${members.length}명)`);
  const dup = [...new Set(members.filter((m, i) => members.indexOf(m) !== i))];
  if (dup.length) problems.push(`같은 니케를 두 번 넣었다: ${dup.join(', ')}`);
  const unknown = members.filter((m) => !(m in catalog.nikkes));
  if (unknown.length) problems.push(`엔진이 모르는 이름: ${unknown.join(', ')}`);
  const unowned = members.filter((m) => m in catalog.nikkes && !(m in account.nikkes));
  if (unowned.length) problems.push(`보유하지 않은 니케: ${unowned.join(', ')}`);
  return problems;
}

/** 계산은 하되 결과와 함께 알려야 하는 것. */
export function squadNotes(squad, account, catalog) {
  const notes = [];
  const stages = new Set(squad.members.map((m) => catalog.nikkes[m]?.burst_stage));
  if (!stages.has('A')) {
    const missing = ['1', '2', '3'].filter((s) => !stages.has(s));
    if (missing.length) notes.push(`버스트 ${missing.join('·')}단계 니케가 없다 — 풀 버스트가 열리지 않을 수 있다`);
  }
  for (const m of squad.members) {
    const u = unconfirmedFields(account, m);
    if (u.length) notes.push(`${m}: 미확인 칸(${u.join(', ')})은 미육성 값으로 계산했다`);
  }
  return notes;
}

/**
 * @param {object} input
 * @param {object} input.account   계정 상태 문서
 * @param {object} input.condition 전투 조건 문서
 * @param {{name?: string, members: string[]}[]} input.squads 후보 편성
 * @param {object} [deps] 테스트에서 엔진을 바꿔 끼울 때 쓴다
 */
export async function compareSquads({ account, condition, squads }, deps = {}) {
  const catalog = deps.catalog ?? loadCatalog(deps.engineDir);
  const runBatch = deps.runBatch ?? defaultRunBatch;

  const a = validateAccount(account, catalog);
  if (!a.ok) throw new InputError('계정 상태가 잘못됐다', a.errors);
  const c = validateCondition(condition, catalog);
  if (!c.ok) throw new InputError('전투 조건이 잘못됐다', c.errors);
  if (!Array.isArray(squads) || squads.length === 0) {
    throw new InputError('후보 편성이 없다', [{ path: '/squads', message: '편성을 하나 이상 줘야 한다' }]);
  }

  const named = squads.map((s, i) => ({ ...s, name: s?.name ?? `편성 ${i + 1}` }));
  const rejected = [];
  const accepted = [];
  for (const s of named) {
    const problems = squadProblems(s, account, catalog);
    if (problems.length) rejected.push({ name: s.name, members: s.members, reasons: problems });
    else accepted.push(s);
  }

  const base = toEngineBase(condition);
  const requests = accepted.map((s) => ({ ...base, squad: s.members, profile: toEngineProfile(account, s.members) }));
  const results = await runBatch(requests, { engineDir: deps.engineDir, concurrency: deps.concurrency });

  const ranking = [];
  const failed = [];
  let evaluator = null;
  for (const [i, s] of accepted.entries()) {
    const r = results[i];
    if (r.error) {
      failed.push({ name: s.name, members: s.members, error: { type: r.error.type, message: r.error.message, path: r.error.path ?? null } });
      continue;
    }
    evaluator ??= r.evaluator ?? null;
    ranking.push({
      name: s.name,
      members: r.members.map((m) => ({ name: m.name, damage: m.damage, share: m.share })),
      total_damage: r.total_damage,
      notes: squadNotes(s, account, catalog),
      engine_warnings: r.warnings ?? [],
      ungrown_members: r.spec?.profile?.ungrown ?? [],
    });
  }
  // 같은 총딜이면 입력 순서를 지킨다(안정 정렬) — 실행마다 순위가 바뀌지 않게.
  ranking.sort((x, y) => y.total_damage - x.total_damage);
  const best = ranking[0]?.total_damage ?? 0;
  ranking.forEach((r, i) => {
    r.rank = i + 1;
    r.relative_to_best = best > 0 ? r.total_damage / best : 0;
  });

  return {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
    account: { name: account.name ?? null, is_test_data: account.is_test_data, updated_at: account.updated_at ?? null },
    condition,
    assumptions: assumptionsOf(condition),
    engine: evaluator ?? engineVersion(deps.engineDir),
    ranking,
    rejected,
    failed,
    caveats: [
      '후보로 준 편성 안에서의 비교다. 전체에서 가장 좋은 편성이라는 뜻이 아니다.',
      '수치는 시뮬레이션 추정치다. 실제 게임 기록과 대조하지 않았다.',
      ...a.warnings,
    ],
  };
}
