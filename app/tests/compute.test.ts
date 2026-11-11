// 추천·비교 실행(lib/compute.ts): 런타임을 주입해 루트의 suggestSquads·compareSquads를 부른다.
// 엔진 실행은 가짜다. 후보 생성·검증·순위는 루트의 실제 계산 코드(src/core)가 한다.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputeError, defaultDeps, runCompare, runSuggest, type ComputeDeps } from '../src/lib/compute';
import { tauriRuntime } from '../src/lib/runtime';
import type { EngineRequest } from '../src/types';
import {
  ACCOUNT_PATH,
  catalog,
  CONDITION_PATH,
  documents,
  FAKE_EVALUATOR,
  fakeRow,
  fakeRuntime,
  now,
  readJson,
  sampleAccount,
  SQUADS_PATH,
} from './helpers/fakeEngine';

afterEach(() => clearMocks());

const suggestInput = { accountPath: ACCOUNT_PATH, conditionPath: CONDITION_PATH, limit: 6, top: 3 };
const compareInput = { accountPath: ACCOUNT_PATH, conditionPath: CONDITION_PATH, squadsPath: SQUADS_PATH };
const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('실패해야 한다');
    },
    (e: unknown) => e,
  );

describe('추천 실행 (가짜 런타임 주입)', () => {
  it('보유 니케에서 후보를 만들어 엔진에 넘기고 총딜 순으로 상위만 돌려준다', async () => {
    const runtime = fakeRuntime();
    const report = await runSuggest(suggestInput, { runtime, readJson, now });

    // 런타임: 카탈로그 한 번, 배치 한 번. 결과에 엔진 판이 있어 버전은 묻지 않는다.
    expect(runtime.calls).toEqual(['loadCatalog', 'runBatch']);
    const requests = runtime.batches[0];
    expect(requests).toHaveLength(6);
    for (const request of requests) {
      const squad = request.squad as string[];
      expect(squad).toHaveLength(5);
      expect(new Set(squad).size).toBe(5);
      for (const name of squad) expect(Object.keys(sampleAccount.nikkes)).toContain(name);
      // 편성끼리 비교하려면 결정론이어야 한다. 프로필에 없는 이름이 만렙으로 계산되지 않게 base는 ungrown.
      expect(request.sim).toEqual({ expected: true, duration: 180 });
      expect(request.boss).toBe('솔로 레이드 S40');
      expect((request.profile as { base: string }).base).toBe('ungrown');
      expect(Object.keys((request.profile as { chars: object }).chars)).toEqual(squad);
    }

    expect(report.schema_version).toBe(1);
    expect(report.account.is_test_data).toBe(true);
    expect(report.engine).toEqual(FAKE_EVALUATOR);
    expect(report.generated_at).toBe('2026-11-12T00:00:00.000Z');
    expect(report.suggestion).toMatchObject({ generated: 6, simulated: 6, shown: 3, limit: 6, top: 3 });
    expect(report.ranking.map((r) => r.rank)).toEqual([1, 2, 3]);
    const totals = report.ranking.map((r) => r.total_damage);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    // 순위의 수치는 엔진이 준 값 그대로다.
    const best = requests.map((r) => fakeRow(r).total_damage as number).sort((a, b) => b - a)[0];
    expect(totals[0]).toBe(best);
    expect(report.ranking[0].relative_to_best).toBe(1);
    expect(report.caveats.join('\n')).toContain('전수 탐색이 아니다');
    expect(report.caveats).toContain('검증용 데이터다 — 실제 계정이 아니다');
  });

  it('후보 수·표시 수를 주지 않으면 계산 코드의 기본값을 쓴다', async () => {
    const runtime = fakeRuntime();
    const report = await runSuggest({ accountPath: ACCOUNT_PATH, conditionPath: CONDITION_PATH }, { runtime, readJson, now });
    expect(report.suggestion).toMatchObject({ limit: 30, top: 5 });
    expect(runtime.batches[0].length).toBe(report.suggestion?.generated);
    expect(report.ranking.length).toBeLessThanOrEqual(5);
  });

  it('엔진이 한 편성에서 오류를 내도 나머지는 순위에 남는다', async () => {
    const runtime = fakeRuntime({ failOn: '앨리스' });
    const report = await runSuggest({ ...suggestInput, top: 30 }, { runtime, readJson, now });
    expect(report.failed.length).toBeGreaterThan(0);
    expect(report.failed[0].error.message).toBe('가짜 엔진 오류: 앨리스');
    expect(report.ranking.length + report.failed.length).toBe(6);
    for (const r of report.ranking) expect(r.members.map((m) => m.name)).not.toContain('앨리스');
  });

  it('모든 편성이 실패해 엔진 판을 알 수 없으면 런타임에 버전을 묻는다', async () => {
    const runtime = fakeRuntime();
    runtime.runBatch = async (requests) => requests.map(() => ({ error: { type: 'internal_error', message: '전부 실패' } }));
    const report = await runSuggest(suggestInput, { runtime, readJson, now });
    expect(runtime.calls).toEqual(['loadCatalog', 'engineVersion']);
    expect(report.ranking).toEqual([]);
    expect(report.failed).toHaveLength(6);
    expect(report.engine).toEqual({ repo: 'fake/engine', commit: null });
  });
});

