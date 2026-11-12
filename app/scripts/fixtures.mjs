#!/usr/bin/env node
// 컴포넌트 테스트의 입력(tests/fixtures/*.sample.json)을 실제 CLI(저장소 루트의 src/cli.mjs)로 다시 만든다.
// 실제 엔진을 부른다(시뮬 결과 캐시를 쓰지 않는다 — `--no-cache`). 모두 만들면 몇 분 걸린다.
//
//   npm --prefix app run fixture                 # 전부
//   npm --prefix app run fixture -- tier growth  # 고른 것만 (compare · intercept · growth · tier)
//
// 아래 표의 인자가 곧 "만든 명령"이다 — 저장소 루트에서 `node src/cli.mjs <인자…>`로 그대로 돌릴 수 있다
// (경로는 저장소 루트 기준). 니케 이름에 공백·쉼표·한글이 있어 셸 문자열이 아니라 인자 배열로 넘긴다.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ACCOUNT = 'data/samples/account.sample.json';
const CONDITION = 'data/samples/condition.solo-raid.json';
const SQUADS = 'data/samples/squads.sample.json';
const out = (name) => `app/tests/fixtures/${name}.sample.json`;

export const FIXTURES = {
  // 편성 비교 결과 — ReportView·App·ComputeFlow 테스트와 Rust의 report.rs 테스트가 읽는다.
  compare: ['compare', '--no-cache', '--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS, '--json', out('compare')],
  // 요격전 보스별 추천 — 검증용 보스 묶음(확인된 칸이 많은 보스 · 약점만 아는 보스 · 속성도 약점도 모르는 보스).
  intercept: [
    'intercept', '--no-cache', '--account', ACCOUNT, '--bosses', 'data/samples/bosses.anomaly.sample.json',
    '--budget', '40', '--top', '3', '--json', out('intercept'),
  ],
  // 성장 투자 비교 — 샘플 후보 6개(계산되는 것 · 기준 편성 밖 · 범위 밖).
  growth: [
    'growth', '--no-cache', '--account', ACCOUNT, '--condition', CONDITION, '--squads', SQUADS,
    '--upgrades', 'data/samples/upgrades.sample.json', '--json', out('growth'),
  ],
  // 티어 — 버스트 1·2·3단계의 등급 항목, 평가 보류(스킬 효과 없음: 엔진의 시험용 항목 test_B1), 평가 보류(예산: 마지막 니케).
  tier: [
    'tier', 'build', '--no-cache', '--only', '헬름,크라운,리틀 머메이드,라피 : 레드 후드,솔져 O.W.,리타,test_B1,앨리스',
    '--budget', '50', '--json', out('tier'),
  ],
};

function main(argv) {
  const names = argv.length ? argv : Object.keys(FIXTURES);
  const unknown = names.filter((n) => !Object.hasOwn(FIXTURES, n));
  if (unknown.length) {
    console.error(`모르는 fixture: ${unknown.join(', ')} — 있는 것: ${Object.keys(FIXTURES).join(', ')}`);
    return 2;
  }
  for (const name of names) {
    console.error(`■ ${name}: node src/cli.mjs ${FIXTURES[name].map((a) => (/[\s,:]/.test(a) ? `"${a}"` : a)).join(' ')}`);
    // 표준 출력(사람이 읽는 표)은 버리고, 진행·오류(표준 오류)만 보인다.
    const r = spawnSync(process.execPath, ['src/cli.mjs', ...FIXTURES[name]], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) {
      console.error(`${name}: 실패(종료 코드 ${r.status ?? r.signal})`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
