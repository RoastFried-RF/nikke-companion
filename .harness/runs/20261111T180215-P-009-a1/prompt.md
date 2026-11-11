너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-009
제목: Electron 오버레이 골격
설명: Electron + Vue 3 + Vite + TypeScript 창. 항상 위·투명·클릭 통과 토글·단축키, 비교 결과 JSON을 읽어 표시. 앱은 app/ 폴더에 둔다(자체 package.json). 의존성 설치가 필요하다. 게임 창 추적과 캡처는 다음 작업.

수락 조건:
- 빌드가 통과한다
- 비교 결과 JSON을 읽어 순위를 그리는 컴포넌트 테스트가 통과한다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- node --test tests/unit/

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 실제 니케 PC판 위에서 오버레이가 보인다(창 모드·전체 화면)
- 클릭 통과 상태에서 게임 입력을 방해하지 않는다
- Alt+Tab·창 이동·크기 변경 뒤에도 동작한다

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.