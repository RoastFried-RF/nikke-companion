너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-004
제목: 대미지 한국어 단위 표기 (억·만)
설명: src/core/format.mjs에 formatDamage(n)을 만들고 src/core/render.mjs의 총딜·멤버 딜 표시에 쓴다. 표에는 단위 표기와 원값(천 단위 구분)을 함께 보여 준다. 결과 JSON의 수치는 바꾸지 않는다.

수락 조건:
- tests/unit/format.acceptance.test.mjs가 통과한다
- 기존 단위·통합 테스트가 계속 통과한다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/format.acceptance.test.mjs
- node --test tests/unit/
- node --test tests/integration/

수정·삭제 금지 경로 (바꾸면 검증이 실패한다):
- tests/unit/format.acceptance.test.mjs

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.