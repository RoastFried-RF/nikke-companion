// 요격전 계획(P-029): 장비 현황 · 주력 니케 · 오늘 돌 보스 · 요격전 기록 · 속성 커버리지.
// 형식 설명은 docs/data-model.md §요격전 계획.
//
// 순수 모듈이다 — 파일·프로세스·네트워크·시계에 닿지 않는다(웹뷰와 Node가 함께 쓴다). 계정 문서와 요격전 추천 결과,
// 보스 묶음을 받아 화면이 그릴 값을 만든다. 계정을 고치지 않고, 추정치를 기록에 맞춰 고쳐 쓰지도 않는다.
//
// **계정에 없는 것은 지어내지 않는다.** 장비를 적지 않은 니케는 「기록 없음」이고(끼지 않은 것으로 세지 않는다),
// 가지고 있지만 끼지 않은 장비의 수·보상이 나올 확률·한 번에 얻는 수는 모른다 — 모른다는 문장을 함께 돌려준다.
import { investmentScore } from './candidates.mjs';
import { isDate } from './dates.mjs';
import { formatDamage } from './format.mjs';
import { readRewards, STAGE_MAX } from './journal.mjs';

// 날짜 검사와 달성 단계의 범위는 모듈 기록장(journal.mjs)과 함께 쓴다 — 이 모듈에서 꺼내 쓰던 이름은 그대로다.
export { isDate, STAGE_MAX };

export const PLAN_SCHEMA_VERSION = 1;
export const PLAN_KIND = 'intercept_plan';

/** 장비 부위(계정 문서의 `equipment` 키 — 엔진 표기). */
export const GEAR_PARTS = ['머리', '몸통', '팔', '다리'];
/** 속성 다섯(엔진 카탈로그의 낱말). */
export const ELEMENTS = ['작열', '풍압', '철갑', '전격', '수냉'];

/** 장비 칸의 상태와 화면의 말. */
export const GEAR_STATE_LABEL = Object.freeze({
  empty: '미장착',
  normal: '일반 등급',
  corp: '기업 장비',
  overload: '오버로드',
  unrecorded: '기록 없음',
  unknown: '미확인',
});
/** 「오버로드가 아닌 칸」으로 세는 상태. 기록이 없거나 모르는 칸은 세지 않는다. */
export const OPEN_STATES = ['empty', 'normal', 'corp'];
/** 같은 칸 수일 때 더 급한 쪽을 가리는 무게: 비어 있을수록 크다. */
const OPEN_WEIGHT = { empty: 3, normal: 2, corp: 1 };

