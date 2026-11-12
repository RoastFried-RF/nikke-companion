// 계산기(P-034)의 출처 점검 — 순수 함수. 지어낸 작은 표로만 본다(엔진을 부르지 않는다).
// 실제 엔진 데이터로 보는 것은 tests/integration/calculators.engine.test.mjs, 조사 결과는 docs/calculators.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  auditCalculatorSources,
  CALCULATOR_NEEDS,
  CALCULATOR_SOURCES_KIND,
  CALCULATOR_SOURCES_SCHEMA_VERSION,
  CALCULATORS,
  cdnPathsIn,
  collectionColumns,
  keyMatchesNeed,
  keyNames,
  renderSourceReport,
  SOURCE_STATUS,
} from '../../src/core/calculators.mjs';

const need = (id) => CALCULATOR_NEEDS.find((n) => n.id === id);
const calc = (report, id) => report.calculators.find((c) => c.id === id);
const needOf = (report, id) => report.needs.find((n) => n.id === id);

/** 엔진의 소장품 표와 같은 모양의 지어낸 표(값은 아무 숫자다 — is_test_data). */
const fakeCollection = () => ({
  is_test_data: true,
  _comment: '경험치 표가 아니다 — 이 문장은 값이라 칸 이름으로 세지 않는다',
  _stat_table: { R0: { skill_lv: 1, hp: 10, atk: 2, def: 1 }, R1: { skill_lv: 1, hp: 20, atk: 4, def: 2 } },
  common: { def_pct: { template: '방어력 {0}% ▲', R: [1, 2] } },
});

test('살펴본 계산기는 둘이고, 쓰려는 값은 셋이다', () => {
  assert.deepEqual(CALCULATORS.map((c) => [c.id, c.title, [...c.needs]]), [
    ['collection-upgrade', '소장품 강화', ['collection-exp', 'kit-exp']],
    ['recruit', '모집 확률', ['recruit-rates']],
  ]);
  assert.deepEqual(CALCULATOR_NEEDS.map((n) => n.label), ['소장품 단계별 필요 경험치', '관리 키트 세 종류의 경험치', '공식 모집 확률 표']);
  assert.deepEqual(SOURCE_STATUS, { no_source: '출처 없음', candidate: '확인 필요' });
  // 상태에 「확인됨」·「만들 수 있음」이 없다 — 이 점검만으로 계산기가 생기지 않는다.
  assert.deepEqual(Object.keys(SOURCE_STATUS), ['no_source', 'candidate']);
});

