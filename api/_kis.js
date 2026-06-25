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

module.exports = { KIS_BASE, getKisToken };
