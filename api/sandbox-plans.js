/**
 * Vercel Serverless Function: POST /api/sandbox-plans
 * 处理用电沙盘的方案生成请求
 */

const { callDeepSeek, extractJson } = require('../lib/deepseek');
const { getSandboxPrompt } = require('../lib/prompts');
const { getSandboxFallback } = require('../lib/fallback-data');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  if (!payload) {
    res.status(400).json({ error: 'Missing payload' });
    return;
  }

  const userPrompt = `模拟数据如下：
- 出行人数：${payload.people} 人
- 露营天数：${payload.days} 天
- 天气：${payload.weather}
- 太阳能板：${payload.solar}W
- 电池容量：1500Wh
- 最低电量：${payload.minSOC}%
- 结束电量：${payload.finalSOC}%
- 日均负载：${payload.avgDailyLoad} Wh/天
- 日均太阳能：${payload.avgDailySolar} Wh/天
- 太阳能覆盖率：${payload.solarCoverage}%
- 接入设备：${payload.devices}
- 关键事件：${payload.events || '无'}

请根据以上数据生成三套用电方案，记住：描述产品边界和可行组合，不要限制用户行为。`;

  try {
    const content = await callDeepSeek([
      { role: 'system', content: getSandboxPrompt() },
      { role: 'user', content: userPrompt },
    ]);

    const plans = extractJson(content);
    res.status(200).json({ plans, source: 'llm' });
  } catch (err) {
    console.log('[Sandbox] DeepSeek 调用失败，使用 fallback:', err.message);
    const plans = getSandboxFallback(payload);
    res.status(200).json({ plans, source: 'fallback' });
  }
};
