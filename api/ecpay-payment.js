const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || process.env.ECPAY_MERCHANTID || process.env.MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_HASH_KEY || process.env.ECPAY_HASHKEY || process.env.ECPAY_LOGISTICS_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV || process.env.ECPAY_HASHIV || process.env.ECPAY_LOGISTICS_HASH_IV;
const ECPAY_PAYMENT_URL = process.env.ECPAY_PAYMENT_URL || 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

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

  const missing = [];
  if (!MERCHANT_ID) missing.push('ECPAY_MERCHANT_ID');
  if (!HASH_KEY) missing.push('ECPAY_HASH_KEY');
  if (!HASH_IV) missing.push('ECPAY_HASH_IV');
  if (missing.length) {
    res.status(500).json({ success: false, error: 'MissingEcpayPaymentConfig', missing });
    return;
  }

  try {
    const body = parseBody(req.body);
    const merchantTradeNo = normalizeTradeNo(body.MerchantTradeNo);
    const totalAmount = Math.max(1, parseInt(body.TotalAmount, 10) || 1);
    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: getMerchantTradeDate(body.MerchantTradeDate),
      PaymentType: 'aio',
      TotalAmount: String(totalAmount),
      TradeDesc: String(body.TradeDesc || '商品訂單').slice(0, 200),
      ItemName: buildItemName(body.Items),
      ReturnURL: String(body.ReturnURL || ''),
      ChoosePayment: 'ALL',
      EncryptType: '1',
      NeedExtraPaidInfo: 'N',
      OrderResultURL: String(body.OrderResultURL || ''),
      ClientBackURL: String(body.OrderResultURL || '')
    };

    if (!params.ReturnURL || !params.OrderResultURL) {
      res.status(400).json({ success: false, error: 'MissingReturnUrls' });
      return;
    }

    if (body.AllPayLogisticsID) {
      params.LogisticsType = 'CVS';
      params.LogisticsSubType = 'UNIMARTC2C';
      params.IsCollection = 'N';
      params.AllPayLogisticsID = String(body.AllPayLogisticsID);
    }

    params.CheckMacValue = buildCheckMacValue(params, HASH_KEY, HASH_IV);

    res.status(200).json({
      success: true,
      paymentUrl: ECPAY_PAYMENT_URL,
      formData: params,
      MerchantTradeNo: merchantTradeNo
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'CreatePaymentFailed', message: error.message });
  }
};
