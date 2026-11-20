# Windows 설치판 게시

## 처음 한 번

공개 저장소 `RoastFried-RF/nikke-companion`에 릴리스를 게시할 권한이 있는 계정으로 GitHub CLI에 로그인한다. PowerShell에서 아래 두 명령을 실행하면 각 파일을 표준 입력으로 전달한다. 명령줄과 콘솔 출력에 값이 남지 않는다.

```powershell
cmd /d /c 'gh secret set TAURI_SIGNING_PRIVATE_KEY --repo RoastFried-RF/nikke-companion < "%USERPROFILE%\.tauri\nikke-companion.key"'
cmd /d /c 'gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo RoastFried-RF/nikke-companion < "%USERPROFILE%\.tauri\nikke-companion.key.password"'
```

개인 키와 암호는 저장소 밖의 안전한 곳에 백업한다. 설치판은 빌드에 고정된 공개 키로 서명을 확인한다. 개인 키를 잃으면 이미 설치한 앱에 새 키로 서명한 업데이트를 보낼 수 없어 새 설치 프로그램으로 직접 설치해야 한다.

현재 저장소에 쓰기 권한이 있는 사람은 소유자 한 명이다. 쓰기 권한이 있는 사람은 워크플로를 고친 커밋에 태그를 올려 서명 키를 꺼낼 수 있다. 협업자를 추가할 때는 서명 비밀을 필수 검토자가 있는 GitHub Actions Environment로 옮긴다.

## 새 판 게시

1. `npm --prefix app version <판> --no-git-tag-version`으로 앱 판과 npm 잠금 파일을 함께 올린다. 앱 판의 원본은 `app/package.json`이다. `Cargo.toml`의 `version`은 Rust 크레이트 자체에만 쓰인다.
2. 테스트와 빌드를 확인한 변경을 커밋한다. 게시할 커밋에서 `git tag v<판>`을 만들고 `git push origin v<판>`으로 해당 태그를 올린다.
3. GitHub Actions의 Windows release 실행에서 태그 검사, 앱·루트 테스트와 서명 빌드가 통과했는지 본다. [공개 릴리스](https://github.com/RoastFried-RF/nikke-companion/releases/latest)에서 설치 프로그램, 서명, `latest.json`을 확인한다. 목록의 판, Windows 설치 주소와 서명이 새 판의 것이어야 한다. GitHub가 만든 변경 내용(비어 있으면 태그 설명)이 릴리스 본문과 `latest.json`의 `notes`에 함께 들어갔는지 본다.
4. 이전 판으로 설치한 앱이 새 판을 알리는지, 직접 설치한 뒤 다시 시작해 새 판을 표시하는지 본다. 연결한 계정, 프로필과 캡처가 남고 계정 받기·계산이 되는지 확인한다.

설치 산출물은 `app/src-tauri/target/release/bundle/nsis/`에 생긴다. 서명된 릴리스의 엔진에는 서브모듈의 게임 이미지가 들어간다.

옛 판으로 되돌리려면 현재 앱을 제거한 뒤 옛 설치 파일로 설치한다. 계정과 캡처를 보존하려면 제거할 때 「애플리케이션 데이터 삭제」를 비워 둔다.
