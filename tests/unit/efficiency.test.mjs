// 육성 효율표(P-031)의 순수 함수: 한 단계 올릴 수 있는 것(후보 만들기)·효율표·오버로드 옵션 바꿔 보기·큐브.
// 엔진은 가짜다(니케의 육성 칸에서 정해지는 값). 실제 엔진으로는 tests/integration/efficiency.engine.test.mjs가 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { overloadOptionId, OVERLOAD_OPTIONS, validateAccount } from '../../src/core/account.mjs';
import { createMemoryStore, withCache } from '../../src/core/cache.mjs';
import { InputError } from '../../src/core/compare.mjs';
import { deckKey, resolveOpponent } from '../../src/core/deck.mjs';
import {
  CANDIDATE_KINDS,
  compareCubes,
  cubeCandidates,
  cubeCatalogFrom,
  cubeList,
  currentCube,
  DEFAULT_CUBE_LIMIT,
  DEFAULT_EFFICIENCY_LIMIT,
  DEFAULT_LINE_LEVEL,
  efficiencyTable,
  emptyOverloadParts,
  ENGINE_DEFAULT_CUBE,
  layoutOverload,
  OVERLOAD_LINE_MAX,
  OVERLOAD_PARTS,
  overloadFromParts,
  overloadState,
  overloadSummary,
  overloadTrialKey,
  readCollectionStage,
  tryOverload,
  upgradeCandidates,
} from '../../src/core/efficiency.mjs';
import { applyUpgrade } from '../../src/core/growth.mjs';

const bundle = JSON.parse(fs.readFileSync(new URL('../../data/intercept/anomaly.json', import.meta.url), 'utf8'));

// 지어낸 카탈로그: 「바」만 SR 등급이다. 큐브는 넷을 바꿔 볼 수 있고 하나는 엔진이 효과를 계산하지 못한다.
const stage = { 가: '1', 나: '2', 다: '3', 라: '3', 바: '2', 사: '3' };
const cubes = [
  { name: '렐릭 베어 큐브', skill: '퀵 리로드 HC', effect: '재장전 속도 {0}% ▲', max_level: 15, supported: true },
  { name: '가 큐브', skill: '가 효과', effect: '가 {0}% ▲', max_level: 15, supported: true },
  { name: '나 큐브', skill: '나 효과', effect: '나 {0}% ▲', max_level: 15, supported: true },
  { name: '낮은 큐브', skill: '낮은 효과', effect: '낮은 {0}% ▲', max_level: 10, supported: true },
  { name: '못 쓰는 큐브', skill: '못 쓰는 효과', effect: '회복량 {0}% ▲', max_level: 15, supported: false },
];
const catalog = {
  nikkes: Object.fromEntries(Object.entries(stage).map(([n, s]) => [n, { burst_stage: s, weapon_type: 'AR', element_code: '작열', rarity: n === '바' ? 'SR' : 'SSR' }])),
  bosses: ['솔로 레이드 S40'],
  cubes,
};
const DECK = ['가', '나', '다', '라', '바'];
const account = {
  schema_version: 1,
  is_test_data: true,
  name: '검증용',
  account: { cubes: { '가 큐브': 7 } },
  nikkes: {
    // 스킬 2는 최대, 오버로드는 줄 수 표기와 줄별 레벨 표기가 섞여 있다.
    가: { skill_levels: [7, 10, 9], breakthrough: 3, core_enhancement: 3, collection_stage: 'SR5', overload: { 공격력: 2, 우월코드: [11, 9] } },
    // 전부 최대.
    나: { skill_levels: [10, 10, 10], breakthrough: 3, core_enhancement: 7, collection_stage: 'SR15', overload: { 공격력: 4, '우월 코드 대미지': 4, '최대 장탄 수': 4 } },
    // 미확인 칸이 있다.
    다: { skill_levels: [4, 4, 4], unknown: ['breakthrough', 'core_enhancement', 'overload', 'collection_stage'] },
    // 아무것도 적지 않았다(미육성으로 계산된다).
    라: {},
    // SR 등급, 돌파 2(코어 강화가 잠겨 있다), R 소장품 최대, 오버로드 장비는 두 부위뿐.
    바: { skill_levels: [10, 10, 10], breakthrough: 2, collection_stage: 'R15', overload: { 공격력: 2 }, equipment: { 머리: { level: 5 }, 몸통: { level: 3 }, 팔: { tier: 'T9' }, 다리: { tier: '없음' } } },
    사: { equip_skills: { atk_pct: 22.22 } },
  },
};
const now = () => new Date('2026-11-12T00:00:00Z');

/** 받은 객체를 안쪽까지 얼린다 — 계정 문서를 바꾸면 테스트가 던진다. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
deepFreeze(account);

const OPTION_WEIGHT = { atk_pct: 9, element_bonus: 7, max_ammo_pct: 5, crit_rate: 3, crit_dmg: 4, charge_speed_pct: 2, charge_dmg_pct: 2, accuracy_pct: 1, def_pct: 0 };
/** 큐브의 가짜 효과: 「가 큐브」는 「가」에게, 「나 큐브」는 「나」에게 좋다. 「낮은 큐브」는 누구에게나 손해다. */
function cubeBonus(name, cube) {
  if (cube === '가 큐브') return name === '가' ? 40 : 5;
  if (cube === '나 큐브') return name === '나' ? 30 : -5;
  if (cube === '낮은 큐브') return -20;
  return 0;
}

/** 가짜 엔진이 니케의 육성 칸에서 내는 힘(엔진 프로필의 항목을 읽는다). */
function power(name, entry) {
  const skills = entry.skill_levels ?? [1, 1, 1];
  let p = 100 + skills[0] * 3 + skills[1] * 2 + skills[2] * 5 + (entry.breakthrough ?? 0) * 20 + (entry.core_enhancement ?? 0) * 7;
  const stageOf = /^(R|SR)(\d+)$/.exec(entry.collection_stage ?? '');
  if (stageOf) p += (stageOf[1] === 'SR' ? 30 : 10) + Number(stageOf[2]);
  for (const [key, value] of Object.entries(entry.overload ?? {})) {
    const lines = Array.isArray(value) ? value.reduce((s, lv) => s + lv / 10, 0) : value;
    p += lines * OPTION_WEIGHT[overloadOptionId(key)];
  }
  return p + cubeBonus(name, entry.cube?.name ?? ENGINE_DEFAULT_CUBE.name);
}

