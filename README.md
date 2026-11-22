# 니케 컴패니언

승리의 여신: 니케 PC판(한국 서버)용 **개인** 데스크톱 앱 — 데스크톱 앱 창 + 게임 위의 오버레이 위젯, 계정 맞춤
편성 · 성장 추천(요격전 중심), 엔진 계산으로 만든 티어. Windows 설치판은 공개 GitHub Releases에서 배포한다.

- 무엇을 만드는가 · 결정 기록: [`docs/spec.md`](docs/spec.md)
- 지금 상태: [`.harness/progress.md`](.harness/progress.md)
- **다음에 할 일: [`docs/plan.md`](docs/plan.md)**
- 명령 · 작업 원칙(에이전트용 안내이기도 하다): [`CLAUDE.md`](CLAUDE.md)
- 앱의 자세한 설명: [`app/README.md`](app/README.md)

## Windows 설치판

[공개 릴리스](https://github.com/RoastFried-RF/nikke-companion/releases/latest)에서 최신 판의 `-setup.exe`를 받아 실행한다.
관리자 권한 없이 현재 사용자에게 설치된다. 계산과 계정 연결에는 PC의 Python 3.12 이상이 필요하다. [Python 설치 프로그램](https://www.python.org/downloads/windows/)에서 **Add python.exe to PATH**를 선택하고 앱을 다시 연다.

앱이 켜질 때 새 판을 확인한다. **설정 → 앱 정보·업데이트**에서 자동 확인을 끄거나 수동으로 확인할 수 있다. 계산이 끝난 뒤 **설치하고 다시 시작**을 누르면 서명을 확인하고 설치한다.
설치판의 계정·캡처·받은 이미지·계산 도구는 각각 `%APPDATA%\nikke-companion`의 `accounts`, `captures`, `assets`, `engine`에 있다.
앱을 제거할 때 「애플리케이션 데이터 삭제」를 선택하면 설치판의 계정·캡처·이미지·엔진을 함께 지운다. 선택하지 않거나 업데이트할 때는 데이터를 보존한다.
엔진에 딸린 게임 이미지는 설치판에 포함된다. 개인 계정과 캡처는 각 PC에 보관한다.

## 다른 PC에서 이어 하기

### 필요한 것

| 무엇 | 이 저장소를 만든 PC의 판 |
|---|---|
| Windows 11 (WebView2 포함) | 10.0.26300 |
| Node.js 20 이상 | v20.19.6 |
| Python 3.12 (엔진 — 표준 라이브러리만 쓴다) | 3.12.3 |
| Rust (MSVC 툴체인 — Visual Studio Build Tools의 C++ 빌드 도구 필요) | 1.99.1 |
| Git | 2.48 |
| Claude Code CLI(`claude`) — 자율 실행(`scripts/autopilot.mjs`)을 쓸 때만. Fable 5.2를 쓸 수 있는 계정으로 로그인 | — |

### 받기와 설치

엔진(`vendor/nikke-calc`)이 서브모듈이라 함께 받아야 한다.

```bash
git clone --recurse-submodules https://github.com/RoastFried-RF/nikke-companion.git
```

```bash
npm --prefix app install
```

이미 받은 뒤에 서브모듈이 비어 있으면:

```bash
git submodule update --init
```

### 되는지 확인

```bash
node --test tests/unit/
```

```bash
node --test tests/integration/
```

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml
```

```bash
npm --prefix app test
```

```bash
node scripts/verify.mjs --status
```

앱 실행:

```bash
npm --prefix app run tauri dev
```

설정 → 계정 연결 → **확장 설치(한 번)**에서 **경로 복사**를 눌러 크롬·엣지에 설치할 폴더를 찾는다. **브라우저로 로그인**을 눌러 평소 쓰는 패스키로 로그인한 뒤 확장에서 **오버레이로 보내기**를 누르면 계정을 받는다. 배포된 v0.1.0에서는 저장소의 확장이 필요하다. [설치와 연결 순서](extension/README.md)

확장이 받는 쪽이 니케 컴패니언인지 확인할 수 없어 자동 전달은 보류했다. 앱이 확장에 자신을 증명하는 방식을 사용자가 정하면 별도 작업으로 재개한다.

### 저장소에 없는 것

개인 데이터와 게임 이미지는 일부러 올리지 않았다(`.gitignore`). 새 PC에서는 아래처럼 다시 만들거나, **깃허브가 아닌
길로**(USB 등) 옮긴다.

| 폴더 · 파일 | 무엇 | 새 PC에서 |
|---|---|---|
| `data/accounts/` | 내 계정(니케 육성 상태), 요격전 추천 결과 · 기록 · 저장한 편성, 앱 설정 | 앱의 설정 > 계정 연결로 다시 받는다(크롬 확장 — `extension/README.md`). 기록 · 저장한 편성까지 옮기려면 폴더를 복사한다 |
| `vendor/nikke-calc/scraper/.session_cookie`, `vendor/nikke-calc/profiles/` | blablalink 세션 쿠키(계정 접근권)와 받아 둔 프로필 | 옮기지 않는다 — 새 PC에서 계정을 받으면 다시 생긴다 |
| `data/captures/` | 게임 화면 캡처 16장 + `labels.json`(화면 인식 시험용), `bosses/*.png`(보스 얼굴 이미지 5장) | 없으면 보스 이미지가 속성 색으로 대신 나오고 `live_recognize` 테스트를 돌릴 수 없다. 폴더를 복사하거나 `nikke-capture`로 다시 찍는다(`app/README.md` §게임 창 · 화면 캡처) |
| `data/cache/` | 시뮬 결과 캐시 | 다시 계산하면 생긴다 |
| `data/assets/` | 공식 CDN에서 받는 게임 이미지 | 지금은 받을 것이 없다(`node scripts/fetch-assets.mjs --list`) |
| `app/node_modules/`, `app/dist/`, `app/src-tauri/target/` | 설치 · 빌드 산출물 | 설치 · 빌드하면 생긴다(첫 Rust 빌드는 몇 분 걸린다) |

샘플 계정(`data/samples/`)만으로도 계산과 화면 대부분을 볼 수 있다 — 지어낸 데이터다(`is_test_data: true`).

### 알아 둘 것

- 니케는 관리자 권한으로 돈다. 게임 화면을 읽는 것(캡처 · 화면 인식 · 자동 추적)은 일반 권한으로도 됐다. 앱은 게임을
  **읽기만** 한다(입력 · 창 조작 · 메모리 읽기 없음 — 입력 자동화는 만들 수 없다: `docs/plan.md` §5).
- Windows 콘솔은 cp949다. 엔진을 직접 부를 때는 `PYTHONUTF8=1`이 필요하다(앱과 CLI는 스스로 설정한다).
- 자율 실행을 쓰는 세션은 `.harness/config.json`의 설정대로 Fable 5.2만 쓴다.

## 라이선스 · 권리

엔진 `vendor/nikke-calc`는 별도 저장소다(MIT — `docs/spec.md` §7). 게임의 이미지 · 이름 · 데이터의 권리는 게임사에
있다 — 이 저장소에는 게임 이미지를 넣지 않는다.
