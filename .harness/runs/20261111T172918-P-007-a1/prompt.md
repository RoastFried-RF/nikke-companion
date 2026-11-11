너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-007
제목: 신규 니케·데이터 변경 감지 (자동 티어 1단계)
설명: 엔진 서브모듈의 두 커밋 사이에서 data/parsed_nikke.json·parsed_skills.json을 비교해 추가·변경된 니케 목록을 낸다. src/tier/detect.mjs + CLI `detect-changes --from <커밋> --to <커밋>`. 스킬이 미파싱인 니케는 '평가 보류'로 구분한다. 티어 산출은 이 작업 범위가 아니다.

수락 조건:
- 추가·변경·삭제를 구분한 목록을 JSON으로 낸다
- 미파싱 니케를 평가 보류로 표시한다
- 가짜 데이터 두 판으로 단위 테스트한다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.