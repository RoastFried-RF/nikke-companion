// 문구와 표시의 원칙(docs/ui-redesign.md §3·§13) — 데스크톱 앱 창과 오버레이의 화면에 대해:
//   - 화면의 글은 일반 사용자가 읽는 한국어다: 파일·JSON·시뮬·예산·경로 같은 개발 용어를 쓰지 않는다(설정의 「고급」 제외).
//   - 오류는 무슨 일이 있었고 무엇을 하면 되는지를 말한다.
//   - 숨기면 안 되는 표시(추정·미확인 값·속성 상성 미반영·미지원 효과·검증용 데이터·임시 규칙)는 배지로, 접힌 구획 밖에 남아 있다.
//   - 새 화면은 색·크기를 디자인 토큰으로만 적는다.
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { clearImageCache } from '../src/lib/images';
import type { CompareReport, GrowthReport, InterceptReport, NikkeInfo, TierReport } from '../src/types';
import GrowthBoard from '../src/views/GrowthBoard.vue';
import InterceptResult from '../src/views/InterceptResult.vue';
import SquadBoard from '../src/views/SquadBoard.vue';
import SquadPanel from '../src/views/SquadPanel.vue';
import TierBoard from '../src/views/TierBoard.vue';
import compareFixture from './fixtures/compare.sample.json';
import growthFixture from './fixtures/growth.sample.json';
import interceptFixture from './fixtures/intercept.sample.json';
import tierFixture from './fixtures/tier.sample.json';
import { mockImages } from './helpers/fakeImages';

const sources = import.meta.glob<string>(['../src/**/*.{vue,ts,css}'], { query: '?raw', import: 'default', eager: true });

/** 일반 사용자가 읽는 화면의 파일(설정의 고급과, 고급으로 옮긴 예전 화면은 뺀다). */
const PLAIN = Object.keys(sources).filter(
  (file) =>
    file.endsWith('.vue') &&
    (file === '../src/App.vue' ||
      file === '../src/Overlay.vue' ||
      (file.startsWith('../src/pages/') && file !== '../src/pages/AdvancedPage.vue') ||
      file.startsWith('../src/views/') ||
      [
        '../src/screens/AccountScreen.vue',
        '../src/components/AccountFailure.vue',
        '../src/components/TrackPanel.vue',
        '../src/components/GamePanel.vue',
        '../src/components/OverlayStatus.vue',
        '../src/ui/NavIcon.vue',
      ].includes(file)),
);

/** 주석과 속성 이름·코드를 뺀, 화면에 보이는 글자(템플릿의 글과 따옴표 안의 글, 스크립트의 문자열). */
function shownText(source: string): string {
  const template = source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>')).replace(/<!--[\s\S]*?-->/g, '');
  const script = source
    .slice(0, source.indexOf('<template>'))
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/^\s*import /.test(line))
    .join('\n');
  // 스크립트에서는 문자열만 본다(식별자·주석이 아니라 화면에 나가는 글).
  const strings = (script.match(/'[^'\n]*'|`[^`]*`/g) ?? []).join('\n');
  return `${template}\n${strings}`;
}

const JARGON = /JSON|시뮬|예산|파일|경로|schema/;

beforeEach(() => {
  clearMocks();
  clearImageCache();
  localStorage.clear();
  mockImages();
});

