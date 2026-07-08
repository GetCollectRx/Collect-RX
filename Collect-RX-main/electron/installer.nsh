; CollectRx NSIS custom install — startup + first-run agent config template
!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
    "CollectRx" "$INSTDIR\CollectRx.exe --hidden"

  ; ProgramData\CollectRx\agent-config.json (ReadEnvStr — $COMMONAPPDATA is not defined in NSIS)
  ReadEnvStr $0 ProgramData
  CreateDirectory "$0\CollectRx"
  IfFileExists "$0\CollectRx\agent-config.json" +3 0
    CopyFiles "$INSTDIR\resources\desktop\config\agent-config.example.json" \
      "$0\CollectRx\agent-config.json"
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CollectRx"
!macroend
