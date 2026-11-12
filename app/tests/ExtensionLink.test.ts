// 크롬 확장으로 계정 받기 — 화면 쪽: 계정 화면의 방법 순서와 설치 안내, 「크롬 확장 연결」 스위치·연결 코드,
// 확장에서 쿠키를 받았을 때 「계정 새로 받기」가 저절로 이어지는 흐름, 계산 중에는 탭을 옮기지 않는 규칙.
//
// Rust 쪽(backend)은 가짜다. 이 길에서는 **쿠키가 화면에 오지 않는다** — Rust의 수신부가 받아 쿠키 파일에 쓰고 화면에는
// 상태(켜짐·주소·연결 코드·마지막 요청의 결과·「받았다」)만 알린다. 그래서 이 테스트에는 쿠키가 아예 없다.
// 수집은 일어나지 않으며(가짜 결과), 받은 프로필은 검증용 샘플이다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sampleProfile from '../../data/samples/profile.sample.json';
import optionTable from '../../vendor/nikke-calc/data/base_stat_tables/equipment_skills.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { arrivalStep, NO_ARRIVAL, type ArrivalInput } from '../src/lib/extensionLink';
import { simCache } from '../src/lib/runtime';
import type { ExtensionLinkStatus, FetchLine, FetchOutcome, SyncFailure, SyncStatus } from '../src/types';
import { ACCOUNT_PATH, catalog, CONDITION_PATH, documents, FAKE_EVALUATOR, fakeRow } from './helpers/fakeEngine';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  loadReport: vi.fn(),
  overlayStatus: vi.fn(),
  startupReportPath: vi.fn(),
  quitApp: vi.fn(),
  onOverlayState: vi.fn(),
  engineCatalog: vi.fn(),
  engineVersion: vi.fn(),
  engineRunBatch: vi.fn(),
  engineCancel: vi.fn(),
  readJsonFile: vi.fn(),
  pickJsonFile: vi.fn(),
  onEngineProgress: vi.fn(),
  gameWindowStatus: vi.fn(),
  setFollowGame: vi.fn(),
  captureGame: vi.fn(),
  onGameWindow: vi.fn(),
  onGameCapture: vi.fn(),
  accountSyncStatus: vi.fn(),
  accountSaveCookie: vi.fn(),
  accountFetchProfile: vi.fn(),
  accountFetchCancel: vi.fn(),
  accountReadProfile: vi.fn(),
  accountSaveFile: vi.fn(),
  loginWindowOpen: vi.fn(),
  loginWindowTakeCookie: vi.fn(),
  loginWindowClear: vi.fn(),
  onAccountFetch: vi.fn(),
  extensionLinkStatus: vi.fn(),
  extensionLinkSet: vi.fn(),
  extensionLinkNewCode: vi.fn(),
  extensionLinkTakePending: vi.fn(),
  onExtensionLink: vi.fn(),
}));

const api = vi.mocked(backend);

const PROFILE_PATH = 'D:\\engine\\profiles\\me.json';
const ACCOUNT_FILE = 'D:\\repo\\data\\accounts\\me.json';
const ADDRESS = '127.0.0.1:47615';
const CODE = 'ABCD-2345';
const NEW_CODE = 'WXYZ-6789';

const LINES: FetchLine[] = [
  { text: '[+] openid (가림) (area 83): 캐릭터 6종', warning: false },
  { text: '[+] 프로필 저장: profiles/me.json  (6종)', warning: false },
];
const OUTCOME: FetchOutcome = { name: 'me', profile_path: PROFILE_PATH, fetched_at: '2026-11-12T09:01:00.000Z', lines: LINES, warnings: [], seconds: 30 };

/** 수신부가 쿠키를 받았을 때의 「마지막 요청」. */
const RECEIVED = { at: '2026-11-12T09:00:00.000Z', outcome: 'received', message: '크롬 확장에서 쿠키를 받아 저장했다 — 계정을 새로 받는다' };

