# 니케 컴패니언 오버레이 (app/)

Tauri v2 + Vue 3 + Vite + TypeScript로 만든 데스크톱 오버레이다(P-009 골격, P-010 계산 실행, P-011 게임 창 추적·화면 캡처).

- 계정 파일과 전투 조건 파일을 골라 **추천**(보유 니케에서 후보 생성)이나 **비교**(편성 파일)를 실행하고 순위를 그린다.
- 이미 만들어 둔 비교 결과 JSON(`docs/data-model.md` §비교 결과)을 읽어 순위를 그린다.
- 니케 PC판 **게임 창**을 찾아 상태를 보이고, 지금 게임 화면을 PNG로 저장하고, 오버레이를 게임 창에 붙여 따라가게 한다
  (§게임 창·화면 캡처). 같은 캡처를 명령줄 도구 `nikke-capture`로도 한다.

계산은 저장소 루트의 `src/core`(JS)가 웹뷰 안에서 그대로 한다 — Node CLI와 같은 코드다. 웹뷰에는 Node가 없으므로
엔진 프로세스 실행과 파일 읽기만 Rust 명령이 대신한다(`src/core/runtime.mjs`의 런타임 계약). Rust에는 계산 로직이 없다.

아직 하지 않는 것: 화면 인식(캡처한 화면이 무슨 화면인지 알아보기), 성장 비교 화면. 이 앱은 네트워크 요청을 하지 않는다.

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
- 같은 엔진 판·같은 요청은 다시 계산하지 않는다(시뮬 결과 캐시, `docs/data-model.md` §시뮬 결과 캐시). 이 앱은
  **메모리 저장소만** 쓴다 — 앱이 켜져 있는 동안만 남고 파일에 쓰지 않으며, CLI의 `data/cache/sim/`과 나눠 쓰지 않는다.
  결과 화면의 `캐시: 적중 N건 · 엔진 계산 N건 · 새로 저장 N건` 줄로 보인다. 진행 건수는 엔진에 보낸 요청만 센다
  (모두 적중하면 엔진을 부르지 않고 곧바로 끝난다). 엔진 커밋을 모르거나 엔진 폴더에 커밋하지 않은 변경이 있으면
  캐시를 쓰지 않고 그 이유가 같은 자리에 보인다.

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

## 게임 창·화면 캡처

### 게임은 읽기만 한다

이 앱은 게임 창을 옮기거나 크기를 바꾸거나 앞으로 가져오지 않고, 게임에 마우스·키 입력이나 창 메시지를 보내지 않고,
게임 프로세스를 열거나 메모리를 읽거나 무엇을 주입하지 않는다(`docs/spec.md` §게임과의 상호작용 규칙).
쓰는 것은 표준 창 API뿐이다: 창 열거와 창 속성 읽기, DWM 창 경계, 시스템 프로세스 목록(이름만 — 게임 프로세스의 핸들을
열지 않는다), Windows.Graphics.Capture. 붙이기가 옮기는 것은 오버레이 창뿐이다. `tests/contract.test.ts`가 Rust 코드에
창을 움직이거나 입력을 보내거나 프로세스를 여는 호출이 없는지 확인한다.

### 게임 창 찾기

1. 최상위 창을 열거해 후보를 모은다: 프로세스가 `nikke.exe`·`nikke_launcher.exe`이거나 제목이 `NIKKE`인 창.
2. 게임 창은 **`nikke.exe`의 창**이고, 보이고(WS_VISIBLE), DWM이 가리지 않았고, 화면 영역이 있는 창이다.
   런처(`nikke_launcher.exe`)는 제목이 같아도 게임이 아니다. 최소화된 창은 게임 창으로 보고 상태를 "최소화"로 알린다.
3. 여러 개면 제목이 `NIKKE`인 것 → 최소화되지 않은 것 → 화면 영역이 넓은 것 → 핸들 값이 작은 것.

규칙은 `src-tauri/src/game_window.rs`의 순수 함수(`select_game_window`)이고 Win32 호출은 `game_win32.rs`에만 있다.
창 정보의 좌표와 크기는 모두 **물리 픽셀**이다: `client`(제목 표시줄·테두리를 뺀 게임 화면 영역의 화면 좌표와 크기),
`frame`(창에서 보이는 부분 전체), `minimized`, `foreground`(전경 창인가), `scale_factor`(창이 놓인 모니터의 배율).

