// 계정 가져오기의 Node 쪽: 프로필 파일을 읽고, 엔진 폴더에서 카탈로그·옵션 표를 읽고, 계정 파일을 쓴다.
// 변환 자체는 src/core/import-profile.mjs(순수 — 오버레이와 함께 쓴다)가 한다. 형식 설명은 docs/data-model.md §계정 가져오기.
//
// 사용자가 직접 받아 둔 프로필 파일만 읽는다. 로그인 세션·쿠키·네트워크는 다루지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError } from '../core/compare.mjs';
import {
  accountFileName, checkProfileShape, importProfile as convertProfile, importReport, optionTableFrom, OPTION_TABLE_FILE,
} from '../core/import-profile.mjs';
import { DEFAULT_ENGINE_DIR, loadCatalog } from './node.mjs';

export {
  accountFileName, IMPORT_CAVEATS, IMPORT_FORMAT, IMPORT_REPORT_SCHEMA_VERSION, importReport, optionTableFrom, OPTION_TABLE_FILE,
} from '../core/import-profile.mjs';

/** 개인 계정 데이터를 두는 곳(gitignore). */
export const DEFAULT_ACCOUNTS_DIR = path.resolve(fileURLToPath(new URL('../../data/accounts', import.meta.url)));

/** 엔진의 오버로드 옵션 표 → `{엔진 키: {name: 인게임 이름, values: [레벨별 퍼센트]}}`. */
export function loadOptionTable(engineDir = DEFAULT_ENGINE_DIR) {
  return optionTableFrom(JSON.parse(fs.readFileSync(path.join(engineDir, OPTION_TABLE_FILE), 'utf8')));
}

/**
 * 엔진 육성 프로필 → 계정 상태 문서(`src/core/import-profile.mjs`의 `importProfile`). 카탈로그와 옵션 표를 주지 않으면
 * 엔진 폴더(`deps.engineDir`, 기본 vendor/nikke-calc)에서 읽는다. 프로필이 아닌 문서는 엔진 폴더를 읽기 전에 거부한다.
 */
export function importProfile(profile, deps = {}) {
  checkProfileShape(profile);
  return convertProfile(profile, {
    ...deps,
    catalog: deps.catalog ?? loadCatalog(deps.engineDir),
    optionTable: deps.optionTable ?? loadOptionTable(deps.engineDir),
  });
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
  const meta = profile !== null && typeof profile === 'object' && !Array.isArray(profile) ? profile._meta : null;
  const profileName = meta !== null && typeof meta === 'object' && typeof meta.name === 'string' && meta.name !== '' ? meta.name : null;
  const result = importProfile(profile, { ...deps, name: name ?? profileName ?? fallbackName });

  const output = path.join(outDir, `${accountFileName(result.account.name)}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  try {
    fs.writeFileSync(output, JSON.stringify(result.account, null, 2) + '\n', { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw new InputError('계정 파일이 이미 있다', [{ path: output, message: '덮어쓰면 손으로 고친 내용이 사라진다 — 덮어쓰려면 --force, 따로 두려면 --name <다른 이름>' }]);
  }
  return importReport({ profile, result, file: path.resolve(file), output });
}
