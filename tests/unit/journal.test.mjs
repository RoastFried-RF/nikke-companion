// 모듈 기록장(P-033)의 순수 함수: 날짜 계산, 기록의 모양 검사·더하기·빼기, 주·월 합계, 보스별 횟수, 날짜별 보기.
// 엔진도 파일도 쓰지 않는다. 화면은 app/tests/DailyTools.test.ts가 본다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, isDate, monthOf, weekStart } from '../../src/core/dates.mjs';
import {
  addReward,
  bossCounts,
  JOURNAL_NOTES,
  journalDays,
  journalSummary,
  MAX_REWARDS,
  periodTotals,
  readRewards,
  removeReward,
  REWARD_GEAR_MAX,
  REWARD_MODULE_MAX,
  REWARD_PARTS,
  rewardProblems,
  rewardSum,
  rewardText,
  STAGE_MAX,
} from '../../src/core/journal.mjs';
import { addRecord, emptyPlan, GEAR_PARTS, isDate as planIsDate, readPlan, STAGE_MAX as PLAN_STAGE_MAX } from '../../src/core/plan.mjs';

const BOSSES = [
  { id: 'indivilia', name: '인디빌리아' },
  { id: 'ultra', name: '울트라' },
  { id: 'kraken', name: '크라켄' },
];
const entry = (over = {}) => ({ date: '2026-11-12', boss_id: 'kraken', boss_name: '크라켄', stage: 4, gear: {}, modules: 2, ...over });

test('날짜: 달력에 있는 날만 받고, 주는 월요일부터 일요일까지로 묶는다', () => {
  assert.ok(isDate('2026-11-12'));
  assert.ok(isDate('2028-02-29'));
  for (const bad of ['2026-02-30', '2026-13-01', '11/12', '2026-1-1', '', null, 20261112]) assert.ok(!isDate(bad), String(bad));
  // 요격전 기록(P-029)이 쓰던 이름 그대로다.
  assert.equal(planIsDate, isDate);
  assert.equal(PLAN_STAGE_MAX, STAGE_MAX);

  // 2026-11-12는 목요일이다 — 그 주는 11월 9일(월)부터 15일(일)까지.
  assert.equal(weekStart('2026-11-12'), '2026-11-09');
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // 일요일은 그 주의 끝이다
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  // 달과 해를 넘는 주.
  assert.equal(weekStart('2026-11-01'), '2026-10-26');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(weekStart('없는 날'), null);

  assert.equal(addDays('2026-11-09', 6), '2026-11-15');
  assert.equal(addDays('2026-12-28', 6), '2027-01-03');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('x', 1), null);
  assert.equal(monthOf('2026-11-12'), '2026-11');
  assert.equal(monthOf('2026-02-30'), null);
});

test('기록의 모양: 날짜·보스는 있어야 하고, 수는 범위 안의 정수다 — 틀리면 이유를 말한다', () => {
  assert.deepEqual(rewardProblems(entry()), []);
  assert.deepEqual(rewardProblems({ date: '2026-11-12', boss_id: 'kraken' }), []); // 단계·얻은 것은 비워도 된다
  assert.deepEqual(rewardProblems(entry({ gear: { 머리: 1, 다리: 0 }, modules: 0, stage: null })), []);
  assert.match(rewardProblems(entry({ date: '11/12' }))[0], /날짜는 2026-11-12처럼/);
  assert.match(rewardProblems(entry({ boss_id: '' }))[0], /어느 보스를 돌았는지/);
  assert.match(rewardProblems(entry({ stage: 0 }))[0], /달성 단계는 1~99의 정수/);
  assert.match(rewardProblems(entry({ stage: Number.NaN }))[0], /달성 단계/);
  assert.match(rewardProblems(entry({ gear: { 머리: -1 } }))[0], /부위마다 0~99의 정수/);
  assert.match(rewardProblems(entry({ gear: { 머리: 1.5 } }))[0], /부위마다/);
  assert.match(rewardProblems(entry({ gear: { 머리: REWARD_GEAR_MAX + 1 } }))[0], /부위마다/);
  assert.match(rewardProblems(entry({ gear: { 머리: Number.NaN } }))[0], /부위마다/);
  assert.match(rewardProblems(entry({ gear: { 신발: 1 } }))[0], /장비 부위는 머리·몸통·팔·다리 넷이다/);
  assert.match(rewardProblems(entry({ gear: [1] }))[0], /부위마다/);
  assert.match(rewardProblems(entry({ modules: REWARD_MODULE_MAX + 1 }))[0], /커스텀 모듈의 수는 0~999의 정수/);
  assert.match(rewardProblems(entry({ modules: Number.NaN }))[0], /커스텀 모듈/);
  assert.deepEqual(rewardProblems('x'), ['기록은 객체여야 한다']);
  assert.equal(rewardProblems({}).length, 2);
  // 부위는 계정 문서의 장비 부위와 같다.
  assert.deepEqual([...REWARD_PARTS], GEAR_PARTS);
});

