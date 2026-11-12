# 진행 상황

마지막 갱신: 2026-11-12 (대화형 세션 — 사용자가 자는 동안 자율 진행)

## 지금 상태

- 끝난 작업 12건(H-001~P-010). **P-011(게임 창 추적·캡처)은 구현은 끝났지만 "환경 대기"다** — 아래 "차단".
- 대기 중: P-012(시뮬 캐시) → P-013(배치 순서 탐색) → P-014(유니온 5덱) → P-015(자동 티어 2단계) →
  P-016(오버레이 다듬기) → P-017(오버레이 화면). 게임이 필요 없는 작업들이라 P-011을 기다리지 않는다.
- 계산 경로: 편성 비교(`compare`), 후보 추천(`suggest`), 성장 투자 비교(`growth`), 엔진 데이터 변경 감지
  (`detect-changes`), 프로필 파일 가져오기(`import-profile`). Node CLI와 Tauri 오버레이가 같은 계산 모듈을 쓴다.
- 오버레이(`app/`, Tauri v2 + Vue 3): 투명·항상 위 창, 단축키, 결과 파일 표시, 앱 안에서 추천·비교 실행,
  게임 창 상태 표시·화면 저장(Alt+Shift+S)·게임 창에 붙이기(P-011, 실게임 검증 대기).
- **화면 인식(레이드·로스트 섹터)은 시작하지 못했다.** 인식에 쓸 화면 캡처가 로비 1장뿐이다 — 아래 "게임 조작".

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
- 화면 인식은 시작하지 않았다(캡처 부족).

## 차단

- **P-011 — 환경 대기.** 게임 창이 최소화돼 있어(2026-11-12 05:47경부터. 누가 내렸는지는 모른다 — 앱·테스트 코드에는
  게임 창 상태를 바꾸는 호출이 없다) `live_game.rs` 5건을 돌리지 못했다. 코드 실패가 아니다: 단위·프런트·Rust 테스트,
  clippy, 게임 없이 같은 캡처 경로를 확인하는 `live_capture` 4건은 통과했다(대화형 세션에서 다시 돌려 확인).
  **재개: 니케 창을 다시 띄운 뒤 `node scripts/verify.mjs P-011 --record`** (가운데에 자홍색 네모가 1초쯤 뜬다 — 테스트의
  가리개 창이다). 게임 창으로 아직 확인 못 한 것: 가려진 게임 창 캡처, 캡처 전후 게임 창 상태 비교, `manual_checks` 3개.
  Claude가 창을 다시 띄우지 않은 이유: 작업 표시줄을 누르려면 사용자 승인(파일 탐색기 접근)이 필요했고,
  Win32 호출로 관리자 권한 창을 건드리는 것은 하지 않기로 한 일이다.
- (해결됨: CLI 인증은 재로그인으로, Rust 툴체인은 사용자 설치로 — rustc 1.99.1, MSVC.)

## 다음 작업

1. `node scripts/autopilot.mjs` — P-012부터 순서대로. 묶음마다 대화형 세션이 점검한다.
2. 사용자 몫: (a) 니케 창을 띄우고 P-011 검증 기록, (b) 화면 캡처 수집(위 "게임 조작"), (c) 실제 계정 프로필
   (`vendor/nikke-calc/scraper/profile_fetch.py`, blablalink 로그인은 사용자가 한다) → `import-profile` → 인게임 기록 대조,
   (d) 오버레이 `manual_checks`(P-009·P-010·P-011).
