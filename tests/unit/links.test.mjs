// 도구 링크(P-033)의 순수 함수와 데이터 파일(data/links/tools.json): 목록의 모양, 열어도 되는 주소, id로만 찾기.
// 네트워크를 쓰지 않는다 — 이 앱은 그 사이트들의 내용을 가져오지 않는다. 여는 쪽(Rust)의 같은 검사는
// app/src-tauri/src/tool_links.rs의 단위 테스트가, 화면은 app/tests/DailyTools.test.ts가 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { isLinkId, isSafeLinkUrl, LINK_BASES, linkById, linkProblems, LINK_URL_MAX, readToolLinks, TOOL_LINKS_KIND, TOOL_LINKS_SCHEMA_VERSION } from '../../src/core/links.mjs';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const doc = JSON.parse(read('data/links/tools.json'));

/** 작업이 정한 목록(대화형 세션이 직접 열어 확인한 것). */
const EXPECTED = [
  ['레츠도로', 'https://letsdoro.com/'],
  ['니케 장비 현황', 'https://nikkegear885.github.io/nikke-/'],
  ['딜도로', 'https://dildoro.com/'],
  ['Enikk', 'https://enikk.app/'],
  ['도로파티', 'https://doroparty.com/'],
  ['니케 금서고', 'https://nikkeforbiddenlibrary.com/'],
  ['NIKKE PvP META', 'https://inspiring-hotteok-9de45f.netlify.app/'],
  ['NIKKE DECK', 'https://nikke-deck.com/ko/deck'],
  ['NIKKE Arena Tools', 'https://nikke.top/'],
  ['소장품 강화 시뮬레이터', 'https://changjoeconomy.github.io/collectibles/'],
  ['니붕 시뮬레이터', 'https://nibung.kr/'],
  ['니케피그', 'https://nikkefig.com/'],
  ['홍련 농장', 'https://scarletfarm.app/'],
];

test('데이터 파일: 확인한 도구 열셋 그대로이고, 출처가 모음집 글임을 적었다', () => {
  assert.deepEqual(linkProblems(doc), []);
  const book = readToolLinks(doc);
  assert.deepEqual(book.links.map((l) => [l.name, l.url]), EXPECTED);
  assert.equal(doc.kind, TOOL_LINKS_KIND);
  assert.equal(doc.schema_version, TOOL_LINKS_SCHEMA_VERSION);
  assert.equal(book.source.title, '니케 유용한 툴 모음집');
  assert.match(book.source.where, /니케 마이너 갤러리/);
  assert.match(book.source.note, /이 앱은 이 사이트들의 내용을 가져오지 않는다/);
  // 도구마다 이름·한 줄 설명·주소가 있고 id는 겹치지 않는다.
  assert.equal(new Set(book.links.map((l) => l.id)).size, EXPECTED.length);
  for (const link of book.links) {
    assert.ok(isLinkId(link.id), link.id);
    assert.ok(isSafeLinkUrl(link.url), link.url);
    assert.ok(link.description.trim().length > 0 && !link.description.includes('\n'), link.name);
    assert.ok(Object.hasOwn(LINK_BASES, link.basis), link.name);
    assert.equal(link.basis_label, LINK_BASES[link.basis]);
  }
  // 열어 본 기록에 기능이 남아 있지 않은 도구는 분류 한마디만 적고 그렇게 표시했다(지어내지 않는다).
  assert.deepEqual(book.links.filter((l) => l.basis === 'category').map((l) => l.name), ['도로파티', '니케 금서고', 'NIKKE PvP META', '니케피그', '홍련 농장']);
});

test('이 앱이 하지 않는 것: PVP 계산 · 통계·랭킹 · 스토리 열람 · 유니온 구인 — 까닭과 안내할 도구가 있다', () => {
  const book = readToolLinks(doc);
  assert.deepEqual(book.not_supported.map((t) => t.topic), ['PVP 계산', '통계·랭킹', '스토리 열람', '유니온 구인']);
  for (const topic of book.not_supported) {
    assert.ok(topic.reason.trim().length > 0, topic.topic);
    assert.ok(topic.links.length > 0, topic.topic);
    for (const link of topic.links) assert.ok(book.links.includes(link), `${topic.topic}: 목록에 있는 도구만 가리킨다`);
  }
  const of = (topic) => book.not_supported.find((t) => t.topic === topic);
  assert.match(of('PVP 계산').reason, /계산 도구는 PVP\(아레나\)를 계산하지 않는다 — 지원하지 않음/);
  assert.match(of('통계·랭킹').reason, /서버 데이터가 필요하다/);
  assert.deepEqual(of('스토리 열람').links.map((l) => l.name), ['니케 금서고']);
  assert.deepEqual(of('유니온 구인').links.map((l) => l.name), ['도로파티']);
  // 화면의 글에는 「엔진」이라고 적지 않는다(계산 도구라고 한다).
  assert.ok(!JSON.stringify(doc).includes('엔진'));
});

