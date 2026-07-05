@echo off
title 博客编辑器
cd /d "%~dp0"
echo 正在启动博客编辑器...
echo.
start "" http://localhost:3456
echo 编辑器已打开，请不要关闭此窗口。
echo 按 Ctrl+C 可停止服务器。
echo.
node server.js
pause
