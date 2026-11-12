// 계산기(P-034)의 **출처 점검**: 계산기를 만들려면 값의 출처가 있어야 한다 — 그 표가 계산 도구(엔진)의 데이터에 있는지 본다.
// 조사 결과와 까닭은 docs/calculators.md, 형식은 docs/data-model.md §계산기 출처 점검.
//
// 이 모듈에는 **게임의 값이 하나도 없다**(필요 경험치·키트 경험치·모집 확률을 적지 않는다 — 기억이나 다른 사이트의 숫자를
// 옮기지 않는다). 하는 일은 「받은 표들에 그런 칸이 있는가」를 칸 이름으로 찾아 보고서로 만드는 것뿐이다.
// 순수 모듈이다 — 파일을 읽지 않는다. 표를 읽어 넘기는 쪽은 tests/integration/calculators.engine.test.mjs다.
//
// 칸 이름이 걸렸다고 「확인됨」이 되지 않는다: 그때의 상태는 `candidate`(사람이 그 표를 읽고 판단한다)다.
// 그래서 이 점검만으로는 어떤 계산기도 저절로 생기지 않는다.

export const CALCULATOR_SOURCES_KIND = 'calculator_sources';
export const CALCULATOR_SOURCES_SCHEMA_VERSION = 1;

/** 출처의 상태: 출처 없음(만들지 않는다) / 그럴 만한 칸이 보인다(사람이 확인한다). */
export const SOURCE_STATUS = Object.freeze({ no_source: '출처 없음', candidate: '확인 필요' });

/**
 * 계산기가 쓰려는 값. `words`는 칸 이름을 영문·숫자 토막으로 나눴을 때 그 토막과 같아야 하는 말이고
 * (`spot_explosion_range`의 `explosion`은 `exp`가 아니다), `parts`는 칸 이름에 들어 있기만 하면 되는 한국어다.
 */
export const CALCULATOR_NEEDS = Object.freeze([
  Object.freeze({
    id: 'collection-exp',
    label: '소장품 단계별 필요 경험치',
    words: Object.freeze(['exp', 'xp', 'experience']),
    parts: Object.freeze(['경험치']),
  }),
  Object.freeze({
    id: 'kit-exp',
    label: '관리 키트 세 종류의 경험치',
    words: Object.freeze(['kit', 'kits']),
    parts: Object.freeze(['키트']),
  }),
  Object.freeze({
    id: 'recruit-rates',
    label: '공식 모집 확률 표',
    words: Object.freeze(['gacha', 'recruit', 'recruitment', 'pickup', 'probability']),
    parts: Object.freeze(['모집', '뽑기']),
  }),
]);

/** 이 작업이 살펴본 계산기와 그것이 쓰려는 값. */
export const CALCULATORS = Object.freeze([
  Object.freeze({ id: 'collection-upgrade', title: '소장품 강화', needs: Object.freeze(['collection-exp', 'kit-exp']) }),
  Object.freeze({ id: 'recruit', title: '모집 확률', needs: Object.freeze(['recruit-rates']) }),
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON 문서에 나오는 모든 칸 이름(객체의 열쇠)을 겹치지 않게, 글자 순서로. 값(문장·주석)은 보지 않는다. */
export function keyNames(doc) {
  const names = new Set();
  const stack = [doc];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) if (item !== null && typeof item === 'object') stack.push(item);
    } else if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        names.add(key);
        if (value !== null && typeof value === 'object') stack.push(value);
      }
    }
  }
  return [...names].sort();
}

