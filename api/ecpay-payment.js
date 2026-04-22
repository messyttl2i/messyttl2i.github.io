const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV;

// 測試環境金流網址（正式環境要換成正式網域）
const ECPAY_AIO_URL =
  process.env.ECPAY_AIO_URL || 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';

// 付款完成後回到你的 GitHub Pages（你指��的）
const RETURN_URL = process.env.ECPAY_RETURN_URL || 'https://messyttl2i.github.io/';

// 讓綠界背景通知回來（可先留著，之後要做付款結果入庫再處理）
function getSiteUrl(req) {
  const envSite = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (envSite) return envSite;
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;
  return '';
}

function setCors(req, res) {
  const allowList = new Set([
    'https://messyttl2i.github.io',
    'http://localhost:8888',
    'http://localhost:3000'
  ]);
  const origin = req.headers.origin;
  if (origin && allowList.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function merchantTradeDate(date = new Date()) {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function normalizeTradeNo(input) {
  const cleaned = String(input || '').replace(/[^0-9A-Za-z]/g, '');
  if (cleaned.length >= 8) return cleaned.slice(0, 20);
  return `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildAutoSubmitForm(actionUrl, fields) {
  const inputs = Object.keys(fields)
    .map((k) => {
      const v = fields[k] == null ? '' : String(fields[k]);
      return `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Redirecting...</title></head>
<body>
  <p style="font-family:system-ui; padding:16px;">正在導向綠界付款頁...</p>
  <form id="ecpay" method="POST" action="${escapeHtml(actionUrl)}">
    ${inputs}
  </form>
  <script>document.getElementById('ecpay').submit();</script>
</body>
</html>`;
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const SITE_URL = getSiteUrl(req);

  if (!MERCHANT_ID || !HASH_KEY || !HASH_IV) {
    return res.status(500).json({ success: false, error: 'MissingEcpayPaymentConfig' });
  }

  try {
    const body = req.body || {};

    // 你前端送來的資料（可依你現有欄位調整）
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const totalAmount = Math.max(1, parseInt(body.TotalAmount, 10) || 1);
    const itemName = String(body.ItemName || '商品訂單').slice(0, 200);
    const tradeDesc = String(body.TradeDesc || 'MessyTTL2i Order').slice(0, 200);

    // 綠界 AioCheckOut 參數（信用卡：ChoosePayment=Credit）
    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: merchantTradeDate(),
      PaymentType: 'aio',
      TotalAmount: String(totalAmount),
      TradeDesc: tradeDesc,
      ItemName: itemName,
      ReturnURL: `${SITE_URL}/api/ecpay-payment-callback`, // 背景通知（先留著）
      OrderResultURL: RETURN_URL, // 付款完成後導回你指定的 GitHub Pages
      ChoosePayment: 'Credit',
      EncryptType: 1
    };

    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    const html = buildAutoSubmitForm(ECPAY_AIO_URL, params);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).json({ success: false, error: 'EcpayPaymentBuildFailed', message: e.message });
  }
};
