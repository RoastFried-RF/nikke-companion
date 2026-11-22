<script setup lang="ts">
// 계정 화면: 터미널에서 손으로 하던 세 단계를 여기서 한다.
//   1 쿠키 받기 — 방법 셋: 크롬 확장(권장 — 이미 로그인된 브라우저에서 단추 한 번. Rust의 수신부가 받는다),
//     붙여넣기, 앱 안의 blablalink 로그인 창(Rust가 그 창의 쿠키를 읽는다)
//   2 계정 새로 받기 — 엔진의 수집 스크립트 실행(Rust). 스크립트가 낸 줄과 경고를 빠짐없이 보인다
//   3 변환·저장 — 루트의 src/core/import-profile.mjs로 계정 상태로 바꿔 계정 파일로 저장, 다른 화면의 계정 칸에 넣는다
// 크롬 확장으로 받으면 2 → 3이 저절로 이어진다(확장의 단추 한 번으로 끝까지).
//
// 세션 쿠키는 계정 접근권이다. 이 화면의 규칙:
//   - 붙여넣은 글자는 Rust에 한 번 넘기고 곧바로 입력 칸에서 지운다. 입력 칸은 가려진 형식이다.
//   - 쿠키를 기억하지 않는다(lib/remember.ts에 넣지 않는다). 화면에 다시 보이지 않는다 — Rust도 돌려주지 않는다.
//   - 크롬 확장·로그인 창으로 받을 때는 쿠키가 이 화면을 지나가지도 않는다(Rust 안에서만 흐른다).
//     화면에 보이는 연결 코드는 쿠키가 아니다(확장에 한 번 넣는 여덟 글자).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AccountFailure from '../components/AccountFailure.vue';
import { useAccountLink } from '../lib/accountLink';
import { useExtensionLink } from '../lib/extensionLink';
import { useUpdates, type AccountWork } from '../lib/updates';
import { importFetchedProfile, type ImportedAccount } from '../lib/accountSync';
import {
  accountFetchCancel,
  accountFetchProfile,
  accountSaveCookie,
  accountSyncStatus,
  copyText,
  errorMessage,
  extensionFolderPath,
  openBrowserLogin,
  openExtensionFolder,
  loginWindowClear,
  loginWindowOpen,
  loginWindowTakeCookie,
  onAccountFetch,
  syncFailure,
} from '../lib/backend';
import { recall, remember } from '../lib/remember';
import { useShared } from '../lib/shared';
import type { CookieSaved, FetchLine, SyncFailure, SyncStatus } from '../types';

/** 마지막으로 받은 계정의 이름을 기억하는 이름. 쿠키는 기억하지 않는다. */
const LAST_NAME = 'account.name';
/** 이름을 주지 않았을 때의 이름(엔진 수집 스크립트의 기본값과 같다). */
const DEFAULT_NAME = 'me';
/** 중단을 눌렀는데 수집이 아직 Rust에 닿기 전이면 다시 청하는 간격(밀리초). */
const STOP_RETRY_MS = 100;
const BROWSER_LOGIN_WAIT_MS = 3 * 60 * 1000;

/** 실패가 난 단계 — 그 단계 아래에 안내를 보인다. */
type Step = 1 | 2 | 3;

const name = ref(recall(LAST_NAME) || DEFAULT_NAME);
const status = ref<SyncStatus | null>(null);
/** 붙여넣기 칸. 저장을 누르면 Rust에 넘기고 곧바로 비운다. 어디에도 기억하지 않는다. */
const pasted = ref('');
const updates = useUpdates();
const busy = updates?.accountWork ?? ref<AccountWork>('');
const blocked = computed(() => updates ? !updates.canStartAccount.value : busy.value !== '');
/** 쿠키 단계에서 한 일을 알리는 줄(저장했다·세션을 지웠다). */
const cookieNote = ref('');
const failure = ref<{ step: Step; detail: SyncFailure } | null>(null);
/** 수집 스크립트가 낸 줄. 도는 동안에는 이벤트로 오는 대로, 끝나면 Rust가 돌려준 전체로 바꾼다. */
const lines = ref<FetchLine[]>([]);
const stopping = ref(false);
/** 마지막 수집이 중단으로 끝났다. */
const stopped = ref(false);
const elapsed = ref(0);
const imported = ref<ImportedAccount | null>(null);