test('이 모듈에는 게임의 값이 없다 — 숫자를 적지 않았다(판 번호 한 자리뿐)', () => {
  const source = fs.readFileSync(new URL('../../src/core/calculators.mjs', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(code, /\d{2,}/, '두 자리 넘는 숫자가 있다 — 값을 적었다면 출처를 docs/calculators.md에 먼저 적는다');
  assert.doesNotMatch(code, /\d\s*%|\d\.\d/, '확률·비율처럼 보이는 숫자가 있다');
});

test('keyNames: 객체의 열쇠만 모은다 — 값(문장·주석)과 배열의 숫자는 보지 않는다', () => {
  assert.deepEqual(keyNames(fakeCollection()), ['R', 'R0', 'R1', '_comment', '_stat_table', 'atk', 'common', 'def', 'def_pct', 'hp', 'is_test_data', 'skill_lv', 'template']);
  assert.deepEqual(keyNames([{ a: 1 }, [{ b: { c: null } }], 'exp', 3]), ['a', 'b', 'c']);
  assert.deepEqual(keyNames(null), []);
  assert.deepEqual(keyNames('경험치'), []);
});

test('keyMatchesNeed: 영문은 토막이 같아야 하고, 한국어는 들어 있으면 된다', () => {
  const exp = need('collection-exp');
  for (const key of ['exp', 'need_exp', 'needExp', 'level-exp', 'EXP_TABLE', 'total_xp', '필요 경험치', '경험치표']) assert.equal(keyMatchesNeed(key, exp), true, key);
  // 엔진에 실제로 있는 칸 이름들 — 경험치가 아니다.
  for (const key of ['spot_explosion_range', 'projectile_explosion_dmg_pct', 'explosion_range', 'expire', 'expected', 'skill_lv', 'hp']) assert.equal(keyMatchesNeed(key, exp), false, key);

  const kit = need('kit-exp');
  for (const key of ['kit', 'maintenance_kit', 'kits', '관리 키트', '키트_경험치']) assert.equal(keyMatchesNeed(key, kit), true, key);
  for (const key of ['kitchen', 'skit', 'crit_rate']) assert.equal(keyMatchesNeed(key, kit), false, key);

  const rates = need('recruit-rates');
  for (const key of ['gacha', 'GachaTable', 'recruit_rate', 'pickup', 'probability', '모집 확률', '일반 모집', '뽑기']) assert.equal(keyMatchesNeed(key, rates), true, key);
  // 「확률」만으로는 걸지 않는다(크리티컬 확률·명중률 같은 전투 칸이 있다).
  for (const key of ['crit_rate', 'fire_rate', 'core_hit_rate', '크리티컬 확률', 'rate']) assert.equal(keyMatchesNeed(key, rates), false, key);

  assert.equal(keyMatchesNeed(undefined, exp), false);
  assert.equal(keyMatchesNeed(12, exp), false);
});

test('collectionColumns: 소장품 표의 단계 수와 칸 이름', () => {
  assert.deepEqual(collectionColumns(fakeCollection()), { stages: 2, columns: ['atk', 'def', 'hp', 'skill_lv'] });
  const withExp = fakeCollection();
  withExp._stat_table.R1.need_exp = 7;
  assert.deepEqual(collectionColumns(withExp).columns, ['atk', 'def', 'hp', 'need_exp', 'skill_lv']);
  for (const bad of [undefined, null, [], 'x', {}, { _stat_table: [] }]) assert.deepEqual(collectionColumns(bad), { stages: 0, columns: [] });
});

test('cdnPathsIn: 따옴표로 적힌 평문 경로만, 언어 자리는 ko로 읽어 하나로 센다', () => {
  const code = [
    'CUBE_PATH = "/equip/{locale}/cube_{cid}.json"',
    "d = _cdn_json(f'/equip/ko/cube_{cid}.json')",
    'PORTRAIT_PATH = "/character/mi/mi_c{rid:03d}_00_s.webp"',
    '  cube  큐브  /equip/cube_rare_map.json + 설명문의 경로는 세지 않는다',
    'ROOT = "/tmp/x"',
    'URL = "https://example.invalid/a/b.json"',
  ].join('\n');
  assert.deepEqual(cdnPathsIn(code), ['/character/mi/mi_c{rid:03d}_00_s.webp', '/equip/ko/cube_{cid}.json']);
  assert.deepEqual(cdnPathsIn(''), []);
  assert.deepEqual(cdnPathsIn(undefined), []);
});

test('audit: 표가 없으면 둘 다 「출처 없음」이고, 무엇이 없는지 적는다', () => {
  const report = auditCalculatorSources({ files: { 'base_stat_tables/collection.json': fakeCollection() }, cdnPaths: ['/equip/ko/favorite_{fid}.json'] });
  assert.equal(report.kind, CALCULATOR_SOURCES_KIND);
  assert.equal(report.schema_version, CALCULATOR_SOURCES_SCHEMA_VERSION);
  assert.deepEqual(report.looked, { files: ['base_stat_tables/collection.json'], cdn_paths: ['/equip/ko/favorite_{fid}.json'] });
  assert.deepEqual(report.collection_table, { stages: 2, columns: ['atk', 'def', 'hp', 'skill_lv'] });
  assert.deepEqual(report.needs.map((n) => [n.id, n.found, n.hits]), [['collection-exp', false, []], ['kit-exp', false, []], ['recruit-rates', false, []]]);
  assert.deepEqual(calc(report, 'collection-upgrade'), {
    id: 'collection-upgrade', title: '소장품 강화', needs: ['collection-exp', 'kit-exp'], missing: ['collection-exp', 'kit-exp'], status: 'no_source', status_label: '출처 없음', built: false,
  });
  assert.equal(calc(report, 'recruit').status, 'no_source');
  assert.equal(report.caveats.length, 2);
  // 아무것도 주지 않아도 같은 결론이다(0으로 채워 계산하지 않는다 — 계산이 없다).
  const empty = auditCalculatorSources();
  assert.deepEqual(empty.calculators.map((c) => c.status), ['no_source', 'no_source']);
  assert.deepEqual(empty.collection_table, { stages: 0, columns: [] });
});

test('audit: 필요한 값 가운데 하나만 보이면 여전히 「출처 없음」이다', () => {
  const collection = fakeCollection();
  collection._stat_table.R0.need_exp = 5;
  const report = auditCalculatorSources({ files: { 'base_stat_tables/collection.json': collection } });
  assert.deepEqual(needOf(report, 'collection-exp').hits, [{ where: 'file', file: 'base_stat_tables/collection.json', key: 'need_exp' }]);
  assert.equal(needOf(report, 'kit-exp').found, false);
  assert.deepEqual([calc(report, 'collection-upgrade').status, calc(report, 'collection-upgrade').missing], ['no_source', ['kit-exp']]);
});

test('audit: 칸 이름이 다 걸려도 「확인 필요」까지다 — 만들어진 것으로 치지 않는다', () => {
  const collection = fakeCollection();
  collection._stat_table.R0.need_exp = 5;
  const report = auditCalculatorSources({
    files: { 'base_stat_tables/collection.json': collection, 'items.json': { is_test_data: true, 관리_키트: [{ exp: 1 }] } },
    cdnPaths: ['/gacha/GachaTable-ko.json', '/equip/ko/cube_{cid}.json', '/gacha/GachaTable-ko.json'],
  });
  const upgrade = calc(report, 'collection-upgrade');
  assert.deepEqual([upgrade.status, upgrade.status_label, upgrade.missing, upgrade.built], ['candidate', '확인 필요', [], false]);
  assert.deepEqual(needOf(report, 'kit-exp').hits, [{ where: 'file', file: 'items.json', key: '관리_키트' }]);
  // 경로 이름으로도 찾는다(겹친 경로는 한 번).
  assert.deepEqual(needOf(report, 'recruit-rates').hits, [{ where: 'cdn_path', path: '/gacha/GachaTable-ko.json' }]);
  assert.deepEqual([calc(report, 'recruit').status, calc(report, 'recruit').built], ['candidate', false]);
  assert.deepEqual(report.looked.cdn_paths, ['/equip/ko/cube_{cid}.json', '/gacha/GachaTable-ko.json']);
});

test('audit: files가 객체가 아니면 던진다', () => {
  for (const bad of [null, [], 'x', 3]) assert.throws(() => auditCalculatorSources({ files: bad }), TypeError);
});

test('renderSourceReport: 사람이 읽는 줄 — 없는 것은 「없다」, 걸린 것은 어디의 무슨 칸인지', () => {
  const none = renderSourceReport(auditCalculatorSources({ files: { 'base_stat_tables/collection.json': fakeCollection() }, cdnPaths: ['/a/b.json'] }));
  assert.deepEqual(none, [
    '살펴본 표 1개 · 수집 코드의 경로 1개',
    '소장품 표: 2단계 · 칸 atk, def, hp, skill_lv',
    '- 소장품 단계별 필요 경험치: 없다',
    '- 관리 키트 세 종류의 경험치: 없다',
    '- 공식 모집 확률 표: 없다',
    '소장품 강화 계산기: 출처 없음',
    '모집 확률 계산기: 출처 없음',
  ]);
  const some = renderSourceReport(auditCalculatorSources({ files: { 'x.json': { need_exp: 1 } }, cdnPaths: ['/gacha/rates.json'] }));
  assert.equal(some[1], '소장품 표: 0단계 · 칸 없음');
  assert.equal(some[2], '- 소장품 단계별 필요 경험치: 그럴 만한 칸이 보인다(x.json의 need_exp)');
  assert.equal(some[4], '- 공식 모집 확률 표: 그럴 만한 칸이 보인다(/gacha/rates.json)');
  assert.deepEqual(some.slice(5), ['소장품 강화 계산기: 출처 없음', '모집 확률 계산기: 확인 필요']);
});
