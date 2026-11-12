# 니케 컴패니언

니케 PC판용 개인 데스크톱 앱(오버레이 + 계정 맞춤 편성·성장 추천 + 자체 티어).
요구사항의 기준은 `docs/spec.md`다. 먼저 읽어라.

## 읽는 순서

1. `docs/spec.md` — 요구사항, 단계, 결정 기록, 미검증 가정
   (요격전 작업이면 `docs/intercept.md`도 — 게임 화면에서 확인한 보스 정보와 모르는 것)
2. `.harness/progress.md` — 지금 상황과 다음 행동
3. `.harness/tasks.json` — 작업 목록(수락 조건·검증 명령·상태)
4. 맡은 작업과 관련된 코드

## 명령

```bash
node --test tests/unit/                  # 단위 테스트 (엔진 호출 없음, 빠름)
node --test tests/integration/           # 실제 엔진 호출 (수십 초)
node scripts/verify.mjs <작업ID>         # 그 작업의 검증 명령 실행 + 증거 기록
node scripts/verify.mjs --all            # 완료된 작업을 현재 코드로 재검증
node scripts/autopilot.mjs --max-iterations 3   # 자율 실행 루프
node scripts/harness-selftest.mjs        # 하네스 자체 검증 (모델 호출 없음)
node src/cli.mjs compare --account data/samples/account.sample.json --condition data/samples/condition.solo-raid.json --squads data/samples/squads.sample.json
```

`compare`·`suggest`·`growth`·`tier`·`intercept`는 시뮬 결과를 `data/cache/sim/`(gitignore)에 캐시한다. `--no-cache`로 끄고, 폴더를 지우면
비워진다(`docs/data-model.md` §시뮬 결과 캐시).
`suggest`는 상위 조합의 배치 순서도 탐색한다(2단계). `--no-refine`으로 끄고, `--budget <시뮬 횟수>`(기본 120)로 전체
시뮬 횟수를 묶는다(`docs/data-model.md` §배치 탐색).

요격전(이상 개체) 보스별 편성 추천(보스 값은 `data/intercept/anomaly.json` — 게임 화면에서 확인한 것만 담는다. 형식은
`docs/data-model.md` §보스 묶음·§요격전 추천 결과):

```bash
node src/cli.mjs intercept --account data/samples/account.sample.json                      # 보스 5종, 시뮬 예산 300건(보스당 60건) — 몇 분
node src/cli.mjs intercept --account data/samples/account.sample.json --boss 크라켄 --budget 30 --top 3 --json intercept.json
node src/cli.mjs intercept --account data/samples/account.sample.json --bosses data/samples/bosses.anomaly.sample.json --budget 25   # 검증용 보스 묶음
node src/cli.mjs intercept --account data/samples/account.large.sample.json --boss 크라켄 --budget 20   # 보유 34명 시험 계정 — 약점 속성 니케가 후보에 드는 것을 본다
```

요격전 추천은 보스마다 약점 속성 니케를 후보 풀에 단계당 최소 2명 넣고 후보 순서에서 앞에 둔다(`docs/data-model.md` §후보 생성 §우선 속성).
`suggest`·`tier`의 후보는 그대로다.

자동 티어(엔진 계산으로 티어표 — 방법·한계는 `docs/tier-method.md`, 기준 편성·등급 규칙은 `data/tier/`):

```bash
node src/cli.mjs tier build --only "헬름,크라운,리틀 머메이드" --json tier.json   # 일부만 (수십 초)
node src/cli.mjs tier build --json tier.json                                    # 전원: 시뮬 1,769건, 수십 분. --budget으로 상한(기본 2000)
```

데스크톱 앱(`app/`, Tauri v2 + Vue 3 — 자체 package.json. 자세한 것은 `app/README.md`):

```bash
npm --prefix app install                                  # 처음 한 번
npm --prefix app run tauri dev                            # 개발 실행 (오버레이 창 + Vite)
npm --prefix app run tauri build                          # 실행 파일: app/src-tauri/target/release/nikke-companion.exe
npm --prefix app run build                                # 타입 검사 + 프런트 빌드
npm --prefix app test                                     # 컴포넌트 테스트 (vitest)
cargo test --manifest-path app/src-tauri/Cargo.toml       # Rust 단위 테스트
cargo build --manifest-path app/src-tauri/Cargo.toml
npm --prefix app run fixture                              # 컴포넌트 테스트용 샘플 결과 넷을 실제 CLI로 다시 만든다(몇 분). 고른 것만: `-- tier growth`
```

게임 창·화면 캡처·요격전 화면 인식(실행 중인 니케가 필요하다 — `--recognize <PNG>`와 `live_recognize`만 빼고. 게임은 읽기만 한다 —
`app/README.md` §게임 창·화면 캡처, §화면 인식):

```bash
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --info          # 게임 창 정보(JSON)
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --name <라벨>   # 게임 화면을 data/captures/에 PNG로 저장
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --recognize <PNG 파일>   # 캡처에서 화면 종류·보스 인식(JSON 한 줄, 게임 불필요)
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --recognize-live        # 게임 창을 찍어 인식만(이미지는 저장하지 않는다. 게임이 없으면 종료 코드 2)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_game -- --ignored                # 실제 게임 테스트(창이 떠 있어야 한다)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_capture -- --ignored             # 게임 없이 캡처 경로 확인(테스트가 띄운 자기 창을 찍는다)
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_recognize -- --ignored           # 화면 인식을 라벨 붙은 캡처로 확인(data/captures/labels.json이 있어야 한다. 게임 불필요)
```

엔진은 `vendor/nikke-calc`(서브모듈, Python 3.12, 표준 라이브러리만). 직접 고치지 않는다.

## 작업 원칙

- 한 번에 작업 하나. `tasks.json`의 수락 조건과 검증 명령을 구현 전에 확인한다.
- 완료는 `node scripts/verify.mjs <작업ID>`가 통과해야 한다. "구현했다"는 말은 완료가 아니다.
- 검증을 통과시키려고 테스트를 지우거나 약하게 만들지 않는다. `protected` 경로는 수정 금지.
  수락 조건을 바꿔야 하면 이유와 영향을 `progress.md`에 적고 작업을 멈춘다.
- 실제 게임이 필요한 확인은 `manual_checks`에 남기고 완료로 치지 않는다.
- 모의 데이터에는 `is_test_data: true`. 개인 계정 데이터는 `data/accounts/`(gitignore).
- 엔진이 지원하지 않는 효과는 미지원으로 표시한다. 0으로 두고 결과를 확정하지 않는다.
- 권한·접근 제한을 우회하지 않는다. 배포·공개 게시·게임 계정에 영향을 주는 조작은 하지 않는다.
- 모델은 Fable 5.2만. 쓸 수 없으면 기록하고 멈춘다.

## 세션을 끝낼 때

`.harness/progress.md`를 갱신한다: 구현한 것, 실행한 검증과 결과, 미검증 항목,
차단된 작업과 재개 조건, 다음 작업.
