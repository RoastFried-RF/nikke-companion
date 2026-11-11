너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-008
제목: blablalink 계정 가져오기
설명: 엔진의 scraper/profile_fetch.py가 만든 프로필(profiles/*.json)을 우리 계정 상태 형식으로 변환한다. src/core/import-profile.mjs + CLI `import-profile <파일>`. 로그인 세션을 얻거나 쿠키를 다루는 일은 하지 않는다 — 사용자가 직접 받은 프로필 파일을 입력으로 받는다.

수락 조건:
- 엔진 프로필 형식의 예시 파일을 계정 상태로 바꾸고 validateAccount를 통과한다
- 변환하지 못한 칸은 unknown으로 남긴다
- 결과는 is_test_data:false, source:import로 표시하고 data/accounts/에 쓴다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 사용자가 자기 계정으로 받은 프로필 파일을 변환해 인게임 육성 상태와 대조

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.