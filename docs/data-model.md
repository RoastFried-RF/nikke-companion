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
