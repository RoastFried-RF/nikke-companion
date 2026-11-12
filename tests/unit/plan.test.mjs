// 요격전 계획(src/core/plan.mjs): 장비 상태 분류, 주력 선정의 세 경우, 보스 추천과 동률, 기록과 추정의 비교, 커버리지 기준.
// 시험 계정은 data/samples/account.large.sample.json(지어낸 계정)에 data/samples/gear.large.sample.json(지어낸 장비)을 얹은 것이다.
// 실제 계정 파일은 읽지 않는다. 엔진은 부르지 않는다(카탈로그 파일에서 속성·클래스·기업만 읽는다).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { investmentScore } from '../../src/core/candidates.mjs';
import {
  addRecord,
  bossEstimate,
  catalogInfoOf,
  compareRecord,
  CORE_BY_SCORE,
  COVERAGE_RULE,
  COVERAGE_RULE_TEXT,
  elementCoverage,
  ELEMENTS,
  emptyPlan,
  GEAR_PARTS,
  gearRow,
  gearRows,
  gearState,
  gearSummary,
  isDate,
  isGrown,
  latestRecord,
  MAX_RECORDS,
  parseDamage,
  pickCore,
  PLAN_KIND,
  readPlan,
  recommendBoss,
  recordCheck,
  recordProblems,
  recordsOf,
  removeRecord,
  rewardPart,
  toggleFavorite,
} from '../../src/core/plan.mjs';

const readJson = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const large = readJson('data/samples/account.large.sample.json');
const gear = readJson('data/samples/gear.large.sample.json');
const bundle = readJson('data/intercept/anomaly.json');
const catalog = { nikkes: readJson('vendor/nikke-calc/data/parsed_nikke.json') };
const infoOf = catalogInfoOf(catalog);

/** 큰 샘플 계정에 지어낸 장비를 얹은 계정. */
function accountWithGear() {
  const account = structuredClone(large);
  for (const [name, equipment] of Object.entries(gear.equipment)) {
    assert.ok(account.nikkes[name], `장비 샘플의 니케가 계정에 있다: ${name}`);
    account.nikkes[name].equipment = structuredClone(equipment);
  }
  return account;
}

/** 지어낸 추천 결과: 보스마다 1위 편성의 멤버만 담는다. */
function reportOf(squads, total = 1_000_000_000) {
  return {
    bosses: bundle.bosses.map((b, i) => ({
      id: b.id,
      name: b.name,
      reward: b.reward,
      element: { code: b.enemy.code, weak_to: b.weak_to },
      status: squads[i] ? 'computed' : 'not_computed',
      ranking: squads[i] ? [{ rank: 1, total_damage: total + i, members: squads[i].map((name) => ({ name })) }] : [],
    })),
  };
}

// ── 장비 상태 분류 ───────────────────────────────────────────────────────────

test('장비 한 칸의 상태: 미장착 · 일반 등급 · 기업 장비 · 오버로드 — 계정에 적힌 값 그대로', () => {
  assert.equal(gearState({ tier: '없음' }), 'empty');
  assert.equal(gearState({ tier: 'T9' }), 'normal');
  assert.equal(gearState({ tier: 'T3', skills: [] }), 'normal');
  assert.equal(gearState({ tier: 'T9', level: 3, corp: '필그림' }), 'corp');
  // tier를 적지 않은 칸이 오버로드다(엔진 표기). "기업"은 엔진의 오버로드 표 이름이다.
  assert.equal(gearState({ level: 5 }), 'overload');
  assert.equal(gearState({}), 'overload');
  assert.equal(gearState({ tier: '기업', level: 2 }), 'overload');
  // 칸이 없으면 기록 없음, 읽을 수 없는 값은 미확인 — 어느 쪽도 미장착으로 치지 않는다.
  assert.equal(gearState(undefined), 'unrecorded');
  assert.equal(gearState(null), 'unrecorded');
  assert.equal(gearState({ tier: 'T10' }), 'unknown');
  assert.equal(gearState({ tier: 9 }), 'unknown');
  assert.equal(gearState('T9'), 'unknown');
  assert.equal(gearState({ tier: 'T9', corp: '' }), 'normal');
});

