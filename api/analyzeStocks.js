const https = require('https');

const SPAM_KEYWORDS = ['무료 리딩방', '카톡방', '클릭 시 이동', '급등주 추천', 'vip 회원', '선착순 모집'];

function stripHtml(str) {
  return String(str || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
}

function fetchNaverNews(stockName, targetDate, rangedays) {
  return new Promise((resolve) => {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return resolve([]);

    const query = encodeURIComponent(`"${stockName} 특징주" -리딩방 -카톡방 -추천`);
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

          // 날짜 범위 필터링
          if (targetDate) {
            const targetStart = new Date(targetDate + 'T00:00:00+09:00');
            const targetEnd = new Date(targetStart);
            targetEnd.setDate(targetEnd.getDate() + (rangedays > 0 ? rangedays + 1 : 1));
            items = items.filter(item => {
              const d = new Date(item.pubDate);
              return d >= targetStart && d < targetEnd;
            });
          }

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

  // 분석 날짜 기준으로 뉴스 검색 범위 결정
  const today = new Date();
  const target = date ? new Date(date + 'T00:00:00+09:00') : today;
  const diffDays = Math.floor((today - target) / 86400000);
  const rangedays = diffDays >= 3 ? 3 : 0;

  // 중복 제거 후 종목별 뉴스 병렬 조회
  const uniqueNames = [...new Set([...volumeStocks, ...rateStocks].map(s => s.name))];
  const newsEntries = await Promise.all(
    uniqueNames.map(name => fetchNaverNews(name, date, rangedays).then(news => [name, news]))
  );
  const newsMap = Object.fromEntries(newsEntries);

  return res.json({
    거래대금: volumeStocks.map(s => ({ 종목명: s.name, changeRate: s.changeRate, news: newsMap[s.name] || [] })),
    등락률:   rateStocks.map(s =>   ({ 종목명: s.name, changeRate: s.changeRate, news: newsMap[s.name] || [] })),
  });
};