/** 가짜 엔진: 총딜 = Σ 이름 코드 × (자리 + 1) × 힘. `failCube`를 낀 요청은 계산하지 못한다. */
function fakeEngine(log = [], failCube = null) {
  return async (requests) => {
    log.push(...requests);
    return requests.map((req) => {
      const chars = req.profile.chars;
      if (failCube && req.squad.some((n) => chars[n]?.cube?.name === failCube)) return { error: { type: 'invalid_input', message: `효과 모델이 없는 큐브: ${failCube}`, path: '/profile' } };
      const dmg = req.squad.map((n, i) => n.codePointAt(0) * (i + 1) * power(n, chars[n] ?? {}));
      const total = dmg.reduce((a, b) => a + b, 0);
      return { total_damage: total, members: req.squad.map((n, i) => ({ name: n, damage: dmg[i], share: dmg[i] / total })), warnings: [], spec: { profile: { ungrown: [] } }, evaluator: { repo: 'fake', commit: 'abc', dirty: false } };
    });
  };
}
const deps = (log, failCube) => ({ catalog, runBatch: fakeEngine(log, failCube), now });
const kraken = () => resolveOpponent('boss:kraken', { bundle, catalog });
const idsOf = (list) => list.map((c) => c.id);

// ── 엔진의 큐브 표 → 카탈로그 ───────────────────────────────────────────────────

test('큐브 표: 주석·공통 효과를 빼고 이름·효과·최대 레벨·지원 여부만 남긴다', () => {
  const raw = {
    _comment: '주석',
    _stats: { 1: { atk: 1 } },
    공통: { stat: 'element_bonus', 스킬명: '공통 효과', template: '공통 {0}%', values: { 5: 1 } },
    '가 큐브': { stat: 'a', 스킬명: '가 효과', template: '가 {0}% ▲', values: { 1: 1, 2: 2, 3: 3 } },
    '나 큐브': { stat: 'b', 스킬명: '나 효과', template: '나 {0}% ▲', values: { 1: 1 }, unsupported: true },
    '다 큐브': { stat: 'c', values: {} },
    '이상한 줄': '객체가 아니다',
  };
  assert.deepEqual(cubeCatalogFrom(raw), [
    { name: '가 큐브', skill: '가 효과', effect: '가 {0}% ▲', max_level: 3, supported: true },
    { name: '나 큐브', skill: '나 효과', effect: '나 {0}% ▲', max_level: 1, supported: false },
    { name: '다 큐브', skill: null, effect: null, max_level: 0, supported: true },
  ]);
  assert.deepEqual(cubeCatalogFrom(null), []);
  // 바꿔 볼 수 있는 것은 엔진이 효과를 계산하고 레벨이 있는 큐브뿐이다. 목록이 없으면 「모름」이다.
  const list = cubeList({ cubes: cubeCatalogFrom(raw) });
  assert.deepEqual([list.known, list.supported.map((c) => c.name), list.unsupported.map((c) => c.name)], [true, ['가 큐브'], ['나 큐브', '다 큐브']]);
  assert.deepEqual(cubeList({ nikkes: {}, bosses: [] }), { known: false, supported: [], unsupported: [] });
  assert.equal(cubeList({ cubes: null }).known, false);
});

// ── 한 단계 올릴 수 있는 것 ────────────────────────────────────────────────────

test('후보: 니케마다 한 단계 올릴 수 있는 칸만 만든다 — 이미 최대인 칸은 후보가 아니다', () => {
  const { candidates, excluded } = upgradeCandidates({ account, members: DECK, catalog, only: '가' });
  assert.deepEqual(idsOf(candidates), [
    '가 · 스킬 1 Lv.7 → Lv.8',
    '가 · 버스트 Lv.9 → Lv.10',
    '가 · 코어 강화 3 → 4',
    '가 · 소장품 SR5 → SR6',
    '가 · 오버로드 공격력 2줄 → 3줄',
    '가 · 오버로드 우월 코드 대미지 2줄 → 3줄',
    '가 · 오버로드 최대 장탄 수 0줄 → 1줄',
    '가 · 오버로드 크리티컬 확률 0줄 → 1줄',
    '가 · 오버로드 크리티컬 대미지 0줄 → 1줄',
    '가 · 오버로드 차지 속도 0줄 → 1줄',
    '가 · 오버로드 차지 대미지 0줄 → 1줄',
    '가 · 오버로드 명중률 0줄 → 1줄',
    '가 · 오버로드 방어력 0줄 → 1줄',
  ]);
  // 스킬 2(이미 10)와 돌파(이미 3)는 후보가 아니고, 까닭이 남는다.
  assert.deepEqual(excluded, [
    { nikke: '가', kind: 'skill2', label: '스킬 2', code: 'max', reason: '스킬 2 레벨이 이미 최대(10)다.' },
    { nikke: '가', kind: 'breakthrough', label: '돌파', code: 'max', reason: '돌파가 이미 최대(3)다.' },
  ]);
  // 후보는 성장 비교(growth.mjs)의 업그레이드 후보 그대로다: 더하기는 add, 소장품은 set. 오버로드는 계정이 적은 이름·표기를 따른다.
  const up = (label) => candidates.find((c) => c.label === label).upgrade;
  assert.deepEqual(up('스킬 1'), { name: '가 · 스킬 1 Lv.7 → Lv.8', nikke: '가', add: { skill_levels: [1, 0, 0] } });
  assert.deepEqual(up('버스트').add, { skill_levels: [0, 0, 1] });
  assert.deepEqual(up('코어 강화').add, { core_enhancement: 1 });
  assert.deepEqual(up('소장품').set, { collection_stage: 'SR6' });
  assert.deepEqual(up('오버로드 공격력').add, { overload: { 공격력: 1 } });
  assert.deepEqual(up('오버로드 우월 코드 대미지').add, { overload: { 우월코드: [DEFAULT_LINE_LEVEL] } });
  assert.deepEqual(up('오버로드 최대 장탄 수').add, { overload: { '최대 장탄 수': 1 } });
  assert.equal(DEFAULT_LINE_LEVEL, 10);
});

test('후보: 가상 적용한 계정은 모두 범위 안이다 — 받은 계정은 바뀌지 않는다', () => {
  const before = JSON.stringify(account);
  const { candidates } = upgradeCandidates({ account, members: DECK, catalog });
  assert.ok(candidates.length > 20);
  for (const c of candidates) {
    const applied = applyUpgrade(account, c.upgrade);
    assert.deepEqual(applied.problems, [], c.id);
    assert.equal(validateAccount(applied.account, catalog).ok, true, c.id);
    assert.equal(applied.changes.length, 1, c.id);
    assert.equal(applied.changes[0].nikke, c.nikke);
  }
  assert.equal(JSON.stringify(account), before);
  // 한 단계만 올린다.
  const one = applyUpgrade(account, candidates.find((c) => c.id === '가 · 오버로드 우월 코드 대미지 2줄 → 3줄').upgrade);
  assert.deepEqual(one.account.nikkes.가.overload, { 공격력: 2, 우월코드: [11, 9, 10] });
  assert.deepEqual(applyUpgrade(account, candidates.find((c) => c.id === '라 · 스킬 1 Lv.1 → Lv.2').upgrade).account.nikkes.라.skill_levels, [2, 1, 1]);
});

