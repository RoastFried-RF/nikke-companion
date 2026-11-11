#!/usr/bin/env node
// 명령줄 진입점.
//   node src/cli.mjs compare --account <계정.json> --condition <조건.json> --squads <편성.json> [--json <결과.json>]
//   node src/cli.mjs suggest --account <계정.json> --condition <조건.json> [--limit <후보 수>] [--top <표시 수>] [--json <결과.json>]
//   node src/cli.mjs growth  --account <계정.json> --condition <조건.json> --squads <편성.json> [--squad <편성 이름>] --upgrades <후보.json> [--json <결과.json>]
//   node src/cli.mjs detect-changes --from <커밋> --to <커밋> [--engine <엔진 저장소 경로>] [--json <결과.json>]
//   node src/cli.mjs import-profile <엔진 프로필.json> [--name <계정 이름>] [--out-dir <폴더>] [--force] [--json <결과.json>]
// 종료 코드: 0 성공 · 1 실행 오류 · 2 입력 오류
import fs from 'node:fs';
import { suggestSquads } from './core/candidates.mjs';
import { compareSquads, InputError } from './core/compare.mjs';
import { compareGrowth } from './core/growth.mjs';
import { importProfileFile } from './core/import-profile.mjs';
import { renderReport, renderGrowthReport, renderImportReport } from './core/render.mjs';
import { detectChanges } from './tier/detect.mjs';

const USAGE = [
  '사용법:',
  '  node src/cli.mjs compare --account <계정.json> --condition <조건.json> --squads <편성.json> [--json <결과.json>]',
  '  node src/cli.mjs suggest --account <계정.json> --condition <조건.json> [--limit <후보 수, 기본 30>] [--top <표시 수, 기본 5>] [--json <결과.json>]',
  '  node src/cli.mjs growth  --account <계정.json> --condition <조건.json> --squads <편성.json> [--squad <기준 편성 이름, 기본 첫 편성>] --upgrades <후보.json> [--json <결과.json>]',
  '  node src/cli.mjs detect-changes --from <엔진 커밋> --to <엔진 커밋> [--engine <엔진 저장소, 기본 vendor/nikke-calc>] [--json <결과.json>]',
  '  node src/cli.mjs import-profile <엔진 프로필.json> [--name <계정 이름, 기본 프로필 이름>] [--out-dir <폴더, 기본 data/accounts>] [--force] [--json <결과.json>]',
].join('\n');

/** 값을 받지 않는 인자. 뒤에 오는 낱말을 값으로 삼키지 않는다. */
const FLAGS = new Set(['force']);

/** `--이름 값`은 opts에, 이름 없는 낱말은 차례대로 opts._에 담는다. */
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (key === null) opts._.push(argv[i]);
    else if (FLAGS.has(key)) opts[key] = true;
    else opts[key] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
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

/** 선택 인자인 양의 정수. 주지 않았으면 undefined(기본값은 받는 쪽이 정한다). */
function readCount(label, value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new InputError('인자가 잘못됐다', [{ path: `--${label}`, message: '1 이상의 정수여야 한다' }]);
  }
  return Number(value);
}

/** 편성 파일에서 기준 편성 하나를 고른다. 이름을 주지 않으면 첫 편성이다. */
function pickSquad(squadsDoc, name) {
  const squads = Array.isArray(squadsDoc) ? squadsDoc : squadsDoc?.squads;
  if (!Array.isArray(squads) || squads.length === 0) {
    throw new InputError('기준 편성이 없다', [{ path: '--squads', message: '편성을 하나 이상 담은 파일이어야 한다' }]);
  }
  if (name === undefined) return squads[0];
  const found = typeof name === 'string' ? squads.find((s) => s?.name === name) : undefined;
  if (!found) {
    throw new InputError('기준 편성이 없다', [{ path: '--squad', message: `그 이름의 편성이 없다. 있는 이름: ${squads.map((s) => s?.name ?? '(이름 없음)').join(', ')}` }]);
  }
  return found;
}

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);

try {
  let report;
  let render = renderReport;
  if (command === 'growth') {
    const upgradesDoc = readJsonFile('upgrades', opts.upgrades);
    report = await compareGrowth({
      account: readJsonFile('account', opts.account),
      condition: readJsonFile('condition', opts.condition),
      squad: pickSquad(readJsonFile('squads', opts.squads), opts.squad),
      upgrades: Array.isArray(upgradesDoc) ? upgradesDoc : upgradesDoc?.upgrades,
    });
    render = renderGrowthReport;
  } else if (command === 'compare') {
    const squadsDoc = readJsonFile('squads', opts.squads);
    report = await compareSquads({
      account: readJsonFile('account', opts.account),
      condition: readJsonFile('condition', opts.condition),
      squads: Array.isArray(squadsDoc) ? squadsDoc : squadsDoc.squads,
    });
  } else if (command === 'detect-changes') {
    // 엔진을 부르지 않는다. 결과는 표가 아니라 JSON 그대로 낸다(다음 단계의 입력).
    if (opts.engine === true) throw new InputError('인자가 빠졌다', [{ path: '--engine', message: '엔진 저장소 경로가 필요하다' }]);
    report = detectChanges({ from: opts.from, to: opts.to }, { engineDir: opts.engine });
    render = (r) => JSON.stringify(r, null, 2);
  } else if (command === 'import-profile') {
    // 엔진을 부르지 않는다. 사용자가 직접 받아 둔 프로필 파일만 읽는다(로그인 세션·쿠키는 다루지 않는다).
    for (const key of ['name', 'out-dir', 'engine']) {
      if (opts[key] === true) throw new InputError('인자가 빠졌다', [{ path: `--${key}`, message: '값이 필요하다' }]);
    }
    if (opts._.length > 1) throw new InputError('인자가 잘못됐다', [{ path: opts._[1], message: '프로필 파일은 하나만 받는다' }]);
    report = importProfileFile({ file: opts._[0], name: opts.name, outDir: opts['out-dir'], force: opts.force === true }, { engineDir: opts.engine });
    render = renderImportReport;
  } else if (command === 'suggest') {
    report = await suggestSquads(
      { account: readJsonFile('account', opts.account), condition: readJsonFile('condition', opts.condition) },
      { limit: readCount('limit', opts.limit), top: readCount('top', opts.top) },
    );
  } else {
    console.error(USAGE);
    process.exit(2);
  }
  if (typeof opts.json === 'string') fs.writeFileSync(opts.json, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(render(report));
} catch (e) {
  if (e instanceof InputError) {
    console.error(`입력 오류 — ${e.message}`);
    process.exit(2);
  }
  console.error(`실행 오류 — ${e.message}`);
  process.exit(1);
}
