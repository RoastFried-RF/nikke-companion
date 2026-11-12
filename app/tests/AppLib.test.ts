// 데스크톱 앱 창의 화면들이 기대는 작은 규칙들: 정밀도(빠르게·보통·꼼꼼히), 탐색(메뉴·계산 중 표시), 내 니케 목록, 두 창이 함께 보는 자리.
// Rust 쪽(backend)은 가짜다.
import { DEFAULT_BUDGET } from '@core/candidates.mjs';
import { DEFAULT_INTERCEPT_BUDGET } from '@core/intercept.mjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as backend from '../src/lib/backend';
import { ANOMALY_BUNDLE, DEFAULT_CONDITION } from '../src/lib/builtin';
import { ADVANCED_TABS, createNav, pageOfRun, PAGES, RUN_INTERCEPT, RUN_SUGGEST } from '../src/lib/nav';
import { INTERCEPT_PRECISION, precisionOf, recallPrecision, rememberPrecision, roughTime, SUGGEST_PRECISION } from '../src/lib/precision';
import { breakthroughLabel, filterRoster, NO_FILTER, overloadLabel, overloadLines, rosterRows, skillsLabel } from '../src/lib/roster';
import { createShared } from '../src/lib/shared';
import type { AccountDoc, InterceptReport } from '../src/types';
import anomalyFile from '../../data/intercept/anomaly.json';
import conditionFile from '../../data/samples/condition.solo-raid.json';
import interceptFixture from './fixtures/intercept.sample.json';
import { catalog, sampleAccount } from './helpers/fakeEngine';
import { FakeDisk, installShell } from './helpers/shell';

vi.mock('../src/lib/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/backend')>()),
  ...(await import('./helpers/shell')).shellMocks(),
}));

const api = vi.mocked(backend);
const sample = interceptFixture as unknown as InterceptReport;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe('정밀도 — 계산 횟수의 일반 사용자용 이름', () => {
  it('셋 중 하나를 고른다: 빠르게 · 보통 · 꼼꼼히. 꼼꼼히가 계산 코드의 기본값이다', () => {
    for (const list of [INTERCEPT_PRECISION, SUGGEST_PRECISION]) {
      expect(list.map((c) => c.label)).toEqual(['빠르게', '보통', '꼼꼼히']);
      expect(list.map((c) => c.key)).toEqual(['fast', 'normal', 'thorough']);
      // 뒤로 갈수록 더 많이 계산한다.
      expect(list[0].budget).toBeLessThan(list[1].budget);
      expect(list[1].budget).toBeLessThan(list[2].budget);
    }
    expect(INTERCEPT_PRECISION[2].budget).toBe(DEFAULT_INTERCEPT_BUDGET);
    expect(SUGGEST_PRECISION[2].budget).toBe(DEFAULT_BUDGET);
    // 요격전은 보스가 다섯이다 — 가장 빠른 것도 보스마다 몇 건씩은 돌아간다.
    expect(INTERCEPT_PRECISION[0].budget / ANOMALY_BUNDLE.bosses.length).toBeGreaterThanOrEqual(10);
  });

  it('대략 걸리는 시간을 「약 N분」으로 말한다 — 1분이 안 되면 「1분 안쪽」', () => {
    expect(roughTime(40)).toBe('1분 안쪽');
    expect(roughTime(60)).toBe('약 1분');
    expect(roughTime(150)).toBe('약 3분');
    expect(roughTime(300)).toBe('약 6분');
    for (const choice of [...INTERCEPT_PRECISION, ...SUGGEST_PRECISION]) {
      expect(choice.time).toBe(roughTime(choice.budget));
      // 숫자만이 아니라 무엇이 다른지도 한 줄 있다. 개발 용어는 없다.
      expect(choice.hint.length).toBeGreaterThan(5);
      expect(`${choice.label}${choice.time}${choice.hint}`).not.toMatch(/시뮬|예산|건/);
    }
  });

  it('고른 것을 기억한다. 없거나 모르는 값이면 「보통」이다', () => {
    expect(recallPrecision('x.precision')).toBe('normal');
    rememberPrecision('x.precision', 'fast');
    expect(recallPrecision('x.precision')).toBe('fast');
    localStorage.setItem('nikke-companion.x.precision', '아주 빠르게');
    expect(recallPrecision('x.precision')).toBe('normal');
    expect(precisionOf(INTERCEPT_PRECISION, 'thorough').budget).toBe(300);
    expect(precisionOf(INTERCEPT_PRECISION, '모름').key).toBe('normal');
  });
});

