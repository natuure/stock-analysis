const { MongoClient } = require('mongodb');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

// "종목스크리닝" 탭 전용 — 종목스크리닝.py가 주차별로 쌓는 stock_screening 컬렉션
// (_id = "YYYY-W##")을 시간순으로 전부 반환한다. 주차 수가 적고 문서당 종목 수도 100개
// 안팎이라 한 번에 내려주고, 주차 선택·추이 계산은 프론트엔드가 한다.
// _id 문자열 정렬은 "2026-W9" > "2026-W10"이 되어 시간순이 아니므로(weekly_indices와 같은
// 함정, DATA_PIPELINE.md 참고) (연도, 주차) 숫자로 파싱해 정렬한다.
function parseWeekKey(k) {
  const m = /^(\d{4})-W(\d+)$/.exec(k);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = await getDb();
    const docs = await db.collection('stock_screening').find({}).toArray();
    docs.sort((a, b) => {
      const [ay, aw] = parseWeekKey(a._id);
      const [by, bw] = parseWeekKey(b._id);
      return ay - by || aw - bw;
    });
    const weeks = docs.map(d => ({
      weekKey: d._id,
      weekStart: d.weekStart,
      asOfDate: d.asOfDate,
      total: d.total,
      categoryCounts: d.categoryCounts || [],
      stocks: d.stocks || [],
    }));
    return res.json({ weeks });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