const link = useAccountLink();
/** 두 창이 함께 보는 자리(App.vue가 내려 준다). 받은 계정을 계산에 쓸 계정으로 정한다. */
const shared = useShared();
/** 크롬 확장 연결(App.vue가 내려 준다 — 상태는 Rust가 들고 있다). 화면만 따로 띄우면 null이고 그 칸은 없다. */
const extension = useExtensionLink();
const extensionStatus = computed(() => extension?.status.value ?? null);
const browserLoginBlocked = computed(() => blocked.value || extension?.busy.value);
const browserNote = ref('');
const folderNote = ref('');
let browserTimer: ReturnType<typeof setTimeout> | undefined;
let mounted = true;

function endBrowserWait(): void {
  clearTimeout(browserTimer);
  browserNote.value = '';
}

async function startBrowserLogin(): Promise<void> {
  if (!extension || browserLoginBlocked.value) return;
  endBrowserWait();
  await cookieTask('login', async () => {
    if (!extensionStatus.value?.listening) await extension.setEnabled(true);
    if (!extensionStatus.value?.listening) {
      throw new Error(extension.problem.value || extensionStatus.value?.problem || '크롬 확장 연결을 켜지 못했다. 연결 상태를 확인해 주세요.');
    }
    if (!mounted) return '';
    await openBrowserLogin();
    if (mounted && !extensionStatus.value?.pending) {
      browserNote.value = '기본 브라우저에서 로그인한 뒤 확장의 「오버레이로 보내기」를 누르세요.';
      browserTimer = setTimeout(() => {
        browserNote.value = '아직 받지 못했다. 기본 브라우저에서 열린 프로필에 확장이 설치돼 있고 연결 코드가 들어 있는지 확인해 주세요.';
      }, BROWSER_LOGIN_WAIT_MS);
    }
    return '';
  });
}

async function showFolder(copy: boolean): Promise<void> {
  folderNote.value = '';
  try {
    if (copy) {
      await copyText(await extensionFolderPath());
      folderNote.value = '확장 폴더의 위치를 복사했다.';
    } else {
      await openExtensionFolder();
    }
  } catch (e) {
    folderNote.value = errorMessage(e);
  }
}
/** 크롬 확장 연결의 지금 상태를 한 줄로. */
const extensionState = computed(() => {
  const s = extensionStatus.value;
  if (!s) return '상태를 확인하지 못했다';
  if (!s.enabled) return '꺼짐';
  return s.listening ? `켜짐 · ${s.address}에서 듣는 중` : '켜 두었지만 열지 못했다';
});
const fetching = computed(() => busy.value === 'fetch' || busy.value === 'import');
const warnings = computed(() => lines.value.filter((line) => line.warning));
const account = computed(() => name.value.trim() || DEFAULT_NAME);

let timer: ReturnType<typeof setInterval> | null = null;

function stopTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

/** ISO 시각을 이 PC의 시각 글자로. 읽을 수 없으면 받은 글자 그대로. */
function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR');
}

async function refresh(): Promise<void> {
  try {
    status.value = await accountSyncStatus(account.value);
  } catch (e) {
    // 상태를 못 읽어도 단추는 쓸 수 있다 — 누르면 그 명령이 이유를 알려 준다.
    status.value = null;
    if (!failure.value) failure.value = { step: 1, detail: syncFailure(e) };
  }
}

function savedNote(saved: CookieSaved, how: string): string {
  const at = when(saved.saved_at);
  return `${how} 쿠키 ${saved.count}개를 저장했다${at ? ` (${at})` : ''} — 이제 2단계의 「계정 새로 받기」를 누른다.`;
}

