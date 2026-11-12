// 데스크톱 앱 창(App.vue)을 띄우는 테스트가 함께 쓰는 것:
//   - 앱 창의 틀이 부르는 backend 함수들의 가짜(`shellMocks` — vi.mock의 factory에서 펼친다)와 그 기본 동작(`installShell`),
//   - Rust의 계정 폴더를 흉내 내는 가짜 디스크(`FakeDisk` — 기본 계정·계정 목록·마지막 요격전 결과. src-tauri/src/shared_state.rs의 규칙),
//   - 화면을 여는 도우미(왼쪽 메뉴, 설정의 구획, 고급의 탭).
// 실제 계정 폴더·실제 계정은 쓰지 않는다 — 전부 지어낸 값이다.
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { vi, type MockedObject } from 'vitest';
import type { OverlayLaunch, OverlaySnapshot, SharedSnapshot } from '../../src/types';

type Backend = typeof import('../../src/lib/backend');
type Api = MockedObject<Backend>;
type Wrapper = VueWrapper;

/** 앱 창의 틀과 홈·설정이 부르는 함수들. vi.mock의 factory에서 `...shellMocks()`로 펼친다(그 뒤에 적은 것이 이긴다). */
export function shellMocks(): Record<string, ReturnType<typeof vi.fn>> {
  const names = [
    'sharedState',
    'setDefaultAccount',
    'setOverlayLaunch',
    'readAccount',
    'saveInterceptResult',
    'loadInterceptResult',
    'onSharedState',
    'setOverlayVisible',
    'showAppWindow',
    'overlayStatus',
    'onOverlayState',
    'startupReportPath',
    'gameWindowStatus',
    'onGameWindow',
    'onGameCapture',
    'setFollowGame',
  ];
  return Object.fromEntries(names.map((name) => [name, vi.fn()]));
}

/** 계정 폴더를 흉내 낸다. */
export class FakeDisk {
  accounts = new Map<string, { doc: unknown; modified_at: string }>();
  /** 사용자가 고른 기본 계정(상태 파일). */
  chosen: string | null = null;
  launch: OverlayLaunch = 'with_app';
  intercept: unknown | null = null;
  interceptSavedAt: string | null = null;
  problems: string[] = [];
  /** `shared-state` 이벤트를 듣는 창들. */
  listeners = new Set<(snapshot: SharedSnapshot) => void>();
  private clock = 0;

  /** 지어낸 시각(부를 때마다 1초씩 는다). */
  now(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 10, 12, 6, 0, this.clock)).toISOString();
  }

  addAccount(name: string, doc: unknown): void {
    this.accounts.set(name, { doc, modified_at: this.now() });
  }

  /** Rust의 규칙: 고른 계정이 아직 있으면 그것, 아니면 계정이 하나뿐일 때 그것. */
  effective(): { name: string | null; remembered: boolean } {
    if (this.chosen && this.accounts.has(this.chosen)) return { name: this.chosen, remembered: true };
    if (this.accounts.size === 1) return { name: [...this.accounts.keys()][0], remembered: false };
    return { name: null, remembered: false };
  }

  snapshot(): SharedSnapshot {
    const { name, remembered } = this.effective();
    return {
      default_account: name,
      remembered,
      accounts: [...this.accounts.entries()].map(([n, a]) => ({ name: n, modified_at: a.modified_at })).sort((a, b) => a.name.localeCompare(b.name)),
      overlay_launch: this.launch,
      intercept_saved_at: this.interceptSavedAt,
      problems: [...this.problems],
    };
  }

  /** 모든 창에 알린다(Rust의 emit). */
  emit(): SharedSnapshot {
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
    return snapshot;
  }

  /** 다른 창(또는 앞선 실행)이 결과를 저장한 것처럼 디스크에 둔다. `announce`면 알림도 보낸다. */
  putIntercept(report: unknown, announce = false): void {
    this.intercept = structuredClone(report);
    this.interceptSavedAt = this.now();
    if (announce) this.emit();
  }
}

/**
 * 앱 창의 틀이 부르는 함수들의 기본 동작을 건다(`vi.resetAllMocks()` 뒤에 부른다). 가짜 디스크를 돌려준다.
 * 오버레이는 떠 있고, 게임은 없고, 실행 인자는 없다 — 테스트가 그 뒤에 바꿔 건다.
 */