test('니케 한 명의 네 칸: 부위 순서는 머리·몸통·팔·다리, 등급·강화·제조사는 있는 상태에만', () => {
  const row = gearRow('크라운', { equipment: gear.equipment['크라운'] });
  assert.deepEqual(row.slots.map((s) => s.part), GEAR_PARTS);
  assert.deepEqual(row.slots.map((s) => s.state), ['overload', 'overload', 'corp', 'normal']);
  assert.deepEqual(row.slots.map((s) => s.label), ['오버로드', '오버로드', '기업 장비', '일반 등급']);
  assert.deepEqual(row.slots.map((s) => s.level), [5, 4, 3, null]);
  assert.deepEqual(row.slots.map((s) => s.tier), [null, null, 'T9', 'T9']);
  assert.deepEqual(row.slots.map((s) => s.corp), [null, null, '필그림', null]);
  assert.equal(row.recorded, true);
  assert.equal(row.open, 2);
});

test('장비를 적지 않은 니케는 「기록 없음」, 미확인으로 표시한 니케는 「미확인」 — 끼지 않은 것으로 세지 않는다', () => {
  const blank = gearRow('나가', { skill_levels: [7, 7, 7] });
  assert.deepEqual(blank.slots.map((s) => s.state), ['unrecorded', 'unrecorded', 'unrecorded', 'unrecorded']);
  assert.equal(blank.recorded, false);
  assert.equal(blank.open, 0);
  const flagged = gearRow('프리바티', { unknown: ['equipment'] });
  assert.deepEqual(flagged.slots.map((s) => s.label), ['미확인', '미확인', '미확인', '미확인']);
  assert.equal(flagged.open, 0);
  // 한 부위만 빠진 장비: 그 칸만 기록 없음이다.
  const partial = gearRow('x', { equipment: { 머리: { level: 1 }, 팔: { tier: '없음' } } });
  assert.deepEqual(partial.slots.map((s) => s.state), ['overload', 'unrecorded', 'empty', 'unrecorded']);
  assert.equal(partial.open, 1);
  // 큰 샘플 계정 자체에는 장비 칸이 없다 — 전부 기록 없음이고 필요 칸은 0이다.
  const rows = gearRows(large);
  assert.equal(rows.length, Object.keys(large.nikkes).length);
  assert.ok(rows.every((r) => !r.recorded && r.open === 0));
});

test('요약: 부위별·기업별로 오버로드가 아닌 칸을 세고, 기록 없는 니케는 따로 센다', () => {
  const account = accountWithGear();
  const rows = gearRows(account);
  const summary = gearSummary(rows, { infoOf });
  const recorded = Object.keys(gear.equipment).length;
  assert.equal(summary.nikkes, Object.keys(large.nikkes).length);
  assert.equal(summary.recorded, recorded);
  assert.equal(summary.unrecorded, summary.nikkes - recorded);

  // 샘플 장비에서 직접 센 값과 같다.
  const isOpen = (g) => g.tier !== undefined && g.tier !== '기업';
  for (const item of summary.by_part) {
    const expected = Object.values(gear.equipment).filter((e) => isOpen(e[item.part])).length;
    assert.equal(item.open, expected, item.part);
    assert.equal(item.open, item.empty + item.normal + item.corp, item.part);
    assert.equal(item.open + item.overload, recorded, item.part);
  }
  assert.deepEqual(summary.by_part.map((p) => p.part), GEAR_PARTS);
  assert.equal(summary.open, summary.by_part.reduce((s, p) => s + p.open, 0));

  // 기업은 니케의 기업이다(카탈로그). 칸 수의 합은 전체와 같고 많은 순서다.
  assert.equal(summary.by_corp.reduce((s, c) => s + c.open, 0), summary.open);
  for (const item of summary.by_corp) {
    const names = rows.filter((r) => r.open > 0 && (infoOf(r.name).corp ?? '모름') === item.corp);
    assert.equal(item.nikkes, names.length, item.corp);
    assert.equal(item.open, names.reduce((s, r) => s + r.open, 0), item.corp);
  }
  assert.deepEqual([...summary.by_corp].sort((a, b) => b.open - a.open).map((c) => c.open), summary.by_corp.map((c) => c.open));
  // 기업을 모르면 「모름」으로 묶는다(지어내지 않는다).
  assert.deepEqual(gearSummary(rows).by_corp.map((c) => c.corp), ['모름']);
  // 계정에 없는 정보는 없다고 적는다.
  assert.match(summary.unknowns.join(' '), /끼지 않은 장비의 수는 계정 정보에 없다/);
});

