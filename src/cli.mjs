#!/usr/bin/env node
// 명령줄 진입점.
//   node src/cli.mjs compare --account <계정.json> --condition <조건.json> --squads <편성.json> [--json <결과.json>]
//   node src/cli.mjs suggest --account <계정.json> --condition <조건.json> [--limit <후보 수>] [--top <표시 수>]
//                           [--refine | --no-refine] [--budget <시뮬 횟수>] [--refine-top <조합 수>] [--json <결과.json>]
//   node src/cli.mjs growth  --account <계정.json> --condition <조건.json> --squads <편성.json> [--squad <편성 이름>] --upgrades <후보.json> [--json <결과.json>]
//   node src/cli.mjs detect-changes --from <커밋> --to <커밋> [--engine <엔진 저장소 경로>] [--json <결과.json>]
//   node src/cli.mjs import-profile <엔진 프로필.json> [--name <계정 이름>] [--out-dir <폴더>] [--force] [--json <결과.json>]
//   node src/cli.mjs tier build [--only <이름,이름>] [--budget <시뮬 횟수>] [--json <결과.json>]
//                              [--references <기준 편성.json>] [--rules <등급 규칙.json>]
//   node src/cli.mjs intercept --account <계정.json> [--bosses <보스 묶음.json>] [--boss <이름 또는 id>] [--top <표시 수>]
//                              [--budget <시뮬 횟수>] [--json <결과.json>]
// compare·suggest·growth·tier·intercept는 시뮬 결과 캐시(data/cache/sim/)를 기본으로 쓴다: [--no-cache] [--cache-dir <폴더>]
// 종료 코드: 0 성공 · 1 실행 오류 · 2 입력 오류
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withCache } from './core/cache.mjs';
import { suggestSquads } from './core/candidates.mjs';
import { compareSquads, InputError } from './core/compare.mjs';
import { compareGrowth } from './core/growth.mjs';
import { recommendIntercept } from './core/intercept.mjs';
import { renderReport, renderGrowthReport, renderImportReport, renderInterceptReport } from './core/render.mjs';
import { importProfileFile } from './runtime/import-profile.mjs';
import { createFileCacheStore, loadEngineData, nodeRuntime } from './runtime/node.mjs';
import { detectChanges } from './tier/detect.mjs';
import { buildTier } from './tier/evaluate.mjs';
import { renderTierReport } from './tier/render.mjs';

/** 자동 티어의 기준 편성·등급 규칙(버전 있는 데이터 파일). --references·--rules로 바꿀 수 있다. */
const TIER_REFERENCES = fileURLToPath(new URL('../data/tier/reference-squads.json', import.meta.url));
const TIER_RULES = fileURLToPath(new URL('../data/tier/rules.json', import.meta.url));
/** 이상 개체 요격전의 실제 보스 묶음(게임 화면에서 확인한 값 — docs/intercept.md). --bosses로 바꿀 수 있다. */
const INTERCEPT_BOSSES = fileURLToPath(new URL('../data/intercept/anomaly.json', import.meta.url));

const USAGE = [
  '사용법:',
  '  node src/cli.mjs compare --account <계정.json> --condition <조건.json> --squads <편성.json> [--json <결과.json>]',
  '  node src/cli.mjs suggest --account <계정.json> --condition <조건.json> [--limit <후보 수, 기본 30>] [--top <표시 수, 기본 5>] [--json <결과.json>]',
  '      [--refine] 상위 조합의 배치 순서도 탐색한다(기본)   [--no-refine] 조합마다 배치 하나만 계산한다',
  '      [--budget <전체 시뮬 횟수의 상한, 기본 120>]   [--refine-top <배치를 탐색할 상위 조합 수, 기본 5>]',
  '  node src/cli.mjs growth --account <계정.json> --condition <조건.json> --squads <편성.json> [--squad <기준 편성 이름, 기본 첫 편성>] --upgrades <후보.json> [--json <결과.json>]',
  '  node src/cli.mjs detect-changes --from <엔진 커밋> --to <엔진 커밋> [--engine <엔진 저장소, 기본 vendor/nikke-calc>] [--json <결과.json>]',
  '  node src/cli.mjs import-profile <엔진 프로필.json> [--name <계정 이름, 기본 프로필 이름>] [--out-dir <폴더, 기본 data/accounts>] [--force] [--json <결과.json>]',
  '  node src/cli.mjs tier build [--only <니케 이름,니케 이름>] [--budget <시뮬 횟수의 상한, 기본 2000>] [--json <결과.json>]',
  '      엔진 계산으로 티어표를 만든다(전원 계산은 1,800건쯤 — 수십 분). --only로 일부만 계산할 수 있다',
  '      [--references <기준 편성.json, 기본 data/tier/reference-squads.json>]   [--rules <등급 규칙.json, 기본 data/tier/rules.json>]',
  '  node src/cli.mjs intercept --account <계정.json> [--bosses <보스 묶음.json, 기본 data/intercept/anomaly.json>] [--boss <보스 이름 또는 id>]',
  '      요격전(이상 개체) 보스마다 보유 니케로 총딜이 가장 큰 편성을 추천한다. --boss로 한 보스만 계산할 수 있다',
  '      [--top <보스별 표시 수, 기본 3>]   [--budget <전체 시뮬 횟수의 상한, 기본 300 — 보스 수로 나눈다>]   [--json <결과.json>]',
  'compare·suggest·growth·tier·intercept는 같은 엔진 판·같은 요청의 시뮬 결과를 다시 계산하지 않는다(캐시):',
  '  [--no-cache] 캐시를 읽지도 쓰지도 않는다   [--cache-dir <폴더, 기본 data/cache/sim>]',
].join('\n');