### 오버레이에서

- **게임 창** 칸이 상태(찾음/없음/최소화됨/런처만)와 화면 영역의 크기·배율을 보인다. 1초마다 다시 읽는다.
- **화면 저장** 단추나 전역 단축키 `Alt+Shift+S`가 지금 게임 화면을 저장하고, 저장한 경로(또는 한국어 오류)를 칸에 알린다.
  단추는 게임 창을 찾았을 때만 눌린다. 단축키는 언제나 듣고, 못 찍으면 이유를 알린다.
- **게임 창에 붙이기**를 켜면 오버레이가 게임 화면 영역의 오른쪽 위 안쪽(가장자리에서 12px)에 자리 잡고, 게임 창이 움직이거나
  크기가 바뀌면 따라간다(0.05초마다 게임 창 위치를 읽는다). 끄면 그 자리에 머문다. 켜 둔 것은 기억했다가 다음 실행 때 다시 켠다.
  - 게임 창이 가만히 있는 동안 오버레이를 끌어 옮기면 그 자리에 머물고, 게임 창이 다시 움직이면 오른쪽 위로 돌아간다.
  - 게임이 없거나 최소화돼 있으면 옮기지 않는다. 오버레이가 게임 화면보다 넓으면 게임 화면의 왼쪽 끝에 맞춘다.
  - 위치 계산은 순수 함수다(`game_window.rs`의 `attach_position`·`follow_target`·`follow_move`).

### 저장하는 곳

캡처 이미지는 계정 정보와 게임 화면을 담는다. **저장소에 올리지 않는다** — 기본 폴더 `data/captures/`는 gitignore에 있다.

- 폴더: 환경 변수 `NIKKE_CAPTURE_DIR` → 저장소의 `data/captures`(실행 파일·현재 폴더에서 위로 올라가며 저장소를 찾는다).
  저장소 밖에서 실행해 폴더를 정할 수 없으면 저장하지 않고 알린다. 화면(웹뷰)은 폴더를 정하지 못한다.
- 파일 이름: `<현지 시각 YYYYMMDD-HHMMSS-mmm>[_<라벨>].png`. 라벨은 글자·숫자(한글 포함)·`-`·`_`만 남기고(공백은 `-`,
  경로 구분자·점·따옴표 등은 버림) 48자로 자른다. 같은 이름이 있으면 덮어쓰지 않고 `-2`, `-3`…을 붙인다.
- 형식: 8비트 RGB PNG, 클라이언트 영역의 원본 해상도 그대로.

### 명령줄 도구 `nikke-capture`

저장소 루트에서:

```bash
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --info
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --name lobby
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --out D:\shots --name "솔로 레이드"
```

| 인자 | 하는 일 |
|---|---|
| `--info` | 게임 창 정보를 JSON 한 줄로 출력: `{hwnd, pid, process_name, title, client, frame, minimized, foreground, scale_factor}` |
| (없음) / `--out <폴더>` / `--name <라벨>` | 게임 화면을 저장하고 `{path, width, height, captured_at, method, window}`를 JSON 한 줄로 출력. `--out`이 없으면 기본 폴더. `method`는 캡처 방식(지금은 `wgc`뿐) |
| `--help` | 사용법 |

종료 코드: `0` 성공 · `1` 인자 오류·최소화·캡처/저장 실패 · `2` 게임 창 없음(게임이 꺼져 있거나 런처만 떠 있다).
오류는 표준 오류에 한국어로 나온다. `captured_at`은 UTC(ISO 8601), 파일 이름의 시각은 현지 시각이다.
최소화된 게임 창에 `--info`를 하면 `minimized: true`와 크기 0의 `client`가 나오고 종료 코드는 0이다.

### 캡처 방식 — Windows.Graphics.Capture