/** 장비 현황이 모르는 것(화면에 그대로 적는다). */
export const GEAR_UNKNOWNS = Object.freeze([
  '가지고 있지만 끼지 않은 장비의 수는 계정 정보에 없다 — 세지 않았다.',
]);
/** 보스 추천이 모르는 것(화면에 그대로 적는다). */
export const RECOMMEND_UNKNOWNS = Object.freeze([
  '보상이 나올 확률과 한 번에 얻는 수는 모른다 — 언제 다 모이는지는 어림하지 않는다.',
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
// 로케일과 무관한 이름 순서(코드 단위 비교).
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ── 장비 현황 ─────────────────────────────────────────────────────────────────

/**
 * 장비 한 칸의 상태. 표기는 엔진 프로필과 같다(vendor/nikke-calc/calculator/base_stat.py 모듈 docstring):
 *   `tier: "없음"` 미장착 · `tier` 생략(또는 "기업" — 엔진의 오버로드 표 이름) 오버로드 ·
 *   `tier: "T1"~"T9"` + `corp` 기업 장비 · `tier: "T1"~"T9"`만 일반 등급. 그 밖의 값은 미확인이다.
 * 칸이 아예 없으면(`undefined`) 「기록 없음」이다.
 */
export function gearState(gear) {
  if (gear === undefined || gear === null) return 'unrecorded';
  if (!isPlainObject(gear)) return 'unknown';
  const tier = gear.tier;
  if (tier === '없음') return 'empty';
  if (tier === undefined || tier === '기업') return 'overload';
  if (typeof tier === 'string' && /^T[1-9]$/.test(tier)) return isText(gear.corp) ? 'corp' : 'normal';
  return 'unknown';
}

function slotOf(part, gear, forced) {
  const state = forced ?? gearState(gear);
  const g = isPlainObject(gear) && !forced ? gear : {};
  return {
    part,
    state,
    label: GEAR_STATE_LABEL[state],
    /** 등급(T1~T9). 일반·기업 장비에만 있다. */
    tier: (state === 'normal' || state === 'corp') && typeof g.tier === 'string' ? g.tier : null,
    /** 강화 단계(0~5). 오버로드·기업 장비에만 있다(일반 등급은 강화가 없다). */
    level: (state === 'overload' || state === 'corp') && Number.isInteger(g.level) ? g.level : null,
    /** 장비의 제조사(기업 장비만). */
    corp: state === 'corp' ? g.corp : null,
  };
}

/**
 * 니케 한 명의 장비 네 칸. 계정에 적힌 값 그대로다.
 * `equipment`를 적지 않았으면 네 칸 모두 「기록 없음」, 미확인(`unknown`)으로 표시했으면 「미확인」이다.
 */
export function gearRow(name, entry) {
  const e = isPlainObject(entry) ? entry : {};
  const flagged = Array.isArray(e.unknown) && e.unknown.includes('equipment');
  const written = isPlainObject(e.equipment);
  const forced = flagged ? 'unknown' : written ? null : 'unrecorded';
  const slots = GEAR_PARTS.map((part) => slotOf(part, written ? e.equipment[part] : undefined, forced));
  return {
    name,
    /** 장비가 계정에 적혀 있는가(한 칸이라도). */
    recorded: slots.some((s) => s.state !== 'unrecorded' && s.state !== 'unknown'),
    slots,
    /** 오버로드가 아닌 칸의 수(기록이 있는 칸만). */
    open: slots.filter((s) => OPEN_STATES.includes(s.state)).length,
  };
}

/** 계정의 모든 니케의 장비 현황(계정에 적힌 순서). */
export function gearRows(account) {
  const nikkes = isPlainObject(account?.nikkes) ? account.nikkes : {};
  return Object.entries(nikkes).map(([name, entry]) => gearRow(name, entry));
}

/**
 * 부위별·기업별로 「오버로드가 아닌 칸」을 센다. 기업은 **니케의 기업**이다(오버로드 장비는 그 기업의 장비로 만든다).
 * 기업을 주지 않거나 모르면 「모름」으로 묶는다.
 * @param {any[]} rows `gearRows`의 결과(또는 그 일부 — 주력만 등)
 * @param {{infoOf?: (name: string) => any}} [options] infoOf: 이름 → `{corp}`
 */
export function gearSummary(rows, { infoOf } = {}) {
  const byPart = GEAR_PARTS.map((part) => ({ part, open: 0, empty: 0, normal: 0, corp: 0, overload: 0 }));
  const corps = new Map();
  let recorded = 0;
  for (const row of rows) {
    if (row.recorded) recorded += 1;
    row.slots.forEach((slot, i) => {
      if (slot.state in byPart[i]) byPart[i][slot.state] += 1;
      if (OPEN_STATES.includes(slot.state)) byPart[i].open += 1;
    });
    if (row.open > 0) {
      const corp = infoOf?.(row.name)?.corp ?? null;
      const key = isText(corp) ? corp : '모름';
      const item = corps.get(key) ?? { corp: key, open: 0, nikkes: 0 };
      item.open += row.open;
      item.nikkes += 1;
      corps.set(key, item);
    }
  }
  return {
    nikkes: rows.length,
    recorded,
    /** 장비가 계정에 적혀 있지 않은 니케의 수 — 칸 수에 세지 않았다. */
    unrecorded: rows.length - recorded,
    open: byPart.reduce((s, p) => s + p.open, 0),
    by_part: byPart,
    by_corp: [...corps.values()].sort((a, b) => b.open - a.open || byName(a.corp, b.corp)),
    unknowns: [...GEAR_UNKNOWNS],
  };
}

// ── 주력 니케 ─────────────────────────────────────────────────────────────────

/** 추천 결과의 보스 하나에서 1위 편성. 계산하지 않았으면 null. */
export function bestSquad(boss) {
  if (!boss || boss.status !== 'computed' || !Array.isArray(boss.ranking)) return null;
  return boss.ranking.find((e) => e?.rank === 1) ?? boss.ranking[0] ?? null;
}

/** 보스의 추정 총딜(1위 편성). 없으면 null. */
export function bossEstimate(boss) {
  const total = bestSquad(boss)?.total_damage;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

/** 기준이 육성 점수일 때 고르는 인원. */
export const CORE_BY_SCORE = 10;

/**
 * 어느 니케의 장비가 중요한가(「주력」): ① 요격전 추천의 보스별 1위 편성에 든 니케 → ② 없으면 즐겨찾기 →
 * ③ 그것도 없으면 많이 키운 순서(투자 점수 — 성능 추정이 아니다) 상위 `limit`명.
 * 계정을 주면 그 계정이 가진 니케만 남긴다(다른 계정으로 계산한 옛 결과의 이름을 걸러 낸다).
 * 「안 씀」으로 표시한 니케(`unused`)는 ③에서 뺀다(많이 키웠어도 쓰지 않는 니케다).
 * @param {{report?: any, favorites?: string[], unused?: string[], account?: any, limit?: number}} [input]
 * @returns {{basis: 'intercept'|'favorites'|'score'|'none', names: string[], text: string}}
 */
export function pickCore({ report = null, favorites = [], unused = [], account = null, limit = CORE_BY_SCORE } = {}) {
  // 「안 씀」으로 표시한 니케는 많이 키웠어도 주력으로 어림하지 않는다(추천 편성에 든 니케와 즐겨찾기는 그대로 둔다).
  const idle = new Set(Array.isArray(unused) ? unused : []);
  const nikkes = isPlainObject(account?.nikkes) ? account.nikkes : null;
  const owned = (names) => [...new Set(names.filter(isText))].filter((n) => !nikkes || Object.hasOwn(nikkes, n));

  const fromReport = owned((report?.bosses ?? []).flatMap((b) => (bestSquad(b)?.members ?? []).map((m) => m?.name)));
  if (fromReport.length) {
    return { basis: 'intercept', names: fromReport, text: `주력 기준: 요격전 추천에서 보스마다 1위 편성에 든 니케 ${fromReport.length}명.` };
  }
  const fromFavorites = owned(Array.isArray(favorites) ? favorites : []);
  if (fromFavorites.length) {
    return { basis: 'favorites', names: fromFavorites, text: `주력 기준: 즐겨찾기로 고른 니케 ${fromFavorites.length}명(요격전 추천이 아직 없다).` };
  }
  if (nikkes) {
    const ranked = Object.entries(nikkes)
      .filter(([name]) => !idle.has(name))
      .map(([name, entry]) => ({ name, score: investmentScore(isPlainObject(entry) ? entry : {}) }))
      .sort((a, b) => b.score - a.score || byName(a.name, b.name))
      .slice(0, Math.max(0, limit))
      .map((r) => r.name);
    if (ranked.length) {
      return { basis: 'score', names: ranked, text: `주력 기준: 많이 키운 순서로 위에서 ${ranked.length}명(요격전 추천도 즐겨찾기도 아직 없다).` };
    }
  }
  return { basis: 'none', names: [], text: '주력 기준: 계정에 니케가 없어 고르지 못했다.' };
}

// ── 오늘 돌 보스 ──────────────────────────────────────────────────────────────

/** 보상 문구(「머리 장비」)에서 장비 부위를 읽는다. 장비가 아니면(커스텀 모듈 등) null. */
export function rewardPart(reward) {
  if (typeof reward !== 'string') return null;
  const m = /^\s*(머리|몸통|팔|다리)\s*장비\s*$/.exec(reward);
  return m ? m[1] : null;
}

// 받침이 있으면 '이', 없으면 '가'.
const subject = (word) => {
  const code = word.charCodeAt(word.length - 1);
  const coda = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${word}${coda ? '이' : '가'}`;
};

/**
 * 주력 니케의 「오버로드가 아닌 칸」을 보스의 보상 부위와 잇는다.
 * 급한 순서: 칸 수가 많은 보스 → 같으면 더 비어 있는 쪽(미장착 3 · 일반 등급 2 · 기업 장비 1의 합) → 그래도 같으면 함께 적는다(동률).
 * bosses: 보스 목록(`{id, name, reward}` — 보스 묶음이나 추천 결과의 보스) · rows: `gearRows`의 결과 · core: 주력 니케의 이름.
 * @param {{bosses?: any[], rows?: any[], core?: string[]}} [input]
 */
export function recommendBoss({ bosses = [], rows = [], core = [] } = {}) {
  const rowOf = new Map(rows.map((r) => [r.name, r]));
  const coreRows = core.map((name) => rowOf.get(name)).filter(Boolean);
  const unrecorded = coreRows.filter((r) => !r.recorded).map((r) => r.name);

  const items = bosses.map((b, order) => {
    const part = rewardPart(b.reward);
    const base = { id: b.id, name: b.name, reward: b.reward ?? null, part, order };
    if (!part) {
      const note = b.reward ? `보상(${b.reward})은 장비 부위가 아니라 세지 않았다.` : '보상을 몰라 세지 않았다.';
      return { ...base, need: null, weight: 0, reasons: [], note };
    }
    const reasons = [];
    for (const row of coreRows) {
      const slot = row.slots.find((s) => s.part === part);
      if (slot && OPEN_STATES.includes(slot.state)) reasons.push({ nikke: row.name, part, state: slot.state, label: slot.label, tier: slot.tier, level: slot.level });
    }
    const weight = reasons.reduce((s, r) => s + OPEN_WEIGHT[r.state], 0);
    return { ...base, need: reasons.length, weight, reasons, note: null };
  });

  const ranked = items.filter((i) => i.need !== null).sort((a, b) => b.need - a.need || b.weight - a.weight || a.order - b.order);
  const first = ranked[0];
  const top = first && first.need > 0 ? ranked.filter((i) => i.need === first.need && i.weight === first.weight) : [];
  const maxNeed = ranked.reduce((m, i) => Math.max(m, i.need), 0);

  let status;
  let text;
  if (coreRows.length === 0) {
    status = 'no_core';
    text = '주력 니케가 없어 어느 보스가 급한지 알 수 없다.';
  } else if (unrecorded.length === coreRows.length) {
    status = 'no_data';
    text = '주력 니케의 장비가 계정에 적혀 있지 않아 어느 보스가 급한지 알 수 없다.';
  } else if (top.length === 0) {
    status = 'done';
    text = '주력 니케의 장비는 적힌 칸이 모두 오버로드다 — 장비 때문에 급한 보스는 없다.';
  } else if (top.length === 1) {
    status = 'pick';
    text = `${subject(`${first.part} 장비`)} 가장 급하다 → ${first.name}`;
  } else {
    status = 'tie';
    text = `${subject(`${top.map((t) => t.part).join('·')} 장비`)} 똑같이 급하다 → ${top.map((t) => t.name).join(' 또는 ')}`;
  }

  return {
    status,
    text,
    /** 가장 급한 보스의 id(동률이면 여럿, 급한 보스가 없으면 빈 배열). */
    top: top.map((t) => t.id),
    /** 막대의 길이를 정하는 가장 큰 칸 수. */
    max_need: maxNeed,
    /** 보스마다(받은 순서): 보상 부위, 필요 칸 수(장비가 아니면 null), 근거(어느 니케의 어느 부위). */
    bosses: items.map(({ order: _order, weight: _weight, ...rest }) => rest),
    core: coreRows.length,
    /** 장비 기록이 없어 세지 못한 주력 니케. */
    unrecorded,
    unknowns: [...RECOMMEND_UNKNOWNS],
  };
}

// ── 요격전 기록 ───────────────────────────────────────────────────────────────

/** 기록의 종류와 화면의 말. */
export const RECORD_MODES = Object.freeze({ mock: '모의전', real: '실전' });
/** 계정 하나에 남기는 기록의 수(파일이 끝없이 커지지 않게). 넘으면 오래된 것부터 뺀다. */
export const MAX_RECORDS = 500;

/**
 * 빈 계획 문서. `unused`(「안 씀」으로 표시한 니케)와 `rewards`(모듈 기록장 — journal.mjs)는 P-033이 더한 칸이다 —
 * 판은 그대로 1이고, 이 두 칸이 없는 예전 문서는 빈 목록으로 읽는다.
 */
export function emptyPlan() {
  return { schema_version: PLAN_SCHEMA_VERSION, kind: PLAN_KIND, favorites: [], unused: [], records: [], rewards: [] };
}

/**
 * 손으로 적은 대미지 → 정수. 게임에 보이는 숫자 그대로(`1,234,567,890`)나 단위 표기(`12.3억`·`1조 2000억`·`3500만`)를 받는다.
 * 읽을 수 없거나 0 이하이면 null.
 */
export function parseDamage(text) {
  if (typeof text === 'number') return Number.isSafeInteger(text) && text > 0 ? text : null;
  if (typeof text !== 'string') return null;
  const s = text.replace(/[\s,]/g, '');
  if (s === '') return null;
  let value;
  if (/^\d+$/.test(s)) value = Number(s);
  else {
    const m = /^(?:(\d+(?:\.\d+)?)조)?(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?(\d+)?$/.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
    value = Math.round(Number(m[1] ?? 0) * 1e12 + Number(m[2] ?? 0) * 1e8 + Number(m[3] ?? 0) * 1e4 + Number(m[4] ?? 0));
  }
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 기록 하나의 모양을 본다. 문제를 한국어 문장으로 돌려준다(없으면 빈 배열). */
export function recordProblems(record) {
  const problems = [];
  if (!isPlainObject(record)) return ['기록은 객체여야 한다'];
  if (!isText(record.boss_id)) problems.push('어느 보스의 기록인지 없다');
  if (!(Number.isSafeInteger(record.damage) && record.damage > 0)) problems.push('대미지를 읽을 수 없다 — 게임에 보이는 숫자나 12.3억처럼 적는다');
  if (!Object.hasOwn(RECORD_MODES, record.mode)) problems.push('모의전인지 실전인지 고르지 않았다');
  if (!isDate(record.date)) problems.push('날짜는 2026-11-12처럼 적는다');
  if (!(record.stage === null || record.stage === undefined || (Number.isInteger(record.stage) && record.stage >= 1 && record.stage <= STAGE_MAX))) {
    problems.push(`달성 단계는 1~${STAGE_MAX}의 정수다(모르면 비워 둔다)`);
  }
  return problems;
}

function cleanRecord(record) {
  return {
    id: String(record.id),
    boss_id: record.boss_id,
    boss_name: isText(record.boss_name) ? record.boss_name : record.boss_id,
    damage: record.damage,
    mode: record.mode,
    date: record.date,
    stage: Number.isInteger(record.stage) ? record.stage : null,
    note: isText(record.note) ? record.note.trim().slice(0, 200) : null,
    created_at: isText(record.created_at) ? record.created_at : null,
  };
}

/**
 * 저장해 둔 계획 문서를 읽는다. 없으면(`null`) 빈 계획이다. 종류·판이 다르면 한국어 문장으로 던진다.
 * 모양이 맞지 않는 기록·즐겨찾기는 버리고 그 수를 `dropped`로 알린다(나머지는 쓴다).
 * @returns {{plan: object, dropped: number}}
 */
export function readPlan(doc) {
  if (doc === null || doc === undefined) return { plan: emptyPlan(), dropped: 0 };
  if (!isPlainObject(doc) || doc.kind !== PLAN_KIND) throw new Error('요격전 기록이 아니다(종류가 다르다).');
  if (doc.schema_version !== PLAN_SCHEMA_VERSION) throw new Error(`요격전 기록의 판이 다르다(받은 것 ${String(doc.schema_version)}, 이 앱이 읽는 판 ${PLAN_SCHEMA_VERSION}).`);
  const favorites = Array.isArray(doc.favorites) ? [...new Set(doc.favorites.filter(isText))] : [];
  // 「안 씀」은 즐겨찾기와 함께 붙지 않는다 — 둘 다 적혀 있으면 즐겨찾기로 읽는다(빼는 쪽이 아니라 남기는 쪽으로).
  const marked = Array.isArray(doc.unused) ? [...new Set(doc.unused.filter(isText))] : [];
  const unused = marked.filter((name) => !favorites.includes(name));
  const raw = Array.isArray(doc.records) ? doc.records : [];
  const records = raw.filter((r) => recordProblems(r).length === 0 && (isText(r.id) || Number.isInteger(r.id))).map(cleanRecord);
  const journal = readRewards(doc.rewards);
  const dropped =
    raw.length -
    records.length +
    (Array.isArray(doc.favorites) ? doc.favorites.length - favorites.length : 0) +
    (Array.isArray(doc.unused) ? doc.unused.length - marked.length : 0) +
    journal.dropped;
  return { plan: { schema_version: PLAN_SCHEMA_VERSION, kind: PLAN_KIND, favorites, unused, records, rewards: journal.rewards }, dropped };
}

/**
 * 기록을 하나 더한 새 계획 문서(받은 문서는 바꾸지 않는다). 모양이 맞지 않으면 문제 목록과 함께 던진다(`error.problems`).
 * @param {any} plan
 * @param {any} input `{boss_id, boss_name, damage, mode, date, stage?, note?}` — damage는 정수(`parseDamage`로 읽은 값)
 * @param {{now?: string | null}} [options] now: 적은 시각(ISO). 시계는 부르는 쪽이 읽는다.
 */
export function addRecord(plan, input, { now = null } = {}) {
  const problems = recordProblems(input);
  if (problems.length) {
    const error = new Error(problems.join(' / '));
    error.problems = problems;
    throw error;
  }
  const next = Math.max(0, ...plan.records.map((r) => Number(/^r(\d+)$/.exec(r.id)?.[1] ?? 0))) + 1;
  const record = cleanRecord({ ...input, id: `r${next}`, created_at: now });
  const records = [...plan.records, record].slice(-MAX_RECORDS);
  return { ...plan, records };
}

/** 기록 하나를 뺀 새 계획 문서. */
export function removeRecord(plan, id) {
  return { ...plan, records: plan.records.filter((r) => r.id !== id) };
}

const without = (list, name) => (Array.isArray(list) ? list.filter((n) => n !== name) : []);

/** 즐겨찾기를 켜거나 끈 새 계획 문서. 켜면 그 니케의 「안 씀」 표시는 내린다(둘은 함께 붙지 않는다). */
export function toggleFavorite(plan, name) {
  const on = plan.favorites.includes(name);
  if (on) return { ...plan, favorites: without(plan.favorites, name) };
  return { ...plan, favorites: [...plan.favorites, name], unused: without(plan.unused, name) };
}

/** 「안 씀」 표시를 켜거나 끈 새 계획 문서. 켜면 그 니케의 즐겨찾기는 내린다. 계정은 바뀌지 않는다 — 표시일 뿐이다. */
export function toggleUnused(plan, name) {
  const unused = Array.isArray(plan.unused) ? plan.unused : [];
  if (unused.includes(name)) return { ...plan, unused: without(unused, name) };
  return { ...plan, unused: [...unused, name], favorites: without(plan.favorites, name) };
}

/** 니케에 붙은 표시: 'favorite'(즐겨찾기) · 'unused'(안 씀) · null(없음). */
export function markOf(plan, name) {
  if (Array.isArray(plan?.favorites) && plan.favorites.includes(name)) return 'favorite';
  if (Array.isArray(plan?.unused) && plan.unused.includes(name)) return 'unused';
  return null;
}

/** 표시로 거르는 보기와 화면의 말. 빈 값은 「전부」다. */
export const MARK_FILTERS = Object.freeze({ favorite: '즐겨찾기', unused: '안 씀', active: '안 씀 빼고' });

/** 그 니케가 표시 거르기를 지나는가. `filter`가 비었거나 모르는 낱말이면 전부 지난다. */
export function passesMark(plan, name, filter) {
  const mark = markOf(plan, name);
  if (filter === 'favorite') return mark === 'favorite';
  if (filter === 'unused') return mark === 'unused';
  if (filter === 'active') return mark !== 'unused';
  return true;
}

/** 「안 씀」으로 표시한 니케 가운데 그 계정이 가진 이름(계정에 적힌 순서). 추천 계산에서 뺄 목록이다. */
export function unusedOwned(plan, account) {
  const unused = new Set(Array.isArray(plan?.unused) ? plan.unused : []);
  const nikkes = isPlainObject(account?.nikkes) ? account.nikkes : {};
  return Object.keys(nikkes).filter((name) => unused.has(name));
}

/** 한 보스의 기록 — 최근 날짜가 앞, 같은 날이면 나중에 적은 것이 앞. */
export function recordsOf(plan, bossId) {
  const mine = (plan?.records ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.boss_id === bossId);
  return mine.sort((a, b) => byName(b.r.date, a.r.date) || b.i - a.i).map(({ r }) => r);
}

/** 한 보스의 가장 최근 기록. 없으면 null. */
export function latestRecord(plan, bossId) {
  return recordsOf(plan, bossId)[0] ?? null;
}

/**
 * 추정 총딜과 기록을 견준다. 어느 쪽이든 없으면 null. **추정치를 고치지 않는다** — 차이를 알릴 뿐이다.
 * `diff_pct` = (추정 − 기록) ÷ 기록 × 100(양수면 추정이 크다). `text`는 배지의 말(「기록과 12% 차이」).
 */
export function compareRecord(estimate, record) {
  const actual = record?.damage;
  if (!(Number.isSafeInteger(estimate) && estimate > 0) || !(Number.isSafeInteger(actual) && actual > 0)) return null;
  const diff = ((estimate - actual) / actual) * 100;
  const pct = Math.round(Math.abs(diff));
  const direction = estimate === actual ? 'same' : estimate > actual ? 'over' : 'under';
  const amount = direction === 'same' ? '같다' : pct < 1 ? '1% 미만' : `${pct}%`;
  const text = direction === 'same' ? '기록과 같다' : `기록과 ${amount} 차이`;
  const how = direction === 'same' ? '추정과 기록이 같다' : `추정이 기록보다 ${amount} ${direction === 'over' ? '크다' : '작다'}`;
  return {
    estimate,
    actual,
    ratio: estimate / actual,
    diff_pct: diff,
    direction,
    text,
    detail: `추정 ${formatDamage(estimate)} · 기록 ${formatDamage(actual)}(${RECORD_MODES[record.mode] ?? '기록'}, ${record.date}) — ${how}. 추정치는 기록에 맞춰 고치지 않았다.`,
  };
}

/** 추천 결과의 보스 하나와 그 보스의 가장 최근 기록을 견준다. 기록이나 추정이 없으면 null. */
export function recordCheck(boss, plan) {
  if (!boss) return null;
  return compareRecord(bossEstimate(boss), latestRecord(plan, boss.id));
}

// ── 속성 커버리지 ─────────────────────────────────────────────────────────────

/** 「키운 딜러」의 기준. 어림이다 — 성능을 잰 값이 아니다. */
export const COVERAGE_RULE = Object.freeze({ klass: '화력형', breakthrough: 3, skill: 7 });
export const COVERAGE_RULE_TEXT = `키운 딜러 = ${COVERAGE_RULE.klass}이고 돌파 ${COVERAGE_RULE.breakthrough} 이상, 스킬 셋이 모두 ${COVERAGE_RULE.skill} 이상인 니케.`;

/** 계정의 니케 항목이 「키운 딜러」의 육성 기준을 채우는가(클래스는 따로 본다). 미확인 칸은 채우지 못한 것으로 본다. */
export function isGrown(entry) {
  const e = isPlainObject(entry) ? entry : {};
  const unknown = Array.isArray(e.unknown) ? e.unknown : [];
  if (unknown.includes('breakthrough') || unknown.includes('skill_levels')) return false;
  const skills = Array.isArray(e.skill_levels) ? e.skill_levels : [];
  return Number.isFinite(e.breakthrough) && e.breakthrough >= COVERAGE_RULE.breakthrough && skills.length === 3 && skills.every((v) => Number.isFinite(v) && v >= COVERAGE_RULE.skill);
}

/**
 * 속성 다섯마다 「키운 딜러」가 몇 명인가, 그리고 그 속성이 약점인 보스.
 * infoOf: 이름 → `{element, klass}`(엔진 카탈로그). 속성이나 클래스를 모르는 니케는 세지 않고 `unsure`에 남긴다.
 * bosses: 보스 목록(`{id, name, weak_to}` 또는 추천 결과의 `{id, name, element: {weak_to}}`).
 * @param {any} account
 * @param {{infoOf?: (name: string) => any, bosses?: any[]}} [options]
 */
export function elementCoverage(account, { infoOf, bosses = [] } = {}) {
  const nikkes = isPlainObject(account?.nikkes) ? account.nikkes : {};
  const names = Object.fromEntries(ELEMENTS.map((el) => [el, []]));
  const unsure = [];
  for (const [name, entry] of Object.entries(nikkes)) {
    if (!isGrown(entry)) continue;
    const info = infoOf?.(name) ?? {};
    if (!isText(info.klass) || !ELEMENTS.includes(info.element)) {
      unsure.push(name);
      continue;
    }
    if (info.klass === COVERAGE_RULE.klass) names[info.element].push(name);
  }
  const weakOf = (b) => b?.weak_to ?? b?.element?.weak_to ?? null;
  const elements = ELEMENTS.map((element) => ({
    element,
    count: names[element].length,
    names: names[element],
    /** 이 속성이 약점인 보스. */
    bosses: bosses.filter((b) => weakOf(b) === element).map((b) => ({ id: b.id, name: b.name })),
  }));
  const max = Math.max(0, ...elements.map((e) => e.count));
  const min = Math.min(...elements.map((e) => e.count));
  return {
    rule: { ...COVERAGE_RULE },
    rule_text: COVERAGE_RULE_TEXT,
    elements,
    max,
    /** 키운 딜러가 가장 적은 속성(여럿일 수 있다). 다섯이 모두 같으면 빈 배열 — 어느 쪽이 약하다고 말하지 않는다. */
    weakest: max === min ? [] : elements.filter((e) => e.count === min).map((e) => e.element),
    /** 육성 기준은 채웠지만 속성이나 클래스를 몰라 세지 못한 니케. */
    unsure,
  };
}

/** 엔진 카탈로그 → `infoOf`(Node 쪽. 앱은 lib/nikkeInfo.ts의 정보를 넘긴다). */
export function catalogInfoOf(catalog) {
  return (name) => {
    const row = catalog?.nikkes?.[name];
    return { element: row?.element_code ?? null, klass: row?.class ?? null, corp: row?.manufacturer ?? null };
  };
}
