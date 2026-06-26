// KIS(한국투자증권) Open API 접근토큰 발급·캐싱 — candles.js/getCompanyOverview.js 공용.
// 파일명에 _ 접두사를 붙여 Vercel이 라우트(엔드포인트)로 인식하지 않게 함(api/_toss.js와 같은 관례).
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

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

// 종목분석.py가 MongoDB에 저장하는 quote는 그 스크립트를 실행한 날의 가격으로 고정돼버려서
// (사용자 제보, 2026-06-25) 검색 시점에 KIS로 직접 현재가를 받아와 항상 "오늘 가격" 기준
// PER/PBR이 나오게 함 — candles.js와 같은 패턴(실시간 우선, 실패 시에만 저장값 폴백).
// getCompanyOverview.js·analyzeCompany.js 공용(2026-06-27, 후자 추가로 이동).
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

module.exports = { KIS_BASE, getKisToken, fetchLiveQuote };