test('기록을 더하고 빼고 다시 읽는다 — 받은 문서는 바꾸지 않는다', () => {
  const start = Object.freeze({ ...emptyPlan(), rewards: Object.freeze([]) });
  const first = addReward(start, entry({ gear: { 머리: 1 } }), { now: '2026-11-12T12:00:00.000Z' });
  assert.equal(start.rewards.length, 0);
  assert.deepEqual(first.rewards, [
    { id: 'm1', date: '2026-11-12', boss_id: 'kraken', boss_name: '크라켄', stage: 4, gear: { 머리: 1, 몸통: 0, 팔: 0, 다리: 0 }, modules: 2, note: null, created_at: '2026-11-12T12:00:00.000Z' },
  ]);
  const second = addReward(first, { date: '2026-11-13', boss_id: 'ultra' });
  assert.deepEqual(second.rewards[1], { id: 'm2', date: '2026-11-13', boss_id: 'ultra', boss_name: 'ultra', stage: null, gear: { 머리: 0, 몸통: 0, 팔: 0, 다리: 0 }, modules: 0, note: null, created_at: null });
  // 요격전 기록(P-029)과 즐겨찾기는 그대로다 — 서로 건드리지 않는다.
  const withDamage = addRecord(second, { boss_id: 'kraken', boss_name: '크라켄', damage: 900_000_000, mode: 'mock', date: '2026-11-12' });
  assert.equal(withDamage.rewards.length, 2);
  assert.equal(addReward(withDamage, entry()).records.length, 1);

  const removed = removeReward(second, 'm1');
  assert.deepEqual(removed.rewards.map((r) => r.id), ['m2']);
  // 지운 뒤에 더해도 남은 번호와 겹치지 않는다.
  assert.equal(addReward(removed, entry()).rewards.at(-1).id, 'm3');
  // 예전 문서(rewards 칸이 없다)에도 더할 수 있다.
  assert.equal(addReward({ schema_version: 1, kind: 'intercept_plan', favorites: [], records: [] }, entry()).rewards[0].id, 'm1');

  // 모양이 맞지 않으면 문제 목록과 함께 던지고 아무것도 바뀌지 않는다.
  assert.throws(() => addReward(first, entry({ modules: -1 })), (e) => /커스텀 모듈/.test(e.message) && e.problems.length === 1);

  // 디스크를 다녀온 것처럼(JSON) 계획 문서째로 다시 읽어도 같다.
  const { plan, dropped } = readPlan(JSON.parse(JSON.stringify(withDamage)));
  assert.deepEqual(plan, withDamage);
  assert.equal(dropped, 0);
  // 깨진 기록은 버리고 그 수를 알린다(나머지는 쓴다).
  const broken = readRewards([{ id: 'm1', ...entry() }, { id: 'm2', ...entry({ modules: -1 }) }, 'x', { ...entry() }]);
  assert.deepEqual(broken.rewards.map((r) => r.id), ['m1']);
  assert.equal(broken.dropped, 3);
  assert.deepEqual(readRewards(undefined), { rewards: [], dropped: 0 });
  assert.deepEqual(readRewards('글자'), { rewards: [], dropped: 1 });
  assert.equal(readPlan({ kind: 'intercept_plan', schema_version: 1, favorites: [], records: [], rewards: [{ id: 'm1', ...entry() }, 3] }).dropped, 1);

  // 한도를 넘으면 오래 적은 것부터 뺀다.
  let many = emptyPlan();
  for (let i = 0; i < MAX_REWARDS + 2; i += 1) many = addReward(many, entry());
  assert.equal(many.rewards.length, MAX_REWARDS);
  assert.equal(many.rewards[0].id, 'm3');
});

