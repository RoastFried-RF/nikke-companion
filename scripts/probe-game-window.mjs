#!/usr/bin/env node
// 실제 게임이 필요한 검증의 환경 확인(tasks.json의 requires_cmd).
//   node scripts/probe-game-window.mjs            게임이 실행 중이고 창이 떠 있으면(최소화 아님) 0
//   node scripts/probe-game-window.mjs --running  게임 프로세스만 있으면 0
// 종료 코드: 0 준비됨 · 1 게임이 없다 · 2 창이 최소화돼 있다 · 3 확인 실패
// 게임은 읽기만 한다: 프로세스 목록과 창의 최소화 여부(IsIconic)만 본다. 창을 건드리지 않는다.
// 검증 대상 코드(nikke-capture)에 기대지 않으려고 PowerShell로 따로 확인한다.
import { spawnSync } from 'node:child_process';

const onlyRunning = process.argv.includes('--running');
if (process.platform !== 'win32') {
  console.log('Windows가 아니다 — 게임 환경 없음');
  process.exit(1);
}
const script = [
  "$p = Get-Process nikke -ErrorAction SilentlyContinue | Select-Object -First 1",
  "if (-not $p) { Write-Output 'no-process'; exit 1 }",
  onlyRunning ? "Write-Output 'running'; exit 0" : '',
  "$w = Get-Process nikke -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
  "if (-not $w) { Write-Output 'no-window'; exit 1 }",
  "Add-Type -Namespace NikkeProbe -Name U32 -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool IsIconic(System.IntPtr h);'",
  "if ([NikkeProbe.U32]::IsIconic($w.MainWindowHandle)) { Write-Output 'minimized'; exit 2 }",
  "Write-Output 'ready'; exit 0",
].filter(Boolean).join('; ');
const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 45_000 });
const state = (r.stdout ?? '').trim().split(/\r?\n/).pop() ?? '';
const messages = {
  ready: '니케 창이 떠 있다',
  running: '니케가 실행 중이다',
  minimized: '니케 창이 최소화돼 있다 — 작업 표시줄에서 창을 다시 띄워라',
  'no-window': '니케 프로세스는 있지만 창이 없다',
  'no-process': '니케(nikke.exe)가 실행 중이 아니다',
};
if (r.error || r.status === null || !(state in messages)) {
  console.log(`게임 창 상태를 확인하지 못했다: ${r.error?.message ?? (r.stderr ?? '').trim().slice(0, 200)}`);
  process.exit(3);
}
console.log(messages[state]);
process.exit(r.status);
