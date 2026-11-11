// 성장 투자 비교: 업그레이드 후보를 계정 상태에 가상 적용 → 기준 편성의 총딜 변화 → 증가율 순위.
// 원래 계정 문서는 바꾸지 않는다(후보마다 복사본에 적용한다). 재화·비용은 다루지 않는다 — 후보는 입력이다.
// 형식 설명은 docs/data-model.md §성장 투자 비교.
import { validateAccount, toEngineProfile, GROWTH_FIELDS } from './account.mjs';
import { validateCondition, toEngineBase, assumptionsOf } from './condition.mjs';
import { InputError, squadProblems, squadNotes } from './compare.mjs';
import { runBatch as defaultRunBatch, loadCatalog, engineVersion } from './engine.mjs';

export const GROWTH_REPORT_SCHEMA_VERSION = 1;

/** `add`(현재 값에 더하기)를 쓸 수 있는 칸. 미육성 기준값이 분명한 칸만이다(엔진 `spec.py` UNGROWN). */
export const ADDABLE_FIELDS = ['skill_levels', 'breakthrough', 'core_enhancement', 'overload'];
const UNGROWN_SKILLS = [1, 1, 1];
const UPGRADE_KEYS = ['name', 'note', 'nikke', 'set', 'add', 'changes'];
const CHANGE_KEYS = ['nikke', 'set', 'add'];

// 오버로드 옵션의 엔진 키 ↔ 인게임 이름(vendor/nikke-calc/docs/SIM-JSON.md §육성). 옵션 이름을 검사하려는 게
// 아니라, 계정에 "우월 코드 대미지"로 적힌 옵션에 후보가 "우월코드"로 더해도 같은 옵션으로 합치기 위한 표다.
// 여기 없는 이름은 글자 그대로만 비교하고, 맞는 이름인지는 엔진이 판정한다.
const OVERLOAD_OPTIONS = {
  atk_pct: '공격력',
  element_bonus: '우월 코드 대미지',
  max_ammo_pct: '최대 장탄 수',
  crit_rate: '크리티컬 확률',
  crit_dmg: '크리티컬 대미지',
  charge_speed_pct: '차지 속도',
  charge_dmg_pct: '차지 대미지',
  accuracy_pct: '명중률',
  def_pct: '방어력',
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 증가율 = (적용 후 − 적용 전) / 적용 전. 0.05 = 5% 증가, 음수 = 감소.
 * 적용 전 총딜이 0 이하이거나 수가 아니면 비율을 정할 수 없어 null이다.
 */
export function gainRate(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
  return (after - before) / before;
}

/** 오버로드 옵션 이름 → 엔진 키. 공백은 무시하고, 앞부분만 적어도 하나로 정해지면 받는다. 못 정하면 null. */
function overloadId(name) {
  const s = String(name).replace(/\s+/g, '');
  if (s === '') return null;
  if (Object.hasOwn(OVERLOAD_OPTIONS, s)) return s;
  const hits = Object.entries(OVERLOAD_OPTIONS).filter(([, ko]) => ko.replace(/\s+/g, '').startsWith(s));
  return hits.length === 1 ? hits[0][0] : null;
}

/** 이미 적혀 있는 같은 옵션의 키(표기가 달라도). 없으면 후보가 쓴 이름 그대로. */
function overloadKeyIn(overload, name) {
  const id = overloadId(name);
  return Object.keys(overload).find((k) => k === name || (id !== null && overloadId(k) === id)) ?? name;
}

/** 객체는 재귀 병합, 그 밖의 값은 교체 — 엔진 프로필 항목의 병합 규칙과 같다. */
function merge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return structuredClone(patch);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base[k], v);
  return out;
}

function setField(field, current, value) {
  if (field === 'overload' && isPlainObject(current) && isPlainObject(value)) {
    const out = structuredClone(current);
    for (const [opt, v] of Object.entries(value)) out[overloadKeyIn(out, opt)] = structuredClone(v);
    return out;
  }
  return merge(current, value);
}

