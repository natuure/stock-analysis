const { MongoClient } = require('mongodb');
const { KIS_BASE, getKisToken } = require('./_kis');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

// 종목분석.py가 MongoDB에 저장하는 quote는 그 스크립트를 실행한 날의 가격으로 고정돼버려서
// (사용자 제보, 2026-06-25) 검색 시점에 KIS로 직접 현재가를 받아와 항상 "오늘 가격" 기준
// PER/PBR이 나오게 함 — api/candles.js와 같은 패턴(실시간 우선, 실패 시에만 저장값 폴백).
async function fetchLiveQuote(db, stockCode) {
  const token = await getKisToken(db);
  const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'UN');
  url.searchParams.set('FID_INPUT_ISCD', stockCode);

  const r = await fetch(url, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: 'FHKST01010100',
      custtype: 'P',
    },
  });
  const data = await r.json();
  if (!r.ok || data.rt_cd !== '0') throw new Error(`kis quote ${r.status}: ${JSON.stringify(data)}`);

  const price = Number(data.output.stck_prpr);
  const sharesOutstanding = Number(data.output.lstn_stcn);
  return { price, marketCap_억원: (price * sharesOutstanding) / 100_000_000, sharesOutstanding };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = await getDb();
    const col = db.collection('company_analysis');
    const { code } = req.query;

    if (code) {
      // 종목코드로 단건 조회 (검색 결과 선택 시)
      const doc = await col.findOne({ _id: code });
      if (!doc) return res.json({ data: null });
      try {
        doc.quote = await fetchLiveQuote(db, code);
      } catch (e) {
        console.error('[KIS 현재가 조회 실패, 저장된 quote로 폴백]', e.message);
      }
      return res.json({ data: doc });
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
