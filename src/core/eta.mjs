// 남은 시간 어림: 진행 건수와 경과 시간 → 남은 시간과 화면에 보일 한마디.
// 순수 함수다(시계를 읽지 않는다 — 경과 시간은 부르는 쪽이 넘긴다). 웹뷰와 Node가 함께 쓴다.
//
// 어림은 「지금까지의 평균 속도가 끝까지 간다」는 가정 하나뿐이다. 계산 한 건의 길이는 편성마다 다르고
// 여러 건이 한꺼번에 끝나기도 해서(엔진 프로세스 넷이 나란히 돈다) 처음 몇 건으로는 속도를 알 수 없다 —
// 그동안에는 숫자를 내지 않고 「계산 중」만 말한다.

/** 이만큼 끝나기 전에는 남은 시간을 말하지 않는다. */
export const ETA_MIN_DONE = 3;
/** 이보다 적게 남았으면 숫자 대신 「곧 끝남」. */
export const ETA_SOON_MS = 5000;

export const ETA_TEXT_WARMING = '계산 중';
export const ETA_TEXT_SOON = '곧 끝남';
export const ETA_TEXT_DONE = '끝남';

const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * 남은 시간을 사람이 읽는 말로. 어림이라 자잘한 단위는 버린다:
 * 5초 미만 「곧 끝남」 · 1분 미만 5초 단위(올림) · 10분 미만 「약 N분 M0초」(30초 단위) · 1시간 미만 분 단위 · 그 위는 시간과 분.
 * 수가 아니거나 음수면 「계산 중」.
 */
export function formatRemaining(ms) {
  if (!isCount(ms)) return ETA_TEXT_WARMING;
  if (ms < ETA_SOON_MS) return ETA_TEXT_SOON;
  const seconds = ms / 1000;
  if (seconds < 60) {
    const s = Math.ceil(seconds / 5) * 5;
    return s >= 60 ? '약 1분 남음' : `약 ${s}초 남음`;
  }
  if (seconds < 600) {
    const half = Math.round(seconds / 30); // 30초 단위
    const minutes = Math.floor(half / 2);
    return half % 2 === 1 ? `약 ${minutes}분 30초 남음` : `약 ${minutes}분 남음`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `약 ${minutes}분 남음`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `약 ${hours}시간 남음` : `약 ${hours}시간 ${rest}분 남음`;
}

/**
 * 진행 건수와 경과 시간으로 남은 시간을 어림한다.
 *
 * - `warming`: 아직 어림할 수 없다 — 끝난 건수가 `minDone`(기본 3) 미만이거나, 전체 건수·경과 시간을 모른다. `text`는 「계산 중」.
 * - `estimating`: 평균 속도로 어림했다. `remaining_ms`는 `경과 ÷ 끝난 건수 × 남은 건수`.
 * - `done`: 전부 끝났다. `remaining_ms`는 0.
 *
 * 값을 지어내지 않는다: 어림할 수 없으면 `remaining_ms`는 null이다(0이 아니다).
 *
 * @param {{done: number, total: number, elapsedMs: number}} progress
 * @param {{minDone?: number}} [options]
 * @returns {{state: 'warming'|'estimating'|'done', remaining_ms: number|null, text: string}}
 */
export function estimateRemaining(progress, options = {}) {
  const warming = { state: 'warming', remaining_ms: null, text: ETA_TEXT_WARMING };
  const { done, total, elapsedMs } = progress ?? {};
  const minDone = Number.isInteger(options.minDone) && options.minDone >= 1 ? options.minDone : ETA_MIN_DONE;
  if (!isCount(done) || !isCount(total) || total <= 0) return warming;
  if (done >= total) return { state: 'done', remaining_ms: 0, text: ETA_TEXT_DONE };
  if (done < minDone || !isCount(elapsedMs) || elapsedMs <= 0) return warming;
  const remaining = (elapsedMs / done) * (total - done);
  return { state: 'estimating', remaining_ms: remaining, text: formatRemaining(remaining) };
}
