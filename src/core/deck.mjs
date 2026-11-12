// 덱 빌더(P-030) — 손으로 짠 편성 하나를 계산하고 바꿔 보는 순수 모듈.
//   편성 짜기   다섯 자리에 넣고 빼고 자리를 바꾼다(같은 니케는 한 번만), 버스트 단계 구성에서 무엇이 모자란지 말한다
//   상대        이상 개체 보스(보스 묶음) · 엔진의 보스 프리셋 · 「속성만 정하기」(약점 속성 다섯 + 속성 없음) → 전투 조건
//   바로 계산   그 편성을 「내 계정 육성」과 「엔진 기본 스펙」 둘로 계산해 나란히 둔다
//   한 명을 바꾼다면  한 자리에 같은 버스트 묶음의 보유 니케를 하나씩 넣어 총딜 변화 순으로
//   자리 순서 비교    같은 다섯의 자리 변형(src/core/search.mjs — P-013의 규칙) 가운데 가장 좋은 순서
//   내 편성     다섯 칸(01~05)과 이름 붙인 목록(계정마다 두는 문서), 편성을 글자로(복사용)
//
// 계산은 전부 compareSquads(src/core/compare.mjs)가 한다 — 여기에는 엔진 요청을 만드는 코드가 없다. 자리 변형은 search.mjs,
// 보스 → 전투 조건과 미확인 칸은 intercept.mjs의 것을 그대로 쓴다. `node:` 모듈을 import하지 않는다(웹뷰와 Node가 함께 쓴다).
// 형식은 docs/data-model.md §덱 빌더.
//
// 다루지 않는 것(지원하지 않음 — 결과의 caveats에도 적는다): 버스트 순서·조작 같은 운용 지정, 보스 패턴, PVP,
// 다른 사람의 편성(랭커 덱)·통계. 엔진이 계산하지 못한 편성은 0으로 두지 않고 「계산하지 못함」으로 돌려준다.
import { investmentScore } from './candidates.mjs';
import { compareSquads, ENGINE_DEFAULT_SPEC_TEXT, GROWTH_ACCOUNT, GROWTH_ENGINE_DEFAULT, InputError, SQUAD_SIZE } from './compare.mjs';
import { CONDITION_SCHEMA_VERSION } from './condition.mjs';
import { formatDamage } from './format.mjs';
import { bossCondition, ELEMENTS, resolveElement, unconfirmedOf } from './intercept.mjs';
import { engineAccess } from './runtime.mjs';
import { burstOrderGroup, gainText, pickBestPlacement, planRefinement, variantName } from './search.mjs';

export { GROWTH_ACCOUNT, GROWTH_ENGINE_DEFAULT };

export const DECK_SIZE = SQUAD_SIZE;
export const DECK_REPORT_SCHEMA_VERSION = 1;
/** 「한 명을 바꾼다면」이 한 번에 계산하는 니케 수의 기본 상한. */
export const DEFAULT_SWAP_LIMIT = 12;
/** 「자리 순서 비교」가 한 번에 계산하는 자리 변형 수의 기본 상한. */
export const DEFAULT_ORDER_LIMIT = 24;

const STAGES = ['1', '2', '3'];
const ANY_STAGE = 'A';
const CURRENT = '지금 편성';
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const infoOf = (catalog, name) => (Object.hasOwn(catalog?.nikkes ?? {}, name) ? catalog.nikkes[name] : null);

// ── 편성 짜기 ─────────────────────────────────────────────────────────────────

/** 빈 다섯 자리. */
export const emptySlots = () => Array.from({ length: DECK_SIZE }, () => null);

/** 무엇이 오든 다섯 자리(이름 또는 null)로 만든다. 같은 이름이 두 번 있으면 뒤의 것을 비운다. */
export function normalizeSlots(slots) {
  const seen = new Set();
  return Array.from({ length: DECK_SIZE }, (_, i) => {
    const name = Array.isArray(slots) && isText(slots[i]) ? slots[i] : null;
    if (name === null || seen.has(name)) return null;
    seen.add(name);
    return name;
  });
}

export const filledMembers = (slots) => normalizeSlots(slots).filter((n) => n !== null);
export const isFull = (slots) => filledMembers(slots).length === DECK_SIZE;

/**
 * 니케를 자리에 넣는다. `index`를 주지 않으면 앞에서부터 첫 빈 자리다. 받은 배열은 바꾸지 않는다.
 * 넣지 못하면 `problem`(한국어 문장)이 있고 `slots`는 그대로다 — 같은 니케를 두 번 넣을 수 없다.
 * @param {(string|null)[]} slots
 * @param {string} name
 * @param {number|null} [index]
 * @returns {{slots: (string|null)[], placed: number|null, problem: string|null}}
 */
