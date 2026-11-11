#!/usr/bin/env node
// H-002 검증: 실제 Fable 5.2가 하네스를 통해 작업 하나를 끝냈는가.
// 검증 통과로 기록된 실행 중에, 에이전트 결과에 설정한 모델이 실제로 쓰였다고 적힌 것이 있어야 한다.
import fs from 'node:fs';
import path from 'node:path';
import { RUNS_DIR, loadConfig } from './harness-lib.mjs';

const model = loadConfig().agent.model;
const found = [];
for (const dir of fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR) : []) {
  const metaFile = path.join(RUNS_DIR, dir, 'meta.json');
  if (!fs.existsSync(metaFile)) continue;
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (meta.outcome === 'verified' && meta.agent?.result?.models?.some((m) => m.startsWith(model))) found.push(`${dir} (${meta.task})`);
}
if (found.length === 0) {
  console.error(`${model}로 검증까지 통과한 실행 기록이 없다.`);
  process.exit(1);
}
console.log(`${model}로 완료한 실행: ${found.join(', ')}`);
