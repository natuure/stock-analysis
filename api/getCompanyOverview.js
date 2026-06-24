const { MongoClient } = require('mongodb');

let client = null;
async function getCol() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db().collection('company_analysis');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const col = await getCol();
    const { code } = req.query;

    if (code) {
      // 종목코드로 단건 조회 (검색 결과 선택 시)
      const doc = await col.findOne({ _id: code });
      return res.json({ data: doc || null });
    }

    // 분석된 전체 종목 목록 반환 (검색 자동완성용)
    const docs = await col
      .find({}, { projection: { _id: 1, name: 1 } })
      .toArray();
    return res.json({ list: docs.map(d => ({ name: d.name, stock_code: d._id })) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