/** 쿠키 단계의 일 하나를 돌린다: 겹쳐 누르지 못하게 하고, 실패는 1단계 아래에 보인다. */
async function cookieTask(kind: AccountWork, work: () => Promise<string>): Promise<void> {
  if (blocked.value) return;
  busy.value = kind;
  cookieNote.value = '';
  failure.value = null;
  try {
    cookieNote.value = await work();
  } catch (e) {
    failure.value = { step: 1, detail: syncFailure(e) };
  } finally {
    busy.value = '';
    await refresh();
  }
}

async function saveCookie(): Promise<void> {
  if (blocked.value) return;
  // 넘길 글자를 꺼내고 입력 칸은 곧바로 비운다 — 저장에 실패해도 화면에 남기지 않는다.
  const text = pasted.value;
  pasted.value = '';
  await cookieTask('cookie', async () => savedNote(await accountSaveCookie(text), '붙여넣은'));
}

async function openLogin(): Promise<void> {
  await cookieTask('login', async () => {
    await loginWindowOpen();
    return '로그인 창을 열었다 — 그 창에서 blablalink에 로그인하고 게임 계정을 연동한 뒤 「쿠키 가져오기」를 누른다.';
  });
}

async function takeCookie(): Promise<void> {
  await cookieTask('take', async () => savedNote(await loginWindowTakeCookie(), '로그인 창에서'));
}

async function clearSession(): Promise<void> {
  await cookieTask('clear', () => loginWindowClear());
}

async function toggleExtension(event: Event): Promise<void> {
  const box = event.target as HTMLInputElement;
  await extension?.setEnabled(box.checked);
  // 스위치는 Rust가 알려 준 상태를 따른다 — 켜지 못했으면 되돌아간다.
  box.checked = extensionStatus.value?.enabled === true;
}

/**
 * 크롬 확장에서 쿠키를 받았으면(Rust의 수신부가 이미 쿠키 파일에 썼다) 「계정 새로 받기」를 이어서 돌린다.
 * 다른 일을 하는 중이면 끝난 뒤에 잇는다(아래 watch가 다시 부른다). 차례는 한 번만 가져간다.
 */
async function continueFromExtension(): Promise<void> {
  if (!extension || !extensionStatus.value?.pending) return;
  endBrowserWait();
  if (blocked.value) return;
  busy.value = 'claim';
  const mine = await extension.claim();
  if (mine) await refresh();
  busy.value = '';
  if (!mine) return;
  failure.value = null;
  cookieNote.value = '크롬 확장에서 쿠키를 받았다 — 계정을 새로 받는다.';
  await fetchAccount();
}

/** 계정 새로 받기: 수집 → 받은 프로필 읽기 → 변환 → 계정 파일 저장 → 다른 화면의 계정 칸에 넣기. */
async function fetchAccount(): Promise<void> {
  if (blocked.value) return;
  const target = account.value;
  busy.value = 'fetch';
  failure.value = null;
  stopping.value = false;
  stopped.value = false;
  lines.value = [];
  imported.value = null;
  elapsed.value = 0;
  const startedAt = Date.now();
  timer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
  }, 1000);

  let unlisten: (() => void) | null = null;
  try {
    try {
      unlisten = await onAccountFetch((line) => lines.value.push(line));
    } catch {
      // 도는 동안의 줄을 받지 못해도 수집은 한다. 끝나면 전체 줄이 온다.
      unlisten = null;
    }
    let fetched;
    try {
      fetched = await accountFetchProfile(target);
    } catch (e) {
      const detail = syncFailure(e);
      // Rust가 그때까지의 줄을 함께 준다 — 이벤트로 받은 것보다 온전하다.
      if (detail.lines.length) lines.value = detail.lines;
      if (detail.kind === 'stopped' || stopping.value) stopped.value = true;
      else failure.value = { step: 2, detail };
      return;
    }
    lines.value = fetched.lines;
    if (stopping.value) {
      // 중단을 누른 뒤에 마침 끝난 수집은 변환·저장으로 잇지 않는다.
      stopped.value = true;
      return;
    }

    busy.value = 'import';
    try {
      const result = await importFetchedProfile(target);
      imported.value = result;
      remember(LAST_NAME, target);
      // 받은 계정을 계산에 쓸 계정으로 정한다 — 요격전·편성 도구·내 니케 화면이 이 계정을 쓴다(계산은 시작하지 않는다).
      // 고급의 계정 칸에도 넣는다(lib/accountLink.ts).
      await shared?.setDefaultAccount(target);
      link?.adopt(result.saved.path);
    } catch (e) {
      failure.value = { step: 3, detail: syncFailure(e) };
    }
  } finally {
    unlisten?.();
    stopTimer();
    busy.value = '';
    stopping.value = false;
    await refresh();
  }
}

