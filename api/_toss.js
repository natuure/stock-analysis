const TOSS_BASE = 'https://openapi.tossinvest.com';

let cached = { token: null, expiresAt: 0 };

async function getTossToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }
  if (!process.env.TOSS_CLIENT_ID || !process.env.TOSS_CLIENT_SECRET) {
    throw new Error('TOSS_CLIENT_ID 또는 TOSS_CLIENT_SECRET 환경변수가 설정되지 않음');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.TOSS_CLIENT_ID,
    client_secret: process.env.TOSS_CLIENT_SECRET,
  });
  const r = await fetch(`${TOSS_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`토스 토큰 발급 실패: ${r.status} ${await r.text()}`);
  const data = await r.json();
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function tossGet(path) {
  const token = await getTossToken();
  const r = await fetch(`${TOSS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`토스 API 호출 실패: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return data.result;
}

module.exports = { getTossToken, tossGet };
