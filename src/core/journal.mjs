// 모듈 기록장(P-033): 날짜별로 이상 개체 보스·달성 단계·얻은 것(장비 부위별 수 · 커스텀 모듈 수)을 손으로 적어 두고
// 주·월 합계와 보스별 횟수를 본다. 형식 설명은 docs/data-model.md §모듈 기록.
//
// 순수 모듈이다 — 파일·프로세스·네트워크·시계에 닿지 않는다(웹뷰와 Node가 함께 쓴다). 기록은 요격전 계획 문서
// (`<계정>.plan.json` — plan.mjs)의 `rewards` 칸에 들어간다. 이 모듈은 받은 문서를 바꾸지 않고 새 문서를 돌려준다.
//
// **적은 것만 센다.** 보상이 나올 확률이나 한 번에 얻는 수는 이 앱이 모른다 — 어림해 채우지 않는다.
// 손으로 적은 요격전 대미지 기록(P-029 — 문서의 `records`)은 고치지 않고, 날짜별 보기에서 나란히 보여 줄 뿐이다.
import { isDate, monthOf, weekStart, addDays } from './dates.mjs';

/** 장비 부위(계정 문서의 `equipment` 키와 같다 — plan.mjs의 GEAR_PARTS). */
export const REWARD_PARTS = Object.freeze(['머리', '몸통', '팔', '다리']);
/** 달성 단계의 범위. 실제 상한은 모른다(게임 화면에서 본 것은 「달성 단계 4」 하나) — 넉넉히 잡았다. */
export const STAGE_MAX = 99;
/** 한 번에 적을 수 있는 수의 상한(잘못 누른 큰 수를 막는다 — 게임의 규칙이 아니다). */
export const REWARD_GEAR_MAX = 99;
export const REWARD_MODULE_MAX = 999;
/** 계정 하나에 남기는 기록의 수. 넘으면 오래 적은 것부터 뺀다. */
export const MAX_REWARDS = 1000;

