// GET → tracked_stocks(차트분석.py가 채움)에서 status:'active'만 반환 + 종목이 리스트에
// 포함된 날(firstAddedDate)부터 현재까지의 코스피/코스닥 누적 변동률을 요청 시점에 계산해
// 같이 내려준다(지수 일별 종가는 stock_data.indices에 이미 매일 저장돼 있으므로 별도 FDR/KIS
// 호출 없이 MongoDB 조회만으로 계산 가능, ARCHITECTURE.md 참고).
const { MongoClient } = require('mongodb');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

function indexClose(stockDataDoc, market) {
  if (!stockDataDoc || !stockDataDoc.indices) return null;
  const key = market === 'KOSPI' ? 'kospi' : 'kosdaq';  // KOSDAQ GLOBAL도 코스닥 지수로 취급
  return stockDataDoc.indices[key] ? stockDataDoc.indices[key].close : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = await getDb();
    const stocks = await db.collection('tracked_stocks')
      .find({ status: 'active' })
      .sort({ lastEnteredDate: -1 })
      .toArray();

    if (!stocks.length) return res.json({ stocks: [] });

    const latestStockData = await db.collection('stock_data')
      .find({}, { projection: { indices: 1 } })
      .sort({ _id: -1 })
      .limit(1)
      .toArray();
    const latestDoc = latestStockData[0] || null;

    const addedDates = [...new Set(stocks.map(s => s.firstAddedDate))];
    const addedDocs = await db.collection('stock_data')
      .find({ _id: { $in: addedDates } }, { projection: { indices: 1 } })
      .toArray();
    const addedDocByDate = {};
    addedDocs.forEach(d => { addedDocByDate[d._id] = d; });

    const result = stocks.map(s => {
      const startClose = indexClose(addedDocByDate[s.firstAddedDate], s.market);
      const latestClose = indexClose(latestDoc, s.market);
      const indexCumulativeReturn =
        startClose && latestClose ? (latestClose / startClose - 1) * 100 : null;

      return {
        code: s._id,
        name: s.name,
        market: s.market,
        firstAddedDate: s.firstAddedDate,
        lastEnteredDate: s.lastEnteredDate,
        referenceClose: s.referenceClose,
        ma: s.ma || null,
        indexCumulativeReturn,
      };
    });

    return res.json({ stocks: result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
