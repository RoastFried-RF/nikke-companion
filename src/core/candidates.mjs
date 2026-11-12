// 후보 편성 생성: 보유 니케 → 버스트 1·2·3단계를 갖춘 5인 편성 몇 개.
// 생성(generateCandidates)은 엔진을 부르지 않는다. 전수 탐색도 아니다 — 무엇을 기준으로 줄였는지는 결과의 caveats에 적는다.
// 추천(suggestSquads)은 후보를 엔진으로 계산하고(1단계), 상위 조합의 배치를 바꿔 다시 계산한다(2단계 — 변형 규칙은 search.mjs).
// 형식 설명은 docs/data-model.md §후보 생성·§배치 탐색.
import { validateAccount, unconfirmedFields } from './account.mjs';
import { compareSquads, InputError, SQUAD_SIZE } from './compare.mjs';
import { engineAccess } from './runtime.mjs';
import { DEFAULT_BUDGET, DEFAULT_REFINE_TOP, pickBestPlacement, planRefinement, variantName } from './search.mjs';

export { DEFAULT_BUDGET, DEFAULT_REFINE_TOP };
export const DEFAULT_LIMIT = 30;
export const DEFAULT_TOP = 5;
/** 단계별로 후보 풀에 남기는 인원. 조합 수가 수백 개를 넘지 않게 잡은 값이다. */
export const DEFAULT_STAGE_CAPS = Object.freeze({ 1: 3, 2: 3, 3: 5 });
/** 실전에서 흔한 단계별 인원(1단계-2단계-3단계). 여기서 하나도 못 만들 때만 RARE_SHAPES를 쓴다. */
export const COMMON_SHAPES = Object.freeze([[1, 1, 3], [1, 2, 2], [2, 1, 2]]);
export const RARE_SHAPES = Object.freeze([[2, 2, 1], [1, 3, 1], [3, 1, 1]]);

const STAGES = ['1', '2', '3'];
const ANY_STAGE = 'A'; // 어느 단계에서나 버스트를 쓸 수 있는 니케
const OVERLOAD_MAX_LINES = 12; // 장비 4부위 × 3줄
export const INVEST_SCORE_MAX = 27216;

const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
// 로케일과 무관한 이름 순서(코드 단위 비교) — 실행 환경이 달라도 순서가 같아야 한다.
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 투자 점수(정수, 0~INVEST_SCORE_MAX). 스킬 레벨·돌파·코어 강화·오버로드 줄 수를 각각 0~1로 보고
 * 같은 비중으로 더한 값이다(공통 분모 6804로 정수화). 성능 추정이 아니라 "얼마나 키웠나"다.
 * 적지 않은 칸과 미확인 칸은 미육성으로 센다 — 엔진이 그렇게 계산하기 때문이다.
 */
export function investmentScore(entry) {
  const e = entry ?? {};
  const skills = Array.isArray(e.skill_levels) ? e.skill_levels.reduce((s, v) => s + (Number.isFinite(v) ? v : 1), 0) : 3;
  const breakthrough = Number.isFinite(e.breakthrough) ? e.breakthrough : 0;
  const core = Number.isFinite(e.core_enhancement) ? e.core_enhancement : 0;
  let lines = 0;
  if (e.overload && typeof e.overload === 'object') {
    for (const v of Object.values(e.overload)) lines += Array.isArray(v) ? v.length : Number.isFinite(v) ? v : 0;
  }
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  return clamp(skills - 3, 27) * 252 + clamp(breakthrough, 3) * 2268 + clamp(core, 7) * 972 + clamp(lines, OVERLOAD_MAX_LINES) * 567;
}

/** 편성이 버스트 1·2·3단계를 모두 채우는가. 전 단계(A) 니케는 비어 있는 단계 하나를 채운다. */
export function coversAllBurstStages(members, catalog) {
  const stages = members.map((m) => catalog.nikkes[m]?.burst_stage);
  const missing = STAGES.filter((s) => !stages.includes(s)).length;
  return missing <= stages.filter((s) => s === ANY_STAGE).length;
}

function* combinations(items, k, start = 0, picked = []) {
  if (picked.length === k) {
    yield picked;
    return;
  }
  for (let i = start; i <= items.length - (k - picked.length); i += 1) {
    yield* combinations(items, k, i + 1, [...picked, items[i]]);
  }
}

