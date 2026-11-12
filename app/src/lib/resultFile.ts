// 결과 파일(요격전 추천·성장 비교·티어) 불러오기: 경로 → Rust의 read_json_file → 그 화면의 종류·판 검사.
// 읽지 못하거나 다른 종류·다른 판이면 한국어 문장으로 던진다 — 화면은 오류만 보이고 앞서 보이던 결과를 그대로 둔다.

import { reactive, ref } from 'vue';
import { readJsonFile } from './backend';
import { recall, remember } from './remember';

export function useResultFile<T>(options: {
  /** 마지막으로 불러온 경로를 기억하는 이름. */
  key: string;
  /** 「… 파일 경로를 넣어야 한다」에 들어가는 이름. */
  label: string;
  /** 문서가 이 화면의 결과인지 검사한다(lib/reports.ts). 아니면 던진다. */
  check: (doc: unknown, path: string) => T;
  /** 기억해 둔 경로가 없을 때 처음 보일 경로(개발 실행의 샘플). */
  initial?: string;
}) {
  const path = ref(recall(options.key) || options.initial || '');
  const loading = ref(false);
  /** 늦게 끝난 이전 요청이 나중 요청의 결과를 덮지 않게 한다. */
  let seq = 0;

  /**
   * 경로의 파일을 읽어 검사한 결과. 실패하면 화면에 보일 문장으로 던진다.
   * 그 사이에 더 나중의 요청이 시작됐으면(또는 `abandon`) 결과도 오류도 버리고 null을 돌려준다.
   */
  async function load(): Promise<T | null> {
    const target = path.value.trim();
    if (!target) throw new Error(`${options.label} 파일 경로를 넣어야 한다.`);
    const mine = ++seq;
    loading.value = true;
    try {
      const doc = await readJsonFile(target);
      if (mine !== seq) return null;
      const checked = options.check(doc, target);
      remember(options.key, target);
      return checked;
    } catch (e) {
      if (mine !== seq) return null;
      throw e;
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  /** 읽는 중인 요청을 버린다(계산을 시작할 때 — 늦게 끝난 읽기가 계산 결과를 덮지 않게). */
  function abandon(): void {
    seq += 1;
    loading.value = false;
  }

  return reactive({ path, loading, load, abandon });
}

export type ResultFile<T> = ReturnType<typeof useResultFile<T>>;
