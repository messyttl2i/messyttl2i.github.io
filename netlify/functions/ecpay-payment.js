const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_PAYMENT_HASH_KEY || process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_PAYMENT_HASH_IV || process.env.ECPAY_HASH_IV;
const NETLIFY_SITE_URL = (process.env.NETLIFY_SITE_URL || '').replace(/\/$/, '');
const ECPAY_PAYMENT_URL = process.env.ECPAY_PAYMENT_URL || 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

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
  return `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

function buildItemName(items) {
  if (Array.isArray(items) && items.length) {
    return items
      .map((item) => `${item.name || '商品'}x${item.qty || 1}`)
      .join('#')
      .slice(0, 200);
  }
  return 'MessyTT&L2i 商品';
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
  if (!MERCHANT_ID || !HASH_KEY || !HASH_IV || !NETLIFY_SITE_URL) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'MissingEcpayPaymentConfig' })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const amount = Math.max(1, parseInt(body.TotalAmount, 10) || 1);
    const returnURL = body.ReturnURL || `${NETLIFY_SITE_URL}/.netlify/functions/ecpay-payment`;
    const orderResultURL = body.OrderResultURL || `${NETLIFY_SITE_URL}/?payment=success&order=${merchantTradeNo}`;
    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: getMerchantTradeDate(body.MerchantTradeDate),
      PaymentType: 'aio',
      TotalAmount: String(amount),
      TradeDesc: String(body.TradeDesc || '商品訂單').slice(0, 200),
      ItemName: buildItemName(body.Items),
      ReturnURL: returnURL,
      OrderResultURL: orderResultURL,
      ClientBackURL: orderResultURL,
      ChoosePayment: 'ALL',
      EncryptType: '1'
    };

    if (body.AllPayLogisticsID) params.CustomField1 = String(body.AllPayLogisticsID).slice(0, 50);
    if (body.CVSStoreID) params.CustomField2 = String(body.CVSStoreID).slice(0, 50);

    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        paymentUrl: ECPAY_PAYMENT_URL,
        formData: params
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'CreatePaymentFailed', message: error.message })
    };
  }
};
