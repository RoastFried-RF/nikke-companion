# 진행 상황

마지막 갱신: 2026-11-12 낮 (대화형 세션 — 사용자와 함께)

## 지금 상태

- 끝난 작업 17건(H-001~P-013, P-015, P-016). P-011(게임 창 추적·캡처)은 실게임 검증까지 통과했다 — 아래 "P-011 마무리".
- **방향 변경: 레이드 기능은 요격전(이상 개체 요격전) 중심**(사용자 확인, `docs/spec.md` §5). 유니온 5덱(P-014)은 보류.
- 대기 중: **P-018(요격전 보스별 편성 추천)** → P-019(요격전 화면 인식) → P-017(오버레이 화면: 요격전·성장 비교·티어표).
- 보스 5종의 이름·속성·약점은 캡처로 확인했다(`docs/intercept.md`). 방어력 같은 나머지 값은 모른다.
- P-019(요격전 화면 인식)를 정의했다 — 라벨 붙은 캡처 16장이 있다(아래 "요격전").
- 자동 티어(P-015): `node src/cli.mjs tier build [--only 이름,이름]`. 등급 규칙은 임시다. 전체 니케 계산은 아직 돌리지 않았다.
- 계산 경로: 편성 비교(`compare`), 후보 추천(`suggest`), 성장 투자 비교(`growth`), 엔진 데이터 변경 감지
  (`detect-changes`), 프로필 파일 가져오기(`import-profile`). Node CLI와 Tauri 오버레이가 같은 계산 모듈을 쓴다.
- 오버레이(`app/`, Tauri v2 + Vue 3): 투명·항상 위 창, 단축키, 결과 파일 표시, 앱 안에서 추천·비교 실행,
  게임 창 상태 표시·화면 저장(Alt+Shift+S)·게임 창에 붙이기(P-011), 계산 중단·활성화 없이 보이기(P-016).
- **요격전 화면 인식(P-019)**: 캡처한 프레임에서 화면 종류(이상 개체 보스 선택·편성·그 밖·모름)와 선택된 보스를 알아낸다 —
  Rust 모듈·`nikke-capture --recognize`/`--recognize-live`·앱 명령 `recognize_game_screen`까지. 오버레이 화면 연동은 아직 없다
  (`app/README.md` §화면 인식). 요격전 밖의 화면(로스트 섹터·니케 목록 등)은 인식하지 않는다.

## 관리자 권한 재실행 결과 (2026-11-12 14:12~)

- 사용자가 Claude 앱을 관리자 권한으로 다시 실행했다(세션 셸·앱·게임 모두 관리자 권한인 것을 확인).
- **게임 조작은 여전히 안 된다.** 커서는 움직이고 클릭이 게임 창을 활성화하지만, 로비의 "방주"를 세 번 눌러도 화면이 그대로였다
  (`nikke-capture`로 전후를 찍어 확인). 게임이 프로그램이 만든 입력을 받지 않는 것으로 보인다. 다른 입력 방식은 시도하지 않는다
  (`docs/spec.md` §게임과의 상호작용 규칙). 화면 이동은 사용자가, 읽기는 앱과 Claude가 한다.
- computer use 스크린샷은 게임 창이 활성 상태일 때 게임 화면을 어둡게만 보여 준다 — 게임 화면은 `nikke-capture`로 본다.
- **관리자 권한 세션은 얻는 것이 없다.** 이 세션과 하네스 에이전트의 모든 명령이 관리자 권한으로 돈다 — 사용자에게 일반 권한으로
  되돌리기를 권했다. 관리자 권한 세션에서는 자율 실행(autopilot)을 돌리지 않는다.
- 일반 권한 세션에서 알게 된 것: 마우스 커서가 관리자 권한 창(런처 등) 위에 있으면 computer use의 입력이 전부 막혀 **우리 오버레이도**
  누를 수 없었다. 그리고 `open_application`으로 오버레이를 앞으로 가져오려다 **두 번째 인스턴스가 떴다** — 오버레이에 중복 실행 방지가
  없다(두 번째 창은 단축키 등록 실패 오류를 띄운다). 고칠 것.
- 그 직전 묶음: P-018(요격전 보스별 추천)·P-019(요격전 화면 인식)·P-017(오버레이 화면)이 모두 검증을 통과했다.
  `intercept` 명령을 샘플 계정으로 돌려 보스별로 속성 상성이 반영되는 것을 봤고(리틀 머메이드: 크라켄 10.61억 ↔ 미러 컨테이너 6.12억),
  `--recognize-live`는 로비에서 `other`를 냈다. **이상 개체 화면을 띄운 채 라이브 인식은 아직 확인하지 못했다**(사용자가 화면을 넘겨 줘야 한다).
  오버레이의 새 화면들은 실제 창에서 추천·비교 탭이 그려지는 것까지만 봤다(요격전 탭은 눌러 보지 못했다).

## 요격전 (2026-11-12)

- 사용자가 말한 "레이드"는 요격전(이상 개체 요격전)이다. 사용자가 화면 14장을 찍어 줬고(모두 16장, 라벨 `data/captures/labels.json`),
  대화형 세션이 이미지를 읽어 **보스 5종의 이름·속성·약점·보상과 "최대 레벨 400 제한"을 확인했다 — `docs/intercept.md`.**
  인디빌리아(풍압, 약점 작열) · 울트라(전격, 약점 철갑) · 하베스터(작열, 약점 수냉) · 크라켄(철갑, 약점 풍압) · 미러 컨테이너(수냉, 약점 전격).
  육각형의 속성 아이콘은 보스 자신의 속성이다(약점은 편성 화면에 글자로 나온다).
- 모르는 것: 방어력·코어·파츠·거리·전투 시간·보스 패턴. 엔진에 요격전 보스 프리셋이 없어 조건의 적 설정으로 표현한다 —
  지금 계산할 수 있는 것은 속성 상성과 계정 육성을 반영한 총딜 추정까지다.
- 작업: P-018(보스별 편성 추천 + 실제 보스 묶음 `data/intercept/anomaly.json`), P-019(화면 인식: 화면 종류와 선택된 보스, Rust),
  P-017(오버레이 화면). 그 뒤에 오버레이가 인식 결과로 그 보스의 추천을 자동으로 보여 주는 연동을 정의한다.

## P-011 마무리 (2026-11-12 낮)

- 사용자가 게임 창을 띄운 뒤 `live_game`을 돌리자 **5건 중 3건 통과 뒤 테스트 프로세스가 STATUS_ACCESS_VIOLATION으로 죽었다.**
  저장소 밖 재현 프로그램(앱의 캡처 모듈 복사 + 예외 처리기)으로 위치를 찾았다: `GraphicsCaptureSession::IsSupported`가 쓰는,
  `windows` 크레이트의 전역 팩터리 캐시가 언로드된 DLL을 가리켰다. 조건: 첫 캡처를 창을 가진 스레드가 하고(가리개 창 테스트),
  그 스레드가 끝난 뒤 다른 스레드가 캡처한다. 게임 없이는 재현하지 못했다(대상 창을 가진 다른 스레드가 살아 있으면 COM이 내려가지 않는다).
- 수정: `game_win32.rs`의 `keep_winrt_loaded()` — 첫 WinRT 호출 전에 `CoIncrementMTAUsage`를 한 번 부른다. 재현 프로그램에서
  수정 없이는 매번 죽고 수정하면 3/3 통과, 저장소에서는 `live_game` 5건이 4회 연속 통과(병렬 3 + 직렬 1). clippy 경고 없음.
