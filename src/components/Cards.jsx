import { fmtN, rc } from '../utils';

function Skeleton() {
  return (
    <div>
      {[80, 60, 80, 60, 80].map((w, i) => (
        <div key={i} className={`sk sk-line w${w}`} />
      ))}
    </div>
  );
}

function SectorBars({ data, loading }) {
  if (loading) return <Skeleton />;
  if (!data.some(s => s.sector)) return <span className="empty-text">업종 데이터 로딩 중...</span>;
  const cnt = {};
  data.forEach(s => { const k = s.sector || '미분류'; cnt[k] = (cnt[k] || 0) + 1; });
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top[0][1];
  return (
    <div className="sec-list">
      {top.map(([n, c]) => (
        <div className="sec-item" key={n}>
          <span className="sec-name">{n}</span>
          <div className="sec-bar"><div className="sec-fill" style={{ width: `${(c / max * 100).toFixed(0)}%` }} /></div>
          <span className="sec-cnt">{c}</span>
        </div>
      ))}
    </div>
  );
}

function CardA({ vol }) {
  const top = [...vol]
    .filter(s => s.marketCap > 0)
    .map(s => ({ ...s, ratio: s.tradingVolume / s.marketCap * 100 }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);
  return top.length ? (
    <div className="rank-list">
      {top.map((s, i) => (
        <div className="rank-item" key={s.code}>
          <span className={`rank-num${i < 3 ? ' top' : ''}`}>{i + 1}</span>
          <span className="rank-name">{s.name}</span>
          <span className="rank-val">{s.ratio.toFixed(1)}%</span>
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
  const limits = rate.filter(s => s.changeRate >= 29.9);
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

export default function Cards({ vol, rate, fetchingSectors }) {
  return (
    <>
      <h2 className="sec-title">거래대금 분석 <span className="sec-sub">상위 50위</span></h2>
      <div className="grid-3">
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
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            WICS 업종 분포 TOP 5
          </div>
          <SectorBars data={vol} loading={fetchingSectors} />
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
        <div className="card">
          <div className="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            WICS 업종 분포 TOP 5
          </div>
          <SectorBars data={rate} loading={fetchingSectors} />
        </div>
      </div>
    </>
  );
}
