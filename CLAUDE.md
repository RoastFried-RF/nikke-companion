# 니케 컴패니언

니케 PC판용 개인 데스크톱 앱(오버레이 + 계정 맞춤 편성·성장 추천 + 자체 티어).
요구사항의 기준은 `docs/spec.md`다. 먼저 읽어라.

## 읽는 순서

1. `docs/spec.md` — 요구사항, 단계, 결정 기록, 미검증 가정
   (요격전 작업이면 `docs/intercept.md`도 — 게임 화면에서 확인한 보스 정보와 모르는 것)
2. `.harness/progress.md` — 지금 상황과 다음 행동
3. `.harness/tasks.json` — 작업 목록(수락 조건·검증 명령·상태)
4. 맡은 작업과 관련된 코드

## 명령

```bash
node --test tests/unit/                  # 단위 테스트 (엔진 호출 없음, 빠름)
node --test tests/integration/           # 실제 엔진 호출 (수십 초)
node --test extension/                   # 크롬 확장(extension/)의 테스트 (브라우저 없이, 빠름)
node scripts/verify.mjs <작업ID>         # 그 작업의 검증 명령 실행 + 증거 기록
node scripts/verify.mjs --all            # 완료된 작업을 현재 코드로 재검증
node scripts/autopilot.mjs --max-iterations 3   # 자율 실행 루프
node scripts/harness-selftest.mjs        # 하네스 자체 검증 (모델 호출 없음)
node src/cli.mjs compare --account data/samples/account.sample.json --condition data/samples/condition.solo-raid.json --squads data/samples/squads.sample.json
```

`compare`·`suggest`·`growth`·`tier`·`intercept`는 시뮬 결과를 `data/cache/sim/`(gitignore)에 캐시한다. `--no-cache`로 끄고, 폴더를 지우면
비워진다(`docs/data-model.md` §시뮬 결과 캐시).
`suggest`는 상위 조합의 배치 순서도 탐색한다(2단계). `--no-refine`으로 끄고, `--budget <시뮬 횟수>`(기본 120)로 전체
시뮬 횟수를 묶는다(`docs/data-model.md` §배치 탐색).

요격전(이상 개체) 보스별 편성 추천(보스 값은 `data/intercept/anomaly.json` — 게임 화면에서 확인한 것만 담는다. 형식은
`docs/data-model.md` §보스 묶음·§요격전 추천 결과):

```bash
node src/cli.mjs intercept --account data/samples/account.sample.json                      # 보스 5종, 시뮬 예산 300건(보스당 60건) — 몇 분
node src/cli.mjs intercept --account data/samples/account.sample.json --boss 크라켄 --budget 30 --top 3 --json intercept.json
node src/cli.mjs intercept --account data/samples/account.sample.json --bosses data/samples/bosses.anomaly.sample.json --budget 25   # 검증용 보스 묶음
node src/cli.mjs intercept --account data/samples/account.large.sample.json --boss 크라켄 --budget 20   # 보유 34명 시험 계정 — 약점 속성 니케가 후보에 드는 것을 본다
```

요격전 추천은 보스마다 약점 속성 니케를 후보 풀에 단계당 최소 2명 넣고 후보 순서에서 앞에 둔다(`docs/data-model.md` §후보 생성 §우선 속성).
`suggest`·`tier`의 후보는 그대로다.

자동 티어(엔진 계산으로 티어표 — 방법·한계는 `docs/tier-method.md`, 기준 편성·등급 규칙은 `data/tier/`):

```bash
node src/cli.mjs tier build --only "헬름,크라운,리틀 머메이드" --json tier.json   # 일부만 (수십 초)
node src/cli.mjs tier build --json tier.json                                    # 전원: 시뮬 1,769건, 수십 분. --budget으로 상한(기본 2000)
```

데스크톱 앱(`app/`, Tauri v2 + Vue 3 — 자체 package.json. 자세한 것은 `app/README.md`):

```bash
npm --prefix app install                                  # 처음 한 번
npm --prefix app run tauri dev                            # 개발 실행 (데스크톱 앱 창 + 오버레이 창 + Vite)
npm --prefix app run tauri build                          # 실행 파일: app/src-tauri/target/release/nikke-companion.exe
npm --prefix app run build                                # 타입 검사 + 프런트 빌드
npm --prefix app test                                     # 컴포넌트 테스트 (vitest)
cargo test --manifest-path app/src-tauri/Cargo.toml       # Rust 단위 테스트
cargo build --manifest-path app/src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path app/src-tauri/Cargo.toml   # 경고가 없어야 한다
npm --prefix app run fixture                              # 컴포넌트 테스트용 샘플 결과 넷을 실제 CLI로 다시 만든다(몇 분). 고른 것만: `-- tier growth`
```