/** 칸 이름을 영문·숫자 토막으로(소문자). `needExp`·`need_exp`·`need-exp` → need, exp. */
function wordsOf(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** 그 칸 이름이 이 값의 표일 수 있는가(이름만 본다). */
export function keyMatchesNeed(key, need) {
  if (typeof key !== 'string') return false;
  if ((need.parts ?? []).some((part) => key.includes(part))) return true;
  const words = wordsOf(key);
  return (need.words ?? []).some((word) => words.includes(word));
}

/**
 * 소장품 표(엔진의 `collection.json`)의 단계별 줄에 어떤 칸이 있는가.
 * 반환: `{ stages: 줄 수, columns: 칸 이름(글자 순서) }` — 표가 아니면 `{ stages: 0, columns: [] }`.
 */
export function collectionColumns(collection) {
  const table = isPlainObject(collection) && isPlainObject(collection._stat_table) ? collection._stat_table : {};
  const rows = Object.values(table).filter(isPlainObject);
  const columns = new Set();
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
  return { stages: rows.length, columns: [...columns].sort() };
}

/**
 * 수집 코드의 글에서 따옴표로 적힌 표·이미지의 평문 경로(`"/equip/…​.json"`)를 겹치지 않게, 글자 순서로.
 * 언어 자리(`{locale}`)는 `ko`로 읽는다 — 같은 표를 두 가지로 적은 것을 하나로 센다.
 */
export function cdnPathsIn(sourceText) {
  const paths = new Set();
  for (const m of String(sourceText ?? '').matchAll(/["'](\/[A-Za-z_]+\/[^"'\s]*\.(?:json|webp|png))["']/g)) {
    paths.add(m[1].replaceAll('{locale}', 'ko'));
  }
  return [...paths].sort();
}

/**
 * 받은 표들에서 계산기가 쓰려는 값의 칸을 찾는다.
 *   files     { '<파일 이름>': 읽어 둔 JSON }        — 엔진의 데이터 파일들
 *   cdnPaths  수집 코드가 받는 평문 경로 목록(선택)   — 「어디까지 봤는가」로 보고서에 남긴다(이름으로도 찾는다)
 * 반환: 보고서(`calculator_sources`). 값이 없으면 `no_source`, 칸 이름이 걸리면 `candidate`다 — `candidate`도 확인된 것이 아니다.
 */
export function auditCalculatorSources({ files = {}, cdnPaths = [] } = {}) {
  if (!isPlainObject(files)) throw new TypeError('files는 { 파일 이름: JSON } 객체여야 한다');
  const names = Object.keys(files).sort();
  const keysByFile = new Map(names.map((name) => [name, keyNames(files[name])]));
  const paths = [...new Set(cdnPaths)].sort();

  const needs = CALCULATOR_NEEDS.map((need) => {
    const hits = [];
    for (const [file, keys] of keysByFile) {
      for (const key of keys) if (keyMatchesNeed(key, need)) hits.push({ where: 'file', file, key });
    }
    for (const path of paths) if (keyMatchesNeed(path, need)) hits.push({ where: 'cdn_path', path });
    return { id: need.id, label: need.label, found: hits.length > 0, hits };
  });
  const needById = new Map(needs.map((n) => [n.id, n]));

  const calculators = CALCULATORS.map((calc) => {
    const missing = calc.needs.filter((id) => !needById.get(id).found);
    const status = missing.length > 0 ? 'no_source' : 'candidate';
    return {
      id: calc.id,
      title: calc.title,
      needs: [...calc.needs],
      missing,
      status,
      status_label: SOURCE_STATUS[status],
      built: false,
    };
  });

  return {
    kind: CALCULATOR_SOURCES_KIND,
    schema_version: CALCULATOR_SOURCES_SCHEMA_VERSION,
    looked: { files: names, cdn_paths: paths },
    collection_table: collectionColumns(files['base_stat_tables/collection.json']),
    needs,
    calculators,
    caveats: [
      '칸 이름만 본다 — 걸린 칸이 있어도 그 표가 맞는지는 사람이 읽고 정한다(「확인 필요」는 확인된 것이 아니다).',
      '수집 코드가 받는 공개 표의 원본에 이 코드가 읽지 않는 칸이 더 있는지는 이 점검이 알 수 없다.',
    ],
  };
}

/** 보고서를 사람이 읽는 줄들로. */
export function renderSourceReport(report) {
  const lines = [`살펴본 표 ${report.looked.files.length}개 · 수집 코드의 경로 ${report.looked.cdn_paths.length}개`];
  const table = report.collection_table;
  lines.push(`소장품 표: ${table.stages}단계 · 칸 ${table.columns.length ? table.columns.join(', ') : '없음'}`);
  for (const need of report.needs) {
    const where = need.hits.map((h) => (h.where === 'file' ? `${h.file}의 ${h.key}` : h.path)).join(', ');
    lines.push(`- ${need.label}: ${need.found ? `그럴 만한 칸이 보인다(${where})` : '없다'}`);
  }
  for (const calc of report.calculators) lines.push(`${calc.title} 계산기: ${calc.status_label}`);
  return lines;
}
