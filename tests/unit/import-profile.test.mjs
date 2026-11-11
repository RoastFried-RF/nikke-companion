// 계정 가져오기(엔진 프로필 → 계정 상태). 엔진을 부르지 않는다 — 가짜 엔진 데이터 폴더를 쓴다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateAccount, toEngineProfile, GROWTH_FIELDS } from '../../src/core/account.mjs';
import { InputError } from '../../src/core/compare.mjs';
import { loadCatalog } from '../../src/runtime/node.mjs';
import {
  importProfile, importProfileFile, loadOptionTable, accountFileName, DEFAULT_ACCOUNTS_DIR, IMPORT_FORMAT,
} from '../../src/core/import-profile.mjs';
import { renderImportReport } from '../../src/core/render.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = path.join(ROOT, 'src/cli.mjs');
const sampleProfile = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/samples/profile.sample.json'), 'utf8'));

// ── 가짜 엔진 데이터 폴더: 샘플에 나오는 니케와 옵션 표(수치는 엔진 표에서 옮긴 것) ──────────
const STAT = [0.0477, 0.0547, 0.0618, 0.0688, 0.0759, 0.0829, 0.09, 0.097, 0.104, 0.1111, 0.1181, 0.1252, 0.1322, 0.1393, 0.1463];
const ENGINE_FILES = {
  'data/parsed_nikke.json': {
    '리틀 머메이드': { burst_stage: '1' }, 크라운: { burst_stage: '2' }, '라피 : 레드 후드': { burst_stage: '3' },
    헬름: { burst_stage: '3', favorite_slots: [1, 2, 3] }, 앨리스: { burst_stage: '3' }, 나가: { burst_stage: '2' },
  },
  'data/boss_presets.json': { _comment: '테스트용', '테스트 보스': {} },
  'data/base_stat_tables/equipment_skills.json': {
    _comment: '테스트용',
    atk_pct: { template: '공격력 {0}% 증가', values: STAT },
    element_bonus: { template: '우월 코드 대미지 {0}% 증가', values: [0.0954, 0.1094, 0.1234, 0.1375, 0.1515, 0.1655, 0.1795, 0.1935, 0.2075, 0.2215, 0.2356, 0.2496, 0.2636, 0.2776, 0.2916] },
    max_ammo_pct: { template: '최대 장탄 수 {0}% 증가', values: [0.2784, 0.3195, 0.3606, 0.4017, 0.4428, 0.4839, 0.525, 0.566, 0.6071, 0.6482, 0.6893, 0.7304, 0.7715, 0.8126, 0.8537] },
    crit_rate: { template: '크리티컬 확률 {0}% 증가', values: [0.023, 0.0264, 0.0298, 0.0332, 0.0366, 0.04, 0.0435, 0.0469, 0.0503, 0.0537, 0.0571, 0.0605, 0.0639, 0.0673, 0.0707] },
    crit_dmg: { template: '크리티컬 대미지 {0}% 증가', values: [0.0664, 0.0762, 0.086, 0.0958, 0.1056, 0.1154, 0.1252, 0.135, 0.1448, 0.1546, 0.1644, 0.1742, 0.184, 0.1938, 0.2036] },
    charge_speed_pct: { template: '차지 속도 {0}% 증가', values: [0.0198, 0.0228, 0.0257, 0.0286, 0.0316, 0.0345, 0.0375, 0.0404, 0.0433, 0.0463, 0.0492, 0.0521, 0.0551, 0.058, 0.0609] },
    charge_dmg_pct: { template: '차지 대미지 {0}% 증가', values: STAT },
    accuracy_pct: { template: '명중률 {0}% 증가', values: STAT },
    def_pct: { template: '방어력 {0}% 증가', values: STAT },
  },
};
const ENGINE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-import-engine-'));
for (const [rel, body] of Object.entries(ENGINE_FILES)) {
  fs.mkdirSync(path.dirname(path.join(ENGINE_DIR, rel)), { recursive: true });
  fs.writeFileSync(path.join(ENGINE_DIR, rel), JSON.stringify(body));
}
test.after(() => fs.rmSync(ENGINE_DIR, { recursive: true, force: true }));

const catalog = loadCatalog(ENGINE_DIR);
const optionTable = loadOptionTable(ENGINE_DIR);
const now = () => new Date('2026-11-12T05:00:00Z');
const deps = { catalog, optionTable, now };

