exports.handler = async (event) => {
  // 綠界會用 POST 回打，回 200 + '1|OK' 表示收到
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: '1|OK'
  };
};
