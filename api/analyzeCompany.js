// 미분석 종목을 검색 시점에 즉석으로 분석하는 엔드포인트 — 종목분석.py main()의 1:1 포팅
// (2026-06-27, 사용자 요청 "종목 누르면 실시간으로 분석"). DART+KIS API 호출과 산술 계산
// 뿐이라 Claude/LLM은 전혀 개입하지 않음. GET /api/analyzeCompany?name=종목명
const { MongoClient } = require('mongodb');
const { fetchLiveQuote } = require('./_kis');
const {
  loadCorpCodeMap, findCorpCode, findLatestReport, buildFetchPlan,
  fetchAnnualFinancials, fetchQuarters,
} = require('./_dart');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'bad_request', message: 'name 파라미터가 필요합니다.' });
  if (!process.env.DART_API_KEY) {
    return res.status(500).json({ error: 'config_error', message: 'DART_API_KEY가 서버에 설정되지 않았습니다.' });
  }

  try {
    const db = await getDb();
    const corpMap = await loadCorpCodeMap(db);
    const corp = findCorpCode(name, corpMap);
    if (!corp) {
      return res.json({ error: 'not_found', message: `DART 상장사 목록에서 '${name}'을 찾지 못했습니다.` });
    }

    const today = new Date();
    const latest = await findLatestReport(corp.corp_code, today);
    if (latest.year === null) {
      return res.json({ error: 'no_report', message: '최근 3년 내 제출된 사업보고서/분기보고서를 찾지 못했습니다.' });
    }

    // 이미 이 보고서까지 분석돼 있으면(주도주분석.py 일괄 실행 등으로) DART 재무제표를 다시
    // 받지 않고 저장된 데이터를 그대로 쓴다 — 현재가만 새로 받아 덮어씀. 검색 즉시 결과가
    // 보이길 기대하는데 클라이언트의 분석 종목 목록이 새로고침 전이라 이 즉석분석 경로를
    // 타게 되는 경우에도, 여기서 다시 한 번 "이미 최신인지" 확인해 불필요한 재분석을 막는다
    // (2026-06-28, 사용자 제보 — 사전에 주도주분석.py를 돌려놔도 검색이 즉시 안 보였음).
    const existing = await db.collection('company_analysis').findOne({ _id: corp.stock_code });
    const upToDate = existing && existing.latest_report
      && existing.latest_report.year === latest.year
      && existing.latest_report.reprt_code === latest.reprtCode;

    if (upToDate) {
      let quote = existing.quote;
      try {
        quote = await fetchLiveQuote(db, corp.stock_code);
      } catch (e) {
        console.error('[analyzeCompany] KIS 현재가 조회 실패, 저장된 quote로 폴백:', e.message);
      }
      return res.json({ data: { ...existing, quote } });
    }

    const plan = buildFetchPlan(latest.year, latest.reprtCode);
    const annual = await fetchAnnualFinancials(corp.corp_code, plan.annualYears);
    const quarters = plan.quarterSpecs.length ? await fetchQuarters(corp.corp_code, plan.quarterSpecs) : [];

    let quote = null;
    try {
      quote = await fetchLiveQuote(db, corp.stock_code);
    } catch (e) {
      console.error('[analyzeCompany] KIS 현재가 조회 실패, quote 없이 진행:', e.message);
    }

    const result = {
      name: corp.name,
      date: today.toISOString().slice(0, 10),
      corp_code: corp.corp_code,
      stock_code: corp.stock_code,
      latest_report: { year: latest.year, reprt_code: latest.reprtCode, label: latest.label },
      quote,
      annual_financials: annual,
      quarterly_financials: quarters,
    };

    await db.collection('company_analysis').updateOne(
      { _id: corp.stock_code }, { $set: result }, { upsert: true }
    );

    return res.json({ data: result });
  } catch (e) {
    console.error('[analyzeCompany] 실패:', e);
    return res.status(500).json({ error: 'fetch_failed', message: e.message });
  }
};
