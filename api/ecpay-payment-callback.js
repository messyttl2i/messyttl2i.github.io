module.exports = async (req, res) => {
  // 綠界會用 POST 回打，你先回 200 + '1|OK' 表示收到
  // 之後你要做驗簽/紀錄訂單，再把邏輯補上
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send('1|OK');
};
