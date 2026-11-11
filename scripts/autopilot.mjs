#!/usr/bin/env node
// 자율 실행 루프: 작업 하나 선택 → 에이전트(Fable 5.2) 실행 → 하네스가 직접 검증 → 상태·증거 저장.
//   node scripts/autopilot.mjs [--max-iterations N] [--max-minutes M] [--task ID] [--kill-orphan]
// 종료 코드: 0 정상 종료(전부 완료·진행할 작업 없음·한도 도달) · 3 다른 실행이 살아 있음 · 4 모델 호출 실패로 중단
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, LOCK_FILE, loadTasks, saveTasks, loadConfig, readJson, writeJson, appendLog, now,
  gitHead, gitStatusLines, isAlive, harnessEnv, depsDone, maxAttempts, runVerify, completeTask, newRunDir,
  summarize,
} from './harness-lib.mjs';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const config = loadConfig();
const maxIterations = Number(argValue('--max-iterations') ?? config.limits.max_iterations);
const maxMinutes = Number(argValue('--max-minutes') ?? config.limits.max_minutes);
const onlyTask = argValue('--task');
const killOrphan = process.argv.includes('--kill-orphan');
const startedAt = Date.now();

function minutesLeft() {
  return maxMinutes - (Date.now() - startedAt) / 60_000;
}

// ── 잠금: 작성자는 한 번에 하나 ─────────────────────────────────────────────
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const lock = readJson(LOCK_FILE);
    if (isAlive(lock.pid)) {
      console.error(`다른 실행이 살아 있다 (pid ${lock.pid}, 시작 ${lock.started_at}). 중단한다.`);
      process.exit(3);
    }
    if (isAlive(lock.agent_pid)) {
      if (!killOrphan) {
        console.error(
          `이전 실행은 끝났지만 에이전트 프로세스(pid ${lock.agent_pid})가 남아 있다.\n` +
            '끝나기를 기다리거나 --kill-orphan으로 종료한 뒤 다시 실행하라.',
        );
        process.exit(3);
      }
      try {
        process.kill(lock.agent_pid);
      } catch {}
      appendLog({ event: 'orphan_agent_killed', pid: lock.agent_pid });
    }
    appendLog({ event: 'recovered_stale_lock', previous: lock, git_status: gitStatusLines() });
    console.log(`이전 실행(pid ${lock.pid})이 비정상 종료됐다. 남은 상태에서 재개한다.`);
  }
  writeLock({});
}
function writeLock(extra) {
  writeJson(LOCK_FILE, { pid: process.pid, started_at: new Date(startedAt).toISOString(), ...extra });
}
function releaseLock() {
  fs.rmSync(LOCK_FILE, { force: true });
}

// ── 작업 선택 ────────────────────────────────────────────────────────────────
function pickTask(doc) {
  // manual: true인 작업은 사람이 하는 일이다(로그인·실제 게임 확인 등). 에이전트에게 넘기지 않는다.
  const runnable = (t) =>
    !t.manual && (!onlyTask || t.id === onlyTask) && depsDone(doc, t) && t.attempts <= maxAttempts(doc, config, t);
  // 중단된 작업이 있으면 그것부터 잇는다.
  const interrupted = doc.tasks.find((t) => t.status === 'in_progress' && runnable(t));
  if (interrupted) return { task: interrupted, resumed: true };
  const next = doc.tasks.find(
    (t) => t.status === 'pending' && runnable(t) && t.attempts < maxAttempts(doc, config, t),
  );
  return next ? { task: next, resumed: false } : null;
}