export function placeMember(slots, name, index = null) {
  const now = normalizeSlots(slots);
  const refuse = (problem) => ({ slots: now, placed: null, problem });
  if (!isText(name)) return refuse('넣을 니케를 고르지 않았다.');
  if (now.includes(name)) return refuse(`${name}은(는) 이미 편성에 있다 — 같은 니케를 두 번 넣을 수 없다.`);
  let at = index;
  if (at === null || at === undefined) {
    at = now.indexOf(null);
    if (at < 0) return refuse('다섯 자리가 모두 찼다 — 자리 하나를 비우거나 바꿀 자리를 고른다.');
  }
  if (!Number.isInteger(at) || at < 0 || at >= DECK_SIZE) return refuse('없는 자리다.');
  const next = [...now];
  next[at] = name;
  return { slots: next, placed: at, problem: null };
}

/** 자리 하나를 비운다. */
export function removeMember(slots, index) {
  const next = normalizeSlots(slots);
  if (Number.isInteger(index) && index >= 0 && index < DECK_SIZE) next[index] = null;
  return next;
}

/** 두 자리의 니케를 맞바꾼다(끌어다 놓기·옆으로 옮기기). 빈 자리와도 바꾼다. */
export function moveMember(slots, from, to) {
  const next = normalizeSlots(slots);
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < DECK_SIZE;
  if (!ok(from) || !ok(to) || from === to) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * 버스트 단계 구성. 풀 버스트는 1·2·3단계가 모두 있어야 열린다 — 어느 단계에서나 쓰는 니케(A)는 빈 단계 하나를 채운다
 * (candidates.mjs의 coversAllBurstStages와 같은 규칙). 자리가 다 차지 않았어도 지금 무엇이 없는지 말한다.
 * @returns {{counts: {1: number, 2: number, 3: number, A: number, unknown: number}, missing: string[], uncovered: number,
 *   ok: boolean, full: boolean, text: string|null}} `ok` = 빈 단계가 없다(A가 채운 것 포함). `text` = 모자란 것이 있을 때의 한 문장
 */
export function burstCheck(slots, catalog) {
  const members = filledMembers(slots);
  const counts = { 1: 0, 2: 0, 3: 0, A: 0, unknown: 0 };
  for (const name of members) {
    const stage = infoOf(catalog, name)?.burst_stage;
    if (STAGES.includes(stage) || stage === ANY_STAGE) counts[stage] += 1;
    else counts.unknown += 1;
  }
  const missing = STAGES.filter((s) => counts[s] === 0);
  const uncovered = Math.max(0, missing.length - counts.A);
  const full = members.length === DECK_SIZE;
  let text = null;
  if (uncovered > 0) {
    text = `버스트 ${missing.join('·')}단계 니케가 없다`;
    if (counts.A > 0) text += ` — 어느 단계에서나 쓰는 니케 ${counts.A}명이 그중 ${counts.A}단계만 채운다`;
    text += full ? '. 풀 버스트가 열리지 않을 수 있다.' : '.';
  }
  if (counts.unknown > 0) text = `${text ? `${text} ` : ''}버스트 단계를 모르는 니케가 ${counts.unknown}명 있다.`;
  return { counts, missing, uncovered, ok: uncovered === 0, full, text };
}

/** 계산 결과가 어느 편성·어느 상대의 것인지 견주는 열쇠(자리 순서가 다르면 다른 편성이다). */
export const deckKey = (slots, opponentKey) => JSON.stringify([normalizeSlots(slots), opponentKey ?? null]);

// ── 상대 고르기 ────────────────────────────────────────────────────────────────

/** 「속성만 정하기」에서 속성 없음을 고른 것. */
export const NO_ELEMENT = 'none';
export const OPPONENT_GROUPS = Object.freeze({ boss: '이상 개체', preset: '솔로 레이드', element: '속성만 정하기' });

/**
 * 고를 수 있는 상대의 목록(이 순서로 보인다): 보스 묶음의 보스 → 엔진의 보스 프리셋 → 약점 속성 다섯 + 속성 없음.
 * @param {{bundle?: any, catalog?: any}} [sources] 보스 묶음과 엔진 카탈로그(없으면 속성만 남는다)
 * @returns {{key: string, kind: 'boss'|'preset'|'element', id: string, label: string, weak_to: string|null}[]}
 */
export function listOpponents(sources = {}) {
  const { bundle = null, catalog = null } = sources;
  const out = [];
  for (const b of Array.isArray(bundle?.bosses) ? bundle.bosses : []) {
    if (!isText(b?.id) || !isText(b?.name)) continue;
    out.push({ key: `boss:${b.id}`, kind: 'boss', id: b.id, label: b.name, weak_to: resolveElement(b).weak_to });
  }
  for (const name of Array.isArray(catalog?.bosses) ? catalog.bosses : []) {
    if (isText(name)) out.push({ key: `preset:${name}`, kind: 'preset', id: name, label: name, weak_to: null });
  }
  for (const e of ELEMENTS) out.push({ key: `element:${e}`, kind: 'element', id: e, label: `약점 ${e}`, weak_to: e });
  out.push({ key: `element:${NO_ELEMENT}`, kind: 'element', id: NO_ELEMENT, label: '속성 없음', weak_to: null });
  return out;
}

/**
 * 고른 상대 → 전투 조건과, 결과와 함께 보여야 하는 것(약점·미확인 칸·표시).
 *
 *   boss     보스 묶음의 그 보스. 요격전 추천과 같은 조건(intercept.mjs의 bossCondition)·같은 미확인 칸(unconfirmedOf)이다.
 *   preset   엔진의 보스 프리셋 이름 그대로(`boss`). 보스의 값은 엔진 안에 있다 — 이 모듈은 그 속성·약점을 모른다(`element.known: false`).
 *   element  적 속성만 정한 적: 약점 속성에 약한 속성(엔진의 속성 상성 규칙)을 적 속성으로 넣는다. 그 밖의 칸은 전부 미확인이라
 *            엔진 기본 적 값으로 계산된다. 속성 없음이면 적 속성도 넣지 않는다 — 「속성 상성 미반영」.
 *
 * 모르는 열쇠(묶음에서 빠진 보스, 엔진에 없는 프리셋)면 null.
 * @param {string|null} key
 * @param {{bundle?: any, catalog?: any}} [sources]
 * @returns {null | {key: string, kind: string, id: string, label: string, condition: object, element: object,
 *   unconfirmed: {field: string, label: string, computed_as: unknown, text: string}[], flags: string[], notes: string[], is_test_data: boolean}}
 */
export function resolveOpponent(key, sources = {}) {
  const { bundle = null, catalog = null } = sources;
  if (!isText(key)) return null;
  const cut = key.indexOf(':');
  const kind = cut < 0 ? '' : key.slice(0, cut);
  const id = cut < 0 ? '' : key.slice(cut + 1);

  if (kind === 'boss') {
    const boss = (Array.isArray(bundle?.bosses) ? bundle.bosses : []).find((b) => b?.id === id);
    if (!boss) return null;
    const element = { ...resolveElement(boss), known: true };
    const notes = ['보스 패턴 미반영: 무적·보호막·특수 기믹, 단계별 체력은 계산에 없다 — 보스를 적 설정(속성·방어력 등)만으로 표현했다.'];
    if (element.reflected && element.code_source === 'weak_to') {
      notes.push(`보스 속성(${element.code})은 화면에서 확인한 값이 아니다 — 약점(${element.weak_to})에서 엔진의 속성 상성 규칙으로 정했다.`);
    }
    return {
      key,
      kind,
      id,
      label: boss.name,
      condition: bossCondition(boss, bundle.content ?? 'anomaly_interception'),
      element,
      // 약점은 계산 입력이 아니다(상성은 보스 속성으로 정한다) — 요격전 화면·CLI 표와 같이 세지 않는다.
      unconfirmed: unconfirmedOf(boss).filter((u) => u.field !== 'weak_to'),
      flags: element.reflected ? [] : ['속성 상성 미반영'],
      notes,
      is_test_data: bundle.is_test_data === true,
    };
  }

  if (kind === 'preset') {
    if (!(Array.isArray(catalog?.bosses) && catalog.bosses.includes(id))) return null;
    return {
      key,
      kind,
      id,
      label: id,
      condition: { schema_version: CONDITION_SCHEMA_VERSION, content: 'solo_raid', boss: id },
      element: { code: null, code_source: null, weak_to: null, weak_to_source: null, reflected: true, known: false },
      unconfirmed: [],
      flags: [],
      notes: ['보스의 속성·방어력·코어는 엔진의 보스 프리셋에 든 값으로 계산한다 — 이 화면은 그 값을 따로 알지 못한다(약점 속성을 표시하지 않는다).'],
      is_test_data: false,
    };
  }

  if (kind === 'element') {
    if (id !== NO_ELEMENT && !ELEMENTS.includes(id)) return null;
    // 속성만 아는 가상의 적: 요격전의 보스와 같은 길로 조건과 미확인 칸을 만든다.
    const pseudo = id === NO_ELEMENT ? { id: 'element-none', name: '속성 없음', enemy: {} } : { id: `element-${id}`, name: `약점 ${id}`, enemy: {}, weak_to: id };
    const element = { ...resolveElement(pseudo), known: true };
    return {
      key,
      kind,
      id,
      label: pseudo.name,
      condition: bossCondition(pseudo, 'custom'),
      element,
      // 사용자가 고른 속성은 미확인이 아니다. 속성 없음이면 「속성 없음(엔진 기본값)」이 미확인 칸으로 남는다.
      unconfirmed: unconfirmedOf(pseudo).filter((u) => u.field !== 'weak_to' && !(u.field === 'code' && id !== NO_ELEMENT)),
      flags: element.reflected ? [] : ['속성 상성 미반영'],
      notes: [
        id === NO_ELEMENT
          ? '속성 상성 미반영 — 적 속성 없이 계산했다. 어느 니케에도 우월 코드 보너스가 붙지 않는다.'
          : `적 속성만 정했다(약점 ${id} → 적 속성 ${element.code}, 엔진의 속성 상성 규칙). 특정 보스가 아니다 — 그 밖의 값은 전부 엔진 기본 적 값이다.`,
      ],
      is_test_data: false,
    };
  }
  return null;
}

// ── 바로 계산 ─────────────────────────────────────────────────────────────────

/** 육성 기준의 이름(화면과 복사한 글에 쓴다). */
export const BASIS_LABELS = Object.freeze({ [GROWTH_ACCOUNT]: '내 계정 육성', [GROWTH_ENGINE_DEFAULT]: '모두 최대 육성' });
const BASIS_SQUAD = Object.freeze({ [GROWTH_ACCOUNT]: '내 계정 육성', [GROWTH_ENGINE_DEFAULT]: '모두 최대 육성(엔진 기본 스펙)' });

function requireOpponent(opponent) {
  if (!opponent || typeof opponent !== 'object' || !opponent.condition) {
    throw new InputError('상대가 없다', [{ path: '/opponent', message: '상대(보스·프리셋·속성)를 골라야 한다' }]);
  }
}

function requireFull(members) {
  const names = filledMembers(members);
  if (!Array.isArray(members) || names.length !== DECK_SIZE) {
    throw new InputError('편성이 덜 찼다', [{ path: '/members', message: `다섯 자리를 모두 채워야 계산한다 (지금 ${names.length}명)` }]);
  }
  return names;
}

const opponentBrief = (o) => ({
  key: o.key,
  kind: o.kind,
  id: o.id,
  label: o.label,
  element: o.element,
  unconfirmed: o.unconfirmed,
  flags: o.flags,
  notes: o.notes,
  is_test_data: o.is_test_data,
  condition: o.condition,
});

/** 비교 결과에서 이름으로 한 편성의 결과를 꺼낸다: 계산됨 · 거부됨(계산 전 검사에 걸림) · 실패(엔진이 계산하지 못함). */
function outcomeOf(report, name) {
  const done = report.ranking.find((r) => r.name === name);
  if (done) {
    return {
      status: 'computed',
      total_damage: done.total_damage,
      members: done.members,
      notes: done.notes,
      engine_warnings: done.engine_warnings,
      ungrown_members: done.ungrown_members,
      level: done.level ?? null,
    };
  }
  const rejected = report.rejected.find((r) => r.name === name);
  if (rejected) return { status: 'rejected', reasons: rejected.reasons };
  const failed = report.failed.find((r) => r.name === name);
  // 엔진이 계산하지 못한 편성(스킬 미파싱 니케 등)은 0이 아니다 — 「계산하지 못함」이고 엔진의 말을 그대로 싣는다.
  if (failed) return { status: 'failed', error: failed.error };
  return { status: 'failed', error: { type: 'missing', message: '결과에 이 편성이 없다', path: null } };
}

/**
 * 「내 계정 육성」 대 「모두 최대 육성」을 한 줄로. 둘 다 계산됐을 때만.
 * 판정(조합이 약하다·덜 키웠다)을 내리지 않는다 — 그럴 기준이 없다. 비율과, 그것을 어떻게 읽는지만 말한다.
 */
export function growthLine(accountTotal, defaultTotal) {
  if (!(Number.isFinite(accountTotal) && Number.isFinite(defaultTotal) && defaultTotal > 0 && accountTotal >= 0)) return null;
  const ratio = accountTotal / defaultTotal;
  const percent = Math.round(ratio * 100);
  const head = `지금 육성으로는 모두 최대 육성일 때의 ${percent}%다`;
  const tail =
    ratio >= 1
      ? ' — 이 편성은 기준만큼(또는 그 이상) 키웠다. 더 올리려면 조합이나 자리 순서를 바꿔 본다.'
      : ` — 같은 조합을 끝까지 키우면 ${formatDamage(Math.round(defaultTotal))}까지 오른다. 그 값도 낮으면 조합을 바꿔 본다.`;
  return { ratio, text: `${head}${tail}` };
}

/**
 * 편성 하나를 두 육성 기준으로 계산한다(엔진 요청 두 건 — 캐시에 있으면 엔진을 부르지 않는다).
 * @param {{account: object, opponent: object, members: (string|null)[]}} input `opponent`는 resolveOpponent의 결과
 * @param {object} [deps] compareSquads와 같다
 * @returns {Promise<object>} 덱 계산 결과(docs/data-model.md §덱 빌더 §계산 결과)
 */
export async function evaluateDeck({ account, opponent, members }, deps = {}) {
  requireOpponent(opponent);
  const names = requireFull(members);
  const report = await compareSquads(
    {
      account,
      condition: opponent.condition,
      squads: [
        { name: BASIS_SQUAD[GROWTH_ACCOUNT], members: names },
        { name: BASIS_SQUAD[GROWTH_ENGINE_DEFAULT], members: names, growth: GROWTH_ENGINE_DEFAULT },
      ],
    },
    deps,
  );
  const mine = outcomeOf(report, BASIS_SQUAD[GROWTH_ACCOUNT]);
  const max = outcomeOf(report, BASIS_SQUAD[GROWTH_ENGINE_DEFAULT]);
  return {
    schema_version: DECK_REPORT_SCHEMA_VERSION,
    kind: 'deck_report',
    generated_at: report.generated_at,
    key: deckKey(names, opponent.key),
    account: report.account,
    opponent: opponentBrief(opponent),
    members: names,
    results: { [GROWTH_ACCOUNT]: mine, [GROWTH_ENGINE_DEFAULT]: max },
    growth: mine.status === 'computed' && max.status === 'computed' ? growthLine(mine.total_damage, max.total_damage) : null,
    engine_default_spec: ENGINE_DEFAULT_SPEC_TEXT,
    assumptions: report.assumptions,
    engine: report.engine,
    cache: report.cache,
    caveats: [
      '수치는 계산으로 어림한 값이다. 실제 전투 기록과 대조하지 않았다.',
      ...opponent.notes,
      ...report.caveats.filter((c) => !c.startsWith('후보로 준 편성 안에서의 비교다') && !c.startsWith('수치는 시뮬레이션 추정치다')),
      '지원하지 않음: 버스트를 누가 쓰지 않을지·조작 같은 운용 지정(엔진의 캐릭터별 기본값으로 계산한다), PVP, 다른 사람의 편성과 통계.',
    ],
  };
}

// ── 한 명을 바꾼다면 ──────────────────────────────────────────────────────────

/**
 * 한 자리에 넣어 볼 보유 니케. 그 자리의 니케와 **같은 버스트 묶음**(search.mjs의 burstOrderGroup — 어느 단계에서나 쓰는
 * 니케는 3단계 묶음)이고 편성에 없는 니케다. 많이 키운 순(투자 점수 — 성능 추정이 아니다), 같으면 이름순으로 `limit`명만 고른다.
 * @param {{members: (string|null)[], slot: number, account: any, catalog: any, limit?: number}} input
 * @returns {{out: string|null, group: string|null, candidates: string[], skipped: string[], total: number}}
 *   `skipped` = 상한 때문에 보지 않는 니케(덜 키운 쪽)
 */
export function swapCandidates(input) {
  const { members, slot, account, catalog, limit = DEFAULT_SWAP_LIMIT } = input;
  const slots = normalizeSlots(members);
  const out = Number.isInteger(slot) ? (slots[slot] ?? null) : null;
  const group = out === null ? null : burstOrderGroup(infoOf(catalog, out));
  if (out === null || group === null) return { out, group, candidates: [], skipped: [], total: 0 };
  const fits = Object.keys(account?.nikkes ?? {})
    .filter((name) => !slots.includes(name) && burstOrderGroup(infoOf(catalog, name)) === group)
    .map((name) => ({ name, score: investmentScore(account.nikkes[name]) }))
    .sort((a, b) => b.score - a.score || byCode(a.name, b.name))
    .map((c) => c.name);
  const cap = isPositiveInt(limit) ? limit : DEFAULT_SWAP_LIMIT;
  return { out, group, candidates: fits.slice(0, cap), skipped: fits.slice(cap), total: fits.length };
}

const swapName = (name) => `교체: ${name}`;

/**
 * 한 자리의 니케를 다른 보유 니케로 바꿨을 때의 총딜. 지금 편성과 교체 편성들을 한 번에 계산해(compareSquads)
 * 총딜이 큰 순으로 돌려준다. 계산은 계정의 육성 기준이다.
 * @param {{account: object, opponent: object, members: (string|null)[], slot: number}} input
 * @param {{limit?: number}} [options] 계산할 니케 수의 상한(기본 12)
 * @returns {Promise<object>} docs/data-model.md §덱 빌더 §한 명을 바꾼다면
 */
export async function swapOne({ account, opponent, members, slot }, options = {}, deps = {}) {
  requireOpponent(opponent);
  const names = requireFull(members);
  if (!Number.isInteger(slot) || slot < 0 || slot >= DECK_SIZE) {
    throw new InputError('바꿀 자리가 없다', [{ path: '/slot', message: `자리는 0~${DECK_SIZE - 1}이어야 한다` }]);
  }
  const limit = options.limit ?? DEFAULT_SWAP_LIMIT;
  if (!isPositiveInt(limit)) throw new InputError('옵션이 잘못됐다', [{ path: '/limit', message: 'limit은 1 이상의 정수여야 한다' }]);
  const catalog = await engineAccess(deps).catalog();
  const picked = swapCandidates({ members: names, slot, account, catalog, limit });
  const replaced = (name) => names.map((m, i) => (i === slot ? name : m));

  const report = await compareSquads(
    {
      account,
      condition: opponent.condition,
      squads: [{ name: CURRENT, members: names }, ...picked.candidates.map((name) => ({ name: swapName(name), members: replaced(name) }))],
    },
    { ...deps, catalog },
  );
  const baseline = outcomeOf(report, CURRENT);
  const base = baseline.status === 'computed' ? baseline.total_damage : null;
  const rows = [];
  const failed = [];
  for (const name of picked.candidates) {
    const r = outcomeOf(report, swapName(name));
    if (r.status === 'computed') {
      rows.push({
        name,
        members: replaced(name),
        total_damage: r.total_damage,
        // 총딜 변화: +0.08 = 8% 증가. 지금 편성을 계산하지 못했으면 모른다(null).
        change: base !== null && base > 0 ? (r.total_damage - base) / base : null,
        engine_warnings: r.engine_warnings,
      });
    } else {
      failed.push({ name, reason: r.status === 'rejected' ? r.reasons.join(' / ') : (r.error?.message ?? '알 수 없는 오류') });
    }
  }
  // 총딜이 큰 순. 같으면 후보 순서(많이 키운 순)를 지킨다(안정 정렬).
  rows.sort((a, b) => b.total_damage - a.total_damage);

  const caveats = [
    `그 자리의 니케와 같은 버스트 묶음(${picked.group ?? '모름'}단계 — 어느 단계에서나 쓰는 니케는 3단계로 센다)의 보유 니케만 넣어 봤다.`,
    '한 명만 바꾼 것이다 — 나머지 넷과 자리 순서는 그대로다. 바꾼 뒤의 가장 좋은 자리 순서는 따로 보지 않았다.',
  ];
  if (picked.skipped.length) {
    caveats.push(`한 번에 ${limit}명까지만 계산한다(많이 키운 순). 보지 못한 니케 ${picked.skipped.length}명: ${picked.skipped.join(', ')}.`);
  }
  if (failed.length) caveats.push(`계산하지 못한 니케 ${failed.length}명 — 0으로 두지 않고 뺐다: ${failed.map((f) => f.name).join(', ')}.`);
  return {
    schema_version: DECK_REPORT_SCHEMA_VERSION,
    kind: 'deck_swap',
    generated_at: report.generated_at,
    key: deckKey(names, opponent.key),
    slot,
    out: picked.out,
    group: picked.group,
    baseline,
    rows,
    failed,
    skipped: picked.skipped,
    candidates: { total: picked.total, limit, computed: rows.length, failed: failed.length, skipped: picked.skipped.length },
    engine: report.engine,
    cache: report.cache,
    caveats,
  };
}

// ── 자리 순서 비교 ────────────────────────────────────────────────────────────

/**
 * 같은 다섯의 자리 변형(search.mjs의 placementVariants — 같은 버스트 단계 안의 순서, 3번 자리에 누가 서는가)을 계산해
 * 가장 좋은 순서와 지금 순서의 차이를 돌려준다. 지금 순서도 후보라서 가장 좋은 순서의 총딜은 지금 이상이다.
 * @param {{account: object, opponent: object, members: (string|null)[]}} input
 * @param {{limit?: number}} [options] 계산할 변형 수의 상한(기본 24)
 * @returns {Promise<object>} docs/data-model.md §덱 빌더 §자리 순서 비교
 */
export async function compareOrders({ account, opponent, members }, options = {}, deps = {}) {
  requireOpponent(opponent);
  const names = requireFull(members);
  const limit = options.limit ?? DEFAULT_ORDER_LIMIT;
  if (!isPositiveInt(limit)) throw new InputError('옵션이 잘못됐다', [{ path: '/limit', message: 'limit은 1 이상의 정수여야 한다' }]);
  const catalog = await engineAccess(deps).catalog();

  const planned = planRefinement([{ name: CURRENT, members: names }], catalog, limit);
  const item = planned.plan[0];
  const report = await compareSquads(
    {
      account,
      condition: opponent.condition,
      squads: [{ name: CURRENT, members: names }, ...item.selected.map((v, i) => ({ name: variantName(CURRENT, i + 1), members: v.members }))],
    },
    { ...deps, catalog },
  );
  const original = report.ranking.find((r) => r.name === CURRENT);
  if (!original) {
    const why = outcomeOf(report, CURRENT);
    const message = why.status === 'rejected' ? why.reasons.join(' / ') : (why.error?.message ?? '알 수 없는 오류');
    throw new InputError('지금 편성을 계산하지 못했다', [{ path: '/members', message }]);
  }
  const computed = new Map(report.ranking.filter((r) => r.name !== CURRENT).map((r) => [r.name, r]));
  const best = pickBestPlacement(original, item, computed);
  const p = best.placement;

  const caveats = [
    '자리 변형은 두 가지만 바꾼다: 같은 버스트 단계 안의 순서, 3번 자리에 누가 서는가(엔진 문서 GAMEPLAY.md §버스트 사용 순서와 배치, CONTROL.md §카메라). 모든 순열을 본 것이 아니다.',
  ];
  if (p.variants.total === 0) caveats.push('이 다섯 명에게는 규칙으로 바꿀 자리 순서가 없다.');
  if (p.variants.skipped > 0) caveats.push(`한 번에 ${limit}가지까지만 계산한다. 자리 변형 ${p.variants.total}가지 중 ${p.variants.skipped}가지는 보지 못했다.`);
  if (p.variants.failed > 0) caveats.push(`자리 변형 ${p.variants.failed}가지는 계산하지 못했다(0으로 두지 않고 뺐다).`);
  return {
    schema_version: DECK_REPORT_SCHEMA_VERSION,
    kind: 'deck_order',
    generated_at: report.generated_at,
    key: deckKey(names, opponent.key),
    current: { members: names, total_damage: original.total_damage },
    best: { members: best.members.map((m) => m.name), total_damage: best.total_damage },
    changed: p.changed,
    changes: p.changes,
    // 가장 좋은 순서 ÷ 지금 순서(1 이상). 지금 총딜이 0이면 모른다.
    gain_ratio: p.gain_ratio,
    gain_text: p.gain_ratio === null ? null : gainText(p.gain_ratio),
    variants: { ...p.variants, limit },
    engine: report.engine,
    cache: report.cache,
    caveats,
  };
}

// ── 내 편성(저장) ─────────────────────────────────────────────────────────────

export const DECK_BOOK_SCHEMA_VERSION = 1;
export const DECK_BOOK_KIND = 'deck_book';
/** 번호 칸의 수 — 게임의 편성 칸과 같다(01~05). */
export const DECK_SLOT_COUNT = 5;
export const MAX_SAVED_DECKS = 50;
export const DECK_NAME_MAX = 30;

/** 칸 번호의 표기: 0 → '01'. */
export const slotLabel = (index) => String(index + 1).padStart(2, '0');

export function emptyDeckBook() {
  return { schema_version: DECK_BOOK_SCHEMA_VERSION, kind: DECK_BOOK_KIND, slots: Array.from({ length: DECK_SLOT_COUNT }, () => null), saved: [] };
}

/** 저장할 편성의 문제(한국어 문장들). 없으면 빈 배열. */
export function deckProblems(deck) {
  if (deck === null || typeof deck !== 'object' || Array.isArray(deck)) return ['편성은 객체여야 한다'];
  const problems = [];
  const members = deck.members;
  if (!Array.isArray(members) || members.length !== DECK_SIZE || !members.every((m) => m === null || isText(m))) {
    problems.push(`members는 다섯 자리(니케 이름 또는 null)여야 한다`);
  } else {
    const names = members.filter((m) => m !== null);
    if (names.length === 0) problems.push('빈 편성은 저장하지 않는다 — 니케를 한 명 이상 넣는다');
    if (new Set(names).size !== names.length) problems.push('같은 니케를 두 번 넣었다');
  }
  if (deck.name !== undefined && deck.name !== null && !(typeof deck.name === 'string' && deck.name.length <= DECK_NAME_MAX)) {
    problems.push(`이름은 ${DECK_NAME_MAX}자까지다`);
  }
  if (deck.opponent !== undefined && deck.opponent !== null && !isText(deck.opponent)) problems.push('상대는 열쇠(문자열)여야 한다');
  if (deck.total_damage !== undefined && deck.total_damage !== null && !(Number.isFinite(deck.total_damage) && deck.total_damage >= 0)) {
    problems.push('총딜은 0 이상의 수여야 한다');
  }
  return problems;
}

/**
 * 저장할 모양으로 다듬는다. 문제가 있으면 InputError. `total_damage`는 저장할 때의 추정 총딜(계정 육성 기준)이다 — 없으면 null.
 * @param {any} input
 * @param {{now?: string|null}} [options]
 */
export function makeDeck(input, options = {}) {
  const now = options.now ?? null;
  const problems = deckProblems(input);
  if (problems.length) throw new InputError('편성을 저장할 수 없다', problems.map((message) => ({ path: '/deck', message })));
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  return {
    name,
    members: [...input.members],
    opponent: input.opponent ?? null,
    opponent_label: isText(input.opponent_label) ? input.opponent_label : null,
    total_damage: input.total_damage ?? null,
    saved_at: isText(input.saved_at) ? input.saved_at : now,
  };
}

function cleanDeck(deck) {
  if (deckProblems(deck).length) return null;
  const made = makeDeck(deck);
  return isText(deck.id) ? { id: deck.id, ...made } : made;
}

/**
 * 디스크에서 읽은 문서를 편성 묶음으로. 모양이 다른 문서는 빈 묶음이고, 읽을 수 없는 편성은 빼고 몇 개 뺐는지 알린다.
 * @returns {{book: object, dropped: number}}
 */
export function readDeckBook(doc) {
  const book = emptyDeckBook();
  if (doc === null || doc === undefined) return { book, dropped: 0 };
  if (typeof doc !== 'object' || Array.isArray(doc) || doc.kind !== DECK_BOOK_KIND || doc.schema_version !== DECK_BOOK_SCHEMA_VERSION) {
    return { book, dropped: 0 };
  }
  let dropped = 0;
  for (let i = 0; i < DECK_SLOT_COUNT; i += 1) {
    const raw = Array.isArray(doc.slots) ? doc.slots[i] : null;
    if (raw === null || raw === undefined) continue;
    const deck = cleanDeck(raw);
    if (deck) book.slots[i] = deck;
    else dropped += 1;
  }
  const ids = new Set();
  for (const raw of Array.isArray(doc.saved) ? doc.saved : []) {
    const deck = cleanDeck(raw);
    if (!deck || !isText(deck.id) || ids.has(deck.id) || book.saved.length >= MAX_SAVED_DECKS) {
      dropped += 1;
      continue;
    }
    ids.add(deck.id);
    book.saved.push(deck);
  }
  return { book, dropped };
}

/**
 * 번호 칸에 저장한다(있던 것을 덮는다). 받은 묶음은 바꾸지 않는다.
 * @param {any} book
 * @param {number} index
 * @param {any} deck
 * @param {{now?: string|null}} [options]
 */
export function saveSlot(book, index, deck, options = {}) {
  const now = options.now ?? null;
  if (!Number.isInteger(index) || index < 0 || index >= DECK_SLOT_COUNT) {
    throw new InputError('편성을 저장할 수 없다', [{ path: '/slot', message: `칸은 01~${slotLabel(DECK_SLOT_COUNT - 1)}이다` }]);
  }
  const made = makeDeck(deck, { now });
  const slots = [...book.slots];
  slots[index] = { ...made, name: made.name || `편성 ${slotLabel(index)}` };
  return { ...book, slots };
}

export function clearSlot(book, index) {
  const slots = [...book.slots];
  if (Number.isInteger(index) && index >= 0 && index < DECK_SLOT_COUNT) slots[index] = null;
  return { ...book, slots };
}

/**
 * 이름을 붙여 목록 맨 앞에 저장한다. 이름이 비면 InputError, 목록이 가득 차면(50개) InputError.
 * @param {any} book
 * @param {any} deck
 * @param {{now?: string|null}} [options]
 */
export function addSaved(book, deck, options = {}) {
  const now = options.now ?? null;
  const made = makeDeck(deck, { now });
  if (!made.name) throw new InputError('편성을 저장할 수 없다', [{ path: '/name', message: '이름을 적어야 한다' }]);
  if (book.saved.length >= MAX_SAVED_DECKS) {
    throw new InputError('편성을 저장할 수 없다', [{ path: '/saved', message: `저장 목록은 ${MAX_SAVED_DECKS}개까지다 — 쓰지 않는 것을 지운 뒤 저장한다` }]);
  }
  const used = book.saved.map((d) => Number(/^d(\d+)$/.exec(d.id)?.[1] ?? 0));
  const id = `d${Math.max(0, ...used) + 1}`;
  return { ...book, saved: [{ id, ...made }, ...book.saved] };
}

export function removeSaved(book, id) {
  return { ...book, saved: book.saved.filter((d) => d.id !== id) };
}

/**
 * 요격전 추천 결과의 편성 한 줄 → 덱 빌더에 넣을 것(자리 순서 그대로, 상대는 그 보스).
 * @param {any} entry
 * @param {string|null} [bossId]
 */
export function deckFromRanking(entry, bossId = null) {
  const names = (Array.isArray(entry?.members) ? entry.members : []).map((m) => (typeof m === 'string' ? m : m?.name));
  return { members: normalizeSlots(names), opponent: isText(bossId) ? `boss:${bossId}` : null };
}

// ── 편성을 글자로 ─────────────────────────────────────────────────────────────

/**
 * 편성을 붙여넣기 좋은 글로: 자리 순서대로 이름, 상대, 총딜, 「추정」 표시. 계산하지 않았으면 총딜 대신 「계산 전」이다.
 * @param {{members: (string|null)[], opponent_label?: string|null, weak_to?: string|null, total_damage?: number|null, basis?: string|null}} deck
 */
export function deckText(deck) {
  const { members, opponent_label = null, weak_to = null, total_damage = null, basis = GROWTH_ACCOUNT } = deck;
  const slots = normalizeSlots(members);
  const line = slots.map((name, i) => `${i + 1}. ${name ?? '(빈 자리)'}`).join(' / ');
  const opponent = opponent_label ? `${opponent_label}${weak_to && !opponent_label.includes(weak_to) ? ` (약점 ${weak_to})` : ''}` : '정하지 않음';
  const total =
    Number.isFinite(total_damage) && total_damage >= 0
      ? `총딜 ${formatDamage(Math.round(total_damage))} (추정 · 실전 미대조${BASIS_LABELS[basis] ? ` · ${BASIS_LABELS[basis]} 기준` : ''})`
      : '총딜 계산 전';
  return [`편성: ${line}`, `상대: ${opponent}`, total].join('\n');
}
