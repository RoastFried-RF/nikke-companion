// 신규 니케·데이터 변경 감지. 아래 두 판은 모두 가짜 데이터다(실제 니케·수치가 아니다).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { InputError } from '../../src/core/compare.mjs';
import { detectChanges, diffEngineData, evaluationOf, readEngineDataAt, sameJson, skillsState } from '../../src/tier/detect.mjs';

const stats = (over = {}) => ({ rarity: 'SSR', burst_stage: '3', weapon_type: 'AR', damage_coeff: 13.65, optimal_range: [25, 45], ...over });
const effect = (source, name, over = {}) => ({ source, type: 'buff', name, trigger: { timing: ['burst_cast'], condition: [] }, target: 'self', stat: 'atk_pct', values: { 1: 10, 10: 20 }, ...over });

// 이전 판
const makeV1 = () => ({
  nikkes: {
    그대로: stats(),
    스탯변경: stats(),
    효과변경: stats(),
    효과증감: stats(),
    판본변경: stats(),
    순서변경: stats(),
    키순서만: stats(),
    삭제됨: stats(),
    파싱됨: stats(),
    파싱취소: stats(),
  },
  skills: {
    그대로: [effect('스킬1', '가')],
    스탯변경: [effect('스킬1', '가')],
    효과변경: [effect('스킬1', '가'), effect('스킬2', '나')],
    효과증감: [effect('스킬1', '가'), effect('스킬2', '나')],
    판본변경: [effect('스킬1', '가', { favorite: false }), effect('스킬1', '가', { favorite: true })],
    순서변경: [effect('스킬1', '가'), effect('스킬2', '나')],
    키순서만: [effect('스킬1', '가')],
    삭제됨: [effect('스킬1', '가')],
    // `파싱됨`은 이 판에서 미파싱이다(키 없음)
    파싱취소: [effect('스킬1', '가')],
  },
});

// 새 판
const makeV2 = () => ({
  nikkes: {
    그대로: stats(),
    스탯변경: stats({ damage_coeff: 15, charge_time: 1 }),
    효과변경: stats(),
    효과증감: stats(),
    판본변경: stats(),
    순서변경: stats(),
    키순서만: Object.fromEntries(Object.entries(stats()).reverse()),
    파싱됨: stats(),
    파싱취소: stats(),
    신규완비: stats(),
    신규미파싱: stats(),
    신규빈스킬: stats(),
  },
  skills: {
    그대로: [effect('스킬1', '가')],
    스탯변경: [effect('스킬1', '가')],
    효과변경: [effect('스킬1', '가'), effect('스킬2', '나', { values: { 1: 12, 10: 24 }, duration: 10 })],
    효과증감: [effect('스킬1', '가'), effect('스킬3', '다')],
    판본변경: [effect('스킬1', '가', { favorite: false }), effect('스킬1', '가', { favorite: true, max_stack: 3 })],
    순서변경: [effect('스킬2', '나'), effect('스킬1', '가')],
    키순서만: [Object.fromEntries(Object.entries(effect('스킬1', '가')).reverse())],
    파싱됨: [effect('스킬1', '가'), effect('스킬2', '나')],
    신규완비: [effect('스킬1', '가')],
    신규빈스킬: [],
    신규스탯없음: [effect('스킬1', '가')],
  },
});

const diff = () => diffEngineData(makeV1(), makeV2());
const find = (list, name) => list.find((e) => e.name === name);
const codes = (entry) => entry.evaluation.reasons.map((r) => r.code);

test('추가·변경·삭제를 구분하고 이름순으로 낸다', () => {
  const d = diff();
  assert.deepEqual(d.added.map((e) => e.name), ['신규미파싱', '신규빈스킬', '신규스탯없음', '신규완비']);
  assert.deepEqual(d.changed.map((e) => e.name), ['순서변경', '스탯변경', '파싱됨', '파싱취소', '판본변경', '효과변경', '효과증감']);
  assert.deepEqual(d.removed, [{ name: '삭제됨', evaluation_before: 'ready' }]);
  assert.deepEqual(d.summary, { added: 4, changed: 7, removed: 1, unchanged: 2, hold: 4 });
});

test('내용이 같으면 변경이 아니다 — 객체 키 순서는 무시한다', () => {
  const d = diff();
  for (const name of ['그대로', '키순서만']) {
    assert.equal(find(d.changed, name), undefined, name);
    assert.equal(find(d.added, name), undefined, name);
  }
});

test('같은 판끼리 비교하면 변경이 없다', () => {
  const d = diffEngineData(makeV1(), makeV1());
  assert.deepEqual([d.added, d.changed, d.removed, d.hold], [[], [], [], []]);
  assert.equal(d.summary.unchanged, 10);
});

test('미파싱 신규 니케는 평가 보류다', () => {
  const e = find(diff().added, '신규미파싱');
  assert.equal(e.evaluation.status, 'hold');
  assert.equal(e.evaluation.label, '평가 보류');
  assert.deepEqual(codes(e), ['skills_unparsed']);
  assert.match(e.evaluation.reasons[0].message, /파싱되지 않았다/);
  assert.equal(e.skills_state, 'unparsed');
  assert.equal(e.effects, 0);
});

