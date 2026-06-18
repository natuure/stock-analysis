import { useState, useEffect } from 'react';
import { fmtN, rc } from '../utils';

function CandleChart({ candles }) {
  const data = [...candles].reverse(); // 오래된 → 최신 순
  const W = 600, H = 220, PAD = 10;
  const highs = data.map(c => parseFloat(c.highPrice));
  const lows  = data.map(c => parseFloat(c.lowPrice));
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = max - min || 1;
  const colW = (W - PAD * 2) / data.length;
  const y = (price) => PAD + (H - PAD * 2) * (1 - (price - min) / range);

  return (
    <svg className="candle-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {data.map((c, i) => {
        const o = parseFloat(c.openPrice), h = parseFloat(c.highPrice);
        const l = parseFloat(c.lowPrice), cl = parseFloat(c.closePrice);
        const cx = PAD + colW * i + colW / 2;
        const up = cl >= o;
        const color = up ? 'var(--c-up)' : 'var(--c-down)';
        const bodyTop = y(Math.max(o, cl));
        const bodyBot = y(Math.min(o, cl));
        const bodyH = Math.max(bodyBot - bodyTop, 1);
        return (
          <g key={c.timestamp}>
            <line x1={cx} x2={cx} y1={y(h)} y2={y(l)} style={{ stroke: color }} strokeWidth="1" />
            <rect x={cx - colW * 0.3} y={bodyTop} width={colW * 0.6} height={bodyH} style={{ fill: color }} />
          </g>
        );
      })}
    </svg>
  );
}

export default function StockDetailModal({ open, code, name, dateISO, onClose }) {
  const [candles, setCandles] = useState(null);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!open || !code) return;
    setCandles(null);
    setError(null);
    fetch(`/api/tossQuote?symbol=${code}&date=${dateISO}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setCandles(data.candles || []);
      })
      .catch(e => setError(e.message));
  }, [open, code, dateISO]);

  if (!open) return null;

  const last = candles && candles[0];
  const prevClose = candles && candles[1] ? parseFloat(candles[1].closePrice) : null;
  const changeRate = last && prevClose ? ((parseFloat(last.closePrice) - prevClose) / prevClose) * 100 : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{name}<span className="td-code">{code}</span></div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="modal-state">차트를 불러오지 못했습니다 ({error})</div>}
          {!error && !candles && <div className="modal-state">불러오는 중...</div>}
          {!error && candles && candles.length === 0 && <div className="modal-state">캔들 데이터가 없습니다</div>}
          {!error && candles && candles.length > 0 && (
            <>
              <div className="modal-summary">
                <span className="modal-price">{fmtN(last.closePrice)}</span>
                {changeRate !== null && (
                  <span className={rc(changeRate)}>{changeRate >= 0 ? '+' : ''}{changeRate.toFixed(2)}%</span>
                )}
              </div>
              <CandleChart candles={candles} />
              <div className="candle-info">
                <div>시가<b>{fmtN(last.openPrice)}</b></div>
                <div>고가<b>{fmtN(last.highPrice)}</b></div>
                <div>저가<b>{fmtN(last.lowPrice)}</b></div>
                <div>거래량<b>{fmtN(last.volume)}</b></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
