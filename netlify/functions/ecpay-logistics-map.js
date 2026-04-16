const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || '3483323';
const HASH_KEY = process.env.ECPAY_LOGISTICS_HASH_KEY || process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_LOGISTICS_HASH_IV || process.env.ECPAY_HASH_IV;
const NETLIFY_SITE_URL = (process.env.NETLIFY_SITE_URL || 'https://messyttl2i.netlify.app').replace(/\/$/, '');

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
  return `MAP${Date.now()}`.slice(0, 20);
}

function parseStoreFromQuery(query) {
  return {
    StoreID: query.CVSStoreID || query.StoreID || '',
    StoreName: query.CVSStoreName || query.StoreName || '',
    StoreAddress: query.CVSAddress || query.StoreAddress || '',
    StorePhone: query.CVSTelephone || query.StorePhone || ''
  };
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (!HASH_KEY || !HASH_IV) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'MissingEcpayLogisticsSecrets' })
    };
  }

  if (event.httpMethod === 'GET') {
    const store = parseStoreFromQuery(event.queryStringParameters || {});
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Store Selected</title></head><body><script>
      (function () {
        var payload = ${JSON.stringify({ type: 'CVS_SELECTION', ...store })};
        if (window.opener && window.opener !== window) { window.opener.postMessage(payload, '*'); }
        if (window.parent && window.parent !== window) { window.parent.postMessage(payload, '*'); }
        setTimeout(function () { window.close(); }, 300);
        document.body.innerHTML = '<p>門市已選擇完成，視窗即將關閉...</p>';
      })();
    </script></body></html>`;
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      body: html
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const device = body.Device === 1 ? '1' : '0';
    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      LogisticsType: 'CVS',
      LogisticsSubType: 'UNIMARTC2C',
      IsCollection: 'N',
      ServerReplyURL: `${NETLIFY_SITE_URL}/.netlify/functions/ecpay-logistics-map`,
      Device: device
    };
    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        eMapUrl: 'https://logistics.ecpay.com.tw/Express/map',
        formData: params,
        MerchantTradeNo: merchantTradeNo
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'MapBuildFailed', message: error.message })
    };
  }
};