/** 값을 받지 않는 인자. 뒤에 오는 낱말을 값으로 삼키지 않는다. */
const FLAGS = new Set(['force', 'no-cache', 'refine', 'no-refine']);

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

/**
 * 계산 모듈에 넘길 것. 계산 모듈은 엔진을 직접 부르지 않는다 — 여기서 Node 런타임을 넘긴다.
 * 기본은 시뮬 결과 캐시(파일 저장소)로 감싼 런타임이고, --no-cache면 감싸지 않는다(결과의 cache가 null).
 */
function engineDeps() {
  if (opts['no-cache'] === true) return { runtime: nodeRuntime };
  if (opts['cache-dir'] === true) throw new InputError('인자가 빠졌다', [{ path: '--cache-dir', message: '캐시 폴더 경로가 필요하다' }]);
  return { runtime: withCache(nodeRuntime, createFileCacheStore(opts['cache-dir'])) };
}

try {
  let report;
  let render = renderReport;
  const deps = ['compare', 'suggest', 'growth', 'tier', 'intercept'].includes(command) ? engineDeps() : {};
  if (command === 'tier') {
    if (opts._[0] !== 'build' || opts._.length > 1) {
      throw new InputError('인자가 잘못됐다', [{ path: 'tier', message: '하위 명령은 build뿐이다 — node src/cli.mjs tier build [--only <이름,이름>]' }]);
    }
    for (const key of ['only', 'references', 'rules']) {
      if (opts[key] === true) throw new InputError('인자가 빠졌다', [{ path: `--${key}`, message: '값이 필요하다' }]);
    }
    // 니케 이름에는 쉼표가 없다(공백·콜론·괄호는 있다) — 쉼표로만 나눈다.
    const only = typeof opts.only === 'string' ? opts.only.split(',').map((n) => n.trim()).filter(Boolean) : undefined;
    const budget = readCount('budget', opts.budget);
    let shown = 0;
    report = await buildTier(
      {
        references: readJsonFile('references', opts.references ?? TIER_REFERENCES),
        rules: readJsonFile('rules', opts.rules ?? TIER_RULES),
        only,
        budget,
      },
      {
        ...deps,
        engineData: () => loadEngineData(),
        // 진행은 표준 오류로만 낸다 — 표준 출력은 결과 표다. 오래 걸리는 계산이라 10%쯤마다 한 줄.
        onProgress: ({ done, total }) => {
          if (total < 40 || done === total || done - shown >= total / 10) {
            shown = done;
            process.stderr.write(`시뮬 ${done}/${total}건\n`);
          }
        },
      },
    );
    render = renderTierReport;
  } else if (command === 'intercept') {
    for (const key of ['bosses', 'boss']) {
      if (opts[key] === true) throw new InputError('인자가 빠졌다', [{ path: `--${key}`, message: '값이 필요하다' }]);
    }
    if (opts._.length > 0) {
      throw new InputError('인자가 잘못됐다', [{ path: opts._[0], message: '이름 없는 인자는 받지 않는다 — 보스는 --boss <이름 또는 id>로 고른다' }]);
    }
    report = await recommendIntercept(
      {
        account: readJsonFile('account', opts.account),
        bundle: readJsonFile('bosses', opts.bosses ?? INTERCEPT_BOSSES),
        boss: opts.boss,
      },
      { top: readCount('top', opts.top), budget: readCount('budget', opts.budget) },
      {
        ...deps,
        // 진행은 표준 오류로만 낸다 — 표준 출력은 결과 표다.
        onBoss: ({ index, total, boss, budget }) => process.stderr.write(`보스 ${index + 1}/${total} ${boss.name} — 시뮬 예산 ${budget}건\n`),
      },
    );
    render = renderInterceptReport;
  } else if (command === 'growth') {
    const upgradesDoc = readJsonFile('upgrades', opts.upgrades);
    report = await compareGrowth({
      account: readJsonFile('account', opts.account),
      condition: readJsonFile('condition', opts.condition),
      squad: pickSquad(readJsonFile('squads', opts.squads), opts.squad),
      upgrades: Array.isArray(upgradesDoc) ? upgradesDoc : upgradesDoc?.upgrades,
    }, deps);
    render = renderGrowthReport;
  } else if (command === 'compare') {
    const squadsDoc = readJsonFile('squads', opts.squads);
    report = await compareSquads({
      account: readJsonFile('account', opts.account),
      condition: readJsonFile('condition', opts.condition),
      squads: Array.isArray(squadsDoc) ? squadsDoc : squadsDoc.squads,
    }, deps);
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
    if (opts.refine === true && opts['no-refine'] === true) {
      throw new InputError('인자가 잘못됐다', [{ path: '--refine', message: '--refine과 --no-refine을 함께 줄 수 없다' }]);
    }
    report = await suggestSquads(
      { account: readJsonFile('account', opts.account), condition: readJsonFile('condition', opts.condition) },
      {
        limit: readCount('limit', opts.limit),
        top: readCount('top', opts.top),
        // 배치 탐색(2단계)은 기본으로 켜져 있다. 예산은 1단계 + 2단계를 합친 시뮬 횟수의 상한이다.
        refine: opts['no-refine'] === true ? false : undefined,
        budget: readCount('budget', opts.budget),
        refineTop: readCount('refine-top', opts['refine-top']),
      },
      deps,
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