describe('문구 — 개발 용어를 쓰지 않는다', () => {
  it('앱 창·오버레이의 화면 파일이 빠짐없이 검사 대상이다', () => {
    expect(PLAIN).toEqual(
      expect.arrayContaining([
        '../src/App.vue',
        '../src/Overlay.vue',
        '../src/pages/HomePage.vue',
        '../src/pages/InterceptPage.vue',
        '../src/pages/RosterPage.vue',
        '../src/pages/ToolsPage.vue',
        '../src/pages/TierPage.vue',
        '../src/pages/SettingsPage.vue',
        '../src/pages/settings/AccountSection.vue',
        '../src/pages/settings/OverlaySection.vue',
        '../src/pages/settings/EngineSection.vue',
        '../src/views/InterceptResult.vue',
        '../src/views/OverlayWidget.vue',
        '../src/views/BossFace.vue',
        '../src/views/SquadPanel.vue',
        '../src/views/SquadBoard.vue',
        '../src/views/GrowthBoard.vue',
        '../src/views/TierBoard.vue',
        // P-030: 덱 빌더의 그림 넷도 같은 규칙을 따른다(「엔진」이라 하지 않고 「계산 도구」라고 한다 등).
        '../src/views/DeckBuilder.vue',
        '../src/views/DeckOpponent.vue',
        '../src/views/DeckRoster.vue',
        '../src/views/DeckBook.vue',
        '../src/screens/AccountScreen.vue',
      ]),
    );
    // 고급(파일 직접 고르기)과 거기로 옮긴 예전 화면은 대상이 아니다 — 거기서는 파일·경로를 말할 수밖에 없다.
    expect(PLAIN).not.toContain('../src/pages/AdvancedPage.vue');
    expect(PLAIN).not.toContain('../src/screens/InterceptScreen.vue');
  });

  it('화면의 글에 파일·JSON·시뮬·예산·경로가 없다(설정의 고급 제외)', () => {
    for (const file of PLAIN) {
      const text = shownText(sources[file]);
      const hit = text.match(JARGON);
      expect(hit ? `${file}: 「${hit[0]}」 — …${text.slice(Math.max(0, (hit.index ?? 0) - 40), (hit.index ?? 0) + 40).replace(/\s+/g, ' ')}…` : '', file).toBe('');
    }
  });

  it('「엔진」은 설정의 계산 도구에서만 말한다 — 다른 화면은 「계산 도구」라고 한다', () => {
    for (const file of PLAIN) {
      if (file === '../src/pages/settings/EngineSection.vue') continue;
      const template = sources[file].slice(sources[file].indexOf('<template>'), sources[file].lastIndexOf('</template>')).replace(/<!--[\s\S]*?-->/g, '');
      // 속성 이름(engine.…)과 testid는 글이 아니다 — 한글 낱말만 본다.
      expect(template, file).not.toMatch(/엔진|스크립트/);
    }
  });

  it('오류는 무슨 일이 있었는지와 무엇을 하면 되는지를 함께 말한다', () => {
    const intercept = sources['../src/pages/InterceptPage.vue'];
    expect(intercept).toContain('<strong>추천 편성을 찾지 못했다.</strong> {{ error }} 다시 계산을 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.');
    const tools = sources['../src/pages/ToolsPage.vue'];
    expect(tools).toContain('<strong>편성을 추천하지 못했다.</strong> {{ error }} 다시 눌러 보고, 계속 실패하면 설정의 계산 도구에서 문제를 확인한다.');
    const tier = sources['../src/pages/TierPage.vue'];
    expect(tier).toContain('<strong>마지막으로 불러온 티어표를 열지 못했다.</strong> {{ error }} 설정의 고급에서 티어표를 다시 불러온다.');
    // 빈 상태는 한마디 + 무엇을 하면 되는지 한 줄 + 단추 하나다.
    // (P-028: 오버레이는 작은 위젯이 됐다 — 빈 상태 부품 대신 한 줄 알림을 쓴다. 아래에서 따로 본다.)
    for (const file of ['../src/pages/InterceptPage.vue', '../src/pages/RosterPage.vue', '../src/pages/ToolsPage.vue', '../src/pages/TierPage.vue']) {
      const states = sources[file].match(/<EmptyState[\s\S]*?\/>/g) ?? [];
      expect(states.length, file).toBeGreaterThan(0);
      for (const state of states) {
        expect(state, file).toMatch(/title=/);
        expect(state, file).toMatch(/hint=/);
        expect(state, file).toMatch(/action=/);
      }
    }
    // 오버레이 위젯의 한 줄 알림도 같다: 무슨 일인지와 무엇을 하면 되는지를 한 줄에 말하고, 단추는 「앱 열기」 하나다.
    const widget = sources['../src/views/OverlayWidget.vue'];
    for (const line of ['연결된 계정이 없다 — 앱에서 계정을 연결한다', '아직 요격전 추천이 없다 — 앱에서 계산한다', '추천이 아직 없다 — 앱에서 계산한다']) expect(widget).toContain(line);
    const notice = widget.slice(widget.indexOf('<div v-if="kind !== \'result\'" class="notice"'), widget.indexOf('<!-- ── 접힘(알약)'));
    expect(notice.match(/<button/g)).toHaveLength(2);
    expect(notice).toContain('data-testid="open-app"');
    expect(notice).toContain('data-testid="widget-hide"');
  });
});