const NO_OPTIONS = { atk_pct: 0, element_bonus: 0, max_ammo_pct: [], crit_rate: 0, crit_dmg: 0, charge_speed_pct: [], charge_dmg_pct: 0, accuracy_pct: 0, def_pct: 0 };
const NO_LINES = { 머리: [], 몸통: [], 팔: [], 다리: [] };
/** 계정 상태의 overload: 줄이 없는 옵션도 `[]`로 적혀 있어야 한다(엔진이 적지 않은 옵션을 기본 스펙 값으로 계산한다). */
const overloadOf = (lines = {}) => ({
  공격력: [], '우월 코드 대미지': [], '최대 장탄 수': [], '크리티컬 확률': [], '크리티컬 대미지': [],
  '차지 속도': [], '차지 대미지': [], 명중률: [], 방어력: [], ...lines,
});
/** profile_fetch.py가 내는 모양의 니케 항목 하나(옵션 없음). */
const entry = (over = {}) => ({
  breakthrough: 3, core_enhancement: 2, affinity: 20, skill_levels: { 1: 7, 2: 8, 3: 9 },
  equipment: Object.fromEntries(['머리', '몸통', '팔', '다리'].map((p) => [p, { level: 5, _track: '오버로드' }])),
  equip_skills: { ...NO_OPTIONS }, _overload: structuredClone(NO_LINES), collection_stage: 'SR5', ...over,
});
/** 실제 계정에서 받은 것처럼 생긴 프로필(검증용 표시 없음). */
const profileOf = (chars, account = { console: { common_level: 200, class_level: 100, company_level: 100 }, console_warnings: [] }) => ({
  _meta: { name: 'me', openid: '12345678901234567890', area: 83, fetched_at: '2026-11-10T21:00:00+09:00', roster: Object.keys(chars).length },
  _account: account,
  chars,
});
const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-import-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('예시 프로필 파일을 계정 상태로 바꾸고 validateAccount를 통과한다', () => {
  const profile = sampleProfile();
  const before = structuredClone(profile);
  const { account, skipped, unknown, warnings } = importProfile(profile, deps);

  const checked = validateAccount(account, catalog);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.ok, true);
  assert.deepEqual(profile, before, '받은 프로필을 바꾸지 않는다');
  assert.deepEqual([skipped, unknown, warnings], [[], [], []]);
  assert.deepEqual(Object.keys(account.nikkes).sort(), Object.keys(profile.chars).sort());

  // 엔진 표기 → 계정 상태 표기
  assert.deepEqual(account.nikkes['리틀 머메이드'], {
    breakthrough: 3,
    core_enhancement: 7,
    affinity: 30,
    skill_levels: [10, 10, 10],
    equipment: { 머리: { level: 5 }, 몸통: { level: 5 }, 팔: { level: 4 }, 다리: { level: 3 } },
    overload: overloadOf({ 공격력: [11, 11, 9], '우월 코드 대미지': [11, 11, 8], '최대 장탄 수': [10, 7] }),
    collection_stage: 'SR10',
  });
  // 계산이 엔진의 아래 층(기본 스펙)에 기대지 않게, 프로필이 언제나 적는 칸은 모두 값으로 옮긴다.
  for (const [name, e] of Object.entries(account.nikkes)) {
    for (const field of ['breakthrough', 'core_enhancement', 'affinity', 'skill_levels', 'equipment', 'overload', 'collection_stage']) assert.ok(field in e, `${name}.${field}`);
    assert.equal(Object.keys(e.overload).length, 9, name);
  }
  assert.deepEqual(account.nikkes.크라운.equipment, { 머리: { level: 5 }, 몸통: { level: 4 }, 팔: { tier: 'T9', level: 3, corp: '필그림' }, 다리: { tier: 'T9' } });
  assert.deepEqual(account.nikkes.앨리스.overload, overloadOf({ 공격력: [10, 10, 10, 10], '우월 코드 대미지': [12, 12, 10], '차지 속도': [10, 8] }));
  assert.deepEqual(account.nikkes.헬름.skill_levels, [7, 7, 10]);
  assert.equal(account.nikkes.헬름.favorite_stage, 2);
  assert.equal('favorite_stage' in account.nikkes.크라운, false, '애장품이 없는 니케에는 단계를 지어내지 않는다');
  // 동기화 소대 밖 표시는 메모로, 옵션이 없는 것은 "옵션 없음"으로 옮긴다(미확인이 아니다).
  assert.match(account.nikkes.나가.note, /동기화 소대 밖/);
  assert.deepEqual(account.nikkes.나가.overload, overloadOf());
  assert.equal(account.nikkes.나가.collection_stage, '없음');

  // 계정 단위 값과 출처
  assert.deepEqual(account.account, { console: profile._account.console, synchro_level: 412, cubes: profile._account.cubes });
  assert.equal(account.source, 'import');
  assert.equal(account.updated_at, '2026-11-12T03:00:00+09:00');
  assert.deepEqual(account.import, {
    format: IMPORT_FORMAT, profile_name: '검증용 샘플 프로필', fetched_at: '2026-11-12T03:00:00+09:00',
    imported_at: '2026-11-12T05:00:00.000Z', skipped: [], warnings: [],
  });
  // 샘플은 스스로 검증용이라고 밝힌 파일이다 — 실제 계정으로 표시되면 안 된다.
  assert.equal(account.is_test_data, true);
  assert.equal(JSON.stringify(account).includes(profile._meta.openid), false, '게임 계정 식별자는 옮기지 않는다');
});

