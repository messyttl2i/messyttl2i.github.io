const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_HASH_KEY || process.env.ECPAY_LOGISTICS_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV || process.env.ECPAY_LOGISTICS_HASH_IV;
const NETLIFY_SITE_URL = (process.env.SITE_URL || process.env.NETLIFY_SITE_URL || '').replace(/\/$/, '');
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

function normalizeTradeNo(input) {
  const cleaned = String(input || '').replace(/[^0-9A-Za-z]/g, '');
  if (cleaned.length >= 8) return cleaned.slice(0, 20);
  return `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

function getMerchantTradeDate(dateInput) {
  if (dateInput && /^\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2}$/.test(dateInput)) return dateInput;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function buildItemName(items) {
  if (!Array.isArray(items) || !items.length) return 'MessyTT&L2i 商品';
  const merged = items
    .map((item) => `${String(item.name || '商品').replace(/[#\\|]/g, ' ')} x ${Math.max(1, parseInt(item.qty, 10) || 1)}`)
    .join('#');
  return merged.slice(0, 200) || 'MessyTT&L2i 商品';
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

  const missing = [];
  if (!MERCHANT_ID) missing.push('ECPAY_MERCHANT_ID');
  if (!HASH_KEY) missing.push('ECPAY_HASH_KEY');
  if (!HASH_IV) missing.push('ECPAY_HASH_IV');
  if (!NETLIFY_SITE_URL) missing.push('SITE_URL / NETLIFY_SITE_URL');
  if (missing.length) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'MissingEcpayPaymentConfig', missing })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const totalAmount = Math.max(1, parseInt(body.TotalAmount, 10) || 1);
    const orderResultURL = String(body.OrderResultURL || '');
    if (!orderResultURL) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'MissingReturnUrls' })
      };
    }

    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: getMerchantTradeDate(body.MerchantTradeDate),
      PaymentType: 'aio',
      TotalAmount: String(totalAmount),
      TradeDesc: String(body.TradeDesc || '商品訂單').slice(0, 200),
      ItemName: buildItemName(body.Items),
      ReturnURL: `${NETLIFY_SITE_URL}/.netlify/functions/ecpay-payment-callback`,
      ChoosePayment: 'ALL',
      EncryptType: '1',
      NeedExtraPaidInfo: 'N',
      OrderResultURL: orderResultURL,
      ClientBackURL: orderResultURL
    };

    if (body.AllPayLogisticsID) {
      params.LogisticsType = 'CVS';
      params.LogisticsSubType = 'UNIMARTC2C';
      params.IsCollection = 'N';
      params.AllPayLogisticsID = String(body.AllPayLogisticsID);
    }

    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        paymentUrl: ECPAY_PAYMENT_URL,
        formData: params,
        MerchantTradeNo: merchantTradeNo
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