/** 현재 값(없으면 미육성 값)에 더한다. 더할 수 없으면 `{problem}`. */
function addField(field, current, delta) {
  if (field === 'skill_levels') {
    if (!Array.isArray(delta) || delta.length !== 3 || !delta.every(isNonNegInt)) return { problem: 'skill_levels에 더할 값은 [0 이상 정수 3개]여야 한다' };
    const base = current ?? UNGROWN_SKILLS;
    if (!Array.isArray(base) || base.length !== 3) return { problem: '현재 skill_levels가 [a, b, c] 표기가 아니라 더할 수 없다 — set을 써라' };
    return { value: base.map((v, i) => v + delta[i]) };
  }
  if (field === 'breakthrough' || field === 'core_enhancement') {
    if (!isNonNegInt(delta)) return { problem: `${field}에 더할 값은 0 이상의 정수여야 한다` };
    return { value: (current ?? 0) + delta };
  }
  // overload
  if (!isPlainObject(delta)) return { problem: 'overload에 더할 값은 {옵션: 줄 수}여야 한다' };
  if (current !== undefined && !isPlainObject(current)) return { problem: '현재 overload가 {옵션: 줄 수} 표기가 아니라 더할 수 없다' };
  const out = structuredClone(current ?? {});
  for (const [opt, d] of Object.entries(delta)) {
    const key = overloadKeyIn(out, opt);
    const cur = out[key];
    if (isNonNegInt(d) && (cur === undefined || isNonNegInt(cur))) out[key] = (cur ?? 0) + d;
    else if (Array.isArray(d) && (cur === undefined || Array.isArray(cur))) out[key] = [...(cur ?? []), ...d];
    else if (!isNonNegInt(d) && !Array.isArray(d)) return { problem: `overload ${opt}에 더할 값은 줄 수(0 이상 정수)나 [줄별 레벨]이어야 한다` };
    else return { problem: `overload ${opt}: 줄 수 표기와 줄별 레벨 표기는 서로 더할 수 없다 — 같은 표기로 주거나 set을 써라` };
  }
  return { value: out };
}

/** 후보 하나를 `[{nikke, set?, add?}]`로 편다. 한 니케만 바꾸는 후보는 `changes` 없이 바로 적어도 된다. */
function changesOf(upgrade, problems) {
  if (!isPlainObject(upgrade)) {
    problems.push('업그레이드 후보는 객체여야 한다');
    return [];
  }
  for (const k of Object.keys(upgrade)) if (!UPGRADE_KEYS.includes(k)) problems.push(`모르는 칸이다: ${k}`);
  const inline = ['nikke', 'set', 'add'].some((k) => k in upgrade);
  if ('changes' in upgrade) {
    if (inline) problems.push('changes와 nikke·set·add를 함께 쓸 수 없다');
    if (!Array.isArray(upgrade.changes) || upgrade.changes.length === 0) {
      problems.push('changes는 변경을 하나 이상 담은 배열이어야 한다');
      return [];
    }
    return upgrade.changes;
  }
  if (!inline) problems.push('바꿀 내용이 없다 — nikke와 set 또는 add를 적어라');
  return inline ? [{ nikke: upgrade.nikke, set: upgrade.set, add: upgrade.add }] : [];
}

/**
 * 업그레이드 후보를 계정 문서의 **복사본**에 적용한다. 받은 계정 문서는 바꾸지 않는다.
 *
 * 후보: `{name?, nikke, set?, add?}` 또는 `{name?, changes: [{nikke, set?, add?}, ...]}`
 *   set — 육성 칸을 그 값으로 만든다(객체 칸은 적은 키만 바꾼다).
 *   add — 현재 값에 더한다(ADDABLE_FIELDS만). 적지 않은 칸은 미육성 값에서 더한다.
 *
 * 값의 범위(스킬 레벨 10 초과 등)는 여기서 보지 않는다 — 결과 계정을 `validateAccount`로 검사한다.
 * @returns {{account: object|null, changes: {nikke: string, field: string, before: any, after: any}[], notes: string[], problems: string[]}}
 *   problems가 있으면 적용할 수 없는 후보이고 account는 null이다. before가 null이면 적지 않았거나 미확인이던 칸이다.
 */
