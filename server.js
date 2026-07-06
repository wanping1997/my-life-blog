const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const sharp = require('sharp');

const PORT = 3456;
const ROOT = __dirname;

// ffmpeg 路径（winget 安装位置）
const FFMPEG_PATH = process.env.FFMPEG_PATH || path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft', 'WinGet', 'Packages',
  'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'ffmpeg-8.1.2-full_build', 'bin', 'ffmpeg.exe'
);

// 确保媒体目录存在
const VIDEOS_DIR = path.join(ROOT, 'videos');
const IMAGES_DIR = path.join(ROOT, 'images');
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR);
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};

function serveFile(req, res) {
  let urlPath = req.url === '/' ? '/admin.html' : decodeURIComponent(req.url);
  let filePath = path.join(ROOT, urlPath);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
  });
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

async function saveFiles(posts, profile) {
  if (posts) {
    fs.writeFileSync(path.join(ROOT, 'posts.json'), JSON.stringify(posts, null, 2));
    console.log('[保存] posts.json');
  }
  if (profile) {
    // 如果头像还是 base64，提取为 avatar.jpg
    const avatar = profile.avatar || '';
    if (avatar.startsWith('data:image/')) {
      const match = avatar.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const buf = Buffer.from(match[2], 'base64');
        const avatarPath = path.join(ROOT, 'avatar.' + ext);
        fs.writeFileSync(avatarPath, buf);
        profile.avatar = 'avatar.' + ext;
        console.log('[保存] avatar.' + ext + ' (' + (buf.length / 1024).toFixed(0) + 'KB)');
        // 同时生成 WebP 版本
        try {
          const webpPath = path.join(ROOT, 'avatar.webp');
          await sharp(avatarPath)
            .resize(200, 200, { fit: 'cover' })
            .webp({ quality: 70 })
            .toFile(webpPath);
          console.log('[WebP] avatar.webp');
        } catch(e) {
          console.error('[WebP] avatar 生成失败:', e.message);
        }
      }
    }
    fs.writeFileSync(path.join(ROOT, 'profile.json'), JSON.stringify(profile, null, 2));
    console.log('[保存] profile.json');
  }
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(null); }
    });
  });
}

// 读取 Netlify 配置
function getNetlifyConfig() {
  let siteId = '1ec8b761-88b3-4bcb-9e28-0c10dc66a614';
  let token = '';
  try {
    const stateJson = JSON.parse(fs.readFileSync(path.join(ROOT, '.netlify', 'state.json'), 'utf8'));
    siteId = stateJson.siteId || siteId;
    const configPath = path.join(process.env.APPDATA || '', 'netlify', 'Config', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const userId = config.userId;
    if (userId && config.users && config.users[userId]) {
      token = config.users[userId].auth.token;
    }
  } catch (e) {
    console.error('[配置] 读取失败:', e.message);
  }
  return { siteId, token };
}

// 通过 API 将草稿部署发布为生产版本
function publishDeploy(siteId, deployId, token) {
  return new Promise((resolve, reject) => {
    const apiReq = https.request({
      hostname: 'api.netlify.com',
      path: '/api/v1/sites/' + siteId + '/deploys/' + deployId + '/restore',
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }, (apiRes) => {
      let body = '';
      apiRes.on('data', c => body += c);
      apiRes.on('end', () => {
        if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
          resolve(true);
        } else {
          reject(new Error('API 返回 ' + apiRes.statusCode + ': ' + body));
        }
      });
    });
    apiReq.on('error', e => reject(e));
    apiReq.end();
  });
}

// 压缩视频：H.264 + AAC，moov atom 前置（faststart）支持流播放
function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const inSize = fs.statSync(inputPath).size;
    console.log('[压缩] 开始: ' + (inSize / 1024 / 1024).toFixed(1) + 'MB');

    const ffmpeg = spawn(FFMPEG_PATH, [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-profile:v', 'main',     // 确保浏览器兼容
      '-pix_fmt', 'yuv420p',    // 8-bit，所有浏览器硬件加速
      '-crf', '24',
      '-preset', 'medium',
      '-g', '60',               // 每秒一个关键帧，快启播放
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-vf', 'scale=w=1920:h=1080:force_original_aspect_ratio=decrease',
      '-y',
      outputPath
    ]);

    let lastProgress = '';
    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      // 提取进度信息
      const timeMatch = msg.match(/time=(\d+:\d+:\d+)/);
      if (timeMatch) {
        lastProgress = timeMatch[1];
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        const outSize = fs.statSync(outputPath).size;
        const ratio = (outSize / inSize * 100).toFixed(0);
        console.log('[压缩] 完成: ' + (inSize / 1024 / 1024).toFixed(1) + 'MB → ' + (outSize / 1024 / 1024).toFixed(1) + 'MB (' + ratio + '%)');
        resolve();
      } else {
        reject(new Error('ffmpeg 退出码 ' + code));
      }
    });

    ffmpeg.on('error', () => {
      reject(new Error('未找到 ffmpeg，请先安装'));
    });
  });
}

