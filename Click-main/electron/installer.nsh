; Adds CollectRx to Windows startup (user-level, no UAC prompt)
!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
    "CollectRx" "$INSTDIR\CollectRx.exe --hidden"
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CollectRx"
!macroend
