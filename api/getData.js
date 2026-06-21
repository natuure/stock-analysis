const { MongoClient } = require('mongodb');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db  = await getDb();
    const col = db.collection('stock_data');
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

    // 주차별 코스피/코스닥 변동률 (python 주간분석.py가 채움, 달력 토요일 칸 표시용)
    // _id가 "2026-W9" 같은 문자열이라 사전식 정렬은 시간순이 아니므로 sort/limit 없이 전체를 가져온다
    // (주간분석.py의 LOOKBACK_DAYS=540으로 한 번에 ~76건만 쌓이므로 전체 조회로도 충분히 가볍다)
    const weeklyDocs = await db.collection('weekly_indices').find({}).toArray();
    const weeklyIndices = {};
    weeklyDocs.forEach(d => { weeklyIndices[d._id] = { kospi: d.kospi, kosdaq: d.kosdaq }; });

    return res.json({ dates: docs.map(d => d._id), weeklyIndices });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
