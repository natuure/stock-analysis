const https = require('https');

function buildPrompt(date, vol, rate) {
  const fmt = list => list.slice(0, 30).map((s, i) =>
    `${i + 1}. ${s.name} | 등락률: ${s.changeRate >= 0 ? '+' : ''}${s.changeRate}%`
  ).join('\n');

  return `오늘은 ${date || '알 수 없는 날짜'}입니다. 아래는 한국 주식시장 오늘 데이터입니다.

[거래대금 상위 30위]
${fmt(vol)}

[등락률 상위 30위]
${fmt(rate)}

각 종목이 오늘 급등하거나 거래가 집중된 이유를 다음 관점에서 분석하세요.
- 실적/공시 이슈
- 수주·계약·파트너십 뉴스
- 정책·규제 수혜
- 업종 동반 상승 (대장주 연동)
- AI·반도체·배터리·방산·로봇 등 테마 모멘텀

종목당 1~2줄로 간결하게 작성하세요.

반드시 아래 JSON 형식만 응답 (설명 텍스트 없이):
{"거래대금":[{"종목명":"...","이유":"..."}],"등락률":[{"종목명":"...","이유":"..."}]}`;
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
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-')) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다.' });
  }

  const { volumeStocks = [], rateStocks = [], date } = req.body || {};
  const prompt = buildPrompt(date, volumeStocks, rateStocks);

  try {
    const text = await callClaude(apiKey, prompt);
    return res.json({ analysis: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
