# 계산기 — 값의 출처 조사 (P-034)

커뮤니티 도구 모음의 두 도구(소장품 강화 최적화 시뮬레이터 · 니붕 시뮬레이터)에서 **기능의 생각만** 참고해 계산기를 만들려던
작업이다. 조건은 하나였다: **값의 출처가 있어야 한다** — 기억이나 다른 사이트의 숫자를 옮기지 않는다.

조사한 날: 2026-11-13. 조사한 엔진: `vendor/nikke-calc` 커밋 `67835ca`(서브모듈, 손대지 않았다).

## 결론

| 계산기 | 쓰려던 값 | 출처 | 만들었나 |
|---|---|---|---|
| 소장품 강화 | 소장품 단계별 필요 경험치 | **출처 없음** | 만들지 않았다 |
| | 관리 키트 세 종류의 경험치 | **출처 없음** | |
| 모집 확률 | 공식 모집 확률 표 | **출처 없음** | 만들지 않았다 |

**만든 계산기가 없다. 그래서 화면도 더하지 않았다**(편성 도구에 「계산기」 구획이 없다). 저장소에는 게임의 값을 하나도 더하지
않았다. 더한 것은 이 문서와, 이 결론을 실제 엔진 데이터로 다시 확인하는 점검(`src/core/calculators.mjs` + 테스트)뿐이다.

## 어디를 봤나

1. **엔진이 받아 둔 표** — `vendor/nikke-calc/data/`의 JSON 16개와 `scraper/`의 JSON 2개(모두 18개)의 **모든 칸 이름**.
2. **엔진의 수집 코드** — `vendor/nikke-calc/scraper/*.py`가 받는 공개 표의 경로와, 그 표에서 읽는 칸.
3. **엔진의 문서** — `.agent/skills/char-scrape/SCRAPER.md`(받는 경로의 정본), `.agent/skills/profile-sync/SKILL.md`(계정에서 받는 것).

### 1. 엔진이 받아 둔 표 — 무엇이 어디에 있나

성장 표는 `vendor/nikke-calc/data/base_stat_tables/`의 일곱 파일이다.

| 파일 | 담긴 것(열쇠) | 필요한 값이 있나 |
|---|---|---|
| `collection.json` | `_stat_table`: `R0`~`R15` · `SR0`~`SR15` 서른두 단계 × `skill_lv` · `hp` · `atk` · `def`(**단계별 누적 스탯**). `common`(`def_pct` · `received_dmg_pct` · `cover_hp_pct`)과 무기군 여섯(`AR` · `MG` · `RL` · `SG` · `SMG` · `SR`)의 `template` · `buff_type` · `R`/`SR`(스킬 레벨 넷의 효과 값) | **없다** — 단계의 스탯과 효과뿐이다. 단계를 올리는 데 드는 경험치·재화 칸이 없다 |
| `affinity.json` | 클래스 셋 × 호감도 1~40 × `hp` · `atk` · `def` | 없다(호감도의 스탯) |
| `console.json` | `공통` · `클래스` · `기업`의 `per_level`(`hp` · `atk` · `def`) | 없다 |
| `cube.json` | `_stats`(큐브 레벨 1~15의 스탯), 큐브별 효과(`values` · `stat` · `timing` …) | 없다(큐브의 스탯·효과 — 강화 재화가 아니다) |
| `equipment_stats.json` | `기업`(강화 0~5) · `일반`(T1~T9) × 클래스 × 부위의 스탯 | 없다 |
| `equipment_skills.json` | 오버로드 옵션의 단계별 수치 | 없다 |
| `level_stats.json` | 등급·클래스·무기군별 레벨 스탯 | 없다 |

나머지 열한 파일(`parsed_nikke.json` · `parsed_skills.json` · `boss_presets.json` · `boss_scripts/…` · `burst_gauge.json` ·
`char_defaults.json` · `tactics.json` · `weapon_delays.json` · `weapon_mechanics.json` · `scraper/nikke_scraped.json` ·
`scraper/preview_skills.json`)은 캐릭터·스킬·보스·무기 데이터다. 「경험치」라는 말은 스킬 설명문의 **값** 안에만 있다(어느 니케의
버프 이름 — 재화가 아니다). `exp`가 든 칸 이름은 `spot_explosion_range` · `projectile_explosion_dmg_pct` 같은 폭발에 관한 것뿐이다.