test('스킬까지 파싱된 신규 니케는 평가 대상이다', () => {
  const e = find(diff().added, '신규완비');
  assert.deepEqual(e.evaluation, { status: 'ready', label: '평가 대상', reasons: [] });
  assert.equal(e.skills_state, 'parsed');
  assert.equal(e.effects, 1);
});

test('효과가 비었거나 기본 스탯이 없는 신규 니케도 평가 보류다', () => {
  const d = diff();
  assert.deepEqual(codes(find(d.added, '신규빈스킬')), ['skills_empty']);
  assert.deepEqual(codes(find(d.added, '신규스탯없음')), ['stats_missing']);
});

test('hold 목록은 추가·변경 중 평가 보류인 이름이다', () => {
  assert.deepEqual(diff().hold, ['신규미파싱', '신규빈스킬', '신규스탯없음', '파싱취소']);
});

test('미파싱이던 니케가 파싱되면 변경이고 평가 대상으로 바뀐다', () => {
  const e = find(diff().changed, '파싱됨');
  assert.equal(e.evaluation_before, 'hold');
  assert.equal(e.evaluation.status, 'ready');
  assert.equal(e.changes.skills.state_before, 'unparsed');
  assert.equal(e.changes.skills.state_after, 'parsed');
  assert.equal(e.changes.skills.effects_before, null);
  assert.equal(e.changes.skills.effects_after, 2);
  assert.deepEqual(e.changes.stats, []);
});

test('파싱됐던 니케의 스킬이 사라지면 변경이고 평가 보류로 바뀐다', () => {
  const e = find(diff().changed, '파싱취소');
  assert.equal(e.evaluation_before, 'ready');
  assert.deepEqual(codes(e), ['skills_unparsed']);
  assert.deepEqual(e.changes.skills.removed, [{ source: '스킬1', name: '가' }]);
});

test('기본 스탯 변경은 칸별로 전후 값을 낸다', () => {
  const e = find(diff().changed, '스탯변경');
  assert.deepEqual(e.changes.stats, [
    { field: 'charge_time', before: null, after: 1 },
    { field: 'damage_coeff', before: 13.65, after: 15 },
  ]);
  assert.equal(e.changes.stats_presence, null);
  assert.equal(e.changes.skills, null);
  assert.equal(e.evaluation.status, 'ready');
});

test('스킬 효과 변경은 바뀐 효과와 칸을 짚는다', () => {
  const s = find(diff().changed, '효과변경').changes.skills;
  assert.deepEqual(s.changed, [{ source: '스킬2', name: '나', fields: ['duration', 'values'] }]);
  assert.deepEqual([s.added, s.removed, s.reordered], [[], [], false]);
  assert.deepEqual([s.effects_before, s.effects_after], [2, 2]);
});

test('스킬 효과의 추가와 삭제를 구분한다', () => {
  const s = find(diff().changed, '효과증감').changes.skills;
  assert.deepEqual(s.added, [{ source: '스킬3', name: '다' }]);
  assert.deepEqual(s.removed, [{ source: '스킬2', name: '나' }]);
  assert.deepEqual(s.changed, []);
});

test('같은 칸·이름의 효과가 여럿이면 묶음째 변경으로 본다', () => {
  const s = find(diff().changed, '판본변경').changes.skills;
  assert.deepEqual(s.changed, [{ source: '스킬1', name: '가', fields: null }]);
});

test('효과 순서만 바뀌어도 변경이다', () => {
  const s = find(diff().changed, '순서변경').changes.skills;
  assert.equal(s.reordered, true);
  assert.deepEqual([s.added, s.removed, s.changed], [[], [], []]);
});

test('기본 스탯이 통째로 생기면 칸을 나열하지 않고 stats_presence로 알린다', () => {
  const v1 = { nikkes: {}, skills: { 가: [effect('스킬1', '가')] } };
  const v2 = { nikkes: { 가: stats() }, skills: { 가: [effect('스킬1', '가')] } };
  const [e] = diffEngineData(v1, v2).changed;
  assert.deepEqual(e.changes, { stats: [], stats_presence: 'added', skills: null });
  assert.equal(e.evaluation_before, 'hold');
  assert.equal(e.evaluation.status, 'ready');
  assert.equal(diffEngineData(v2, v1).changed[0].changes.stats_presence, 'removed');
});

test('입력 데이터를 바꾸지 않는다', () => {
  const freeze = (o) => {
    if (o && typeof o === 'object') {
      Object.freeze(o);
      Object.values(o).forEach(freeze);
    }
    return o;
  };
  assert.doesNotThrow(() => diffEngineData(freeze(makeV1()), freeze(makeV2())));
});

test('데이터가 이름 → 값 객체가 아니면 입력 오류다', () => {
  assert.throws(() => diffEngineData({ nikkes: [], skills: {} }, makeV2()), InputError);
  assert.throws(() => diffEngineData(makeV1(), { nikkes: {} }), InputError);
});

