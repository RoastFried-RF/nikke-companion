// 버스트 흐름(P-032)의 화면: 덱 빌더와 요격전 상세의 「버스트 흐름」 구획 — 한 줄 요약, 시간축 위의 풀 버스트 띠, 니케별 버스트 표시,
// 두 편성을 위아래로 견주기(자리 순서를 바꾼 편성·한 명을 바꾼 편성·요격전 1위와 2위), 버스트가 돌지 않는 편성의 빨간 표시와 한 문장,
// 계산 도구가 흐름을 주지 않았을 때(그리지 않는다).
// 규칙 자체는 루트의 단위 테스트(tests/unit/burst.test.mjs)가, 실제 엔진으로는 tests/integration/burst.engine.test.mjs가 본다.
// Rust 쪽(backend)은 가짜다: 버스트 보기의 글은 실제 엔진의 출력 모양을 그대로 흉내 낸 것이다. 계정은 검증용 샘플뿐이다.
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import largeAccount from '../../data/samples/account.large.sample.json';
import App from '../src/App.vue';
import * as backend from '../src/lib/backend';
import { clearNikkeCatalog } from '../src/lib/nikkeInfo';
import { simCache } from '../src/lib/runtime';
import type { BurstLine, EngineRequest, EngineViewRow, InterceptReport, NikkeInfo } from '../src/types';
import BurstTimeline from '../src/views/BurstTimeline.vue';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog, FAKE_EVALUATOR, fakeRow, sampleAccount } from './helpers/fakeEngine';
import { FakeDisk, installShell, openPage } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
  loadReport: vi.fn(),
  engineCatalog: vi.fn(),
  engineVersion: vi.fn(),
  engineRunBatch: vi.fn(),
  engineRunViews: vi.fn(),
  engineCancel: vi.fn(),
  readJsonFile: vi.fn(),
  pickJsonFile: vi.fn(),
  onEngineProgress: vi.fn(),
  setScreenTracking: vi.fn(),
  screenTrackStatus: vi.fn(),
  onScreenTrack: vi.fn(),
  accountSyncStatus: vi.fn(),
  extensionLinkStatus: vi.fn(),
  onExtensionLink: vi.fn(),
  captureGame: vi.fn(),
}));

const api = vi.mocked(backend);
let disk = new FakeDisk();
type Wrapper = ReturnType<typeof mount>;
const at = (w: Wrapper, testid: string) => w.find(`[data-testid="${testid}"]`);
const all = (w: Wrapper, testid: string) => w.findAll(`[data-testid="${testid}"]`);
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 샘플 계정의 편성(1·2·3·3·3단계). */
const DECK = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '헬름', '앨리스'];
const stageOf = (name: string) => String(catalog.nikkes[name]?.burst_stage);

const row = (t: number, what: string) => `  t=${t.toFixed(3).padStart(7)}s  ${what}`;
const head = (squad: string[]) => [`스쿼드: ${squad.join(', ')}  (기대값 모드 — 크리·코어히트 무작위 없음, 결정론적)`, '기본 스펙(1층) 그대로 — 컨트롤 자동 · 공통 장비 옵션.', '', '[버스트 사이클]'];

/**
 * 가짜 계산 도구의 버스트 보기: 편성의 자리 순서에서 정해진다. 1·2단계는 그 단계의 첫 니케가, 3단계는 그 단계 니케들이 번갈아 쓴다.
 * 20초마다 아홉 번(3초·23초·…·163초), 풀 버스트는 10초. 실제 엔진의 줄 모양 그대로다.
 */
function burstText(squad: string[], every = 20): string {
  const of = (stage: string) => squad.filter((n) => stageOf(n) === stage);
  const [b1] = of('1');
  const [b2] = of('2');
  const b3 = of('3');
  const lines = head(squad);
  for (let i = 0; 3 + every * i + 0.583 < 180; i += 1) {
    const t = 3 + every * i;
    if (!b1) break;
    lines.push(row(t, `stage:1 사용  ${b1}`));
    if (!b2) break;
    lines.push(row(t + 0.1, `stage:2 사용  ${b2}`));
    if (!b3.length) break;
    lines.push(row(t + 0.2, `stage:3 사용  ${b3[i % b3.length]}`), row(t + 0.583, 'full_burst 시작'));
    if (t + 10.583 <= 180) lines.push(row(t + 10.583, 'full_burst 종료'));
  }
  return `${lines.join('\n')}\n`;
}