export function applyUpgrade(account, upgrade) {
  const problems = [];
  const notes = [];
  const applied = [];
  const next = structuredClone(account);

  for (const [i, change] of changesOf(upgrade, problems).entries()) {
    const at = `변경 ${i + 1}`;
    if (!isPlainObject(change)) {
      problems.push(`${at}: 객체여야 한다`);
      continue;
    }
    for (const k of Object.keys(change)) if (!CHANGE_KEYS.includes(k)) problems.push(`${at}: 모르는 칸이다: ${k}`);
    const { nikke } = change;
    if (typeof nikke !== 'string' || nikke === '') {
      problems.push(`${at}: nikke에 니케 이름을 적어야 한다`);
      continue;
    }
    if (!isPlainObject(next.nikkes) || !Object.hasOwn(next.nikkes, nikke) || !isPlainObject(next.nikkes[nikke])) {
      problems.push(`보유하지 않은 니케: ${nikke}`);
      continue;
    }
    const set = change.set ?? {};
    const add = change.add ?? {};
    if (!isPlainObject(set) || !isPlainObject(add)) {
      problems.push(`${nikke}: set과 add는 {육성 칸: 값} 객체여야 한다`);
      continue;
    }
    if (Object.keys(set).length + Object.keys(add).length === 0) {
      problems.push(`${nikke}: 바꿀 내용이 없다 — set 또는 add를 적어라`);
      continue;
    }

    const entry = next.nikkes[nikke];
    const unknown = Array.isArray(entry.unknown) ? entry.unknown : [];
    const record = (field, before, after) => applied.push({ nikke, field, before: before === undefined ? null : structuredClone(before), after });

    for (const [field, value] of Object.entries(set)) {
      if (!GROWTH_FIELDS.includes(field)) {
        problems.push(`${nikke}: 모르는 육성 칸이다: ${field}`);
        continue;
      }
      if (field in add) {
        problems.push(`${nikke}: ${field}을(를) set과 add에 함께 적었다`);
        continue;
      }
      if (unknown.includes(field)) {
        entry.unknown = entry.unknown.filter((k) => k !== field);
        if (entry.unknown.length === 0) delete entry.unknown;
        notes.push(`${nikke}: ${field}의 적용 전 값이 미확인이라 미육성으로 계산했다 — 증가율이 실제보다 크게 나올 수 있다`);
      }
      const before = entry[field];
      entry[field] = setField(field, before, value);
      record(field, before, entry[field]);
    }

    for (const [field, delta] of Object.entries(add)) {
      if (field in set) continue; // 위에서 이미 문제로 적었다
      if (!ADDABLE_FIELDS.includes(field)) {
        problems.push(`${nikke}: ${field}에는 add를 쓸 수 없다 (쓸 수 있는 칸: ${ADDABLE_FIELDS.join(', ')}) — set을 써라`);
        continue;
      }
      if (unknown.includes(field)) {
        problems.push(`${nikke}: ${field}은(는) 미확인 칸이라 더할 기준 값이 없다 — set으로 적용 후 값을 적어라`);
        continue;
      }
      const before = entry[field];
      const r = addField(field, before, delta);
      if (r.problem) {
        problems.push(`${nikke}: ${r.problem}`);
        continue;
      }
      entry[field] = r.value;
      record(field, before, r.value);
    }
  }

  if (problems.length) return { account: null, changes: [], notes: [], problems };
  return { account: next, changes: applied, notes, problems };
}

const memberRows = (members) => members.map((m) => ({ name: m.name, damage: m.damage, share: m.share }));

/**
 * 업그레이드 후보마다 기준 편성의 적용 전후 총딜과 증가율을 계산해 증가율 순으로 돌려준다.
 * 엔진 호출은 기준 1건 + 계산할 후보 수만큼이다(한 배치).
 *
 * @param {object} input
 * @param {object} input.account   계정 상태 문서 — 바꾸지 않는다
 * @param {object} input.condition 전투 조건 문서
 * @param {{name?: string, members: string[]}} input.squad 기준 편성
 * @param {object[]} input.upgrades 업그레이드 후보 (`applyUpgrade` 참고)
 * @param {object} [deps] compareSquads와 같다
 */
