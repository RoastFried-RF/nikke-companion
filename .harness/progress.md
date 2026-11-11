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

## 최근 작업 메모

- P-004 (2026-11-12): `src/core/format.mjs`에 `formatDamage`(조·억 소수 둘째 자리 버림, 만 정수 버림)를 만들고 `render.mjs`의 총딜·멤버 딜에 단위 표기와 원값을 함께 표시. 결과 JSON 수치는 그대로다.
- 검증: 수락 테스트 6건, `tests/unit/` 21건, `tests/integration/` 5건 통과. 샘플 CLI 출력도 눈으로 확인했다.
- 남은 점: `formatDamage`는 안전한 정수(약 9,007조)를 넘는 값도 RangeError로 본다. 표의 열 맞춤은 한글을 두 칸으로 세는 방식이라 글꼴에 따라 어긋날 수 있다.
