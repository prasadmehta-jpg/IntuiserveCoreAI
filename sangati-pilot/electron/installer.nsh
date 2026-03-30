!macro customHeader
  !system "echo 'SANGATI Installer'"
!macroend

!macro customInit
  ; No custom init needed
!macroend

!macro customInstall
  ; Write additional registry info
  WriteRegStr SHCTX "Software\SANGATI" "InstallPath" "$INSTDIR"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\SANGATI"
!macroend
