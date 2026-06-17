import { rc } from '../utils';

function Skeleton() {
  const Block = ({ i }) => (
    <div className="a-item" key={i} style={{ marginBottom: 10 }}>
      <div className="sk sk-line w60" style={{ marginBottom: 10 }} />
      <div className="sk sk-line w80" />
    </div>
  );
  return (
    <div className="analysis-grid">
      <div>{[0,1,2,3].map(i => <Block key={i} i={i} />)}</div>
      <div>{[0,1,2,3].map(i => <Block key={i} i={i} />)}</div>
    </div>
  );
}

function AnalysisResult({ result, vol, rate }) {
  function Col({ title, items, dataArr }) {
    return (
      <div>
        <div className="analysis-col-title">{title}</div>
        <div className="a-list">
          {(items || []).map((item, i) => {
            const s = dataArr.find(d => d.name === item.종목명);
            const rateStr = s ? `${s.changeRate >= 0 ? '+' : ''}${s.changeRate.toFixed(2)}%` : '';
            return (
              <div className="a-item" key={i}>
                <div className="a-head">
                  <span className="a-name">{item.종목명}</span>
                  {s?.sector && <span className="a-sector">{s.sector}</span>}
                  {rateStr && <span className={`a-rate ${rc(s.changeRate)}`}>{rateStr}</span>}
                </div>
                <div className="a-reason">{item.이유 || '-'}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!result) return (
    <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--c-muted)', fontSize: 14 }}>
      분석 결과를 파싱할 수 없습니다.
    </div>
  );

  return (
    <div className="analysis-grid">
      <Col title="거래대금 상위 30위" items={result['거래대금']} dataArr={vol} />
      <Col title="등락률 상위 30위"   items={result['등락률']}   dataArr={rate} />
    </div>
  );
}

export default function Analysis({ vol, rate, loading, result, hasKey, onStart }) {
  return (
    <div>
      <div className="analysis-row" style={{ marginTop: 36 }}>
        <h2 className="sec-title" style={{ margin: 0 }}>AI 뉴스 분석</h2>
        <button
          className="btn-primary"
          disabled={!vol || !rate || !hasKey || loading}
          onClick={onStart}
          title={!hasKey ? 'Claude API 키를 설정 패널에서 입력해주세요' : ''}
        >
          {loading ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin" style={{ width: 16, height: 16 }}>
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              분석 중...
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                <circle cx="12" cy="12" r="3"/>
                <path d="m8 16-2 2-2-2M6 18V9M16 8l2-2 2 2M18 6v9M12 3v3M12 18v3M3 12H6M18 12h3"/>
              </svg>
              AI 뉴스 분석 시작
            </>
          )}
        </button>
      </div>
      <div id="analysis-results">
        {loading && <Skeleton />}
        {!loading && result !== null && <AnalysisResult result={result} vol={vol} rate={rate} />}
      </div>
    </div>
  );
}
