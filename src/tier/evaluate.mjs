// 자동 티어 2단계 — 엔진 계산으로 티어표를 만든다 (방법 v1: 팀 총딜 비율).
//
// 니케마다 「편성에 넣었을 때 팀 총딜이 얼마나 달라지는가」를 본다(개인 딜이 아니다 — 서포터를 제대로 평가하려는 것).
// 표준 육성 조건(엔진 기본 스펙, 육성 프로필 없음)과 시나리오(보스 프리셋)에서, 기준 편성(data/tier/reference-squads.json)의
// 같은 버스트 단계 자리에 대상 니케를 바꿔 넣어 시뮬하고, 점수 = 바꿔 넣은 편성 총딜 ÷ 그 기준 편성 총딜의 최댓값.
// 등급은 data/tier/rules.json의 경계로 매긴다(src/tier/rules.mjs). 방법·가정·한계는 docs/tier-method.md,
// 결과 형식은 docs/data-model.md §티어 결과.
//
// 이 파일은 계산 모듈이다: `node:` 모듈을 import하지 않는다. 엔진은 `deps.runtime`으로, 데이터 문서는 인자로 받는다.
// AI API는 부르지 않는다 — 수치 계산과 등급 산출만 한다.
import { canonicalJson, sha256Hex } from '../core/cache.mjs';
import { InputError, SQUAD_SIZE } from '../core/compare.mjs';
import { engineAccess } from '../core/runtime.mjs';
import { burstOrderGroup } from '../core/search.mjs';
import { gradeOf, isUnsupportedWarning, tierLabel, UNSUPPORTED_FLAG, validateRules } from './rules.mjs';

export const TIER_SCHEMA_VERSION = 1;
export const REFERENCES_SCHEMA_VERSION = 1;
export const METHOD = Object.freeze({ id: 'team-swap-ratio', version: 1 });

/** 시뮬 횟수의 기본 예산. 지금 로스터(209명)·기준 편성 5개의 전체 계산이 1,800건쯤이다. */
export const DEFAULT_TIER_BUDGET = 2000;
/** 엔진에 한 번에 맡기는 요청 수. 묶음이 끝날 때마다 캐시에 저장되고 진행이 보고된다. */
export const DEFAULT_BATCH_SIZE = 40;

export const STATUS_PREDICTED = '예측 평가';
export const STATUS_HOLD = '평가 보류';

/** 평가 보류 사유. `label`은 `평가 보류(…)`의 괄호 안에 들어간다. */
export const HOLD_REASONS = Object.freeze({
  skills_unparsed: '스킬 미파싱',
  skills_empty: '스킬 효과 없음',
  preview: '프리뷰',
  no_burst_stage: '버스트 단계 미상',
  no_comparison: '대조 편성 없음',
  sim_error: '시뮬 오류',
  budget: '예산',
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const infoOf = (catalog, name) => (Object.hasOwn(catalog.nikkes, name) ? catalog.nikkes[name] : null);

/**
 * 기준 편성 문서(시나리오 + 편성 목록)를 검사한다.
 * @returns {{ok: boolean, errors: {path: string, message: string}[]}}
 */
export function validateReferences(doc, catalog) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObject(doc)) return { ok: false, errors: [{ path: '', message: '기준 편성 문서는 객체여야 한다' }] };
  if (doc.schema_version !== REFERENCES_SCHEMA_VERSION) err('/schema_version', `schema_version은 ${REFERENCES_SCHEMA_VERSION}이어야 한다`);
  if (!nonEmptyString(doc.version)) err('/version', '기준 편성 버전(문자열)이 필요하다');

  const sc = doc.scenario;
  if (!isObject(sc)) {
    err('/scenario', '시나리오(보스·시간·육성 조건)가 필요하다');
  } else {
    if (!nonEmptyString(sc.id)) err('/scenario/id', '시나리오 이름(문자열)이 필요하다');
    if (!nonEmptyString(sc.boss)) err('/scenario/boss', '보스 프리셋 이름이 필요하다');
    else if (!catalog.bosses.includes(sc.boss)) err('/scenario/boss', `엔진에 없는 보스 프리셋이다. 사용 가능: ${catalog.bosses.join(', ')}`);
    if (sc.duration !== undefined && !(typeof sc.duration === 'number' && Number.isFinite(sc.duration) && sc.duration > 0)) {
      err('/scenario/duration', '전투 시간(초)은 0보다 커야 한다');
    }
    // 방법 v1의 표준 육성 조건은 엔진 기본 스펙 하나뿐이다. 다른 값을 조용히 기본 스펙으로 계산하지 않는다.
    if (sc.growth !== 'engine_default') err('/scenario/growth', "육성 조건은 'engine_default'(엔진 기본 스펙, 프로필 없음)만 지원한다");
    if (sc.enemy !== undefined && !isObject(sc.enemy)) err('/scenario/enemy', 'enemy는 객체여야 한다');
  }

  if (!Array.isArray(doc.squads) || doc.squads.length === 0) {
    err('/squads', '기준 편성을 하나 이상 적어야 한다');
  } else {
    const ids = new Set();
    doc.squads.forEach((s, i) => {
      if (!isObject(s) || !nonEmptyString(s.id)) return err(`/squads/${i}/id`, '기준 편성 이름(문자열)이 필요하다');
      if (ids.has(s.id)) err(`/squads/${i}/id`, `기준 편성 이름이 겹친다: ${s.id}`);
      ids.add(s.id);
      const m = s.members;
      if (!Array.isArray(m) || m.some((x) => typeof x !== 'string')) return err(`/squads/${i}/members`, 'members는 니케 이름 배열이어야 한다');
      if (m.length !== SQUAD_SIZE) err(`/squads/${i}/members`, `편성은 ${SQUAD_SIZE}명이어야 한다 (지금 ${m.length}명)`);
      if (new Set(m).size !== m.length) err(`/squads/${i}/members`, '같은 니케를 두 번 넣었다');
    });
  }
  return { ok: errors.length === 0, errors };
}

