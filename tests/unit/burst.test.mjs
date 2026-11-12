// 버스트 흐름(P-032)의 순수 함수: 엔진의 버스트 보기 글 읽기, 요약(횟수·평균 주기·첫 버스트·단계별 사용자), 돌지 않는 편성의 판정,
// 두 편성 견주기, 엔진 요청과 결과 문서. 엔진은 부르지 않는다 — 글은 실제 엔진의 출력 모양을 그대로 옮긴 것이다
// (실제 엔진으로는 tests/integration/burst.engine.test.mjs가 본다).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { BURST_VIEW, burstReport, compareFlows, durationText, parseBurstView, secondsText, STALL_GAP_SECONDS, summarizeBurst } from '../../src/core/burst.mjs';
import { compareSquads, InputError } from '../../src/core/compare.mjs';
import { loadCatalog } from '../../src/runtime/node.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const account = read('data/samples/account.sample.json');
const condition = read('data/samples/condition.solo-raid.json');
const catalog = loadCatalog();
const DECK = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];

const line = (t, what) => `  t=${t.toFixed(3).padStart(7)}s  ${what}`;
/** 엔진의 출력 모양: 머리말(스쿼드·이탈 보고) + 빈 줄 + [버스트 사이클] + 줄들. */
const view = (rows) => ['스쿼드: 가, 나, 다  (기대값 모드 — 크리·코어히트 무작위 없음, 결정론적)', '기본 스펙(1층) 그대로 — 컨트롤 자동 · 공통 장비 옵션.', '', '[버스트 사이클]', ...rows, ''].join('\n');

/** 풀 버스트 하나: 1→2→3단계를 0.1초 간격으로 쓰고 0.383초 뒤 열려 `length`초 뒤 닫힌다. */
function cycle(t, [b1, b2, b3], length = 10) {
  return [
    line(t, `stage:1 사용  ${b1}`),
    line(t + 0.1, `stage:2 사용  ${b2}`),
    line(t + 0.2, `stage:3 사용  ${b3}`),
    line(t + 0.583, 'full_burst 시작'),
    line(t + 0.583 + length, 'full_burst 종료'),
  ];
}

test('글 읽기: 버스트 사용(단계·이름)과 풀 버스트 시작·종료를 엔진이 적은 시각 그대로 옮긴다', () => {
  const parsed = parseBurstView(view(cycle(3, ['리틀 머메이드', '크라운', '라피 : 레드 후드'])), { members: DECK });
  assert.equal(parsed.found, true);
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(parsed.events, [
    { t: 3, kind: 'use', stage: '1', name: '리틀 머메이드', reenter: false },
    { t: 3.1, kind: 'use', stage: '2', name: '크라운', reenter: false },
    // 이름에 콜론과 공백이 있어도 통째로 읽는다.
    { t: 3.2, kind: 'use', stage: '3', name: '라피 : 레드 후드', reenter: false },
    { t: 3.583, kind: 'full_burst_start' },
    { t: 13.583, kind: 'full_burst_end' },
  ]);
});

test('글 읽기: 재진입(reenter)은 표시해 두고, 게이지·카메라 줄은 흐름에 쓰지 않으며, 모르는 줄과 편성에 없는 이름은 버리지 않고 남긴다', () => {
  const text = view([
    line(0, '카메라 초점: 헬름'),
    line(3, 'stage:1 사용  리틀 머메이드'),
    line(15, '게이지 만충 100.0% → 1단계 진입 (소모)'),
    line(43, 'reenter:1 사용  리틀 머메이드'),
    line(44, 'stage:2 사용  없는 니케'),
    line(45, '새로운 사건'),
    '  형식이 다른 줄',
  ]);
  const parsed = parseBurstView(text, { members: DECK });
  assert.deepEqual(
    parsed.events.map((e) => [e.t, e.kind, e.reenter ?? null]),
    [
      [0, 'note', null],
      [3, 'use', false],
      [15, 'note', null],
      [43, 'use', true],
    ],
  );
  assert.equal(parsed.unread.length, 3);
  assert.ok(parsed.unread[0].includes('없는 니케') && parsed.unread[1].includes('새로운 사건') && parsed.unread[2] === '형식이 다른 줄');
});

test('글 읽기: 버스트 사이클 머리줄이 없으면 「엔진이 주지 않았다」 — 다른 줄에서 지어내지 않는다', () => {
  for (const text of ['', '스쿼드: 가, 나\n\n[버스트 게이지 충전]\n  t=  0.000s →   2.983s  ( 2.98초,  89.62%)', null, undefined]) {
    assert.deepEqual(parseBurstView(text), { found: false, events: [], unread: [] });
  }
  // 머리줄만 있고 줄이 없으면 버스트가 없었던 것이다.
  assert.deepEqual(parseBurstView('[버스트 사이클]\n'), { found: true, events: [], unread: [] });
});

