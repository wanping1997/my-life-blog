' Blog server watchdog: starts node silently (no window) and restarts it
' automatically if it crashes. Logs go to server.log in this folder.
' Launched at logon by the "博客编辑器" shortcut in the Startup folder.
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
Do
  WshShell.Run "cmd /c node server.js >> server.log 2>&1", 0, True
  WScript.Sleep 3000
Loop