3. 캡처가 모이면: 화면 종류 인식 → 레이드 보스·조건 읽기 → 로스트 섹터 가이드. 입력 자동화(R9)는 그 뒤, 별도 결정으로.
4. 재화 제약을 넣은 성장 추천(R4 투자 효율), 실측 대조 뒤 티어 규칙 확정.

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
  환경 변수가 실제로 듣는지는 다음 실행의 기록으로 확인한다.

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
- (P-004) 남은 점: `formatDamage`는 안전한 정수(약 9,007조)를 넘는 값도 RangeError로 본다. 표의 열 맞춤은 한글을 두 칸으로 세는 방식이라 글꼴에 따라 어긋날 수 있다.
- P-012 (2026-11-12, 중단된 실행을 이어서 마침): `src/core/cache.mjs`의 `withCache(runtime, store)`(키 = 엔진 커밋 + 정규화된 요청의 SHA-256(Web Crypto), 결정론·오류 아님·엔진 clean일 때만 저장/읽기, 적중은 엔진에 안 보내고 입력 순서로 합침, 저장소 고장은 경고) + `createMemoryStore`, Node 파일 저장소 `createFileCacheStore`(`src/runtime/node.mjs`, 기본 `data/cache/sim/`), 결과 문서 `cache: {hits, misses, stored, warnings}`와 표의 `캐시:` 줄, CLI `--no-cache`·`--cache-dir`. 엔진 버전에 `dirty`를 더했다(Node·Rust `engine::version` 같은 값). 오버레이는 메모리 저장소(`app/src/lib/runtime.ts`의 `simCache`, `compute.ts`가 감쌈)와 결과 화면의 캐시 줄. 형식·무효화 규칙은 `docs/data-model.md` §시뮬 결과 캐시.
- 검증: 루트 단위 134건(캐시 32건), 통합 18건(`cache.engine.test.mjs` 3건 — 실제 엔진으로 두 번째 compare가 엔진 호출 0건·수치 동일, CLI는 없는 python을 줘도 두 번째가 성공, 깨진 파일·쓸 수 없는 폴더는 경고만), 프런트 122건·빌드, Rust 단위 94 + 엔진 통합 6, clippy 경고 없음. 기본 폴더로 CLI를 두 번 돌려 `적중 0·계산 3·저장 3` → `적중 3·계산 0`도 봤다. 기존 CLI 통합 테스트 3개는 실제 엔진을 계속 부르도록 `--no-cache`를 붙였고(`npm run fixture`도), 프런트 `ComputeFlow.test.ts`의 `start` 도우미는 해시가 진짜 비동기라 "엔진에 닿거나 끝날 때까지" 기다리게 바꿨다(단언은 그대로).
- 남은 문제: 파일 캐시에는 크기 제한·자동 정리가 없다(폴더를 지우면 된다). 엔진 커밋 밖의 변화(파이썬 버전, 추적 안 되는 엔진 파일)는 가르지 못한다. 오버레이의 캐시는 가짜 IPC 테스트로만 확인했다 — 실제 창(개발·릴리스 빌드)에서 `crypto.subtle`이 되는지와 두 번째 실행이 곧바로 끝나는지는 눈으로 보지 않았다(안 되면 계산은 되고 "캐시 키를 만들 수 없어" 경고가 보인다). 성장 비교 화면은 여전히 없다.
- P-013 (2026-11-12): `suggest`가 2단계가 됐다 — 1단계 멤버 조합 → 2단계 상위 K개(기본 5) 조합의 배치 변형(`src/core/search.mjs`: `placementVariants`·`planRefinement`·`pickBestPlacement`, 흐름은 `candidates.mjs`의 `suggestSquads`). 변형은 엔진 문서의 두 가지만 바꾼다: 같은 버스트 단계 안의 순서(GAMEPLAY.md §버스트 사용 순서와 배치)와 3번 자리의 카메라 대상(CONTROL.md §카메라) — 서명이 같은 배치는 한 번만, 원래 배치는 1단계 결과를 그대로 후보에 넣는다. 예산(기본 120)은 엔진에 맡기는 요청 수의 상한이고(캐시 적중도 센다) 못 본 수는 caveats·`suggestion.search`에 적힌다. 순위는 조합마다 가장 좋은 배치 하나 + `placement`와 `배치 탐색: …` 메모. CLI `--refine`(기본)/`--no-refine`·`--budget`·`--refine-top`, 오버레이는 `예산` 칸·`배치 탐색` 체크·단계/예산 진행 표시·`탐색:` 줄. 형식·근거는 `docs/data-model.md` §배치 탐색.
- 검증: 루트 단위 154건(`search.test.mjs` 20건 — 가짜 엔진이 단계 안 순서·3번 자리로 총딜을 바꾼다), 통합 19건(실제 엔진: `--refine` 1위 ≥ `--no-refine` 1위, 시뮬 ≤ 예산), 프런트 132건·빌드, Rust 단위 94 + 엔진 통합 6, 하네스 자체 검증 14/14. 실제 엔진으로 규칙을 확인했다: 샘플 두 조합의 120가지 배치를 전부 돌리니 총딜을 가른 것은 단계 안 순서였고(29.5억~38.7억) 3번 자리·그 밖의 자리 차이는 0.1% 이하. 기본 설정 샘플 추천은 87건(30 + 57)에 1위 39.72억 → 40.28억. 1단계만 가정하던 기존 테스트 여섯 곳은 `refine: false`/`--no-refine`/체크 해제를 붙였고(단언은 그대로), `cache.test.mjs`의 추천 통계 기대값은 두 단계 합으로 바꿨다.
- 남은 문제: 규칙 확인은 샘플 계정·솔로 레이드 S40 두 조합뿐이다(다른 계정·보스 미확인). 운용 지정(`no_burst`·`burst_sequence`), 스킬로 단계가 바뀌는 니케, 무기 변경 차지형, 좌표 모드 보스의 카메라 조준은 보지 않는다. 0.001%대의 차이도 "배치를 바꿨다"로 고른다(메모에 비율이 그대로 보인다). 오버레이의 새 칸·진행 표시는 가짜 IPC 테스트로만 확인했다 — 실제 창에서 줄바꿈·표시는 눈으로 보지 않았다.
