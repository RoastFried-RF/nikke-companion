너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-010
제목: 코어 런타임 분리 + 오버레이에서 편성 비교·추천 실행
설명: Tauri에는 Node 런타임이 없다. (1) src/core의 계산 모듈(account, condition, compare, candidates, growth, format, render)이 node: 모듈을 정적으로 import하지 않게 한다: 엔진 실행(runBatch)·카탈로그 읽기·엔진 버전을 런타임 객체로 주입받게 하고, Node 구현은 src/runtime/node.mjs로 옮긴다(CLI와 기존 테스트는 이것을 쓴다). (2) Rust 명령 engine_catalog, engine_version, engine_run_batch를 만든다: `python -m runner.sim --batch`를 최대 4개 프로세스로 병렬 실행, 입력 순서 보존, 줄 단위 오류 전달, 시간 제한, PYTHONUTF8=1. 엔진 폴더와 python 경로는 설정값. (3) 오버레이에서 계정 파일과 조건 파일을 골라 추천(suggest)·비교(compare)를 실행하고 결과를 P-009의 화면에 그린다. 진행 중 표시와 오류 표시가 있다. Rust로 계산 로직을 다시 쓰지 않는다.

수락 조건:
- tests/unit/에 정적 검사가 있다: 위 계산 모듈 파일에 node: import가 없다
- 기존 단위·통합 테스트가 계속 통과한다. CLI 동작은 그대로다
- Rust engine_run_batch의 통합 테스트가 실제 엔진(vendor/nikke-calc)으로 통과한다: 순서 보존, 한 건 오류가 다른 건을 막지 않음, 결정론
- 같은 요청에 대해 Node 런타임과 Rust 명령의 total_damage가 같다는 것을 확인하는 검증이 있다
- 프런트에서 Tauri 런타임을 주입해 suggestSquads·compareSquads를 부르는 코드의 테스트가 있다(런타임은 가짜로 대체)

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- node --test tests/integration/
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- cargo test --manifest-path app/src-tauri/Cargo.toml

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 앱에서 샘플 계정으로 추천을 실행해 순위가 보인다
- 실제 계정 파일로 실행해 인게임 기록과 대조

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.