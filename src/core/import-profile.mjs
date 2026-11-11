// 계정 가져오기: 엔진의 육성 프로필(vendor/nikke-calc `scraper/profile_fetch.py`가 만든 `profiles/<이름>.json`)
// → 우리 계정 상태. 형식 설명은 docs/data-model.md §계정 가져오기.
//
// 사용자가 직접 받아 둔 프로필 파일만 읽는다. 로그인 세션·쿠키·네트워크는 다루지 않는다.
// 옮기지 못한 칸은 값을 지어내지 않고 그 니케의 `unknown`에 남긴다 — 결과에 "미확인"으로 드러난다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_SCHEMA_VERSION, validateAccount } from './account.mjs';
import { InputError } from './compare.mjs';
import { DEFAULT_ENGINE_DIR, loadCatalog } from '../runtime/node.mjs';

export const IMPORT_REPORT_SCHEMA_VERSION = 1;
export const IMPORT_FORMAT = 'nikke-calc profile';
/** 개인 계정 데이터를 두는 곳(gitignore). */
export const DEFAULT_ACCOUNTS_DIR = path.resolve(fileURLToPath(new URL('../../data/accounts', import.meta.url)));

/** 프로필이 언제나 적는 칸. 없거나 읽을 수 없으면 미확인이다. */
const EXPECTED_FIELDS = ['breakthrough', 'core_enhancement', 'affinity', 'skill_levels', 'equipment', 'overload', 'collection_stage'];
const INT_RANGES = { breakthrough: [0, 3], core_enhancement: [0, 7], affinity: [1, 40], favorite_stage: [0, 3] };
// 장비·소장품 표기(vendor/nikke-calc/docs/SIM-JSON.md §육성). 엔진 인라인 프로필은 이 밖의 값을 오류로 본다.
const PARTS = ['머리', '몸통', '팔', '다리'];
const GEAR_KEYS = ['tier', 'corp', 'level', 'skills'];
const GEAR_TIER = /^(없음|기업|T[1-9])$/;
const GEAR_LEVEL_MAX = 5;
const COLLECTION_STAGE = /^(없음|(R|SR)(\d|1[0-5]))$/;
const CONSOLE_KEYS = ['common_level', 'class_level', 'company_level'];
// 줄별 수치를 표와 맞춰 볼 때의 허용 오차(퍼센트). 프로필은 소수 넷째 자리로 반올림해 적고,
// 이웃한 옵션 레벨의 차이는 0.03 이상이라 이 오차로 레벨이 섞이지 않는다.
const OPTION_TOLERANCE = 1e-3;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi = Infinity) => Number.isInteger(v) && v >= lo && v <= hi;
const isAmount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** 엔진의 오버로드 옵션 표 → `{엔진 키: {name: 인게임 이름, values: [레벨별 퍼센트]}}`. */
export function loadOptionTable(engineDir = DEFAULT_ENGINE_DIR) {
  const raw = JSON.parse(fs.readFileSync(path.join(engineDir, 'data/base_stat_tables/equipment_skills.json'), 'utf8'));
  const table = {};
  for (const [key, row] of Object.entries(raw)) {
    if (key.startsWith('_')) continue;
    // 인게임 이름은 표의 문구에서 뽑는다 — 엔진(`runner/spec.py`)이 옵션 이름을 정하는 방식과 같다.
    table[key] = { name: String(row.template).split('{0}')[0].trim(), values: row.values.map((v) => v * 100) };
  }
  return table;
}

/** 엔진이 받는 스킬 레벨 표기 넷(`{"1","2","3"}` · `[a,b,c]` · `"a/b/c"` · 정수) → `[a, b, c]`. 못 읽으면 null. */
function readSkillLevels(v) {
  let levels = null;
  if (Array.isArray(v)) levels = v;
  else if (isPlainObject(v) && Object.keys(v).length === 3) levels = ['1', '2', '3'].map((k) => v[k]);
  else if (typeof v === 'string' && /^\s*\d+\s*\/\s*\d+\s*\/\s*\d+\s*$/.test(v)) levels = v.split('/').map(Number);
  else if (Number.isInteger(v)) levels = [v, v, v];
  return levels !== null && levels.length === 3 && levels.every((x) => isInt(x, 1, 10)) ? [...levels] : null;
}

