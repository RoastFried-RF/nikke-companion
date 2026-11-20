// 계정 화면의 흐름: 쿠키 저장(붙여넣기·로그인 창) → 계정 새로 받기 → 변환 → 계정 파일 저장 → 다른 화면의 계정 칸.
// Rust 쪽(backend)은 가짜다 — 쿠키는 지어낸 글자이고, 수집은 일어나지 않으며(가짜 결과), 받은 프로필은 검증용 샘플
// (data/samples/profile.sample.json)이다. 변환은 루트의 실제 코드(src/core/import-profile.mjs)가 실제 엔진 데이터로 한다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sampleProfile from '../../data/samples/profile.sample.json';
import optionTable from '../../vendor/nikke-calc/data/base_stat_tables/equipment_skills.json';
import App from '../src/App.vue';
import accountFailureSource from '../src/components/AccountFailure.vue?raw';
import * as backend from '../src/lib/backend';
import accountScreenSource from '../src/screens/AccountScreen.vue?raw';
import type { FetchLine, FetchOutcome, SyncFailure, SyncStatus } from '../src/types';
import { catalog } from './helpers/fakeEngine';
import { FakeDisk, installShell, openLegacy } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
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
  updateMode: vi.fn(),
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
  accountFetchCancel: vi.fn(),
  accountReadProfile: vi.fn(),
  accountSaveFile: vi.fn(),
  loginWindowOpen: vi.fn(),
  loginWindowTakeCookie: vi.fn(),
  loginWindowClear: vi.fn(),
  onAccountFetch: vi.fn(),
}));

const api = vi.mocked(backend);

/** 지어낸 쿠키. 실제 계정의 값이 아니다. */
const TOKEN = 'FAKE-TOKEN-front-9e107d9d372bb6826bd81d3542a419d6';
const OPENID = '70605040302010998877';
const FAKE_COOKIE = `game_token=${TOKEN}; game_openid=${OPENID}; game_gameid=29080`;

const PROFILE_PATH = 'D:\\engine\\profiles\\me.json';
const ACCOUNT_FILE = 'D:\\repo\\data\\accounts\\me.json';
const SAVED_AT = '2026-11-12T06:00:00.000Z';

/** 진짜 수집 스크립트가 내는 모양의 줄(쿠키 값은 Rust가 이미 가렸다). */
const LINES: FetchLine[] = [
  { text: '[+] openid (가림) (area 83): 캐릭터 6종', warning: false },
  { text: '[+] 상세 수집 중… (동기화 소대 5종 · 소대 밖 1종)', warning: false },
  { text: '[+] 원시 저장: profiles/me.raw.json', warning: false },
  { text: '[+] CDN 매핑 수집 중…', warning: false },
  { text: '[+] 프로필 저장: profiles/me.json  (6종, 1종 이름매핑 실패)', warning: false },
  { text: '    이름매핑 실패 name_code(신캐·미수집 가능): [9999]', warning: false },
  { text: "[!] 애장품 단계 3 미만 1명 — 그 단계의 스킬 판본으로 계산된다. 판본이 아직 파싱 안 됐으면 시뮬이 그 사실을 알리며 끊는다: {'헬름': 2}", warning: true },
  { text: '[!] 모르는 재활용 연구실 tid 1301 (lv 3) — 무시했다. 신규 역할군·기업이면 profile_fetch.py의 CONSOLE_TIDS에 추가하라', warning: true },
  { text: "[+] 동기화 소대 밖 1종 (참고) — 레벨은 정책이 정하므로 계산에는 영향이 없다. 다만 이쪽은 대체로 스킬·장비 투자가 없어 딜이 낮게 나온다: ['나가']", warning: false },
  { text: '[+] 소장품 미장착 0종 · 장비 4부위 전부 미장착 0종', warning: false },
];
const WARNINGS = LINES.filter((l) => l.warning).map((l) => l.text);
const OUTCOME: FetchOutcome = { name: 'me', profile_path: PROFILE_PATH, fetched_at: '2026-11-12T06:01:00.000Z', lines: LINES, warnings: WARNINGS, seconds: 41.2 };

const failureOf = (kind: string, message: string, cookie_help: boolean, lines: FetchLine[] = []): SyncFailure => ({
  kind,
  message,
  cookie_help,
  lines,
  warnings: lines.filter((l) => l.warning).map((l) => l.text),
});

/** 가짜 Rust의 상태: 쿠키 파일이 있는지, 받은 프로필과 계정 파일. */
let state: { cookie: boolean; fetchedAt: string | null; accountFile: string | null; loginOpen: boolean; problems: string[] };
/** 가짜 Rust가 받은 계정 문서(계정 파일로 쓴 것). */
let written: { name: string; account: Record<string, unknown> }[];
/** Rust가 보내는 진행 줄을 흉내 낸다. */
let emitLine: (line: FetchLine) => void = () => {};
/** 수집을 테스트가 원하는 때에 끝낸다. */
let pendingFetch: { resolve: (o: FetchOutcome) => void; reject: (f: SyncFailure) => void } | null;

const status = (name: string | null): SyncStatus => ({
  name: name ?? 'me',
  cookie_saved: state.cookie,
  cookie_saved_at: state.cookie ? SAVED_AT : null,
  profile_fetched_at: state.fetchedAt,
  account_file: state.accountFile,
  login_window_open: state.loginOpen,
  problems: state.problems,
});