test('후보: 전부 최대인 니케는 후보가 없다. 미확인 칸은 한 단계 위를 정할 수 없다', () => {
  const maxed = upgradeCandidates({ account, members: DECK, catalog, only: '나' });
  assert.deepEqual(maxed.candidates, []);
  assert.deepEqual(maxed.excluded.map((e) => [e.kind, e.code]), [['skill1', 'max'], ['skill2', 'max'], ['burst', 'max'], ['breakthrough', 'max'], ['core', 'max'], ['collection', 'max'], ['overload', 'max']]);
  assert.equal(maxed.excluded.at(-1).reason, `오버로드 ${OVERLOAD_LINE_MAX}줄이 모두 찼다.`);
  assert.equal(maxed.excluded.find((e) => e.kind === 'collection').reason, '소장품이 이미 최대(SR15)다.');

  const unknown = upgradeCandidates({ account, members: DECK, catalog, only: '다' });
  assert.deepEqual(idsOf(unknown.candidates), ['다 · 스킬 1 Lv.4 → Lv.5', '다 · 스킬 2 Lv.4 → Lv.5', '다 · 버스트 Lv.4 → Lv.5']);
  assert.deepEqual(unknown.excluded.map((e) => [e.kind, e.code]), [['breakthrough', 'unknown'], ['core', 'unknown'], ['collection', 'unknown'], ['overload', 'unknown']]);
  const noSkill = upgradeCandidates({ account: { nikkes: { 가: { unknown: ['skill_levels'] } } }, members: ['가'] });
  assert.deepEqual(noSkill.excluded[0], { nikke: '가', kind: 'skill1', label: '스킬', code: 'unknown', reason: '스킬 레벨이 미확인이라 한 단계 위를 정할 수 없다.' });
  assert.equal(noSkill.candidates.some((c) => c.kind.startsWith('skill') || c.kind === 'burst'), false);
});

test('후보: 적지 않은 칸은 키우지 않은 값에서 한 단계 — 소장품이 없으면 후보가 아니고, 코어 강화는 돌파 3 뒤에만', () => {
  const blank = upgradeCandidates({ account, members: DECK, catalog, only: '라' });
  assert.deepEqual(idsOf(blank.candidates).slice(0, 4), ['라 · 스킬 1 Lv.1 → Lv.2', '라 · 스킬 2 Lv.1 → Lv.2', '라 · 버스트 Lv.1 → Lv.2', '라 · 돌파 0 → 1']);
  assert.equal(blank.candidates.filter((c) => c.kind.startsWith('overload:')).length, 9);
  assert.deepEqual(blank.excluded, [
    { nikke: '라', kind: 'core', label: '코어 강화', code: 'locked', reason: '코어 강화는 돌파 3 뒤에 열린다(지금 돌파 0).' },
    { nikke: '라', kind: 'collection', label: '소장품', code: 'none', reason: '소장품이 없다(또는 계정에 적혀 있지 않다) — 어느 등급을 얻을지 알 수 없어 후보로 만들지 않는다.' },
  ]);

  // SR 등급: 돌파 후보에 「한도를 확인하지 못했다」는 메모가 붙는다. R15는 R의 최대다. 오버로드 장비가 두 부위뿐이면 옵션마다 두 줄까지다.
  const sr = upgradeCandidates({ account, members: DECK, catalog, only: '바' });
  const bt = sr.candidates.find((c) => c.kind === 'breakthrough');
  assert.equal(bt.id, '바 · 돌파 2 → 3');
  assert.match(bt.notes[0], /^SR 등급 니케의 돌파 한도는 이 앱이 확인하지 못했다/);
  assert.deepEqual(upgradeCandidates({ account, members: DECK, catalog, only: '가' }).candidates.every((c) => c.notes.length === 0), true);
  assert.equal(sr.excluded.find((e) => e.kind === 'core').code, 'locked');
  assert.equal(sr.excluded.find((e) => e.kind === 'collection').reason, '소장품이 R 등급의 최대(15)다 — SR은 다른 소장품이라 후보로 만들지 않는다.');
  assert.deepEqual(sr.excluded.find((e) => e.kind === 'overload:atk_pct'), { nikke: '바', kind: 'overload:atk_pct', label: '오버로드 공격력', code: 'max', reason: '공격력 옵션이 이미 2줄이다(부위마다 한 줄로 본다).' });
  assert.equal(sr.candidates.filter((c) => c.kind.startsWith('overload:')).length, 8);
  // 두 부위 × 세 줄이 다 차면 더 놓을 자리가 없다.
  const full = { nikkes: { 바: { ...account.nikkes.바, overload: { 공격력: 2, 우월코드: 2, 최대장탄: 2 } } } };
  assert.equal(upgradeCandidates({ account: full, members: ['바'] }).excluded.find((e) => e.kind === 'overload').reason, '오버로드 장비가 2부위뿐이라 줄을 더 놓을 자리가 없다(부위마다 3줄).');

  // 합산 수치로만 적힌 오버로드는 줄을 더할 수 없다(지원하지 않음).
  const aggregate = upgradeCandidates({ account, members: ['사'], catalog });
  assert.equal(aggregate.candidates.some((c) => c.kind.startsWith('overload:')), false);
  assert.deepEqual([aggregate.excluded.at(-1).kind, aggregate.excluded.at(-1).code], ['overload', 'unsupported']);
  assert.match(aggregate.excluded.at(-1).reason, /줄 단위로 바꿔 볼 수 없다\(지원하지 않음\)/);
  // 소장품 표기.
  assert.deepEqual([readCollectionStage('R0'), readCollectionStage('SR15'), readCollectionStage('없음'), readCollectionStage(undefined)], [{ grade: 'R', level: 0 }, { grade: 'SR', level: 15 }, { grade: null, level: null }, { grade: null, level: null }]);
  for (const bad of ['SSR3', 'SR16', 'R', 7]) assert.equal(readCollectionStage(bad), null);
});

