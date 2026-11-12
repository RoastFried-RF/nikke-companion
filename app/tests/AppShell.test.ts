// 데스크톱 앱 창의 틀(App.vue): 왼쪽 메뉴, 홈, 그리고 화면 사이의 흐름 —
//   계정 없음 → 계정 연결 → 요격전 추천 계산 → 결과 → 앱을 다시 켜도 복원 → 오버레이 창에도 같은 결과.
// Rust 쪽(backend)은 가짜다: 계정 폴더는 가짜 디스크(tests/helpers/shell.ts), 쿠키는 지어낸 글자, 받은 프로필은 검증용 샘플,
// 계산 도구의 실행도 가짜다. 변환·추천은 루트의 실제 코드(src/core)가 한다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sampleProfile from '../../data/samples/profile.sample.json';
import anomalyBundle from '../../data/intercept/anomaly.json';
import optionTable from '../../vendor/nikke-calc/data/base_stat_tables/equipment_skills.json';
import App from '../src/App.vue';
import Overlay from '../src/Overlay.vue';
import * as backend from '../src/lib/backend';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { simCache } from '../src/lib/runtime';
import type { EngineRow, FetchOutcome, InterceptReport, ScreenTrackStatus } from '../src/types';
import interceptFixture from './fixtures/intercept.sample.json';
import { ACCOUNT_PATH, catalog, documents, FAKE_EVALUATOR, fakeRow } from './helpers/fakeEngine';
import { currentPage, FakeDisk, installShell, openPage } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
  loadReport: vi.fn(),
  engineCatalog: vi.fn(),
  engineVersion: vi.fn(),
  engineRunBatch: vi.fn(),
  engineCancel: vi.fn(),
  readJsonFile: vi.fn(),
  pickJsonFile: vi.fn(),
  onEngineProgress: vi.fn(),
  setScreenTracking: vi.fn(),
  screenTrackStatus: vi.fn(),
  onScreenTrack: vi.fn(),
  accountSyncStatus: vi.fn(),
  accountSaveCookie: vi.fn(),
  accountFetchProfile: vi.fn(),
  accountFetchCancel: vi.fn(),
  accountReadProfile: vi.fn(),
  accountSaveFile: vi.fn(),
  onAccountFetch: vi.fn(),
  extensionLinkStatus: vi.fn(),
  onExtensionLink: vi.fn(),
  quitApp: vi.fn(),
}));

const api = vi.mocked(backend);
const sample = interceptFixture as unknown as InterceptReport;
const BOSS_IDS = anomalyBundle.bosses.map((b) => b.id);

/** 지어낸 쿠키. 실제 계정의 값이 아니다. */
const FAKE_COOKIE = 'game_token=FAKE-TOKEN-shell-0123456789abcdef; game_openid=10203040506070809000';

let disk = new FakeDisk();
let cookieSaved = false;
let trackStatus: ScreenTrackStatus;

const at = (w: ReturnType<typeof mount>, testid: string) => w.find(`[data-testid="${testid}"]`);

async function render() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