/** 도는 수집을 멈춘다. Rust가 스크립트와 그 자식 프로세스를 끝내고 수집 호출이 '중단됨'으로 돌아온다. */
async function stop(): Promise<void> {
  if (busy.value !== 'fetch' || stopping.value) return;
  stopping.value = true;
  // 수집 호출이 Rust에 닿기 직전에 눌렀으면 Rust는 "도는 수집 없음"으로 답한다. 닿을 때까지 다시 청한다.
  while (busy.value === 'fetch') {
    try {
      if (await accountFetchCancel()) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_RETRY_MS));
  }
}

onMounted(refresh);
onBeforeUnmount(() => {
  mounted = false;
  endBrowserWait();
  stopTimer();
});
watch(() => extensionStatus.value?.enabled, enabled => {
  if (enabled === false) endBrowserWait();
});
// 확장에서 쿠키를 받았을 때, 그리고 하던 일이 끝났을 때 본다. 이 화면을 처음 열 때 이미 받아 둔 것이 있어도 잇는다.
watch([() => extensionStatus.value?.pending, blocked], continueFromExtension, { immediate: true });
</script>

<template>
  <div class="screen" data-testid="screen-account">
    <main class="screen__content account">
      <ul v-if="status?.problems.length" class="notes account__problems" data-testid="account-problems">
        <li v-for="problem in status.problems" :key="problem">{{ problem }}</li>
      </ul>

      <!-- 1 ─────────────────────────────────────────────────────────────── -->
      <section class="step" aria-labelledby="step-cookie-title" data-testid="step-cookie">
        <h2 id="step-cookie-title" class="step__title">
          <span class="step__no">1</span> 쿠키 받기
          <span v-if="status" class="badge" :class="status.cookie_saved ? 'badge--accent' : 'badge--warn'" data-testid="cookie-state">
            {{ status.cookie_saved ? `쿠키 저장됨${status.cookie_saved_at ? ` · ${when(status.cookie_saved_at)}` : ''}` : '쿠키 없음' }}
          </span>
        </h2>
        <p class="step__hint">
          계정을 받으려면 blablalink 로그인 세션 쿠키가 있어야 한다. 쿠키는 <strong>계정 접근권</strong>이다 — 이 앱은 이 PC의 한 곳에만
          저장하고, 화면에 다시 보이지 않는다. 받는 방법은 셋이다.
        </p>

        <!-- 방법 1 ───────────────────────────────────────────────────────── -->
        <div class="step__way" data-testid="way-extension">
          <p class="step__way-title">
            방법 1 · 크롬 확장 <span class="badge badge--accent">권장</span>
            <span class="step__sub">이미 로그인된 브라우저에서 단추 한 번 — 비밀번호를 몰라도 된다</span>
          </p>
          <template v-if="extension">
            <button class="panel__button" type="button" :disabled="browserLoginBlocked" data-testid="browser-login" @click="startBrowserLogin">브라우저로 로그인</button>
            <p class="step__hint">기본 브라우저에서 열린 프로필에 확장을 설치하고 연결 코드를 넣어 두세요. 패스키로 로그인한 뒤 확장 아이콘의 「오버레이로 보내기」를 누르면 계정 받기가 시작됩니다. 이미 로그인했다면 바로 누르세요.</p>
            <p v-if="browserNote" class="step__hint" role="status" data-testid="browser-note">{{ browserNote }}</p>
            <div class="panel__row">
              <label class="link__switch">
                <input
                  type="checkbox"
                  :checked="extensionStatus?.enabled === true"
                  :disabled="blocked || extension.busy.value"
                  data-testid="link-toggle"
                  @change="toggleExtension"
                />
                크롬 확장 연결
              </label>
              <span
                class="badge"
                :class="extensionStatus?.listening ? 'badge--accent' : extensionStatus?.enabled ? 'badge--warn' : 'badge--muted'"
                data-testid="link-state"
              >
                {{ extensionState }}
              </span>
            </div>
            <p v-if="extensionStatus?.enabled && extensionStatus.code" class="link__code-row">
              연결 코드 <code class="link__code" data-testid="link-code">{{ extensionStatus.code }}</code>
              <button
                class="step__quiet"
                type="button"
                title="코드를 새로 만든다 — 옛 코드는 곧바로 받지 않는다. 확장에 새 코드를 넣어야 한다"
                :disabled="blocked || extension.busy.value"
                data-testid="link-new-code"
                @click="extension.newCode()"
              >
                코드 다시 만들기
              </button>
            </p>
            <p v-if="extensionStatus?.problem || extension.problem.value" class="screen__error" role="alert" data-testid="link-problem">
              {{ extensionStatus?.problem || extension.problem.value }}
            </p>
            <p v-if="extensionStatus?.last" class="step__hint" role="status" data-testid="link-last" :data-outcome="extensionStatus.last.outcome">
              마지막 요청({{ when(extensionStatus.last.at) }}): {{ extensionStatus.last.message }}
            </p>
            <p class="step__hint">
              켜 두면 이 PC 안에서만 닿는 주소에서 확장의 요청을 기다린다(다른 PC·웹 페이지는 부르지 못한다). 확장의 「오버레이로 보내기」를
              누르면 쿠키 저장부터 2·3단계까지 저절로 이어진다. 연결 코드는 쿠키가 아니다 — 확장에 한 번 넣어 두는 값이다.
            </p>
            <details class="fold" :open="extensionStatus?.enabled !== true" data-testid="link-howto">
              <summary>확장 설치(한 번)</summary>
              <div class="panel__row">
                <button class="panel__button" type="button" data-testid="extension-folder" @click="showFolder(false)">확장 폴더 열기</button>
                <button class="panel__button" type="button" data-testid="extension-copy" @click="showFolder(true)">경로 복사</button>
              </div>
              <p v-if="folderNote" class="step__hint" role="status">{{ folderNote }}</p>
              <ol class="step__list">
                <li>패스키로 로그인하는 크롬에서 <code>chrome://extensions</code>를 연다. 엣지는 <code>edge://extensions</code>를 연다.</li>
                <li>오른쪽 위의 「개발자 모드」를 켠다.</li>
                <li>「압축해제된 확장 프로그램을 로드합니다」를 누르고 위에서 복사한 위치를 붙여 넣는다. 앱을 설치한 폴더(저장소에서 실행하면 저장소) 안의 <code>extension</code> 폴더를 고른다.</li>
                <li>여기서 「크롬 확장 연결」을 켠다 — 연결 코드가 보인다.</li>
                <li>브라우저 도구 모음의 확장 아이콘(니케 컴패니언 연결)을 눌러 「연결 코드」 칸에 그 코드를 넣는다.</li>
                <li>같은 브라우저에서 blablalink.com에 로그인된 상태로 확장의 「오버레이로 보내기」를 누른다 — 이 화면에서 계정 받기가 이어진다.</li>
              </ol>
              <p class="step__hint">앱을 업데이트한 뒤에는 같은 브라우저의 확장 관리에서 「니케 컴패니언 연결」의 새로 고침(↻)을 누른다.</p>
            </details>
            <details class="fold">
              <summary>확장에서 전송을 눌러야 하는 이유</summary>
              <p class="step__hint">확장이 받는 쪽이 니케 컴패니언인지 확인할 수 없어 자동 전달은 보류했다. 앱이 확장에 자신을 증명하는 방식을 사용자가 정하면 별도 작업으로 재개한다.</p>
            </details>
          </template>
        </div>

        <!-- 방법 2 ───────────────────────────────────────────────────────── -->
        <div class="step__way" data-testid="way-paste">
          <p class="step__way-title">방법 2 · 쿠키 붙여넣기 <span class="step__sub">브라우저의 개발자 도구에서 복사</span></p>
          <form class="panel__row" @submit.prevent="saveCookie">
            <input
              v-model="pasted"
              class="panel__text"
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder="Cookie 헤더 값을 붙여넣는다 (가려져 보인다)"
              aria-label="붙여넣을 세션 쿠키"
              :disabled="blocked"
              data-testid="cookie-input"
            />
            <button class="panel__button" type="submit" :disabled="blocked || pasted.trim() === ''" data-testid="cookie-save">
              {{ busy === 'cookie' ? '저장 중…' : '쿠키 저장' }}
            </button>
          </form>
          <details class="fold" data-testid="cookie-howto">
            <summary>쿠키를 복사하는 순서</summary>
            <ol class="step__list">
              <li>브라우저(크롬·엣지)에서 blablalink.com에 로그인하고 게임 계정을 연동한다.</li>
              <li>F12로 개발자 도구를 열어 Network(네트워크) 탭을 고르고 페이지를 새로 고친다.</li>
              <li>목록에서 api.blablalink.com으로 가는 요청을 하나 눌러, 요청 머리글(Request Headers)의 Cookie 값 전체를 복사한다.</li>
              <li>위 칸에 붙여넣고 「쿠키 저장」을 누른다.</li>
            </ol>
          </details>
        </div>

        <!-- 방법 3 ───────────────────────────────────────────────────────── -->
        <div class="step__way" data-testid="way-login">
          <p class="step__way-title">방법 3 · 앱 안의 로그인 창 <span class="step__sub">비밀번호로 로그인하는 사용자용</span></p>
          <div class="panel__row">
            <button class="panel__button" type="button" :disabled="blocked" data-testid="login-open" @click="openLogin">
              blablalink 로그인
            </button>
            <button class="panel__button" type="button" :disabled="blocked" data-testid="login-take" @click="takeCookie">
              {{ busy === 'take' ? '가져오는 중…' : '쿠키 가져오기' }}
            </button>
            <button
              class="step__quiet"
              type="button"
              title="로그인 창의 쿠키·저장 데이터를 지운다 — 다른 계정으로 바꾸거나 공용 PC에서 쓴 뒤에"
              :disabled="blocked"
              data-testid="login-clear"
              @click="clearSession"
            >
              로그인 세션 지우기
            </button>
          </div>
          <p class="step__hint">
            「blablalink 로그인」으로 뜨는 별도 창에서 직접 로그인하고 게임 계정을 연동한 뒤 「쿠키 가져오기」를 누른다. 아이디와 비밀번호는
            그 페이지에 넣는다(앱은 읽지 않는다). 자동 로그인으로 써서 비밀번호를 모르거나 그 창에서 로그인이 막히면(예: 구글 계정) 방법 1·2를
            쓴다.
          </p>
        </div>

        <p v-if="cookieNote" class="step__done" role="status" data-testid="cookie-note">{{ cookieNote }}</p>
        <AccountFailure v-if="failure?.step === 1" :step="1" :detail="failure.detail" />
      </section>

      <!-- 2 ─────────────────────────────────────────────────────────────── -->
      <section class="step" aria-labelledby="step-fetch-title" data-testid="step-fetch">
        <h2 id="step-fetch-title" class="step__title"><span class="step__no">2</span> 계정 새로 받기</h2>
        <div class="panel__row">
          <label class="panel__label" for="account-name">이름</label>
          <input
            id="account-name"
            v-model="name"
            class="panel__text"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="DEFAULT_NAME"
            aria-label="계정 이름"
            :disabled="blocked"
            data-testid="account-name"
            @change="refresh"
            @keydown.enter.prevent="fetchAccount"
          />
          <button class="panel__button" type="button" :disabled="blocked" data-testid="fetch-run" @click="fetchAccount">
            {{ fetching ? '받는 중…' : '계정 새로 받기' }}
          </button>
          <button v-if="busy === 'fetch'" class="step__stop" type="button" :disabled="stopping" data-testid="fetch-stop" @click="stop">
            {{ stopping ? '멈추는 중…' : '중단' }}
          </button>
        </div>
        <p class="step__hint">
          저장된 쿠키로 blablalink에서 내 니케의 육성 상태를 받는다(1~2분 걸릴 수 있다). 큐브는 장착 중인 것만 받는다.
          <template v-if="status?.profile_fetched_at">
            <span data-testid="last-fetch">마지막으로 받은 때: {{ when(status.profile_fetched_at) }}.</span>
          </template>
        </p>

        <p v-if="fetching" class="step__progress" role="status" data-testid="fetch-progress">
          {{ busy === 'import' ? '받은 것을 정리해 저장하는 중…' : `받는 중… ${elapsed}초` }}
        </p>
        <p v-else-if="stopped" class="step__progress" role="status" data-testid="fetch-stopped">
          중단됨 — 계정을 받지 않았다. 앞서 받은 계정은 그대로다.
        </p>
        <AccountFailure v-if="failure?.step === 2" :step="2" :detail="failure.detail" />

        <template v-if="lines.length">
          <div v-if="warnings.length" class="step__box" data-testid="fetch-warnings">
            <p class="step__box-title">받는 중에 나온 경고 {{ warnings.length }}건</p>
            <ul class="notes">
              <li v-for="(line, i) in warnings" :key="i" data-testid="fetch-warning">{{ line.text.trim() }}</li>
            </ul>
          </div>
          <div class="step__box" data-testid="fetch-log">
            <p class="step__box-title">받는 과정 {{ lines.length }}줄 <span class="step__sub">쿠키 값은 가려져 있다</span></p>
            <ul class="step__log">
              <li v-for="(line, i) in lines" :key="i" :class="{ 'step__log-warn': line.warning }" data-testid="fetch-line">{{ line.text }}</li>
            </ul>
          </div>
        </template>
      </section>

      <!-- 3 ─────────────────────────────────────────────────────────────── -->
      <section class="step" aria-labelledby="step-import-title" data-testid="step-import">
        <h2 id="step-import-title" class="step__title"><span class="step__no">3</span> 변환·저장</h2>
        <template v-if="imported">
          <p class="step__done" data-testid="import-summary">
            가져온 니케 <strong>{{ imported.report.summary.imported }}명</strong>
            (받은 항목 {{ imported.report.summary.roster }}개) · 건너뛴 항목 {{ imported.report.summary.skipped }}개 · 미확인 칸이 있는 니케
            {{ imported.report.summary.with_unknown }}명 · 동기화 레벨 {{ imported.synchroLevel ?? '미확인' }}
            <span class="badge" :class="imported.report.account.is_test_data ? 'badge--test' : 'badge--real'" data-testid="import-kind">
              {{ imported.report.account.is_test_data ? '검증용 데이터' : '실제 계정 데이터' }}
            </span>
          </p>
          <p class="step__path" data-testid="import-path">
            저장한 곳: <code>{{ imported.saved.path }}</code>
            <template v-if="imported.saved.backup">
              <br />앞서 받은 것은 <code data-testid="import-backup">{{ imported.saved.backup }}</code>에 한 벌 남겼다.
            </template>
          </p>
          <p class="step__hint" data-testid="import-adopted">
            이 계정을 계산에 쓸 계정으로 정했다 — 요격전과 편성 도구가 이 계정으로 계산하고, 내 니케에 보인다.
          </p>

          <div v-if="imported.report.skipped.length" class="step__box" data-testid="import-skipped">
            <p class="step__box-title">건너뛴 항목</p>
            <ul class="bullets">
              <li v-for="item in imported.report.skipped" :key="item.name">{{ item.name }}: {{ item.reason }}</li>
            </ul>
          </div>
          <div v-if="imported.report.unknown.length" class="step__box" data-testid="import-unknown">
            <p class="step__box-title">미확인 칸이 있는 니케</p>
            <ul class="bullets">
              <li v-for="item in imported.report.unknown" :key="item.nikke">{{ item.nikke }}: {{ item.fields.join(', ') }}</li>
            </ul>
          </div>
          <div v-if="imported.report.warnings.length" class="step__box" data-testid="import-warnings">
            <p class="step__box-title">변환 알림</p>
            <ul class="notes">
              <li v-for="(warning, i) in imported.report.warnings" :key="i">{{ warning }}</li>
            </ul>
          </div>
          <div class="step__box" data-testid="import-caveats">
            <p class="step__box-title">주의</p>
            <ul class="bullets">
              <li v-for="(caveat, i) in imported.report.caveats" :key="i">{{ caveat }}</li>
            </ul>
          </div>
        </template>
        <p v-else class="step__hint" data-testid="import-hint">
          계정을 받으면 여기서 정리해 <strong>{{ account }}</strong>(이)라는 이름으로 저장하고, 계산에 쓸 계정으로 정한다. 같은 이름으로 받아 둔
          것이 있으면 덮어쓰기 전에 한 벌 남긴다.
          <template v-if="status?.account_file">
            <br />지금 받아 둔 것: <code data-testid="existing-account">{{ status.account_file }}</code>
          </template>
        </p>

        <AccountFailure v-if="failure?.step === 3" :step="3" :detail="failure.detail" />
      </section>
    </main>
  </div>
