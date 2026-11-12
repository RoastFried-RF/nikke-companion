// 즐겨찾기·「안 씀」과 계정 여러 개(P-033)의 순수 함수: 표시 켜고 끄기·거르기, 추천에서 빼기(뺐다는 사실이 결과에 남는다), 계정을 바꾸는 칸.
// 엔진은 가짜다(멤버에서 정해지는 값). 실제 엔진으로는 tests/integration/exclude.engine.test.mjs가 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ACCOUNT_FILES, accountChoices, accountFiles } from '../../src/core/accounts.mjs';
import { suggestSquads } from '../../src/core/candidates.mjs';
import { InputError } from '../../src/core/compare.mjs';
import { EXCLUDE_REASONS, excludeNikkes, isExcludeList } from '../../src/core/exclude.mjs';
import { recommendIntercept } from '../../src/core/intercept.mjs';
import { emptyPlan, MARK_FILTERS, markOf, passesMark, pickCore, readPlan, toggleFavorite, toggleUnused, unusedOwned } from '../../src/core/plan.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const account = read('data/samples/account.sample.json');
const condition = read('data/samples/condition.solo-raid.json');
const bundle = read('data/samples/bosses.anomaly.sample.json');

/** 가짜 엔진: 니케마다 정해 둔 딜의 합. 카탈로그는 샘플 계정의 여덟 명(버스트 1·2·3단계가 고루 있다). */
const BURST = { '리틀 머메이드': '1', 프리카: '1', 미하라: '1', 크라운: '2', 나가: '2', '라피 : 레드 후드': '3', 헬름: '3', 앨리스: '3' };
const DAMAGE = { '리틀 머메이드': 9, 프리카: 2, 미하라: 1, 크라운: 3, 나가: 2, '라피 : 레드 후드': 8, 헬름: 4, 앨리스: 7 };
const catalog = { nikkes: Object.fromEntries(Object.keys(BURST).map((name) => [name, { burst_stage: BURST[name], element_code: '작열', weapon_type: 'AR' }])), bosses: ['솔로 레이드 S40'] };
const seen = [];
const runtime = {
  loadCatalog: async () => catalog,
  engineVersion: async () => ({ repo: '가짜', commit: 'abc' }),
  runBatch: async (requests) => {
    seen.push(...requests.map((r) => r.squad));
    return requests.map((r, id) => ({
      id,
      total_damage: r.squad.reduce((s, n) => s + DAMAGE[n], 0) * 1_000_000,
      members: r.squad.map((name) => ({ name, damage: DAMAGE[name] * 1_000_000 })),
    }));
  },
};

test('표시: 즐겨찾기와 「안 씀」은 함께 붙지 않는다 — 받은 문서는 바꾸지 않는다', () => {
  const start = Object.freeze({ ...emptyPlan(), favorites: Object.freeze(['크라운']), unused: Object.freeze([]) });
  const idle = toggleUnused(start, '나가');
  assert.deepEqual(idle.unused, ['나가']);
  assert.deepEqual(idle.favorites, ['크라운']);
  assert.deepEqual(start.unused, []);
  assert.equal(markOf(idle, '나가'), 'unused');
  assert.equal(markOf(idle, '크라운'), 'favorite');
  assert.equal(markOf(idle, '헬름'), null);
  assert.equal(markOf(null, '헬름'), null);

  // 즐겨찾기인 니케를 「안 씀」으로 표시하면 즐겨찾기가 내려간다. 그 반대도 같다.
  const swapped = toggleUnused(idle, '크라운');
  assert.deepEqual(swapped.unused, ['나가', '크라운']);
  assert.deepEqual(swapped.favorites, []);
  const back = toggleFavorite(swapped, '크라운');
  assert.deepEqual(back.favorites, ['크라운']);
  assert.deepEqual(back.unused, ['나가']);
  // 다시 누르면 꺼진다.
  assert.deepEqual(toggleUnused(back, '나가').unused, []);
  assert.deepEqual(toggleFavorite(back, '크라운').favorites, []);
  // 예전 문서(unused 칸이 없다)에도 표시할 수 있다.
  const old = { schema_version: 1, kind: 'intercept_plan', favorites: ['헬름'], records: [] };
  assert.deepEqual(toggleUnused(old, '나가').unused, ['나가']);
  assert.deepEqual(toggleFavorite(old, '크라운').unused, []);
  assert.equal(markOf(old, '나가'), null);

  // 디스크를 다녀와도 같고, 예전 문서는 빈 목록으로 읽는다. 둘 다 적힌 이름은 즐겨찾기로 읽는다(빼는 쪽이 아니라 남기는 쪽).
  assert.deepEqual(readPlan(JSON.parse(JSON.stringify(swapped))).plan, swapped);
  assert.deepEqual(readPlan(old).plan.unused, []);
  const both = readPlan({ ...old, unused: ['헬름', '나가', '나가', '', 3] });
  assert.deepEqual(both.plan.unused, ['나가']);
  assert.deepEqual(both.plan.favorites, ['헬름']);
  assert.equal(both.dropped, 3);
});

