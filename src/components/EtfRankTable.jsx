import { useState } from 'react';
import { fmtN, rc } from '../utils';

function SortIcon({ col, sort }) {
  if (sort.col !== col) return <i className="sort-ic">↕</i>;
  return <i className="sort-ic">{sort.dir === 'asc' ? '↑' : '↓'}</i>;
}

function EtfRankRows({ rows }) {
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
          {th('name', 'ETF명')}
          {th('price', '현재가')}
          {th('changeRate', '등락률')}
          {th('marCap', '순자산(억원)')}
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <tr key={s.code}>
            <td>{s.rank}</td>
            <td>{s.name}<span className="td-code">{s.code}</span></td>
            <td>{fmtN(s.price)}</td>
            <td className={rc(s.changeRate)}>{s.changeRate >= 0 ? '+' : ''}{s.changeRate.toFixed(2)}%</td>
            <td>{fmtN(s.marCap)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 주간뷰(카테고리 비중 도넛 ~ 주간 종목 데이터 표 사이)에 삽입되는 ETF 등락률 상위 15 표.
// weekly_indices.etfRank는 주간분석.py가 vol/rate와 같이 채우므로 별도 API 호출 없이
// weekVolRate에 실려 오는 값을 그대로 받는다.
export default function EtfRankTable({ etfRank, week, lastTradingDate }) {
  if (!etfRank || etfRank.length === 0) {
    return (
      <>
        <h2 className="sec-title" style={{ marginTop: 36 }}>ETF 등락률 상위 15</h2>
        <div className="tab-placeholder">이번 주 ETF 랭킹 데이터가 아직 없습니다.</div>
      </>
    );
  }
  return (
    <>
      <h2 className="sec-title" style={{ marginTop: 36 }}>ETF 등락률 상위 15</h2>
      <div className="tbl-card">
        <div className="tbl-head">
          <div className="tbl-head-title">
            ETF 등락률 상위 15위 <span className="tbl-head-note">({week}{lastTradingDate ? `, ${lastTradingDate} 기준` : ''})</span>
          </div>
        </div>
        <div className="tbl-wrap"><EtfRankRows rows={etfRank} /></div>
      </div>
    </>
  );
}