// ── 프롬프트 ─────────────────────────────────────────────────────────────────
function buildPrompt(task, attempt, resumed) {
  const lines = [
    '너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.',
    '먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.',
    '',
    `작업 ID: ${task.id}`,
    `제목: ${task.title}`,
    task.description ? `설명: ${task.description}` : '',
    '',
    '수락 조건:',
    ...task.acceptance.map((a) => `- ${a}`),
    '',
    '하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):',
    ...task.verify.map((v) => `- ${v.cmd}`),
  ];
  if (task.protected.length) {
    lines.push('', '수정·삭제 금지 경로 (바꾸면 검증이 실패한다):', ...task.protected.map((p) => `- ${p}`));
  }
  if (task.manual_checks.length) {
    lines.push('', '실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):', ...task.manual_checks.map((m) => `- ${m}`));
  }
  if (resumed) {
    lines.push('', '이전 실행이 이 작업 도중에 중단됐다. `git status`로 남아 있는 변경을 확인하고 버리지 말고 이어서 하라.');
  }
  if (task.last_failure) {
    lines.push('', `이전 시도(${attempt - 1}회차)의 검증이 실패했다: ${task.last_failure.reason}`);
    for (const c of task.last_failure.commands ?? []) {
      lines.push(`--- ${c.name} (exit ${c.exit_code}) 출력 끝부분 ---`, c.tail ?? '');
    }
    lines.push('원인을 분석해 고쳐라. 테스트를 지우거나 약하게 만들지 마라.');
  }
  lines.push(
    '',
    '규칙:',
    '- 이 작업만 하라. 다른 작업을 시작하지 마라.',
    '- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.',
    '- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.',
    '- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.',
    '- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.',
  );
  return lines.filter((l) => l !== undefined).join('\n');
}

// ── 에이전트 실행 ────────────────────────────────────────────────────────────
// `--output-format json`이면 출력 마지막 줄이 결과 객체다. 사용량은 여기 적힌 값만 기록하고
// 없으면 추정하지 않는다.
function readAgentResult(logFile) {
  try {
    const lines = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/);
    const r = JSON.parse(lines[lines.length - 1]);
    if (r?.type !== 'result') return null;
    return {
      is_error: r.is_error === true,
      error: r.is_error ? String(r.result ?? '').slice(0, 300) : null,
      num_turns: r.num_turns ?? null,
      total_cost_usd: r.total_cost_usd ?? null,
      models: Object.keys(r.modelUsage ?? {}),
      session_id: r.session_id ?? null,
    };
  } catch {
    return null;
  }
}