/** 가짜 Rust가 쥐고 있는 크롬 확장 연결의 상태. */
let rustLink: ExtensionLinkStatus;
let linkListeners: Array<(status: ExtensionLinkStatus) => void>;
/** 가짜 Rust의 계정 상태: 쿠키 파일이 있는지. */
let cookieSaved: boolean;
let written: { name: string; account: Record<string, unknown> }[];
let pendingFetch: { resolve: (o: FetchOutcome) => void; reject: (f: SyncFailure) => void } | null;

const offStatus = (): ExtensionLinkStatus => ({ enabled: false, listening: false, address: ADDRESS, code: CODE, problem: null, pending: false, last: null, locked_seconds: 0 });
const onStatus = (): ExtensionLinkStatus => ({ ...offStatus(), enabled: true, listening: true });

/** Rust가 보내는 `extension-link` 이벤트를 흉내 낸다(상태가 바뀌었다). */
async function emitLink(patch: Partial<ExtensionLinkStatus>): Promise<void> {
  rustLink = { ...rustLink, ...patch };
  for (const listener of [...linkListeners]) listener(structuredClone(rustLink));
  await flushPromises();
}

/** 확장의 단추가 눌렸다: 수신부가 쿠키를 받아 쿠키 파일에 썼고(화면에는 오지 않는다), 화면에 「받았다」를 알린다. */
async function extensionSends(): Promise<void> {
  cookieSaved = true;
  await emitLink({ pending: true, last: RECEIVED });
}

const syncStatus = (name: string | null): SyncStatus => ({
  name: name ?? 'me',
  cookie_saved: cookieSaved,
  cookie_saved_at: cookieSaved ? '2026-11-12T09:00:00.000Z' : null,
  profile_fetched_at: null,
  account_file: null,
  login_window_open: false,
  problems: [],
});

async function render() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}
type Wrapper = Awaited<ReturnType<typeof render>>;
type TabKey = 'compare' | 'intercept' | 'growth' | 'tier' | 'account';

const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const value = (w: Wrapper, testid: string) => (at(w, testid).element as HTMLInputElement).value;
const selectedTab = (w: Wrapper) => w.findAll('[role="tab"][data-testid^="tab-"]').find((t) => t.attributes('aria-selected') === 'true')?.attributes('data-testid');

async function openTab(w: Wrapper, key: TabKey): Promise<void> {
  await at(w, `tab-${key}`).trigger('click');
  await flushPromises();
}

async function click(w: Wrapper, testid: string): Promise<void> {
  await at(w, testid).trigger('click');
  await flushPromises();
}

async function setSwitch(w: Wrapper, on: boolean): Promise<void> {
  await at(w, 'link-toggle').setValue(on);
  await flushPromises();
}

/** 기억해 둔 탭으로 앱을 연다. */
async function renderOn(tab: TabKey): Promise<Wrapper> {
  localStorage.setItem('nikke-companion.tab', tab);
  return render();
}

/** 자동으로 시작된 수집이 가짜 Rust에 닿을 때까지 기다린다. */
async function fetchStarted(): Promise<void> {
  await vi.waitFor(() => expect(pendingFetch).not.toBeNull());
  await flushPromises();
}