test('id로만 찾는다 — 주소·경로·모르는 글자로는 아무것도 나오지 않는다', () => {
  assert.equal(linkById(doc, 'letsdoro').url, 'https://letsdoro.com/');
  assert.equal(linkById(doc, 'nikke-deck').name, 'NIKKE DECK');
  for (const bad of [
    '',
    'LETSDORO',
    'letsdoro ',
    '없는-도구',
    'unknown-tool',
    'https://letsdoro.com/',
    'https://example.com/',
    'letsdoro.com',
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'C:\\Windows\\System32\\calc.exe',
    '../letsdoro',
    'letsdoro?x=1',
    '-letsdoro',
    'lets--doro',
    'a'.repeat(41),
    null,
    undefined,
    3,
    { id: 'letsdoro' },
  ]) {
    assert.equal(linkById(doc, bad), null, String(bad));
  }
  assert.equal(linkById(null, 'letsdoro'), null);
  // 목록에 있어도 주소가 검사를 지나지 못하면 돌려주지 않는다.
  const tampered = { ...doc, links: [{ ...doc.links[0], url: 'http://letsdoro.com/' }] };
  assert.equal(linkById(tampered, 'letsdoro'), null);
});

test('열어도 되는 주소: https의 평범한 주소뿐이다', () => {
  for (const [, url] of EXPECTED) assert.ok(isSafeLinkUrl(url), url);
  for (const bad of [
    '',
    'https://',
    'https:///x',
    'https://localhost/',
    'http://letsdoro.com/',
    'HTTPS://letsdoro.com/',
    'ftp://letsdoro.com/',
    'file:///C:/x',
    'javascript:alert(1)',
    'https://letsdoro.com/?q=1',
    'https://letsdoro.com/#top',
    'https://user@letsdoro.com/',
    'https://letsdoro.com:8443/',
    'https://letsdoro.com/a b',
    'https://letsdoro.com/"x"',
    'https://letsdoro.com/%2e%2e',
    'https://letsdoro.com\\x',
    'https://lets doro.com/',
    'https://-letsdoro.com/',
    'https://letsdoro-.com/',
    'https://letsdoro..com/',
    'https://LetsDoro.com/',
    'https://letsdoro.com/\n',
    ' https://letsdoro.com/',
    'https://letsdoro.com/ & calc',
    `https://a.com/${'x'.repeat(LINK_URL_MAX)}`,
    null,
    42,
  ]) {
    assert.ok(!isSafeLinkUrl(bad), String(bad));
  }
});

test('목록의 모양이 틀리면 이유를 말하고 읽지 않는다', () => {
  const ok = { schema_version: 1, kind: 'tool_links', source: { title: '모음집', where: '어느 글' }, links: [{ id: 'a', name: 'A', description: '설명', url: 'https://a.com/', basis: 'recorded' }], not_supported: [{ topic: 'PVP', reason: '없다', links: ['a'] }] };
  assert.deepEqual(linkProblems(ok), []);
  assert.equal(readToolLinks(ok).not_supported[0].id, 'topic-1');
  const problems = (change) => linkProblems(change(structuredClone(ok)));
  const set = (path, value) => (d) => {
    let at = d;
    for (const key of path.slice(0, -1)) at = at[key];
    at[path.at(-1)] = value;
    return d;
  };
  assert.match(problems(set(['kind'], 'deck_book'))[0], /도구 목록이 아니다/);
  assert.match(problems(set(['schema_version'], 2))[0], /판이 다르다/);
  assert.match(problems(set(['source'], {}))[0], /출처/);
  assert.match(problems(set(['links'], []))[0], /도구가 하나도 없다/);
  assert.match(problems(set(['links', 0, 'id'], 'A B'))[0], /id는 소문자·숫자·붙임표다/);
  assert.match(problems(set(['links', 0, 'name'], ''))[0], /이름이 없다/);
  assert.match(problems(set(['links', 0, 'description'], ' '))[0], /한 줄 설명이 없다/);
  assert.match(problems(set(['links', 0, 'url'], 'http://a.com/'))[0], /https:\/\/로 시작하는 평범한 주소/);
  assert.match(problems(set(['links', 0, 'basis'], '추측'))[0], /설명의 근거/);
  assert.match(problems(set(['links', 1], { ...ok.links[0] })).join(' / '), /id가 겹친다.*주소가 겹친다/);
  assert.match(problems(set(['not_supported'], undefined))[0], /이 앱이 하지 않는 것/);
  assert.match(problems(set(['not_supported', 0, 'links'], ['없는-도구']))[0], /목록에 없는 도구를 가리킨다/);
  assert.match(problems(set(['not_supported', 0, 'links'], []))[0], /안내할 도구가 없다/);
  assert.match(problems(set(['not_supported', 0, 'reason'], ''))[0], /무엇을 왜 하지 않는지/);
  assert.deepEqual(linkProblems('글자'), ['도구 목록은 객체여야 한다']);
  assert.throws(() => readToolLinks({ ...ok, kind: 'x' }), (e) => /도구 목록을 읽지 못했다/.test(e.message) && e.problems.length === 1);
});

test('이 모듈과 데이터 파일은 네트워크를 쓰지 않는다 — 여는 것은 앱의 명령 하나뿐이다', () => {
  const source = read('src/core/links.mjs');
  const code = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|node:|require\(|import\(/.test(code));
  assert.ok(!/^import /m.test(code), '다른 모듈에 기대지 않는다');
});
