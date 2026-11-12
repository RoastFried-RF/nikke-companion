너는 이 저장소의 자율 개발 루프에서 작업 하나를 맡았다.
먼저 CLAUDE.md, docs/spec.md, .harness/progress.md를 읽어라.

작업 ID: P-033
제목: 계정 여러 개·즐겨찾기·모듈 기록·도구 링크
설명: 먼저 docs/ui-redesign.md(개편의 구조·원칙·부품)를 읽어라. 이 작업은 커뮤니티 도구 모음(니케 마이너 갤러리 "니케 유용한 툴 모음집")의 도구들을 대화형 세션이 직접 열어 보고 고른 기능이다 — 그 사이트들의 코드·이미지·데이터는 가져오지 않고 기능의 아이디어만 참고한다. 계산은 src/core의 순수 모듈(node: import 금지)로 만들고 엔진(vendor/nikke-calc)은 고치지 않는다. 엔진이 지원하지 않는 것은 지원하는 것처럼 계산하지 말고 "지원하지 않음"으로 화면과 결과에 적는다. 화면은 P-026의 부품으로 그리고 데스크톱 앱 창(P-027)에 넣는다. 화면의 글은 일반 사용자가 읽는 한국어다. 시험 데이터는 data/samples/만 쓴다(실제 계정 파일을 읽지 않는다). 참고한 것: 니케 장비 현황(계정1·계정2 전환, 미사용 니케 표시), 레츠도로(마이페이지 니케 즐겨찾기), 모듈 기록 시트(커스텀 모듈·요격전 보상 기록), 모음집 글 자체(유용한 도구 링크 모음). **이 작업**: 자잘하지만 매일 쓰는 편의 기능.

수락 조건:
- 계정 여러 개: 계정 파일이 여럿이면(본계·부계) 설정과 화면 위쪽에서 바꾼다. 계정마다 결과·기록·편성 저장이 따로다. 계정을 지우는 기능은 파일을 지우지 않고 목록에서 숨긴다(지우려면 파일 위치를 알려 준다)
- 즐겨찾기·미사용: 니케에 즐겨찾기 별과 "안 씀" 표시를 붙인다. 내 니케·덱 빌더에서 거르기에 쓰이고, 추천 계산에서 "안 씀" 니케를 빼는 선택이 있다(뺐다는 사실이 결과에 남는다)
- 모듈 기록: 날짜별로 이상 개체 보스, 달성 단계, 얻은 것(장비 부위·커스텀 모듈 수)을 손으로 적는 기록장. 주·월 합계와 보스별 횟수가 보인다. P-029의 요격전 기록과 한 화면에서 본다. 저장은 계정 폴더
- 도구 링크: 커뮤니티 도구 목록(이름·한 줄 설명·주소 — 저장소의 데이터 파일로 두고 출처가 모음집 글임을 적는다)을 보여 주고 누르면 **기본 브라우저**로 연다. 앱이 그 사이트의 내용을 가져오지는 않는다. 여는 주소는 목록에 있는 것뿐이다(화면이 임의 주소를 열 수 없다 — 테스트). 목록에는 대화형 세션이 직접 열어 확인한 것만 넣는다: 레츠도로 https://letsdoro.com/ , 니케 장비 현황 https://nikkegear885.github.io/nikke-/ , 딜도로 https://dildoro.com/ , Enikk https://enikk.app/ , 도로파티 https://doroparty.com/ , 니케 금서고 https://nikkeforbiddenlibrary.com/ , NIKKE PvP META https://inspiring-hotteok-9de45f.netlify.app/ , NIKKE DECK https://nikke-deck.com/ko/deck , NIKKE Arena Tools https://nikke.top/ , 소장품 강화 시뮬레이터 https://changjoeconomy.github.io/collectibles/ , 니붕 시뮬레이터 https://nibung.kr/ , 니케피그 https://nikkefig.com/ , 홍련 농장 https://scarletfarm.app/
- 이 앱이 하지 않는 것을 도구 링크 화면에 적는다: PVP 계산(엔진이 PVP를 계산하지 않는다), 통계·랭킹(서버 데이터가 필요하다), 스토리 열람, 유니온 구인 — 해당 도구로 안내한다
- 단위 테스트(순수 함수)와 화면 테스트(가짜 backend)가 있고, 실제 엔진을 쓰는 통합 테스트가 한 건 이상 있다(3분 안쪽). 기존 테스트가 계속 통과하고 cargo clippy --all-targets에 경고가 없다. docs/data-model.md·docs/ui-redesign.md·app/README.md·루트 CLAUDE.md를 갱신한다

하네스가 네가 끝난 뒤 직접 실행할 검증 명령 (네가 미리 돌려 봐도 된다):
- node --test tests/unit/
- node --test tests/integration/
- npm --prefix app install
- npm --prefix app run build
- npm --prefix app test
- cargo test --manifest-path app/src-tauri/Cargo.toml

실제 환경에서 사람이 확인할 항목 (네가 완료로 처리하지 마라):
- 부계 프로필을 받아 계정 전환이 되는지
- 도구 링크가 기본 브라우저로 열린다

규칙:
- 이 작업만 하라. 다른 작업을 시작하지 마라.
- .harness/tasks.json과 .harness/runs/는 건드리지 마라. 상태는 하네스가 기록한다.
- 커밋하지 마라. 검증을 통과하면 하네스가 체크포인트 커밋을 만든다.
- 끝나면 .harness/progress.md의 "최근 작업 메모"에 한 일과 남은 문제를 3줄 이내로 적어라.
- 수락 조건을 만족할 수 없으면 이유와 필요한 것을 progress.md에 적고 끝내라. 질문으로 끝내지 마라.