`windows` 크레이트(0.62 — Tauri가 이미 끌어오는 판이라 새 의존성이 아니다. 기능만 더 켰다)로
**Windows.Graphics.Capture(WGC)**를 직접 부른다: 게임 창으로 캡처 대상을 만들고(`IGraphicsCaptureItemInterop::CreateForWindow`),
프레임 하나를 받아 클라이언트 영역만 CPU 메모리로 읽은 뒤 세션을 닫는다. 받은 표면은 창 전체(제목 표시줄·테두리 포함)라서
프레임을 받은 시점의 DWM 창 경계와 클라이언트 영역의 화면 좌표로 잘라 낼 자리를 계산한다(`capture.rs`의 `client_crop`).

고른 이유:

- **가려져도 찍힌다.** WGC는 화면에 보이는 것이 아니라 합성기(DWM)가 가진 그 창의 화면을 넘겨준다(화면을 그대로 복사하는
  BitBlt는 가린 창이 찍힌다). 테스트의 자기 창으로는 확인했다(`live_capture.rs` — 가린 자리에 가리개 색 픽셀 0개).
  게임 창으로 같은 것을 보는 테스트는 `live_game.rs`에 있다 — 통과 여부는 아래 §실제 게임 테스트의 "돌려 본 결과"를 보라.
- **게임에 아무것도 보내지 않는다.** PrintWindow는 대상 창에 그리기 요청이 갈 수 있다. WGC는 합성기 쪽에서 끝난다.
- **Direct3D로 그리는 창도 찍힌다.** 니케(Unity)에서 실제로 찍혔다(2026-11-12, 창 모드 2212×1244, 전경이 아닌 상태).
- **PrintWindow는 니케 창에서 실패했고, 코드에서 뺐다.** 개발 중에 `PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)`를
  한 번 불러 봤는데 FALSE를 돌려줬다(원인은 확인하지 않았다). 그 시험을 한 뒤 몇 분 사이에 게임 창이 최소화돼 있었다 —
  사용자가 한 것인지 그 호출과 관계가 있는지 확인하지 못했다(그 앞의 WGC 캡처 직후에는 최소화돼 있지 않았다). 쓸 수 없고
  영향도 모르는 호출이라 남기지 않았다. BitBlt도 넣지 않았다. `tests/contract.test.ts`가 이 호출들이 없는지 확인한다.
- 래퍼 크레이트(`windows-capture`, `xcap` 등)는 쓰지 않았다. 필요한 것이 프레임 한 장이라 직접 부르는 코드가 짧고,
  의존성이 늘지 않는다.

확인한 문서와 확인하지 못한 문서: Microsoft Learn의 "Screen capture"(WGC 개요 — 노란 테두리, `IsSupported`, 프레임 풀과
`ContentSize`)를 읽었다. docs.rs의 크레이트 문서(`windows` 0.62.2, `windows-capture`, `xcap`)는 이 작업을 한 세션에서 열 수
없었다(웹 읽기 권한 없음) — `windows` API의 이름과 인자는 컴파일과 실제 게임 실행으로 확인했고, 래퍼 크레이트는 문서를
보지 못한 채로 비교했다(위 이유는 문서가 아니라 필요한 기능의 크기로 판단한 것이다).

한계:

- **최소화된 창은 찍지 못한다.** 한국어 오류로 알리고, 창을 복원하지 않는다(게임 창을 건드리지 않는다).
- **빈 화면은 저장하지 않는다.** 네 모서리를 뺀 모든 픽셀이 같은 색(전부 검은 화면 포함)이면 최대 0.7초 동안 다음 프레임을
  더 받아 보고, 그래도 같으면 오류로 돌려준다. 그래서 정말로 한 색인 게임 화면(검은 로딩 화면)도 저장되지 않는다.
- **창 모드에서는 아래쪽 두 모서리가 검게 찍힌다.** Windows 11이 창 모서리를 둥글게 깎기 때문이다(반지름 8px × 배율 —
  화면에서는 그 자리에 뒤의 창이 보인다). 클라이언트 영역의 아래쪽 모서리가 창 모서리와 겹쳐, 깎인 바깥쪽 몇 픽셀은
  `(0, 0, 0)`으로, 둥근 테두리 선이 지나는 픽셀은 테두리 색으로 온다(`live_capture.rs`의 자기 창과 2026-11-12에 찍은 실제
  게임 캡처 2212×1244에서 확인 — 맨 아래 모서리 픽셀이 `(0, 0, 0)`, 그 대각선 안쪽 픽셀이 `(34, 34, 34)`). 이미지는 그대로 저장한다 — 화면 인식에서 모서리 몇 픽셀은 믿지 말 것. 이 픽셀 때문에
  한 색 화면이 정상으로 판정되던 것을 고쳤다: 빈 화면 판정은 네 모서리의 24×24픽셀(작은 프레임에서는 변의 1/4)을 보지 않는다.