/** 엔진 요청: 표준 육성 조건(프로필 없음 = 엔진 기본 스펙) + 시나리오. 항상 기대값 모드(결정론)다. */
export function tierRequest(scenario, members) {
  const request = { squad: members, sim: { expected: true, duration: scenario.duration ?? 180 }, boss: scenario.boss };
  if (scenario.enemy) request.enemy = scenario.enemy;
  return request;
}

/**
 * 시뮬 없이 알 수 있는 평가 보류 사유. 없으면 null.
 * `skills`(이름 → 파싱된 효과 수)가 없으면 미파싱 여부는 여기서 알 수 없다 — 엔진이 오류로 끊는다(시뮬 오류로 보류).
 */
export function staticHold(name, catalog, skills) {
  const info = infoOf(catalog, name);
  if (info?.preview === true) {
    return hold('preview', '출시 전 카드 기준(프리뷰)으로 등록된 니케다. 수치가 추정값이라 등급을 매기지 않는다');
  }
  if (skills) {
    if (!Object.hasOwn(skills, name)) {
      return hold('skills_unparsed', '엔진이 스킬을 파싱하지 못했다(parsed_skills.json에 없다). 스킬 0개로 계산하면 결과가 조용히 틀린다');
    }
    if (!(skills[name] > 0)) return hold('skills_empty', '파싱된 스킬 효과가 하나도 없다. 스킬 0개로 계산된다');
  }
  if (burstOrderGroup(info) === null) {
    return hold('no_burst_stage', `버스트 단계를 알 수 없어(${JSON.stringify(info?.burst_stage ?? null)}) 바꿔 넣을 자리를 정할 수 없다`);
  }
  return null;
}

function hold(code, message, extra = {}) {
  return { code, label: HOLD_REASONS[code], message, ...extra };
}

/** 기준 편성을 시뮬 전에 쓸 수 없는 이유(없으면 null). 기준이 흔들리면 그 편성으로 낸 점수 전부가 흔들린다. */
function referenceProblem(squad, catalog, skills) {
  const unknown = squad.members.filter((m) => infoOf(catalog, m) === null);
  if (unknown.length) return `엔진이 모르는 이름: ${unknown.join(', ')}`;
  for (const m of squad.members) {
    const h = staticHold(m, catalog, skills);
    if (h) return `${m}: ${h.label} — ${h.message}`;
  }
  return null;
}

