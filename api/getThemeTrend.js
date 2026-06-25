const { MongoClient } = require('mongodb');

let client = null;
async function getCol() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db().collection('ai_analysis');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const days = Math.min(parseInt(req.query.days) || 14, 90);

  try {
    const col = await getCol();
    const docs = await col
      .find({ analysis: { $exists: true } }, { projection: { _id: 1, 'analysis.테마': 1 } })
      .sort({ _id: -1 })
      .limit(days)
      .toArray();

    return res.json({
      days: docs.map(d => ({ date: d._id, 테마: d.analysis?.테마 || [] })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