test('후보: 순서는 종류 → 자리 순서다(상한에 걸리면 뒤의 종류부터 빠진다). 같은 입력이면 같은 목록이다', () => {
  const all = upgradeCandidates({ account, members: DECK, catalog });
  const kindIndex = all.candidates.map((c) => CANDIDATE_KINDS.indexOf(c.kind));
  assert.deepEqual(kindIndex, [...kindIndex].sort((a, b) => a - b));
  assert.deepEqual(all.candidates.filter((c) => c.kind === 'skill1').map((c) => c.nikke), ['가', '다', '라']);
  assert.equal(all.candidates.at(-1).kind, 'overload:def_pct');
  assert.equal(new Set(idsOf(all.candidates)).size, all.candidates.length);
  assert.deepEqual(upgradeCandidates({ account, members: DECK, catalog }), all);
  // 편성에 없는 니케·보유하지 않은 니케의 후보는 만들지 않는다.
  assert.equal(all.candidates.some((c) => c.nikke === '사'), false);
  assert.deepEqual(upgradeCandidates({ account, members: ['없는 니케'], catalog }), { candidates: [], excluded: [] });
  assert.deepEqual(CANDIDATE_KINDS.slice(0, 6), ['skill1', 'skill2', 'burst', 'breakthrough', 'core', 'collection']);
  assert.equal(CANDIDATE_KINDS.length, 6 + Object.keys(OVERLOAD_OPTIONS).length);
});

// ── 육성 효율표 ────────────────────────────────────────────────────────────────

test('효율표: 후보마다 계산해 총딜 증가율 순으로 — 무엇을 올리는지와 비용을 모른다는 것이 함께 온다', async () => {
  const log = [];
  const report = await efficiencyTable({ account, opponent: kraken(), members: DECK }, { only: '가' }, deps(log));
  // 엔진에 간 것: 기준 1건 + 후보 13건.
  assert.equal(log.length, 14);
  assert.equal(report.kind, 'growth_efficiency');
  assert.equal(report.key, deckKey(DECK, 'boss:kraken'));
  assert.equal(report.only, '가');
  assert.deepEqual(report.members, DECK);
  assert.deepEqual(report.candidates, { total: 13, limit: DEFAULT_EFFICIENCY_LIMIT, computed: 13, failed: 0, skipped: 0 });
  // 가짜 엔진에서 「가」의 힘: 오버로드 공격력 한 줄 +9, 우월 코드 +7(레벨 10 한 줄), 코어 강화 +7, 버스트 +5, 최대 장탄 +5 …
  assert.deepEqual(report.rows.slice(0, 4).map((r) => [r.rank, r.kind, r.label, r.from, r.to]), [
    [1, 'overload:atk_pct', '오버로드 공격력', '2줄', '3줄'],
    [2, 'core', '코어 강화', '3', '4'],
    [3, 'overload:element_bonus', '오버로드 우월 코드 대미지', '2줄', '3줄'],
    [4, 'burst', '버스트', 'Lv.9', 'Lv.10'],
  ]);
  const base = report.baseline.total_damage;
  const code = '가'.codePointAt(0);
  assert.equal(report.rows[0].gain, code * 9);
  assert.equal(report.rows[0].total_after, base + code * 9);
  assert.equal(report.rows[0].gain_rate, (code * 9) / base);
  for (const [i, row] of report.rows.entries()) {
    assert.equal(row.rank, i + 1);
    assert.equal(row.nikke, '가');
    if (i > 0) assert.ok(report.rows[i - 1].gain >= row.gain);
  }
  // 딜에 영향이 없는 것도 0%로 남는다(빼지 않는다).
  assert.deepEqual([report.rows.at(-1).kind, report.rows.at(-1).gain, report.rows.at(-1).gain_rate], ['overload:def_pct', 0, 0]);
  assert.deepEqual(report.baseline.members.map((m) => m.name), DECK);
  // 비용은 모른다 — 결과에 그렇게 적는다. 값을 지어내지 않는다.
  assert.equal(report.cost_known, false);
  assert.match(report.cost_note, /^비용은 모른다 — 재화와 필요 수량의 표가 이 앱에 없다/);
  assert.equal(report.caveats[0], report.cost_note);
  assert.equal(report.rows.some((r) => 'cost' in r || 'efficiency' in r), false);
  assert.match(report.caveats.join('\n'), /새 오버로드 줄은 레벨 10으로 본다/);
  assert.match(report.caveats.join('\n'), /후보로 만들지 않는 것: 호감도, 애장품 단계/);
  assert.match(report.caveats.join('\n'), /보스 패턴 미반영/);
  assert.equal(report.caveats.some((c) => c.startsWith('재화·비용은 고려하지 않았다')), false);
  assert.deepEqual(report.excluded.map((e) => e.kind), ['skill2', 'breakthrough']);
  assert.equal(report.account.is_test_data, true);
  assert.equal(report.opponent.unconfirmed.length, 7);
  // 같은 입력이면 같은 결과다(시각 고정).
  assert.deepEqual(await efficiencyTable({ account, opponent: kraken(), members: DECK }, { only: '가' }, deps()), report);
});

test('효율표: 편성 전체 — 니케가 섞여 순위에 오르고, 상한을 넘는 후보는 보지 못한 것으로 남는다', async () => {
  const log = [];
  const all = await efficiencyTable({ account, opponent: kraken(), members: DECK }, {}, deps(log));
  const made = upgradeCandidates({ account, members: DECK, catalog });
  assert.equal(all.candidates.total, made.candidates.length);
  assert.equal(all.rows.length, made.candidates.length);
  assert.equal(log.length, made.candidates.length + 1);
  assert.deepEqual(all.skipped, []);
  assert.ok(new Set(all.rows.map((r) => r.nikke)).size >= 4);
  assert.equal(all.rows.some((r) => r.nikke === '나'), false, '전부 최대인 니케는 후보가 없다');
  // SR 등급 돌파 후보의 메모가 줄에 실린다.
  assert.match(all.rows.find((r) => r.id === '바 · 돌파 2 → 3').notes[0], /SR 등급 니케의 돌파 한도/);

  const cut = await efficiencyTable({ account, opponent: kraken(), members: DECK }, { limit: 5 }, deps());
  assert.deepEqual(cut.candidates, { total: made.candidates.length, limit: 5, computed: 5, failed: 0, skipped: made.candidates.length - 5 });
  assert.deepEqual(cut.rows.map((r) => r.id).sort(), idsOf(made.candidates.slice(0, 5)).sort());
  assert.deepEqual(cut.skipped.map((s) => s.id), idsOf(made.candidates.slice(5)));
  assert.match(cut.caveats.join('\n'), new RegExp(`한 번에 5개까지만 계산한다\\. 올릴 수 있는 ${made.candidates.length}개 가운데 ${made.candidates.length - 5}개는 보지 못했다`));
});

