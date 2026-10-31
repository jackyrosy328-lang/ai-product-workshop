/**
 * 生成纯静态「本地版」：local/
 *
 * 目的：不依赖 Vercel / 不需要翻墙 / 不需要 Node 服务，双击 index.html 即可运行。
 * 做法：
 *   1. 所有绝对路径改成相对路径（file:// 下可解析）
 *   2. 用 lib/fallback-data.js 生成浏览器端数据源 local-data.js
 *   3. 注入 local-api.js，拦截 fetch('/api/...') 返回本地预置数据
 *
 * 用法：node build-local.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'local');

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function write(rel, content) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
  console.log(`  ✓ ${rel}`);
}

function copyDir(rel) {
  const src = path.join(ROOT, rel);
  const dest = path.join(OUT, rel);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(path.join(rel, entry.name));
    } else {
      fs.copyFileSync(s, d);
    }
  }
  console.log(`  ✓ ${rel}/`);
}

function mustReplace(html, from, to, label) {
  if (!html.includes(from)) {
    throw new Error(`[${label}] 未找到待替换片段：${from}`);
  }
  return html.split(from).join(to);
}

// ============================================================
// 1. 清理输出目录
// ============================================================
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
console.log('生成静态本地版 → local/\n');

// ============================================================
// 2. 复制静态资源
// ============================================================
copyDir('_shared');
copyDir('assets');

// ============================================================
// 3. 生成 local-data.js（把 Node 版 fallback 数据搬到浏览器）
// ============================================================
const fallbackSrc = read('lib/fallback-data.js')
  .replace(/^module\.exports = \{ getAgentFallback, getSandboxFallback \};$/m, '')
  .trim();

write('assets/local-data.js', `/**
 * 本地版预置数据（由 build-local.js 从 lib/fallback-data.js 自动生成，请勿手改）
 */
(function () {
  ${fallbackSrc}

  window.__LOCAL_DATA__ = {
    getAgentFallback: getAgentFallback,
    getSandboxFallback: getSandboxFallback,
  };
})();
`);

// ============================================================
// 4. 生成 local-api.js（拦截 /api/* 请求）
// ============================================================
write('assets/local-api.js', `/**
 * 本地版 API 拦截层（由 build-local.js 自动生成，请勿手改）
 *
 * 本地版没有后端，直接返回预置数据，因此：
 *   - 工作坊可以完整跑完五步流程
 *   - 用电沙盘走纯前端规则引擎（原本也不需要后端）
 */
(function () {
  var realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function parseBody(init) {
    if (!init || !init.body) return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body); } catch (e) { return {}; }
    }
    return {};
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var data = window.__LOCAL_DATA__;

    // GET /api/status → 不接大模型
    if (url.indexOf('/api/status') !== -1) {
      return Promise.resolve(jsonResponse({ deepseekConfigured: false, model: 'local-static' }));
    }

    // POST /api/agent/<role> → 预置 Agent 输出
    var agentMatch = url.match(/\\/api\\/agent\\/([^/?#]+)/);
    if (agentMatch) {
      var role = agentMatch[1];
      var agentPayload = parseBody(init);
      var result = data.getAgentFallback(role, agentPayload.proposition || '未命名命题');
      return Promise.resolve(jsonResponse(Object.assign({ source: 'local' }, result)));
    }

    // POST /api/sandbox-plans → 预置三套方案
    if (url.indexOf('/api/sandbox-plans') !== -1) {
      var sandboxPayload = parseBody(init);
      return Promise.resolve(jsonResponse({
        plans: data.getSandboxFallback(sandboxPayload),
        source: 'local',
      }));
    }

    // 其它请求交回真实 fetch（本地文件场景下会失败，由调用方兜底）
    if (realFetch) return realFetch(input, init);
    return Promise.reject(new Error('No fetch available'));
  };
})();
`);

// ============================================================
// 5. 处理三个页面
// ============================================================
// 门户页
let indexHtml = read('index.html');
indexHtml = mustReplace(indexHtml, 'href="/workshop"', 'href="workshop/index.html"', 'index.html');
indexHtml = mustReplace(indexHtml, 'href="/sandbox"', 'href="sandbox/index.html"', 'index.html');
write('index.html', indexHtml);

// 工作坊页
let workshopHtml = read('workshop/index.html');
workshopHtml = mustReplace(workshopHtml, "url('/_shared/fonts/", "url('../_shared/fonts/", 'workshop/index.html');
workshopHtml = mustReplace(workshopHtml, 'href="/"', 'href="../index.html"', 'workshop/index.html');
workshopHtml = mustReplace(
  workshopHtml,
  '<script src="/assets/workshop.js"></script>',
  '<script src="../assets/local-data.js"></script>\n  <script src="../assets/local-api.js"></script>\n  <script src="../assets/workshop.js"></script>',
  'workshop/index.html'
);
write('workshop/index.html', workshopHtml);

// 沙盘页
let sandboxHtml = read('sandbox/index.html');
sandboxHtml = mustReplace(sandboxHtml, "url('/_shared/fonts/", "url('../_shared/fonts/", 'sandbox/index.html');
sandboxHtml = mustReplace(sandboxHtml, 'href="/workshop"', 'href="../workshop/index.html"', 'sandbox/index.html');
sandboxHtml = mustReplace(
  sandboxHtml,
  '<script src="/_shared/js/echarts.min.js"></script>',
  '<script src="../_shared/js/echarts.min.js"></script>',
  'sandbox/index.html'
);
sandboxHtml = mustReplace(
  sandboxHtml,
  '<script src="/assets/sandbox.js"></script>',
  '<script src="../assets/local-data.js"></script>\n  <script src="../assets/local-api.js"></script>\n  <script src="../assets/sandbox.js"></script>',
  'sandbox/index.html'
);
write('sandbox/index.html', sandboxHtml);

// 工作坊脚本里的跳转链接（只改本地产物里的副本）
let workshopJs = read('assets/workshop.js');
workshopJs = mustReplace(workshopJs, 'href="/sandbox"', 'href="../sandbox/index.html"', 'assets/workshop.js');
write('assets/workshop.js', workshopJs);

// ============================================================
// 6. 使用说明
// ============================================================
write('使用说明.txt', `AI 产品合伙人工坊 — 本地离线版
========================================

怎么用
  1. 解压整个文件夹（不要只拿单个 html 文件，页面需要同目录的资源）
  2. 双击 index.html 用浏览器打开

三个页面
  index.html            门户页
  workshop/index.html   多 Agent 产品定义工作流
  sandbox/index.html    用电沙盘样品

说明
  · 本版本不联网、不调用任何大模型，所有内容来自内置预置数据
  · 用电沙盘为纯前端物理模拟，数据点均为本地实时计算
  · 如果浏览器对本地文件限制较严（个别版本 Chrome），
    也可以在本目录执行：python3 -m http.server 8000
    然后访问 http://127.0.0.1:8000/
`);

console.log('\n完成。双击 local/index.html 即可打开。');
