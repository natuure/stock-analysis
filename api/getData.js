const { MongoClient } = require('mongodb');

let client = null;
async function getCol() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db().collection('stock_data');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const col = await getCol();
    const { date } = req.query;

    if (date) {
      // 특정 날짜 데이터 반환
      const doc = await col.findOne({ _id: date });
      if (!doc) return res.json({ vol: null });
      const { _id, ...rest } = doc;
      return res.json(rest);
    }

    // 날짜 목록 반환 (최신순, 최대 90개)
    const docs = await col
      .find({}, { projection: { _id: 1 } })
      .sort({ _id: -1 })
      .limit(90)
      .toArray();
    return res.json({ dates: docs.map(d => d._id) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