test('효율표: 올릴 것이 없으면 계산하지 않는다(기준 총딜도 0이 아니라 없음). 잘못된 입력은 계산 전에 걸린다', async () => {
  const log = [];
  const none = await efficiencyTable({ account, opponent: kraken(), members: DECK }, { only: '나' }, deps(log));
  assert.equal(log.length, 0);
  assert.equal(none.baseline, null);
  assert.deepEqual(none.rows, []);
  assert.equal(none.candidates.total, 0);
  assert.equal(none.excluded.length, 7);
  assert.equal(none.cost_known, false);

  await assert.rejects(efficiencyTable({ account, opponent: kraken(), members: ['가', '나', null, null, null] }, {}, deps()), (e) => e instanceof InputError && /다섯 자리를 모두 채워야 계산한다 \(지금 2명\)/.test(e.message));
  await assert.rejects(efficiencyTable({ account, opponent: null, members: DECK }, {}, deps()), /상대/);
  await assert.rejects(efficiencyTable({ account, opponent: kraken(), members: DECK }, { only: '사' }, deps()), /기준 편성에 있는 니케여야 한다/);
  await assert.rejects(efficiencyTable({ account, opponent: kraken(), members: DECK }, { limit: 0 }, deps()), /limit은 1 이상의 정수/);
  // 보유하지 않은 니케가 든 편성은 성장 비교가 입력 오류로 끊는다.
  await assert.rejects(efficiencyTable({ account, opponent: kraken(), members: ['가', '나', '다', '라', '없는 니케'] }, {}, deps()), (e) => e instanceof InputError);
});

test('효율표: 엔진이 계산하지 못한 후보는 0이 아니라 「계산하지 못한 것」이다', async () => {
  const failing = async (requests) => {
    const rows = await fakeEngine()(requests);
    return rows.map((row, i) => (requests[i].profile.chars.가.core_enhancement === 4 ? { error: { type: 'invalid_input', message: '가짜 오류', path: '/profile' } } : row));
  };
  const report = await efficiencyTable({ account, opponent: kraken(), members: DECK }, { only: '가' }, { catalog, runBatch: failing, now });
  assert.deepEqual(report.failed, [{ id: '가 · 코어 강화 3 → 4', nikke: '가', kind: 'core', label: '코어 강화', from: '3', to: '4', reason: '가짜 오류' }]);
  assert.equal(report.rows.some((r) => r.kind === 'core'), false);
  assert.deepEqual([report.candidates.computed, report.candidates.failed], [12, 1]);
  assert.match(report.caveats.join('\n'), /계산하지 못한 것 1개 — 0으로 두지 않고 뺐다/);
});

test('효율표: 같은 계산은 캐시에서 바로 나온다', async () => {
  const log = [];
  const runtime = withCache({ loadCatalog: () => catalog, engineVersion: () => ({ repo: 'fake', commit: 'abc', dirty: false }), runBatch: fakeEngine(log) }, createMemoryStore());
  const first = await efficiencyTable({ account, opponent: kraken(), members: DECK }, { only: '가' }, { runtime, now });
  assert.deepEqual(first.cache, { hits: 0, misses: 14, stored: 14, warnings: [] });
  const again = await efficiencyTable({ account, opponent: kraken(), members: DECK }, { only: '가' }, { runtime, now });
  assert.deepEqual(again.cache, { hits: 14, misses: 0, stored: 0, warnings: [] });
  assert.equal(log.length, 14);
  assert.deepEqual(again.rows, first.rows);
});

// ── 오버로드 옵션 바꿔 보기 ────────────────────────────────────────────────────

test('오버로드: 계정의 줄 수·줄 레벨을 줄 목록으로 읽는다 — 미확인·합산 수치·읽을 수 없는 표기는 그렇게 말한다', () => {
  const read = overloadState(account.nikkes.가);
  assert.equal(read.status, 'lines');
  assert.deepEqual(read.lines, [{ id: 'atk_pct', level: 10 }, { id: 'atk_pct', level: 10 }, { id: 'element_bonus', level: 11 }, { id: 'element_bonus', level: 9 }]);
  assert.deepEqual(overloadState({}), { status: 'lines', lines: [], reason: null });
  assert.equal(overloadState(account.nikkes.다).status, 'unknown');
  assert.match(overloadState(account.nikkes.다).reason, /미확인이다 — 지금 값은 옵션이 없는 것으로 계산한다/);
  assert.equal(overloadState(account.nikkes.사).status, 'aggregate');
  assert.match(overloadState(account.nikkes.사).reason, /지원하지 않음/);
  assert.equal(overloadState({ overload: { 크리티컬: 1 } }).status, 'unreadable');
  assert.equal(overloadState({ overload: { 공격력: [16] } }).status, 'unreadable');
  assert.deepEqual(overloadSummary(read.lines), [{ id: 'atk_pct', name: '공격력', levels: [10, 10] }, { id: 'element_bonus', name: '우월 코드 대미지', levels: [11, 9] }]);
});

test('오버로드: 줄을 네 부위 × 세 줄에 차례로 놓는다 — 같은 옵션은 되도록 서로 다른 부위에', () => {
  const { parts, overflow } = layoutOverload(overloadState(account.nikkes.가).lines);
  assert.deepEqual(parts.map((p) => p.part), OVERLOAD_PARTS);
  assert.deepEqual(parts.map((p) => p.lines.map((l) => (l ? `${l.id}:${l.level}` : null))), [
    ['atk_pct:10', 'element_bonus:11', null],
    ['atk_pct:10', 'element_bonus:9', null],
    [null, null, null],
    [null, null, null],
  ]);
  assert.deepEqual(overflow, []);
  // 열두 줄(옵션 셋 × 네 줄)은 부위마다 옵션 셋이 한 줄씩이다. 그보다 많으면 넘친 줄로 남는다.
  const twelve = layoutOverload(overloadState(account.nikkes.나).lines);
  assert.deepEqual(twelve.parts.map((p) => p.lines.map((l) => l.id)), OVERLOAD_PARTS.map(() => ['atk_pct', 'element_bonus', 'max_ammo_pct']));
  const five = layoutOverload(Array.from({ length: 5 }, () => ({ id: 'atk_pct', level: 10 })));
  assert.deepEqual(five.parts.map((p) => p.lines.filter(Boolean).length), [2, 1, 1, 1]);
  assert.equal(layoutOverload(Array.from({ length: 13 }, () => ({ id: 'atk_pct', level: 10 }))).overflow.length, 1);
  assert.deepEqual(emptyOverloadParts().map((p) => p.lines), OVERLOAD_PARTS.map(() => [null, null, null]));
  // 놓았다가 다시 모으면 같은 줄이다.
  assert.deepEqual(overloadFromParts(parts).lines, overloadState(account.nikkes.가).lines);
});

