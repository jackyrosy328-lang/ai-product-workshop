/**
 * 本地开发服务器
 * 模拟 Vercel 的路由 + Serverless 函数行为，便于本地测试
 *
 * 使用：
 *   export DEEPSEEK_API_KEY=sk-xxxx   # 可选
 *   node dev-server.js
 *   打开 http://127.0.0.1:7333/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const PORT = process.env.PORT || 7333;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ============================================================
// 调用 serverless function（CommonJS module）
// ============================================================
async function invokeFunction(functionPath, req, res) {
  try {
    // 清除 require 缓存，便于开发热更新
    delete require.cache[require.resolve(functionPath)];
    const mod = require(functionPath);
    const handler = mod.default || mod;

    // 模拟 Vercel 的 req/res 接口
    const mockRes = {
      _status: 200,
      _headers: {},
      status(code) { this._status = code; return this; },
      setHeader(k, v) { this._headers[k] = v; return this; },
      json(data) {
        res.writeHead(this._status, { ...this._headers, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      },
      end(data) {
        res.writeHead(this._status, this._headers);
        res.end(data);
      },
    };

    // 解析 query
    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = Object.fromEntries(url.searchParams.entries());

    // 解析 dynamic route 参数（/api/agent/[role]）
    const roleMatch = url.pathname.match(/^\/api\/agent\/([^/]+)$/);
    if (roleMatch) query.role = roleMatch[1];

    // 解析 body
    let body = null;
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      });
    }

    const mockReq = {
      method: req.method,
      query,
      body,
      headers: req.headers,
      url: req.url,
    };

    await handler(mockReq, mockRes);
  } catch (err) {
    console.error('[Function Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, stack: err.stack }));
  }
}

// ============================================================
// 静态文件服务
// ============================================================
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);

  // 路由重写（对齐 vercel.json）
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/workshop') urlPath = '/workshop/index.html';
  if (urlPath === '/sandbox') urlPath = '/sandbox/index.html';

  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found: ' + safePath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ============================================================
// 主服务
// ============================================================
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // API 路由分发
  if (urlPath.match(/^\/api\/agent\/[^/]+$/)) {
    return invokeFunction(path.join(ROOT, 'api/agent/[role].js'), req, res);
  }
  if (urlPath === '/api/sandbox-plans') {
    return invokeFunction(path.join(ROOT, 'api/sandbox-plans.js'), req, res);
  }
  if (urlPath === '/api/status') {
    return invokeFunction(path.join(ROOT, 'api/status.js'), req, res);
  }

  serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AI 产品合伙人工坊 — 本地开发服务已启动\n`);
  console.log(`  门户页:    http://127.0.0.1:${PORT}/`);
  console.log(`  工作坊:    http://127.0.0.1:${PORT}/workshop`);
  console.log(`  用电沙盘:  http://127.0.0.1:${PORT}/sandbox\n`);
  console.log(`  DeepSeek API: ${process.env.DEEPSEEK_API_KEY ? '已配置' : '未配置（API 将返回 fallback 数据）'}`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log(`  配置方法: export DEEPSEEK_API_KEY=sk-xxxx && node dev-server.js\n`);
  } else {
    console.log();
  }
});
