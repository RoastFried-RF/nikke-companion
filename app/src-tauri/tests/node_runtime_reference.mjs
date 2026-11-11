// Rust 통합 테스트(tests/engine_batch.rs)가 부르는 기준 답안.
// 샘플 계정·조건·편성으로 계산 모듈이 만드는 것과 같은 엔진 요청을 만들고, Node 런타임으로 돌린 결과를
// 요청과 함께 표준 출력에 JSON 한 덩어리로 낸다. Rust 쪽은 같은 요청을 자기 명령으로 돌려 수치를 대조한다.
import fs from 'node:fs';
import { toEngineProfile } from '../../../src/core/account.mjs';
import { toEngineBase } from '../../../src/core/condition.mjs';
import { nodeRuntime } from '../../../src/runtime/node.mjs';

const sample = (name) => JSON.parse(fs.readFileSync(new URL(`../../../data/samples/${name}`, import.meta.url), 'utf8'));
const account = sample('account.sample.json');
const condition = sample('condition.solo-raid.json');
const { squads } = sample('squads.sample.json');

const base = toEngineBase(condition);
const usable = squads.filter((s) => new Set(s.members).size === 5 && s.members.every((m) => m in account.nikkes));
const requests = [
  ...usable.map((s) => ({ ...base, squad: s.members, profile: toEngineProfile(account, s.members) })),
  // 줄 단위 오류도 두 런타임이 같은 모양으로 돌려줘야 한다.
  { ...base, squad: ['없는 니케'] },
];

const catalog = await nodeRuntime.loadCatalog();
const results = await nodeRuntime.runBatch(requests);
const out = {
  requests,
  results,
  catalog: { nikke_names: Object.keys(catalog.nikkes), bosses: catalog.bosses },
  version: await nodeRuntime.engineVersion(),
};
process.stdout.write(JSON.stringify(out));