const flowOf = (rows, duration = 180, members = DECK) => summarizeBurst(parseBurstView(view(rows), { members }).events, { duration, members });

test('요약: 풀 버스트 횟수, 평균 주기, 첫 버스트까지의 시간, 단계별로 누가 썼는지 — 단위는 초', () => {
  // 20초마다 아홉 번(3초·23초·…·163초에 1단계). 3단계는 라피와 헬름이 번갈아 쓴다.
  const rows = [];
  for (let i = 0; i < 9; i += 1) rows.push(...cycle(3 + 20 * i, ['리틀 머메이드', '크라운', i % 2 === 0 ? '라피 : 레드 후드' : '헬름']));
  const flow = flowOf(rows);
  assert.equal(flow.count, 9);
  assert.equal(flow.average_period, 20);
  assert.equal(flow.first_use_at, 3);
  assert.equal(flow.first_at, 3.583);
  assert.equal(flow.headline, '3분 동안 풀 버스트 9번, 평균 20초마다');
  assert.equal(flow.status, 'ok');
  assert.equal(flow.problem, null);
  assert.equal(flow.uptime_seconds, 90);
  assert.equal(flow.uptime_ratio, 0.5);
  assert.deepEqual(flow.by_stage, {
    1: [{ name: '리틀 머메이드', count: 9 }],
    2: [{ name: '크라운', count: 9 }],
    3: [
      { name: '라피 : 레드 후드', count: 5 },
      { name: '헬름', count: 4 },
    ],
  });
  // 니케별 줄은 자리 순서대로이고, 버스트를 쓰지 않은 니케도 빈 줄로 있다.
  assert.deepEqual(flow.by_member.map((m) => [m.name, m.count, m.stages]), [
    ['리틀 머메이드', 9, ['1']],
    ['크라운', 9, ['2']],
    ['라피 : 레드 후드', 5, ['3']],
    ['헬름', 4, ['3']],
    ['앨리스', 0, []],
  ]);
  assert.deepEqual(flow.by_member[3].uses[0], { t: 23.2, stage: '3', reenter: false });
  const first = flow.full_bursts[0];
  assert.deepEqual([first.index, first.start, first.end, first.open, first.chain_start, first.wait, first.waited_for], [1, 3.583, 13.583, false, 3, 0.1, null]);
  assert.deepEqual(first.users.map((u) => u.name), ['리틀 머메이드', '크라운', '라피 : 레드 후드']);
});

test('요약: 끝까지 닫히지 않은 풀 버스트는 전투가 끝날 때까지 열려 있던 것으로 세고, 한 번뿐이면 평균 주기는 모른다', () => {
  const rows = cycle(170, ['리틀 머메이드', '크라운', '헬름']).slice(0, 4);
  const flow = flowOf(rows);
  assert.equal(flow.count, 1);
  assert.equal(flow.average_period, null);
  assert.equal(flow.headline, '3분 동안 풀 버스트 1번');
  assert.deepEqual([flow.full_bursts[0].end, flow.full_bursts[0].open], [null, true]);
  assert.equal(flow.uptime_seconds, 9.417);
});

test('돌지 않는 편성: 단계가 빠지면 풀 버스트가 한 번도 열리지 않는다 — 어느 단계가 없는지 한 문장으로', () => {
  const noStage2 = flowOf([line(3, 'stage:1 사용  리틀 머메이드')]);
  assert.equal(noStage2.status, 'none');
  assert.equal(noStage2.count, 0);
  assert.equal(noStage2.first_at, null);
  assert.equal(noStage2.headline, '3분 동안 풀 버스트가 한 번도 열리지 않았다');
  assert.equal(noStage2.problem, '2단계 버스트를 쓴 니케가 없어 풀 버스트가 한 번도 열리지 않았다(1단계까지만 이어졌다).');
  assert.equal(noStage2.pending.length, 1);

  const noStage3 = flowOf([line(3, 'stage:1 사용  리틀 머메이드'), line(3.1, 'stage:2 사용  크라운')]);
  assert.equal(noStage3.problem, '3단계 버스트를 쓴 니케가 없어 풀 버스트가 한 번도 열리지 않았다(1·2단계까지만 이어졌다).');

  const nobody = flowOf([]);
  assert.equal(nobody.status, 'none');
  assert.equal(nobody.problem, '버스트를 쓴 니케가 없다 — 풀 버스트가 한 번도 열리지 않았다.');
});