/** 장비 4부위. `_track` 같은 주석 키는 뗀다(엔진 인라인 프로필이 장비 안의 모르는 키를 오류로 본다). */
function readEquipment(v) {
  if (!isPlainObject(v) || Object.keys(v).some((p) => !PARTS.includes(p))) return null;
  const out = {};
  for (const [part, gear] of Object.entries(v)) {
    if (!isPlainObject(gear)) return null;
    const kept = Object.fromEntries(Object.entries(gear).filter(([k]) => !k.startsWith('_')));
    if (Object.keys(kept).some((k) => !GEAR_KEYS.includes(k))) return null;
    if ('tier' in kept && !(typeof kept.tier === 'string' && GEAR_TIER.test(kept.tier))) return null;
    if ('level' in kept && !isInt(kept.level, 0, GEAR_LEVEL_MAX)) return null;
    if ('corp' in kept && !(typeof kept.corp === 'string' && kept.corp !== '')) return null;
    if ('skills' in kept && !(Array.isArray(kept.skills) && kept.skills.every(isPlainObject))) return null;
    out[part] = structuredClone(kept);
  }
  return out;
}

/** 프로필의 `equip_skills`(합산 퍼센트 또는 줄별 퍼센트 목록). 표에 없는 키·음수가 있으면 null. */
function readEquipSkills(v, table) {
  if (!isPlainObject(v)) return null;
  for (const [key, val] of Object.entries(v)) {
    if (!Object.hasOwn(table, key)) return null;
    if (!(isAmount(val) || (Array.isArray(val) && val.every(isAmount)))) return null;
  }
  return structuredClone(v);
}

/** 손으로 적은 `overload`(`{옵션: 줄 수 | [줄별 레벨]}`)의 모양만 본다. 옵션 이름은 엔진이 판정한다. */
function readOverloadNotation(v) {
  if (!isPlainObject(v)) return null;
  const ok = Object.values(v).every((x) => isInt(x, 0) || (Array.isArray(x) && x.every((lv) => isInt(lv, 1, 15))));
  return ok ? structuredClone(v) : null;
}

/**
 * 프로필의 부위별 줄 목록(`_overload`: `{부위: [[엔진 키, 레벨], ...]}`)을 우리 `overload`
 * (`{인게임 이름: [줄별 레벨]}`)로 바꾼다. 줄 목록으로 다시 계산한 합이 `equip_skills`와 맞을 때만 돌려준다 —
 * 프로필은 표에 없는 수치의 줄을 `_overload`에서 빼므로, 맞지 않으면 줄 목록만 믿을 수 없다(null).
 */
function linesToOverload(pieces, equipSkills, table) {
  if (!isPlainObject(pieces)) return null;
  const levels = {};
  for (const lines of Object.values(pieces)) {
    if (!Array.isArray(lines)) return null;
    for (const line of lines) {
      if (!Array.isArray(line) || line.length !== 2) return null;
      const [key, lv] = line;
      if (!Object.hasOwn(table, key) || !isInt(lv, 1, table[key].values.length)) return null;
      (levels[key] ??= []).push(lv);
    }
  }
  for (const key of Object.keys(table)) {
    const written = equipSkills[key] ?? 0;
    const lineLevels = levels[key] ?? [];
    if (Array.isArray(written) && written.length !== lineLevels.length) return null;
    const total = Array.isArray(written) ? written.reduce((s, x) => s + x, 0) : written;
    const expected = lineLevels.reduce((s, lv) => s + table[key].values[lv - 1], 0);
    if (Math.abs(total - expected) > OPTION_TOLERANCE) return null;
  }
  // 줄이 없는 옵션도 `[]`(그 옵션 없음)로 적는다. 엔진은 항목에 적지 않은 옵션을 0이 아니라 기본 스펙 값
  // (우월 코드 4줄·공격력 2줄·최대 장탄 2줄)으로 계산하므로, 빼놓으면 없는 옵션이 붙은 것으로 계산된다.
  const out = {};
  for (const key of Object.keys(table)) out[table[key].name] = (levels[key] ?? []).sort((a, b) => b - a);
  return out;
}