function enumerate(pool, shapes) {
  const found = [];
  const seen = new Set();
  for (const [n1, n2, n3] of shapes) {
    for (const c1 of combinations(pool[1], n1)) {
      for (const c2 of combinations(pool[2], n2)) {
        for (const c3 of combinations(pool[3], n3)) {
          const picked = [...c1, ...c2, ...c3];
          const members = picked.map((p) => p.name);
          if (new Set(members).size !== SQUAD_SIZE) continue; // 전 단계 니케가 두 자리에 들어간 조합
          const key = [...members].sort(byName).join('\u0000');
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ members, shape: `${n1}-${n2}-${n3}`, score: picked.reduce((s, p) => s + p.score, 0), order: found.length });
        }
      }
    }
  }
  return found;
}

/**
 * 보유 니케에서 후보 편성을 만든다. 순수 함수 — 같은 입력이면 같은 후보가 같은 순서로 나온다
 * (계정 문서의 니케 나열 순서와도 무관하다).
 *
 * 줄이는 순서: ① 단계별 투자 점수 상위만 후보 풀에 남긴다 ② 흔한 단계 구성의 5인 조합만 만든다
 * ③ 투자 점수 합이 높은 순으로 limit개만 남긴다.
 * 편성 안의 배치는 1→2→3단계, 같은 단계 안에서는 투자 점수 순이다(엔진은 앞사람이 버스트를 먼저 쓴다).
 *
 * @param {object} account 계정 상태 문서 (validateAccount를 통과한 것)
 * @param {{nikkes: object}} catalog 엔진 카탈로그
 * @param {{limit?: number, stageCaps?: {1?: number, 2?: number, 3?: number}}} [options]
 * @returns {{squads: {name: string, members: string[]}[], caveats: string[], summary: object}}
 */