</template>

<style scoped>
.account {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.account__problems {
  margin-top: 0;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-strong);
}

.step__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 800;
}

.step__no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: #06121d;
  font-size: 12px;
}

.step__hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.step__hint code,
.step__path code {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.step__way {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 5px;
  border-top: 1px dashed var(--line);
}

.step__way-title {
  margin: 0;
  font-weight: 700;
}

.step__sub {
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}

.step__quiet,
.step__stop {
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}

.step__stop {
  border-color: var(--danger);
  color: var(--danger);
}

.step__quiet:disabled,
.step__stop:disabled {
  opacity: 0.6;
  cursor: default;
}

.link__switch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
  cursor: pointer;
}

.link__code-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}

/* 연결 코드는 사람이 보고 옮겨 적는 값이다 — 크게, 글자 사이를 띄워 보인다. */
.link__code {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  font-family: Consolas, 'D2Coding', monospace;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.12em;
  user-select: all;
}

.step__list {
  padding-left: 18px;
  list-style: decimal;
  font-size: 12px;
}

.step__list li {
  margin-top: 2px;
  overflow-wrap: anywhere;
}

.step__done {
  margin: 0;
  overflow-wrap: anywhere;
}

.step__path {
  margin: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.step__progress {
  margin: 0;
  color: var(--accent);
}

.step__box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
  border-top: 1px dashed var(--line);
}

.step__box .notes {
  margin-top: 0;
}

.step__box-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

/* 수집 스크립트의 줄은 길다 — 줄을 바꾸고, 많으면 이 상자 안에서 스크롤한다(빠뜨리지 않는다). */
.step__log {
  max-height: 150px;
  overflow-y: auto;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  font-family: Consolas, 'D2Coding', monospace;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.step__log-warn {
  color: var(--warn);
}

</style>
