import { useState, useMemo } from 'react';
import { TrendChart, TREND_PALETTE } from './TrendChart';

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

export default function Analysis({ analysisExcel, aiAnalysis, themeTrend }) {
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
