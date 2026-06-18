const { tossGet } = require('./_toss');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { symbol, date } = req.query;
  if (!symbol || !date) return res.status(400).json({ error: 'symbol, date 파라미터 필요' });

  try {
    const before = `${date}T16:00:00+09:00`;
    const candles = await tossGet(
      `/api/v1/candles?symbol=${encodeURIComponent(symbol)}&interval=1d&count=60&before=${encodeURIComponent(before)}`
    );
    return res.json({ candles: candles.candles });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