test('실제 계정 프로필의 결과는 is_test_data:false, source:import다', () => {
  const { account } = importProfile(profileOf({ 크라운: entry() }), deps);
  assert.equal(account.is_test_data, false);
  assert.equal(account.source, 'import');
  assert.equal(account.name, 'me');
  assert.equal(account.updated_at, '2026-11-10T21:00:00+09:00');
  assert.equal(JSON.stringify(account).includes('12345678901234567890'), false);
  const checked = validateAccount(account, catalog);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.warnings, [], '검증용 데이터 경고가 붙지 않는다');
  assert.equal(importProfile(profileOf({ 크라운: entry() }), { ...deps, name: '본계' }).account.name, '본계');
});

test('변환하지 못한 칸은 값을 지어내지 않고 unknown으로 남긴다', () => {
  const broken = entry({
    breakthrough: 5,                                              // 범위 밖
    skill_levels: { 1: 0, 2: 4, 3: 4 },                           // 0레벨
    equipment: { 머리: { tier: 'T10' }, 몸통: { level: 5 } },     // 모르는 등급
    equip_skills: { ...NO_OPTIONS, new_option_pct: 3.5 },         // 표에 없는 옵션
    collection_stage: 'SSR3',                                     // 모르는 표기
    favorite_stage: 7,
    cube: 15,
  });
  delete broken.affinity;                                         // 칸이 아예 없다
  const noFavorite = entry();                                     // 애장품이 있는 니케인데 단계가 없다
  const { account, unknown, warnings } = importProfile(profileOf({ 크라운: broken, 헬름: noFavorite, 앨리스: entry() }), deps);

  assert.equal(validateAccount(account, catalog).ok, true);
  assert.deepEqual(account.nikkes.크라운, {
    core_enhancement: 2,
    unknown: ['breakthrough', 'affinity', 'favorite_stage', 'skill_levels', 'equipment', 'overload', 'collection_stage', 'cube'],
  });
  assert.deepEqual(account.nikkes.헬름.unknown, ['favorite_stage']);
  assert.equal('unknown' in account.nikkes.앨리스, false);
  assert.deepEqual(unknown, [
    { nikke: '크라운', fields: account.nikkes.크라운.unknown },
    { nikke: '헬름', fields: ['favorite_stage'] },
  ]);
  for (const field of account.nikkes.크라운.unknown) {
    assert.ok(GROWTH_FIELDS.includes(field), field);
    assert.ok(warnings.some((w) => w.startsWith('크라운: ') && w.includes(field) && w.includes('미확인')), `${field}의 이유가 알림에 있어야 한다`);
  }
  assert.equal(account.import.warnings, warnings);
});

test('스킬 레벨은 엔진이 받는 표기 넷을 모두 읽는다', () => {
  const chars = { 크라운: entry({ skill_levels: [4, 5, 6] }), 헬름: entry({ skill_levels: '7/8/9', favorite_stage: 0 }), 앨리스: entry({ skill_levels: 3 }), 나가: entry({ skill_levels: { 1: 10 } }) };
  const { account } = importProfile(profileOf(chars), deps);
  assert.deepEqual(account.nikkes.크라운.skill_levels, [4, 5, 6]);
  assert.deepEqual(account.nikkes.헬름.skill_levels, [7, 8, 9]);
  assert.deepEqual(account.nikkes.앨리스.skill_levels, [3, 3, 3]);
  assert.deepEqual(account.nikkes.나가.unknown, ['skill_levels'], '일부만 적힌 스킬 레벨은 나머지를 지어내지 않는다');
});

