// 요격전(이상 개체) 보스별 편성 추천 — 형식 검사, 약점·속성 대조와 변환, 예산 나누기, 미확인 표시, 결정론.
// 엔진은 가짜다: 적 속성에 우월한 니케의 딜이 커지고, 레벨이 낮으면 딜이 줄어든다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateAccount, toEngineProfile } from '../../src/core/account.mjs';
import { generateCandidates } from '../../src/core/candidates.mjs';
import { compareSquads, InputError } from '../../src/core/compare.mjs';
import { CONTENTS, validateCondition, levelPlan, toEngineBase, assumptionsOf, levelCaveats } from '../../src/core/condition.mjs';
import {
  recommendIntercept, validateBossBundle, resolveElement, bossCondition, unconfirmedOf, splitBudget, selectBosses,
  codeWeakTo, weaknessOf, ELEMENT_ADVANTAGE, ELEMENTS, ENGINE_ENEMY_DEFAULTS, TRACKED_FIELDS,
  DEFAULT_INTERCEPT_TOP, DEFAULT_INTERCEPT_BUDGET,
} from '../../src/core/intercept.mjs';
import { renderInterceptReport } from '../../src/core/render.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const REAL = readJson('data/intercept/anomaly.json');
const SAMPLE = readJson('data/samples/bosses.anomaly.sample.json');
const TRACKED = Object.keys(TRACKED_FIELDS);

// ── 가짜 카탈로그·계정·엔진 ────────────────────────────────────────────────────
const nikke = (stage, element) => ({ burst_stage: stage, element_code: element, weapon_type: 'AR', is_charge: false });
const catalog = {
  nikkes: {
    일작: nikke('1', '작열'), 일풍: nikke('1', '풍압'),
    이철: nikke('2', '철갑'), 이전: nikke('2', '전격'),
    삼수: nikke('3', '수냉'), 삼작: nikke('3', '작열'), 삼풍: nikke('3', '풍압'), 삼철: nikke('3', '철갑'), 삼전: nikke('3', '전격'),
  },
  bosses: ['솔로 보스'],
};
const grown = (skill) => ({ skill_levels: [skill, skill, skill] });
const accountOf = (extra = {}) => ({
  schema_version: 1,
  is_test_data: true,
  name: '가짜 계정',
  nikkes: { 일작: grown(10), 일풍: grown(9), 이철: grown(10), 이전: grown(9), 삼수: grown(10), 삼작: grown(9), 삼풍: grown(8), 삼철: grown(7), 삼전: grown(6) },
  ...extra,
});
const account = accountOf();
const now = () => new Date('2026-11-12T00:00:00Z');

/**
 * 가짜 엔진. 멤버 딜 = 1000 × (적 속성에 우월하면 2) × 레벨/400 × 전투 시간/180 × 31784/방어력.
 * 요청마다 무엇을 받았는지 `log`에 남긴다.
 */
function fakeEngine(log = [], cat = catalog) {
  return async (requests) => {
    log.push(...requests);
    return requests.map((req) => {
      const code = req.enemy?.code ?? null;
      const level = req.profile_level === 'sync' ? req.profile._account.synchro_level : 400;
      const def = req.enemy?.def ?? 31784;
      const members = req.squad.map((name) => {
        const superior = code !== null && ELEMENT_ADVANTAGE[cat.nikkes[name].element_code] === code;
        return { name, damage: Math.round(1000 * (superior ? 2 : 1) * (level / 400) * (req.sim.duration / 180) * (31784 / def)) };
      });
      const total = members.reduce((s, m) => s + m.damage, 0);
      return {
        total_damage: total,
        members: members.map((m) => ({ ...m, share: m.damage / total })),
        warnings: [],
        spec: { profile: { ungrown: [] } },
        evaluator: { repo: 'fake', commit: 'abc', dirty: false },
      };
    });
  };
}
const depsOf = (log) => ({ catalog, runBatch: fakeEngine(log), now });
const errorAt = (result, pathPrefix) => result.errors.filter((e) => e.path.startsWith(pathPrefix));
const clone = (v) => structuredClone(v);
/** 샘플 묶음을 고쳐서 검사한다. */
const mutated = (fn) => {
  const b = clone(SAMPLE);
  fn(b);
  return validateBossBundle(b);
};

// ── 전투 조건·계정: 요격전 종류와 레벨 상한 ─────────────────────────────────────

test('조건 content에 요격전 종류가 더해졌고, 기존 조건은 그대로 통과한다', () => {
  assert.ok(CONTENTS.includes('anomaly_interception') && CONTENTS.includes('interception'));
  for (const content of ['solo_raid', 'union_raid', 'custom', 'anomaly_interception', 'interception']) {
    assert.equal(validateCondition({ schema_version: 1, content }, catalog).ok, true, content);
  }
  const solo = readJson('data/samples/condition.solo-raid.json');
  assert.equal(validateCondition(solo, { nikkes: {}, bosses: [solo.boss] }).ok, true);
  assert.equal(validateCondition({ schema_version: 1, content: 'raid' }, catalog).ok, false);
  // 레벨 상한: 1~1000의 정수.
  assert.equal(validateCondition({ schema_version: 1, content: 'anomaly_interception', level_cap: 400 }, catalog).ok, true);
  for (const bad of [0, 1001, 399.5, '400', null]) {
    const r = validateCondition({ schema_version: 1, content: 'anomaly_interception', level_cap: bad }, catalog);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.errors[0].path, '/level_cap');
    assert.match(r.errors[0].message, /레벨 상한은 1~1000의 정수/);
  }
});

test('레벨 상한이 없는 조건은 종전 그대로 fixed(400) — 요청과 가정 문장이 바뀌지 않는다', () => {
  const condition = { schema_version: 1, content: 'solo_raid', boss: '솔로 보스' };
  const withSync = accountOf({ account: { synchro_level: 258 } });
  const plan = levelPlan(condition, withSync);
  assert.deepEqual(plan, { mode: 'fixed', level: 400, cap: null, synchro_level: null, assumed: false, engine_policy: 'fixed' });
  assert.deepEqual(toEngineBase(condition), { sim: { expected: true, duration: 180 }, profile_level: 'fixed', boss: '솔로 보스' });
  assert.deepEqual(toEngineBase(condition, plan), toEngineBase(condition));
  // 계정에 동기화 레벨이 있어도 상한 없는 조건의 프로필에는 싣지 않는다.
  assert.deepEqual(toEngineProfile(withSync, ['일작'], plan), toEngineProfile(withSync, ['일작']));
  assert.equal(toEngineProfile(withSync, ['일작'])._account, undefined);
  assert.ok(assumptionsOf(condition).includes('캐릭터 레벨은 엔진 정책 fixed(400)'));
  assert.deepEqual(assumptionsOf(condition, plan), assumptionsOf(condition));
  assert.deepEqual(levelCaveats(plan), []);
});