describe('숨기면 안 되는 표시는 배지로, 접힌 구획 밖에 있다', () => {
  const info = (name: string): NikkeInfo => ({ name, known: false, element: null, burst: null, weapon: null, corp: null, klass: null, rarity: null });
  const outsideFold = (el: Element | undefined) => el !== undefined && el.closest('details') === null;
  const intercept = interceptFixture as unknown as InterceptReport;

  it('요격전 결과: 추정 · 실전 미대조, 검증용 데이터·보스 정보, 미확인 값 N칸, 속성 상성 미반영', async () => {
    localStorage.setItem('nikke-companion.intercept.boss', 'test-e');
    const w = mount(InterceptResult, { props: { report: intercept } });
    const pill = (testid: string) => w.find(`[data-testid="${testid}"]`);
    expect(pill('estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(pill('data-kind').text()).toBe('검증용 데이터');
    expect(pill('bundle-kind').text()).toBe('검증용 보스 정보');
    expect(pill('boss-flag').text()).toBe('속성 상성 미반영');
    // 약점은 계산 입력이 아니라서 세지 않는다(CLI 표와 같다).
    const boss = intercept.bosses.find((b) => b.id === 'test-e')!;
    const counted = boss.unconfirmed.filter((u) => u.field !== 'weak_to').length;
    expect(pill('boss-unconfirmed').text()).toBe(`미확인 값 ${counted}칸`);
    for (const id of ['estimate-pill', 'data-kind', 'bundle-kind', 'boss-flag', 'boss-unconfirmed']) expect(outsideFold(pill(id).element), id).toBe(true);
    // 큰 총딜 숫자 옆에도 「추정」이 붙어 있다.
    expect(w.find('[data-role="estimate"]').text()).toBe('추정');
    expect(outsideFold(w.find('[data-role="estimate"]').element)).toBe(true);
    // 접어 둔 「계산 조건」에는 미확인 칸·가정·주의가 빠짐없이 들어 있다(접혀 있어도 내용은 있다).
    const fold = w.find('[data-testid="calc-conditions"]');
    expect(fold.element.tagName).toBe('DETAILS');
    expect((fold.element as HTMLDetailsElement).open).toBe(false);
    expect(fold.findAll('[data-testid="unconfirmed-item"]').map((li) => li.text())).toEqual(boss.unconfirmed.filter((u) => u.field !== 'weak_to').map((u) => `${u.label}: ${u.text}`));
    expect(fold.findAll('[data-testid="assumption-item"]').map((li) => li.text())).toEqual([...boss.assumptions, ...intercept.assumptions]);
    expect(fold.findAll('[data-testid="caveat-item"]').map((li) => li.text())).toEqual([...boss.caveats, ...intercept.caveats]);
    expect(fold.findAll('[data-testid="boss-note"]').map((li) => li.text())).toEqual(boss.notes);
    const notes = boss.ranking.flatMap((e) => e.notes.map((n) => `${e.rank}위 편성: ${n}`));
    expect(fold.findAll('[data-testid="squad-note"]').map((li) => li.text())).toEqual(notes);
  });

  it('실제 계정의 결과에는 검증용 표시가 없고, 밝히지 않은 결과는 「데이터 구분 미확인」이다 — 추정 표시는 언제나 있다', () => {
    const real = structuredClone(intercept);
    real.account.is_test_data = false;
    real.bundle.is_test_data = false;
    const w = mount(InterceptResult, { props: { report: real } });
    expect(w.find('[data-testid="data-kind"]').exists()).toBe(false);
    expect(w.find('[data-testid="bundle-kind"]').exists()).toBe(false);
    expect(w.find('[data-testid="estimate-pill"]').exists()).toBe(true);

    const unsaid = structuredClone(intercept);
    delete unsaid.account.is_test_data;
    expect(mount(InterceptResult, { props: { report: unsaid } }).find('[data-testid="data-kind"]').text()).toBe('데이터 구분 미확인');
  });

  it('편성 추천·비교 결과: 추정, 검증용 데이터, 계산하지 못한 편성 N개', () => {
    const report = structuredClone(compareFixture) as unknown as CompareReport;
    const w = mount(SquadBoard, { props: { report } });
    const pill = (testid: string) => w.find(`[data-testid="${testid}"]`);
    expect(pill('estimate-pill').text()).toBe('추정 · 실전 미대조');
    expect(pill('data-kind').text()).toBe('검증용 데이터');
    const dropped = report.rejected.length + report.failed.length;
    expect(dropped).toBeGreaterThan(0);
    expect(pill('dropped-pill').text()).toBe(`계산하지 못한 편성 ${dropped}개`);
    for (const id of ['estimate-pill', 'data-kind', 'dropped-pill']) expect(outsideFold(pill(id).element), id).toBe(true);
    expect(w.findAll('[data-testid="caveat-item"]').map((li) => li.text())).toEqual(report.caveats);
    expect(w.findAll('[data-testid="rejected-item"]')).toHaveLength(report.rejected.length);
  });

  it('성장 비교 결과: 추정, 검증용 데이터 — 총딜이 주는 선택지는 따로 표시한다', () => {
    const report = structuredClone(growthFixture) as unknown as GrowthReport;
    report.ranking[0] = { ...report.ranking[0], gain: -1000, gain_rate: -0.01 };
    const w = mount(GrowthBoard, { props: { report } });
    expect(w.find('[data-testid="estimate-pill"]').text()).toBe('추정 · 실전 미대조');
    expect(w.find('[data-testid="data-kind"]').text()).toBe('검증용 데이터');
    expect(w.find('[data-testid="loss-pill"]').text()).toBe('총딜이 준다');
    expect(outsideFold(w.find('[data-testid="loss-pill"]').element)).toBe(true);
    expect(w.findAll('[data-testid="caveat-item"]').map((li) => li.text())).toEqual(report.caveats);
  });

  it('티어: 임시 규칙(언제나), 예측 평가, 평가 보류, 미지원 효과 있음 — 거르기를 바꿔도 남는다', async () => {
    const report = structuredClone(tierFixture) as unknown as TierReport;
    report.entries[1] = { ...report.entries[1], unsupported: true, flags: ['미지원 효과 있음'] };
    const w = mount(TierBoard, { props: { report } });
    const pill = (testid: string) => w.find(`[data-testid="${testid}"]`);
    expect(pill('tier-provisional').text()).toBe('임시 규칙');
    expect(pill('estimate-pill').text()).toBe('예측 평가 · 실전 미대조');
    expect(pill('hold-pill').text()).toBe('평가 보류 2명');
    expect(pill('unsupported-pill').text()).toBe('미지원 효과 있음 1명');
    expect(pill('entry-flag').text()).toBe('미지원 효과 있음');
    for (const id of ['tier-provisional', 'estimate-pill', 'hold-pill', 'unsupported-pill', 'entry-flag']) expect(outsideFold(pill(id).element), id).toBe(true);
    expect(w.find('[data-testid="tier-provisional-note"]').text()).toContain('임시다');
    // 평가 보류는 사유와 함께 따로 묶인다(등급이 없는 것이지 0점이 아니다).
    expect(w.findAll('[data-testid="hold-entry"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="hold-reason"]').every((r) => r.text().length > 0)).toBe(true);
    // 거르기를 바꿔도 표시는 남는다.
    const options = w.findAll('[data-testid="burst-option"]');
    await options[options.length - 1].trigger('click');
    for (const id of ['tier-provisional', 'estimate-pill', 'hold-pill', 'unsupported-pill']) expect(pill(id).exists(), id).toBe(true);
    // 임시가 아니라고 밝힌 규칙에서만 임시 표시를 내린다.
    const settled = structuredClone(report);
    settled.rules.provisional = false;
    expect(mount(TierBoard, { props: { report: settled } }).find('[data-testid="tier-provisional"]').exists()).toBe(false);
  });

  it('미육성으로 계산한 니케는 편성 옆에 그대로 알린다(접지 않는다)', () => {
    const ranking = structuredClone((compareFixture as unknown as CompareReport).ranking);
    ranking[0].ungrown_members = ['나가'];
    const w = mount(SquadPanel, { props: { ranking, info } });
    expect(w.find('[data-testid="squad-ungrown"]').text()).toContain('키우지 않은 것으로 계산한 니케: 나가');
  });
});

describe('새 화면은 색·크기를 디자인 토큰으로만 적는다', () => {
  /** 토큰만 쓰는 파일: 앱 창의 틀, 화면(고급 제외), 결과 그림, 함께 쓰는 모양. */
  const TOKEN_ONLY = Object.keys(sources).filter(
    (file) =>
      file === '../src/App.vue' ||
      file === '../src/styles/app.css' ||
      (file.startsWith('../src/pages/') && file.endsWith('.vue') && file !== '../src/pages/AdvancedPage.vue') ||
      file.startsWith('../src/views/'),
  );

  it('16진수 색·rgb()·px 값이 없고, 쓰는 토큰은 모두 정의돼 있다', () => {
    expect(TOKEN_ONLY.length).toBeGreaterThan(12);
    const defined = new Set((sources['../src/styles/tokens.css'].match(/--nk-[\w-]+(?=\s*:)/g) ?? []) as string[]);
    for (const file of TOKEN_ONLY) {
      const source = sources[file];
      const style = file.endsWith('.css') ? source : (source.match(/<style[^>]*>([\s\S]*?)<\/style>/g) ?? []).join('\n');
      const css = style.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, file).not.toMatch(/\brgba?\(/);
      expect(css, file).not.toMatch(/\d+px\b/);
      for (const used of css.match(/var\((--nk-[\w-]+)/g) ?? []) expect(defined.has(used.slice(4)), `${file}: ${used.slice(4)}`).toBe(true);
    }
  });
});
