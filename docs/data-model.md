# 데이터 형식

앱 전체가 같은 뜻으로 쓰는 문서 네 가지. 검사 코드가 정본이다(`src/core/*.mjs`).

## 계정 상태 — `src/core/account.mjs`

```jsonc
{
  "schema_version": 1,
  "is_test_data": true,            // 필수. 검증용이면 true, 실제 계정이면 false
  "name": "검증용 샘플 계정",
  "source": "manual",              // manual | import (§계정 가져오기)
  "updated_at": "2026-11-12T02:00:00+09:00",
  "account": {                     // 선택. 계정 단위 값
    "console": { },                //   엔진 `_account.console` 형식 그대로
    "synchro_level": 258           //   동기화 레벨(1~1000의 정수). 레벨 상한이 있는 콘텐츠에서만 쓴다(§전투 조건 §레벨)
  },
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
- 적지 않은 칸은 **미육성 값**으로 계산된다(돌파 0 · 스킬 1/1/1 · 소장품 없음 · 오버로드 0줄). 모르는 칸은 `unknown`에 적어 결과에 드러나게 한다.
- 오버로드 줄을 적고 `equipment`를 적지 않으면 엔진 기본 오버로드 장비를 낀 것으로 계산한다. 오버로드 줄이 없으면 장비 미장착이다.
- 니케별 레벨은 계정 상태에 없다. 레벨은 콘텐츠가 정한다 — 솔로 레이드는 400 고정이고, 레벨 **상한**이 있는 콘텐츠
  (이상 개체 요격전)는 계정의 동기화 레벨 `account.synchro_level`을 상한까지 반영한다(§전투 조건 §레벨). 가져온 계정에는
  이 칸이 들어 있고(§계정 가져오기), 수동 계정은 인게임 동기화 레벨을 직접 적는다. 없으면 상한 값으로 가정하고 결과에 그렇게 적힌다.
- 실제 계정 파일은 `data/accounts/`에 둔다(gitignore).

## 계정 가져오기 — `src/core/import-profile.mjs`

엔진의 `scraper/profile_fetch.py`가 만든 육성 프로필(`profiles/<이름>.json`)을 계정 상태로 바꾼다. **사용자가 직접 받아 둔
파일만 읽는다** — 로그인 세션·쿠키·네트워크는 다루지 않고, 엔진의 `profiles/` 폴더에도 쓰지 않는다.

```bash
node src/cli.mjs import-profile <프로필.json> [--name <계정 이름>] [--out-dir <폴더>] [--force] [--json <결과.json>]
```

- `data/accounts/<계정 이름>.json`에 쓴다(gitignore). 이름은 `--name` → 프로필의 `_meta.name` → 입력 파일 이름 순이다.
  같은 이름의 파일이 있으면 쓰지 않는다(손으로 고친 내용을 지키기 위해). 덮어쓰려면 `--force`.
- 결과는 `is_test_data: false`, `source: "import"`, `updated_at` = 프로필의 수집 시각. 프로필이 스스로 검증용이라고 밝힌
  경우(`_meta.is_test_data: true`, 예: `data/samples/profile.sample.json`)에만 `is_test_data: true`로 남긴다.
- 순수 변환은 `importProfile(프로필, {catalog, optionTable, name, now})` → `{account, skipped, unknown, warnings}`.

| 프로필 | 계정 상태 |
|---|---|
| `breakthrough` · `core_enhancement` · `affinity` · `collection_stage` · `favorite_stage` | 그대로. 범위·표기가 맞지 않으면 미확인 |
| `skill_levels` `{"1","2","3"}` | `[a, b, c]` |
| `equipment` | 그대로, 주석 키(`_track`)만 뗀다 |
| `equip_skills`(합산 퍼센트) + `_overload`(부위별 줄 목록) | `overload` `{인게임 이름: [줄별 레벨]}`. 9개 옵션을 모두 적고 줄이 없는 옵션은 `[]` |
| `_unsynced` | `note`(동기화 소대 밖이었다는 메모) |
| `_account.console` | `account.console`. `synchro_level`은 `account.synchro_level`(레벨 상한이 있는 콘텐츠의 계산에 쓰인다 — §전투 조건 §레벨), `cubes`(장착 중 관찰된 보유 하한)는 `account`에 기록만 한다 |
| `_meta.openid` · `level` · 그 밖의 `_` 키 | 옮기지 않는다 |

- **옮기지 못한 칸은 값을 지어내지 않고 그 니케의 `unknown`에 남긴다.** 이유는 `import.warnings`와 결과의 `warnings`에 적힌다.
  프로필이 언제나 적는 칸(위 표의 앞 네 줄, `favorite_stage`는 애장품이 있는 니케만)은 없어도 미확인이다.
- 줄 목록으로 다시 계산한 합이 `equip_skills`와 맞지 않으면(프로필은 표에 없는 수치의 줄을 `_overload`에서 뺀다) 줄 단위로
  옮기지 않고 `equip_skills`를 그대로 옮긴다. 계산 값은 같지만 줄 수를 세는 기능(후보 생성의 투자 점수, 성장 비교의
  `overload` 더하기)에는 반영되지 않는다.
- 엔진이 모르는 이름의 니케는 건너뛰고 `import.skipped`에 남긴다. 하나도 옮기지 못하면 입력 오류다.
- 계정 문서에는 `import: {format, profile_name, fetched_at, imported_at, skipped, warnings}`가 함께 남는다.

**적지 않은 칸의 계산 값.** 엔진은 인라인 프로필에 **항목이 있는** 니케의 적지 않은 칸을 미육성이 아니라 기본 스펙 값
(돌파 3 · 스킬 10/10/10 · 오버로드 장비 등)으로 계산한다(`runner/spec.py`의 `GrowthProfile.layer` — 미육성은 항목이 아예
없는 이름에만 쓰인다). 그래서 `toEngineEntry`(`src/core/account.mjs`)가 적지 않은 칸과 미확인 칸을 미육성 값으로 채워
넘긴다. 실제 엔진의 미육성 결과와 같은지는 `tests/integration/compare.engine.test.mjs`가 대조한다(2026-11-12 수정 —
그 전에는 비워 둔 칸이 만렙으로 계산됐다).

결과(`importProfileFile`, CLI의 `--json`):

```jsonc
{
  "schema_version": 1, "kind": "import", "generated_at": "…",
  "input": { "file": "…", "format": "nikke-calc profile", "profile_name": "me", "fetched_at": "…" },
  "output": "data/accounts/me.json",
  "account": { "name": "me", "is_test_data": false, "source": "import", "updated_at": "…" },
  "summary": { "roster": 192, "imported": 191, "skipped": 1, "with_unknown": 2, "unknown_fields": { "favorite_stage": 2 } },
  "unknown": [ { "nikke": "…", "fields": ["favorite_stage"] } ],
  "skipped": [ { "name": "…", "reason": "엔진이 모르는 니케다 …" } ],
  "warnings": ["…"], "caveats": ["가져온 값을 인게임 육성 상태와 대조하지 않았다 …"]
}
```

## 전투 조건 — `src/core/condition.mjs`

```jsonc
{ "schema_version": 1, "content": "solo_raid", "boss": "솔로 레이드 S40", "duration": 180, "enemy": { "code": "풍압" } }
```

`boss`는 엔진 프리셋 이름(`vendor/nikke-calc/data/boss_presets.json`). `enemy`는 그 위에 덮는 적 스탯
(`def` · `code` · `core_px` · `distance` · `has_parts` · `part_break_interval` · `optimal_range_weapons` — 엔진 요청의 `enemy`와 같다).

- `content`: `solo_raid` · `union_raid` · `custom` · `anomaly_interception`(이상 개체 요격전) · `interception`(일반·특수 개체 요격전).
- `level_cap`(선택, 1~1000의 정수): 콘텐츠의 레벨 상한. 요격전 조건은 보스 묶음에서 만들어진다(§보스 묶음).

### 레벨

엔진의 레벨 정책은 둘뿐이다(`vendor/nikke-calc/runner/spec.py`의 `LEVEL_MODES`, `docs/HARNESS.md` §레벨 정책): `fixed`(레벨 400
고정 — 솔로 레이드)와 `sync`(프로필의 `_account.synchro_level`, 편성 전원 같은 값). `levelPlan(조건, 계정)`이 무엇으로
계산할지 정한다.

| 조건 | 계정 | 계산하는 레벨 | 엔진에 보내는 것 |
|---|---|---|---|
| `level_cap` 없음 | (무관) | 400 | `profile_level: "fixed"` — 종전 그대로 |
| `level_cap` 있음 | `account.synchro_level` 있음 | min(동기화 레벨, 상한) | 400이면 `fixed`, 아니면 `sync` + 프로필의 `_account.synchro_level`에 그 레벨 |
| `level_cap` 있음 | 동기화 레벨 없음 | 상한(**가정**) | 위와 같다. 결과의 `caveats`에 「상한으로 계산했다 — 실제 레벨이 더 낮으면 총딜이 과대」가 붙는다 |

- 이상 개체 요격전의 "최대 레벨 400 제한"은 고정이 아니라 상한이다(`docs/intercept.md`). 그래서 계정 상태에
  `account.synchro_level`을 뒀다 — 있으면 실제 레벨로 계산한다.
- 엔진의 `sync`는 동기화 소대 밖의 니케도 같은 레벨로 본다(소대에 넣기만 하면 그 레벨이 되므로). 니케마다 다른 레벨은
  계산하지 않는다 — 결과의 `caveats`에 적힌다.
- 무엇으로 계산했는지는 결과의 `assumptions` 셋째 줄에 나온다(`캐릭터 레벨 258 — 계정의 동기화 레벨(…)`).

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

배치는 1→2→3단계 순, 같은 단계 안에서는 투자 점수 순이다. 생성기는 조합마다 배치를 하나만 만든다 —
다른 배치는 추천의 2단계(§배치 탐색)가 다룬다.

`suggestSquads({account, condition}, {limit, top = 5, refine = true, budget = 120, refineTop = 5})`(CLI `suggest`)는
후보를 `compareSquads`로 계산하고(1단계), 상위 조합의 배치를 바꿔 다시 계산한 뒤(2단계 — §배치 탐색) 총딜 상위
`top`개만 `ranking`에 남긴 비교 결과를 돌려준다. 생성 기준은 `caveats`에, 요약은 `suggestion`
(`summary` + `simulated`·`top`·`shown`·`search`)에 실린다. `simulated`는 1단계에서 계산된 조합 수다.
후보를 하나도 만들 수 없으면 입력 오류다.

## 배치 탐색 — `src/core/search.mjs`

같은 5명이라도 배치 순서에 따라 총딜이 달라진다. 추천은 두 단계로 탐색한다.

1. **1단계 — 멤버 조합.** 생성기의 후보(조합마다 배치 하나)를 계산한다.
2. **2단계 — 배치.** 1단계 총딜 상위 `refineTop`개(기본 5) 조합에만 배치 변형을 만들어 다시 계산한다. 조합마다
   원래 배치(1단계 결과)를 언제나 후보에 넣으므로 2단계 뒤의 최고 총딜은 1단계 최고 이상이다. 원래 배치는 다시
   계산하지 않는다(1단계 결과를 그대로 쓴다).

CLI: `suggest --refine`(기본) / `--no-refine`(1단계만) · `--budget <시뮬 횟수>`(기본 120) · `--refine-top <조합 수>`(기본 5).
오버레이의 추천 실행도 같은 함수를 쓴다(`예산` 칸, `배치 탐색` 체크).

### 변형 규칙과 근거

무작위 순열(5! = 120가지)을 다 돌리지 않는다. 엔진 문서가 「배치가 결과를 바꾼다」고 적은 두 가지만 바꾼다.

| 바꾸는 것 | 근거(엔진 문서) | 변형 |
|---|---|---|
| (가) 같은 버스트 단계 안의 순서 | `vendor/nikke-calc/docs/GAMEPLAY.md` §버스트 사용 순서와 배치 — 「스쿼드 멤버 순서는 같은 단계의 자동 사용 우선순위다」, 「앞사람이 준비돼 있는 한 계속 선점하고, 쿨이면 뒷사람이 나간다」. 전 단계(`burst_stage: "A"`) 니케는 「자동 버스트 후보는 B3에만 넣는다」 → 3단계 묶음 | 묶음(1·2·3단계)마다 순서의 모든 순열. 단계가 다른 멤버 사이의 앞뒤는 이 규칙에 없으므로 바꾸지 않는다 |
| (나) 3번 자리에 누가 서는가 | `vendor/nikke-calc/docs/CONTROL.md` §카메라 — 카메라는 「풀차지 버스트 게이지 배율이 붙는 대상」이고, 유도 규칙은 조작 주인이 한 명인 차지 무기가 아니면 「3번 자리(squad[2])」, 「전투가 시작되면 카메라는 3번 자리에서 출발한다」, 「비차지 무기는 `full_charge_mult`가 없어 무영향」. 같은 절의 측정: 카메라만 옮겨 97.1%~106.6% | 차지 무기 멤버(카탈로그에 `full_charge_mult`가 있다 — 엔진의 `_is_charge_nikke`와 같은 판정) 각각 + 비차지 대표 하나. 무기 정보가 없는 니케는 후보에서 빼지 않는다 |

- 배치 하나를 「단계별 순서 + 3번 자리의 카메라 대상」(**서명** — `placementSignature`)으로 줄여 보고, 서명이 같은 배치는
  한 번만 계산한다. 원래 배치와 서명이 같은 것은 만들지 않는다. 예: 1-1-3 구성에 차지 무기가 둘이면
  3! × 3 − 1 = 17개(순열 119개가 아니다).
- 서명마다 배치 하나를 이렇게 만든다(`placementVariants`): 원래 배치의 자리 틀(몇 번 자리가 몇 단계인가)에 새 순서를
  채우고, 3번 자리가 목표와 다를 때만 그 멤버를 3번 자리로 옮긴다(묶음 안의 앞뒤는 지킨다).
- 계산하는 순서: (가)만 바꾼 변형 → (나)만 바꾼 변형 → 둘 다 바꾼 변형. 예산이 모자라면 앞의 것부터 계산한다.
  근거는 이 프로젝트의 확인이다 — 2026-11-12, 엔진 `67835ca`, 샘플 계정·솔로 레이드 S40에서 두 조합의 120가지
  배치를 모두 돌렸다: 총딜을 가른 것은 (가)였고(29.5억~38.7억, 18.5억~19.6억), (나)와 서명이 같은 배치끼리의
  차이는 0.1% 이하였다. 다른 계정·보스에서도 그런지는 확인하지 않았다.
- 다루지 않는 것(결과의 `caveats`에도 적힌다): 누가 버스트를 쓰지 않을지(`operation.no_burst`)·`burst_sequence` 같은
  운용 지정, 스킬로 버스트 단계가 바뀌는 니케(라피 : 레드 후드의 `burst_stage_override`), 무기 변경으로 차지형이 되는
  니케, 좌표 모드 보스에서 카메라 니케의 조준(지금은 보스 프리셋만 쓴다). 서명이 같은 배치 사이의 작은 차이(위의
  0.1% 이하)도 보지 않는다.

### 시뮬 예산

`budget`은 엔진에 맡기는 요청 수(1단계 + 2단계)의 상한이다. 캐시에서 채워져 엔진이 실제로 돌지 않은 요청도
센다 — 같은 입력이면 캐시가 차 있든 비어 있든 같은 결과가 같은 순서로 나오게 하려는 것이다.

- 1단계: 후보(투자 점수 합 순)를 앞에서부터 `budget`개까지만 계산한다. `--no-refine`이어도 지킨다.
- 2단계: 남은 예산을 상위 조합이 순위 순으로 돌아가며 하나씩 나눠 갖는다(`planRefinement` — 1위의 첫 변형 →
  2위의 첫 변형 → … → 1위의 둘째 변형 …).
- 건너뛴 것은 `caveats`에 몇 개인지 적는다: 「시뮬 예산 N건이 모자라 후보 K개…를 계산하지 못했다」,
  「…배치 변형 M개 중 K개를 계산하지 못했다」. 조합별 수는 순위 항목의 메모와 `placement.variants`에 있다.

### 결과

순위(`ranking`)에는 멤버 조합마다 **가장 좋은 배치 하나**만 남는다(이름은 조합 이름 `후보 N` 그대로, `members`는 그
배치의 순서). 같은 총딜이면 원래 배치, 그다음은 먼저 계산한 변형이 이긴다. 2단계 뒤에 순위를 다시 매긴다.

```jsonc
// ranking 항목에 더해지는 칸 — 2단계 대상이 아니었던 조합은 "placement": null, --no-refine이면 칸이 없다
"notes": ["…", "배치 탐색: 배치를 바꿔 총딜이 1단계 배치의 101.4%가 됐다 (변형 11개 계산). 바꾼 것 — 버스트 2단계 순서 프리카 → 크라운."],
"placement": {
  "changed": true,                              // 원래 배치가 아닌 배치가 가장 좋았나
  "changes": ["버스트 2단계 순서 프리카 → 크라운"],
  "original_members": ["…"], "original_total_damage": 0,   // 1단계 배치와 그 총딜
  "gain_ratio": 1.014,                          // 1단계 배치 대비 총딜 비율(1 이상). 1단계 총딜이 0이면 null
  "variants": { "total": 11, "simulated": 11, "skipped": 0, "failed": 0 }   // 만든 수 · 계산한 수 · 예산으로 못 본 수 · 엔진 오류
}

