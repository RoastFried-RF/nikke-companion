너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-009
제목: Tauri 오버레이 골격
설명: app/ 폴더에 Tauri v2 + Vue 3 + Vite + TypeScript 데스크톱 앱을 만든다(자체 package.json, 루트와 분리). 이 작업은 골격이다: 오버레이 창과 단축키, 비교 결과 JSON 파일을 읽어 순위를 그리는 화면까지. 엔진 호출·게임 창 추적·화면 캡처는 다음 작업(P-010 이후)이다. Tauri v2 API는 기억에 의존하지 말고 설치된 패키지의 타입·문서로 확인하라. Rust 코드는 app/src-tauri/에 둔다. 결정 배경은 docs/spec.md §5.

수락 조건:
- 창: 테두리 없음·투명 배경·항상 위·작업 표시줄에 안 보임. 시작 시 화면 오른쪽 위 근처, 조작 가능한 상태
- 전역 단축키 Alt+Shift+C로 클릭 통과를 켜고 끈다. Alt+Shift+O로 창을 숨기고 보인다. 현재 상태가 화면에 보인다(클릭 통과 중에는 눈에 띄는 표시)
- 오버레이 상태(보임/숨김, 클릭 통과 여부)의 전환 규칙은 창 API와 분리된 Rust 코드로 두고 단위 테스트한다
- Rust 명령 load_report(path): 비교 결과 JSON(docs/data-model.md §비교 결과, schema_version 1)을 읽어 돌려준다. 없는 파일·JSON 아님·schema_version 불일치는 한국어 오류 메시지. 단위 테스트가 있다
- Vue 컴포넌트가 비교 결과를 그린다: 순위, 총딜(단위 표기와 원값), 1위 대비 비율, 멤버별 딜과 비중, 메모, 계산하지 않은 편성과 사유, 엔진이 실패한 편성, 주의 문구, 검증용 데이터 표시, 엔진 버전
- 대미지 단위 표기는 src/core/format.mjs를 그대로 가져다 쓴다(복제 금지)
- 컴포넌트 테스트가 있다. 입력은 실제 CLI(`node src/cli.mjs compare … --json`)로 만든 샘플 결과를 app 안의 fixture로 저장한 것이다
- 앱은 네트워크 요청을 하지 않는다. Tauri capability는 쓰는 것만 허용한다
- app/node_modules·app/dist·app/src-tauri/target이 .gitignore에 있다. Cargo.lock과 package-lock.json은 커밋 대상이다
- app/README.md에 개발 실행·빌드 방법과 단축키가 적혀 있다. 루트 CLAUDE.md의 명령 목록에 app 명령을 추가한다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- cargo test --manifest-path app/src-tauri/Cargo.toml
- cargo build --manifest-path app/src-tauri/Cargo.toml
- node --test tests/unit/

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 앱을 실행하면 오버레이 창이 뜨고 샘플 결과를 불러와 순위가 보인다
- Alt+Shift+C로 클릭 통과가 전환되고, 켜진 상태에서 창 아래 프로그램이 클릭된다
- 실제 니케 PC판 위에서 오버레이가 보인다(창 모드·전체 화면)
- 클릭 통과 상태에서 게임 입력을 방해하지 않는다
- Alt+Tab·창 이동·크기 변경 뒤에도 동작한다

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.