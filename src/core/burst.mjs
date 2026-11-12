// 버스트 흐름(P-032) — 편성의 버스트 순환을 엔진의 출력에서 읽는 순수 모듈.
//
// 엔진의 JSON 결과(vendor/nikke-calc/docs/SIM-JSON.md §결과 객체)에는 버스트 흐름이 없다. 엔진은 그것을 텍스트 보기
// `--view burst`(runner/sim.py — `SimLog.burst_summary()`)로만 낸다:
//
//     [버스트 사이클]
//       t=  3.000s  stage:1 사용  리틀 머메이드
//       t=  3.100s  stage:2 사용  크라운
//       t=  3.200s  stage:3 사용  라피 : 레드 후드
//       t=  3.583s  full_burst 시작
//       t= 13.583s  full_burst 종료
//
// 그래서 같은 요청을 텍스트 보기로 한 번 더 돌려(런타임의 `runViews`) 그 줄들을 읽는다 — 총딜을 낸 계산과 같은 요청이다
// (compare.mjs의 squadRequest). 줄의 뜻을 아는 것만 읽고, 모르는 줄은 버리지 않고 `unread`에 남긴다. 엔진이 주지 않는
// 것(버스트 게이지 충전 내역 — 다른 보기 `gauge`, 버스트가 늦은 까닭)은 지어내지 않는다.
// `node:` 모듈을 import하지 않는다(웹뷰와 Node가 함께 쓴다). 형식은 docs/data-model.md §버스트 흐름.
import { validateAccount } from './account.mjs';
import { InputError, squadProblems, squadRequest } from './compare.mjs';
import { validateCondition } from './condition.mjs';
import { engineAccess } from './runtime.mjs';

/** 런타임에 청하는 엔진의 보기 종류. */
export const BURST_VIEW = 'burst';
export const BURST_SCHEMA_VERSION = 1;
/** 요청에 전투 시간을 적지 않았을 때 엔진이 도는 시간(초) — 엔진 문서 SIM-JSON.md §요청 `sim.duration`의 기본값. */
export const ENGINE_DEFAULT_DURATION = 180;
/**
 * 「기다렸다」의 기준(초) — **이 앱의 규칙이다**(엔진은 버스트가 늦은 까닭을 말하지 않는다). 풀 버스트 하나를 여는 동안
 * 버스트와 버스트 사이가 이만큼 벌어지면 다음 단계가 준비되지 않아 기다린 것으로 센다. 엔진이 버스트를 이어 쓸 때의
 * 간격은 0.1초다(엔진 문서 GAMEPLAY.md — `switching` 0.1초, 재진입 0.5초).
 */
export const STALL_GAP_SECONDS = 1;

const HEADER = '[버스트 사이클]';
const STAGES = ['1', '2', '3'];
// 엔진의 줄: `  t={t:7.3f}s  {event}{"  " + caster}`
const LINE = /^\s*t=\s*(\d+(?:\.\d+)?)s {2}(\S.*?)\s*$/;
const USE = /^(stage|reenter):(\S+) 사용 {2}(\S.*)$/;

/**
 * 엔진의 버스트 보기 글 → 사건 목록. 엔진이 적은 값(시각·단계·이름)을 그대로 옮긴다.
 *   use               버스트 사용. `stage`(엔진 표기 그대로 '1'·'2'·'3'), `name`(쓴 니케), `reenter`(엔진의 `reenter:N` — 버스트 재진입)
 *   full_burst_start  풀 버스트 시작
 *   full_burst_end    풀 버스트 종료
 *   note              뜻은 알지만 흐름에 쓰지 않는 줄(게이지 만충·카메라 초점 — 엔진의 게이지 판정 모드에서만 나온다)
 * 모르는 줄, 편성에 없는 이름의 줄은 `unread`에 원문 그대로 남는다.
 * @param {string} text 엔진의 표준 출력
 * @param {{members?: string[]}} [options] 편성(주면 이름을 대조한다)
 * @returns {{found: boolean, events: {t: number, kind: string, stage?: string, name?: string, reenter?: boolean}[], unread: string[]}}
 *   `found` = 버스트 사이클 머리줄이 있었다. 없으면 엔진이 이 정보를 주지 않은 것이다
 */