export async function compareGrowth({ account, condition, squad, upgrades }, deps = {}) {
  const catalog = deps.catalog ?? loadCatalog(deps.engineDir);
  const runBatch = deps.runBatch ?? defaultRunBatch;

  const a = validateAccount(account, catalog);
  if (!a.ok) throw new InputError('계정 상태가 잘못됐다', a.errors);
  const c = validateCondition(condition, catalog);
  if (!c.ok) throw new InputError('전투 조건이 잘못됐다', c.errors);
  if (!isPlainObject(squad)) throw new InputError('기준 편성이 없다', [{ path: '/squad', message: '{name, members} 객체여야 한다' }]);
  const squadErrors = squadProblems(squad, account, catalog);
  if (squadErrors.length) throw new InputError('기준 편성이 잘못됐다', squadErrors.map((message) => ({ path: '/squad', message })));
  if (!Array.isArray(upgrades) || upgrades.length === 0) {
    throw new InputError('업그레이드 후보가 없다', [{ path: '/upgrades', message: '후보를 하나 이상 줘야 한다' }]);
  }

  const members = squad.members;
  const base = toEngineBase(condition);
  const baseProfile = toEngineProfile(account, members);

  const rejected = [];
  const accepted = [];
  for (const [i, u] of upgrades.entries()) {
    const name = typeof u?.name === 'string' && u.name !== '' ? u.name : `후보 ${i + 1}`;
    const r = applyUpgrade(account, u);
    const reasons = [...r.problems];
    if (r.account) {
      const v = validateAccount(r.account, catalog);
      if (!v.ok) reasons.push(...v.errors.map((e) => `적용 후 값이 범위를 벗어난다: ${e.path} ${e.message}`));
    }
    const notes = [...r.notes];
    let profile = null;
    if (reasons.length === 0) {
      const touched = [...new Set(r.changes.map((ch) => ch.nikke))];
      const outside = touched.filter((n) => !members.includes(n));
      profile = toEngineProfile(r.account, members);
      if (outside.length === touched.length) reasons.push(`기준 편성에 없는 니케만 바꾼다(${outside.join(', ')}) — 이 편성의 총딜은 달라지지 않는다`);
      else if (same(profile, baseProfile)) reasons.push('현재 상태와 같다 — 달라지는 것이 없다');
      else if (outside.length) notes.push(`기준 편성에 없는 니케의 변경은 총딜에 반영되지 않는다: ${outside.join(', ')}`);
    }
    if (reasons.length) rejected.push({ name, reasons });
    else accepted.push({ name, changes: r.changes, notes, profile });
  }

  const requests = [
    { ...base, squad: members, profile: baseProfile },
    ...accepted.map((u) => ({ ...base, squad: members, profile: u.profile })),
  ];
  const results = await runBatch(requests, { engineDir: deps.engineDir, concurrency: deps.concurrency });

  const before = results[0];
  if (before.error) {
    throw new InputError('기준 편성을 엔진이 계산하지 못했다', [{ path: before.error.path ?? '/squad', message: before.error.message }]);
  }
  const beforeDamage = new Map(before.members.map((m) => [m.name, m.damage]));

  const ranking = [];
  const failed = [];
  for (const [i, u] of accepted.entries()) {
    const r = results[i + 1];
    if (r.error) {
      failed.push({ name: u.name, changes: u.changes, error: { type: r.error.type, message: r.error.message, path: r.error.path ?? null } });
      continue;
    }
    ranking.push({
      name: u.name,
      changes: u.changes,
      total_before: before.total_damage,
      total_after: r.total_damage,
      gain: r.total_damage - before.total_damage,
      gain_rate: gainRate(before.total_damage, r.total_damage),
      members: r.members.map((m) => ({ name: m.name, damage: m.damage, share: m.share, gain: m.damage - (beforeDamage.get(m.name) ?? 0) })),
      notes: u.notes,
      engine_warnings: r.warnings ?? [],
    });
  }
  // 기준이 같으므로 증가량 순서가 곧 증가율 순서다. 같은 값이면 입력 순서를 지킨다(안정 정렬).
  ranking.sort((x, y) => y.gain - x.gain);
  ranking.forEach((r, i) => {
    r.rank = i + 1;
  });

  return {
    schema_version: GROWTH_REPORT_SCHEMA_VERSION,
    kind: 'growth',
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
    account: { name: account.name ?? null, is_test_data: account.is_test_data, updated_at: account.updated_at ?? null },
    condition,
    assumptions: assumptionsOf(condition),
    engine: before.evaluator ?? engineVersion(deps.engineDir),
    baseline: {
      name: squad.name ?? '기준 편성',
      members: memberRows(before.members),
      total_damage: before.total_damage,
      notes: squadNotes(squad, account, catalog),
      engine_warnings: before.warnings ?? [],
      ungrown_members: before.spec?.profile?.ungrown ?? [],
    },
    ranking,
    rejected,
    failed,
    caveats: [
      '기준 편성 하나에서의 총딜 변화다. 다른 편성·다른 전투 조건에서는 순서가 달라질 수 있다.',
      '재화·비용은 고려하지 않았다. 증가율이 높다고 투자 효율이 높다는 뜻은 아니다.',
      '후보는 하나씩 따로 적용했다. 여러 후보를 함께 적용한 효과는 각각의 합과 다를 수 있다.',
      '수치는 시뮬레이션 추정치다. 실제 게임 기록과 대조하지 않았다.',
      ...a.warnings,
    ],
  };
}