/** 프로필의 니케 항목 하나 → 계정 상태 항목. 옮기지 못한 칸은 `unknown`에 남기고 이유를 warnings에 적는다. */
function convertEntry(name, entry, info, table, warnings) {
  const out = {};
  const unknown = [];
  const warn = (message) => warnings.push(`${name}: ${message}`);
  const miss = (field, why) => {
    unknown.push(field);
    warn(`${field}${why} — 미확인으로 남겼다`);
  };
  const reason = (field) => (field in entry ? '의 값을 읽을 수 없다' : '이(가) 프로필에 없다');

  for (const [field, [lo, hi]] of Object.entries(INT_RANGES)) {
    if (isInt(entry[field], lo, hi)) out[field] = entry[field];
    else if (field in entry || EXPECTED_FIELDS.includes(field)) miss(field, reason(field));
  }
  // 애장품이 있는 니케인데 단계가 없으면 프로필을 만든 엔진이 그 애장품을 몰랐던 것이다.
  if (!('favorite_stage' in entry) && Array.isArray(info?.favorite_slots) && info.favorite_slots.length) {
    miss('favorite_stage', '이(가) 프로필에 없다(애장품이 있는 니케)');
  }

  const skills = readSkillLevels(entry.skill_levels);
  if (skills) out.skill_levels = skills;
  else miss('skill_levels', reason('skill_levels'));

  const equipment = readEquipment(entry.equipment);
  if (equipment) {
    out.equipment = equipment;
    const odd = Object.entries(equipment).filter(([, g]) => typeof g.corp === 'string' && g.corp.startsWith('?'));
    if (odd.length) warn(`장비 제조사 코드를 프로필이 풀지 못했다(${odd.map(([p, g]) => `${p} ${g.corp}`).join(', ')}) — 제조사 보너스 없이 계산된다`);
  } else miss('equipment', reason('equipment'));

  // 오버로드 옵션. 줄 단위(`overload`)로 옮겨야 후보 생성의 투자 점수와 성장 비교의 add가 줄 수를 읽는다.
  const equipSkills = readEquipSkills(entry.equip_skills, table);
  if ('overload' in entry) {
    const written = readOverloadNotation(entry.overload);
    if (written) {
      out.overload = written;
      if (equipSkills) out.equip_skills = equipSkills;
      else if ('equip_skills' in entry) warn('equip_skills의 값을 읽을 수 없어 옮기지 않았다(overload는 옮겼다)');
    } else miss('overload', '의 값을 읽을 수 없다');
  } else if (equipSkills) {
    const overload = linesToOverload(entry._overload, equipSkills, table);
    if (overload) out.overload = overload;
    else {
      out.equip_skills = equipSkills;
      warn('오버로드 옵션을 줄 단위로 풀지 못해 합산 수치(equip_skills)를 그대로 옮겼다 — 계산 값은 같지만 줄 수를 세는 기능(후보 생성의 투자 점수, 성장 비교의 overload 더하기)에는 반영되지 않는다');
    }
  } else miss('overload', 'equip_skills' in entry ? '(equip_skills)의 값을 읽을 수 없다' : '(equip_skills)이(가) 프로필에 없다');

  if (typeof entry.collection_stage === 'string' && COLLECTION_STAGE.test(entry.collection_stage)) out.collection_stage = entry.collection_stage;
  else miss('collection_stage', reason('collection_stage'));

  if ('console' in entry) {
    if (isPlainObject(entry.console)) out.console = structuredClone(entry.console);
    else miss('console', '의 값을 읽을 수 없다');
  }
  if ('cube' in entry) {
    const ok = (typeof entry.cube === 'string' && entry.cube !== '') || (isPlainObject(entry.cube) && typeof entry.cube.name === 'string');
    if (ok) out.cube = structuredClone(entry.cube);
    else miss('cube', '의 값을 읽을 수 없다');
  }

  // 레벨은 계정 상태가 아니다(콘텐츠가 정한다). `_`로 시작하는 키는 엔진도 계산에 쓰지 않는 주석이다.
  const ignored = Object.keys(entry).filter((k) => !k.startsWith('_') && k !== 'level' && k !== 'equip_skills' && !(k in out) && !unknown.includes(k));
  if (ignored.length) warn(`모르는 칸은 옮기지 않았다: ${ignored.join(', ')}`);
  if (entry._unsynced === true) out.note = '가져올 때 동기화 소대 밖이었다(인게임 레벨 1). 레벨은 콘텐츠가 정하므로 계산에는 영향이 없다.';
  if (unknown.length) out.unknown = unknown;
  return out;
}

function readConsole(v) {
  if (!isPlainObject(v) || Object.keys(v).some((k) => !CONSOLE_KEYS.includes(k))) return null;
  const level = (x) => isInt(x, 0) || (isPlainObject(x) && Object.values(x).every((n) => isInt(n, 0)));
  if ('common_level' in v && !isInt(v.common_level, 0)) return null;
  if (('class_level' in v && !level(v.class_level)) || ('company_level' in v && !level(v.company_level))) return null;
  return structuredClone(v);
}

