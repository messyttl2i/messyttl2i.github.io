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

function getMerchantTradeDate(dateInput) {
  if (dateInput && /^\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2}$/.test(dateInput)) return dateInput;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function normalizeTradeNo(input) {
  const cleaned = String(input || '').replace(/[^0-9A-Za-z]/g, '');
  if (cleaned.length >= 8) return cleaned.slice(0, 20);
  return `LG${Date.now()}`.slice(0, 20);
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

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }
  if (!HASH_KEY || !HASH_IV) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'MissingEcpayLogisticsSecrets' })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
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
      SenderName: 'MessyTTL2i',
      SenderCellPhone: '0900000000',
      ReceiverName: String(body.ReceiverName || '').slice(0, 10),
      ReceiverCellPhone: receiverPhone,
      ReceiverStoreID: String(body.CVSStoreID || ''),
      ServerReplyURL: `${NETLIFY_SITE_URL}/.netlify/functions/ecpay-create-logistics-order`,
      IsCollection: 'N'
    };

    if (!params.ReceiverName || !params.ReceiverCellPhone || !params.ReceiverStoreID) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'MissingRequiredFields' })
      };
    }

    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);
    const payload = new URLSearchParams(params).toString();
    const response = await fetch('https://logistics.ecpay.com.tw/Express/Create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });
    const rawText = await response.text();
    const parsed = parseEcpayResponse(rawText);
    const isSuccess = String(parsed.RtnCode || '').trim() === '1' || /^1\|/.test(rawText);
    return {
      statusCode: isSuccess ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: isSuccess,
        MerchantTradeNo: merchantTradeNo,
        AllPayLogisticsID: parsed.AllPayLogisticsID || '',
        raw: rawText,
        ...parsed
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'CreateLogisticsFailed', message: error.message })
    };
  }
};
