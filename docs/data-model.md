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
- 적지 않은 칸은 **미육성 값**으로 계산된다(돌파 0 · 스킬 1/1/1 · 소장품 없음 · 오버로드 0줄). 모르는 칸은 `unknown`에 적어 결과에 드러나게 한다.
- 오버로드 줄을 적고 `equipment`를 적지 않으면 엔진 기본 오버로드 장비를 낀 것으로 계산한다. 오버로드 줄이 없으면 장비 미장착이다.
- 캐릭터 레벨은 계정 상태가 아니다. 콘텐츠가 정한다(솔로 레이드 = 400 고정).
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
| `_account.console` | `account.console`. `synchro_level`·`cubes`(장착 중 관찰된 보유 하한)는 `account`에 기록만 한다 |
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

## 시뮬 결과 캐시 — `src/core/cache.mjs`

엔진 시뮬 1회가 4~5초라서, 같은 엔진 판·같은 요청의 결과는 다시 계산하지 않는다. `withCache(runtime, store)`가
런타임(`src/core/runtime.mjs`의 계약)을 감싼다. **캐시는 속도만 바꾼다** — 틀릴 수 있으면 쓰지 않고, 저장소가 고장 나도
계산은 끝까지 한다.

| 쓰는 곳 | 저장소 | 남는 기간 |
|---|---|---|
| CLI `compare`·`suggest`·`growth` | 파일 — `createFileCacheStore(dir)`(`src/runtime/node.mjs`), 기본 `data/cache/sim/`(gitignore) | 지울 때까지 |
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
