import { Fragment, useState, useEffect, useRef } from 'react';
import { fmtN, rc } from '../utils';
import StockChartPanel from './StockChartPanel';

// 추적 종목의 "포함 이후 누적" 차트에 일봉 5일·20일선(StockChartPanel 기본) 위에 덧붙이는
// 50/150/200일선 — 정배열 배지(현재가 > 50일선 > 150일선 > 200일선)와 시각적으로 대응되도록.
const EXTRA_MA_LINES = [
  { period: 50,  color: '#f5a623', label: '50일선' },
  { period: 150, color: '#03b26c', label: '150일선' },
  { period: 200, color: '#34495e', label: '200일선' },
];

const MARKET_LABEL = { KOSPI: '코스피', KOSDAQ: '코스닥', 'KOSDAQ GLOBAL': '코스닥' };

// Tables.jsx의 SortIcon과 동일한 패턴 — 클릭한 열의 현재 정렬 방향을 화살표로 표시.
function SortIcon({ col, sort }) {
  if (sort.col !== col) return <i className="sort-ic">↕</i>;
  return <i className="sort-ic">{sort.dir === 'asc' ? '↑' : '↓'}</i>;
}

// Tables.jsx의 useCardWidth와 동일한 패턴 — 좁은 화면에서 표가 가로 스크롤돼도 펼쳐진 차트는
// 카드 실제 폭에 맞춰 고정 표시되게 함.
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

export default function ChartAnalysis() {
  const [stocks, setStocks] = useState(null);
  const [error,  setError]  = useState(null);
  const [expandedCode, setExpandedCode] = useState(null);
  const [sort, setSort] = useState({ col: 'firstAddedDate', dir: 'desc' });
  const [cardRef, cardWidth] = useCardWidth();

  useEffect(() => {
    fetch('/api/getTrackedStocks')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setStocks(data.stocks || []);
      })
      .catch(e => setError(e.message));
  }, []);

  const toggleRow = (code) => setExpandedCode(c => (c === code ? null : code));
  const onSort = (col) => setSort(s => ({
    col, dir: s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc',
  }));
  const th = (col, label) => (
    <th className={sort.col === col ? 'sorted' : ''} onClick={() => onSort(col)}>
      {label}<SortIcon col={col} sort={sort} />
    </th>
  );

  // 정렬에 필요한 파생값(현재가·기준가 대비·정배열 여부)을 미리 계산해 함께 갖고 다님.
  const rows = (stocks || []).map(s => ({
    ...s,
    currentPrice: s.ma ? s.ma.currentPrice : null,
    refChangeRate: s.ma ? (s.ma.currentPrice / s.referenceClose - 1) * 100 : null,
    alignedSort: s.ma ? (s.ma.aligned ? 1 : 0) : -1,
  }));
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.col], bv = b[sort.col];
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
    return sort.dir === 'asc' ? (av ?? -Infinity) - (bv ?? -Infinity) : (bv ?? -Infinity) - (av ?? -Infinity);
  });

  return (
    <main>
      <h2 className="sec-title">차트분석 — 등락률 상위 50 추적 종목</h2>
      <div className="tbl-card" ref={cardRef}>
        {error && <div className="chart-state">불러오지 못했습니다 ({error})</div>}
        {!error && !stocks && <div className="chart-state">불러오는 중...</div>}
        {!error && stocks && stocks.length === 0 && (
          <div className="chart-state">현재 추적 중인 종목이 없습니다.</div>
        )}
        {!error && stocks && stocks.length > 0 && (
          <div className="tbl-wrap">
            <table className="chart-tracking-table">
              <thead>
                <tr>
                  {th('name', '종목명')}
                  {th('market', '시장')}
                  {th('firstAddedDate', '추가일')}
                  {th('currentPrice', '현재가')}
                  {th('refChangeRate', '기준가 대비')}
                  {th('alignedSort', '정배열')}
                  {th('indexCumulativeReturn', '지수 대비 누적 변동률')}
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => (
                  <Fragment key={s.code}>
                    <tr onClick={() => toggleRow(s.code)}>
                      <td>{s.name}<span className="td-code">{s.code}</span></td>
                      <td>{MARKET_LABEL[s.market] || '-'}</td>
                      <td>{s.firstAddedDate}</td>
                      <td>{s.currentPrice !== null ? fmtN(s.currentPrice) : '-'}</td>
                      <td className={s.refChangeRate !== null ? rc(s.refChangeRate) : ''}>
                        {s.refChangeRate !== null
                          ? `${s.refChangeRate >= 0 ? '+' : ''}${s.refChangeRate.toFixed(2)}%`
                          : '-'}
                      </td>
                      <td>
                        {s.ma
                          ? <span className={`ma-align-badge${s.ma.aligned ? ' aligned' : ''}`}>
                              {s.ma.aligned ? '정배열' : '비정배열'}
                            </span>
                          : '-'}
                      </td>
                      <td className={s.indexCumulativeReturn !== null ? rc(s.indexCumulativeReturn) : ''}>
                        {s.indexCumulativeReturn !== null
                          ? `${s.indexCumulativeReturn >= 0 ? '+' : ''}${s.indexCumulativeReturn.toFixed(2)}%`
                          : '-'}
                      </td>
                    </tr>
                    {expandedCode === s.code && (
                      <tr className="chart-row">
                        <td colSpan={7}>
                          <StockChartPanel
                            code={s.code}
                            dateISO={s.lastEnteredDate}
                            from={s.firstAddedDate}
                            extraMaLines={EXTRA_MA_LINES}
                            maxWidth={cardWidth ? `${cardWidth}px` : undefined}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