**창이 둘이다**(P-027 — `app/README.md` §창 둘 — 데스크톱 앱과 오버레이): **데스크톱 앱 창**(`app` — 테두리가 있는 보통 창, 1100×720,
`app/src/App.vue`)이 전부 한다 — 왼쪽 메뉴의 홈 · 요격전 · 내 니케 · 편성 도구 · 티어 · 설정(계정 연결 · 오버레이 · 계산 도구 ·
고급). **오버레이 창**(`main` — 게임 위의 작은 위젯, `app/src/Overlay.vue`)은 마지막 요격전 추천만 보여 준다. 권한도 창마다 따로다
(`src-tauri/capabilities/app.json` 명령 47개 / `overlay.json` 명령 15개 — 결과·상태 읽기와 자기 창의 조작). 앱을 실행하면 앱 창이 뜨고 오버레이는
설정대로 뜬다(앱과 함께 — 기본 · 게임을 찾았을 때 · 직접). **앱 창을 닫으면 앱이 끝난다**(오버레이 창은 닫히지 않고 숨는다. 끝내기
명령은 없다 — 오버레이 위젯의 `×`는 숨기기다).
화면은 파일 경로를 묻지 않는다: 계정은 기본 계정(이름 — 경로가 아니다), 보스 값은 내장한 `data/intercept/anomaly.json`.
**파일을 직접 고르는 길은 설정 > 고급에만 있다**(예전 오버레이의 탭 넷이 거기에 예전 모양으로 있다). 두 창이 같은 것을 보게
기본 계정·오버레이 설정·마지막 요격전 결과를 계정 폴더의 `.companion-state.json`·`.last-intercept.json`에 둔다
(Rust `src-tauri/src/shared_state.rs`, 화면 `app/src/lib/shared.ts` — 앱 창이 저장하면 `shared-state` 이벤트로 오버레이가 다시 읽는다).
화면의 글에는 개발 용어(파일·JSON·시뮬·예산·경로)를 쓰지 않고(고급 제외), 숨기면 안 되는 표시(추정·미확인 값·미지원 효과·
검증용 데이터·임시 규칙)는 접힌 구획 밖의 배지로 둔다 — `app/tests/Wording.test.ts`가 본다.

**요격전 계획**(P-029 — `app/README.md` §요격전 계획, 형식·규칙은 `docs/data-model.md` §요격전 계획): 계정의 니케별 장비 4부위와
보스의 보상 부위를 이어 「오늘 돌 보스」를 한 문장으로 말하고(내 니케 > 장비 · 요격전 계획, 홈의 「오늘의 요격전」 카드), 손으로 적은
요격전 기록을 추정 총딜과 견준다(요격전 화면의 「내 기록」 — 기록이 있으면 배지가 「추정 · 기록과 ○○% 차이」). 규칙은 순수 모듈
`src/core/plan.mjs`, 화면은 `app/src/lib/plan.ts`·`app/src/views/PlanBoard.vue`·`RecordPanel.vue`·`TodayCard.vue`. 기록·즐겨찾기는
계정 폴더의 `<계정>.plan.json`(gitignore — Rust `shared_state.rs`의 `load_plan`·`save_plan`, 앱 창만 부른다). **계정에 없는 것은
지어내지 않는다**(장비를 적지 않은 니케는 「기록 없음」, 보상 확률·획득 수는 모른다고 적는다), **추정치를 기록에 맞춰 고치지 않는다**.
시험 계정은 `data/samples/account.large.sample.json`에 지어낸 장비 `data/samples/gear.large.sample.json`을 얹은 것이다.

```bash
node --test tests/unit/plan.test.mjs                      # 순수 함수: 장비 상태 분류·주력 선정·보스 추천과 동률·기록 비교·커버리지 기준
npm --prefix app test -- InterceptPlan                    # 화면(가짜 backend): 장비 칸·추천 문장·기록 입력과 복원·배지 변화·홈 카드
```

