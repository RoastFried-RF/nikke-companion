import assert from 'node:assert/strict';
import test from 'node:test';
import { InputError } from '../../src/core/compare.mjs';
import { applyUpgrade, compareGrowth, gainRate } from '../../src/core/growth.mjs';
import { renderGrowthReport } from '../../src/core/render.mjs';

const stage = { 가: '1', 나: '2', 다: '3', 라: '3', 마: '3', 바: '2' };
const catalog = { nikkes: Object.fromEntries(Object.entries(stage).map(([n, s]) => [n, { burst_stage: s }])), bosses: ['보스'] };
const makeAccount = () => ({
  schema_version: 1,
  is_test_data: true,
  name: '단위 테스트 계정',
  nikkes: {
    가: { skill_levels: [4, 4, 4], breakthrough: 1, core_enhancement: 0, overload: { 공격력: 2, '우월 코드 대미지': 1 } },
    나: { skill_levels: [7, 7, 7] },
    다: {},
    라: { skill_levels: [10, 10, 10], unknown: ['overload', 'core_enhancement'] },
    마: { skill_levels: [1, 1, 1] },
    바: { overload: { 공격력: [15, 15] } },
  },
});
const condition = { schema_version: 1, content: 'solo_raid', boss: '보스' };
const now = () => new Date('2026-11-12T00:00:00Z');
const squad = { name: '기준', members: ['가', '나', '다', '라', '마'] };

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

// 가짜 엔진: 멤버 딜 = 1000 + 스킬 레벨 합×100 + 돌파×500 + 코어×200 + 오버로드 줄 수×50.
// 프로필에 `엔진오류` 칸이 실린 요청은 오류를 낸다.
function memberDamage(entry = {}) {
  const skills = (entry.skill_levels ?? [1, 1, 1]).reduce((s, v) => s + v, 0);
  const lines = Object.values(entry.overload ?? {}).reduce((s, v) => s + (Array.isArray(v) ? v.length : v), 0);
  return 1000 + skills * 100 + (entry.breakthrough ?? 0) * 500 + (entry.core_enhancement ?? 0) * 200 + lines * 50;
}
function fakeEngine(log = [], { failBaseline = false } = {}) {
  return async (requests) => {
    log.push(...requests);
    return requests.map((req, i) => {
      if (failBaseline && i === 0) return { error: { type: 'invalid_input', message: '기준 오류', path: '/profile' } };
      if (Object.values(req.profile.chars).some((e) => e.affinity === 40)) return { error: { type: 'invalid_input', message: '가짜 오류', path: '/profile/chars' } };
      const dmg = req.squad.map((n) => memberDamage(req.profile.chars[n]));
      const total = dmg.reduce((a, b) => a + b, 0);
      return {
        total_damage: total,
        members: req.squad.map((n, k) => ({ name: n, damage: dmg[k], share: dmg[k] / total })),
        warnings: [],
        spec: { profile: { ungrown: [] } },
        evaluator: { repo: 'fake', commit: 'abc', dirty: false },
      };
    });
  };
}
const deps = (log, opt) => ({ catalog, runBatch: fakeEngine(log, opt), now });
const run = (upgrades, log, account = makeAccount()) => compareGrowth({ account, condition, squad, upgrades }, deps(log));

// 기준 편성 총딜: 가 2850 + 나 3100 + 다 1300 + 라 4000 + 마 1300
const BASE_TOTAL = 12550;

test('증가율 = (적용 후 − 적용 전) / 적용 전', () => {
  assert.equal(gainRate(100, 125), 0.25);
  assert.equal(gainRate(200, 200), 0);
  assert.equal(gainRate(200, 150), -0.25);
  assert.equal(gainRate(4_000_000_000, 4_100_000_000), 0.025);
});

test('적용 전 총딜이 0 이하이거나 수가 아니면 증가율은 null이다', () => {
  assert.equal(gainRate(0, 100), null);
  assert.equal(gainRate(-5, 100), null);
  assert.equal(gainRate(NaN, 100), null);
  assert.equal(gainRate(100, undefined), null);
});

