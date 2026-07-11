import { useState } from 'react';

function SortIcon({ col, sort }) {
  if (sort.col !== col) return <i className="sort-ic">↕</i>;
  return <i className="sort-ic">{sort.dir === 'asc' ? '↑' : '↓'}</i>;
}

function RsRankRows({ rows }) {
  const [sort, setSort] = useState({ col: 'rank', dir: 'asc' });

  function handleSort(col) {
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'rank' ? 'asc' : 'desc' });
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.col], bv = b[sort.col];
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
    return sort.dir === 'asc' ? (av ?? -Infinity) - (bv ?? -Infinity) : (bv ?? -Infinity) - (av ?? -Infinity);
  });

  const th = (col, label) => (
    <th className={sort.col === col ? 'sorted' : ''} onClick={() => handleSort(col)}>
      {label}<SortIcon col={col} sort={sort} />
    </th>
  );

  return (
    <table>
      <thead>
        <tr>
          {th('rank', '순위')}
          {th('name', '종목명')}
          {th('rsScore', 'RS Score')}
          {th('카테고리', '카테고리')}
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <tr key={s.code}>
            <td>{s.rank}</td>
            <td>{s.name}<span className="td-code">{s.code}</span></td>
            <td>{s.rsScore.toFixed(1)}</td>
            <td>{s.카테고리 || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 주간뷰("금주의 코스피/코스닥" ~ 주간 종목 데이터 표 사이)에 삽입되는 RS Score 랭킹 표.
// weekly_indices.rsRank(주간분석.py가 산출, DATA_PIPELINE.md "rs_ranking" 절 참고)를
// 그대로 받아 표시 — 전종목 중 RS Score(백분위) 90 이상만 이미 필터링돼 내려오므로
// 여기서는 정렬만 담당한다. .tbl-wrap이 이미 세로 스크롤+헤더 sticky를 지원해서
// "100점부터 90점까지 위아래로 스크롤" 요구사항을 별도 CSS 없이 그대로 충족한다.
export default function RsRankTable({ rsRank, week, lastTradingDate }) {
  if (!rsRank || rsRank.length === 0) {
    return (
      <>
        <h2 className="sec-title" style={{ marginTop: 36 }}>RS Score 랭킹 (90점 이상)</h2>
        <div className="tab-placeholder">이번 주 RS Score 랭킹 데이터가 아직 없습니다.</div>
      </>
    );
  }
  return (
    <>
      <h2 className="sec-title" style={{ marginTop: 36 }}>RS Score 랭킹 (90점 이상)</h2>
      <div className="tbl-card">
        <div className="tbl-head">
          <div className="tbl-head-title">
            RS Score 90~100점 <span className="tbl-head-note">({week}{lastTradingDate ? `, ${lastTradingDate} 기준` : ''}, {rsRank.length}개 종목)</span>
          </div>
        </div>
        <div className="tbl-wrap"><RsRankRows rows={rsRank} /></div>
      </div>
    </>
  );
}