test('레벨 상한이 있는 조건: 계정의 동기화 레벨을 상한까지 반영하고, 모르면 상한으로 가정했다고 적는다', () => {
  const condition = { schema_version: 1, content: 'anomaly_interception', level_cap: 400 };
  // 동기화 레벨이 상한보다 낮다 → 그 레벨. 엔진 정책 sync에 실어 보낸다.
  const low = accountOf({ account: { synchro_level: 258 } });
  const lowPlan = levelPlan(condition, low);
  assert.deepEqual(lowPlan, { mode: 'cap', level: 258, cap: 400, synchro_level: 258, assumed: false, engine_policy: 'sync' });
  assert.equal(toEngineBase(condition, lowPlan).profile_level, 'sync');
  assert.deepEqual(toEngineProfile(low, ['일작'], lowPlan)._account, { synchro_level: 258 });
  assert.match(assumptionsOf(condition, lowPlan)[2], /캐릭터 레벨 258 — 계정의 동기화 레벨\(콘텐츠의 레벨 상한 400 이하/);
  assert.match(levelCaveats(lowPlan)[0], /편성 전원을 레벨 258\(동기화 레벨 258, 상한 400\)로 계산했다/);

  // 동기화 레벨이 상한보다 높다 → 상한. 400이면 엔진 정책 fixed와 같다.
  const high = accountOf({ account: { synchro_level: 512, console: { common_level: 100 } } });
  const highPlan = levelPlan(condition, high);
  assert.deepEqual(highPlan, { mode: 'cap', level: 400, cap: 400, synchro_level: 512, assumed: false, engine_policy: 'fixed' });
  assert.deepEqual(toEngineProfile(high, ['일작'], highPlan)._account, { console: { common_level: 100 } });
  assert.match(assumptionsOf(condition, highPlan)[2], /동기화 레벨 512에 콘텐츠의 레벨 상한 400을 적용/);
  // 상한이 400이 아니면 상한을 sync로 실어 보낸다.
  const cap200 = levelPlan({ ...condition, level_cap: 200 }, high);
  assert.equal(cap200.level, 200);
  assert.equal(cap200.engine_policy, 'sync');
  assert.deepEqual(toEngineProfile(high, ['일작'], cap200)._account, { console: { common_level: 100 }, synchro_level: 200 });

  // 동기화 레벨을 모른다 → 상한으로 가정. 지원하는 것처럼 말하지 않는다.
  const unknown = levelPlan(condition, account);
  assert.deepEqual(unknown, { mode: 'cap', level: 400, cap: 400, synchro_level: null, assumed: true, engine_policy: 'fixed' });
  assert.match(assumptionsOf(condition, unknown)[2], /레벨 상한 400으로 가정했다\(계정에 동기화 레벨 account\.synchro_level이 없다\)/);
  assert.match(levelCaveats(unknown)[0], /실제 레벨이 상한보다 낮으면 총딜이 실제보다 크게 나온다/);
});

test('계정 검사: account.synchro_level은 1~1000의 정수', () => {
  assert.equal(validateAccount(accountOf({ account: { synchro_level: 258 } }), catalog).ok, true);
  assert.equal(validateAccount(accountOf({ account: { console: {} } }), catalog).ok, true);
  for (const bad of [0, 1001, 258.5, '258', null]) {
    const r = validateAccount(accountOf({ account: { synchro_level: bad } }), catalog);
    assert.equal(r.ok, false, String(bad));
    assert.deepEqual(r.errors.map((e) => e.path), ['/account/synchro_level']);
    assert.match(r.errors[0].message, /동기화 레벨은 1~1000의 정수/);
  }
  assert.equal(validateAccount(accountOf({ account: [] }), catalog).errors[0].path, '/account');
});

test('compareSquads: 레벨 상한 조건이면 요청에 계정 레벨이 실리고 caveats에 한계가 적힌다', async () => {
  const squads = [{ name: 'A', members: ['일작', '이철', '삼수', '삼작', '삼풍'] }];
  const condition = { schema_version: 1, content: 'anomaly_interception', enemy: { code: '풍압' }, level_cap: 400 };
  const log = [];
  const low = await compareSquads({ account: accountOf({ account: { synchro_level: 200 } }), condition, squads }, depsOf(log));
  assert.equal(log[0].profile_level, 'sync');
  assert.equal(log[0].profile._account.synchro_level, 200);
  const assumed = await compareSquads({ account, condition, squads }, depsOf(log));
  assert.equal(log[1].profile_level, 'fixed');
  assert.equal(log[1].profile._account, undefined);
  assert.equal(low.ranking[0].total_damage * 2, assumed.ranking[0].total_damage, '레벨 200은 400의 절반(가짜 엔진)');
  assert.ok(assumed.caveats.some((c) => c.includes('동기화 레벨(account.synchro_level)이 없어 전원을 레벨 400으로 계산했다')));
  assert.ok(low.caveats.some((c) => c.includes('편성 전원을 레벨 200')));
});

// ── 속성 상성 ─────────────────────────────────────────────────────────────────

test('속성 상성 규칙: 작열 → 풍압 → 철갑 → 전격 → 수냉 → 작열(앞이 뒤에 우월)', () => {
  assert.deepEqual([...ELEMENTS].sort(), ['수냉', '작열', '전격', '철갑', '풍압']);
  const chain = ['작열', '풍압', '철갑', '전격', '수냉', '작열'];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(codeWeakTo(chain[i]), chain[i + 1], `${chain[i]}에 약한 속성`);
    assert.equal(weaknessOf(chain[i + 1]), chain[i], `${chain[i + 1]}의 약점`);
  }
  assert.equal(codeWeakTo('불'), null);
  assert.equal(weaknessOf('불'), null);
  assert.equal(codeWeakTo('constructor'), null, '객체의 내장 키를 속성으로 읽지 않는다');
});

test('resolveElement: 한쪽만 있으면 다른 쪽을 규칙으로 정하고, 둘 다 없으면 미반영', () => {
  assert.deepEqual(resolveElement({ enemy: { code: '풍압' }, weak_to: '작열' }), { code: '풍압', code_source: 'bundle', weak_to: '작열', weak_to_source: 'bundle', reflected: true });
  assert.deepEqual(resolveElement({ enemy: {}, weak_to: '수냉' }), { code: '작열', code_source: 'weak_to', weak_to: '수냉', weak_to_source: 'bundle', reflected: true });
  assert.deepEqual(resolveElement({ enemy: { code: '철갑' } }), { code: '철갑', code_source: 'bundle', weak_to: '풍압', weak_to_source: 'code', reflected: true });
  assert.deepEqual(resolveElement({ enemy: {} }), { code: null, code_source: null, weak_to: null, weak_to_source: null, reflected: false });
});

// ── 보스 묶음 형식 ────────────────────────────────────────────────────────────

