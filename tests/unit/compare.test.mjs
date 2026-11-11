import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSquads, squadProblems, InputError } from '../../src/core/compare.mjs';

const stage = { 가: '1', 나: '2', 다: '3', 라: '3', 마: '3', 바: '2', 사: '3' };
const catalog = { nikkes: Object.fromEntries(Object.entries(stage).map(([n, s]) => [n, { burst_stage: s }])), bosses: ['보스'] };
// '사'는 엔진은 알지만 보유하지 않은 니케다.
const account = { schema_version: 1, is_test_data: true, nikkes: { 가: {}, 나: {}, 다: {}, 라: {}, 마: {}, 바: { unknown: ['overload'] } } };
const condition = { schema_version: 1, content: 'solo_raid', boss: '보스' };
const now = () => new Date('2026-11-12T00:00:00Z');
const FULL = ['가', '나', '다', '라', '바'];

// 가짜 엔진: 멤버 이름 코드값의 합을 총딜로 돌려준다. '마'가 들어가면 오류를 낸다.
function fakeEngine(log = []) {
  return async (requests) => {
    log.push(...requests);
    return requests.map((req) => {
      if (req.squad.includes('마')) return { error: { type: 'invalid_input', message: '가짜 오류', path: '/squad/4' } };
      const dmg = req.squad.map((n) => n.codePointAt(0));
      const total = dmg.reduce((a, b) => a + b, 0);
      return {
        total_damage: total,
        members: req.squad.map((n, i) => ({ name: n, damage: dmg[i], share: dmg[i] / total })),
        warnings: [],
        spec: { profile: { ungrown: [] } },
        evaluator: { repo: 'fake', commit: 'abc', dirty: false },
      };
    });
  };
}
const deps = (log) => ({ catalog, runBatch: fakeEngine(log), now });

test('미보유·중복·인원 수·모르는 이름은 편성 문제로 잡힌다', () => {
  assert.match(squadProblems({ members: ['가', '나', '다', '라', '사'] }, account, catalog).join(), /보유하지 않은 니케: 사/);
  assert.match(squadProblems({ members: ['가', '나', '다', '라', '라'] }, account, catalog).join(), /두 번/);
  assert.match(squadProblems({ members: ['가', '나', '다'] }, account, catalog).join(), /5명/);
  assert.match(squadProblems({ members: ['가', '나', '다', '라', '없음'] }, account, catalog).join(), /모르는 이름: 없음/);
  assert.deepEqual(squadProblems({ members: FULL }, account, catalog), []);
});

test('문제 있는 편성은 엔진에 보내지 않고 사유와 함께 제외한다', async () => {
  const log = [];
  const report = await compareSquads(
    { account, condition, squads: [{ name: '정상', members: FULL }, { name: '미보유', members: ['가', '나', '다', '라', '사'] }] },
    deps(log),
  );
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].squad, FULL);
  assert.deepEqual(report.rejected.map((r) => r.name), ['미보유']);
  assert.equal(report.ranking.length, 1);
});

test('엔진 요청은 기대값 모드이고 프로필 base는 ungrown이다', async () => {
  const log = [];
  await compareSquads({ account, condition, squads: [{ members: FULL }] }, deps(log));
  assert.equal(log[0].sim.expected, true);
  assert.equal(log[0].boss, '보스');
  assert.equal(log[0].profile.base, 'ungrown');
  assert.deepEqual(Object.keys(log[0].profile.chars), FULL);
});

test('총딜 내림차순으로 순위를 매기고 1위 대비 비율을 계산한다', async () => {
  const runBatch = async (reqs) =>
    reqs.map((r, i) => ({
      total_damage: (i + 1) * 100,
      members: r.squad.map((n) => ({ name: n, damage: (i + 1) * 20, share: 0.2 })),
      warnings: [],
      evaluator: { repo: 'fake', commit: 'abc' },
    }));
  const report = await compareSquads(
    { account, condition, squads: [{ name: '낮음', members: FULL }, { name: '높음', members: [...FULL].reverse() }] },
    { catalog, runBatch, now },
  );
  assert.deepEqual(report.ranking.map((r) => [r.rank, r.name, r.total_damage]), [[1, '높음', 200], [2, '낮음', 100]]);
  assert.equal(report.ranking[1].relative_to_best, 0.5);
  assert.equal(report.engine.commit, 'abc');
});

test('엔진 오류가 난 편성은 순위에 넣지 않고 따로 보고한다', async () => {
  const report = await compareSquads(
    { account, condition, squads: [{ name: '오류', members: ['가', '나', '다', '라', '마'] }, { name: '정상', members: FULL }] },
    deps(),
  );
  assert.deepEqual(report.failed.map((f) => [f.name, f.error.path]), [['오류', '/squad/4']]);
  assert.deepEqual(report.ranking.map((r) => r.name), ['정상']);
});

test('미확인 칸이 있는 멤버를 결과 메모로 알린다', async () => {
  const report = await compareSquads({ account, condition, squads: [{ members: FULL }] }, deps());
  assert.match(report.ranking[0].notes.join(), /바: 미확인 칸\(overload\)/);
});

test('버스트 1단계가 없으면 메모가 붙는다', async () => {
  const acct = { ...account, nikkes: { ...account.nikkes, 사: {} } };
  const report = await compareSquads({ account: acct, condition, squads: [{ members: ['나', '다', '라', '바', '사'] }] }, deps());
  assert.match(report.ranking[0].notes.join(), /버스트 1단계 니케가 없다/);
});

test('결과에 검증용 데이터 표시·가정·주의 문구가 실린다', async () => {
  const report = await compareSquads({ account, condition, squads: [{ members: FULL }] }, deps());
  assert.equal(report.account.is_test_data, true);
  assert.ok(report.assumptions.length > 0);
  assert.match(report.caveats.join(), /실제 게임 기록과 대조하지 않았다/);
  assert.equal(report.generated_at, '2026-11-12T00:00:00.000Z');
});

test('잘못된 계정·조건·빈 후보는 InputError다', async () => {
  await assert.rejects(compareSquads({ account: { ...account, schema_version: 9 }, condition, squads: [{ members: FULL }] }, deps()), InputError);
  await assert.rejects(compareSquads({ account, condition: { ...condition, boss: '없는 보스' }, squads: [{ members: FULL }] }, deps()), InputError);
  await assert.rejects(compareSquads({ account, condition, squads: [] }, deps()), InputError);
});
