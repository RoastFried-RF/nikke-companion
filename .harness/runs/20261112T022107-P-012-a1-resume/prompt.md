너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-012
제목: 시뮬 결과 캐시
설명: 엔진 시뮬 1회가 4~5초라 탐색·티어 계산이 느리다. 같은 엔진 버전·같은 요청의 결과를 다시 계산하지 않게 한다. src/core/cache.mjs에 런타임을 감싸는 withCache(runtime, store)를 만든다(계산 모듈은 node: import 금지 — 해시는 Web Crypto, 저장소는 주입). Node 저장소는 src/runtime/node.mjs 쪽에 두고 data/cache/sim/(gitignore)에 쓴다. 오버레이(app)는 이번에는 메모리 저장소만 쓴다. CLI의 compare·suggest·growth가 기본으로 캐시를 쓰고 --no-cache로 끈다.

수락 조건:
- 캐시 키 = 엔진 커밋 + 요청의 정규화된 JSON(키 순서와 무관, id 같은 호출용 칸 제외)의 해시. 엔진 커밋이 다르면 다른 키다
- 결정론이 보장되는 요청만 저장한다(sim.expected=true 또는 seed 지정). 그렇지 않은 요청, 오류 결과, 엔진 작업 트리가 dirty이거나 커밋을 모를 때는 저장하지도 읽지도 않는다
- 배치에서 적중한 요청은 엔진에 보내지 않고, 빗나간 요청만 보낸 뒤 입력 순서대로 합친다
- 결과 문서(비교·성장)에 cache: {hits, misses, stored}가 실린다. CLI 표 출력에도 한 줄로 보인다
- 저장소가 깨졌거나 읽을 수 없으면 캐시 없이 계산하고 경고를 남긴다(실패하지 않는다)
- 단위 테스트: 키 정규화, 저장 조건, 부분 적중 합치기, 깨진 저장소. 통합 테스트: 같은 compare를 두 번 돌리면 두 번째는 엔진 호출 0건이고 수치가 같다
- data/cache/가 .gitignore에 있다. docs/data-model.md에 캐시 형식과 무효화 규칙을 적는다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- node --test tests/integration/
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- cargo test --manifest-path app/src-tauri/Cargo.toml

이전 실행이 이 작업 도중에 중단됐다. `git status`로 남아 있는 변경을 확인하고 버리지 말고 이어서 하라.

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.