너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-018
제목: 요격전(이상 개체) 보스별 편성 추천
설명: 사용자가 말하는 "레이드"는 이상 개체 요격전이다(docs/spec.md §5 결정 기록). 이상 개체 5종 각각에 대해 보유 니케로 총딜이 가장 큰 편성을 추천한다. **먼저 docs/intercept.md를 읽어라** — 게임 화면에서 확인한 사실(보스 5종의 이름·속성·약점, 최대 레벨 400 제한)과 모르는 것(방어력·코어·파츠·거리·전투 시간·패턴)이 나뉘어 적혀 있다. 엔진(vendor/nikke-calc)에는 요격전 보스 프리셋이 없으므로(data/boss_presets.json에는 솔로 레이드 S40뿐) 조건의 적 설정(enemy: def·code·core_px·distance·has_parts·part_break_interval·optimal_range_weapons)으로 보스를 표현한다. 확인된 값만 넣고, 모르는 값은 미확인으로 표시한다 — 기억이나 추정으로 채우지 마라. 값은 "보스 묶음" 파일로 받는다: 실제 값은 data/intercept/anomaly.json(docs/intercept.md의 표를 옮긴다. 게임 사실이라 커밋한다), 테스트용은 data/samples/bosses.anomaly.sample.json. src/core/intercept.mjs(순수 모듈, node: import 금지) + CLI `intercept --account <계정> [--bosses <보스 묶음, 기본 data/intercept/anomaly.json>] [--boss <이름 또는 id>] [--top N] [--budget <시뮬 횟수>] [--json <결과 파일>] [--no-cache]`. 오버레이(app/)는 이번 작업에서 건드리지 않는다(P-017).

수락 조건:
- 조건 content에 요격전 종류(anomaly_interception, interception)를 더한다. 기존 조건 파일과 기존 명령은 그대로 동작한다
- 보스 묶음 형식(schema_version, content, bosses[]): 보스마다 id, name, 적 설정(enemy), 약점 속성(weak_to — 선택), 레벨 상한(선택), 전투 시간(선택), 값의 출처(source), 확인 여부(어느 칸이 확인됐고 어느 칸이 미확인인지)를 담는다. 검사 함수가 한국어 오류를 경로와 함께 돌려준다
- 실제 보스 묶음 data/intercept/anomaly.json: docs/intercept.md의 다섯 보스(이름·보스 속성·약점·레벨 상한 400·보상)를 그대로 옮기고 출처를 적는다. 문서에 없는 값(방어력·코어·파츠·거리·전투 시간)은 넣지 않고 미확인으로 표시한다
- 보스 속성과 약점의 관계를 엔진의 속성 상성 규칙(엔진 코드에서 읽는다 — 위치를 주석과 docs/data-model.md에 적는다)과 대조하는 검사가 있다: 약점이 보스 속성에 우월한 속성이 아니면 오류다. 실제 보스 묶음의 다섯 보스가 이 검사를 통과하는지 테스트한다. weak_to만 있는 보스는 같은 규칙으로 적 속성을 정한다
- 속성 상성이 실제 계산에 반영되는지 실제 엔진으로 확인하는 통합 테스트: 같은 편성을 적 속성만 다른 두 보스에 돌리면, 그 속성에 우위인 니케의 딜이 우위일 때 더 크다
- 레벨 정책: 이상 개체 요격전은 "최대 레벨 400 제한"(고정이 아니라 상한)이다. 지금 조건은 엔진 정책 fixed(400 고정)만 쓴다. 엔진이 지원하는 레벨 정책을 엔진 코드·문서에서 확인하고, 계정의 실제 레벨을 상한까지 반영하는 계산이 가능하면 그렇게 하고(계정 상태에 필요한 칸이 없으면 더한다 — 형식 문서와 검사 포함), 불가능하면 지원하는 것처럼 계산하지 말고 무엇을 가정했는지 결과 caveats에 한계로 적는다
- 보스별 추천: 보스마다 기존 추천(suggestSquads — 배치 탐색 2단계와 캐시 포함)을 돌려 상위 편성 N개(기본 3), 멤버별 딜, 1위 대비 비율을 낸다. 전체 시뮬 예산(기본 300)을 보스 수로 나눠 지키고, 예산 때문에 줄인 것은 caveats에 적는다. 같은 입력이면 같은 결과다
- 미확인 값이 있는 보스의 결과에는 무엇이 미확인이고 그 칸을 무엇(엔진 기본값)으로 계산했는지가 붙는다. 적 속성을 모르는 보스는 계산은 하되 "속성 상성 미반영"이 결과와 표 출력에서 눈에 띈다. 미확인을 0이나 확정값처럼 다루지 않는다
- 결과 문서(kind: intercept_report): 보스별 결과(보스 이름·속성·약점·보상 포함), 가정, 엔진 버전, 캐시 통계, caveats("실제 요격전 기록과 대조하지 않았다", 보스 패턴 미반영 포함). 표 출력(render)과 --json 저장. docs/data-model.md에 보스 묶음·결과 형식을 적는다
- 샘플 data/samples/bosses.anomaly.sample.json: is_test_data: true, 보스 5개(이름은 "시험 보스 A"~"E"), 일부는 weak_to만, 일부는 속성 미상으로 둬서 변환과 표시가 테스트된다
- 단위 테스트(가짜 런타임): 형식 검사, 약점·속성 대조와 변환, 예산 나누기, 미확인 표시, 결정론. 통합 테스트: 샘플 계정 + 실제 보스 묶음으로 실제 엔진을 불러 보스 5종의 추천이 나온다(예산을 작게 잡아 3분 안쪽)
- 루트 CLAUDE.md의 명령 목록에 intercept 예시를 더한다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- node --test tests/integration/
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 사용자 실제 계정으로 추천을 돌려 인게임 요격전 기록(모의전 대미지)과 대조한다

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.