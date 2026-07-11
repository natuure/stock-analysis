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

// 상단 "RS랭킹" 탭(RsRankingView.jsx가 소유) 전용 카드형 표 — rs_ranking.rsRank(rs랭킹.py가
// 산출, DATA_PIPELINE.md "rs랭킹.py" 절 참고)를 그대로 받아 표시. 전종목 중 RS Score
// (백분위) 90 이상만 이미 필터링·정렬돼 내려오므로 여기서는 정렬만 담당한다. .tbl-wrap이
// 이미 세로 스크롤+헤더 sticky를 지원해서 "100점부터 90점까지 위아래로 스크롤" 요구사항을
// 별도 CSS 없이 그대로 충족한다. 2026-07-11까지는 주간뷰("금주의 코스피/코스닥" 아래)에
// 삽입돼 있었으나, RS Score 계산이 주간분석.py에서 rs랭킹.py로 분리되며 이 컴포넌트도
// 주간뷰에서 빠지고 독립된 "RS랭킹" 탭 전용으로 옮겨짐(주간 종목 데이터 페이지에는 더
// 이상 표시하지 않기로 사용자가 결정, [HISTORY.md](HISTORY.md) 참고).
export default function RsRankTable({ rsRank, asOfDate }) {
  if (!rsRank || rsRank.length === 0) {
    return <div className="tab-placeholder">RS Score 랭킹 데이터가 아직 없습니다. rs랭킹.py를 먼저 실행해 주세요.</div>;
  }
  return (
    <div className="tbl-card">
      <div className="tbl-head">
        <div className="tbl-head-title">
          RS Score 90~100점 <span className="tbl-head-note">({asOfDate ? `${asOfDate} 기준, ` : ''}{rsRank.length}개 종목)</span>
        </div>
      </div>
      <div className="tbl-wrap"><RsRankRows rows={rsRank} /></div>
    </div>
  );
}