/**
 * 대상 니케를 바꿔 넣을 자리. 대상이 이미 들어 있는 기준 편성은 통째로 뺀다(자기 자신과 비교하지 않는다).
 * 자리 = 대상과 같은 버스트 묶음(1·2·3단계, 전 단계 A는 3단계 묶음)의 멤버 자리. 배치 순서는 그대로 둔다.
 * @returns {{variants: {reference: string, slot: number, replaced: string, members: string[]}[], excluded: {reference: string, reason: string}[]}}
 */
export function planVariants(name, references, catalog) {
  const group = burstOrderGroup(infoOf(catalog, name));
  const variants = [];
  const excluded = [];
  for (const ref of references) {
    if (ref.members.includes(name)) {
      excluded.push({ reference: ref.id, reason: 'self' });
      continue;
    }
    const slots = ref.members.map((m, i) => (burstOrderGroup(infoOf(catalog, m)) === group ? i : -1)).filter((i) => i >= 0);
    if (slots.length === 0) {
      excluded.push({ reference: ref.id, reason: 'no_slot' });
      continue;
    }
    for (const slot of slots) {
      const members = [...ref.members];
      members[slot] = name;
      variants.push({ reference: ref.id, slot, replaced: ref.members[slot], members });
    }
  }
  return { variants, excluded };
}

const errorOf = (row) => ({ type: row?.error?.type ?? 'invalid_result', message: row?.error?.message ?? '엔진 결과에 총딜이 없다', path: row?.error?.path ?? null });
const isGoodRow = (row) => isObject(row) && !('error' in row) && Number.isFinite(row.total_damage);

function addCache(sum, part) {
  if (part === null || part === undefined) return sum;
  const base = sum ?? { hits: 0, misses: 0, stored: 0, warnings: [] };
  return {
    hits: base.hits + part.hits,
    misses: base.misses + part.misses,
    stored: base.stored + part.stored,
    warnings: [...new Set([...base.warnings, ...(part.warnings ?? [])])],
  };
}

function readBudget(budget) {
  if (budget === undefined || budget === null) return DEFAULT_TIER_BUDGET;
  if (!Number.isInteger(budget) || budget < 1) throw new InputError('인자가 잘못됐다', [{ path: 'budget', message: '시뮬 예산은 1 이상의 정수여야 한다' }]);
  return budget;
}

function readTargets(only, catalog) {
  if (only === undefined || only === null) return Object.keys(catalog.nikkes);
  if (!Array.isArray(only) || only.length === 0 || !only.every(nonEmptyString)) {
    throw new InputError('인자가 잘못됐다', [{ path: 'only', message: '니케 이름을 하나 이상 줘야 한다' }]);
  }
  const names = [...new Set(only.map((n) => n.trim()))];
  const unknown = names.filter((n) => infoOf(catalog, n) === null);
  if (unknown.length) throw new InputError('엔진이 모르는 니케다', unknown.map((n) => ({ path: 'only', message: `'${n}' — 정식 명칭만 받는다` })));
  return names;
}

/** 엔진 데이터 버전: 데이터 파일별 내용 해시를 하나로 묶은 값. 해시를 못 받았으면 null(값을 지어내지 않는다). */
async function engineDataVersion(engineData) {
  if (!isObject(engineData?.files) || Object.keys(engineData.files).length === 0) return null;
  const digest = await sha256Hex(canonicalJson(engineData.files));
  return { version: `sha256:${digest.slice(0, 16)}`, files: engineData.files };
}

/**
 * 티어표를 만든다.
 * @param {object} input
 * @param {object} input.references 기준 편성 문서(data/tier/reference-squads.json)
 * @param {object} input.rules      등급 규칙 문서(data/tier/rules.json)
 * @param {string[]} [input.only]   평가할 니케 이름. 주지 않으면 엔진이 아는 전원(카탈로그 순)
 * @param {number} [input.budget]   엔진에 맡기는 요청 수(기준 편성 + 바꿔 넣기)의 상한. 캐시 적중도 센다
 * @param {object} [deps] `runtime`(src/core/runtime.mjs의 계약), `now`, `concurrency`, `batchSize`,
 *   `engineData`(`{skills: {이름: 효과 수}, files: {파일: 해시}}` 또는 그것을 돌려주는 함수 — Node는
 *   src/runtime/node.mjs의 loadEngineData), `onProgress({done, total})`. `catalog`·`runBatch`를 직접 주면 런타임보다 먼저다
 */
