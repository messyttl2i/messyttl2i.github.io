const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || process.env.ECPAY_MERCHANTID || process.env.MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_LOGISTICS_HASH_KEY || process.env.ECPAY_HASH_KEY || process.env.ECPAY_HASHKEY;
const HASH_IV = process.env.ECPAY_LOGISTICS_HASH_IV || process.env.ECPAY_HASH_IV || process.env.ECPAY_HASHIV;
const ECPAY_MAP_URL = process.env.ECPAY_LOGISTICS_MAP_URL || 'https://logistics.ecpay.com.tw/Express/map';

function getSiteUrl() {
  // 1. Manual override (highest priority)
  const manual = (process.env.SITE_URL || process.env.NETLIFY_SITE_URL || '').trim();
  if (manual) return manual.replace(/\/$/, '');
  // 2. Vercel stable production URL (set automatically since 2023)
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (prod) return `https://${prod}`.replace(/\/$/, '');
  // 3. Vercel deployment URL (always set by Vercel runtime)
  const vercelUrl = (process.env.VERCEL_URL || '').trim();
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/$/, '');
  return '';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
}

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

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch (e) {
    return {};
  }
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const siteUrl = getSiteUrl();
  const missing = [];
  if (!MERCHANT_ID) missing.push('ECPAY_MERCHANT_ID');
  if (!HASH_KEY) missing.push('ECPAY_LOGISTICS_HASH_KEY / ECPAY_HASH_KEY');
  if (!HASH_IV) missing.push('ECPAY_LOGISTICS_HASH_IV / ECPAY_HASH_IV');
  if (!siteUrl) missing.push('SITE_URL (or VERCEL_PROJECT_PRODUCTION_URL)');
  if (missing.length) {
    res.status(500).json({ success: false, error: 'MissingEcpayLogisticsConfig', missing });
    return;
  }

  if (req.method === 'GET') {
    const store = parseStoreFromQuery(req.query || {});
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Store Selected</title></head><body><script>
      (function () {
        var payload = ${JSON.stringify({ type: 'CVS_SELECTION', ...store })};
        if (window.opener && window.opener !== window) { window.opener.postMessage(payload, '*'); }
        if (window.parent && window.parent !== window) { window.parent.postMessage(payload, '*'); }
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
    const body = parseBody(req.body);
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const device = body.Device === 1 ? '1' : '0';
    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      LogisticsType: 'CVS',
      LogisticsSubType: 'UNIMARTC2C',
      IsCollection: 'N',
      ServerReplyURL: `${siteUrl}/api/ecpay-logistics-map`,
      Device: device
    };
    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    res.status(200).json({
      success: true,
      eMapUrl: ECPAY_MAP_URL,
      formData: params,
      MerchantTradeNo: merchantTradeNo
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'MapBuildFailed', message: error.message });
  }
};