/** 기록장이 모르는 것·정한 것(화면에 그대로 적는다). */
export const JOURNAL_NOTES = Object.freeze([
  '손으로 적은 것만 센다 — 보상이 나올 확률과 한 번에 얻는 수는 이 앱이 모른다.',
  '주는 월요일부터 일요일까지로 묶었다(달력 기준이다 — 게임의 초기화 시각과 다를 수 있다).',
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isCount = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 기록 하나의 모양을 본다. 문제를 한국어 문장으로 돌려준다(없으면 빈 배열). */
export function rewardProblems(entry) {
  if (!isPlainObject(entry)) return ['기록은 객체여야 한다'];
  const problems = [];
  if (!isDate(entry.date)) problems.push('날짜는 2026-11-12처럼 적는다');
  if (!isText(entry.boss_id)) problems.push('어느 보스를 돌았는지 고르지 않았다');
  if (!(entry.stage === null || entry.stage === undefined || (Number.isInteger(entry.stage) && entry.stage >= 1 && entry.stage <= STAGE_MAX))) {
    problems.push(`달성 단계는 1~${STAGE_MAX}의 정수다(모르면 비워 둔다)`);
  }
  const gear = entry.gear ?? {};
  if (!isPlainObject(gear) || !REWARD_PARTS.every((part) => gear[part] === undefined || isCount(gear[part], REWARD_GEAR_MAX))) {
    problems.push(`얻은 장비의 수는 부위마다 0~${REWARD_GEAR_MAX}의 정수다(없으면 비워 둔다)`);
  } else if (Object.keys(gear).some((part) => !REWARD_PARTS.includes(part))) {
    problems.push(`장비 부위는 ${REWARD_PARTS.join('·')} 넷이다`);
  }
  if (!(entry.modules === undefined || entry.modules === null || isCount(entry.modules, REWARD_MODULE_MAX))) {
    problems.push(`커스텀 모듈의 수는 0~${REWARD_MODULE_MAX}의 정수다(없으면 비워 둔다)`);
  }
  return problems;
}

function cleanReward(entry) {
  const gear = isPlainObject(entry.gear) ? entry.gear : {};
  return {
    id: String(entry.id),
    date: entry.date,
    boss_id: entry.boss_id,
    boss_name: isText(entry.boss_name) ? entry.boss_name : entry.boss_id,
    stage: Number.isInteger(entry.stage) ? entry.stage : null,
    gear: Object.fromEntries(REWARD_PARTS.map((part) => [part, gear[part] ?? 0])),
    modules: entry.modules ?? 0,
    note: isText(entry.note) ? entry.note.trim().slice(0, 200) : null,
    created_at: isText(entry.created_at) ? entry.created_at : null,
  };
}

/**
 * 저장해 둔 기록 목록을 읽는다. 모양이 맞지 않는 것은 버리고 그 수를 알린다(나머지는 쓴다).
 * @returns {{rewards: object[], dropped: number}}
 */
export function readRewards(raw) {
  if (raw === undefined || raw === null) return { rewards: [], dropped: 0 };
  if (!Array.isArray(raw)) return { rewards: [], dropped: 1 };
  const rewards = raw.filter((e) => rewardProblems(e).length === 0 && (isText(e.id) || Number.isInteger(e.id))).map(cleanReward);
  return { rewards, dropped: raw.length - rewards.length };
}

const rewardsOf = (plan) => (Array.isArray(plan?.rewards) ? plan.rewards : []);

/**
 * 기록을 하나 더한 새 계획 문서(받은 문서는 바꾸지 않는다). 모양이 맞지 않으면 문제 목록과 함께 던진다(`error.problems`).
 * @param {any} plan 요격전 계획 문서(plan.mjs)
 * @param {any} input `{date, boss_id, boss_name, stage?, gear?: {머리?, 몸통?, 팔?, 다리?}, modules?, note?}`
 * @param {{now?: string | null}} [options] now: 적은 시각(ISO). 시계는 부르는 쪽이 읽는다.
 */
export function addReward(plan, input, { now = null } = {}) {
  const problems = rewardProblems(input);
  if (problems.length) {
    const error = new Error(problems.join(' / '));
    error.problems = problems;
    throw error;
  }
  const before = rewardsOf(plan);
  const next = Math.max(0, ...before.map((r) => Number(/^m(\d+)$/.exec(r.id)?.[1] ?? 0))) + 1;
  const entry = cleanReward({ ...input, id: `m${next}`, created_at: now });
  return { ...plan, rewards: [...before, entry].slice(-MAX_REWARDS) };
}

/** 기록 하나를 뺀 새 계획 문서. */
export function removeReward(plan, id) {
  return { ...plan, rewards: rewardsOf(plan).filter((r) => r.id !== id) };
}

/** 기록들의 합: 돈 횟수, 커스텀 모듈 수, 부위별 장비 수와 그 합. */
export function rewardSum(entries) {
  const gear = Object.fromEntries(REWARD_PARTS.map((part) => [part, 0]));
  let modules = 0;
  for (const e of entries) {
    modules += e.modules ?? 0;
    for (const part of REWARD_PARTS) gear[part] += e.gear?.[part] ?? 0;
  }
  return { runs: entries.length, modules, gear, gear_total: REWARD_PARTS.reduce((s, part) => s + gear[part], 0) };
}

function group(entries, keyOf) {
  const groups = new Map();
  for (const e of entries) {
    const key = keyOf(e);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return groups;
}

/** 주 하나의 말: 「11월 9일 ~ 11월 15일」. */
function weekLabel(from) {
  const to = addDays(from, 6);
  const say = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
  return `${say(from)} ~ ${say(to)}`;
}

/**
 * 주마다 또는 달마다의 합(최근이 앞). 주는 월요일부터 일요일까지다.
 * @param {object[]} entries 기록 목록
 * @param {'week' | 'month'} period
 * @returns {Array<{key: string, label: string, from: string, to: string | null, runs: number, modules: number, gear: object, gear_total: number}>}
 */
export function periodTotals(entries, period) {
  const groups = group(entries, (e) => (period === 'week' ? weekStart(e.date) : monthOf(e.date)));
  return [...groups.entries()]
    .sort(([a], [b]) => byText(b, a))
    .map(([key, list]) =>
      period === 'week'
        ? { key, label: weekLabel(key), from: key, to: addDays(key, 6), ...rewardSum(list) }
        : { key, label: `${Number(key.slice(0, 4))}년 ${Number(key.slice(5, 7))}월`, from: `${key}-01`, to: null, ...rewardSum(list) },
    );
}

/**
 * 보스마다 몇 번 돌았는가(많이 돈 순서 → 이름순): 횟수, 마지막으로 돈 날, 가장 높았던 달성 단계, 얻은 것의 합.
 * `bosses`(`{id, name}` 목록)를 주면 한 번도 적지 않은 보스도 0번으로 넣고 이름은 그 목록의 것을 쓴다.
 */
export function bossCounts(entries, bosses = []) {
  const groups = group(entries, (e) => e.boss_id);
  const nameOf = new Map(bosses.map((b) => [b.id, b.name]));
  const ids = [...new Set([...bosses.map((b) => b.id), ...groups.keys()])];
  return ids
    .map((id, order) => {
      const list = groups.get(id) ?? [];
      const stages = list.map((e) => e.stage).filter(Number.isInteger);
      return {
        boss_id: id,
        boss_name: nameOf.get(id) ?? list.at(-1)?.boss_name ?? id,
        order,
        last_date: list.reduce((latest, e) => (latest === null || e.date > latest ? e.date : latest), null),
        best_stage: stages.length ? Math.max(...stages) : null,
        ...rewardSum(list),
      };
    })
    .sort((a, b) => b.runs - a.runs || a.order - b.order)
    .map(({ order: _order, ...rest }) => rest);
}

/**
 * 기록장의 요약: 전체 합, 이번 주·이번 달의 합(`today`가 든 주와 달 — 기록이 없어도 0으로 나온다), 주별·월별 합, 보스별 횟수.
 * @param {any} plan 요격전 계획 문서
 * @param {{today: string, bosses?: Array<{id: string, name: string}>}} options today: 오늘(`YYYY-MM-DD` — 시계는 부르는 쪽이 읽는다)
 */
export function journalSummary(plan, { today, bosses = [] } = {}) {
  const entries = rewardsOf(plan);
  const weeks = periodTotals(entries, 'week');
  const months = periodTotals(entries, 'month');
  const thisWeek = weekStart(today);
  const thisMonth = monthOf(today);
  const blank = (key, label, from, to) => ({ key, label, from, to, ...rewardSum([]) });
  return {
    total: rewardSum(entries),
    /** 오늘이 든 주. `today`가 날짜가 아니면 null. */
    this_week: thisWeek === null ? null : (weeks.find((w) => w.key === thisWeek) ?? blank(thisWeek, weekLabel(thisWeek), thisWeek, addDays(thisWeek, 6))),
    /** 오늘이 든 달. */
    this_month:
      thisMonth === null
        ? null
        : (months.find((m) => m.key === thisMonth) ?? blank(thisMonth, `${Number(thisMonth.slice(0, 4))}년 ${Number(thisMonth.slice(5, 7))}월`, `${thisMonth}-01`, null)),
    weeks,
    months,
    bosses: bossCounts(entries, bosses),
    notes: [...JOURNAL_NOTES],
  };
}

/**
 * 날짜별 보기(최근 날짜가 앞): 그날 적은 보상 기록(`rewards`)과 그날의 요격전 대미지 기록(P-029의 `records` — `damages`)을
 * 한 묶음으로. 같은 날 안에서는 나중에 적은 것이 앞이다. 어느 쪽도 고치지 않는다.
 */
export function journalDays(plan) {
  const days = new Map();
  const dayOf = (date) => {
    if (!days.has(date)) days.set(date, { date, rewards: [], damages: [] });
    return days.get(date);
  };
  for (const e of rewardsOf(plan)) dayOf(e.date).rewards.unshift(e);
  for (const r of Array.isArray(plan?.records) ? plan.records : []) dayOf(r.date).damages.unshift(r);
  return [...days.values()].sort((a, b) => byText(b.date, a.date));
}

/** 기록 한 줄에서 얻은 것을 말로: 「머리 장비 1 · 커스텀 모듈 2」. 아무것도 없으면 「얻은 것 없음」. */
export function rewardText(entry) {
  const gear = REWARD_PARTS.filter((part) => (entry.gear?.[part] ?? 0) > 0).map((part) => `${part} 장비 ${entry.gear[part]}`);
  const modules = (entry.modules ?? 0) > 0 ? [`커스텀 모듈 ${entry.modules}`] : [];
  const all = [...gear, ...modules];
  return all.length ? all.join(' · ') : '얻은 것 없음';
}