export async function buildTier({ references, rules, only, budget }, deps = {}) {
  const engine = engineAccess(deps);
  const catalog = await engine.catalog();

  const rv = validateRules(rules);
  if (!rv.ok) throw new InputError('등급 규칙이 잘못됐다', rv.errors);
  const fv = validateReferences(references, catalog);
  if (!fv.ok) throw new InputError('기준 편성이 잘못됐다', fv.errors);
  const limit = readBudget(budget);
  const targets = readTargets(only, catalog);

  const engineData = (typeof deps.engineData === 'function' ? await deps.engineData() : deps.engineData) ?? null;
  const skills = isObject(engineData?.skills) ? engineData.skills : null;
  const scenario = references.scenario;
  const batchSize = Number.isInteger(deps.batchSize) && deps.batchSize > 0 ? deps.batchSize : DEFAULT_BATCH_SIZE;

  // ── 기준 편성: 시뮬 전에 쓸 수 있는지 본다 ─────────────────────────────────────────────────────
  const refs = references.squads.map((s) => ({
    id: s.id,
    members: [...s.members],
    source: s.source ?? null,
    status: 'used',
    reason: null,
    total_damage: null,
    warnings: [],
  }));
  for (const ref of refs) {
    const problem = referenceProblem(ref, catalog, skills);
    if (problem) Object.assign(ref, { status: 'unusable', reason: problem });
  }
  const usable = () => refs.filter((r) => r.status === 'used');
  if (usable().length === 0) {
    throw new InputError('쓸 수 있는 기준 편성이 없다', refs.map((r) => ({ path: r.id, message: r.reason })));
  }

  // ── 대상: 시뮬 없이 알 수 있는 보류 ───────────────────────────────────────────────────────────
  /** @type {Map<string, object>} */
  const held = new Map();
  for (const name of targets) {
    const h = staticHold(name, catalog, skills);
    if (h) held.set(name, { hold: h });
  }
  const pending = targets.filter((n) => !held.has(n));

  // ── 엔진 실행: 묶음으로 나눠 맡긴다(묶음마다 캐시에 저장되고 진행이 보고된다) ─────────────────
  let used = 0;
  let cache = null;
  let cacheUsed = false;
  let evaluator = null;
  let done = 0;
  let totalPlanned = 0;
  const progress = () => deps.onProgress?.({ done, total: totalPlanned });
  async function run(requests) {
    const rows = [];
    for (let at = 0; at < requests.length; at += batchSize) {
      const chunk = requests.slice(at, at + batchSize);
      const r = await engine.runBatchWithStats(chunk, { concurrency: deps.concurrency });
      if (!Array.isArray(r.results) || r.results.length !== chunk.length) {
        throw new Error(`엔진 런타임이 요청 ${chunk.length}건에 결과 ${Array.isArray(r.results) ? r.results.length : 0}건을 돌려줬다`);
      }
      if (r.cache !== null && r.cache !== undefined) cacheUsed = true;
      cache = addCache(cache, r.cache);
      rows.push(...r.results);
      done += chunk.length;
      progress();
    }
    return rows;
  }

  // ── 기준 편성 시뮬 ─────────────────────────────────────────────────────────────────────────
  // 예산이 기준 편성 계산에도 모자라면 아무것도 계산하지 않는다 — 대상 전원이 평가 보류(예산)다.
  const baselineCount = usable().length;
  const budgetCoversBaselines = pending.length === 0 || limit >= baselineCount;
  let baselinesRun = 0;
  if (pending.length > 0 && budgetCoversBaselines) {
    const toRun = usable();
    totalPlanned = toRun.length;
    used += toRun.length;
    baselinesRun = toRun.length;
    const rows = await run(toRun.map((ref) => tierRequest(scenario, ref.members)));
    for (const [i, ref] of toRun.entries()) {
      const row = rows[i];
      if (!isGoodRow(row)) {
        Object.assign(ref, { status: 'unusable', reason: `엔진이 기준 편성을 계산하지 못했다: ${errorOf(row).message}` });
      } else if (!(row.total_damage > 0)) {
        Object.assign(ref, { status: 'unusable', reason: '기준 편성의 총딜이 0이다 — 비율을 낼 수 없다' });
      } else if (Array.isArray(row.spec?.preview) && row.spec.preview.length > 0) {
        Object.assign(ref, { status: 'unusable', reason: `프리뷰(출시 전 카드 기준) 니케가 들어 있다: ${row.spec.preview.join(', ')}` });
      } else {
        evaluator ??= row.evaluator ?? null;
        ref.total_damage = row.total_damage;
        ref.warnings = Array.isArray(row.warnings) ? row.warnings : [];
      }
    }
    if (usable().length === 0) {
      throw new Error(`기준 편성을 하나도 계산하지 못했다 — ${refs.map((r) => `${r.id}: ${r.reason}`).join(' / ')}`);
    }
  }

  // ── 대상별 계획: 예산 안에서 통째로 들어가는 니케만 계산한다 ──────────────────────────────────
  // 일부 자리만 계산한 점수는 예산에 따라 달라져 서로 견줄 수 없다. 그래서 한 니케의 변형이 남은 예산에 다 들어가지
  // 않으면 그 니케는 평가 보류(예산)로 남기고, 뒤의 니케는 계속 본다(순서는 입력 순서 — 같은 입력이면 같은 결과).
  /** @type {{name: string, variants: object[], excluded: object[], at: number}[]} */
  const planned = [];
  const requests = [];
  for (const name of pending) {
    if (!budgetCoversBaselines) {
      held.set(name, { hold: hold('budget', `시뮬 예산 ${limit}건이 기준 편성 ${baselineCount}개를 계산하기에도 모자라다`) });
      continue;
    }
    const { variants, excluded } = planVariants(name, usable(), catalog);
    if (variants.length === 0) {
      const why = excluded.map((e) => `${e.reference}(${e.reason === 'self' ? '이미 들어 있다' : '같은 버스트 단계 자리가 없다'})`).join(', ');
      held.set(name, { hold: hold('no_comparison', `바꿔 넣어 볼 기준 편성이 없다: ${why}`), excluded });
      continue;
    }
    if (variants.length > limit - used) {
      held.set(name, {
        hold: hold('budget', `시뮬 ${variants.length}건이 필요한데 예산 ${limit}건 중 ${limit - used}건만 남았다`, { needed: variants.length, remaining: limit - used }),
        excluded,
      });
      continue;
    }
    used += variants.length;
    planned.push({ name, variants, excluded, at: requests.length });
    for (const v of variants) requests.push(tierRequest(scenario, v.members));
  }
  totalPlanned += requests.length;
  const rows = await run(requests);

  // ── 점수와 등급 ─────────────────────────────────────────────────────────────────────────────
  const refById = new Map(refs.map((r) => [r.id, r]));
  const graded = [];
  for (const plan of planned) {
    const results = plan.variants.map((v, i) => ({ variant: v, row: rows[plan.at + i] }));
    const errors = results
      .filter((r) => !isGoodRow(r.row))
      .map((r) => ({ reference: r.variant.reference, slot: r.variant.slot, replaced: r.variant.replaced, error: errorOf(r.row) }));
    if (errors.length) {
      // 일부 자리만 성공했어도 등급을 매기지 않는다 — 빠진 자리가 최댓값이었을 수 있다.
      const first = errors[0];
      held.set(plan.name, {
        hold: hold('sim_error', `시뮬 ${results.length}건 중 ${errors.length}건이 오류를 냈다: ${first.error.message} (${first.reference}의 ${first.replaced} 자리)`, { errors }),
        excluded: plan.excluded,
      });
      continue;
    }
    if (results.some((r) => Array.isArray(r.row.spec?.preview) && r.row.spec.preview.includes(plan.name))) {
      held.set(plan.name, { hold: hold('preview', '엔진이 이 니케를 출시 전 카드 기준(프리뷰)으로 계산했다고 알렸다'), excluded: plan.excluded });
      continue;
    }

    const comparisons = results.map(({ variant, row }) => {
      const ref = refById.get(variant.reference);
      return {
        reference: variant.reference,
        slot: variant.slot,
        replaced: variant.replaced,
        total_damage: row.total_damage,
        reference_total: ref.total_damage,
        ratio: row.total_damage / ref.total_damage,
      };
    });
    // 같은 비율이면 먼저 계산한 자리(기준 편성 문서의 순서)가 이긴다.
    let bestAt = 0;
    comparisons.forEach((c, i) => {
      if (c.ratio > comparisons[bestAt].ratio) bestAt = i;
    });
    const best = comparisons[bestAt];
    const score = best.ratio;
    const grade = gradeOf(score, rules);

    // 미지원 효과: 이 니케의 시뮬과 그 대조인 기준 편성 시뮬의 경고 가운데 「효과 모델이 없다」는 종류.
    const unsupported = [];
    const see = (warnings) => {
      for (const w of warnings ?? []) if (isUnsupportedWarning(w, rules) && !unsupported.includes(w)) unsupported.push(w);
    };
    for (const r of results) see(r.row.warnings);
    for (const id of new Set(plan.variants.map((v) => v.reference))) see(refById.get(id).warnings);

    const notes = [];
    for (const e of plan.excluded) {
      notes.push(
        e.reason === 'self'
          ? `기준 편성 ${e.reference}에 이미 들어 있어 그 편성은 대조에서 뺐다(자기 자신과 비교하지 않는다).`
          : `기준 편성 ${e.reference}에는 같은 버스트 단계 자리가 없어 대조에서 뺐다.`,
      );
    }
    for (const w of unsupported) notes.push(`미지원 효과(엔진 경고): ${w}`);

    if (grade === null) {
      held.set(plan.name, { hold: hold('sim_error', `점수를 낼 수 없다(총딜 비율 ${score})`), excluded: plan.excluded });
      continue;
    }
    graded.push({
      name: plan.name,
      rank: null, // 아래에서 점수 순으로 매긴다
      burst_stage: infoOf(catalog, plan.name)?.burst_stage ?? null,
      status: STATUS_PREDICTED,
      status_label: STATUS_PREDICTED,
      tier: grade.tier,
      tier_label: tierLabel(grade.tier, unsupported.length > 0),
      score,
      unsupported: unsupported.length > 0,
      flags: unsupported.length > 0 ? [UNSUPPORTED_FLAG] : [],
      best,
      comparisons,
      excluded_references: plan.excluded,
      hold: null,
      notes,
      engine_warnings: Array.isArray(results[bestAt].row.warnings) ? results[bestAt].row.warnings : [],
    });
  }

  // 점수 내림차순, 같은 점수면 이름 순(코드 단위 — 로케일과 무관). 보류는 그 뒤에 입력 순서대로.
  graded.sort((a, b) => b.score - a.score || byCodeUnit(a.name, b.name));
  graded.forEach((e, i) => {
    e.rank = i + 1;
  });
  const holds = targets
    .filter((n) => held.has(n))
    .map((name) => {
      const h = held.get(name);
      return {
        name,
        rank: null,
        burst_stage: infoOf(catalog, name)?.burst_stage ?? null,
        status: STATUS_HOLD,
        status_label: `${STATUS_HOLD}(${h.hold.label})`,
        tier: null,
        tier_label: null,
        score: null,
        unsupported: false,
        flags: [],
        best: null,
        comparisons: [],
        excluded_references: h.excluded ?? [],
        hold: h.hold,
        notes: [h.hold.message],
        engine_warnings: [],
      };
    });

  // ── 결과 문서 ───────────────────────────────────────────────────────────────────────────────
  const version = evaluator ?? (await engine.version());
  const dataVersion = await engineDataVersion(engineData);
  const byTier = Object.fromEntries(rules.tiers.map((t) => [t.tier, 0]));
  for (const e of graded) byTier[e.tier] += 1;
  const holdByReason = {};
  for (const e of holds) holdByReason[e.hold.code] = (holdByReason[e.hold.code] ?? 0) + 1;
  const budgetHolds = holdByReason.budget ?? 0;
  const flagged = graded.filter((e) => e.unsupported).length;
  const duration = scenario.duration ?? 180;

  const caveats = [
    `${STATUS_PREDICTED}다 — 시뮬레이션 추정치이고 실제 게임 기록과 대조하지 않았다.`,
    '점수는 기준 편성의 같은 버스트 단계 자리에 바꿔 넣었을 때의 팀 총딜 비율 가운데 최댓값이다. 개인 딜이 아니고, 기준 편성 밖의 조합에서만 나오는 시너지는 보지 않았다.',
    `시나리오 하나(${scenario.boss} · ${duration}초 · 엔진 기본 스펙)에서의 평가다. 다른 보스·속성·전투 시간·육성 상태에서는 달라질 수 있다.`,
  ];
  if (rules.provisional !== false) {
    caveats.push(`등급 규칙 ${rules.version}은 임시다 — 대표 사례로 검증되지 않았다. 등급 경계는 바뀔 수 있다.`);
  }
  caveats.push('엔진이 경고로 알리지 않는 미지원 효과(파싱은 됐지만 계산에 반영되지 않는 스킬 효과)는 여기서 찾아내지 못한다.');
  if (flagged) caveats.push(`엔진이 효과 모델이 없다고 알린 항목 ${flagged}개의 등급에는 '${UNSUPPORTED_FLAG}' 표시가 붙었다 — 그 효과가 빠진 수치다.`);
  if (holds.length) caveats.push(`${STATUS_HOLD} ${holds.length}명은 등급이 없다. 0점으로 친 것이 아니다.`);
  if (budgetHolds) caveats.push(`시뮬 예산 ${limit}건이 모자라 ${budgetHolds}명을 계산하지 못했다(${STATUS_HOLD}(${HOLD_REASONS.budget})). 예산을 늘려 다시 돌리면 된다.`);
  for (const ref of refs) if (ref.status === 'unusable') caveats.push(`기준 편성 ${ref.id}를 쓰지 못했다: ${ref.reason}`);
  if (version?.commit === null || version?.commit === undefined) caveats.push('엔진 커밋을 확인하지 못했다.');
  else if (version.dirty === true) caveats.push('엔진 작업 폴더에 커밋하지 않은 변경이 있다 — 엔진 커밋만으로는 이 결과를 재현할 수 없다.');
  if (dataVersion === null) caveats.push('엔진 데이터 버전(데이터 파일 해시)을 확인하지 못했다. 스킬 미파싱 여부도 엔진 오류로만 알 수 있었다.');

  return {
    schema_version: TIER_SCHEMA_VERSION,
    kind: 'tier',
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
    method: { ...METHOD },
    engine: version,
    engine_data: dataVersion,
    scenario: {
      id: scenario.id,
      boss: scenario.boss,
      duration,
      enemy: scenario.enemy ?? null,
      growth: scenario.growth,
      growth_note: scenario.growth_note ?? null,
      expected: true,
    },
    assumptions: [
      `전투 ${duration}초, 크리티컬·코어 히트는 기대값으로 계산(결정론)`,
      `보스 프리셋: ${scenario.boss}`,
      '육성: 전원 엔진 기본 스펙(육성 프로필 없음)',
      '운용(조작·버스트 순서)은 엔진의 캐릭터별 기본값. 바꿔 넣은 니케는 빠진 멤버의 배치 자리를 그대로 쓴다',
    ],
    references: {
      version: references.version,
      source: references.source ?? null,
      squads: refs.map((r) => ({ id: r.id, members: r.members, source: r.source, status: r.status, reason: r.reason, total_damage: r.total_damage })),
    },
    rules: { version: rules.version, provisional: rules.provisional, tiers: rules.tiers.map((t) => ({ tier: t.tier, min: t.min })) },
    sims: {
      budget: limit,
      used,
      baselines: baselinesRun,
      variants: requests.length,
      skipped_for_budget: budgetHolds,
    },
    // 시뮬 결과 캐시 통계(src/core/cache.mjs). 캐시를 쓰지 않는 런타임이면 null이다.
    cache: cacheUsed ? cache : null,
    summary: {
      requested: targets.length,
      graded: graded.length,
      hold: holds.length,
      unsupported: flagged,
      by_tier: byTier,
      hold_by_reason: holdByReason,
    },
    entries: [...graded, ...holds],
    caveats,
  };
}