test('applyUpgrade: set은 값을 바꾸고 add는 현재 값에 더한다', () => {
  const account = makeAccount();
  const r = applyUpgrade(account, {
    changes: [
      { nikke: '가', set: { skill_levels: [10, 10, 10] }, add: { breakthrough: 2, overload: { 공격력: 1, '차지 속도': 2 } } },
      { nikke: '나', add: { skill_levels: [1, 0, 3] } },
    ],
  });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.account.nikkes.가, { skill_levels: [10, 10, 10], breakthrough: 3, core_enhancement: 0, overload: { 공격력: 3, '우월 코드 대미지': 1, '차지 속도': 2 } });
  assert.deepEqual(r.account.nikkes.나.skill_levels, [8, 7, 10]);
  assert.deepEqual(
    r.changes.map((c) => [c.nikke, c.field, c.before, c.after]),
    [
      ['가', 'skill_levels', [4, 4, 4], [10, 10, 10]],
      ['가', 'breakthrough', 1, 3],
      ['가', 'overload', { 공격력: 2, '우월 코드 대미지': 1 }, { 공격력: 3, '우월 코드 대미지': 1, '차지 속도': 2 }],
      ['나', 'skill_levels', [7, 7, 7], [8, 7, 10]],
    ],
  );
});

test('applyUpgrade: 적지 않은 칸에 더하면 미육성 값에서 더한다', () => {
  const r = applyUpgrade(makeAccount(), { nikke: '다', add: { skill_levels: [3, 0, 0], breakthrough: 1, core_enhancement: 2, overload: { 공격력: 1 } } });
  assert.deepEqual(r.account.nikkes.다, { skill_levels: [4, 1, 1], breakthrough: 1, core_enhancement: 2, overload: { 공격력: 1 } });
  assert.deepEqual(r.changes.map((c) => c.before), [null, null, null, null]);
});

test('applyUpgrade: 오버로드 옵션은 표기가 달라도 같은 옵션으로 합친다', () => {
  const r = applyUpgrade(makeAccount(), { nikke: '가', add: { overload: { 우월코드: 2, atk_pct: 1 } } });
  assert.deepEqual(r.account.nikkes.가.overload, { 공격력: 3, '우월 코드 대미지': 3 });
  const s = applyUpgrade(makeAccount(), { nikke: '가', set: { overload: { '우월코드 대미지': 4 } } });
  assert.deepEqual(s.account.nikkes.가.overload, { 공격력: 2, '우월 코드 대미지': 4 });
});

test('applyUpgrade: 줄별 레벨 표기끼리는 이어 붙이고, 줄 수 표기와 섞으면 거절한다', () => {
  const ok = applyUpgrade(makeAccount(), { nikke: '바', add: { overload: { 공격력: [10] } } });
  assert.deepEqual(ok.account.nikkes.바.overload, { 공격력: [15, 15, 10] });
  const mixed = applyUpgrade(makeAccount(), { nikke: '바', add: { overload: { 공격력: 1 } } });
  assert.equal(mixed.account, null);
  assert.match(mixed.problems.join(), /줄 수 표기와 줄별 레벨 표기는 서로 더할 수 없다/);
});

