@echo off
title 博客编辑器
cd /d "%~dp0"
echo 正在启动博客编辑器...
echo.
start "" http://localhost:3456
echo 如果浏览器显示"无法连接"，等2秒刷新一下即可。
echo 请不要关闭此窗口。
echo.
node server.js
pause
