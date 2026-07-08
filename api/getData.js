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
    const { date, week } = req.query;

    if (date) {
      // 특정 날짜 데이터 반환
      const doc = await col.findOne({ _id: date });
      if (!doc) return res.json({ vol: null });
      const { _id, ...rest } = doc;
      return res.json(rest);
    }

    if (week) {
      // 특정 주차 전체 데이터 반환(거래대금/등락률 표용, 2026-06-27 추가) — ?date= 분기와
      // 동일한 패턴. 아래 weeklyIndices 프로젝션과 달리 vol/rate를 포함한 전체를 그대로
      // 내려준다 — 주차를 클릭했을 때만 호출되는 지연 조회라 무겁지 않음.
      const weekDoc = await db.collection('weekly_indices').findOne({ _id: week });
      if (!weekDoc) return res.json({ kospi: null, kosdaq: null });
      const { _id, ...rest } = weekDoc;
      return res.json(rest);
    }

    // 날짜 목록 반환 (최신순) — 원래 최대 90개로 제한했으나, 백필(backfilled:true)로
    // 2025-01-02~2026-06-14 구간이 통째로 채워지면서 실데이터 포함 총 날짜 수가 90개를
    // 훌쩍 넘어 최신 90개 안에 못 든 과거 날짜가 캘린더에서 "데이터 없음"으로 보이는
    // 문제가 생겼다(2026-07-09 확인). _id만 담은 문자열 배열이라 전체를 다 내려줘도 가볍다.
    const docs = await col
      .find({}, { projection: { _id: 1 } })
      .sort({ _id: -1 })
      .toArray();

    // 주차별 코스피/코스닥 변동률 (python 주간분석.py가 채움, 달력 주차 칸 표시용)
    // _id가 "2026-W9" 같은 문자열이라 사전식 정렬은 시간순이 아니므로 sort/limit 없이 전체를 가져온다
    // (주간분석.py의 LOOKBACK_DAYS=540으로 한 번에 ~76건만 쌓이므로 전체 조회로도 충분히 가볍다)
    // vol/rate(종목별 50개씩)는 여기서 일부러 제외 — 캘린더 진입 시 76주치를 한 번에 받는
    // 가벼운 경로이므로, 그 둘은 ?week= 분기에서 클릭한 주차만 지연 조회한다(2026-06-27).
    // lastTradingDate(그 주 마지막 실제 거래일)만 추가로 내려줘서, 주차 클릭 시 프론트가
    // ISO 주차를 다시 계산하지 않고 StockChartPanel의 dateISO로 바로 쓸 수 있게 한다.
    const weeklyDocs = await db.collection('weekly_indices').find({}).toArray();
    const weeklyIndices = {};
    weeklyDocs.forEach(d => {
      weeklyIndices[d._id] = { kospi: d.kospi, kosdaq: d.kosdaq, lastTradingDate: d.lastTradingDate };
    });

    return res.json({ dates: docs.map(d => d._id), weeklyIndices });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