const mounted: Wrapper[] = [];
async function render(): Promise<Wrapper> {
  const wrapper = mount(App);
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

async function idle(w: Wrapper): Promise<void> {
  await flushPromises();
  await vi.waitFor(
    () => {
      if (at(w, 'nav-busy').exists()) throw new Error('아직 계산 중이다');
    },
    { timeout: 10000 },
  );
  await flushPromises();
}

async function openDeck(w: Wrapper): Promise<void> {
  await openPage(w, 'tools');
  await at(w, 'tool-deck').trigger('click');
  await flushPromises();
}
const pickButton = (w: Wrapper, name: string) => all(w, 'deck-pick').find((b) => b.attributes('data-name') === name)!;
async function fill(w: Wrapper, names: string[]): Promise<void> {
  for (const name of names) await pickButton(w, name).trigger('click');
  await idle(w);
}
async function show(w: Wrapper): Promise<void> {
  await at(w, 'burst-run').trigger('click');
  await idle(w);
}
const viewCalls = () => api.engineRunViews.mock.calls as unknown as [EngineRequest[], string][];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  simCache.clear();
  clearNikkeCatalog();
  disk = installShell(api);
  api.engineCatalog.mockResolvedValue(catalog);
  api.engineVersion.mockResolvedValue(FAKE_EVALUATOR);
  api.engineRunBatch.mockImplementation(async (requests) => requests.map((r) => fakeRow(r)));
  api.engineRunViews.mockImplementation(async (requests) => requests.map((r): EngineViewRow => ({ text: burstText(r.squad as string[]) })));
  api.engineCancel.mockResolvedValue(false);
  api.onEngineProgress.mockResolvedValue(() => {});
  api.readJsonFile.mockRejectedValue('없다');
  api.pickJsonFile.mockResolvedValue(null);
  api.loadReport.mockRejectedValue('결과가 없다');
  api.onScreenTrack.mockResolvedValue(() => {});
  api.screenTrackStatus.mockResolvedValue({ enabled: false, interval_ms: 2000, state: 'off', message: '', recognition: null, read_at: null, capture_ms: null, failures: 0 });
  api.accountSyncStatus.mockImplementation(async (name) => ({ name: name ?? 'me', cookie_saved: false, cookie_saved_at: null, profile_fetched_at: null, account_file: null, login_window_open: false, problems: [] }));
  api.extensionLinkStatus.mockResolvedValue({ enabled: false, listening: false, address: '127.0.0.1:47615', code: 'ABCD-2345', problem: null, pending: false, last: null, locked_seconds: 0 });
  api.onExtensionLink.mockResolvedValue(() => {});
});

// ── 덱 빌더 ───────────────────────────────────────────────────────────────────

