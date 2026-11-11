# 주 계산 엔진 선택

확인일: 2026-11-12. 세 후보를 얕게 복제해 직접 확인했다.

## 후보

| | RapiLab | nikke-calc | nikke_project |
|---|---|---|---|
| 저장소 | `fienn-eda/RapiLab` | `Jgaram/nikke-calc` | `HKHKM-dev/nikke_project` |
| 확인한 리비전 | `26a7d04` (2026-08-23, 기본 브랜치 `wip/scaffolding`) | `67835ca` (2026-11-02) | `0fd9818` (2026-11-11) |
| 라이선스 | MIT | MIT | MIT(코드) |
| 언어 | Python(FastAPI) + React | Python, 표준 라이브러리만 | TypeScript |
| 지원 니케 | README 기준 86명 | `data/parsed_skills.json` 209명 | 미확인 |
| 계정 가져오기 | 있음(blablalink) | 있음(`scraper/profile_fetch.py`) | 수동 입력 |
| 편성 탐색 | 있음(솔로·유니온) | 없음(평가기) | 없음 |
| 외부 호출 계약 | 내부 HTTP API | 요청·결과 JSON 스키마, 배치, 결정론 보장 문서화 | 없음 |
| 직접 실행 | **안 함** | **함** | 안 함 |

## 실제로 확인한 것 (nikke-calc)

- Python 3.12.3에서 `python -m runner.sim "리틀 머메이드,크라운,라피 : 레드 후드,헬름,앨리스" --expected`
  → 총딜 2,528,963,704. 약 4.6초.
- `python -m unittest discover -s tests` → 39건 통과(21초).
- `--batch --expected`에 인라인 프로필을 실은 요청 → 결과 JSON, 모르는 니케는 그 줄만
  `invalid_input` 오류(`path: /squad/0`).
- 보스 프리셋 `솔로 레이드 S40` 사용 가능.

## 선택: nikke-calc

1. 지원 범위가 넓다(209명 대 86명). 내 계정의 주요 니케가 빠질 가능성이 낮다.
2. 다른 프로그램이 평가기로 부르도록 만든 계약이 있다(`docs/SIM-JSON.md`). 인라인 육성 프로필,
   기대값 모드 결정론, 결과에 평가기 커밋이 실린다 → 우리 결과에 엔진 버전을 남길 수 있다.
3. 의존성이 없어 설치·패키징 부담이 작다.
4. 스킬 원문을 효과 데이터로 옮기는 절차와 미지원 표기가 있어 R5(자동 티어)와 맞는다.
5. 최근까지 갱신된다(확인 시점 10일 전).

## 감수하는 것

- **편성 탐색이 없다.** 우리가 만든다. 시뮬 1회가 4~5초라 전수 탐색은 불가 → 후보 필터와
  병렬 배치가 필요하다(단계 2).
- UI가 없다. 어차피 오버레이용 UI는 새로 만든다.
- 수치는 엔진 문서가 스스로 "참고용"이라 밝힌다. 실전 대조는 별도 과제다.

## RapiLab의 위치

코드를 결합하지 않는다. 편성 탐색 구조(`backend/app/deck_search.py`, `deck_allocation.py`)와
엔진 한계 문서(`docs/engine-gaps.md`)를 설계 참고로 읽는다. 서로 다른 가정의 수치를 섞지 않는다.
빌드·실행은 하지 않았으므로 "RapiLab이 동작한다"는 확인된 사실이 아니다.

## 엔진 갱신 절차

`vendor/nikke-calc`의 커밋을 올릴 때는 `node scripts/verify.mjs --all`로 기존 작업의 검증을
새 엔진에서 다시 돌린다. 대표 사례 수치가 바뀌면 `docs/spec.md` 결정 기록에 적는다.
