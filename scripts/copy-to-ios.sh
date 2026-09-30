#!/bin/bash
osascript <<'EOF'
tell application id "com.apple.dt.Devices" to activate
delay 1
tell application "System Events"
  set frontApp to bundle identifier of (first application process whose frontmost is true)
  if frontApp is not "com.apple.dt.Devices" then error "Simulator window is not in front, nothing typed"
  keystroke (the clipboard as text)
end tell
EOF
