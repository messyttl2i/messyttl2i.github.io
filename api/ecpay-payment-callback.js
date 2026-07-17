const crypto = require('crypto');

const HASH_KEY = process.env.ECPAY_HASH_KEY || process.env.ECPAY_HASHKEY || process.env.ECPAY_LOGISTICS_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV || process.env.ECPAY_HASHIV || process.env.ECPAY_LOGISTICS_HASH_IV;

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

function parseFormBody(body) {
  const params = {};
  const raw = typeof body === 'string' ? body : (body ? body.toString() : '');
  new URLSearchParams(raw).forEach((value, key) => { params[key] = value; });
  return params;
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // 綠界以 POST + application/x-www-form-urlencoded 回打
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const params = parseFormBody(req.body);

    if (HASH_KEY && HASH_IV && !verifyCheckMacValue(params, HASH_KEY, HASH_IV)) {
      res.status(200).send('0|CheckMacValueFailed');
      return;
    }

    res.status(200).send('1|OK');
  } catch (_) {
    res.status(200).send('1|OK');
  }
};