**덱 빌더**(P-030 — `app/README.md` §덱 빌더, 형식·규칙은 `docs/data-model.md` §덱 빌더): 편성 도구의 「덱 빌더」 탭 — 보유 니케의 초상화에서
다섯을 골라 자리에 놓고(같은 니케는 한 번만, 버스트 단계 구성에서 모자란 것을 바로 말한다) 상대(이상 개체 보스 5종 · 엔진의 솔로 레이드
프리셋 · 「속성만 정하기」)를 골라 「계산」을 누르면 총딜과 니케별 딜이 나온다. 「내 계정 육성」과 「모두 최대 육성」(엔진 기본 스펙 —
코어 강화 0이라 전부 최대는 아니다)을 나란히 보이고, 한 자리를 다른 보유 니케로 바꿔 보거나(「한 명을 바꾼다면」 — 한 번에 12명까지),
같은 다섯의 자리 순서를 견준다(P-013의 변형 규칙 — 한 번에 24가지까지). 규칙은 순수 모듈 `src/core/deck.mjs`(계산은 `compareSquads`를
그대로 부른다 — 편성 항목의 `growth: "engine_default"`가 엔진 기본 스펙이다), 화면은 `app/src/lib/deck.ts`·`app/src/views/Deck*.vue`.
내 편성(번호 칸 01~05와 이름 붙인 목록)은 계정 폴더의 `<계정>.decks.json`(gitignore — Rust `shared_state.rs`의 `load_decks`·`save_decks`),
편성 복사는 앱 명령 `copy_text`(`src-tauri/src/clipboard.rs` — **쓰기만 한다. 클립보드를 읽는 코드를 넣지 않는다**, 메모리를 직접 잡는
`Win32_System_Memory`는 켜지 않는다). 자동 계산은 설정 > 계산 도구에서 켠다(기본 꺼짐). **계산하지 못한 편성은 0이 아니라 「계산하지 못함」**
이고, 상한 때문에 못 본 것은 화면에 적는다.

```bash
node --test tests/unit/deck.test.mjs                      # 순수 함수: 자리에 넣고 빼기·버스트 구성·상대 → 전투 조건·두 육성 기준·한 명 바꾸기·자리 순서·저장 문서·복사 글
node --test tests/integration/deck.engine.test.mjs        # 실제 엔진(약 20초): 두 기준 계산과 캐시, 한 명 바꾸기, 자리 순서, 엔진 기본 스펙 = 프로필 없는 계산
npm --prefix app test -- DeckBuilder                      # 화면(가짜 backend): 편성 짜기·상대·계산·바꿔 보기·자리 순서·저장과 복원·덱 빌더에서 열기·복사·자동 계산
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_clipboard -- --ignored --nocapture   # 이 PC의 클립보드에 실제로 쓴다(끝나면 앞의 글자를 되돌린다)
```