export function generateCandidates(account, catalog, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!isPositiveInt(limit)) throw new InputError('후보 생성 옵션이 잘못됐다', [{ path: '/limit', message: 'limit은 1 이상의 정수여야 한다' }]);
  const caps = { ...DEFAULT_STAGE_CAPS, ...(options.stageCaps ?? {}) };
  for (const s of STAGES) {
    if (!isPositiveInt(caps[s])) throw new InputError('후보 생성 옵션이 잘못됐다', [{ path: `/stageCaps/${s}`, message: '단계별 인원은 1 이상의 정수여야 한다' }]);
  }

  const owned = Object.keys(account?.nikkes ?? {});
  const unknownNames = [];
  const noStage = [];
  const usable = [];
  for (const name of owned) {
    const info = Object.hasOwn(catalog.nikkes, name) ? catalog.nikkes[name] : null;
    if (!info) unknownNames.push(name);
    else if (!STAGES.includes(info.burst_stage) && info.burst_stage !== ANY_STAGE) noStage.push(name);
    else usable.push({ name, stage: info.burst_stage, score: investmentScore(account.nikkes[name]) });
  }
  usable.sort((a, b) => b.score - a.score || byName(a.name, b.name));

  const pool = {};
  const available = {};
  for (const s of STAGES) {
    const fits = usable.filter((u) => u.stage === s || u.stage === ANY_STAGE);
    available[s] = fits.length;
    pool[s] = fits.slice(0, caps[s]);
  }
  const pooled = new Set(STAGES.flatMap((s) => pool[s].map((u) => u.name)));
  const excluded = usable.filter((u) => !pooled.has(u.name)).map((u) => u.name);

  let shapes = COMMON_SHAPES;
  let found = enumerate(pool, shapes);
  const usedRareShapes = found.length === 0;
  if (usedRareShapes) {
    shapes = RARE_SHAPES;
    found = enumerate(pool, shapes);
  }
  found.sort((a, b) => b.score - a.score || a.order - b.order);
  const kept = found.slice(0, limit);
  const squads = kept.map((c, i) => ({ name: `후보 ${i + 1}`, members: c.members }));

  const caveats = [];
  const shapeText = (list) => list.map((sh) => sh.join('-')).join(', ');
  if (squads.length === 0) {
    const lacking = STAGES.filter((s) => available[s] === 0);
    if (lacking.length) caveats.push(`후보 편성을 만들 수 없다: 버스트 ${lacking.join('·')}단계 니케를 보유하지 않았다.`);
    else caveats.push(`후보 편성을 만들 수 없다: 버스트 1·2·3단계를 모두 갖춘 ${SQUAD_SIZE}인을 채울 보유 니케가 모자란다 (쓸 수 있는 보유 니케 ${usable.length}명).`);
  } else {
    caveats.push(
      `후보는 전수 탐색이 아니다. 보유 ${owned.length}명에서 버스트 단계별 투자 점수 상위만 후보 풀로 썼다 ` +
        `(${STAGES.map((s) => `${s}단계 ${pool[s].length}/${available[s]}명`).join(', ')}).`,
    );
    caveats.push('투자 점수는 스킬 레벨·돌파·코어 강화·오버로드 줄 수를 같은 비중으로 더한 값이다. 성능 추정이 아니다 — 덜 키웠지만 강한 니케나 시너지 조합이 빠질 수 있다.');
    if (excluded.length) caveats.push(`후보 풀에 들지 못한 보유 니케: ${excluded.join(', ')}.`);
    caveats.push(
      usedRareShapes
        ? `버스트 1·2·3단계를 모두 갖춘 ${SQUAD_SIZE}인만 만들었다. 흔한 단계 구성(${shapeText(COMMON_SHAPES)})으로는 만들 수 없어 드문 구성(${shapeText(RARE_SHAPES)})을 썼다.`
        : `버스트 1·2·3단계를 모두 갖춘 ${SQUAD_SIZE}인만 만들었다. 단계별 인원은 ${shapeText(COMMON_SHAPES)} 구성만 쓴다(1단계-2단계-3단계).`,
    );
    caveats.push(
      found.length > kept.length
        ? `조건에 맞는 조합 ${found.length}개 중 투자 점수 합이 높은 ${kept.length}개만 후보로 남겼다 (limit ${limit}).`
        : `조건에 맞는 조합 ${found.length}개를 모두 후보로 썼다 (limit ${limit}).`,
    );
    caveats.push('후보의 배치는 조합마다 하나만 만든다: 1→2→3단계 순, 같은 단계 안에서는 투자 점수 순이다. 다른 배치는 추천의 배치 탐색(2단계)이 다룬다.');
    if (usable.some((u) => u.stage === ANY_STAGE)) caveats.push('어느 단계에서나 버스트를 쓰는 니케는 비어 있는 단계 하나를 채우는 것으로 봤다.');
    const unconfirmed = usable.filter((u) => unconfirmedFields(account, u.name).length).map((u) => u.name);
    if (unconfirmed.length) caveats.push(`미확인 칸은 투자 점수에서 미육성으로 셌다: ${unconfirmed.join(', ')}.`);
  }
  if (unknownNames.length) caveats.push(`엔진이 모르는 이름은 후보에서 뺐다: ${unknownNames.join(', ')}.`);
  if (noStage.length) caveats.push(`버스트 단계를 알 수 없어 후보에서 뺐다: ${noStage.join(', ')}.`);

  return {
    squads,
    caveats,
    summary: {
      owned: owned.length,
      usable: usable.length,
      pool: Object.fromEntries(STAGES.map((s) => [s, pool[s].map((u) => u.name)])),
      excluded,
      shapes: shapes.map((sh) => sh.join('-')),
      considered: found.length,
      generated: squads.length,
      limit,
      truncated: found.length > kept.length,
    },
  };
}

/** 두 번의 엔진 배치가 남긴 캐시 통계를 더한다. 둘 다 캐시를 쓰지 않았으면 null. */
function mergeCacheStats(first, second) {
  if (!first || !second) return first ?? second ?? null;
  return {
    hits: first.hits + second.hits,
    misses: first.misses + second.misses,
    stored: first.stored + second.stored,
    warnings: [...new Set([...(first.warnings ?? []), ...(second.warnings ?? [])])],
  };
}

