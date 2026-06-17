function ThemeTable({ themes }) {
  if (!themes || themes.length === 0) return null;
  return (
    <div>
      <h2 className="sec-title" style={{ marginTop: 36 }}>핫한 테마</h2>
      <div className="theme-wrap">
        <table className="theme-table">
          <thead>
            <tr>
              <th>테마</th>
              <th>주요 종목</th>
              <th>핵심 재료</th>
            </tr>
          </thead>
          <tbody>
            {themes.map((row, i) => (
              <tr key={i}>
                <td><span className="theme-tag">{row.테마}</span></td>
                <td>{row.주요종목}</td>
                <td className="theme-material">{row.핵심재료}</td>
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
      </div>
      {item.한줄요약 && (
        <div className="a-detail">
          <span className="a-label">요약</span>{item.한줄요약}
        </div>
      )}
      {item.상승원인 && (
        <div className="a-detail">
          <span className="a-label">원인</span>{item.상승원인}
        </div>
      )}
      {item.트리거 && (
        <div className="a-detail">
          <span className="a-label">트리거</span>{item.트리거}
        </div>
      )}
      {item.테마섹터 && (
        <div className="a-detail">
          <span className="a-label">테마</span>{item.테마섹터}
        </div>
      )}
    </div>
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
          <h2 className="sec-title" style={{ marginTop: 36 }}>AI 분석 결과</h2>
          {aiAnalysis.거래대금?.length > 0 && (
            <>
              <h3 className="sec-subtitle">거래대금 상위</h3>
              <div className="analysis-grid">
                {aiAnalysis.거래대금.map((item, i) => <AiCard key={i} item={item} />)}
              </div>
            </>
          )}
          {aiAnalysis.등락률?.length > 0 && (
            <>
              <h3 className="sec-subtitle">등락률 상위</h3>
              <div className="analysis-grid">
                {aiAnalysis.등락률.map((item, i) => <AiCard key={i} item={item} />)}
              </div>
            </>
          )}
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