**오버레이는 작은 위젯이다**(P-028 — `app/README.md` §오버레이 위젯): 모양 셋 — 접힘(알약: 보스 얼굴·이름·총딜) · 한 줄 카드(기본:
+ 「약점 ○○」·작은 초상화 다섯) · 펼침(+ 한 줄 요약·2·3위·자리 순서). 누르거나 `Alt+Shift+M`으로 오가고, **창은 위젯만큼만 크다**
(화면이 잰 크기를 `overlay_fit`으로 알린다 — 빈 투명 영역이 게임 클릭을 가로막지 않게). 그림은 `app/src/views/OverlayWidget.vue`(받은
값을 그리기만 한다), 규칙은 Rust `src-tauri/src/overlay_widget.rs`(순수): 자동 표시 `AutoShow::step`(이상 개체 화면을 떠나면 설정한
시간 뒤 접거나 쉬고 돌아오면 되돌린다 — 핀이면 그대로, 인식이 unknown인 동안에는 바꾸지 않는다), 끌어 둔 자리(`Spot`·`Anchor` —
붙이기를 켜면 게임 화면 기준)와 화면 안으로 되돌리기(`clamp_into`). 설정(크기 배율·불투명도·자동 숨김·기본 모양·클릭 통과·자리
초기화)은 앱 창의 설정 > 오버레이에 있고 계정 폴더의 `.overlay-widget.json`에 기억한다(`overlay_store.rs`). **오버레이는 계산을
시작하지 않는다** — 결과가 없으면 한 줄과 「앱 열기」뿐이고, 계산 진행은 앱 창이 알린 것을 작게 보인다(`app/src/lib/activity.ts`).

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml --lib overlay_                                              # 위젯의 규칙: 모양·설정·자동 표시·창 크기·자리, 설정 파일 읽고 쓰기(평소 cargo test에도 들어 있다)
npm --prefix app test -- OverlayWidget Overlay WidgetLib                                                        # 위젯의 그림(세 모양·결과 없음·계산 중·오류·긴 이름·이미지 없음), 오버레이 창의 틀, 작은 규칙들
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_widget -- --ignored --nocapture --test-threads=1   # 앱을 실제로 띄운다: 창이 모양에 맞게 줄고 늘어남·모서리·자리 기억(먼저 다른 터미널에서 `npm --prefix app run dev`. 떠 있는 앱은 끄고 돌린다. 계정 폴더는 임시 폴더)
```

설정 > 오버레이에 **자동 추적** 스위치가 있다(기본 꺼짐): 켜 두면 2초마다 게임 화면을 읽어(읽기만 — 이미지는 저장하지도
화면에 넘기지도 않는다) 게임에서 보고 있는 이상 개체 보스의 추천을 요격전 화면과 오버레이에 스스로 보여 준다. 규칙은 Rust
`src-tauri/src/screen_track.rs`(언제 읽는가)와 `app/src/lib/screenTrack.ts`의 `followStep`(언제 보스를 바꾸는가) — `app/README.md` §자동 추적.
앱은 한 번만 뜬다(두 번째 실행은 조용히 끝나고 떠 있던 앱 창이 앞으로 온다 — §중복 실행 방지).

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_track -- --ignored --nocapture --test-threads=1   # 캡처 한 번에 걸리는 시간·창 크기 변경(자기 창. 게임 창 측정 한 건은 게임 창이 떠 있어야 한다)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_single_instance -- --ignored --nocapture --test-threads=1   # 앱을 실제로 띄운다: 창 둘, 두 번째 실행, 앱 창을 닫으면 끝남(떠 있는 앱은 끄고 돌린다. 계정 폴더는 임시 폴더)
cargo test --manifest-path app/src-tauri/Cargo.toml --lib shared_state                                          # 두 창이 함께 보는 것: 기본 계정·마지막 요격전 결과·오버레이를 띄우는 때(평소 cargo test에도 들어 있다)
```

오버레이는 **게임 위에 머문다**(P-024): 니케 게임 창이 항상 위 창이라 게임을 누르면 오버레이를 덮는다 — 오버레이가 0.1초마다 창
순서를 읽어, 게임이 위로 올라왔으면 **자기 창만** 활성화 없이 다시 올린다(규칙 `src-tauri/src/stay_on_top.rs`, 호출은
`overlay_win32.rs`의 `OverlayWindow` 한 곳 — 게임 창은 읽기만 한다). 앱이 끝나면(앱 창 닫기·오버레이의 끝내기·프로세스 종료) 돌던 엔진·계정 수집
프로세스가 자식까지 끝난다(`engine_win32.rs`의 Job Object). 계산이 도는 동안에는 자동 추적이 화면을 옮기지 않는다
(`app/src/lib/screenTrack.ts`의 `tabMoveStep`). 자세한 것은 `app/README.md` §게임 위에 머물기·§종료 시 정리.

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_stay_on_top -- --ignored --nocapture --test-threads=1   # 항상 위 창에 덮인 자기 창을 포커스 없이 다시 올린다(게임 불필요. 테스트 창 하나가 잠깐 활성화된다)
cargo test --manifest-path app/src-tauri/Cargo.toml --test exit_cleanup                                         # 가짜 엔진을 띄운 실행 파일을 끝내면 자식 프로세스가 남지 않는다(평소 cargo test에도 들어 있다)
```

앱 창의 **설정 > 계정 연결**에서 계정을 받는다(터미널의 세 단계 — 쿠키 저장 → `profile_fetch.py` → `import-profile` — 를 대신한다):
1 쿠키 받기(방법 셋: 크롬 확장 — 권장 · 붙여넣기 · 앱 안의 blablalink 로그인 창) → 2 계정 새로 받기(엔진의 수집 스크립트 실행) → 3 변환·저장
(`data/accounts/<이름>.json`, 있던 파일은 `.bak`) → 그 계정이 곧바로 계산에 쓸 계정(기본 계정)이 된다. 자세한 것은 `app/README.md` §계정 받기.
**세션 쿠키는 계정 접근권이다**: 앱은 쿠키를 엔진의 `scraper/.session_cookie` 한 곳에만 쓰고, 화면·로그·오류·이벤트·반환값·
localStorage에 내보내지 않으며, 스스로 네트워크로 보내지 않는다(Rust `src-tauri/src/cookie.rs`·`account_sync.rs`·`login_window.rs`·
`extension_link.rs`). 로그인 창은 앱 명령을 부를 수 없다(capability에 없다). **에이전트는 실제 `vendor/nikke-calc/scraper/.session_cookie`,
`vendor/nikke-calc/profiles/`, `data/accounts/`의 파일을 읽지도 출력하지도 실행에 쓰지도 않고, 실제 수집을 돌리지 않는다** — 개발과
테스트는 지어낸 쿠키, 가짜 수집 스크립트, 샘플 프로필(`data/samples/profile.sample.json`)로만 한다. 앱 실행 파일을 띄우는 테스트는
`NIKKE_ACCOUNTS_DIR`로 임시 계정 폴더를 준다(앱은 켜질 때 계정 폴더의 설정을 읽는다).

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml --test account_fetch                                   # 가짜 엔진 폴더·가짜 수집 스크립트로 수집·중단·쿠키 비노출(평소 cargo test에도 들어 있다)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_login_window -- --ignored --nocapture       # 로그인 창을 실제로 띄운다(임시 세션 — 로그인하지 않는다. 네트워크 필요)
```