test('주·월 합계와 보스별 횟수 — 적은 것만 센다', () => {
  let plan = emptyPlan();
  const add = (over) => (plan = addReward(plan, entry(over)));
  add({ date: '2026-11-12', boss_id: 'kraken', boss_name: '크라켄', stage: 4, modules: 2 });
  add({ date: '2026-11-12', boss_id: 'ultra', boss_name: '울트라', stage: 3, gear: { 머리: 1 }, modules: 0 });
  add({ date: '2026-11-10', boss_id: 'kraken', boss_name: '크라켄', stage: 5, modules: 3 });
  add({ date: '2026-11-08', boss_id: 'kraken', boss_name: '크라켄', stage: null, modules: 1 }); // 앞 주(11월 2일~8일)
  add({ date: '2026-10-30', boss_id: 'indivilia', boss_name: '인디빌리아', stage: 2, gear: { 몸통: 2, 팔: 1 }, modules: 0 }); // 지난달

  assert.deepEqual(rewardSum(plan.rewards), { runs: 5, modules: 6, gear: { 머리: 1, 몸통: 2, 팔: 1, 다리: 0 }, gear_total: 4 });
  assert.deepEqual(rewardSum([]), { runs: 0, modules: 0, gear: { 머리: 0, 몸통: 0, 팔: 0, 다리: 0 }, gear_total: 0 });

  const weeks = periodTotals(plan.rewards, 'week');
  assert.deepEqual(weeks.map((w) => [w.key, w.label, w.to, w.runs, w.modules, w.gear_total]), [
    ['2026-11-09', '11월 9일 ~ 11월 15일', '2026-11-15', 3, 5, 1],
    ['2026-11-02', '11월 2일 ~ 11월 8일', '2026-11-08', 1, 1, 0],
    ['2026-10-26', '10월 26일 ~ 11월 1일', '2026-11-01', 1, 0, 3],
  ]);
  const months = periodTotals(plan.rewards, 'month');
  assert.deepEqual(months.map((m) => [m.key, m.label, m.from, m.runs, m.modules, m.gear_total]), [
    ['2026-11', '2026년 11월', '2026-11-01', 4, 6, 1],
    ['2026-10', '2026년 10월', '2026-10-01', 1, 0, 3],
  ]);

  const summary = journalSummary(plan, { today: '2026-11-12', bosses: BOSSES });
  assert.equal(summary.total.runs, 5);
  assert.deepEqual([summary.this_week.key, summary.this_week.runs, summary.this_week.modules], ['2026-11-09', 3, 5]);
  assert.deepEqual([summary.this_month.key, summary.this_month.runs, summary.this_month.modules], ['2026-11', 4, 6]);
  assert.deepEqual(summary.notes, [...JOURNAL_NOTES]);
  assert.match(summary.notes[0], /보상이 나올 확률과 한 번에 얻는 수는 이 앱이 모른다/);
  assert.match(summary.notes[1], /월요일부터 일요일까지/);
  // 보스별: 많이 돈 순서 → 받은 순서. 한 번도 적지 않은 보스는 0번이다(없는 것으로 지어내지 않는다).
  assert.deepEqual(summary.bosses.map((b) => [b.boss_name, b.runs, b.last_date, b.best_stage, b.modules, b.gear_total]), [
    ['크라켄', 3, '2026-11-12', 5, 6, 0],
    ['인디빌리아', 1, '2026-10-30', 2, 0, 3],
    ['울트라', 1, '2026-11-12', 3, 0, 1],
  ]);
  assert.deepEqual(bossCounts([], BOSSES).map((b) => [b.boss_name, b.runs, b.last_date, b.best_stage]), [
    ['인디빌리아', 0, null, null],
    ['울트라', 0, null, null],
    ['크라켄', 0, null, null],
  ]);
  // 목록에 없는 보스의 기록도 센다(이름은 기록의 것).
  assert.deepEqual(bossCounts(plan.rewards).map((b) => b.boss_name), ['크라켄', '울트라', '인디빌리아']);

  // 기록이 없는 주·달도 0으로 나온다(「오늘」은 부르는 쪽이 넘긴다 — 이 모듈은 시계를 읽지 않는다).
  const later = journalSummary(plan, { today: '2027-01-01', bosses: BOSSES });
  assert.deepEqual([later.this_week.key, later.this_week.label, later.this_week.runs], ['2026-12-28', '12월 28일 ~ 1월 3일', 0]);
  assert.deepEqual([later.this_month.key, later.this_month.label, later.this_month.runs, later.this_month.gear_total], ['2027-01', '2027년 1월', 0, 0]);
  const unknownDay = journalSummary(plan, { today: '오늘' });
  assert.equal(unknownDay.this_week, null);
  assert.equal(unknownDay.this_month, null);
  assert.equal(unknownDay.total.runs, 5);
  assert.equal(journalSummary(emptyPlan(), { today: '2026-11-12' }).total.runs, 0);
});

