// 디자인 토큰(src/styles/tokens.css)과 「부품은 토큰만 쓴다」는 규칙의 정적 확인.
import { describe, expect, it } from 'vitest';
import mainSource from '../src/main.ts?raw';
import oldStyle from '../src/style.css?raw';
import tokens from '../src/styles/tokens.css?raw';

/** 공통 부품과 부품 모아 보기의 소스 전부. */
const uiSources = import.meta.glob<string>('../src/ui/**/*.{vue,ts}', { query: '?raw', import: 'default', eager: true });

/** tokens.css의 `:root`에 정의된 토큰: 이름 → 값. */
const defined = new Map<string, string>();
const rootBlock = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}', tokens.indexOf(':root {')));
for (const m of rootBlock.matchAll(/^\s*(--nk-[a-z0-9-]+):\s*([^;]+);/gm)) defined.set(m[1], m[2].trim());

/** '#rrggbb' → 색상(0~360도)·채도·밝기. */
function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

const hexOf = (name: string): string => {
  const value = defined.get(name);
  expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
  return value as string;
};

describe('디자인 토큰', () => {
  it('어두운 테마의 배경·표면·글자·테두리 색이 있다 — 배경은 어둡고 글자는 밝다', () => {
    for (const name of ['--nk-bg', '--nk-surface', '--nk-surface-raised', '--nk-surface-sunken', '--nk-border', '--nk-border-strong']) {
      expect(hsl(hexOf(name)).l, name).toBeLessThan(0.4);
    }
    for (const name of ['--nk-bg', '--nk-surface', '--nk-surface-raised', '--nk-surface-sunken']) expect(hsl(hexOf(name)).l, name).toBeLessThan(0.2);
    expect(hsl(hexOf('--nk-text')).l).toBeGreaterThan(0.85);
    expect(hsl(hexOf('--nk-text-muted')).l).toBeGreaterThan(0.6);
    expect(hsl(hexOf('--nk-text-faint')).l).toBeGreaterThan(0.4);
    // 표면은 배경보다 밝고, 올린 표면은 더 밝다(카드가 바탕에서 떠 보인다).
    expect(hsl(hexOf('--nk-surface')).l).toBeGreaterThan(hsl(hexOf('--nk-bg')).l);
    expect(hsl(hexOf('--nk-surface-raised')).l).toBeGreaterThan(hsl(hexOf('--nk-surface')).l);
    // 정보 영역은 불투명 카드다: 표면 색에 투명도가 없다.
    for (const name of ['--nk-bg', '--nk-surface', '--nk-surface-raised', '--nk-surface-sunken']) expect(defined.get(name), name).not.toMatch(/rgba|transparent/);
  });

  it('강조색은 보라 계열 하나다', () => {
    const accent = hsl(hexOf('--nk-accent'));
    expect(accent.h).toBeGreaterThan(235);
    expect(accent.h).toBeLessThan(290);
    expect(accent.s).toBeGreaterThan(0.5);
    const strong = hsl(hexOf('--nk-accent-strong'));
    expect(Math.abs(strong.h - accent.h)).toBeLessThan(15);
    expect([...defined.keys()].filter((name) => name.startsWith('--nk-accent'))).toEqual(['--nk-accent', '--nk-accent-strong', '--nk-accent-soft']);
  });

  it('속성 색 다섯은 게임의 보스 테마 색과 같은 계열이다: 작열 빨강·철갑 주황·풍압 초록·수냉 파랑·전격 보라', () => {
    const hue = (name: string) => hsl(hexOf(name)).h;
    const fire = hue('--nk-el-fire');
    expect(fire < 15 || fire > 345, `작열 ${fire}`).toBe(true);
    expect(hue('--nk-el-iron')).toBeGreaterThan(20);
    expect(hue('--nk-el-iron')).toBeLessThan(45);
    expect(hue('--nk-el-wind')).toBeGreaterThan(110);
    expect(hue('--nk-el-wind')).toBeLessThan(170);
    expect(hue('--nk-el-water')).toBeGreaterThan(195);
    expect(hue('--nk-el-water')).toBeLessThan(225);
    expect(hue('--nk-el-electric')).toBeGreaterThan(260);
    expect(hue('--nk-el-electric')).toBeLessThan(300);
    // 다섯 색이 서로 다르고 어두운 바탕에서 보일 만큼 밝다. 모르는 속성은 채도가 낮은 회색이다.
    const five = ['--nk-el-fire', '--nk-el-iron', '--nk-el-wind', '--nk-el-water', '--nk-el-electric'];
    expect(new Set(five.map(hexOf)).size).toBe(5);
    for (const name of five) {
      expect(hsl(hexOf(name)).l, name).toBeGreaterThan(0.5);
      expect(hsl(hexOf(name)).s, name).toBeGreaterThan(0.55);
    }
    expect(hsl(hexOf('--nk-el-unknown')).s).toBeLessThan(0.25);
    // 전격(보라)과 강조색(보라)은 구분된다.
    expect(Math.abs(hue('--nk-el-electric') - hsl(hexOf('--nk-accent')).h)).toBeGreaterThan(15);
  });

  it('속성의 낱말(엔진 카탈로그 그대로)이 그 속성의 색을 고른다', () => {
    const pairs: [string, string][] = [
      ['작열', 'fire'],
      ['풍압', 'wind'],
      ['철갑', 'iron'],
      ['전격', 'electric'],
      ['수냉', 'water'],
    ];
    for (const [word, key] of pairs) {
      expect(tokens, word).toMatch(new RegExp(`\\[data-element='${word}'\\] \\{\\s*--nk-el: var\\(--nk-el-${key}\\);\\s*\\}`));
    }
    // 낱말이 없거나 다른 낱말이면 「모름」 색이다.
    expect(defined.get('--nk-el')).toBe('var(--nk-el-unknown)');
    expect(tokens.match(/\[data-element=/g)).toHaveLength(5);
  });

  it('상태 색이 있다: 추정·미확인·오류(와 정상·검증용)', () => {
    for (const name of ['--nk-ok', '--nk-estimate', '--nk-unknown', '--nk-error', '--nk-test', '--nk-neutral']) hexOf(name);
    for (const tone of ['ok', 'estimate', 'unknown', 'error', 'test', 'accent', 'neutral']) {
      expect(tokens, tone).toMatch(new RegExp(`\\[data-tone='${tone}'\\] \\{\\s*--nk-tone: var\\(--nk-`));
    }
    // 추정은 노랑, 미확인은 주황, 오류는 빨강 — 서로 다른 색이다.
    expect(hsl(hexOf('--nk-estimate')).h).toBeGreaterThan(40);
    expect(hsl(hexOf('--nk-estimate')).h).toBeLessThan(60);
    expect(hsl(hexOf('--nk-unknown')).h).toBeGreaterThan(20);
    expect(hsl(hexOf('--nk-unknown')).h).toBeLessThan(40);
    const error = hsl(hexOf('--nk-error')).h;
    expect(error < 15 || error > 345).toBe(true);
    expect(new Set(['--nk-ok', '--nk-estimate', '--nk-unknown', '--nk-error'].map(hexOf)).size).toBe(4);
  });

  it('간격·모서리·글자 크기에 단계가 있다(작은 것부터 커진다)', () => {
    const px = (name: string) => {
      const value = defined.get(name);
      expect(value, name).toMatch(/^\d+px$/);
      return Number.parseInt(value as string, 10);
    };
    const rising = (names: string[]) => {
      const values = names.map(px);
      expect([...values].sort((a, b) => a - b), names.join(' ')).toEqual(values);
      expect(new Set(values).size, names.join(' ')).toBe(values.length);
    };
    rising(['--nk-space-1', '--nk-space-2', '--nk-space-3', '--nk-space-4', '--nk-space-5', '--nk-space-6', '--nk-space-7']);
    rising(['--nk-radius-sm', '--nk-radius-md', '--nk-radius-lg', '--nk-radius-pill']);
    rising(['--nk-font-xs', '--nk-font-sm', '--nk-font-md', '--nk-font-lg', '--nk-font-xl', '--nk-font-hero']);
    rising(['--nk-tile-xs', '--nk-tile-sm', '--nk-tile-lg']);
    // 오버레이 위젯(폭 320px부터)에 작은 타일 다섯이 한 줄로 들어간다.
    expect(px('--nk-tile-sm') * 5 + px('--nk-space-3') * 6).toBeLessThanOrEqual(320);
  });

  it('토큰 파일은 변수만 정한다 — 어떤 요소의 모양도 바꾸지 않는다(기존 화면은 그대로다)', () => {
    const withoutComments = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
    // 선택자는 :root와 data-element·data-tone뿐이고, 선언은 전부 --nk- 변수다.
    const selectors = [...withoutComments.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    for (const selector of selectors) expect(selector).toMatch(/^(:root|\[data-(element|tone)='[^']+'\])$/);
    const declarations = [...withoutComments.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]);
    expect(declarations.length).toBeGreaterThan(60);
    for (const property of declarations) expect(property).toMatch(/^--nk-/);
    // 앱이 시작할 때 불러온다. 예전 변수(style.css)는 그대로 있다.
    expect(mainSource).toContain("import './styles/tokens.css';");
    expect(mainSource).toContain("import './style.css';");
    for (const old of ['--panel:', '--line:', '--text:', '--muted:', '--accent:', '--warn:', '--danger:']) expect(oldStyle, old).toContain(old);
    expect(oldStyle).not.toContain('--nk-');
  });
});

describe('부품은 토큰만 쓴다', () => {
  const files = Object.entries(uiSources);
  const styleOf = (source: string) => [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

  it('부품 파일이 모두 검사 대상이다', () => {
    const names = files.map(([file]) => file.replace('../src/ui/', '')).sort();
    for (const part of [
      'BossCard.vue',
      'BurstBadge.vue',
      'DamageBar.vue',
      'DetailsFold.vue',
      'ElementChip.vue',
      'EmptyState.vue',
      'GameIcon.vue',
      'NikkeTile.vue',
      'ProgressPanel.vue',
      'RankRow.vue',
      'SkeletonBlock.vue',
      'StatusPill.vue',
      'gallery/UiGallery.vue',
    ]) {
      expect(names, part).toContain(part);
    }
  });

  it('색을 직접 적지 않는다 — 16진수·rgb()·hsl()·색 이름이 없다', () => {
    for (const [file, source] of files) {
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklch|color-mix)\(/);
      const style = styleOf(source);
      expect(style, file).not.toMatch(/:\s*(white|black|red|green|blue|gray|grey|orange|yellow|purple|violet|pink|gold|silver)\b/);
      // 색이 들어가는 속성의 값은 토큰(또는 투명·현재 글자색)이다.
      for (const m of style.matchAll(/^\s*(color|background|background-color|border-color|fill|stroke|outline-color)\s*:\s*([^;]+);/gm)) {
        expect(m[2].trim(), `${file} ${m[1]}`).toMatch(/^(var\(--nk-[a-z0-9-]+\)|transparent|currentColor|inherit)$/);
      }
    }
  });

  it('크기도 직접 적지 않는다 — px·rem·em 값이 없다', () => {
    for (const [file, source] of files) {
      const style = styleOf(source);
      expect(style, file).not.toMatch(/\d(px|rem|em|pt)\b/);
    }
  });

  it('쓰는 토큰은 모두 tokens.css에 있다(오타가 없다). 부품 안에서만 쓰는 변수는 그 부품이 정한다', () => {
    let used = 0;
    for (const [file, source] of files) {
      const style = styleOf(source);
      const local = new Set([...style.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
      for (const m of source.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = m[1];
        used += 1;
        if (name.startsWith('--nk-')) expect(defined.has(name), `${file}: ${name}`).toBe(true);
        else expect(local.has(name), `${file}: ${name}는 토큰도 이 부품의 변수도 아니다`).toBe(true);
      }
      // 부품이 토큰을 다시 정하지 않는다.
      for (const name of local) expect(name, file).not.toMatch(/^--nk-/);
      // 예전 변수(style.css)를 쓰지 않는다.
      expect(style, file).not.toMatch(/var\(--(panel|panel-strong|line|text|muted|accent|gold|warn|danger|passthrough)\)/);
    }
    expect(used).toBeGreaterThan(150);
  });

  it('부품의 글자에 개발 용어를 쓰지 않는다(파일·JSON·시뮬·예산)', () => {
    for (const [file, source] of files) {
      if (!file.endsWith('.vue')) continue;
      const template = source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'));
      // 주석을 뺀 템플릿의 글자.
      const text = template.replace(/<!--[\s\S]*?-->/g, '');
      expect(text, file).not.toMatch(/JSON|시뮬|예산|파일|경로|schema/);
    }
  });
});
