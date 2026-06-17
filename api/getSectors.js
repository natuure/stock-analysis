const { MongoClient } = require('mongodb');
const https = require('https');

const SECTORS = [
  { cd: 'G10', name: '에너지' },
  { cd: 'G15', name: '소재' },
  { cd: 'G20', name: '산업재' },
  { cd: 'G25', name: '경기소비재' },
  { cd: 'G30', name: '필수소비재' },
  { cd: 'G35', name: '건강관리' },
  { cd: 'G40', name: '금융' },
  { cd: 'G45', name: 'IT' },
  { cd: 'G50', name: '커뮤니케이션서비스' },
  { cd: 'G55', name: '유틸리티' },
];

let client = null;
async function getCol() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db().collection('wics_cache');
}

function fetchSector(dt, sec_cd) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.wiseindex.com',
      path: `/Index/GetIndexComponets?ceil_yn=0&dt=${dt}&sec_cd=${sec_cd}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://www.wiseindex.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    };
    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          resolve(data.list || []);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(12000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

function padCode(code) {
  return String(code || '').replace(/\D/g, '').padStart(6, '0');
}

// YYYYMMDD에서 영업일 기준 이전 날짜로 이동 (주말 건너뜀)
function prevTradingDay(dt) {
  const d = new Date(`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`);
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchAllSectors(dt) {
  const map = {};
  const results = await Promise.all(SECTORS.map(({ cd, name }) =>
    fetchSector(dt, cd).then(list => ({ name, list }))
  ));
  results.forEach(({ name, list }) => {
    list.forEach(item => {
      const code = padCode(item.CMP_CD);
      if (code && code !== '000000') map[code] = name;
    });
  });
  return map;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { codes = [], date } = req.body || {};
  const cacheDate = date || new Date().toISOString().slice(0, 10);
  const unique = [...new Set(codes.map(padCode))].filter(c => c !== '000000');

  let col;
  try { col = await getCol(); } catch (e) { console.error('MongoDB connect:', e.message); }

  // 캐시 확인
  let cached = {};
  if (col) {
    try {
      const doc = await col.findOne({ _id: cacheDate });
      if (doc) { const { _id, ...rest } = doc; cached = rest; }
    } catch (e) { console.error('MongoDB read:', e.message); }
  }

  // 캐시에 충분한 데이터가 있으면 바로 반환 (WICS 전체 종목 수 > 100)
  if (Object.keys(cached).length > 100) {
    const result = {};
    unique.forEach(c => { if (cached[c]) result[c] = cached[c]; });
    return res.json(result);
  }

  // WISEindex에서 전체 섹터 일괄 조회
  let wiseDt = cacheDate.replace(/-/g, '');
  let sectorMap = await fetchAllSectors(wiseDt);

  // 데이터가 없으면 (주말·휴장일) 이전 영업일로 재시도
  if (Object.keys(sectorMap).length === 0) {
    wiseDt = prevTradingDay(wiseDt);
    sectorMap = await fetchAllSectors(wiseDt);
  }

  // MongoDB 캐시 저장
  if (Object.keys(sectorMap).length > 0 && col) {
    try {
      await col.updateOne({ _id: cacheDate }, { $set: sectorMap }, { upsert: true });
    } catch (e) { console.error('MongoDB write:', e.message); }
  }

  const merged = { ...cached, ...sectorMap };
  const result = {};
  unique.forEach(c => { if (merged[c]) result[c] = merged[c]; });
  return res.json(result);
};
