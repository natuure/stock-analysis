const { MongoClient } = require('mongodb');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const CANDLE_COUNT = 85; // 화면 60개 표시 + 20일선이 맨 왼쪽까지 끊김 없이 그려지는 데 필요한 선행 19일치

async function getKisToken(db) {
  const tokenCol = db.collection('kis_token');
  const cached = await tokenCol.findOne({ _id: 'token' });
  const now = Date.now();
  if (cached && cached.expiresAt > now + 5 * 60 * 1000) {
    return cached.accessToken;
  }
  const r = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`kis token ${r.status}: ${JSON.stringify(data)}`);
  const expiresAt = now + data.expires_in * 1000;
  await tokenCol.updateOne(
    { _id: 'token' },
    { $set: { accessToken: data.access_token, expiresAt } },
    { upsert: true }
  );
  return data.access_token;
}

// dateStr(YYYY-MM-DD) 기준 캘린더일 오프셋을 적용한 YYYYMMDD 반환 (KST/UTC 변환 오차 방지를 위해 UTC 기준 순수 날짜 연산만 수행)
function ymd(dateStr, offsetDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function fetchKisCandles(token, code, dateStr) {
  const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_INPUT_ISCD', code);
  url.searchParams.set('FID_INPUT_DATE_1', ymd(dateStr, -135)); // 85거래일 확보용 여유 캘린더일
  url.searchParams.set('FID_INPUT_DATE_2', ymd(dateStr, 0));
  url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');
  url.searchParams.set('FID_ORG_ADJ_PRC', '0');

  const r = await fetch(url, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: 'FHKST03010100',
      custtype: 'P',
    },
  });
  const data = await r.json();
  if (!r.ok || data.rt_cd !== '0') throw new Error(`kis candle ${r.status}: ${JSON.stringify(data)}`);

  return (data.output2 || [])
    .filter(row => row.stck_bsop_date)
    .map(row => ({
      timestamp: row.stck_bsop_date,
      openPrice: row.stck_oprc,
      highPrice: row.stck_hgpr,
      lowPrice: row.stck_lwpr,
      closePrice: row.stck_clpr,
      volume: row.acml_vol,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, CANDLE_COUNT);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { symbol, date } = req.query;
  if (!symbol || !date) return res.status(400).json({ error: 'symbol, date 파라미터 필요' });

  const db = await getDb();

  try {
    const token = await getKisToken(db);
    const candles = await fetchKisCandles(token, symbol, date);
    if (candles.length) return res.json({ candles });
  } catch (e) {
    console.error('[KIS 캔들 조회 실패 — 토스 캐시로 폴백]', e.message);
  }

  try {
    const doc = await db.collection('candles').findOne({ _id: `${symbol}_${date}` });
    return res.json({ candles: doc ? doc.candles : [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