test('sameJson·skillsState·evaluationOf', () => {
  assert.equal(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameJson({ a: null }, { a: {} }), false);
  assert.equal(sameJson([], {}), false);
  const v2 = makeV2();
  assert.equal(skillsState(v2, '신규미파싱'), 'unparsed');
  assert.equal(skillsState(v2, '신규빈스킬'), 'empty');
  assert.equal(skillsState(v2, '신규완비'), 'parsed');
  assert.equal(evaluationOf(v2, '없는이름').status, 'hold');
});

// ── git에서 읽는 경로: 임시 저장소에 가짜 데이터 두 판을 커밋해 확인한다 ──────────────

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-detect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (data, message) => {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    if (data.nikkes) fs.writeFileSync(path.join(dir, 'data', 'parsed_nikke.json'), JSON.stringify(data.nikkes, null, 2));
    if (data.skills) fs.writeFileSync(path.join(dir, 'data', 'parsed_skills.json'), JSON.stringify(data.skills, null, 2));
    fs.writeFileSync(path.join(dir, 'note.txt'), message);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  return { dir, commit };
}

test('detectChanges: 엔진 저장소의 두 커밋에서 데이터를 읽어 비교한다', (t) => {
  const repo = makeRepo(t);
  const c1 = repo.commit(makeV1(), 'v1');
  const c2 = repo.commit(makeV2(), 'v2');
  const now = () => new Date('2026-11-12T00:00:00Z');

  const report = detectChanges({ from: 'HEAD~1', to: c2.slice(0, 10) }, { engineDir: repo.dir, now });
  assert.equal(report.schema_version, 1);
  assert.equal(report.kind, 'data_changes');
  assert.equal(report.generated_at, '2026-11-12T00:00:00.000Z');
  assert.deepEqual(report.engine, { repo: 'Jgaram/nikke-calc', from: { ref: 'HEAD~1', commit: c1 }, to: { ref: c2.slice(0, 10), commit: c2 } });
  assert.deepEqual(report.files, ['data/parsed_nikke.json', 'data/parsed_skills.json']);
  const expected = diff();
  for (const key of ['summary', 'added', 'changed', 'removed', 'hold']) assert.deepEqual(report[key], expected[key], key);
  assert.equal(report.caveats.length, 2);
  // JSON으로 그대로 옮길 수 있어야 한다.
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);

  // 작업 폴더가 아니라 커밋에서 읽는다.
  assert.deepEqual(readEngineDataAt(repo.dir, c1), makeV1());

  // 방향을 뒤집으면 추가와 삭제가 바뀌고, 조상이 아니라는 경고가 붙는다.
  const reversed = detectChanges({ from: c2, to: c1 }, { engineDir: repo.dir, now });
  assert.deepEqual(reversed.removed.map((e) => e.name), expected.added.map((e) => e.name));
  assert.deepEqual(reversed.added.map((e) => e.name), ['삭제됨']);
  assert.equal(reversed.caveats.length, 3);
  assert.match(reversed.caveats[2], /조상 커밋이 아니다/);

  // 같은 커밋끼리는 변경 없음.
  assert.deepEqual(detectChanges({ from: c2, to: c2 }, { engineDir: repo.dir, now }).summary, { added: 0, changed: 0, removed: 0, unchanged: 13, hold: 0 });
});

test('detectChanges: 커밋이 없거나 데이터 파일이 없으면 입력 오류다', (t) => {
  const repo = makeRepo(t);
  const empty = repo.commit({}, '데이터 없음');
  const c1 = repo.commit(makeV1(), 'v1');
  const deps = { engineDir: repo.dir };
  assert.throws(() => detectChanges({ from: '없는커밋', to: c1 }, deps), (e) => e instanceof InputError && /--from/.test(e.message));
  assert.throws(() => detectChanges({ from: c1 }, deps), (e) => e instanceof InputError && /--to/.test(e.message));
  assert.throws(() => detectChanges({ from: c1, to: '--all' }, deps), InputError);
  assert.throws(() => detectChanges({ from: empty, to: c1 }, deps), (e) => e instanceof InputError && /parsed_nikke\.json/.test(e.message));
});

test('CLI detect-changes: JSON을 표준 출력과 --json 파일로 낸다', (t) => {
  const repo = makeRepo(t);
  const c1 = repo.commit(makeV1(), 'v1');
  const c2 = repo.commit(makeV2(), 'v2');
  const cli = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
  const out = path.join(repo.dir, 'changes.json');
  const run = (...args) => spawnSync(process.execPath, [cli, 'detect-changes', ...args], { encoding: 'utf8' });

  const ok = run('--from', c1, '--to', c2, '--engine', repo.dir, '--json', out);
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.deepEqual(report.summary, { added: 4, changed: 7, removed: 1, unchanged: 2, hold: 4 });
  assert.deepEqual(report.hold, ['신규미파싱', '신규빈스킬', '신규스탯없음', '파싱취소']);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), report);

  const bad = run('--from', c1, '--engine', repo.dir);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /입력 오류/);
});
