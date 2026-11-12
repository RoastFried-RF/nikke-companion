// 레이드 5덱(P-014) — 솔로 레이드·유니온 레이드: 보유 니케를 겹치지 않게 여러 덱(기본 5)에 나눠 합계 총딜이 큰 배분을 찾는다.
// 형식 설명은 docs/data-model.md §레이드 5덱.
//
//   1. 후보 덱 만들기(순수)   덱 순서대로, 남은 보유 니케에서 기존 후보 생성기(candidates.mjs의 generateCandidates)로 조합을 만든다.
//                             덱마다 투자 점수 합 1위 조합(「뼈대」)의 니케를 다음 덱의 풀에서 뺀다 — 뼈대끼리는 겹치지 않으므로
//                             만들 수 있는 만큼의 겹치지 않는 덱이 후보 안에 언제나 들어 있다.
//   2. 계산(엔진)             시뮬 예산 안에서 후보를 계산한다(compareSquads — 캐시 포함). 고정한 덱 → 덱마다의 뼈대 → 나머지 후보를
//                             덱마다 돌아가며.
//   3. 고르기(순수 · 정확)    계산된 후보 안에서 겹치지 않는 묶음 중 덱 수가 가장 많고, 그중 합계가 가장 큰 것을 빠짐없이 찾는다
//                             (solveAllocation — 가지치기를 하는 전수 탐색. 단위 테스트가 무차별 전수 탐색과 견준다).
//   4. 자리 순서(엔진)        남은 예산으로, 고른 덱의 자리 변형(search.mjs — P-013의 규칙)을 계산해 덱마다 가장 좋은 순서를 남긴다.
//
// 조건은 모든 덱에 같은 조건 하나(솔로 레이드 — 상대 하나에 다섯 덱), 또는 덱별 조건의 배열(유니온 레이드 — 덱마다 다른 보스)이다.
// 일부 덱(다섯 자리 전부)이나 일부 자리를 미리 고정할 수 있다 — 고정한 니케는 다른 덱에 들어가지 않는다.
//
// 지원하지 않는 것(결과의 `unsupported`와 caveats에 적는다 — 지원하는 것처럼 계산하지 않는다): 보스 패턴, 레이드의 점수 규칙
// (보스 체력·단계·남은 체력 이월·점수 보정), 운용 지정. 이 모듈이 내는 것은 덱별 총딜 추정과 그 합뿐이다.
// `node:` 모듈을 import하지 않는다(웹뷰와 Node CLI가 함께 쓴다).
import { validateAccount } from './account.mjs';
import { coversAllBurstStages, DEFAULT_STAGE_CAPS, generateCandidates, investmentScore } from './candidates.mjs';
import { CAVEAT_NOT_VERIFIED, compareSquads, InputError, SQUAD_SIZE } from './compare.mjs';
import { assumptionsOf, levelPlan, validateCondition } from './condition.mjs';
import { excludeNikkes, isExcludeList } from './exclude.mjs';
import { weaknessOf } from './intercept.mjs';
import { engineAccess } from './runtime.mjs';
import { burstOrderGroup, pickBestPlacement, planRefinement, variantName } from './search.mjs';

export const UNION_REPORT_SCHEMA_VERSION = 1;
export const UNION_REPORT_KIND = 'raid_decks';
export const DEFAULT_DECKS = 5;
export const MAX_DECKS = 10;
/** 전체 시뮬 횟수의 기본 예산(후보 계산 + 자리 순서). 시뮬 1회가 4~5초, 4개 병렬이면 2분 남짓이다. */
export const DEFAULT_UNION_BUDGET = 100;
/** 자리 순서 탐색에 남겨 두는 예산: 전체의 1/4, 그리고 고정하지 않은 덱마다 6건을 넘지 않는다. */
export const REFINE_SHARE = 0.25;
export const REFINE_PER_DECK = 6;

/** 이 계산이 다루지 않는 것 — 화면과 결과에 「지원하지 않음」으로 적는다. */
export const UNION_UNSUPPORTED = Object.freeze([
  '보스 패턴(무적·보호막·특수 기믹)과 단계별 체력',
  '레이드의 점수 규칙(보스 체력·단계, 남은 체력 이월, 점수 보정) — 덱별 총딜 추정의 합만 본다',
  '버스트를 누가 쓰지 않을지·조작 같은 운용 지정(계산 도구의 캐릭터별 기본값으로 계산한다)',
]);

const STAGES = ['1', '2', '3'];
const ANY_STAGE = 'A';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const infoOf = (catalog, name) => (Object.hasOwn(catalog?.nikkes ?? {}, name) ? catalog.nikkes[name] : null);
const stageOf = (catalog, name) => infoOf(catalog, name)?.burst_stage ?? null;
const usableStage = (stage) => STAGES.includes(stage) || stage === ANY_STAGE;

/** 열쇠 순서와 무관한 JSON 글(같은 조건인지 견주는 데 쓴다). */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort(byCode).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

// ── 버스트 단계 세기와 「왜 더 못 만드는가」 ────────────────────────────────────────