describe('비교 실행 (가짜 런타임 주입)', () => {
  it('편성 파일의 편성을 비교하고, 미보유·중복 편성은 엔진에 보내지 않고 사유와 함께 뺀다', async () => {
    const runtime = fakeRuntime();
    const report = await runCompare(compareInput, { runtime, readJson, now });
    expect(runtime.batches[0].map((r) => r.squad)).toEqual([
      ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'],
      ['리틀 머메이드', '크라운', '라피 : 레드 후드', '미하라', '헬름'],
      ['앨리스', '프리카', '크라운', '헬름', '미하라'],
    ]);
    expect(report.ranking).toHaveLength(3);
    expect(report.ranking.map((r) => r.name).sort()).toEqual(['A 레드후드-앨리스', 'B 레드후드-미하라', 'C 프리카-앨리스']);
    expect(report.rejected.map((r) => r.name)).toEqual(['D 미보유 포함', 'E 중복']);
    expect(report.suggestion).toBeUndefined();
    for (const r of report.ranking) {
      expect(r.members.reduce((sum, m) => sum + m.damage, 0)).toBe(r.total_damage);
    }
  });

  it('편성 파일은 배열 그대로여도 된다', async () => {
    const runtime = fakeRuntime();
    const squads = (documents[SQUADS_PATH] as { squads: unknown[] }).squads.slice(0, 2);
    const report = await runCompare(compareInput, {
      runtime,
      now,
      readJson: async (path) => (path === SQUADS_PATH ? squads : readJson(path)),
    });
    expect(report.ranking).toHaveLength(2);
  });
});

describe('Tauri 런타임으로 실행 (Rust 명령은 가짜 IPC)', () => {
  it('기본 설정은 Rust 명령으로 파일을 읽고 엔진을 부른다 — 주입한 가짜 런타임과 같은 결과다', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockIPC((cmd, args) => {
      const payload = (args ?? {}) as Record<string, unknown>;
      calls.push({ cmd, args: payload });
      if (cmd === 'read_json_file') return documents[payload.path as string];
      if (cmd === 'engine_catalog') return catalog;
      if (cmd === 'engine_version') return FAKE_EVALUATOR;
      if (cmd === 'engine_run_batch') return (payload.requests as EngineRequest[]).map((r) => fakeRow(r));
      throw `모르는 명령: ${cmd}`;
    });
    expect(defaultDeps.runtime).toBe(tauriRuntime);

    const viaTauri = await runSuggest(suggestInput, { ...defaultDeps, now });
    expect(calls.map((c) => c.cmd)).toEqual(['read_json_file', 'read_json_file', 'engine_catalog', 'engine_run_batch']);
    expect(calls[0].args).toEqual({ path: ACCOUNT_PATH });
    expect(calls[1].args).toEqual({ path: CONDITION_PATH });
    // 화면은 요청만 넘긴다. 엔진 폴더·python·동시 실행 수는 Rust 쪽 설정이다.
    expect(Object.keys(calls[3].args)).toEqual(['requests']);
    expect(calls[3].args.requests).toHaveLength(6);

    const viaFake = await runSuggest(suggestInput, { runtime: fakeRuntime(), readJson, now });
    expect(viaTauri).toEqual(viaFake);

    calls.length = 0;
    const compared = await runCompare(compareInput, { ...defaultDeps, now });
    expect(calls.map((c) => c.cmd)).toEqual([
      'read_json_file',
      'read_json_file',
      'read_json_file',
      'engine_catalog',
      'engine_run_batch',
    ]);
    expect(compared).toEqual(await runCompare(compareInput, { runtime: fakeRuntime(), readJson, now }));
  });

  it('런타임의 세 함수가 각각의 Rust 명령을 부른다', async () => {
    const seen: string[] = [];
    mockIPC((cmd, args) => {
      seen.push(cmd);
      if (cmd === 'engine_run_batch') return ((args as { requests: unknown[] }).requests ?? []).map((_, id) => ({ id }));
      return cmd === 'engine_catalog' ? { nikkes: {}, bosses: [] } : { repo: 'r', commit: null };
    });
    await expect(tauriRuntime.loadCatalog()).resolves.toEqual({ nikkes: {}, bosses: [] });
    await expect(tauriRuntime.engineVersion()).resolves.toEqual({ repo: 'r', commit: null });
    await expect(tauriRuntime.runBatch([{ squad: ['가'] }, { squad: ['나'] }], { concurrency: 2 })).resolves.toEqual([{ id: 0 }, { id: 1 }]);
    expect(seen).toEqual(['engine_catalog', 'engine_version', 'engine_run_batch']);
  });
});

