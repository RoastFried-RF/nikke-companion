// 결과 문서의 종류·판 검사(lib/reports.ts): 화면이 그릴 수 없는 파일은 한국어 문장으로 거부한다.
// 입력은 실제 CLI가 만든 샘플 결과 네 개다(tests/fixtures — `npm run fixture`).
import { describe, expect, it } from 'vitest';
import { checkGrowthReport, checkInterceptReport, checkTierReport, ReportFormatError } from '../src/lib/reports';
import compare from './fixtures/compare.sample.json';
import growth from './fixtures/growth.sample.json';
import intercept from './fixtures/intercept.sample.json';
import tier from './fixtures/tier.sample.json';

const CHECKS = {
  intercept_report: { check: checkInterceptReport, sample: intercept as unknown, label: '요격전 추천 결과' },
  growth: { check: checkGrowthReport, sample: growth as unknown, label: '성장 비교 결과' },
  tier: { check: checkTierReport, sample: tier as unknown, label: '티어 결과' },
};
const kinds = Object.keys(CHECKS) as (keyof typeof CHECKS)[];

const message = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(ReportFormatError);
    return (e as Error).message;
  }
  throw new Error('거부하지 않았다');
};
const hasKorean = (s: string) => /[가-힣]/.test(s);

describe('결과 문서 검사', () => {
  it('실제 CLI가 만든 결과는 그 화면의 검사를 지나고, 문서를 바꾸지 않고 그대로 돌려준다', () => {
    for (const kind of kinds) {
      const { check, sample } = CHECKS[kind];
      const before = JSON.stringify(sample);
      expect(check(sample, 'D:\\결과.json')).toBe(sample);
      expect(JSON.stringify(sample)).toBe(before);
    }
  });

  it('다른 종류의 결과 파일은 무엇인지 알려 주며 거부한다', () => {
    for (const kind of kinds) {
      for (const other of kinds.filter((k) => k !== kind)) {
        const text = message(() => CHECKS[kind].check(CHECKS[other].sample, 'D:\\다른.json'));
        expect(text, `${kind} ← ${other}`).toContain(`${CHECKS[kind].label}가 아니다`);
        expect(text).toContain(`${CHECKS[other].label}(kind: ${other})`);
        expect(text).toContain('D:\\다른.json');
        expect(hasKorean(text)).toBe(true);
      }
    }
    expect(message(() => checkTierReport(growth, 'x.json'))).toBe(
      '티어 결과가 아니다 — 이 파일은 성장 비교 결과(kind: growth)다. 이 화면은 `node src/cli.mjs tier build … --json`이 만든 파일만 읽는다: x.json',
    );
  });

  it('편성 비교 결과(kind가 없다)를 넣으면 추천·비교 탭의 파일이라고 알려 준다', () => {
    for (const kind of kinds) {
      const text = message(() => CHECKS[kind].check(compare, 'D:\\compare.json'));
      expect(text).toContain(`${CHECKS[kind].label}가 아니다`);
      expect(text).toContain('편성 비교 결과(추천·비교 탭에서 불러온다)');
    }
  });

  it('모르는 종류와 종류가 없는 파일도 거부한다', () => {
    expect(message(() => checkTierReport({ schema_version: 1, kind: 'engine_data_diff' }, 'x.json'))).toContain('다른 종류의 결과(kind: engine_data_diff)');
    expect(message(() => checkTierReport({ schema_version: 1 }, 'x.json'))).toContain('결과 종류(kind)가 없는 파일');
    // 계정 파일을 잘못 고른 경우.
    expect(message(() => checkInterceptReport({ schema_version: 1, is_test_data: true, nikkes: {} }, 'account.json'))).toContain('요격전 추천 결과가 아니다');
  });

  it('판(schema_version)이 다르면 두 판을 모두 적어 거부한다', () => {
    for (const kind of kinds) {
      const { check, sample } = CHECKS[kind];
      const newer = { ...(sample as object), schema_version: 2 };
      expect(message(() => check(newer, 'D:\\새 판.json'))).toBe('schema_version이 맞지 않는다: 파일은 2, 이 화면이 읽는 판은 1이다: D:\\새 판.json');
      const text = { ...(sample as object), schema_version: '1' };
      expect(message(() => check(text, 'x.json'))).toContain('파일은 "1", 이 화면이 읽는 판은 1이다');
      const missing: Record<string, unknown> = { ...(sample as object) };
      delete missing.schema_version;
      expect(message(() => check(missing, 'x.json'))).toContain('파일은 없음');
    }
  });

  it('객체가 아닌 문서는 거부한다', () => {
    for (const doc of [null, [], 1, '문자열']) {
      expect(message(() => checkTierReport(doc, 'x.json'))).toBe('티어 결과가 아니다(최상위가 JSON 객체가 아니다): x.json');
    }
  });

  it('화면이 그릴 때 기대하는 칸이 없거나 형식이 다르면 그 칸을 알려 거부한다', () => {
    const broken = (sample: unknown, change: (doc: Record<string, unknown>) => void) => {
      const copy = structuredClone(sample) as Record<string, unknown>;
      change(copy);
      return copy;
    };
    expect(message(() => checkTierReport(broken(tier, (d) => void delete d.entries), 'x.json'))).toBe(
      '티어 결과가 아니다(entries 칸이 없거나 형식이 다르다): x.json',
    );
    expect(message(() => checkTierReport(broken(tier, (d) => void (d.rules = { version: 'x' })), 'x.json'))).toContain('rules.tiers 칸');
    expect(message(() => checkTierReport(broken(tier, (d) => void ((d.entries as unknown[])[2] = '헬름')), 'x.json'))).toContain('entries[2] 칸');
    expect(message(() => checkTierReport(broken(tier, (d) => void delete (d.entries as Record<string, unknown>[])[0].status), 'x.json'))).toContain(
      'entries[0].status 칸',
    );
    expect(message(() => checkInterceptReport(broken(intercept, (d) => void (d.bosses = {})), 'x.json'))).toContain('bosses 칸');
    expect(message(() => checkInterceptReport(broken(intercept, (d) => void delete (d.bosses as Record<string, unknown>[])[1].ranking), 'x.json'))).toContain(
      'bosses[1].ranking 칸',
    );
    expect(message(() => checkInterceptReport(broken(intercept, (d) => void delete (d.bosses as Record<string, unknown>[])[0].element), 'x.json'))).toContain(
      'bosses[0].element 칸',
    );
    expect(message(() => checkGrowthReport(broken(growth, (d) => void delete d.baseline), 'x.json'))).toContain('baseline 칸');
    expect(message(() => checkGrowthReport(broken(growth, (d) => void ((d.baseline as Record<string, unknown>).members = null)), 'x.json'))).toContain(
      'baseline.members 칸',
    );
    expect(message(() => checkGrowthReport(broken(growth, (d) => void delete d.caveats), 'x.json'))).toContain('caveats 칸');
  });

  it('경로를 주지 않으면 문장에 경로를 붙이지 않는다', () => {
    expect(message(() => checkGrowthReport(tier))).toMatch(/파일만 읽는다$/);
  });
});
