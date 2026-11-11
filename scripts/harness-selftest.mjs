#!/usr/bin/env node
// 하네스 자체 검증. 모델을 부르지 않는다 — 가짜 에이전트로 루프의 동작만 확인한다.
// 임시 git 저장소에 하네스 스크립트를 복사해 시나리오별로 돌린다.
//   node scripts/harness-selftest.mjs [--keep]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(os.tmpdir(), `nikke-harness-selftest-${Date.now()}`);
const keep = process.argv.includes('--keep');

const FAKE_AGENT = `
import fs from 'node:fs';
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const id = /작업 ID: (\\S+)/.exec(input)?.[1];
const mode = JSON.parse(fs.readFileSync('fake-behaviors.json', 'utf8'))[id] ?? 'ok';
fs.mkdirSync('out', { recursive: true });
fs.appendFileSync('agent-calls.log', id + ' ' + mode + '\\n');
if (mode === 'ok') fs.writeFileSync('out/' + id + '.txt', 'ok');
else if (mode === 'bad') fs.writeFileSync('out/' + id + '.txt', 'bad');
else if (mode === 'crash') process.exit(1);
else if (mode === 'tamper') { fs.writeFileSync('guard.txt', 'tampered'); fs.writeFileSync('out/' + id + '.txt', 'ok'); }
else if (mode === 'hang') { fs.writeFileSync('out/' + id + '.partial', 'half'); await new Promise((r) => setTimeout(r, 30000)); }
else if (mode === 'resume-ok') fs.writeFileSync('out/' + id + '.txt', fs.existsSync('out/' + id + '.partial') ? 'ok' : 'lost');
`;
const CHECK = `
import fs from 'node:fs';
const f = 'out/' + process.argv[2] + '.txt';
process.exit(fs.existsSync(f) && fs.readFileSync(f, 'utf8') === 'ok' ? 0 : 1);
`;

function sh(dir, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패: ${r.stderr}`);
  return r.stdout.trim();
}

function task(id, extra = {}) {
  return { id, title: `시험 작업 ${id}`, acceptance: [`out/${id}.txt가 ok`], verify: [{ name: 'check', cmd: `node check.mjs ${id}` }], ...extra };
}

function setup(name, tasks, behaviors, config = {}) {
  const dir = path.join(BASE, name);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  for (const f of ['harness-lib.mjs', 'verify.mjs', 'autopilot.mjs']) {
    fs.copyFileSync(path.join(HERE, f), path.join(dir, 'scripts', f));
  }
  fs.writeFileSync(path.join(dir, 'fake-agent.mjs'), FAKE_AGENT);
  fs.writeFileSync(path.join(dir, 'check.mjs'), CHECK);
  fs.writeFileSync(path.join(dir, 'envcheck.mjs'), "import fs from 'node:fs'; process.exit(fs.existsSync('env-ready') ? 0 : 1);");
  fs.writeFileSync(path.join(dir, 'guard.txt'), 'original');
  fs.writeFileSync(path.join(dir, 'fake-behaviors.json'), JSON.stringify(behaviors));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.harness/lock.json\n.harness/runs/**/agent.log\n');
  fs.writeFileSync(path.join(dir, '.harness', 'tasks.json'), JSON.stringify({ version: 1, tasks }, null, 2));
  fs.writeFileSync(
    path.join(dir, '.harness', 'config.json'),
    JSON.stringify({ agent: { command: process.execPath, args: ['fake-agent.mjs'], model: 'fake', timeout_minutes: 1 }, ...config }),
  );
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  sh(dir, 'git', ['config', 'user.name', 'selftest']);
  sh(dir, 'git', ['config', 'user.email', 'selftest@example.invalid']);
  sh(dir, 'git', ['config', 'core.autocrlf', 'false']);
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-q', '-m', 'init']);
  return dir;
}

const autopilot = (dir, ...args) => spawnSync(process.execPath, ['scripts/autopilot.mjs', ...args], { cwd: dir, encoding: 'utf8' });
const verify = (dir, ...args) => spawnSync(process.execPath, ['scripts/verify.mjs', ...args], { cwd: dir, encoding: 'utf8' });
const tasksOf = (dir) => Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'tasks.json'), 'utf8')).tasks.map((t) => [t.id, { status: 'pending', attempts: 0, ...t }]));
const events = (dir) => fs.readFileSync(path.join(dir, '.harness', 'runs', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const calls = (dir) => (fs.existsSync(path.join(dir, 'agent-calls.log')) ? fs.readFileSync(path.join(dir, 'agent-calls.log'), 'utf8').trim().split('\n') : []);
const commits = (dir) => Number(sh(dir, 'git', ['rev-list', '--count', 'HEAD']));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`통과  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`실패  ${name}\n      ${e.message.split('\n').join('\n      ')}`);
  }
}

