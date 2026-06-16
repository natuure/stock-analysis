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
      path: `/item/main.naver?code=${code}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Accept-Encoding': 'identity',
      },
    };
    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const html = iconv.decode(Buffer.concat(chunks), 'EUC-KR');
          resolve(extractWics(html));
        } catch { resolve('파싱 오류'); }
      });
    });
    req.on('error', () => resolve('연결 오류'));
    req.setTimeout(REQ_TIMEOUT_MS, () => { req.destroy(); resolve('타임아웃'); });
    req.end();
  });
}

function extractWics(html) {
  const idx = html.indexOf('WICS</th>');
  if (idx === -1) return 'ETF/ETN';
  const area = html.slice(idx, idx + 600);
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
