// 버스트 흐름(P-032)을 실제 엔진(vendor/nikke-calc)으로 읽는 검증. 엔진을 여섯 번쯤 띄운다(약 15초).
// 엔진의 JSON 결과에는 버스트 흐름이 없어 텍스트 보기(`--view burst`)를 읽는다 — 그 글의 모양이 바뀌면 여기서 걸린다.
// 계정은 검증용 샘플(data/samples/)뿐이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { burstReport, parseBurstView } from '../../src/core/burst.mjs';
import { compareSquads, squadRequest } from '../../src/core/compare.mjs';
import { resolveOpponent } from '../../src/core/deck.mjs';
import { nodeRuntime, runViews, VIEW_REQUEST_MAX_CHARS } from '../../src/runtime/node.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const account = read('data/samples/account.sample.json');
const large = read('data/samples/account.large.sample.json');
const condition = read('data/samples/condition.solo-raid.json');
const bundle = read('data/intercept/anomaly.json');
const catalog = await nodeRuntime.loadCatalog();
const DECK = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];

test('실제 엔진: 샘플 계정의 편성과 자리 순서를 바꾼 편성의 버스트 흐름을 읽어 견준다', async () => {
  const reordered = ['리틀 머메이드', '크라운', '헬름', '라피 : 레드 후드', '앨리스'];
  const report = await burstReport({ account, condition, squads: [{ name: '지금 편성', members: DECK }, { name: '자리 순서를 바꾼 편성', members: reordered }] }, { runtime: nodeRuntime });
  assert.deepEqual(report.lines.map((l) => l.status), ['read', 'read'], JSON.stringify(report.lines.map((l) => l.error ?? l.reasons ?? null)));
  for (const l of report.lines) {
    const flow = l.flow;
    // 엔진이 모르는 줄을 내지 않았다(글의 모양이 그대로다).
    assert.deepEqual(l.unread, []);
    assert.equal(flow.duration, 180);
    assert.ok(flow.count >= 5, `풀 버스트 ${flow.count}번`);
    assert.ok(flow.average_period > 5 && flow.average_period < 40, `평균 주기 ${flow.average_period}초`);
    // 엔진의 첫 버스트 시각은 기본 3초다(SIM-JSON.md §요청 sim.first_burst).
    assert.equal(flow.first_use_at, 3);
    assert.ok(flow.first_at > 3 && flow.first_at < 5);
    assert.equal(flow.status, 'ok', flow.problem ?? '');
    assert.match(flow.headline, /^3분 동안 풀 버스트 \d+번, 평균 [\d.]+초마다$/);
    // 풀 버스트마다 1·2·3단계를 차례로 썼고, 쓴 니케는 그 편성의 니케다.
    for (const fb of flow.full_bursts) {
      assert.deepEqual(fb.users.map((u) => u.stage), ['1', '2', '3']);
      assert.ok(fb.users.every((u) => l.members.includes(u.name)));
      assert.ok(fb.start > fb.users[2].t && (fb.end === null || fb.end > fb.start));
    }
    assert.deepEqual(flow.by_stage[1].map((r) => r.name), ['리틀 머메이드']);
    assert.deepEqual(flow.by_stage[2].map((r) => r.name), ['크라운']);
    assert.equal(flow.by_member.reduce((n, m) => n + m.count, 0), flow.uses.length);
    assert.ok(flow.uptime_ratio > 0.2 && flow.uptime_ratio < 1);
  }
  // 3단계 첫 사용자는 자리 순서를 따른다(엔진 문서 GAMEPLAY.md §버스트 사용 순서와 배치).
  assert.equal(report.lines[0].flow.full_bursts[0].users[2].name, '라피 : 레드 후드');
  assert.equal(report.lines[1].flow.full_bursts[0].users[2].name, '헬름');
  assert.ok(report.comparison.text.startsWith('풀 버스트'));
  assert.ok(typeof report.engine.commit === 'string' && report.engine.commit.length === 40);
});

test('실제 엔진: 버스트가 돌지 않는 편성 — 2단계가 없으면 한 번도 열리지 않고, 3단계가 한 명뿐이면 늦는다', async () => {
  const kraken = resolveOpponent('boss:kraken', { bundle, catalog });
  assert.ok(kraken);
  const noStage2 = ['리틀 머메이드', '리타', '라피 : 레드 후드', '앨리스', '헬름'];
  const oneStage3 = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '리타', '도로시'];
  const report = await burstReport({ account: large, condition: kraken.condition, squads: [{ name: '2단계 없음', members: noStage2 }, { name: '3단계 한 명', members: oneStage3 }] }, { runtime: nodeRuntime });
  const [none, stalled] = report.lines;
  assert.equal(none.status, 'read', JSON.stringify(none.error ?? none.reasons ?? null));
  assert.equal(none.flow.status, 'none');
  assert.equal(none.flow.count, 0);
  assert.equal(none.flow.problem, '2단계 버스트를 쓴 니케가 없어 풀 버스트가 한 번도 열리지 않았다(1단계까지만 이어졌다).');
  assert.equal(stalled.status, 'read', JSON.stringify(stalled.error ?? stalled.reasons ?? null));
  assert.equal(stalled.flow.status, 'stalled', JSON.stringify(stalled.flow.stalls));
  assert.ok(stalled.flow.stalls.every((s) => s.stage === '3' && s.wait >= 1));
  assert.match(stalled.flow.problem, /3단계를 [\d.]+초 기다렸다/);
  assert.equal(report.comparison.count_delta, stalled.flow.count);
});

test('실제 엔진: 버스트 보기는 총딜 계산과 같은 요청이다 — 요청 길이가 명령줄 한도 안이고, 엔진이 받는다', async () => {
  const { request } = squadRequest({ members: DECK }, account, condition);
  assert.ok(JSON.stringify(request).length < VIEW_REQUEST_MAX_CHARS / 2, `요청 ${JSON.stringify(request).length}자`);
  // 장비·오버로드까지 적은 큰 계정의 요청도 한도 안이다.
  const big = squadRequest({ members: ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'] }, large, condition).request;
  assert.ok(JSON.stringify(big).length < VIEW_REQUEST_MAX_CHARS, `요청 ${JSON.stringify(big).length}자`);

  const [row, bad, notObject] = await runViews([{ ...request, sim: { ...request.sim, duration: 20 } }, { squad: ['없는 니케'] }, 'request.json'], 'burst');
  const parsed = parseBurstView(row.text, { members: DECK });
  assert.equal(parsed.found, true);
  assert.deepEqual(parsed.unread, []);
  assert.equal(parsed.events[0].t, 3);
  // 입력 오류는 그 건만 오류다(엔진의 말을 그대로 싣는다).
  assert.equal(bad.error.type, 'invalid_input');
  assert.ok(bad.error.message.includes('없는 니케'));
  // 객체가 아닌 요청은 엔진에 넘기지 않는다(파일 경로로 읽히지 않게).
  assert.equal(notObject.error.type, 'invalid_input');
  await assert.rejects(() => runViews([request], 'hits'), /돌릴 수 없는 보기다/);

  // 같은 요청의 총딜 계산도 그대로 된다(편성 비교의 요청 만들기를 함수로 뺐다).
  const compared = await compareSquads({ account, condition: { ...condition, duration: 20 }, squads: [{ members: DECK }] }, { runtime: nodeRuntime });
  assert.equal(compared.ranking.length, 1);
  assert.ok(compared.ranking[0].total_damage > 0);
});