export function parseBurstView(text, options = {}) {
  const members = Array.isArray(options.members) ? options.members : null;
  const lines = typeof text === 'string' ? text.split(/\r?\n/) : [];
  const at = lines.findIndex((l) => l.trim() === HEADER);
  if (at < 0) return { found: false, events: [], unread: [] };
  const events = [];
  const unread = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue;
    const m = LINE.exec(line);
    if (!m) {
      unread.push(line.trim());
      continue;
    }
    const t = Number(m[1]);
    const what = m[2];
    const use = USE.exec(what);
    if (use) {
      const name = use[3].trim();
      if (members && !members.includes(name)) unread.push(line.trim());
      else events.push({ t, kind: 'use', stage: use[2], name, reenter: use[1] === 'reenter' });
    } else if (what === 'full_burst 시작') events.push({ t, kind: 'full_burst_start' });
    else if (what === 'full_burst 종료') events.push({ t, kind: 'full_burst_end' });
    else if (what.startsWith('게이지 만충') || what.startsWith('카메라 초점')) events.push({ t, kind: 'note' });
    else unread.push(line.trim());
  }
  return { found: true, events, unread };
}

/** 초를 「3분」·「1분 30초」·「20초」로. */
export function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const whole = Math.round(seconds);
  const min = Math.floor(whole / 60);
  const sec = whole % 60;
  if (min === 0) return `${sec}초`;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