/** 계정 단위 값(`_account`) → 우리 `account`. 콘솔만 계산에 쓰인다. 동기화 레벨·관찰된 큐브는 기록으로 옮긴다. */
function convertAccountLevel(src, warnings) {
  const out = {};
  const console_ = readConsole(src.console);
  if (console_) out.console = console_;
  else {
    warnings.push(`콘솔(재활용 연구실) 레벨${src.console == null ? '이 프로필에 없다' : '을 읽을 수 없다'} — 엔진 기본 스펙 값으로 계산된다. 인게임 값을 계정 파일의 account.console에 적어라`);
  }
  if (isInt(src.synchro_level, 1)) out.synchro_level = src.synchro_level;
  if (isPlainObject(src.cubes) && Object.values(src.cubes).every((lv) => isInt(lv, 1))) out.cubes = structuredClone(src.cubes);
  if (Array.isArray(src.console_warnings)) warnings.push(...src.console_warnings.filter((w) => typeof w === 'string'));
  return out;
}

/**
 * 엔진 육성 프로필 → 계정 상태 문서. 파일을 쓰지 않는 순수 변환이다.
 *
 * @param {object} profile 프로필 파일의 내용(`{_meta, _account, chars}`)
 * @param {object} [deps]
 * @param {object} [deps.catalog]     엔진 카탈로그(`loadCatalog`). 이름 확인에 쓴다
 * @param {object} [deps.optionTable] 오버로드 옵션 표(`loadOptionTable`)
 * @param {string} [deps.name]        계정 이름. 주지 않으면 프로필 이름
 * @param {() => Date} [deps.now]
 * @returns {{account: object, skipped: {name: string, reason: string}[], unknown: {nikke: string, fields: string[]}[], warnings: string[]}}
 */
