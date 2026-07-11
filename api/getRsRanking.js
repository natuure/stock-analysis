const { MongoClient } = require('mongodb');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

// "RS랭킹" 탭 전용 — rs랭킹.py가 채우는 rs_ranking 컬렉션의 단일 문서(_id='latest')를
// 그대로 반환한다. 날짜/주차 파라미터가 없는 이유: 이 탭은 달력처럼 과거를 선택해 보는
// 화면이 아니라 "지금 기준 RS 랭킹"만 보여주면 되도록 설계됨(DATA_PIPELINE.md
// "rs랭킹.py" 절 참고) — weekly_indices처럼 날짜별 문서를 쌓지 않는다.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = await getDb();
    const doc = await db.collection('rs_ranking').findOne({ _id: 'latest' });
    if (!doc) return res.json({ rsRank: null, asOfDate: null, weekKey: null });
    return res.json({ rsRank: doc.rsRank, asOfDate: doc.asOfDate, weekKey: doc.weekKey });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
