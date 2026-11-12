// 날짜 글자(`YYYY-MM-DD`)를 다루는 작은 순수 함수들 — 요격전 기록(plan.mjs)과 모듈 기록장(journal.mjs)이 함께 쓴다.
// 시계를 읽지 않는다(「오늘」은 부르는 쪽이 넘긴다). 계산은 UTC 달력으로만 한다 — 이 PC의 시간대와 무관하게 같은 답이 나온다.

const DAY_MS = 86_400_000;

function parts(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return { y, mo, d, ms: date.getTime(), weekday: date.getUTCDay() };
}

const pad = (n) => String(n).padStart(2, '0');
const format = (ms) => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** `YYYY-MM-DD`이고 달력에 있는 날인가. */
export function isDate(text) {
  return parts(text) !== null;
}

/** 그 날에서 `days`일 뒤(음수면 앞)의 날. 날짜가 아니면 null. */
export function addDays(text, days) {
  const p = parts(text);
  return p ? format(p.ms + days * DAY_MS) : null;
}

/** 그 날이 든 주의 월요일(주는 월요일부터 일요일까지로 묶는다). 날짜가 아니면 null. */
export function weekStart(text) {
  const p = parts(text);
  if (!p) return null;
  // 일요일(0)은 앞 주의 끝이다.
  return format(p.ms - ((p.weekday + 6) % 7) * DAY_MS);
}

/** 그 날이 든 달(`YYYY-MM`). 날짜가 아니면 null. */
export function monthOf(text) {
  const p = parts(text);
  return p ? `${p.y}-${pad(p.mo)}` : null;
}