/** 가짜 수집을 성공으로 끝내고 변환·저장이 끝날 때까지 기다린다. */
async function finishFetch(w: Wrapper): Promise<void> {
  pendingFetch?.resolve(OUTCOME);
  pendingFetch = null;
  await vi.waitFor(() => expect(at(w, 'fetch-progress').exists()).toBe(false));
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  simCache.clear();
  document.body.innerHTML = '';
  rustLink = offStatus();
  linkListeners = [];
  cookieSaved = false;
  written = [];
  pendingFetch = null;

  api.overlayStatus.mockResolvedValue({ visible: true, click_through: false, shortcut_problems: [] });
  api.startupReportPath.mockResolvedValue(null);
  api.loadReport.mockRejectedValue('결과 파일이 없다');
  api.onOverlayState.mockResolvedValue(() => {});
  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue(FAKE_EVALUATOR);
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r)));
  api.engineCancel.mockResolvedValue(false);
  api.readJsonFile.mockImplementation(async (path) => {
    if (!(path in documents)) throw `파일을 찾을 수 없다: ${path}`;
    return structuredClone(documents[path]);
  });
  api.pickJsonFile.mockResolvedValue(null);
  api.gameWindowStatus.mockResolvedValue({ state: 'missing', window: null, message: '게임 창을 찾을 수 없다', follow: false });
  api.onGameWindow.mockResolvedValue(() => {});
  api.onGameCapture.mockResolvedValue(() => {});
  api.onEngineProgress.mockResolvedValue(() => {});

  // ── 가짜 Rust: 계정 받기 ──
  api.accountSyncStatus.mockImplementation(async (name) => syncStatus(name ?? null));
  api.onAccountFetch.mockResolvedValue(() => {});
  api.accountFetchProfile.mockImplementation(
    () =>
      new Promise<FetchOutcome>((resolve, reject) => {
        pendingFetch = { resolve, reject };
      }),
  );
  api.accountFetchCancel.mockResolvedValue(false);
  api.accountReadProfile.mockResolvedValue({ path: PROFILE_PATH, profile: structuredClone(sampleProfile), option_table: optionTable });
  api.accountSaveFile.mockImplementation(async (name, account) => {
    written.push({ name, account: account as Record<string, unknown> });
    return { path: ACCOUNT_FILE.replace('me.json', `${name}.json`), backup: null };
  });

  // ── 가짜 Rust: 크롬 확장 연결 ──
  api.extensionLinkStatus.mockImplementation(async () => structuredClone(rustLink));
  api.extensionLinkSet.mockImplementation(async (enabled) => {
    rustLink = { ...rustLink, enabled, listening: enabled, problem: null };
    return structuredClone(rustLink);
  });
  api.extensionLinkNewCode.mockImplementation(async () => {
    rustLink = { ...rustLink, code: NEW_CODE };
    return structuredClone(rustLink);
  });
  // 진짜 Rust처럼: 차례는 한 번만 준다.
  api.extensionLinkTakePending.mockImplementation(async () => {
    const had = rustLink.pending;
    rustLink = { ...rustLink, pending: false };
    return had;
  });
  api.onExtensionLink.mockImplementation(async (handler) => {
    linkListeners.push(handler);
    return () => {
      linkListeners = linkListeners.filter((l) => l !== handler);
    };
  });
});

describe('계정 화면의 방법 순서와 설치 안내', () => {
  it('쿠키를 받는 방법이 1 크롬 확장(권장) → 2 쿠키 붙여넣기 → 3 앱 안의 로그인 창 순서로 보인다', async () => {
    const w = await renderOn('account');
    const ways = at(w, 'step-cookie').findAll('[data-testid^="way-"]');
    expect(ways.map((el) => el.attributes('data-testid'))).toEqual(['way-extension', 'way-paste', 'way-login']);
    const titles = ways.map((el) => el.find('.step__way-title').text().replace(/\s+/g, ' '));
    expect(titles[0]).toMatch(/^방법 1 · 크롬 확장 권장/);
    expect(titles[1]).toMatch(/^방법 2 · 쿠키 붙여넣기/);
    expect(titles[2]).toMatch(/^방법 3 · 앱 안의 로그인 창/);
    expect(titles[2]).toContain('비밀번호로 로그인하는 사용자용');
    // 방법마다 제 단추가 제 칸에 있다.
    expect(ways[0].find('[data-testid="link-toggle"]').exists()).toBe(true);
    expect(ways[1].find('[data-testid="cookie-input"]').exists()).toBe(true);
    expect(ways[2].find('[data-testid="login-open"]').exists()).toBe(true);
    expect(at(w, 'step-cookie').text()).toContain('받는 방법은 셋이다');
    // 단계는 여전히 1·2·3이다.
    expect(w.findAll('[data-testid^="step-"]').map((s) => s.attributes('data-testid'))).toEqual(['step-cookie', 'step-fetch', 'step-import']);
  });

  it('처음 쓰는 사람이 따라 할 수 있게 확장을 설치하고 연결하는 순서가 적혀 있다 — 꺼져 있을 때는 펼쳐져 있다', async () => {
    const w = await renderOn('account');
    const howto = at(w, 'link-howto');
    expect(howto.attributes('open')).toBeDefined();
    const steps = howto.findAll('li').map((li) => li.text());
    expect(steps).toHaveLength(6);
    const parts = ['chrome://extensions', '개발자 모드', '압축해제된 확장 프로그램을 로드합니다', '크롬 확장 연결', '연결 코드', '오버레이로 보내기'];
    parts.forEach((part, i) => expect(steps[i]).toContain(part));
    expect(steps[2]).toContain('extension');
    expect(steps[5]).toContain('blablalink.com에 로그인된 상태');
    // 켜 두면(이미 설치한 사람) 접힌다.
    await setSwitch(w, true);
    expect(at(w, 'link-howto').attributes('open')).toBeUndefined();
  });
});