/** 이름들의 버스트 단계별 수. `A` = 어느 단계에서나 쓰는 니케, `unknown` = 단계를 모르는 니케(덱에 넣지 않는다). */
export function stageCounts(names, catalog) {
  const counts = { 1: 0, 2: 0, 3: 0, A: 0, unknown: 0 };
  for (const name of names) {
    const stage = stageOf(catalog, name);
    if (usableStage(stage)) counts[stage] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

/**
 * 그 니케들로 만들 수 있는 덱 수의 상한: 덱마다 다섯 명이고 버스트 1·2·3단계가 한 명씩은 있어야 한다
 * (어느 단계에서나 쓰는 니케는 덱 하나의 빈 단계 하나를 채운다 — candidates.mjs의 coversAllBurstStages와 같은 규칙).
 * 상한일 뿐이다 — 후보 생성기는 단계 구성(1-1-3 등)과 후보 풀을 더 좁게 잡는다.
 * @param {{1: number, 2: number, 3: number, A: number}} counts
 * @returns {{max: number, by_size: number, lacking: string[]}} `lacking` = 덱을 하나 더 만들려 할 때 모자라는 단계(없으면 인원이 모자란 것이다)
 */
export function deckCapacity(counts) {
  const total = counts[1] + counts[2] + counts[3] + counts.A;
  const bySize = Math.floor(total / SQUAD_SIZE);
  const deficit = (d) => STAGES.reduce((sum, s) => sum + Math.max(0, d - counts[s]), 0);
  let max = 0;
  while (max < bySize && deficit(max + 1) <= counts.A) max += 1;
  // 하나 더(max + 1) 만들려면 무엇이 모자라는가: 인원이 되는데도 못 만들면 단계다.
  const lacking = max < bySize ? STAGES.filter((s) => counts[s] < max + 1) : [];
  return { max, by_size: bySize, lacking };
}

const countsText = (c) => `1단계 ${c[1]}명 · 2단계 ${c[2]}명 · 3단계 ${c[3]}명${c.A ? ` · 어느 단계에서나 쓰는 니케 ${c.A}명` : ''}`;

/**
 * 요청한 수만큼 덱을 만들지 못한 까닭. 남은(어느 덱에도 들지 않은) 보유 니케의 버스트 단계를 세어 말한다.
 * @param {{requested: number, made: number, unused: string[], owned: string[], catalog: object, uncomputed: number}} input
 *   `uncomputed` = 만들었지만 계산하지 못한 후보의 수(예산·실패)
 * @returns {null | {requested: number, made: number, kind: 'size'|'stage'|'search', lacking: string[], remaining: object, owned: object, capacity: number, text: string}}
 */
export function shortageOf({ requested, made, unused, owned, catalog, uncomputed = 0 }) {
  if (made >= requested) return null;
  const remaining = stageCounts(unused, catalog);
  const ownedCounts = stageCounts(owned, catalog);
  const capacity = deckCapacity(ownedCounts);
  const left = deckCapacity(remaining);
  const usable = remaining[1] + remaining[2] + remaining[3] + remaining.A;
  let kind;
  let lacking = [];
  let text;
  if (usable < SQUAD_SIZE) {
    kind = 'size';
    text = `덱 ${requested}개 중 ${made}개만 만들었다 — 남은 보유 니케가 ${usable}명이라 다섯 명을 채울 수 없다.`;
  } else if (left.max === 0) {
    kind = 'stage';
    lacking = left.lacking;
    text = `덱 ${requested}개 중 ${made}개만 만들었다 — 남은 보유 니케 ${usable}명에 버스트 ${lacking.join('·')}단계가 모자란다(${countsText(remaining)}).`;
  } else {
    kind = 'search';
    text =
      `덱 ${requested}개 중 ${made}개만 만들었다 — 남은 보유 니케 ${usable}명(${countsText(remaining)})으로 덱을 더 짤 수 있지만 계산된 후보 안에는 겹치지 않는 덱이 더 없었다` +
      // 화면에 그대로 보이는 문장이다 — 「예산」 대신 「계산 횟수」라고 적는다.
      (uncomputed > 0 ? `(계산하지 못한 후보 ${uncomputed}개 — 계산 횟수가 모자랐거나 계산에 실패했다).` : '.');
  }
  if (capacity.max < requested) {
    const why = capacity.lacking.length ? `버스트 ${capacity.lacking.join('·')}단계가 모자란다` : '인원이 모자란다';
    text += ` 보유 니케 전체(${countsText(ownedCounts)})로는 덱을 많아야 ${capacity.max}개 만들 수 있다 — ${why}.`;
    if (kind !== 'size' && capacity.lacking.length) lacking = [...new Set([...lacking, ...capacity.lacking])].sort(byCode);
  }
  return { requested, made, kind, lacking, remaining, owned: ownedCounts, capacity: capacity.max, text };
}

// ── 고정(locked) ──────────────────────────────────────────────────────────────

/**
 * 고정 문서를 덱 자리마다의 고정으로 읽는다. 받는 모양: `{decks: [...]}` 또는 배열. 항목은 `{deck?: 1부터의 번호, members: [이름|null ×5]}`
 * 또는 이름 배열 그대로다. 다섯 자리가 모두 이름이면 덱 전체 고정(자리 순서 그대로 계산한다), 일부만 이름이면 그 자리만 고정이다
 * (나머지 자리는 찾는다). `deck`을 적지 않은 항목은 비어 있는 앞 번호부터 차례로 받는다.
 * @returns {(null | {slots: (string|null)[], names: string[], full: boolean})[]} 길이 `decks`
 */
export function normalizeLocked(locked, decks) {
  const out = Array.from({ length: decks }, () => null);
  if (locked === undefined || locked === null) return out;
  const list = Array.isArray(locked) ? locked : locked?.decks;
  const bad = (path, message) => new InputError('고정한 덱이 잘못됐다', [{ path, message }]);
  if (!Array.isArray(list)) throw bad('/locked', '고정은 {decks: [{deck, members}]} 또는 배열이어야 한다');
  const seen = new Map();
  const pending = [];
  for (const [i, item] of list.entries()) {
    const base = `/locked/${i}`;
    const members = Array.isArray(item) ? item : item?.members;
    if (!Array.isArray(members) || members.length > SQUAD_SIZE || !members.every((m) => m === null || isText(m))) {
      throw bad(`${base}/members`, `members는 다섯 자리(니케 이름 또는 null)여야 한다`);
    }
    const slots = Array.from({ length: SQUAD_SIZE }, (_, k) => members[k] ?? null);
    const names = slots.filter((m) => m !== null);
    if (names.length === 0) continue; // 아무도 고정하지 않은 항목은 없는 것과 같다
    for (const name of names) {
      if (seen.has(name)) throw bad(`${base}/members`, `${name}을(를) 두 번 고정했다 — 한 니케는 한 덱에만 들어간다`);
      seen.set(name, i);
    }
    const lock = { slots, names, full: names.length === SQUAD_SIZE };
    const deck = Array.isArray(item) ? undefined : item.deck;
    if (deck === undefined || deck === null) pending.push(lock);
    else if (!Number.isInteger(deck) || deck < 1 || deck > decks) throw bad(`${base}/deck`, `덱 번호는 1~${decks}의 정수여야 한다`);
    else if (out[deck - 1]) throw bad(`${base}/deck`, `덱 ${deck}을(를) 두 번 고정했다`);
    else out[deck - 1] = lock;
  }
  for (const lock of pending) {
    const at = out.indexOf(null);
    if (at < 0) throw bad('/locked', `고정한 덱이 덱 수(${decks})보다 많다`);
    out[at] = lock;
  }
  return out;
}

// ── 후보 덱 만들기 ────────────────────────────────────────────────────────────

function* combinations(items, k, start = 0, picked = []) {
  if (picked.length === k) {
    yield picked;
    return;
  }
  for (let i = start; i <= items.length - (k - picked.length); i += 1) yield* combinations(items, k, i + 1, [...picked, items[i]]);
}

const withoutNames = (account, names) => {
  const cut = new Set(names);
  return { ...account, nikkes: Object.fromEntries(Object.entries(account.nikkes).filter(([name]) => !cut.has(name))) };
};

/**
 * 일부 자리를 고정한 덱의 나머지 자리를 채운 후보. 순수 함수.
 * 남은 보유 니케에서 버스트 단계별 투자 점수 상위(후보 생성기와 같은 인원 — 1단계 3 · 2단계 3 · 3단계 5명)를 풀로 삼아
 * 모자란 인원의 조합을 만들고, 고정한 니케와 합쳐 버스트 1·2·3단계가 모두 있는 조합만 남긴다(하나도 없으면 — 고정한 니케만으로
 * 이미 안 되면 — 단계를 따지지 않은 조합을 쓰고 `uncovered: true`). 투자 점수 합 순이다.
 * 자리: 고정한 니케는 그 자리 그대로, 채운 니케는 빈 자리에 1→2→3단계 순(같은 단계 안은 투자 점수 순)으로 놓는다.
 * @param {(string|null)[]} fixedSlots 다섯 자리(고정한 이름 또는 null)
 * @param {object} account 고정한 니케들을 **뺀** 계정(여기 남은 니케로 채운다)
 * @returns {{candidates: {members: string[]}[], considered: number, pool: string[], uncovered: boolean}}
 */
export function completeDeck(fixedSlots, account, catalog, options = {}) {
  const limit = options.limit ?? 30;
  const fixed = fixedSlots.filter((m) => m !== null);
  const need = SQUAD_SIZE - fixed.length;
  const usable = Object.keys(account?.nikkes ?? {})
    .filter((name) => !fixed.includes(name) && usableStage(stageOf(catalog, name)))
    .map((name) => ({ name, stage: stageOf(catalog, name), group: burstOrderGroup(infoOf(catalog, name)), score: investmentScore(account.nikkes[name]) }))
    .sort((a, b) => b.score - a.score || byCode(a.name, b.name));
  const pooled = new Set();
  for (const s of STAGES) for (const u of usable.filter((x) => x.stage === s || x.stage === ANY_STAGE).slice(0, DEFAULT_STAGE_CAPS[s])) pooled.add(u.name);
  const pool = usable.filter((u) => pooled.has(u.name));
  const found = [];
  for (const combo of combinations(pool, need)) {
    found.push({ combo, covers: coversAllBurstStages([...fixed, ...combo.map((c) => c.name)], catalog), score: combo.reduce((s, c) => s + c.score, 0), order: found.length });
  }
  const covering = found.filter((f) => f.covers);
  const kept = (covering.length ? covering : found).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit);
  const candidates = kept.map((f) => {
    const fill = [...f.combo].sort((a, b) => byCode(a.group, b.group) || b.score - a.score || byCode(a.name, b.name)).map((c) => c.name);
    let next = 0;
    return { members: fixedSlots.map((m) => m ?? fill[next++]) };
  });
  return { candidates, considered: found.length, pool: pool.map((p) => p.name), uncovered: covering.length === 0 && found.length > 0 };
}

/**
 * 덱 자리마다의 후보를 만든다(엔진을 부르지 않는다). 순수 함수 — 같은 입력이면 같은 후보가 같은 순서로 나온다.
 *
 * 덱 순서대로 돈다. 전체를 고정한 덱은 후보가 없다(그 덱 그대로 계산한다). 그 밖의 덱은:
 *   고정이 없는 덱   남은 보유 니케로 generateCandidates(그 덱 조건의 약점 속성이 있으면 우선 속성으로).
 *                    뒤에 채울 덱이 남아 있으면 단계별 후보 풀을 「그 단계에 쓸 수 있는 남은 니케 수 − 뒤 덱 수」까지로 줄인다 —
 *                    드문 단계의 니케를 앞 덱이 다 쓰지 않게(뒤 덱마다 한 명씩은 남긴다).
 *   일부 고정한 덱   completeDeck.
 * 덱마다 첫 후보(투자 점수 합 1위 — 「뼈대」)의 니케를 남은 니케에서 빼고 다음 덱으로 간다.
 *
 * @param {{account: object, catalog: object, slots: {lock: object|null, priorityElement: string|null}[], perTier: number}} input
 *   `account`는 고정한 니케를 모두 뺀 계정이다
 * @returns {{tiers: object[], remaining: string[]}} `tiers`는 전체 고정이 아닌 덱마다 하나(덱 순서)
 */
export function planCandidates({ account, catalog, slots, perTier }) {
  let rest = account;
  const open = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => !slot.lock?.full);
  const tiers = [];
  for (const [n, { slot, index }] of open.entries()) {
    const later = open.length - n - 1;
    if (slot.lock) {
      const made = completeDeck(slot.lock.slots, rest, catalog, { limit: perTier });
      const tier = { deck: index, kind: 'partial', candidates: made.candidates, considered: made.considered, caps: null, held: [], uncovered: made.uncovered, reason: null };
      if (made.candidates.length === 0) tier.reason = `고정한 니케 ${slot.lock.names.length}명과 함께 다섯 명을 채울 남은 보유 니케가 없다.`;
      else rest = withoutNames(rest, made.candidates[0].members.filter((m) => !slot.lock.names.includes(m)));
      tiers.push(tier);
      continue;
    }
    const names = Object.keys(rest.nikkes);
    const caps = {};
    const held = [];
    for (const s of STAGES) {
      const avail = names.filter((name) => [s, ANY_STAGE].includes(stageOf(catalog, name))).length;
      caps[s] = Math.max(1, Math.min(DEFAULT_STAGE_CAPS[s], avail - later));
      if (caps[s] < Math.min(DEFAULT_STAGE_CAPS[s], avail)) held.push(s);
    }
    const options = { limit: perTier, stageCaps: caps };
    if (slot.priorityElement) options.priorityElement = slot.priorityElement;
    const made = generateCandidates(rest, catalog, options);
    const tier = {
      deck: index,
      kind: 'free',
      candidates: made.squads.map((s) => ({ members: s.members })),
      considered: made.summary.considered,
      caps,
      held,
      uncovered: false,
      reason: made.squads.length === 0 ? (made.caveats[0] ?? '후보 편성을 만들 수 없다.') : null,
      priority: slot.priorityElement ?? null,
    };
    if (made.squads.length) rest = withoutNames(rest, made.squads[0].members);
    tiers.push(tier);
  }
  return { tiers, remaining: Object.keys(rest.nikkes) };
}

