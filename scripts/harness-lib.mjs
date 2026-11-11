// 하네스 공용 함수 — 작업 상태, 코드 버전, 검증 실행, 체크포인트.
// autopilot.mjs와 verify.mjs가 함께 쓴다. 의존성 없음(Node 20).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 스크립트가 있는 저장소가 대상이다. 자체 검증은 스크립트를 임시 저장소로 복사해 돌린다.
export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const HARNESS_DIR = path.join(ROOT, '.harness');
export const TASKS_FILE = path.join(HARNESS_DIR, 'tasks.json');
export const CONFIG_FILE = path.join(HARNESS_DIR, 'config.json');
export const RUNS_DIR = path.join(HARNESS_DIR, 'runs');
export const LOCK_FILE = path.join(HARNESS_DIR, 'lock.json');
export const LOG_FILE = path.join(RUNS_DIR, 'log.jsonl');

export const DEFAULT_CONFIG = {
  agent: {
    command: 'claude',
    // {effort}는 작업의 effort(없으면 default_effort)로 바뀐다. 프롬프트는 stdin으로 준다.
    args: ['-p', '--model', 'claude-fable-5-2', '--effort', '{effort}', '--permission-mode', 'acceptEdits'],
    model: 'claude-fable-5-2',
    default_effort: 'high',
    timeout_minutes: 45,
  },
  limits: { max_iterations: 10, max_minutes: 180, max_consecutive_agent_errors: 2 },
  defaults: { max_attempts: 3 },
  verify_timeout_minutes: 15,
  commit_trailer: 'Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>',
};

export function now() {
  return new Date().toISOString();
}

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`파일이 없다: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 중단돼도 반쯤 쓰인 파일이 남지 않게 임시 파일에 쓰고 바꿔치기한다.
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function loadConfig() {
  const user = readJson(CONFIG_FILE, {});
  return {
    ...DEFAULT_CONFIG,
    ...user,
    agent: { ...DEFAULT_CONFIG.agent, ...(user.agent ?? {}) },
    limits: { ...DEFAULT_CONFIG.limits, ...(user.limits ?? {}) },
    defaults: { ...DEFAULT_CONFIG.defaults, ...(user.defaults ?? {}) },
  };
}

export function loadTasks() {
  const doc = readJson(TASKS_FILE);
  for (const t of doc.tasks) {
    t.deps ??= [];
    t.acceptance ??= [];
    t.verify ??= [];
    t.protected ??= [];
    t.manual_checks ??= [];
    t.status ??= 'pending';
    t.attempts ??= 0;
    t.agent_errors ??= 0;
  }
  return doc;
}

export function saveTasks(doc) {
  writeJson(TASKS_FILE, doc);
}

export function appendLog(entry) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ at: now(), ...entry }) + '\n', 'utf8');
}

export function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export function gitHead() {
  const r = git(['rev-parse', 'HEAD']);
  return r.code === 0 ? r.out : null;
}

export function gitStatusLines() {
  const r = git(['status', '--porcelain']);
  return r.out ? r.out.split('\n') : [];
}

// 지금 작업 트리의 내용 지문. `.harness/`(하네스 상태)는 뺀다 — 상태 기록이 바뀌어도
// 코드 버전은 그대로여야 검증 결과와 코드를 묶을 수 있다.
export function codeTree() {
  const index = path.join(os.tmpdir(), `harness-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const add = git(['add', '-A', '--', '.', ':(exclude).harness'], { env });
    if (add.code !== 0) throw new Error(`git add 실패: ${add.err}`);
    const tree = git(['write-tree'], { env });
    if (tree.code !== 0) throw new Error(`git write-tree 실패: ${tree.err}`);
    return tree.out;
  } finally {
    fs.rmSync(index, { force: true });
  }
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function depsDone(doc, task) {
  return task.deps.every((id) => doc.tasks.find((t) => t.id === id)?.status === 'done');
}

export function maxAttempts(doc, config, task) {
  return task.max_attempts ?? doc.defaults?.max_attempts ?? config.defaults.max_attempts;
}

// HEAD에 있는 보호 경로가 바뀌었거나 사라졌으면 위반이다. 새로 만드는 중(HEAD에 없음)이면 허용.
export function protectedViolations(task) {
  const out = [];
  for (const p of task.protected) {
    const inHead = git(['cat-file', '-e', `HEAD:${p}`]).code === 0;
    if (!inHead) continue;
    if (!fs.existsSync(path.join(ROOT, p))) {
      out.push(`${p} (삭제됨)`);
      continue;
    }
    if (git(['diff', '--quiet', 'HEAD', '--', p]).code !== 0) out.push(`${p} (수정됨)`);
  }
  return out;
}