test('실제 보스 묶음과 샘플 묶음은 검사를 통과한다', () => {
  const real = validateBossBundle(REAL);
  assert.deepEqual(real.errors, []);
  assert.deepEqual(real.warnings, [], '실제 묶음은 검증용이 아니다');
  const sample = validateBossBundle(SAMPLE);
  assert.deepEqual(sample.errors, []);
  assert.match(sample.warnings.join('\n'), /검증용 보스 묶음/);
});

test('실제 보스 묶음은 docs/intercept.md의 표를 그대로 옮겼다 — 문서에 없는 값은 넣지 않고 미확인으로 표시한다', () => {
  // 문서의 「이상 개체 요격전 — 보스 5종」 표를 읽는다: | 보스 | 보스 속성 | 약점 | 보상 | 화면 테마 색 |
  const doc = fs.readFileSync(path.join(ROOT, 'docs/intercept.md'), 'utf8');
  const section = doc.slice(doc.indexOf('### 이상 개체 요격전 — 보스 5종'), doc.indexOf('### 일반·특수 개체 요격전'));
  const rows = section.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.startsWith('| 보스 |'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  assert.equal(rows.length, 5);
  assert.match(section, /최대 레벨 400 제한/);

  assert.equal(REAL.is_test_data, false);
  assert.equal(REAL.content, 'anomaly_interception');
  assert.match(REAL.source, /docs\/intercept\.md/);
  assert.deepEqual(
    REAL.bosses.map((b) => [b.name, b.enemy.code, b.weak_to, b.reward]),
    rows.map(([name, code, weak, reward]) => [name, code, weak, reward]),
  );
  assert.deepEqual(REAL.bosses.map((b) => b.name), ['인디빌리아', '울트라', '하베스터', '크라켄', '미러 컨테이너']);
  for (const b of REAL.bosses) {
    assert.equal(b.level_cap, 400, b.name);
    assert.match(b.source, /docs\/intercept\.md/, b.name);
    // 확인한 것은 속성·약점·레벨 상한뿐이다. 방어력·코어·파츠·거리·전투 시간은 값이 없고 미확인으로 적혀 있다.
    assert.deepEqual(Object.keys(b.enemy), ['code'], b.name);
    assert.equal(b.duration, undefined, b.name);
    assert.deepEqual([...b.confirmation.confirmed].sort(), ['code', 'level_cap', 'weak_to'], b.name);
    assert.deepEqual([...b.confirmation.unconfirmed].sort(), ['core_px', 'def', 'distance', 'duration', 'has_parts', 'optimal_range_weapons', 'part_break_interval'], b.name);
    // 약점은 보스 속성에 우월한 속성이다(엔진의 속성 상성 규칙).
    assert.equal(codeWeakTo(b.weak_to), b.enemy.code, b.name);
    assert.equal(weaknessOf(b.enemy.code), b.weak_to, b.name);
    assert.equal(resolveElement(b).reflected, true);
  }
});

test('샘플 묶음: 검증용 표시, 보스 5개(시험 보스 A~E), 약점만 있는 보스와 속성 미상 보스가 있다', () => {
  assert.equal(SAMPLE.is_test_data, true);
  assert.deepEqual(SAMPLE.bosses.map((b) => b.name), ['A', 'B', 'C', 'D', 'E'].map((x) => `시험 보스 ${x}`));
  const elements = SAMPLE.bosses.map((b) => resolveElement(b));
  assert.deepEqual(elements.map((e) => e.code_source), ['bundle', 'bundle', 'weak_to', 'weak_to', null]);
  assert.deepEqual(elements.map((e) => e.code), ['풍압', '철갑', '작열', '수냉', null]);
});

test('형식 오류는 한국어 문장과 경로로 돌아온다', () => {
  assert.deepEqual(validateBossBundle(null), { ok: false, errors: [{ path: '', message: '보스 묶음은 객체여야 한다' }], warnings: [] });
  assert.deepEqual(validateBossBundle([]).errors[0].path, '');

  const top = mutated((b) => {
    b.schema_version = 2;
    b.content = 'solo_raid';
    delete b.is_test_data;
    b.source = ' ';
    b.extra = 1;
  });
  assert.equal(top.ok, false);
  assert.deepEqual(top.errors.map((e) => e.path).sort(), ['/content', '/extra', '/is_test_data', '/schema_version', '/source']);
  for (const e of top.errors) assert.match(e.message, /[가-힣]/, `${e.path}: 한국어 문장이어야 한다`);
  assert.match(errorAt(top, '/content')[0].message, /anomaly_interception · interception/);

  assert.equal(mutated((b) => { b.bosses = []; }).errors[0].path, '/bosses');
  assert.equal(mutated((b) => { b.bosses[1] = '보스'; }).errors[0].path, '/bosses/1');

  const boss = mutated((b) => {
    b.bosses[1].id = b.bosses[0].id;
    b.bosses[2].name = '';
    delete b.bosses[3].source;
    b.bosses[4].weakto = '작열';
    b.bosses[0].reward = '';
  });
  assert.deepEqual(boss.errors.map((e) => e.path).sort(), ['/bosses/0/reward', '/bosses/1/id', '/bosses/2/name', '/bosses/3/source', '/bosses/4/weakto']);
  assert.match(errorAt(boss, '/bosses/1/id')[0].message, /같은 id가 1번째 보스에도 있다/);
  assert.match(errorAt(boss, '/bosses/3/source')[0].message, /출처/);
  assert.match(errorAt(boss, '/bosses/4/weakto')[0].message, /모르는 칸/);
});

test('적 설정·약점·레벨 상한·전투 시간의 형과 범위를 본다', () => {
  const cases = [
    [(b) => { b.bosses[0].enemy.def = -1; }, '/bosses/0/enemy/def', /방어력은 0 이상의 정수/],
    [(b) => { b.bosses[0].enemy.def = 100.5; }, '/bosses/0/enemy/def', /방어력은 0 이상의 정수/],
    [(b) => { b.bosses[0].enemy.code = '불'; }, '/bosses/0/enemy/code', /보스 속성은 .*작열/],
    [(b) => { b.bosses[0].enemy.core_px = '30'; }, '/bosses/0/enemy/core_px', /코어 직경/],
    [(b) => { b.bosses[0].enemy.has_parts = 0; }, '/bosses/0/enemy/has_parts', /true\/false/],
    [(b) => { b.bosses[0].enemy.hp = 1; }, '/bosses/0/enemy/hp', /모르는 칸이다\. 쓸 수 있는 칸: def, code/],
    [(b) => { b.bosses[0].enemy = null; }, '/bosses/0/enemy', /enemy\(적 설정\)는 객체여야 한다/],
    [(b) => { b.bosses[0].weak_to = '물'; }, '/bosses/0/weak_to', /약점은 /],
    [(b) => { b.bosses[0].level_cap = 0; }, '/bosses/0/level_cap', /레벨 상한은 1~1000의 정수/],
    [(b) => { b.bosses[0].duration = 0; }, '/bosses/0/duration', /전투 시간\(초\)은 0보다 커야 한다/],
  ];
  for (const [change, where, message] of cases) {
    const r = mutated(change);
    assert.equal(r.ok, false, where);
    const hit = r.errors.find((e) => e.path === where);
    assert.ok(hit, `${where} 오류가 있어야 한다: ${JSON.stringify(r.errors)}`);
    assert.match(hit.message, message);
  }
  // 적 칸을 더 적으면 확인 여부도 맞춰야 한다 — 맞추면 통과한다.
  const ok = mutated((b) => {
    Object.assign(b.bosses[0].enemy, { distance: 30, part_break_interval: 0, optimal_range_weapons: ['SG', 'SMG'] });
    b.bosses[0].confirmation = { confirmed: TRACKED, unconfirmed: [] };
  });
  assert.deepEqual(ok.errors, []);
});

test('약점이 보스 속성에 우월한 속성이 아니면 오류다', () => {
  // 풍압 보스의 약점은 작열이다. 수냉(작열에 우월)이나 풍압 자신, 철갑(풍압이 우월한 상대)은 틀렸다.
  for (const wrong of ['수냉', '풍압', '철갑', '전격']) {
    const r = mutated((b) => { b.bosses[0].weak_to = wrong; });
    assert.equal(r.ok, false, wrong);
    assert.deepEqual(r.errors.map((e) => e.path), ['/bosses/0/weak_to']);
    assert.match(r.errors[0].message, new RegExp(`약점\\(${wrong}\\)이 보스 속성\\(풍압\\)에 우월한 속성이 아니다`));
    assert.match(r.errors[0].message, /풍압 보스의 약점은 작열/);
  }
  // 실제 묶음에서 약점 둘을 서로 바꾸면 두 보스 모두 걸린다.
  const swapped = clone(REAL);
  [swapped.bosses[0].weak_to, swapped.bosses[1].weak_to] = [swapped.bosses[1].weak_to, swapped.bosses[0].weak_to];
  assert.deepEqual(validateBossBundle(swapped).errors.map((e) => e.path), ['/bosses/0/weak_to', '/bosses/1/weak_to']);
});

test('확인 여부: 추적 칸은 빠짐없이 확인됨(값 있음)이나 미확인(값 없음) 한쪽에 적혀야 한다', () => {
  const at = (r) => r.errors.map((e) => e.path);
  // 값을 적고 미확인이라 했다 — 확인하지 않은 값은 넣지 않는다.
  const guessed = mutated((b) => { b.bosses[1].enemy.def = 50000; });
  assert.deepEqual(at(guessed), ['/bosses/1/confirmation/unconfirmed']);
  assert.match(guessed.errors[0].message, /방어력\(def\)을\(를\) 미확인으로 적었지만 값이 있다 — 확인하지 않은 값은 넣지 않는다/);
  // 값 없이 확인됐다고 했다.
  const empty = mutated((b) => {
    b.bosses[1].confirmation.confirmed.push('def');
    b.bosses[1].confirmation.unconfirmed = b.bosses[1].confirmation.unconfirmed.filter((f) => f !== 'def');
  });
  assert.deepEqual(at(empty), ['/bosses/1/confirmation/confirmed']);
  assert.match(empty.errors[0].message, /확인됨으로 적었지만 값이 없다/);
  // 어느 쪽에도 적지 않았다.
  const missing = mutated((b) => { b.bosses[1].confirmation.unconfirmed = b.bosses[1].confirmation.unconfirmed.filter((f) => f !== 'core_px'); });
  assert.deepEqual(at(missing), ['/bosses/1/confirmation']);
  assert.match(missing.errors[0].message, /코어\(core_px\)의 확인 여부를 적지 않았다/);
  const untracked = mutated((b) => { b.bosses[1].confirmation.confirmed = b.bosses[1].confirmation.confirmed.filter((f) => f !== 'weak_to'); });
  assert.match(untracked.errors[0].message, /약점\(weak_to\)에 값이 있는데 확인 여부를 적지 않았다/);
  // 양쪽에 다 적었다 · 모르는 칸 이름 · 같은 칸 두 번 · confirmation 없음.
  assert.match(mutated((b) => { b.bosses[1].confirmation.unconfirmed.push('code'); }).errors[0].message, /확인됨과 미확인에 함께 적었다/);
  assert.equal(mutated((b) => { b.bosses[1].confirmation.unconfirmed.push('hp'); }).errors[0].path, '/bosses/1/confirmation/unconfirmed');
  assert.match(mutated((b) => { b.bosses[1].confirmation.confirmed.push('code'); }).errors[0].message, /같은 칸을 두 번/);
  assert.equal(mutated((b) => { delete b.bosses[1].confirmation; }).errors[0].path, '/bosses/1/confirmation');
});

// ── 변환 ─────────────────────────────────────────────────────────────────────

test('bossCondition: 확인된 칸만 조건에 싣는다. 약점만 있는 보스는 규칙으로 정한 속성을 싣는다', () => {
  const [a, b, c, d, e] = SAMPLE.bosses;
  assert.deepEqual(bossCondition(a, 'anomaly_interception'), {
    schema_version: 1, content: 'anomaly_interception', enemy: { code: '풍압', def: 20000, core_px: 30, has_parts: false }, duration: 120, level_cap: 400,
  });
  assert.deepEqual(bossCondition(b, 'anomaly_interception'), { schema_version: 1, content: 'anomaly_interception', enemy: { code: '철갑' }, level_cap: 400 });
  assert.deepEqual(bossCondition(c, 'anomaly_interception').enemy, { code: '작열' }, '약점 수냉 → 적 속성 작열');
  assert.deepEqual(bossCondition(d, 'anomaly_interception').enemy, { code: '수냉' }, '약점 전격 → 적 속성 수냉');
  // 속성을 모르는 보스: 적 설정이 아예 없다 — 속성을 지어내지 않는다.
  assert.deepEqual(bossCondition(e, 'anomaly_interception'), { schema_version: 1, content: 'anomaly_interception' });
  for (const boss of [...SAMPLE.bosses, ...REAL.bosses]) {
    const condition = bossCondition(boss, 'anomaly_interception');
    assert.equal(validateCondition(condition, catalog).ok, true, boss.name);
    assert.deepEqual(boss, clone(boss), '입력을 바꾸지 않는다');
  }
  // 실제 보스: 조건의 적 설정은 속성뿐이다(모르는 값을 0이나 다른 값으로 채우지 않는다).
  for (const boss of REAL.bosses) assert.deepEqual(bossCondition(boss, 'anomaly_interception').enemy, { code: boss.enemy.code });
});

test('unconfirmedOf: 미확인 칸마다 무엇으로 계산했는지(엔진 기본값)가 붙는다', () => {
  const real = unconfirmedOf(REAL.bosses[0]);
  assert.deepEqual(real.map((u) => u.field), ['duration', 'def', 'core_px', 'distance', 'has_parts', 'part_break_interval', 'optimal_range_weapons']);
  const by = Object.fromEntries(real.map((u) => [u.field, u]));
  assert.equal(by.def.computed_as, ENGINE_ENEMY_DEFAULTS.def);
  assert.equal(by.def.label, '방어력');
  assert.match(by.def.text, /31,784\(엔진 기본값/);
  assert.equal(by.duration.computed_as, 180);
  assert.equal(by.core_px.computed_as, 0);
  assert.match(by.core_px.text, /코어 없음\(엔진 기본값 0\)/);
  assert.equal(by.has_parts.computed_as, false);
  assert.equal(by.distance.computed_as, null);
  assert.deepEqual(by.optimal_range_weapons.computed_as, []);
  for (const u of real) assert.match(u.text, /엔진 기본값/, u.field);

  // 약점만 있는 보스: 속성은 미확인이고, 규칙으로 정한 값이 적힌다.
  const derived = unconfirmedOf(SAMPLE.bosses[2]).find((u) => u.field === 'code');
  assert.equal(derived.computed_as, '작열');
  assert.match(derived.text, /약점 수냉에서 엔진의 속성 상성 규칙으로 정했다/);
  // 속성을 모르는 보스: null — 속성 상성 미반영.
  const none = unconfirmedOf(SAMPLE.bosses[4]);
  assert.deepEqual(none.map((u) => u.field), TRACKED);
  assert.equal(none.find((u) => u.field === 'code').computed_as, null);
  assert.match(none.find((u) => u.field === 'code').text, /속성 상성 미반영/);
  assert.equal(none.find((u) => u.field === 'level_cap').computed_as, 400);
  assert.match(none.find((u) => u.field === 'level_cap').text, /엔진 정책 fixed\(레벨 400\)/);
  // 다 확인된 보스는 미확인이 없다.
  assert.deepEqual(unconfirmedOf({ enemy: { code: '풍압', def: 1, core_px: 0, distance: 30, has_parts: false, part_break_interval: 0, optimal_range_weapons: [] }, weak_to: '작열', level_cap: 400, duration: 90 }), []);
});

// ── 예산 ─────────────────────────────────────────────────────────────────────

test('splitBudget: 합이 예산과 같고, 나머지는 앞 보스부터, 모자라면 뒤 보스가 0건', () => {
  assert.equal(DEFAULT_INTERCEPT_BUDGET, 300);
  assert.equal(DEFAULT_INTERCEPT_TOP, 3);
  assert.deepEqual(splitBudget(300, 5), [60, 60, 60, 60, 60]);
  assert.deepEqual(splitBudget(302, 5), [61, 61, 60, 60, 60]);
  assert.deepEqual(splitBudget(7, 1), [7]);
  assert.deepEqual(splitBudget(3, 5), [1, 1, 1, 0, 0]);
  assert.deepEqual(splitBudget(10, 0), []);
  for (const [total, count] of [[1, 5], [17, 4], [299, 5], [1000, 7]]) {
    const shares = splitBudget(total, count);
    assert.equal(shares.reduce((s, v) => s + v, 0), total);
    assert.ok(Math.max(...shares) - Math.min(...shares) <= 1);
  }
});

test('selectBosses: 이름이나 id로 한 보스를 고른다', () => {
  assert.equal(selectBosses(REAL).length, 5);
  assert.deepEqual(selectBosses(REAL, '크라켄').map((b) => b.id), ['kraken']);
  assert.deepEqual(selectBosses(REAL, 'mirror_container').map((b) => b.name), ['미러 컨테이너']);
  assert.throws(() => selectBosses(REAL, '없는 보스'), (e) => e instanceof InputError && /있는 보스: 인디빌리아\(indivilia\)/.test(e.message));
});

// ── 보스별 추천 ───────────────────────────────────────────────────────────────

test('보스 5종마다 상위 편성 N개·멤버별 딜·1위 대비 비율이 나오고, 보스 정보가 실린다', async () => {
  const report = await recommendIntercept({ account, bundle: REAL }, { budget: 50 }, depsOf());
  assert.equal(report.schema_version, 1);
  assert.equal(report.kind, 'intercept_report');
  assert.equal(report.generated_at, '2026-11-12T00:00:00.000Z');
  assert.deepEqual(report.account, { name: '가짜 계정', is_test_data: true, updated_at: null });
  assert.equal(report.content, 'anomaly_interception');
  assert.deepEqual(report.bundle, { name: REAL.name, version: REAL.version, is_test_data: false, source: REAL.source, bosses: 5 });
  assert.deepEqual(report.engine, { repo: 'fake', commit: 'abc', dirty: false });
  assert.equal(report.cache, null, '캐시 없는 런타임');
  assert.equal(report.top, 3);
  assert.ok(report.assumptions.length > 0);

  assert.deepEqual(report.bosses.map((b) => b.name), ['인디빌리아', '울트라', '하베스터', '크라켄', '미러 컨테이너']);
  for (const [i, b] of report.bosses.entries()) {
    const src = REAL.bosses[i];
    assert.equal(b.id, src.id);
    assert.deepEqual(b.element, { code: src.enemy.code, code_source: 'bundle', weak_to: src.weak_to, weak_to_source: 'bundle', reflected: true });
    assert.equal(b.reward, src.reward);
    assert.equal(b.source, src.source);
    assert.deepEqual(b.flags, []);
    assert.equal(b.status, 'computed');
    assert.deepEqual(b.condition, { schema_version: 1, content: 'anomaly_interception', enemy: { code: src.enemy.code }, level_cap: 400 });
    assert.equal(b.level.cap, 400);
    assert.equal(b.ranking.length, 3);
    assert.deepEqual(b.ranking.map((r) => r.rank), [1, 2, 3]);
    assert.equal(b.ranking[0].relative_to_best, 1);
    for (const [k, r] of b.ranking.entries()) {
      assert.equal(r.members.length, 5);
      assert.equal(r.members.reduce((s, m) => s + m.damage, 0), r.total_damage);
      assert.equal(r.relative_to_best, r.total_damage / b.ranking[0].total_damage);
      if (k > 0) assert.ok(b.ranking[k - 1].total_damage >= r.total_damage);
    }
    // 가짜 엔진에서 1위는 약점 속성 니케가 가장 많이 든 편성이다 — 보스마다 조건이 실제로 다르게 들어갔다.
    const weakCount = (r) => r.members.filter((m) => catalog.nikkes[m.name].element_code === src.weak_to).length;
    assert.equal(weakCount(b.ranking[0]), Math.max(...b.ranking.map(weakCount)));
    assert.ok(weakCount(b.ranking[0]) >= 1, b.name);
  }
  // 보스마다 1위가 같지 않다(약점이 다르다).
  const tops = new Set(report.bosses.map((b) => b.ranking[0].members.map((m) => m.name).sort().join('|')));
  assert.ok(tops.size > 1);

  const text = report.caveats.join('\n');
  assert.match(text, /실제 요격전 기록과 대조하지 않았다/);
  assert.match(text, /보스 패턴 미반영/);
  assert.match(text, /미확인 값이 있는 보스 5종\(인디빌리아, 울트라, 하베스터, 크라켄, 미러 컨테이너\)/);
  assert.match(text, /확정값이 아니다/);
  assert.match(text, /동기화 레벨\(account\.synchro_level\)이 없어 전원을 레벨 400으로 계산했다/);
  assert.doesNotMatch(text, /속성 상성 미반영/, '다섯 보스 모두 속성이 확인됐다');
  assert.doesNotMatch(text, /검증용 보스 묶음/);
});

test('전체 예산을 보스 수로 나눠 지킨다 — 보스마다 엔진에 맡긴 요청 수가 몫을 넘지 않는다', async () => {
  const log = [];
  const report = await recommendIntercept({ account, bundle: REAL }, { budget: 23 }, depsOf(log));
  assert.deepEqual(report.sims.per_boss.map((p) => p.budget), [5, 5, 5, 4, 4]);
  assert.equal(report.sims.budget, 23);
  assert.ok(report.sims.used <= 23);
  assert.equal(report.sims.used, log.length, '엔진이 받은 요청 수가 곧 쓴 시뮬 횟수다');
  for (const [i, p] of report.sims.per_boss.entries()) {
    const sent = log.filter((req) => req.enemy.code === REAL.bosses[i].enemy.code).length;
    assert.equal(sent, p.used, p.name);
    assert.ok(p.used <= p.budget, p.name);
    assert.equal(report.bosses[i].budget, p.budget);
    assert.equal(report.bosses[i].sims, p.used);
    assert.equal(report.bosses[i].suggestion.search.budget, p.budget);
  }
  // 예산 때문에 줄인 것이 caveats에 적힌다.
  const text = report.caveats.join('\n');
  assert.match(text, /전체 시뮬 예산 23건을 보스 5종에 4~5건씩 나눴다/);
  assert.match(text, /\[인디빌리아, 울트라, 하베스터\] 시뮬 예산 5건이 모자라 후보 \d+개/);
  assert.match(text, /\[크라켄, 미러 컨테이너\] 시뮬 예산 4건이 모자라 후보 \d+개/);

  // 넉넉하면 몫이 같고, 문장도 그렇게 적힌다.
  const roomy = await recommendIntercept({ account, bundle: REAL }, {}, depsOf());
  assert.deepEqual(roomy.sims.per_boss.map((p) => p.budget), [60, 60, 60, 60, 60]);
  assert.match(roomy.caveats.join('\n'), /전체 시뮬 예산 300건을 보스 5종에 60건씩 나눴다/);
  assert.ok(roomy.sims.used <= 300);
});

test('예산이 보스 수보다 적으면 뒤 보스는 계산하지 않고 그렇게 적는다 — 0딜이나 빈 순위로 꾸미지 않는다', async () => {
  const log = [];
  const report = await recommendIntercept({ account, bundle: REAL }, { budget: 3 }, depsOf(log));
  assert.deepEqual(report.bosses.map((b) => b.status), ['computed', 'computed', 'computed', 'not_computed', 'not_computed']);
  assert.equal(log.length, 3);
  for (const b of report.bosses.slice(3)) {
    assert.deepEqual(b.ranking, []);
    assert.equal(b.suggestion, null);
    assert.equal(b.sims, 0);
    assert.match(b.notes.join('\n'), /계산하지 못했다/);
    assert.ok(b.unconfirmed.length > 0, '계산하지 않은 보스에도 확인 여부는 실린다');
  }
  assert.match(report.caveats.join('\n'), /계산하지 못한 보스: 크라켄, 미러 컨테이너/);
  assert.match(renderInterceptReport(report), /■ 크라켄 .*\n(?:.*\n)*? {2}계산하지 않았다\./);
});

test('--boss로 한 보스만 계산하면 예산을 그 보스가 다 쓴다', async () => {
  const log = [];
  const report = await recommendIntercept({ account, bundle: REAL, boss: '하베스터' }, { budget: 12, top: 1 }, depsOf(log));
  assert.deepEqual(report.bosses.map((b) => b.id), ['harvester']);
  assert.equal(report.bosses[0].budget, 12);
  assert.equal(report.bosses[0].ranking.length, 1);
  assert.ok(log.every((req) => req.enemy.code === '작열'));
  assert.equal(report.bundle.bosses, 5, '묶음에는 다섯 보스가 있다');
  await assert.rejects(recommendIntercept({ account, bundle: REAL, boss: '없음' }, {}, depsOf()), /보스를 찾을 수 없다/);
});

test('미확인 값이 있는 보스의 결과에는 무엇이 미확인이고 무엇으로 계산했는지가 붙는다', async () => {
  const log = [];
  const report = await recommendIntercept({ account, bundle: SAMPLE }, { budget: 25 }, depsOf(log));
  const [a, b, c, d, e] = report.bosses;

  // A: 적 설정을 채운 보스 — 채운 값이 엔진 요청에 그대로 간다.
  assert.deepEqual(a.confirmed, ['code', 'weak_to', 'level_cap', 'duration', 'def', 'core_px', 'has_parts']);
  assert.deepEqual(a.unconfirmed.map((u) => u.field), ['distance', 'part_break_interval', 'optimal_range_weapons']);
  assert.equal(a.duration, 120);
  const sentA = log.filter((req) => req.enemy?.code === '풍압');
  assert.ok(sentA.length > 0);
  for (const req of sentA) {
    assert.deepEqual(req.enemy, { code: '풍압', def: 20000, core_px: 30, has_parts: false });
    assert.equal(req.sim.duration, 120);
  }

  // B: 속성·약점만 — 나머지 적 칸은 요청에 없다(0으로 채우지 않는다). 무엇으로 계산했는지는 결과에 있다.
  for (const req of log.filter((r) => r.enemy?.code === '철갑')) {
    assert.deepEqual(req.enemy, { code: '철갑' });
    assert.equal(req.sim.duration, 180);
  }
  assert.deepEqual(b.unconfirmed.map((u) => [u.field, u.computed_as]), [
    ['duration', 180], ['def', 31784], ['core_px', 0], ['distance', null], ['has_parts', false], ['part_break_interval', 0], ['optimal_range_weapons', []],
  ]);
  assert.equal(b.duration, 180);

  // C·D: 약점만 — 규칙으로 정한 속성으로 계산하고, 확인한 값이 아니라고 적는다.
  assert.deepEqual(c.element, { code: '작열', code_source: 'weak_to', weak_to: '수냉', weak_to_source: 'bundle', reflected: true });
  assert.deepEqual(d.element.code, '수냉');
  assert.deepEqual(c.flags, []);
  assert.equal(c.unconfirmed[0].field, 'code');
  assert.equal(c.unconfirmed[0].computed_as, '작열');
  assert.match(c.notes.join('\n'), /보스 속성\(작열\)은 화면에서 확인한 값이 아니다 — 약점\(수냉\)에서 엔진의 속성 상성 규칙으로 정했다/);
  assert.ok(log.some((req) => req.enemy?.code === '작열') && log.some((req) => req.enemy?.code === '수냉'));
  // 약점 속성 니케가 실제로 더 큰 딜을 낸다(규칙으로 정한 속성이 계산에 들어갔다).
  const top = c.ranking[0];
  const weak = top.members.filter((m) => catalog.nikkes[m.name].element_code === '수냉');
  const others = top.members.filter((m) => catalog.nikkes[m.name].element_code !== '수냉');
  assert.ok(weak.length > 0 && weak.every((w) => others.every((o) => w.damage > o.damage)));
  // D: 레벨 상한 200 — 동기화 레벨을 몰라 200으로 가정, 엔진에는 sync로 실린다.
  assert.deepEqual(d.level, { mode: 'cap', level: 200, cap: 200, synchro_level: null, assumed: true, engine_policy: 'sync' });
  for (const req of log.filter((r) => r.enemy?.code === '수냉')) {
    assert.equal(req.profile_level, 'sync');
    assert.equal(req.profile._account.synchro_level, 200);
  }

  // E: 속성을 모른다 — 계산은 하되 속성 상성 미반영이 눈에 띈다. 적 속성 없이 계산했다.
  assert.deepEqual(e.element, { code: null, code_source: null, weak_to: null, weak_to_source: null, reflected: false });
  assert.deepEqual(e.flags, ['속성 상성 미반영']);
  assert.equal(e.status, 'computed');
  assert.equal(e.ranking.length, 3);
  assert.match(e.notes[0], /^속성 상성 미반영 — 보스 속성과 약점을 몰라 적 속성 없이 계산했다/);
  assert.equal(e.reward, null);
  assert.equal(e.weak_pool, null);
  const sentE = log.filter((req) => req.enemy === undefined);
  assert.equal(sentE.length, e.sims);
  assert.ok(sentE.length > 0);
  // 우월 코드 보너스가 아무에게도 붙지 않았다 — 멤버 딜이 모두 같다(가짜 엔진).
  assert.equal(new Set(e.ranking[0].members.map((m) => m.damage)).size, 1);
  assert.equal(e.level.mode, 'fixed');
  assert.equal(e.unconfirmed.find((u) => u.field === 'level_cap').computed_as, 400);

  const text = report.caveats.join('\n');
  assert.match(text, /속성 상성 미반영: 시험 보스 E — 보스 속성과 약점을 몰라 우월 코드 보너스 없이 계산했다/);
  assert.match(text, /검증용 보스 묶음이다/);
  assert.match(text, /\[시험 보스 D\] 레벨 상한 200: 계정에 동기화 레벨/);
  assert.match(text, /\[시험 보스 A, 시험 보스 B, 시험 보스 C\] 레벨 상한 400: 계정에 동기화 레벨/);
});

test('계정에 동기화 레벨이 있으면 상한까지 반영해 계산한다', async () => {
  const log = [];
  const low = await recommendIntercept({ account: accountOf({ account: { synchro_level: 258 } }), bundle: REAL, boss: 'kraken' }, { budget: 6 }, depsOf(log));
  assert.deepEqual(low.bosses[0].level, { mode: 'cap', level: 258, cap: 400, synchro_level: 258, assumed: false, engine_policy: 'sync' });
  assert.ok(log.length > 0 && log.every((req) => req.profile_level === 'sync' && req.profile._account.synchro_level === 258));
  assert.match(low.bosses[0].assumptions.join('\n'), /캐릭터 레벨 258/);
  assert.doesNotMatch(low.caveats.join('\n'), /상한으로 가정|전원을 레벨 400으로 계산했다/);
  assert.match(low.caveats.join('\n'), /편성 전원을 레벨 258\(동기화 레벨 258, 상한 400\)로 계산했다/);

  const assumed = await recommendIntercept({ account, bundle: REAL, boss: 'kraken' }, { budget: 6 }, depsOf());
  assert.ok(low.bosses[0].ranking[0].total_damage < assumed.bosses[0].ranking[0].total_damage, '레벨이 낮으면 딜이 낮다');

  const high = await recommendIntercept({ account: accountOf({ account: { synchro_level: 700 } }), bundle: REAL, boss: 'kraken' }, { budget: 6 }, depsOf());
  assert.equal(high.bosses[0].level.level, 400, '상한을 넘지 않는다');
  assert.equal(high.bosses[0].ranking[0].total_damage, assumed.bosses[0].ranking[0].total_damage);
});

// P-020으로 요구가 바뀌었다: 예전에는 후보 풀을 투자 점수로만 골라 덜 키운 약점 속성 니케가 풀에 없다고 알리기만 했다
// (pooled 삼수 / not_pooled 삼수2·삼수3, 「약점 속성 니케를 따로 우선하지 않는다」). 이제는 약점 속성을 우선 속성으로 넘겨
// 단계마다 최소 2명이 풀에 든다 — 그래서 기대값이 달라졌다.
test('약점 속성 니케가 후보 풀에 들었는지 보스마다 알린다 — 덜 키운 니케도 단계마다 최소 2명까지 든다', async () => {
  // 수냉 니케를 둘 더 보유하지만 덜 키웠다. 투자 점수만으로는 둘 다 3단계 후보 풀(5명)에 들지 못한다.
  const cat = { ...catalog, nikkes: { ...catalog.nikkes, 삼수2: nikke('3', '수냉'), 삼수3: nikke('3', '수냉') } };
  const acct = accountOf();
  acct.nikkes = { ...acct.nikkes, 삼수2: grown(2), 삼수3: {} };
  const plain = generateCandidates(acct, cat);
  assert.deepEqual(plain.summary.pool[3], ['삼수', '삼작', '삼풍', '삼철', '삼전'], '우선 속성이 없으면 삼수2·삼수3은 풀 밖이다');

  // 이제 삼수2가 엔진까지 가므로 가짜 엔진도 이 카탈로그로 속성을 읽는다.
  const report = await recommendIntercept({ account: acct, bundle: REAL, boss: '하베스터' }, { budget: 10 }, { catalog: cat, runBatch: fakeEngine([], cat), now });
  const boss = report.bosses[0];
  assert.deepEqual(boss.weak_pool, { element: '수냉', owned: ['삼수', '삼수2', '삼수3'], pooled: ['삼수', '삼수2'], not_pooled: ['삼수3'], promoted: ['삼수2'] });
  assert.match(boss.notes.join('\n'), /약점 속성\(수냉\) 우선으로 후보 풀에 넣은 니케: 삼수2 — 투자 점수만으로는 풀에 들지 못했을 니케다/);
  assert.match(boss.notes.join('\n'), /약점 속성\(수냉\) 보유 니케 3명 중 1명은 후보 풀에 들지 못했다\(삼수3\) — 약점 속성 니케는 버스트 단계마다 최소 2명까지만 보장한다/);
  assert.match(report.caveats.join('\n'), /후보 편성은 보스마다 다르다: 보스의 약점 속성 니케를 버스트 단계별 후보 풀에 최소 2명씩 넣고/);
  assert.doesNotMatch(report.caveats.join('\n'), /약점 속성 니케를 따로 우선하지 않는다/);
  // 덜 키운 삼수2가 든 편성이 실제로 계산됐고, 가짜 엔진(속성 우위 2배)에서 1위다.
  assert.ok(boss.ranking[0].members.some((m) => m.name === '삼수2'), boss.ranking[0].members.map((m) => m.name).join(','));
});

test('같은 입력이면 같은 결과다 — 입력 문서도 바꾸지 않는다', async () => {
  const before = JSON.stringify([account, REAL, SAMPLE]);
  for (const bundle of [REAL, SAMPLE]) {
    const first = await recommendIntercept({ account, bundle }, { budget: 40, top: 2 }, depsOf());
    const second = await recommendIntercept({ account: clone(account), bundle: clone(bundle) }, { budget: 40, top: 2 }, depsOf());
    assert.deepEqual(second, first);
    // 계정의 니케 나열 순서가 달라도 같다.
    const reversed = { ...account, nikkes: Object.fromEntries(Object.entries(account.nikkes).reverse()) };
    assert.deepEqual(await recommendIntercept({ account: reversed, bundle }, { budget: 40, top: 2 }, depsOf()), first);
    assert.equal(renderInterceptReport(second), renderInterceptReport(first));
  }
  assert.equal(JSON.stringify([account, REAL, SAMPLE]), before);
});

test('캐시 통계는 보스별 통계의 합이다', async () => {
  const runtime = {
    loadCatalog: () => catalog,
    engineVersion: () => ({ repo: 'fake', commit: 'abc', dirty: false }),
    runBatch: fakeEngine(),
    runBatchWithStats: async (requests) => ({ results: await fakeEngine()(requests), cache: { hits: 1, misses: requests.length - 1, stored: requests.length - 1, warnings: ['가짜 경고'] } }),
  };
  const report = await recommendIntercept({ account, bundle: REAL }, { budget: 10 }, { runtime, now });
  const batches = report.bosses.length; // 예산 2건씩: 보스마다 1단계 배치 한 번(2단계는 예산이 없어 엔진에 가지 않는다)
  assert.deepEqual(report.cache, { hits: batches, misses: report.sims.used - batches, stored: report.sims.used - batches, warnings: ['가짜 경고'] });
});

test('잘못된 입력은 엔진을 부르기 전에 입력 오류다', async () => {
  const log = [];
  const deps = depsOf(log);
  await assert.rejects(recommendIntercept({ account, bundle: { ...SAMPLE, content: 'solo_raid' } }, {}, deps), (e) => e instanceof InputError && /보스 묶음이 잘못됐다: \/content/.test(e.message));
  await assert.rejects(recommendIntercept({ account: { ...account, is_test_data: undefined }, bundle: SAMPLE }, {}, deps), /계정 상태가 잘못됐다/);
  await assert.rejects(recommendIntercept({ account, bundle: SAMPLE }, { top: 0 }, deps), /top은 1 이상의 정수/);
  await assert.rejects(recommendIntercept({ account, bundle: SAMPLE }, { budget: 1.5 }, deps), /budget은 1 이상의 정수/);
  assert.equal(log.length, 0);
});

// ── 표 출력 ───────────────────────────────────────────────────────────────────

test('표 출력: 보스 이름·속성·약점·보상, 순위, 미확인 칸, 속성 상성 미반영 표시', async () => {
  const real = renderInterceptReport(await recommendIntercept({ account, bundle: REAL }, { budget: 25, top: 2 }, depsOf()));
  assert.match(real, /^계정: 가짜 계정 {2}\[검증용 데이터\]$/m);
  assert.match(real, /^콘텐츠: 이상 개체 요격전 · 보스 5종$/m);
  assert.match(real, /^보스 값의 출처: docs\/intercept\.md/m);
  assert.match(real, /^엔진: fake @ abc$/m);
  assert.match(real, /^캐시: 쓰지 않음$/m);
  assert.match(real, /^예산: 시뮬 \d+건 \/ 예산 25건 \(인디빌리아 \d+\/5 · /m);
  assert.match(real, /^■ 인디빌리아 {2}속성 풍압 · 약점 작열 · 보상 몸통 장비 · 레벨 400\(상한 400 — 동기화 레벨을 몰라 상한으로 가정\) · 전투 180초\(미확인 — 엔진 기본값\)$/m);
  assert.match(real, /^■ 미러 컨테이너 {2}속성 수냉 · 약점 전격 · 보상 팔 장비 /m);
  assert.match(real, /^ {4}\? 방어력: 31,784\(엔진 기본값/m);
  assert.match(real, /^ {2}1위 {2}후보 \d+ {2}총딜 .* · 기준$/m);
  assert.match(real, /^ {2}2위 {2}후보 \d+ {2}총딜 .* · 1위 대비 \d+\.\d%$/m);
  assert.doesNotMatch(real, /3위/);
  assert.doesNotMatch(real, /속성 상성 미반영/);
  assert.match(real, /^ {2}- 수치는 시뮬레이션 추정치다\. 실제 요격전 기록과 대조하지 않았다/m);
  assert.equal((real.match(/^■ /gm) ?? []).length, 5);

  const sample = renderInterceptReport(await recommendIntercept({ account, bundle: SAMPLE }, { budget: 25, top: 1 }, depsOf()));
  assert.match(sample, /보스 5종 {2}\[검증용 보스 묶음\]/);
  assert.match(sample, /^■ 시험 보스 C {2}속성 작열\(약점에서 유도\) · 약점 수냉 · 보상 미확인 /m);
  assert.match(sample, /^■ 시험 보스 D .*레벨 200\(상한 200 — 동기화 레벨을 몰라 상한으로 가정\)/m);
  // 속성을 모르는 보스: 이름 바로 다음 줄에 눈에 띄는 표시.
  assert.match(sample, /^■ 시험 보스 E {2}속성 미확인 · 약점 미확인 · 보상 미확인 · 레벨 400\(상한 미확인\) · 전투 180초\(미확인 — 엔진 기본값\)\n {2}!! 속성 상성 미반영 !!$/m);
  assert.equal((sample.match(/!! 속성 상성 미반영 !!/g) ?? []).length, 1);
  assert.match(sample, /^ {4}\? 보스 속성: 속성 없음\(엔진 기본값\) — 속성 상성 미반영$/m);
  assert.match(sample, /^■ 시험 보스 A .*전투 120초$/m);
});