describe('오류', () => {
  const deps = (over: Partial<ComputeDeps> = {}): ComputeDeps => ({ runtime: fakeRuntime(), readJson, now, ...over });

  it('경로가 비어 있으면 어느 파일인지 알리고 아무것도 읽지 않는다', async () => {
    const read = vi.fn(readJson);
    const e = await failure(runSuggest({ accountPath: '  ', conditionPath: CONDITION_PATH }, deps({ readJson: read })));
    expect(e).toBeInstanceOf(ComputeError);
    expect((e as Error).message).toBe('계정 파일 경로를 넣어야 한다.');
    expect(read).not.toHaveBeenCalled();
    expect(((await failure(runCompare({ ...compareInput, squadsPath: '' }, deps()))) as Error).message).toBe('편성 파일 경로를 넣어야 한다.');
  });

  it('파일을 읽지 못하면 Rust가 준 문장에 어느 파일인지 붙인다', async () => {
    const runtime = fakeRuntime();
    const e = await failure(runSuggest({ accountPath: ACCOUNT_PATH, conditionPath: 'D:\\없음.json' }, deps({ runtime })));
    expect((e as Error).message).toBe('전투 조건 파일 — 파일을 찾을 수 없다: D:\\없음.json');
    expect(runtime.calls).toEqual([]);
  });

  it('입력 문서가 잘못되면 입력 오류로 알리고 엔진을 부르지 않는다', async () => {
    const runtime = fakeRuntime();
    const broken = { ...(documents[ACCOUNT_PATH] as object), schema_version: 9 };
    const e = await failure(
      runSuggest(suggestInput, deps({ runtime, readJson: async (p) => (p === ACCOUNT_PATH ? broken : readJson(p)) })),
    );
    expect((e as Error).message).toMatch(/^입력 오류 — 계정 상태가 잘못됐다: \/schema_version/);
    expect(runtime.calls).toEqual(['loadCatalog']);

    const badLimit = await failure(runSuggest({ ...suggestInput, limit: 0 }, deps()));
    expect((badLimit as Error).message).toMatch(/^입력 오류 — .*limit은 1 이상의 정수여야 한다/);

    const noSquads = await failure(runCompare(compareInput, deps({ readJson: async (p) => (p === SQUADS_PATH ? {} : readJson(p)) })));
    expect((noSquads as Error).message).toMatch(/^입력 오류 — 후보 편성이 없다/);
  });

  it('엔진을 띄우지 못하면 실행 오류로 Rust가 준 문장을 보인다', async () => {
    const runtime = fakeRuntime();
    runtime.runBatch = async () => {
      throw '엔진을 실행할 수 없다 (python): program not found';
    };
    const e = await failure(runCompare(compareInput, deps({ runtime })));
    expect(e).toBeInstanceOf(ComputeError);
    expect((e as Error).message).toBe('실행 오류 — 엔진을 실행할 수 없다 (python): program not found');

    runtime.loadCatalog = async () => {
      throw '엔진 폴더(vendor/nikke-calc)를 찾을 수 없다';
    };
    expect(((await failure(runSuggest(suggestInput, deps({ runtime })))) as Error).message).toBe(
      '실행 오류 — 엔진 폴더(vendor/nikke-calc)를 찾을 수 없다',
    );
  });
});
