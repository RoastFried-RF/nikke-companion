# 니케 컴패니언 오버레이 (app/)

Tauri v2 + Vue 3 + Vite + TypeScript로 만든 데스크톱 오버레이다(P-009 골격, P-010 계산 실행).

- 계정 파일과 전투 조건 파일을 골라 **추천**(보유 니케에서 후보 생성)이나 **비교**(편성 파일)를 실행하고 순위를 그린다.
- 이미 만들어 둔 비교 결과 JSON(`docs/data-model.md` §비교 결과)을 읽어 순위를 그린다.

계산은 저장소 루트의 `src/core`(JS)가 웹뷰 안에서 그대로 한다 — Node CLI와 같은 코드다. 웹뷰에는 Node가 없으므로
엔진 프로세스 실행과 파일 읽기만 Rust 명령이 대신한다(`src/core/runtime.mjs`의 런타임 계약). Rust에는 계산 로직이 없다.

아직 하지 않는 것: 게임 창 추적, 화면 캡처, 성장 비교 화면. 이 앱은 네트워크 요청을 하지 않는다.

## 준비

- Node 20.19 이상, Rust(stable, MSVC 툴체인), WebView2 런타임(Windows 11에는 기본 설치)
- 계산 실행에는 Python 3.12와 엔진 서브모듈(`vendor/nikke-calc`)이 필요하다(§엔진 설정).
- 명령은 저장소 루트에서 `npm --prefix app …`로 실행하거나, `app/` 안에서 `npm …`로 실행한다.

```bash
npm --prefix app install
```

> `npm --prefix app install`을 루트에서 실행하면 npm이 루트 패키지를 `"nikke-companion": "file:.."`으로
> `app/package.json`에 적는다(npm 10의 `--prefix` 동작). 지워도 다음 설치 때 다시 생기므로 그대로 둔다.
> 앱 코드는 이 링크를 쓰지 않는다 — 루트의 계산 코드는 상대 경로 별칭 `@core`(= `../src/core`)로 가져온다.

## 개발 실행

```bash
npm --prefix app run tauri dev
```

Vite 개발 서버(`localhost:1420`, 이 PC 안에서만 열린다)와 오버레이 창이 함께 뜬다.
개발 실행에서는 앞서 불러온 파일이 없으면 경로 입력란에 샘플 결과(`app/tests/fixtures/compare.sample.json`)가
미리 채워지고 바로 불러온다.

개발 실행에서는 계산 실행 칸에도 샘플 입력(`data/samples/`의 검증용 계정·조건·편성)이 미리 채워진다.
`추천 실행`을 누르면 실제 엔진으로 계산한다(후보 30개 기준 수십 초). 진행 중에는 끝난 건수와 경과 시간이 보인다.

다른 결과를 보려면 저장소 루트에서 결과 파일을 만들고 그 경로를 입력란에 넣는다(절대 경로 권장, 따옴표가 붙어 있어도 된다).

```bash
node src/cli.mjs compare --account data/samples/account.sample.json --condition data/samples/condition.solo-raid.json --squads data/samples/squads.sample.json --json 결과.json
```

마지막으로 불러온 경로는 기억했다가 다음 실행 때 다시 연다. 실행 인자로 줄 수도 있다: `nikke-companion.exe <결과.json>`.

## 계산 실행

| 방식 | 입력 | 하는 일 |
|---|---|---|
| 추천 | 계정 파일, 전투 조건 파일, (선택) 후보 수·표시 수 | 보유 니케에서 후보 편성을 만들어 엔진으로 비교하고 상위만 보인다 (`node src/cli.mjs suggest`와 같다) |
| 비교 | 계정 파일, 전투 조건 파일, 편성 파일 | 편성 파일의 편성을 엔진으로 비교한다 (`node src/cli.mjs compare`와 같다) |

