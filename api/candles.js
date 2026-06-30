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

// count: 화면 표시분 + 이동평균선이 맨 왼쪽까지 끊김 없이 그려지는 데 필요한 선행 데이터 포함
// lookbackDays: FID_INPUT_DATE_1 계산용 여유 캘린더일 (주말·휴장일 감안)
const PERIOD_CONFIG = {
  D: { count: 85, lookbackDays: 135 },
  W: { count: 75, lookbackDays: 540 },
};

// dateStr(YYYY-MM-DD) 기준 캘린더일 오프셋을 적용한 YYYYMMDD 반환 (KST/UTC 변환 오차 방지를 위해 UTC 기준 순수 날짜 연산만 수행)
function ymd(dateStr, offsetDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function fetchKisCandles(token, code, dateStr, period, fromStr) {
  const { count, lookbackDays } = PERIOD_CONFIG[period];
  // fromStr(YYYY-MM-DD)이 있으면(차트분석 탭 — 추적 리스트 종목의 "리스트 포함 이후 누적" 조회)
  // 고정 lookbackDays/count 대신 그 날짜부터 전체를 1회 요청한다. KIS는 1회 호출당 최대 100개
  // 캔들만 반환하므로(DATA_PIPELINE.md 참고), 추적 기간이 100거래일을 넘으면 가장 최근 데이터만
  // 받아와 앞부분이 잘릴 수 있음 — 알려진 한계, 다회 호출 페이지네이션은 이번 범위 밖.
  const startStr = fromStr ? fromStr.replace(/-/g, '') : ymd(dateStr, -lookbackDays);
  const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_INPUT_ISCD', code);
  url.searchParams.set('FID_INPUT_DATE_1', startStr);
  url.searchParams.set('FID_INPUT_DATE_2', ymd(dateStr, 0));
  url.searchParams.set('FID_PERIOD_DIV_CODE', period);
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
    .slice(0, fromStr ? undefined : count);  // from 지정 시 그 구간 전체 반환(KIS 1회 100개 한도 내)
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { symbol, date, from } = req.query;
  if (!symbol || !date) return res.status(400).json({ error: 'symbol, date 파라미터 필요' });
  const period = PERIOD_CONFIG[req.query.period] ? req.query.period : 'D';

  const db = await getDb();

  try {
    const token = await getKisToken(db);
    const candles = await fetchKisCandles(token, symbol, date, period, from);
    if (candles.length) return res.json({ candles });
  } catch (e) {
    console.error('[KIS 캔들 조회 실패]', e.message);
  }

  // 토스 캐시는 일봉만 보관하므로 주봉 등 다른 주기는 폴백 대상이 아님
  if (period !== 'D') return res.json({ candles: [] });

  try {
    const doc = await db.collection('candles').findOne({ _id: `${symbol}_${date}` });
    return res.json({ candles: doc ? doc.candles : [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
