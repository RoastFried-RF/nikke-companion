// 데스크톱 앱 창(App.vue)을 띄우는 테스트가 함께 쓰는 것:
//   - 앱 창의 틀이 부르는 backend 함수들의 가짜(`shellMocks` — vi.mock의 factory에서 펼친다)와 그 기본 동작(`installShell`),
//   - Rust의 계정 폴더를 흉내 내는 가짜 디스크(`FakeDisk` — 기본 계정·계정 목록·마지막 요격전 결과. src-tauri/src/shared_state.rs의 규칙),
//   - 화면을 여는 도우미(왼쪽 메뉴, 설정의 구획, 고급의 탭).
// 실제 계정 폴더·실제 계정은 쓰지 않는다 — 전부 지어낸 값이다.
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { vi, type MockedObject } from 'vitest';
import type { ComputeActivity, OverlayLaunch, OverlayPrefs, OverlayShape, OverlaySnapshot, SharedSnapshot, WidgetSnapshot } from '../../src/types';

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
    // 오버레이 위젯(P-028): 상태 읽기·모양·핀·창 크기 맞춤·숨기기·끌기, 설정·자리 초기화, 계산 진행.
    'overlayWidget',
    'onOverlayWidget',
    'overlayShape',
    'overlayPin',
    'overlayFit',
    'overlayHide',
    'startOverlayDrag',
    'setOverlayPrefs',
    'resetOverlayPosition',
    'announceActivity',
    'computeActivity',
    'onComputeActivity',
  ];
  return Object.fromEntries(names.map((name) => [name, vi.fn()]));
}

/** 오버레이 위젯의 기본 설정(Rust의 기본값과 같다). */
export const WIDGET_PREFS: OverlayPrefs = { scale_percent: 100, opacity_percent: 100, leave: 'collapse', leave_after_sec: 8, default_shape: 'card', click_through: false };

/** Rust가 쥐고 있는 위젯 상태와 계산 진행을 흉내 낸다(src-tauri/src/lib.rs의 위젯 명령들 — 모양·핀·설정이 바뀌면 모든 창에 알린다). */
export class FakeWidget {
  state: WidgetSnapshot = { shape: 'card', pinned: false, resting: false, prefs: { ...WIDGET_PREFS }, problem: null };
  activity: ComputeActivity = { running: false, label: '', done: 0, total: 0, elapsed_ms: 0 };
  /** `overlay-widget`·`compute-activity` 이벤트를 듣는 창들. */
  listeners = new Set<(snapshot: WidgetSnapshot) => void>();
  activityListeners = new Set<(activity: ComputeActivity) => void>();
  /** 자리 초기화를 부른 횟수. */
  resets = 0;

  snapshot(): WidgetSnapshot {
    return { ...this.state, prefs: { ...this.state.prefs } };
  }

  /** 모든 창에 알린다(Rust의 emit). */
  emit(): WidgetSnapshot {
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
    return snapshot;
  }

  /** Rust 쪽에서 상태가 바뀐 것처럼(단축키·자동 표시) 바꾸고 알린다. */
  set(patch: Partial<WidgetSnapshot>): WidgetSnapshot {
    this.state = { ...this.state, ...patch };
    return this.emit();
  }

  /** 앱 창이 진행을 알린 것처럼 바꾸고 알린다. */
  announce(activity: ComputeActivity): ComputeActivity {
    this.activity = activity.running ? { ...activity } : { running: false, label: '', done: 0, total: 0, elapsed_ms: 0 };
    for (const listener of [...this.activityListeners]) listener({ ...this.activity });
    return { ...this.activity };
  }
}

const NEXT_SHAPE: Record<OverlayShape, OverlayShape> = { collapsed: 'card', card: 'expanded', expanded: 'collapsed' };

/** 가짜 디스크에 딸린 가짜 위젯(테스트가 `widgetOf(disk)`로 꺼낸다). */
const widgets = new WeakMap<FakeDisk, FakeWidget>();
export function widgetOf(disk: FakeDisk): FakeWidget {
  const found = widgets.get(disk);
  if (!found) throw new Error('installShell로 만든 디스크가 아니다');
  return found;
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

  // 오버레이 위젯: Rust가 쥔 상태를 흉내 낸다. 창 크기 맞춤·끌기·숨기기는 불린 것만 적는다.
  const widget = new FakeWidget();
  widgets.set(disk, widget);
  api.overlayWidget.mockImplementation(async () => widget.snapshot());
  api.onOverlayWidget.mockImplementation(async (handler) => {
    widget.listeners.add(handler);
    return () => widget.listeners.delete(handler);
  });
  api.overlayShape.mockImplementation(async (shape: OverlayShape | 'next') => widget.set({ shape: shape === 'next' ? NEXT_SHAPE[widget.state.shape] : shape }));
  api.overlayPin.mockImplementation(async (pinned: boolean) => widget.set({ pinned }));
  api.overlayFit.mockResolvedValue(undefined);
  api.startOverlayDrag.mockResolvedValue(undefined);
  api.overlayHide.mockImplementation(async () => {
    overlay.visible = false;
    return { ...overlay };
  });
  api.setOverlayPrefs.mockImplementation(async (patch: Partial<OverlayPrefs>) => {
    if (patch.click_through !== undefined && !overlay.visible) throw '오버레이가 숨겨져 있어 클릭 통과를 바꾸지 못했다. 오버레이를 띄운 뒤에 바꾼다';
    if (patch.click_through !== undefined) overlay.click_through = patch.click_through;
    return widget.set({ prefs: { ...widget.state.prefs, ...patch } });
  });
  api.resetOverlayPosition.mockImplementation(async () => {
    widget.resets += 1;
    return widget.snapshot();
  });
  api.announceActivity.mockImplementation(async (activity: ComputeActivity) => widget.announce(activity));
  api.computeActivity.mockImplementation(async () => ({ ...widget.activity }));
  api.onComputeActivity.mockImplementation(async (handler) => {
    widget.activityListeners.add(handler);
    return () => widget.activityListeners.delete(handler);
  });
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