// 异步压缩视频并替换原文件（不阻塞上传响应）
function compressAndReplace(filePath) {
  const tmpPath = filePath.replace(/\.\w+$/, '_tmp.mp4');
  compressVideo(filePath, tmpPath)
    .then(() => {
      fs.unlinkSync(filePath);
      fs.renameSync(tmpPath, filePath);
    })
    .catch(e => {
      console.error('[压缩] 失败，保留原文件:', e.message);
      // 清理可能的临时文件
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    });
}

// 压缩图片：限制最大尺寸 1920px，JPEG 质量 80
async function compressImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const inSize = fs.statSync(filePath).size;
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    // 如果图片已经很小（< 200KB）且尺寸在限制内，跳过
    if (inSize < 200 * 1024 && (metadata.width || 0) <= 1920 && (metadata.height || 0) <= 1920) {
      console.log('[压缩] 图片已足够小，跳过: ' + (inSize / 1024).toFixed(0) + 'KB');
      return;
    }

    let pipeline = image.rotate()  // 根据 EXIF 自动旋转
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true });

    // JPEG / JPG → 压缩质量 80
    if (ext === '.jpg' || ext === '.jpeg') {
      pipeline = pipeline.jpeg({ quality: 80, progressive: true });
    }
    // PNG → 保持 PNG 但压缩
    else if (ext === '.png') {
      pipeline = pipeline.png({ compressionLevel: 9, progressive: true });
    }
    // 其他格式 → 转 JPEG
    else {
      pipeline = pipeline.jpeg({ quality: 80, progressive: true });
    }

    const tmpPath = filePath.replace(/\.\w+$/, '_comp' + ext);
    await pipeline.toFile(tmpPath);

    const outSize = fs.statSync(tmpPath).size;
    if (outSize < inSize) {
      fs.unlinkSync(filePath);
      fs.renameSync(tmpPath, filePath);
      console.log('[压缩] ' + (inSize / 1024).toFixed(0) + 'KB → ' + (outSize / 1024).toFixed(0) + 'KB (' + metadata.width + 'x' + metadata.height + ')');
    } else {
      // 压缩后更大，保留原文件
      fs.unlinkSync(tmpPath);
      console.log('[压缩] 保留原文件（压缩后更大）: ' + (inSize / 1024).toFixed(0) + 'KB');
    }

    // 同时生成 WebP 版本（体积更小，浏览器优先加载）
    try {
      const webpPath = filePath.replace(/\.\w+$/, '.webp');
      await sharp(filePath)
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(webpPath);
      const webpSize = fs.statSync(webpPath).size;
      console.log('[WebP] ' + (webpSize / 1024).toFixed(0) + 'KB');
    } catch (e) {
      // WebP 生成失败不影响主流程
      console.error('[WebP] 生成失败:', e.message);
    }
  } catch (e) {
    console.error('[压缩] 图片处理失败，保留原文件:', e.message);
  }
}

