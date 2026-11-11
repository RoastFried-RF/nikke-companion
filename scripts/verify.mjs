#!/usr/bin/env node
// 검증 실행기.
//   node scripts/verify.mjs <작업ID>            검증만 돌리고 결과를 남긴다 (상태는 안 바꾼다)
//   node scripts/verify.mjs <작업ID> --record   통과하면 완료 처리 + 체크포인트 커밋 (사람·대화형 세션용)
//   node scripts/verify.mjs --all               완료된 작업을 현재 코드로 다시 검증한다
//   node scripts/verify.mjs --status            작업 상태와 검증이 최신 코드의 것인지 보여 준다
// 종료 코드: 0 통과 · 1 검증 실패 · 2 사용법 오류
import {
  loadTasks, saveTasks, loadConfig, runVerify, completeTask, newRunDir, codeTree, appendLog,
  depsDone,
} from './harness-lib.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const ids = args.filter((a) => !a.startsWith('--'));
const config = loadConfig();
const doc = loadTasks();

function printResult(task, r) {
  console.log(`${r.passed ? '통과' : '실패'}  ${task.id}  ${task.title}`);
  for (const c of r.commands) {
    console.log(`  ${c.exit_code === 0 ? 'ok  ' : 'FAIL'} ${c.name}  (${(c.duration_ms / 1000).toFixed(1)}s)  ${c.cmd}`);
  }
  if (!r.passed) console.log(`  사유: ${r.reason}`);
}

if (flags.has('--status')) {
  const tree = codeTree();
  for (const t of doc.tasks) {
    let note = '';
    if (t.status === 'done') {
      const last = t.evidence?.reverified_tree ?? t.evidence?.verified_tree;
      note = last === tree ? '검증=현재 코드' : '검증=이전 코드 (verify --all로 재검증)';
      if (t.manual_status === 'pending') note += ' · 실제 환경 검증 대기';
    } else if (t.status === 'blocked') {
      note = `차단: ${t.blocked_reason ?? ''}`;
    } else {
      note = `시도 ${t.attempts}${depsDone(doc, t) ? '' : ' · 선행 작업 대기'}`;
    }
    console.log(`${t.status.padEnd(11)} ${t.id.padEnd(8)} ${t.title}  — ${note}`);
  }
  process.exit(0);
}

if (flags.has('--all')) {
  let failed = 0;
  for (const task of doc.tasks.filter((t) => t.status === 'done')) {
    const runDir = newRunDir(task.id, task.attempts, '-reverify');
    const r = runVerify(task, runDir, config);
    printResult(task, r);
    if (r.passed) {
      task.evidence = { ...task.evidence, reverified_tree: r.tree, reverified_at: r.finished_at };
    } else {
      failed += 1;
      // 예전 통과 기록을 지금의 성공으로 쓰지 않는다 — 회귀로 표시해 다시 작업 대상이 되게 한다.
      task.status = 'pending';
      task.regressed = { at: r.finished_at, reason: r.reason };
      task.last_failure = { reason: r.reason, commands: r.commands.filter((c) => c.exit_code !== 0) };
    }
    appendLog({ event: 'reverify', task: task.id, passed: r.passed, tree: r.tree, reason: r.reason });
  }
  saveTasks(doc);
  process.exit(failed ? 1 : 0);
}

if (ids.length !== 1) {
  console.error('사용법: node scripts/verify.mjs <작업ID> [--record] | --all | --status');
  process.exit(2);
}
const task = doc.tasks.find((t) => t.id === ids[0]);
if (!task) {
  console.error(`모르는 작업: ${ids[0]}`);
  process.exit(2);
}
const record = flags.has('--record');
if (record && !depsDone(doc, task)) {
  console.error(`선행 작업이 끝나지 않았다: ${task.deps.join(', ')}`);
  process.exit(2);
}
const runDir = newRunDir(task.id, Math.max(task.attempts, 1), record ? '-manual' : '-check');
const r = runVerify(task, runDir, config);
printResult(task, r);
appendLog({ event: record ? 'manual_verify' : 'check', task: task.id, passed: r.passed, tree: r.tree, reason: r.reason });
if (record) {
  if (r.passed) {
    task.attempts = Math.max(task.attempts, 1);
    delete task.regressed;
    const commit = completeTask(doc, task, r, runDir, config);
    console.log(`  완료 처리 · 체크포인트 ${commit?.slice(0, 8)}`);
  } else {
    task.last_failure = { reason: r.reason, commands: r.commands.filter((c) => c.exit_code !== 0) };
    saveTasks(doc);
  }
}
process.exit(r.passed ? 0 : 1);
