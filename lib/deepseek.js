/**
 * DeepSeek API 调用封装（Serverless 环境）
 */

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

/**
 * 调用 DeepSeek Chat Completion
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} options
 * @param {number} options.maxTokens
 * @param {number} options.temperature
 * @param {number} options.timeoutMs
 * @returns {Promise<string>} 模型返回的 content 字符串
 */
async function callDeepSeek(messages, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  const {
    maxTokens = 2000,
    temperature = 0.7,
    timeoutMs = 20000,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`DeepSeek HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty content from DeepSeek');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 LLM 返回的字符串中提取 JSON 对象
 * 兼容 ```json ... ``` 代码块 和 直接 { ... }
 */
function extractJson(content) {
  let jsonStr = String(content || '').trim();

  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  } else {
    const direct = jsonStr.match(/\{[\s\S]*\}/);
    if (direct) {
      jsonStr = direct[0];
    }
  }

  return JSON.parse(jsonStr);
}

module.exports = { callDeepSeek, extractJson };
