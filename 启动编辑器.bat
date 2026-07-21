@echo off
title 博客编辑器
cd /d "%~dp0"

REM 杀掉旧进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456" 2^>nul') do (
  taskkill /PID %%a /F 2>nul
)
timeout /t 1 /nobreak >nul

echo 正在启动...
echo.

REM 启动服务器并打开浏览器
start http://localhost:3456
node server.js
pause