- `node scripts/verify.mjs P-011 --record` 통과(명령 7개 모두, 체크포인트 `eb362de`). `manual_checks` 3개는 여전히 사람 몫이다.
- 오버레이 앱에서 같은 충돌이 실제로 났을지는 확인하지 않았다(주 스레드가 COM을 쥐고 있어 나지 않았을 가능성이 높지만 추정이다).

## 게임 조작 (2026-11-12 확인)

- 사용자가 "화면 이동은 Claude가 computer use로 직접 하라"고 결정했지만 **할 수 없었다.** 니케(`nikke.exe`)가
  관리자 권한으로 실행되고 이 세션은 일반 권한이라, Windows(UIPI)가 낮은 권한 프로세스의 마우스·키 입력을 막는다.
  로비의 "방주"를 두 번 눌러도 화면이 바뀌지 않았고 프로세스 권한을 읽어 원인을 확인했다. 우회하지 않는다.
- 그래서 화면 캡처 수집은 **사용자가 한다**: 게임에서 해당 화면으로 간 뒤 오버레이의 Alt+Shift+S 또는
  `nikke-capture --name <라벨>`(CLAUDE.md §명령). 필요한 화면: 솔로 레이드·유니온 레이드의 보스 정보/편성 화면,
  로스트 섹터 입구·맵, 니케 목록·상세. `data/captures/`(gitignore)에 쌓이면 인식 작업을 정의한다.
- 읽기 전용 캡처는 권한과 무관하게 된다(P-011 에이전트가 로비 1장을 저장했다:
  `data/captures/20261112-054148-988_dev-wgc.png`, 2212×1244, 제목 표시줄·테두리 없음).

## 구현한 것

| 작업 | 내용 | 만든 쪽 |
|---|---|---|
| H-001 | 하네스: `scripts/autopilot.mjs` · `verify.mjs` · `harness-lib.mjs` · `harness-selftest.mjs` | 대화형 |
| P-001 | `src/core/engine.mjs` — nikke-calc 병렬 배치 호출 | 대화형 |
| P-002 | `src/core/account.mjs` · `condition.mjs` | 대화형 |
| P-003 | `src/core/compare.mjs` · `render.mjs` · `src/cli.mjs` | 대화형 |
| P-004 | `src/core/format.mjs` — 억·만 단위 표기 | 자율 |
| H-002 | 실제 모델로 하네스 1회전 확인 | 기록 |
| P-005 | `src/core/candidates.mjs` — 후보 편성 생성 + `suggest` | 자율 |
| P-006 | `src/core/growth.mjs` — 성장 투자 비교 + `growth` | 자율 |
| P-007 | `src/tier/detect.mjs` — 신규·변경 니케 감지 + `detect-changes` | 자율 |
| P-008 | `src/core/import-profile.mjs` — 엔진 프로필 → 계정 상태 + `import-profile` | 자율 |
| P-009 | `app/` — Tauri v2 + Vue 3 오버레이 골격(투명·항상 위, 단축키, 비교 결과 표시) | 자율 |
| P-010 | `src/core/runtime.mjs`(런타임 계약) · `src/runtime/node.mjs`(옛 `src/core/engine.mjs`) · `app/src-tauri/src/engine.rs` · 오버레이 계산 실행 | 자율 |

| P-011 | `app/src-tauri/src/game_window.rs` · `capture.rs` · `game_win32.rs` · `capture_cli.rs` · `bin/nikke-capture.rs` · `GamePanel.vue` — 게임 창 찾기·캡처·붙이기 (**실게임 검증 대기**) | 자율 |

(아래 수치는 P-010 시점이다. P-011 뒤: 프런트 115건, Rust 단위 94 + 엔진 통합 6, `live_capture` 4건.)
검증: 단위 102건, 실제 엔진 통합 15건, 앱 프런트 87건, Rust 49건(단위 43 + 실제 엔진·Node 대조 통합 6), 하네스 자체 검증 11개 시나리오 통과. `node scripts/verify.mjs --status`로 확인한다.

## 이번에 고친 결함 (2026-11-12)

**비워 둔 육성 칸이 만렙으로 계산되던 문제.** 엔진은 프로필에 항목이 있는 니케의 적지 않은 칸을 미육성이 아니라
기본 스펙(돌파 3 · 스킬 10/10/10 · 오버로드 장비)으로 계산한다. P-002의 가정("적지 않은 칸 = 미육성")이 틀렸고,
결과 메모는 "미육성 값으로 계산했다"고 사실과 다르게 말하고 있었다. P-008 에이전트가 발견해 `docs/data-model.md`에
적어 두었다. `toEngineEntry`(`src/core/account.mjs`)가 적지 않은 칸을 미육성 값으로 채워 넘기도록 고쳤고,
실제 엔진의 미육성 결과와 같은지 통합 테스트로 대조한다. 이 수정으로 단위 테스트 2건의 기대값을 바꿨다
(프로필 내용을 글자 그대로 비교하던 `account.test.mjs`·`growth.test.mjs`의 단언 — 요구가 바뀐 것이지 약화가 아니다).
샘플 계정의 수치도 달라졌다(A 편성 45.67억 → 34.63억).

## 미검증

- **수치의 실전 정확도.** 샘플은 검증용 데이터다. 실제 계정·인게임 기록과 대조한 적이 없다(P-003 `manual_checks`).
- **실제 계정 가져오기.** P-008은 사용자가 받아 둔 프로필 파일을 변환한다. 실제 계정 프로필로 돌려 보지 않았다
  (P-008 `manual_checks`). 프로필을 받는 단계(엔진 `scraper/profile_fetch.py`, blablalink 로그인 세션 필요)는 사용자가 한다.
- **후보 생성의 품질.** 투자 점수 상위만 후보로 쓴다. 덜 키운 강한 니케나 시너지 조합이 빠질 수 있다(결과에 표시된다).
- **자율 실행 결과물의 코드 리뷰.** 테스트 재실행, 권한·의존성, Rust 접착 코드(`lib.rs`)와 엔진 프로세스 실행부만 확인했다.
  P-005~P-010의 나머지 코드는 줄 단위로 검토하지 않았다.
- **오버레이의 눈으로 하는 확인.** 사용자가 개발 실행에서 표시·단축키가 정상이라고 확인했다(P-009). 실제 니케 위 표시,
  P-010의 추천 실행 화면, 파일 고르기 창, 릴리스 빌드 실행은 확인되지 않았다.
- RapiLab·nikke_project는 README만 읽었다.
- **화면 인식의 실제 게임 확인.** 라벨 캡처 16장(한 계정·하루·창 모드 1881×1058)과 그것을 다시 샘플링한 이미지로만 맞췄다.
  이상 개체 화면을 띄운 채 라이브로 돌려 본 적이 없고, 다른 창 크기·전체 화면·보스를 넘기는 도중의 화면은 확인하지 못했다(P-019 `manual_checks`).

## 차단

- 없다. P-014는 차단이 아니라 보류다(사용자 방향 변경).
- (해결됨: CLI 인증은 재로그인으로, Rust 툴체인은 사용자 설치로 — rustc 1.99.1, MSVC.)

## 다음 작업

1. `node scripts/autopilot.mjs --max-iterations 3` — P-018, P-019, P-017.
2. 그 뒤: 오버레이 연동(인식한 보스의 추천을 자동으로 보여 주기)을 정의한다. 실제 계정이 있어야 추천이 쓸모가 있다(아래 3).
3. 사용자 몫: 실제 계정 프로필(`vendor/nikke-calc/scraper/profile_fetch.py`, blablalink 로그인은 사용자가 한다) →
   `import-profile` → 인게임 기록 대조. 오버레이 `manual_checks`(P-009·P-010·P-011·P-016).
