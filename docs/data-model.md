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
- 검증용 계정(`is_test_data: true`, 지어낸 값): `data/samples/account.sample.json`(8명)과
  `data/samples/account.large.sample.json`(34명 — 다섯 속성 × 버스트 1·2·3단계에 고르게, 육성 정도를 일부러 다르게.
  보유 니케가 많을 때 요격전 후보가 보스의 약점 속성에 따라 달라지는지 보는 데 쓴다 — §후보 생성 §우선 속성).

## 계정 가져오기 — `src/core/import-profile.mjs`

엔진의 `scraper/profile_fetch.py`가 만든 육성 프로필(`profiles/<이름>.json`)을 계정 상태로 바꾼다. 변환은 순수 함수이고
(`src/core/import-profile.mjs` — 파일·프로세스·네트워크에 닿지 않는다. Node CLI와 오버레이가 함께 쓴다), 프로필 파일을 읽고 계정
파일을 쓰는 일은 런타임마다 따로 한다:

- **Node CLI**(`src/runtime/import-profile.mjs`): 아래 명령. **사용자가 직접 받아 둔 파일만 읽는다** — 로그인 세션·쿠키·네트워크는
  다루지 않고, 엔진의 `profiles/` 폴더에도 쓰지 않는다. 엔진 폴더에서 카탈로그와 오버로드 옵션 표를 읽어 변환 함수에 넘긴다.
- **오버레이**(계정 탭 — `app/README.md` §계정 받기): Rust 명령이 쿠키 저장·수집 스크립트 실행·프로필 읽기·계정 파일 쓰기를 하고,
  화면 쪽(`app/src/lib/accountSync.ts`)이 같은 변환 함수를 부른다. 있는 계정 파일은 `.bak`으로 한 벌 남기고 덮어쓴다(CLI는
  `--force` 없이는 덮어쓰지 않는다).

```bash
node src/cli.mjs import-profile <프로필.json> [--name <계정 이름>] [--out-dir <폴더>] [--force] [--json <결과.json>]
```

- `data/accounts/<계정 이름>.json`에 쓴다(gitignore). 이름은 `--name` → 프로필의 `_meta.name` → 입력 파일 이름 순이다.
  같은 이름의 파일이 있으면 쓰지 않는다(손으로 고친 내용을 지키기 위해). 덮어쓰려면 `--force`.
- 결과는 `is_test_data: false`, `source: "import"`, `updated_at` = 프로필의 수집 시각. 프로필이 스스로 검증용이라고 밝힌
  경우(`_meta.is_test_data: true`, 예: `data/samples/profile.sample.json`)에만 `is_test_data: true`로 남긴다.
