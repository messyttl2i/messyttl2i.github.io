// api/ecpay-payment.js
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  return res.status(501).json({
    success: false,
    error: 'EcpayPaymentNotImplemented',
    message: 'ecpay-payment 尚未完成，請先完成物流選店與建物流單。'
  });
};
