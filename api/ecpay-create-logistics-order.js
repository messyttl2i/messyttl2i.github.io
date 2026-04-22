const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_LOGISTICS_HASH_KEY || process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_LOGISTICS_HASH_IV || process.env.ECPAY_HASH_IV;
const SENDER_NAME = process.env.ECPAY_SENDER_NAME || 'MessyTTL2i';
const SENDER_PHONE = String(process.env.ECPAY_SENDER_PHONE || '').replace(/[^\d]/g, '');
const ECPAY_LOGISTICS_CREATE_URL = process.env.ECPAY_LOGISTICS_CREATE_URL || 'https://logistics.ecpay.com.tw/Express/Create';

function getSiteUrl() {
  const manual = (process.env.SITE_URL || process.env.NETLIFY_SITE_URL || '').trim();
  if (manual) return manual.replace(/\/$/, '');
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (prod) return `https://${prod}`.replace(/\/$/, '');
  const vercelUrl = (process.env.VERCEL_URL || '').trim();
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/$/, '');
  return '';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

function getMerchantTradeDate(dateInput) {
  if (dateInput && /^\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2}$/.test(dateInput)) return dateInput;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
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
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const siteUrl = getSiteUrl();
  const missing = [];
  if (!MERCHANT_ID) missing.push('ECPAY_MERCHANT_ID');
  if (!HASH_KEY) missing.push('ECPAY_LOGISTICS_HASH_KEY / ECPAY_HASH_KEY');
  if (!HASH_IV) missing.push('ECPAY_LOGISTICS_HASH_IV / ECPAY_HASH_IV');
  if (!siteUrl) missing.push('SITE_URL (or VERCEL_PROJECT_PRODUCTION_URL)');
  if (!/^\d{10}$/.test(SENDER_PHONE)) missing.push('ECPAY_SENDER_PHONE (must be 10 digits)');
  if (missing.length) {
    res.status(500).json({ success: false, error: 'MissingEcpayLogisticsConfig', missing });
    return;
  }

  try {
    const body = parseBody(req.body);
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
      ServerReplyURL: `${siteUrl}/api/ecpay-create-logistics-order`,
      IsCollection: 'N'
    };

    if (!params.ReceiverName || !params.ReceiverCellPhone || !params.ReceiverStoreID) {
      res.status(400).json({ success: false, error: 'MissingRequiredFields' });
      return;
    }
    if (!/^\d{10}$/.test(params.ReceiverCellPhone)) {
      res.status(400).json({ success: false, error: 'InvalidReceiverPhone' });
      return;
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

    res.status(isSuccess ? 200 : 400).json({
      success: isSuccess,
      MerchantTradeNo: merchantTradeNo,
      AllPayLogisticsID: parsed.AllPayLogisticsID || '',
      raw: rawText,
      ...parsed
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'CreateLogisticsFailed', message: error.message });
  }
};
