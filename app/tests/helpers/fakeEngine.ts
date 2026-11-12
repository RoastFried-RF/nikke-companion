// 테스트용 가짜 엔진과 실제 입력 문서.
// 카탈로그·계정·조건·편성은 저장소의 실제 파일이다(엔진 데이터와 검증용 샘플). 엔진 실행만 가짜다.
import { cubeCatalogFrom } from '@core/efficiency.mjs';
import type { CubeInfo, EngineCatalog, EngineRequest, EngineRow, EngineRuntime, EngineVersion } from '../../src/types';
import cubeTable from '../../../vendor/nikke-calc/data/base_stat_tables/cube.json';
import account from '../../../data/samples/account.sample.json';
import bossBundle from '../../../data/samples/bosses.anomaly.sample.json';
import condition from '../../../data/samples/condition.solo-raid.json';
import squadsDoc from '../../../data/samples/squads.sample.json';
import upgradesDoc from '../../../data/samples/upgrades.sample.json';
import bossPresets from '../../../vendor/nikke-calc/data/boss_presets.json';
import parsedNikke from '../../../vendor/nikke-calc/data/parsed_nikke.json';

export const ACCOUNT_PATH = 'D:\\입력\\account.json';
export const CONDITION_PATH = 'D:\\입력\\condition.json';
export const SQUADS_PATH = 'D:\\입력\\squads.json';
/** 검증용 보스 묶음(보스 5종 — 확인된 칸이 많은 보스부터 속성도 약점도 모르는 보스까지). */
export const BOSSES_PATH = 'D:\\입력\\bosses.json';
export const UPGRADES_PATH = 'D:\\입력\\upgrades.json';

/** 경로 → 문서. Rust의 read_json_file을 흉내 낸다. */
export const documents: Record<string, unknown> = {
  [ACCOUNT_PATH]: account,
  [CONDITION_PATH]: condition,
  [SQUADS_PATH]: squadsDoc,
  [BOSSES_PATH]: bossBundle,
  [UPGRADES_PATH]: upgradesDoc,
};

export const sampleBossBundle = bossBundle;

export const sampleAccount = account;

/** 실제 엔진 데이터로 만든 카탈로그(Rust의 engine_catalog·Node의 loadCatalog와 같은 모양). */
export const catalog: EngineCatalog = {
  nikkes: parsedNikke as unknown as EngineCatalog['nikkes'],
  bosses: Object.keys(bossPresets).filter((k) => !k.startsWith('_')),
  // 큐브 목록(P-031)도 엔진의 큐브 표에서 같은 규칙으로 만든다.
  cubes: cubeCatalogFrom(cubeTable) as CubeInfo[],
};

export const FAKE_EVALUATOR: EngineVersion = { repo: 'fake/engine', commit: 'f'.repeat(40), dirty: false };

/** 멤버 이름에서 정해지는 가짜 대미지. 같은 편성이면 언제나 같은 값이고, 배치 순서가 다르면 값도 다르다. */
export function fakeDamage(name: string, slot: number): number {
  return [...name].reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) * 1000 * (slot + 1);
}

/** 가짜 엔진의 결과 한 줄. `failOn`이 편성에 있으면 엔진의 줄 단위 오류를 돌려준다. */
export function fakeRow(request: EngineRequest, failOn?: string): EngineRow {
  const squad = request.squad as string[];
  if (failOn && squad.includes(failOn)) {
    return { error: { type: 'invalid_input', message: `가짜 엔진 오류: ${failOn}`, path: '/squad' } };
  }
  const damages = squad.map(fakeDamage);
  const total = damages.reduce((a, b) => a + b, 0);
  return {
    total_damage: total,
    members: squad.map((name, i) => ({ name, damage: damages[i], share: damages[i] / total })),
    warnings: [],
    spec: { profile: { ungrown: [] } },
    evaluator: FAKE_EVALUATOR,
  };
}

export interface FakeRuntime extends EngineRuntime {
  calls: string[];
  batches: EngineRequest[][];
}

/** 호출을 적어 두는 가짜 런타임. */
export function fakeRuntime(options: { failOn?: string } = {}): FakeRuntime {
  const calls: string[] = [];
  const batches: EngineRequest[][] = [];
  return {
    calls,
    batches,
    loadCatalog: async () => {
      calls.push('loadCatalog');
      return catalog;
    },
    engineVersion: async () => {
      calls.push('engineVersion');
      return { repo: 'fake/engine', commit: null };
    },
    runBatch: async (requests) => {
      calls.push('runBatch');
      batches.push(requests);
      return requests.map((r) => fakeRow(r, options.failOn));
    },
  };
}

export const readJson = async (path: string): Promise<unknown> => {
  if (!(path in documents)) throw `파일을 찾을 수 없다: ${path}`;
  return structuredClone(documents[path]);
};

export const now = () => new Date('2026-11-12T00:00:00Z');