function tail(text, lines = 40) {
  return text.split(/\r?\n/).slice(-lines).join('\n');
}

// 작업의 검증 명령을 실제로 돌리고 결과를 runDir/verify.json에 남긴다.
export function runVerify(task, runDir, config) {
  fs.mkdirSync(runDir, { recursive: true });
  const result = {
    task: task.id,
    started_at: now(),
    head: gitHead(),
    tree: codeTree(),
    dirty: gitStatusLines().length > 0,
    protected_violations: protectedViolations(task),
    commands: [],
    passed: false,
    reason: null,
  };
  if (task.verify.length === 0) {
    result.reason = '검증 명령이 없다 — 검증 없이 완료할 수 없다';
  }
  for (const [i, v] of task.verify.entries()) {
    const started = Date.now();
    const r = spawnSync(v.cmd, {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      timeout: (v.timeout_minutes ?? config.verify_timeout_minutes) * 60_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    const log = `verify-${i + 1}-${(v.name ?? 'cmd').replace(/[^\w.-]+/g, '_')}.log`;
    const text = `$ ${v.cmd}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    fs.writeFileSync(path.join(runDir, log), text, 'utf8');
    result.commands.push({
      name: v.name ?? `cmd${i + 1}`,
      cmd: v.cmd,
      exit_code: r.status,
      timed_out: r.error?.code === 'ETIMEDOUT',
      duration_ms: Date.now() - started,
      log,
      tail: r.status === 0 ? undefined : tail(text),
    });
  }
  const failed = result.commands.filter((c) => c.exit_code !== 0);
  if (!result.reason && result.protected_violations.length > 0) {
    result.reason = `보호 경로 변경: ${result.protected_violations.join(', ')}`;
  }
  if (!result.reason && failed.length > 0) {
    result.reason = `검증 실패: ${failed.map((c) => `${c.name}(exit ${c.exit_code})`).join(', ')}`;
  }
  // 검증 도중 코드가 바뀌었으면 그 결과는 어느 버전의 것인지 말할 수 없다.
  const treeAfter = codeTree();
  if (!result.reason && treeAfter !== result.tree) {
    result.reason = '검증 중 작업 트리가 바뀌었다';
  }
  result.tree_after = treeAfter;
  result.passed = result.reason === null;
  result.finished_at = now();
  writeJson(path.join(runDir, 'verify.json'), result);
  return result;
}

// 검증을 통과한 작업을 완료 처리하고 체크포인트 커밋을 남긴다.
export function completeTask(doc, task, verifyResult, runDir, config) {
  if (!verifyResult.passed) throw new Error('통과하지 않은 검증으로 완료 처리할 수 없다');
  task.status = 'done';
  task.blocked_reason = null;
  task.resume_condition = null;
  task.last_failure = null;
  task.manual_status = task.manual_checks.length > 0 ? 'pending' : null;
  task.evidence = {
    run: path.relative(ROOT, runDir).replaceAll('\\', '/'),
    verified_tree: verifyResult.tree,
    verified_at: verifyResult.finished_at,
    commit: null,
  };
  saveTasks(doc);
  git(['add', '-A']);
  const msg = [`checkpoint(${task.id}): ${task.title}`, '', `검증: ${task.evidence.run}/verify.json`];
  if (config.commit_trailer) msg.push('', config.commit_trailer);
  const c = git(['commit', '-m', msg.join('\n')]);
  if (c.code !== 0) {
    appendLog({ event: 'checkpoint_commit_failed', task: task.id, detail: c.err || c.out });
  } else {
    // 커밋 해시는 그 커밋 안에 적을 수 없으므로 로그에 남긴다(tasks.json의 run 경로로 찾는다).
    appendLog({ event: 'checkpoint', task: task.id, commit: gitHead(), tree: verifyResult.tree });
  }
  return gitHead();
}

export function newRunDir(taskId, attempt, suffix = '') {
  const stamp = now().replace(/[-:]/g, '').replace(/\..+/, '');
  const dir = path.join(RUNS_DIR, `${stamp}-${taskId}-a${attempt}${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function summarize(doc) {
  const by = {};
  for (const t of doc.tasks) (by[t.status] ??= []).push(t.id);
  return by;
}