// ── 고르기: 겹치지 않는 묶음 중 가장 좋은 것(정확) ────────────────────────────────

/**
 * 계산된 후보에서 겹치지 않는 묶음을 고른다. 순수 함수이고 **정확하다** — 가지치기는 넘을 수 없는 상한으로만 한다.
 *
 * 자리는 묶음(`groups`)으로 나뉜다: 같은 묶음의 자리는 서로 바꿔도 같은 자리다(같은 조건의 고정하지 않은 덱들),
 * 후보(`entries`)는 자기 묶음의 자리에만 들어간다. 묶음마다 `slots`개까지 고르되 고른 후보 전체에서 어떤 니케도 두 번 나오지 않는다.
 * 목표: ① 고른 후보의 수가 가장 많다 ② 그중 `total`의 합이 가장 크다. 같으면 먼저 찾은 것(앞 묶음에서 총딜이 큰 후보를 고른 쪽)이다.
 *
 * @param {{key: string, slots: number}[]} groups
 * @param {{group: string, members: string[], total: number}[]} entries
 * @returns {{picks: object[], count: number, total: number, nodes: number}} `picks`는 고른 후보(받은 객체 그대로) — 묶음 순, 묶음 안은 총딜이 큰 순
 */
export function solveAllocation(groups, entries) {
  const lists = groups.map((g) =>
    entries
      .map((entry, order) => ({ entry, order }))
      .filter((x) => x.entry.group === g.key)
      .sort((a, b) => b.entry.total - a.entry.total || a.order - b.order)
      .map((x) => x.entry),
  );
  // prefix[g][i] = 묶음 g의 앞 i개 총딜의 합.
  const prefix = lists.map((list) => list.reduce((acc, e) => [...acc, acc[acc.length - 1] + e.total], [0]));
  const top = (g, from, n) => prefix[g][Math.min(lists[g].length, from + n)] - prefix[g][Math.min(lists[g].length, from)];
  const restCount = new Array(groups.length + 1).fill(0);
  const restSum = new Array(groups.length + 1).fill(0);
  for (let g = groups.length - 1; g >= 0; g -= 1) {
    restCount[g] = restCount[g + 1] + Math.min(groups[g].slots, lists[g].length);
    restSum[g] = restSum[g + 1] + top(g, 0, groups[g].slots);
  }

  const used = new Set();
  const chosen = [];
  let best = { count: -1, total: -1, picks: [] };
  let nodes = 0;

  function go(g, idx, left, count, sum) {
    nodes += 1;
    if (g === groups.length) {
      if (count > best.count || (count === best.count && sum > best.total)) best = { count, total: sum, picks: [...chosen] };
      return;
    }
    const list = lists[g];
    const canTake = Math.min(left, list.length - idx);
    const maxCount = count + canTake + restCount[g + 1];
    if (maxCount < best.count) return;
    if (maxCount === best.count && sum + top(g, idx, left) + restSum[g + 1] <= best.total) return;
    if (canTake <= 0) {
      go(g + 1, 0, groups[g + 1]?.slots ?? 0, count, sum);
      return;
    }
    const entry = list[idx];
    if (!entry.members.some((m) => used.has(m))) {
      for (const m of entry.members) used.add(m);
      chosen.push(entry);
      go(g, idx + 1, left - 1, count + 1, sum + entry.total);
      chosen.pop();
      for (const m of entry.members) used.delete(m);
    }
    go(g, idx + 1, left, count, sum);
  }
  go(0, 0, groups[0]?.slots ?? 0, 0, 0);
  return { picks: best.picks, count: Math.max(0, best.count), total: Math.max(0, best.total), nodes };
}

