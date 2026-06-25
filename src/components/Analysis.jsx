import { useState, useMemo } from 'react';
import { TrendChart, TREND_PALETTE } from './TrendChart';
import { PieChart } from './PieChart';

const MAX_THEMES = 6;

function ThemeTable({ themes }) {
  if (!themes || themes.length === 0) return null;
  const shown = themes.slice(0, MAX_THEMES);
  return (
    <div>
      <h2 className="sec-title" style={{ marginTop: 36 }}>핫한 테마</h2>
      <div className="theme-wrap">
        <table className="theme-table">
          <thead>
            <tr>
              <th>테마</th>
              <th>핵심 재료</th>
              <th>주요 종목</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i}>
                <td><span className="theme-tag">{row.테마}</span></td>
                <td className="theme-material">{row.핵심재료}</td>
                <td>{row.주요종목}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// themeTrend(api/getThemeTrend.js 응답의 days 배열, 최신순)를 카테고리별 일별 등장 횟수로
// 집계해 TrendChart의 periods/metrics 모양으로 바꾼다. 카테고리가 없는 항목(과거 미백필분)은
// 조용히 무시 — "기타"로 임의 분류하지 않는다(데이터 왜곡 방지).
function aggregateThemeTrend(days) {
  const chrono = [...days].reverse(); // 시간순(과거→최근)으로 뒤집어서 차트 왼→오 방향에 맞춤

  const totals = {};
  chrono.forEach(d => (d.테마 || []).forEach(t => {
    if (t.카테고리) totals[t.카테고리] = (totals[t.카테고리] || 0) + 1;
  }));

  const topCategories = Object.entries(totals)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) // 동률이면 항상 같은 순서(결정적)
    .slice(0, 6)
    .map(([cat]) => cat);
  if (topCategories.length === 0) return null;

  const periods = chrono.map(d => {
    const row = { label: d.date.slice(5).replace('-', '/') }; // "2026-06-25" → "06/25"
    topCategories.forEach(cat => { row[cat] = 0; });
    (d.테마 || []).forEach(t => {
      if (t.카테고리 && row[t.카테고리] !== undefined) row[t.카테고리] += 1;
    });
    return row;
  });

  const metrics = topCategories.map((cat, i) => ({ key: cat, label: cat, color: TREND_PALETTE[i] }));
  return { periods, metrics };
}

function ThemeCategoryTrend({ themeTrend }) {
  const agg = useMemo(() => (themeTrend ? aggregateThemeTrend(themeTrend) : null), [themeTrend]);
  if (!agg) return null; // 카테고리 데이터가 아예 없으면 섹션 자체를 숨김(다른 빈 섹션과 동일 패턴)
  return (
    <TrendChart
      type="line"
      title={`최근 ${agg.periods.length}일 테마 카테고리 등장 빈도`}
      periods={agg.periods}
      metrics={agg.metrics}
    />
  );
}

// vol/rate(그날 상위 50, 숫자) + aiItems(aiAnalysis.거래대금/등락률, 종목명+카테고리)를
// 종목명으로 매칭해 카테고리별로 valueKey를 합산한다 — 거래대금(tradingVolume, 금액)과
// 등락률(changeRate, %) 양쪽에서 재사용(가중치 기준만 다름). 매칭 실패/카테고리 없음은
// "기타"로 폴백(수치는 절대 누락되지 않고 항상 기타로 흡수됨 — % 합은 항상 100).
function aggregateByCategory(items, aiItems, valueKey) {
  if (!items || items.length === 0) return null;

  const catByName = new Map();
  (aiItems || []).forEach(it => { if (it.카테고리) catByName.set(it.종목명, it.카테고리); });

  const totals = {};
  let grandTotal = 0;
  items.forEach(s => {
    const v = s[valueKey];
    // 거래대금은 항상 양수지만 등락률(changeRate)은 이론상 음수가 섞일 수 있음(상위 50인데도
    // 시장 전체에 상승 종목이 50개가 안 되는 극단적인 날) — 음수/0은 "비중"에 의미가 없으니
    // 분모(grandTotal)에서도 완전히 제외한다. 기타로 흡수하면 음수만큼 다른 슬라이스의 %가
    // 100%를 넘어버리는 버그가 생김(직접 단위 테스트로 발견, 2026-06-26).
    if (!isFinite(v) || v <= 0) return;
    const cat = catByName.get(s.name) || '기타';
    totals[cat] = (totals[cat] || 0) + v;
    grandTotal += v;
  });
  if (grandTotal <= 0) return null;

  // "5개+기타"는 분류 단계가 아니라 여기(차트 렌더 집계)에서만 적용 — 그날 실제로는
  // 6개 이상 카테고리가 나올 수 있음.
  const etcTotal = totals['기타'] || 0;
  const realCats = Object.entries(totals)
    .filter(([cat]) => cat !== '기타')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); // 동률이면 항상 같은 순서(결정적)

  const top5 = realCats.slice(0, 5);
  const restTotal = realCats.slice(5).reduce((sum, [, v]) => sum + v, 0) + etcTotal;

  const slices = top5.map(([label, value], i) => ({
    label, value, pct: (value / grandTotal) * 100, color: TREND_PALETTE[i],
  }));
  if (restTotal > 0) {
    // "기타"는 진짜 섹터가 아니라 잔여 묶음이라 팔레트 6번째 색이 아닌 muted 회색으로 구분.
    slices.push({ label: '기타', value: restTotal, pct: (restTotal / grandTotal) * 100, color: 'var(--c-muted)' });
  }
  return { slices };
}

