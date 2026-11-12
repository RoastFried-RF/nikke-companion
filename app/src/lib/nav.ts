// 데스크톱 앱 창의 탐색: 왼쪽 메뉴의 화면 여섯, 설정 화면의 구획, 고급의 탭.
// 화면들은 `useNav()`로 다른 화면으로 옮긴다(「계정 연결하기」 단추 등). 마지막으로 본 화면을 기억한다.

import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';
import { recall, remember } from './remember';

/** 왼쪽 메뉴의 화면. `icon`은 NavIcon.vue가 그리는 그림의 이름이다. */
export const PAGES = [
  { key: 'home', label: '홈', icon: 'home' },
  { key: 'intercept', label: '요격전', icon: 'target' },
  { key: 'roster', label: '내 니케', icon: 'people' },
  { key: 'tools', label: '편성 도구', icon: 'squad' },
  { key: 'tier', label: '티어', icon: 'tier' },
  { key: 'settings', label: '설정', icon: 'gear' },
] as const;
export type PageKey = (typeof PAGES)[number]['key'];

/** 설정 화면의 구획. */
export const SETTINGS_SECTIONS = [
  { key: 'account', label: '계정 연결' },
  { key: 'overlay', label: '오버레이' },
  { key: 'engine', label: '계산 도구' },
  // P-033: 커뮤니티 도구 목록(누르면 기본 브라우저로 연다)과 이 앱이 하지 않는 것.
  { key: 'links', label: '다른 도구' },
  { key: 'advanced', label: '고급' },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['key'];

/** 고급(파일 직접 고르기)의 탭. `key`는 그 화면이 돌리는 계산의 이름이기도 하다(lib/engineRun.ts의 useEngineRun). */
export const ADVANCED_TABS = [
  { key: 'compare', label: '추천·비교' },
  { key: 'intercept', label: '요격전' },
  { key: 'growth', label: '성장' },
  { key: 'tier', label: '티어' },
] as const;
export type AdvancedTab = (typeof ADVANCED_TABS)[number]['key'];

/** 요격전 화면의 보기(P-033): 추천 편성 · 기록장(모듈 기록과 요격전 기록). */
export const INTERCEPT_VIEWS = [
  { key: 'recommend', label: '추천' },
  { key: 'journal', label: '기록장' },
] as const;
export type InterceptView = (typeof INTERCEPT_VIEWS)[number]['key'];

/** 편성 도구의 탭. */
export const TOOL_TABS = [
  { key: 'suggest', label: '추천' },
  { key: 'deck', label: '덱 빌더' },
  { key: 'efficiency', label: '육성 효율' },
  { key: 'compare', label: '비교' },
  { key: 'growth', label: '성장' },
] as const;
export type ToolTab = (typeof TOOL_TABS)[number]['key'];

/** 요격전 화면이 돌리는 계산의 이름. */
export const RUN_INTERCEPT = 'intercept-page';
/** 편성 도구의 추천이 돌리는 계산의 이름. */
export const RUN_SUGGEST = 'tools-suggest';
/** 편성 도구의 덱 빌더가 돌리는 계산의 이름(바로 계산·한 명 바꾸기·자리 순서 비교). */
export const RUN_DECK = 'tools-deck';
/** 편성 도구의 육성 효율이 돌리는 계산의 이름(효율표·오버로드 바꿔 보기·큐브 비교). */
export const RUN_EFFICIENCY = 'tools-efficiency';

/**
 * 계산을 돌리는 화면의 이름(useEngineRun의 이름) → 메뉴의 어느 화면인가. 메뉴에 「계산 중」을 표시하는 데 쓴다.
 * 고급의 화면들(compare·intercept·growth)은 설정 아래에 있다. 모르는 이름이면 null.
 */
export function pageOfRun(run: string | null | undefined): PageKey | null {
  if (!run) return null;
  if (run === RUN_INTERCEPT) return 'intercept';
  if (run === RUN_SUGGEST || run === RUN_DECK || run === RUN_EFFICIENCY) return 'tools';
  return ADVANCED_TABS.some((t) => t.key === run) ? 'settings' : null;
}

/** 기억해 두는 이름들. */
export const LAST_PAGE = 'page';
export const LAST_SECTION = 'settings.section';
export const LAST_ADVANCED = 'settings.advanced';
export const LAST_TOOL = 'tools.tab';

const pick = <T extends string>(list: readonly { key: T }[], value: string, fallback: T): T => list.find((item) => item.key === value)?.key ?? fallback;

export interface Nav {
  page: Ref<PageKey>;
  section: Ref<SettingsSection>;
  advanced: Ref<AdvancedTab>;
  tool: Ref<ToolTab>;
  /** 요격전 화면의 보기(추천 · 기록장). 앱을 켜면 추천이다(기억하지 않는다). */
  interceptView: Ref<InterceptView>;
  /** 화면을 옮기고 기억한다. */
  go(page: PageKey): void;
  /** 요격전 화면을 그 보기로 연다(주지 않으면 추천 — 보스의 추천을 보러 가는 길들이 쓴다). */
  openIntercept(view?: InterceptView): void;
  /** 설정 화면의 그 구획을 연다. */
  openSettings(section: SettingsSection): void;
  /** 설정 > 고급의 그 탭을 연다. */
  openAdvanced(tab: AdvancedTab): void;
  /** 편성 도구의 그 탭을 연다. */
  openTool(tab: ToolTab): void;
}

const KEY: InjectionKey<Nav> = Symbol('nav');

/** 기억해 둔 화면에서 시작한다. 모르는 이름이면 홈이다. */
export function createNav(): Nav {
  const page = ref<PageKey>(pick(PAGES, recall(LAST_PAGE), 'home'));
  const section = ref<SettingsSection>(pick(SETTINGS_SECTIONS, recall(LAST_SECTION), 'account'));
  const advanced = ref<AdvancedTab>(pick(ADVANCED_TABS, recall(LAST_ADVANCED), 'compare'));
  const tool = ref<ToolTab>(pick(TOOL_TABS, recall(LAST_TOOL), 'suggest'));
  const interceptView = ref<InterceptView>('recommend');

  function go(next: PageKey): void {
    page.value = next;
    remember(LAST_PAGE, next);
  }
  function setSection(next: SettingsSection): void {
    section.value = next;
    remember(LAST_SECTION, next);
  }
  function setAdvanced(next: AdvancedTab): void {
    advanced.value = next;
    remember(LAST_ADVANCED, next);
  }
  return {
    page,
    section,
    advanced,
    tool,
    interceptView,
    go,
    openIntercept(next = 'recommend') {
      interceptView.value = next;
      go('intercept');
    },
    openSettings(next) {
      setSection(next);
      go('settings');
    },
    openAdvanced(next) {
      setAdvanced(next);
      setSection('advanced');
      go('settings');
    },
    openTool(next) {
      tool.value = next;
      remember(LAST_TOOL, next);
      go('tools');
    },
  };
}

export function provideNav(): Nav {
  const nav = createNav();
  provide(KEY, nav);
  return nav;
}

/** 화면들이 부른다. 앱 밖에서(화면만 따로 띄운 테스트 등) 쓰이면 null — 그때 옮기는 단추는 아무 일도 하지 않는다. */
export function useNav(): Nav | null {
  return inject(KEY, null);
}