/**
 * 계정 + 전투 조건 → 후보 생성 → 엔진 비교 → 상위 top개. 탐색은 두 단계다(형식은 docs/data-model.md §배치 탐색).
 *
 *   1단계  멤버 조합: generateCandidates가 만든 후보(조합마다 배치 하나)를 계산한다.
 *   2단계  배치: 1단계 총딜 상위 `refineTop`개 조합에만, 엔진 문서에 근거한 배치 변형(src/core/search.mjs)을
 *          만들어 다시 계산한다. 조합마다 원래 배치(1단계 결과)를 언제나 후보에 넣으므로 2단계 뒤의 최고 총딜은
 *          1단계 최고 이상이다. 순위에는 조합마다 가장 좋은 배치 하나만 남기고, 배치로 얻은 차이를 메모로 남긴다.
 *
 * 시뮬 예산(`budget`)은 엔진에 맡기는 요청 수(1단계 + 2단계)의 상한이다 — 캐시에서 채워져 엔진이 실제로 돌지
 * 않은 요청도 센다(같은 입력이면 캐시가 차 있든 비어 있든 같은 결과가 나오게). 예산이 모자라 건너뛴 것은
 * caveats와 `suggestion.search`에 몇 개인지 적는다.
 *
 * 결과는 compareSquads의 비교 결과에 `suggestion`(생성·탐색 요약)과 생성 기준 caveats를 더한 것이다.
 * @param {{account: object, condition: object}} input
 * @param {{limit?: number, top?: number, stageCaps?: object, refine?: boolean, budget?: number, refineTop?: number}} [options]
 *   `refine`(기본 true)을 끄면 1단계만 한다. `budget` 기본 120, `refineTop` 기본 5.
 * @param {object} [deps] compareSquads와 같다. 더해서 `onStage({stage, stages, requests, used, budget})` —
 *   엔진 배치를 맡기기 직전에 부른다(진행 표시용. `used`는 그 전까지 쓴 시뮬 횟수)
 */