// ── 주력 선정 ────────────────────────────────────────────────────────────────

test('주력 ①: 요격전 추천이 있으면 보스마다 1위 편성에 든 니케다(겹치는 이름은 한 번)', () => {
  const account = accountWithGear();
  const report = reportOf([
    ['크라운', '리타', '라피 : 레드 후드', '앨리스', '헬름'],
    ['크라운', '리타', '신데렐라', '앨리스', '헬름'],
    null,
    ['크라운', '도로시', '리틀 머메이드', '에이다', '헬름'],
    ['크라운', '리타', '라피 : 레드 후드', '앨리스', '이 계정에 없는 니케'],
  ]);
  const core = pickCore({ report, favorites: ['티아'], account });
  assert.equal(core.basis, 'intercept');
  assert.deepEqual(core.names, ['크라운', '리타', '라피 : 레드 후드', '앨리스', '헬름', '신데렐라', '도로시', '리틀 머메이드', '에이다']);
  assert.equal(core.text, '주력 기준: 요격전 추천에서 보스마다 1위 편성에 든 니케 9명.');
});

test('주력 ②: 추천이 없으면 즐겨찾기, ③: 그것도 없으면 많이 키운 순서 상위', () => {
  const account = accountWithGear();
  const none = reportOf([null, null, null, null, null]);
  const fav = pickCore({ report: none, favorites: ['티아', '없는 니케', '헬름', '티아'], account });
  assert.equal(fav.basis, 'favorites');
  assert.deepEqual(fav.names, ['티아', '헬름']);
  assert.match(fav.text, /즐겨찾기로 고른 니케 2명/);

  const byScore = pickCore({ report: null, favorites: [], account });
  assert.equal(byScore.basis, 'score');
  assert.equal(byScore.names.length, CORE_BY_SCORE);
  const expected = Object.entries(account.nikkes)
    .map(([name, entry]) => [name, investmentScore(entry)])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, CORE_BY_SCORE)
    .map(([name]) => name);
  assert.deepEqual(byScore.names, expected);
  assert.match(byScore.text, /많이 키운 순서로 위에서 10명/);
  assert.deepEqual(pickCore({ account, limit: 3 }).names, expected.slice(0, 3));

  // 즐겨찾기가 전부 이 계정에 없는 이름이면 다음 기준으로 넘어간다. 계정도 없으면 고르지 못했다고 말한다.
  assert.equal(pickCore({ favorites: ['없는 니케'], account }).basis, 'score');
  assert.deepEqual(pickCore({}), { basis: 'none', names: [], text: '주력 기준: 계정에 니케가 없어 고르지 못했다.' });
});

// ── 오늘 돌 보스 ─────────────────────────────────────────────────────────────

test('보상 문구에서 장비 부위를 읽는다 — 장비가 아니면 null', () => {
  assert.deepEqual(bundle.bosses.map((b) => [b.name, rewardPart(b.reward)]), [
    ['인디빌리아', '몸통'],
    ['울트라', '머리'],
    ['하베스터', '다리'],
    ['크라켄', null],
    ['미러 컨테이너', '팔'],
  ]);
  assert.equal(rewardPart(null), null);
  assert.equal(rewardPart('머리'), null);
});