/** 초를 소수 첫째 자리까지(「20」·「12.5」). */
export function secondsText(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  const r = Math.round(seconds * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * 사건 목록 → 버스트 흐름의 요약. 엔진이 준 시각만으로 센다(단위는 전부 초).
 * @param {{t: number, kind: string, stage?: string, name?: string, reenter?: boolean}[]} events parseBurstView의 `events`
 * @param {{duration: number, members: string[]}} context 전투 시간(요청의 `sim.duration`)과 편성(자리 순서)
 * @returns {object} docs/data-model.md §버스트 흐름 §흐름
 */
export function summarizeBurst(events, context) {
  const duration = context.duration;
  const members = context.members;
  const uses = [];
  const fullBursts = [];
  let chain = [];
  let open = null;
  for (const e of events) {
    if (e.kind === 'use') {
      const use = { t: e.t, stage: e.stage, name: e.name, reenter: e.reenter === true };
      uses.push(use);
      chain.push(use);
    } else if (e.kind === 'full_burst_start') {
      // 가장 길게 벌어진 자리: 버스트와 버스트 사이, 또는 마지막 버스트와 풀 버스트 시작 사이.
      let wait = 0;
      let waitedFor = null;
      for (let i = 1; i < chain.length; i += 1) {
        const gap = chain[i].t - chain[i - 1].t;
        if (gap > wait) {
          wait = gap;
          waitedFor = { stage: chain[i].stage, reenter: chain[i].reenter };
        }
      }
      open = {
        index: fullBursts.length + 1,
        start: e.t,
        end: null,
        // 엔진이 종료를 적지 않았다 = 전투가 끝날 때까지 열려 있었다.
        open: true,
        users: chain,
        chain_start: chain.length ? chain[0].t : null,
        wait: round3(wait),
        waited_for: wait >= STALL_GAP_SECONDS ? waitedFor : null,
      };
      fullBursts.push(open);
      chain = [];
    } else if (e.kind === 'full_burst_end' && open) {
      open.end = e.t;
      open.open = false;
      open = null;
    }
  }
  const pending = chain;

  const count = fullBursts.length;
  const firstAt = count ? fullBursts[0].start : null;
  const averagePeriod = count >= 2 ? round3((fullBursts[count - 1].start - fullBursts[0].start) / (count - 1)) : null;
  const uptime = round3(fullBursts.reduce((sum, fb) => sum + Math.max(0, (fb.end ?? duration) - fb.start), 0));

  const byStage = {};
  for (const stage of STAGES) byStage[stage] = [];
  for (const u of uses) {
    const list = (byStage[u.stage] ??= []);
    const row = list.find((r) => r.name === u.name);
    if (row) row.count += 1;
    else list.push({ name: u.name, count: 1 });
  }
  // 많이 쓴 순. 같으면 먼저 쓴 순(안정 정렬).
  for (const list of Object.values(byStage)) list.sort((a, b) => b.count - a.count);

  const byMember = members.map((name) => {
    const mine = uses.filter((u) => u.name === name);
    return { name, count: mine.length, stages: [...new Set(mine.map((u) => u.stage))], uses: mine.map((u) => ({ t: u.t, stage: u.stage, reenter: u.reenter })) };
  });

  const stalls = fullBursts.filter((fb) => fb.wait >= STALL_GAP_SECONDS).map((fb) => ({ index: fb.index, wait: fb.wait, stage: fb.waited_for?.stage ?? null }));
  // 풀 버스트로 이어지지 못하고 전투가 끝난 버스트: 마지막 버스트 뒤로 남은 시간.
  const tailWait = pending.length ? round3(Math.max(0, duration - pending[pending.length - 1].t)) : 0;

  let status = 'ok';
  let problem = null;
  if (count === 0) {
    status = 'none';
    const used = new Set(uses.map((u) => u.stage));
    const missing = STAGES.find((s) => !used.has(s));
    if (uses.length === 0) problem = '버스트를 쓴 니케가 없다 — 풀 버스트가 한 번도 열리지 않았다.';
    else if (missing) problem = `${missing}단계 버스트를 쓴 니케가 없어 풀 버스트가 한 번도 열리지 않았다(${[...used].sort().join('·')}단계까지만 이어졌다).`;
    else problem = '1·2·3단계 버스트는 이어졌지만 전투가 끝날 때까지 풀 버스트가 열리지 않았다.';
  } else if (stalls.length > 0) {
    status = 'stalled';
    const worst = stalls.reduce((a, b) => (b.wait > a.wait ? b : a));
    problem =
      `풀 버스트 ${count}번 가운데 ${stalls.length}번은 다음 버스트가 ${STALL_GAP_SECONDS}초 넘게 늦었다 — ` +
      `가장 길게는 ${worst.stage ? `${worst.stage}단계를 ` : ''}${secondsText(worst.wait)}초 기다렸다. 버스트 쿨타임이 맞지 않는 것으로 보인다.`;
  } else if (tailWait >= STALL_GAP_SECONDS && pending.length < STAGES.length && count > 0 && tailWait > (averagePeriod ?? Infinity)) {
    // 잘 돌다가 끝에서만 끊겼다: 한 주기보다 오래 다음 버스트가 오지 않았다.
    status = 'stalled';
    problem = `마지막 풀 버스트 뒤로 ${secondsText(tailWait)}초 동안 다음 풀 버스트가 열리지 않은 채 전투가 끝났다.`;
  }

  const headline =
    count === 0
      ? `${durationText(duration)} 동안 풀 버스트가 한 번도 열리지 않았다`
      : `${durationText(duration)} 동안 풀 버스트 ${count}번${averagePeriod === null ? '' : `, 평균 ${secondsText(averagePeriod)}초마다`}`;

  return {
    duration,
    count,
    // 첫 풀 버스트가 열린 시각과 첫 버스트를 쓴 시각(초). 없으면 null.
    first_at: firstAt,
    first_use_at: uses.length ? uses[0].t : null,
    // 평균 주기(초) = (마지막 풀 버스트 시작 − 첫 풀 버스트 시작) ÷ (횟수 − 1). 두 번 미만이면 모른다(null).
    average_period: averagePeriod,
    // 풀 버스트가 열려 있던 시간의 합(초)과 전투 시간에 대한 비율(0~1).
    uptime_seconds: uptime,
    uptime_ratio: duration > 0 ? round3(uptime / duration) : null,
    full_bursts: fullBursts,
    uses,
    by_stage: byStage,
    by_member: byMember,
    pending,
    tail_wait: tailWait,
    stalls,
    status,
    headline,
    problem,
  };
}

/**
 * 두 흐름을 한 문장으로 견준다(위가 기준, 아래가 견줄 편성). 둘 다 읽었을 때만.
 * 어느 쪽이 낫다고 판정하지 않는다 — 풀 버스트 횟수와 평균 주기가 어떻게 다른지만 말한다(총딜은 따로 본다).
 */
export function compareFlows(base, other) {
  if (!base || !other) return null;
  const countDelta = other.count - base.count;
  const parts = [countDelta === 0 ? `풀 버스트 횟수는 같다(${base.count}번)` : `풀 버스트 ${base.count}번 → ${other.count}번`];
  if (base.average_period !== null && other.average_period !== null) {
    parts.push(
      Math.abs(other.average_period - base.average_period) < 0.05
        ? `평균 주기도 같다(${secondsText(base.average_period)}초)`
        : `평균 주기 ${secondsText(base.average_period)}초 → ${secondsText(other.average_period)}초`,
    );
  }
  if (base.first_at !== null && other.first_at !== null && Math.abs(other.first_at - base.first_at) >= 0.05) {
    parts.push(`첫 풀 버스트 ${secondsText(base.first_at)}초 → ${secondsText(other.first_at)}초`);
  }
  return { count_delta: countDelta, text: `${parts.join(', ')}.` };
}

/** 결과와 함께 보여야 하는 것. 접힌 구획에 싣는다. */
export const BURST_CAVEATS = Object.freeze([
  '버스트 흐름은 계산 도구가 편성을 돌려 본 기록이다. 실제 전투와 대조하지 않았다.',
  '총딜을 낸 계산과 같은 조건이다(크리티컬·코어 히트는 기대값). 계산 도구의 버스트 보기(--view burst)가 적은 시각을 그대로 옮겼다.',
  '누가 언제 버스트를 쓰는지는 계산 도구의 캐릭터별 기본 운용이다(자리 순서대로, 앞사람이 쿨타임이면 뒷사람). 손으로 정하는 것은 지원하지 않음.',
  `「늦었다」는 판정은 이 앱의 규칙이다: 풀 버스트 하나를 여는 동안 버스트와 버스트 사이가 ${STALL_GAP_SECONDS}초 이상 벌어지면 늦은 것으로 센다. 계산 도구는 늦은 까닭을 말하지 않는다.`,
  '지원하지 않음: 버스트 게이지가 차는 내역(계산 도구의 다른 보기라 이 화면은 그리지 않는다), 보스 패턴에 따른 변화.',
]);

/**
 * 편성들의 버스트 흐름을 엔진에서 읽는다(편성마다 엔진의 텍스트 보기 한 번 — 총딜 계산과는 따로 돈다).
 * @param {{account: object, condition: object, squads: {name?: string, members: string[], growth?: string}[]}} input
 *   편성은 하나 이상. 둘을 주면 `comparison`에 둘을 견준 문장이 실린다(첫째가 기준)
 * @param {object} [deps] compareSquads와 같다. 런타임에 `runViews`가 있어야 한다(없으면 던진다)
 * @returns {Promise<object>} docs/data-model.md §버스트 흐름
 */
export async function burstReport({ account, condition, squads }, deps = {}) {
  const engine = engineAccess(deps);
  const catalog = await engine.catalog();
  const a = validateAccount(account, catalog);
  if (!a.ok) throw new InputError('계정 상태가 잘못됐다', a.errors);
  const c = validateCondition(condition, catalog);
  if (!c.ok) throw new InputError('전투 조건이 잘못됐다', c.errors);
  if (!Array.isArray(squads) || squads.length === 0) {
    throw new InputError('편성이 없다', [{ path: '/squads', message: '편성을 하나 이상 줘야 한다' }]);
  }

  const lines = squads.map((s, i) => ({ name: s?.name ?? `편성 ${i + 1}`, members: s?.members, ...(s?.growth ? { growth: s.growth } : {}) }));
  const sendable = [];
  for (const [i, line] of lines.entries()) {
    const problems = squadProblems({ ...squads[i], name: line.name }, account, catalog);
    if (problems.length) {
      line.status = 'rejected';
      line.reasons = problems;
    } else {
      sendable.push({ line, request: squadRequest(squads[i], account, condition).request });
    }
  }

  const rows = sendable.length ? await engine.runViews(sendable.map((s) => s.request), BURST_VIEW, { concurrency: deps.concurrency }) : [];
  if (!Array.isArray(rows) || rows.length !== sendable.length) {
    throw new Error(`엔진 런타임이 요청 ${sendable.length}건에 결과 ${Array.isArray(rows) ? rows.length : 0}건을 돌려줬다`);
  }
  for (const [i, { line, request }] of sendable.entries()) {
    const row = rows[i];
    if (!row || typeof row.text !== 'string') {
      line.status = 'failed';
      line.error = { type: row?.error?.type ?? 'missing', message: row?.error?.message ?? '엔진이 이 편성의 출력을 돌려주지 않았다' };
      continue;
    }
    const parsed = parseBurstView(row.text, { members: line.members });
    if (!parsed.found) {
      // 엔진이 주지 않은 것을 추정하지 않는다.
      line.status = 'failed';
      line.error = { type: 'not_provided', message: '엔진의 출력에 버스트 흐름([버스트 사이클])이 없다 — 엔진이 이 정보를 주지 않았다' };
      continue;
    }
    line.status = 'read';
    line.flow = summarizeBurst(parsed.events, { duration: request.sim?.duration ?? ENGINE_DEFAULT_DURATION, members: line.members });
    line.unread = parsed.unread;
  }

  const read = lines.filter((l) => l.status === 'read');
  const unread = read.reduce((n, l) => n + l.unread.length, 0);
  return {
    schema_version: BURST_SCHEMA_VERSION,
    kind: 'burst_flow',
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
    account: { name: account.name ?? null, is_test_data: account.is_test_data, updated_at: account.updated_at ?? null },
    condition,
    // 전투 시간(초) — 시간축의 길이.
    duration: condition.duration ?? ENGINE_DEFAULT_DURATION,
    source: { view: BURST_VIEW, stall_gap_seconds: STALL_GAP_SECONDS },
    lines,
    // 두 편성을 줬고 둘 다 읽었을 때만.
    comparison: lines.length === 2 && lines.every((l) => l.status === 'read') ? compareFlows(lines[0].flow, lines[1].flow) : null,
    engine: await engine.version(),
    caveats: [...BURST_CAVEATS, ...(unread > 0 ? [`계산 도구의 출력 가운데 뜻을 모르는 줄 ${unread}개는 읽지 않았다(그리지 않았다).`] : [])],
  };
}
