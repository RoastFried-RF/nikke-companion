// 공통 부품(src/ui)의 컴포넌트 테스트 — 부품마다 하나씩.
// 이미지는 코드로 만든 가짜 바이트이고, 이미지 명령은 흉내 낸 것이다(tests/helpers/fakeImages.ts). 게임 이미지를 쓰지 않는다.
import { clearMocks } from '@tauri-apps/api/mocks';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDamage } from '@core/format.mjs';
import { estimateRemaining } from '@core/eta.mjs';
import { clearImageCache } from '../src/lib/images';
import BossCard from '../src/ui/BossCard.vue';
import BurstBadge from '../src/ui/BurstBadge.vue';
import DamageBar from '../src/ui/DamageBar.vue';
import DetailsFold from '../src/ui/DetailsFold.vue';
import ElementChip from '../src/ui/ElementChip.vue';
import EmptyState from '../src/ui/EmptyState.vue';
import GameIcon from '../src/ui/GameIcon.vue';
import NikkeTile from '../src/ui/NikkeTile.vue';
import ProgressPanel from '../src/ui/ProgressPanel.vue';
import RankRow from '../src/ui/RankRow.vue';
import SkeletonBlock from '../src/ui/SkeletonBlock.vue';
import StatusPill from '../src/ui/StatusPill.vue';
import { fakeImage, mockImages, urlOf } from './helpers/fakeImages';

beforeEach(() => clearImageCache());
afterEach(() => clearMocks());