describe('「크롬 확장 연결」 스위치와 연결 코드', () => {
  it('기본은 꺼짐이다 — 켜면 Rust에 켜라고 하고 듣는 주소와 연결 코드를 보이며, 끄면 끄라고 한다', async () => {
    const w = await renderOn('account');
    expect(api.extensionLinkStatus).toHaveBeenCalledTimes(1);
    expect((at(w, 'link-toggle').element as HTMLInputElement).checked).toBe(false);
    expect(at(w, 'link-state').text()).toBe('꺼짐');
    expect(at(w, 'link-code').exists()).toBe(false);
    expect(api.extensionLinkSet).not.toHaveBeenCalled();

    await setSwitch(w, true);
    expect(api.extensionLinkSet).toHaveBeenCalledTimes(1);
    expect(api.extensionLinkSet).toHaveBeenLastCalledWith(true);
    expect((at(w, 'link-toggle').element as HTMLInputElement).checked).toBe(true);
    expect(at(w, 'link-state').text()).toBe(`켜짐 · ${ADDRESS}에서 듣는 중`);
    // 연결 코드는 쿠키가 아니다 — 화면에 그대로 보인다(확장에 옮겨 적는다).
    expect(at(w, 'link-code').text()).toBe(CODE);
    expect(at(w, 'link-problem').exists()).toBe(false);

    await setSwitch(w, false);
    expect(api.extensionLinkSet).toHaveBeenLastCalledWith(false);
    expect(at(w, 'link-state').text()).toBe('꺼짐');
    expect(at(w, 'link-code').exists()).toBe(false);
  });

  it('켜 둔 것은 Rust가 기억한다 — 앱을 다시 열면 켜진 채로 보이고, 화면은 따로 기억하지 않는다', async () => {
    rustLink = onStatus();
    const w = await renderOn('account');
    expect((at(w, 'link-toggle').element as HTMLInputElement).checked).toBe(true);
    expect(at(w, 'link-state').text()).toContain('듣는 중');
    expect(at(w, 'link-code').text()).toBe(CODE);
    // 화면이 켜라고 다시 청하지 않는다(Rust가 켤 때 스스로 연다).
    expect(api.extensionLinkSet).not.toHaveBeenCalled();
    await setSwitch(w, false);
    await setSwitch(w, true);
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(keys.filter((key) => /link|extension|code/i.test(key ?? ''))).toEqual([]);
  });

  it('「코드 다시 만들기」를 누르면 새 코드가 보인다', async () => {
    rustLink = onStatus();
    const w = await renderOn('account');
    await click(w, 'link-new-code');
    expect(api.extensionLinkNewCode).toHaveBeenCalledTimes(1);
    expect(at(w, 'link-code').text()).toBe(NEW_CODE);
  });

  it('열지 못하면(그 포트를 다른 프로그램이 쓴다) 이유를 알린다', async () => {
    const problem = '크롬 확장 연결을 열지 못했다: 127.0.0.1:47615를 다른 프로그램이 쓰고 있다 — 그 프로그램을 끄고 다시 켜라';
    api.extensionLinkSet.mockImplementation(async (enabled) => {
      rustLink = { ...rustLink, enabled, listening: false, problem: enabled ? problem : null };
      return structuredClone(rustLink);
    });
    const w = await renderOn('account');
    await setSwitch(w, true);
    expect(at(w, 'link-state').text()).toBe('켜 두었지만 열지 못했다');
    expect(at(w, 'link-problem').text()).toBe(problem);
    // 끄면 안내가 사라진다.
    await setSwitch(w, false);
    expect(at(w, 'link-problem').exists()).toBe(false);
  });

  it('명령 자체가 실패하면 그렇게 알리고, 상태를 모르면 「확인하지 못했다」로 보인다', async () => {
    api.extensionLinkStatus.mockRejectedValue('명령을 부를 수 없다');
    api.extensionLinkSet.mockRejectedValue('명령을 부를 수 없다');
    const w = await renderOn('account');
    expect(at(w, 'link-state').text()).toBe('상태를 확인하지 못했다');
    await setSwitch(w, true);
    expect(at(w, 'link-problem').text()).toBe('크롬 확장 연결을 켜지 못했다: 명령을 부를 수 없다');
    // 앱 전체의 오류로 번지지 않는다.
    expect(at(w, 'error').exists()).toBe(false);
  });

  it('코드가 틀린 요청이 오면 마지막 요청으로 보인다 — 계정을 받지는 않는다', async () => {
    rustLink = onStatus();
    const w = await renderOn('account');
    expect(at(w, 'link-last').exists()).toBe(false);
    await emitLink({ last: { at: '2026-11-12T09:00:00.000Z', outcome: 'wrong_code', message: '연결 코드가 틀린 요청이 왔다(연속 2회) — 확장에 넣은 코드가 위의 코드와 같은지 확인하라' } });
    expect(at(w, 'link-last').attributes('data-outcome')).toBe('wrong_code');
    expect(at(w, 'link-last').text()).toContain('연결 코드가 틀린 요청이 왔다(연속 2회)');
    await emitLink({ locked_seconds: 60, last: { at: '2026-11-12T09:00:05.000Z', outcome: 'locked', message: '코드를 5번 틀려 요청을 잠시 막았다(60초 남음) — 확장의 코드를 고친 뒤 다시 보내라' } });
    expect(at(w, 'link-last').text()).toContain('잠시 막았다(60초 남음)');
    expect(api.extensionLinkTakePending).not.toHaveBeenCalled();
    expect(api.accountFetchProfile).not.toHaveBeenCalled();
  });
});

