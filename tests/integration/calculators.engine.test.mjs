// 계산기(P-034)의 출처 점검을 **실제 엔진의 데이터**(vendor/nikke-calc)로 돌린다. 시뮬은 하지 않는다(1초 안쪽).
// 네트워크를 쓰지 않는다 — 엔진 폴더에 받아 둔 표와 수집 코드의 글만 읽는다.
//
// 이 테스트가 실패하면: 엔진의 데이터가 바뀌어 docs/calculators.md의 조사 결과가 낡은 것이다. 그 문서를 다시 조사해 고치고
// (새 표가 정말 필요한 값인지 사람이 읽고 정한다) 아래의 기대값을 그 결과에 맞춘다. **값을 지어내 계산기를 만들지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { auditCalculatorSources, cdnPathsIn, collectionColumns, renderSourceReport } from '../../src/core/calculators.mjs';
import { DEFAULT_ENGINE_DIR } from '../../src/runtime/node.mjs';

const STALE = 'docs/calculators.md의 조사 결과가 낡았다 — 엔진의 데이터를 다시 조사한다';
/** 살펴보는 폴더(엔진 폴더 기준)와 보고서에 적는 이름의 머리. */
const DATA_DIRS = [
  ['data', ''],
  ['data/base_stat_tables', 'base_stat_tables/'],
  ['data/boss_scripts', 'boss_scripts/'],
  ['scraper', 'scraper/'],
];

const listing = (dir, ext) => fs.readdirSync(path.join(DEFAULT_ENGINE_DIR, dir)).filter((name) => name.endsWith(ext)).sort();

function readEngineTables() {
  const files = {};
  for (const [dir, prefix] of DATA_DIRS) {
    for (const name of listing(dir, '.json')) files[`${prefix}${name}`] = JSON.parse(fs.readFileSync(path.join(DEFAULT_ENGINE_DIR, dir, name), 'utf8'));
  }
  return files;
}

const scraperCode = () => listing('scraper', '.py').map((name) => fs.readFileSync(path.join(DEFAULT_ENGINE_DIR, 'scraper', name), 'utf8')).join('\n');

test('실제 엔진: 성장 표는 일곱이고, 소장품 표의 칸은 스탯 셋과 스킬 레벨뿐이다(필요 경험치가 없다)', () => {
  assert.deepEqual(
    listing('data/base_stat_tables', '.json'),
    ['affinity.json', 'collection.json', 'console.json', 'cube.json', 'equipment_skills.json', 'equipment_stats.json', 'level_stats.json'],
    STALE,
  );
  const collection = readEngineTables()['base_stat_tables/collection.json'];
  // R0~R15 · SR0~SR15.
  assert.deepEqual(collectionColumns(collection), { stages: 32, columns: ['atk', 'def', 'hp', 'skill_lv'] }, STALE);
  assert.match(collection._source, /favorite_rare_map\.json/);
});

test('실제 엔진: 수집 코드가 받는 공개 표·이미지는 아홉 경로다 — 재화·모집 표가 없다', () => {
  assert.deepEqual(
    cdnPathsIn(scraperCode()),
    [
      '/character/AttractiveLevelTable.json',
      '/character/character_id_map.json',
      '/character/mi/mi_c{rid:03d}_00_s.webp',
      '/equip/ItemEquipTable-ko.json',
      '/equip/cube_rare_map.json',
      '/equip/favorite_rare_map.json',
      '/equip/ko/cube_{cid}.json',
      '/equip/ko/favorite_{fid}.json',
      '/roledata/{rid}-v2-ko.json',
    ],
    STALE,
  );
});

test('실제 엔진: 소장품 필요 경험치 · 키트 경험치 · 모집 확률 — 어느 표에도 없다(계산기 둘 다 「출처 없음」)', () => {
  const files = readEngineTables();
  const report = auditCalculatorSources({ files, cdnPaths: cdnPathsIn(scraperCode()) });
  // 성장 표 일곱, 캐릭터·스킬·보스·무기 데이터, 수집 원본까지 읽었다.
  for (const name of ['base_stat_tables/collection.json', 'base_stat_tables/affinity.json', 'base_stat_tables/level_stats.json', 'parsed_nikke.json', 'parsed_skills.json', 'boss_presets.json', 'scraper/nikke_scraped.json']) {
    assert.ok(report.looked.files.includes(name), `${name}을 읽지 못했다`);
  }
  assert.ok(report.looked.files.length >= 18, `읽은 표가 ${report.looked.files.length}개뿐이다`);
  assert.equal(report.looked.cdn_paths.length, 9);

  const text = renderSourceReport(report).join('\n');
  for (const need of report.needs) assert.deepEqual(need.hits, [], `${need.label} — ${STALE}\n${text}`);
  assert.deepEqual(
    report.calculators.map((c) => [c.title, c.status_label, c.missing, c.built]),
    [
      ['소장품 강화', '출처 없음', ['collection-exp', 'kit-exp'], false],
      ['모집 확률', '출처 없음', ['recruit-rates'], false],
    ],
    `${STALE}\n${text}`,
  );
});
