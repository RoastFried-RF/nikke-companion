// 도구 링크(P-033): 커뮤니티 도구 목록(이름 · 한 줄 설명 · 주소)과 「이 앱이 하지 않는 것」.
// 목록은 저장소의 데이터 파일 `data/links/tools.json`이다(출처: 모음집 글 — 파일의 `source`). 형식은 docs/data-model.md §도구 링크.
//
// 순수 모듈이다 — 네트워크를 쓰지 않는다. 이 앱은 그 사이트들의 내용을 가져오지 않는다: 화면은 목록을 보여 주고,
// 누르면 Rust 명령(`open_tool_link` — app/src-tauri/src/tool_links.rs)이 **목록에 있는 id의 주소만** 기본 브라우저로 연다.
// 화면이 넘기는 것은 id뿐이다(주소가 아니다). 여기의 검사와 같은 검사를 Rust가 한 번 더 한다.

export const TOOL_LINKS_KIND = 'tool_links';
export const TOOL_LINKS_SCHEMA_VERSION = 1;
/** 한 줄 설명의 근거: 열어 본 기록에 기능이 적혀 있다 / 분류 한마디만 남아 있다. */
export const LINK_BASES = Object.freeze({ recorded: '열어 본 기록', category: '분류 기록' });
export const LINK_URL_MAX = 200;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** 목록의 열쇠로 쓸 수 있는 id인가(소문자·숫자·붙임표, 40자까지). */
export function isLinkId(id) {
  return typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 40;
}

/**
 * 기본 브라우저로 열어도 되는 주소인가: `https://`로 시작하고, 호스트는 글자·숫자·점·붙임표뿐이며, 길(path)에는
 * 글자·숫자와 `/ - _ . ~`만 있다. 공백·따옴표·`?`·`#`·`@`·`%`·`\`·제어 문자가 하나라도 있으면 거부한다(목록의 주소에는 필요 없다).
 */
export function isSafeLinkUrl(url) {
  if (typeof url !== 'string' || url.length > LINK_URL_MAX) return false;
  return /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[A-Za-z0-9._~/-]*)?$/.test(url);
}

/** 목록 문서의 문제를 한국어 문장으로(없으면 빈 배열). */
export function linkProblems(doc) {
  if (!isPlainObject(doc)) return ['도구 목록은 객체여야 한다'];
  const problems = [];
  if (doc.kind !== TOOL_LINKS_KIND) problems.push('도구 목록이 아니다(종류가 다르다)');
  if (doc.schema_version !== TOOL_LINKS_SCHEMA_VERSION) problems.push('도구 목록의 판이 다르다');
  if (!isPlainObject(doc.source) || !isText(doc.source.title) || !isText(doc.source.where)) problems.push('출처(어느 글에서 왔는지)가 적혀 있지 않다');
  const links = Array.isArray(doc.links) ? doc.links : null;
  if (!links || links.length === 0) return [...problems, '도구가 하나도 없다'];
  const ids = new Set();
  const urls = new Set();
  links.forEach((link, i) => {
    const where = `도구 ${i + 1}${isPlainObject(link) && isText(link.name) ? `(${link.name})` : ''}`;
    if (!isPlainObject(link)) return problems.push(`${where}: 객체여야 한다`);
    if (!isLinkId(link.id)) problems.push(`${where}: id는 소문자·숫자·붙임표다`);
    else if (ids.has(link.id)) problems.push(`${where}: id가 겹친다`);
    ids.add(link.id);
    if (!isText(link.name)) problems.push(`${where}: 이름이 없다`);
    if (!isText(link.description)) problems.push(`${where}: 한 줄 설명이 없다`);
    if (!isSafeLinkUrl(link.url)) problems.push(`${where}: 주소는 https://로 시작하는 평범한 주소여야 한다`);
    else if (urls.has(link.url)) problems.push(`${where}: 주소가 겹친다`);
    urls.add(link.url);
    if (!Object.hasOwn(LINK_BASES, link.basis)) problems.push(`${where}: 설명의 근거(basis)는 ${Object.keys(LINK_BASES).join('·')} 가운데 하나다`);
    return undefined;
  });
  const topics = Array.isArray(doc.not_supported) ? doc.not_supported : null;
  if (!topics) problems.push('이 앱이 하지 않는 것(not_supported)이 없다');
  for (const [i, topic] of (topics ?? []).entries()) {
    const where = `하지 않는 것 ${i + 1}`;
    if (!isPlainObject(topic) || !isText(topic.topic) || !isText(topic.reason)) {
      problems.push(`${where}: 무엇을 왜 하지 않는지 적혀 있지 않다`);
      continue;
    }
    const refs = Array.isArray(topic.links) ? topic.links : [];
    if (refs.length === 0) problems.push(`${where}(${topic.topic}): 안내할 도구가 없다`);
    for (const ref of refs) if (!ids.has(ref)) problems.push(`${where}(${topic.topic}): 목록에 없는 도구를 가리킨다(${String(ref)})`);
  }
  return problems;
}

/**
 * 목록 문서를 읽는다. 문제가 있으면 한국어 문장으로 던진다(`error.problems`).
 * @returns {{source: object, links: Array<{id: string, name: string, description: string, url: string, basis: string, basis_label: string}>, not_supported: Array<{id: string, topic: string, reason: string, links: object[]}>}}
 */
export function readToolLinks(doc) {
  const problems = linkProblems(doc);
  if (problems.length) {
    const error = new Error(`도구 목록을 읽지 못했다: ${problems.join(' / ')}`);
    error.problems = problems;
    throw error;
  }
  const links = doc.links.map((l) => ({ id: l.id, name: l.name, description: l.description, url: l.url, basis: l.basis, basis_label: LINK_BASES[l.basis] }));
  const byId = new Map(links.map((l) => [l.id, l]));
  return {
    source: { ...doc.source },
    links,
    not_supported: doc.not_supported.map((t, i) => ({
      id: isText(t.id) ? t.id : `topic-${i + 1}`,
      topic: t.topic,
      reason: t.reason,
      links: t.links.map((id) => byId.get(id)),
    })),
  };
}

/** id로 도구 하나를 찾는다. 목록에 없으면 null — 화면이 넘긴 글자를 주소로 쓰지 않는다. */
export function linkById(doc, id) {
  if (!isLinkId(id) || !Array.isArray(doc?.links)) return null;
  const found = doc.links.find((l) => isPlainObject(l) && l.id === id);
  return found && isSafeLinkUrl(found.url) ? found : null;
}
