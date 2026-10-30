/**
 * Vercel Serverless Function: POST /api/agent/:role
 * 处理工作坊五类 Agent 的调用
 */

const { callDeepSeek, extractJson } = require('../../lib/deepseek');
const { getAgentPrompt } = require('../../lib/prompts');
const { getAgentFallback } = require('../../lib/fallback-data');

const VALID_ROLES = ['market', 'user', 'engineering', 'business', 'review', 'final'];

module.exports = async (req, res) => {
  // CORS
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

  const role = req.query.role;
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role: ${role}` });
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

  if (!payload || !payload.proposition) {
    res.status(400).json({ error: 'Missing proposition' });
    return;
  }

  const systemPrompt = getAgentPrompt(role);
  const previousDataStr = payload.previousData
    ? '\n\n前期分析数据：\n' + JSON.stringify(payload.previousData, null, 2)
    : '';
  const userPrompt = `产品命题：${payload.proposition}${previousDataStr}\n\n请从专业视角输出结构化分析结果。`;

  try {
    const content = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    let result;
    try {
      result = extractJson(content);
    } catch (parseErr) {
      console.warn(`[Agent:${role}] JSON parse failed, using raw content`, parseErr.message);
      result = {
        content: content.substring(0, 400),
        output: {},
        evidence: [{ level: 'C', source: 'LLM 返回格式异常' }],
        _parseError: true,
      };
    }

    res.status(200).json({ ...result, source: 'llm' });
  } catch (err) {
    console.log(`[Agent:${role}] DeepSeek 调用失败，使用 fallback:`, err.message);
    const fallback = getAgentFallback(role, payload.proposition);
    res.status(200).json({ ...fallback, source: 'fallback' });
  }
};
