// 부품 모아 보기(src/ui/gallery): 모든 부품과 상태가 한 화면에 있고, 개발 실행에서만 뜬다.
// 이미지는 코드로 만든 가짜 바이트이고, 이미지 명령은 흉내 낸 것이다.
import { clearMocks } from '@tauri-apps/api/mocks';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GALLERY_QUERY, galleryRequested } from '../src/lib/gallery';
import { clearImageCache } from '../src/lib/images';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import UiGallery from '../src/ui/gallery/UiGallery.vue';
import { SAMPLE_BOSSES, SAMPLE_LONG_NAMES, SAMPLE_SQUAD, SAMPLE_UNKNOWN_NAME } from '../src/ui/gallery/samples';
import mainSource from '../src/main.ts?raw';
import bossBundle from '../../data/intercept/anomaly.json';
import { catalog } from './helpers/fakeEngine';
import { mockImages } from './helpers/fakeImages';

const sources = import.meta.glob<string>('../src/**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true });

beforeEach(() => {
  clearImageCache();
  clearNikkeCatalog();
});
afterEach(() => {
  clearMocks();
  vi.useRealTimers();
});

type Wrapper = ReturnType<typeof mount>;
const all = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`);
const section = (w: Wrapper, name: string) => w.find(`[data-section="${name}"]`);

/** 이 PC에 그림이 일부만 있는 상황: 초상화 셋, 보스 둘(받아 둔 것 하나·캡처 조각 하나), 아이콘 몇 개. */
const SOME_IMAGES = {
  portraits: ['라피 : 레드 후드', '크라운', SAMPLE_LONG_NAMES[0]],
  bosses: { indivilia: 'assets', kraken: 'capture' } as const,
  icons: { 'element:작열': 'assets', 'burst:3': 'engine', 'class:화력형': 'engine' } as const,
};

async function open(world: Parameters<typeof mockImages>[0] = SOME_IMAGES) {
  const mock = mockImages(world);
  const w = mount(UiGallery);
  await flushPromises();
  return { w, calls: mock.calls };
}

describe('부품 모아 보기', () => {
  it('모든 부품이 한 화면에 있다', async () => {
    const { w } = await open();
    for (const part of [
      'nikke-tile',
      'boss-card',
      'element-chip',
      'burst-badge',
      'damage-bar',
      'rank-row',
      'status-pill',
      'progress-panel',
      'skeleton',
      'empty-state',
      'details-fold',
      'game-icon',
    ]) {
      expect(all(w, part).length, part).toBeGreaterThan(0);
    }
    expect(w.findAll('[data-section]').map((s) => s.attributes('data-section'))).toEqual([
      'tokens',
      'status',
      'element',
      'icons',
      'bar',
      'tiles',
      'boss',
      'summary',
      'progress',
      'skeleton',
      'empty',
      'fold',
    ]);
    w.unmount();
  });

  it('이미지 있음/없음: 초상화·보스 이미지·아이콘이 있는 것은 그림으로, 없는 것은 대체 그림으로 보인다', async () => {
    const { w } = await open();
    const tiles = all(section(w, 'tiles') as unknown as Wrapper, 'nikke-tile');
    const portraits = tiles.map((t) => t.attributes('data-portrait'));
    expect(portraits).toContain('image');
    expect(portraits).toContain('initial');
    // 세 크기가 다 있다.
    for (const size of ['lg', 'sm', 'xs']) expect(tiles.some((t) => t.classes().includes(`tile--${size}`)), size).toBe(true);
    // 약점 속성 니케(카탈로그의 속성으로 판단)가 강조된다.
    expect(tiles.filter((t) => t.attributes('data-weak') === 'true').length).toBeGreaterThan(0);
    const bosses = all(w, 'boss-card');
    expect(bosses.filter((b) => b.attributes('data-image') === 'image').map((b) => b.attributes('data-boss'))).toEqual(['indivilia', 'kraken']);
    expect(bosses.filter((b) => b.attributes('data-image') === 'color').length).toBeGreaterThan(3);
    const icons = all(w, 'game-icon').map((i) => i.attributes('data-source'));
    expect(icons).toContain('image');
    expect(icons).toContain('drawn');
    w.unmount();
  });

  it('긴 이름·정보 모름·비중 모름·총딜 계산 전이 있다', async () => {
    const { w } = await open();
    const names = all(w, 'nikke-tile-name').map((n) => n.text());
    for (const name of SAMPLE_LONG_NAMES) expect(names, name).toContain(name);
    expect(names).toContain(SAMPLE_UNKNOWN_NAME);
    // 카탈로그에 없는 니케는 속성·버스트 단계가 「모름」이다.
    expect(section(w, 'tiles').text()).toContain(`${SAMPLE_UNKNOWN_NAME}: 속성 모름`);
    expect(section(w, 'tiles').text()).toContain(`${SAMPLE_SQUAD[1].name}: 속성 ${catalog.nikkes[SAMPLE_SQUAD[1].name].element_code}`);
    expect(all(w, 'damage-bar-percent').map((p) => p.text())).toContain('–');
    expect(all(w, 'boss-card-total').map((t) => t.text())).toContain('계산 전');
    expect(all(w, 'element-chip-text').map((t) => t.text())).toContain('약점 모름');
    w.unmount();
  });

  it('계산 중: 진행 패널의 상태들(처음 몇 건·어림 중·준비 중·멈추는 중)과 실제로 흘러가는 보기', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { w } = await open();
    const panels = all(w, 'progress-panel');
    expect(panels.length).toBeGreaterThanOrEqual(5);
    const states = panels.map((p) => p.attributes('data-state'));
    expect(states).toContain('warming');
    expect(states).toContain('estimating');
    expect(states).toContain('done');
    const etas = all(w, 'progress-eta').map((e) => e.text());
    expect(etas).toContain('계산 중');
    expect(etas).toContain('멈추는 중');
    expect(etas.some((t) => /^약 .+ 남음$/.test(t))).toBe(true);
    expect(all(w, 'progress-count').map((c) => c.text())).toContain('준비 중');
    // 흘러가는 보기: 0.5초마다 한 칸, 두 칸에 한 건.
    const live = panels[0];
    expect(live.find('[data-testid="progress-count"]').text()).toBe('0 / 60');
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(live.find('[data-testid="progress-count"]').text()).toBe('10 / 60');
    expect(live.find('[data-testid="progress-eta"]').text()).toMatch(/^약 .+ 남음$/);
    // 중단을 누르면 멈춘다.
    await live.find('[data-testid="progress-stop"]').trigger('click');
    expect(live.find('[data-testid="progress-eta"]').text()).toBe('멈추는 중');
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(live.find('[data-testid="progress-count"]').text()).toBe('10 / 60');
    await w.find('[data-testid="gallery-restart"]').trigger('click');
    expect(live.find('[data-testid="progress-count"]').text()).toBe('0 / 60');
    w.unmount();
  });

  it('빈 상태와 오류: 무엇을 하면 되는지와 단추 하나 — 눌리면 알린다', async () => {
    const { w } = await open();
    const empties = all(w, 'empty-state');
    expect(empties.map((e) => e.attributes('data-tone'))).toEqual(['neutral', 'error', 'neutral']);
    expect(empties[1].attributes('role')).toBe('alert');
    for (const e of empties.slice(0, 2)) {
      expect(e.findAll('button')).toHaveLength(1);
      expect(e.find('[data-testid="empty-hint"]').text().length).toBeGreaterThan(10);
    }
    await empties[0].find('button').trigger('click');
    await empties[1].find('button').trigger('click');
    expect(w.find('[data-testid="gallery-actions"]').text()).toBe('단추를 누른 횟수: 2');
    w.unmount();
  });

  it('상태 알약에 추정·미확인·검증용·오류가 있고, 이 화면의 수치가 지어낸 값임을 밝힌다', async () => {
    const { w } = await open();
    const pills = all(w, 'status-pill');
    const tones = new Set(pills.map((p) => p.attributes('data-tone')));
    for (const tone of ['ok', 'estimate', 'unknown', 'error', 'test', 'accent', 'neutral']) expect(tones.has(tone), tone).toBe(true);
    expect(pills.map((p) => p.text())).toContain('추정 · 실전 미대조');
    expect(w.find('.gallery__head').text()).toContain('지어낸 보기 값');
    expect(w.find('.gallery__head [data-testid="status-pill"]').text()).toBe('검증용 데이터');
    w.unmount();
  });

  it('한 줄 요약은 루트의 순수 함수가 만든 문장이다 — 카탈로그로 약점 속성 니케를 알 때만 속성을 말한다', async () => {
    const { w } = await open();
    const text = w.find('[data-testid="gallery-summary"]').text();
    expect(text).toMatch(/[^.]\.$/);
    expect(text).toContain('자리 순서를 바꿔 딜 +8%');
    expect(text).toContain('약점 속성(작열)');
    w.unmount();
    // 카탈로그를 읽지 못하면 누가 약점 속성인지 모른다 — 속성 이야기를 지어내지 않는다.
    clearMocks();
    clearNikkeCatalog();
    clearImageCache();
    const { w: offline } = await open({ catalogFails: true });
    const plain = offline.find('[data-testid="gallery-summary"]').text();
    expect(plain).not.toContain('약점 속성');
    expect(plain).toContain('로 딜이 나뉜다');
    expect(offline.find('[data-testid="gallery-catalog-problem"]').exists()).toBe(true);
    expect(all(offline, 'nikke-tile').every((t) => t.attributes('data-weak') === 'false' || t.attributes('title')?.includes('약점 속성(작열)'))).toBe(true);
    offline.unmount();
  });

  it('보기 값의 보스는 내장 보스 묶음과 같다(id·이름·속성·약점)', () => {
    expect(SAMPLE_BOSSES.map((b) => [b.id, b.name, b.element, b.weakTo])).toEqual(bossBundle.bosses.map((b) => [b.id, b.name, b.enemy.code, b.weak_to]));
    // 보기 편성의 니케는 엔진 카탈로그에 있는 이름이다(초상화가 뜬다). 모르는 니케의 보기는 카탈로그에 없다.
    for (const m of SAMPLE_SQUAD) expect(Object.hasOwn(catalog.nikkes, m.name), m.name).toBe(true);
    for (const name of SAMPLE_LONG_NAMES) expect(Object.hasOwn(catalog.nikkes, name), name).toBe(true);
    expect(Object.hasOwn(catalog.nikkes, SAMPLE_UNKNOWN_NAME)).toBe(false);
    // 보기 비중의 합은 1이다.
    expect(SAMPLE_SQUAD.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1, 10);
  });
});

describe('개발 실행에서만 뜬다', () => {
  it('주소에 표시(?gallery)가 붙었거나 시작할 때 켰을 때만 — 개발 실행이 아니면 무엇을 붙여도 뜨지 않는다', () => {
    expect(GALLERY_QUERY).toBe('gallery');
    expect(galleryRequested(true, '?gallery')).toBe(true);
    expect(galleryRequested(true, '?gallery=1&x=2')).toBe(true);
    expect(galleryRequested(true, '?x=2&gallery')).toBe(true);
    expect(galleryRequested(true, '')).toBe(false);
    expect(galleryRequested(true, '?notgallery')).toBe(false);
    expect(galleryRequested(true, '?g=gallery')).toBe(false);
    expect(galleryRequested(true, '', '1')).toBe(true);
    expect(galleryRequested(true, '', 'true')).toBe(true);
    expect(galleryRequested(true, '', '0')).toBe(false);
    expect(galleryRequested(true, '', undefined)).toBe(false);
    // 일반 실행(빌드한 앱).
    expect(galleryRequested(false, '?gallery')).toBe(false);
    expect(galleryRequested(false, '?gallery', '1')).toBe(false);
    expect(galleryRequested(false, '', '1')).toBe(false);
  });

  it('시작 코드는 개발 실행일 때만 그 화면을 불러온다 — 빌드하면 그 갈래와 화면의 코드가 빠진다', () => {
    const code = mainSource.replace(/(^|\s)\/\/[^\n]*/g, '$1');
    // 빌드할 때 false로 굳는 값이 조건의 맨 앞에 있고, 화면은 그 갈래 안에서만(필요할 때) 불러온다.
    expect(code).toMatch(/if \(import\.meta\.env\.DEV && galleryRequested\(true, window\.location\.search, import\.meta\.env\.VITE_UI_GALLERY\)\) \{\s*void import\('\.\/ui\/gallery\/UiGallery\.vue'\)/);
    expect(code).not.toMatch(/^import .*gallery\/UiGallery/m);
    // 그 밖에는 창에 맞는 화면을 그린다(P-027: 오버레이 창은 Overlay.vue, 데스크톱 앱 창은 App.vue).
    expect(code).toMatch(/\} else \{\s*createApp\(windowLabel\(\) === OVERLAY_WINDOW \? Overlay : App\)\.mount\('#app'\);\s*\}/);
    // 다른 어떤 화면 코드도 부품 모아 보기를 가져오지 않는다(시작 코드와 그 폴더 안의 파일만).
    for (const [file, text] of Object.entries(sources)) {
      if (file === '../src/main.ts' || file.startsWith('../src/ui/gallery/')) continue;
      expect(text, file).not.toMatch(/ui\/gallery|UiGallery|gallery\/samples/);
    }
  });

  it('새 부품은 새 화면(앱 창의 틀·pages·views·오버레이)이 쓴다 — 고급으로 옮긴 예전 화면(components·screens)은 예전 모양 그대로다', () => {
    // P-027에서 화면을 옮겼다: 데스크톱 앱 창의 화면들과 결과 그림(views)이 부품을 쓴다.
    const users = Object.entries(sources).filter(([, text]) => /from '(\.\.?\/)+ui\/[A-Z]/.test(text)).map(([file]) => file);
    // P-028: 오버레이는 틀(Overlay.vue)과 그림(views/OverlayWidget.vue)으로 나뉘었다 — 부품을 쓰는 것은 그림 쪽이다.
    expect(users).toEqual(
      expect.arrayContaining(['../src/App.vue', '../src/views/OverlayWidget.vue', '../src/pages/InterceptPage.vue', '../src/views/InterceptResult.vue', '../src/views/TierBoard.vue']),
    );
    expect(sources['../src/Overlay.vue']).toContain("import OverlayWidget from './views/OverlayWidget.vue';");
    // 예전 화면은 설정 > 고급(파일 직접 고르기)에 예전 모양으로 남았다 — 부품을 섞어 쓰지 않는다.
    for (const [file, text] of Object.entries(sources)) {
      if (!/\/(components|screens)\//.test(file)) continue;
      expect(text, file).not.toMatch(/from '(\.\.?\/)+ui\//);
    }
  });
});
