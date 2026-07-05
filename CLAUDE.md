# 我的博客项目

## 公网地址
https://fabulous-cranachan-29a6c2.netlify.app

## 项目结构
- `index.html` - 公开博客页面（只读）
- `admin.html` - 本地编辑器（写文章、管理个人信息）
- `posts.json` - 文章数据
- `profile.json` - 个人信息（头像、昵称、简介）
- `server.js` - 本地服务器，处理保存和部署
- `启动编辑器.bat` - 双击启动编辑器

## 日常使用
1. 双击 `启动编辑器.bat`（不要关弹出的命令行窗口）
2. 浏览器打开后编辑文章、个人信息
3. 点左侧「发布」按钮即可更新公网

## 技术说明
- 纯静态网站，部署在 Netlify
- 文章和个人信息存储在 JSON 文件中
- 图片以 base64 格式嵌入文章内容
- 本地服务器运行在 localhost:3456，负责保存文件和调用 Netlify 部署