/** 계산이 끝날 때까지(메뉴의 「계산 중」 점이 사라질 때까지) 기다린다. */
async function idle(w: ReturnType<typeof mount>): Promise<void> {
  await vi.waitFor(
    () => {
      if (at(w, 'nav-busy').exists()) throw new Error('아직 계산 중이다');
    },
    { timeout: 10000 },
  );
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  simCache.clear();
  clearNikkeCatalog();
  cookieSaved = false;
  disk = installShell(api);
  trackStatus = { enabled: false, interval_ms: 2000, state: 'off', message: '', recognition: null, read_at: null, capture_ms: null, failures: 0 };

  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue(FAKE_EVALUATOR);
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r)));
  api.engineCancel.mockResolvedValue(false);
  api.onEngineProgress.mockResolvedValue(() => {});
  api.readJsonFile.mockRejectedValue('파일을 찾을 수 없다');
  api.pickJsonFile.mockResolvedValue(null);
  api.loadReport.mockRejectedValue('결과 파일이 없다');
  api.onScreenTrack.mockResolvedValue(() => {});
  api.setScreenTracking.mockImplementation(async (enabled) => {
    trackStatus = { ...trackStatus, enabled, state: enabled ? 'starting' : 'off' };
    return trackStatus;
  });
  api.screenTrackStatus.mockImplementation(async () => trackStatus);
  api.extensionLinkStatus.mockResolvedValue({ enabled: false, listening: false, address: '127.0.0.1:47615', code: 'ABCD-2345', problem: null, pending: false, last: null, locked_seconds: 0 });
  api.onExtensionLink.mockResolvedValue(() => {});

  // ── 가짜 Rust: 계정 받기 ──
  api.accountSyncStatus.mockImplementation(async (name) => ({
    name: name ?? 'me',
    cookie_saved: cookieSaved,
    cookie_saved_at: cookieSaved ? '2026-11-12T06:00:00.000Z' : null,
    profile_fetched_at: null,
    account_file: null,
    login_window_open: false,
    problems: [],
  }));
  api.accountSaveCookie.mockImplementation(async (cookie) => {
    cookieSaved = true;
    return { saved_at: '2026-11-12T06:00:00.000Z', count: cookie.split(';').length };
  });
  api.onAccountFetch.mockResolvedValue(() => {});
  api.accountFetchProfile.mockImplementation(
    async (name): Promise<FetchOutcome> => ({ name, profile_path: `D:\\engine\\profiles\\${name}.json`, fetched_at: '2026-11-12T06:01:00.000Z', lines: [{ text: '[+] 받았다', warning: false }], warnings: [], seconds: 3 }),
  );
  api.accountFetchCancel.mockResolvedValue(false);
  api.accountReadProfile.mockResolvedValue({ path: 'D:\\engine\\profiles\\me.json', profile: structuredClone(sampleProfile), option_table: optionTable });
  api.accountSaveFile.mockImplementation(async (name, account) => {
    disk.addAccount(name, account);
    return { path: `D:\\repo\\data\\accounts\\${name}.json`, backup: null };
  });
});

describe('왼쪽 메뉴', () => {
  it('화면 여섯이 아이콘과 짧은 이름으로 있고, 처음에는 홈이 보인다', async () => {
    const w = await render();
    const items = w.findAll('[data-testid="nav"] button');
    expect(items.map((b) => b.text())).toEqual(['홈', '요격전', '내 니케', '편성 도구', '티어', '설정']);
    expect(items.every((b) => b.find('[data-testid="nav-icon"]').exists())).toBe(true);
    // 아이콘은 화면마다 다르다.
    expect(new Set(items.map((b) => b.find('[data-testid="nav-icon"]').attributes('data-icon'))).size).toBe(6);
    expect(currentPage(w)).toBe('home');
    expect(at(w, 'page-home').exists()).toBe(true);
    // 유니온 레이드 화면은 없다.
    expect(w.text()).not.toContain('유니온');
  });

  it('누르면 그 화면만 보이고 지금 화면이 표시된다', async () => {
    const w = await render();
    for (const key of ['intercept', 'roster', 'tools', 'tier', 'settings', 'home'] as const) {
      await openPage(w, key);
      expect(currentPage(w)).toBe(key);
      expect(w.findAll('[data-testid^="page-"]').map((p) => p.attributes('data-testid'))).toEqual([`page-${key}`]);
      expect(w.findAll('[data-testid^="nav-"][aria-current="page"]')).toHaveLength(1);
    }
  });

  it('마지막으로 본 화면을 기억해 다음 실행 때 그 화면을 연다 — 모르는 이름이면 홈이다', async () => {
    const first = await render();
    await openPage(first, 'roster');
    expect(localStorage.getItem('nikke-companion.page')).toBe('roster');
    first.unmount();

    const second = await render();
    expect(currentPage(second)).toBe('roster');
    second.unmount();

    localStorage.setItem('nikke-companion.page', 'union');
    expect(currentPage(await render())).toBe('home');
  });

  it('계산 중인 화면이 메뉴에 표시된다 — 다른 화면을 봐도 계산은 계속되고 그 화면의 결과는 남는다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    const waiting: Array<() => void> = [];
    api.engineRunBatch.mockImplementation((requests) => new Promise<EngineRow[]>((resolve) => waiting.push(() => resolve(requests.map((r) => fakeRow(r))))));
    const w = await render();
    expect(at(w, 'nav-busy').exists()).toBe(false);

    await openPage(w, 'tools');
    await at(w, 'run-suggest').trigger('click');
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    await flushPromises();
    expect(at(w, 'nav-tools').find('[data-testid="nav-busy"]').attributes('aria-label')).toBe('계산 중');
    expect(w.findAll('[data-testid="nav-busy"]')).toHaveLength(1);

    // 다른 화면으로 가도 표시는 남고, 그 화면에서는 계산을 시작할 수 없다(한 번에 하나만 돈다).
    await openPage(w, 'intercept');
    expect(at(w, 'nav-tools').find('[data-testid="nav-busy"]').exists()).toBe(true);
    expect(at(w, 'run-intercept').attributes('disabled')).toBeDefined();
    expect(at(w, 'busy-elsewhere').text()).toContain('다른 화면에서 계산이 돌고 있다');

    // 끝날 때까지 오는 대로 풀어 준다(추천은 편성 고르기와 자리 순서, 두 번 맡긴다).
    await vi.waitFor(
      () => {
        for (const finish of waiting.splice(0)) finish();
        if (at(w, 'nav-busy').exists()) throw new Error('아직 계산 중이다');
      },
      { timeout: 10000 },
    );
    await flushPromises();
    expect(at(w, 'run-intercept').attributes('disabled')).toBeUndefined();
    await openPage(w, 'tools');
    expect(at(w, 'squad-board').exists()).toBe(true);
  });
});