function runAgent(task, prompt, runDir) {
  const effort = task.effort ?? config.agent.default_effort;
  const args = config.agent.args.map((a) => a.replaceAll('{effort}', effort));
  const timeoutMs = Math.max(1, Math.min(config.agent.timeout_minutes, minutesLeft())) * 60_000;
  const logFile = path.join(runDir, 'agent.log');
  fs.writeFileSync(path.join(runDir, 'prompt.md'), prompt, 'utf8');
  return new Promise((resolve) => {
    const started = Date.now();
    const out = fs.openSync(logFile, 'w');
    let child;
    try {
      child = spawn(config.agent.command, args, { cwd: ROOT, stdio: ['pipe', out, out], windowsHide: true, env: harnessEnv(config) });
    } catch (e) {
      fs.closeSync(out);
      resolve({ ok: false, error: `실행 실패: ${e.message}`, effort, duration_ms: 0 });
      return;
    }
    writeLock({ task: task.id, agent_pid: child.pid, run: path.relative(ROOT, runDir) });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      fs.closeSync(out);
      resolve({ ok: false, error: `실행 실패: ${e.message}`, effort, duration_ms: Date.now() - started });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(out);
      writeLock({});
      const result = readAgentResult(logFile);
      const base = { effort, exit_code: code, signal, duration_ms: Date.now() - started, result };
      if (timedOut) resolve({ ok: false, error: `시간 초과(${Math.round(timeoutMs / 60_000)}분)`, ...base });
      else if (code !== 0) resolve({ ok: false, error: `에이전트 종료 코드 ${code}${result?.error ? ` — ${result.error}` : ''}`, ...base });
      else if (result?.is_error) resolve({ ok: false, error: `에이전트 오류 — ${result.error ?? '원인 불명'}`, ...base });
      else if (result?.models?.length && !result.models.some((m) => m.startsWith(config.agent.model))) {
        // 설정한 모델이 쓰이지 않았다면 조용히 넘어가지 않는다.
        resolve({ ok: false, error: `설정한 모델(${config.agent.model})이 쓰이지 않았다: ${result.models.join(', ')}`, ...base });
      } else resolve({ ok: true, ...base });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// ── 본체 ─────────────────────────────────────────────────────────────────────
acquireLock();
const session = {
  started_at: new Date(startedAt).toISOString(),
  model: config.agent.model,
  agent_command: [config.agent.command, ...config.agent.args].join(' '),
  limits: { max_iterations: maxIterations, max_minutes: maxMinutes },
  head_at_start: gitHead(),
  git_status_at_start: gitStatusLines(),
  iterations: [],
  stop_reason: null,
};
appendLog({ event: 'session_start', model: session.model, head: session.head_at_start, git_status: session.git_status_at_start });

let consecutiveAgentErrors = 0;
let exitCode = 0;
try {
  for (let i = 0; ; i += 1) {
    if (i >= maxIterations) {
      session.stop_reason = `한도 도달: 반복 ${maxIterations}회`;
      break;
    }
    if (minutesLeft() <= 0) {
      session.stop_reason = `한도 도달: ${maxMinutes}분`;
      break;
    }
    const doc = loadTasks();
    const picked = pickTask(doc);
    if (!picked) {
      const s = summarize(doc);
      session.stop_reason = s.pending || s.blocked ? '진행할 수 있는 작업이 없다(차단 또는 선행 작업 대기)' : '모든 작업 완료';
      break;
    }
    const { task, resumed } = picked;
    const attempt = resumed ? Math.max(task.attempts, 1) : task.attempts + 1;
    task.status = 'in_progress';
    task.attempts = attempt;
    saveTasks(doc); // 에이전트를 띄우기 전에 저장 — 여기서 죽어도 무엇을 하던 중인지 남는다

    const runDir = newRunDir(task.id, attempt, resumed ? '-resume' : '');
    console.log(`[${i + 1}] ${task.id} ${task.title} — ${attempt}회차${resumed ? ' (재개)' : ''}`);
    const agent = await runAgent(task, buildPrompt(task, attempt, resumed), runDir);
    const record = { task: task.id, attempt, resumed, run: path.relative(ROOT, runDir).replaceAll('\\', '/'), agent };

    if (!agent.ok) {
      // 모델 호출 실패는 제품 검증 실패가 아니다. 시도 횟수를 쓰지 않는다.
      task.status = 'pending';
      task.attempts = attempt - 1;
      task.agent_errors += 1;
      saveTasks(doc);
      consecutiveAgentErrors += 1;
      record.outcome = 'agent_error';
      session.iterations.push(record);
      appendLog({ event: 'agent_error', task: task.id, error: agent.error, run: record.run });
      writeJson(path.join(runDir, 'meta.json'), record);
      console.log(`    모델 호출 실패: ${agent.error}`);
      if (consecutiveAgentErrors >= config.limits.max_consecutive_agent_errors) {
        session.stop_reason = `모델 호출이 ${consecutiveAgentErrors}회 연속 실패했다. 다른 모델로 바꾸지 않고 중단한다.`;
        exitCode = 4;
        break;
      }
      continue;
    }
    consecutiveAgentErrors = 0;

    const verify = runVerify(task, runDir, config);
    record.verify = { passed: verify.passed, reason: verify.reason, tree: verify.tree };
    if (verify.passed) {
      record.commit = completeTask(doc, task, verify, runDir, config);
      record.outcome = 'verified';
      console.log(`    검증 통과 · 체크포인트 ${record.commit?.slice(0, 8)}`);
    } else {
      record.outcome = 'verify_failed';
      task.last_failure = { reason: verify.reason, run: record.run, commands: verify.commands.filter((c) => c.exit_code !== 0) };
      const max = maxAttempts(doc, config, task);
      if (attempt >= max) {
        task.status = 'blocked';
        task.blocked_reason = `검증이 ${attempt}회 실패했다: ${verify.reason}`;
        task.resume_condition = `실패 원인을 해결한 뒤 attempts를 0으로, status를 pending으로 되돌린다 (마지막 실행: ${record.run})`;
        console.log(`    검증 실패 ${attempt}/${max} — 차단 처리`);
      } else {
        task.status = 'pending';
        console.log(`    검증 실패 ${attempt}/${max}: ${verify.reason}`);
      }
      saveTasks(doc);
    }
    appendLog({ event: record.outcome, task: task.id, attempt, run: record.run, tree: verify.tree, reason: verify.reason });
    writeJson(path.join(runDir, 'meta.json'), record);
    session.iterations.push(record);
  }
} finally {
  session.finished_at = now();
  session.head_at_end = gitHead();
  session.tasks = summarize(loadTasks());
  const stamp = session.started_at.replace(/[-:]/g, '').replace(/\..+/, '');
  writeJson(path.join(ROOT, '.harness', 'runs', `session-${stamp}.json`), session);
  appendLog({ event: 'session_end', stop_reason: session.stop_reason, tasks: session.tasks });
  releaseLock();
}
console.log(`종료: ${session.stop_reason}`);
console.log(JSON.stringify(session.tasks));
process.exit(exitCode);
