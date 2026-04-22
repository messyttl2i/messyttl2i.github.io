const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_LOGISTICS_HASH_KEY || process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_LOGISTICS_HASH_IV || process.env.ECPAY_HASH_IV;

// 你的Vercel 專案 base URL（建議你在 Vercel 設 SITE_URL= https://xxx.vercel.app）
function getSiteUrl(req) {
  const envSite = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (envSite) return envSite;

  // fallback：從 request 推
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;

  return '';
}

const ECPAY_MAP_URL = process.env.ECPAY_LOGISTICS_MAP_URL || 'https://logistics.ecpay.com.tw/Express/map';

function ecpayEncode(value) {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2a')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function buildCheckMacValue(params, hashKey, hashIv) {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key}=${params[key] ?? ''}`)
    .join('&');

  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIv}`;
  const encoded = ecpayEncode(raw).toLowerCase();
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

function normalizeTradeNo(input) {
  const cleaned = String(input || '').replace(/[^0-9A-Za-z]/g, '');
  if (cleaned.length >= 8) return cleaned.slice(0, 20);
  return `MAP${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

function parseStoreFromQuery(query) {
  return {
    StoreID: query.CVSStoreID || query.StoreID || '',
    StoreName: query.CVSStoreName || query.StoreName || '',
    StoreAddress: query.CVSAddress || query.StoreAddress || '',
    StorePhone: query.CVSTelephone || query.StorePhone || ''
  };
}

function setCors(req, res) {
  // 建議你先只允許你的 GitHub Pages 網域；需要測試再加 localhost
  const allowList = new Set([
    'https://messyttl2i.github.io',
    'http://localhost:8888',
    'http://localhost:3000'
  ]);

  const origin = req.headers.origin;
  if (origin && allowList.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // 沒帶 origin（例如直接 GET 開頁）就不特別限制
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const SITE_URL = getSiteUrl(req);

  if (!MERCHANT_ID || !HASH_KEY || !HASH_IV || !SITE_URL) {
    res.status(500).json({ success: false, error: 'MissingEcpayLogisticsConfig' });
    return;
  }

  // 綠界選店完成後會 redirect 回 ServerReplyURL（GET）
  if (req.method === 'GET') {
    const store = parseStoreFromQuery(req.query || {});
    const payload = { type: 'CVS_SELECTION', ...store };

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Store Selected</title></head>
<body><script>
(function () {
  var payload = ${JSON.stringify(payload)};
  try {
    if (window.opener && window.opener !== window) { window.opener.postMessage(payload, '*'); }
    if (window.parent && window.parent !== window) { window.parent.postMessage(payload, '*'); }
  } catch (e) {}
  setTimeout(function () { window.close(); }, 300);
  document.body.innerHTML = '<p>門市已選擇完成，視窗即將關閉...</p>';
})();
</script></body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const body = req.body || {};
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const device = body.Device === 1 ? '1' : '0';

    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      LogisticsType: 'CVS',
      LogisticsSubType: 'UNIMARTC2C',
      IsCollection: 'N',
      ServerReplyURL: `${SITE_URL}/api/ecpay-logistics-map`,
      Device: device
    };

    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    res.status(200).json({
      success: true,
      eMapUrl: ECPAY_MAP_URL,
      formData: params,
      MerchantTradeNo: merchantTradeNo
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'MapBuildFailed', message: e.message });
  }
};