- 순수 변환은 `importProfile(프로필, {catalog, optionTable, name, now})` → `{account, skipped, unknown, warnings}`
  (`src/core/import-profile.mjs`). `catalog`(엔진 카탈로그)와 `optionTable`(`optionTableFrom(엔진의
  data/base_stat_tables/equipment_skills.json 내용)`)은 호출하는 쪽이 준다 — 없으면 오류다. `src/runtime/import-profile.mjs`의
  같은 이름 함수는 주지 않은 것을 엔진 폴더에서 읽어 채운다. 결과 문서는 `importReport({profile, result, file, output})`이 만든다.

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
그 전에는 비워 둔 칸이 만렙으로 계산됐다). 그래서 **미확인 칸이 있는 니케는 실제보다 낮게 계산될 수 있다** — 가져오기 결과의
주의 문구(`IMPORT_CAVEATS`)가 그렇게 말한다(P-022에서 고쳤다: 그 전 문구는 P-008 때의 설명대로 "엔진이 기본 스펙 값으로
계산하므로 높게 나올 수 있다"고 했다). 채워지는 값: 돌파 0 · 코어 강화 0 · 호감도 1 · 스킬 1/1/1 · 소장품 없음 · 애장품 0단계 ·
오버로드 옵션 0줄, 장비는 오버로드 줄이 하나도 없으면 미장착(줄을 적었는데 장비만 미확인이면 엔진 기본 오버로드 장비).

결과(`importReport` — CLI의 `importProfileFile`·`--json`, 오버레이의 계정 탭. 오버레이에서는 `output`이 Rust가 쓴 계정 파일의 경로다):

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

`generateCandidates(account, catalog, { limit = 30, stageCaps = {1: 3, 2: 3, 3: 5}, priorityElement, priorityMin = 2 })` —
엔진을 부르지 않는 순수 함수. 같은 입력이면 같은 후보가 같은 순서로 나온다(계정 문서의 니케 나열 순서와 무관).
`priorityElement`(우선 속성)는 선택이다 — 주지 않으면 아래 그대로이고, 주면 §우선 속성의 규칙이 더해진다.

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

`suggestSquads({account, condition}, {limit, top = 5, refine = true, budget = 120, refineTop = 5, priorityElement, priorityMin})`(CLI `suggest`)는
후보를 `compareSquads`로 계산하고(1단계), 상위 조합의 배치를 바꿔 다시 계산한 뒤(2단계 — §배치 탐색) 총딜 상위
`top`개만 `ranking`에 남긴 비교 결과를 돌려준다. 생성 기준은 `caveats`에, 요약은 `suggestion`
(`summary` + `simulated`·`top`·`shown`·`search`)에 실린다. `simulated`는 1단계에서 계산된 조합 수다.
후보를 하나도 만들 수 없으면 입력 오류다. `priorityElement`·`priorityMin`은 생성기에 그대로 넘어간다 — CLI `suggest`와
자동 티어는 넘기지 않으므로 결과가 우선 속성이 생기기 전과 같다(넘기는 것은 요격전 추천뿐이다).

### 우선 속성

요격전 추천이 보스의 약점 속성을 넘겨 **보스마다 후보가 달라지게** 하는 선택 사항이다(§요격전 추천 결과). 투자 점수만으로
후보 풀을 고르면 보유 니케가 많은 계정에서는 덜 키운 약점 속성 니케가 후보에 들지 못한다 — 그것을 막는다.
니케의 속성은 엔진 카탈로그의 `element_code`에서 읽는다(계정 파일이나 코드에 적어 두지 않는다).

`priorityElement`를 주면:

1. **순위 점수.** 그 속성 니케는 순위 점수 = 투자 점수 + 3,402(`PRIORITY_SCORE_BONUS` — 투자 점수 만점 27,216의 1/8)로,
   다른 니케는 투자 점수 그대로 순위를 매긴다. 후보 풀·조합 순서·같은 단계 안의 배치가 모두 이 점수를 쓴다.
   **어림 규칙이다** — 속성 우위가 딜을 얼마나 올리는지 잰 값이 아니다(그것은 엔진이 계산한다). 작게 잡은 까닭: 크게 잡으면
   전혀 키우지 않은 우선 속성 니케가 키운 니케를 풀에서 밀어낸다. 이 값은 육성 정도가 비슷한 니케 사이에서 우선 속성 쪽을
   앞세우는 데 쓰고, 덜 키운 니케를 넣는 일은 2가 맡는다.
2. **단계별 최소 인원.** 버스트 단계마다 후보 풀에 그 속성 니케를 최소 `priorityMin`명(기본 2) 넣는다. 순위 점수 상위
   `stageCaps`명 안에 그만큼 없으면 그 뒤의 우선 속성 니케를 순위 점수 순으로 풀에 **더한다** — 풀이 그만큼 커지고
   (단계마다 최대 `priorityMin`명), 원래 풀에 있던 니케는 이 때문에 빠지지 않는다. 그 단계에 쓸 수 있는 보유 수가 모자라면
   있는 만큼만 넣고(0명이면 그 단계는 그대로) `summary.priority.short`와 caveats에 적는다.
3. **후보 순서**(`priorityOrder`). 조합을 순위 점수 합 순으로 정렬한 뒤 두 줄에서 번갈아 하나씩 뽑는다(우선 줄 먼저,
   이미 뽑힌 조합은 건너뛴다):
   - 우선 줄: ① 보장 후보 — 풀에 든 우선 속성 니케마다(순위 점수 순) 그 니케가 든 조합 중 순위 점수 합이 가장 높은 것
     (이미 고른 보장 후보에 든 니케는 건너뛴다) ② 우선 속성 니케가 **둘 이상** 든 나머지 조합 — 그 니케가 몇 명
     들었는가로 묶어(묶음 안은 순위 점수 합 순) 적게 든 묶음(둘)부터 돌아가며 하나씩. 덜 키운 니케는 순위 점수 합이
     낮아서, 합 순으로만 뽑으면 한 명만 든 조합만 계산되고 여럿 든 조합은 계산되지 못한다 ③ 우선 속성 니케가 한 명만
     든 나머지 조합(순위 점수 합 순) — ①이 니케마다 하나씩 이미 대표로 넣었으므로 맨 뒤다.
   - 점수 줄: 모든 조합(순위 점수 합 순).

   ②·③을 이렇게 둔 근거는 이 프로젝트의 실측이다(2026-11-12, 엔진 `67835ca`): 한 명만 든 조합까지 함께 돌리면 잘 키운
   우선 속성 니케를 **뺀** 조합이 앞에 와서 작은 예산을 낭비한다 — 샘플 계정(보스당 8건)에서 1위가 46.5억 → 39.4억으로
   나빠졌다. 많이 든 묶음부터 돌리면 덜 키운 니케를 넷·다섯 채운 조합이 앞에 온다 — 큰 시험 계정에서 1위는 둘·셋 든
   조합이었고, 많이 든 쪽부터는 같거나 나빴다(인디빌리아 60건: 42.35억 ↔ 43.00억). 계정 둘로만 본 것이다.

   그래서 앞에서 몇 개를 자르든(`limit`, 추천의 시뮬 예산) 우선 줄이 남아 있는 한 **절반 이상이 우선 속성 니케가 든
   후보**이고, 순위 점수 합이 가장 높은 조합도 둘째 안에 든다. `limit`은 이 순서의 앞에서부터 자른다.
4. **기록.** 무엇이 우선 속성 때문에 들고 빠졌는지 이름과 함께 남는다 — `summary.priority`와 caveats
   (「우선 속성이 아니었으면 그 단계의 후보 풀에 들지 못했을 니케(투자 점수가 낮아도 넣었다): 1단계 … · 3단계 …」,
   「우선 속성 니케에 순위가 밀려 그 단계의 후보 풀에서 빠진 니케: …」, 「…최소 2명을 채우지 못한 단계: 2단계(보유 1명)」).

```jsonc
// summary.priority — priorityElement를 준 때에만 있다(추천 결과에서는 suggestion.priority)
"priority": {
  "element": "풍압", "min_per_stage": 2, "score_bonus": 3402,
  "active": true,                                   // false = 풀에 그 속성 니케가 없다 — 후보가 우선 속성 없이 만든 것과 같다
  "owned": ["…"],                                   // 그 속성의 쓸 수 있는 보유 니케(순위 점수 순)
  "pool":      { "1": ["…"], "2": [], "3": ["…", "…"] },   // 단계별 풀에 든 우선 속성 니케
  "promoted":  { "1": ["…"], "2": [], "3": ["…"] },        // 그중 우선 속성이 아니었으면 그 단계 풀에 없었을 니케
  "displaced": { "1": [], "2": [], "3": [] },              // 우선 속성 니케에 순위가 밀려 그 단계 풀에서 빠진 니케
  "short": [ { "stage": "2", "wanted": 2, "available": 0 } ],   // 최소 인원을 채우지 못한 단계와 그 단계의 보유 수
  "guaranteed": 3,                                  // 맨 앞쪽에 보장한 조합 수(우선 줄의 ①)
  "candidates": 30                                  // 남긴 후보 중 우선 속성 니케가 든 것
}
```

- 우선 속성을 주지 않으면 `summary.priority` 칸이 없고 순위 점수는 투자 점수와 같다 — 후보·순서·caveats가 종전과 완전히 같다
  (`tests/unit/priority.test.mjs`가 속성 정보를 뺀 카탈로그의 결과와 견준다).
- 그 속성의 보유 니케가 없으면(또는 카탈로그에 속성 정보가 없으면) `active: false` — 후보는 우선 속성 없이 만든 것과 같고
  caveats에 그렇게 적힌다.
- 한계: 순위 점수의 가산값과 최소 인원 2명은 근거가 있는 값이 아니다. 우선 속성 니케를 **후보에 넣을 뿐**이고 순위는 엔진이
  계산한 총딜로 정한다 — 덜 키운 약점 속성 니케가 든 편성이 실제로 더 좋은지는 계산해 봐야 안다. 최소 인원을 넘는 그 속성
  니케는 여전히 풀 밖일 수 있다(`excluded`에 이름이 있다).

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
  우선 속성(§후보 생성 §우선 속성)이 있으면 후보는 그 절의 순서(우선 속성 니케가 든 조합과 순위 점수 합이 높은 조합을
  번갈아)로 놓여 있다 — 예산이 모자라 뒤를 자를 때 계산한 후보의 절반 이상이 우선 속성 니케가 든 후보이고, 풀에 든 우선
  속성 니케마다의 보장 후보가 맨 앞에 있다. 우선 속성 니케가 든 후보가 먼저 잘리지 않는다.
- 2단계: 남은 예산을 상위 조합이 순위 순으로 돌아가며 하나씩 나눠 갖는다(`planRefinement` — 1위의 첫 변형 →
  2위의 첫 변형 → … → 1위의 둘째 변형 …).
- 2단계는 우선 속성과 무관하다 — 1단계에서 **엔진이 계산한 총딜** 상위 조합의 배치를 본다.
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

- `rejected`: 시뮬 전에 걸러진 편성(미보유·중복·인원 수·모르는 이름·모르는 육성 기준). 엔진에 보내지 않는다.
- 편성 항목의 `growth`(선택 — P-030): `"engine_default"`면 그 편성은 계정의 육성 대신 엔진 기본 스펙으로 계산된다(§덱 빌더 §육성 기준).
  그런 편성의 순위 항목에는 `growth: "engine_default"`와 `level`(계산한 레벨)이 실리고, caveats에 그 기준의 뜻이 한 줄 붙는다.
  적지 않으면(`"account"`도 같다) 종전 그대로다 — 결과 문서도 이 칸이 생기기 전과 같다.
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
(`suggestSquads` — 멤버 조합 + 배치 탐색 + 캐시)을 돌린다. 보스마다 **그 보스의 약점 속성을 후보 생성의 우선 속성으로
넘긴다**(§후보 생성 §우선 속성) — 후보 풀과 후보 순서가 보스마다 달라진다. `deps`는 추천과 같고,
`onBoss({index, total, boss: {id, name}, budget})`가 더해진다(그 보스의 계산 직전).

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
      "suggestion": { "search": { "budget": 60, "sims": 57 },            // §후보 생성·§배치 탐색의 suggestion 그대로
                      "priority": { "element": "작열", "promoted": { "1": [], "2": [], "3": ["…"] } } },   // §우선 속성. 적 속성을 모르는 보스에는 이 칸이 없다
      "weak_pool": { "element": "작열", "owned": ["…"], "pooled": ["…"], "not_pooled": ["…"],   // 약점 속성 보유 니케가 후보 풀에 들었나(이름순). 알 수 없으면 null
                     "promoted": ["…"] },                                // pooled 가운데 약점 속성 우선 덕에 든 니케(투자 점수만으로는 풀에 없었을 니케)
      "notes": ["약점 속성(작열) 우선으로 후보 풀에 넣은 니케: … — 투자 점수만으로는 풀에 들지 못했을 니케다.",
                "약점 속성(작열) 보유 니케 4명 중 1명은 후보 풀에 들지 못했다(…) — 약점 속성 니케는 버스트 단계마다 최소 2명까지만 보장한다."],
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
- **예산 배분과 약점 속성.** 약점 속성을 우선해도 예산은 늘지 않는다 — 보스의 몫 안에서 쓰는 순서만 달라진다.
  1. 보스의 몫에서 1단계(멤버 조합)가 먼저 후보를 **후보 순서의 앞에서부터** 몫만큼(최대 `limit` 30개) 계산한다.
  2. 후보 순서는 §우선 속성의 3이다: 약점 속성 니케가 든 조합(풀에 든 약점 속성 니케마다의 보장 후보가 맨 앞)과 순위 점수
     합이 높은 조합을 번갈아 둔다. 그래서 몫이 작아 후보를 줄여도 **계산한 후보의 절반 이상이 약점 속성 니케가 든
     후보**이고(그런 조합이 남아 있는 한), 약점 속성 니케가 든 후보가 먼저 잘리지 않는다. 몫이 1건이면 그 한 건은 순위
     점수가 가장 높은 약점 속성 니케의 보장 후보다.
  3. 남은 몫은 2단계(배치)가 1단계 총딜 상위 조합에 쓴다 — 이 단계는 속성을 보지 않는다.
- **후보는 보스마다 다르다.** 약점 속성 니케는 버스트 단계마다 후보 풀에 최소 2명(보유 수가 모자라면 있는 만큼) 들고,
  덜 키워서 투자 점수만으로는 풀에 없었을 니케는 `weak_pool.promoted`·`suggestion.priority.promoted`·보스의 `notes`·`caveats`에
  이름이 남는다. 최소 인원을 넘어 풀에 들지 못한 약점 속성 니케는 `weak_pool.not_pooled`와 `notes`에 있다. 약점 속성 니케를
  보유하지 않았으면 후보는 투자 점수로만 고른 것과 같고 `notes`에 그렇게 적힌다.
- **적 속성을 모르는 보스**(`element.reflected: false`)는 우선 속성 없이 돌린다 — 후보가 CLI `suggest`의 것과 같고
  `suggestion.priority` 칸이 없다.
- 확인(2026-11-12, 엔진 `67835ca`, `data/samples/account.large.sample.json` — 지어낸 계정 34명). 같은 예산으로 약점 속성을
  우선한 추천과 우선하지 않은 추천(`suggestSquads`에 같은 조건)의 1위 총딜을 견줬다:

  | 보스(약점) | 20건: 우선 없음 → 우선 | 60건: 우선 없음 → 우선 | 1위에 든 덜 키운 약점 속성 니케 |
  |---|---|---|---|
  | 인디빌리아(작열) | 40.98억 → 40.70억 | 43.00억 → 43.00억 | 없음 |
  | 울트라(철갑) | 41.61억 → 38.80억 | 44.23억 → 42.96억 | 없음 |
  | 하베스터(수냉) | 38.39억 → 38.39억 | 40.21억 → 40.21억 | 없음 |
  | 크라켄(풍압) | 36.66억 → 48.29억 | 44.41억 → 53.30억 | 아스카 : WILLE |
  | 미러 컨테이너(전격) | 41.51억 → 45.09억 | 44.95억 → 47.74억 | 에이다 |

  우선하지 않으면 20건에서 네 보스의 1위가 같은 편성이었다. 우선하면 두 보스는 덜 키운 약점 속성 니케가 든 다른 편성이
  1위가 되어 총딜이 6~32% 올랐다. **나빠지는 보스도 있다**(울트라 −3~7%): 예산의 절반쯤을 약점 속성 니케가 든 후보에
  쓰므로, 그 니케들이 실제로는 약할 때 속성과 무관하게 좋은 조합을 그만큼 덜 본다. 넣는다고 언제나 이기는 것이 아니다.
  실제 계정·인게임 기록으로는 확인하지 않았다. `tests/integration/intercept-priority.engine.test.mjs`가 크라켄·미러 컨테이너를 확인한다.
- **미확인.** `unconfirmed`는 미확인 칸마다 `computed_as`(실제로 계산에 쓴 값)와 `text`를 싣는다. 속성을 모르는 보스는
  `flags: ["속성 상성 미반영"]`, `element.reflected: false`이고 표에서는 보스 이름 바로 아래에 `!! 속성 상성 미반영 !!`가 따로 나온다.
- **주의 문장.** 최상위 `caveats`: 요격전 공통 문장(실제 요격전 기록과 대조하지 않았다 · 보스 패턴 미반영 · 미확인 값 ·
  예산 · 후보 편성은 보스마다 다르다 — 약점 속성 우선은 어림 규칙이다) 뒤에 보스별 추천의 주의 문장을 합친 것이 온다 —
  계산한 모든 보스에 공통인 문장은 한 번, 일부 보스의 것은 `[보스 이름, …]`이 앞에 붙는다(우선 속성 문장은 속성 이름이
  들어 있어 보스마다 따로 나온다). 레벨을 가정한 경우의 문장도 여기에 온다.
- 같은 입력(계정·보스 묶음·`top`·`budget`·엔진 판)이면 `generated_at`과 `cache` 말고는 같은 문서가 나온다.
- 입력 오류(종료 코드 2): 잘못된 보스 묶음·계정, 없는 보스 이름, 후보 편성을 만들 수 없는 계정.
- 표 출력은 `renderInterceptReport`(`src/core/render.mjs`). 오버레이 화면은 아직 없다(P-017).

## 요격전 계획 — `src/core/plan.mjs`

P-029. 계정 상태·요격전 추천 결과·보스 묶음을 이어 「오늘 어느 보스를 돌아야 하는가」에 답하고, 손으로 적은 요격전 기록을
추정 총딜과 견준다. 순수 모듈이다(파일·프로세스·네트워크·시계에 닿지 않는다 — 웹뷰와 Node가 함께 쓴다). 화면은
`app/README.md` §요격전 계획. **계정에 없는 것은 지어내지 않는다** — 모르는 것은 `unknowns`의 문장으로 함께 돌려준다.

### 장비 현황

계정 상태의 `nikkes.<이름>.equipment`(부위 `머리`·`몸통`·`팔`·`다리` → `{tier, corp, level, skills}` — 엔진 표기)를 그대로 읽는다.

| 칸의 값 | 상태(`gearState`) | 화면의 말 |
|---|---|---|
| `tier: "없음"` | `empty` | 미장착 |
| `tier: "T1"`~`"T9"`만 | `normal` | 일반 등급(강화 없음) |
| `tier: "T1"`~`"T9"` + `corp` | `corp` | 기업 장비(강화 0~5) |
| `tier` 생략(또는 `"기업"` — 엔진의 오버로드 표 이름) | `overload` | 오버로드(강화 0~5) |
| 칸이 없다 / `equipment`를 적지 않았다 | `unrecorded` | 기록 없음 |
| `unknown`에 `equipment`가 있다 / 읽을 수 없는 값 | `unknown` | 미확인 |

- 「오버로드가 아닌 칸」은 `empty`·`normal`·`corp`다. **기록 없음·미확인은 세지 않는다**(끼지 않은 것으로 치지 않는다) — 그런
  니케의 수는 `gearSummary().unrecorded`로 따로 알린다. 계산 쪽(`toEngineEntry`)은 장비를 적지 않은 니케를 미장착이나 엔진 기본
  오버로드 장비로 **계산**하지만(§계정 상태), 그것은 계산의 가정이지 계정에 적힌 사실이 아니라 장비 현황에는 쓰지 않는다.
- `gearSummary(rows, {infoOf})` → `{nikkes, recorded, unrecorded, open, by_part[{part, open, empty, normal, corp, overload}],
  by_corp[{corp, open, nikkes}], unknowns}`. 기업은 **니케의 기업**(카탈로그의 `manufacturer`)이고 모르면 「모름」으로 묶는다.
- 가지고 있지만 끼지 않은 장비의 수는 계정 상태에 없다 — `unknowns`가 그렇게 말한다.
- 손으로 만든 검증용 계정에는 `equipment`가 없다. 테스트는 `data/samples/account.large.sample.json`에
  `data/samples/gear.large.sample.json`(지어낸 장비 — 니케 이름 → `equipment`, `is_test_data: true`)을 얹어 쓴다. 큰 샘플 계정
  자체에 장비를 넣지 않은 것은 그 계정으로 잰 계산 결과(§후보 생성 §우선 속성)를 바꾸지 않기 위해서다.

### 주력 니케 — `pickCore({report, favorites, unused, account, limit})`

어느 니케의 장비가 중요한가. 위에서부터 처음 맞는 것 하나다(결과의 `basis`·`text`가 어느 기준이었는지 말한다):

1. `intercept` — 요격전 추천 결과에서 보스마다 1위 편성에 든 니케(겹치는 이름은 한 번).
2. `favorites` — 추천이 없으면 사용자가 즐겨찾기로 고른 니케.
3. `score` — 그것도 없으면 투자 점수(`investmentScore` — 성능 추정이 아니다) 상위 `limit`명(기본 10, 동점은 이름순).
   「안 씀」으로 표시한 니케(`unused` — §즐겨찾기와 「안 씀」)는 여기서 뺀다.

계정을 주면 그 계정이 가진 니케만 남긴다(다른 계정으로 계산한 옛 결과의 이름을 걸러 낸다).

### 오늘 돌 보스 — `recommendBoss({bosses, rows, core})`

보스의 보상 문구에서 부위를 읽고(`rewardPart`: 「머리 장비」 → `머리`. 「커스텀 모듈」처럼 장비가 아니면 `null` — 세지 않고
`note`에 그렇게 적는다), 주력 니케의 그 부위 가운데 오버로드가 아닌 칸을 센다.

- 급한 순서: 칸 수가 많은 보스 → 같으면 더 비어 있는 쪽(미장착 3 · 일반 등급 2 · 기업 장비 1의 합) → 그래도 같으면 **함께 적는다**(동률).
- 결과: `{status, text, top[], max_need, bosses[{id, name, reward, part, need, reasons[{nikke, part, state, label, tier, level}], note}],
  core, unrecorded[], unknowns[]}`. `status`는 `pick`(「머리 장비가 가장 급하다 → 울트라」) · `tie`(「머리·팔 장비가 똑같이 급하다 →
  울트라 또는 미러 컨테이너」) · `done`(적힌 칸이 모두 오버로드) · `no_data`(주력의 장비가 계정에 적혀 있지 않다) · `no_core`.
- **보상이 나올 확률과 한 번에 얻는 수는 모른다** — 「언제 다 모이는지」는 어림하지 않고 `unknowns`가 그 사실을 말한다.
  무게(3·2·1)는 순서를 가릴 때만 쓰는 어림이다.

### 속성 커버리지 — `elementCoverage(account, {infoOf, bosses})`

속성 다섯마다 「키운 딜러」가 몇 명인가. **기준(`COVERAGE_RULE`): 클래스가 화력형이고 돌파 3 이상, 스킬 셋이 모두 7 이상.**
어림 기준이다(성능을 잰 값이 아니다). 미확인 칸(`unknown`의 `breakthrough`·`skill_levels`)은 채우지 못한 것으로 본다.
결과: `{rule, rule_text, elements[{element, count, names, bosses[{id, name}]}], max, weakest[], unsure[]}` — `bosses`는 그 속성이
약점인 보스, `weakest`는 키운 딜러가 가장 적은 속성(다섯이 모두 같으면 빈 배열), `unsure`는 육성 기준은 채웠지만 속성·클래스를
몰라 세지 못한 니케다.

### 요격전 기록 — 계획 문서

사용자가 보스별로 실제 대미지(모의전 또는 실전)·날짜·달성 단계를 손으로 적어 둔다. 즐겨찾기·「안 씀」 표시·모듈 기록(P-033)과
함께 계정마다 한 파일이다:
**계정 폴더의 `<계정 이름>.plan.json`**(`data/accounts/` — gitignore. 이름에 점이 더 있어 계정 목록에 들지 않는다).
읽고 쓰는 것은 Rust(`app/src-tauri/src/shared_state.rs`의 `load_plan`·`save_plan` — 종류·판·목록 둘과 항목 수 2,000건까지만 확인),
값의 검사는 이 모듈이 한다.

```jsonc
{
  "schema_version": 1,
  "kind": "intercept_plan",
  "favorites": ["크라운", "헬름"],          // 즐겨찾기로 고른 니케(엔진 정식 명칭)
  "unused": ["네온"],                       // 「안 씀」으로 표시한 니케(P-033 — §즐겨찾기와 「안 씀」). 예전 문서에는 없다(빈 목록으로 읽는다)
  "rewards": [ /* 모듈 기록 — §모듈 기록 */ ],  // P-033. 예전 문서에는 없다(빈 목록으로 읽는다)
  "records": [
    {
      "id": "r1",                          // 이 문서 안에서 겹치지 않는 번호
      "boss_id": "kraken",                 // 보스 묶음의 id
      "boss_name": "크라켄",
      "damage": 940000000,                 // 실제 대미지(양의 정수)
      "mode": "mock",                      // mock = 모의전, real = 실전
      "date": "2026-11-12",                // YYYY-MM-DD(달력에 있는 날)
      "stage": 4,                          // 달성 단계(1~99) 또는 null
      "note": null,
      "created_at": "2026-11-12T12:00:00.000Z"   // 적은 시각(부르는 쪽이 준다) 또는 null
    }
  ]
}
```

- `parseDamage(글자)`: 게임에 보이는 숫자 그대로(`1,234,567,890`)나 단위 표기(`12.3억`·`1조 2000억`·`3500만`)를 정수로. 못 읽으면 `null`.
- 판은 그대로 1이다 — P-033의 칸 둘(`unused`·`rewards`)은 **없어도 되는 칸**이다(Rust는 있으면 목록인지와 항목 수만 본다:
  `PLAN_OPTIONAL_LISTS`). `emptyPlan()`과 `readPlan()`이 돌려주는 문서에는 언제나 네 목록이 다 있다.
- `addRecord`·`removeRecord`·`toggleFavorite`는 새 문서를 돌려준다(받은 문서를 바꾸지 않는다). 기록은 500건까지 남기고 넘으면
  오래된 것부터 뺀다. `readPlan(문서)`는 종류·판이 다르면 한국어 문장으로 던지고, 모양이 맞지 않는 항목은 버리며 그 수를 알린다.
- 달성 단계의 실제 범위는 모른다(게임 화면에서 본 것은 「달성 단계 4」 하나 — `docs/intercept.md`). 1~99로 넉넉히 받는다.
- **기록과 추정의 비교** — `compareRecord(추정 총딜, 기록)` → `{estimate, actual, ratio, diff_pct, direction, text, detail}`.
  `diff_pct` = (추정 − 기록) ÷ 기록 × 100(양수면 추정이 크다), `text`는 배지의 말(「기록과 12% 차이」 · 「기록과 1% 미만 차이」 ·
  「기록과 같다」). 보스의 **가장 최근 기록**(날짜가 늦은 것, 같은 날이면 나중에 적은 것)과 1위 편성의 총딜을 견준다(`recordCheck`).
  **추정치를 기록에 맞춰 고쳐 쓰지 않는다** — 차이를 알릴 뿐이다(보스 값 보정은 별도 작업이다. 차이가 크면 그 근거가 된다).

## 즐겨찾기와 「안 씀」 — `src/core/plan.mjs` · `src/core/exclude.mjs`

P-033. 니케에 붙이는 표시 둘이다. **표시일 뿐이다 — 계정 문서는 바뀌지 않는다.** 요격전 계획 문서(§요격전 기록 — 계획 문서)의
`favorites`와 `unused`에 이름으로 남는다(계정마다 따로).

- **둘은 함께 붙지 않는다.** `toggleFavorite`는 그 니케의 「안 씀」을 내리고, `toggleUnused`는 즐겨찾기를 내린다(둘 다 새 문서를
  돌려준다). 문서에 둘 다 적혀 있으면 `readPlan`이 즐겨찾기로 읽는다(빼는 쪽이 아니라 남기는 쪽으로).
- `markOf(plan, name)` → `'favorite'` · `'unused'` · `null`. `passesMark(plan, name, filter)` — 거르기 셋(`MARK_FILTERS`):
  `favorite` 즐겨찾기만 · `unused` 안 씀만 · `active` 안 씀 빼고. 내 니케와 덱 빌더의 보유 니케 격자가 쓴다(덱 빌더에서 「안 씀」
  니케를 넣는 것은 막지 않는다 — 손으로 짜는 편성은 사용자가 정한다).
- `unusedOwned(plan, account)` → 「안 씀」 가운데 그 계정이 가진 이름(계정에 적힌 순서). 추천에서 뺄 목록이다.
- `pickCore`는 기준이 육성 점수일 때(`score`) 「안 씀」 니케를 고르지 않는다(추천 편성에 든 니케·즐겨찾기 기준은 그대로다).

### 추천에서 빼기 — `excludeNikkes(account, names)`

**선택이다(기본은 빼지 않는다).** `suggestSquads`·`recommendIntercept`의 옵션 `exclude`(니케 이름의 목록)를 주면 그 니케들이 없는
계정 사본으로 후보를 만들고 계산한다. CLI는 `suggest`·`intercept`의 `--exclude "이름,이름"`.

- `excludeNikkes` → `{account, excluded}`. 계정이 갖지 않은 이름은 세지 않는다. **뺀 것이 하나도 없으면 받은 계정을 그대로
  돌려주고 `excluded`는 `null`이다** — 그때 결과 문서에는 아무 칸도 더해지지 않는다(빼지 않은 계산의 결과는 종전과 같다).
- **뺐다는 사실이 결과에 남는다**: 비교 결과(§비교 결과)와 요격전 추천 결과(§요격전 추천 결과)의 최상위에
  `excluded: {reason: "unused", label: "안 씀", names: [...], count, text}`가 생기고, 같은 문장(`text` — 「「안 씀」으로 표시한 니케
  N명을 빼고 계산했다: …」)이 `caveats`의 마지막 줄로 들어간다. 화면은 접힌 구획 밖의 배지(「안 씀 N명 제외」)로 보인다.
- 요격전 추천은 모든 보스를 뺀 계정으로 계산한다 — `weak_pool`(약점 속성 보유 니케)에도 뺀 니케는 없다.
- 빼고 나면 편성을 만들 수 없을 때(예: 버스트 1단계 니케를 모두 뺐다)는 0이나 빈 추천으로 채우지 않고 입력 오류로 거부한다
  (「후보 편성이 없다 — 버스트 1단계 니케를 보유하지 않았다」).
- `exclude`가 이름의 목록이 아니면 입력 오류다(`/exclude`).
- 덱 빌더의 「한 명을 바꾼다면」과 육성 효율표는 이 선택을 쓰지 않는다(편성을 사용자가 정한 계산이다).

## 모듈 기록 — `src/core/journal.mjs`

P-033. 요격전을 돌고 얻은 것을 **날짜별로 손으로 적는 기록장**이다: 이상 개체 보스 · 달성 단계 · 얻은 것(장비 부위별 수 · 커스텀
모듈 수). 순수 모듈이다(시계를 읽지 않는다 — 「오늘」은 부르는 쪽이 넘긴다). 기록은 요격전 계획 문서의 `rewards`에 들어간다 —
**저장은 계정 폴더의 `<계정>.plan.json`**(§요격전 기록 — 계획 문서). 날짜 계산은 `src/core/dates.mjs`.

```jsonc
{
  "id": "m1",                          // 이 문서 안에서 겹치지 않는 번호
  "date": "2026-11-12",                // YYYY-MM-DD(달력에 있는 날)
  "boss_id": "kraken",                 // 보스 묶음의 id
  "boss_name": "크라켄",
  "stage": 4,                          // 달성 단계(1~99) 또는 null
  "gear": { "머리": 0, "몸통": 0, "팔": 0, "다리": 0 },   // 얻은 장비의 수(부위마다 0~99)
  "modules": 2,                        // 얻은 커스텀 모듈의 수(0~999)
  "note": null,
  "created_at": "2026-11-12T12:00:00.000Z"
}
```

- `rewardProblems(기록)` — 모양 검사(한국어 문장). `addReward`·`removeReward`는 새 문서를 돌려준다. 1,000건까지 남기고 넘으면 오래
  적은 것부터 뺀다. 얻은 것이 없어도(전부 0) 적을 수 있다 — 돈 횟수에는 든다.
- **합**: `rewardSum(기록들)` → `{runs, modules, gear{부위: 수}, gear_total}`. `periodTotals(기록들, 'week' | 'month')` → 주마다·달마다의
  합(최근이 앞 — `{key, label, from, to, …합}`). **주는 월요일부터 일요일까지**(달력 기준 — 게임의 초기화 시각과 다를 수 있다).
- **보스별 횟수**: `bossCounts(기록들, 보스 목록)` → `{boss_id, boss_name, runs, last_date, best_stage, modules, gear, gear_total}`
  (많이 돈 순서). 보스 목록을 주면 한 번도 적지 않은 보스도 0번으로 나온다.
- `journalSummary(plan, {today, bosses})` → `{total, this_week, this_month, weeks, months, bosses, notes}` — 이번 주·이번 달은 기록이
  없어도 0으로 나온다. `notes`(화면이 접지 않고 적는 문장): 「손으로 적은 것만 센다 — 보상이 나올 확률과 한 번에 얻는 수는 이 앱이
  모른다」, 「주는 월요일부터 일요일까지로 묶었다」.
- **요격전 기록과 한 화면**: `journalDays(plan)` → 날짜마다(최근이 앞) `{date, rewards[], damages[]}` — `damages`는 P-029의 요격전
  대미지 기록(`records`)이다. 어느 쪽도 고치지 않는다. 대미지 기록은 합(얻은 것)에 세지 않는다.
- 달성 단계의 실제 범위·보상의 확률과 수는 모른다(§요격전 기록). 값의 상한(99·999)은 잘못 누른 큰 수를 막는 것이지 게임의 규칙이 아니다.

## 계정 여러 개 — `app/src-tauri/src/shared_state.rs` · `src/core/accounts.mjs`

P-033. 계정 폴더에 계정이 여럿이면(본계·부계) 설정과 화면 위쪽에서 바꾼다. **계정마다 따로 두는 것**(계정 폴더 — gitignore):

| 파일 | 내용 |
|---|---|
| `<계정>.json` | 계정 상태(§계정 상태). `<계정>.json.bak`은 새로 받기 전의 사본 |
| `<계정>.intercept.json` | 그 계정의 마지막 요격전 추천 결과(§요격전 추천 결과) — **P-033에서 계정마다 따로가 됐다** |
| `<계정>.plan.json` | 요격전 기록 · 모듈 기록 · 즐겨찾기와 「안 씀」(§요격전 기록 — 계획 문서) |
| `<계정>.decks.json` | 덱 빌더에서 저장한 편성(§덱 빌더 §내 편성) |

- **요격전 결과**: `save_intercept_for(dir, name, report)`가 `<name>.intercept.json`에 쓴다 — 화면은 **계산을 시작할 때 쓰던 계정의
  이름**을 넘긴다(계산하는 동안 쓰는 계정이 바뀌어도 결과가 다른 계정의 것으로 남지 않는다. 그때 화면에는 올리지 않고 한 줄로
  알린다). 이름은 경로가 아니라 열쇠다(이름 검사 → 계정 목록에 있는 이름만). 이름을 주지 않으면 지금 쓰는 계정이다.
  `load_intercept`는 지금 쓰는 계정의 것을 읽는다 — 계정을 바꾸면 공유 상태의 `intercept_saved_at`도 그 계정의 것으로 바뀌고,
  화면은 앞 계정의 결과를 치운 뒤 다시 읽는다.
- **예전 결과**: P-033 전에는 결과가 한 자리(`.last-intercept.json`)뿐이었다. 지금 쓰는 계정에 제 결과가 아직 없고 그 자리에 결과가
  남아 있으면 이름을 바꿔 그 계정의 것으로 삼는다(한 번뿐). 어느 계정으로 계산한 것인지는 그 파일에 없다 — 그때 쓰던 계정이
  지금 쓰는 계정이라고 본 것이다. 쓰는 계정이 정해지지 않았을 때(계정 없음)는 여전히 그 한 자리를 쓴다.
- **숨기기**: `set_account_hidden(dir, name, hidden)` — 상태 파일(`.companion-state.json`)의 `hidden_accounts`에 이름을 적을 뿐이다.
  **파일은 지우지 않는다**(이 모듈에는 계정을 지우는 코드가 없다 — 지우는 명령도 앱에 없다). 지금 쓰는 계정을 숨기면 고른 계정이
  없어지고(남은 계정이 하나면 그것을 쓴다), 숨긴 계정은 스스로 쓰이지 않는다. 숨긴 계정을 고르거나 새로 받으면 다시 보인다.
- 공유 상태(`SharedSnapshot`)의 칸: `default_account, remembered, accounts(보이는 것), hidden_accounts(숨긴 것),
  accounts_location, overlay_launch, intercept_saved_at(지금 쓰는 계정의 것), problems`. `accounts_location`은 계정 폴더의 위치를
  사람이 읽는 글자로 적은 것이다 — **계정을 완전히 지우려는 사람에게 어디에 있는지 알려 주는 데만 쓴다**(화면이 그 글자를 명령에
  넘기지 않는다 — 명령은 폴더·파일 이름을 받지 않는다).
- 화면의 규칙(순수 — `src/core/accounts.mjs`): `accountChoices(snapshot, {computing})` → `{current, accounts[{name, modified_at,
  current}], hidden[], show, needs_choice, locked, locked_reason}`. 위쪽의 바꾸는 칸은 **고를 계정이 둘 이상일 때만** 보이고(`show`),
  **계산이 도는 동안에는 바꾸지 못한다**(`locked`). `accountFiles(name)` → 그 계정의 파일 이름과 무엇인지(지우려는 사람에게 보인다).

## 도구 링크 — `data/links/tools.json` · `src/core/links.mjs`

P-033. 커뮤니티 도구 목록(이름 · 한 줄 설명 · 주소)과 「이 앱이 하지 않는 것」. **저장소의 데이터 파일**이고 출처는 그 파일의
`source`에 적는다(니케 마이너 갤러리의 글 「니케 유용한 툴 모음집」 — 2026-11-12에 대화형 세션이 직접 열어 본 것만 담았다).
**이 앱은 그 사이트들의 내용을 가져오지 않는다** — 누르면 기본 브라우저로 열 뿐이다.

```jsonc
{
  "schema_version": 1,
  "kind": "tool_links",
  "source": { "title": "니케 유용한 툴 모음집", "where": "니케 마이너 갤러리의 글", "checked_at": "2026-11-12", "note": "…", "description_note": "…" },
  "links": [
    { "id": "letsdoro",                // 목록의 열쇠(소문자·숫자·붙임표, 40자까지) — 화면이 여는 명령에 넘기는 것은 이것뿐이다
      "name": "레츠도로",
      "url": "https://letsdoro.com/",  // https의 평범한 주소만(아래)
      "description": "…",              // 한 줄 설명
      "basis": "recorded" }            // 설명의 근거: recorded = 열어 본 기록에 기능이 적혀 있다 · category = 분류 한마디만 남아 있다
  ],
  "not_supported": [                   // 이 앱이 하지 않는 것과 대신 안내할 도구(목록의 id)
    { "id": "pvp", "topic": "PVP 계산", "reason": "이 앱의 계산 도구는 PVP(아레나)를 계산하지 않는다 — 지원하지 않음.", "links": ["pvp-meta", "arena-tools"] }
  ]
}
```

- **여는 주소는 목록에 있는 것뿐이다.** 화면은 앱 명령 `open_tool_link(id)`에 **id만** 넘긴다(주소가 아니다). Rust
  (`app/src-tauri/src/tool_links.rs`)가 같은 문서를 실행 파일에 넣어 두고, id가 목록에 있을 때만 그 도구의 주소를 운영체제의
  「열기」(`ShellExecuteW` — 동작은 `open`뿐)로 연다. 셸·열기 플러그인을 쓰지 않는다 — 화면이 임의의 주소·파일·프로그램을 열 길이 없다.
- **열어도 되는 주소**(`isSafeLinkUrl` — Rust의 `is_safe_url`과 같은 규칙): `https://` + 호스트(점으로 나뉜 이름 둘 이상 —
  소문자·숫자·붙임표) + 길(글자·숫자와 `/ - _ . ~`), 200자까지. 공백·따옴표·`?`·`#`·`@`·`:`(포트)·`%`·`\`가 있으면 거부한다.
- `linkProblems(문서)` — 모양 검사(종류·판·출처·id와 주소의 겹침·근거·`not_supported`가 가리키는 id). `readToolLinks(문서)` →
  `{source, links[], not_supported[{id, topic, reason, links[도구]}]}`. `linkById(문서, id)` — id로만 찾는다(주소·경로를 넣으면 `null`).
- **한 줄 설명의 근거**: 열어 본 기록(이 저장소의 작업 설명·진행 기록)에 기능이 적혀 있던 도구는 그것을 줄였고(`recorded`),
  분류 한마디만 남아 있던 도구(도로파티 · 니케 금서고 · NIKKE PvP META · 니케피그 · 홍련 농장)는 그 한마디만 적고 `category`로
  표시했다 — 기능을 지어내지 않았다. 화면은 그런 도구에 「설명은 분류만」 배지를 붙인다.
- 이 앱이 하지 않는 것 넷: **PVP 계산**(계산 도구가 PVP를 계산하지 않는다 — 지원하지 않음) · **통계·랭킹**(서버 데이터가 필요하다) ·
  **스토리 열람** · **유니온 구인**. 각각 까닭과 안내할 도구가 있다.

## 계산기 출처 점검 — `src/core/calculators.mjs`

P-034. 소장품 강화 · 모집 확률 계산기는 **만들지 않았다 — 값의 출처가 없다**(조사 결과는 `docs/calculators.md`). 그래서 계산기의
입력·결과 형식은 없고, 있는 것은 「엔진의 표에 그 값의 칸이 있는가」를 다시 보는 점검뿐이다. 순수 모듈이고(`node:` import 없음)
**게임의 값이 하나도 없다**(단위 테스트가 소스에 두 자리 넘는 숫자가 없는지 본다). 화면은 이 모듈을 쓰지 않는다.

- `CALCULATOR_NEEDS` — 쓰려던 값 셋: `collection-exp`(소장품 단계별 필요 경험치) · `kit-exp`(관리 키트 세 종류의 경험치) ·
  `recruit-rates`(공식 모집 확률 표). 값마다 칸 이름에서 찾을 말이 있다: `words`는 칸 이름을 영문·숫자 토막으로 나눈 것과 **같아야**
  하고(`need_exp`·`needExp`의 `exp` — `spot_explosion_range`는 아니다), `parts`는 들어 있기만 하면 되는 한국어다(「경험치」·「키트」·
  「모집」·「뽑기」). 「확률」·`rate`만으로는 걸지 않는다(크리티컬 확률·연사 같은 전투 칸이 있다).
- `CALCULATORS` — 살펴본 계산기 둘과 각각이 쓰는 값: `collection-upgrade`(소장품 강화 — 앞의 둘) · `recruit`(모집 확률 — 셋째).
- `keyNames(문서)` — JSON의 모든 칸 이름(객체의 열쇠). **값은 보지 않는다**(설명문 안의 「경험치」는 버프 이름이다).
- `collectionColumns(소장품 표)` → `{stages, columns}` — 엔진 `collection.json`의 `_stat_table` 줄 수와 칸 이름. 지금은
  `{stages: 32, columns: ["atk", "def", "hp", "skill_lv"]}`다.
- `cdnPathsIn(수집 코드의 글)` — 따옴표로 적힌 평문 경로(`"/equip/….json"`). `{locale}`은 `ko`로 읽어 같은 표를 하나로 센다.
- `auditCalculatorSources({files, cdnPaths})` — `files`는 `{파일 이름: 읽어 둔 JSON}`(읽는 쪽은 테스트다), `cdnPaths`는 경로 목록.

```jsonc
{
  "schema_version": 1,
  "kind": "calculator_sources",
  "looked": { "files": ["base_stat_tables/collection.json", "…"], "cdn_paths": ["/equip/ko/favorite_{fid}.json", "…"] },
  "collection_table": { "stages": 32, "columns": ["atk", "def", "hp", "skill_lv"] },
  "needs": [
    { "id": "collection-exp", "label": "소장품 단계별 필요 경험치", "found": false,
      "hits": [] }               // 걸린 칸: {where: "file", file, key} 또는 {where: "cdn_path", path}
  ],
  "calculators": [
    { "id": "collection-upgrade", "title": "소장품 강화", "needs": ["collection-exp", "kit-exp"],
      "missing": ["collection-exp", "kit-exp"],   // 칸이 보이지 않는 값
      "status": "no_source",                      // no_source = 출처 없음 · candidate = 확인 필요
      "status_label": "출처 없음",
      "built": false }                            // 이 점검은 계산기를 만들지 않는다 — 늘 false
  ],
  "caveats": ["칸 이름만 본다 — …", "수집 코드가 받는 공개 표의 원본에 … 알 수 없다."]
}
```

- **상태는 둘뿐이다.** 필요한 값 가운데 하나라도 칸이 보이지 않으면 `no_source`, 다 보이면 `candidate`다. `candidate`는
  「확인됨」이 아니다 — 칸 이름이 걸렸을 뿐이고 그 표가 맞는지는 사람이 읽고 정한다. 이 점검만으로 계산기가 생기지 않는다.
- `renderSourceReport(보고서)` — 사람이 읽는 줄들(「소장품 표: 32단계 · 칸 atk, def, hp, skill_lv」 · 「- 공식 모집 확률 표: 없다」 ·
  「소장품 강화 계산기: 출처 없음」).
- 실제 엔진 데이터로 돌리는 것은 `tests/integration/calculators.engine.test.mjs`다(성장 표 일곱 · 소장품 표의 칸 · 수집 경로 아홉 ·
  걸린 칸 0개). 엔진의 데이터가 바뀌어 이 테스트가 실패하면 `docs/calculators.md`를 다시 조사한다.

## 덱 빌더 — `src/core/deck.mjs`

P-030. 손으로 짠 편성 하나를 계산하고 바꿔 보는 순수 모듈이다(`node:` import 없음 — 웹뷰와 Node가 함께 쓴다).
**엔진 요청을 만드는 코드는 여기에 없다**: 계산은 전부 `compareSquads`(§비교 결과)가 하고, 자리 변형은 §배치 탐색의
`placementVariants`·`planRefinement`·`pickBestPlacement`, 보스 → 전투 조건과 미확인 칸은 §보스 묶음의 `bossCondition`·`unconfirmedOf`를
그대로 쓴다. 커뮤니티 도구들(편성 화면·팀 빌더)의 **기능의 생각만** 참고했다 — 코드·이미지·데이터는 가져오지 않았다.

### 편성 짜기

자리는 다섯이고 값은 니케 이름 또는 `null`(빈 자리)이다. 함수는 모두 새 배열을 돌려준다(받은 것을 바꾸지 않는다).

| 함수 | 하는 일 |
|---|---|
| `placeMember(slots, name, index?)` → `{slots, placed, problem}` | 첫 빈 자리(또는 고른 자리)에 넣는다. **같은 니케는 두 번 넣을 수 없다** — 이미 있으면 `problem`(한국어 문장)이 있고 자리는 그대로다. 다섯이 다 찼을 때도 그렇다 |
| `removeMember(slots, index)` · `moveMember(slots, from, to)` | 자리를 비운다 · 두 자리를 맞바꾼다(빈 자리와도) |
| `burstCheck(slots, catalog)` → `{counts, missing, uncovered, ok, full, text}` | 버스트 단계 구성. 1·2·3단계 가운데 없는 단계(`missing`)와, 어느 단계에서나 쓰는 니케(A)가 채우고도 남는 수(`uncovered`). `text`는 모자란 것이 있을 때의 한 문장(「버스트 1단계 니케가 없다. 풀 버스트가 열리지 않을 수 있다.」) — 자리가 덜 찼어도 지금 없는 단계를 말한다 |
| `deckKey(slots, opponentKey)` | 결과가 어느 편성·어느 상대의 것인지 견주는 열쇠. 자리 순서가 다르면 다른 편성이다 |

버스트 구성이 맞지 않아도 계산을 막지 않는다(경고만 한다) — 엔진은 그런 편성도 계산한다.

### 상대

`listOpponents({bundle, catalog})`가 고를 수 있는 상대를 이 순서로 돌려주고, `resolveOpponent(key, {bundle, catalog})`가 고른 상대를
전투 조건과 표시로 바꾼다. 모르는 열쇠면 `null`.

| 열쇠 | 무엇 | 전투 조건 | 미확인 칸(`unconfirmed`) |
|---|---|---|---|
| `boss:<id>` | 보스 묶음의 보스(이상 개체 5종) | `bossCondition(보스, content)` — 요격전 추천과 같다 | `unconfirmedOf(보스)`에서 약점을 뺀 것 — **요격전 화면과 같은 목록**이다 |
| `preset:<이름>` | 엔진의 보스 프리셋(`catalog.bosses` — 지금은 「솔로 레이드 S40」 하나) | `{content: "solo_raid", boss: 이름}` | 없음. 보스의 속성·방어력은 엔진 안의 값이다 — 이 모듈은 그 약점을 모른다(`element.known: false`, 화면은 「약점 속성은 이 화면이 알지 못한다」) |
| `element:<속성>` | 「속성만 정하기」 — 약점 속성 다섯 | `{content: "custom", enemy: {code}}` — 적 속성은 그 약점이 우월한 상대(엔진의 속성 상성 규칙) | 레벨 상한·전투 시간·방어력·코어·거리·파츠 둘·적정 거리(8칸) — 전부 엔진 기본 적 값으로 계산된다. 고른 속성은 미확인이 아니다 |
| `element:none` | 속성 없음 | `{content: "custom"}` | 위 8칸 + 보스 속성(9칸). `flags: ["속성 상성 미반영"]` |

돌려주는 것: `{key, kind, id, label, condition, element: {code, weak_to, reflected, known, …}, unconfirmed, flags, notes, is_test_data}`.

### 육성 기준 — `compareSquads`의 `growth`

편성 항목에 `growth: "engine_default"`를 적으면 그 편성은 계정의 육성 대신 **엔진 기본 스펙**으로 계산된다(§비교 결과).
덱 빌더의 「모두 최대 육성」이 이것이다. 엔진 기본 스펙은 엔진 문서 `HARNESS.md` §기본 스펙의 값이다: 레벨 400 · 돌파 3 ·
**코어 강화 0** · 스킬 10/10/10 · 오버로드 장비 5강(우월 코드 4줄·공격력 2줄·최대 장탄 2줄) · 소장품 SR15 · 애장품 3단계 · 큐브 Lv.15.
**「전부 최대」가 아니다** — 코어 강화까지 올린 계정은 이 기준보다 높게 나올 수 있다(결과의 caveats에 적힌다).

- 엔진에는 `profile: {base: "default", chars: {}}`로 보낸다(엔진 문서: 「총딜은 기본 스펙과 같다」 — 통합 테스트가 프로필 없이 돌린
  값과 같은지 대조한다).
- 레벨: 조건에 상한(`level_cap`)이 없으면 fixed(400), 있으면 **상한 레벨**(계정의 동기화 레벨이 아니다 — 엔진 정책 sync에 실어 보낸다).
- 계정의 미확인 칸 메모는 붙지 않는다(계정 값을 쓰지 않았다). 순위 항목에 `growth`와 `level`이 실린다.

### 계산 결과 — `evaluateDeck({account, opponent, members}, deps)`

같은 다섯을 두 기준으로 한 번에 계산한다(엔진 요청 두 건 — 캐시에 있으면 엔진을 부르지 않는다).

```jsonc
{
  "schema_version": 1,
  "kind": "deck_report",
  "generated_at": "…",
  "key": "[[\"리틀 머메이드\",…],\"boss:kraken\"]",        // deckKey — 화면이 「지금 편성의 결과인가」를 견준다
  "account": { "name": "…", "is_test_data": true, "updated_at": "…" },
  "opponent": { "key": "boss:kraken", "kind": "boss", "label": "크라켄", "element": { }, "unconfirmed": [ ], "flags": [], "notes": [ ], "condition": { } },
  "members": ["리틀 머메이드", "크라운", "라피 : 레드 후드", "헬름", "앨리스"],
  "results": {
    "account":        { "status": "computed", "total_damage": 2562132901, "members": [ { "name": "…", "damage": 0, "share": 0.2 } ],
                        "notes": [], "engine_warnings": [], "ungrown_members": [], "level": null },
    "engine_default": { "status": "computed", "total_damage": 3349646830, "members": [ ], "notes": [ ], "engine_warnings": [ ], "ungrown_members": [], "level": 400 }
  },
  "growth": { "ratio": 0.765, "text": "지금 육성으로는 모두 최대 육성일 때의 76%다 — 같은 조합을 끝까지 키우면 33.49억까지 오른다. 그 값도 낮으면 조합을 바꿔 본다." },
  "engine_default_spec": "돌파 3 · 코어 강화 0 · …",
  "assumptions": [ ], "engine": { }, "cache": { }, "caveats": [ ]
}
```

- `results.<기준>.status`: `computed` · `rejected`(계산 전 검사에 걸림 — `reasons`) · `failed`(엔진이 계산하지 못함 — `error`).
  **계산하지 못한 편성은 0이 아니다** — 총딜 칸이 없고, 화면은 「계산하지 못함」으로 그린다.
- `growth`: 둘 다 계산됐을 때만. **판정을 내리지 않는다**(「조합이 약하다」·「덜 키웠다」) — 그럴 기준이 없다. 비율과 읽는 법만 말한다.
- caveats에 「지원하지 않음」이 적힌다: 누가 버스트를 쓰지 않을지·조작 같은 운용 지정(엔진의 캐릭터별 기본값으로 계산), PVP,
  다른 사람의 편성과 통계. 보스 상대에는 「보스 패턴 미반영」도.
- 덜 찬 편성·상대 없음은 계산하지 않는다(`InputError`).

### 한 명을 바꾼다면 — `swapOne({account, opponent, members, slot}, {limit}, deps)`

그 자리의 니케와 **같은 버스트 묶음**(§배치 탐색의 `burstOrderGroup` — 어느 단계에서나 쓰는 니케는 3단계 묶음)이고 편성에 없는
보유 니케를 하나씩 넣어 계산한다. 계정의 육성 기준이다. 넣어 볼 순서는 많이 키운 순(투자 점수 — 성능 추정이 아니다), 같으면 이름순이고
**`limit`명(기본 12)까지만** 계산한다(`swapCandidates`가 고른다 — 엔진을 부르지 않는다).

```jsonc
{
  "kind": "deck_swap", "key": "…", "slot": 4, "out": "앨리스", "group": "3",
  "baseline": { "status": "computed", "total_damage": 2562132901 },
  "rows": [ { "name": "미하라", "members": ["…", "미하라"], "total_damage": 2494783930, "change": -0.0263, "engine_warnings": [] } ],   // 총딜이 큰 순
  "failed":  [ { "name": "…", "reason": "엔진의 오류 문장" } ],      // 계산하지 못한 니케 — 0으로 두지 않고 뺀다
  "skipped": ["…"],                                                  // 상한 때문에 보지 못한 니케(덜 키운 쪽)
  "candidates": { "total": 13, "limit": 12, "computed": 12, "failed": 0, "skipped": 1 },
  "caveats": [ ]
}
```

`change` = (바꾼 총딜 − 지금 총딜) ÷ 지금 총딜(+0.08 = 8% 증가). 지금 편성을 계산하지 못했으면 `null`이다. 한 명만 바꾼 값이다 —
바꾼 뒤의 가장 좋은 자리 순서는 따로 보지 않는다(caveats).

### 자리 순서 비교 — `compareOrders({account, opponent, members}, {limit}, deps)`

같은 다섯의 자리 변형(§배치 탐색 §변형 규칙 — 같은 버스트 단계 안의 순서, 3번 자리에 누가 서는가)을 `limit`가지(기본 24)까지 계산해
가장 좋은 순서를 고른다. 지금 순서도 후보라서 가장 좋은 순서의 총딜은 지금 이상이다.

```jsonc
{
  "kind": "deck_order", "key": "…",
  "current": { "members": [ ], "total_damage": 2562132901 },
  "best":    { "members": [ ], "total_damage": 2714910367 },
  "changed": true,                                   // 지금 순서가 아닌 순서가 가장 좋았나
  "changes": ["버스트 3단계 순서 라피 : 레드 후드 → 앨리스 → 헬름"],
  "gain_ratio": 1.0596, "gain_text": "106.0%",       // 가장 좋은 순서 ÷ 지금 순서
  "variants": { "total": 17, "simulated": 3, "skipped": 14, "failed": 0, "limit": 3 },
  "caveats": [ ]
}
```

### 내 편성 — 저장 문서

번호 칸 다섯(01~05 — 게임의 편성 칸과 같은 수)과 이름 붙인 목록(50개까지). 계정마다 한 파일이다:
**계정 폴더의 `<계정 이름>.decks.json`**(`data/accounts/` — gitignore). 읽고 쓰는 것은 Rust
(`app/src-tauri/src/shared_state.rs`의 `load_decks`·`save_decks` — 종류·판·번호 칸 다섯·목록 200개까지만 확인), 값의 검사는 이 모듈이 한다.

```jsonc
{
  "schema_version": 1,
  "kind": "deck_book",
  "slots": [
    null,
    { "name": "편성 02", "members": ["리틀 머메이드", "크라운", "라피 : 레드 후드", "헬름", "앨리스"],   // 다섯 자리(빈 자리는 null)
      "opponent": "boss:kraken", "opponent_label": "크라켄",                                          // 상대의 열쇠와 이름(없으면 null)
      "total_damage": 2562132901,                                                                     // 저장할 때의 추정 총딜(계정 육성 기준) 또는 null(계산 전)
      "saved_at": "2026-11-12T12:00:00.000Z" },
    null, null, null
  ],
  "saved": [ { "id": "d1", "name": "솔레 1덱", "members": [ ], "opponent": null, "opponent_label": null, "total_damage": null, "saved_at": "…" } ]
}
```

- `saveSlot(book, index, deck)`(이름이 없으면 「편성 02」) · `clearSlot` · `addSaved(book, deck)`(이름 필수, 맨 앞에 넣는다, `id`는 `d<번호>`) ·
  `removeSaved` — 모두 새 문서를 돌려준다. 저장하지 않는 것: 빈 편성, 같은 니케 두 번, 다섯 자리가 아닌 것, 30자를 넘는 이름.
- `readDeckBook(문서)` → `{book, dropped}`: 종류·판이 다르면 빈 묶음, 읽을 수 없는 편성은 빼고 그 수를 알린다.
- `deckFromRanking(순위 항목, 보스 id)`: 요격전 추천 결과의 편성 한 줄 → `{members, opponent: "boss:<id>"}`(「덱 빌더에서 열기」).
- 저장한 총딜은 저장할 때의 추정치다 — 다시 계산해 맞추지 않는다(화면이 「추정」을 붙인다).

### 편성을 글자로 — `deckText({members, opponent_label, weak_to, total_damage, basis})`

```text
편성: 1. 리틀 머메이드 / 2. 크라운 / 3. 라피 : 레드 후드 / 4. 헬름 / 5. 앨리스
상대: 크라켄 (약점 풍압)
총딜 25.62억 (추정 · 실전 미대조 · 내 계정 육성 기준)
```

계산하지 않았으면 마지막 줄은 「총딜 계산 전」이다(지어내지 않는다). 빈 자리는 「(빈 자리)」.

## 육성 효율표 — `src/core/efficiency.mjs`

P-031. 성장 투자 비교(§성장 투자 비교 — 업그레이드 후보를 파일로 써야 한다)를 후보 없이 쓰게 한 순수 모듈이다(`node:` import 없음 —
웹뷰와 Node가 함께 쓴다). 셋을 한다: **효율표**(한 단계 올릴 수 있는 것을 자동으로 후보로 만들어 증가율 순으로) ·
**오버로드 옵션 바꿔 보기** · **큐브 바꿔 보기**. 계산은 전부 `compareGrowth`가 하고 가상 적용은 `applyUpgrade`다 — **계정 문서는
바뀌지 않는다.** 기준 편성은 다섯 자리, 상대는 덱 빌더의 `resolveOpponent` 결과다(§덱 빌더 §상대). 화면은 편성 도구의 「육성 효율」
탭(`app/README.md` §육성 효율표).

**모르는 것 · 다루지 않는 것**(결과의 `caveats`에도 적는다):

- **비용.** 재화·필요 수량의 표가 이 저장소에 없다 — 「효율」은 **증가율의 순위일 뿐**이다(`cost_known: false`, `cost_note`).
  값을 지어내지 않는다: 결과의 어느 줄에도 비용·효율 점수 칸이 없다.
- 어느 부위에 어느 오버로드 옵션이 붙었는지. 계정 상태는 옵션별 줄 수(와 줄 레벨)만 담고(§계정 상태 `overload`) 엔진도 그것만 쓴다.
- 보유 큐브. 계정에는 계정을 받을 때 끼고 있던 큐브에서 본 레벨만 있다(`account.cubes` — §계정 가져오기).
- 후보로 만들지 않는 칸: 호감도, 애장품 단계, 장비 등급·강화, 콘솔, 큐브 레벨, 소장품이 없는 니케의 소장품.

### 한 단계 올릴 수 있는 것 — `upgradeCandidates({account, members, catalog, only})`

편성의 니케마다(또는 `only`의 한 명) 아래 칸에서 **한 단계 위**를 업그레이드 후보(§성장 투자 비교의 후보 형식)로 만든다.
계정 상태에 있고 엔진이 계산에 반영하는 칸만이다.

| 종류(`kind`) | 무엇 | 후보 | 후보가 아닌 때(`excluded[].code`) |
|---|---|---|---|
| `skill1` · `skill2` · `burst` | 스킬 1 · 스킬 2 · 버스트 레벨 | `add: {skill_levels: [1,0,0]}` 등(+1) | 이미 10(`max`) · 미확인(`unknown`) |
| `breakthrough` | 돌파 | `add: {breakthrough: 1}` | 이미 3(`max`) · 미확인 |
| `core` | 코어 강화 | `add: {core_enhancement: 1}` | 이미 7(`max`) · 돌파 3 미만(`locked` — 엔진 `calculator/base_stat.py`의 「돌파 3 이후 해금」) · 미확인 |
| `collection` | 소장품 단계 | `set: {collection_stage: "SR6"}`(같은 등급 안에서 +1) | 15(`max` — R15도 최대다. SR은 다른 소장품이다) · 소장품 없음(`none` — 어느 등급을 얻을지 모른다) · 미확인 · 읽을 수 없는 표기(`unsupported`) |
| `overload:<옵션>` | 오버로드 옵션 9종 각각 한 줄 더 | `add: {overload: {옵션: 1}}`(계정이 줄별 레벨로 적었으면 `[10]`) | 그 옵션이 이미 부위 수만큼(`max`) · 열두 줄이 다 참(`max`) · 미확인 · 합산 수치(`equip_skills`)로만 적힘(`unsupported`) |

- 적지 않은 칸은 미육성 값(스킬 1/1/1, 돌파 0, 코어 강화 0, 옵션 없음)에서 한 단계다 — 계산이 그 값으로 하기 때문이다.
- **오버로드의 가정**: 부위 넷 × 줄 셋(모두 12줄), 한 옵션은 부위마다 한 줄(많아야 4줄). 계정에 장비가 적혀 있고 오버로드 장비가
  아닌 부위(`tier`가 있는 부위)가 있으면 그만큼 줄어든다(오버로드 장비 2부위 → 6줄, 옵션마다 2줄). 새 줄의 레벨은 10이다
  (`DEFAULT_LINE_LEVEL` — 엔진이 줄 수만 받았을 때 쓰는 레벨, `SIM-JSON.md` §육성 `overload`). 「한 옵션은 부위마다 한 줄」은 게임
  화면에서 확인한 값이 아니라 이 모듈의 가정이다.
- SSR이 아닌 니케의 돌파 후보에는 「그 등급의 돌파 한도는 이 앱이 확인하지 못했다」는 메모가 붙는다(엔진의 범위는 등급과 무관하게 0~3이다).
- 순서는 종류(`CANDIDATE_KINDS` — 위 표의 순서, 오버로드는 옵션 표의 순서) → 편성의 자리 순서다. 상한에 걸리면 뒤의 종류부터 빠진다.
  같은 입력이면 같은 목록이다.

```jsonc
{ "candidates": [ { "id": "헬름 · 스킬 1 Lv.7 → Lv.8", "nikke": "헬름", "kind": "skill1", "label": "스킬 1", "from": "Lv.7", "to": "Lv.8",
                    "upgrade": { "name": "헬름 · 스킬 1 Lv.7 → Lv.8", "nikke": "헬름", "add": { "skill_levels": [1, 0, 0] } }, "notes": [] } ],
  "excluded":   [ { "nikke": "헬름", "kind": "burst", "label": "버스트", "code": "max", "reason": "버스트 레벨이 이미 최대(10)다." } ] }
```

### 효율표 — `efficiencyTable({account, opponent, members}, {limit, only})`

후보를 `limit`개(기본 60 — `DEFAULT_EFFICIENCY_LIMIT`)까지 하나씩 가상 적용해 총딜 증가율 순으로 돌려준다. 엔진 요청은 기준 1건 +
계산한 후보 수다(`compareGrowth` 한 번 — 캐시에 있는 것은 엔진에 보내지 않는다).

```jsonc
{
  "schema_version": 1, "kind": "growth_efficiency", "generated_at": "…",
  "key": "…",                       // 어느 편성·어느 상대의 결과인지(덱 빌더의 deckKey와 같다)
  "only": null,                      // 한 니케만 본 결과면 그 이름
  "account": { }, "opponent": { }, "members": ["…"],
  "baseline": { "total_damage": 0, "members": [ { "name": "…", "damage": 0, "share": 0.2 } ], "notes": [], "engine_warnings": [], "ungrown_members": [] },
  "rows": [ { "rank": 1, "id": "헬름 · 스킬 1 Lv.7 → Lv.8", "nikke": "헬름", "kind": "skill1", "label": "스킬 1", "from": "Lv.7", "to": "Lv.8",
              "total_after": 0, "gain": 0, "gain_rate": 0.0123, "notes": [], "engine_warnings": [] } ],
  "failed":   [ { "id": "…", "nikke": "…", "kind": "…", "label": "…", "from": "…", "to": "…", "reason": "…" } ],   // 계산하지 못한 것(0이 아니다)
  "skipped":  [ { "id": "…", "nikke": "…", "kind": "…", "label": "…", "from": "…", "to": "…" } ],                  // 상한 때문에 보지 못한 것
  "excluded": [ ],                    // 후보로 만들지 않은 칸과 까닭(위)
  "candidates": { "total": 45, "limit": 60, "computed": 45, "failed": 0, "skipped": 0 },
  "cost_known": false, "cost_note": "비용은 모른다 — …",
  "assumptions": [], "engine": { }, "cache": { }, "caveats": ["비용은 모른다 — …", "…"]
}
```

- `rows`는 증가율이 큰 순이다(같으면 후보 순서 — 안정 정렬). 딜에 영향이 없는 것도 빼지 않고 0%로 둔다.
- 올릴 수 있는 칸이 하나도 없으면 계산하지 않는다: `baseline`이 `null`(0이 아니다), `rows`가 빈 배열이다.
- 한 단계씩 **따로** 올려 본 값이다 — 여럿을 함께 올린 효과, 두 단계 이상 올렸을 때의 순서는 보지 않는다.

### 오버로드 옵션 바꿔 보기 — `tryOverload({account, opponent, members, nikke, parts})`

화면은 부위 넷 × 줄 셋의 칸에서 줄마다 옵션(엔진이 받는 9종 — §계정 상태의 옵션 표)과 줄 레벨(1~15)을 고른다.

- `overloadState(니케 항목)` → `{status, lines: [{id, level}], reason}`: `lines`(줄을 읽었다) · `unknown`(미확인 칸 — 빈 줄에서 시작하고
  적용 전을 옵션 없음으로 계산한다) · `aggregate`(합산 수치 `equip_skills`로만 적혀 있다 — **지원하지 않음**) · `unreadable`.
  줄 수만 적힌 줄은 레벨 10이다.
- `layoutOverload(lines)` → `{parts: [{part, lines: [줄|null ×3]} ×4], overflow}`: 줄을 머리 → 몸통 → 팔 → 다리 순으로, 같은 옵션은
  되도록 서로 다른 부위에 놓는다. **화면에 놓을 자리를 정하는 것일 뿐이다** — 실제로 어느 부위에 붙었는지는 계정 정보에 없다.
- `overloadFromParts(parts)` → `{overload, lines, count, problems, notes}`: 옵션 9종을 모두 적은 `overload`(줄이 없는 옵션은 `[]` —
  적지 않은 옵션이 계정의 값으로 남지 않게). `problems`(모르는 옵션 · 레벨 범위 밖 · 한 부위에 네 줄 이상)가 있으면 계산하지 않고,
  같은 부위에 같은 옵션이 두 줄이면 `notes`로 알리기만 한다(게임에서 되는 조합인지 확인하지 못했다 — 계산은 한다).
- `tryOverload`는 `{nikke, set: {overload}}` 후보 하나를 `compareGrowth`에 넘긴다(엔진 요청 2건 — 기준과 바꾼 것).

```jsonc
{
  "schema_version": 1, "kind": "overload_trial", "generated_at": "…",
  "key": "…",                       // 편성·상대·니케·옵션별 줄 레벨(overloadTrialKey) — 화면이 「지금 고른 것의 결과인가」를 견준다
  "nikke": "헬름",
  "status": "computed",             // computed · same(지금 계정의 옵션과 같다 — 표기만 다른 것 포함) · failed(계산하지 못함 — 0이 아니다)
  "before": { "status": "lines", "options": [ { "id": "atk_pct", "name": "공격력", "levels": [10, 10] } ], "count": 4 },
  "after":  { "options": [ { "id": "atk_pct", "name": "공격력", "levels": [15, 10, 10] } ], "count": 5 },
  "total_before": 0, "total_after": 0, "gain": 0, "gain_rate": 0.0123,   // failed면 total_after·gain·gain_rate가 null
  "members": [ { "name": "…", "damage": 0, "share": 0.2, "gain": 0 } ],
  "reason": null, "notes": [], "assumptions": [], "engine": { }, "cache": { },
  "caveats": ["계정은 바뀌지 않는다 — 여기서만 바꿔 본 값이다.", "…"]
}
```

장비의 등급·강화는 그대로 두고 옵션만 바꾼다. 옵션을 얻는 데 드는 재화와 확률은 모른다.

### 큐브 — `compareCubes({account, opponent, members}, {limit, only})`

**엔진은 요청으로 큐브를 바꿔 받는다**: 육성 프로필의 니케 항목 `cube`(이름 또는 `{name, level}` — `vendor/nikke-calc/docs/SIM-JSON.md`
§육성·§니케별 운용 `cube`). 적지 않으면 전원 기본 스펙 큐브다(`runner/spec.py` `DEFAULT_CHAR["cube"]` — 렐릭 베어 큐브 Lv.15, 미육성
프로필에서도 같다: 큐브는 「육성이 아니라 케이스가 정하는 축」이라 미육성 값에 없다). 모르는 이름과 효과 모델이 없는 큐브는 엔진이
오류로 끊는다(`spec.check_cube()`). 계정 상태의 `cube` 칸(§계정 상태)이 그대로 프로필에 실린다.

- **카탈로그의 `cubes`**: 런타임의 카탈로그(`loadCatalog` · Rust `engine_catalog`)에 큐브 목록이 실린다 —
  엔진의 `data/base_stat_tables/cube.json`을 `cubeCatalogFrom`으로 줄인 것이다(Rust는 `engine.rs`의 `cube_catalog` — 같은 규칙, 같은 값):
  `[{name, skill, effect, max_level, supported}]`. `_`로 시작하는 키와 `공통`(어떤 큐브를 껴도 붙는 두 번째 효과)은 큐브가 아니다.
  `supported: false`는 표에 `unsupported`로 적힌 큐브다(지금 2종). 큐브 표를 읽지 못하면 `cubes`는 `null`이고 큐브 비교는
  「큐브 목록이 없다」로 끝난다(지어내지 않는다).
- `currentCube(니케 항목)`: 계정에 적혀 있으면 그것(`source: "account"`), 없으면 엔진의 기본 큐브(`source: "default"` —
  `ENGINE_DEFAULT_CUBE`. 통합 테스트가 「기본 큐브를 직접 적은 값 = 적지 않은 값」으로 엔진과 대조한다). 계정을 받을 때 니케별 큐브는
  옮기지 않는다(엔진 문서 `HARNESS.md` — 「API가 장착 중인 것만 준다」) — 그래서 받은 계정은 전원 기본 큐브로 계산된다.
- 후보(`cubeCandidates`): 엔진이 효과를 계산하는 큐브 가운데 지금 낀 것이 아닌 것. **레벨은 지금 큐브의 레벨로 맞춘다**(그 큐브의
  최대 레벨을 넘지 않게) — 큐브의 종류만 견준다. 순서는 큐브(표의 순서) → 자리 순서이고, `limit`(기본 80 — 다섯 명 × 15종 = 75건이
  다 들어간다)에 걸리면 큐브를 통째로 뒤에서부터 뺀다(니케마다 같은 큐브들을 견준다).
- 「이 편성에 맞는 큐브」(`recommendation`): 니케마다 총딜이 가장 컸던 큐브(지금 큐브보다 느는 것이 없으면 지금 그대로). 둘 이상이
  바뀌면 **함께 끼운 것을 한 번 더 계산한다**(엔진 요청 1건) — 각각의 합으로 어림하지 않는다. 모든 조합을 본 것은 아니다.

```jsonc
{
  "schema_version": 1, "kind": "cube_report", "generated_at": "…", "key": "…", "only": null,
  "account": { }, "opponent": { }, "members": ["…"], "baseline": { "total_damage": 0, "members": [ ] },
  "nikkes": [ { "nikke": "헬름",
                "current": { "name": "렐릭 베어 큐브", "level": 15, "source": "default", "owned_level": null },
                "rows": [ { "cube": "렐릭 퀀텀 큐브", "level": 15, "total_damage": 0, "gain": 0, "change": 0.021,
                            "owned_level": null, "engine_warnings": [] } ],            // 총딜이 큰 순
                "best": { "cube": "렐릭 퀀텀 큐브", "level": 15, "change": 0.021 } } ],  // 지금보다 나은 것이 없으면 null
  "recommendation": { "picks": [ { "nikke": "헬름", "cube": "렐릭 퀀텀 큐브", "level": 15, "changed": true, "alone_change": 0.021, "owned_level": null } ],
                      "status": "computed",          // computed · unchanged(바꿀 것이 없다) · failed(함께 끼운 것을 계산하지 못했다)
                      "total_damage": 0, "gain": 0, "gain_rate": 0.03, "reason": null },
  "failed": [ { "nikke": "…", "cube": "…", "reason": "…" } ],
  "skipped_cubes": [], "unsupported": ["렐릭 힐링 큐브", "렐릭 어시스터 큐브"],
  "candidates": { "total": 75, "limit": 80, "computed": 75, "failed": 0, "skipped": 0 },
  "assumptions": [], "engine": { }, "cache": { },
  "caveats": ["보유 큐브는 모른다 — …", "…"]
}
```

- `owned_level`: 계정의 `account.cubes`(계정을 받을 때 끼고 있던 큐브에서 본 레벨 — 하한)에 그 큐브가 있으면 그 값, 없으면 `null`
  (없다는 뜻이 아니라 **모른다**는 뜻이다).
- 한계: 추천한 큐브를 갖고 있는지·몇 레벨인지 모른다, 같은 레벨로 견줬다, 한 큐브를 몇 명이 함께 낄 수 있는지 모른다(같은 큐브가
  여러 니케에게 추천될 수 있다).

## 레이드 5덱 — `src/core/union.mjs`

P-014. 솔로 레이드·유니온 레이드처럼 **한 니케를 한 덱에만 쓸 수 있는** 콘텐츠에서, 보유 니케를 겹치지 않게 여러 덱(기본 5)에
나눠 **덱별 총딜의 합이 큰 배분**을 찾는다. CLI는 `union`, 화면은 편성 도구의 「레이드 5덱」 탭(`app/README.md` §레이드 5덱).
순수 모듈이다(`node:` import 없음) — 계산은 `compareSquads`를 그대로 부른다.

```bash
node src/cli.mjs union --account data/samples/account.large.sample.json --condition data/samples/condition.solo-raid.json --budget 12
node src/cli.mjs union --account <계정> --condition <조건 또는 덱별 조건 배열> [--decks 5] [--budget 100] [--locked <고정.json>] [--no-refine] [--exclude "이름,이름"] [--json 결과.json]
```

### 입력

`allocateDecks({account, condition | conditions}, {decks, budget, locked, refine, exclude}, deps)`

| 칸 | 뜻 |
|---|---|
| `condition` | 전투 조건 하나 — 모든 덱에 같은 조건(솔로 레이드: 상대 하나에 다섯 덱). **배열이면 덱별 조건**이다(유니온 레이드: 덱마다 다른 보스 — 길이는 덱 수와 같아야 한다). `conditions`로 줘도 같다 |
| `decks` | 덱 수(1~10, 기본 5) |
| `budget` | 전체 시뮬 횟수의 상한(기본 100). 캐시에서 채워진 요청도 센다 — 같은 입력이면 캐시가 차 있든 비어 있든 같은 결과다 |
| `locked` | 고정(아래) |
| `refine` | 고른 덱의 자리 순서를 바꿔 볼지(기본 `true`) |
| `exclude` | 뺄 니케의 이름(「안 씀」 — §즐겨찾기와 「안 씀」). **고정한 니케는 빼지 않는다.** 실제로 뺀 것이 있으면 결과에 `excluded`가 남는다 |

**고정 문서**(`--locked`): `{"decks": [{"deck": 1, "members": ["이름", null, "이름", null, null]}]}` 또는 그 배열 그대로.

- `members`는 다섯 자리(이름 또는 `null`)다. **다섯이 모두 이름이면 덱 전체 고정**(받은 자리 순서 그대로 계산한다),
  **일부만 이름이면 그 자리만 고정**이다(그 니케를 그 자리에 두고 나머지 자리를 찾는다).
- `deck`은 1부터의 덱 번호다. 적지 않은 항목은 비어 있는 앞 번호부터 받는다. 이름만 적은 배열(`["이름", …]`)도 항목으로 받는다.
- 고정한 니케는 다른 어느 덱의 후보에도 들어가지 않는다. 보유하지 않은 니케·두 번 고정한 니케·없는 덱 번호는 입력 오류다.

**시험 계정**: `data/samples/account.large.sample.json`(`is_test_data: true` — 지어낸 계정 34명, 버스트 1·2·3단계 10·10·14명).
샘플 계정(8명)으로는 한 덱뿐이라 큰 계정으로 본다.

### 어떻게 찾는가

1. **후보 덱 만들기**(`planCandidates` — 순수): 덱 순서대로 돈다. 덱마다 **남은** 보유 니케에서 기존 후보 생성기
   (`generateCandidates` — 버스트 단계별 투자 점수 상위 1단계 3 · 2단계 3 · 3단계 5명의 풀, 단계 구성 1-1-3·1-2-2·2-1-2)로
   조합을 만들고, 그 덱에서 투자 점수 합이 가장 높은 조합(**뼈대**)의 니케를 다음 덱의 풀에서 뺀다.
   - 뼈대끼리는 겹치지 않는다 → 만들 수 있는 만큼의 겹치지 않는 덱이 후보 안에 언제나 들어 있다.
   - 뒤 덱의 후보에는 앞 덱 **뼈대**의 니케가 없다(뼈대가 아닌 후보끼리는 덱 사이에 겹칠 수 있다 — 그래서 3번이 고른다).
   - 뒤에 채울 덱이 남아 있으면 단계별 풀을 「그 단계에 쓸 수 있는 남은 니케 수 − 뒤 덱 수」까지로 줄인다(드문 단계의 니케를
     앞 덱이 다 쓰지 않게 — 줄인 덱은 `search.stage1.tiers[].held_back`과 caveats에 적힌다).
   - 조건에 적 속성(`enemy.code`)이 있으면 그 약점 속성을 우선 속성으로 넘긴다(§후보 생성 §우선 속성).
   - 일부 자리를 고정한 덱은 `completeDeck`: 같은 크기의 풀에서 모자란 인원의 조합을 만들어 고정한 니케와 합쳤을 때
     버스트 1·2·3단계가 갖춰지는 것만 남긴다(하나도 없으면 단계를 따지지 않고 채우고 그렇게 적는다).
2. **계산**: 무엇을 먼저 계산하는가가 곧 예산의 우선순위다 — ① 전체를 고정한 덱 ② 덱마다의 뼈대 ③ 나머지 후보를 덱마다
   돌아가며(투자 점수 합이 높은 순). 조건마다 엔진 배치 한 번(`compareSquads` — 캐시 포함). 덱별 조건이면 고정하지 않은 덱의
   후보를 **고정하지 않은 덱들의 서로 다른 조건마다** 계산한다(후보 하나에 시뮬이 그만큼 든다).
3. **고르기**(`solveAllocation` — 순수 · **정확**): 계산된 후보 안에서 겹치지 않는 묶음 가운데 **덱 수가 가장 많고, 그중 합계가
   가장 큰 것**을 빠짐없이 찾는다(넘을 수 없는 상한으로만 가지를 치는 전수 탐색 — 단위 테스트가 무차별 전수 탐색과 견준다).
   자리는 묶음으로 나뉜다: 고정한 덱은 덱마다 한 묶음, 고정하지 않은 덱은 조건이 같은 것끼리 한 묶음(그 안에서는 총딜이 큰 순으로
   덱 번호에 놓인다).
4. **자리 순서**(`refine`): 남은 예산으로, 고른 덱 가운데 **고정하지 않은 덱**의 자리 변형(§배치 탐색의 규칙)을 계산해 덱마다 가장
   좋은 순서를 남긴다. 덱의 니케는 바뀌지 않고 총딜은 낮아지지 않는다. 자리 순서 몫으로 예산의 1/4(고정하지 않은 덱마다 6건을
   넘지 않는다)을 떼어 둔다.

「정확」의 범위: **계산한 후보 안에서**다. 후보를 줄인 기준(투자 점수 — 성능 추정이 아니다)과 예산 때문에 계산하지 못한 후보는
caveats에 적힌다 — 전체에서 가장 좋은 배분이라는 뜻이 아니다. 3번의 총딜은 후보 생성기가 만든 배치 하나의 값이다(자리 순서는
고른 뒤에 본다).

### 결과

```jsonc
{
  "schema_version": 1,
  "kind": "raid_decks",
  "generated_at": "…",
  "account": { "name": "…", "is_test_data": true, "updated_at": null },
  "mode": "single",              // single 모든 덱에 같은 조건 · per_deck 덱별 조건
  "requested": 5,                // 요청한 덱 수
  "made": 5,                     // 계산된 덱 수
  "total_damage": 5811735902,    // 계산된 덱의 총딜 합
  "conditions": [{ "index": 0, "decks": [1, 2, 3, 4, 5], "condition": { … }, "assumptions": ["…"] }],   // 서로 다른 조건마다
  "decks": [
    {
      "deck": 1,                 // 덱 번호(1부터)
      "lock": "none",            // none · full(전체 고정) · partial(일부 자리 고정)
      "locked": null,            // 고정한 자리(이름 또는 null ×5)
      "condition_index": 0,
      "status": "computed",      // computed · empty(채우지 못했다) · failed(전체를 고정했지만 계산하지 못했다 — 0이 아니다)
      "members": [{ "name": "리타", "damage": 174717612, "share": 0.05 }, …],   // 자리 순서대로
      "total_damage": 3476168551,                                               // empty·failed면 null
      "notes": ["…"], "engine_warnings": [], "ungrown_members": [],
      "placement": { … },        // 자리 순서를 바꿔 본 기록(§배치 탐색의 placement). 고정한 덱·refine을 끈 결과는 null
      "reason": null             // empty·failed의 까닭
    }
  ],
  "unused": ["미란다", "…"],      // 어느 덱에도 들지 않은 보유 니케(많이 키운 순). 고정한 니케와 뺀(「안 씀」) 니케는 없다
  "shortage": null,              // 요청한 수만큼 만들지 못했을 때(아래)
  "search": {
    "refine": true, "budget": 12, "sims": 12,
    "stage1": { "budget": 9, "requested": 9, "skipped": 36, "generated": 45, "computed": 9,
                "tiers": [{ "deck": 1, "kind": "free", "considered": 270, "generated": 9, "simulated": 2, "pool_caps": { "1": 3, "2": 3, "3": 5 }, "held_back": [], "reason": null }] },
    "stage2": { "decks": 5, "variants": 85, "requested": 3, "skipped": 82, "improved": 0 },   // refine을 끄면 null
    "examined": 55               // 고르기가 본 가지의 수
  },
  "assumptions": ["…"],
  "unsupported": ["보스 패턴…", "레이드의 점수 규칙…", "…운용 지정…"],   // 이 계산이 다루지 않는 것
  "engine": { "repo": "Jgaram/nikke-calc", "commit": "…", "dirty": false },
  "cache": { "hits": 0, "misses": 12, "stored": 12, "warnings": [] },   // 캐시를 쓰지 않으면 null
  "rejected": [], "failed": [],  // 계산 전 검사에 걸린 후보 · 엔진이 계산하지 못한 후보(0으로 두지 않고 뺀다)
  "caveats": ["…"]
  // "excluded": { … }           // 「안 씀」을 뺐을 때만
}
```

- **어떤 니케도 두 덱에 없다**(고정한 덱 포함). 보유하지 않은 니케는 쓰지 않는다.
- `shortage`: `{requested, made, kind, lacking, remaining, owned, capacity, text}`.
  `kind`는 `size`(남은 니케가 다섯이 안 된다) · `stage`(남은 니케에 버스트 단계가 빈다 — `lacking`에 그 단계) ·
  `search`(더 짤 수 있었지만 계산된 후보에 겹치지 않는 덱이 없었다 — 예산·실패). `remaining`·`owned`는 버스트 단계별 수
  (`{1, 2, 3, A, unknown}`), `capacity`는 보유 니케 전체로 만들 수 있는 덱 수의 상한(덱마다 다섯 명 + 1·2·3단계 한 명씩 —
  `deckCapacity`. 상한일 뿐이고 후보 생성기는 더 좁게 잡는다). `text`는 화면과 표에 그대로 보이는 한 문장이다.
- 같은 입력이면 `generated_at`·`cache` 말고는 같은 문서다(계정의 니케 나열 순서와도 무관하다).
- 진행: `deps.onStage({stage, stages, requests, used, budget})` — 엔진 배치를 맡기기 직전(1 = 후보 계산, 2 = 자리 순서).

### 지원하지 않는 것

결과의 `unsupported`와 caveats에 적힌다 — 지원하는 것처럼 계산하지 않는다.

- 보스 패턴(무적·보호막·특수 기믹)과 단계별 체력.
- **레이드의 점수 규칙**(보스 체력·단계, 남은 체력 이월, 점수 보정). 이 모듈이 내는 것은 덱별 총딜 추정과 그 합뿐이다 —
  레이드의 점수가 아니다.
- 운용 지정(버스트를 누가 쓰지 않을지·조작).
- **엔진에 프리셋이 없는 솔로 레이드 보스**: 엔진의 보스 프리셋은 「솔로 레이드 S40」 하나다. 다른 시즌의 보스는 값을 모른다 —
  적 속성만 정한 조건(`enemy.code` — 덱 빌더의 「속성만 정하기」: `resolveOpponent('element:<약점>')`)으로 계산하고, 그 밖의 칸
  (방어력·코어·파츠·거리)은 **미확인**으로 표시한다(§덱 빌더 §상대의 `unconfirmed` — 엔진 기본 적 값으로 계산된다).
- 유니온 레이드의 보스 값도 저장소에 없다(게임 화면에서 확인한 적이 없다) — 덱별 조건은 「속성만 정한 상대」나 사용자가 준 조건이다.

## 버스트 흐름 — `src/core/burst.mjs`

P-032. 편성의 버스트 순환(풀 버스트가 몇 번, 얼마마다 열리고 누가 버스트를 썼는가)을 **엔진의 기록에서 읽는다** — 계산하거나
어림하지 않는다. 화면은 덱 빌더와 요격전 상세의 「버스트 흐름」 구획이다(`app/README.md` §버스트 흐름).

### 엔진이 주는 것과 얻는 길

- 엔진의 **JSON 결과(`--json`·`--batch` — `vendor/nikke-calc/docs/SIM-JSON.md` §결과 객체)에는 버스트 흐름이 없다**(총딜·멤버 딜·
  적·스펙·조작 요약·경고뿐이다 — `runner/sim.py`의 `payload()`).
- 엔진은 그것을 **텍스트 보기**로만 낸다: `python -m runner.sim --request <요청 JSON> --view burst`(`SimLog.burst_summary()`).
  `--view`는 `--json`·`--batch`와 함께 쓸 수 없다(엔진이 오류로 끊는다). 그래서 **요청 방법을 바꿨다** — 같은 요청을 텍스트 보기로
  한 번 더 돌린다. 엔진 문서의 보장대로 같은 `prepare()` → `execute()`를 거치므로 총딜을 낸 계산과 같은 전투다(기대값 모드라 결정론).
- 런타임 계약에 선택 함수 `runViews(requests, view, opts) → ({text} | {error: {type, message}})[]`를 더했다(`src/core/runtime.mjs`).
  Node는 `src/runtime/node.mjs`의 `runViews`, 앱은 Rust 명령 `engine_run_views`(`src-tauri/src/engine.rs`의 `run_views`)다. 둘 다
  **보기 이름을 `burst`만 받고**(`VIEW_KINDS`), 객체가 아닌 요청은 엔진에 넘기지 않으며(엔진은 `{`로 시작하지 않는 `--request` 값을
  파일 경로로 읽는다), 요청 JSON이 24,000자를 넘으면 그 건을 오류로 돌려준다(명령줄 인자로 넘긴다 — Windows 한도 32,767자. 시험 계정의
  요청은 수천 자다). 편성 하나에 엔진 한 번(약 3초), 동시에 네 개까지. **캐시하지 않는다**(시뮬 결과 캐시는 JSON 결과만 담는다).
- 요청은 편성 비교와 같은 함수가 만든다(`compare.mjs`의 `squadRequest` — 계정 육성·엔진 기본 스펙 둘 다).

엔진이 적는 줄(이름·단위는 엔진 그대로):

```text
[버스트 사이클]
  t=  3.000s  stage:1 사용  리틀 머메이드        ← 시각(초, 전투 시작부터) · 단계 · 쓴 니케
  t=  3.100s  stage:2 사용  크라운
  t=  3.200s  stage:3 사용  라피 : 레드 후드
  t=  3.583s  full_burst 시작
  t= 13.583s  full_burst 종료
  t= 43.000s  reenter:1 사용  티아                ← 버스트 재진입(엔진 문서 GAMEPLAY.md)
```

| 읽는 것 | 사건(`parseBurstView`의 `events`) |
|---|---|
| `stage:N 사용  <이름>` · `reenter:N 사용  <이름>` | `{t, kind: "use", stage: "N", name, reenter}` |
| `full_burst 시작` · `full_burst 종료` | `{t, kind: "full_burst_start"}` · `{t, kind: "full_burst_end"}` |
| `게이지 만충 …` · `카메라 초점: …`(엔진의 게이지 판정 모드에서만 나온다 — 이 앱은 그 모드를 쓰지 않는다) | `{t, kind: "note"}` — 흐름에 쓰지 않는다 |
| 그 밖의 줄, 편성에 없는 이름의 줄 | 버리지 않고 `unread`에 원문 그대로(결과의 caveats에 몇 줄인지 적는다) |

`[버스트 사이클]` 머리줄이 없으면 `found: false` — **엔진이 주지 않은 것**이고 그 편성은 흐름 없이 `failed`가 된다(다른 줄에서
지어내지 않는다). 텍스트 보기의 글은 엔진 문서가 「사람용」이라고 밝힌 것이라 모양이 바뀔 수 있다 — 바뀌면 통합 테스트
(`tests/integration/burst.engine.test.mjs`)의 「모르는 줄이 없다」가 먼저 걸린다.

**읽지 않는 것(지원하지 않음)**: 버스트 게이지가 차는 내역(엔진의 다른 보기 `gauge` — 이 앱이 쓰는 판정 모드 `fixed`에서는 게이지가
사이클을 정하지 않아 그리지 않았다), 버스트가 늦은 까닭(엔진이 말하지 않는다), 보스 패턴에 따른 변화, 버스트 순서를 손으로 정하기.

### 흐름 — `summarizeBurst(events, {duration, members})`

단위는 전부 **초**(전투 시작부터)다. 엔진이 적은 시각만으로 센다.

| 칸 | 뜻 |
|---|---|
| `duration` | 전투 시간 — 요청의 `sim.duration`(전투 조건의 `duration`, 적지 않으면 180) |
| `count` | 풀 버스트 횟수 = `full_burst 시작` 줄의 수 |
| `first_at` · `first_use_at` | 첫 풀 버스트가 열린 시각 · 첫 버스트를 쓴 시각. 없으면 `null` |
| `average_period` | 평균 주기 = (마지막 풀 버스트 시작 − 첫 풀 버스트 시작) ÷ (횟수 − 1). 두 번 미만이면 `null`(모른다) |
| `uptime_seconds` · `uptime_ratio` | 풀 버스트가 열려 있던 시간의 합과 전투 시간에 대한 비율(0~1). 닫히지 않은 풀 버스트는 전투 끝까지로 센다 |
| `full_bursts[]` | `{index, start, end, open, users[], chain_start, wait, waited_for}` — `end: null`·`open: true`는 엔진이 종료를 적지 않은 것(전투가 끝날 때까지 열려 있었다). `users`는 그 풀 버스트를 연 버스트들(직전 풀 버스트 시작 뒤부터). `wait`는 그 버스트들 사이가 가장 길게 벌어진 시간 |
| `uses[]` | 모든 버스트 사용 `{t, stage, name, reenter}` |
| `by_stage` | 단계(`"1"`·`"2"`·`"3"`) → `[{name, count}]`(많이 쓴 순) — **단계별로 누가 버스트를 썼는지**. 단계는 엔진이 그 버스트를 쓴 단계로 적은 값이다 |
| `by_member[]` | 자리 순서대로 `{name, count, stages, uses[]}` — 버스트를 쓰지 않은 니케도 빈 줄로 있다 |
| `pending[]` · `tail_wait` | 풀 버스트로 이어지지 못하고 전투가 끝난 버스트들 · 그 마지막 버스트 뒤로 남은 시간 |
| `stalls[]` | 다음 버스트가 늦은 풀 버스트 `{index, wait, stage}` |
| `status` | `ok` · `stalled`(늦은 풀 버스트가 있다) · `none`(풀 버스트가 한 번도 열리지 않았다) |
| `headline` | 「3분 동안 풀 버스트 9번, 평균 20초마다」 / 「3분 동안 풀 버스트가 한 번도 열리지 않았다」 |
| `problem` | 돌지 않는 편성의 한 문장(없으면 `null`) — 「2단계 버스트를 쓴 니케가 없어 풀 버스트가 한 번도 열리지 않았다(1단계까지만 이어졌다).」, 「풀 버스트 7번 가운데 6번은 다음 버스트가 1초 넘게 늦었다 — 가장 길게는 3단계를 14.6초 기다렸다. 버스트 쿨타임이 맞지 않는 것으로 보인다.」 |

**「늦었다」는 이 앱의 규칙이다**(`STALL_GAP_SECONDS = 1`): 풀 버스트 하나를 여는 동안 버스트와 버스트 사이가 1초 이상 벌어지면 다음 단계를
기다린 것으로 센다. 엔진이 버스트를 이어 쓰는 간격은 0.1초(재진입 0.5초)다. 엔진은 **왜** 늦었는지 말하지 않는다 — 문장은 「쿨타임이
맞지 않는 것으로 보인다」까지만 말한다. 실제 엔진에서 본 모양: 2단계가 없으면 `stage:1` 한 줄뿐, 3단계가 한 명(쿨타임 40초)뿐이면
2단계 뒤에 3단계를 10~15초 기다린다, 1단계가 쿨타임 40초 한 명이면 `reenter:1`까지 40초를 기다린다.

### 결과 문서 — `burstReport({account, condition, squads}, deps)`

```jsonc
{
  "schema_version": 1, "kind": "burst_flow", "generated_at": "…",
  "account": {"name": "…", "is_test_data": true, "updated_at": null},
  "condition": { … },                       // 받은 전투 조건 그대로
  "duration": 180,                          // 시간축의 길이(초)
  "source": {"view": "burst", "stall_gap_seconds": 1},
  "lines": [                                // 받은 편성 순서대로(첫째가 기준)
    {"name": "지금 편성", "members": ["…"], "status": "read", "flow": { … 위의 흐름 … }, "unread": []},
    {"name": "…", "members": ["…"], "status": "rejected", "reasons": ["편성은 5명이어야 한다 (지금 4명)"]},
    {"name": "…", "members": ["…"], "status": "failed", "error": {"type": "not_provided", "message": "…"}}
  ],
  "comparison": {"count_delta": -2, "text": "풀 버스트 9번 → 7번, 평균 주기 20초 → 25초, 첫 풀 버스트 3.6초 → 5.6초."},
  "engine": {"repo": "Jgaram/nikke-calc", "commit": "…", "dirty": false},
  "caveats": ["…"]
}
```

- `lines[].status`: `read`(읽었다) · `rejected`(계산 전 검사 — `squadProblems`, 엔진을 부르지 않는다) · `failed`(엔진이 그 편성을
  돌리지 못했거나 `error.type: "not_provided"` — 출력에 버스트 줄이 없다). **읽지 못한 편성에는 `flow`가 없다.**
- `comparison`: 편성을 둘 줬고 둘 다 읽었을 때만(아니면 `null`). 횟수·평균 주기·첫 풀 버스트가 어떻게 다른지만 말한다 — 어느 쪽이
  낫다고 판정하지 않는다(총딜은 덱 빌더의 계산이 말한다).
- `caveats`: 실전 미대조, 같은 조건이라는 것, 운용은 엔진의 기본값(손으로 정하기는 지원하지 않음), 「늦었다」는 이 앱의 규칙,
  지원하지 않는 것(게이지 내역·보스 패턴), 읽지 못한 줄의 수.
- 런타임에 `runViews`가 없으면 던진다(빈 흐름을 내지 않는다).

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
