; CollectRx NSIS custom install — startup + first-run agent config template
!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
    "CollectRx" "$INSTDIR\CollectRx.exe --hidden"

  ; Seed agent-config.json for IT (edit token + SQL server — no env var editing)
  CreateDirectory "$COMMONAPPDATA\CollectRx"
  IfFileExists "$COMMONAPPDATA\CollectRx\agent-config.json" +3 0
    CopyFiles "$INSTDIR\resources\app\desktop\config\agent-config.example.json" \
      "$COMMONAPPDATA\CollectRx\agent-config.json"
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CollectRx"
!macroend
