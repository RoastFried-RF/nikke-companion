# 진행 상황

마지막 갱신: 2026-11-12 (첫 세션, 대화형 Fable 5.2)

## 지금 상태

- 단계 1(계산 경로)의 첫 경로가 실제 엔진으로 동작한다:
  `계정 상태 → 전투 조건 → nikke-calc → 편성 비교 → CLI 표·JSON`.
- 최소 하네스가 동작한다(자체 검증 11개 시나리오 통과).
- **실제 모델로 하네스를 돌리는 것은 막혀 있다.** 아래 "차단" 참고.

## 구현한 것

| 작업 | 내용 | 검증 |
|---|---|---|
| H-001 | `scripts/autopilot.mjs` · `verify.mjs` · `harness-lib.mjs` · `harness-selftest.mjs` | `node scripts/harness-selftest.mjs` 통과 |
| P-001 | `src/core/engine.mjs` — nikke-calc 병렬 배치 호출 | 통합 테스트 통과 |
| P-002 | `src/core/account.mjs` · `condition.mjs` · `docs/data-model.md` | 단위 테스트 통과 |
| P-003 | `src/core/compare.mjs` · `render.mjs` · `src/cli.mjs` · `data/samples/` | 단위 15건 + 실제 엔진 통합 5건 통과 |

결정과 근거: `docs/spec.md` §5, `docs/engine-selection.md`.

## 미검증

- **수치의 실전 정확도.** 샘플 계정은 검증용 데이터(`is_test_data: true`)다. 실제 계정·인게임 기록과
  대조한 적이 없다 (P-003 `manual_checks`).
- RapiLab·nikke_project는 README만 읽었다. 빌드·실행하지 않았다.
- 오버레이·화면 캡처·계정 가져오기는 시작하지 않았다.
- 하네스의 실제 모델 경로: 프롬프트 전달, 권한 설정(`--permission-mode acceptEdits` + `--allowedTools`),
  결과 JSON의 모델·사용량 기록은 **실제 성공 실행으로 확인하지 못했다.**

## 차단

**Claude Code CLI 인증 실패 (H-002, 그리고 autopilot으로 돌릴 모든 작업)**
- 증상: `claude -p --model claude-fable-5-2 --effort high` → `401 OAuth access token is invalid`.
  `claude auth status`는 로그인됨으로 나오지만 토큰이 무효다.
- 하네스 동작: 2회 연속 모델 호출 실패로 기록하고 종료 코드 4로 멈췄다. P-004의 시도 횟수는 0 그대로다
  (`.harness/runs/20261111T170854-P-004-a1/`).
- 재개 조건: 사용자가 터미널에서 `claude auth login`으로 다시 로그인한다.
  CLI가 2.1.114(2026-04)라 로그인 뒤에도 `claude-fable-5-2`를 모르면 `claude update`가 필요할 수 있다.
- 재개 방법:
  1. `node scripts/autopilot.mjs --task P-004` — 작은 실제 작업 1건
  2. `node scripts/verify.mjs H-002 --record` — 실제 모델 실행 기록 확인
  3. `node scripts/autopilot.mjs` — 나머지 작업

## 다음 작업

1. P-004 대미지 단위 표기 (수락 테스트 `tests/unit/format.acceptance.test.mjs`가 이미 있다. 지금은 이 테스트가
   실패하므로 `node --test tests/unit/` 전체는 P-004 전까지 실패한다 — 의도된 상태)
2. P-005 후보 편성 생성기 → P-006 성장 투자 비교 → P-007 신규 니케 감지 → P-008 계정 가져오기
3. P-009 Electron 오버레이 골격 (실제 게임 위 확인 필요)

## 알아 둘 것

- 엔진 시뮬 1회가 4~5초다. 배치는 최대 4개 프로세스로 병렬 실행한다(`runBatch`의 `concurrency`).
- Windows 콘솔은 cp949다. 엔진을 직접 부를 때 `PYTHONUTF8=1`이 필요하다(어댑터는 자동 설정).
- Windows에서는 autopilot이 죽으면 에이전트 프로세스도 함께 끝난다. POSIX에서는 남을 수 있어
  재시작 시 확인한다(`--kill-orphan`).
- `.refs/`는 후보 저장소를 얕게 복제한 참고용 폴더다(gitignore). 지워도 된다.
- **엔진은 인라인 프로필에 항목이 있는 니케의 적지 않은 칸을 미육성이 아니라 기본 스펙으로 계산한다**(P-008에서 실제 엔진으로
  확인: `base: "ungrown"`에서 빈 항목 `{}`의 총딜 = 기본 스펙 총딜. 미육성은 항목이 아예 없는 이름에만 쓰인다 —
  `runner/spec.py` `build_char`·`GrowthProfile.layer`. 엔진 문서 SIM-JSON §육성의 설명과 다르다). `toEngineProfile`은
  미육성 값을 채우지 않으므로 "적지 않은 칸·미확인 칸은 미육성 값으로 계산"이라는 우리 문서·메모는 지금 사실이 아니다. 미해결.

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
