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
    // "거래대금 카테고리 TOP5 추이" 표용 — 예전엔 analysis.테마(요약 태그)를 줬으나
    // 2026-06-28부터 그날 거래대금 상위 50 종목별 카테고리를 직접 집계하는 방식으로
    // 바뀌어 analysis.거래대금을 내려준다(FRONTEND.md 참고).
    const docs = await col
      .find({ analysis: { $exists: true } }, { projection: { _id: 1, 'analysis.거래대금': 1 } })
      .sort({ _id: -1 })
      .limit(days)
      .toArray();

    return res.json({
      days: docs.map(d => ({ date: d._id, 거래대금: d.analysis?.거래대금 || [] })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