test('오버로드 옵션: 줄 목록이 합산 수치와 맞을 때만 줄 단위로 옮긴다', () => {
  const lines = { ...NO_LINES, 머리: [['atk_pct', 10], ['max_ammo_pct', 10]], 몸통: [['atk_pct', 12]] };
  const totals = { ...NO_OPTIONS, atk_pct: 23.63, max_ammo_pct: [64.82] };
  const chars = {
    크라운: entry({ equip_skills: totals, _overload: lines }),
    // 프로필은 표에 없는 수치의 줄을 `_overload`에서 뺀다 → 합이 맞지 않는다.
    앨리스: entry({ equip_skills: { ...totals, atk_pct: 30.0 }, _overload: lines }),
    // 줄 수가 다르다(최대 장탄 2줄인데 줄 목록에는 1줄).
    나가: entry({ equip_skills: { ...totals, max_ammo_pct: [32.41, 32.41] }, _overload: lines }),
    // 줄 목록이 없는 옛 프로필.
    '리틀 머메이드': (() => {
      const e = entry({ equip_skills: totals });
      delete e._overload;
      return e;
    })(),
  };
  const { account, unknown, warnings } = importProfile(profileOf(chars), deps);
  assert.deepEqual(account.nikkes.크라운.overload, overloadOf({ 공격력: [12, 10], '최대 장탄 수': [10] }));
  assert.equal('equip_skills' in account.nikkes.크라운, false);
  for (const name of ['앨리스', '나가', '리틀 머메이드']) {
    assert.equal('overload' in account.nikkes[name], false, name);
    assert.deepEqual(account.nikkes[name].equip_skills, chars[name].equip_skills, `${name}: 합산 수치를 그대로 옮긴다`);
    assert.ok(warnings.some((w) => w.startsWith(`${name}: `) && w.includes('equip_skills')), name);
  }
  assert.deepEqual(unknown, [], '수치는 옮겼으므로 미확인이 아니다');
  assert.equal(validateAccount(account, catalog).ok, true);
});

test('손으로 적은 overload 표기는 그대로 옮기고, 모르는 칸·레벨은 옮기지 않는다', () => {
  const e = entry({ overload: { 공격력: 2, 우월코드: [12, 10] }, level: 400, control: { burst: {} } });
  delete e.equip_skills;
  delete e._overload;
  const { account, warnings } = importProfile(profileOf({ 크라운: e, 앨리스: entry({ overload: { 공격력: -1 } }) }), deps);
  assert.deepEqual(account.nikkes.크라운.overload, { 공격력: 2, 우월코드: [12, 10] });
  assert.equal('level' in account.nikkes.크라운, false);
  assert.equal('control' in account.nikkes.크라운, false);
  assert.ok(warnings.some((w) => w.startsWith('크라운: ') && w.includes('control')));
  assert.deepEqual(account.nikkes.앨리스.unknown, ['overload']);
  assert.equal(validateAccount(account, catalog).ok, true);
});

test('장비: 주석 키를 떼고, 풀지 못한 제조사 코드는 알린다', () => {
  const equipment = { 머리: { tier: 'T9', level: 2, corp: '?9', _track: 'T9' }, 몸통: { tier: '없음' }, 팔: { tier: '기업', level: 5 }, 다리: { tier: 'T3' } };
  const { account, warnings, unknown } = importProfile(profileOf({ 크라운: entry({ equipment }) }), deps);
  assert.deepEqual(account.nikkes.크라운.equipment, { 머리: { tier: 'T9', level: 2, corp: '?9' }, 몸통: { tier: '없음' }, 팔: { tier: '기업', level: 5 }, 다리: { tier: 'T3' } });
  assert.ok(warnings.some((w) => w.includes('제조사') && w.includes('?9')));
  assert.deepEqual(unknown, []);
  for (const bad of [{ 머리: { level: 6 } }, { 꼬리: { level: 1 } }, { 머리: { level: 1, grade: 'x' } }, { 머리: 'T9' }, []]) {
    const r = importProfile(profileOf({ 크라운: entry({ equipment: bad }) }), deps);
    assert.deepEqual(r.account.nikkes.크라운.unknown, ['equipment'], JSON.stringify(bad));
  }
});