describe('확장에서 쿠키를 받으면 「계정 새로 받기」가 저절로 이어진다', () => {
  it('다른 탭을 보고 있어도 계정 탭이 열리고, 수집 → 변환 → 저장 → 다른 화면의 계정 칸까지 간다', async () => {
    rustLink = onStatus();
    const w = await renderOn('compare');
    expect(selectedTab(w)).toBe('tab-compare');
    expect(value(w, 'account-path')).toBe('');

    await extensionSends();
    // 계정 탭이 열리고, 차례를 한 번 가져간 뒤 같은 「계정 새로 받기」가 돈다.
    expect(selectedTab(w)).toBe('tab-account');
    await fetchStarted();
    expect(api.extensionLinkTakePending).toHaveBeenCalledTimes(1);
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
    expect(api.accountFetchProfile).toHaveBeenCalledWith('me');
    // 진행이 계정 화면에 보인다.
    expect(at(w, 'cookie-note').text()).toContain('크롬 확장에서 쿠키를 받았다');
    expect(at(w, 'link-last').text()).toContain('크롬 확장에서 쿠키를 받아 저장했다');
    expect(at(w, 'cookie-state').text()).toContain('쿠키 저장됨');
    expect(at(w, 'fetch-progress').text()).toContain('받는 중');
    expect(at(w, 'fetch-stop').exists()).toBe(true);

    await finishFetch(w);
    // 결과가 계정 화면에 보인다: 받은 줄, 변환 요약, 저장한 파일.
    expect(w.findAll('[data-testid="fetch-line"]').map((el) => el.text())).toEqual(LINES.map((l) => l.text));
    expect(api.accountReadProfile).toHaveBeenCalledWith('me');
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('me');
    expect(at(w, 'import-summary').text()).toContain('6명');
    expect(at(w, 'import-path').text()).toContain(ACCOUNT_FILE);
    expect(at(w, 'account-error').exists()).toBe(false);
    // 다른 화면의 계정 칸.
    for (const key of ['compare', 'intercept', 'growth'] as const) {
      await openTab(w, key);
      expect(value(w, 'account-path')).toBe(ACCOUNT_FILE);
    }
    // 이 길에서 화면은 쿠키를 만지지 않는다: 쿠키를 저장하는 명령·로그인 창 명령을 부르지 않았다.
    expect(api.accountSaveCookie).not.toHaveBeenCalled();
    expect(api.loginWindowTakeCookie).not.toHaveBeenCalled();
    // 계산을 스스로 시작하지도 않는다.
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });

  it('이름 칸에 적어 둔 이름으로 받는다', async () => {
    rustLink = onStatus();
    const w = await renderOn('account');
    await at(w, 'account-name').setValue('부계');
    await extensionSends();
    await fetchStarted();
    expect(api.accountFetchProfile).toHaveBeenCalledWith('부계');
    await finishFetch(w);
    expect(written[0].name).toBe('부계');
  });

  it('앱이 켜지기 전에 받아 둔 것도 잇는다 — 앱을 열면 계정 탭이 열리고 수집이 시작된다', async () => {
    rustLink = { ...onStatus(), pending: true, last: RECEIVED };
    cookieSaved = true;
    const w = await renderOn('tier');
    await fetchStarted();
    expect(selectedTab(w)).toBe('tab-account');
    expect(api.extensionLinkTakePending).toHaveBeenCalledTimes(1);
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
    await finishFetch(w);
    expect(written).toHaveLength(1);
  });

  it('차례는 한 번만 가져간다 — 같은 알림이 다시 와도, 다른 알림이 뒤따라도 수집은 한 번이다', async () => {
    rustLink = onStatus();
    const w = await renderOn('account');
    await extensionSends();
    await fetchStarted();
    // 수집이 도는 동안 수신부가 다른 요청(수집 중이라 받지 않았다)을 알린다. 차례는 이미 가져갔다(pending은 false).
    await emitLink({ last: { at: '2026-11-12T09:00:20.000Z', outcome: 'busy', message: '계정을 받는 중이라 확장이 보낸 쿠키를 받지 않았다 — 끝난 뒤에 다시 보내라' } });
    expect(at(w, 'link-last').attributes('data-outcome')).toBe('busy');
    await finishFetch(w);
    await flushPromises();
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
    expect(api.extensionLinkTakePending).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);

    // 확장의 단추를 한 번 더 누르면 한 번 더 받는다.
    await extensionSends();
    await fetchStarted();
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(2);
    await finishFetch(w);
    expect(written).toHaveLength(2);
  });

  it('다른 쪽이 차례를 이미 가져갔으면(Rust가 false를 준다) 수집을 시작하지 않는다', async () => {
    rustLink = onStatus();
    api.extensionLinkTakePending.mockResolvedValue(false);
    const w = await renderOn('account');
    await extensionSends();
    await flushPromises();
    expect(api.extensionLinkTakePending).toHaveBeenCalledTimes(1);
    expect(api.accountFetchProfile).not.toHaveBeenCalled();
    expect(at(w, 'fetch-progress').exists()).toBe(false);
    // 단추는 다시 쓸 수 있다.
    expect(at(w, 'fetch-run').attributes('disabled')).toBeUndefined();
  });

  it('하던 일이 있으면 끝난 뒤에 잇는다 — 손으로 받는 중에 온 알림은 그 수집이 끝난 다음에 새로 받는다', async () => {
    rustLink = onStatus();
    cookieSaved = true;
    const w = await renderOn('account');
    await click(w, 'fetch-run');
    await fetchStarted();
    await extensionSends();
    // 도는 수집을 건드리지 않는다.
    expect(api.extensionLinkTakePending).not.toHaveBeenCalled();
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
    // 손으로 시작한 수집을 끝낸다. 끝나자마자 다음 수집이 시작되므로 「진행 표시가 사라질 때까지」는 기다리지 않는다.
    pendingFetch?.resolve(OUTCOME);
    pendingFetch = null;
    // 끝나자 차례를 가져가 다시 받는다(확장이 넘긴 새 쿠키로).
    await fetchStarted();
    expect(api.extensionLinkTakePending).toHaveBeenCalledTimes(1);
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(2);
    await finishFetch(w);
    expect(written).toHaveLength(2);
  });

  it('받은 뒤의 수집이 실패하면 여느 때처럼 2단계 아래에 안내가 보인다', async () => {
    rustLink = onStatus();
    const w = await renderOn('account');
    await extensionSends();
    await fetchStarted();
    pendingFetch?.reject({ kind: 'session_expired', message: '로그인 세션이 만료됐다(game not login) — 쿠키를 다시 받아라', cookie_help: true, lines: [], warnings: [] });
    pendingFetch = null;
    await vi.waitFor(() => expect(at(w, 'fetch-progress').exists()).toBe(false));
    await flushPromises();
    expect(at(w, 'account-error').attributes('data-step')).toBe('2');
    expect(at(w, 'account-error-message').text()).toContain('로그인 세션이 만료됐다');
    // 쿠키를 다시 받는 안내에 크롬 확장이 있다.
    expect(at(w, 'account-error').text()).toContain('크롬 확장');
    expect(written).toEqual([]);
    // 실패한 것을 되풀이하지 않는다.
    await flushPromises();
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
  });
});