async function render() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}
type Wrapper = Awaited<ReturnType<typeof render>>;

const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const texts = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`).map((el) => el.text());
const value = (w: Wrapper, testid: string) => (at(w, testid).element as HTMLInputElement).value;

/** 예전 탭에 해당하는 화면을 연다: 계정 → 설정 > 계정 연결, 그 밖 → 설정 > 고급의 탭(P-027). */
async function openTab(w: Wrapper, key: 'compare' | 'intercept' | 'growth' | 'tier' | 'account'): Promise<void> {
  await openLegacy(w, key);
}

/** 계정 폴더를 흉내 내는 가짜 디스크(저장한 계정이 여기에 생기고, 기본 계정이 여기에 기억된다). */
let disk = new FakeDisk();

async function click(w: Wrapper, testid: string): Promise<void> {
  await at(w, testid).trigger('click');
  await flushPromises();
}

async function paste(w: Wrapper, text: string): Promise<void> {
  await at(w, 'cookie-input').setValue(text);
  await at(w, 'cookie-save').trigger('click');
  await flushPromises();
}

/** 화면에 그려진 것 전부(글자와 속성) + 입력 칸의 값 + 이 웹뷰가 기억해 둔 것. 쿠키가 어디에도 없어야 한다. */
function everythingShown(w: Wrapper): string {
  const inputs = [...document.querySelectorAll('input, textarea')].map((el) => (el as HTMLInputElement).value);
  const stored: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) ?? '';
    stored.push(key, localStorage.getItem(key) ?? '');
  }
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i) ?? '';
    stored.push(key, sessionStorage.getItem(key) ?? '');
  }
  return [w.html(), document.body.innerHTML, document.body.textContent ?? '', ...inputs, ...stored].join('\n');
}

function expectNoCookie(w: Wrapper): void {
  const shown = everythingShown(w);
  for (const secret of [TOKEN, OPENID, FAKE_COOKIE]) expect(shown).not.toContain(secret);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
  state = { cookie: false, fetchedAt: null, accountFile: null, loginOpen: false, problems: [] };
  written = [];
  pendingFetch = null;
  emitLine = () => {};
  disk = installShell(api);

  api.overlayStatus.mockResolvedValue({ visible: true, click_through: false, shortcut_problems: [] });
  api.startupReportPath.mockResolvedValue(null);
  api.loadReport.mockRejectedValue('결과 파일이 없다');
  api.onOverlayState.mockResolvedValue(() => {});
  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue({ repo: 'fake/engine', commit: null });
  api.engineRunBatch.mockResolvedValue([]);
  api.engineCancel.mockResolvedValue(false);
  api.readJsonFile.mockRejectedValue('파일을 찾을 수 없다');
  api.pickJsonFile.mockResolvedValue(null);
  api.gameWindowStatus.mockResolvedValue({ state: 'missing', window: null, message: '게임 창을 찾을 수 없다', follow: false });
  api.onGameWindow.mockResolvedValue(() => {});
  api.onGameCapture.mockResolvedValue(() => {});
  api.onEngineProgress.mockResolvedValue(() => {});

  // ── 가짜 Rust: 계정 받기 ──
  api.accountSyncStatus.mockImplementation(async (name) => status(name ?? null));
  // 진짜 Rust처럼: 필수 쿠키가 없으면 거부하고, 받아들이면 시각과 개수만 돌려준다(쿠키는 돌려주지 않는다).
  api.accountSaveCookie.mockImplementation(async (cookie) => {
    if (!cookie.includes('game_token=') || !cookie.includes('game_openid=')) {
      throw failureOf('cookie_rejected', '쿠키에 game_token=가 없다 — 로그인한 상태에서 api.blablalink.com 요청의 Cookie 헤더 전체를 복사했는지 확인하라', true);
    }
    state.cookie = true;
    return { saved_at: SAVED_AT, count: cookie.split(';').length };
  });
  api.onAccountFetch.mockImplementation(async (handler) => {
    emitLine = handler;
    return () => {
      emitLine = () => {};
    };
  });
  api.accountFetchProfile.mockImplementation(
    () =>
      new Promise<FetchOutcome>((resolve, reject) => {
        pendingFetch = { resolve, reject };
      }),
  );
  api.accountFetchCancel.mockImplementation(async () => {
    if (!pendingFetch) return false;
    pendingFetch.reject(failureOf('stopped', '중단됨: 계정 수집을 멈췄다', false, LINES.slice(0, 2)));
    pendingFetch = null;
    return true;
  });
  api.accountReadProfile.mockResolvedValue({ path: PROFILE_PATH, profile: structuredClone(sampleProfile), option_table: optionTable });
  api.accountSaveFile.mockImplementation(async (name, account) => {
    const backup = state.accountFile ? `${ACCOUNT_FILE}.bak` : null;
    written.push({ name, account: account as Record<string, unknown> });
    disk.addAccount(name, account);
    state.accountFile = ACCOUNT_FILE.replace('me.json', `${name}.json`);
    return { path: state.accountFile, backup };
  });
  api.loginWindowOpen.mockImplementation(async () => {
    state.loginOpen = true;
  });
  api.loginWindowTakeCookie.mockImplementation(async () => {
    state.cookie = true;
    state.loginOpen = false;
    return { saved_at: SAVED_AT, count: 3 };
  });
  api.loginWindowClear.mockResolvedValue('로그인 창의 쿠키·저장 데이터를 지웠다');
});

/** 「계정 새로 받기」를 누르고, 가짜 수집이 Rust에 닿을 때까지 기다린다. */
async function startFetch(w: Wrapper): Promise<void> {
  await click(w, 'fetch-run');
  await vi.waitFor(() => expect(pendingFetch).not.toBeNull());
}

/** 가짜 수집을 성공으로 끝내고 변환·저장이 끝날 때까지 기다린다. */
async function finishFetch(w: Wrapper, outcome: FetchOutcome = OUTCOME): Promise<void> {
  state.fetchedAt = outcome.fetched_at;
  pendingFetch?.resolve(outcome);
  pendingFetch = null;
  await vi.waitFor(() => expect(at(w, 'fetch-progress').exists()).toBe(false));
  await flushPromises();
}

async function failFetch(w: Wrapper, failure: SyncFailure): Promise<void> {
  pendingFetch?.reject(failure);
  pendingFetch = null;
  await vi.waitFor(() => expect(at(w, 'fetch-progress').exists()).toBe(false));
  await flushPromises();
}

describe('계정 연결과 업데이트 설치', () => {
  it('구획을 옮겨도 수집과 저장이 모두 끝나야 설치할 수 있고 설치 중에는 새 수집을 막는다', async () => {
    api.updateMode.mockResolvedValue(true);
    api.checkUpdate.mockResolvedValue({ rid: 1, version: '1.2.3' });
    let finishSave!: () => void;
    api.accountSaveFile.mockImplementationOnce(() => new Promise(resolve => {
      finishSave = () => resolve({ path: ACCOUNT_FILE, backup: null });
    }));
    let failInstall!: (e: Error) => void;
    api.installUpdate.mockImplementationOnce(() => new Promise((_, reject) => { failInstall = reject; }));
    const w = await render();
    try {
      await openTab(w, 'account');
      await startFetch(w);
      await click(w, 'section-updates');
      const install = () => w.get('section[aria-label="앱 정보·업데이트"] button');
      expect(install().attributes('disabled')).toBeDefined();
      await install().trigger('click');
      expect(api.installUpdate).not.toHaveBeenCalled();
      pendingFetch!.resolve(OUTCOME);
      await vi.waitFor(() => expect(api.accountSaveFile).toHaveBeenCalledOnce());
      expect(install().attributes('disabled')).toBeDefined();
      finishSave();
      await flushPromises();
      expect(install().attributes('disabled')).toBeUndefined();
      await install().trigger('click');
      expect(api.installUpdate).toHaveBeenCalledOnce();
      await click(w, 'section-account');
      expect(at(w, 'fetch-run').attributes('disabled')).toBeDefined();
      await at(w, 'account-name').trigger('keydown.enter');
      expect(api.accountFetchProfile).toHaveBeenCalledOnce();
      expect(api.accountSaveFile).toHaveBeenCalledOnce();
      failInstall(new Error('설치 실패'));
      await flushPromises();
      expect(at(w, 'fetch-run').attributes('disabled')).toBeUndefined();
    } finally {
      w.unmount();
    }
  });
});

describe('계정 화면의 모양', () => {
  it('계정 탭에 1·2·3 단계가 차례로 보인다', async () => {
    const w = await render();
    await openTab(w, 'account');
    expect(at(w, 'screen-account').exists()).toBe(true);
    const steps = w.findAll('[data-testid^="step-"]');
    expect(steps.map((s) => s.attributes('data-testid'))).toEqual(['step-cookie', 'step-fetch', 'step-import']);
    expect(steps.map((s) => s.find('.step__no').text())).toEqual(['1', '2', '3']);
    expect(steps.map((s) => s.find('.step__title').text().replace(/\s+/g, ' '))).toEqual(['1 쿠키 받기 쿠키 없음', '2 계정 새로 받기', '3 변환·저장']);
    // 첫 화면: 쿠키가 없고, 받은 것도 없다.
    expect(at(w, 'cookie-state').text()).toBe('쿠키 없음');
    // 저장할 이름과, 받으면 계산에 쓸 계정이 된다는 것을 알린다(파일 경로는 적지 않는다 — P-027의 문구 원칙).
    expect(at(w, 'import-hint').text()).toContain('me(이)라는 이름으로 저장하고, 계산에 쓸 계정으로 정한다');
    expect(at(w, 'account-state').text()).toBe('연결 안 됨');
    expect(at(w, 'account-error').exists()).toBe(false);
    expect(api.accountSyncStatus).toHaveBeenCalledWith('me');
  });

  it('쿠키 입력 칸은 가려진 형식이고 브라우저가 기억하지 않는다', async () => {
    const w = await render();
    await openTab(w, 'account');
    const input = at(w, 'cookie-input');
    expect(input.attributes('type')).toBe('password');
    expect(input.attributes('autocomplete')).toBe('off');
    // 빈 칸으로는 저장할 수 없다.
    expect(at(w, 'cookie-save').attributes('disabled')).toBeDefined();
    await click(w, 'cookie-save');
    expect(api.accountSaveCookie).not.toHaveBeenCalled();
  });

  it('엔진 폴더·python 문제를 알린다', async () => {
    state.problems = ['엔진 폴더(vendor/nikke-calc)를 찾을 수 없다', '수집 스크립트를 실행할 수 없다 (python): program not found'];
    const w = await render();
    await openTab(w, 'account');
    expect(texts(w, 'account-problems')[0]).toContain('엔진 폴더(vendor/nikke-calc)를 찾을 수 없다');
    expect(texts(w, 'account-problems')[0]).toContain('수집 스크립트를 실행할 수 없다 (python)');
  });

  it('이미 받은 것이 있으면 쿠키 상태·마지막으로 받은 때·계정 파일을 보인다', async () => {
    state = { ...state, cookie: true, fetchedAt: '2026-11-12T06:01:00.000Z', accountFile: ACCOUNT_FILE };
    const w = await render();
    await openTab(w, 'account');
    expect(at(w, 'cookie-state').text()).toContain('쿠키 저장됨');
    expect(at(w, 'last-fetch').text()).toContain('마지막으로 받은 때');
    expect(at(w, 'existing-account').text()).toBe(ACCOUNT_FILE);
  });
});

describe('붙여넣기 → 계정 새로 받기 → 변환 → 저장', () => {
  it('차례대로 끝까지 가고, 저장한 계정 파일이 추천·비교, 요격전, 성장 화면의 계정 칸에 들어간다', async () => {
    const w = await render();
    // 요격전 화면은 미리 열어 둔다(열려 있는 화면). 성장 화면은 열지 않는다(나중에 처음 여는 화면).
    await openTab(w, 'intercept');
    expect(value(w, 'account-path')).toBe('');
    await openTab(w, 'account');

    // 1 쿠키 저장
    // 붙여넣은 글자는 손대지 않고 그대로 Rust에 넘긴다 — 정리(앞뒤 공백·줄바꿈)와 확인은 Rust가 한다.
    await paste(w, `  ${FAKE_COOKIE}  `);
    expect(api.accountSaveCookie).toHaveBeenCalledTimes(1);
    expect(api.accountSaveCookie).toHaveBeenCalledWith(`  ${FAKE_COOKIE}  `);
    expect(at(w, 'cookie-note').text()).toContain('붙여넣은 쿠키 3개를 저장했다');
    expect(at(w, 'cookie-note').text()).toContain('「계정 새로 받기」');
    expect(at(w, 'cookie-state').text()).toContain('쿠키 저장됨');

    // 2 계정 새로 받기 — 도는 동안 줄이 오는 대로 보인다
    await startFetch(w);
    expect(api.accountFetchProfile).toHaveBeenCalledWith('me');
    expect(at(w, 'fetch-progress').text()).toContain('받는 중');
    expect(at(w, 'fetch-stop').exists()).toBe(true);
    emitLine(LINES[0]);
    emitLine(LINES[1]);
    await flushPromises();
    expect(texts(w, 'fetch-line')).toEqual([LINES[0].text, LINES[1].text]);
    await finishFetch(w);

    // 스크립트가 낸 줄은 하나도 빠지지 않고, 경고는 따로 모여 보인다
    expect(texts(w, 'fetch-line')).toEqual(LINES.map((l) => l.text.trim()));
    expect(texts(w, 'fetch-warning')).toEqual(WARNINGS);
    expect(at(w, 'fetch-warnings').text()).toContain('경고 2건');
    expect(at(w, 'fetch-log').text()).toContain(`${LINES.length}줄`);

    // 3 변환(루트의 실제 코드) → 저장
    expect(api.accountReadProfile).toHaveBeenCalledWith('me');
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('me');
    const account = written[0].account as { name: string; source: string; nikkes: Record<string, { skill_levels: number[] }>; account: { synchro_level: number } };
    expect(account.name).toBe('me');
    expect(account.source).toBe('import');
    expect(Object.keys(account.nikkes).sort()).toEqual(Object.keys(sampleProfile.chars).sort());
    expect(account.nikkes.헬름.skill_levels).toEqual([7, 7, 10]);
    const summary = at(w, 'import-summary').text().replace(/\s+/g, ' ');
    expect(summary).toContain('가져온 니케 6명');
    expect(summary).toContain('받은 항목 6개');
    expect(summary).toContain('건너뛴 항목 0개');
    expect(summary).toContain('미확인 칸이 있는 니케 0명');
    expect(summary).toContain('동기화 레벨 412');
    expect(at(w, 'import-kind').text()).toBe('검증용 데이터');
    expect(at(w, 'import-path').text()).toContain(ACCOUNT_FILE);
    expect(at(w, 'import-backup').exists()).toBe(false);
    // 받은 계정이 곧바로 계산에 쓸 계정이 된다(요격전·편성 도구·내 니케가 이 계정을 쓴다) — 디스크에 기억된다.
    expect(at(w, 'import-adopted').text()).toContain('이 계정을 계산에 쓸 계정으로 정했다');
    expect(api.setDefaultAccount).toHaveBeenCalledWith('me');
    expect(disk.chosen).toBe('me');
    expect(at(w, 'account-state').text()).toBe('연결됨 · me');
    // 주의 문구는 루트 모듈의 것 그대로다(미확인 칸은 미육성 값으로 — 낮게 나올 수 있다).
    expect(at(w, 'import-caveats').text()).toContain('실제보다 낮게 나올 수 있다');
    expect(at(w, 'account-error').exists()).toBe(false);

    // 다른 화면의 계정 칸: 열려 있던 화면(요격전·추천·비교)과 이제 처음 여는 화면(성장) 모두
    await openTab(w, 'intercept');
    expect(value(w, 'account-path')).toBe(ACCOUNT_FILE);
    await openTab(w, 'compare');
    expect(value(w, 'account-path')).toBe(ACCOUNT_FILE);
    await openTab(w, 'growth');
    expect(value(w, 'account-path')).toBe(ACCOUNT_FILE);
    // 경로만 넣는다 — 계산을 스스로 시작하지 않는다.
    expect(api.engineRunBatch).not.toHaveBeenCalled();
    expect(api.readJsonFile).not.toHaveBeenCalled();
  });

  it('저장한 뒤 입력 칸이 비고, 쿠키가 화면 어디에도 없으며 localStorage에도 없다', async () => {
    const w = await render();
    await openTab(w, 'account');
    await at(w, 'cookie-input').setValue(FAKE_COOKIE);
    expect(value(w, 'cookie-input')).toBe(FAKE_COOKIE);
    await at(w, 'cookie-save').trigger('click');
    await flushPromises();

    expect(value(w, 'cookie-input')).toBe('');
    expectNoCookie(w);
    // 수집·변환·저장을 끝까지 한 뒤에도, 다른 탭을 다녀와도 없다.
    await startFetch(w);
    emitLine(LINES[0]);
    await finishFetch(w);
    for (const key of ['compare', 'intercept', 'growth', 'tier', 'account'] as const) {
      await openTab(w, key);
      expectNoCookie(w);
    }
    expect(value(w, 'cookie-input')).toBe('');
    // 기억해 둔 것은 이름과 경로, 마지막으로 본 화면(메뉴·설정의 구획·고급의 탭)뿐이다.
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort();
    expect(keys).toEqual([
      'nikke-companion.account.name',
      'nikke-companion.compute.account',
      'nikke-companion.growth.account',
      'nikke-companion.intercept.account',
      'nikke-companion.page',
      'nikke-companion.settings.advanced',
      'nikke-companion.settings.section',
    ]);
    expect(localStorage.getItem('nikke-companion.account.name')).toBe('me');
    // Rust에 넘긴 것은 한 번, 저장 명령 하나뿐이다.
    expect(api.accountSaveCookie).toHaveBeenCalledTimes(1);
    for (const fn of [api.accountFetchProfile, api.accountReadProfile, api.accountSaveFile, api.accountSyncStatus]) {
      expect(JSON.stringify(fn.mock.calls)).not.toContain(TOKEN);
    }
  });

  it('거부된 쿠키도 입력 칸에서 지워지고 화면에 남지 않는다 — 이유와 쿠키를 받는 순서가 보인다', async () => {
    const w = await render();
    await openTab(w, 'account');
    await paste(w, `game_openid=${OPENID}; lang=ko`);
    expect(value(w, 'cookie-input')).toBe('');
    expectNoCookie(w);
    expect(at(w, 'account-error').attributes('data-kind')).toBe('cookie_rejected');
    expect(at(w, 'account-error').attributes('data-step')).toBe('1');
    expect(at(w, 'account-error-message').text()).toContain('game_token=가 없다');
    expect(at(w, 'cookie-help').exists()).toBe(true);
    expect(at(w, 'cookie-note').exists()).toBe(false);
    expect(at(w, 'cookie-state').text()).toBe('쿠키 없음');
    // 다시 제대로 넣으면 안내가 사라진다.
    await paste(w, FAKE_COOKIE);
    expect(at(w, 'account-error').exists()).toBe(false);
    expect(at(w, 'cookie-note').exists()).toBe(true);
  });

  it('이름을 바꾸면 그 이름으로 받고 그 이름의 계정 파일로 저장한다', async () => {
    state.cookie = true;
    const w = await render();
    await openTab(w, 'account');
    await at(w, 'account-name').setValue('  부계  ');
    await startFetch(w);
    expect(api.accountFetchProfile).toHaveBeenCalledWith('부계');
    await finishFetch(w, { ...OUTCOME, name: '부계' });
    expect(api.accountReadProfile).toHaveBeenCalledWith('부계');
    expect(written[0].name).toBe('부계');
    expect((written[0].account as { name: string }).name).toBe('부계');
    expect(at(w, 'import-path').text()).toContain('부계.json');
    expect(localStorage.getItem('nikke-companion.account.name')).toBe('부계');
  });

  it('건너뛴 항목·미확인 칸·변환 알림을 빠짐없이 보이고, 덮어쓴 파일의 사본을 알린다', async () => {
    state = { ...state, cookie: true, accountFile: ACCOUNT_FILE };
    const profile = structuredClone(sampleProfile) as unknown as {
      _account: { console_warnings: string[] };
      chars: Record<string, Record<string, unknown>>;
    };
    profile.chars['새로 나온 니케'] = structuredClone(profile.chars.크라운);
    delete profile.chars.앨리스.collection_stage;
    profile._account.console_warnings = ['모르는 재활용 연구실 tid 1301 (lv 3) — 무시했다.'];
    api.accountReadProfile.mockResolvedValue({ path: PROFILE_PATH, profile, option_table: optionTable });

    const w = await render();
    await openTab(w, 'account');
    await startFetch(w);
    await finishFetch(w);

    const summary = at(w, 'import-summary').text().replace(/\s+/g, ' ');
    expect(summary).toContain('가져온 니케 6명');
    expect(summary).toContain('받은 항목 7개');
    expect(summary).toContain('건너뛴 항목 1개');
    expect(summary).toContain('미확인 칸이 있는 니케 1명');
    expect(at(w, 'import-skipped').text()).toContain('새로 나온 니케: 엔진이 모르는 니케다');
    expect(at(w, 'import-unknown').text()).toContain('앨리스: collection_stage');
    expect(at(w, 'import-warnings').text()).toContain('앨리스: collection_stage이(가) 프로필에 없다 — 미확인으로 남겼다');
    expect(at(w, 'import-warnings').text()).toContain('모르는 재활용 연구실 tid 1301');
    expect(at(w, 'import-backup').text()).toBe(`${ACCOUNT_FILE}.bak`);
    // 저장한 문서에도 미확인이 남아 있다(값을 지어내지 않는다).
    const saved = written[0].account as { nikkes: Record<string, { unknown?: string[] }> };
    expect(saved.nikkes.앨리스.unknown).toEqual(['collection_stage']);
    expect(Object.keys(saved.nikkes)).not.toContain('새로 나온 니케');
  });
});

describe('로그인 창으로 쿠키 받기', () => {
  it('로그인 창을 열고, 로그인 전에는 「아직 로그인되지 않았다」, 로그인 뒤에는 같은 「계정 새로 받기」로 이어진다', async () => {
    const w = await render();
    await openTab(w, 'account');
    await click(w, 'login-open');
    expect(api.loginWindowOpen).toHaveBeenCalledTimes(1);
    expect(at(w, 'cookie-note').text()).toContain('로그인 창을 열었다');

    // 아직 로그인하지 않았다: Rust가 거부하고 창은 그대로다.
    api.loginWindowTakeCookie.mockRejectedValueOnce(
      failureOf('not_logged_in', '아직 로그인되지 않았다(game_token=, game_openid= 쿠키가 없다) — 로그인 창에서 blablalink에 로그인하고 게임 계정을 연동한 뒤 다시 눌러라', true),
    );
    await click(w, 'login-take');
    expect(at(w, 'account-error').attributes('data-kind')).toBe('not_logged_in');
    expect(at(w, 'account-error-message').text()).toContain('아직 로그인되지 않았다');
    expect(at(w, 'cookie-note').exists()).toBe(false);
    expect(at(w, 'cookie-state').text()).toBe('쿠키 없음');

    // 로그인한 뒤: 쿠키는 Rust 안에서만 흐른다 — 화면에는 개수와 시각만 온다.
    await click(w, 'login-take');
    expect(at(w, 'account-error').exists()).toBe(false);
    expect(at(w, 'cookie-note').text()).toContain('로그인 창에서 쿠키 3개를 저장했다');
    expect(at(w, 'cookie-state').text()).toContain('쿠키 저장됨');
    // 붙여넣기 명령은 한 번도 부르지 않았다 — 두 길은 서로 기대지 않는다.
    expect(api.accountSaveCookie).not.toHaveBeenCalled();

    // 그 뒤는 붙여넣기와 같은 흐름이다.
    await startFetch(w);
    await finishFetch(w);
    expect(written).toHaveLength(1);
    expect(at(w, 'import-summary').text()).toContain('6명');
    await openTab(w, 'compare');
    expect(value(w, 'account-path')).toBe(ACCOUNT_FILE);
  });

  it('붙여넣기는 로그인 창 없이 된다', async () => {
    const w = await render();
    await openTab(w, 'account');
    await paste(w, FAKE_COOKIE);
    await startFetch(w);
    await finishFetch(w);
    expect(written).toHaveLength(1);
    expect(api.loginWindowOpen).not.toHaveBeenCalled();
    expect(api.loginWindowTakeCookie).not.toHaveBeenCalled();
    expect(api.loginWindowClear).not.toHaveBeenCalled();
  });

  it('로그인 창이 닫혀 있거나 열 수 없으면 이유를 알린다', async () => {
    const w = await render();
    await openTab(w, 'account');
    api.loginWindowTakeCookie.mockRejectedValueOnce(failureOf('login_window', '로그인 창이 열려 있지 않다 — 「blablalink 로그인」으로 창을 열고 로그인한 뒤 다시 눌러라', false));
    await click(w, 'login-take');
    expect(at(w, 'account-error-message').text()).toContain('로그인 창이 열려 있지 않다');
    expect(at(w, 'cookie-help').exists()).toBe(false);

    api.loginWindowOpen.mockRejectedValueOnce(failureOf('login_window', '로그인 창을 다루지 못했다: 로그인 창을 만들지 못했다', false));
    await click(w, 'login-open');
    expect(at(w, 'account-error-message').text()).toContain('로그인 창을 만들지 못했다');
  });

  it('로그인 세션을 지우는 단추가 있다', async () => {
    const w = await render();
    await openTab(w, 'account');
    await click(w, 'login-clear');
    expect(api.loginWindowClear).toHaveBeenCalledTimes(1);
    expect(at(w, 'cookie-note').text()).toBe('로그인 창의 쿠키·저장 데이터를 지웠다');
    // 엔진의 쿠키 파일을 지우는 것이 아니다 — 쿠키 상태는 그대로다.
    expect(api.accountSaveCookie).not.toHaveBeenCalled();
  });
});

describe('실패의 안내', () => {
  const COOKIE_STEPS = ['blablalink.com에 로그인', 'Network(네트워크)', 'api.blablalink.com으로 가는 요청의 Cookie 헤더', '붙여넣'];

  const cases: { name: string; failure: SyncFailure; says: string }[] = [
    {
      name: '쿠키 파일 없음',
      failure: failureOf('cookie_missing', '쿠키 파일이 없다 — 1단계에서 쿠키를 먼저 받아라(로그인 창 또는 붙여넣기)', true),
      says: '쿠키 파일이 없다',
    },
    {
      name: 'game_token 없음',
      failure: failureOf('cookie_invalid', '저장된 쿠키에 game_token이 없다 — 로그인 세션 쿠키 전체를 다시 받아라', true),
      says: 'game_token이 없다',
    },
    {
      name: '세션 만료',
      failure: failureOf('session_expired', '로그인 세션이 만료됐다(game not login) — 쿠키를 다시 받아라', true, [
        LINES[0],
        { text: '[!] GetUserCharacterDetails: 로그인 세션 만료 (game not login). 쿠키를 다시 받아라.', warning: true },
      ]),
      says: '로그인 세션이 만료됐다',
    },
    {
      name: '네트워크 오류',
      failure: failureOf('network', '네트워크 오류로 계정을 받지 못했다 — 인터넷 연결과 blablalink 접속을 확인하고 다시 하라 (urllib.error.URLError: <urlopen error [Errno 11001] getaddrinfo failed>)', false, [
        { text: '[+] CDN 매핑 수집 중…', warning: false },
        { text: 'Traceback (most recent call last):', warning: false },
        { text: 'urllib.error.URLError: <urlopen error [Errno 11001] getaddrinfo failed>', warning: false },
      ]),
      says: '네트워크 오류로 계정을 받지 못했다',
    },
    {
      name: '시간 초과',
      failure: failureOf('timeout', '시간 초과: 계정 수집이 600초 안에 끝나지 않아 멈췄다 — 네트워크 상태를 확인하고 다시 하라', false, [LINES[1]]),
      says: '시간 초과',
    },
  ];

  for (const { name, failure, says } of cases) {
    it(`${name}: 한국어 안내가 2단계 아래에 보이고, 쿠키 문제일 때만 쿠키를 다시 받는 순서가 함께 보인다`, async () => {
      state.cookie = true;
      const w = await render();
      await openTab(w, 'account');
      await startFetch(w);
      await failFetch(w, failure);

      const error = at(w, 'account-error');
      expect(error.attributes('data-kind')).toBe(failure.kind);
      expect(error.attributes('data-step')).toBe('2');
      expect(at(w, 'step-fetch').find('[data-testid="account-error"]').exists()).toBe(true);
      expect(at(w, 'account-error-message').text()).toBe(failure.message);
      expect(at(w, 'account-error-message').text()).toContain(says);
      expect(at(w, 'cookie-help').exists()).toBe(failure.cookie_help);
      if (failure.cookie_help) {
        const steps = at(w, 'cookie-help').findAll('li').map((li) => li.text());
        expect(steps).toHaveLength(4);
        COOKIE_STEPS.forEach((part, i) => expect(steps[i]).toContain(part));
      }
      // 스크립트가 그때까지 낸 줄은 그대로 보인다.
      expect(texts(w, 'fetch-line')).toEqual(failure.lines.map((l) => l.text));
      expect(texts(w, 'fetch-warning')).toEqual(failure.warnings);
      // 받지 못했으면 변환·저장으로 잇지 않고, 다른 화면의 계정 칸도 그대로다.
      expect(api.accountReadProfile).not.toHaveBeenCalled();
      expect(written).toEqual([]);
      expect(at(w, 'import-summary').exists()).toBe(false);
      expect(at(w, 'fetch-stopped').exists()).toBe(false);
      await openTab(w, 'compare');
      expect(value(w, 'account-path')).toBe('');
    });
  }

  it('실패한 뒤 다시 받으면 앞의 안내는 사라진다', async () => {
    state.cookie = true;
    const w = await render();
    await openTab(w, 'account');
    await startFetch(w);
    await failFetch(w, cases[2].failure);
    expect(at(w, 'account-error').exists()).toBe(true);
    await startFetch(w);
    expect(at(w, 'account-error').exists()).toBe(false);
    expect(texts(w, 'fetch-line')).toEqual([]);
    await finishFetch(w);
    expect(at(w, 'account-error').exists()).toBe(false);
    expect(at(w, 'import-summary').exists()).toBe(true);
  });

  it('중단: 중단 명령을 보내고 「중단됨」으로 끝난다 — 오류가 아니고, 변환·저장으로 잇지 않는다', async () => {
    state.cookie = true;
    const w = await render();
    await openTab(w, 'account');
    await startFetch(w);
    emitLine(LINES[0]);
    await click(w, 'fetch-stop');
    await vi.waitFor(() => expect(at(w, 'fetch-progress').exists()).toBe(false));
    await flushPromises();

    expect(api.accountFetchCancel).toHaveBeenCalledTimes(1);
    expect(at(w, 'fetch-stopped').text()).toContain('중단됨');
    expect(at(w, 'account-error').exists()).toBe(false);
    expect(at(w, 'fetch-stop').exists()).toBe(false);
    // 그때까지 낸 줄은 남아 있다.
    expect(texts(w, 'fetch-line')).toEqual([LINES[0].text, LINES[1].text]);
    expect(api.accountReadProfile).not.toHaveBeenCalled();
    expect(written).toEqual([]);
    // 중단한 뒤에 다시 받을 수 있다.
    await startFetch(w);
    expect(at(w, 'fetch-stopped').exists()).toBe(false);
    await finishFetch(w);
    expect(written).toHaveLength(1);
  });

  it('받는 동안에는 겹쳐 누를 수 없다', async () => {
    state.cookie = true;
    const w = await render();
    await openTab(w, 'account');
    await startFetch(w);
    for (const id of ['fetch-run', 'login-open', 'login-take', 'login-clear', 'cookie-input', 'account-name']) {
      expect(at(w, id).attributes('disabled'), id).toBeDefined();
    }
    await click(w, 'fetch-run');
    expect(api.accountFetchProfile).toHaveBeenCalledTimes(1);
    await finishFetch(w);
    expect(at(w, 'fetch-run').attributes('disabled')).toBeUndefined();
  });

  it('받은 것이 프로필이 아니면 3단계에서 입력 오류로 알리고 저장하지 않는다', async () => {
    state.cookie = true;
    api.accountReadProfile.mockResolvedValue({ path: PROFILE_PATH, profile: { openid: '1', characters: [], details: [] }, option_table: optionTable });
    const w = await render();
    await openTab(w, 'account');
    await startFetch(w);
    await finishFetch(w);
    expect(at(w, 'account-error').attributes('data-step')).toBe('3');
    expect(at(w, 'account-error').attributes('data-kind')).toBe('convert');
    expect(at(w, 'account-error-message').text()).toContain('입력 오류 — 프로필을 읽을 수 없다');
    expect(at(w, 'account-error-message').text()).toContain('raw.json');
    expect(at(w, 'cookie-help').exists()).toBe(false);
    expect(written).toEqual([]);
    // 받은 줄은 그대로 보인다.
    expect(texts(w, 'fetch-line')).toHaveLength(LINES.length);
  });

  it('받은 프로필을 읽지 못하거나 계정 파일을 쓰지 못하면 3단계에서 Rust의 문장 그대로 알린다', async () => {
    state.cookie = true;
    const w = await render();
    await openTab(w, 'account');

    api.accountReadProfile.mockRejectedValueOnce(failureOf('profile', '받은 프로필을 읽을 수 없다: D:\\engine\\profiles\\me.json (os error 2) — 계정을 먼저 받아라', false));
    await startFetch(w);
    await finishFetch(w);
    expect(at(w, 'account-error').attributes('data-step')).toBe('3');
    expect(at(w, 'account-error').attributes('data-kind')).toBe('profile');
    expect(at(w, 'account-error-message').text()).toContain('받은 프로필을 읽을 수 없다');

    api.accountSaveFile.mockRejectedValueOnce(failureOf('account_file', '계정 파일을 쓰지 못했다: D:\\repo\\data\\accounts\\me.json (os error 5)', false));
    await startFetch(w);
    await finishFetch(w);
    expect(at(w, 'account-error').attributes('data-kind')).toBe('account_file');
    expect(at(w, 'account-error-message').text()).toContain('계정 파일을 쓰지 못했다');
    expect(at(w, 'import-summary').exists()).toBe(false);
    await openTab(w, 'compare');
    expect(value(w, 'account-path')).toBe('');
  });

  it('쓸 수 없는 이름은 Rust가 거부한 문장으로 알린다', async () => {
    state.cookie = true;
    const w = await render();
    await openTab(w, 'account');
    await at(w, 'account-name').setValue('../밖');
    await startFetch(w);
    await failFetch(w, failureOf('name', '계정 이름을 쓸 수 없다: 쓸 수 없는 글자가 있다(점·경로 구분자·기호는 쓰지 않는다). 글자·숫자·밑줄(_)·붙임표(-)·낱말 사이 공백만, 48자까지 쓴다', false));
    expect(at(w, 'account-error').attributes('data-kind')).toBe('name');
    expect(at(w, 'account-error-message').text()).toContain('계정 이름을 쓸 수 없다');
    expect(written).toEqual([]);
  });
});

describe('계정 화면의 코드', () => {
  it('쿠키를 기억하지 않는다 — 기억하는 것은 이름뿐이고, 넘기기 전에 입력 칸을 비운다', () => {
    // 기억(lib/remember.ts)에 넣는 것은 마지막으로 받은 이름 하나다.
    expect(accountScreenSource.match(/\bremember\(/g)).toHaveLength(1);
    expect(accountScreenSource).toContain('remember(LAST_NAME, target);');
    expect(accountScreenSource).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    // 붙여넣은 글자는 Rust에 넘기기 전에 입력 칸에서 지운다.
    expect(accountScreenSource).toMatch(/const text = pasted\.value;\s*pasted\.value = '';\s*await cookieTask\('cookie', async \(\) => savedNote\(await accountSaveCookie\(text\), '붙여넣은'\)\);/);
    // 붙여넣은 글자를 읽는 곳은 그 한 곳과 입력 칸(그리고 빈 칸인지 보는 것)뿐이다.
    expect(accountScreenSource.match(/pasted\.value/g)).toHaveLength(2);
    expect(accountScreenSource.match(/\bpasted\b/g)).toHaveLength(5);
    // 실패 안내는 Rust가 준 문장과 정해진 글자만 보인다.
    expect(accountFailureSource).not.toMatch(/pasted|cookie\b(?!-help)/);
  });
});