describe('덱 빌더의 버스트 흐름', () => {
  it('다섯 자리가 차야 볼 수 있다 — 덜 찼으면 단추가 막히고 까닭을 말한다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    expect(at(w, 'burst-panel').exists()).toBe(true);
    expect(at(w, 'burst-run').text()).toBe('버스트 흐름 보기');
    expect(at(w, 'burst-run').attributes('disabled')).toBeDefined();
    await fill(w, DECK.slice(0, 4));
    expect(at(w, 'burst-run').attributes('disabled')).toBeDefined();
    expect(at(w, 'burst-hint').text()).toBe('다섯 자리를 모두 채우면 버스트 흐름을 볼 수 있다(지금 4명)');
    await fill(w, DECK.slice(4));
    expect(at(w, 'burst-run').attributes('disabled')).toBeUndefined();
    expect(at(w, 'burst-hint').text()).toContain('버스트 순환을 시간축 위에 그린다');
    expect(api.engineRunViews).not.toHaveBeenCalled();
  });

  it('누르면 한 줄 요약이 위에, 시간축에 풀 버스트 띠가, 니케마다 초상화 줄에 버스트 표시가 보인다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await show(w);

    // 계산 도구에는 버스트 보기를 청한다 — 그 편성, 자리 순서 그대로.
    expect(viewCalls()).toHaveLength(1);
    expect(viewCalls()[0][1]).toBe('burst');
    expect(viewCalls()[0][0].map((r) => r.squad)).toEqual([DECK]);
    // 총딜 계산은 돌리지 않았다.
    expect(api.engineRunBatch).not.toHaveBeenCalled();

    const lines = all(w, 'burst-line');
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.attributes('data-status')).toBe('ok');
    expect(line.find('[data-testid="burst-name"]').text()).toBe('지금 편성');
    expect(line.find('[data-testid="burst-headline"]').text()).toBe('3분 동안 풀 버스트 9번, 평균 20초마다');
    expect(line.find('[data-testid="burst-pill"]').exists()).toBe(false);
    expect(line.find('[data-testid="burst-problem"]').exists()).toBe(false);
    expect(clean(line.find('[data-testid="burst-stats"]').text())).toBe('첫 풀 버스트 3.6초 · 풀 버스트가 열려 있던 시간 90초');

    // 시간축: 0부터 전투가 끝나는 3분까지 30초마다.
    expect(all(w, 'burst-tick').map((t) => t.text())).toEqual(['0', '30초', '1분', '90초', '2분', '150초', '3분']);
    // 풀 버스트 띠: 아홉 개, 자리와 길이가 시각에서 나온다(3.583초 ÷ 180초 = 1.991%).
    const bands = all(w, 'burst-band');
    expect(bands).toHaveLength(9);
    expect(bands[0].attributes('data-start')).toBe('3.583');
    expect(bands[0].attributes('data-end')).toBe('13.583');
    expect(bands[0].attributes('style')).toContain('left: 1.991%');
    expect(bands[0].attributes('style')).toContain('width: calc(7.546% - 1.991%)');
    expect(bands[0].attributes('title')).toBe('1번째 풀 버스트 — 3.6초부터 13.6초까지');
    expect(bands.every((b) => b.attributes('data-late') === 'no')).toBe(true);

    // 니케 줄: 자리 순서대로 다섯, 초상화 타일이 있고, 버스트를 쓴 때마다 표시가 있다.
    const members = all(w, 'burst-member');
    expect(members.map((m) => m.attributes('data-name'))).toEqual(DECK);
    expect(members.map((m) => m.attributes('data-count'))).toEqual(['9', '9', '3', '3', '3']);
    expect(all(w, 'burst-who').every((who) => who.find('[data-testid="nikke-tile"]').exists())).toBe(true);
    const marks = members[2].findAll('[data-testid="burst-mark"]');
    expect(marks.map((m) => m.attributes('data-t'))).toEqual(['3.2', '63.2', '123.2']);
    expect(marks[0].attributes('data-stage')).toBe('3');
    expect(marks[0].attributes('style')).toContain('left: 1.778%');
    expect(marks[0].attributes('title')).toBe('3.2초 — 3단계 버스트');

    // 단계별로 누가 썼는지.
    expect(all(w, 'burst-stage').map((s) => clean(s.text()))).toEqual(['1단계 리틀 머메이드 9번', '2단계 크라운 9번', '3단계 라피 : 레드 후드 3번 · 헬름 3번 · 앨리스 3번']);

    // 「추정 · 실전 미대조」는 접힌 구획 밖에 있다. 조건과 지원하지 않는 것은 접어 둔다.
    expect(at(w, 'burst-estimate').text()).toBe('추정 · 실전 미대조');
    expect(at(w, 'burst-conditions').find('[data-testid="burst-estimate"]').exists()).toBe(false);
    const caveats = all(w, 'burst-caveat').map((c) => c.text());
    expect(caveats.some((c) => c.includes('지원하지 않음'))).toBe(true);
    expect(caveats.some((c) => c.includes('실제 전투와 대조하지 않았다'))).toBe(true);
    expect(at(w, 'burst-run').text()).toBe('다시 보기');
  });

  it('편성을 바꾸면 바꾸기 전의 그림은 보이지 않는다 — 다시 누르면 지금 편성으로 읽는다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await show(w);
    expect(all(w, 'burst-line')).toHaveLength(1);

    // 3·4번 자리를 맞바꾼다.
    await all(w, 'slot-right')[2].trigger('click');
    await flushPromises();
    expect(all(w, 'burst-line')).toHaveLength(0);
    expect(at(w, 'burst-hint').text()).toContain('편성이나 상대가 바뀌었다');
    await show(w);
    const swapped = [DECK[0], DECK[1], DECK[3], DECK[2], DECK[4]];
    expect(viewCalls()[1][0].map((r) => r.squad)).toEqual([swapped]);
    expect(all(w, 'burst-member').map((m) => m.attributes('data-name'))).toEqual(swapped);
    // 3단계를 먼저 쓰는 니케가 자리 순서를 따라 바뀌었다.
    expect(all(w, 'burst-member')[2].find('[data-testid="burst-mark"]').attributes('data-t')).toBe('3.2');
  });

  it('자리 순서를 바꾼 편성과 견준다: 지금 편성과 가장 좋은 자리 순서의 타임라인이 위아래로 놓인다', async () => {
    disk.addAccount('me', sampleAccount);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await at(w, 'order-run').trigger('click');
    await idle(w);
    expect(at(w, 'order-panel').attributes('data-changed')).toBe('yes');
    const best = all(w, 'order-member').map((m) => m.attributes('data-name')) as string[];
    expect(best).not.toEqual(DECK);

    expect(at(w, 'order-burst').text()).toBe('버스트 흐름 견주기');
    await at(w, 'order-burst').trigger('click');
    await idle(w);
    expect(viewCalls()).toHaveLength(1);
    expect(viewCalls()[0][0].map((r) => r.squad)).toEqual([DECK, best]);
    const lines = all(w, 'burst-line');
    expect(lines.map((l) => l.find('[data-testid="burst-name"]').text())).toEqual(['지금 편성', '가장 좋은 자리 순서']);
    expect(lines.map((l) => l.findAll('[data-testid="burst-member"]').map((m) => m.attributes('data-name')))).toEqual([DECK, best]);
    expect(lines.every((l) => l.find('[data-testid="burst-chart"]').exists())).toBe(true);
    expect(at(w, 'burst-compare').text()).toBe('지금 편성 → 가장 좋은 자리 순서: 풀 버스트 횟수는 같다(9번), 평균 주기도 같다(20초).');
    expect(at(w, 'burst-lead').text()).toBe('두 편성을 위아래로 견준다: 지금 편성 · 가장 좋은 자리 순서');
  });

  it('한 명을 바꾼 편성과 견준다: 바꿔 본 줄의 「버스트 흐름 견주기」', async () => {
    // 보유 니케가 많은 시험 계정(같은 단계의 다른 니케가 있다).
    disk.addAccount('me', largeAccount);
    // 가짜 계산 도구: 니케를 바꾼 편성은 25초마다 돈다.
    api.engineRunViews.mockImplementation(async (requests) =>
      requests.map((r): EngineViewRow => ({ text: burstText(r.squad as string[], (r.squad as string[]).join() === DECK.join() ? 20 : 25) })),
    );
    const others = Object.keys(largeAccount.nikkes).filter((n) => !DECK.includes(n) && stageOf(n) === '1');
    expect(others.length).toBeGreaterThan(0);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await all(w, 'deck-slot')[0].find('[data-testid="slot-swap"]').trigger('click');
    await idle(w);
    const first = all(w, 'swap-row')[0];
    const name = first.attributes('data-name')!;
    await first.find('[data-testid="swap-burst"]').trigger('click');
    await idle(w);

    const swapped = [name, ...DECK.slice(1)];
    expect(viewCalls()[0][0].map((r) => r.squad)).toEqual([DECK, swapped]);
    const lines = all(w, 'burst-line');
    expect(lines.map((l) => l.find('[data-testid="burst-name"]').text())).toEqual(['지금 편성', `${name}(으)로 바꾼 편성`]);
    expect(lines.map((l) => l.find('[data-testid="burst-headline"]').text())).toEqual(['3분 동안 풀 버스트 9번, 평균 20초마다', '3분 동안 풀 버스트 8번, 평균 25초마다']);
    expect(at(w, 'burst-compare').text()).toContain('풀 버스트 9번 → 8번, 평균 주기 20초 → 25초');
    // 자리의 편성은 그대로다(견주기만 했다).
    expect(all(w, 'deck-slot').map((s) => s.attributes('data-name'))).toEqual(DECK);
  });

  it('버스트가 돌지 않는 편성: 단계가 빠지면 빨간 배지와 한 문장 — 띠는 없고 쓴 버스트만 보인다', async () => {
    disk.addAccount('me', sampleAccount);
    // 실제 엔진이 낸 모양: 2단계가 없으면 1단계 한 번뿐이다.
    api.engineRunViews.mockImplementation(async (requests) => requests.map((r): EngineViewRow => ({ text: `${[...head(r.squad as string[]), row(3, `stage:1 사용  ${(r.squad as string[])[0]}`)].join('\n')}\n` })));
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await show(w);
    const line = at(w, 'burst-line');
    expect(line.attributes('data-status')).toBe('none');
    const pill = line.find('[data-testid="burst-pill"]');
    expect(pill.text()).toBe('풀 버스트 없음');
    expect(pill.attributes('data-tone')).toBe('error');
    expect(pill.classes()).toContain('pill--solid');
    const problem = line.find('[data-testid="burst-problem"]');
    expect(problem.text()).toBe('2단계 버스트를 쓴 니케가 없어 풀 버스트가 한 번도 열리지 않았다(1단계까지만 이어졌다).');
    expect(problem.attributes('role')).toBe('alert');
    expect(problem.classes()).toContain('nk-error');
    expect(line.find('[data-testid="burst-headline"]').text()).toBe('3분 동안 풀 버스트가 한 번도 열리지 않았다');
    expect(all(w, 'burst-band')).toHaveLength(0);
    expect(all(w, 'burst-mark')).toHaveLength(1);
    expect(all(w, 'burst-idle')).toHaveLength(4);
    expect(all(w, 'burst-stage').map((s) => [clean(s.text()), s.attributes('data-empty')])).toEqual([
      ['1단계 리틀 머메이드 1번', 'no'],
      ['2단계 쓴 니케 없음', 'yes'],
      ['3단계 쓴 니케 없음', 'yes'],
    ]);
    // 표시는 접힌 구획 안에 있지 않다.
    expect(at(w, 'burst-conditions').find('[data-testid="burst-pill"]').exists()).toBe(false);
  });

  it('버스트가 돌지 않는 편성: 쿨타임이 맞지 않아 다음 버스트가 늦으면 빨간 배지와 한 문장 — 늦게 열린 띠는 빨갛다', async () => {
    disk.addAccount('me', sampleAccount);
    const [b1, b2, b3] = DECK;
    const text = [
      ...head(DECK),
      row(3, `stage:1 사용  ${b1}`),
      row(3.1, `stage:2 사용  ${b2}`),
      row(3.2, `stage:3 사용  ${b3}`),
      row(3.583, 'full_burst 시작'),
      row(13.583, 'full_burst 종료'),
      row(15.583, `stage:1 사용  ${b1}`),
      row(15.683, `stage:2 사용  ${b2}`),
      row(30.267, `stage:3 사용  ${b3}`),
      row(30.65, 'full_burst 시작'),
      row(40.65, 'full_burst 종료'),
    ].join('\n');
    api.engineRunViews.mockResolvedValue([{ text }]);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await show(w);
    const line = at(w, 'burst-line');
    expect(line.attributes('data-status')).toBe('stalled');
    expect(line.find('[data-testid="burst-pill"]').text()).toBe('버스트가 늦다');
    expect(line.find('[data-testid="burst-pill"]').attributes('data-tone')).toBe('error');
    expect(line.find('[data-testid="burst-problem"]').text()).toBe(
      '풀 버스트 2번 가운데 1번은 다음 버스트가 1초 넘게 늦었다 — 가장 길게는 3단계를 14.6초 기다렸다. 버스트 쿨타임이 맞지 않는 것으로 보인다.',
    );
    expect(all(w, 'burst-band').map((b) => b.attributes('data-late'))).toEqual(['no', 'yes']);
    expect(all(w, 'burst-band')[1].attributes('title')).toBe('2번째 풀 버스트 — 30.7초부터 40.7초까지 (다음 버스트를 14.6초 기다렸다)');
  });

  it('계산 도구가 버스트 흐름을 주지 않으면 그리지 않는다 — 그 사실을 적는다', async () => {
    disk.addAccount('me', sampleAccount);
    // 버스트 줄이 없는 글(다른 모양의 출력).
    api.engineRunViews.mockResolvedValueOnce([{ text: '스쿼드: …\n\n[다른 보기]\n  t=  3.000s  무엇\n' }]);
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await show(w);
    const line = at(w, 'burst-line');
    expect(line.attributes('data-status')).toBe('failed');
    expect(line.find('[data-testid="burst-chart"]').exists()).toBe(false);
    expect(line.find('[data-testid="burst-headline"]').exists()).toBe(false);
    expect(all(w, 'burst-band')).toHaveLength(0);
    expect(line.find('[data-testid="burst-pill"]').text()).toBe('읽지 못함');
    expect(clean(line.find('[data-testid="burst-unread"]').text())).toContain('이 편성의 버스트 흐름은 읽지 못했다 — 어림해 그리지 않는다.');
    expect(line.find('[data-testid="burst-unread"]').text()).toContain('엔진이 이 정보를 주지 않았다');

    // 계산 도구가 그 편성을 돌리지 못했을 때도 같다(그 말을 그대로 싣는다).
    api.engineRunViews.mockResolvedValueOnce([{ error: { type: 'invalid_input', message: '가짜 계산 도구 오류' } }]);
    await show(w);
    expect(at(w, 'burst-line').attributes('data-status')).toBe('failed');
    expect(at(w, 'burst-unread').text()).toContain('가짜 계산 도구 오류');

    // 버스트 보기 자체가 실패하면 오류 문장이 보이고 앞의 그림은 그대로다.
    api.engineRunViews.mockRejectedValueOnce('엔진을 실행할 수 없다 (python): 없다');
    await show(w);
    expect(clean(at(w, 'burst-error').text())).toContain('버스트 흐름을 읽지 못했다. 실행 오류 — 엔진을 실행할 수 없다 (python): 없다');
  });

  it('읽는 동안에는 진행이 보이고 덱 빌더의 계산 단추가 막힌다 — 중단할 수 있다', async () => {
    disk.addAccount('me', sampleAccount);
    let release: (rows: EngineViewRow[]) => void = () => {};
    api.engineRunViews.mockImplementation(() => new Promise<EngineViewRow[]>((resolve) => (release = resolve)));
    const w = await render();
    await openDeck(w);
    await fill(w, DECK);
    await at(w, 'burst-run').trigger('click');
    await vi.waitFor(() => expect(api.engineRunViews).toHaveBeenCalled());
    await flushPromises();
    expect(at(w, 'nav-busy').exists()).toBe(true);
    expect(at(w, 'burst-panel').text()).toContain('버스트 흐름을 읽는 중');
    expect(at(w, 'deck-run').attributes('disabled')).toBeDefined();
    expect(at(w, 'order-run').attributes('disabled')).toBeDefined();
    expect(at(w, 'burst-run').attributes('disabled')).toBeDefined();
    release([{ text: burstText(DECK) }]);
    await idle(w);
    expect(all(w, 'burst-line')).toHaveLength(1);
    expect(at(w, 'deck-run').attributes('disabled')).toBeUndefined();
  });
});