4. 그 뒤: 전체 티어 계산(`tier build`, 1,000회 이상 — 캐시 사용), 로스트 섹터 가이드, 재화 제약을 넣은 성장 추천. 입력 자동화(R9)는 별도 결정.

## 하네스 변경 (2026-11-12, 대화형)

P-011에서 드러난 문제 셋을 고쳤다. 자체 검증은 14개 시나리오(M·N 추가) 통과.

- **환경 대기.** 실패한 명령은 없고 실제 환경만 없을 때(`requires_cmd` 실패) 에이전트를 다시 부르지 않고
  `blocked` + `env_wait: true`로 세운다. P-011은 창이 최소화된 채로 에이전트를 3번 불러 CLI 보고 기준 $23.9를 썼다 —
  2·3회차는 할 수 있는 일이 거의 없었다. 실패 사유의 우선순위도 "실제 실패 > 환경 없음"으로 바꿨다.
- **P-011의 환경 확인 명령**을 `scripts/probe-game-window.mjs`로 바꿨다(프로세스 유무 → 창이 떠 있는지까지).
  수락 조건과 테스트는 그대로다.
- **tasks.json 덮어쓰기.** autopilot이 에이전트 실행 전에 읽은 문서를 실행 뒤에 그대로 저장해, 그 사이에 사람이 고친
  내용이 사라질 수 있었다. 실행 뒤 디스크에서 다시 읽고 그 작업의 상태만 적는다.
- **보조 모델.** P-011 1회차 결과에 `claude-haiku-5-5`가 함께 찍혔다(주 작업은 Fable 5.2, CLI가 보조 작업에 쓴 것으로 보인다 —
  무엇에 썼는지는 결과에 없다). "Fable 5.2만" 원칙에 맞추려고 `.harness/config.json`의 `agent.env`로 보조·하위 에이전트
  모델도 `claude-fable-5-2`로 고정했고, 다른 모델이 쓰이면 `other_models_used`로 기록하고 화면에 알린다(실패로 치지는 않는다).
  P-012·P-013·P-016·P-015 실행 기록에는 `claude-fable-5-2`만 찍혔다(환경 변수 덕인지 보조 호출이 없었던 것인지는 구분되지 않는다).

## P-009 점검 기록 (2026-11-12, 대화형)

- 재실행: 프런트 테스트 55건, Rust 테스트 28건 통과. `cargo clippy` 경고 없음.
- 권한: capability는 이벤트 듣기·창 끌기·앱 명령 4개뿐. 파일·셸·네트워크 플러그인 없음. CSP 설정됨.
- `npm --prefix app run tauri dev`로 실제 실행해 창 속성을 Win32 API로 읽었다:
  보임, 항상 위(WS_EX_TOPMOST), 시작 시 클릭 통과 꺼짐, 위치 (2096,24) 크기 440x660 — 2560 폭 작업 영역의
  오른쪽 위에서 24px 띄운 자리.
- **확인하지 못한 것**: 화면이 실제로 그려지는지(투명 배경·내용), 작업 표시줄에서 숨겨지는지, 단축키 동작.
  창 스타일 비트로는 판정할 수 없어 눈으로 봐야 한다.

## 자율 실행 기록

CLI가 보고한 값이다(구독 사용 시 실제 청구액과 다를 수 있다).

| 작업 | 시간 | 턴 | CLI 보고 비용 |
|---|---|---|---|
| P-004 | 1.4분 | 12 | $0.77 |
| P-005 | 6.0분 | 31 | $2.79 |
| P-006 | 6.6분 | 48 | $3.76 |
| P-007 | 5.9분 | 45 | $3.20 |
| P-008 | 12.7분 | 75 | $6.97 |
| P-009 | 19.5분 | 134 | $9.84 |
| P-010 | 19.6분 | 81 | $10.23 |
| P-011 1회차 | 39.5분 | 194 | $15.45 (구현) |
| P-011 2회차 | 23.4분 | 2 | $6.32 (`live_capture` 추가, 둥근 모서리 결함 수정) |
| P-011 3회차 | 31.6분 | 30 | $2.17 (변경 없음 — 창이 뜨기를 기다림) |
| P-012 | 10분(재개분. 앞선 10분쯤은 세션 종료로 기록 없음) | 83 | $6.34 |
| P-013 | 23분 | 154 | $12.79 |
| P-016 | 22분 | 126 | $9.24 |
| P-015 | 17분 | 89 | $10.54 |

## 알아 둘 것

- 엔진 시뮬 1회가 4~5초다. 배치는 최대 4개 프로세스로 병렬 실행한다(`runBatch`의 `concurrency`).
- Windows 콘솔은 cp949다. 엔진을 직접 부를 때 `PYTHONUTF8=1`이 필요하다(어댑터는 자동 설정).
- Windows에서는 autopilot이 죽으면 에이전트 프로세스도 함께 끝난다. POSIX에서는 남을 수 있어
  재시작 시 확인한다(`--kill-orphan`).
- 같은 5명이라도 배치 순서에 따라 총딜이 달라진다(샘플 A 편성: 34.63억 ↔ 순서만 바꾼 후보 38.69억). 엔진이 자리로
  카메라·버스트 순서를 정하기 때문이다. 후보 생성기는 배치 순서를 하나만 만들고, `suggest`의 2단계(P-013,
  `src/core/search.mjs`)가 상위 조합의 배치를 바꿔 다시 계산한다 — 실측으로는 같은 버스트 단계 안의 순서가 거의 전부였다.
- `.refs/`는 후보 저장소를 얕게 복제한 참고용 폴더다(gitignore). 지워도 된다.
- 하네스 설정(`.harness/config.json`)의 권한: `acceptEdits` + `node`·`npm`·`npx`·`python`·`cargo`·`rustc`·`git status/diff/log`만 허용.

## 최근 작업 메모