export function importProfile(profile, deps = {}) {
  if (!isPlainObject(profile)) throw new InputError('프로필을 읽을 수 없다', [{ path: '', message: '프로필 문서는 객체여야 한다' }]);
  if (!isPlainObject(profile.chars)) {
    const raw = Array.isArray(profile.characters) || Array.isArray(profile.details);
    throw new InputError('프로필을 읽을 수 없다', [{
      path: '/chars',
      message: raw
        ? '원시 응답 파일(<이름>.raw.json)이다 — 변환된 프로필 파일(<이름>.json)을 줘야 한다'
        : 'chars가 없다 — 엔진의 scraper/profile_fetch.py가 만든 프로필 파일이 아니다',
    }]);
  }
  const catalog = deps.catalog ?? loadCatalog(deps.engineDir);
  const table = deps.optionTable ?? loadOptionTable(deps.engineDir);
  const meta = isPlainObject(profile._meta) ? profile._meta : {};
  const now = (deps.now ?? (() => new Date()))().toISOString();

  const warnings = [];
  const skipped = [];
  const nikkes = {};
  for (const [name, entry] of Object.entries(profile.chars)) {
    if (!Object.hasOwn(catalog.nikkes, name)) skipped.push({ name, reason: '엔진이 모르는 니케다 — 엔진 데이터에 추가된 뒤 다시 가져와라' });
    else if (!isPlainObject(entry)) skipped.push({ name, reason: '육성 항목이 객체가 아니다' });
    else nikkes[name] = convertEntry(name, entry, catalog.nikkes[name], table, warnings);
  }
  if (Object.keys(nikkes).length === 0) {
    throw new InputError('가져올 니케가 없다', [{ path: '/chars', message: `프로필의 ${skipped.length}개 항목을 모두 옮기지 못했다` }]);
  }

  const fetchedAt = typeof meta.fetched_at === 'string' && !Number.isNaN(Date.parse(meta.fetched_at)) ? meta.fetched_at : null;
  if (!fetchedAt) warnings.push('프로필에 수집 시각(_meta.fetched_at)이 없다 — updated_at에는 가져온 시각을 적었다');
  const profileName = typeof meta.name === 'string' && meta.name !== '' ? meta.name : null;
  const account = {
    schema_version: ACCOUNT_SCHEMA_VERSION,
    // 실제 계정에서 받은 파일로 본다. 프로필이 스스로 검증용이라고 밝힌 경우에만 검증용으로 남긴다 —
    // 모의 데이터가 실제 계정으로 표시되는 일이 없게.
    is_test_data: meta.is_test_data === true,
    name: deps.name ?? profileName ?? '가져온 계정',
    source: 'import',
    updated_at: fetchedAt ?? now,
    import: { format: IMPORT_FORMAT, profile_name: profileName, fetched_at: fetchedAt, imported_at: now, skipped, warnings },
    account: convertAccountLevel(isPlainObject(profile._account) ? profile._account : {}, warnings),
    nikkes,
  };

  const checked = validateAccount(account, catalog);
  if (!checked.ok) {
    throw new Error(`변환 결과가 계정 형식 검사를 통과하지 못했다(변환기 결함): ${checked.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  }
  const unknown = Object.entries(nikkes).filter(([, e]) => e.unknown).map(([nikke, e]) => ({ nikke, fields: e.unknown }));
  return { account, skipped, unknown, warnings };
}

/** 계정 이름 → 파일 이름(확장자 없이). 경로 구분자·Windows에서 못 쓰는 글자는 `_`로 바꾼다. */
export function accountFileName(name) {
  const safe = String(name ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  return safe === '' ? 'imported' : safe;
}

/**
 * 프로필 파일을 읽어 계정 상태로 바꾸고 `data/accounts/<이름>.json`에 쓴다.
 * 같은 이름의 파일이 있으면 쓰지 않는다 — 손으로 고친 계정 파일을 덮어쓰지 않기 위해서다(`force`로만 덮어쓴다).
 *
 * @param {object} input
 * @param {string} input.file      프로필 파일 경로
 * @param {string} [input.name]    계정 이름(파일 이름도 여기서 나온다). 기본은 프로필 이름, 없으면 입력 파일 이름
 * @param {string} [input.outDir]  기본 `data/accounts/`
 * @param {boolean} [input.force]
 * @param {object} [deps] importProfile과 같다
 */
export function importProfileFile({ file, name, outDir = DEFAULT_ACCOUNTS_DIR, force = false }, deps = {}) {
  if (typeof file !== 'string' || file === '') {
    throw new InputError('인자가 빠졌다', [{ path: '<파일>', message: '엔진 프로필 파일(profiles/<이름>.json) 경로가 필요하다' }]);
  }
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new InputError('파일을 읽을 수 없다', [{ path: file, message: e.message }]);
  }
  const fallbackName = path.basename(file).replace(/\.json$/i, '');
  const profileName = isPlainObject(profile?._meta) && typeof profile._meta.name === 'string' && profile._meta.name !== '' ? profile._meta.name : null;
  const { account, skipped, unknown, warnings } = importProfile(profile, { ...deps, name: name ?? profileName ?? fallbackName });

  const output = path.join(outDir, `${accountFileName(account.name)}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  try {
    fs.writeFileSync(output, JSON.stringify(account, null, 2) + '\n', { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw new InputError('계정 파일이 이미 있다', [{ path: output, message: '덮어쓰면 손으로 고친 내용이 사라진다 — 덮어쓰려면 --force, 따로 두려면 --name <다른 이름>' }]);
  }

  const fieldCounts = {};
  for (const u of unknown) for (const f of u.fields) fieldCounts[f] = (fieldCounts[f] ?? 0) + 1;
  return {
    schema_version: IMPORT_REPORT_SCHEMA_VERSION,
    kind: 'import',
    generated_at: account.import.imported_at,
    input: { file: path.resolve(file), format: IMPORT_FORMAT, profile_name: account.import.profile_name, fetched_at: account.import.fetched_at },
    output,
    account: { name: account.name, is_test_data: account.is_test_data, source: account.source, updated_at: account.updated_at },
    summary: {
      roster: Object.keys(profile.chars).length,
      imported: Object.keys(account.nikkes).length,
      skipped: skipped.length,
      with_unknown: unknown.length,
      unknown_fields: fieldCounts,
    },
    unknown,
    skipped,
    warnings,
    caveats: [
      '가져온 값을 인게임 육성 상태와 대조하지 않았다. 계정 파일을 열어 직접 확인하라.',
      '미확인 칸은 값이 없는 칸이다. 지금 엔진은 항목에 적지 않은 칸을 기본 스펙 값(돌파 3·스킬 10/10/10·오버로드 장비 등)으로 계산하므로, 미확인 칸이 있는 니케는 실제보다 높게 나올 수 있다. 확인한 값을 계정 파일에 적고 그 칸을 unknown에서 지워라.',
      '캐릭터 레벨과 큐브는 계정 상태에 담지 않는다 — 레벨은 콘텐츠가 정하고, 큐브는 엔진 기본 스펙 큐브로 계산된다.',
    ],
  };
}