test('돌지 않는 편성: 쿨타임이 맞지 않아 다음 단계를 기다리면 「늦었다」 — 기준은 버스트 사이 1초', () => {
  assert.equal(STALL_GAP_SECONDS, 1);
  // 실제 엔진이 낸 모양: 3단계가 한 명뿐이라 2단계 뒤에 3단계를 14.6초·11.9초 기다린다.
  const rows = [
    ...cycle(3, ['리틀 머메이드', '크라운', '라피 : 레드 후드']),
    line(15.583, 'stage:1 사용  리틀 머메이드'),
    line(15.683, 'stage:2 사용  크라운'),
    line(30.267, 'stage:3 사용  라피 : 레드 후드'),
    line(30.65, 'full_burst 시작'),
    line(40.65, 'full_burst 종료'),
    line(42.65, 'stage:1 사용  리틀 머메이드'),
    line(42.75, 'stage:2 사용  크라운'),
    line(54.633, 'stage:3 사용  라피 : 레드 후드'),
    line(55.017, 'full_burst 시작'),
    line(65.017, 'full_burst 종료'),
  ];
  const flow = flowOf(rows, 70);
  assert.equal(flow.status, 'stalled');
  assert.deepEqual(flow.stalls, [
    { index: 2, wait: 14.584, stage: '3' },
    { index: 3, wait: 11.883, stage: '3' },
  ]);
  assert.equal(flow.problem, '풀 버스트 3번 가운데 2번은 다음 버스트가 1초 넘게 늦었다 — 가장 길게는 3단계를 14.6초 기다렸다. 버스트 쿨타임이 맞지 않는 것으로 보인다.');
  assert.deepEqual(flow.full_bursts[1].waited_for, { stage: '3', reenter: false });
  assert.equal(flow.headline, '1분 10초 동안 풀 버스트 3번, 평균 25.7초마다');

  // 재진입을 기다린 경우(실제 엔진: 1단계 쿨타임 40초).
  const reenter = flowOf([
    line(3, 'stage:1 사용  리틀 머메이드'),
    line(43, 'reenter:1 사용  리틀 머메이드'),
    line(43.1, 'stage:2 사용  크라운'),
    line(43.2, 'stage:3 사용  헬름'),
    line(43.583, 'full_burst 시작'),
    line(53.583, 'full_burst 종료'),
  ]);
  assert.equal(reenter.status, 'stalled');
  assert.deepEqual(reenter.stalls, [{ index: 1, wait: 40, stage: '1' }]);
  assert.equal(reenter.by_member[0].uses[1].reenter, true);
});

test('두 편성 견주기: 횟수·평균 주기·첫 풀 버스트가 어떻게 다른지만 말한다(어느 쪽이 낫다고 하지 않는다)', () => {
  const nine = [];
  for (let i = 0; i < 9; i += 1) nine.push(...cycle(3 + 20 * i, ['리틀 머메이드', '크라운', '헬름']));
  const seven = [];
  for (let i = 0; i < 7; i += 1) seven.push(...cycle(5 + 25 * i, ['리틀 머메이드', '크라운', '헬름']));
  const a = flowOf(nine);
  const b = flowOf(seven);
  assert.deepEqual(compareFlows(a, b), { count_delta: -2, text: '풀 버스트 9번 → 7번, 평균 주기 20초 → 25초, 첫 풀 버스트 3.6초 → 5.6초.' });
  assert.deepEqual(compareFlows(a, a), { count_delta: 0, text: '풀 버스트 횟수는 같다(9번), 평균 주기도 같다(20초).' });
  assert.equal(compareFlows(a, null), null);
  // 한쪽이 돌지 않으면 주기는 말하지 않는다.
  assert.equal(compareFlows(a, flowOf([])).text, '풀 버스트 9번 → 0번.');
});

test('표기: 전투 시간과 초', () => {
  assert.deepEqual([180, 90, 20, 60, 0].map(durationText), ['3분', '1분 30초', '20초', '1분', '0초']);
  assert.deepEqual([20, 12.53, 24.96, 0.04].map(secondsText), ['20', '12.5', '25', '0']);
  assert.equal(durationText(NaN), '–');
});

// ── 결과 문서 ─────────────────────────────────────────────────────────────────

const SAMPLE_TEXT = view([...cycle(3, DECK.slice(0, 3)), ...cycle(23, DECK.slice(0, 3))]);