test('거르기: 즐겨찾기만 · 안 씀만 · 안 씀 빼고', () => {
  const plan = { ...emptyPlan(), favorites: ['크라운'], unused: ['나가', '미하라'] };
  const names = Object.keys(account.nikkes);
  const kept = (filter) => names.filter((n) => passesMark(plan, n, filter));
  assert.deepEqual(kept('favorite'), ['크라운']);
  assert.deepEqual(kept('unused'), ['미하라', '나가']);
  assert.deepEqual(kept('active'), ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스', '프리카']);
  assert.deepEqual(kept(''), names);
  assert.deepEqual(kept('모르는 낱말'), names);
  assert.deepEqual(Object.keys(MARK_FILTERS), ['favorite', 'unused', 'active']);
  assert.equal(MARK_FILTERS.active, '안 씀 빼고');
  // 추천에서 뺄 목록은 그 계정이 가진 이름만이다(계정에 적힌 순서).
  assert.deepEqual(unusedOwned({ ...plan, unused: ['나가', '없는 니케', '미하라'] }, account), ['미하라', '나가']);
  assert.deepEqual(unusedOwned(emptyPlan(), account), []);
  assert.deepEqual(unusedOwned(plan, null), []);
  // 「안 씀」 니케는 많이 키웠어도 주력으로 어림하지 않는다(기준이 육성 점수일 때).
  const core = pickCore({ account, unused: ['리틀 머메이드'], limit: 3 });
  assert.equal(core.basis, 'score');
  assert.ok(!core.names.includes('리틀 머메이드'));
  assert.ok(pickCore({ account, limit: 3 }).names.includes('리틀 머메이드'));
});

test('추천에서 빼기: 뺀 사본과 뺐다는 사실 — 계정은 바뀌지 않는다', () => {
  const frozen = JSON.parse(JSON.stringify(account));
  const cut = excludeNikkes(account, ['나가', '없는 니케', '앨리스']);
  assert.deepEqual(account, frozen);
  assert.deepEqual(Object.keys(cut.account.nikkes), ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '미하라', '프리카']);
  assert.equal(cut.account.name, account.name);
  assert.deepEqual(cut.excluded, {
    reason: 'unused',
    label: '안 씀',
    names: ['앨리스', '나가'], // 계정에 적힌 순서
    count: 2,
    text: '「안 씀」으로 표시한 니케 2명을 빼고 계산했다: 앨리스, 나가.',
  });
  assert.equal(EXCLUDE_REASONS.unused, '안 씀');
  // 뺀 것이 없으면 받은 계정 그대로이고 기록도 없다.
  for (const none of [[], ['없는 니케'], undefined, '나가', [3]]) {
    const same = excludeNikkes(account, none);
    assert.equal(same.account, account);
    assert.equal(same.excluded, null);
  }
  assert.equal(excludeNikkes(null, ['나가']).excluded, null);
  assert.ok(isExcludeList(['나가']) && isExcludeList([]));
  for (const bad of ['나가', [''], [3], null, { 나가: true }]) assert.ok(!isExcludeList(bad));
});

test('편성 추천: 뺀 니케는 어느 편성에도 없고, 뺐다는 사실이 결과에 남는다 — 빼지 않으면 결과가 종전과 같다', async () => {
  const plain = await suggestSquads({ account, condition }, { refine: false }, { runtime });
  assert.ok(!Object.hasOwn(plain, 'excluded'));
  assert.ok(plain.ranking.some((r) => r.members.some((m) => m.name === '앨리스')), '빼지 않으면 앨리스가 든 편성이 있다');
  assert.ok(!plain.caveats.some((c) => c.includes('안 씀')));

  seen.length = 0;
  const cut = await suggestSquads({ account, condition }, { refine: false, exclude: ['앨리스', '없는 니케'] }, { runtime });
  assert.deepEqual(cut.excluded.names, ['앨리스']);
  assert.equal(cut.excluded.count, 1);
  assert.equal(cut.caveats.at(-1), '「안 씀」으로 표시한 니케 1명을 빼고 계산했다: 앨리스.');
  assert.ok(seen.length > 0 && seen.every((squad) => !squad.includes('앨리스')), '계산 도구에 넘긴 편성에도 없다');
  assert.ok(cut.ranking.every((r) => r.members.every((m) => m.name !== '앨리스')));
  assert.ok(cut.ranking[0].total_damage < plain.ranking[0].total_damage);

  // 빈 목록·가진 니케가 없는 목록은 빼지 않은 것과 같다(칸도 생기지 않는다).
  for (const none of [[], ['없는 니케']]) {
    const same = await suggestSquads({ account, condition }, { refine: false, exclude: none }, { runtime });
    assert.ok(!Object.hasOwn(same, 'excluded'));
    assert.deepEqual(same.ranking, plain.ranking);
    assert.deepEqual(same.caveats, plain.caveats);
  }
  // 목록의 모양이 틀리면 입력 오류다.
  await assert.rejects(suggestSquads({ account, condition }, { exclude: '앨리스' }, { runtime }), (e) => e instanceof InputError && e.errors[0].path === '/exclude');
  // 다 빼면 편성을 만들 수 없다 — 0으로 채우지 않고 입력 오류로 말한다.
  await assert.rejects(suggestSquads({ account, condition }, { exclude: Object.keys(account.nikkes) }, { runtime }), InputError);
});