await scenario('A. 구현·검증을 마치면 체크포인트를 남기고 다음 작업으로 넘어간다', () => {
  const dir = setup('a', [task('T1'), task('T2', { deps: ['T1'], manual_checks: ['실제 게임 위에서 확인'] })], {});
  const r = autopilot(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const t = tasksOf(dir);
  assert.equal(t.T1.status, 'done');
  assert.equal(t.T2.status, 'done');
  assert.equal(commits(dir), 3, '작업마다 체크포인트 커밋이 있어야 한다');
  assert.ok(t.T1.evidence.verified_tree, '검증한 코드 버전이 증거에 남아야 한다');
  assert.ok(fs.existsSync(path.join(dir, t.T1.evidence.run, 'verify.json')));
  assert.equal(t.T1.manual_status, null);
  assert.equal(t.T2.manual_status, 'pending', '실제 환경 확인이 필요한 작업은 대기로 드러나야 한다');
  assert.deepEqual(calls(dir), ['T1 ok', 'T2 ok']);
});

await scenario('B. 실패한 검증은 성공이 되지 않고, 3회 실패하면 차단하고 독립 작업을 진행한다', () => {
  const dir = setup('b', [task('T3'), task('T4', { deps: ['T3'] }), task('T5')], { T3: 'bad' });
  const r = autopilot(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const t = tasksOf(dir);
  assert.equal(t.T3.status, 'blocked');
  assert.equal(t.T3.attempts, 3);
  assert.ok(t.T3.blocked_reason && t.T3.resume_condition, '차단 사유와 재개 조건이 있어야 한다');
  assert.equal(t.T3.evidence ?? null, null, '실패한 작업에 완료 증거가 있으면 안 된다');
  assert.equal(t.T4.status, 'pending', '선행 작업이 차단되면 시작하지 않는다');
  assert.equal(t.T4.attempts, 0);
  assert.equal(t.T5.status, 'done', '독립 작업은 진행한다');
  assert.deepEqual(calls(dir), ['T3 bad', 'T3 bad', 'T3 bad', 'T5 ok']);
  assert.equal(events(dir).filter((e) => e.event === 'verify_failed').length, 3);
});

await scenario('C. 모델 호출 실패는 검증 실패와 구분하고, 연속 실패하면 중단한다', () => {
  for (const [name, config] of [
    ['c-exit', {}],
    ['c-missing', { agent: { command: 'no-such-agent-command-xyz', args: [], model: 'fake', timeout_minutes: 1 } }],
  ]) {
    const dir = setup(name, [task('T6'), task('T7')], { T6: 'crash' }, config);
    const r = autopilot(dir);
    assert.equal(r.status, 4, `${name}: 종료 코드 4여야 한다\n${r.stderr}${r.stdout}`);
    const t = tasksOf(dir);
    assert.equal(t.T6.status, 'pending', `${name}: 차단이 아니라 대기`);
    assert.equal(t.T6.attempts, 0, `${name}: 모델 실패는 시도 횟수를 쓰지 않는다`);
    assert.equal(t.T6.agent_errors, 2);
    const ev = events(dir).map((e) => e.event);
    assert.equal(ev.filter((e) => e === 'agent_error').length, 2);
    assert.ok(!ev.includes('verify_failed') && !ev.includes('verified'), `${name}: 검증 결과로 기록되면 안 된다`);
  }
});

await scenario('D. 중단 후 재개: 남은 프로세스를 확인하고, 변경을 보존하고, 끝난 작업을 반복하지 않는다', async () => {
  const dir = setup('d', [task('T1'), task('T8', { deps: ['T1'] })], { T8: 'hang' });
  const child = spawn(process.execPath, ['scripts/autopilot.mjs'], { cwd: dir, stdio: 'ignore' });
  const partial = path.join(dir, 'out', 'T8.partial');
  for (let i = 0; i < 200 && !fs.existsSync(partial); i += 1) await sleep(100);
  assert.ok(fs.existsSync(partial), '가짜 에이전트가 작업을 시작해야 한다');
  await sleep(200);
  const lock = JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'lock.json'), 'utf8'));
  child.kill();
  await new Promise((r) => child.on('exit', r));

  let t = tasksOf(dir);
  assert.equal(t.T1.status, 'done');
  assert.equal(t.T8.status, 'in_progress', '중단 시점에 무엇을 하던 중인지 남아 있어야 한다');
  assert.ok(fs.existsSync(path.join(dir, '.harness', 'lock.json')), '잠금 파일이 남아 있어야 한다');
  assert.ok(lock.agent_pid, '에이전트 pid가 잠금에 기록돼야 한다');

  // Windows에서는 부모가 죽으면 자식도 함께 끝난다(libuv 작업 객체). POSIX에서는 남을 수 있다.
  await sleep(500);
  let orphanAlive = true;
  try {
    process.kill(lock.agent_pid, 0);
  } catch {
    orphanAlive = false;
  }
  if (orphanAlive) {
    const refused = autopilot(dir);
    assert.equal(refused.status, 3, '남은 에이전트 프로세스가 있으면 시작을 거부해야 한다\n' + refused.stderr);
  }

  fs.writeFileSync(path.join(dir, 'fake-behaviors.json'), JSON.stringify({ T8: 'resume-ok' }));
  const r = autopilot(dir, '--kill-orphan');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  t = tasksOf(dir);
  assert.equal(t.T8.status, 'done');
  assert.equal(t.T8.attempts, 1, '중단은 실패한 시도로 세지 않는다');
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'T8.txt'), 'utf8'), 'ok', '중단 전 변경(T8.partial)이 보존돼야 한다');
  assert.deepEqual(calls(dir), ['T1 ok', 'T8 hang', 'T8 resume-ok'], '끝난 T1을 다시 실행하면 안 된다');
  const ev = events(dir);
  const recovered = ev.find((e) => e.event === 'recovered_stale_lock');
  assert.ok(recovered, '비정상 종료에서 복구했다는 기록이 있어야 한다');
  assert.ok(Array.isArray(recovered.git_status) && recovered.git_status.length > 0, '재시작 시 git 변경 상태를 기록해야 한다');
});