- **전체 화면은 확인하지 않았다.** 테두리 없는 창 모드는 될 것으로 보지만(창 경계와 클라이언트 영역이 같아진다) 돌려 보지
  않았고, 전용 전체 화면에서는 프레임이 오지 않거나 검게 나올 수 있다.
- **캡처하는 순간 노란 테두리가 보일 수 있다.** 테두리를 빼 달라고 요청하지만(`IsBorderRequired = false`, Windows 11) 요청이
  받아들여졌는지는 확인하지 않는다. 테두리는 이미지에는 찍히지 않는다. 마우스 커서도 빼 달라고 요청한다.
- **창이 움직이는 중이면 실패할 수 있다.** 받은 표면에서 클라이언트 영역이 벗어나거나 크기가 달라지면 잘린 이미지를 만들지
  않고 "크기가 다르다" 오류로 돌려준다. 다시 찍으면 된다.
- **HDR**: 프레임을 8비트 BGRA로 받는다. HDR 화면에서 색이 어떻게 바뀌는지는 확인하지 않았다.
- Windows 10 1903 이전에는 WGC가 없다(오류로 알린다). 프레임은 최대 2.5초 기다린다.
- 캡처마다 Direct3D 장치와 세션을 새로 만든다(걸리는 시간은 재지 않았다 — `live_game.rs`가 돌 때 찍어 준다). 연속
  캡처(화면 인식)에는 세션을 유지하는 방식이 필요하다 — 다음 단계 과제다.

### 실제 게임 테스트

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_game -- --ignored
```

`tests/live_game.rs`는 실행 중인 니케가 필요해서 `#[ignore]`다(평소 `cargo test`에서는 건너뛴다). 게임 창이 **떠 있어야**
한다 — 최소화돼 있으면 실패한다(테스트도 게임 창을 복원하지 않는다). 확인하는 것:

- 게임 창을 찾는다(`nikke.exe`, 런처가 아니다). 클라이언트 영역이 창 경계 안에 있고 배율이 읽힌다.
- 캡처한 이미지의 크기가 클라이언트 영역과 같고 빈 화면·거의 검은 화면이 아니다.
- 캡처·저장 전후로 게임 창의 핸들·위치·크기·최소화 여부·전경 여부가 같다.
- 게임 화면 가운데를 이 테스트의 작은 자홍색 창(항상 위, 비활성)으로 **가린 채** 찍어도 그 색이 찍히지 않는다.
  가리개가 실제로 화면에 보이는지는 화면 픽셀로 확인한다. 테스트 중 1초쯤 게임 화면 가운데에 자홍색 네모가 보인다.
- `nikke-capture --info`와 캡처 저장(종료 코드 0, JSON 한 줄, PNG 크기).

테스트가 쓴 캡처는 `data/captures/_live-test-…` 폴더에 두었다가 끝나면 지운다.

돌려 본 결과(2026-11-12, P-011을 만든 세션):

- 명령줄 도구로 실제 게임을 한 번 찍었다: 창 모드 2212×1244, 전경이 아닌 창. 저장된 PNG를 열어 보니 제목 표시줄·테두리
  없이 로비 화면 전체가 찍혀 있었다. 그때 다른 창이 게임을 가리고 있었는지는 모른다.
- 그 뒤 게임 창이 최소화됐고 세션이 끝날 때까지 그대로였다. 그래서 **`live_game.rs`의 다섯 테스트는 최소화 상태에서만 돌았고
  모두 "게임 창이 최소화돼 있다"로 실패했다** — 가려진 창 캡처, 캡처 전후 창 상태 비교는 아직 통과를 확인하지 못했다.
