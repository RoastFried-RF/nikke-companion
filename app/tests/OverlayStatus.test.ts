import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import OverlayStatus from '../src/components/OverlayStatus.vue';
import type { OverlaySnapshot } from '../src/types';

const render = (state: OverlaySnapshot | null) => mount(OverlayStatus, { props: { state } });
const snapshot = (over: Partial<OverlaySnapshot> = {}): OverlaySnapshot => ({
  visible: true,
  click_through: false,
  shortcut_problems: [],
  ...over,
});

describe('오버레이 상태 표시', () => {
  it('조작 가능한 상태와 두 단축키를 보인다', () => {
    const w = render(snapshot());
    expect(w.find('[data-testid="click-through-off"]').text()).toContain('조작 가능');
    expect(w.find('[data-testid="click-through-on"]').exists()).toBe(false);
    expect(w.text()).toContain('Alt+Shift+C');
    expect(w.text()).toContain('Alt+Shift+O');
    expect(w.find('[data-testid="visibility"]').text()).toBe('창: 보임');
  });

  it('클릭 통과 중에는 눈에 띄는 표시와 해제 단축키를 보인다', () => {
    const w = render(snapshot({ click_through: true }));
    const banner = w.find('[data-testid="click-through-on"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('클릭 통과 중');
    expect(banner.text()).toContain('Alt+Shift+C');
    expect(banner.attributes('role')).toBe('status');
    expect(w.find('[data-testid="overlay-status"]').classes()).toContain('status--passthrough');
    expect(w.find('[data-testid="click-through-off"]').exists()).toBe(false);
  });

  it('숨김 상태를 적는다', () => {
    expect(render(snapshot({ visible: false })).find('[data-testid="visibility"]').text()).toBe('창: 숨김');
  });

  it('등록하지 못한 단축키를 경고로 보인다', () => {
    const problem = '단축키 Alt+Shift+C(클릭 통과 전환)를 등록하지 못했다 — 다른 프로그램이 쓰고 있을 수 있다';
    const w = render(snapshot({ shortcut_problems: [problem] }));
    const box = w.find('[data-testid="shortcut-problems"]');
    expect(box.attributes('role')).toBe('alert');
    expect(box.text()).toContain(problem);
    expect(render(snapshot()).find('[data-testid="shortcut-problems"]').exists()).toBe(false);
  });

  it('상태를 아직 모르면 확인 중이라고 적는다', () => {
    const w = render(null);
    expect(w.find('[data-testid="status-unknown"]').exists()).toBe(true);
    expect(w.find('[data-testid="click-through-on"]').exists()).toBe(false);
    expect(w.find('[data-testid="click-through-off"]').exists()).toBe(false);
  });
});