test('요격전 추천: 모든 보스에서 빼고, 결과 문서에 한 번 남는다', async () => {
  const plain = await recommendIntercept({ account, bundle }, { budget: 10 }, { runtime });
  assert.ok(!Object.hasOwn(plain, 'excluded'));

  const cut = await recommendIntercept({ account, bundle }, { budget: 10, exclude: ['리틀 머메이드'] }, { runtime });
  assert.deepEqual(cut.excluded, {
    reason: 'unused',
    label: '안 씀',
    names: ['리틀 머메이드'],
    count: 1,
    text: '「안 씀」으로 표시한 니케 1명을 빼고 계산했다: 리틀 머메이드.',
  });
  assert.equal(cut.caveats.at(-1), cut.excluded.text);
  const computed = cut.bosses.filter((b) => b.status === 'computed');
  assert.ok(computed.length > 0);
  for (const boss of computed) {
    assert.ok(boss.ranking.length > 0, boss.name);
    assert.ok(boss.ranking.every((r) => r.members.every((m) => m.name !== '리틀 머메이드')), boss.name);
  }
  assert.ok(plain.bosses.some((b) => b.ranking.some((r) => r.members.some((m) => m.name === '리틀 머메이드'))));
  await assert.rejects(recommendIntercept({ account, bundle }, { exclude: [3] }, { runtime }), (e) => e instanceof InputError && e.errors[0].path === '/exclude');
});

test('계정 여러 개: 바꾸는 칸은 고를 계정이 둘 이상일 때만 보이고, 계산 중에는 잠긴다', () => {
  const two = { default_account: 'main', accounts: [{ name: 'main', modified_at: '2026-11-12T06:00:00.000Z' }, { name: 'sub', modified_at: null }], hidden_accounts: [{ name: 'old', modified_at: null }] };
  const choices = accountChoices(two);
  assert.equal(choices.show, true);
  assert.equal(choices.current, 'main');
  assert.deepEqual(choices.accounts, [
    { name: 'main', modified_at: '2026-11-12T06:00:00.000Z', current: true },
    { name: 'sub', modified_at: null, current: false },
  ]);
  assert.deepEqual(choices.hidden, [{ name: 'old', modified_at: null }]);
  assert.equal(choices.needs_choice, false);
  assert.equal(choices.locked, false);
  assert.equal(choices.locked_reason, null);

  const busy = accountChoices(two, { computing: true });
  assert.equal(busy.locked, true);
  assert.match(busy.locked_reason, /계산이 도는 동안에는 계정을 바꾸지 않는다/);

  // 계정이 하나뿐이면 바꾸는 칸이 없다(숨긴 계정은 세지 않는다).
  assert.equal(accountChoices({ default_account: 'main', accounts: [{ name: 'main' }], hidden_accounts: [{ name: 'sub' }] }).show, false);
  // 여럿인데 고르지 않았으면 고르라고 알린다.
  const open = accountChoices({ default_account: null, accounts: [{ name: 'main' }, { name: 'sub' }] });
  assert.equal(open.needs_choice, true);
  assert.equal(open.current, null);
  assert.deepEqual(open.hidden, []);
  // 아직 모르는 상태(null)에서도 죽지 않는다.
  assert.deepEqual(accountChoices(null), { current: null, accounts: [], hidden: [], show: false, needs_choice: false, locked: false, locked_reason: null });
});

test('계정을 지우려는 사람에게 알려 줄 것: 계정마다 따로 두는 것들의 이름', () => {
  assert.deepEqual(accountFiles('sub').map((f) => f.name), ['sub.json', 'sub.intercept.json', 'sub.plan.json', 'sub.decks.json', 'sub.json.bak']);
  assert.ok(accountFiles('sub').every((f) => f.label.length > 0));
  assert.equal(ACCOUNT_FILES.length, 5);
});
