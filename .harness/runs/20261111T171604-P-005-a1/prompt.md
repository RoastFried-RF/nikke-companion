너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-005
제목: 후보 편성 생성기
설명: 보유 니케에서 후보 편성을 만든다. src/core/candidates.mjs에 generateCandidates(account, catalog, options)를 만들고 CLI에 `suggest` 명령을 추가한다(계정+조건 → 후보 생성 → compareSquads → 상위 N개). 전수 탐색은 하지 않는다: 버스트 1·2·3단계를 모두 갖춘 5인만 만들고, options.limit(기본 30)으로 개수를 제한한다. 어떤 기준으로 후보를 줄였는지 결과의 caveats에 적는다. 설계 참고: .refs가 없으면 RapiLab은 읽지 않아도 된다.

수락 조건:
- 생성된 모든 편성은 보유 니케 5명, 중복 없음, 버스트 1·2·3단계 포함
- 같은 입력이면 같은 후보가 같은 순서로 나온다
- limit을 넘지 않는다. 줄인 기준이 결과에 적힌다
- tests/unit/candidates.test.mjs에 위 조건의 테스트가 있고 통과한다
- 샘플 계정으로 `node src/cli.mjs suggest`가 실제 엔진으로 상위 편성을 출력하는 통합 테스트가 있다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- node --test tests/integration/

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.