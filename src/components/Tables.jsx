import { Fragment, useState, useEffect, useRef } from 'react';
import { fmtN, rc } from '../utils';
import StockChartPanel from './StockChartPanel';

function SortIcon({ col, sort }) {
  if (sort.col !== col) return <i className="sort-ic">↕</i>;
  return <i className="sort-ic">{sort.dir === 'asc' ? '↑' : '↓'}</i>;
}

// 표가 좁은 화면에서 가로 스크롤될 때, 펼쳐진 차트는 카드 폭(스크롤 영향 없음)에
// 맞춰 표시되도록 카드의 실제 렌더링 폭을 측정해 내려준다.
function useCardWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function VolTable({ vol, sort, onSort, dateISO, cardWidth, onJumpToStock }) {
  const [expandedCode, setExpandedCode] = useState(null);
  useEffect(() => { setExpandedCode(null); }, [vol]);
  const toggleRow = (code) => setExpandedCode(c => c === code ? null : code);

  const withRatio = vol.map(s => ({ ...s, ratio: s.marketCap > 0 ? s.tradingVolume / s.marketCap : null }));
  const sorted = [...withRatio].sort((a, b) => {
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
          {th('ratio', '거래대금/시가총액')}
          {th('tradingVolume', '거래대금(백만원)')}
          <th>종목분석</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <Fragment key={s.code}>
            <tr className={s.changeRate >= 29.9 ? 'limit-up' : ''} onClick={() => toggleRow(s.code)}>
              <td>{s.rank}</td>
              <td>{s.name}<span className="td-code">{s.code}</span></td>
              <td>{fmtN(s.price)}</td>
              <td className={rc(s.changeRate)}>{s.changeRate >= 0 ? '+' : ''}{s.changeRate.toFixed(2)}%</td>
              <td>{s.high60Rate != null ? `${s.high60Rate.toFixed(2)}%` : '-'}</td>
              <td>{s.ratio != null ? s.ratio.toFixed(2) : '-'}</td>
              <td>{fmtN(s.tradingVolume)}</td>
              <td>
                <button
                  type="button"
                  className="stock-jump-btn"
                  onClick={(e) => { e.stopPropagation(); onJumpToStock(s.name); }}
                >
                  이동
                </button>
              </td>
            </tr>
            {expandedCode === s.code && (
              <tr className="chart-row">
                <td colSpan={8}>
                  <StockChartPanel code={s.code} dateISO={dateISO} maxWidth={cardWidth ? `${cardWidth}px` : undefined} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function RateTable({ rate, sort, onSort, dateISO, cardWidth, onJumpToStock }) {
  const [expandedCode, setExpandedCode] = useState(null);
  useEffect(() => { setExpandedCode(null); }, [rate]);
  const toggleRow = (code) => setExpandedCode(c => c === code ? null : code);

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
          <th>종목분석</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <Fragment key={s.code}>
            <tr className={s.isUpperLimit ? 'limit-up' : ''} onClick={() => toggleRow(s.code)}>
              <td>{s.rank}</td>
              <td>{s.name}<span className="td-code">{s.code}</span></td>
              <td>{fmtN(s.price)}</td>
              <td className={rc(s.changeRate)}>{s.changeRate >= 0 ? '+' : ''}{s.changeRate.toFixed(2)}%</td>
              <td>{s.high60Rate != null ? `${s.high60Rate.toFixed(2)}%` : '-'}</td>
              <td>
                <button
                  type="button"
                  className="stock-jump-btn"
                  onClick={(e) => { e.stopPropagation(); onJumpToStock(s.name); }}
                >
                  이동
                </button>
              </td>
            </tr>
            {expandedCode === s.code && (
              <tr className="chart-row">
                <td colSpan={6}>
                  <StockChartPanel code={s.code} dateISO={dateISO} maxWidth={cardWidth ? `${cardWidth}px` : undefined} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export default function Tables({ vol, rate, sortV, sortR, tab, onSort, onTab, dateISO, onJumpToStock }) {
  const [cardRefV, cardWidthV] = useCardWidth();
  const [cardRefR, cardWidthR] = useCardWidth();
  return (
    <>
      <div className="seg-tabs">
        <button className={`seg-btn${tab === 'v' ? ' active' : ''}`} onClick={() => onTab('v')}>거래대금</button>
        <button className={`seg-btn${tab === 'r' ? ' active' : ''}`} onClick={() => onTab('r')}>등락률</button>
      </div>
      <div className="tables-grid">
        <div className={`tbl-card${tab === 'r' ? ' mobile-hidden' : ''}`} ref={cardRefV}>
          <div className="tbl-head"><div className="tbl-head-title">거래대금 상위 50위</div></div>
          <div className="tbl-wrap"><VolTable vol={vol} sort={sortV} onSort={onSort} dateISO={dateISO} cardWidth={cardWidthV} onJumpToStock={onJumpToStock} /></div>
        </div>
        <div className={`tbl-card${tab === 'v' ? ' mobile-hidden' : ''}`} ref={cardRefR}>
          <div className="tbl-head"><div className="tbl-head-title">등락률 상위 50위 <span className="tbl-head-note">(거래대금 300억 이상)</span></div></div>
          <div className="tbl-wrap"><RateTable rate={rate} sort={sortR} onSort={onSort} dateISO={dateISO} cardWidth={cardWidthR} onJumpToStock={onJumpToStock} /></div>
        </div>
      </div>
    </>
  );
}