test('엔진이 모르는 니케는 건너뛰고 알린다. 하나도 못 옮기면 입력 오류다', () => {
  const { account, skipped } = importProfile(profileOf({ 크라운: entry(), '새로 나온 니케': entry(), 헬름: 'x' }), deps);
  assert.deepEqual(Object.keys(account.nikkes), ['크라운']);
  assert.deepEqual(skipped.map((s) => s.name), ['새로 나온 니케', '헬름']);
  assert.match(skipped[0].reason, /엔진이 모르는 니케/);
  assert.equal(account.import.skipped, skipped);
  assert.equal(validateAccount(account, catalog).ok, true);
  assert.throws(() => importProfile(profileOf({ '새로 나온 니케': entry() }), deps), (e) => e instanceof InputError && /가져올 니케가 없다/.test(e.message));
});

test('프로필이 아닌 입력은 입력 오류다', () => {
  for (const bad of [null, [], 'x', {}, { chars: [] }]) assert.throws(() => importProfile(bad, deps), InputError, JSON.stringify(bad));
  // 원시 응답 파일을 준 경우 무엇을 줘야 하는지 알려 준다.
  assert.throws(() => importProfile({ openid: '1', characters: [], details: [] }, deps), (e) => e instanceof InputError && /raw\.json/.test(e.message));
});

test('계정 단위 값: 콘솔이 없으면 알리고, 프로필의 콘솔 경고와 수집 시각 누락도 알린다', () => {
  const noConsole = importProfile(profileOf({ 크라운: entry() }, { console: null, synchro_level: 300, console_warnings: ['모르는 재활용 연구실 tid 1301'] }), deps);
  assert.deepEqual(noConsole.account.account, { synchro_level: 300 });
  assert.ok(noConsole.warnings.some((w) => w.includes('콘솔') && w.includes('account.console')));
  assert.ok(noConsole.warnings.includes('모르는 재활용 연구실 tid 1301'));

  const badConsole = importProfile(profileOf({ 크라운: entry() }, { console: { common_level: '250' } }), deps);
  assert.equal('console' in badConsole.account.account, false);

  const p = profileOf({ 크라운: entry() });
  delete p._meta;
  delete p._account;
  const bare = importProfile(p, deps);
  assert.equal(bare.account.name, '가져온 계정');
  assert.equal(bare.account.updated_at, '2026-11-12T05:00:00.000Z');
  assert.equal(bare.account.import.fetched_at, null);
  assert.ok(bare.warnings.some((w) => w.includes('fetched_at')));
  assert.equal(validateAccount(bare.account, catalog).ok, true);
});

test('엔진에 넘기는 프로필에는 육성 칸만 실린다', () => {
  const { account } = importProfile(sampleProfile(), deps);
  const squad = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '나가'];
  const engineProfile = toEngineProfile(account, squad);
  assert.deepEqual(engineProfile._account, { console: account.account.console });
  for (const name of squad) {
    const e = engineProfile.chars[name];
    assert.deepEqual(Object.keys(e).filter((k) => !GROWTH_FIELDS.includes(k)), [], name);
    // 엔진 인라인 프로필은 장비 안의 모르는 키(`_track`)와 프로필 표기(`equip_skills`+`overload` 중복)를 오류로 본다.
    for (const gear of Object.values(e.equipment)) assert.deepEqual(Object.keys(gear).filter((k) => !['tier', 'corp', 'level', 'skills'].includes(k)), []);
    assert.equal('equip_skills' in e, false);
  }
});

