# 진행 상황

마지막 갱신: 2026-11-12 (대화형 세션 + 자율 실행 2회)

## 지금 상태

- 단계 1(계산 경로)이 실제 엔진으로 동작한다: 편성 비교(`compare`), 후보 편성 추천(`suggest`),
  성장 투자 비교(`growth`), 엔진 데이터 변경 감지(`detect-changes`), 프로필 파일 가져오기(`import-profile`).
- 하네스가 실제 Fable 5.2(`claude-fable-5-2`, effort high)로 작업 5건(P-004~P-008)을 구현·검증·체크포인트까지 끝냈다.
  전부 첫 시도에 통과했다.
- 남은 작업: P-009 Electron 오버레이 골격.

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

검증: 단위 94건, 실제 엔진 통합 15건, 하네스 자체 검증 11개 시나리오 통과. `node scripts/verify.mjs --status`로 확인한다.

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
- **자율 실행 결과물의 코드 리뷰.** 테스트 통과와 샘플 실행만 확인했다. P-005~P-008 코드를 줄 단위로 검토하지 않았다.
- RapiLab·nikke_project는 README만 읽었다.
- 오버레이·화면 캡처는 시작하지 않았다.

## 차단

없다. (2026-11-12 CLI 인증 실패는 사용자 재로그인으로 해결됐다.)

## 다음 작업

1. P-009 Electron 오버레이 골격 — `app/` 폴더, npm 의존성 설치 필요, 실제 게임 위 확인은 사용자 몫.
   `node scripts/autopilot.mjs --task P-009`
2. 이후 후보(작업 목록에 아직 없다): 게임 창 추적·캡처, 재화 제약을 넣은 성장 추천, 티어 산출 규칙,
   유니온 레이드(5덱 배분), 편성 탐색 고도화(배치 순서·시너지).

## 자율 실행 기록

CLI가 보고한 값이다(구독 사용 시 실제 청구액과 다를 수 있다).

| 작업 | 시간 | 턴 | CLI 보고 비용 |
|---|---|---|---|
| P-004 | 1.4분 | 12 | $0.77 |
| P-005 | 6.0분 | 31 | $2.79 |
| P-006 | 6.6분 | 48 | $3.76 |
| P-007 | 5.9분 | 45 | $3.20 |
| P-008 | 12.7분 | 75 | $6.97 |

## 알아 둘 것

- 엔진 시뮬 1회가 4~5초다. 배치는 최대 4개 프로세스로 병렬 실행한다(`runBatch`의 `concurrency`).
- Windows 콘솔은 cp949다. 엔진을 직접 부를 때 `PYTHONUTF8=1`이 필요하다(어댑터는 자동 설정).
- Windows에서는 autopilot이 죽으면 에이전트 프로세스도 함께 끝난다. POSIX에서는 남을 수 있어
  재시작 시 확인한다(`--kill-orphan`).
- 같은 5명이라도 배치 순서에 따라 총딜이 달라진다(샘플 A 편성: 34.63억 ↔ 순서만 바꾼 후보 38.69억). 엔진이 자리로
  카메라·버스트 순서를 정하기 때문이다. 후보 생성기는 배치 순서를 하나만 만든다 — 탐색 고도화 때 다룰 것.
- `.refs/`는 후보 저장소를 얕게 복제한 참고용 폴더다(gitignore). 지워도 된다.
- 하네스 설정(`.harness/config.json`)의 권한: `acceptEdits` + `node`·`npm`·`python`·`git status/diff/log`만 허용.

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
- 남은 문제(범위 밖이라 고치지 않음, 위 "알아 둘 것" 마지막 항목): 엔진이 적지 않은 칸을 기본 스펙으로 계산하므로 수동 계정의 적지 않은 칸과 모든 미확인 칸이 실제보다 높게 계산된다 — P-002~P-006 결과와 "미육성으로 계산했다"는 메모에 영향. 고치려면 `toEngineProfile`이 미육성 값을 채워 넘기게 하고 `account.test.mjs`·샘플 수치를 함께 바꿔야 한다(별도 작업 필요). 가져온 계정은 칸을 모두 적어 영향이 없지만 미확인 칸이 남은 니케는 같은 문제를 겪는다.
- (P-004) 남은 점: `formatDamage`는 안전한 정수(약 9,007조)를 넘는 값도 RangeError로 본다. 표의 열 맞춤은 한글을 두 칸으로 세는 방식이라 글꼴에 따라 어긋날 수 있다.