test('오버로드: 화면에서 짠 부위별 줄 → 옵션 9종을 모두 적은 overload. 잘못된 줄은 계산하지 않고, 같은 부위의 같은 옵션은 알린다', () => {
  const parts = emptyOverloadParts();
  parts[0].lines = [{ id: 'atk_pct', level: 12 }, { id: 'crit_rate', level: 8 }, null];
  parts[3].lines = [{ id: 'atk_pct', level: 15 }, null, null];
  const built = overloadFromParts(parts);
  assert.deepEqual(Object.keys(built.overload), Object.values(OVERLOAD_OPTIONS));
  assert.deepEqual(built.overload.공격력, [15, 12]);
  assert.deepEqual(built.overload['크리티컬 확률'], [8]);
  assert.deepEqual(built.overload.방어력, []);
  assert.deepEqual([built.count, built.problems, built.notes], [3, [], []]);

  const dup = emptyOverloadParts();
  dup[1].lines = [{ id: 'atk_pct', level: 10 }, { id: 'atk_pct', level: 10 }, null];
  assert.deepEqual(overloadFromParts(dup).problems, []);
  assert.deepEqual(overloadFromParts(dup).notes, ['몸통에 공격력 옵션이 두 줄 이상이다 — 게임에서 되는 조합인지 이 앱은 확인하지 못했다. 계산은 그대로 한다.']);

  const bad = emptyOverloadParts();
  bad[0].lines = [{ id: 'hp_pct', level: 10 }, { id: 'atk_pct', level: 16 }, { id: 'atk_pct', level: 0 }];
  bad[1].lines = [null, null, null, { id: 'atk_pct', level: 1 }, { id: 'atk_pct', level: 1 }, { id: 'atk_pct', level: 1 }, { id: 'atk_pct', level: 1 }];
  assert.deepEqual(overloadFromParts(bad).problems, ['머리: 모르는 옵션이다(hp_pct)', '머리: 공격력 줄의 레벨은 1~15이어야 한다', '머리: 공격력 줄의 레벨은 1~15이어야 한다', '몸통: 옵션은 3줄까지다']);
  assert.notEqual(overloadTrialKey(DECK, 'boss:kraken', '가', built.lines), overloadTrialKey(DECK, 'boss:kraken', '가', []));
  assert.equal(overloadTrialKey(DECK, 'boss:kraken', '가', built.lines), overloadTrialKey(DECK, 'boss:kraken', '가', [...built.lines].reverse().sort((a, b) => b.level - a.level)));
});

test('오버로드 바꿔 보기: 니케 한 명의 옵션 줄을 바꾼 총딜 변화 — 계정은 바뀌지 않는다', async () => {
  const before = JSON.stringify(account);
  const log = [];
  const parts = layoutOverload(overloadState(account.nikkes.가).lines).parts;
  // 몸통의 우월 코드(레벨 9) 줄을 공격력 레벨 15로 바꾸고, 팔에 크리티컬 대미지 한 줄을 더한다.
  parts[1].lines[1] = { id: 'crit_dmg', level: 10 };
  parts[2].lines[0] = { id: 'atk_pct', level: 15 };
  const report = await tryOverload({ account, opponent: kraken(), members: DECK, nikke: '가', parts }, deps(log));
  assert.equal(JSON.stringify(account), before);
  assert.equal(log.length, 2);
  // 바꾼 니케의 프로필에는 옵션 9종이 모두 실린다(적지 않은 옵션이 남지 않는다).
  assert.deepEqual(log[1].profile.chars.가.overload, { 공격력: [15, 10, 10], 우월코드: [11], '최대 장탄 수': [], '크리티컬 확률': [], '크리티컬 대미지': [10], '차지 속도': [], '차지 대미지': [], 명중률: [], 방어력: [] });
  assert.deepEqual(log[0].profile.chars.나, log[1].profile.chars.나);
  assert.equal(report.kind, 'overload_trial');
  assert.equal(report.status, 'computed');
  assert.equal(report.nikke, '가');
  // 힘의 변화: 우월 코드 레벨 9 한 줄(−6.3) → 크리티컬 대미지 한 줄(+4), 공격력 레벨 15 한 줄(+13.5).
  const code = '가'.codePointAt(0);
  assert.ok(Math.abs(report.gain - code * (-6.3 + 4 + 13.5)) < 1e-6);
  assert.equal(report.total_after, report.total_before + report.gain);
  assert.equal(report.gain_rate, report.gain / report.total_before);
  assert.deepEqual(report.members.map((m) => m.name), DECK);
  assert.ok(report.members.filter((m) => m.name !== '가').every((m) => m.gain === 0));
  assert.deepEqual(report.before, { status: 'lines', options: [{ id: 'atk_pct', name: '공격력', levels: [10, 10] }, { id: 'element_bonus', name: '우월 코드 대미지', levels: [11, 9] }], count: 4 });
  assert.deepEqual(report.after.options.map((o) => [o.name, o.levels]), [['공격력', [15, 10, 10]], ['우월 코드 대미지', [11]], ['크리티컬 대미지', [10]]]);
  assert.equal(report.key, overloadTrialKey(DECK, 'boss:kraken', '가', overloadFromParts(parts).lines));
  assert.equal(report.caveats[0], '계정은 바뀌지 않는다 — 여기서만 바꿔 본 값이다.');
  assert.match(report.caveats.join('\n'), /어느 부위에 어느 옵션이 붙었는지는 계정 정보에 없다/);
  assert.deepEqual(await tryOverload({ account, opponent: kraken(), members: DECK, nikke: '가', parts }, deps()), report);
});