// 保存媒体文件（文件名纯 ASCII 避免编码问题）
function saveMediaFile(buffer, originalName, dir) {
  const ext = path.extname(originalName) || '.bin';
  const unique = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + ext;
  const filePath = path.join(dir, unique);
  fs.writeFileSync(filePath, buffer);
  const label = dir === IMAGES_DIR ? '图片' : '视频';
  console.log('[' + label + '] 已保存: ' + originalName + ' → ' + unique + ' (' + (buffer.length / 1024 / 1024).toFixed(1) + 'MB)');
  return unique;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 上传视频
  if (req.method === 'POST' && req.url === '/api/upload-video') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('multipart/form-data')) {
        const boundaryMatch = contentType.match(/boundary=(.+)/);
        if (boundaryMatch) {
          const boundary = boundaryMatch[1].trim();
          const boundaryBuffer = Buffer.from('--' + boundary);
          const str = buffer.toString('binary');
          const parts = str.split('--' + boundary);

          for (const part of parts) {
            if (part.indexOf('Content-Disposition') === -1) continue;
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd === -1) continue;

            const header = part.slice(0, headerEnd);
            const filenameMatch = header.match(/filename="([^"]+)"/);
            if (!filenameMatch) continue;

            const headerStr = part.slice(0, headerEnd + 4);
            const headerLen = Buffer.byteLength(headerStr, 'binary');

            const searchFrom = buffer.indexOf(Buffer.from(headerStr.slice(0, 40), 'binary'));
            if (searchFrom === -1) continue;

            const fileStart = searchFrom + headerLen;
            const nextBoundary = buffer.indexOf(boundaryBuffer, fileStart);
            let fileEnd = nextBoundary > 0 ? nextBoundary - 2 : buffer.length - 2;
            if (fileEnd <= fileStart) fileEnd = buffer.length - 2;

            const fileData = buffer.slice(fileStart, fileEnd);
            const filename = filenameMatch[1];
            const savedName = saveMediaFile(fileData, filename || 'video.mp4', VIDEOS_DIR);
            compressAndReplace(path.join(VIDEOS_DIR, savedName));
            return json(res, 200, { ok: true, filename: savedName });
          }
        }
      } else {
        let filename = req.headers['x-filename'] || 'video_' + Date.now().toString(36) + '.mp4';
        try { filename = decodeURIComponent(filename); } catch(e) {}
        const savedName = saveMediaFile(buffer, filename, VIDEOS_DIR);
        compressAndReplace(path.join(VIDEOS_DIR, savedName));
        return json(res, 200, { ok: true, filename: savedName });
      }

      json(res, 400, { ok: false, msg: '未能解析视频文件' });
    });
    return;
  }

  // 上传图片
  if (req.method === 'POST' && req.url === '/api/upload-image') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      let filename = req.headers['x-filename'] || 'image_' + Date.now().toString(36) + '.jpg';
      try { filename = decodeURIComponent(filename); } catch(e) {}
      const savedName = saveMediaFile(buffer, filename, IMAGES_DIR);
      // 异步压缩图片（后台执行，不阻塞响应）
      compressImage(path.join(IMAGES_DIR, savedName));
      return json(res, 200, { ok: true, filename: savedName });
    });
    return;
  }

  // 列出视频文件
  if (req.method === 'GET' && req.url === '/api/list-videos') {
    try {
      const files = fs.readdirSync(VIDEOS_DIR)
        .filter(f => /\.(mp4|webm|mov|avi|mkv)$/i.test(f))
        .map(f => ({ name: f, size: fs.statSync(path.join(VIDEOS_DIR, f)).size }));
      json(res, 200, files);
    } catch (e) {
      json(res, 500, []);
    }
    return;
  }

  // 保存文件
  if (req.method === 'POST' && req.url === '/api/save') {
    const data = await readBody(req);
    if (!data) return json(res, 400, { ok: false, msg: '数据格式错误' });
    try {
      await saveFiles(data.posts, data.profile);
      json(res, 200, { ok: true, msg: '文件已保存' });
    } catch (e) {
      json(res, 500, { ok: false, msg: e.message });
    }
    return;
  }

  // 保存 + 部署（GitHub Pages）
  if (req.method === 'POST' && req.url === '/api/deploy') {
    const data = await readBody(req);
    if (!data) return json(res, 400, { ok: false, msg: '数据格式错误' });
    try {
      await saveFiles(data.posts, data.profile);
    } catch (e) {
      return json(res, 500, { ok: false, msg: '保存失败: ' + e.message });
    }

    const url = 'https://wanping1997.github.io/my-life-blog/';
    console.log('[部署] git add + commit + push...');

    exec('git add -A && git commit -m "publish" && git push origin master', { cwd: ROOT, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        // git commit 在无变更时会报错，这种情况也算成功
        if (stderr && stderr.includes('nothing to commit')) {
          console.log('[部署] 无变更，跳过 push');
          return json(res, 200, { ok: true, msg: '已是最新版本', url });
        }
        console.error('[部署] git push 失败:', stderr || err.message);
        return json(res, 500, { ok: false, msg: '部署失败: ' + (stderr || err.message) });
      }
      console.log('[部署] 成功! ' + url);
      console.log('[部署] GitHub Pages 将在 1-2 分钟内自动更新');
      json(res, 200, { ok: true, msg: '部署成功！1-2 分钟后生效', url });
    });
    return;
  }

  serveFile(req, res);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  博客管理已启动');
  console.log('  打开 → http://localhost:' + PORT);
  console.log('');
  console.log('  编辑完点「发布」即可更新公网');
  console.log('');
});
