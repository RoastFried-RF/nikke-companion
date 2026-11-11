# 데이터 형식

앱 전체가 같은 뜻으로 쓰는 문서 네 가지. 검사 코드가 정본이다(`src/core/*.mjs`).

## 계정 상태 — `src/core/account.mjs`

```jsonc
{
  "schema_version": 1,
  "is_test_data": true,            // 필수. 검증용이면 true, 실제 계정이면 false
  "name": "검증용 샘플 계정",
  "source": "manual",              // manual | import (가져오기는 단계 2)
  "updated_at": "2026-11-12T02:00:00+09:00",
  "account": { "console": { } },   // 선택. 엔진 `_account.console` 형식 그대로
  "nikkes": {                      // 여기 있는 이름 = 보유 니케 (엔진 정식 명칭)
    "크라운": {
      "skill_levels": [10, 10, 10],
      "breakthrough": 3,           // 0~3
      "core_enhancement": 7,       // 0~7
      "overload": { "공격력": 2 }, // 옵션 → 줄 수. 표기는 엔진 문서 §육성
      "unknown": ["collection_stage"],  // 아직 확인하지 못한 칸
      "note": "메모"
    }
  }
}
```

- 육성 칸의 이름과 표기는 엔진 프로필과 같다(`vendor/nikke-calc/docs/SIM-JSON.md` §육성).
- 적지 않은 칸은 **미육성 값**으로 계산된다. 모르는 칸은 `unknown`에 적어 결과에 드러나게 한다.
- 캐릭터 레벨은 계정 상태가 아니다. 콘텐츠가 정한다(솔로 레이드 = 400 고정).
- 실제 계정 파일은 `data/accounts/`에 둔다(gitignore).

## 전투 조건 — `src/core/condition.mjs`

```jsonc
{ "schema_version": 1, "content": "solo_raid", "boss": "솔로 레이드 S40", "duration": 180, "enemy": { "code": "풍압" } }
```

`boss`는 엔진 프리셋 이름(`vendor/nikke-calc/data/boss_presets.json`). `enemy`는 그 위에 덮는 적 스탯.

## 후보 편성

```jsonc
{ "squads": [ { "name": "A", "members": ["리틀 머메이드", "크라운", "라피 : 레드 후드", "헬름", "앨리스"] } ] }
```

배치 순서가 뜻을 가진다(엔진이 자리로 카메라·버스트 순서를 유도한다).

## 후보 생성 — `src/core/candidates.mjs`

`generateCandidates(account, catalog, { limit = 30, stageCaps = {1: 3, 2: 3, 3: 5} })` — 엔진을 부르지 않는 순수 함수.
같은 입력이면 같은 후보가 같은 순서로 나온다(계정 문서의 니케 나열 순서와 무관).

```jsonc
{
  "squads": [ { "name": "후보 1", "members": ["…", "…", "…", "…", "…"] } ],   // 위 §후보 편성 형식
  "caveats": ["후보는 전수 탐색이 아니다. …"],                                // 줄인 기준. 사람이 읽는 문장
  "summary": { "owned": 8, "usable": 8, "pool": { "1": [], "2": [], "3": [] }, "excluded": [],
               "shapes": ["1-1-3", "1-2-2", "2-1-2"], "considered": 30, "generated": 6, "limit": 6, "truncated": true }
}
```

전수 탐색이 아니다. 줄이는 순서:

1. 버스트 단계별로 **투자 점수** 상위만 후보 풀에 남긴다(`stageCaps`). 투자 점수는 스킬 레벨·돌파·코어 강화·
   오버로드 줄 수를 같은 비중으로 더한 값이다 — 성능 추정이 아니다. 적지 않은 칸과 미확인 칸은 미육성으로 센다.
2. 버스트 1·2·3단계를 모두 갖춘 5인만 만든다. 단계별 인원은 1-1-3, 1-2-2, 2-1-2만 쓰고, 이것으로 하나도
   못 만들 때만 2-2-1, 1-3-1, 3-1-1을 쓴다. 전 단계(`burst_stage: "A"`) 니케는 비어 있는 단계 하나를 채운다.
3. 투자 점수 합이 높은 순으로 `limit`개만 남긴다.

배치는 1→2→3단계 순, 같은 단계 안에서는 투자 점수 순이다. 다른 배치 순서는 만들지 않는다.

`suggestSquads({account, condition}, {limit, top = 5})`(CLI `suggest`)는 후보를 `compareSquads`로 계산해 총딜 상위
`top`개만 `ranking`에 남긴 비교 결과를 돌려준다. 생성 기준은 `caveats`에, 요약은 `suggestion`
(`summary` + `simulated`·`top`·`shown`)에 실린다. 후보를 하나도 만들 수 없으면 입력 오류다.

## 비교 결과 — `src/core/compare.mjs`

```jsonc
{
  "schema_version": 1,
  "generated_at": "…",
  "account": { "name": "…", "is_test_data": true, "updated_at": "…" },
  "condition": { },
  "assumptions": ["전투 180초, …"],
  "engine": { "repo": "Jgaram/nikke-calc", "commit": "67835ca…", "dirty": false },
  "ranking": [ { "rank": 1, "name": "A", "total_damage": 0, "relative_to_best": 1,
                 "members": [ { "name": "…", "damage": 0, "share": 0.2 } ],
                 "notes": [], "engine_warnings": [], "ungrown_members": [] } ],
  "rejected": [ { "name": "D", "members": [], "reasons": ["보유하지 않은 니케: 홍련"] } ],
  "failed":   [ { "name": "…", "error": { "type": "invalid_input", "message": "…", "path": "/…" } } ],
  "caveats": ["후보로 준 편성 안에서의 비교다 …"]
}
```

- `rejected`: 시뮬 전에 걸러진 편성(미보유·중복·인원 수·모르는 이름). 엔진에 보내지 않는다.
- `failed`: 엔진이 오류를 낸 편성. 순위에 넣지 않는다.
- 총딜은 정수 원값을 그대로 둔다. 단위 표기는 표시 단계의 일이다.
