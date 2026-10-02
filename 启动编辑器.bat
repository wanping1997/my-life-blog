@echo off
title 博客编辑器
cd /d "%~dp0"
start "" http://localhost:3456
echo 正在启动博客编辑器...
echo.
netstat -ano | findstr ":3456 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo 博客服务器已经在运行，直接使用即可。
) else (
  echo 正在后台启动博客服务器，请稍等 2 秒后刷新浏览器。
  start "" wscript "%~dp0start-server.vbs"
)
echo.
timeout /t 3 >nul
exit
