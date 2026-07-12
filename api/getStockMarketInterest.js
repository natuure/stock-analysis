const { MongoClient } = require('mongodb');

let client = null;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db();
}

// weekly_indices/rs_ranking의 _id("YYYY-W##")는 문자열이라 사전식 정렬이 시간순이 아님
// (예: "2026-W9" > "2026-W25") — 주간분석.py의 get_previous_week_vol_ranks()와 동일한
// 이유로 (year, isoWeek) 튜플로 직접 비교해 정렬한다.
function parseWeekKey(k) {
  const [y, w] = k.split('-W');
  return [parseInt(y, 10), parseInt(w, 10)];
}

// "종목 분석" 탭 "시장관심도" 전용 — 종목 하나에 대해 세 가지를 한 번에 계산해 반환한다:
//   1) 최근 10주 RS Score 추이(rs_ranking 컬렉션의 주차별 히스토리 문서, rs랭킹.py 참고)
//   2) 최근 15거래일 중 그 종목이 등락률 상위 50에 든 날짜/횟수(stock_data.rate)
//   3) 그 종목의 카테고리(ai_analysis 전체 이력 1순위 + rs_category_cache 2순위,
//      rs랭킹.py의 fetch_global_category_map()/fetch_category_cache_map()과 동일한 우선순위를
//      JS로 재현 — 다만 카테고리 목록 유효성(VALID_CATEGORIES) 재검증은 하지 않음, 읽기
//      전용 표시라 저장분석.py가 목록을 바꿔도 즉시 갱신할 필요가 없기 때문)
//   4) 그 카테고리가 최근 15거래일의 "등락률 상위 TOP5 카테고리"에 든 날짜/횟수 —
//      Analysis.jsx의 aggregateByCategory()(이름 매칭 → 카테고리별 카운트 → 내림차순 정렬,
//      동률은 이름 오름차순, '기타' 제외 후 상위 5개)와 동일한 로직을 서버에서 재현한다.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { code, name } = req.query;
  if (!code || !name) return res.status(400).json({ error: 'code, name 파라미터가 모두 필요합니다.' });

  try {
    const db = await getDb();

    // 1) RS Score 최근 10주 추이 — 'latest'(그 주 백분위 90 이상만 담은 별도 스냅샷,
    //    shape이 다름)는 제외하고 주차별 히스토리 문서(_id=weekKey)만 대상으로 한다.
    const rsDocs = await db.collection('rs_ranking').aggregate([
      { $match: { _id: { $ne: 'latest' } } },
      { $project: {
          weekKey: 1, asOfDate: 1,
          entry: { $arrayElemAt: [
            { $filter: { input: '$scores', as: 's', cond: { $eq: ['$$s.code', code] } } }, 0,
          ] },
        } },
    ]).toArray();
    rsDocs.sort((a, b) => {
      const [ay, aw] = parseWeekKey(a.weekKey), [by, bw] = parseWeekKey(b.weekKey);
      return ay !== by ? ay - by : aw - bw;
    });
    const rsHistory = rsDocs.slice(-10).map(d => ({
      weekKey: d.weekKey,
      asOfDate: d.asOfDate,
      rsScore: d.entry ? d.entry.rsScore : null, // 그 주 계산 대상에서 빠졌으면(신규상장 등) null
    }));

    // 2) 최근 15거래일(stock_data 최신 15개 문서 = 실제 데이터가 있는 거래일만) 중
    //    등락률 상위 50에 이 종목이 들었던 날짜
    const recentDays = await db.collection('stock_data')
      .find({}, { projection: { _id: 1, rate: 1 } })
      .sort({ _id: -1 })
      .limit(15)
      .toArray();
    recentDays.reverse(); // 과거 → 최근 순으로 정리

    const rateTop50Dates = recentDays
      .filter(d => (d.rate || []).some(s => s.code === code))
      .map(d => d._id);

    // 3) 카테고리 — ai_analysis 전체 이력을 날짜 오름차순으로 훑어 종목명이 일치하는 마지막
    //    카테고리(=가장 최근 분류)를 채택(1순위). 못 찾으면 rs_category_cache(2순위)로 폴백.
    const aiDocs = await db.collection('ai_analysis')
      .find({}, { projection: {
        'analysis.거래대금.종목명': 1, 'analysis.거래대금.카테고리': 1,
        'analysis.등락률.종목명': 1, 'analysis.등락률.카테고리': 1,
      } })
      .sort({ _id: 1 })
      .toArray();
    let category = null;
    for (const doc of aiDocs) {
      const analysis = doc.analysis || {};
      for (const key of ['거래대금', '등락률']) {
        for (const item of analysis[key] || []) {
          if (item.종목명 === name && item.카테고리) category = item.카테고리;
        }
      }
    }
    if (!category) {
      const cacheDoc = await db.collection('rs_category_cache').findOne({ _id: name });
      if (cacheDoc) category = cacheDoc.카테고리;
    }

    // 4) 그 카테고리가 최근 15거래일의 등락률 카테고리 TOP5에 든 날짜
    let categoryTop5Dates = [];
    if (category) {
      const dateIds = recentDays.map(d => d._id);
      const aiByDate = await db.collection('ai_analysis')
        .find({ _id: { $in: dateIds } }, { projection: { 'analysis.등락률.종목명': 1, 'analysis.등락률.카테고리': 1 } })
        .toArray();
      const aiMap = new Map(aiByDate.map(d => [d._id, d.analysis?.등락률 || []]));

      for (const day of recentDays) {
        const aiItems = aiMap.get(day._id) || [];
        const catByName = new Map();
        aiItems.forEach(it => { if (it.카테고리) catByName.set(it.종목명, it.카테고리); });
        if (catByName.size === 0) continue; // 그날 카테고리 데이터 자체가 없으면 집계 대상에서 제외

        const counts = {};
        (day.rate || []).forEach(s => {
          const cat = catByName.get(s.name) || '기타';
          counts[cat] = (counts[cat] || 0) + 1;
        });
        const top5 = Object.entries(counts)
          .filter(([cat]) => cat !== '기타')
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([cat]) => cat);
        if (top5.includes(category)) categoryTop5Dates.push(day._id);
      }
    }

    return res.json({
      rsHistory,
      rateTop50: { count: rateTop50Dates.length, dates: rateTop50Dates },
      category,
      categoryTop5: { count: categoryTop5Dates.length, dates: categoryTop5Dates },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