test('날짜별 보기: 보상 기록과 요격전 대미지 기록(P-029)을 한 묶음으로 — 최근이 앞', () => {
  let plan = emptyPlan();
  plan = addReward(plan, entry({ date: '2026-11-10', modules: 1 }));
  plan = addReward(plan, entry({ date: '2026-11-12', boss_id: 'ultra', boss_name: '울트라', gear: { 머리: 1 }, modules: 0 }));
  plan = addReward(plan, entry({ date: '2026-11-12', modules: 2 }));
  plan = addRecord(plan, { boss_id: 'kraken', boss_name: '크라켄', damage: 900_000_000, mode: 'mock', date: '2026-11-12', stage: 4 });
  plan = addRecord(plan, { boss_id: 'ultra', boss_name: '울트라', damage: 500_000_000, mode: 'real', date: '2026-11-11' });

  const days = journalDays(plan);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-12', '2026-11-11', '2026-11-10']);
  // 같은 날 안에서는 나중에 적은 것이 앞이다.
  assert.deepEqual(days[0].rewards.map((r) => r.id), ['m3', 'm2']);
  assert.deepEqual(days[0].damages.map((r) => r.id), ['r1']);
  assert.deepEqual(days[1].rewards, []);
  assert.deepEqual(days[1].damages.map((r) => r.damage), [500_000_000]);
  assert.deepEqual(days[2].damages, []);
  // 문서는 바뀌지 않았다.
  assert.deepEqual(plan.rewards.map((r) => r.id), ['m1', 'm2', 'm3']);
  assert.deepEqual(journalDays(emptyPlan()), []);
  assert.deepEqual(journalDays(null), []);

  assert.equal(rewardText(plan.rewards[1]), '머리 장비 1');
  assert.equal(rewardText(plan.rewards[2]), '커스텀 모듈 2');
  assert.equal(rewardText({ gear: { 머리: 1, 다리: 2 }, modules: 3 }), '머리 장비 1 · 다리 장비 2 · 커스텀 모듈 3');
  assert.equal(rewardText({ gear: {}, modules: 0 }), '얻은 것 없음');
});