export function installShell(api: Api, disk: FakeDisk = new FakeDisk()): FakeDisk {
  const overlay: OverlaySnapshot = { visible: true, click_through: false, shortcut_problems: [] };
  api.overlayStatus.mockImplementation(async () => ({ ...overlay }));
  api.onOverlayState.mockResolvedValue(() => {});
  api.setOverlayVisible.mockImplementation(async (visible: boolean) => {
    overlay.visible = visible;
    return { ...overlay };
  });
  api.showAppWindow.mockResolvedValue(undefined);
  api.startupReportPath.mockResolvedValue(null);
  api.gameWindowStatus.mockResolvedValue({ state: 'missing', window: null, message: '게임 창을 찾을 수 없다', follow: false });
  api.onGameWindow.mockResolvedValue(() => {});
  api.onGameCapture.mockResolvedValue(() => {});
  api.setFollowGame.mockImplementation(async (enabled: boolean) => ({ state: 'missing', window: null, message: '게임 창을 찾을 수 없다', follow: enabled }));

  api.sharedState.mockImplementation(async () => disk.snapshot());
  api.onSharedState.mockImplementation(async (handler) => {
    disk.listeners.add(handler);
    return () => disk.listeners.delete(handler);
  });
  api.setDefaultAccount.mockImplementation(async (name: string) => {
    if (!disk.accounts.has(name)) throw `'${name}' 계정을 찾을 수 없다. 설정의 계정 연결에서 계정을 새로 받아라`;
    disk.chosen = name;
    return disk.emit();
  });
  api.setOverlayLaunch.mockImplementation(async (mode: OverlayLaunch) => {
    disk.launch = mode;
    return disk.emit();
  });
  api.readAccount.mockImplementation(async (name: string | null = null) => {
    const target = name ?? disk.effective().name;
    if (!target) throw '연결된 계정이 없다. 설정의 계정 연결에서 계정을 받아라';
    const found = disk.accounts.get(target);
    if (!found) throw `'${target}' 계정을 찾을 수 없다. 설정의 계정 연결에서 계정을 새로 받아라`;
    return { name: target, modified_at: found.modified_at, account: structuredClone(found.doc) } as never;
  });
  api.saveInterceptResult.mockImplementation(async (report) => {
    const doc = report as unknown as { kind?: unknown; schema_version?: unknown };
    if (doc.kind !== 'intercept_report') throw `요격전 추천 결과가 아니다(종류: ${String(doc.kind ?? '없음')}). 앞서 저장한 결과는 그대로 둔다`;
    if (doc.schema_version !== 1) throw `요격전 추천 결과의 판이 다르다(받은 것 ${String(doc.schema_version)}, 이 앱이 읽는 판 1). 앞서 저장한 결과는 그대로 둔다`;
    disk.intercept = structuredClone(report);
    disk.interceptSavedAt = disk.now();
    return disk.emit();
  });
  api.loadInterceptResult.mockImplementation(async () => (disk.intercept === null ? null : structuredClone(disk.intercept)));
  return disk;
}

const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);

async function click(w: Wrapper, testid: string): Promise<void> {
  await at(w, testid).trigger('click');
  await flushPromises();
}

export type PageKey = 'home' | 'intercept' | 'roster' | 'tools' | 'tier' | 'settings';
export type SectionKey = 'account' | 'overlay' | 'engine' | 'advanced';
/** 예전 오버레이의 탭 이름. 지금은 설정 아래에 있다: 추천·비교/요격전/성장/티어 → 고급의 탭, 계정 → 계정 연결. */
export type LegacyTab = 'compare' | 'intercept' | 'growth' | 'tier' | 'account';

/** 왼쪽 메뉴에서 화면을 연다. */
export async function openPage(w: Wrapper, key: PageKey): Promise<void> {
  await click(w, `nav-${key}`);
}

/** 설정 화면의 구획을 연다. */
export async function openSection(w: Wrapper, key: SectionKey): Promise<void> {
  await click(w, 'nav-settings');
  await click(w, `section-${key}`);
}

/** 예전 탭에 해당하는 화면을 연다(설정 > 고급의 탭, 또는 설정 > 계정 연결). */
export async function openLegacy(w: Wrapper, key: LegacyTab): Promise<void> {
  if (key === 'account') return openSection(w, 'account');
  await openSection(w, 'advanced');
  await click(w, `tab-${key}`);
}

/** 지금 보이는 화면(왼쪽 메뉴에서 고른 것). */
export function currentPage(w: Wrapper): string {
  return w.find('[data-testid^="nav-"][aria-current="page"]').attributes('data-testid')?.replace('nav-', '') ?? '';
}

/** 예전 탭에 해당하는 화면이 지금 보이는가. */
export function legacyOpen(w: Wrapper, key: LegacyTab): boolean {
  if (currentPage(w) !== 'settings') return false;
  if (key === 'account') return at(w, 'screen-account').exists();
  return at(w, `tab-${key}`).exists() && at(w, `tab-${key}`).attributes('aria-selected') === 'true';
}
