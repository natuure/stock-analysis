import { fmtN, rc } from '../utils';

function SortIcon({ col, sort }) {
  if (sort.col !== col) return <i className="sort-ic">↕</i>;
  return <i className="sort-ic">{sort.dir === 'asc' ? '↑' : '↓'}</i>;
}

function VolTable({ vol, sort, onSort, onRowClick }) {
  const sorted = [...vol].sort((a, b) => {
    const av = a[sort.col], bv = b[sort.col];
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
    return sort.dir === 'asc' ? (av ?? -Infinity) - (bv ?? -Infinity) : (bv ?? -Infinity) - (av ?? -Infinity);
  });

  const th = (col, label) => (
    <th className={sort.col === col ? 'sorted' : ''} onClick={() => onSort('v', col)}>
      {label}<SortIcon col={col} sort={sort} />
    </th>
  );

  return (
    <table>
      <thead>
        <tr>
          <th className={sort.col === 'rank' ? 'sorted' : ''} onClick={() => onSort('v', 'rank')}>
            순위<SortIcon col="rank" sort={sort} />
          </th>
          {th('name', '종목명')}
          {th('price', '현재가')}
          {th('changeRate', '등락률')}
          {th('high60Rate', '60일 신고가대비')}
          {th('tradingVolume', '거래대금(백만원)')}
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <tr key={s.code} className={s.changeRate >= 29.9 ? 'limit-up' : ''} onClick={() => onRowClick(s)}>
            <td>{s.rank}</td>
            <td>{s.name}<span className="td-code">{s.code}</span></td>
            <td>{fmtN(s.price)}</td>
            <td className={rc(s.changeRate)}>{s.changeRate >= 0 ? '+' : ''}{s.changeRate.toFixed(2)}%</td>
            <td>{s.high60Rate != null ? `${s.high60Rate.toFixed(2)}%` : '-'}</td>
            <td>{fmtN(s.tradingVolume)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RateTable({ rate, sort, onSort, onRowClick }) {
  const sorted = [...rate].sort((a, b) => {
    const av = a[sort.col], bv = b[sort.col];
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
    return sort.dir === 'asc' ? (av ?? -Infinity) - (bv ?? -Infinity) : (bv ?? -Infinity) - (av ?? -Infinity);
  });

  const th = (col, label) => (
    <th className={sort.col === col ? 'sorted' : ''} onClick={() => onSort('r', col)}>
      {label}<SortIcon col={col} sort={sort} />
    </th>
  );

  return (
    <table>
      <thead>
        <tr>
          <th className={sort.col === 'rank' ? 'sorted' : ''} onClick={() => onSort('r', 'rank')}>
            순위<SortIcon col="rank" sort={sort} />
          </th>
          {th('name', '종목명')}
          {th('price', '현재가')}
          {th('changeRate', '등락률')}
          {th('high60Rate', '60일 신고가대비')}
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <tr key={s.code} className={s.isUpperLimit ? 'limit-up' : ''} onClick={() => onRowClick(s)}>
            <td>{s.rank}</td>
            <td>{s.name}<span className="td-code">{s.code}</span></td>
            <td>{fmtN(s.price)}</td>
            <td className={rc(s.changeRate)}>{s.changeRate >= 0 ? '+' : ''}{s.changeRate.toFixed(2)}%</td>
            <td>{s.high60Rate != null ? `${s.high60Rate.toFixed(2)}%` : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Tables({ vol, rate, sortV, sortR, tab, onSort, onTab, onRowClick }) {
  return (
    <>
      <div className="seg-tabs">
        <button className={`seg-btn${tab === 'v' ? ' active' : ''}`} onClick={() => onTab('v')}>거래대금</button>
        <button className={`seg-btn${tab === 'r' ? ' active' : ''}`} onClick={() => onTab('r')}>등락률</button>
      </div>
      <div className="tables-grid">
        <div className={`tbl-card${tab === 'r' ? ' mobile-hidden' : ''}`}>
          <div className="tbl-head"><div className="tbl-head-title">거래대금 상위 50위</div></div>
          <div className="tbl-wrap"><VolTable vol={vol} sort={sortV} onSort={onSort} onRowClick={onRowClick} /></div>
        </div>
        <div className={`tbl-card${tab === 'v' ? ' mobile-hidden' : ''}`}>
          <div className="tbl-head"><div className="tbl-head-title">등락률 상위 50위</div></div>
          <div className="tbl-wrap"><RateTable rate={rate} sort={sortR} onSort={onSort} onRowClick={onRowClick} /></div>
        </div>
      </div>
    </>
  );
}