**크롬 확장으로 계정 받기**(P-025 — 계정 받기의 기본 경로. 자동 로그인으로 써서 비밀번호를 모르는 계정도 된다): 저장소의
`extension/`(Manifest V3 — `chrome://extensions`의 개발자 모드에서 「압축해제된 확장 프로그램을 로드합니다」로 설치)이 blablalink에
로그인된 크롬에서 단추 한 번으로 `api.blablalink.com` 요청에 실릴 쿠키를 Cookie 헤더 한 줄로 만들어 이 PC의 오버레이에 넘긴다.
앱은 설정 > 계정 연결에서 **크롬 확장 연결**을 켰을 때만(기본 꺼짐, Rust가 기억) `127.0.0.1:47615`에서 듣고(`src-tauri/src/extension_link.rs` —
루프백에만 묶인다, 정해진 요청 하나, 출처가 크롬 확장인 것만, 화면에 보이는 **연결 코드**가 맞는 것만 — 다섯 번 틀리면 1분 막는다),
받은 쿠키를 붙여넣기와 같은 검사를 거쳐 같은 한 곳에 쓴 뒤 계정 화면이 「계정 새로 받기」를 저절로 잇는다. 쿠키는 답·로그·이벤트·
반환값에 실리지 않고 화면을 지나가지도 않는다. 확장의 권한은 `cookies`와 호스트 권한 둘(blablalink, 127.0.0.1)뿐이고 백그라운드에서
돌지 않는다. 확장을 고치면 `chrome://extensions`에서 다시 로드한다. 자세한 것은 `app/README.md` §크롬 확장으로 계정 받기,
`extension/README.md`. **에이전트는 사용자의 크롬에 확장을 설치하거나 실제 blablalink에 로그인하지 않는다** — 가짜 쿠키와 가짜
요청으로만 개발·테스트한다(실제 포트 47615와 앱의 설정 폴더도 테스트에 쓰지 않는다).

```bash
node --test extension/                                                                                     # 확장: 쿠키 목록 → 헤더(순수 모듈), 보내기 흐름(가짜 요청), manifest 권한, 오버레이와의 계약
cargo test --manifest-path app/src-tauri/Cargo.toml --test extension_link                                  # 수신부를 실제로 열고(빈 포트) 가짜 요청을 보낸다: 루프백 전용·연결 코드·거부·쿠키 비노출(평소 cargo test에도 들어 있다)
```