type Wrapper = ReturnType<typeof mount>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const all = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`);

describe('GameIcon — 아이콘', () => {
  it('받아 둔 아이콘이 있으면 그 그림을 쓴다', async () => {
    const { calls } = mockImages({ icons: { 'element:작열': 'assets' } });
    const w = mount(GameIcon, { props: { kind: 'element', value: '작열' } });
    await flushPromises();
    expect(calls).toEqual([{ cmd: 'game_icon', args: { kind: 'element', key: '작열' } }]);
    expect(at(w, 'game-icon').attributes('data-source')).toBe('image');
    expect(at(w, 'game-icon-image').attributes('src')).toBe(urlOf(fakeImage('icon:element:작열', 'assets')));
    expect(at(w, 'game-icon-drawn').exists()).toBe(false);
    expect(at(w, 'game-icon').attributes('aria-label')).toBe('속성 작열');
  });

  it('아이콘이 없으면 직접 그린 것으로 대신한다 — 속성은 도형, 나머지는 글자 배지', async () => {
    mockImages();
    const element = mount(GameIcon, { props: { kind: 'element', value: '전격' } });
    const burst = mount(GameIcon, { props: { kind: 'burst', value: '3' } });
    const all4 = mount(GameIcon, { props: { kind: 'burst', value: 'A' } });
    const klass = mount(GameIcon, { props: { kind: 'class', value: '화력형' } });
    const corp = mount(GameIcon, { props: { kind: 'corp', value: '필그림' } });
    const weapon = mount(GameIcon, { props: { kind: 'weapon', value: 'SMG' } });
    await flushPromises();
    for (const w of [element, burst, all4, klass, corp, weapon]) {
      expect(at(w, 'game-icon').attributes('data-source')).toBe('drawn');
      expect(at(w, 'game-icon-image').exists()).toBe(false);
    }
    // 속성: 도형(색은 속성 색 토큰이 정한다 — data-element로 고른다).
    expect(at(element, 'game-icon-drawn').element.tagName.toLowerCase()).toBe('svg');
    expect(at(element, 'game-icon').attributes('data-element')).toBe('전격');
    // 속성마다 도형이 다르다.
    const shapes = ['작열', '풍압', '철갑', '전격', '수냉'].map((value) => mount(GameIcon, { props: { kind: 'element', value, src: null } }).find('path').attributes('d'));
    expect(new Set(shapes).size).toBe(5);
    expect(at(burst, 'game-icon-drawn').text()).toBe('III');
    expect(at(all4, 'game-icon-drawn').text()).toBe('A');
    expect(at(klass, 'game-icon-drawn').text()).toBe('화');
    expect(at(corp, 'game-icon-drawn').text()).toBe('필');
    expect(at(weapon, 'game-icon-drawn').text()).toBe('SMG');
  });

  it('값을 모르면 묻지 않고 「?」로 그린다', async () => {
    const { calls } = mockImages({ icons: { 'element:작열': 'assets' } });
    const w = mount(GameIcon, { props: { kind: 'element', value: null } });
    const burst = mount(GameIcon, { props: { kind: 'burst', value: '9' } });
    await flushPromises();
    expect(calls.filter((c) => c.args.kind === 'element')).toEqual([]);
    expect(at(w, 'game-icon-drawn').text()).toBe('?');
    expect(at(w, 'game-icon').attributes('aria-label')).toBe('속성 모름');
    expect(at(w, 'game-icon').attributes('data-element')).toBeUndefined();
    // 표에 없는 단계는 지어내지 않는다.
    expect(at(burst, 'game-icon-drawn').text()).toBe('?');
  });

  it('주소를 직접 주면 그것을 쓰고 묻지 않는다. null을 주면 직접 그린 것만 쓴다. 값이 바뀌면 다시 묻는다', async () => {
    const { calls } = mockImages({ icons: { 'burst:1': 'engine', 'burst:2': 'engine' } });
    const given = mount(GameIcon, { props: { kind: 'burst', value: '1', src: 'data:image/png;base64,AAAA' } });
    const drawn = mount(GameIcon, { props: { kind: 'burst', value: '1', src: null } });
    await flushPromises();
    expect(calls).toEqual([]);
    expect(at(given, 'game-icon-image').attributes('src')).toBe('data:image/png;base64,AAAA');
    expect(at(drawn, 'game-icon-drawn').text()).toBe('I');
    const auto = mount(GameIcon, { props: { kind: 'burst', value: '1' } });
    await flushPromises();
    expect(at(auto, 'game-icon-image').attributes('src')).toBe(urlOf(fakeImage('icon:burst:1')));
    await auto.setProps({ value: '2' });
    await flushPromises();
    expect(at(auto, 'game-icon-image').attributes('src')).toBe(urlOf(fakeImage('icon:burst:2')));
    await auto.setProps({ value: '3' });
    await flushPromises();
    expect(at(auto, 'game-icon-drawn').text()).toBe('III');
  });
});

describe('BurstBadge — 버스트 배지', () => {
  it('단계를 로마 숫자 배지로 그린다. 게임의 아이콘이 있으면 그것을 쓴다', async () => {
    mockImages({ icons: { 'burst:2': 'engine' } });
    const drawn = ['1', '2', '3', 'A'].map((stage) => mount(BurstBadge, { props: { stage, src: null } }));
    expect(drawn.map((w) => at(w, 'game-icon-drawn').text())).toEqual(['I', 'II', 'III', 'A']);
    expect(drawn.map((w) => at(w, 'burst-badge').attributes('data-stage'))).toEqual(['1', '2', '3', 'A']);
    const withIcon = mount(BurstBadge, { props: { stage: '2' } });
    const without = mount(BurstBadge, { props: { stage: '1' } });
    await flushPromises();
    expect(at(withIcon, 'game-icon-image').attributes('src')).toBe(urlOf(fakeImage('icon:burst:2')));
    expect(at(without, 'game-icon-drawn').text()).toBe('I');
    expect(at(withIcon, 'game-icon').attributes('aria-label')).toBe('버스트 2');
  });

  it('단계를 모르면 「?」다', () => {
    const w = mount(BurstBadge, { props: { stage: null } });
    expect(at(w, 'game-icon-drawn').text()).toBe('?');
    expect(at(w, 'game-icon').attributes('aria-label')).toBe('버스트 모름');
  });
});

describe('ElementChip — 속성 칩', () => {
  it('속성 아이콘과 글자를 보이고, 속성 색을 data-element로 고른다', () => {
    const w = mount(ElementChip, { props: { element: '작열', label: '약점', src: null } });
    expect(at(w, 'element-chip-text').text()).toBe('약점 작열');
    expect(at(w, 'element-chip').attributes('data-element')).toBe('작열');
    expect(at(w, 'game-icon').attributes('data-kind')).toBe('element');
    expect(mount(ElementChip, { props: { element: '수냉', src: null } }).text()).toBe('수냉');
  });

  it('속성을 모르면 「모름」이다 — 색을 지어내지 않는다', () => {
    const w = mount(ElementChip, { props: { element: null, label: '약점' } });
    expect(at(w, 'element-chip-text').text()).toBe('약점 모름');
    expect(at(w, 'element-chip').attributes('data-element')).toBeUndefined();
    expect(at(w, 'element-chip').classes()).toContain('chip--unknown');
    expect(at(w, 'game-icon-drawn').text()).toBe('?');
  });

  it('점으로 쓰면 글자 없이 아이콘만 — 무엇인지는 풍선 도움말과 읽어 주는 말에 있다', async () => {
    mockImages({ icons: { 'element:풍압': 'engine' } });
    const w = mount(ElementChip, { props: { element: '풍압', dot: true } });
    await flushPromises();
    expect(at(w, 'element-chip-text').exists()).toBe(false);
    expect(at(w, 'element-chip').attributes('title')).toBe('풍압');
    expect(at(w, 'game-icon-image').exists()).toBe(true);
    expect(at(w, 'game-icon').attributes('aria-label')).toBe('속성 풍압');
  });
});

describe('DamageBar — 딜 막대', () => {
  const width = (w: Wrapper) => (at(w, 'damage-bar-fill').element as HTMLElement).style.width;

  it('비중을 막대의 길이와 %로 보인다', () => {
    const w = mount(DamageBar, { props: { share: 0.624 } });
    expect(width(w)).toBe('62.4%');
    expect(at(w, 'damage-bar-percent').text()).toBe('62%');
    expect(at(w, 'damage-bar').attributes('aria-label')).toBe('딜 비중 62%');
    expect(mount(DamageBar, { props: { share: 0 } }).text()).toBe('0%');
    expect(mount(DamageBar, { props: { share: 1 } }).text()).toBe('100%');
  });

  it('범위를 벗어난 값은 0~100%로 자른다', () => {
    expect(width(mount(DamageBar, { props: { share: 1.7 } }))).toBe('100%');
    expect(mount(DamageBar, { props: { share: 1.7 } }).text()).toBe('100%');
    expect(width(mount(DamageBar, { props: { share: -0.2 } }))).toBe('0%');
  });

  it('비중을 모르면 0%가 아니라 「–」와 빈 막대다', () => {
    for (const share of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const w = mount(DamageBar, { props: { share } });
      expect(at(w, 'damage-bar-percent').text()).toBe('–');
      expect(width(w)).toBe('0%');
      expect(at(w, 'damage-bar').attributes('aria-label')).toBe('딜 비중 모름');
      expect(at(w, 'damage-bar').classes()).toContain('bar--unknown');
    }
  });

  it('% 글자를 끌 수 있고, 얇은 막대·속성 색 막대가 있다', () => {
    const w = mount(DamageBar, { props: { share: 0.3, percent: false, thin: true, tone: 'element' } });
    expect(at(w, 'damage-bar-percent').exists()).toBe(false);
    expect(at(w, 'damage-bar').classes()).toEqual(expect.arrayContaining(['bar--thin', 'bar--element']));
  });
});

describe('NikkeTile — 니케 타일', () => {
  it('초상화가 있으면 그 그림을, 버스트 배지·속성 점·이름·딜 비중과 함께 보인다', async () => {
    const { calls } = mockImages({ portraits: ['크라운'] });
    const w = mount(NikkeTile, { props: { name: '크라운', element: '철갑', burst: '2', share: 0.21 } });
    await flushPromises();
    expect(calls.filter((c) => c.cmd === 'nikke_portrait')).toEqual([{ cmd: 'nikke_portrait', args: { name: '크라운' } }]);
    const tile = at(w, 'nikke-tile');
    expect(tile.attributes('data-portrait')).toBe('image');
    expect(at(w, 'nikke-tile-image').attributes('src')).toBe(urlOf(fakeImage('portrait:크라운')));
    expect(at(w, 'nikke-tile-image').attributes('alt')).toBe('크라운');
    expect(at(w, 'nikke-tile-initial').exists()).toBe(false);
    expect(at(w, 'nikke-tile-name').text()).toBe('크라운');
    expect(at(w, 'burst-badge').attributes('data-stage')).toBe('2');
    expect(at(w, 'element-chip').attributes('data-element')).toBe('철갑');
    expect(at(w, 'damage-bar-percent').text()).toBe('21%');
    expect(tile.classes()).toContain('tile--lg');
    expect(tile.attributes('data-element')).toBe('철갑');
  });

  it('초상화가 없으면 이름의 첫 글자로 대신한다(불러오는 동안에도)', async () => {
    mockImages();
    const w = mount(NikkeTile, { props: { name: '이름만 있는 니케' } });
    expect(at(w, 'nikke-tile-initial').text()).toBe('이');
    await flushPromises();
    expect(at(w, 'nikke-tile').attributes('data-portrait')).toBe('initial');
    expect(at(w, 'nikke-tile-initial').text()).toBe('이');
    expect(at(w, 'nikke-tile-image').exists()).toBe(false);
    // 영문·기호로 시작하는 이름, 앞뒤 공백, 빈 이름.
    expect(at(mount(NikkeTile, { props: { name: 'D : 킬러 와이프', src: null } }), 'nikke-tile-initial').text()).toBe('D');
    expect(at(mount(NikkeTile, { props: { name: '  2B', src: null } }), 'nikke-tile-initial').text()).toBe('2');
    expect(at(mount(NikkeTile, { props: { name: '', src: null } }), 'nikke-tile-initial').text()).toBe('?');
  });

  it('약점 속성 니케는 속성 색 테두리로 강조한다', () => {
    const weak = mount(NikkeTile, { props: { name: '라피 : 레드 후드', element: '작열', burst: '3', weak: true, share: 0.46, src: null } });
    const plain = mount(NikkeTile, { props: { name: '크라운', element: '철갑', burst: '2', share: 0.21, src: null } });
    expect(at(weak, 'nikke-tile').attributes('data-weak')).toBe('true');
    expect(at(weak, 'nikke-tile').classes()).toContain('tile--weak');
    expect(at(weak, 'nikke-tile').attributes('title')).toBe('라피 : 레드 후드 — 약점 속성(작열)');
    // 약점 속성 니케의 딜 막대는 속성 색이다.
    expect(at(weak, 'damage-bar').classes()).toContain('bar--element');
    expect(at(plain, 'nikke-tile').attributes('data-weak')).toBe('false');
    expect(at(plain, 'nikke-tile').classes()).not.toContain('tile--weak');
    expect(at(plain, 'damage-bar').classes()).toContain('bar--accent');
  });

  it('긴 이름은 전부 담되 한 줄로 줄여 보이고, 풍선 도움말에 전체 이름이 있다', () => {
    const name = '스노우 화이트 : 이노센트 데이즈';
    const w = mount(NikkeTile, { props: { name, src: null }, attachTo: document.body });
    expect(at(w, 'nikke-tile-name').text()).toBe(name);
    expect(at(w, 'nikke-tile').attributes('title')).toBe(name);
    w.unmount();
  });

  it('속성·버스트 단계를 모르면 「모름」으로 그리고, 딜 비중은 주지 않으면 막대가 없고 null이면 「–」다', () => {
    const unknown = mount(NikkeTile, { props: { name: '이름만 있는 니케', src: null } });
    expect(at(unknown, 'burst-badge').attributes('data-stage')).toBe('');
    expect(unknown.findAll('[data-testid="game-icon-drawn"]').map((el) => el.text())).toEqual(['?', '?']);
    expect(at(unknown, 'nikke-tile').attributes('data-element')).toBeUndefined();
    expect(at(unknown, 'damage-bar').exists()).toBe(false);
    const noShare = mount(NikkeTile, { props: { name: '크라운', share: null, src: null } });
    expect(at(noShare, 'damage-bar-percent').text()).toBe('–');
  });

  it('한 줄 카드용 타일(mini — 오버레이 위젯)은 얼굴과 버스트 배지만 보인다 — 약점 속성 강조와 이름(풍선 도움말)은 갖는다', async () => {
    mockImages({ portraits: ['크라운'] });
    const mini = mount(NikkeTile, { props: { name: '크라운', size: 'mini', element: '철갑', burst: '2', share: 0.21, weak: true } });
    await flushPromises();
    expect(at(mini, 'nikke-tile').classes()).toContain('tile--mini');
    expect(at(mini, 'nikke-tile-image').exists()).toBe(true);
    expect(at(mini, 'burst-badge').attributes('data-stage')).toBe('2');
    for (const part of ['nikke-tile-name', 'element-chip', 'damage-bar']) expect(at(mini, part).exists(), part).toBe(false);
    expect(at(mini, 'nikke-tile').classes()).toContain('tile--weak');
    expect(at(mini, 'nikke-tile').attributes('title')).toBe('크라운 — 약점 속성(철갑)');
    // 그림이 없으면 이름 첫 글자, 버스트 단계를 모르면 「?」.
    const blank = mount(NikkeTile, { props: { name: '이름만 있는 니케', size: 'mini', src: null } });
    expect(at(blank, 'nikke-tile-initial').text()).toBe('이');
    expect(at(blank, 'burst-badge').attributes('data-stage')).toBe('');
  });

  it('작은 타일(오버레이용)은 같은 정보를 작게, 얼굴만 타일(순위 줄)은 그림만 보인다', async () => {
    mockImages({ portraits: ['크라운'] });
    const small = mount(NikkeTile, { props: { name: '크라운', size: 'sm', element: '철갑', burst: '2', share: 0.21 } });
    const face = mount(NikkeTile, { props: { name: '크라운', size: 'xs', element: '철갑', burst: '2', share: 0.21, weak: true } });
    await flushPromises();
    expect(at(small, 'nikke-tile').classes()).toContain('tile--sm');
    expect(at(small, 'nikke-tile-image').exists()).toBe(true);
    expect(at(small, 'nikke-tile-name').text()).toBe('크라운');
    expect(at(small, 'burst-badge').exists()).toBe(true);
    expect(at(small, 'damage-bar').classes()).toContain('bar--thin');
    expect(at(face, 'nikke-tile').classes()).toContain('tile--xs');
    expect(at(face, 'nikke-tile-image').exists()).toBe(true);
    for (const part of ['nikke-tile-name', 'burst-badge', 'element-chip', 'damage-bar']) expect(at(face, part).exists(), part).toBe(false);
    // 얼굴만 타일도 약점 속성 강조와 이름(풍선 도움말·대체 글자)은 갖는다.
    expect(at(face, 'nikke-tile').attributes('data-weak')).toBe('true');
    expect(at(face, 'nikke-tile-image').attributes('alt')).toBe('크라운');
  });

  it('이름이 바뀌면 그 니케의 초상화로 바뀐다 — 늦게 온 앞 그림이 덮지 않는다', async () => {
    mockImages({ portraits: ['크라운', '헬름'] });
    const w = mount(NikkeTile, { props: { name: '크라운' } });
    await w.setProps({ name: '헬름' });
    await flushPromises();
    expect(at(w, 'nikke-tile-image').attributes('src')).toBe(urlOf(fakeImage('portrait:헬름')));
    await w.setProps({ name: '그림 없는 니케' });
    await flushPromises();
    expect(at(w, 'nikke-tile-initial').text()).toBe('그');
  });
});

describe('BossCard — 보스 카드', () => {
  const props = { id: 'kraken', name: '크라켄', element: '철갑', weakTo: '풍압', totalDamage: 1_061_233_907 };

  it('보스 이미지·이름·약점 칩·총딜을 보인다', async () => {
    const { calls } = mockImages({ bosses: { kraken: 'capture' } });
    const w = mount(BossCard, { props });
    await flushPromises();
    expect(calls.filter((c) => c.cmd === 'boss_image')).toEqual([{ cmd: 'boss_image', args: { id: 'kraken' } }]);
    expect(at(w, 'boss-card').attributes('data-image')).toBe('image');
    expect(at(w, 'boss-card-image').attributes('src')).toBe(urlOf(fakeImage('boss:kraken', 'capture', 'image/png')));
    expect(at(w, 'boss-card-name').text()).toBe('크라켄');
    expect(at(w, 'element-chip-text').text()).toBe('약점 풍압');
    // 약점 칩은 약점 속성의 색, 카드는 보스 자신의 속성 색이다.
    expect(at(w, 'element-chip').attributes('data-element')).toBe('풍압');
    expect(at(w, 'boss-card').attributes('data-element')).toBe('철갑');
    // 총딜은 루트의 단위 표기 그대로다.
    expect(at(w, 'boss-card-total').text()).toBe(`총딜 ${formatDamage(1_061_233_907)}`);
  });

  it('받아 둔 이미지도 캡처 조각도 없으면 속성 색 바탕에 이름 첫 글자로 대신한다', async () => {
    mockImages();
    const w = mount(BossCard, { props });
    await flushPromises();
    expect(at(w, 'boss-card').attributes('data-image')).toBe('color');
    expect(at(w, 'boss-card-image').exists()).toBe(false);
    expect(at(w, 'boss-card-fallback').text()).toBe('크');
    expect(at(w, 'boss-card').attributes('data-element')).toBe('철갑');
    // 속성도 모르는 보스: 색을 지어내지 않는다(모름 색).
    const unknown = mount(BossCard, { props: { id: 'x', name: '모르는 보스', src: null } });
    expect(at(unknown, 'boss-card').attributes('data-element')).toBeUndefined();
    expect(at(unknown, 'element-chip-text').text()).toBe('약점 모름');
  });

  it('받아 둔 이미지가 있으면 그것을 쓴다(Rust가 캡처 조각보다 먼저 준다)', async () => {
    mockImages({ bosses: { kraken: 'assets' } });
    const w = mount(BossCard, { props });
    await flushPromises();
    expect(at(w, 'boss-card-image').attributes('src')).toBe(urlOf(fakeImage('boss:kraken', 'assets')));
  });

  it('총딜을 아직 모르면 0이 아니라 「계산 전」이다', () => {
    const w = mount(BossCard, { props: { ...props, totalDamage: null, src: null } });
    expect(at(w, 'boss-card-total').text()).toBe('계산 전');
    expect(at(mount(BossCard, { props: { ...props, totalDamage: 0, src: null } }), 'boss-card-total').text()).toBe(`총딜 ${formatDamage(0)}`);
  });

  it('누르면 그 보스를 고르라고 알리고, 고른 카드는 눌린 상태다', async () => {
    const w = mount(BossCard, { props: { ...props, src: null } });
    expect(at(w, 'boss-card').element.tagName).toBe('BUTTON');
    expect(at(w, 'boss-card').attributes('aria-pressed')).toBe('false');
    await at(w, 'boss-card').trigger('click');
    expect(w.emitted('select')).toEqual([['kraken']]);
    await w.setProps({ selected: true });
    expect(at(w, 'boss-card').attributes('aria-pressed')).toBe('true');
    expect(at(w, 'boss-card').classes()).toContain('boss--selected');
  });
});

describe('RankRow — 순위 줄', () => {
  const members = [
    { name: '라피 : 레드 후드', element: '작열', weak: true },
    { name: '크라운', element: '철갑' },
    { name: '리틀 머메이드', element: '수냉' },
    { name: '프리카', element: null },
    { name: '앨리스', element: '작열', weak: true },
  ];

  it('순위·멤버 얼굴·총딜·1위 대비 비율을 한 줄에 보인다', async () => {
    mockImages({ portraits: ['크라운', '앨리스'] });
    const w = mount(RankRow, { props: { rank: 2, members, totalDamage: 4_480_112_003, relative: 0.963 } });
    await flushPromises();
    expect(at(w, 'rank-row').attributes('data-rank')).toBe('2');
    expect(at(w, 'rank-row-place').text()).toBe('2위');
    expect(at(w, 'rank-row-total').text()).toBe(formatDamage(4_480_112_003));
    expect(at(w, 'rank-row-ratio').text()).toBe('1위의 96%');
    const tiles = all(w, 'nikke-tile');
    expect(tiles).toHaveLength(5);
    expect(tiles.every((t) => t.classes().includes('tile--xs'))).toBe(true);
    // 그림이 있는 멤버는 그림, 없는 멤버는 첫 글자.
    expect(tiles.map((t) => t.attributes('data-portrait'))).toEqual(['initial', 'image', 'initial', 'initial', 'image']);
    expect(tiles.map((t) => t.attributes('data-weak'))).toEqual(['true', 'false', 'false', 'false', 'true']);
    // 누가 들었는지는 풍선 도움말로 읽힌다.
    expect(at(w, 'rank-row-members').attributes('title')).toBe('라피 : 레드 후드, 크라운, 리틀 머메이드, 프리카, 앨리스');
  });

  it('1위 대비 비율을 모르면 그 칸이 없다', () => {
    const w = mount(RankRow, { props: { rank: 3, members: [{ name: '크라운', src: null }], totalDamage: 123_456_789 } });
    expect(at(w, 'rank-row-place').text()).toBe('3위');
    expect(at(w, 'rank-row-ratio').exists()).toBe(false);
    expect(at(mount(RankRow, { props: { rank: 3, members: [], totalDamage: 1, relative: Number.NaN } }), 'rank-row-ratio').exists()).toBe(false);
  });
});

describe('StatusPill — 상태 알약', () => {
  it('상태 한마디를 그 상태의 색으로 보인다(색은 data-tone으로 고른다)', () => {
    const cases: [string, 'ok' | 'estimate' | 'unknown' | 'error' | 'test' | 'accent'][] = [
      ['연결됨', 'ok'],
      ['추정 · 실전 미대조', 'estimate'],
      ['미확인 값 7칸', 'unknown'],
      ['오류', 'error'],
      ['검증용 데이터', 'test'],
      ['고른 보스', 'accent'],
    ];
    for (const [label, tone] of cases) {
      const w = mount(StatusPill, { props: { label, tone } });
      expect(at(w, 'status-pill').text()).toBe(label);
      expect(at(w, 'status-pill').attributes('data-tone')).toBe(tone);
    }
    expect(at(mount(StatusPill, { props: { label: '연결 안 됨' } }), 'status-pill').attributes('data-tone')).toBe('neutral');
  });

  it('풍선 도움말로 무엇이 추정인지 덧붙일 수 있고, 채운 알약이 있다', () => {
    const w = mount(StatusPill, { props: { label: '추정', tone: 'estimate', detail: '실제 기록과 맞춰 본 적이 없다', solid: true } });
    expect(at(w, 'status-pill').attributes('title')).toBe('실제 기록과 맞춰 본 적이 없다');
    expect(at(w, 'status-pill').classes()).toContain('pill--solid');
  });
});

describe('ProgressPanel — 진행 패널', () => {
  const base = { title: '크라켄 추천 편성을 찾는 중', detail: '보스 4/5' };

  it('무엇을 하는 중인지·진행 막대·건수를 보인다', () => {
    const w = mount(ProgressPanel, { props: { ...base, done: 24, total: 60, elapsedMs: 96_000 } });
    expect(at(w, 'progress-title').text()).toBe('크라켄 추천 편성을 찾는 중');
    expect(at(w, 'progress-detail').text()).toBe('보스 4/5');
    expect(at(w, 'progress-count').text()).toBe('24 / 60');
    expect((at(w, 'progress-fill').element as HTMLElement).style.width).toBe('40%');
    const bar = at(w, 'progress-bar');
    expect([bar.attributes('role'), bar.attributes('aria-valuenow'), bar.attributes('aria-valuemax')]).toEqual(['progressbar', '24', '60']);
    expect(at(w, 'progress-panel').attributes('role')).toBe('status');
  });

  it('남은 시간은 루트의 순수 함수가 어림한 말 그대로다 — 처음 몇 건 전에는 「계산 중」만', () => {
    const early = mount(ProgressPanel, { props: { ...base, done: 2, total: 60, elapsedMs: 8000 } });
    expect(at(early, 'progress-eta').text()).toBe('계산 중');
    expect(at(early, 'progress-panel').attributes('data-state')).toBe('warming');
    const later = mount(ProgressPanel, { props: { ...base, done: 24, total: 60, elapsedMs: 96_000 } });
    expect(at(later, 'progress-eta').text()).toBe(estimateRemaining({ done: 24, total: 60, elapsedMs: 96_000 }).text);
    expect(at(later, 'progress-eta').text()).toBe('약 2분 30초 남음');
    expect(at(later, 'progress-panel').attributes('data-state')).toBe('estimating');
    const done = mount(ProgressPanel, { props: { ...base, done: 60, total: 60, elapsedMs: 240_000 } });
    expect(at(done, 'progress-eta').text()).toBe('끝남');
    expect((at(done, 'progress-fill').element as HTMLElement).style.width).toBe('100%');
  });

  it('전체 건수를 아직 모르면 「준비 중」이고 막대의 값을 지어내지 않는다', () => {
    const w = mount(ProgressPanel, { props: { ...base, done: 0, total: 0, elapsedMs: 1200 } });
    expect(at(w, 'progress-count').text()).toBe('준비 중');
    expect(at(w, 'progress-eta').text()).toBe('계산 중');
    expect(at(w, 'progress-bar').attributes('aria-valuenow')).toBeUndefined();
    expect(at(w, 'progress-bar').classes()).toContain('progress__track--waiting');
    expect((at(w, 'progress-fill').element as HTMLElement).style.width).toBe('0%');
  });

  it('중단 단추를 누르면 알린다. 멈추는 중에는 누를 수 없고, 중단할 수 없는 일에는 단추가 없다', async () => {
    const w = mount(ProgressPanel, { props: { ...base, done: 5, total: 60, elapsedMs: 20_000 } });
    expect(at(w, 'progress-stop').text()).toBe('중단');
    await at(w, 'progress-stop').trigger('click');
    expect(w.emitted('stop')).toHaveLength(1);
    await w.setProps({ stopping: true });
    expect(at(w, 'progress-stop').attributes('disabled')).toBeDefined();
    expect(at(w, 'progress-eta').text()).toBe('멈추는 중');
    const fixed = mount(ProgressPanel, { props: { ...base, done: 5, total: 60, elapsedMs: 20_000, stoppable: false } });
    expect(at(fixed, 'progress-stop').exists()).toBe(false);
  });

  it('끝난 건수가 전체를 넘는 보고가 와도 막대와 건수는 전체를 넘지 않는다', () => {
    const w = mount(ProgressPanel, { props: { ...base, done: 70, total: 60, elapsedMs: 1000 } });
    expect(at(w, 'progress-count').text()).toBe('60 / 60');
    expect((at(w, 'progress-fill').element as HTMLElement).style.width).toBe('100%');
  });
});

describe('SkeletonBlock — 뼈대 화면', () => {
  it('내용이 올 자리를 모양별로 미리 그리고, 불러오는 중임을 알린다', () => {
    for (const shape of ['tiles', 'cards', 'lines'] as const) {
      const w = mount(SkeletonBlock, { props: { shape, count: 5 } });
      const root = at(w, 'skeleton');
      expect(root.classes()).toContain(`skeleton--${shape}`);
      expect(all(w, 'skeleton-item')).toHaveLength(5);
      expect([root.attributes('role'), root.attributes('aria-busy'), root.attributes('aria-label')]).toEqual(['status', 'true', '불러오는 중']);
      // 자리 표시는 읽어 주지 않는다.
      expect(all(w, 'skeleton-item').every((item) => item.attributes('aria-hidden') === 'true')).toBe(true);
    }
    const w = mount(SkeletonBlock, { props: { label: '추천 편성을 불러오는 중' } });
    expect(all(w, 'skeleton-item')).toHaveLength(3);
    expect(at(w, 'skeleton').classes()).toContain('skeleton--lines');
    expect(at(w, 'skeleton').attributes('aria-label')).toBe('추천 편성을 불러오는 중');
  });
});

describe('EmptyState — 빈 상태', () => {
  it('무슨 일인지, 무엇을 하면 되는지, 단추 하나를 보인다', async () => {
    const w = mount(EmptyState, { props: { title: '아직 계정을 연결하지 않았다', hint: '계정을 한 번 연결하면 추천 편성을 찾아 준다.', action: '계정 연결하기' } });
    expect(at(w, 'empty-title').text()).toBe('아직 계정을 연결하지 않았다');
    expect(at(w, 'empty-hint').text()).toBe('계정을 한 번 연결하면 추천 편성을 찾아 준다.');
    expect(w.findAll('button')).toHaveLength(1);
    expect(at(w, 'empty-action').text()).toBe('계정 연결하기');
    await at(w, 'empty-action').trigger('click');
    expect(w.emitted('action')).toHaveLength(1);
    expect(at(w, 'empty-state').attributes('role')).toBeUndefined();
  });

  it('단추 글자를 주지 않으면 단추가 없고, 하는 중에는 누를 수 없다', async () => {
    const plain = mount(EmptyState, { props: { title: '이 보스는 아직 계산하지 않았다' } });
    expect(plain.findAll('button')).toHaveLength(0);
    expect(at(plain, 'empty-hint').exists()).toBe(false);
    const busy = mount(EmptyState, { props: { title: '계정 없음', action: '계정 연결하기', busy: true } });
    expect(at(busy, 'empty-action').attributes('disabled')).toBeDefined();
  });

  it('오류도 같은 모양이다 — 무엇이 잘못됐는지와 다시 해 볼 단추, 그리고 곧바로 읽어 준다', () => {
    const w = mount(EmptyState, { props: { tone: 'error', title: '추천 편성을 찾지 못했다', hint: '다시 해 보라.', action: '다시 시도' } });
    expect(at(w, 'empty-state').attributes('role')).toBe('alert');
    expect(at(w, 'empty-state').attributes('data-tone')).toBe('error');
    expect(at(w, 'empty-state').classes()).toContain('empty--error');
    expect(at(w, 'empty-action').text()).toBe('다시 시도');
  });
});

describe('DetailsFold — 접는 「자세히」', () => {
  it('처음에는 접혀 있고, 접힌 줄에 이름과 항목 수가 보인다', () => {
    const w = mount(DetailsFold, { props: { summary: '주의', count: 4 }, slots: { default: '<p data-testid="inside">보스 패턴은 계산에 없다.</p>' } });
    const fold = at(w, 'details-fold');
    expect(fold.element.tagName).toBe('DETAILS');
    expect((fold.element as HTMLDetailsElement).open).toBe(false);
    expect(at(w, 'details-fold-summary').text()).toBe('주의4');
    expect(at(w, 'details-fold-count').text()).toBe('4');
    // 내용은 접혀 있어도 문서 안에 있다(펴면 보인다).
    expect(at(w, 'inside').text()).toBe('보스 패턴은 계산에 없다.');
  });

  it('이름을 주지 않으면 「자세히」이고, 항목 수를 주지 않으면 수가 없다', () => {
    const w = mount(DetailsFold, { slots: { default: '내용' } });
    expect(at(w, 'details-fold-summary').text()).toBe('자세히');
    expect(at(w, 'details-fold-count').exists()).toBe(false);
    expect(at(w, 'details-fold').attributes('data-tone')).toBe('neutral');
    // 0도 수다.
    expect(at(mount(DetailsFold, { props: { count: 0 } }), 'details-fold-count').text()).toBe('0');
  });

  it('처음부터 펴 둘 수 있고, 접고 펼 때 알린다. 경고가 든 구획은 색으로 구분한다', async () => {
    const w = mount(DetailsFold, { props: { open: true, tone: 'unknown' }, slots: { default: '내용' } });
    const el = at(w, 'details-fold').element as HTMLDetailsElement;
    expect(el.open).toBe(true);
    expect(at(w, 'details-fold').attributes('data-tone')).toBe('unknown');
    // 접으면(브라우저가 toggle을 알린다) 접혔다고 알린다.
    el.open = false;
    await at(w, 'details-fold').trigger('toggle');
    expect(w.emitted('toggle')?.at(-1)).toEqual([false]);
    el.open = true;
    await at(w, 'details-fold').trigger('toggle');
    expect(w.emitted('toggle')?.at(-1)).toEqual([true]);
  });
});