describe('홈', () => {
  it('처음 실행이면 세 단계 안내가 보이고, 다음에 할 일은 「계정 연결하기」 하나다', async () => {
    const w = await render();
    expect(w.findAll('[data-testid="first-run-step"]').map((s) => s.find('strong').text())).toEqual(['계정 연결', '게임 켜기', '요격전 화면 열기']);
    expect(w.findAll('[data-testid="next-action"]')).toHaveLength(1);
    expect(at(w, 'next-action').text()).toBe('계정 연결하기');

    await at(w, 'next-action').trigger('click');
    await flushPromises();
    expect(currentPage(w)).toBe('settings');
    expect(at(w, 'settings-account').exists()).toBe(true);
  });

  it('지금 상태를 체크리스트 넷으로 보인다: 계정 연결·게임 창·오버레이·자동 추적', async () => {
    const w = await render();
    const state = (key: string) => at(w, `check-${key}`).find('[data-testid="status-pill"]').text();
    expect(w.findAll('[data-testid^="check-"]').map((c) => c.find('.home__check-label').text())).toEqual(['계정 연결', '게임 창', '오버레이', '자동 추적']);
    expect(state('account')).toBe('연결 안 됨');
    expect(state('game')).toBe('없음');
    expect(state('overlay')).toBe('떠 있음');
    expect(state('track')).toBe('꺼짐');
    expect(at(w, 'check-account').attributes('data-done')).toBe('no');
    expect(at(w, 'check-overlay').attributes('data-done')).toBe('yes');
  });

  it('게임 창과 오버레이의 상태가 바뀌면 따라 바뀐다', async () => {
    let onGame: (snapshot: never) => void = () => {};
    api.onGameWindow.mockImplementation(async (handler) => {
      onGame = handler as never;
      return () => {};
    });
    const w = await render();
    onGame({ state: 'found', window: null, message: '게임 창을 찾았다', follow: false } as never);
    await flushPromises();
    expect(at(w, 'check-game').find('[data-testid="status-pill"]').text()).toBe('찾음');
    expect(at(w, 'check-game').attributes('data-done')).toBe('yes');
  });

  it('다음에 할 일은 위에서부터 아직 안 된 것 하나다: 계정 → 추천 → 자동 추적 → 오버레이 → 보기', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    const w = await render();
    // 계정은 있고 추천이 없다 — 처음 쓰는 안내는 보이지 않는다.
    expect(at(w, 'first-run').exists()).toBe(false);
    expect(at(w, 'check-account').find('[data-testid="status-pill"]').text()).toBe('연결됨 · me');
    expect(at(w, 'next-action').text()).toBe('요격전 추천 받기');
    await at(w, 'next-action').trigger('click');
    expect(currentPage(w)).toBe('intercept');

    // 추천이 생겼다(다른 창이 저장했다) → 자동 추적 켜기.
    disk.putIntercept(sample, true);
    await flushPromises();
    await openPage(w, 'home');
    expect(at(w, 'next-action').text()).toBe('자동 추적 켜기');
    await at(w, 'next-action').trigger('click');
    await flushPromises();
    expect(api.setScreenTracking).toHaveBeenCalledWith(true, 2000);
    expect(at(w, 'check-track').find('[data-testid="status-pill"]').text()).toBe('켜짐');

    // 오버레이가 숨겨져 있으면 띄우기.
    api.overlayStatus.mockResolvedValue({ visible: false, click_through: false, shortcut_problems: [] });
    w.unmount();
    const again = await render();
    expect(at(again, 'check-overlay').find('[data-testid="status-pill"]').text()).toBe('숨김');
    expect(at(again, 'next-action').text()).toBe('오버레이 띄우기');
    await at(again, 'next-action').trigger('click');
    await flushPromises();
    expect(api.setOverlayVisible).toHaveBeenCalledWith(true);
    expect(at(again, 'check-overlay').find('[data-testid="status-pill"]').text()).toBe('떠 있음');
    // 다 됐으면 보러 간다.
    expect(at(again, 'next-action').text()).toBe('요격전 추천 보기');
  });

  it('추천이 있으면 보스 5종의 1위 총딜과 마지막 계산 시각이 보인다 — 누르면 그 보스의 요격전 화면이다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    disk.putIntercept(sample);
    const w = await render();
    const cards = at(w, 'home-bosses').findAll('[data-testid="boss-card"]');
    expect(cards.map((c) => c.find('[data-testid="boss-card-name"]').text())).toEqual(sample.bosses.map((b) => b.name));
    expect(cards.every((c) => c.find('[data-testid="boss-card-total"]').text().startsWith('총딜 '))).toBe(true);
    expect(at(w, 'home-computed-at').text()).toMatch(/^마지막 계산 \d{4}-\d\d-\d\d \d\d:\d\d$/);
    // 숨기면 안 되는 표시.
    expect(at(w, 'home-bosses').text()).toContain('추정 · 실전 미대조');
    expect(at(w, 'home-bosses').text()).toContain('검증용 데이터');

    await cards[3].trigger('click');
    await flushPromises();
    expect(currentPage(w)).toBe('intercept');
    expect(at(w, 'boss-name').text()).toBe(sample.bosses[3].name);
  });

  it('계정 상태를 읽지 못하면 무슨 일인지 알린다 — 화면은 그대로 쓸 수 있다', async () => {
    api.sharedState.mockRejectedValue('계정 폴더를 찾을 수 없다');
    const w = await render();
    expect(at(w, 'shared-problem').text()).toBe('계정 상태를 확인하지 못했다: 계정 폴더를 찾을 수 없다');
    expect(at(w, 'next-action').exists()).toBe(true);
  });
});