**UI 개편**(데스크톱 앱 + 오버레이 — 기준 문서 `docs/ui-redesign.md`. UI 작업이면 먼저 읽는다): 디자인 기반(P-026), 데스크톱 앱 창
(P-027 — 위의 「창이 둘이다」, 화면 `app/src/pages/`, 결과 그림 `app/src/views/`, 함께 쓰는 모양 `app/src/styles/app.css`), 오버레이 위젯
(P-028 — 위의 「오버레이는 작은 위젯이다」)까지 만들었다. 디자인 기반:
디자인 토큰 `app/src/styles/tokens.css`, 공통 부품 `app/src/ui/`(색·크기는 토큰만 쓴다 — 새 화면도 그렇다), 게임 이미지 명령(Rust `src-tauri/src/assets.rs` —
니케 이름·보스 id·아이콘 종류는 경로가 아니라 열쇠다: 엔진 카탈로그·내장 보스 묶음·아이콘 표에 있을 때만 정해진 폴더에서 읽고,
없는 이미지는 오류가 아니라 「없음」), 한 줄 요약 `src/core/summary.mjs`, 남은 시간 어림 `src/core/eta.mjs`. **게임 이미지를 저장소에 넣지 않는다** — `data/assets/`·`data/captures/`는 gitignore이고 테스트는
코드로 만든 가짜 이미지로만 한다. **에이전트는 `fetch-assets.mjs --run`을 돌리지 않는다**(실제로 받는 것은 사람이 한다), 설치된 게임
클라이언트의 파일을 풀거나 복호화하지 않고, 주소를 추측해 두드려 보지 않는다. 자세한 것은 `app/README.md` §디자인 기반.

```bash
node scripts/fetch-assets.mjs --list                          # 받을 리소스의 종류별 개수·출처(네트워크 없음). --manifest는 목록을 data/assets/manifest.json에 쓴다
node --test tests/unit/fetch-assets.test.mjs                  # 리소스 받기: 주소 규칙(엔진 코드와 대조)·목록·받기(로컬 가짜 서버 — 실제 CDN을 부르지 않는다)
cargo test --manifest-path app/src-tauri/Cargo.toml --lib assets   # 게임 이미지 읽기: 읽는 순서·없는 이미지·경로 탈출
$env:VITE_UI_GALLERY = '1'; npm --prefix app run tauri dev    # (PowerShell) 부품 모아 보기 — 개발 실행에서만 뜬다. 브라우저에서는 개발 서버 주소 뒤에 ?gallery
```

게임 창·화면 캡처·요격전 화면 인식(실행 중인 니케가 필요하다 — `--recognize <PNG>`와 `live_recognize`만 빼고. 게임은 읽기만 한다 —
`app/README.md` §게임 창·화면 캡처, §화면 인식):

```bash
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --info          # 게임 창 정보(JSON)
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --name <라벨>   # 게임 화면을 data/captures/에 PNG로 저장
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --recognize <PNG 파일>   # 캡처에서 화면 종류·보스 인식(JSON 한 줄, 게임 불필요)
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --recognize-live        # 게임 창을 찍어 인식만(이미지는 저장하지 않는다. 게임이 없으면 종료 코드 2)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_game -- --ignored                # 실제 게임 테스트(창이 떠 있어야 한다)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_capture -- --ignored             # 게임 없이 캡처 경로 확인(테스트가 띄운 자기 창을 찍는다)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_recognize -- --ignored           # 화면 인식을 라벨 붙은 캡처로 확인(data/captures/labels.json이 있어야 한다. 게임 불필요)
```

엔진은 `vendor/nikke-calc`(서브모듈, Python 3.12, 표준 라이브러리만). 직접 고치지 않는다.

## 작업 원칙

- 한 번에 작업 하나. `tasks.json`의 수락 조건과 검증 명령을 구현 전에 확인한다.
- 완료는 `node scripts/verify.mjs <작업ID>`가 통과해야 한다. "구현했다"는 말은 완료가 아니다.
- 검증을 통과시키려고 테스트를 지우거나 약하게 만들지 않는다. `protected` 경로는 수정 금지.
  수락 조건을 바꿔야 하면 이유와 영향을 `progress.md`에 적고 작업을 멈춘다.
- 실제 게임이 필요한 확인은 `manual_checks`에 남기고 완료로 치지 않는다.
- 모의 데이터에는 `is_test_data: true`. 개인 계정 데이터는 `data/accounts/`(gitignore).
- 엔진이 지원하지 않는 효과는 미지원으로 표시한다. 0으로 두고 결과를 확정하지 않는다.
- 권한·접근 제한을 우회하지 않는다. 배포·공개 게시·게임 계정에 영향을 주는 조작은 하지 않는다.
- 모델은 Fable 5.2만. 쓸 수 없으면 기록하고 멈춘다.

## 세션을 끝낼 때

`.harness/progress.md`를 갱신한다: 구현한 것, 실행한 검증과 결과, 미검증 항목,
차단된 작업과 재개 조건, 다음 작업.