test('오버로드 바꿔 보기: 지금과 같으면 「달라지는 것이 없다」, 계산하지 못하면 0이 아니라 실패, 바꿀 수 없는 니케는 입력 오류', async () => {
  // 표기만 다르고(줄 수 2 ↔ [10, 10]) 줄은 같다.
  const same = await tryOverload({ account, opponent: kraken(), members: DECK, nikke: '가', parts: layoutOverload(overloadState(account.nikkes.가).lines).parts }, deps());
  assert.deepEqual([same.status, same.gain, same.gain_rate, same.total_after], ['same', 0, 0, same.total_before]);
  assert.equal(same.reason, '지금 계정의 옵션과 같다 — 달라지는 것이 없다.');

  // 미확인이던 오버로드: 빈 상태에서 시작하고 그렇게 알린다.
  const parts = emptyOverloadParts();
  parts[0].lines[0] = { id: 'atk_pct', level: 10 };
  const unknown = await tryOverload({ account, opponent: kraken(), members: DECK, nikke: '다', parts }, deps());
  assert.equal(unknown.status, 'computed');
  assert.equal(unknown.before.status, 'unknown');
  assert.equal(unknown.gain, '다'.codePointAt(0) * 3 * 9);
  assert.match(unknown.notes.join('\n'), /적용 전 값이 미확인이라 미육성으로 계산했다/);
  assert.match(unknown.notes.join('\n'), /오버로드가 미확인이다/);

  // 기준(첫 요청)은 계산하고, 바꾼 것은 계산하지 못하는 엔진.
  const engine = async (requests) => (await fakeEngine()(requests)).map((row, i) => (i === 0 ? row : { error: { type: 'invalid_input', message: '가짜 오류', path: '/profile' } }));
  const failed = await tryOverload({ account, opponent: kraken(), members: DECK, nikke: '가', parts }, { catalog, runBatch: engine, now });
  assert.deepEqual([failed.status, failed.total_after, failed.gain, failed.gain_rate, failed.reason], ['failed', null, null, null, '가짜 오류']);
  assert.ok(failed.total_before > 0);

  const sa = ['가', '나', '다', '라', '사'];
  await assert.rejects(tryOverload({ account, opponent: kraken(), members: sa, nikke: '사', parts }, deps()), (e) => e instanceof InputError && /오버로드를 바꿔 볼 수 없다.*지원하지 않음/.test(e.message));
  await assert.rejects(tryOverload({ account, opponent: kraken(), members: DECK, nikke: '사', parts }, deps()), /기준 편성에 있는 니케여야 한다/);
  const bad = emptyOverloadParts();
  bad[0].lines[0] = { id: 'atk_pct', level: 99 };
  await assert.rejects(tryOverload({ account, opponent: kraken(), members: DECK, nikke: '가', parts: bad }, deps()), /오버로드 옵션이 잘못됐다.*레벨은 1~15/);
});

// ── 큐브 ──────────────────────────────────────────────────────────────────────

test('큐브: 계정에 적혀 있지 않으면 계산 도구의 기본 큐브를 낀 것으로 본다', () => {
  assert.deepEqual(ENGINE_DEFAULT_CUBE, { name: '렐릭 베어 큐브', level: 15 });
  assert.deepEqual(currentCube({}), { name: '렐릭 베어 큐브', level: 15, source: 'default' });
  assert.deepEqual(currentCube({ cube: '가 큐브' }), { name: '가 큐브', level: 15, source: 'account' });
  assert.deepEqual(currentCube({ cube: { name: '나 큐브', level: 7 } }), { name: '나 큐브', level: 7, source: 'account' });
  assert.deepEqual(currentCube({ cube: { name: '나 큐브' } }), { name: '나 큐브', level: 15, source: 'account' });
  assert.equal(currentCube({ cube: 15 }).source, 'default');
  assert.equal(currentCube({ cube: '가 큐브', unknown: ['cube'] }).source, 'default');
});

test('큐브 후보: 엔진이 효과를 계산하는 큐브 가운데 지금 낀 것이 아닌 것 — 상한에 걸리면 큐브를 통째로 뺀다', () => {
  const made = cubeCandidates({ account, members: DECK, catalog });
  assert.equal(made.known, true);
  assert.deepEqual(made.targets, DECK);
  assert.deepEqual(made.unsupported, ['못 쓰는 큐브']);
  // 큐브(표의 순서) → 자리 순서. 지금 낀 것(기본 큐브)은 후보가 아니다. 레벨은 지금 레벨에 맞추되 그 큐브의 최대 레벨을 넘지 않는다.
  assert.deepEqual(made.candidates.map((c) => `${c.nikke}:${c.cube}:${c.level}`), [
    ...DECK.map((n) => `${n}:가 큐브:15`),
    ...DECK.map((n) => `${n}:나 큐브:15`),
    ...DECK.map((n) => `${n}:낮은 큐브:10`),
  ]);
  assert.deepEqual(made.candidates[0].upgrade, { name: '가 · 큐브 가 큐브', nikke: '가', set: { cube: { name: '가 큐브', level: 15 } } });
  assert.deepEqual([made.skipped_cubes, made.skipped], [[], 0]);
  assert.equal(DEFAULT_CUBE_LIMIT, 80);

  // 상한 10건 ÷ 다섯 명 = 큐브 두 종까지(기본 큐브 포함) → 「가 큐브」만 견준다.
  const cut = cubeCandidates({ account, members: DECK, catalog, limit: 10 });
  assert.deepEqual(cut.candidates.map((c) => c.cube), DECK.map(() => '가 큐브'));
  assert.deepEqual([cut.skipped_cubes, cut.skipped], [['나 큐브', '낮은 큐브'], 10]);
  // 한 명만 보면 같은 상한으로 더 많은 큐브를 본다.
  const one = cubeCandidates({ account, members: DECK, catalog, only: '나', limit: 10 });
  assert.deepEqual(one.candidates.map((c) => `${c.nikke}:${c.cube}`), ['나:가 큐브', '나:나 큐브', '나:낮은 큐브']);
  // 계정에 큐브가 적힌 니케는 그 큐브가 지금 것이다.
  const worn = { nikkes: { 가: { cube: { name: '가 큐브', level: 7 } } } };
  const mine = cubeCandidates({ account: worn, members: ['가'], catalog });
  assert.deepEqual(mine.current.가, { name: '가 큐브', level: 7, source: 'account' });
  assert.deepEqual(mine.candidates.map((c) => `${c.cube}:${c.level}`), ['렐릭 베어 큐브:7', '나 큐브:7', '낮은 큐브:7']);
  assert.equal(cubeCandidates({ account, members: DECK, catalog: { nikkes: {}, bosses: [] } }).known, false);
});

