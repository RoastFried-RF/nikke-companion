// 신규 니케·데이터 변경 감지 (자동 티어 1단계).
// 엔진 서브모듈의 두 커밋에서 data/parsed_nikke.json·parsed_skills.json을 읽어 니케 단위로
// 추가·변경·삭제를 나눈다. 티어는 내지 않는다 — 무엇을 다시 평가해야 하는지만 알려 준다.
// 형식 설명은 docs/data-model.md §데이터 변경 감지.
import { spawnSync } from 'node:child_process';
import { InputError } from '../core/compare.mjs';
import { DEFAULT_ENGINE_DIR } from '../runtime/node.mjs';

export const CHANGES_SCHEMA_VERSION = 1;
export const DATA_FILES = { nikkes: 'data/parsed_nikke.json', skills: 'data/parsed_skills.json' };

const HOLD_MESSAGES = {
  skills_unparsed: '스킬이 파싱되지 않았다(parsed_skills.json에 없다). 스킬 0개로 계산하면 결과가 조용히 틀린다',
  skills_empty: '스킬 효과가 하나도 없다. 스킬 0개로 계산된다',
  stats_missing: '기본 스탯이 없다(parsed_nikke.json에 없다). 엔진이 이 이름을 계산하지 못한다',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** JSON 값 비교. 객체는 키 순서를 무시하고, 배열은 순서까지 본다. */
export function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
}

/** 스킬 파싱 상태. 엔진의 미파싱 기준(timeline.py `_check_names`)과 같다: parsed_skills에 키가 없으면 미파싱. */
export function skillsState(data, name) {
  if (!Object.hasOwn(data.skills, name)) return 'unparsed';
  const effects = data.skills[name];
  return Array.isArray(effects) && effects.length > 0 ? 'parsed' : 'empty';
}

/** 그 판의 데이터로 이 니케를 평가할 수 있는가. 못 하면 평가 보류와 그 사유. */
export function evaluationOf(data, name) {
  const codes = [];
  if (!Object.hasOwn(data.nikkes, name)) codes.push('stats_missing');
  const state = skillsState(data, name);
  if (state === 'unparsed') codes.push('skills_unparsed');
  if (state === 'empty') codes.push('skills_empty');
  if (codes.length === 0) return { status: 'ready', label: '평가 대상', reasons: [] };
  return { status: 'hold', label: '평가 보류', reasons: codes.map((code) => ({ code, message: HOLD_MESSAGES[code] })) };
}

function changedFields(before, after) {
  if (!isObject(before) || !isObject(after)) return null;
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields.filter((f) => !sameJson(before[f], after[f])).sort();
}

function statChanges(before, after) {
  // 객체가 아닌 값끼리는 칸을 나눌 수 없다 — 통째로 한 건으로 알린다.
  const fields = changedFields(before, after);
  if (fields === null) return sameJson(before, after) ? [] : [{ field: null, before: before ?? null, after: after ?? null }];
  return fields.map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

function effectGroups(effects) {
  const groups = new Map();
  for (const e of Array.isArray(effects) ? effects : []) {
    const key = JSON.stringify([e?.source ?? null, e?.name ?? null]);
    if (!groups.has(key)) groups.set(key, { source: e?.source ?? null, name: e?.name ?? null, effects: [] });
    groups.get(key).effects.push(e);
  }
  return groups;
}

/**
 * 한 니케의 스킬 효과 목록을 (스킬 칸, 효과 이름)으로 묶어 비교한다.
 * 같은 칸·이름의 효과가 여럿일 수 있어(애장품 판본) 묶음째 비교한다.
 */
function skillChanges(before, after) {
  const b = effectGroups(before);
  const a = effectGroups(after);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, g] of a) {
    const old = b.get(key);
    if (!old) added.push({ source: g.source, name: g.name });
    else if (!sameJson(old.effects, g.effects)) {
      // 1:1일 때만 바뀐 칸을 짚는다. 여럿이면 어느 것끼리 짝인지 알 수 없다.
      const fields = old.effects.length === 1 && g.effects.length === 1 ? changedFields(old.effects[0], g.effects[0]) : null;
      changed.push({ source: g.source, name: g.name, fields });
    }
  }
  for (const [key, g] of b) if (!a.has(key)) removed.push({ source: g.source, name: g.name });
  const same = sameJson(before ?? null, after ?? null);
  return {
    effects_before: Array.isArray(before) ? before.length : null,
    effects_after: Array.isArray(after) ? after.length : null,
    added,
    removed,
    changed,
    // 효과 내용은 같고 나열 순서만 바뀐 경우. 엔진은 배열 순서로 같은 프레임의 발동 순서를 정한다.
    reordered: !same && added.length + removed.length + changed.length === 0,
  };
}

function checkData(label, data) {
  const errors = [];
  for (const key of ['nikkes', 'skills']) {
    if (!isObject(data?.[key])) errors.push({ path: `${label}.${key}`, message: `${DATA_FILES[key]}는 이름 → 값 객체여야 한다` });
  }
  if (errors.length) throw new InputError('엔진 데이터 형식이 다르다', errors);
}

/**
 * 엔진 데이터 두 판을 니케 단위로 비교한다. 순수 함수 — 파일도 git도 건드리지 않는다.
 * @param {{nikkes: object, skills: object}} from 이전 판
 * @param {{nikkes: object, skills: object}} to   새 판
 */
