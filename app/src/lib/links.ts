// 도구 링크(P-033) — 화면 쪽: 저장소의 도구 목록(data/links/tools.json)을 읽어 화면의 값으로.
//
// 목록은 저장소의 문서를 그대로 가져온다(복제하지 않는다 — Rust도 같은 문서를 실행 파일에 넣는다). 모양 검사는 루트의
// 순수 함수(src/core/links.mjs)가 한다. **이 앱은 그 사이트들의 내용을 가져오지 않는다** — 화면은 목록을 보여 주고,
// 누르면 Rust 명령(open_tool_link)에 **목록의 id**를 넘겨 기본 브라우저로 열 뿐이다. 주소를 넘기는 길은 없다.
import { readToolLinks } from '@core/links.mjs';
import toolLinks from '../../../data/links/tools.json';
import type { OpenedLink, ToolLinkBook } from '../types';
import { openToolLink } from './backend';

/** 앱에 든 도구 목록(읽지 못하면 던진다 — 빌드할 때 든 문서라 테스트가 먼저 잡는다). */
export const TOOL_LINKS: ToolLinkBook = readToolLinks(toolLinks) as ToolLinkBook;

/** 목록의 그 도구를 기본 브라우저로 연다. 목록에 없는 id면 아무것도 열지 않고 한국어 문장으로 던진다. */
export function openLink(id: string): Promise<OpenedLink> {
  if (!TOOL_LINKS.links.some((link) => link.id === id)) return Promise.reject(new Error('목록에 없는 도구다 — 열지 않았다'));
  return openToolLink(id);
}
