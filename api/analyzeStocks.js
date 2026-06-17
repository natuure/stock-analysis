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

function buildPrompt(date, vol, rate, newsMap) {
  const fmt = (list) => list.slice(0, 30).map((s, i) => {
    const news = newsMap[s.name] || [];
    const newsLines = news.length
      ? news.map((n, j) => `   뉴스${j + 1}: [${n.title}] ${n.description}`).join('\n')
      : '   뉴스: 없음';
    return `${i + 1}. ${s.name} | 등락률: ${s.changeRate >= 0 ? '+' : ''}${s.changeRate}%\n${newsLines}`;
  }).join('\n\n');

  return `당신은 대한민국 주식 시장의 전문 시장 분석가(Market Analyst)입니다.
${date || '알 수 없는 날짜'}을 당일로 가정하여 아래 종목별 뉴스를 바탕으로 분석하세요.
노이즈를 제외하고 팩트 기반으로 명확하게 답변하세요.

[거래대금 상위 30위]
${fmt(vol)}

[등락률 상위 30위]
${fmt(rate)}

각 종목에 대해:
1. 오늘 급등한 핵심 사유 (실적/공시/수주/테마 등)
2. 거래대금이 폭발적으로 몰린 직접적인 트리거 (공시, 글로벌 이슈, 테마 편입 등)
뉴스가 없는 종목은 등락률과 시장 흐름으로 추정하세요.

반드시 아래 JSON 형식만 응답 (설명 텍스트 없이):
{"거래대금":[{"종목명":"...","한줄요약":"...","상승원인":"...","트리거":"...","테마섹터":"..."}],"등락률":[{"종목명":"...","한줄요약":"...","상승원인":"...","트리거":"...","테마섹터":"..."}]}`;
}

function callClaude(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => { chunks.push(c); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (parsed.error) reject(new Error(parsed.error.message));
          else if (parsed.content?.[0]?.text) resolve(parsed.content[0].text);
          else reject(new Error('응답 형식 오류'));
        } catch (e) {
          reject(new Error('JSON 파싱 오류: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Claude API 타임아웃')); });
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-')) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다.' });
  }

  const { volumeStocks = [], rateStocks = [], date } = req.body || {};

  const uniqueNames = [...new Set([...volumeStocks, ...rateStocks].map(s => s.name))];
  const newsEntries = await Promise.all(
    uniqueNames.map(name => fetchNaverNews(name).then(news => [name, news]))
  );
  const newsMap = Object.fromEntries(newsEntries);

  const prompt = buildPrompt(date, volumeStocks, rateStocks, newsMap);

  try {
    const text = await callClaude(apiKey, prompt);
    return res.json({ analysis: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