- 파일은 `고르기`로 고르거나 경로를 직접 넣는다(따옴표가 붙어 있어도 된다). 쓴 경로와 방식은 기억한다.
- 입력이 잘못되면 `입력 오류 — …`, 엔진을 띄우지 못하거나 시간이 넘으면 `실행 오류 — …`로 보인다.
  엔진이 일부 편성에서만 오류를 내면 그 편성은 "실패한 편성"으로 보이고 나머지는 순위에 남는다.
- 계산 중에는 다시 실행하거나 결과 파일을 불러올 수 없다. 계산을 중간에 멈추는 단추는 없다.

### 엔진 설정

엔진 폴더와 python 경로는 화면에서 바꿀 수 없다(화면이 실행할 프로그램을 정하지 못하게). 우선순위:

1. 환경 변수 `NIKKE_ENGINE_DIR`, `NIKKE_PYTHON`
2. 설정 파일 `%APPDATA%\local.nikke-companion.overlay\settings.json`
3. 기본값: 실행 파일·현재 폴더에서 위로 올라가며 찾은 `vendor/nikke-calc`, PATH의 `python`

```json
{ "engine_dir": "E:\\code\\nikke-companion\\vendor\\nikke-calc", "python": "python", "concurrency": 4, "timeout_seconds": 600 }
```

모든 칸은 선택이다. `concurrency`는 동시에 띄울 엔진 프로세스 수(1~4, 기본은 코어 수 − 1을 4로 제한),
`timeout_seconds`는 엔진 프로세스 하나의 시간 제한(기본 600초)이다. 저장소 안에서 빌드한 실행 파일은 설정 없이 돈다.

## 빌드

```bash
npm --prefix app run tauri build     # app/src-tauri/target/release/nikke-companion.exe
```

설치 파일은 만들지 않는다(`bundle.active: false`). 개인용이라 실행 파일 하나면 충분하고, 배포는 범위 밖이다.

`cargo build --manifest-path app/src-tauri/Cargo.toml`만 하면 개발용 실행 파일이 나온다. 이것은 화면을
개발 서버(`localhost:1420`)에서 읽으므로 서버 없이 실행하면 빈 창이 뜬다. 혼자 도는 실행 파일은 위 명령으로 만든다.

## 단축키 (전역)

| 단축키 | 동작 |
|---|---|
| `Alt+Shift+C` | 클릭 통과 켜기/끄기. 켜면 마우스 입력이 오버레이를 지나 아래 프로그램으로 간다 |
| `Alt+Shift+O` | 오버레이 숨기기/보이기 |

- 시작할 때는 보이고 조작할 수 있는 상태다(주 모니터 작업 영역의 오른쪽 위).
- 클릭 통과 중에는 창을 조작할 수 없다. 주황색 줄무늬 띠와 테두리로 표시되고, `Alt+Shift+C`로 되돌린다.
- 숨긴 동안에는 `Alt+Shift+C`를 무시한다. 다시 보이면 숨기기 전의 클릭 통과 상태 그대로다.
- 다른 프로그램이 같은 단축키를 쓰고 있어 등록하지 못하면 화면에 경고가 뜬다.
- 창 옮기기: 맨 위 제목 줄을 끈다. 끝내기: 제목 줄의 `×`.

## 검증

```bash
npm --prefix app run build                                # 타입 검사(vue-tsc) + 프런트 빌드
npm --prefix app test                                     # 컴포넌트·계약 테스트(vitest)
cargo test --manifest-path app/src-tauri/Cargo.toml       # 상태 전환 규칙·결과 읽기 단위 테스트 + 엔진 통합 테스트
cargo build --manifest-path app/src-tauri/Cargo.toml
```

`cargo test`의 `tests/engine_batch.rs`는 실제 엔진과 python을 띄운다(십여 초): 입력 순서 보존, 한 건의 오류가
다른 건을 막지 않음, 결정론, 시간 제한, 그리고 **같은 요청에 대해 Node 런타임과 total_damage가 같은지**
(`tests/node_runtime_reference.mjs`를 `node`로 돌려 대조한다 — `node`가 PATH에 있어야 한다).
프런트의 `tests/compute.test.ts`·`tests/ComputeFlow.test.ts`는 엔진만 가짜로 바꾸고 루트의 실제 계산 코드를 돌린다.

