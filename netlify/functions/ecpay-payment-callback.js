const crypto = require('crypto');

const HASH_KEY = process.env.ECPAY_HASH_KEY || process.env.ECPAY_LOGISTICS_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV || process.env.ECPAY_LOGISTICS_HASH_IV;

function ecpayEncode(value) {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2a')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function verifyCheckMacValue(params, hashKey, hashIv) {
  const received = params.CheckMacValue;
  if (!received) return false;
  const rest = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${params[k] ?? ''}`)
    .join('&');
  const raw = `HashKey=${hashKey}&${rest}&HashIV=${hashIv}`;
  const encoded = ecpayEncode(raw).toLowerCase();
  const expected = crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
  return expected === String(received).toUpperCase();
}

exports.handler = async (event) => {
  // 綠界以 POST + application/x-www-form-urlencoded 回打
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method Not Allowed' };
  }

  try {
    const params = {};
    const raw = event.body || '';
    new URLSearchParams(raw).forEach((value, key) => { params[key] = value; });

    if (HASH_KEY && HASH_IV && !verifyCheckMacValue(params, HASH_KEY, HASH_IV)) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: '0|CheckMacValueFailed' };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: '1|OK' };
  } catch (_) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: '1|OK' };
  }
};
