/**
 * Vercel Serverless Function: GET /api/status
 * 返回后端配置状态
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    deepseekConfigured: !!process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
    timestamp: new Date().toISOString(),
  });
};