- 최소화 상태에서 확인한 것: `--info`가 `minimized: true`를 내고(종료 코드 0), 캡처는 한국어 오류와 종료 코드 1로 끝나고,
  오버레이의 게임 창 칸이 "최소화됨"을 보이고 저장 단추가 막히고, 붙이기를 켜도 오버레이가 그 자리에 머문다.
- 두 번째 세션(같은 날 06:07~)에서도 게임 창은 계속 최소화돼 있었다. 그때 화면의 전경 창은 다른 프로그램이었고 이 앱의
  프로세스는 떠 있지 않았다. 누가 최소화했는지는 여전히 모른다. `live_game.rs`는 이번에도 돌리지 못했다.

### 게임 없이 캡처 경로 확인

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_capture -- --ignored
```

`tests/live_capture.rs`는 게임 대신 **테스트가 띄운 자기 창**(제목 표시줄·테두리가 있는 보통 창, 네 구역을 다른 색으로 칠함)을
같은 캡처 함수로 찍는다. 게임이 꺼져 있거나 최소화돼 있어도 돌고, 게임 창은 읽지도 건드리지도 않는다. 화면이 켜진
데스크톱이 필요해서 `#[ignore]`다. 1~2초 동안 화면 왼쪽 위에 작은 창과 자홍색 네모가 떴다 사라진다(활성화하지 않는다).

- 클라이언트 영역만 정확히 잘라 낸다: 각 구역의 맨 바깥 행·열이 그 구역의 색이다(한 픽셀이라도 밀리면 테두리가 섞인다).
- 가운데를 다른 창으로 가린 채 찍어도 가리개의 색이 한 픽셀도 찍히지 않는다(가리개가 화면에 보이는지는 화면 픽셀로 확인).
- 한 색으로만 칠한 창은 `BlankFrame` 오류다(실제 WGC 프레임으로 — 둥근 모서리의 검은 픽셀이 있어도).
- 최소화한 창은 `Minimized` 오류이고 캡처를 시도해도 최소화된 그대로다. 다시 띄우면 같은 크기로 찍힌다.
- 캡처 전후로 대상 창의 위치·크기·최소화·전경 여부가 같다.

돌려 본 결과(2026-11-12, Windows 11 26300, 배율 100%): 네 테스트 통과. 처음 돌렸을 때는 한 색 창이 성공으로 돌아와
실패했다 — 위 §한계의 둥근 모서리 문제를 여기서 찾아 고쳤다. **이것은 게임 창으로 한 확인이 아니다**: 니케(Direct3D로 그리는
창)가 가려졌을 때 어떻게 찍히는지, 캡처가 게임 창 상태를 바꾸지 않는지는 `live_game.rs`가 통과해야 확인된다.

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
| `Alt+Shift+S` | 지금 게임 화면을 PNG로 저장(§게임 창·화면 캡처). 결과는 게임 창 칸에 보인다 |

- 시작할 때는 보이고 조작할 수 있는 상태다(주 모니터 작업 영역의 오른쪽 위).
- 클릭 통과 중에는 창을 조작할 수 없다. 주황색 줄무늬 띠와 테두리로 표시되고, `Alt+Shift+C`로 되돌린다.
- 숨긴 동안에는 `Alt+Shift+C`를 무시한다. 다시 보이면 숨기기 전의 클릭 통과 상태 그대로다.
- 다른 프로그램이 같은 단축키를 쓰고 있어 등록하지 못하면 화면에 경고가 뜬다.
- 창 옮기기: 맨 위 제목 줄을 끈다. 끝내기: 제목 줄의 `×`.

## 검증

```bash
npm --prefix app run build                                # 타입 검사(vue-tsc) + 프런트 빌드
npm --prefix app test                                     # 컴포넌트·계약 테스트(vitest)
cargo test --manifest-path app/src-tauri/Cargo.toml       # 규칙 단위 테스트(오버레이 상태·결과 읽기·게임 창·캡처) + 엔진 통합 테스트
cargo build --manifest-path app/src-tauri/Cargo.toml
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_game -- --ignored   # 실행 중인 니케가 필요하다
cargo test --manifest-path app/src-tauri/Cargo.toml --test live_capture -- --ignored   # 게임 없이: 자기 창을 실제 WGC로 찍는다
cargo run --quiet --manifest-path app/src-tauri/Cargo.toml --bin nikke-capture -- --info
```

