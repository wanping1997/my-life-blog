@echo off
title 博客编辑器
cd /d "%~dp0"
echo 正在启动博客编辑器...
echo.

REM 杀掉占用端口3456的旧进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456.*LISTENING" 2^>nul') do (
  echo 发现旧进程 PID=%%a，正在关闭...
  taskkill /PID %%a /F 2>nul
  timeout /t 1 /nobreak >nul
)

REM 先启动服务器（后台运行）
start /B node server.js
timeout /t 2 /nobreak >nul

REM 服务器就绪后再打开浏览器
start "" http://localhost:3456

echo 编辑器已打开，请不要关闭此窗口。
echo 按 Ctrl+C 可停止服务器。
echo.

REM 保持窗口不关闭
pause >nul