await scenario('I. 재시작 시 남은 에이전트 프로세스가 있으면 거부하고, --kill-orphan이면 종료 후 진행한다', async () => {
  const dir = setup('i', [task('T1')], {});
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  const orphan = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(
      path.join(dir, '.harness', 'lock.json'),
      JSON.stringify({ pid: dead, started_at: new Date().toISOString(), task: 'T1', agent_pid: orphan.pid }),
    );
    const refused = autopilot(dir);
    assert.equal(refused.status, 3, '남은 에이전트 프로세스가 있으면 시작을 거부해야 한다\n' + refused.stderr + refused.stdout);
    assert.match(refused.stderr, /에이전트 프로세스/);
    assert.equal(tasksOf(dir).T1.status, 'pending', '거부했으면 아무 작업도 시작하지 않는다');
    const exited = new Promise((r) => orphan.on('exit', r));
    const r = autopilot(dir, '--kill-orphan');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    await exited;
    assert.equal(tasksOf(dir).T1.status, 'done');
    assert.ok(events(dir).some((e) => e.event === 'orphan_agent_killed'));
  } finally {
    orphan.kill();
  }
});

await scenario('J. 다른 실행이 살아 있으면 두 번째 실행을 거부한다 (작성자 1개)', () => {
  const dir = setup('j', [task('T1')], {});
  fs.writeFileSync(path.join(dir, '.harness', 'lock.json'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  const r = autopilot(dir);
  assert.equal(r.status, 3);
  assert.equal(tasksOf(dir).T1.status, 'pending');
});

await scenario('K. 사람이 할 작업(manual)은 에이전트에게 넘기지 않는다', () => {
  const dir = setup('k', [task('M1', { manual: true }), task('T1')], {});
  assert.equal(autopilot(dir).status, 0);
  const t = tasksOf(dir);
  assert.equal(t.M1.status, 'pending');
  assert.equal(t.T1.status, 'done');
  assert.deepEqual(calls(dir), ['T1 ok']);
});

await scenario('L. 환경이 필요한 검증: 환경 없이는 완료할 수 없고, 재검증에서는 회귀로 치지 않는다', () => {
  const live = { name: 'live', cmd: 'node check.mjs T1', requires: '표시 파일', requires_cmd: 'node envcheck.mjs' };
  const dir = setup('l', [task('T1', { verify: [{ name: 'check', cmd: 'node check.mjs T1' }, live], max_attempts: 1 })], {});
  autopilot(dir);
  let t = tasksOf(dir);
  assert.equal(t.T1.status, 'blocked', '환경이 없으면 완료 처리하면 안 된다');
  assert.match(t.T1.blocked_reason, /필요한 환경이 없어/);

  fs.writeFileSync(path.join(dir, 'env-ready'), '');
  assert.equal(verify(dir, 'T1', '--record').status, 0, '환경이 있으면 완료된다');
  assert.equal(tasksOf(dir).T1.status, 'done');

  fs.rmSync(path.join(dir, 'env-ready'));
  const r = verify(dir, '--all');
  assert.equal(r.status, 0, '환경이 없어 못 돌린 것은 회귀가 아니다: ' + r.stdout);
  assert.match(r.stdout, /환경 없음/);
  t = tasksOf(dir);
  assert.equal(t.T1.status, 'done');
  assert.equal(t.T1.evidence.reverified_tree, undefined, '못 돌린 검증을 현재 코드의 성공으로 적으면 안 된다');
});

await scenario('E. 한도에 도달하면 상태를 저장하고 끝낸다', () => {
  const dir = setup('e', [task('T1'), task('T2')], {});
  const r = autopilot(dir, '--max-iterations', '1');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const t = tasksOf(dir);
  assert.equal(t.T1.status, 'done');
  assert.equal(t.T2.status, 'pending');
  assert.ok(!fs.existsSync(path.join(dir, '.harness', 'lock.json')), '정상 종료 시 잠금을 푼다');
  const session = fs.readdirSync(path.join(dir, '.harness', 'runs')).find((f) => f.startsWith('session-'));
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'runs', session), 'utf8'));
  assert.match(s.stop_reason, /한도 도달/);
  assert.equal(s.model, 'fake', '실행 기록에 모델이 남아야 한다');
});

