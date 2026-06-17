export default function Analysis({ analysisExcel }) {
  if (!analysisExcel || analysisExcel.length === 0) return null;

  const headers = Object.keys(analysisExcel[0]);
  const nameKey = headers[0];

  return (
    <div>
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
    </div>
  );
}