test('큰 샘플 계정: 머리 장비가 가장 급하다 → 울트라, 보스마다 필요 칸 수와 근거가 있다', () => {
  const account = accountWithGear();
  const rows = gearRows(account);
  const core = pickCore({ account });
  const pick = recommendBoss({ bosses: bundle.bosses, rows, core: core.names });
  assert.equal(pick.status, 'pick');
  assert.equal(pick.text, '머리 장비가 가장 급하다 → 울트라');
  assert.deepEqual(pick.top, ['ultra']);
  assert.deepEqual(pick.bosses.map((b) => [b.id, b.part, b.need]), [
    ['indivilia', '몸통', 1],
    ['ultra', '머리', 5],
    ['harvester', '다리', 4],
    ['kraken', null, null],
    ['mirror_container', '팔', 3],
  ]);
  assert.equal(pick.max_need, 5);
  // 근거: 어느 니케의 어느 부위가 어떤 상태인가.
  const ultra = pick.bosses.find((b) => b.id === 'ultra');
  assert.deepEqual(ultra.reasons.map((r) => [r.nikke, r.part, r.label]).sort(), [
    ['도로시 : 세렌디피티', '머리', '미장착'],
    ['리타', '머리', '미장착'],
    ['리틀 머메이드', '머리', '기업 장비'],
    ['스노우 화이트 : 이노센트 데이즈', '머리', '기업 장비'],
    ['홍련 : 흑영', '머리', '일반 등급'],
  ].sort());
  for (const b of pick.bosses) for (const r of b.reasons) assert.ok(core.names.includes(r.nikke), '근거는 주력 니케뿐이다');
  // 커스텀 모듈은 장비 부위가 아니라 세지 않는다고 적는다.
  assert.match(pick.bosses.find((b) => b.id === 'kraken').note, /커스텀 모듈.*장비 부위가 아니라 세지 않았다/);
  // 장비 기록이 없는 주력 니케는 세지 못했다고 알린다.
  assert.deepEqual(pick.unrecorded, core.names.filter((n) => !gear.equipment[n]));
  assert.ok(pick.unrecorded.length > 0);
  // 언제 다 모이는지는 말하지 않는다 — 모른다고 적는다.
  assert.match(pick.unknowns.join(' '), /확률과 한 번에 얻는 수는 모른다.*어림하지 않는다/);
  assert.doesNotMatch(JSON.stringify(pick), /예상|며칠|일 뒤/);
});

test('동률: 칸 수가 같으면 더 비어 있는 쪽이 앞, 그래도 같으면 함께 적는다', () => {
  const bosses = bundle.bosses;
  const rowsOf = (nikkes) => gearRows({ nikkes });
  const over = { level: 5 };
  // 머리 2칸(기업·기업) 대 다리 2칸(미장착·일반) — 칸 수는 같고 다리가 더 비어 있다.
  const weighted = recommendBoss({
    bosses,
    core: ['a', 'b'],
    rows: rowsOf({
      a: { equipment: { 머리: { tier: 'T9', corp: '필그림' }, 몸통: over, 팔: over, 다리: { tier: '없음' } } },
      b: { equipment: { 머리: { tier: 'T9', corp: '필그림' }, 몸통: over, 팔: over, 다리: { tier: 'T9' } } },
    }),
  });
  assert.equal(weighted.status, 'pick');
  assert.deepEqual(weighted.top, ['harvester']);
  assert.equal(weighted.text, '다리 장비가 가장 급하다 → 하베스터');

  // 머리와 팔이 똑같다(미장착 한 칸씩) — 둘 다 적는다. 순서는 보스 목록의 순서다.
  const tie = recommendBoss({
    bosses,
    core: ['a'],
    rows: rowsOf({ a: { equipment: { 머리: { tier: '없음' }, 몸통: over, 팔: { tier: '없음' }, 다리: over } } }),
  });
  assert.equal(tie.status, 'tie');
  assert.deepEqual(tie.top, ['ultra', 'mirror_container']);
  assert.equal(tie.text, '머리·팔 장비가 똑같이 급하다 → 울트라 또는 미러 컨테이너');

  // 주력이 아닌 니케의 빈 칸은 세지 않는다.
  const others = recommendBoss({
    bosses,
    core: ['a'],
    rows: rowsOf({ a: { equipment: { 머리: over, 몸통: over, 팔: over, 다리: over } }, z: { equipment: { 머리: { tier: '없음' } } } }),
  });
  assert.equal(others.status, 'done');
  assert.deepEqual(others.top, []);
  assert.match(others.text, /모두 오버로드다/);
});

test('알 수 없을 때는 그렇게 말한다: 주력이 없다 · 주력의 장비 기록이 없다', () => {
  assert.equal(recommendBoss({ bosses: bundle.bosses, rows: [], core: [] }).status, 'no_core');
  const core = pickCore({ account: large });
  const blank = recommendBoss({ bosses: bundle.bosses, rows: gearRows(large), core: core.names });
  assert.equal(blank.status, 'no_data');
  assert.match(blank.text, /장비가 계정에 적혀 있지 않아/);
  assert.deepEqual(blank.top, []);
  assert.deepEqual(blank.unrecorded, core.names);
  assert.ok(blank.bosses.every((b) => b.need === 0 || b.need === null));
});

