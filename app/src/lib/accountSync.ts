// 계정 받기의 뒷부분: 받은 프로필 → 계정 상태 → 계정 파일.
// 변환 규칙은 여기에 없다. 루트의 src/core/import-profile.mjs(CLI의 `import-profile`과 같은 함수)에 엔진 카탈로그와
// 옵션 표를 넘겨 부를 뿐이다. 파일 읽기·쓰기는 Rust 명령이 한다(lib/backend.ts).
//
// 세션 쿠키는 이 파일을 지나가지 않는다 — 여기서 다루는 것은 이미 받은 프로필과 계정 문서뿐이다.

import { InputError } from '@core/compare.mjs';
import { importProfile, importReport, optionTableFrom } from '@core/import-profile.mjs';
import type { EngineCatalog, FetchedProfile, ImportReport, SavedAccount, SyncFailure } from '../types';
import { accountReadProfile, accountSaveFile, engineCatalog, errorMessage, syncFailure } from './backend';

/** 변환·저장에 필요한 바깥 일. 테스트에서 가짜로 바꿔 끼운다. */
export interface AccountSyncDeps {
  /** 받은 프로필과 옵션 표 읽기. 기본은 Rust 명령 account_read_profile. */
  readProfile: (name: string) => Promise<FetchedProfile>;
  /** 계정 파일 쓰기. 기본은 Rust 명령 account_save_file. */
  saveFile: (name: string, account: unknown) => Promise<SavedAccount>;
  /** 엔진 카탈로그(니케 이름 확인). 기본은 Rust 명령 engine_catalog. */
  catalog: () => Promise<EngineCatalog>;
  now?: () => Date;
}

export const defaultSyncDeps: AccountSyncDeps = {
  readProfile: accountReadProfile,
  saveFile: accountSaveFile,
  catalog: engineCatalog,
};

export interface ImportedAccount {
  /** 가져오기 결과(요약·건너뛴 항목·미확인 칸·알림·주의). `output`이 저장한 계정 파일의 경로다. */
  report: ImportReport;
  /** 계정 파일에 든 동기화 레벨. 프로필에 없었으면 null. */
  synchroLevel: number | null;
  saved: SavedAccount;
}

/** 변환이 던진 것을 화면 문장으로. CLI의 "입력 오류 — …" / "실행 오류 — …"와 같은 구분이다. */
function asFailure(step: string, e: unknown): SyncFailure {
  const known = syncFailure(e);
  // Rust가 종류와 함께 거부한 것은 그대로 넘긴다.
  if (known.kind !== 'unknown') return known;
  const message = e instanceof InputError ? `입력 오류 — ${e.message}` : `실행 오류 — ${errorMessage(e)}`;
  return { kind: step, message, cookie_help: false, lines: [], warnings: [] };
}

/**
 * 받아 둔 프로필(`<엔진>/profiles/<이름>.json`)을 계정 상태로 바꿔 계정 폴더의 `<이름>.json`에 쓴다.
 * 실패하면 `SyncFailure`를 던진다(`kind`: Rust가 준 종류, 변환 실패는 `convert`).
 */
export async function importFetchedProfile(name: string, deps: AccountSyncDeps = defaultSyncDeps): Promise<ImportedAccount> {
  let read: FetchedProfile;
  let catalog: EngineCatalog;
  try {
    read = await deps.readProfile(name);
    catalog = await deps.catalog();
  } catch (e) {
    throw asFailure('profile', e);
  }

  let account: Record<string, unknown>;
  let report: ImportReport;
  try {
    const profile = read.profile as { chars: object };
    const result = importProfile(profile, {
      catalog,
      optionTable: optionTableFrom(read.option_table),
      name,
      ...(deps.now ? { now: deps.now } : {}),
    });
    account = result.account as Record<string, unknown>;
    report = importReport({ profile, result, file: read.path }) as ImportReport;
  } catch (e) {
    throw asFailure('convert', e);
  }

  let saved: SavedAccount;
  try {
    saved = await deps.saveFile(name, account);
  } catch (e) {
    throw asFailure('account_file', e);
  }
  const level = (account.account as { synchro_level?: unknown } | undefined)?.synchro_level;
  return { report: { ...report, output: saved.path }, synchroLevel: typeof level === 'number' ? level : null, saved };
}