describe('내장한 입력 — 화면이 파일 경로를 묻지 않게', () => {
  it('보스 묶음은 저장소의 실제 묶음(게임 화면에서 확인한 값) 그대로다 — 복제하지 않았다', () => {
    expect(ANOMALY_BUNDLE).toBe(anomalyFile);
    expect(ANOMALY_BUNDLE.bosses.map((b) => b.name)).toEqual(['인디빌리아', '울트라', '하베스터', '크라켄', '미러 컨테이너']);
    expect((anomalyFile as { is_test_data: boolean }).is_test_data).toBe(false);
  });

  it('편성 도구의 전투 조건은 계산 도구가 아는 보스 프리셋이다', () => {
    expect({ ...DEFAULT_CONDITION }).toEqual(conditionFile);
    expect(catalog.bosses).toContain(DEFAULT_CONDITION.boss);
  });
});

describe('탐색', () => {
  it('메뉴의 화면은 여섯이고 이름이 짧다', () => {
    expect(PAGES.map((p) => p.key)).toEqual(['home', 'intercept', 'roster', 'tools', 'tier', 'settings']);
    for (const p of PAGES) expect(p.label.length).toBeLessThanOrEqual(5);
  });

  it('계산을 돌리는 화면의 이름으로 메뉴의 어느 화면인지 안다 — 고급의 화면들은 설정 아래다', () => {
    expect(pageOfRun(RUN_INTERCEPT)).toBe('intercept');
    expect(pageOfRun(RUN_SUGGEST)).toBe('tools');
    for (const tab of ADVANCED_TABS) expect(pageOfRun(tab.key)).toBe('settings');
    expect(pageOfRun(null)).toBeNull();
    expect(pageOfRun('모르는 계산')).toBeNull();
    // 요격전 화면과 고급의 요격전은 이름이 다르다(서로 다른 화면이다).
    expect(RUN_INTERCEPT).not.toBe('intercept');
  });

  it('옮긴 곳을 기억하고, 기억해 둔 곳에서 시작한다', () => {
    const nav = createNav();
    expect([nav.page.value, nav.section.value, nav.advanced.value, nav.tool.value]).toEqual(['home', 'account', 'compare', 'suggest']);
    nav.openAdvanced('tier');
    nav.openTool('growth');
    expect(nav.page.value).toBe('tools');
    const again = createNav();
    expect([again.page.value, again.section.value, again.advanced.value, again.tool.value]).toEqual(['tools', 'advanced', 'tier', 'growth']);
    again.openSettings('overlay');
    expect(createNav().section.value).toBe('overlay');
    // 모르는 이름은 버린다.
    localStorage.setItem('nikke-companion.page', '없는 화면');
    localStorage.setItem('nikke-companion.settings.section', '없는 구획');
    expect([createNav().page.value, createNav().section.value]).toEqual(['home', 'account']);
  });
});