test('큐브 비교: 니케마다 큐브를 바꿔 본 총딜과, 가장 좋았던 것을 함께 끼운 「이 편성에 맞는 큐브」', async () => {
  const before = JSON.stringify(account);
  const log = [];
  const report = await compareCubes({ account, opponent: kraken(), members: DECK }, {}, deps(log));
  assert.equal(JSON.stringify(account), before);
  // 엔진에 간 것: 기준 1 + 다섯 명 × 큐브 셋 + 함께 끼운 것 1(+ 그때의 기준 1 — 캐시가 없으면 다시 계산한다).
  assert.equal(log.length, 1 + 15 + 2);
  assert.equal(report.kind, 'cube_report');
  assert.equal(report.key, deckKey(DECK, 'boss:kraken'));
  assert.deepEqual(report.nikkes.map((n) => n.nikke), DECK);
  const base = report.baseline.total_damage;
  const of = (name) => report.nikkes.find((n) => n.nikke === name);
  // 「가」: 가 큐브 +40, 나 큐브 −5, 낮은 큐브 −20 (총딜이 큰 순).
  assert.deepEqual(of('가').rows.map((r) => [r.cube, r.level, r.gain]), [['가 큐브', 15, '가'.codePointAt(0) * 40], ['나 큐브', 15, '가'.codePointAt(0) * -5], ['낮은 큐브', 10, '가'.codePointAt(0) * -20]]);
  assert.equal(of('가').rows[0].change, ('가'.codePointAt(0) * 40) / base);
  assert.deepEqual(of('가').current, { name: '렐릭 베어 큐브', level: 15, source: 'default', owned_level: null });
  assert.deepEqual(of('가').best, { cube: '가 큐브', level: 15, change: ('가'.codePointAt(0) * 40) / base });
  // 계정에서 본 보유 레벨(장착 중이던 것의 하한)은 그 큐브에만 붙는다 — 나머지는 모른다(null).
  assert.deepEqual(of('가').rows.map((r) => r.owned_level), [7, null, null]);
  // 「나」에게는 가 큐브(+5)보다 나 큐브(+30)가 좋다.
  assert.equal(of('나').best.cube, '나 큐브');
  // 추천: 니케마다 가장 좋았던 것. 함께 끼운 총딜은 한 번 더 계산한 값이다.
  assert.deepEqual(report.recommendation.picks.map((p) => [p.nikke, p.cube, p.changed]), [['가', '가 큐브', true], ['나', '나 큐브', true], ['다', '가 큐브', true], ['라', '가 큐브', true], ['바', '가 큐브', true]]);
  const together = '가'.codePointAt(0) * 40 + '나'.codePointAt(0) * 2 * 30 + '다'.codePointAt(0) * 3 * 5 + '라'.codePointAt(0) * 4 * 5 + '바'.codePointAt(0) * 5 * 5;
  assert.deepEqual([report.recommendation.status, report.recommendation.gain, report.recommendation.total_damage], ['computed', together, base + together]);
  assert.equal(report.recommendation.gain_rate, together / base);
  assert.deepEqual(log.at(-1).squad.map((n) => log.at(-1).profile.chars[n].cube), [{ name: '가 큐브', level: 15 }, { name: '나 큐브', level: 15 }, { name: '가 큐브', level: 15 }, { name: '가 큐브', level: 15 }, { name: '가 큐브', level: 15 }]);
  assert.deepEqual(report.candidates, { total: 15, limit: DEFAULT_CUBE_LIMIT, computed: 15, failed: 0, skipped: 0 });
  // 한계를 적는다: 보유 큐브를 모른다, 같은 레벨로 견줬다, 기본 큐브, 지원하지 않는 큐브.
  assert.match(report.caveats[0], /^보유 큐브는 모른다 — 계정 정보에는 계정을 받을 때 끼고 있던 큐브와 그 레벨만 있다/);
  assert.match(report.caveats.join('\n'), /같은 레벨\(Lv\.10·15\)로 계산했다/);
  assert.match(report.caveats.join('\n'), /계산 도구의 기본 큐브\(렐릭 베어 큐브 Lv\.15\)를 낀 것으로 계산한다/);
  assert.match(report.caveats.join('\n'), /지원하지 않음: 못 쓰는 큐브 — 계산 도구가 효과를 계산하지 못하는 큐브라 견주지 않았다/);
  assert.deepEqual(report.unsupported, ['못 쓰는 큐브']);
  assert.deepEqual(await compareCubes({ account, opponent: kraken(), members: DECK }, {}, deps()), report);
});

test('큐브 비교: 한 명만 · 더 좋은 큐브가 없을 때 · 상한 · 계산하지 못한 큐브 · 큐브 목록이 없을 때', async () => {
  // 한 명만: 추천이 하나뿐이면 함께 끼운 값은 그 줄의 값이다(더 계산하지 않는다).
  const log = [];
  const one = await compareCubes({ account, opponent: kraken(), members: DECK }, { only: '나' }, deps(log));
  assert.equal(log.length, 4);
  assert.deepEqual(one.nikkes.map((n) => n.nikke), ['나']);
  assert.deepEqual([one.recommendation.status, one.recommendation.gain], ['computed', '나'.codePointAt(0) * 2 * 30]);

  // 지금 큐브보다 나은 것이 없으면 「그대로」다.
  const worn = structuredClone(account);
  worn.nikkes.가.cube = { name: '가 큐브', level: 15 };
  const kept = await compareCubes({ account: worn, opponent: kraken(), members: DECK }, { only: '가' }, deps());
  assert.deepEqual(kept.nikkes[0].current, { name: '가 큐브', level: 15, source: 'account', owned_level: 7 });
  assert.equal(kept.nikkes[0].best, null);
  assert.ok(kept.nikkes[0].rows.every((r) => r.gain < 0));
  assert.deepEqual(kept.recommendation.picks, [{ nikke: '가', cube: '가 큐브', level: 15, changed: false, alone_change: null, owned_level: 7 }]);
  assert.deepEqual([kept.recommendation.status, kept.recommendation.gain, kept.recommendation.total_damage], ['unchanged', 0, kept.baseline.total_damage]);

  // 상한: 보지 못한 큐브를 적는다.
  const cut = await compareCubes({ account, opponent: kraken(), members: DECK }, { limit: 10 }, deps());
  assert.deepEqual(cut.skipped_cubes, ['나 큐브', '낮은 큐브']);
  assert.deepEqual(cut.candidates, { total: 15, limit: 10, computed: 5, failed: 0, skipped: 10 });
  assert.match(cut.caveats.join('\n'), /한 번에 10건까지만 계산한다\. 보지 못한 큐브 2종: 나 큐브, 낮은 큐브/);

  // 엔진이 계산하지 못한 큐브는 0이 아니라 빠진다.
  const failed = await compareCubes({ account, opponent: kraken(), members: DECK }, { only: '가' }, deps([], '낮은 큐브'));
  assert.deepEqual(failed.failed, [{ nikke: '가', cube: '낮은 큐브', reason: '효과 모델이 없는 큐브: 낮은 큐브' }]);
  assert.deepEqual(failed.nikkes[0].rows.map((r) => r.cube), ['가 큐브', '나 큐브']);
  assert.match(failed.caveats.join('\n'), /계산하지 못한 것 1건 — 0으로 두지 않고 뺐다/);

  // 큐브 목록을 모르면 바꿔 볼 수 없다고 말한다(지어내지 않는다).
  await assert.rejects(compareCubes({ account, opponent: kraken(), members: DECK }, {}, { catalog: { nikkes: catalog.nikkes, bosses: [] }, runBatch: fakeEngine(), now }), (e) => e instanceof InputError && /큐브 목록이 없다/.test(e.message));
  await assert.rejects(compareCubes({ account, opponent: kraken(), members: DECK }, { only: '사' }, deps()), /기준 편성에 있는 니케여야 한다/);
});