describe('흐름: 계정 없음 → 연결 → 계산 → 결과 → 다시 켜도 복원', () => {
  it('처음부터 끝까지 — 파일 경로를 한 번도 넣지 않는다', async () => {
    const w = await render();

    // 1) 계정이 없다: 요격전 화면에는 계산 단추 대신 「계정 연결」 안내가 있다.
    await openPage(w, 'intercept');
    expect(at(w, 'run-intercept').exists()).toBe(false);
    expect(at(w, 'need-account').find('[data-testid="empty-title"]').text()).toBe('아직 계정을 연결하지 않았다');
    expect(w.find('input').exists()).toBe(false);
    await at(w, 'need-account').find('[data-testid="empty-action"]').trigger('click');
    await flushPromises();
    expect(currentPage(w)).toBe('settings');
    expect(at(w, 'account-state').text()).toBe('연결 안 됨');

    // 2) 계정 연결: 쿠키 붙여넣기 → 계정 새로 받기 → 저장. 받은 계정이 곧바로 계산에 쓸 계정이 된다.
    await at(w, 'cookie-input').setValue(FAKE_COOKIE);
    await at(w, 'cookie-save').trigger('click');
    await flushPromises();
    await at(w, 'fetch-run').trigger('click');
    await vi.waitFor(() => expect(at(w, 'import-summary').exists()).toBe(true));
    await flushPromises();
    expect(disk.chosen).toBe('me');
    expect(at(w, 'account-state').text()).toBe('연결됨 · me');
    // 쿠키는 화면에도 기억에도 남지 않는다.
    expect(w.html()).not.toContain('FAKE-TOKEN-shell');
    expect(JSON.stringify({ ...localStorage })).not.toContain('FAKE-TOKEN-shell');

    // 3) 홈: 다음에 할 일이 「요격전 추천 받기」로 바뀌었다.
    await openPage(w, 'home');
    expect(at(w, 'first-run').exists()).toBe(false);
    expect(at(w, 'next-action').text()).toBe('요격전 추천 받기');
    await at(w, 'next-action').trigger('click');

    // 4) 계산: 단추 하나 + 정밀도. 계정과 보스 값은 스스로 쓴다(기본 계정 + 내장 보스 5종).
    expect(at(w, 'account-line').text()).toBe('계정 me');
    expect(w.find('[data-testid="page-intercept"] input').exists()).toBe(false);
    expect(at(w, 'run-intercept').text()).toBe('추천 계산');
    await at(w, 'precision-fast').trigger('click');
    await at(w, 'run-intercept').trigger('click');
    await idle(w);

    // 5) 결과: 보스 5종의 카드와 1위 편성.
    expect(at(w, 'error').exists()).toBe(false);
    expect(w.findAll('[data-testid="page-intercept"] [data-testid="boss-card"]').map((c) => c.attributes('data-boss'))).toEqual(BOSS_IDS);
    expect(w.findAll('[data-testid="squad-member"]')).toHaveLength(5);
    expect(at(w, 'estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(at(w, 'restored-note').exists()).toBe(false);
    expect(at(w, 'run-intercept').text()).toBe('다시 계산');
    // 계산에 쓴 것: 기본 계정을 이름 없이(지금 쓰는 계정) 읽었고, 파일은 읽지 않았다.
    expect(api.readAccount).toHaveBeenCalledWith(null);
    expect(api.readJsonFile).not.toHaveBeenCalled();
    expect(api.pickJsonFile).not.toHaveBeenCalled();
    // 디스크에 저장됐다.
    const saved = disk.intercept as InterceptReport;
    expect(saved.kind).toBe('intercept_report');
    expect(saved.account.name).toBe('me');
    expect(saved.bosses.map((b) => b.id)).toEqual(BOSS_IDS);
    const shown = { boss: at(w, 'boss-name').text(), total: at(w, 'squad-total').text(), members: w.findAll('[data-testid="nikke-tile-name"]').map((n) => n.text()) };
    w.unmount();

    // 6) 앱을 다시 켠다: 계산하지 않아도 마지막 결과가 그대로 보인다.
    const engineCalls = api.engineRunBatch.mock.calls.length;
    const again = await render();
    expect(currentPage(again)).toBe('intercept'); // 마지막으로 본 화면
    expect(at(again, 'restored-note').text()).toContain('앞서 계산해 둔 추천이다');
    expect({ boss: at(again, 'boss-name').text(), total: at(again, 'squad-total').text(), members: again.findAll('[data-testid="nikke-tile-name"]').map((n) => n.text()) }).toEqual(shown);
    expect(api.engineRunBatch.mock.calls.length).toBe(engineCalls);
    // 홈에도 요약이 보이고, 처음 쓰는 안내는 없다.
    await openPage(again, 'home');
    expect(at(again, 'first-run').exists()).toBe(false);
    expect(at(again, 'home-bosses').findAll('[data-testid="boss-card"]')).toHaveLength(5);

    // 7) 오버레이 창도 같은 결과를 본다(같은 디스크). P-028: 오버레이는 위젯이다 — 보스 하나의 한 줄 카드(앱 창에서 보던 보스)를
    //    보이고, 펼치면 보스 다섯을 고를 수 있다. (예전에는 앱 창과 같은 그림 — 보스 카드 다섯과 큰 총딜 — 을 그렸다.)
    const overlay = mount(Overlay);
    await flushPromises();
    expect(overlay.find('[data-testid="widget"]').attributes('data-shape')).toBe('card');
    expect(overlay.find('[data-testid="widget-boss"]').text()).toBe(shown.boss);
    expect(overlay.find('[data-testid="widget-total"]').text()).toBe(shown.total);
    expect(overlay.findAll('[data-testid="widget-member"]').map((m) => (m.attributes('title') ?? '').split(' — ')[0])).toEqual(shown.members);
    expect(overlay.find('[data-testid="estimate-pill"]').text()).toBe('추정');
    await overlay.find('[data-testid="widget-toggle"]').trigger('click');
    await flushPromises();
    expect(overlay.findAll('[data-testid="widget-boss-pick"]').map((c) => c.attributes('data-boss'))).toEqual(BOSS_IDS);
  });

  it('앱 창이 계산을 끝내면 떠 있던 오버레이 창이 새 결과를 받는다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    const overlay = mount(Overlay);
    await flushPromises();
    // P-028: 빈 상태는 한 줄 알림이다(「아직 요격전 추천이 없다 — 앱에서 계산한다」와 「앱 열기」).
    expect(overlay.find('[data-testid="widget-notice"]').attributes('data-kind')).toBe('empty');
    expect(overlay.find('[data-testid="open-app"]').exists()).toBe(true);

    const w = await render();
    await openPage(w, 'intercept');
    await at(w, 'precision-fast').trigger('click');
    await at(w, 'run-intercept').trigger('click');
    await idle(w);
    await flushPromises();

    expect(overlay.find('[data-testid="widget-notice"]').exists()).toBe(false);
    expect(overlay.find('[data-testid="widget"]').attributes('data-state')).toBe('result');
    expect(overlay.find('[data-testid="widget-boss"]').text()).toBe(at(w, 'boss-name').text());
    expect(overlay.find('[data-testid="widget-total"]').text()).toBe(at(w, 'squad-total').text());
    // 계산하는 동안 앱 창이 진행을 알렸고(오버레이가 작게 보인다), 끝나면 「돌고 있지 않다」로 되돌렸다.
    const announced = api.announceActivity.mock.calls.map(([a]) => a);
    expect(announced.some((a) => a.running && a.total > 0)).toBe(true);
    expect(announced[announced.length - 1].running).toBe(false);
    expect(overlay.find('[data-testid="widget-activity"]').exists()).toBe(false);
  });

  it('결과를 저장하지 못해도 화면에는 보이고, 저장하지 못했다고 알린다', async () => {
    disk.addAccount('me', documents[ACCOUNT_PATH]);
    api.saveInterceptResult.mockRejectedValue('요격전 추천 결과을(를) 저장하지 못했다 (디스크가 가득 찼다)');
    const w = await render();
    await openPage(w, 'intercept');
    await at(w, 'precision-fast').trigger('click');
    await at(w, 'run-intercept').trigger('click');
    await idle(w);
    expect(at(w, 'intercept-result').exists()).toBe(true);
    expect(at(w, 'result-problem').text()).toContain('이 결과를 저장하지 못했다(앱을 다시 켜면 보이지 않는다)');
    expect(at(w, 'result-problem').text()).toContain('디스크가 가득 찼다');
  });
});