- P-004 (2026-11-12): `src/core/format.mjs`에 `formatDamage`(조·억 소수 둘째 자리 버림, 만 정수 버림)를 만들고 `render.mjs`의 총딜·멤버 딜에 단위 표기와 원값을 함께 표시. 결과 JSON 수치는 그대로다.
- 검증: 수락 테스트 6건, `tests/unit/` 21건, `tests/integration/` 5건 통과. 샘플 CLI 출력도 눈으로 확인했다.
- P-005 (2026-11-12): `src/core/candidates.mjs`에 `generateCandidates`(단계별 투자 점수 상위 풀 → 1-1-3·1-2-2·2-1-2 구성의 5인 → 투자 점수 합 상위 limit개, 기준은 caveats)와 `suggestSquads`를 만들고 CLI `suggest --limit --top`을 추가. 형식은 `docs/data-model.md` §후보 생성.
- 검증: `tests/unit/` 35건(후보 14건 포함), `tests/integration/` 8건(실제 엔진 `suggest` 포함) 통과. 샘플 계정 기본 limit 30도 실제 엔진으로 실행해 봤다.
- 남은 문제: 투자 점수는 성능 추정이 아니라서 덜 키운 강한 니케·시너지 조합이 풀에서 빠질 수 있고, 같은 단계 안의 다른 배치 순서·버스트 쿨타임 회전은 비교하지 않는다(단계 2 편성 탐색에서 다룰 것). 실전 수치 대조는 여전히 미검증.
- P-006 (2026-11-12): `src/core/growth.mjs`에 `gainRate`·`applyUpgrade`(계정 복사본에 set/add 가상 적용)·`compareGrowth`(기준 1건 + 후보별 시뮬 → 전후 총딜·증가량·증가율 순위)를 만들고 CLI `growth --squads --squad --upgrades`, `renderGrowthReport`, `data/samples/upgrades.sample.json`을 추가. 형식은 `docs/data-model.md` §성장 투자 비교.
- 검증: `tests/unit/` 55건(성장 20건: 증가율·원본 불변(동결 계정)·제외 사유 포함), `tests/integration/` 10건(실제 엔진 `growth` 포함) 통과. 샘플 실행: 기준 45.67억, 헬름 스킬 10/10/10 +2.04%가 1위.
- 남은 문제: 기준 편성 하나에서만 보며 재화·비용이 없다(R4의 투자 효율은 단계 2). 미확인 칸에 set한 후보는 적용 전을 미육성으로 봐 증가율이 과대일 수 있다(메모로 표시). 오버로드 옵션 별칭 표를 엔진 문서에서 옮겨 적었으므로 엔진이 옵션을 늘리면 갱신해야 한다. 실전 수치 대조는 여전히 미검증.
- P-007 (2026-11-12): `src/tier/detect.mjs`에 `diffEngineData`(두 판 순수 비교)·`detectChanges`(엔진 저장소 두 커밋을 `git show`로 읽기)를 만들고 CLI `detect-changes --from --to [--engine] [--json]`(표준 출력이 JSON)을 추가. 추가·변경(스탯 칸별 전후, 스킬 효과 추가·삭제·변경·순서)·삭제를 나누고, 미파싱(`parsed_skills.json`에 키 없음)·효과 없음·기본 스탯 없음은 `evaluation.status: "hold"`(평가 보류)로 표시한다. 형식은 `docs/data-model.md` §데이터 변경 감지.
- 검증: `tests/unit/` 76건(감지 21건: 가짜 데이터 두 판 + 임시 git 저장소로 읽기·CLI 확인), `tests/integration/` 12건(실제 서브모듈 `HEAD`·`HEAD~1` 포함) 통과. 실제 엔진 `HEAD~40..HEAD`: 추가 4·변경 47·삭제 0·보류 0, 더 옛 구간에서는 미파싱 니케가 보류로 나오는 것을 확인했다.
- 남은 문제: 보류 판정은 파싱 여부까지만 본다 — 파싱된 효과를 엔진이 모두 계산하는지(지원 여부), 프리뷰 선행 등록(`preview_skills.json`, 추정값)은 보지 않으므로 `ready`를 "티어 확정 가능"으로 읽으면 안 된다(다음 단계 과제). 두 파일 밖의 변경(엔진 코드·보스·장비)은 감지하지 않는다. 서브모듈에 없는 커밋은 미리 fetch해야 한다(이 명령은 네트워크를 쓰지 않는다).
- P-008 (2026-11-12): `src/core/import-profile.mjs`에 `importProfile`(엔진 프로필 → 계정 상태 순수 변환)·`importProfileFile`(→ `data/accounts/<이름>.json`, 있는 파일은 `--force` 없이 덮어쓰지 않음)과 CLI `import-profile <파일> [--name] [--out-dir] [--force] [--json]`, `renderImportReport`, `data/samples/profile.sample.json`(검증용 표시)을 추가. 못 옮긴 칸은 `unknown`, 엔진이 모르는 니케는 `import.skipped`, 오버로드는 줄 목록이 합산 수치와 맞을 때만 `overload`(9개 옵션 모두 명시)로 옮긴다. 로그인·쿠키·수집기는 다루지 않는다. 형식은 `docs/data-model.md` §계정 가져오기.
- 검증: `tests/unit/` 90건(가져오기 14건), `tests/integration/` 14건 통과 — 샘플 프로필을 가져온 계정의 총딜이 프로필을 엔진 표기 그대로 넘긴 계산과 같다(41.74억). 실제 계정에서 받은 프로필로는 돌려 보지 않았다(`manual_checks`: 인게임 대조).
- (해결됨 — 위 "이번에 고친 결함" 참고. `toEngineEntry`가 미육성 값을 채운다.) 당시 남은 문제: 엔진이 적지 않은 칸을 기본 스펙으로 계산하므로 수동 계정의 적지 않은 칸과 모든 미확인 칸이 실제보다 높게 계산된다 — P-002~P-006 결과와 "미육성으로 계산했다"는 메모에 영향. 고치려면 `toEngineProfile`이 미육성 값을 채워 넘기게 하고 `account.test.mjs`·샘플 수치를 함께 바꿔야 한다(별도 작업 필요). 가져온 계정은 칸을 모두 적어 영향이 없지만 미확인 칸이 남은 니케는 같은 문제를 겪는다.
- P-009 (2026-11-12): `app/`에 Tauri v2(2.12.5) + Vue 3 + Vite + TS 오버레이 골격. Rust: `overlay_state.rs`(보임·클릭 통과 전환 규칙 + 오른쪽 위 위치 계산, 창 API 없음)·`report.rs`(`load_report`: 형식 확인 + 한국어 오류)·`lib.rs`(투명·무테·항상 위·작업 표시줄 숨김 창, 전역 단축키 Alt+Shift+C/O, 상태 이벤트). 화면: `ReportView.vue`·`OverlayStatus.vue`·`App.vue`, 단위 표기는 루트 `src/core/format.mjs`를 `@core` 별칭으로 가져온다. 권한은 `capabilities/overlay.json`(이벤트 듣기·창 끌기·앱 명령 4개)뿐, CSP는 IPC만 허용. 사용법은 `app/README.md`.
- 검증: 하네스 명령 6개 통과(vitest 55건 — 실제 CLI로 만든 `app/tests/fixtures/compare.sample.json` 입력, Rust 28건, 루트 단위 94건). 추가로 `npm --prefix app run tauri build`로 만든 실행 파일을 잠깐 띄워 WebView2 디버깅 포트로 페이지를 읽었다: 실행 인자로 준 샘플이 실제 `load_report`로 읽혀 순위가 그려지고, 단축키 2개가 등록되고, 외부 fetch는 CSP에 막히고 capability에 없는 명령은 거부됐다. 개발 실행 경로(Vite 서버 + 디버그 실행 파일)도 같은 방법으로 샘플이 그려지는 것을 봤다. **단축키를 눌러 본 것은 아니다.**
- 남은 문제: `manual_checks` 5개는 그대로 사람 몫(실제 니케 위 표시, 클릭 통과 중 게임 입력, Alt+Tab 뒤 동작). `Alt+Shift+O`로 다시 보일 때 창 라이브러리(tao)가 창을 활성화해 게임의 키보드 포커스를 가져갈 수 있다 — 게임 위에서 확인 필요, 고치려면 Win32로 직접 보여야 한다(P-010 이후). `npm --prefix app install`이 루트에서 돌면 `app/package.json`에 `"nikke-companion": "file:.."`을 매번 적는다(npm 10 동작, 지워도 다시 생겨 그대로 둠 — 앱은 쓰지 않는다). 설치 파일은 만들지 않는다(`bundle.active: false`). 결과 파일은 경로를 손으로 넣는다(파일 고르기 창은 P-010).
- P-010 (2026-11-12): 계산 모듈이 엔진을 `deps.runtime`(계약: `src/core/runtime.mjs`)으로 받게 하고 Node 구현을 `src/runtime/node.mjs`로 옮겼다(`src/core/engine.mjs` 삭제 — CLI·기존 테스트는 import 경로와 런타임 주입만 바꿨다). Rust `engine.rs` + 명령 `engine_catalog`·`engine_version`·`engine_run_batch`(최대 4개 프로세스, id로 순서 복원, 줄 단위 오류, 시간 제한, 한 프로세스가 죽으면 나머지도 멈춤, 진행 이벤트)·`read_json_file`·`pick_json_file`(rfd — 대화 상자 플러그인·권한 없음), 엔진 폴더·python은 환경 변수 `NIKKE_ENGINE_DIR`·`NIKKE_PYTHON` → `%APPDATA%\local.nikke-companion.overlay\settings.json` → 저장소의 `vendor/nikke-calc` 순(화면에서는 못 바꾼다). 화면: `ComputePanel.vue`·`lib/compute.ts`·`lib/runtime.ts`로 추천·비교 실행, 진행 건수·경과 시간, 오류 표시.
- 검증: 하네스 명령 6개 통과(루트 단위 102건 — `core-runtime.test.mjs`가 node: import 정적 검사, 통합 15건, vitest 87건, Rust 49건 — `tests/engine_batch.rs`가 실제 엔진으로 순서·오류 격리·결정론을, `node_runtime_reference.mjs`로 Node 런타임과 total_damage·멤버 딜·카탈로그·버전 일치를 확인). `cargo clippy` 경고 없음. 추가로 개발용 실행 파일 + Vite 서버를 띄워 WebView2 디버깅 포트로 `추천 실행`을 눌렀다: 샘플 계정 후보 6개가 7초에 끝나 1위 39.72억(3,972,224,195) — 같은 인자의 `node src/cli.mjs suggest`와 3위까지 수치가 같았다.
- 남은 문제: `manual_checks` 2개는 사람 몫이고, **파일 고르기 창은 띄워 보지 못했다**(오버레이가 항상 위라 뒤에 가려지는지 확인 필요 — 가려지면 경로를 직접 넣으면 된다). 릴리스 빌드(`tauri build`) 실행 파일로는 계산을 돌려 보지 않았다. 계산을 중간에 멈추는 단추와 성장 비교(`growth`) 화면은 없다. `rfd`(0.18, Windows 전용 의존성)와 `serde_json`의 `preserve_order`를 더했다.
- P-011 (2026-11-12): Rust에 `game_window.rs`(게임 창 고르기 규칙·창 정보·붙이기 위치, 순수)·`capture.rs`(빈 프레임 판정·클라이언트 영역 잘라 내기·라벨/파일 이름·PNG 저장, 순수)·`game_win32.rs`(창 열거·창 정보·Windows.Graphics.Capture)·`capture_cli.rs` + `src/bin/nikke-capture.rs`(`--info`, `--out/--name`, 게임 없음 = 종료 코드 2)·`tests/live_game.rs`(`#[ignore]` 5건)를 만들고, 오버레이에 명령 `game_window_status`·`set_follow_game`·`capture_game`, 단축키 Alt+Shift+S, 게임 창 추적 스레드(상태 이벤트 + 붙이기), `GamePanel.vue`를 더했다. 캡처는 WGC만 쓴다(이유·한계는 `app/README.md` §캡처 방식). `windows` 0.62 기능과 `png`만 더했고 capability에는 새 명령 3개만 더했다.
- 검증: 루트 단위 102건, 프런트 115건(GamePanel 21건 + 계약 테스트에 "게임 창을 움직이거나 입력·메시지를 보내거나 프로세스를 여는 호출이 없다" 추가), Rust 98건(단위 92 + 엔진 통합 6), `cargo clippy` 경고 없음, 프런트 빌드 통과. 실제 게임: `nikke-capture --info`와 캡처 1회 성공(창 모드 2212×1244, PNG를 열어 제목 표시줄·테두리 없이 로비 전체가 찍힌 것을 봤다 — `data/captures/20261112-054148-988_dev-wgc.png`가 남아 있다). 개발용 실행 파일을 띄워 WebView2 디버깅 포트로 게임 창 칸·명령 3개·단축키 3개 등록·없는 명령 거부를 확인했다.
- **차단 — `live_game.rs`를 통과시키지 못했다.** 첫 캡처 뒤 몇 분 사이에 게임 창이 최소화됐고(05:47경 발견, 06:06까지 그대로) 이 작업은 게임 창을 복원할 수 없다. 다섯 테스트 모두 "게임 창이 최소화돼 있다"로 실패했고, 가려진 창 캡처·캡처 전후 창 상태 비교·오버레이에서의 실제 저장·붙이기 위치는 확인되지 않았다(최소화 경로는 CLI·앱에서 실제로 확인됨). 누가 최소화했는지 모른다: 직전에 `PrintWindow`를 한 번 시험했는데(FALSE로 실패) 관계가 있는지 확인할 수 없어 그 코드를 완전히 뺐다. **재개 조건: 사용자가 게임 창을 다시 띄운 뒤** `cargo test --manifest-path app/src-tauri/Cargo.toml --test live_game -- --ignored`(1초쯤 게임 화면 가운데에 자홍색 네모가 뜬다)와 `node scripts/verify.mjs P-011`을 돌린다. 캡처 뒤에 게임 창이 또 최소화되면 WGC 쪽을 의심해야 한다. 그 밖에 `manual_checks` 3개와 캡처 순간의 노란 테두리는 사람 몫이고, 포트 1420에 다른 세션의 Vite 서버가 떠 있다(건드리지 않았다). docs.rs는 이 세션에서 열 수 없어 `windows` API는 컴파일·실행으로만 확인했다.
- P-011 2회차 (2026-11-12 06:07~): 실패 원인은 코드가 아니라 환경이다 — 게임 창(hwnd 3345878)이 계속 최소화돼 있다(`nikke-capture --info`가 `minimized: true`, 이 앱의 프로세스는 떠 있지 않았고 전경 창은 다른 프로그램, 누가 최소화했는지는 여전히 모른다). 게임 창 복원은 "게임은 읽기만 한다"에 어긋나 하지 않았고, `live_game.rs`는 그대로 뒀다(지우거나 약하게 하지 않음). 대신 게임 없이 같은 캡처 함수를 실제 WGC로 확인하는 `tests/live_capture.rs`(`#[ignore]` 4건, 테스트가 띄운 자기 창)를 더했다: 클라이언트 영역 잘라 내기가 가장자리 한 픽셀까지 맞고, 가려진 창에서 가리개 색 0픽셀, 최소화 → `Minimized` → 다시 띄우면 캡처, 캡처 전후 창 상태 동일 — 4건 통과.
- 그 테스트가 결함 하나를 찾아 고쳤다: Windows 11이 창 아래 모서리를 둥글게 깎아 그 픽셀이 검게(테두리 선은 테두리 색으로) 찍혀서 **한 색뿐인 화면이 빈 화면으로 판정되지 않고 저장**됐다(05:41의 실제 게임 캡처에서도 같은 모서리 픽셀 확인). `blank_kind`가 네 모서리 24×24픽셀(작은 프레임은 변의 1/4)을 판정에서 빼게 했고, 그에 맞춰 단위 테스트 1건의 자리("마지막·첫 픽셀" → 모서리 밖 11곳)를 바꾸고 2건을 더했다 — 요구(한 색 프레임은 오류)를 지키려는 변경이다. 검증: 루트 단위 102, 프런트 115·빌드, Rust 단위 94 + 엔진 통합 6, `live_capture` 4, `cargo clippy --all-targets` 경고 없음. 문서: `app/README.md`(§한계의 둥근 모서리, §게임 없이 캡처 경로 확인), 루트 `CLAUDE.md` 명령.
- **여전히 차단 — `live-game` 검증은 게임 창이 떠 있어야만 통과한다.** 세션 끝까지 15분쯤 읽기 전용으로 지켜봤지만 최소화 그대로였다. 재개 조건: 사용자가 게임 창을 다시 띄운 뒤(작업 표시줄에서 니케를 누른다) `node scripts/verify.mjs P-011`. 3회차도 창이 최소화돼 있으면 같은 이유로 실패한다 — 하네스의 `requires_cmd`가 프로세스 유무만 보기 때문이다(`nikke-capture --info`의 `minimized`까지 보게 하면 "환경 없음"으로 구분된다 — tasks.json은 건드리지 않았다). 게임 창으로는 아직 확인 못 한 것: 가려진 게임 창 캡처, 캡처 전후 게임 창 상태 비교, `manual_checks` 3개.
- P-011 3회차 (2026-11-12 06:27~): 코드는 바꾸지 않았다. 실패 원인은 또 환경이다 — 게임 창(hwnd 3345878)이 여전히 최소화돼 있다(`GetWindowPlacement` showCmd=2, 복원 자리 (99,51) 2228×1283은 그대로). 읽기 전용으로 바탕 화면을 보니 Steam·Chrome·ChatGPT·Discord도 함께 최소화돼 있고 전경은 Claude 데스크톱 앱이라, 이 앱이 아니라 사용자(또는 대화형 세션)가 창을 내려 둔 것으로 보인다(추정). 앱·테스트 코드에 게임 창 상태를 바꾸는 호출이 없는 것도 다시 확인했다(`ShowWindow`는 `live_capture.rs`가 자기 창에만 쓴다).
- 검증: 루트 단위 102, 프런트 빌드·115, Rust 단위 94 + 엔진 통합 6 통과, `nikke-capture --info`는 종료 코드 0(`minimized: true`). `live_game` 5건은 돌리지 못했다 — 06:32~07:02 동안 5초마다 `--info`로 지켜봤지만 창이 뜨지 않았다. 게임 창 복원은 "게임은 읽기만 한다"에 어긋나 하지 않았고, 테스트도 그대로 뒀다.
- **차단(시도 3/3 소진) — 재개 조건: 사용자가 작업 표시줄에서 니케 창을 다시 띄운 뒤** `node scripts/verify.mjs P-011`(가운데에 자홍색 네모가 1초쯤 뜬다). 게임 창으로 아직 확인 못 한 것: 가려진 게임 창 캡처, 캡처 전후 게임 창 상태 비교, `manual_checks` 3개. 하네스의 `requires_cmd`가 프로세스 유무만 봐서 최소화 상태가 "환경 없음"이 아니라 실패로 기록된다(`tasks.json`은 건드리지 않았다).
- P-016 (2026-11-12): **계산 중단** — `engine.rs`에 `StopSignal`·`BatchSlot`·`run_batch_with_stop`·`EngineError::Stopped`("중단됨: …"), 명령 `engine_cancel`(build.rs·capability 포함, 앱 명령 13개), 엔진 프로세스는 Job Object로 묶어 끝낸다(`engine_win32.rs` — Job 없이는 엔진이 띄운 자식이 출력 파이프를 쥐어 호출이 300초 동안 돌아오지 않는 것을 가짜 엔진으로 확인). 화면: 도는 동안에만 `중단` 단추, 중단하면 `중단됨` 줄 + 계산 전 결과 복원(`ComputePanel.vue`·`App.vue`). **활성화 없이 보이기** — `overlay_state.rs`의 `VisibilityChange::{ShowWithoutActivating, Hide}`, Windows는 `overlay_win32.rs`의 `ShowWindowAsync(SW_SHOWNA/SW_HIDE)`, 그 밖은 기존 `show()/hide()`. **파일 고르기 창** — 오버레이 창 핸들을 `DialogParent`로 명시해 넘기고, 핸들을 못 얻으면 부모 없이 띄우지 않는다. 설명은 `app/README.md` §계산 중단·§포커스·§파일 고르기 창.
- 검증: 루트 단위 154, 프런트 빌드·145건(「계산 중단」 7건 + 계약 6건 추가), Rust 단위 102 + `engine_batch` 6 + `engine_cancel` 2(실제 엔진 40건 중 4건 끝난 뒤 멈춤 → 약 0.01초에 `중단됨`, python 4개 모두 사라짐, 같은 자리로 재실행 성공), clippy 경고 없음. `Win32_Security`·`Win32_System_JobObjects` 기능과 `raw-window-handle`(이미 끌어오던 0.6.2) 직접 의존을 더했다.
- 남은 문제: **실제 창에서는 하나도 눌러 보지 않았다** — `manual_checks` 2개(게임 입력이 안 끊기는지, 고르기 창이 앞에 뜨는지)와 중단 단추·숨겼다 다시 보인 창이 제대로 그려지는지는 사람 몫. 창 라이브러리(tao) 소스는 읽지 못했다(`~/.cargo` 읽기 권한 없음): 시작 뒤 보임/숨김을 Win32로만 바꿔 tao는 창이 계속 보인다고 알므로, 숨긴 동안 창 스타일을 바꾸는 호출을 더하면 창이 나타날 수 있다(지금은 규칙이 막는다). 클릭 통과 전환이 포커스를 안 바꾸는 것은 tao의 동작에 기대고 있다(우리 코드는 활성화 호출이 없다). 앱이 죽으면 돌던 엔진은 배치를 마칠 때까지 남는다.
- (P-004) 남은 점: `formatDamage`는 안전한 정수(약 9,007조)를 넘는 값도 RangeError로 본다. 표의 열 맞춤은 한글을 두 칸으로 세는 방식이라 글꼴에 따라 어긋날 수 있다.
- P-012 (2026-11-12, 중단된 실행을 이어서 마침): `src/core/cache.mjs`의 `withCache(runtime, store)`(키 = 엔진 커밋 + 정규화된 요청의 SHA-256(Web Crypto), 결정론·오류 아님·엔진 clean일 때만 저장/읽기, 적중은 엔진에 안 보내고 입력 순서로 합침, 저장소 고장은 경고) + `createMemoryStore`, Node 파일 저장소 `createFileCacheStore`(`src/runtime/node.mjs`, 기본 `data/cache/sim/`), 결과 문서 `cache: {hits, misses, stored, warnings}`와 표의 `캐시:` 줄, CLI `--no-cache`·`--cache-dir`. 엔진 버전에 `dirty`를 더했다(Node·Rust `engine::version` 같은 값). 오버레이는 메모리 저장소(`app/src/lib/runtime.ts`의 `simCache`, `compute.ts`가 감쌈)와 결과 화면의 캐시 줄. 형식·무효화 규칙은 `docs/data-model.md` §시뮬 결과 캐시.
- 검증: 루트 단위 134건(캐시 32건), 통합 18건(`cache.engine.test.mjs` 3건 — 실제 엔진으로 두 번째 compare가 엔진 호출 0건·수치 동일, CLI는 없는 python을 줘도 두 번째가 성공, 깨진 파일·쓸 수 없는 폴더는 경고만), 프런트 122건·빌드, Rust 단위 94 + 엔진 통합 6, clippy 경고 없음. 기본 폴더로 CLI를 두 번 돌려 `적중 0·계산 3·저장 3` → `적중 3·계산 0`도 봤다. 기존 CLI 통합 테스트 3개는 실제 엔진을 계속 부르도록 `--no-cache`를 붙였고(`npm run fixture`도), 프런트 `ComputeFlow.test.ts`의 `start` 도우미는 해시가 진짜 비동기라 "엔진에 닿거나 끝날 때까지" 기다리게 바꿨다(단언은 그대로).
- 남은 문제: 파일 캐시에는 크기 제한·자동 정리가 없다(폴더를 지우면 된다). 엔진 커밋 밖의 변화(파이썬 버전, 추적 안 되는 엔진 파일)는 가르지 못한다. 오버레이의 캐시는 가짜 IPC 테스트로만 확인했다 — 실제 창(개발·릴리스 빌드)에서 `crypto.subtle`이 되는지와 두 번째 실행이 곧바로 끝나는지는 눈으로 보지 않았다(안 되면 계산은 되고 "캐시 키를 만들 수 없어" 경고가 보인다). 성장 비교 화면은 여전히 없다.
- P-013 (2026-11-12): `suggest`가 2단계가 됐다 — 1단계 멤버 조합 → 2단계 상위 K개(기본 5) 조합의 배치 변형(`src/core/search.mjs`: `placementVariants`·`planRefinement`·`pickBestPlacement`, 흐름은 `candidates.mjs`의 `suggestSquads`). 변형은 엔진 문서의 두 가지만 바꾼다: 같은 버스트 단계 안의 순서(GAMEPLAY.md §버스트 사용 순서와 배치)와 3번 자리의 카메라 대상(CONTROL.md §카메라) — 서명이 같은 배치는 한 번만, 원래 배치는 1단계 결과를 그대로 후보에 넣는다. 예산(기본 120)은 엔진에 맡기는 요청 수의 상한이고(캐시 적중도 센다) 못 본 수는 caveats·`suggestion.search`에 적힌다. 순위는 조합마다 가장 좋은 배치 하나 + `placement`와 `배치 탐색: …` 메모. CLI `--refine`(기본)/`--no-refine`·`--budget`·`--refine-top`, 오버레이는 `예산` 칸·`배치 탐색` 체크·단계/예산 진행 표시·`탐색:` 줄. 형식·근거는 `docs/data-model.md` §배치 탐색.
- 검증: 루트 단위 154건(`search.test.mjs` 20건 — 가짜 엔진이 단계 안 순서·3번 자리로 총딜을 바꾼다), 통합 19건(실제 엔진: `--refine` 1위 ≥ `--no-refine` 1위, 시뮬 ≤ 예산), 프런트 132건·빌드, Rust 단위 94 + 엔진 통합 6, 하네스 자체 검증 14/14. 실제 엔진으로 규칙을 확인했다: 샘플 두 조합의 120가지 배치를 전부 돌리니 총딜을 가른 것은 단계 안 순서였고(29.5억~38.7억) 3번 자리·그 밖의 자리 차이는 0.1% 이하. 기본 설정 샘플 추천은 87건(30 + 57)에 1위 39.72억 → 40.28억. 1단계만 가정하던 기존 테스트 여섯 곳은 `refine: false`/`--no-refine`/체크 해제를 붙였고(단언은 그대로), `cache.test.mjs`의 추천 통계 기대값은 두 단계 합으로 바꿨다.
- 남은 문제: 규칙 확인은 샘플 계정·솔로 레이드 S40 두 조합뿐이다(다른 계정·보스 미확인). 운용 지정(`no_burst`·`burst_sequence`), 스킬로 단계가 바뀌는 니케, 무기 변경 차지형, 좌표 모드 보스의 카메라 조준은 보지 않는다. 0.001%대의 차이도 "배치를 바꿨다"로 고른다(메모에 비율이 그대로 보인다). 오버레이의 새 칸·진행 표시는 가짜 IPC 테스트로만 확인했다 — 실제 창에서 줄바꿈·표시는 눈으로 보지 않았다.
- P-015 (2026-11-12): 자동 티어 2단계 — `src/tier/evaluate.mjs`(`buildTier`: 엔진 기본 스펙·솔로 레이드 S40에서 기준 편성 5개(`data/tier/reference-squads.json`, 하네스 `SQUADS`의 S40 실사용 상위)의 같은 버스트 단계 자리에 바꿔 넣어 점수 = 팀 총딜 비율의 최댓값, 자기가 든 편성 제외, 보류 7종(미파싱·효과 없음·프리뷰·단계 미상·대조 없음·시뮬 오류·예산), 미지원 경고 표시, 예산·40건 묶음·캐시) · `rules.mjs` + `data/tier/rules.json`(임시 경계 SSS 1.05~D 0) · `render.mjs` · `loadEngineData`(`src/runtime/node.mjs`) · CLI `tier build [--only] [--budget] [--json] [--references] [--rules]`. 문서: `docs/tier-method.md`, `docs/data-model.md` §티어 결과, `CLAUDE.md` 명령.
- 검증: 루트 단위 191건(`tier.test.mjs` 37건, 가짜 엔진), 통합 20건(`tier.engine.test.mjs` — 실제 엔진 4명·시뮬 27건 42초, 헬름의 최고 자리를 캐시 없이 엔진에 직접 물은 값과 일치, 두 번째 실행 전부 캐시 적중·항목 동일, `--budget 12`에서 2명 평가 보류(예산)), 프런트 빌드·145건 통과. 표본 20명(시뮬 162건)도 실제 엔진으로 돌렸다: 0.645(솔져 O.W.)~1.182(라피 : 레드 후드).
- 남은 문제: **전원 계산(1,769건, 30~40분 추정)은 돌리지 않았고 등급 경계는 임시다**(대표 사례 미검증 — 결과 caveats에 실린다). 표본에서 본 방법의 한계(`docs/tier-method.md` §한계): 최고 자리가 가장 약한 기준 편성으로 쏠리고(19명 중 11명이 `S40_앨리스모더니아` 38억), 기준 편성 멤버는 자기 편성이 빠져 낮게 나온다(도로시 : 세렌디피티 0.906). 엔진이 경고로 알리지 않는 미지원 스킬 효과는 못 잡고, 미지원 판정은 경고 문구(`효과 모델이 없`·`미지원`)에 기댄다 — 지금 엔진·시나리오에서는 그 경고가 실제로 나오지 않아 가짜 엔진으로만 확인했다. 오버레이에는 티어 화면이 없다.
- P-018 (2026-11-12): 요격전 보스별 편성 추천 — `src/core/intercept.mjs`(`validateBossBundle`·`resolveElement`·`bossCondition`·`unconfirmedOf`·`splitBudget`·`recommendIntercept`: 보스마다 `suggestSquads`, 결과 `kind: intercept_report`) + `renderInterceptReport` + CLI `intercept --account [--bosses] [--boss] [--top 3] [--budget 300] [--json] [--no-cache]`, 실제 보스 묶음 `data/intercept/anomaly.json`(문서 표 그대로: 속성·약점·상한 400·보상만, 나머지 7칸은 미확인)과 샘플 `data/samples/bosses.anomaly.sample.json`. 조건에 `anomaly_interception`·`interception`·`level_cap`, 계정에 `account.synchro_level` 검사를 더했다 — 엔진 레벨 정책은 `fixed`·`sync` 둘이라 상한 조건은 min(동기화 레벨, 상한)을 `sync`로 보내고, 동기화 레벨이 없으면 상한으로 가정했다고 caveats에 적는다(`levelPlan`, 상한 없는 기존 조건의 요청은 그대로). 속성 상성 표·기본 적은 엔진에서 옮겨 적고(`calculator/damage.py` `_CODE_ADVANTAGE`, `timeline.py` `DEFAULT_ENEMY`) 통합 테스트가 엔진과 대조한다. 문서: `docs/data-model.md` §보스 묶음·§요격전 추천 결과·§전투 조건 §레벨, `CLAUDE.md` 명령.
- 검증: 루트 단위 220건(`intercept.test.mjs` 29건, 가짜 엔진), 통합 25건(`intercept.engine.test.mjs` 5건 27초 — 실제 엔진으로 앨리스(작열)는 풍압 보스에서, 리틀 머메이드(풍압)는 철갑 보스에서 딜이 더 크고 속성 없는 적에서는 보너스가 없음, 레벨 258 < 400, 샘플 계정 + 실제 묶음 예산 15건으로 보스 5종 추천, 두 번째 실행은 전부 캐시 적중·같은 문서), 프런트 빌드·145건 통과. 기본 예산 300건 전체 실행은 돌리지 않았다(크라켄 한 보스 30건은 실제로 돌려 봤다).
- 남은 문제: **실제 요격전 기록과 대조한 적이 없다**(`manual_checks`). 방어력·코어·파츠·거리·전투 시간·패턴을 몰라 엔진 기본 적(솔로 레이드 Lv 400 방어력 31,784, 코어·파츠 없음, 180초)으로 계산한다 — 보스 사이의 차이는 속성 상성뿐이다. 후보 풀은 투자 점수로만 골라 보스마다 같다 — 덜 키운 약점 속성 니케는 후보에 없을 수 있다(결과의 `weak_pool`·메모에 이름이 나온다. 약점 속성을 우선하는 후보 생성은 별도 작업). `sync`는 편성 전원을 같은 레벨로 본다(소대 밖 니케의 실제 레벨 미반영). 샘플 계정에는 동기화 레벨이 없어 실제 엔진의 CLI 경로는 "상한 400 가정"만 탔다(258 경로는 요청 단위 통합 테스트로 확인). 오버레이 화면은 없다(P-017).
- P-019 (2026-11-12): 요격전 화면 인식 — `app/src-tauri/src/recognize.rs`(순수: `Frame`만 받음, OCR·ML·새 의존성·이미지 조각 없음). 화면 비율로 적은 자리 12곳에서 2,000점만 찍어 색을 센다: 보스 테마 색(초록·보라·빨강·주황·파랑 — 아래 가장자리 띠, 선택 화면의 `도전하기` 단추·좌우 화살표, 편성 화면의 이름 칸 막대·정보 칸 날개)과 단추 색(아래 탭 빨강, `모의전` 파랑·`전투 진입` 빨강). 한 화면의 표지가 모두 같은 보스 색일 때만 그 화면·보스이고, 빠지거나 섞이면 `unknown`, 아래 띠가 없으면 `other`, 16:9(±3%)가 아니면 `unknown`. 결과 `{screen, boss{id,name}, confidence, evidence, width, height}`. `capture.rs`에 `load_png`·`grab_game_frame`(저장 없이 찍기), 명령줄 `--recognize <PNG>`·`--recognize-live`, 앱 명령 `recognize_game_screen`(build.rs·capability 14개), 프런트 타입 `ScreenRecognition`·`recognizeGameScreen()`. 문서: `app/README.md` §화면 인식, `docs/intercept.md` §인식 근거, `CLAUDE.md` 명령.
- 검증: 루트 단위 220, 프런트 빌드·151건(계약 테스트에 인식 6건 추가), Rust 단위 137(인식 28·명령줄 5·PNG 읽기 2 추가) + 엔진 통합 8, `live_recognize` 6건(라벨 16장 전부 정답, 0.6·0.8·1.25배·1280×720·1920×1080 다시 샘플링, 밝기 ±10%·잡음 ±8, 4:3·21:9는 `unknown`, 캡처 없는 폴더에서는 이유를 말하고 실패), `cargo clippy --all-targets` 경고 없음. 인식 한 번 평균 릴리스 35~36µs·디버그 147~149µs(1881×1058). 실제 게임에서 `--recognize-live` 2회: 그때 화면은 니케 목록이었고 `other`(따로 찍어 눈으로 확인 후 삭제).
- 남은 문제: **이상 개체 화면을 띄운 채 라이브로 돌려 보지 못했다**(`manual_checks` 2개 — 보스 넘겨 가며 확인, 다른 창 크기·전체 화면). 기준값은 한 계정·하루·창 모드 1881×1058 캡처에서 쟀다 — 게임이 창 크기에 따라 UI를 같은 비율로 그리는지, 16:9가 아닐 때 어떻게 그리는지 모른다. 보스를 넘기는 도중·팝업이 덮인 화면은 캡처가 없어 합성 이미지로만 `unknown`/`other`를 확인했다. 보스는 테마 색으로만 가린다(보스 추가·색 변경 시 다시 재야 한다). 앱 명령은 컴파일·계약 테스트까지이고 실제 창에서 불러 보지 않았다(같은 경로를 명령줄 라이브로는 탔다). 화면(Vue) 연동과 인식 결과로 추천을 자동으로 보여 주는 일은 다음 작업이다.
- P-017 (2026-11-12): 오버레이를 탭 네 개로 나눴다(`app/src/App.vue` + `src/screens/` — 추천·비교(기존, `CompareScreen`으로 옮김) / 요격전 / 성장 / 티어, 마지막 탭 기억, 탭을 옮겨도 상태 유지). 요격전(`InterceptScreen`·`InterceptView`: 보스 단추 → 고른 보스의 약점·상위 편성·멤버별 딜, 빨간 `속성 상성 미반영`·주황 `미확인 값 N칸`, 약점 속성 멤버 표시, 마지막으로 고른 보스와 **마지막 결과 문서를 localStorage에 기억**해 앱을 다시 열면 바로 보인다), 성장(`GrowthScreen`·`GrowthView`), 티어(`TierScreen`·`TierView`: 결과 파일만 읽는다 — 등급별 묶음·버스트 필터·평가 보류 따로·`미지원 효과 있음` 강조·임시 규칙 문구는 스크롤해도 고정). 실행은 `lib/compute.ts`의 `runIntercept`·`runGrowth`가 루트의 `recommendIntercept`·`compareGrowth`를 그대로 부르고, 진행 표시·중단은 추천과 같은 코드로 뽑아냈다(`lib/engineRun.ts`·`RunStatus`·`RunButtons` — `ComputePanel`도 이것을 쓴다, 한 번에 한 탭만 계산). 잘못된 결과 파일(다른 종류·다른 판)은 `lib/reports.ts`가 한국어로 거부하고 이전 화면을 둔다. Rust·권한은 바꾸지 않았다(결과 파일은 `read_json_file`). fixture 셋(`intercept`·`growth`·`tier`)을 실제 CLI로 만들었다 — 명령은 `app/scripts/fixtures.mjs`와 `app/README.md` §테스트 입력.
- 검증: 하네스 명령 6개 통과 — 루트 단위 220, 통합 25, 프런트 빌드·250건(기존 151건은 고치지 않고 통과, 새 99건: `InterceptView` 23·`GrowthView` 16·`TierView` 19·`reports` 8·`ScreensFlow` 31·계약 2), Rust 단위 137 + 엔진 통합 8.
- 남은 문제: **실제 창에서도 브라우저에서도 그려 보지 못했다**(이 세션은 브라우저를 띄울 권한이 없다) — 440px에서의 폭·줄바꿈·색, 요격전 첫 화면에 보스·1위 편성이 스크롤 없이 들어가는지, 웹뷰의 실제 localStorage 복원은 `manual_checks`와 `app/README.md` §사람이 확인할 것에 남겼다(CSS는 읽어서만 점검). 추천·비교 탭은 예전대로 읽기 실패·계산 시작 때 이전 순위를 치우고, 새 화면들은 이전 결과를 남긴다(동작이 다르다 — README에 적음). 기억해 둔 요격전 결과는 계정·보스 값이 바뀌어도 그대로 보인다(알림 문구만 있다). 인식한 보스를 요격전 화면에서 자동으로 고르는 연동, 티어 `미지원 효과` 표시의 실제 엔진 사례(가짜 문서로만 확인), 오버레이 안에서의 티어 계산은 없다.