// ── 요격전 기록 ──────────────────────────────────────────────────────────────

test('손으로 적은 대미지를 읽는다: 숫자 그대로 · 쉼표 · 조/억/만', () => {
  assert.equal(parseDamage('1,234,567,890'), 1234567890);
  assert.equal(parseDamage(' 1234567890 '), 1234567890);
  assert.equal(parseDamage('12.3억'), 1230000000);
  assert.equal(parseDamage('1조 2000억'), 1_200_000_000_000);
  assert.equal(parseDamage('3500만'), 35_000_000);
  assert.equal(parseDamage('12억 3456만 7890'), 1_234_567_890);
  assert.equal(parseDamage(987654321), 987654321);
  for (const bad of ['', '  ', '억', '많음', '-5', '0', '12.5', '1e9', '12억원', null, undefined, 0, -1, 1.5]) {
    assert.equal(parseDamage(bad), null, String(bad));
  }
});

test('기록을 더하고 빼고 다시 읽는다 — 받은 문서는 바꾸지 않는다', () => {
  const start = Object.freeze({ ...emptyPlan(), records: Object.freeze([]), favorites: Object.freeze([]) });
  const first = addRecord(start, { boss_id: 'kraken', boss_name: '크라켄', damage: 900_000_000, mode: 'mock', date: '2026-11-10', stage: 4 }, { now: '2026-11-10T12:00:00.000Z' });
  assert.equal(start.records.length, 0);
  assert.deepEqual(first.records, [
    { id: 'r1', boss_id: 'kraken', boss_name: '크라켄', damage: 900_000_000, mode: 'mock', date: '2026-11-10', stage: 4, note: null, created_at: '2026-11-10T12:00:00.000Z' },
  ]);
  const second = addRecord(first, { boss_id: 'kraken', boss_name: '크라켄', damage: 950_000_000, mode: 'real', date: '2026-11-12', stage: null });
  const third = addRecord(second, { boss_id: 'ultra', boss_name: '울트라', damage: 500_000_000, mode: 'mock', date: '2026-11-11' });
  const fourth = addRecord(third, { boss_id: 'kraken', boss_name: '크라켄', damage: 940_000_000, mode: 'mock', date: '2026-11-12' });
  assert.deepEqual(fourth.records.map((r) => r.id), ['r1', 'r2', 'r3', 'r4']);
  // 최근 날짜가 앞, 같은 날이면 나중에 적은 것이 앞.
  assert.deepEqual(recordsOf(fourth, 'kraken').map((r) => r.id), ['r4', 'r2', 'r1']);
  assert.equal(latestRecord(fourth, 'kraken').damage, 940_000_000);
  assert.equal(latestRecord(fourth, 'harvester'), null);
  const removed = removeRecord(fourth, 'r4');
  assert.equal(latestRecord(removed, 'kraken').id, 'r2');
  // 지운 뒤에 더해도 남은 번호와 겹치지 않는다.
  assert.equal(addRecord(removed, { boss_id: 'ultra', damage: 1, mode: 'real', date: '2026-11-12' }).records.at(-1).id, 'r4');

  // 디스크를 다녀온 것처럼(JSON) 다시 읽어도 같다.
  const { plan, dropped } = readPlan(JSON.parse(JSON.stringify(fourth)));
  assert.deepEqual(plan, fourth);
  assert.equal(dropped, 0);
  assert.deepEqual(readPlan(null), { plan: emptyPlan(), dropped: 0 });
  assert.equal(emptyPlan().kind, PLAN_KIND);
});

