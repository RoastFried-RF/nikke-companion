// 비교 결과 파일 불러오기(데스크톱 앱 창의 설정 > 고급 > 추천·비교)와 게임 창 칸(설정 > 오버레이). Rust 쪽은 가짜로 대체한다.
//
// P-027: 이 파일은 예전에 오버레이 화면 전체(상태 표시 + 결과 불러오기)를 봤다. 화면이 둘로 나뉘면서
//   - 결과 파일 불러오기·게임 창 칸은 앱 창으로 옮겼다 → 여기서 그대로 확인한다(자리만 설정 아래로 바뀌었다),
//   - 오버레이의 상태 표시·클릭 통과·끝내기·창 끌기는 오버레이 창에 남았다 → Overlay.test.ts가 확인한다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import type { CompareReport, GameSnapshot } from '../src/types';
import fixture from './fixtures/compare.sample.json';
import { installShell, openLegacy, openSection } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
  loadReport: vi.fn(),
  quitApp: vi.fn(),
  captureGame: vi.fn(),
}));

const sample = fixture as unknown as CompareReport;
const api = vi.mocked(backend);
const noGame: GameSnapshot = {
  state: 'missing',
  window: null,
  message: '게임 창을 찾을 수 없다. 니케 PC판(nikke.exe)이 실행 중인지 확인하라',
  follow: false,
};

/** 앱 창을 띄우고 설정 > 고급 > 추천·비교를 연다(실행 인자로 결과 파일을 받았으면 앱이 스스로 거기를 연다). */
async function render() {
  const wrapper = mount(App);
  await flushPromises();
  if (!wrapper.find('[data-testid="screen-compare"]').exists()) await openLegacy(wrapper, 'compare');
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  installShell(api);
  api.loadReport.mockResolvedValue(sample);
  api.gameWindowStatus.mockResolvedValue(noGame);
  api.setFollowGame.mockResolvedValue(noGame);
});

describe('비교 결과 파일 불러오기(설정 > 고급)', () => {
  it('불러올 파일이 없으면 안내만 보인다', async () => {
    const w = await render();
    expect(w.find('[data-testid="hint"]').exists()).toBe(true);
    expect(api.loadReport).not.toHaveBeenCalled();
    expect(w.find('[data-testid="ranking-entry"]').exists()).toBe(false);
  });

  it('실행 인자로 받은 결과 파일을 바로 불러와 순위를 그린다 — 메뉴를 누르지 않아도 그 화면이 열려 있다', async () => {
    api.startupReportPath.mockResolvedValue('C:\\결과\\compare.json');
    const w = mount(App);
    await flushPromises();
    expect(w.find('[data-testid="nav-settings"]').attributes('aria-current')).toBe('page');
    expect(api.loadReport).toHaveBeenCalledWith('C:\\결과\\compare.json');
    expect(w.findAll('[data-testid="ranking-entry"]')).toHaveLength(3);
    expect(w.find('[data-testid="total-unit"]').text()).toBe('34.63억');
    expect((w.find('[data-testid="report-path"]').element as HTMLInputElement).value).toBe('C:\\결과\\compare.json');
  });

  it('경로를 넣고 불러오면 결과를 그리고 그 경로를 기억한다', async () => {
    const w = await render();
    await w.find('[data-testid="report-path"]').setValue('  D:\\r.json  ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(api.loadReport).toHaveBeenCalledWith('D:\\r.json');
    expect(w.findAll('[data-testid="ranking-entry"]')).toHaveLength(3);
    expect(localStorage.getItem('nikke-companion.report-path')).toBe('D:\\r.json');
  });

  it('다음 실행에서는 마지막으로 불러온 파일을 다시 연다', async () => {
    localStorage.setItem('nikke-companion.report-path', 'D:\\last.json');
    await render();
    expect(api.loadReport).toHaveBeenCalledWith('D:\\last.json');
  });

  it('실행 인자가 기억해 둔 경로보다 먼저다', async () => {
    localStorage.setItem('nikke-companion.report-path', 'D:\\last.json');
    api.startupReportPath.mockResolvedValue('D:\\arg.json');
    await render();
    expect(api.loadReport).toHaveBeenCalledTimes(1);
    expect(api.loadReport).toHaveBeenCalledWith('D:\\arg.json');
  });

  it('읽지 못하면 Rust가 준 한국어 오류를 보이고 순위를 그리지 않는다', async () => {
    const w = await render();
    api.loadReport.mockRejectedValue('파일을 찾을 수 없다: D:\\없음.json');
    await w.find('[data-testid="report-path"]').setValue('D:\\없음.json');
    await w.find('form').trigger('submit');
    await flushPromises();
    const error = w.find('[data-testid="error"]');
    expect(error.text()).toBe('파일을 찾을 수 없다: D:\\없음.json');
    expect(error.attributes('role')).toBe('alert');
    expect(w.find('[data-testid="ranking-entry"]').exists()).toBe(false);
    expect(localStorage.getItem('nikke-companion.report-path')).toBeNull();
  });

  it('읽기에 실패하면 앞서 보이던 다른 파일의 순위를 남기지 않는다', async () => {
    api.startupReportPath.mockResolvedValue('D:\\ok.json');
    const w = await render();
    expect(w.findAll('[data-testid="ranking-entry"]')).toHaveLength(3);

    api.loadReport.mockRejectedValue('JSON이 아니다: D:\\bad.json (1번째 줄 1번째 글자 근처: 문법 오류)');
    await w.find('[data-testid="report-path"]').setValue('D:\\bad.json');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="ranking-entry"]').exists()).toBe(false);
    expect(w.find('[data-testid="error"]').text()).toContain('JSON이 아니다');
  });

  it('경로가 비어 있으면 읽지 않고 알린다', async () => {
    const w = await render();
    await w.find('[data-testid="report-path"]').setValue('   ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(api.loadReport).not.toHaveBeenCalled();
    expect(w.find('[data-testid="error"]').text()).toBe('비교 결과 파일 경로를 넣어야 한다.');
  });

  it('불러온 결과는 편성 도구의 비교에도 새 부품으로 보인다', async () => {
    api.startupReportPath.mockResolvedValue('D:\\ok.json');
    const w = mount(App);
    await flushPromises();
    await w.find('[data-testid="nav-tools"]').trigger('click');
    await w.find('[data-testid="tool-compare"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="squad-board"]').exists()).toBe(true);
    expect(w.find('[data-testid="squad-total"]').text()).toBe('34.63억');
    expect(w.findAll('[data-testid="squad-member"]')).toHaveLength(5);
  });
});

describe('게임 창 칸(설정 > 오버레이)', () => {
  it('게임 창 상태를 보인다 — 게임이 없다는 것은 오류가 아니다', async () => {
    const w = mount(App);
    await flushPromises();
    await openSection(w, 'overlay');
    expect(w.find('[data-testid="game-panel"]').exists()).toBe(true);
    expect(api.gameWindowStatus).toHaveBeenCalled();
    expect(w.find('[data-testid="game-state"]').text()).toBe('게임 창: 없음');
    expect(w.find('[data-testid="error"]').exists()).toBe(false);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('지난번에 붙이기를 켜 두었으면 앱이 켜질 때 다시 켠다 — 설정을 열지 않아도', async () => {
    localStorage.setItem('nikke-companion.follow-game', '1');
    mount(App);
    await flushPromises();
    expect(api.setFollowGame).toHaveBeenCalledWith(true);
  });

  it('붙이기를 켠 적이 없으면 Rust에 시키지 않는다', async () => {
    mount(App);
    await flushPromises();
    expect(api.setFollowGame).not.toHaveBeenCalled();
  });
});
