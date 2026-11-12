너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-013
제목: 편성 탐색 고도화: 배치 순서 탐색과 시뮬 예산
설명: 같은 5명이라도 배치 순서에 따라 총딜이 달라진다(샘플: 34.63억 ↔ 38.69억). 지금 후보 생성기는 배치를 하나만 만든다. suggest를 2단계로 만든다: (1) 기존 생성기로 멤버 조합을 만들어 계산, (2) 상위 조합에 대해 배치 변형을 만들어 다시 계산. 배치가 무엇에 영향을 주는지는 엔진 문서(vendor/nikke-calc/docs/GAMEPLAY.md의 버스트 사용 순서와 배치, docs/CONTROL.md의 카메라)를 읽고 그 근거로 변형 규칙을 정한다 — 무작위 순열을 다 돌리지 않는다. 전체 시뮬 횟수에 예산을 둔다. src/core/candidates.mjs를 확장하거나 src/core/search.mjs를 새로 만든다. CLI: suggest에 --refine(기본 켜짐)/--no-refine, --budget <시뮬 횟수>.

수락 조건:
- 배치 변형 규칙이 엔진 문서의 어느 내용에 근거하는지 코드 주석과 docs/data-model.md에 적혀 있다
- 2단계는 1단계 상위 K개 조합(기본 5)에만 적용하고, 조합마다 원래 배치를 반드시 포함한다 — 그래서 2단계 결과의 최고 총딜은 1단계 최고 이상이다
- 시뮬 횟수가 예산(기본 120)을 넘지 않는다. 예산이 모자라 건너뛴 것이 있으면 결과 caveats에 몇 개를 못 봤는지 적는다
- 같은 입력이면 같은 결과가 같은 순서로 나온다
- 결과 순위는 멤버 조합당 가장 좋은 배치 하나만 보여 주고, 배치로 얻은 차이(1단계 대비 비율)를 메모로 남긴다
- 단위 테스트(가짜 엔진: 배치에 따라 총딜이 달라지게)로 위 조건을 확인한다. 통합 테스트: 샘플 계정에서 --refine 결과의 1위 총딜 ≥ --no-refine 1위 총딜
- 오버레이의 추천 실행도 같은 함수를 쓴다(화면 변경은 최소: 예산·진행 표시가 맞게 나오면 된다)

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- node --test tests/integration/
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- cargo test --manifest-path app/src-tauri/Cargo.toml

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.