// ── 전체 흐름 ─────────────────────────────────────────────────────────────────

function mergeCacheStats(all) {
  const used = all.filter(Boolean);
  if (used.length === 0) return null;
  return {
    hits: used.reduce((s, c) => s + c.hits, 0),
    misses: used.reduce((s, c) => s + c.misses, 0),
    stored: used.reduce((s, c) => s + c.stored, 0),
    warnings: [...new Set(used.flatMap((c) => c.warnings ?? []))],
  };
}

/** 받은 조건(하나 또는 덱별 배열)을 덱마다의 조건 번호와 서로 다른 조건의 목록으로. */
function readConditions(condition, conditions, decks, catalog) {
  const given = conditions ?? condition;
  const perDeck = Array.isArray(given);
  if (perDeck && given.length !== decks) {
    throw new InputError('전투 조건이 잘못됐다', [{ path: '/conditions', message: `덱별 조건은 덱 수(${decks})만큼 줘야 한다 (지금 ${given.length}개)` }]);
  }
  const list = perDeck ? given : Array.from({ length: decks }, () => given);
  const distinct = [];
  const keys = [];
  const indexOf = list.map((c, i) => {
    const v = validateCondition(c, catalog);
    if (!v.ok) throw new InputError('전투 조건이 잘못됐다', v.errors.map((e) => ({ ...e, path: perDeck ? `/conditions/${i}${e.path}` : e.path })));
    const key = canonical(c);
    let at = keys.indexOf(key);
    if (at < 0) {
      at = keys.push(key) - 1;
      distinct.push(c);
    }
    return at;
  });
  return { perDeck, distinct, indexOf };
}