컴포넌트 테스트의 입력(`tests/fixtures/compare.sample.json`)은 실제 CLI가 만든 결과다. 엔진이나 샘플이 바뀌면 다시 만든다.

```bash
npm --prefix app run fixture
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/App.vue` | 오버레이 화면: 상태 표시, 계산 실행, 결과 파일 불러오기, 오류 |
| `src/components/ComputePanel.vue` | 계산 실행 칸: 방식·파일 고르기·실행·진행 중 표시 |
| `src/components/ReportView.vue` | 비교 결과 그리기(순위·총딜·멤버·메모·걸러진 편성·실패한 편성·주의·엔진 버전) |
| `src/components/OverlayStatus.vue` | 클릭 통과·숨김 상태와 단축키 표시 |
| `src/lib/format.ts` | 서식. 대미지 단위 표기는 루트의 `src/core/format.mjs`를 그대로 쓴다(복제하지 않는다) |
| `src/lib/backend.ts` | Rust 명령·이벤트를 부르는 유일한 곳 |
| `src/lib/runtime.ts` | 계산 코드에 넘기는 엔진 런타임(Rust 명령 `engine_*`을 부른다) |
| `src/lib/compute.ts` | 파일 읽기 → 루트의 `suggestSquads`·`compareSquads` 호출 → 비교 결과. 계산 규칙은 없다 |
| `src-tauri/src/overlay_state.rs` | 보임/숨김·클릭 통과의 전환 규칙과 시작 위치 계산. 창 API를 모른다 |
| `src-tauri/src/report.rs` | 비교 결과 JSON 읽기와 형식 확인(한국어 오류), 입력 JSON 파일 읽기 |
| `src-tauri/src/engine.rs` | 엔진 설정, 카탈로그·버전 읽기, `python -m runner.sim --batch` 병렬 실행(최대 4개, 순서 보존, 시간 제한). 계산 로직 없음 |
| `src-tauri/src/lib.rs` | 창·전역 단축키·명령을 잇는 접착 코드 |
| `src-tauri/capabilities/overlay.json` | 화면에 허용한 권한: 이벤트 듣기, 창 끌기, 앱 명령 아홉 개 |

Rust 명령: `load_report(path)`, `overlay_status()`, `startup_report_path()`, `quit_app()`,
`engine_catalog()`, `engine_version()`, `engine_run_batch(requests)`, `read_json_file(path)`, `pick_json_file(title)`.
파일 고르기 창은 대화 상자 플러그인 없이 `pick_json_file` 명령 하나로만 연다(화면에 파일·대화 상자 권한을 주지 않는다).
명령을 더하면 `src-tauri/build.rs`의 목록과 capability에도 적어야 화면에서 부를 수 있다.

## 사람이 확인할 것 (아직 확인하지 않았다)

- 앱에서 샘플 계정으로 추천을 실행해 순위가 보이는지, `고르기` 창이 오버레이 위에 뜨는지.
- 실제 계정 파일로 실행한 수치가 인게임 기록과 맞는지.

- 실제 니케 PC판 위에서 오버레이가 보이는지(창 모드·전체 화면). 전체 화면 전용 모드에서는 가려질 수 있다.
- 클릭 통과 상태에서 창 아래 프로그램이 클릭되고 게임 입력을 방해하지 않는지.
- `Alt+Shift+O`로 다시 보일 때 오버레이가 키보드 포커스를 가져간다(창 라이브러리가 창을 보이면서 활성화한다).
  게임 입력이 끊기면 게임을 한 번 클릭해 되돌려야 한다 — 게임 위에서 불편한지 확인이 필요하다.
- Alt+Tab·창 이동·크기 변경 뒤에도 단축키와 표시가 맞는지.
