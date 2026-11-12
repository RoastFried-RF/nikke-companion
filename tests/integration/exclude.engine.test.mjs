// 「안 씀」 니케를 뺀 추천(P-033)을 실제 엔진(vendor/nikke-calc)으로 돌리는 검증. 엔진 요청 스무 건 남짓 — 30초쯤 걸린다.
// 계정은 검증용 샘플(data/samples/account.sample.json), 보스 값은 내장 묶음(data/intercept/anomaly.json)이다.
// 본다: 뺀 니케가 실제 계산의 어느 편성에도 없다 · 뺐다는 사실이 결과에 남는다 · 빼지 않은 계산은 종전과 같다 · 계정은 그대로다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createMemoryStore, withCache } from '../../src/core/cache.mjs';
import { suggestSquads } from '../../src/core/candidates.mjs';
import { recommendIntercept } from '../../src/core/intercept.mjs';
import { emptyPlan, toggleUnused, unusedOwned } from '../../src/core/plan.mjs';
import { engineVersion, nodeRuntime } from '../../src/runtime/node.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const account = read('data/samples/account.sample.json');
const condition = read('data/samples/condition.solo-raid.json');
const bundle = read('data/intercept/anomaly.json');
const before = JSON.stringify(account);

// 메모리 캐시로 감싼 실제 런타임(디스크에는 쓰지 않는다). 엔진에 실제로 넘어간 편성을 적어 둔다.
const sent = [];
const runtime = withCache(
  {
    ...nodeRuntime,
    runBatch: async (requests, options) => {
      sent.push(...requests.map((r) => r.squad));
      return nodeRuntime.runBatch(requests, options);
    },
  },
  createMemoryStore(),
);
const BUDGET = 6;
const names = (report) => report.ranking.flatMap((r) => r.members.map((m) => m.name));

test('편성 추천: 「안 씀」으로 표시한 니케를 빼면 실제 계산의 어느 편성에도 없고, 뺐다는 사실이 결과에 남는다', async () => {
  // 내 니케 화면에서 표시한 것처럼: 표시 → 이 계정이 가진 이름만 추린다.
  const plan = toggleUnused(toggleUnused(emptyPlan(), '앨리스'), '계정에 없는 니케');
  const exclude = unusedOwned(plan, account);
  assert.deepEqual(exclude, ['앨리스']);

  const plain = await suggestSquads({ account, condition }, { budget: BUDGET, refine: false }, { runtime });
  assert.ok(plain.ranking.length > 0);
  assert.ok(!Object.hasOwn(plain, 'excluded'), '빼지 않은 계산의 결과에는 그 칸이 없다');
  assert.ok(names(plain).includes('앨리스'), '빼지 않으면 앨리스가 든 편성이 추천에 있다');

  sent.length = 0;
  const cut = await suggestSquads({ account, condition }, { budget: BUDGET, refine: false, exclude }, { runtime });
  assert.ok(cut.ranking.length > 0, '남은 니케로도 편성이 나온다');
  assert.ok(cut.ranking.every((r) => r.total_damage > 0));
  assert.ok(!names(cut).includes('앨리스'));
  assert.ok(sent.length > 0 && sent.every((squad) => !squad.includes('앨리스')), '엔진에 넘긴 편성에도 없다');
  assert.deepEqual(cut.excluded, {
    reason: 'unused',
    label: '안 씀',
    names: ['앨리스'],
    count: 1,
    text: '「안 씀」으로 표시한 니케 1명을 빼고 계산했다: 앨리스.',
  });
  assert.ok(cut.caveats.includes(cut.excluded.text));
  assert.equal(cut.engine.commit, engineVersion().commit);
  // 주력 딜러를 뺐으니 가장 좋은 편성의 총딜이 줄어든다(같은 계산 횟수로 견줬다).
  assert.ok(cut.ranking[0].total_damage < plain.ranking[0].total_damage, `${cut.ranking[0].total_damage} < ${plain.ranking[0].total_damage}`);

  // 빼지 않는 계산을 다시 돌리면 처음과 같다(캐시에서 나온다 — 빼는 선택이 다른 계산을 바꾸지 않았다).
  const again = await suggestSquads({ account, condition }, { budget: BUDGET, refine: false, exclude: [] }, { runtime });
  assert.deepEqual(again.ranking, plain.ranking);
  assert.deepEqual(again.caveats, plain.caveats);
  assert.equal(again.cache.misses, 0);
  // 계정 문서는 바뀌지 않았다.
  assert.equal(JSON.stringify(account), before);
});

test('요격전 추천: 보스 하나를 실제 엔진으로 — 뺀 니케가 없는 편성이 나오고 결과 문서에 한 번 남는다', async () => {
  const plain = await recommendIntercept({ account, bundle, boss: '크라켄' }, { budget: BUDGET, top: 2 }, { runtime });
  assert.equal(plain.bosses.length, 1);
  assert.equal(plain.bosses[0].status, 'computed');
  assert.ok(!Object.hasOwn(plain, 'excluded'));
  const top = plain.bosses[0].ranking[0];
  assert.ok(top.total_damage > 0);
  // 1위 편성에 든 3단계 딜러 하나를 「안 씀」으로 뺀다(샘플 계정에는 3단계 니케가 더 있어 편성이 여전히 나온다).
  const carry = '앨리스';
  assert.ok(top.members.some((m) => m.name === carry), '빼지 않으면 1위 편성에 앨리스가 있다');

  const cut = await recommendIntercept({ account, bundle, boss: '크라켄' }, { budget: BUDGET, top: 2, exclude: [carry] }, { runtime });
  const boss = cut.bosses[0];
  assert.equal(boss.status, 'computed');
  assert.ok(boss.ranking.length > 0);
  assert.ok(boss.ranking.every((r) => r.total_damage > 0 && r.members.every((m) => m.name !== carry)), `${carry}가 든 편성이 없다`);
  assert.deepEqual(cut.excluded.names, [carry]);
  assert.equal(cut.excluded.text, `「안 씀」으로 표시한 니케 1명을 빼고 계산했다: ${carry}.`);
  assert.equal(cut.caveats.at(-1), cut.excluded.text);
  // 약점 속성 보유 니케 목록에도 뺀 니케는 없다(뺀 계정으로 계산했다).
  assert.ok(!(boss.weak_pool?.owned ?? []).includes(carry));

  // 빼고 나면 편성을 만들 수 없을 때(버스트 1단계 니케를 모두 뺐다)는 0이나 빈 추천으로 얼버무리지 않고 까닭을 말하며 거부한다.
  const catalog = await nodeRuntime.loadCatalog();
  const firstStage = Object.keys(account.nikkes).filter((name) => String(catalog.nikkes[name]?.burst_stage) === '1');
  assert.ok(firstStage.length > 0);
  await assert.rejects(
    recommendIntercept({ account, bundle, boss: '크라켄' }, { budget: BUDGET, exclude: firstStage }, { runtime }),
    /후보 편성이 없다.*버스트 1단계 니케를 보유하지 않았다/,
  );
  assert.equal(JSON.stringify(account), before);
});