칸 이름으로 찾은 말: 경험치(`exp` · `xp` · `experience` · 「경험치」), 키트(`kit` · 「키트」), 모집(`gacha` · `recruit` · `pickup` ·
`probability` · 「모집」 · 「뽑기」). **18개 파일 어디에도 걸린 칸이 없다.**

### 2. 엔진의 수집 코드가 받는 공개 표

수집 코드에 적힌 평문 경로는 아홉이다(`cdn_fetch.py` · `cdn_tables.py` · `profile_fetch.py`의 상수 — 게임사의 공식 도구 사이트 CDN).

| 경로 | 내용 | 엔진이 만드는 것 |
|---|---|---|
| `/character/character_id_map.json` | 캐릭터 번호 목록 | 수집 대상 |
| `/roledata/{rid}-v2-ko.json` | 캐릭터 한 명의 무기·스킬·스탯 | `parsed_nikke.json` · `level_stats.json` 등 |
| `/character/mi/mi_c{rid:03d}_00_s.webp` | 초상화 | `image/` |
| `/equip/cube_rare_map.json` · `/equip/ko/cube_{cid}.json` | 큐브 목록 · 큐브 한 종 | `cube.json` |
| `/equip/favorite_rare_map.json` · `/equip/ko/favorite_{fid}.json` | 애장품·소장품 목록 · 한 종 | `collection.json`, 애장품 스킬 |
| `/equip/ItemEquipTable-ko.json` | 장비 스탯 | `equipment_stats.json` |
| `/character/AttractiveLevelTable.json` | 호감도 레벨별 보너스 | `affinity.json` |

엔진 문서는 받지 않는 표 하나를 더 적어 뒀다: `/equip/equip_option_table_v2-ko.json`(오버로드 옵션 이름). **재화(관리 키트)·아이템·
모집에 관한 경로는 없다.**

소장품 한 종의 표(`favorite_{fid}.json`)에서 엔진 코드가 읽는 칸은 `id` · `favorite_rare` · `weapon_type` · `name_localkey` ·
`icon_resource_id` · `atk` · `def` · `hp`(단계별 배열) · `level1`(단계별 스킬 레벨) · `collection_skill_group_data` ·
`favoriteitem_skill_group_data`(안의 `skill_change_slot`)다. 경험치에 관한 칸을 읽는 코드는 없다.

### 3. 계정에서 받는 것

엔진의 계정 수집(`profile_fetch.py`)이 부르는 것은 `Game/GetUserCharacters` · `Game/GetUserCharacterDetails` ·
`Game/GetUserProfileOutpostInfo` 셋이고, 소장품에 관해 받는 것은 장착한 것의 id와 단계뿐이다. **가진 키트 수(인벤토리)는 받지 않는다** —
계산기를 만들더라도 가진 키트 수는 사람이 적어야 한다(수락 조건도 그렇게 정했다). 실제 계정 파일은 읽지 않았다
(`data/samples/profile.sample.json`의 모양과 엔진 코드만 봤다).

## 확인하지 못한 것

- **공개 표의 원본에 엔진이 읽지 않는 칸이 더 있는지.** `favorite_{fid}.json`의 원본은 엔진 폴더에 저장돼 있지 않다(엔진은 읽은 칸만
  `collection.json`으로 옮긴다). 원본의 칸 이름을 한 번 받아 보려 했지만 자동 실행 세션에서는 네트워크 요청이 승인되지 않았다 —
  돌아가는 길을 찾지 않았다. 사람이 엔진의 수집 명령으로 확인할 수 있다(아래 「값이 생기면」).
  원본에 단계별 필요 경험치가 있더라도 **키트 한 개의 경험치는 소장품 표의 값이 아니다**(재화의 값이다) — 그 표의 경로는
  엔진 코드 어디에도 없으므로 소장품 강화 계산기는 여전히 값 하나가 모자란다.
- 참고한 두 도구가 어떤 숫자를 쓰는지는 보지 않았다(코드·데이터를 가져오지 않는다. 자동 실행 세션은 웹에 나갈 수도 없다).

## 하지 않은 것과 까닭

- **값을 지어내지 않았다.** 소장품 강화에 드는 경험치, 키트의 경험치, 모집 확률은 기억으로 적을 수 있는 숫자가 아니다 — 틀린
  숫자로 만든 계산기는 재화를 잘못 쓰게 한다.