test('결과 문서: 편성마다 엔진의 버스트 보기를 한 번 청한다 — 총딜 계산과 같은 요청이다', async () => {
  const seen = [];
  const sims = [];
  const deps = {
    catalog,
    now: () => new Date('2026-11-12T00:00:00Z'),
    runViews: async (requests, kind) => {
      seen.push({ requests, kind });
      return requests.map(() => ({ text: SAMPLE_TEXT }));
    },
    runBatch: async (requests) => {
      sims.push(...requests);
      return requests.map((r) => ({ total_damage: 1, members: r.squad.map((name) => ({ name, damage: 0, share: 0 })) }));
    },
  };
  const reordered = [DECK[0], DECK[1], DECK[3], DECK[2], DECK[4]];
  const report = await burstReport({ account, condition, squads: [{ name: '지금 편성', members: DECK }, { name: '자리 순서를 바꾼 편성', members: reordered }] }, deps);
  assert.equal(report.kind, 'burst_flow');
  assert.equal(report.schema_version, 1);
  assert.equal(report.generated_at, '2026-11-12T00:00:00.000Z');
  assert.equal(report.duration, 180);
  assert.deepEqual(report.source, { view: 'burst', stall_gap_seconds: 1 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, BURST_VIEW);
  assert.deepEqual(seen[0].requests.map((r) => r.squad), [DECK, reordered]);
  assert.deepEqual(report.lines.map((l) => [l.name, l.status, l.flow.count, l.flow.average_period]), [
    ['지금 편성', 'read', 2, 20],
    ['자리 순서를 바꾼 편성', 'read', 2, 20],
  ]);
  assert.equal(report.comparison.text, '풀 버스트 횟수는 같다(2번), 평균 주기도 같다(20초).');
  assert.ok(report.caveats.some((c) => c.includes('지원하지 않음')));
  assert.ok(report.caveats.some((c) => c.includes('이 앱의 규칙')));

  // 편성 비교가 엔진에 보내는 요청과 글자 하나 다르지 않다.
  await compareSquads({ account, condition, squads: [{ members: DECK }, { members: reordered }] }, deps);
  assert.deepEqual(seen[0].requests, sims);
});

test('결과 문서: 엔진 기본 스펙 편성도 같은 길이다 — 요청의 프로필이 다르다', async () => {
  let got = null;
  const deps = {
    catalog,
    runViews: async (requests) => {
      got = requests;
      return requests.map(() => ({ text: SAMPLE_TEXT }));
    },
  };
  const report = await burstReport({ account, condition, squads: [{ members: DECK, growth: 'engine_default' }] }, deps);
  assert.equal(got[0].profile.base, 'default');
  assert.deepEqual(got[0].profile.chars, {});
  assert.equal(report.lines[0].growth, 'engine_default');
  assert.equal(report.comparison, null);
});

test('결과 문서: 계산 전 검사에 걸린 편성·엔진이 실패한 편성·버스트 줄이 없는 출력은 흐름을 지어내지 않고 그렇게 적는다', async () => {
  const deps = {
    catalog,
    runViews: async (requests) =>
      requests.map((r) => {
        if (r.squad[4] === '앨리스') return { error: { type: 'invalid_input', message: '가짜 엔진 오류' } };
        if (r.squad[4] === '헬름') return { text: '스쿼드: …\n\n[다른 보기]\n' };
        return { text: `${SAMPLE_TEXT}\n  t= 50.000s  처음 보는 사건\n` };
      }),
  };
  const report = await burstReport(
    {
      account,
      condition,
      squads: [
        { name: '네 명', members: DECK.slice(0, 4) },
        { name: '엔진 실패', members: DECK },
        { name: '줄 없음', members: [DECK[0], DECK[1], DECK[2], DECK[4], DECK[3]] },
        { name: '모르는 줄', members: [DECK[0], DECK[1], DECK[4], DECK[3], DECK[2]] },
      ],
    },
    deps,
  );
  const [four, failed, none, odd] = report.lines;
  assert.equal(four.status, 'rejected');
  assert.ok(four.reasons[0].includes('5명'));
  assert.equal(four.flow, undefined);
  assert.deepEqual([failed.status, failed.error.message], ['failed', '가짜 엔진 오류']);
  assert.deepEqual([none.status, none.error.type], ['failed', 'not_provided']);
  assert.ok(none.error.message.includes('엔진이 이 정보를 주지 않았다'));
  assert.equal(odd.status, 'read');
  assert.equal(odd.unread.length, 1);
  assert.ok(report.caveats.at(-1).includes('뜻을 모르는 줄 1개'));
  assert.equal(report.comparison, null);
});

test('결과 문서: 버스트 보기를 돌리지 못하는 런타임이면 던진다 — 빈 흐름을 내지 않는다', async () => {
  await assert.rejects(() => burstReport({ account, condition, squads: [{ members: DECK }] }, { catalog, runtime: { loadCatalog: () => catalog } }), /버스트 흐름을 읽을 수 없다/);
  await assert.rejects(() => burstReport({ account, condition, squads: [] }, { catalog, runViews: async () => [] }), InputError);
  await assert.rejects(() => burstReport({ account, condition, squads: [{ members: DECK }] }, { catalog, runViews: async () => [] }), /결과 0건/);
});
