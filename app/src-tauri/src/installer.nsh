!define MUI_CUSTOMFUNCTION_GUIINIT CompanionInstallFolder

Function CompanionInstallFolder
  ; 처음 설치할 때의 제안 위치를 정한다. 다시 설치할 때에는 기록된 위치를 사용한다.
  Push $0
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nikke-companion" "InstallLocation"
  ${If} $0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\nikke-companion"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\nikke-companion"
  ${EndIf}
  Pop $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; 무인 설치에서는 폴더 선택 화면을 거치지 않는다.
  ${If} ${Silent}
    Call CompanionInstallFolder
    SetOutPath "$INSTDIR"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ${If} $APPDATA != ""
      RMDir /r "$APPDATA\nikke-companion"
    ${EndIf}
  ${EndIf}
!macroend