- **다른 사이트의 숫자를 옮기지 않았다.** 그 도구들의 데이터는 그 도구들의 것이다.
- **주소를 추측해 CDN을 두드리지 않았다**(「아이템 표가 있을 법한 경로」를 만들어 보지 않았다 — `docs/ui-redesign.md` §8의 원칙).
- **조합 찾기만 따로 만들어 두지 않았다.** 값이 없으면 쓸 화면이 없다(수락 조건: 값이 없는 계산기는 만들지 않는다).
- **화면에 「계산기」 자리를 비워 두지 않았다.** 설정 > 다른 도구에 두 도구(소장품 강화 시뮬레이터 · 니붕 시뮬레이터)의 링크가
  이미 있다(P-033).

## 값이 생기면

출처로 인정하는 것은 이 저장소가 지금까지 써 온 둘이다: **엔진이 받는 공식 표**, 그리고 **사용자가 게임 화면에서 직접 확인한 값**
(요격전 보스의 값을 `docs/intercept.md`와 `data/intercept/anomaly.json`에 그렇게 담았다).

소장품 강화 계산기에 필요한 값:

1. 등급(R · SR)별로 **한 단계를 올리는 데 드는 경험치**(0→1 … 14→15), 그리고 R15에서 SR로 넘어가는 규칙이 있다면 그것.
2. **관리 키트 세 종류 각각의 경험치**, 그리고 소장품과 키트의 종류(무기군·기업 등)에 따라 값이 달라지는 규칙이 있다면 그것.
3. 강화에 키트 말고 드는 것(재화)이 있다면 그것 — 모르면 「모른다」고 적는다.

모집 확률 계산기에 필요한 값: 모집 종류별 **공식 확률 표**(게임 안의 확률 안내). 엔진은 모집을 다루지 않는다.

값을 얻는 길:

- 엔진이 그 표를 받기 시작하면(서브모듈을 올린 뒤) 아래 점검이 실패해 알려 준다.
- 사람이 원본을 볼 때: 엔진 폴더에서 `python scraper/cdn_tables.py --check --only collection`은 표를 받아 차이만 보인다(쓰지 않는다).
  원본의 칸 이름을 보려면 그 스크립트의 `collect()`가 돌려주는 값을 직접 출력해야 한다 — 엔진은 고치지 않는다.
- 게임 화면에서 확인한 값은 날짜·화면과 함께 이 문서에 먼저 적고, 그 다음에 데이터 파일과 계산기를 만든다. 계산기를 만들 때의
  조건은 작업(P-034)의 수락 조건 그대로다: 조합 찾기는 순수 함수(작은 사례에서 전수 탐색과 같은 답), 편성 도구의 「계산기」 구획,
  화면 아래에 값의 출처.

## 다시 점검하기

```bash
node --test tests/unit/calculators.test.mjs                 # 순수 함수: 칸 이름 찾기·소장품 표의 칸·수집 경로·보고서
node --test tests/integration/calculators.engine.test.mjs   # 실제 엔진 데이터(1초 안쪽, 네트워크 없음): 표 일곱 · 소장품 표의 칸 · 수집 경로 아홉 · 계산기 둘 다 「출처 없음」
```

`src/core/calculators.mjs`의 `auditCalculatorSources({files, cdnPaths})`가 받은 표들의 칸 이름에서 위의 말을 찾아 보고서를 만든다
(형식은 `docs/data-model.md` §계산기 출처 점검). **이 점검은 칸 이름만 본다** — 걸린 칸이 생겨도 상태는 「확인 필요」까지이고,
그 표가 정말 필요한 값인지는 사람이 읽고 정한다. 통합 테스트가 실패하면 엔진의 데이터가 바뀐 것이다: 이 문서를 다시 조사해 고친다.

## 사람이 확인할 것

- 작업의 확인 항목 「만들어진 계산기의 결과가 게임에서와 맞는지」는 **대상이 없다**(만든 계산기가 없다).
- 계산기를 원하면: 위 「값이 생기면」의 값을 게임 화면에서 확인해 알려 준다(소장품 강화 화면의 단계별 필요 경험치와 키트 설명,
  모집 화면의 확률 안내).
