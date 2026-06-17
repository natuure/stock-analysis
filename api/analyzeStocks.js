const https = require('https');

const SPAM_KEYWORDS = ['무료 리딩방', '카톡방', '클릭 시 이동', '급등주 추천', 'vip 회원', '선착순 모집'];

function stripHtml(str) {
  return String(str || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
}

function fetchNaverNews(stockName) {
  return new Promise((resolve) => {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return resolve([]);

    const query = encodeURIComponent(`${stockName} 특징주 -리딩방 -카톡방 -추천`);
    const options = {
      hostname: 'openapi.naver.com',
      path: `/v1/search/news.json?query=${query}&display=10&sort=date&start=1`,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    };

    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          let items = data.items || [];

          // 스팸 필터링
          items = items.filter(item => {
            const text = (item.title + item.description).toLowerCase();
            return !SPAM_KEYWORDS.some(kw => text.includes(kw));
          });

          resolve(items.slice(0, 5).map(item => ({
            title: stripHtml(item.title),
            description: stripHtml(item.description),
          })));
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(6000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { volumeStocks = [], rateStocks = [], date } = req.body || {};

  // 중복 제거 후 종목별 뉴스 병렬 조회
  const uniqueNames = [...new Set([...volumeStocks, ...rateStocks].map(s => s.name))];
  const newsEntries = await Promise.all(
    uniqueNames.map(name => fetchNaverNews(name).then(news => [name, news]))
  );
  const newsMap = Object.fromEntries(newsEntries);

  return res.json({
    거래대금: volumeStocks.map(s => ({ 종목명: s.name, changeRate: s.changeRate, news: newsMap[s.name] || [] })),
    등락률:   rateStocks.map(s =>   ({ 종목명: s.name, changeRate: s.changeRate, news: newsMap[s.name] || [] })),
  });
};