export function diffEngineData(from, to) {
  checkData('from', from);
  checkData('to', to);
  const namesOf = (d) => new Set([...Object.keys(d.nikkes), ...Object.keys(d.skills)]);
  const before = namesOf(from);
  const after = namesOf(to);

  const added = [];
  const changed = [];
  const removed = [];
  let unchanged = 0;
  for (const name of after) {
    const evaluation = evaluationOf(to, name);
    if (!before.has(name)) {
      added.push({ name, evaluation, skills_state: skillsState(to, name), effects: Array.isArray(to.skills[name]) ? to.skills[name].length : 0 });
      continue;
    }
    const hadStats = Object.hasOwn(from.nikkes, name);
    const hasStats = Object.hasOwn(to.nikkes, name);
    // 기본 스탯이 통째로 생기거나 사라진 경우는 칸마다 나열하지 않고 stats_presence로만 알린다.
    const statsPresence = hadStats === hasStats ? null : hasStats ? 'added' : 'removed';
    const stats = hadStats && hasStats ? statChanges(from.nikkes[name], to.nikkes[name]) : [];
    const skillsSame = Object.hasOwn(from.skills, name) === Object.hasOwn(to.skills, name) && sameJson(from.skills[name], to.skills[name]);
    if (stats.length === 0 && !statsPresence && skillsSame) {
      unchanged += 1;
      continue;
    }
    changed.push({
      name,
      evaluation,
      evaluation_before: evaluationOf(from, name).status,
      changes: {
        stats,
        stats_presence: statsPresence,
        skills: skillsSame
          ? null
          : { state_before: skillsState(from, name), state_after: skillsState(to, name), ...skillChanges(from.skills[name], to.skills[name]) },
      },
    });
  }
  for (const name of before) {
    if (!after.has(name)) removed.push({ name, evaluation_before: evaluationOf(from, name).status });
  }
  added.sort(byName);
  changed.sort(byName);
  removed.sort(byName);
  const hold = [...added, ...changed].filter((e) => e.evaluation.status === 'hold').map((e) => e.name).sort();

  return {
    summary: { added: added.length, changed: changed.length, removed: removed.length, unchanged, hold: hold.length },
    added,
    changed,
    removed,
    hold,
  };
}

function git(engineDir, args) {
  const r = spawnSync('git', ['-C', engineDir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error) throw new Error(`git을 실행할 수 없다: ${r.error.message}`);
  return r;
}

function resolveCommit(engineDir, label, ref) {
  // '-'로 시작하는 값은 git 옵션으로 읽힐 수 있다.
  if (typeof ref !== 'string' || ref === '' || ref.startsWith('-')) {
    throw new InputError('인자가 빠졌다', [{ path: `--${label}`, message: '엔진 저장소의 커밋(해시·태그·HEAD~1 등)이 필요하다' }]);
  }
  const r = git(engineDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (r.status !== 0) {
    throw new InputError('커밋을 찾을 수 없다', [{ path: `--${label}`, message: `엔진 저장소(${engineDir})에 '${ref}' 커밋이 없다` }]);
  }
  return r.stdout.trim();
}

/** 엔진 저장소의 한 커밋에서 데이터 두 파일을 읽는다. 작업 폴더는 건드리지 않는다(`git show`). */
export function readEngineDataAt(engineDir, commit) {
  const data = {};
  for (const [key, file] of Object.entries(DATA_FILES)) {
    const r = git(engineDir, ['show', `${commit}:${file}`]);
    if (r.status !== 0) {
      throw new InputError('엔진 데이터를 읽을 수 없다', [{ path: `${commit.slice(0, 7)}:${file}`, message: '그 커밋에 이 파일이 없다' }]);
    }
    try {
      data[key] = JSON.parse(r.stdout);
    } catch (e) {
      throw new InputError('엔진 데이터를 읽을 수 없다', [{ path: `${commit.slice(0, 7)}:${file}`, message: `JSON이 아니다: ${e.message}` }]);
    }
  }
  return data;
}

/**
 * 엔진 저장소의 두 커밋 사이에서 추가·변경·삭제된 니케를 찾는다.
 * @param {object} input
 * @param {string} input.from 이전 커밋
 * @param {string} input.to   새 커밋
 * @param {object} [deps] engineDir, now — 테스트에서 바꿔 끼운다
 */
export function detectChanges({ from, to }, deps = {}) {
  const engineDir = deps.engineDir ?? DEFAULT_ENGINE_DIR;
  const fromCommit = resolveCommit(engineDir, 'from', from);
  const toCommit = resolveCommit(engineDir, 'to', to);
  const diff = diffEngineData(readEngineDataAt(engineDir, fromCommit), readEngineDataAt(engineDir, toCommit));

  const caveats = [
    '티어를 낸 것이 아니다. 다시 평가할 대상을 고른 목록이다.',
    '평가 보류는 스킬 미파싱·효과 없음·기본 스탯 없음만 본다. 파싱된 효과를 엔진이 모두 계산하는지는 판정하지 않았다.',
  ];
  if (fromCommit !== toCommit && git(engineDir, ['merge-base', '--is-ancestor', fromCommit, toCommit]).status !== 0) {
    caveats.push('--from이 --to의 조상 커밋이 아니다. 비교 방향이 뒤집혔으면 추가와 삭제가 바뀌어 나온다.');
  }
  return {
    schema_version: CHANGES_SCHEMA_VERSION,
    kind: 'data_changes',
    generated_at: (deps.now ?? (() => new Date()))().toISOString(),
    engine: { repo: 'Jgaram/nikke-calc', from: { ref: from, commit: fromCommit }, to: { ref: to, commit: toCommit } },
    files: Object.values(DATA_FILES),
    ...diff,
    caveats,
  };
}