test('파일로 쓰기: data/accounts/가 기본이고, 있는 파일은 --force 없이 덮어쓰지 않는다', (t) => {
  assert.equal(DEFAULT_ACCOUNTS_DIR, path.join(ROOT, 'data', 'accounts'));
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^data\/accounts\/$/m, '개인 계정 폴더는 저장소에 올리지 않는다');

  const dir = tmpDir(t);
  const file = path.join(dir, 'me.json');
  fs.writeFileSync(file, JSON.stringify(profileOf({ 크라운: entry(), 헬름: entry(), '새로 나온 니케': entry() })));
  const outDir = path.join(dir, 'accounts');

  const report = importProfileFile({ file, outDir }, deps);
  assert.equal(report.output, path.join(outDir, 'me.json'));
  const written = JSON.parse(fs.readFileSync(report.output, 'utf8'));
  assert.equal(written.is_test_data, false);
  assert.equal(written.source, 'import');
  assert.equal(validateAccount(written, catalog).ok, true);
  assert.deepEqual(written.nikkes.헬름.unknown, ['favorite_stage']);

  assert.equal(report.schema_version, 1);
  assert.equal(report.kind, 'import');
  assert.deepEqual(report.account, { name: 'me', is_test_data: false, source: 'import', updated_at: '2026-11-10T21:00:00+09:00' });
  assert.deepEqual(report.summary, { roster: 3, imported: 2, skipped: 1, with_unknown: 1, unknown_fields: { favorite_stage: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  const text = renderImportReport(report);
  assert.match(text, /\[실제 계정 데이터\]/);
  assert.match(text, /헬름: favorite_stage/);
  assert.match(text, /새로 나온 니케/);
  assert.match(text, /인게임 육성 상태와 대조하지 않았다/);

  // 손으로 고친 계정 파일을 지키기 위해, 같은 이름이 있으면 쓰지 않는다.
  fs.writeFileSync(report.output, '{"손으로": "고친 내용"}');
  assert.throws(() => importProfileFile({ file, outDir }, deps), (e) => e instanceof InputError && /이미 있다/.test(e.message));
  assert.equal(fs.readFileSync(report.output, 'utf8'), '{"손으로": "고친 내용"}');
  importProfileFile({ file, outDir, force: true }, deps);
  assert.equal(JSON.parse(fs.readFileSync(report.output, 'utf8')).source, 'import');

  // 이름을 주면 그 이름으로 따로 쓴다. 프로필 이름이 없으면 입력 파일 이름을 쓴다.
  assert.equal(importProfileFile({ file, outDir, name: '부계/2' }, deps).output, path.join(outDir, '부계_2.json'));
  const unnamed = path.join(dir, 'alt.json');
  fs.writeFileSync(unnamed, JSON.stringify({ chars: { 크라운: entry() } }));
  assert.equal(importProfileFile({ file: unnamed, outDir }, deps).account.name, 'alt');

  assert.throws(() => importProfileFile({ file: path.join(dir, '없는파일.json'), outDir }, deps), InputError);
  assert.throws(() => importProfileFile({ outDir }, deps), InputError);
});

test('계정 이름을 파일 이름으로 바꿀 때 경로를 벗어나는 글자를 없앤다', () => {
  assert.equal(accountFileName('me'), 'me');
  assert.equal(accountFileName('../../밖'), '_.._밖');
  assert.equal(accountFileName('a:b*c?'), 'a_b_c_');
  assert.equal(accountFileName(' .. '), 'imported');
  assert.equal(accountFileName(undefined), 'imported');
});

test('CLI import-profile: 프로필 파일을 받아 계정 파일을 쓰고 요약을 낸다', (t) => {
  const dir = tmpDir(t);
  const outDir = path.join(dir, 'accounts');
  const reportFile = path.join(dir, 'report.json');
  const sample = path.join(ROOT, 'data/samples/profile.sample.json');
  const run = (...args) => spawnSync(process.execPath, [CLI, 'import-profile', ...args], { encoding: 'utf8' });
  const common = ['--out-dir', outDir, '--engine', ENGINE_DIR];

  const ok = run(sample, ...common, '--json', reportFile);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\[검증용 데이터\]/);
  assert.match(ok.stdout, /가져온 니케 6명/);
  const written = path.join(outDir, '검증용 샘플 프로필.json');
  const account = JSON.parse(fs.readFileSync(written, 'utf8'));
  assert.equal(validateAccount(account, catalog).ok, true);
  assert.equal(account.source, 'import');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.output, written);
  assert.equal(report.summary.imported, 6);

  const again = run(sample, ...common);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /입력 오류 — 계정 파일이 이미 있다/);
  // --force는 값을 받지 않는다 — 뒤에 오는 파일 경로를 삼키지 않는다.
  assert.equal(run('--force', sample, ...common).status, 0);
  assert.equal(run(sample, ...common, '--name', '다른 이름').status, 0);
  assert.ok(fs.existsSync(path.join(outDir, '다른 이름.json')));

  for (const bad of [[...common], [path.join(dir, '없는파일.json'), ...common], [sample, sample, ...common], [sample, '--out-dir']]) {
    const r = run(...bad);
    assert.equal(r.status, 2, bad.join(' '));
    assert.match(r.stderr, /입력 오류/);
  }
});