describe('내 니케 목록', () => {
  const account = sampleAccount as unknown as AccountDoc;

  it('오버로드 줄 수: 손으로 적은 계정은 옵션 → 줄 수, 가져온 계정은 옵션 → 줄별 레벨 목록이다', () => {
    expect(overloadLines({ 공격력: 3, '우월 코드 대미지': 2 })).toBe(5);
    expect(overloadLines({ 공격력: [11, 15], '차지 속도': [], '최대 장탄 수': [3] })).toBe(3);
    expect(overloadLines({})).toBe(0);
    expect(overloadLines(undefined)).toBeNull();
  });

  it('계정에 적힌 값을 그대로 읽는다 — 적지 않았거나 미확인인 칸은 null이다', () => {
    const rows = rosterRows(account, catalog);
    expect(rows).toHaveLength(Object.keys(account.nikkes).length);
    const helm = rows.find((r) => r.name === '헬름')!;
    expect([helm.breakthrough, helm.core, helm.skills, helm.overloadLines]).toEqual([3, 3, [7, 7, 10], 4]);
    expect([breakthroughLabel(helm), skillsLabel(helm), overloadLabel(helm)]).toEqual(['3돌 +3', '7/7/10', '4줄']);
    expect(helm.info.element).toBe(catalog.nikkes.헬름.element_code);
    const mihara = rows.find((r) => r.name === '미하라')!;
    expect([mihara.core, mihara.overloadLines]).toEqual([null, null]);
    expect(mihara.unknown).toEqual(['오버로드', '코어 강화']);
    expect(mihara.grown).toBe(true);
    const naga = rows.find((r) => r.name === '나가')!;
    expect([naga.breakthrough, naga.skills, naga.overloadLines, naga.grown]).toEqual([null, null, null, false]);
    expect([breakthroughLabel(naga), skillsLabel(naga), overloadLabel(naga)]).toEqual(['미확인', '미확인', '미확인']);
    // 많이 키운 순이다.
    expect(rows.map((r) => r.score)).toEqual([...rows.map((r) => r.score)].sort((a, b) => b - a));
    // 계정을 바꾸지 않는다.
    expect(account).toEqual(sampleAccount);
  });

  it('카탈로그를 아직 읽지 못했으면 속성·버스트 단계는 「모름」이다(지어내지 않는다)', () => {
    const rows = rosterRows(account, null);
    expect(rows.every((r) => r.info.element === null && r.info.burst === null)).toBe(true);
    expect(rosterRows(null, catalog)).toEqual([]);
  });

  it('속성·버스트 단계·육성 여부·이름으로 거른다', () => {
    const rows = rosterRows(account, catalog);
    expect(filterRoster(rows, NO_FILTER)).toEqual(rows);
    const fire = filterRoster(rows, { ...NO_FILTER, element: '작열' });
    expect(fire.length).toBeGreaterThan(0);
    expect(fire.every((r) => r.info.element === '작열')).toBe(true);
    // 모든 단계(A) 니케는 어느 단계를 골라도 남는다.
    const two = filterRoster(rows, { ...NO_FILTER, burst: '2' });
    expect(two.every((r) => r.info.burst === '2' || r.info.burst === 'A')).toBe(true);
    expect(filterRoster(rows, { ...NO_FILTER, grownOnly: true }).map((r) => r.name)).not.toContain('나가');
    expect(filterRoster(rows, { ...NO_FILTER, query: ' 레드후드 ' }).map((r) => r.name)).toEqual(['라피 : 레드 후드']);
  });
});

