#!/usr/bin/env node
// 명령줄 진입점.
//   node src/cli.mjs compare --account <계정.json> --condition <조건.json> --squads <편성.json> [--json <결과.json>]
// 종료 코드: 0 성공 · 1 실행 오류 · 2 입력 오류
import fs from 'node:fs';
import { compareSquads, InputError } from './core/compare.mjs';
import { renderReport } from './core/render.mjs';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return opts;
}

function readJsonFile(label, file) {
  if (typeof file !== 'string') throw new InputError('인자가 빠졌다', [{ path: `--${label}`, message: 'JSON 파일 경로가 필요하다' }]);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new InputError('파일을 읽을 수 없다', [{ path: file, message: e.message }]);
  }
}

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);

try {
  if (command !== 'compare') {
    console.error('사용법: node src/cli.mjs compare --account <계정.json> --condition <조건.json> --squads <편성.json> [--json <결과.json>]');
    process.exit(2);
  }
  const squadsDoc = readJsonFile('squads', opts.squads);
  const report = await compareSquads({
    account: readJsonFile('account', opts.account),
    condition: readJsonFile('condition', opts.condition),
    squads: Array.isArray(squadsDoc) ? squadsDoc : squadsDoc.squads,
  });
  if (typeof opts.json === 'string') fs.writeFileSync(opts.json, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(renderReport(report));
} catch (e) {
  if (e instanceof InputError) {
    console.error(`입력 오류 — ${e.message}`);
    process.exit(2);
  }
  console.error(`실행 오류 — ${e.message}`);
  process.exit(1);
}
