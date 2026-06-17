const { MongoClient } = require('mongodb');
const https = require('https');
const iconv = require('iconv-lite');

const CRAWL_DELAY_MS = 350;
const BATCH_SIZE = 5;
const REQ_TIMEOUT_MS = 12000;

let client = null;
async function getCol() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db().collection('wics_cache');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function padCode(code) { return String(code).replace(/\D/g, '').padStart(6, '0'); }

function fetchNaverPage(code) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'finance.naver.com',
      path: `/item/coinfo.naver?code=${code}&target=outside`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'identity',
        'Referer': `https://finance.naver.com/item/main.naver?code=${code}`,
        'Connection': 'keep-alive',
      },
    };
    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const html = iconv.decode(Buffer.concat(chunks), 'EUC-KR');
          resolve(extractWics(html, code));
        } catch { resolve('파싱 오류'); }
      });
    });
    req.on('error', () => resolve('연결 오류'));
    req.setTimeout(REQ_TIMEOUT_MS, () => { req.destroy(); resolve('타임아웃'); });
    req.end();
  });
}

function extractWics(html, code) {
  // ETF/ETN 판별: WICS 섹션이 없으면 ETF 페이지
  const wicsIdx = html.indexOf('WICS');
  if (wicsIdx === -1) {
    // 차단 여부 확인: 한글 콘텐츠가 없으면 차단된 것
    if (!/[가-힣]{3,}/.test(html)) {
      console.warn(`[BLOCKED] code=${code} len=${html.length}`);
      return '미분류';
    }
    return 'ETF/ETN';
  }
  const area = html.slice(wicsIdx, wicsIdx + 400);
  const aMatch = area.match(/<a[^>]*>([^<]+)<\/a>/);
  if (aMatch && /[가-힣]/.test(aMatch[1])) return aMatch[1].trim();
  const tdMatch = area.match(/<td[^>]*>\s*([가-힣][^<]{1,30}?)\s*</);
  if (tdMatch) return tdMatch[1].trim();
  return '업종 미분류';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { codes = [], date } = req.body || {};
  const cacheDate = date || new Date().toISOString().slice(0, 10);

  let cached = {};
  let col;
  try {
    col = await getCol();
    const doc = await col.findOne({ _id: cacheDate });
    if (doc) { const { _id, ...rest } = doc; cached = rest; }
  } catch (e) {
    console.error('MongoDB read:', e.message);
  }

  const unique = [...new Set(codes.map(padCode))].filter(c => c !== '000000');
  const missing = unique.filter(c => !cached[c]);

  const fresh = {};
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchNaverPage));
    batch.forEach((code, j) => { fresh[code] = results[j]; });
    if (i + BATCH_SIZE < missing.length) await sleep(CRAWL_DELAY_MS);
  }

  if (Object.keys(fresh).length > 0 && col) {
    try {
      await col.updateOne({ _id: cacheDate }, { $set: fresh }, { upsert: true });
    } catch (e) {
      console.error('MongoDB write:', e.message);
    }
  }

  const all = { ...cached, ...fresh };
  const result = {};
  unique.forEach(c => { if (all[c]) result[c] = all[c]; });
  return res.json(result);
};
