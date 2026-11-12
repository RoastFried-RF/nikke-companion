// 팝업의 접착 코드: 단추·입력 칸·상태 줄을 lib/link.js에 잇는다. 규칙은 lib/에 있다.
//
// 이 확장은 백그라운드에서 돌지 않는다(서비스 워커·콘텐츠 스크립트·알람이 없다). 쿠키를 읽는 것은 아래의
// 단추를 눌렀을 때 한 번뿐이고, 읽은 쿠키는 이 PC의 오버레이(127.0.0.1)에 한 번 보낸 뒤 버린다.
// 기억하는 것은 연결 코드 하나다(팝업의 localStorage — 쿠키가 아니다).

import { COOKIE_URL } from './lib/cookie-header.js';
import { CODE_KEY, normalizeCode, SEND_TIMEOUT_MS, sendSession } from './lib/link.js';

const codeInput = document.getElementById('code');
const sendButton = document.getElementById('send');
const statusLine = document.getElementById('status');

function show(state, message) {
  statusLine.dataset.state = state;
  statusLine.textContent = message;
}

function recallCode() {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberCode(code) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
  } catch {
    // 기억하지 못해도 보낼 수는 있다.
  }
}

codeInput.value = recallCode();

codeInput.addEventListener('change', () => {
  const code = normalizeCode(codeInput.value);
  if (code) {
    codeInput.value = code;
    rememberCode(code);
  }
});

sendButton.addEventListener('click', async () => {
  sendButton.disabled = true;
  show('sending', '오버레이로 보내는 중…');
  const result = await sendSession({
    code: codeInput.value,
    // api.blablalink.com으로 가는 요청에 실릴 쿠키만 묻는다 — 다른 사이트의 쿠키는 읽지 않는다(권한도 없다).
    getCookies: () => chrome.cookies.getAll({ url: COOKIE_URL }),
    post: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }),
  });
  if (result.state !== 'no_code') rememberCode(normalizeCode(codeInput.value));
  show(result.state, result.message);
  sendButton.disabled = false;
});