/**
 * 계정 + 전투 조건 → 겹치지 않는 덱 묶음(기본 5덱). 흐름은 이 파일 머리말의 네 단계다.
 *
 * - 어떤 니케도 두 덱에 들어가지 않는다(고정한 덱 포함). 보유하지 않은 니케는 쓰지 않는다.
 * - 시뮬 예산(`budget`)은 엔진에 맡기는 요청 수의 상한이다 — 캐시에서 채워진 요청도 센다(같은 입력이면 같은 결과가 나오게).
 * - 요청한 수만큼 만들 수 없으면 만든 만큼만 돌려주고 `shortage`에 까닭(어느 버스트 단계가 모자라는지)을 적는다.
 * - 같은 입력이면 `generated_at`·`cache` 말고는 같은 문서가 나온다.
 *
 * @param {{account: object, condition?: object|object[], conditions?: object[]}} input 조건 하나(모든 덱에) 또는 덱별 조건 배열
 * @param {{decks?: number, budget?: number, locked?: any, refine?: boolean, exclude?: string[]}} [options]
 *   `locked`는 normalizeLocked가 읽는 문서. `refine`(기본 true)을 끄면 자리 순서를 바꿔 보지 않는다.
 *   `exclude`(「안 씀」)는 그 니케들을 빼고 나눈다 — 고정한 니케는 빼지 않는다. 실제로 뺀 것이 있으면 결과에 `excluded`가 남는다.
 * @param {object} [deps] compareSquads와 같다. 더해서 `onStage({stage, stages, requests, used, budget})` — 엔진 배치를 맡기기 직전에 부른다
 * @returns {Promise<object>} docs/data-model.md §레이드 5덱 §결과
 */
