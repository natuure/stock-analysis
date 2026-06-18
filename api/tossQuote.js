const { MongoClient } = require('mongodb');

let client = null;
async function getCol() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db().collection('candles');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { symbol, date } = req.query;
  if (!symbol || !date) return res.status(400).json({ error: 'symbol, date 파라미터 필요' });

  try {
    const col = await getCol();
    const doc = await col.findOne({ _id: `${symbol}_${date}` });
    return res.json({ candles: doc ? doc.candles : [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
