import { useState } from 'react';

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

export default function Analysis({ analysisExcel, aiAnalysis }) {
  const hasTheme = aiAnalysis?.테마?.length > 0;
  const hasAi    = aiAnalysis && (aiAnalysis.거래대금?.length || aiAnalysis.등락률?.length);
  const hasN     = analysisExcel && analysisExcel.length > 0;
  if (!hasTheme && !hasAi && !hasN) return null;

  const headers = hasN ? Object.keys(analysisExcel[0]) : [];
  const nameKey = headers[0];

  return (
    <div>
      {hasTheme && <ThemeTable themes={aiAnalysis.테마} />}

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
