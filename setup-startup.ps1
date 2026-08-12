$ws = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath('Startup')
$s = $ws.CreateShortcut("$startup\博客编辑器.lnk")
$s.TargetPath = "c:\Users\wanping97\Desktop\my-blog\start-server.vbs"
$s.WorkingDirectory = "c:\Users\wanping97\Desktop\my-blog"
$s.Save()
Write-Host "Done"