function CategoryPieCarousel({ vol, rate, aiAnalysis }) {
  const volAgg  = useMemo(() => aggregateByCategory(vol,  aiAnalysis?.거래대금 || [], 'tradingVolume'), [vol, aiAnalysis]);
  const rateAgg = useMemo(() => aggregateByCategory(rate, aiAnalysis?.등락률   || [], 'changeRate'),    [rate, aiAnalysis]);
  const [page, setPage] = useState(0);
  if (!volAgg && !rateAgg) return null; // 둘 다 데이터 없으면 섹션 자체를 숨김

  return (
    <div className="pie-carousel-block">
      <div
        className="pie-carousel"
        onScroll={e => setPage(Math.round(e.target.scrollLeft / e.target.clientWidth))}
      >
        <div className="pie-carousel-page">
          <PieChart title="거래대금 상위 50 카테고리 비중" slices={volAgg?.slices} />
        </div>
        <div className="pie-carousel-page">
          <PieChart title="등락률 상위 50 카테고리 비중" slices={rateAgg?.slices} />
        </div>
      </div>
      <div className="pie-carousel-dots">
        <span className={`pie-dot${page === 0 ? ' active' : ''}`} />
        <span className={`pie-dot${page === 1 ? ' active' : ''}`} />
      </div>
    </div>
  );
}

function AiCard({ item }) {
  return (
    <div className="a-item">
      <div className="a-head">
        <span className="a-name">{item.종목명}</span>
        {item.테마섹터 && <span className="a-theme">{item.테마섹터}</span>}
      </div>
      {item.상승원인 && (
        <div className="a-block">
          <div className="a-text">{item.상승원인}</div>
        </div>
      )}
    </div>
  );
}

function AiPanels({ aiAnalysis }) {
  const [tab, setTab] = useState('v');
  const vol  = aiAnalysis.거래대금 || [];
  const rate = aiAnalysis.등락률   || [];
  if (!vol.length && !rate.length) return null;

  return (
    <>
      <div className="seg-tabs">
        <button className={`seg-btn${tab === 'v' ? ' active' : ''}`} onClick={() => setTab('v')}>거래대금</button>
        <button className={`seg-btn${tab === 'r' ? ' active' : ''}`} onClick={() => setTab('r')}>등락률</button>
      </div>
      <div className="tables-grid">
        <div className={`tbl-card${tab === 'r' ? ' mobile-hidden' : ''}`}>
          <div className="tbl-wrap news-wrap">
            {vol.map((item, i) => <AiCard key={i} item={item} />)}
          </div>
        </div>
        <div className={`tbl-card${tab === 'v' ? ' mobile-hidden' : ''}`}>
          <div className="tbl-wrap news-wrap">
            {rate.map((item, i) => <AiCard key={i} item={item} />)}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Analysis({ analysisExcel, aiAnalysis, themeTrend, vol, rate }) {
  const hasTheme = aiAnalysis?.테마?.length > 0;
  const hasAi    = aiAnalysis && (aiAnalysis.거래대금?.length || aiAnalysis.등락률?.length);
  const hasN     = analysisExcel && analysisExcel.length > 0;
  if (!hasTheme && !hasAi && !hasN && !themeTrend?.length) return null;

  const headers = hasN ? Object.keys(analysisExcel[0]) : [];
  const nameKey = headers[0];

  return (
    <div>
      {hasTheme && <ThemeTable themes={aiAnalysis.테마} />}
      <ThemeCategoryTrend themeTrend={themeTrend} />
      <CategoryPieCarousel vol={vol} rate={rate} aiAnalysis={aiAnalysis} />

      {hasAi && (
        <>
          <h2 className="sec-title" style={{ marginTop: 36 }}>주요 뉴스</h2>
          <AiPanels aiAnalysis={aiAnalysis} />
        </>
      )}

      {hasN && (
        <>
          <h2 className="sec-title" style={{ marginTop: 36 }}>분석 결과</h2>
          <div className="analysis-grid">
            {analysisExcel.map((row, i) => (
              <div className="a-item" key={i}>
                <div className="a-head">
                  <span className="a-name">{row[nameKey]}</span>
                </div>
                {headers.slice(1).map(h => row[h] ? (
                  <div className="a-detail" key={h}>
                    <span className="a-label">{h}</span>{row[h]}
                  </div>
                ) : null)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