await scenario('F. 보호 경로를 바꾸면 명령이 통과해도 검증 실패다', () => {
  const dir = setup('f', [task('TP', { protected: ['guard.txt'], max_attempts: 1 })], { TP: 'tamper' });
  autopilot(dir);
  const t = tasksOf(dir);
  assert.equal(t.TP.status, 'blocked');
  assert.match(t.TP.blocked_reason, /보호 경로/);
});

await scenario('G. 예전 통과 기록을 현재 코드의 성공으로 쓰지 않는다 (verify --all)', () => {
  const dir = setup('g', [task('T1'), task('T2')], {});
  assert.equal(autopilot(dir).status, 0);
  assert.equal(verify(dir, '--all').status, 0);
  assert.match(verify(dir, '--status').stdout, /검증=현재 코드/);
  fs.writeFileSync(path.join(dir, 'out', 'T1.txt'), 'broken');
  assert.match(verify(dir, '--status').stdout, /검증=이전 코드/, '코드가 바뀌면 검증이 최신이 아님을 보여야 한다');
  const r = verify(dir, '--all');
  assert.equal(r.status, 1, '회귀가 있으면 실패 코드를 내야 한다');
  const t = tasksOf(dir);
  assert.equal(t.T1.status, 'pending', '회귀한 작업은 다시 작업 대상이 된다');
  assert.ok(t.T1.regressed);
  assert.equal(t.T2.status, 'done');
});

await scenario('H. verify --record: 통과해야만 완료 처리된다', () => {
  const dir = setup('h', [task('T1')], {});
  assert.equal(verify(dir, 'T1', '--record').status, 1);
  assert.equal(tasksOf(dir).T1.status, 'pending');
  fs.mkdirSync(path.join(dir, 'out'));
  fs.writeFileSync(path.join(dir, 'out', 'T1.txt'), 'ok');
  assert.equal(verify(dir, 'T1', '--record').status, 0);
  assert.equal(tasksOf(dir).T1.status, 'done');
  assert.equal(commits(dir), 2);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (!keep && failed.length === 0) fs.rmSync(BASE, { recursive: true, force: true });
else console.log(`임시 저장소: ${BASE}`);
process.exit(failed.length ? 1 : 0);