// ── 요격전 상세 ───────────────────────────────────────────────────────────────

describe('요격전 상세의 버스트 흐름', () => {
  it('고른 보스의 1위 편성과 2위 편성을 그 보스의 전투 조건으로 읽어 위아래로 놓는다', async () => {
    disk.addAccount('me', sampleAccount);
    const report = structuredClone(interceptFixture) as unknown as InterceptReport;
    disk.putIntercept(report);
    const w = await render();
    await openPage(w, 'intercept');
    const id = at(w, 'boss-detail').attributes('data-boss');
    const boss = report.bosses.find((b) => b.id === id)!;
    const top = [...boss.ranking].sort((a, b) => a.rank - b.rank).slice(0, 2).map((e) => e.members.map((m) => m.name));
    expect(top.length).toBe(2);

    expect(at(w, 'burst-panel').exists()).toBe(true);
    expect(at(w, 'burst-lead').text()).toBe('두 편성을 위아래로 견준다: 1위 편성 · 2위 편성');
    await show(w);
    expect(viewCalls()).toHaveLength(1);
    const [requests, view] = viewCalls()[0];
    expect(view).toBe('burst');
    expect(requests.map((r) => r.squad)).toEqual(top);
    // 추천을 계산한 그 보스의 조건이다(적 설정이 그대로 실린다).
    for (const r of requests) expect(r.enemy).toEqual(boss.condition?.enemy);
    expect((requests[0].sim as { duration: number }).duration).toBe(boss.duration);

    const lines = all(w, 'burst-line');
    expect(lines.map((l) => l.find('[data-testid="burst-name"]').text())).toEqual(['1위 편성', '2위 편성']);
    expect(lines.map((l) => l.findAll('[data-testid="burst-member"]').map((m) => m.attributes('data-name')))).toEqual(top);
    expect(at(w, 'burst-compare').text()).toContain('1위 편성 → 2위 편성:');
    // 추천 결과는 그대로다(다시 계산하지 않았다).
    expect(api.engineRunBatch).not.toHaveBeenCalled();
  });
});

