// 오버레이 화면 전체: 상태 표시, 결과 불러오기, 오류. Rust 쪽은 가짜로 대체한다.
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import type { CompareReport, OverlaySnapshot } from '../src/types';
import fixture from './fixtures/compare.sample.json';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  loadReport: vi.fn(),
  overlayStatus: vi.fn(),
  startupReportPath: vi.fn(),
  quitApp: vi.fn(),
  onOverlayState: vi.fn(),
}));

const sample = fixture as unknown as CompareReport;
const api = vi.mocked(backend);
const interactive: OverlaySnapshot = { visible: true, click_through: false, shortcut_problems: [] };

/** Rust가 보내는 상태 이벤트를 흉내 낸다. */
let emitOverlayState: (state: OverlaySnapshot) => void = () => {};
const unlisten = vi.fn();

async function render() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  api.overlayStatus.mockResolvedValue(interactive);
  api.startupReportPath.mockResolvedValue(null);
  api.loadReport.mockResolvedValue(sample);
  api.quitApp.mockResolvedValue(undefined);
  api.onOverlayState.mockImplementation(async (handler) => {
    emitOverlayState = handler;
    return unlisten;
  });
});

describe('오버레이 화면', () => {
  it('시작하면 현재 상태(조작 가능)를 보이고, 불러올 파일이 없으면 안내만 보인다', async () => {
    const w = await render();
    expect(w.find('[data-testid="click-through-off"]').exists()).toBe(true);
    expect(w.find('[data-testid="hint"]').exists()).toBe(true);
    expect(api.loadReport).not.toHaveBeenCalled();
    expect(w.find('[data-testid="ranking-entry"]').exists()).toBe(false);
  });

  it('실행 인자로 받은 결과 파일을 바로 불러와 순위를 그린다', async () => {
    api.startupReportPath.mockResolvedValue('C:\\결과\\compare.json');
    const w = await render();
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

  it('단축키로 클릭 통과가 켜지면 눈에 띄게 표시하고, 꺼지면 되돌린다', async () => {
    const w = await render();
    expect(w.find('[data-testid="overlay"]').classes()).not.toContain('overlay--passthrough');

    emitOverlayState({ ...interactive, click_through: true });
    await flushPromises();
    expect(w.find('[data-testid="click-through-on"]').text()).toContain('클릭 통과 중');
    expect(w.find('[data-testid="overlay"]').classes()).toContain('overlay--passthrough');

    emitOverlayState(interactive);
    await flushPromises();
    expect(w.find('[data-testid="click-through-on"]').exists()).toBe(false);
    expect(w.find('[data-testid="overlay"]').classes()).not.toContain('overlay--passthrough');
  });

  it('상태를 확인하지 못하면 오류를 보인다', async () => {
    api.overlayStatus.mockRejectedValue('명령을 부를 수 없다');
    const w = await render();
    expect(w.find('[data-testid="error"]').text()).toContain('오버레이 상태를 확인하지 못했다');
    expect(w.find('[data-testid="status-unknown"]').exists()).toBe(true);
  });

  it('닫기 단추가 앱을 끝낸다', async () => {
    const w = await render();
    await w.find('[data-testid="quit"]').trigger('click');
    expect(api.quitApp).toHaveBeenCalledTimes(1);
  });

  it('화면이 내려가면 상태 구독을 끊는다', async () => {
    const w = await render();
    w.unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('창 끌기 영역이 있다', async () => {
    const w = await render();
    expect(w.find('header').attributes('data-tauri-drag-region')).toBeDefined();
  });
});
