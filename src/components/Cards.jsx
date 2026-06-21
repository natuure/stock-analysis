import { fmtN, rc } from '../utils';


function CardA({ vol }) {
  // tradingVolume은 백만원, marketCap은 억원 단위(1억원 = 100백만원)라 단위를 맞춰서 나눈다
  const top = [...vol]
    .filter(s => s.marketCap > 0)
    .map(s => ({ ...s, ratio: s.tradingVolume / (s.marketCap * 100) }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);
  return top.length ? (
    <div className="rank-list">
      {top.map((s, i) => (
        <div className="rank-item" key={s.code}>
          <span className={`rank-num${i < 3 ? ' top' : ''}`}>{i + 1}</span>
          <span className="rank-name">{s.name}</span>
          <span className="rank-val">{s.ratio.toFixed(2)}</span>
        </div>
      ))}
    </div>
  ) : <span className="empty-text">시가총액 데이터가 없습니다</span>;
}

function CardC({ vol }) {
  const list = [...vol]
    .map(s => ({ ...s, rise: s.prevRank !== null ? s.prevRank - s.rank : null }))
    .filter(s => s.rise !== null || s.prevRank === null)
    .sort((a, b) => {
      if (a.prevRank === null && b.prevRank !== null) return -1;
      if (a.prevRank !== null && b.prevRank === null) return 1;
      return (b.rise || 0) - (a.rise || 0);
    })
    .slice(0, 5);
  return list.length ? (
    <div className="rank-list">
      {list.map((s, i) => (
        <div className="rank-item" key={s.code}>
          <span className={`rank-num${i < 3 ? ' top' : ''}`}>{i + 1}</span>
          <span className="rank-name">{s.name}</span>
          {s.prevRank === null
            ? <span className="badge badge-new">NEW</span>
            : <span className="badge badge-up">↑{s.rise}위</span>}
        </div>
      ))}
    </div>
  ) : <span className="empty-text">전일 순위 데이터가 없습니다</span>;
}

function CardD({ rate }) {
  const limits = rate.filter(s => s.isUpperLimit);
  return (
    <>
      <div className="limit-count">{limits.length}<span>종목</span></div>
      <div className="chips">
        {limits.length
          ? limits.map(s => <span className="chip" key={s.code}>{s.name}</span>)
          : <span className="empty-text">상한가 종목 없음</span>}
      </div>
    </>
  );
}

export default function Cards({ vol, rate }) {
  return (
    <>
      <h2 className="sec-title">거래대금 분석 <span className="sec-sub">상위 50위</span></h2>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
            </svg>
            거래대금 / 시가총액 TOP 5
          </div>
          <CardA vol={vol} />
        </div>
        <div className="card">
          <div className="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>
            </svg>
            전일 대비 순위 상승 TOP 5
          </div>
          <CardC vol={vol} />
        </div>
      </div>

      <h2 className="sec-title" style={{ marginTop: 28 }}>등락률 분석 <span className="sec-sub">상위 50위 · 거래대금 300억↑</span></h2>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            상한가 종목
          </div>
          <CardD rate={rate} />
        </div>
      </div>
    </>
  );
}