// ── 그림 부품 ─────────────────────────────────────────────────────────────────

describe('타임라인 그림', () => {
  const info = (): NikkeInfo => ({ element: null, burst: null }) as unknown as NikkeInfo;

  it('계산 전 검사에 걸린 편성은 그림 없이 까닭을 적는다', () => {
    const line: BurstLine = { name: '네 명', members: DECK.slice(0, 4), status: 'rejected', reasons: ['편성은 5명이어야 한다 (지금 4명)'] };
    const w = mount(BurstTimeline, { props: { line, duration: 180, info } });
    expect(w.attributes('data-status')).toBe('rejected');
    expect(w.find('[data-testid="burst-chart"]').exists()).toBe(false);
    expect(clean(w.find('[data-testid="burst-unread"]').text())).toBe('이 편성의 버스트 흐름은 읽지 못했다 — 어림해 그리지 않는다. 편성은 5명이어야 한다 (지금 4명)');
  });

  it('짧은 전투는 10초마다 눈금을 긋고, 끝까지 열려 있던 풀 버스트는 전투가 끝나는 곳까지 그린다', () => {
    const use = (t: number, stage: string, name: string) => ({ t, stage, name, reenter: false });
    const users = [use(3, '1', DECK[0]), use(3.1, '2', DECK[1]), use(3.2, '3', DECK[2])];
    const line: BurstLine = {
      name: '지금 편성',
      members: DECK,
      status: 'read',
      unread: [],
      flow: {
        duration: 20,
        count: 1,
        first_at: 15,
        first_use_at: 3,
        average_period: null,
        uptime_seconds: 5,
        uptime_ratio: 0.25,
        full_bursts: [{ index: 1, start: 15, end: null, open: true, users, chain_start: 3, wait: 0.1, waited_for: null }],
        uses: users,
        by_stage: { 1: [{ name: DECK[0], count: 1 }], 2: [{ name: DECK[1], count: 1 }], 3: [{ name: DECK[2], count: 1 }] },
        by_member: DECK.map((name) => ({ name, count: users.filter((u) => u.name === name).length, stages: [], uses: users.filter((u) => u.name === name).map((u) => ({ t: u.t, stage: u.stage, reenter: name === DECK[0] })) })),
        pending: [],
        tail_wait: 0,
        stalls: [],
        status: 'ok',
        headline: '20초 동안 풀 버스트 1번',
        problem: null,
      },
    };
    const w = mount(BurstTimeline, { props: { line, duration: 20, info } });
    expect(w.findAll('[data-testid="burst-tick"]').map((t) => t.text())).toEqual(['0', '10초', '20초']);
    const band = w.find('[data-testid="burst-band"]');
    expect(band.attributes('style')).toContain('left: 75.000%');
    expect(band.attributes('style')).toContain('width: calc(100.000% - 75.000%)');
    expect(band.attributes('title')).toBe('1번째 풀 버스트 — 15초부터 전투가 끝날 때까지');
    // 재진입으로 쓴 버스트는 다른 모양으로 그리고 풍선 도움말에 적는다.
    const mark = w.find('[data-testid="burst-mark"]');
    expect(mark.classes()).toContain('burst__mark--again');
    expect(mark.attributes('title')).toBe('3초 — 1단계 버스트(재진입)');
  });
});
