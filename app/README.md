# 니케 컴패니언 오버레이 (app/)

Tauri v2 + Vue 3 + Vite + TypeScript로 만든 데스크톱 오버레이의 **골격**이다(P-009).
이미 만들어 둔 비교 결과 JSON(`docs/data-model.md` §비교 결과)을 읽어 순위를 그린다.

아직 하지 않는 것: 엔진 호출(P-010), 게임 창 추적, 화면 캡처. 이 앱은 네트워크 요청을 하지 않는다.

## 준비

- Node 20.19 이상, Rust(stable, MSVC 툴체인), WebView2 런타임(Windows 11에는 기본 설치)
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

다른 결과를 보려면 저장소 루트에서 결과 파일을 만들고 그 경로를 입력란에 넣는다(절대 경로 권장, 따옴표가 붙어 있어도 된다).

```bash
node src/cli.mjs compare --account data/samples/account.sample.json --condition data/samples/condition.solo-raid.json --squads data/samples/squads.sample.json --json 결과.json
```

마지막으로 불러온 경로는 기억했다가 다음 실행 때 다시 연다. 실행 인자로 줄 수도 있다: `nikke-companion.exe <결과.json>`.

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
cargo test --manifest-path app/src-tauri/Cargo.toml       # 상태 전환 규칙·결과 읽기 단위 테스트
cargo build --manifest-path app/src-tauri/Cargo.toml
```

컴포넌트 테스트의 입력(`tests/fixtures/compare.sample.json`)은 실제 CLI가 만든 결과다. 엔진이나 샘플이 바뀌면 다시 만든다.

```bash
npm --prefix app run fixture
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/App.vue` | 오버레이 화면: 상태 표시, 결과 파일 불러오기, 오류 |
| `src/components/ReportView.vue` | 비교 결과 그리기(순위·총딜·멤버·메모·걸러진 편성·실패한 편성·주의·엔진 버전) |
| `src/components/OverlayStatus.vue` | 클릭 통과·숨김 상태와 단축키 표시 |
| `src/lib/format.ts` | 서식. 대미지 단위 표기는 루트의 `src/core/format.mjs`를 그대로 쓴다(복제하지 않는다) |
| `src/lib/backend.ts` | Rust 명령·이벤트를 부르는 유일한 곳 |
| `src-tauri/src/overlay_state.rs` | 보임/숨김·클릭 통과의 전환 규칙과 시작 위치 계산. 창 API를 모른다 |
| `src-tauri/src/report.rs` | 비교 결과 JSON 읽기와 형식 확인(한국어 오류) |
| `src-tauri/src/lib.rs` | 창·전역 단축키·명령을 잇는 접착 코드 |
| `src-tauri/capabilities/overlay.json` | 화면에 허용한 권한: 이벤트 듣기, 창 끌기, 앱 명령 네 개 |

Rust 명령: `load_report(path)`, `overlay_status()`, `startup_report_path()`, `quit_app()`.
명령을 더하면 `src-tauri/build.rs`의 목록과 capability에도 적어야 화면에서 부를 수 있다.

## 사람이 확인할 것 (아직 확인하지 않았다)

- 실제 니케 PC판 위에서 오버레이가 보이는지(창 모드·전체 화면). 전체 화면 전용 모드에서는 가려질 수 있다.
- 클릭 통과 상태에서 창 아래 프로그램이 클릭되고 게임 입력을 방해하지 않는지.
- `Alt+Shift+O`로 다시 보일 때 오버레이가 키보드 포커스를 가져간다(창 라이브러리가 창을 보이면서 활성화한다).
  게임 입력이 끊기면 게임을 한 번 클릭해 되돌려야 한다 — 게임 위에서 불편한지 확인이 필요하다.
- Alt+Tab·창 이동·크기 변경 뒤에도 단축키와 표시가 맞는지.