export async function suggestSquads({ account, condition }, options = {}, deps = {}) {
  const top = options.top ?? DEFAULT_TOP;
  if (!isPositiveInt(top)) throw new InputError('추천 옵션이 잘못됐다', [{ path: '/top', message: 'top은 1 이상의 정수여야 한다' }]);
  const refine = options.refine ?? true;
  if (typeof refine !== 'boolean') throw new InputError('추천 옵션이 잘못됐다', [{ path: '/refine', message: 'refine은 true 또는 false여야 한다' }]);
  const budget = options.budget ?? DEFAULT_BUDGET;
  if (!isPositiveInt(budget)) throw new InputError('추천 옵션이 잘못됐다', [{ path: '/budget', message: 'budget은 1 이상의 정수여야 한다' }]);
  const refineTop = options.refineTop ?? DEFAULT_REFINE_TOP;
  if (!isPositiveInt(refineTop)) throw new InputError('추천 옵션이 잘못됐다', [{ path: '/refineTop', message: 'refineTop은 1 이상의 정수여야 한다' }]);

  const catalog = await engineAccess(deps).catalog();
  const a = validateAccount(account, catalog);
  if (!a.ok) throw new InputError('계정 상태가 잘못됐다', a.errors);

  const generated = generateCandidates(account, catalog, options);
  if (generated.squads.length === 0) {
    throw new InputError('후보 편성이 없다', generated.caveats.map((message) => ({ path: '/account/nikkes', message })));
  }
  const onStage = typeof deps.onStage === 'function' ? deps.onStage : () => {};
  const stages = refine ? 2 : 1;

  // ── 1단계: 멤버 조합. 후보는 투자 점수 합 순이라, 예산이 모자라면 뒤쪽 후보를 건너뛴다.
  const stage1Squads = generated.squads.slice(0, budget);
  const stage1Skipped = generated.squads.length - stage1Squads.length;
  onStage({ stage: 1, stages, requests: stage1Squads.length, used: 0, budget });
  const report = await compareSquads({ account, condition, squads: stage1Squads }, { ...deps, catalog });
  const simulated = report.ranking.length;
  const bestStage1 = report.ranking[0]?.total_damage ?? null;

  // ── 2단계: 상위 조합의 배치 변형.
  let stage2 = null;
  if (refine) {
    const membersOf = new Map(stage1Squads.map((s) => [s.name, s.members]));
    const targets = report.ranking.slice(0, refineTop);
    const planned = planRefinement(
      targets.map((r) => ({ name: r.name, members: membersOf.get(r.name) })),
      catalog,
      budget - stage1Squads.length,
    );
    const computed = new Map();
    if (planned.requested > 0) {
      const variantSquads = planned.plan.flatMap((p) => p.selected.map((v, i) => ({ name: variantName(p.name, i + 1), members: v.members })));
      onStage({ stage: 2, stages, requests: variantSquads.length, used: stage1Squads.length, budget });
      const second = await compareSquads({ account, condition, squads: variantSquads }, { ...deps, catalog });
      for (const r of second.ranking) computed.set(r.name, r);
      report.rejected = [...report.rejected, ...second.rejected];
      report.failed = [...report.failed, ...second.failed];
      report.cache = mergeCacheStats(report.cache, second.cache);
    }
    const refined = new Map(targets.map((r, i) => [r.name, pickBestPlacement(r, planned.plan[i], computed)]));
    // 1단계 순위 순서에서 시작해 다시 정렬한다(안정 정렬) — 같은 총딜이면 1단계 순서를 지킨다.
    report.ranking = report.ranking.map((r) => refined.get(r.name) ?? { ...r, placement: null });
    report.ranking.sort((x, y) => y.total_damage - x.total_damage);
    const best = report.ranking[0]?.total_damage ?? 0;
    report.ranking.forEach((r, i) => {
      r.rank = i + 1;
      r.relative_to_best = best > 0 ? r.total_damage / best : 0;
    });
    stage2 = {
      combos: targets.length,
      variants: planned.total,
      requested: planned.requested,
      skipped: planned.skipped,
      improved: [...refined.values()].filter((r) => r.placement.changed).length,
    };
  }

  report.ranking = report.ranking.slice(0, top);
  const sims = stage1Squads.length + (stage2?.requested ?? 0);
  report.suggestion = {
    ...generated.summary,
    simulated,
    top,
    shown: report.ranking.length,
    search: {
      refine,
      budget,
      refine_top: refine ? refineTop : null,
      sims,
      stage1: { requested: stage1Squads.length, skipped: stage1Skipped },
      stage2,
      best_stage1_total: bestStage1,
      best_total: report.ranking[0]?.total_damage ?? null,
    },
  };

  const searchCaveats = [];
  if (stage1Skipped > 0) {
    searchCaveats.push(`시뮬 예산 ${budget}건이 모자라 후보 ${stage1Skipped}개(투자 점수 합이 낮은 쪽)를 계산하지 못했다.`);
  }
  if (stage2) {
    searchCaveats.push(
      `배치 탐색(2단계): 1단계 총딜 상위 ${stage2.combos}개 조합에만, 같은 버스트 단계 안의 순서와 3번 자리(카메라)를 바꾼 배치 ` +
        `${stage2.requested}개를 더 계산했다(근거: 엔진 문서 GAMEPLAY.md §버스트 사용 순서와 배치, CONTROL.md §카메라). ` +
        '모든 순열을 본 것이 아니고, 순위에는 조합마다 가장 좋은 배치 하나만 남겼다.',
    );
    if (stage2.skipped > 0) {
      searchCaveats.push(`시뮬 예산 ${budget}건이 모자라 배치 변형 ${stage2.variants}개 중 ${stage2.skipped}개를 계산하지 못했다.`);
    }
    searchCaveats.push('누가 버스트를 쓰지 않을지 같은 운용 지정, 스킬로 버스트 단계가 바뀌는 니케, 무기 변경으로 차지형이 되는 니케는 배치 탐색에서 따로 보지 않았다.');
  } else {
    searchCaveats.push('배치 탐색(2단계)을 하지 않았다 — 조합마다 생성기가 만든 배치 하나만 계산했다.');
  }
  report.caveats = [
    ...report.caveats,
    ...generated.caveats,
    ...searchCaveats,
    simulated > report.ranking.length
      ? `후보 ${simulated}개를 계산해 총딜 상위 ${report.ranking.length}개만 표시한다.`
      : `계산한 후보 ${simulated}개를 모두 표시한다.`,
  ];
  return report;
}