describe('두 창이 함께 보는 자리', () => {
  let disk: FakeDisk;
  beforeEach(() => {
    disk = installShell(api);
  });

  it('켜질 때 디스크의 상태와 마지막 결과를 읽는다 — 읽은 결과는 「앞서 저장해 둔 것」이다', async () => {
    disk.addAccount('me', sampleAccount);
    disk.putIntercept(sample);
    const { shared, start } = createShared();
    expect(shared.ready.value).toBe(false);
    await start();
    expect(shared.ready.value).toBe(true);
    expect(shared.accountName.value).toBe('me');
    expect(shared.accountSavedAt.value).toBe(disk.accounts.get('me')!.modified_at);
    expect(shared.intercept.value?.bosses).toHaveLength(5);
    expect(shared.restored.value).toBe(true);
    expect(shared.interceptProblem.value).toBe('');
  });

  it('새 결과를 올리면 보이고, 저장하고, 다른 창에 알린다 — 올린 창에서는 「앞서 저장해 둔 것」이 아니다', async () => {
    const app = createShared();
    const overlay = createShared();
    await app.start();
    await overlay.start();
    const reads = api.loadInterceptResult.mock.calls.length;

    await app.shared.publishIntercept(structuredClone(sample));
    await flush();
    expect(app.shared.intercept.value?.kind).toBe('intercept_report');
    expect(app.shared.restored.value).toBe(false);
    expect(api.saveInterceptResult).toHaveBeenCalledTimes(1);
    // 다른 창은 알림을 받고 디스크에서 한 번 다시 읽었다. 올린 창은 다시 읽지 않았다.
    expect(api.loadInterceptResult.mock.calls.length).toBe(reads + 1);
    expect(overlay.shared.intercept.value?.bosses).toHaveLength(5);
    expect(overlay.shared.restored.value).toBe(true);
    expect(app.shared.snapshot.value?.intercept_saved_at).toBe(disk.interceptSavedAt);
  });

  it('요격전 추천 결과가 아닌 것(다른 종류·다른 판)은 한국어로 거부하고 앞서 보이던 것을 둔다 — 저장하지도 않는다', async () => {
    disk.putIntercept(sample);
    const { shared, start } = createShared();
    await start();
    const before = shared.intercept.value;

    await expect(shared.publishIntercept({ ...sample, schema_version: 2 })).rejects.toThrow('schema_version이 맞지 않는다');
    await expect(shared.publishIntercept({ schema_version: 1, kind: 'tier' })).rejects.toThrow('요격전 추천 결과가 아니다');
    await expect(shared.publishIntercept(null)).rejects.toThrow('요격전 추천 결과가 아니다');
    expect(shared.intercept.value).toBe(before);
    expect(api.saveInterceptResult).not.toHaveBeenCalled();
  });

  it('저장하지 못하면 화면에는 보이되 그 사실을 알린다', async () => {
    api.saveInterceptResult.mockRejectedValue('요격전 추천 결과을(를) 저장하지 못했다 (쓸 수 없다)');
    const { shared, start } = createShared();
    await start();
    await shared.publishIntercept(structuredClone(sample));
    expect(shared.intercept.value?.bosses).toHaveLength(5);
    expect(shared.interceptProblem.value).toBe('이 결과를 저장하지 못했다(앱을 다시 켜면 보이지 않는다): 요격전 추천 결과을(를) 저장하지 못했다 (쓸 수 없다)');
  });

  it('기본 계정·오버레이를 띄우는 때를 바꾸면 Rust에 알리고, 못 바꾸면 이유를 남긴다', async () => {
    disk.addAccount('me', sampleAccount);
    disk.addAccount('sub', sampleAccount);
    const { shared, start } = createShared();
    await start();
    expect(shared.accountName.value).toBeNull(); // 둘인데 고르지 않았다
    expect(await shared.setDefaultAccount('sub')).toBe(true);
    expect(shared.accountName.value).toBe('sub');
    expect(await shared.setDefaultAccount('없는 계정')).toBe(false);
    expect(shared.problem.value).toContain("기본 계정을 정하지 못했다: '없는 계정' 계정을 찾을 수 없다");
    expect(shared.accountName.value).toBe('sub');

    expect(await shared.setOverlayLaunch('manual')).toBe(true);
    expect(shared.snapshot.value?.overlay_launch).toBe('manual');
    expect(shared.problem.value).toBe('');
  });

  it('계정은 이름 없이(지금 쓰는 계정) 읽는다 — 화면은 경로를 넘기지 않는다', async () => {
    disk.addAccount('me', sampleAccount);
    const { shared, start } = createShared();
    await start();
    const read = await shared.loadAccount();
    expect(read.name).toBe('me');
    expect(api.readAccount.mock.calls).toEqual([[null]]);
    disk.accounts.clear();
    await expect(shared.loadAccount()).rejects.toBe('연결된 계정이 없다. 설정의 계정 연결에서 계정을 받아라');
  });

  it('내려가면 알림 구독을 끊는다', async () => {
    const { start, dispose } = createShared();
    await start();
    expect(disk.listeners.size).toBe(1);
    dispose();
    expect(disk.listeners.size).toBe(0);
  });
});
