// 편성 비교: 계정 상태 + 전투 조건 + 후보 편성 → 엔진 시뮬 → 순위와 근거.
// 형식 설명은 docs/data-model.md §비교 결과.
import { validateAccount, toEngineProfile, unconfirmedFields } from './account.mjs';
import { validateCondition, toEngineBase, assumptionsOf, levelPlan, levelCaveats } from './condition.mjs';
import { engineAccess } from './runtime.mjs';

export const REPORT_SCHEMA_VERSION = 1;
export const SQUAD_SIZE = 5;
/** 모든 비교 결과에 붙는 주의 문장. 요격전 추천은 더 구체적인 문장을 쓰므로 이것을 걸러 낸다(src/core/intercept.mjs). */
export const CAVEAT_NOT_VERIFIED = '수치는 시뮬레이션 추정치다. 실제 게임 기록과 대조하지 않았다.';

/**
 * 편성의 육성 기준(편성 항목의 `growth`). 적지 않으면 계정의 육성이다.
 *   account         계정 문서에 적힌 육성(적지 않은 칸·미확인 칸은 미육성)
 *   engine_default  엔진 기본 스펙 — 계정의 육성 값을 쓰지 않는다(vendor/nikke-calc/docs/HARNESS.md §기본 스펙:
 *                   돌파 3 · 코어 강화 0 · 스킬 10/10/10 · 오버로드 장비 5강 · 큐브·소장품 포함). 덱 빌더의 「모두 최대 육성」이 쓴다.
 */
export const GROWTH_ACCOUNT = 'account';
export const GROWTH_ENGINE_DEFAULT = 'engine_default';
export const GROWTH_BASES = Object.freeze([GROWTH_ACCOUNT, GROWTH_ENGINE_DEFAULT]);
/** 엔진 기본 스펙이 무엇인지 한 줄(결과의 메모·caveats에 쓴다). 「전부 최대」가 아니다 — 코어 강화는 0이다. */
export const ENGINE_DEFAULT_SPEC_TEXT = '돌파 3 · 코어 강화 0 · 스킬 10/10/10 · 오버로드 장비 5강 · 소장품 SR15 · 애장품 3단계 · 큐브 Lv.15(엔진 문서 HARNESS.md §기본 스펙)';

const usesEngineDefault = (squad) => squad?.growth === GROWTH_ENGINE_DEFAULT;

/**
 * 엔진 기본 스펙으로 계산할 때의 프로필: 프로필에 없는 니케를 기본 스펙으로 계산하게 하고(`base: "default"`) 아무도 적지 않는다
 * (vendor/nikke-calc/docs/SIM-JSON.md §육성 — 「`base: "default"` + 빈 `chars`는 총딜이 기본 스펙과 같다」).
 * 레벨은 `levelPlan(condition, null)`이 정한다: 상한이 없으면 fixed(400), 있으면 상한 값(엔진 정책 sync에 실어 보낸다).
 */
function engineDefaultProfile(level) {
  const profile = { base: 'default', chars: {}, _meta: { name: '엔진 기본 스펙' } };
  if (level.engine_policy === 'sync') profile._account = { synchro_level: level.level };
  return profile;
}

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
  if (squad.growth !== undefined && !GROWTH_BASES.includes(squad.growth)) problems.push(`모르는 육성 기준이다: ${String(squad.growth)} (쓸 수 있는 값: ${GROWTH_BASES.join(', ')})`);
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
  if (usesEngineDefault(squad)) {
    // 계정의 육성 값을 쓰지 않으므로 미확인 칸 이야기는 하지 않는다.
    notes.push(`육성 기준: 엔진 기본 스펙 — 계정의 육성 값을 쓰지 않았다(${ENGINE_DEFAULT_SPEC_TEXT})`);
    return notes;
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
 * @param {{name?: string, members: string[], growth?: 'account'|'engine_default'}[]} input.squads 후보 편성.
 *   `growth: 'engine_default'`인 편성은 계정의 육성 대신 엔진 기본 스펙으로 계산한다(순위 항목에 `growth`가 실린다).
 *   적지 않으면 종전 그대로다 — 결과 문서도 이 칸이 생기기 전과 같다.
 * @param {object} [deps] `runtime`(src/core/runtime.mjs의 계약 — 엔진 실행·카탈로그·버전), `concurrency`, `now`.
 *   런타임을 `withCache`(src/core/cache.mjs)로 감싸 주면 같은 요청을 다시 계산하지 않고 결과에 `cache` 통계가 실린다.
 *   `catalog`·`runBatch`를 직접 주면 런타임보다 먼저다(테스트에서 엔진을 바꿔 끼울 때 쓴다)
 */
export async function compareSquads({ account, condition, squads }, deps = {}) {
  const engine = engineAccess(deps);
  const catalog = await engine.catalog();

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

  // 레벨: 조건에 상한(level_cap)이 있으면 계정의 동기화 레벨을 상한까지 반영한다. 없으면 종전대로 fixed(400).
  const level = levelPlan(condition, account);
  const base = toEngineBase(condition, level);
  // 엔진 기본 스펙 편성: 계정의 동기화 레벨을 쓰지 않는다 — 상한이 있으면 상한 레벨, 없으면 fixed(400).
  const defaultLevel = levelPlan(condition, null);
  const defaultBase = toEngineBase(condition, defaultLevel);
  const requests = accepted.map((s) =>
    usesEngineDefault(s)
      ? { ...defaultBase, squad: s.members, profile: engineDefaultProfile(defaultLevel) }
      : { ...base, squad: s.members, profile: toEngineProfile(account, s.members, level) },
  );
  const { results, cache } = await engine.runBatchWithStats(requests, { concurrency: deps.concurrency });

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
      // 육성 기준을 따로 준 편성에만 싣는다.
      ...(usesEngineDefault(s) ? { growth: GROWTH_ENGINE_DEFAULT, level: defaultLevel.level } : {}),
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
    assumptions: assumptionsOf(condition, level),
    engine: evaluator ?? (await engine.version()),
    // 시뮬 결과 캐시 통계(src/core/cache.mjs). 캐시를 쓰지 않는 런타임이면 null이다.
    cache,
    ranking,
    rejected,
    failed,
    caveats: [
      '후보로 준 편성 안에서의 비교다. 전체에서 가장 좋은 편성이라는 뜻이 아니다.',
      CAVEAT_NOT_VERIFIED,
      ...levelCaveats(level),
      ...(accepted.some(usesEngineDefault)
        ? [
            `육성 기준이 「엔진 기본 스펙」인 편성은 계정의 육성과 무관하다: 캐릭터 레벨 ${defaultLevel.level} · ${ENGINE_DEFAULT_SPEC_TEXT}. ` +
              '「전부 최대」가 아니다 — 코어 강화까지 올린 계정은 이 기준보다 높게 나올 수 있다.',
          ]
        : []),
      ...a.warnings,
    ],
  };
}