게임 없이 도는 단위 테스트가 확인하는 것: 게임 창 고르기(후보 없음·런처만·최소화·여러 개), 빈 프레임 판정, 클라이언트 영역
잘라 내기, 라벨·파일 이름, PNG 저장(덮어쓰지 않음), 붙이기 위치, 명령줄 도구의 인자·종료 코드(가짜 게임으로).

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
| `src/components/GamePanel.vue` | 게임 창 칸: 상태·크기, 화면 저장 단추와 결과, 붙이기 |
| `src/lib/format.ts` | 서식. 대미지 단위 표기는 루트의 `src/core/format.mjs`를 그대로 쓴다(복제하지 않는다) |
| `src/lib/backend.ts` | Rust 명령·이벤트를 부르는 유일한 곳 |
| `src/lib/runtime.ts` | 계산 코드에 넘기는 엔진 런타임(Rust 명령 `engine_*`을 부른다)과 시뮬 결과 캐시의 메모리 저장소(`simCache`) |
| `src/lib/compute.ts` | 파일 읽기 → 런타임을 캐시로 감싸 루트의 `suggestSquads`·`compareSquads` 호출 → 비교 결과. 계산 규칙은 없다 |
| `src-tauri/src/overlay_state.rs` | 보임/숨김·클릭 통과의 전환 규칙과 시작 위치 계산. 창 API를 모른다 |
| `src-tauri/src/report.rs` | 비교 결과 JSON 읽기와 형식 확인(한국어 오류), 입력 JSON 파일 읽기 |
| `src-tauri/src/engine.rs` | 엔진 설정, 카탈로그·버전 읽기, `python -m runner.sim --batch` 병렬 실행(최대 4개, 순서 보존, 시간 제한). 계산 로직 없음 |
| `src-tauri/src/game_window.rs` | 게임 창 고르기 규칙, 창 정보·상태의 모양, 한국어 오류, 붙이기 위치 계산. Win32를 모른다 |
| `src-tauri/src/capture.rs` | 빈 프레임 판정, 클라이언트 영역 잘라 내기, 라벨·파일 이름, PNG 저장, 캡처 폴더. Win32를 모른다 |
| `src-tauri/src/game_win32.rs` | Win32 호출: 창 열거·창 정보 읽기, Windows.Graphics.Capture |
| `src-tauri/src/capture_cli.rs` · `src/bin/nikke-capture.rs` | 명령줄 도구 `nikke-capture`의 인자 해석·종료 코드와 실행 파일 |
| `src-tauri/src/lib.rs` | 창·전역 단축키·명령·게임 창 추적 스레드를 잇는 접착 코드 |
| `src-tauri/tests/live_game.rs` | 실제 게임을 상대로 한 테스트(`#[ignore]`) |
| `src-tauri/tests/live_capture.rs` | 게임 없이 캡처 경로를 확인하는 테스트(`#[ignore]`) — 자기 창을 실제 WGC로 찍는다 |
| `src-tauri/capabilities/overlay.json` | 화면에 허용한 권한: 이벤트 듣기, 창 끌기, 앱 명령 열두 개 |

Rust 명령: `load_report(path)`, `overlay_status()`, `startup_report_path()`, `quit_app()`,
`engine_catalog()`, `engine_version()`, `engine_run_batch(requests)`, `read_json_file(path)`, `pick_json_file(title)`,
`game_window_status()`, `set_follow_game(enabled)`, `capture_game(label)`.
이벤트: `overlay-state`, `engine-progress`, `game-window`(게임 창 상태가 바뀔 때), `game-capture`(단축키로 저장한 결과).
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

게임 창·화면 캡처(P-011):

- 오버레이에서 `Alt+Shift+S`로 저장한 캡처가 실제 게임 화면과 같은지(단축키는 눌러 보지 못했다).
- 붙이기를 켠 상태에서 게임 창을 옮기거나 크기를 바꾸면 오버레이가 따라오는지(자동 테스트는 게임 창을 움직일 수 없다).
- 전체 화면(테두리 없는 창·전용 전체 화면)에서 캡처가 되는지.
- 캡처하는 순간 게임 창 둘레에 노란 테두리가 보이는지, 게임이 끊기지 않는지.
