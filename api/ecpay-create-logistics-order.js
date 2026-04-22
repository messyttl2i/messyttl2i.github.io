// api/ecpay-create-logistics-order.js
const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_LOGISTICS_HASH_KEY || process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_LOGISTICS_HASH_IV || process.env.ECPAY_HASH_IV;

// 建議在 Vercel 設 SITE_URL = https://messyttl2i-github-io.vercel.app
function getSiteUrl(req) {
  const envSite = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (envSite) return envSite;

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;
  return '';
}

const SENDER_NAME = process.env.ECPAY_SENDER_NAME || 'MessyTTL2i';
const SENDER_PHONE = String(process.env.ECPAY_SENDER_PHONE || '').replace(/[^\d]/g, '');
const ECPAY_LOGISTICS_CREATE_URL =
  process.env.ECPAY_LOGISTICS_CREATE_URL || 'https://logistics.ecpay.com.tw/Express/Create';

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

function getMerchantTradeDate(dateInput) {
  if (dateInput && /^\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2}$/.test(dateInput)) return dateInput;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function normalizeTradeNo(input) {
  const cleaned = String(input || '').replace(/[^0-9A-Za-z]/g, '');
  if (cleaned.length >= 8) return cleaned.slice(0, 20);
  return `LG${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

function parseEcpayResponse(text) {
  const result = {};
  String(text || '')
    .split('&')
    .forEach((pair) => {
      const [rawKey, ...rawValue] = pair.split('=');
      if (!rawKey) return;
      result[rawKey] = decodeURIComponent((rawValue.join('=') || '').replace(/\+/g, '%20'));
    });
  return result;
}

function setCors(req, res) {
  // 建議允許 GitHub Pages
  const allowList = new Set(['https://messyttl2i.github.io', 'http://localhost:8888', 'http://localhost:3000']);
  const origin = req.headers.origin;

  if (origin && allowList.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const SITE_URL = getSiteUrl(req);

  if (!MERCHANT_ID || !HASH_KEY || !HASH_IV || !SITE_URL || !/^\d{10}$/.test(SENDER_PHONE)) {
    return res.status(500).json({ success: false, error: 'MissingEcpayLogisticsConfig' });
  }

  try {
    const body = req.body || {};
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const tradeDate = getMerchantTradeDate(body.MerchantTradeDate);
    const amount = Math.max(1, parseInt(body.TotalAmount, 10) || 1);
    const receiverPhone = String(body.ReceiverPhone || '').replace(/[^\d]/g, '');

    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: tradeDate,
      LogisticsType: 'CVS',
      LogisticsSubType: 'UNIMARTC2C',
      GoodsAmount: String(amount),
      GoodsName: String(body.ItemName || body.TradeDesc || '商品訂單').slice(0, 25),
      SenderName: SENDER_NAME,
      SenderCellPhone: SENDER_PHONE,
      ReceiverName: String(body.ReceiverName || '').slice(0, 10),
      ReceiverCellPhone: receiverPhone,
      ReceiverStoreID: String(body.CVSStoreID || ''),
      ServerReplyURL: `${SITE_URL}/api/ecpay-create-logistics-order`,
      IsCollection: 'N'
    };

    if (!params.ReceiverName || !params.ReceiverCellPhone || !params.ReceiverStoreID) {
      return res.status(400).json({ success: false, error: 'MissingRequiredFields' });
    }
    if (!/^\d{10}$/.test(params.ReceiverCellPhone)) {
      return res.status(400).json({ success: false, error: 'InvalidReceiverPhone' });
    }

    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    const payload = new URLSearchParams(params).toString();
    const response = await fetch(ECPAY_LOGISTICS_CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });

    const rawText = await response.text();
    const parsed = parseEcpayResponse(rawText);
    const isSuccess = String(parsed.RtnCode || '').trim() === '1' || /^1\|/.test(rawText);

  return res.status(500).json({
  success: false,
  error: 'MissingEcpayLogisticsConfig',
  debug: {
    SITE_URL: process.env.SITE_URL || '',
    ECPAY_MERCHANT_ID: process.env.ECPAY_MERCHANT_ID || '',
    has_ECPAY_HASH_KEY: !!(process.env.ECPAY_LOGISTICS_HASH_KEY || process.env.ECPAY_HASH_KEY),
    has_ECPAY_HASH_IV: !!(process.env.ECPAY_LOGISTICS_HASH_IV || process.env.ECPAY_HASH_IV),
    VERCEL_ENV: process.env.VERCEL_ENV || '',
    VERCEL_URL: process.env.VERCEL_URL || '',
  }
});
