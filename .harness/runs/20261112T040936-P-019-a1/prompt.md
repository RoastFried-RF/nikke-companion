너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-019
제목: 요격전 화면 인식: 화면 종류와 선택된 보스
설명: 캡처한 게임 화면에서 (1) 화면 종류 — 이상 개체 보스 선택(anomaly_select) / 이상 개체 편성(anomaly_squad) / 그 밖(other) — 와 (2) 이상 개체 화면이면 어느 보스가 선택됐는지를 알아낸다. 나중에 오버레이가 이 결과로 그 보스의 추천 편성을 자동으로 보여 준다(그 연동은 이 작업이 아니다). Rust(app/src-tauri)에 순수 모듈로 만든다(Win32·파일 접근 없이 capture::Frame만 받는다). **먼저 docs/intercept.md(보스 5종, §화면 구성)를 읽고, data/captures/labels.json과 그 폴더의 캡처 16장을 Read 도구로 직접 보라** — 무엇이 화면과 보스를 구분하는지는 이미지를 보고 정한다. 캡처는 사용자 계정의 게임 화면이라 gitignore돼 있고 커밋하지 않는다. 캡처에서 뽑은 기준값(위치 비율·색 범위 같은 수치)은 코드에 넣어도 되지만, 게임 이미지 조각(픽셀 템플릿)은 저장소에 넣지 않는다. 큰 의존성(OCR 엔진·ML 런타임)을 더하지 않는다 — 그것 없이는 안 된다고 판단하면 구현을 억지로 하지 말고 이유와 필요한 것을 progress.md에 적고 끝내라. 게임은 읽기만 한다(P-011과 같은 규칙).

수락 조건:
- 인식 결과: 화면 종류, 보스(이상 개체 화면일 때), 신뢰도, 근거(무엇을 보고 그렇게 판단했는지 사람이 읽을 수 있는 설명). 기준에 못 미치면 화면 종류는 unknown, 보스는 없음이다 — 추측으로 채우지 않는다. 보스를 다른 보스로 잘못 말하는 것보다 모른다고 하는 쪽을 택한다
- 해상도와 무관하다: 위치를 화면 비율로 다룬다. 라벨 캡처를 0.6배·0.8배·1.25배로 다시 샘플링해도 같은 결과가 나온다. 화면 비율이 크게 다른 프레임(예: 4:3, 21:9)은 틀린 답 대신 unknown이거나, 지원한다면 테스트로 보인다
- 라벨 캡처 16장 전부에서 정답: anomaly_select 6장과 anomaly_squad 5장은 화면 종류와 보스가 맞고, 나머지 5장(로비·요격전 탭·일반 개체 편성 2장·특수 개체 편성)은 이상 개체 화면이 아니라고 나온다. 이 테스트는 캡처가 있어야 돌므로 `#[ignore]`로 app/src-tauri/tests/live_recognize.rs에 둔다(캡처가 없으면 이유를 말하고 실패)
- 단위 테스트는 코드로 그린 합성 이미지로 한다(캡처 없이 돈다): 판정 함수, 경계값, unknown 처리, 밝기 ±10%와 약한 잡음에서 결과 유지, 두 보스의 특징이 섞인 이미지는 unknown
- 명령줄: `nikke-capture --recognize <PNG 파일>`은 인식 결과를 JSON 한 줄로 출력한다. `nikke-capture --recognize-live`는 게임 창을 찍어 인식만 하고 이미지는 저장하지 않는다(게임이 없으면 종료 코드 2)
- 앱 명령 `recognize_game_screen`: 게임 창을 찍어 인식 결과만 돌려준다(이미지는 저장하지도 화면에 넘기지도 않는다). capability에 이 명령만 더한다. 화면(Vue) 연동은 이번 작업이 아니다 — 타입과 backend 함수까지만
- 인식 한 번에 걸리는 시간을 재서 app/README.md에 적는다(1881×1058 프레임, 릴리스·디버그 빌드). 프레임 전체를 여러 번 훑지 않는다
- 문서: app/README.md §화면 인식(방법·한계·기준값을 어떻게 정했는지), docs/intercept.md §화면 구성에 인식 근거를 덧붙인다. 루트 CLAUDE.md 명령 목록 갱신
- 기존 테스트가 계속 통과하고 `cargo clippy --all-targets`에 경고가 없다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- cargo test --manifest-path app/src-tauri/Cargo.toml
- cargo test --manifest-path app/src-tauri/Cargo.toml --test live_recognize -- --ignored

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 실제 게임에서 보스를 넘겨 가며 `nikke-capture --recognize-live`가 맞는 보스를 말한다
- 다른 창 크기·전체 화면에서도 인식된다

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.