// suggestion.search — 탐색 요약
"search": {
  "refine": true, "budget": 120, "refine_top": 5,          // --no-refine이면 refine false, refine_top null
  "sims": 87,                                              // 엔진에 맡긴 요청 수(1단계 + 2단계). budget을 넘지 않는다
  "stage1": { "requested": 30, "skipped": 0 },             // skipped = 예산이 모자라 계산하지 못한 후보
  "stage2": { "combos": 5, "variants": 57, "requested": 57, "skipped": 0, "improved": 2 },   // --no-refine이면 null
  "best_stage1_total": 0, "best_total": 0                  // 1단계 최고 총딜과 최종 1위 총딜(best_total ≥ best_stage1_total)
}
```

- 배치로 얻은 차이는 메모(`notes`의 `배치 탐색: …` 한 줄)로 남는다 — 표와 오버레이가 그대로 보인다.
- 엔진이 계산하지 못한 변형은 `failed`에 `후보 N · 배치 변형 K`라는 이름으로 남고, 그 조합은 나머지 배치로 순위에 남는다.
- `cache`는 두 단계의 통계를 더한 값이다.
- 진행 표시: `deps.onStage({stage, stages, requests, used, budget})`를 엔진 배치를 맡기기 직전에 부른다
  (`used` = 그 전까지 쓴 시뮬 횟수). 표의 `탐색:` 줄과 오버레이의 같은 줄은 `searchLine`(`src/core/render.mjs`)이 만든다.

## 비교 결과 — `src/core/compare.mjs`

```jsonc
{
  "schema_version": 1,
  "generated_at": "…",
  "account": { "name": "…", "is_test_data": true, "updated_at": "…" },
  "condition": { },
  "assumptions": ["전투 180초, …"],
  "engine": { "repo": "Jgaram/nikke-calc", "commit": "67835ca…", "dirty": false },
  "cache": { "hits": 2, "misses": 1, "stored": 1, "warnings": [] },   // §시뮬 결과 캐시. 캐시 없이 계산했으면 null
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
- `cache`: 이 계산에서 캐시가 한 일(§시뮬 결과 캐시). 수치에는 영향이 없다 — 같은 입력이면 `cache`와 `generated_at`
  말고는 같은 문서가 나온다.

## 성장 투자 비교 — `src/core/growth.mjs`

업그레이드 후보를 계정 상태의 **복사본**에 하나씩 가상 적용하고, 기준 편성 하나의 총딜 변화를 계산해 증가율 순으로
순위를 매긴다. 계정 문서는 바뀌지 않는다. 재화·비용은 다루지 않는다 — 후보는 입력이다.

```jsonc
// 업그레이드 후보 (data/samples/upgrades.sample.json)
{ "upgrades": [
  { "name": "헬름 스킬 10/10/10", "nikke": "헬름", "set": { "skill_levels": [10, 10, 10] } },
  { "name": "크라운 공격력 +2줄", "nikke": "크라운", "add": { "overload": { "공격력": 2 } } },
  { "name": "묶음", "changes": [ { "nikke": "헬름", "add": { "core_enhancement": 4 } },
                                  { "nikke": "앨리스", "add": { "overload": { "우월코드": 1 } } } ] }
] }
```

- `set` — 육성 칸(계정 상태의 칸 이름)을 그 값으로 만든다. 객체 칸은 적은 키만 바뀐다(`overload`는 적은 옵션만).
- `add` — 현재 값에 더한다. `skill_levels`(`[a, b, c]`)·`breakthrough`·`core_enhancement`·`overload`(줄 수, 또는
  줄별 레벨끼리 이어 붙이기)만 된다. 적지 않은 칸은 미육성 값(스킬 1/1/1, 0, 옵션 없음)에서 더한다.
- 오버로드 옵션은 표기가 달라도(`우월코드` ↔ `우월 코드 대미지` ↔ `element_bonus`) 같은 옵션으로 합친다.
- 미확인(`unknown`) 칸: `set`은 계산하되 적용 전을 미육성으로 본 것이라 증가율이 과대일 수 있다는 메모가 붙고,
  `add`는 더할 기준이 없어 제외한다.

`compareGrowth({account, condition, squad, upgrades})`(CLI `growth --squads <편성.json> [--squad <이름>] --upgrades <후보.json>`,
`--squad`를 주지 않으면 첫 편성)의 결과:

```jsonc
{
  "schema_version": 1, "kind": "growth",
  "generated_at": "…", "account": { }, "condition": { }, "assumptions": [], "engine": { }, "cache": { },   // 비교 결과와 같다
  "baseline": { "name": "A", "total_damage": 0, "members": [ { "name": "…", "damage": 0, "share": 0.2 } ],
                "notes": [], "engine_warnings": [], "ungrown_members": [] },
  "ranking": [ { "rank": 1, "name": "헬름 스킬 10/10/10",
                 "changes": [ { "nikke": "헬름", "field": "skill_levels", "before": [7, 7, 10], "after": [10, 10, 10] } ],
                 "total_before": 0, "total_after": 0, "gain": 0, "gain_rate": 0.0204,
                 "members": [ { "name": "…", "damage": 0, "share": 0.2, "gain": 0 } ],
                 "notes": [], "engine_warnings": [] } ],
  "rejected": [ { "name": "…", "reasons": ["기준 편성에 없는 니케만 바꾼다(프리카) …"] } ],
  "failed":   [ { "name": "…", "changes": [], "error": { "type": "invalid_input", "message": "…", "path": "/…" } } ],
  "caveats": ["기준 편성 하나에서의 총딜 변화다 …", "재화·비용은 고려하지 않았다 …"]
}
```

- `gain_rate` = (`total_after` − `total_before`) / `total_before`. 0.05 = 5% 증가, 음수 = 감소. 기준 총딜이 0이면 `null`.
- `changes[].before`가 `null`이면 적지 않았거나 미확인이던 칸이다. `members[].gain`은 그 멤버 딜의 증감이다.
- `rejected`: 엔진에 보내지 않은 후보 — 잘못 적은 후보, 미보유 니케, 적용 후 값이 범위 밖, 기준 편성에 없는 니케만
  바꾸는 후보, 현재 상태와 같은 후보.
- 기준 편성 자체에 문제가 있거나 엔진이 기준 편성을 계산하지 못하면 결과 없이 입력 오류다.
- 엔진 요청은 기준 1건 + 계산한 후보 수다. 캐시에 있는 것은 엔진에 보내지 않는다(기준 편성은 `compare`가 이미
  계산했으면 적중한다).

## 보스 묶음 — `src/core/intercept.mjs`

요격전 보스를 담는 문서. 엔진에는 요격전 보스 프리셋이 없어(`vendor/nikke-calc/data/boss_presets.json`은 솔로 레이드 S40뿐)
보스를 전투 조건의 적 설정(`enemy`)으로 표현한다. **확인한 값만 넣는다** — 모르는 값은 넣지 않고 미확인으로 표시한다.

| 파일 | 내용 |
|---|---|
| `data/intercept/anomaly.json` | 이상 개체 요격전의 실제 보스 5종. `docs/intercept.md`의 표(게임 화면 캡처에서 읽은 값)를 옮긴 것이다. 커밋한다 |
| `data/samples/bosses.anomaly.sample.json` | 검증용(`is_test_data: true`) — 시험 보스 A~E. 약점만 있는 보스, 속성을 모르는 보스가 섞여 있다 |

```jsonc
{
  "schema_version": 1,
  "content": "anomaly_interception",        // anomaly_interception | interception — 전투 조건의 content가 된다
  "is_test_data": false,                    // 필수. 지어낸 값이면 true
  "name": "…", "version": "2026-11-12.1", "note": "…", "updated_at": "…",   // 선택
  "source": "docs/intercept.md §확인한 사실 — …",   // 필수. 값의 출처
  "bosses": [
    {
      "id": "indivilia", "name": "인디빌리아",      // 필수. 묶음 안에서 겹치지 않는다
      "enemy": { "code": "풍압" },                  // 필수(확인한 칸이 없으면 {}). 전투 조건의 enemy와 같은 칸. code = 보스 자신의 속성
      "weak_to": "작열",                            // 선택. 약점 속성
      "level_cap": 400,                             // 선택. 레벨 상한(§전투 조건 §레벨)
      "duration": 180,                              // 선택. 전투 시간(초)
      "reward": "몸통 장비",                        // 선택. 계산에는 쓰지 않는다
      "source": "docs/intercept.md §… : 육각형의 속성 아이콘, 편성 화면의 \"약점 작열\" …",   // 필수. 이 보스 값의 출처
      "confirmation": {                             // 필수. 확인 여부
        "confirmed":   ["code", "weak_to", "level_cap"],
        "unconfirmed": ["duration", "def", "core_px", "distance", "has_parts", "part_break_interval", "optimal_range_weapons"]
      }
    }
  ]
}
```

- **확인 여부.** 추적 칸은 열 개다: `code`(보스 속성) · `weak_to` · `level_cap` · `duration` · `def` · `core_px` · `distance` ·
  `has_parts` · `part_break_interval` · `optimal_range_weapons`. 칸마다 `confirmed`(값이 있다)나 `unconfirmed`(값이 없다) 한쪽에
  빠짐없이 적는다. 값을 적고 미확인이라 하거나, 값 없이 확인됐다 하거나, 어느 쪽에도 적지 않으면 오류다 — 확인하지 않은
  값이 조용히 계산에 들어가지 않게 하려는 것이다.
- **검사**는 `validateBossBundle(묶음)` → `{ok, errors: [{path, message}], warnings}`. 오류는 한국어 문장과 JSON 경로
  (`/bosses/1/enemy/def`)로 온다. 값의 형·범위는 엔진 요청 스키마(`vendor/nikke-calc/runner/request.py`의 `enemy`)와 같다.
  모르는 칸은 오류다(`weakto` 같은 오타가 조용히 지나가지 않는다).
- **속성 상성.** 규칙은 엔진의 것이다 — 정본은 `vendor/nikke-calc/calculator/damage.py`의 `_CODE_ADVANTAGE`
  (키 속성이 값 속성에 우월: 작열 → 풍압 → 철갑 → 전격 → 수냉 → 작열). `src/core/intercept.mjs`의 `ELEMENT_ADVANTAGE`가
  이를 옮겨 적었고, `tests/integration/intercept.engine.test.mjs`가 엔진의 표와 같은지 대조한다.
  - `weak_to`와 `enemy.code`를 둘 다 적었으면 약점이 보스 속성에 우월한 속성이어야 한다. 아니면 오류다(`/bosses/N/weak_to`).
  - `weak_to`만 있는 보스는 같은 규칙으로 적 속성을 정한다(`resolveElement` — 약점 수냉 → 적 속성 작열). 결과에는
    「화면에서 확인한 값이 아니라 약점에서 정했다」가 붙는다.
  - 둘 다 없는 보스는 적 속성 없이 계산한다 — 엔진 기본 적은 속성이 없어 어느 니케에도 우월 코드 보너스가 붙지 않는다.
    결과에 **속성 상성 미반영**이 붙는다.
- **변환.** `bossCondition(보스, content)` → 전투 조건. 확인된 칸만 싣는다(적 설정 + 정해진 속성, `duration`, `level_cap`).
  실제 보스 5종의 조건은 `{content, enemy: {code}, level_cap: 400}`뿐이다.
- **미확인 칸의 계산 값.** 적지 않은 적 칸은 엔진 기본 적으로 계산된다 — 정본은 `vendor/nikke-calc/calculator/timeline.py`의
  `DEFAULT_ENEMY`: 방어력 31,784(솔로 레이드 Lv 400 보스) · 속성 없음 · 코어 없음(0) · 파츠 없음 · 파츠 파괴 없음(0) ·
  거리 없음 · 적정 거리 무기군 없음. 전투 시간은 180초, 레벨 상한이 없으면 `fixed`(400). `ENGINE_ENEMY_DEFAULTS`가 옮겨 적었고
  통합 테스트가 엔진 결과의 `boss`(실제로 적용된 적)와 대조한다. `unconfirmedOf(보스)`가 칸마다 무엇으로 계산했는지 돌려준다.

## 요격전 추천 결과 — `src/core/intercept.mjs`

`recommendIntercept({account, bundle, boss}, {top = 3, budget = 300}, deps)` — 보스 묶음의 보스마다 기존 추천
(`suggestSquads` — 멤버 조합 + 배치 탐색 + 캐시)을 돌린다. `deps`는 추천과 같고, `onBoss({index, total, boss: {id, name}, budget})`가
더해진다(그 보스의 계산 직전).

```bash
node src/cli.mjs intercept --account <계정.json> [--bosses <보스 묶음, 기본 data/intercept/anomaly.json>] [--boss <이름 또는 id>]
                           [--top <보스별 표시 수, 기본 3>] [--budget <전체 시뮬 횟수, 기본 300>] [--json <결과.json>] [--no-cache] [--cache-dir <폴더>]
```

```jsonc
{
  "schema_version": 1, "kind": "intercept_report", "generated_at": "…",
  "account": { "name": "…", "is_test_data": true, "updated_at": "…" },
  "content": "anomaly_interception",
  "bundle": { "name": "…", "version": "2026-11-12.1", "is_test_data": false, "source": "docs/intercept.md …", "bosses": 5 },
  "assumptions": ["이상 개체 요격전 — 보스는 엔진 프리셋이 아니라 전투 조건의 적 설정으로 표현했다 …"],   // 공통 가정
  "engine": { "repo": "Jgaram/nikke-calc", "commit": "67835ca…", "dirty": false },
  "cache": { "hits": 0, "misses": 15, "stored": 15, "warnings": [] },   // 보스별 통계의 합. 캐시 없이 계산했으면 null
  "top": 3,
  "sims": { "budget": 300, "used": 287,                                 // 엔진에 맡긴 요청 수(캐시 적중 포함). budget을 넘지 않는다
            "per_boss": [ { "id": "indivilia", "name": "인디빌리아", "budget": 60, "used": 57 } ] },
  "bosses": [
    {
      "id": "indivilia", "name": "인디빌리아", "reward": "몸통 장비",    // 보상을 모르면 null
      "element": { "code": "풍압", "code_source": "bundle",              // bundle(묶음에 적힘) | weak_to(약점에서 정함) | null(모름)
                   "weak_to": "작열", "weak_to_source": "bundle",        // bundle | code(보스 속성에서 정함) | null
                   "reflected": true },                                  // 속성 상성이 계산에 들어갔나
      "level": { "mode": "cap", "level": 400, "cap": 400, "synchro_level": null, "assumed": true, "engine_policy": "fixed" },   // §전투 조건 §레벨
      "duration": 180,                                                   // 계산한 전투 시간(미확인이면 엔진 기본값 — unconfirmed에 있다)
      "source": "docs/intercept.md §…",
      "condition": { "schema_version": 1, "content": "anomaly_interception", "enemy": { "code": "풍압" }, "level_cap": 400 },   // 실제로 쓴 전투 조건
      "confirmed": ["code", "weak_to", "level_cap"],
      "unconfirmed": [ { "field": "def", "label": "방어력", "computed_as": 31784,     // 무엇이 미확인이고 무엇으로 계산했나
                         "text": "31,784(엔진 기본값 — 솔로 레이드 Lv 400 보스 방어력)" } ],
      "flags": [],                                                       // 속성을 모르면 ["속성 상성 미반영"]
      "status": "computed",                                              // computed | not_computed(예산이 돌아가지 않았다)
      "budget": 60, "sims": 57,                                          // 이 보스의 몫과 쓴 시뮬 횟수
      "assumptions": ["전투 180초, …", "…", "캐릭터 레벨 400 — 콘텐츠의 레벨 상한 400으로 가정했다(…)", "…"],
      "ranking": [ { "rank": 1, "name": "후보 3", "total_damage": 0, "relative_to_best": 1,     // §비교 결과·§배치 탐색의 순위 항목 그대로
                     "members": [ { "name": "…", "damage": 0, "share": 0.2 } ], "notes": [], "placement": { } } ],
      "rejected": [], "failed": [],
      "suggestion": { "search": { "budget": 60, "sims": 57 } },          // §후보 생성·§배치 탐색의 suggestion 그대로
      "weak_pool": { "element": "작열", "owned": ["…"], "pooled": ["…"], "not_pooled": [] },   // 약점 속성 보유 니케가 후보 풀에 들었나. 알 수 없으면 null
      "notes": ["약점 속성(작열) 보유 니케 3명 중 1명은 후보 풀에 들지 못했다(…) — …"],
      "caveats": ["…"]                                                   // 이 보스의 추천이 낸 주의 문장 전부
    }
  ],
  "caveats": ["수치는 시뮬레이션 추정치다. 실제 요격전 기록과 대조하지 않았다 …", "보스 패턴 미반영: …"]
}
```

- **예산.** 전체 예산을 계산할 보스 수로 나눈다(`splitBudget` — 합이 정확히 예산, 나머지는 앞 보스부터 한 건씩). 보스마다
  그 몫이 `suggestSquads`의 `budget`이 된다(1단계 조합 → 2단계 배치 순으로 쓴다 — §배치 탐색 §시뮬 예산). `--boss`로 한
  보스만 고르면 그 보스가 전체를 쓴다. 예산이 보스 수보다 적으면 뒤쪽 보스는 `status: "not_computed"`다(순위가 비어 있다 —
  0딜이 아니다). 예산 때문에 줄인 것은 `caveats`에 적힌다(「전체 시뮬 예산 300건을 보스 5종에 60건씩 나눴다」,
  「[보스 이름] 시뮬 예산 N건이 모자라 후보 K개…를 계산하지 못했다」).
- **미확인.** `unconfirmed`는 미확인 칸마다 `computed_as`(실제로 계산에 쓴 값)와 `text`를 싣는다. 속성을 모르는 보스는
  `flags: ["속성 상성 미반영"]`, `element.reflected: false`이고 표에서는 보스 이름 바로 아래에 `!! 속성 상성 미반영 !!`가 따로 나온다.
- **주의 문장.** 최상위 `caveats`: 요격전 공통 문장(실제 요격전 기록과 대조하지 않았다 · 보스 패턴 미반영 · 미확인 값 ·
  예산 · 후보 풀은 약점 속성을 우선하지 않는다) 뒤에 보스별 추천의 주의 문장을 합친 것이 온다 — 계산한 모든 보스에 공통인
  문장은 한 번, 일부 보스의 것은 `[보스 이름, …]`이 앞에 붙는다. 레벨을 가정한 경우의 문장도 여기에 온다.
- **후보는 보스마다 같다.** 후보 풀은 투자 점수로만 고른다(§후보 생성) — 보스의 약점 속성 니케를 우선하지 않는다.
  덜 키운 약점 속성 니케는 후보에 없을 수 있고, 그럴 때 `weak_pool.not_pooled`와 보스의 `notes`에 이름이 적힌다.
- 같은 입력(계정·보스 묶음·`top`·`budget`·엔진 판)이면 `generated_at`과 `cache` 말고는 같은 문서가 나온다.
- 입력 오류(종료 코드 2): 잘못된 보스 묶음·계정, 없는 보스 이름, 후보 편성을 만들 수 없는 계정.
- 표 출력은 `renderInterceptReport`(`src/core/render.mjs`). 오버레이 화면은 아직 없다(P-017).

## 시뮬 결과 캐시 — `src/core/cache.mjs`

엔진 시뮬 1회가 4~5초라서, 같은 엔진 판·같은 요청의 결과는 다시 계산하지 않는다. `withCache(runtime, store)`가
런타임(`src/core/runtime.mjs`의 계약)을 감싼다. **캐시는 속도만 바꾼다** — 틀릴 수 있으면 쓰지 않고, 저장소가 고장 나도
계산은 끝까지 한다.

| 쓰는 곳 | 저장소 | 남는 기간 |
|---|---|---|
| CLI `compare`·`suggest`·`growth`·`tier`·`intercept` | 파일 — `createFileCacheStore(dir)`(`src/runtime/node.mjs`), 기본 `data/cache/sim/`(gitignore) | 지울 때까지 |
| 오버레이(`app/`) | 메모리 — `createMemoryStore()`(최근 500건) | 앱을 끌 때까지 |

CLI는 `--no-cache`로 끄고(읽지도 쓰지도 않는다) `--cache-dir <폴더>`로 폴더를 바꾼다.

### 키

`키 = SHA-256(엔진 커밋 + 줄바꿈 + 요청의 정규화된 JSON)` — 소문자 16진수 64자. 해시는 Web Crypto(`crypto.subtle`)로 만든다.

- 엔진 커밋: 런타임의 `engineVersion().commit`(엔진 저장소의 HEAD 해시 40자). **커밋이 다르면 다른 키다.**
- 정규화된 JSON(`canonicalJson`): 객체의 키를 코드 단위 순으로 정렬하고 공백 없이 적는다. 그래서 키 순서와 무관하다.
  배열 순서는 지킨다(편성의 배치 순서가 결과를 바꾼다). 값이 `undefined`인 키는 없는 것으로 본다. `null`은 그대로 둔다.
- 호출용 칸은 뺀다: 요청 맨 위의 `id`(배치 결과 줄에 되돌려 받는 표시)뿐이다(`CALL_ONLY_FIELDS`). 안쪽의 `id`는 내용이다.

### 저장하고 읽는 조건

아래를 **모두** 만족하는 요청만 저장소에서 찾고, 계산한 뒤 저장한다. 하나라도 어긋나면 그 요청은 매번 엔진에 간다.

1. 결정론이 보장된다 — `sim.expected === true`이거나 `sim.seed`가 정수다(엔진 `docs/SIM-JSON.md` §보장). 계산 모듈이
   만드는 요청은 항상 기대값 모드다(§전투 조건).
2. 요청 밖의 파일을 가리키지 않는다 — `profile`이 이름(문자열, 엔진의 `profiles/` 파일)이거나 `boss`가 `.json`
   경로면 엔진 커밋이 같아도 내용이 바뀔 수 있어 저장하지 않는다. 계산 모듈은 프로필을 요청 안에 객체로 싣는다.
3. 엔진 판을 안다 — `engineVersion()`이 `commit`(빈 문자열 아님)과 `dirty: false`를 돌려줬다. 커밋을 모르거나, 엔진
   작업 폴더에 커밋하지 않은 변경이 있거나(`dirty: true`), 깨끗한지 확인할 수 없으면(`dirty`가 없거나 null) 그 배치
   전체가 저장소를 건드리지 않는다. 엔진 판은 배치마다 다시 묻는다. `dirty`의 기준은 엔진의 `evaluator.dirty`와 같다
   (추적 중인 파일의 변경 — `git status --porcelain -uno`).
4. 결과가 오류가 아니다 — `{error}` 줄은 저장하지 않는다. 결과가 스스로 밝힌 `evaluator`가 3에서 확인한 커밋과 다르거나
   dirty여도(계산 도중 엔진이 바뀜) 저장하지 않는다.

### 배치 한 번의 흐름과 통계

적중한 요청은 엔진에 보내지 않는다. 빗나간 요청만(같은 배치 안의 같은 요청은 한 번만) 엔진에 보내고, 입력 순서대로
합쳐 돌려준다. 줄의 `id`는 입력 배치에서의 자리다. 계산 모듈은 `engineAccess(deps).runBatchWithStats()`로 결과와
통계를 함께 받아 결과 문서의 `cache`에 싣는다:

```jsonc
{ "hits": 2,          // 엔진에 보내지 않고 채운 요청 수
  "misses": 1,        // 엔진에 보낸 요청 수 (hits + misses = 요청 수)
  "stored": 1,        // 새로 저장한 수
  "warnings": [] }    // 캐시를 못 쓴 이유·저장소 문제 (사람이 읽는 문장)
```

캐시로 감싸지 않은 런타임이면 `cache`는 `null`이다. CLI 표에는 `캐시: 적중 2건 · 엔진 계산 1건 · 새로 저장 1건`
(쓰지 않았으면 `캐시: 쓰지 않음`) 한 줄과 경고(`  ! …`)가 나온다. 오버레이의 결과 화면에도 같은 줄이 나온다.

### 저장 항목

파일 저장소는 항목 하나가 파일 하나다: `data/cache/sim/<키 앞 두 글자>/<키>.json`. 메모리 저장소도 같은 항목을 담는다.

```jsonc
{
  "cache_schema_version": 1,
  "key": "<64자 해시>",
  "engine": { "repo": "Jgaram/nikke-calc", "commit": "67835ca…" },
  "request": { },                  // 키를 만든 요청(호출용 칸 제외) — 무엇의 결과인지 사람이 볼 수 있다
  "result": { },                   // 엔진 결과 줄 그대로(id 제외). evaluator 포함
  "stored_at": "2026-11-12T02:30:00.000Z"
}
```

파일은 임시 파일에 쓴 뒤 이름을 바꾼다(여러 프로세스가 함께 써도 반쯤 쓴 파일이 읽히지 않는다).

### 무효화 규칙

- **엔진이 바뀌면 자동으로 빗나간다.** 서브모듈 커밋이 바뀌면 키가 달라져 옛 항목은 읽히지 않는다(지워지지는 않는다).
  원래 커밋으로 돌아가면 그 커밋의 항목을 다시 쓴다.
- **요청이 바뀌면 다른 키다.** 계정 육성·편성·배치 순서·보스·전투 시간 등 엔진에 가는 모든 칸이 키에 들어간다.
- **읽을 때 다시 확인한다.** 항목의 `cache_schema_version`·`key`·`engine.commit`·`request`(정규화해 비교)·`result`
  (오류가 아니고 `total_damage`가 수, `members`가 배열, `evaluator`가 같은 커밋)가 맞지 않으면 적중으로 치지 않고
  다시 계산해 덮어쓴다(경고 1줄).
- **저장소 고장은 실패가 아니다.** 읽기·쓰기가 던지거나 파일이 JSON이 아니면 그 요청을 다시 계산하고 `warnings`에 적는다.
- **만료 시간은 없다.** 결정론 요청의 결과는 엔진 커밋이 같으면 바뀌지 않는다. 항목 형식을 바꿀 때는
  `CACHE_SCHEMA_VERSION`을 올린다(옛 항목은 다시 계산된다).
- **손으로 비우기:** `data/cache/sim/` 폴더를 지운다. 언제 지워도 안전하다. 파일 저장소에는 크기 제한·자동 정리가 없다.
- 캐시가 가리지 못하는 것: 엔진 커밋 밖에서 결과를 바꾸는 것(파이썬 버전, 추적되지 않는 엔진 파일). 의심되면
  `--no-cache`로 다시 계산해 대조한다.

## 데이터 변경 감지 — `src/tier/detect.mjs`

자동 티어의 1단계. 엔진 저장소의 두 커밋에서 `data/parsed_nikke.json`(기본 스탯)과 `data/parsed_skills.json`(스킬 효과)을
`git show`로 읽어 니케 단위로 추가·변경·삭제를 나눈다. 작업 폴더는 건드리지 않고 엔진도 부르지 않는다. **티어는 내지 않는다.**

`detectChanges({from, to})`(CLI `detect-changes --from <커밋> --to <커밋> [--engine <엔진 저장소>] [--json <파일>]`)의 결과.
CLI는 이 JSON을 표준 출력에 그대로 낸다. 순수 비교만 필요하면 `diffEngineData(이전 판, 새 판)`(판 = `{nikkes, skills}`).

```jsonc
{
  "schema_version": 1, "kind": "data_changes", "generated_at": "…",
  "engine": { "repo": "Jgaram/nikke-calc", "from": { "ref": "HEAD~40", "commit": "163144a…" }, "to": { "ref": "HEAD", "commit": "67835ca…" } },
  "files": ["data/parsed_nikke.json", "data/parsed_skills.json"],
  "summary": { "added": 1, "changed": 1, "removed": 1, "unchanged": 206, "hold": 1 },
  "added":   [ { "name": "…", "evaluation": { "status": "hold", "label": "평가 보류",
                                               "reasons": [ { "code": "skills_unparsed", "message": "…" } ] },
                 "skills_state": "unparsed", "effects": 0 } ],
  "changed": [ { "name": "…", "evaluation": { "status": "ready", "label": "평가 대상", "reasons": [] }, "evaluation_before": "hold",
                 "changes": {
                   "stats": [ { "field": "damage_coeff", "before": 13.65, "after": 15 } ],
                   "stats_presence": null,                       // null | "added" | "removed" (기본 스탯이 통째로 생김·사라짐)
                   "skills": { "state_before": "parsed", "state_after": "parsed", "effects_before": 9, "effects_after": 10,
                               "added": [ { "source": "스킬3", "name": "…" } ], "removed": [],
                               "changed": [ { "source": "스킬2", "name": "…", "fields": ["duration", "values"] } ],
                               "reordered": false } } } ],       // 스킬이 그대로면 "skills": null
  "removed": [ { "name": "…", "evaluation_before": "ready" } ],
  "hold": ["…"],                                                 // 추가·변경 중 평가 보류인 이름
  "caveats": ["티어를 낸 것이 아니다 …"]
}
```

- 니케 = 두 파일 중 어느 쪽에든 있는 이름. 이전 판에 없으면 **추가**, 새 판에 없으면 **삭제**, 둘 다 있고 내용이 다르면 **변경**.
  객체의 키 순서는 무시하고 배열 순서는 본다(엔진이 효과 나열 순서로 같은 프레임의 발동 순서를 정한다).
- `evaluation`은 **새 판** 기준이다. `ready`(평가 대상)는 다음 단계가 평가해야 한다는 뜻이지 티어가 났다는 뜻이 아니다.
- `hold`(평가 보류) 사유: `skills_unparsed` — `parsed_skills.json`에 키가 없다(엔진의 미파싱 기준과 같다. 그대로 돌리면
  스킬 0개로 계산된다) · `skills_empty` — 효과가 하나도 없다 · `stats_missing` — `parsed_nikke.json`에 없다.
- 스킬 효과는 (스킬 칸 `source`, 효과 `name`)으로 묶어 비교한다. 같은 칸·이름이 여럿이면(애장품 판본) 묶음째 변경으로 보고
  `fields`는 `null`이다. 효과 내용은 같고 순서만 바뀌면 `reordered: true`.
- `--from`이 `--to`의 조상 커밋이 아니면 방향이 뒤집혔을 수 있다는 문장이 `caveats`에 붙는다.
- 보지 않는 것: 파싱된 효과를 엔진이 모두 계산하는지(지원 여부 판정은 다음 단계), 프리뷰 선행 등록 여부
  (`preview_skills.json` — 카드 기준 추정값), 두 파일 밖의 변경(엔진 코드·보스·장비 데이터).

## 티어 결과 — `src/tier/evaluate.mjs`

자동 티어의 2단계. 엔진 계산으로 니케별 등급을 낸다. 방법·가정·한계는 `docs/tier-method.md` — 여기는 형식만 적는다.

`buildTier({references, rules, only, budget}, deps)`(CLI `tier build [--only <이름,이름>] [--budget <시뮬 횟수, 기본 2000>]
[--json <결과.json>] [--references <파일>] [--rules <파일>] [--no-cache] [--cache-dir <폴더>]`).
`deps`는 다른 계산 모듈과 같고(`runtime`·`now`·`concurrency`), 여기에 `engineData`(엔진 데이터 현황 — Node는
`src/runtime/node.mjs`의 `loadEngineData()`: `{files: {파일: 내용 해시}, skills: {이름: 파싱된 효과 수}}`) · `batchSize`(기본 40) ·
`onProgress({done, total})`가 더해진다. CLI는 진행을 표준 오류로만 낸다(`시뮬 85/140건`).

### 입력 문서

```jsonc
// data/tier/reference-squads.json — 시나리오와 기준 편성. 바꾸면 version을 올린다
{
  "schema_version": 1, "version": "2026-11-12.1",
  "source": { "summary": "…snapshot.py의 SQUADS…", "origin": "…", "selection": "…", "not_carried_over": "…", "checked_at": "2026-11-12" },
  "scenario": { "id": "solo-raid-s40-default-spec", "boss": "솔로 레이드 S40", "duration": 180,
                "growth": "engine_default",        // 표준 육성 조건. 지금은 이 값만 받는다(엔진 기본 스펙, 프로필 없음)
                "enemy": { } },                    // 선택. 보스 위에 덮는 적 칸(전투 조건의 enemy와 같다)
  "squads": [ { "id": "S40_토브드레이크", "members": ["…", "…", "…", "…", "…"], "source": "…" } ]   // 5명, 배치 순서가 뜻을 가진다
}

// data/tier/rules.json — 등급 규칙. 바꾸면 version을 올린다
{
  "schema_version": 1, "version": "2026-11-12.1",
  "provisional": true,                             // 대표 사례로 검증하기 전에는 true — 결과 caveats에 임시라고 적힌다
  "tiers": [ { "tier": "SSS", "min": 1.05 }, …, { "tier": "D", "min": 0 } ],   // 위 등급부터. min 이상이면 그 등급. 마지막은 0
  "unsupported_warning_markers": ["효과 모델이 없", "미지원"]                   // 이 문구가 든 엔진 경고 = 미지원 효과
}
```

### 결과

```jsonc
{
  "schema_version": 1, "kind": "tier",
  "generated_at": "2026-11-12T03:29:47.427Z",                         // 계산 시각
  "method": { "id": "team-swap-ratio", "version": 1 },
  "engine": { "repo": "Jgaram/nikke-calc", "commit": "67835ca…", "dirty": false },   // 엔진 커밋
  "engine_data": { "version": "sha256:6b9f8225c2a5f426",              // 엔진 데이터 버전 = 아래 파일 해시들을 묶은 해시
                   "files": { "data/parsed_nikke.json": "<64자>", "data/parsed_skills.json": "<64자>" } },   // 못 받았으면 null
  "scenario": { "id": "…", "boss": "솔로 레이드 S40", "duration": 180, "enemy": null,
                "growth": "engine_default", "growth_note": "…", "expected": true },
  "assumptions": ["전투 180초, …"],
  "references": { "version": "2026-11-12.1", "source": { },           // 기준 편성 버전과 출처
                  "squads": [ { "id": "…", "members": [], "source": "…", "status": "used",   // used | unusable
                                "reason": null, "total_damage": 5865088902 } ] },            // 기준 편성 그대로의 총딜
  "rules": { "version": "2026-11-12.1", "provisional": true, "tiers": [ { "tier": "SSS", "min": 1.05 } ] },   // 등급 규칙 버전
  "sims": { "budget": 2000, "used": 27, "baselines": 5, "variants": 22, "skipped_for_budget": 0 },           // 시뮬 횟수
  "cache": { "hits": 0, "misses": 27, "stored": 27, "warnings": [] }, // §시뮬 결과 캐시(묶음별 통계의 합). 캐시 없이 계산했으면 null
  "summary": { "requested": 4, "graded": 3, "hold": 1, "unsupported": 0,
               "by_tier": { "SSS": 0, "SS": 1, "S": 2, "A": 0, "B": 0, "C": 0, "D": 0 },
               "hold_by_reason": { "skills_empty": 1 } },
  "entries": [
    { "name": "크라운", "rank": 1, "burst_stage": "2",
      "status": "예측 평가", "status_label": "예측 평가",
      "tier": "SS", "tier_label": "SS",                               // 미지원 효과가 있으면 tier_label이 "SS (미지원 효과 있음)"
      "score": 1.0296,                                                // comparisons[].ratio의 최댓값
      "unsupported": false, "flags": [],                              // 있으면 true, ["미지원 효과 있음"]
      "best": { "reference": "S40_앨리스모더니아", "slot": 1, "replaced": "그레이브",
                "total_damage": 3925782856, "reference_total": 3812832549, "ratio": 1.0296 },
      "comparisons": [ { "reference": "…", "slot": 1, "replaced": "…", "total_damage": 0, "reference_total": 0, "ratio": 0.73 } ],
      "excluded_references": [ { "reference": "S40_퀸유키코", "reason": "self" } ],   // self(이미 들어 있다) | no_slot(같은 단계 자리 없음)
      "hold": null,
      "notes": ["기준 편성 S40_퀸유키코에 이미 들어 있어 …", "미지원 효과(엔진 경고): …"],
      "engine_warnings": ["기본 스펙(1층) 이탈 1명 — 앨리스"] },         // 가장 좋은 자리의 시뮬이 실은 경고 전부
    { "name": "test_B1", "rank": null, "burst_stage": "1",
      "status": "평가 보류", "status_label": "평가 보류(스킬 효과 없음)",
      "tier": null, "tier_label": null, "score": null,                // 0점이 아니다
      "unsupported": false, "flags": [], "best": null, "comparisons": [], "excluded_references": [],
      "hold": { "code": "skills_empty", "label": "스킬 효과 없음", "message": "파싱된 스킬 효과가 하나도 없다 …" },
      "notes": ["파싱된 스킬 효과가 하나도 없다 …"], "engine_warnings": [] }
  ],
  "caveats": ["예측 평가다 …", "등급 규칙 2026-11-12.1은 임시다 — 대표 사례로 검증되지 않았다 …"]
}
```

- `status`는 `예측 평가`(등급 있음) 또는 `평가 보류`(등급·점수 `null`) 둘뿐이다. `실측 대조 완료`는 쓰지 않는다.
- `score` = 팀 총딜 비율: `comparisons[].ratio`(= `total_damage ÷ reference_total`)의 최댓값. `slot`은 기준 편성에서 바꿔 넣은
  자리(0부터), `replaced`는 빠진 멤버다. 같은 비율이면 기준 편성 문서에서 먼저 나오는 자리가 `best`다.
- `hold.code`: `skills_unparsed` · `skills_empty` · `preview` · `no_burst_stage` · `no_comparison` · `sim_error`(+ `errors`:
  `[{reference, slot, replaced, error: {type, message, path}}]`) · `budget`(+ `needed`, `remaining`).
  `status_label`은 `평가 보류(<label>)` — 예산이면 `평가 보류(예산)`.
- `entries`의 순서: 등급을 매긴 항목이 점수 내림차순(같으면 이름의 코드 단위 순, `rank` 1부터) → 평가 보류 항목이 입력 순서
  (`only`에 적은 순서, 주지 않으면 엔진 카탈로그 순서)대로.
- `sims.used`는 엔진에 맡긴 요청 수(캐시 적중 포함)이고 `budget`을 넘지 않는다. `used = baselines + variants`.
- 같은 입력(엔진 판·기준 편성·규칙·`only`·`budget`)이면 `generated_at`과 `cache` 말고는 같은 문서가 나온다.
- 입력 오류(종료 코드 2): 모르는 니케 이름, 잘못된 규칙·기준 편성 문서, 쓸 수 있는 기준 편성이 없음. 엔진이 기준 편성을
  하나도 계산하지 못하면 실행 오류(종료 코드 1)다.