export async function allocateDecks({ account: given, condition, conditions }, options = {}, deps = {}) {
  const fail = (path, message) => new InputError('레이드 덱 옵션이 잘못됐다', [{ path, message }]);
  const decks = options.decks ?? DEFAULT_DECKS;
  if (!isPositiveInt(decks) || decks > MAX_DECKS) throw fail('/decks', `덱 수는 1~${MAX_DECKS}의 정수여야 한다`);
  const budget = options.budget ?? DEFAULT_UNION_BUDGET;
  if (!isPositiveInt(budget)) throw fail('/budget', 'budget은 1 이상의 정수여야 한다');
  const refine = options.refine ?? true;
  if (typeof refine !== 'boolean') throw fail('/refine', 'refine은 true 또는 false여야 한다');
  if (options.exclude !== undefined && !isExcludeList(options.exclude)) throw fail('/exclude', 'exclude는 니케 이름의 목록이어야 한다');
  if ((conditions ?? condition) === undefined) throw new InputError('전투 조건이 없다', [{ path: '/condition', message: '조건 하나 또는 덱별 조건 배열을 줘야 한다' }]);

  const engine = engineAccess(deps);
  const catalog = await engine.catalog();
  const a = validateAccount(given, catalog);
  if (!a.ok) throw new InputError('계정 상태가 잘못됐다', a.errors);
  const conds = readConditions(condition, conditions, decks, catalog);

  // ── 고정: 보유한 니케여야 한다. 고정한 니케는 「안 씀」이어도 빼지 않는다(사용자가 그 덱에 넣으라고 한 것이다).
  const locks = normalizeLocked(options.locked, decks);
  const lockedNames = locks.flatMap((l) => l?.names ?? []);
  const notOwned = lockedNames.filter((name) => !Object.hasOwn(given.nikkes, name));
  if (notOwned.length) {
    throw new InputError('고정한 덱이 잘못됐다', [{ path: '/locked', message: `보유하지 않은 니케를 고정했다: ${notOwned.join(', ')}` }]);
  }
  const cut = excludeNikkes(given, (options.exclude ?? []).filter((name) => !lockedNames.includes(name)));
  const account = cut.account;
  const owned = Object.keys(account.nikkes);
  const scoreOf = (name) => investmentScore(account.nikkes[name]);

  const slots = locks.map((lock, index) => {
    const code = conds.distinct[conds.indexOf[index]]?.enemy?.code;
    return { index, lock, cond: conds.indexOf[index], priorityElement: isText(code) ? weaknessOf(code) : null };
  });
  const openSlots = slots.filter((s) => !s.lock?.full);
  const freeSlots = slots.filter((s) => !s.lock);
  const freeConds = [...new Set(freeSlots.map((s) => s.cond))].sort((x, y) => x - y);

  // ── 예산 나누기: 자리 순서 탐색 몫을 떼고 나머지가 후보 계산이다.
  const reserve = refine && freeSlots.length ? Math.min(Math.floor(budget * REFINE_SHARE), REFINE_PER_DECK * freeSlots.length) : 0;
  const stage1Budget = Math.max(1, budget - reserve);

  // ── 1. 후보 만들기.
  const plan = planCandidates({ account: withoutNames(account, lockedNames), catalog, slots, perTier: stage1Budget });
  for (const tier of plan.tiers) {
    const own = slots[tier.deck].cond;
    tier.cond = own;
    tier.conds = tier.kind === 'free' ? [own, ...freeConds.filter((c) => c !== own)] : [own];
  }

  // ── 2. 무엇을 계산할지(순서가 곧 예산의 우선순위다): 전체 고정한 덱 → 덱마다의 뼈대 → 나머지 후보를 덱마다 돌아가며.
  const wanted = [];
  const seen = new Set();
  const want = (members, cond, meta) => {
    const key = JSON.stringify([members, cond]);
    if (seen.has(key)) return;
    seen.add(key);
    wanted.push({ id: wanted.length, members, cond, ...meta });
  };
  for (const s of slots) if (s.lock?.full) want(s.lock.names, s.cond, { kind: 'locked', deck: s.index, label: `고정한 덱 ${s.index + 1}` });
  const tierLabel = (tier, nth) => `덱 ${tier.deck + 1} 후보 ${nth + 1}`;
  for (const tier of plan.tiers) {
    if (tier.candidates[0]) want(tier.candidates[0].members, tier.cond, { kind: tier.kind, deck: tier.deck, nth: 0, label: tierLabel(tier, 0) });
  }
  const longest = Math.max(0, ...plan.tiers.map((t) => t.candidates.length));
  for (let nth = 0; nth < longest; nth += 1) {
    for (const tier of plan.tiers) {
      const cand = tier.candidates[nth];
      if (!cand) continue;
      for (const cond of tier.conds) want(cand.members, cond, { kind: tier.kind, deck: tier.deck, nth, label: tierLabel(tier, nth) });
    }
  }
  const stage1 = wanted.slice(0, stage1Budget);
  const stage1Skipped = wanted.length - stage1.length;

  // ── 3. 계산: 조건마다 한 번의 엔진 배치.
  const onStage = typeof deps.onStage === 'function' ? deps.onStage : () => {};
  const stages = refine ? 2 : 1;
  const caches = [];
  const compareCaveats = [];
  const rejected = [];
  const failed = [];
  let evaluator = null;
  let used = 0;
  /** 요청 번호 → 계산된 순위 항목. */
  const computed = new Map();
  async function runGroup(stage, cond, items, nameOf) {
    onStage({ stage, stages, requests: items.length, used, budget });
    const report = await compareSquads(
      { account, condition: conds.distinct[cond], squads: items.map((it) => ({ name: nameOf(it), members: it.members })) },
      { ...deps, catalog },
    );
    used += items.length;
    evaluator ??= report.engine ?? null;
    caches.push(report.cache);
    compareCaveats.push(...report.caveats);
    return report;
  }
  for (let cond = 0; cond < conds.distinct.length; cond += 1) {
    const items = stage1.filter((w) => w.cond === cond);
    if (items.length === 0) continue;
    const byName = new Map(items.map((it) => [`#${it.id}`, it]));
    const report = await runGroup(1, cond, items, (it) => `#${it.id}`);
    for (const r of report.ranking) computed.set(byName.get(r.name).id, r);
    for (const r of report.rejected) rejected.push({ name: byName.get(r.name).label, members: r.members, reasons: r.reasons });
    for (const f of report.failed) failed.push({ name: byName.get(f.name).label, members: f.members, error: f.error });
  }

  // ── 4. 고르기(정확): 전체 고정한 덱 → 일부 고정한 덱 → 고정하지 않은 덱(조건이 같은 자리끼리 한 묶음).
  const groups = [
    ...slots.filter((s) => s.lock).map((s) => ({ key: `deck:${s.index}`, slots: 1 })),
    ...freeConds.map((c) => ({ key: `free:${c}`, slots: freeSlots.filter((s) => s.cond === c).length })),
  ];
  const entries = stage1
    .filter((w) => computed.has(w.id))
    .map((w) => ({ group: w.kind === 'free' ? `free:${w.cond}` : `deck:${w.deck}`, members: w.members, total: computed.get(w.id).total_damage, want: w }));
  const solved = solveAllocation(groups, entries);

  // 고른 것을 덱 자리에 놓는다. 고정하지 않은 덱은 같은 조건의 자리에 총딜이 큰 순으로.
  const placed = new Map(); // 덱 번호(0부터) → {want, entry}
  for (const g of groups) {
    const picks = solved.picks.filter((p) => p.group === g.key);
    const targets = g.key.startsWith('deck:') ? [Number(g.key.slice(5))] : freeSlots.filter((s) => `free:${s.cond}` === g.key).map((s) => s.index);
    picks.forEach((p, i) => placed.set(targets[i], { want: p.want, entry: { ...computed.get(p.want.id), name: `덱 ${targets[i] + 1}` } }));
  }

  // ── 5. 자리 순서: 고정하지 않은 덱만, 남은 예산으로(총딜이 큰 덱부터 돌아가며).
  let stage2 = null;
  if (refine) {
    const targets = freeSlots
      .filter((s) => placed.has(s.index))
      .map((s) => ({ index: s.index, cond: s.cond, entry: placed.get(s.index).entry }))
      .sort((x, y) => y.entry.total_damage - x.entry.total_damage || x.index - y.index);
    const planned = planRefinement(targets.map((t) => ({ name: t.entry.name, members: t.entry.members.map((m) => m.name) })), catalog, budget - used);
    const variants = new Map();
    for (const cond of freeConds) {
      const items = targets.flatMap((t, i) => (t.cond === cond ? planned.plan[i].selected.map((v, n) => ({ members: v.members, name: variantName(planned.plan[i].name, n + 1) })) : []));
      if (items.length === 0) continue;
      const report = await runGroup(2, cond, items, (it) => it.name);
      for (const r of report.ranking) variants.set(r.name, r);
      for (const r of report.rejected) rejected.push(r);
      for (const f of report.failed) failed.push(f);
    }
    let improved = 0;
    targets.forEach((t, i) => {
      const best = pickBestPlacement(t.entry, planned.plan[i], variants);
      if (best.placement.changed) improved += 1;
      placed.get(t.index).entry = best;
    });
    // 같은 조건의 고정하지 않은 덱끼리는 자리 순서를 바꾼 뒤의 총딜이 큰 순으로 다시 놓는다(덱 1이 가장 센 덱).
    for (const cond of freeConds) {
      const at = freeSlots.filter((s) => s.cond === cond && placed.has(s.index)).map((s) => s.index);
      const sorted = at.map((i) => placed.get(i)).sort((x, y) => y.entry.total_damage - x.entry.total_damage);
      at.forEach((index, i) => placed.set(index, { ...sorted[i], entry: { ...sorted[i].entry, name: `덱 ${index + 1}` } }));
    }
    stage2 = {
      decks: targets.length,
      variants: planned.total,
      requested: planned.requested,
      skipped: planned.skipped,
      improved,
    };
  }

  // ── 결과 문서.
  const tierOf = new Map(plan.tiers.map((t) => [t.deck, t]));
  const deckDocs = slots.map((s) => {
    const base = {
      deck: s.index + 1,
      lock: s.lock ? (s.lock.full ? 'full' : 'partial') : 'none',
      locked: s.lock ? [...s.lock.slots] : null,
      condition_index: s.cond,
    };
    const got = placed.get(s.index);
    if (got) {
      const e = got.entry;
      return {
        ...base,
        status: 'computed',
        members: e.members,
        total_damage: e.total_damage,
        notes: e.notes,
        engine_warnings: e.engine_warnings,
        ungrown_members: e.ungrown_members,
        placement: e.placement ?? null,
        reason: null,
      };
    }
    // 못 채운 덱: 전체 고정한 덱은 「계산하지 못함」(0이 아니다), 그 밖은 빈 덱이다.
    let reason;
    if (s.lock?.full) {
      const mine = wanted.find((w) => w.kind === 'locked' && w.deck === s.index);
      const why = rejected.find((r) => r.name === mine?.label)?.reasons.join(' / ') ?? failed.find((f) => f.name === mine?.label)?.error?.message;
      reason = why ?? (mine && mine.id >= stage1.length ? `계산 횟수(${budget}건)가 모자라 계산하지 못했다.` : '계산하지 못했다.');
    } else {
      reason = tierOf.get(s.index)?.reason ?? '계산된 후보 안에 다른 덱과 겹치지 않는 편성이 없었다.';
    }
    return { ...base, status: s.lock?.full ? 'failed' : 'empty', members: [], total_damage: null, notes: [], engine_warnings: [], ungrown_members: [], placement: null, reason };
  });
  const made = deckDocs.filter((d) => d.status === 'computed');
  const inDecks = new Set([...made.flatMap((d) => d.members.map((m) => m.name)), ...lockedNames]);
  const unused = owned.filter((name) => !inDecks.has(name)).sort((x, y) => scoreOf(y) - scoreOf(x) || byCode(x, y));
  const uncomputed = stage1Skipped + stage1.filter((w) => !computed.has(w.id)).length;
  const shortage = shortageOf({ requested: decks, made: made.length, unused, owned, catalog, uncomputed });
  // 고정했지만 계산하지 못한 덱은 「더 짤 수 있었다」와 다른 까닭이다 — 따로 적는다(그 니케들은 쓰지 않은 니케로 세지 않는다).
  const failedLocked = deckDocs.filter((d) => d.status === 'failed');
  if (shortage && failedLocked.length) shortage.text += ` 고정한 덱 ${failedLocked.length}개(${failedLocked.map((d) => `덱 ${d.deck}`).join(', ')})는 계산하지 못했다.`;
  const totalDamage = made.reduce((sum, d) => sum + d.total_damage, 0);

  const uniqueSquads = (list) => new Set(list.map((w) => JSON.stringify(w.members))).size;
  const search = {
    refine,
    budget,
    sims: used,
    stage1: {
      budget: stage1Budget,
      requested: stage1.length,
      skipped: stage1Skipped,
      generated: uniqueSquads(wanted),
      computed: uniqueSquads(stage1.filter((w) => computed.has(w.id))),
      tiers: plan.tiers.map((t) => ({
        deck: t.deck + 1,
        kind: t.kind,
        considered: t.considered,
        generated: t.candidates.length,
        simulated: uniqueSquads(stage1.filter((w) => w.deck === t.deck && w.kind === t.kind)),
        pool_caps: t.caps,
        held_back: t.held,
        reason: t.reason,
      })),
    },
    stage2,
    examined: solved.nodes,
  };

  // ── 주의 문장.
  const caveats = [
    '수치는 시뮬레이션 추정치다. 실제 레이드 기록과 대조하지 않았다.',
    `계산한 후보 덱 안에서 고른 배분이다 — 전체에서 가장 좋은 배분이라는 뜻이 아니다. 계산한 후보(${search.stage1.computed}개) 안에서는 ` +
      '겹치지 않는 묶음 중 덱 수가 가장 많고 그중 합계가 가장 큰 것을 빠짐없이 찾았다.',
    `후보 덱은 덱 순서대로 만들었다: 덱마다 남은 보유 니케에서 버스트 단계별 투자 점수 상위(1단계 ${DEFAULT_STAGE_CAPS[1]} · 2단계 ${DEFAULT_STAGE_CAPS[2]} · 3단계 ${DEFAULT_STAGE_CAPS[3]}명)만 ` +
      '후보 풀로 써서 조합을 만들고, 그 덱에서 투자 점수 합이 가장 높은 조합(뼈대)의 니케를 다음 덱의 풀에서 뺐다. 그래서 뒤 덱의 후보에는 앞 덱 뼈대의 니케가 없다.',
    '투자 점수는 스킬 레벨·돌파·코어 강화·오버로드 줄 수를 같은 비중으로 더한 값이다. 성능 추정이 아니다 — 덜 키웠지만 강한 니케나 시너지 조합이 빠질 수 있다.',
    `시뮬 예산 ${budget}건 중 ${used}건을 썼다: 후보 계산 ${stage1.length}건(고정한 덱 → 덱마다의 뼈대 → 나머지 후보를 덱마다 돌아가며, 투자 점수 합이 높은 순)` +
      (stage2 ? ` + 자리 순서 ${stage2.requested}건.` : '.'),
  ];
  if (stage1Skipped > 0) caveats.push(`예산이 모자라 만든 후보 계산 ${wanted.length}건 중 ${stage1Skipped}건(후보 순서의 뒤쪽)은 계산하지 못했다.`);
  const held = plan.tiers.filter((t) => t.held.length);
  if (held.length) {
    caveats.push(
      `뒤 덱이 쓸 니케를 남기려고 후보 풀을 줄인 덱: ${held.map((t) => `덱 ${t.deck + 1}(버스트 ${t.held.join('·')}단계)`).join(', ')} — ` +
        '그 단계의 남은 니케 수에서 뒤에 채울 덱 수를 뺀 만큼만 풀에 넣었다.',
    );
  }
  if (conds.perDeck && conds.distinct.length > 1) {
    caveats.push(
      `덱마다 조건이 다르다(서로 다른 조건 ${conds.distinct.length}종): 고정하지 않은 덱의 후보는 고정하지 않은 덱들의 조건 ${freeConds.length}종마다 따로 계산했다 — 후보 하나에 시뮬이 그만큼 든다. ` +
        '조건이 같은 덱끼리는 총딜이 큰 순으로 놓았다.',
    );
  }
  if (slots.some((s) => s.priorityElement)) {
    caveats.push('적 속성이 조건에 적힌 덱은 그 약점 속성 니케를 후보 풀에 단계마다 최소 2명 넣고 후보 순서에서 앞에 뒀다(어림 규칙 — 순위는 계산한 총딜로 정한다).');
  }
  const lockedSlots = slots.filter((s) => s.lock);
  if (lockedSlots.length) {
    caveats.push(
      `고정한 덱 ${lockedSlots.length}개(${lockedSlots.map((s) => `덱 ${s.index + 1}${s.lock.full ? '' : ` 일부 ${s.lock.names.length}명`}`).join(', ')}): 고정한 니케는 다른 덱의 후보에서 뺐다. ` +
        '전체를 고정한 덱은 받은 자리 순서 그대로 계산했고, 일부 자리를 고정한 덱은 고정한 니케를 그 자리에 두고 나머지를 채웠다(자리 순서는 바꿔 보지 않았다).',
    );
  }
  if (plan.tiers.some((t) => t.uncovered)) caveats.push('일부 자리를 고정한 덱 가운데 고정한 니케만으로 버스트 1·2·3단계를 갖출 수 없는 덱이 있다 — 단계를 따지지 않고 채웠다(풀 버스트가 열리지 않을 수 있다).');
  if (stage2) {
    caveats.push(
      `자리 순서: 고른 덱 ${stage2.decks}개(고정하지 않은 덱)에만, 같은 버스트 단계 안의 순서와 3번 자리(카메라)를 바꾼 배치 ${stage2.requested}개를 더 계산해 덱마다 가장 좋은 순서를 남겼다` +
        (stage2.skipped > 0 ? ` — 예산이 모자라 배치 변형 ${stage2.variants}개 중 ${stage2.skipped}개는 계산하지 못했다.` : '.') +
        ' 자리 순서는 덱을 고른 뒤에 본 것이다 — 고르는 단계의 총딜은 후보 생성기가 만든 배치 하나의 값이다.',
    );
  } else {
    caveats.push('자리 순서는 바꿔 보지 않았다 — 덱마다 후보 생성기가 만든 배치 하나만 계산했다.');
  }
  if (failed.length) caveats.push(`계산 도구가 계산하지 못한 후보 ${failed.length}개는 0으로 두지 않고 뺐다.`);
  if (shortage) caveats.push(shortage.text);
  caveats.push(`지원하지 않음: ${UNION_UNSUPPORTED.join(' / ')}.`);
  caveats.push(...new Set(compareCaveats.filter((c) => c !== CAVEAT_NOT_VERIFIED && !c.startsWith('후보로 준 편성 안에서의 비교다'))));
  if (compareCaveats.length === 0) caveats.push(...a.warnings);
  if (cut.excluded) caveats.push(cut.excluded.text);

  const conditionDocs = conds.distinct.map((c, index) => ({
    index,
    decks: slots.filter((s) => s.cond === index).map((s) => s.index + 1),
    condition: c,
    assumptions: assumptionsOf(c, levelPlan(c, account)),
  }));

  return {
    schema_version: UNION_REPORT_SCHEMA_VERSION,
    kind: UNION_REPORT_KIND,
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
    account: { name: account.name ?? null, is_test_data: account.is_test_data, updated_at: account.updated_at ?? null },
    mode: conds.perDeck ? 'per_deck' : 'single',
    requested: decks,
    made: made.length,
    total_damage: totalDamage,
    conditions: conditionDocs,
    decks: deckDocs,
    // 어느 덱에도 들지 않은 보유 니케(많이 키운 순). 고정한 니케와 뺀(「안 씀」) 니케는 여기에 없다.
    unused,
    shortage,
    search,
    assumptions: [...new Set(conditionDocs.flatMap((c) => c.assumptions))],
    unsupported: [...UNION_UNSUPPORTED],
    engine: evaluator ?? (await engine.version()),
    // 시뮬 결과 캐시 통계(엔진 배치들의 합). 캐시를 쓰지 않는 런타임이면 null이다.
    cache: mergeCacheStats(caches),
    rejected,
    failed,
    caveats,
    ...(cut.excluded ? { excluded: cut.excluded } : {}),
  };
}