describe('계산 중에는 탭을 옮기지 않는다', () => {
  /** 엔진 배치를 붙든다: 풀어 줄 때까지 계산이 끝나지 않는다. */
  function holdEngine(): { release: () => void } {
    const waiting: Array<() => void> = [];
    let open = false;
    api.engineRunBatch.mockImplementation(
      (requests) =>
        new Promise((resolve) => {
          const finish = () => resolve(requests.map((r) => fakeRow(r)));
          if (open) finish();
          else waiting.push(finish);
        }),
    );
    return {
      release: () => {
        open = true;
        for (const finish of waiting.splice(0)) finish();
      },
    };
  }

  /** 추천·비교 탭에서 추천 계산을 시작하고, 엔진에 닿을 때까지 기다린다. */
  async function startCompare(w: Wrapper): Promise<void> {
    await at(w, 'account-path').setValue(ACCOUNT_PATH);
    await at(w, 'condition-path').setValue(CONDITION_PATH);
    await at(w, 'run-compute').trigger('click');
    await vi.waitFor(() => {
      if (api.engineRunBatch.mock.calls.length === 0) throw new Error('계산이 아직 엔진에 닿지 않았다');
    });
    await flushPromises();
  }

  async function finishCompute(w: Wrapper, engine: { release: () => void }): Promise<void> {
    engine.release();
    await vi.waitFor(
      () => {
        if (at(w, 'tab-busy').exists()) throw new Error('아직 계산 중이다');
      },
      { timeout: 5000 },
    );
    await flushPromises();
  }

  it('계산이 도는 동안 받으면 보던 탭에 머물고 한 줄로 알린다 — 계산이 끝나면 계정 탭으로 옮겨 받는다', async () => {
    rustLink = onStatus();
    const engine = holdEngine();
    const w = await renderOn('compare');
    await startCompare(w);
    expect(at(w, 'tab-busy').exists()).toBe(true);
    expect(at(w, 'link-pending-move').exists()).toBe(false);

    await extensionSends();
    expect(selectedTab(w)).toBe('tab-compare');
    expect(at(w, 'link-pending-move').text()).toContain('계산이 끝나면 계정 탭으로 옮겨 계정을 새로 받는다');
    // 계정 화면을 아직 연 적이 없다 — 수집은 탭을 열 때 시작한다.
    expect(api.extensionLinkTakePending).not.toHaveBeenCalled();
    expect(api.accountFetchProfile).not.toHaveBeenCalled();

    await finishCompute(w, engine);
    expect(selectedTab(w)).toBe('tab-account');
    expect(at(w, 'link-pending-move').exists()).toBe(false);
    await fetchStarted();
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
    await finishFetch(w);
    expect(written).toHaveLength(1);
  });

  it('계산 중에 계정 탭을 직접 열면 곧바로 받고, 미뤄 둔 이동은 버린다', async () => {
    rustLink = onStatus();
    const engine = holdEngine();
    const w = await renderOn('compare');
    await startCompare(w);
    await extensionSends();
    expect(at(w, 'link-pending-move').exists()).toBe(true);

    await openTab(w, 'account');
    expect(at(w, 'link-pending-move').exists()).toBe(false);
    await fetchStarted();
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
    await finishFetch(w);
    // 다른 탭으로 가 있다가 계산이 끝나도 계정 탭으로 끌려가지 않는다.
    await openTab(w, 'tier');
    await finishCompute(w, engine);
    expect(selectedTab(w)).toBe('tab-tier');
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('계정 화면을 열어 둔 적이 있으면 계산 중에도 받기는 곧바로 시작한다 — 미루는 것은 탭 이동뿐이다', async () => {
    rustLink = onStatus();
    const engine = holdEngine();
    const w = await renderOn('account');
    await openTab(w, 'compare');
    await startCompare(w);

    await extensionSends();
    expect(selectedTab(w)).toBe('tab-compare');
    expect(at(w, 'link-pending-move').exists()).toBe(true);
    await fetchStarted();
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);

    await finishCompute(w, engine);
    expect(selectedTab(w)).toBe('tab-account');
    await finishFetch(w);
    expect(written).toHaveLength(1);
  });
});

describe('계정 탭 열기 규칙(arrivalStep) — 순수 함수', () => {
  const input = (over: Partial<ArrivalInput> = {}): ArrivalInput => ({ arrived: false, computing: false, onAccount: false, ...over });
  const WAITING = { waiting: true };

  it('받았고 계산이 없으면 계정 탭을 연다 — 이미 계정 탭이면 열 것이 없다', () => {
    expect(arrivalStep(NO_ARRIVAL, input({ arrived: true }))).toEqual({ state: NO_ARRIVAL, open: true });
    expect(arrivalStep(NO_ARRIVAL, input({ arrived: true, onAccount: true }))).toEqual({ state: NO_ARRIVAL, open: false });
    expect(arrivalStep(NO_ARRIVAL, input({ arrived: true, onAccount: true, computing: true }))).toEqual({ state: NO_ARRIVAL, open: false });
  });

  it('받은 것이 없으면 아무것도 하지 않는다', () => {
    expect(arrivalStep(NO_ARRIVAL, input())).toEqual({ state: NO_ARRIVAL, open: false });
    expect(arrivalStep(NO_ARRIVAL, input({ computing: true }))).toEqual({ state: NO_ARRIVAL, open: false });
  });

  it('계산 중이면 미뤄 두고, 계산이 끝나면 한 번 연다', () => {
    const held = arrivalStep(NO_ARRIVAL, input({ arrived: true, computing: true }));
    expect(held).toEqual({ state: WAITING, open: false });
    // 계산이 이어지는 동안에는 그대로 미뤄 둔다.
    expect(arrivalStep(held.state, input({ computing: true }))).toEqual({ state: WAITING, open: false });
    const done = arrivalStep(held.state, input());
    expect(done).toEqual({ state: NO_ARRIVAL, open: true });
    // 한 번 열었으면 다시 열지 않는다.
    expect(arrivalStep(done.state, input())).toEqual({ state: NO_ARRIVAL, open: false });
  });

  it('미뤄 둔 동안 사용자가 계정 탭을 직접 열었으면 미뤄 둔 이동을 버린다', () => {
    const opened = arrivalStep(WAITING, input({ computing: true, onAccount: true }));
    expect(opened).toEqual({ state: NO_ARRIVAL, open: false });
    expect(arrivalStep(opened.state, input())).toEqual({ state: NO_ARRIVAL, open: false });
  });

  it('입력을 바꾸지 않는다', () => {
    const state = Object.freeze({ waiting: true });
    const frozen = Object.freeze(input({ computing: true }));
    expect(() => arrivalStep(state, frozen)).not.toThrow();
    expect(Object.isFrozen(NO_ARRIVAL)).toBe(true);
    expect(NO_ARRIVAL).toEqual({ waiting: false });
  });
});