test('모양이 맞지 않는 기록은 받지 않고 이유를 말한다', () => {
  const ok = { boss_id: 'kraken', damage: 1000, mode: 'mock', date: '2026-11-12', stage: 3 };
  assert.deepEqual(recordProblems(ok), []);
  assert.equal(recordProblems({ ...ok, damage: 0 }).length, 1);
  assert.equal(recordProblems({ ...ok, damage: 12.5 }).length, 1);
  assert.equal(recordProblems({ ...ok, mode: 'sim' }).length, 1);
  assert.equal(recordProblems({ ...ok, date: '2026-02-30' }).length, 1);
  assert.equal(recordProblems({ ...ok, date: '11/12' }).length, 1);
  assert.equal(recordProblems({ ...ok, stage: 0 }).length, 1);
  assert.equal(recordProblems({ ...ok, stage: 2.5 }).length, 1);
  assert.equal(recordProblems({ ...ok, boss_id: '' }).length, 1);
  assert.equal(recordProblems({}).length, 4);
  assert.ok(isDate('2028-02-29'));
  assert.ok(!isDate('2026-02-29'));
  assert.throws(() => addRecord(emptyPlan(), { ...ok, damage: null }), (e) => /대미지를 읽을 수 없다/.test(e.message) && e.problems.length === 1);

  // 다른 종류·다른 판은 한국어로 던진다. 깨진 기록은 버리고 그 수를 알린다.
  assert.throws(() => readPlan({ kind: 'intercept_report', schema_version: 1 }), /요격전 기록이 아니다/);
  assert.throws(() => readPlan({ kind: PLAN_KIND, schema_version: 2 }), /판이 다르다/);
  const { plan, dropped } = readPlan({ kind: PLAN_KIND, schema_version: 1, favorites: ['크라운', '', '크라운', 3], records: [{ id: 'r1', ...ok }, { id: 'r2', ...ok, damage: -1 }, 'x'] });
  assert.deepEqual(plan.favorites, ['크라운']);
  assert.deepEqual(plan.records.map((r) => r.id), ['r1']);
  assert.equal(dropped, 5);

  // 한도를 넘으면 오래된 것부터 뺀다.
  let many = emptyPlan();
  for (let i = 0; i < MAX_RECORDS + 3; i += 1) many = addRecord(many, ok);
  assert.equal(many.records.length, MAX_RECORDS);
  assert.equal(many.records[0].id, 'r4');
});

test('즐겨찾기를 켜고 끈다', () => {
  const on = toggleFavorite(emptyPlan(), '크라운');
  assert.deepEqual(on.favorites, ['크라운']);
  assert.deepEqual(toggleFavorite(toggleFavorite(on, '헬름'), '크라운').favorites, ['헬름']);
});

test('기록과 추정의 비교: 비율과 방향을 말하고 추정치는 그대로 둔다', () => {
  const record = { boss_id: 'kraken', damage: 1_000_000_000, mode: 'mock', date: '2026-11-12' };
  const over = compareRecord(1_120_000_000, record);
  assert.equal(over.text, '기록과 12% 차이');
  assert.equal(over.direction, 'over');
  assert.equal(over.estimate, 1_120_000_000);
  assert.ok(Math.abs(over.diff_pct - 12) < 1e-9);
  assert.ok(Math.abs(over.ratio - 1.12) < 1e-9);
  assert.equal(over.detail, '추정 11.20억 · 기록 10.00억(모의전, 2026-11-12) — 추정이 기록보다 12% 크다. 추정치는 기록에 맞춰 고치지 않았다.');

  const under = compareRecord(750_000_000, { ...record, mode: 'real' });
  assert.equal(under.text, '기록과 25% 차이');
  assert.equal(under.direction, 'under');
  assert.match(under.detail, /실전.*추정이 기록보다 25% 작다/);

  assert.equal(compareRecord(1_000_000_000, record).text, '기록과 같다');
  assert.equal(compareRecord(1_001_000_000, record).text, '기록과 1% 미만 차이');
  // 어느 쪽이든 없으면 견주지 않는다(0%라고 말하지 않는다).
  assert.equal(compareRecord(null, record), null);
  assert.equal(compareRecord(1_000, null), null);
  assert.equal(compareRecord(0, record), null);

  // 추천 결과의 보스와 그 보스의 가장 최근 기록.
  const report = reportOf([['a'], ['a'], ['a'], ['a'], ['a']], 1_120_000_000);
  const kraken = report.bosses.find((b) => b.id === 'kraken');
  const before = JSON.stringify(report);
  let plan = addRecord(emptyPlan(), { ...record, damage: 500_000_000, date: '2026-11-01' });
  plan = addRecord(plan, record);
  assert.equal(bossEstimate(kraken), 1_120_000_003);
  assert.equal(recordCheck(kraken, plan).actual, 1_000_000_000);
  assert.equal(recordCheck(report.bosses[0], plan), null, '기록이 없는 보스');
  assert.equal(recordCheck({ ...kraken, status: 'not_computed' }, plan), null, '추정이 없는 보스');
  assert.equal(JSON.stringify(report), before, '추천 결과를 바꾸지 않는다');
});