test('applyUpgrade: 받은 계정 문서를 바꾸지 않는다', () => {
  const account = deepFreeze(makeAccount());
  const snapshot = structuredClone(account);
  const r = applyUpgrade(account, { nikke: '가', set: { overload: { 공격력: 4 } }, add: { skill_levels: [1, 1, 1], core_enhancement: 3 } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(account, snapshot);
  assert.notEqual(r.account, account);
  // 결과 쪽을 고쳐도 원본과 이어져 있지 않다.
  r.account.nikkes.가.overload.공격력 = 99;
  assert.equal(account.nikkes.가.overload.공격력, 2);
});

test('applyUpgrade: 미확인 칸은 set이면 미확인 표시를 지우고 메모를 남기고, add면 거절한다', () => {
  const set = applyUpgrade(makeAccount(), { nikke: '라', set: { core_enhancement: 7 } });
  assert.deepEqual(set.account.nikkes.라, { skill_levels: [10, 10, 10], unknown: ['overload'], core_enhancement: 7 });
  assert.match(set.notes.join(), /라: core_enhancement의 적용 전 값이 미확인/);
  const both = applyUpgrade(makeAccount(), { nikke: '라', set: { core_enhancement: 7, overload: { 공격력: 1 } } });
  assert.equal('unknown' in both.account.nikkes.라, false);

  const add = applyUpgrade(makeAccount(), { nikke: '라', add: { overload: { 공격력: 1 } } });
  assert.equal(add.account, null);
  assert.match(add.problems.join(), /미확인 칸이라 더할 기준 값이 없다/);
});

test('applyUpgrade: 잘못 적은 후보는 문제로 돌려준다', () => {
  const problems = (u) => applyUpgrade(makeAccount(), u).problems.join(' | ');
  assert.match(problems({ nikke: '없음', set: { breakthrough: 3 } }), /보유하지 않은 니케: 없음/);
  assert.match(problems({ nikke: '가', set: { skil_levels: [1, 1, 1] } }), /모르는 육성 칸이다: skil_levels/);
  assert.match(problems({ nikke: '가', add: { affinity: 5 } }), /affinity에는 add를 쓸 수 없다/);
  assert.match(problems({ nikke: '가', set: { breakthrough: 3 }, add: { breakthrough: 1 } }), /set과 add에 함께/);
  assert.match(problems({ nikke: '가', add: { skill_levels: [1, 1] } }), /정수 3개/);
  assert.match(problems({ nikke: '가', add: { breakthrough: -1 } }), /0 이상의 정수/);
  assert.match(problems({ nikke: '가' }), /바꿀 내용이 없다/);
  assert.match(problems({ name: '빈 후보' }), /바꿀 내용이 없다/);
  assert.match(problems({ nikke: '가', set: { breakthrough: 3 }, changes: [{ nikke: '나', set: { breakthrough: 3 } }] }), /함께 쓸 수 없다/);
  assert.match(problems({ nikke: '가', set: { breakthrough: 3 }, sett: {} }), /모르는 칸이다: sett/);
  assert.match(problems('헬름 스킬'), /객체여야 한다/);
});

test('후보마다 적용 전후 총딜·증가량·증가율을 내고 증가율 순으로 순위를 매긴다', async () => {
  const log = [];
  const report = await run(
    [
      { name: '가 스킬 +1', nikke: '가', add: { skill_levels: [1, 0, 0] } }, // +100
      { name: '마 돌파 3', nikke: '마', set: { breakthrough: 3 } }, // +1500
      { name: '나 코어 +2', nikke: '나', add: { core_enhancement: 2 } }, // +400
    ],
    log,
  );
  assert.equal(report.kind, 'growth');
  assert.equal(report.baseline.name, '기준');
  assert.equal(report.baseline.total_damage, BASE_TOTAL);
  assert.deepEqual(
    report.ranking.map((r) => [r.rank, r.name, r.total_before, r.total_after, r.gain]),
    [
      [1, '마 돌파 3', BASE_TOTAL, BASE_TOTAL + 1500, 1500],
      [2, '나 코어 +2', BASE_TOTAL, BASE_TOTAL + 400, 400],
      [3, '가 스킬 +1', BASE_TOTAL, BASE_TOTAL + 100, 100],
    ],
  );
  for (const r of report.ranking) {
    assert.equal(r.gain_rate, (r.total_after - r.total_before) / r.total_before);
    assert.equal(r.members.reduce((s, m) => s + m.gain, 0), r.gain, '멤버별 증가량의 합은 총 증가량이다');
  }
  assert.equal(report.ranking[0].gain_rate, 1500 / BASE_TOTAL);
  assert.deepEqual(report.ranking[0].members.filter((m) => m.gain !== 0).map((m) => [m.name, m.gain]), [['마', 1500]]);
  // 기준 1건 + 후보 3건만 엔진에 보낸다. 모두 같은 편성·같은 조건이다.
  assert.equal(log.length, 4);
  for (const req of log) {
    assert.deepEqual(req.squad, squad.members);
    assert.equal(req.sim.expected, true);
    assert.equal(req.profile.base, 'ungrown');
  }
  assert.deepEqual(log[0].profile.chars.마, { skill_levels: [1, 1, 1] });
  assert.deepEqual(log[2].profile.chars.마, { skill_levels: [1, 1, 1], breakthrough: 3 });
  assert.equal(report.generated_at, '2026-11-12T00:00:00.000Z');
  assert.equal(report.engine.commit, 'abc');
});

test('총딜이 줄어드는 후보는 음수 증가율로 맨 뒤에 온다', async () => {
  const report = await run([
    { name: '낮춤', nikke: '나', set: { skill_levels: [1, 1, 1] } }, // -1800
    { name: '올림', nikke: '나', set: { skill_levels: [7, 7, 8] } }, // +100
  ]);
  assert.deepEqual(report.ranking.map((r) => [r.name, r.gain]), [['올림', 100], ['낮춤', -1800]]);
  assert.equal(report.ranking[1].gain_rate, -1800 / BASE_TOTAL);
});

test('같은 증가량이면 입력 순서를 지킨다', async () => {
  const report = await run([
    { name: '첫째', nikke: '가', add: { skill_levels: [1, 0, 0] } },
    { name: '둘째', nikke: '나', add: { skill_levels: [0, 1, 0] } },
  ]);
  assert.deepEqual(report.ranking.map((r) => r.name), ['첫째', '둘째']);
});

test('원래 계정 문서를 바꾸지 않는다', async () => {
  const account = deepFreeze(makeAccount());
  const snapshot = structuredClone(account);
  const report = await run(
    [
      { nikke: '가', set: { skill_levels: [10, 10, 10], overload: { 공격력: 4 } } },
      { nikke: '라', set: { core_enhancement: 7 } },
      { nikke: '다', add: { overload: { 공격력: 2 }, breakthrough: 3 } },
    ],
    [],
    account,
  );
  assert.equal(report.ranking.length, 3);
  assert.deepEqual(account, snapshot);
});

test('계산할 수 없는 후보는 엔진에 보내지 않고 사유와 함께 제외한다', async () => {
  const log = [];
  const report = await run(
    [
      { name: '정상', nikke: '가', add: { core_enhancement: 1 } },
      { name: '범위 밖', nikke: '라', add: { skill_levels: [1, 0, 0] } },
      { name: '편성 밖', nikke: '바', set: { breakthrough: 3 } },
      { name: '그대로', nikke: '나', set: { skill_levels: [7, 7, 7] } },
      { name: '미보유', nikke: '사', set: { breakthrough: 3 } },
      { nikke: '라', add: { core_enhancement: 1 } },
    ],
    log,
  );
  assert.deepEqual(report.ranking.map((r) => r.name), ['정상']);
  const reasons = Object.fromEntries(report.rejected.map((r) => [r.name, r.reasons.join(' | ')]));
  assert.match(reasons['범위 밖'], /적용 후 값이 범위를 벗어난다: \/nikkes\/라\/skill_levels/);
  assert.match(reasons['편성 밖'], /기준 편성에 없는 니케만 바꾼다\(바\)/);
  assert.match(reasons['그대로'], /현재 상태와 같다/);
  assert.match(reasons['미보유'], /보유하지 않은 니케: 사/);
  assert.match(reasons['후보 6'], /미확인 칸/, '이름이 없는 후보는 순번으로 부른다');
  assert.equal(log.length, 2, '기준 + 정상 후보만 계산한다');
});

test('편성 안팎을 함께 바꾸는 후보는 계산하되 반영되지 않는 변경을 메모로 알린다', async () => {
  const report = await run([{ name: '묶음', changes: [{ nikke: '가', add: { core_enhancement: 1 } }, { nikke: '바', set: { breakthrough: 3 } }] }]);
  assert.equal(report.ranking[0].gain, 200);
  assert.match(report.ranking[0].notes.join(), /기준 편성에 없는 니케의 변경은 총딜에 반영되지 않는다: 바/);
});

test('미확인 칸에 set한 후보는 증가율이 과대일 수 있다는 메모가 붙는다', async () => {
  const report = await run([{ name: '라 코어', nikke: '라', set: { core_enhancement: 7 } }]);
  assert.equal(report.ranking[0].gain, 1400);
  assert.match(report.ranking[0].notes.join(), /증가율이 실제보다 크게 나올 수 있다/);
  assert.match(report.baseline.notes.join(), /라: 미확인 칸\(overload, core_enhancement\)/);
});

test('엔진이 오류를 낸 후보는 순위에 넣지 않고 따로 보고한다', async () => {
  const report = await run([
    { name: '오류', nikke: '가', set: { affinity: 40 } },
    { name: '정상', nikke: '가', add: { core_enhancement: 1 } },
  ]);
  assert.deepEqual(report.failed.map((f) => [f.name, f.error.message, f.error.path]), [['오류', '가짜 오류', '/profile/chars']]);
  assert.deepEqual(report.ranking.map((r) => [r.rank, r.name]), [[1, '정상']]);
});

test('기준 총딜이 0이면 증가율은 null이고 증가량으로 순위를 매긴다', async () => {
  const runBatch = async (reqs) => reqs.map((r, i) => ({ total_damage: [0, 50, 80][i], members: r.squad.map((n) => ({ name: n, damage: 0, share: 0 })), warnings: [] }));
  const report = await compareGrowth(
    { account: makeAccount(), condition, squad, upgrades: [{ name: 'ㄱ', nikke: '가', add: { core_enhancement: 1 } }, { name: 'ㄴ', nikke: '나', add: { core_enhancement: 1 } }] },
    { catalog, runBatch, now, engineDir: 'unused' },
  );
  assert.deepEqual(report.ranking.map((r) => [r.name, r.gain, r.gain_rate]), [['ㄴ', 80, null], ['ㄱ', 50, null]]);
  assert.match(renderGrowthReport(report), /증가율 계산 불가/);
});

test('잘못된 입력은 InputError다: 계정·조건·기준 편성·빈 후보·기준 편성 엔진 오류', async () => {
  const ups = [{ nikke: '가', add: { core_enhancement: 1 } }];
  const call = (over, d = deps()) => compareGrowth({ account: makeAccount(), condition, squad, upgrades: ups, ...over }, d);
  await assert.rejects(call({ account: { ...makeAccount(), schema_version: 9 } }), InputError);
  await assert.rejects(call({ condition: { ...condition, boss: '없는 보스' } }), InputError);
  await assert.rejects(call({ squad: { members: ['가', '나', '다', '라', '사'] } }), /기준 편성이 잘못됐다.*엔진이 모르는 이름: 사/);
  await assert.rejects(call({ squad: undefined }), /기준 편성이 없다/);
  await assert.rejects(call({ upgrades: [] }), /업그레이드 후보가 없다/);
  await assert.rejects(call({ upgrades: undefined }), InputError);
  await assert.rejects(call({}, deps([], { failBaseline: true })), /기준 편성을 엔진이 계산하지 못했다.*기준 오류/);
});

test('표시: 기준 편성, 순위·증가율·전후 총딜, 바꾼 칸, 제외 사유, 주의 문구', async () => {
  const report = await run([
    { name: '마 돌파 3', nikke: '마', set: { breakthrough: 3 } },
    { name: '낮춤', nikke: '나', set: { skill_levels: [1, 1, 1] } },
    { name: '편성 밖', nikke: '바', set: { breakthrough: 3 } },
  ]);
  const text = renderGrowthReport(report);
  assert.match(text, /\[검증용 데이터\]/);
  assert.match(text, /기준 편성: 기준 {2}총딜 1만 \(12,550\)/);
  assert.match(text, /1위 {2}마 돌파 3 {2}\+11\.95% {2}총딜 1만 → 1만 \(\+1,500\)/);
  assert.match(text, /마 breakthrough: \(적지 않음\) → 3/);
  assert.match(text, /2위 {2}낮춤 {2}-14\.34% {2}총딜 1만 → 1만 \(-1,800\)/);
  assert.match(text, /나 skill_levels: \[7,7,7\] → \[1,1,1\]/);
  assert.match(text, /계산하지 않은 후보:\n {2}- 편성 밖: 기준 편성에 없는 니케만 바꾼다/);
  assert.match(text, /재화·비용은 고려하지 않았다/);
  assert.match(text, /실제 게임 기록과 대조하지 않았다/);
});