// ── 속성 커버리지 ────────────────────────────────────────────────────────────

test('커버리지 기준: 화력형 · 돌파 3 이상 · 스킬 셋 모두 7 이상', () => {
  assert.deepEqual(COVERAGE_RULE, { klass: '화력형', breakthrough: 3, skill: 7 });
  assert.equal(COVERAGE_RULE_TEXT, '키운 딜러 = 화력형이고 돌파 3 이상, 스킬 셋이 모두 7 이상인 니케.');
  assert.equal(isGrown({ breakthrough: 3, skill_levels: [7, 7, 7] }), true);
  assert.equal(isGrown({ breakthrough: 3, skill_levels: [10, 6, 10] }), false);
  assert.equal(isGrown({ breakthrough: 2, skill_levels: [10, 10, 10] }), false);
  assert.equal(isGrown({ breakthrough: 3 }), false);
  assert.equal(isGrown({ skill_levels: [10, 10, 10] }), false);
  // 미확인 칸은 채운 것으로 치지 않는다.
  assert.equal(isGrown({ breakthrough: 3, skill_levels: [10, 10, 10], unknown: ['skill_levels'] }), false);

  const info = { 딜러: { element: '작열', klass: '화력형' }, 지원: { element: '작열', klass: '지원형' }, 덜키움: { element: '풍압', klass: '화력형' }, 모름: { element: null, klass: null } };
  const grown = { breakthrough: 3, skill_levels: [7, 7, 7] };
  const cov = elementCoverage(
    { nikkes: { 딜러: grown, 지원: grown, 덜키움: { breakthrough: 3, skill_levels: [7, 7, 6] }, 모름: grown } },
    { infoOf: (name) => info[name], bosses: bundle.bosses },
  );
  assert.deepEqual(cov.elements.map((e) => [e.element, e.count]), [['작열', 1], ['풍압', 0], ['철갑', 0], ['전격', 0], ['수냉', 0]]);
  assert.deepEqual(cov.elements[0].names, ['딜러']);
  assert.deepEqual(cov.unsure, ['모름']);
  assert.deepEqual(cov.weakest, ['풍압', '철갑', '전격', '수냉']);
  // 속성마다 그 속성이 약점인 보스가 붙는다.
  assert.deepEqual(cov.elements.map((e) => e.bosses.map((b) => b.name)), [['인디빌리아'], ['크라켄'], ['울트라'], ['미러 컨테이너'], ['하베스터']]);
});

test('큰 샘플 계정의 커버리지: 카탈로그의 속성·클래스로 센다', () => {
  const cov = elementCoverage(large, { infoOf, bosses: bundle.bosses });
  assert.deepEqual(cov.elements.map((e) => e.element), ELEMENTS);
  for (const item of cov.elements) {
    const expected = Object.entries(large.nikkes)
      .filter(([name, e]) => catalog.nikkes[name].class === '화력형' && catalog.nikkes[name].element_code === item.element)
      .filter(([, e]) => e.breakthrough >= 3 && e.skill_levels.every((v) => v >= 7) && !(e.unknown ?? []).includes('skill_levels'))
      .map(([name]) => name);
    assert.deepEqual(item.names, expected, item.element);
  }
  const total = cov.elements.reduce((s, e) => s + e.count, 0);
  assert.ok(total >= 5, `키운 딜러가 있다(${total}명)`);
  assert.equal(cov.max, Math.max(...cov.elements.map((e) => e.count)));
  assert.deepEqual(cov.unsure, []);
  // 추천 결과의 보스 모양(element.weak_to)도 받는다.
  const viaReport = elementCoverage(large, { infoOf, bosses: reportOf([null, null, null, null, null]).bosses });
  assert.deepEqual(viaReport.elements.map((e) => e.bosses), cov.elements.map((e) => e.bosses));
  // 다섯이 모두 같으면 어느 쪽이 약하다고 말하지 않는다.
  assert.deepEqual(elementCoverage({ nikkes: {} }, { infoOf }).weakest, []);
});
