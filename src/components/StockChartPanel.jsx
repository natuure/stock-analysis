import { useState, useEffect } from 'react';
import { fmtN, rc } from '../utils';

const VISIBLE_COUNT = 60;
const PERIOD_TABS = [
  { key: 'D', label: '일봉', maLines: [
    { period: 5,  color: '#3182f6', label: '5일선' },
    { period: 20, color: '#9b59b6', label: '20일선' },
  ] },
  { key: 'W', label: '주봉', maLines: [
    { period: 5,  color: '#3182f6', label: '5주선' },
    { period: 10, color: '#9b59b6', label: '10주선' },
  ] },
];

function sma(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    return sum / period;
  });
}

const BAR_UP = '#000000';   // 양봉
const BAR_DOWN = '#f04452'; // 음봉

function CandleChart({ candles, maLines }) {
  const full = [...candles].reverse(); // 오래된 → 최신 순 (MA 계산용 선행 데이터 포함)
  const visible = full.slice(-VISIBLE_COUNT);
  const offset = full.length - visible.length;
  const closes = full.map(c => parseFloat(c.closePrice));
  const maSeries = maLines.map(line => ({ ...line, values: sma(closes, line.period).slice(offset) }));

  const W = 600, PAD = 10, PRICE_H = 170, GAP = 10, VOL_H = 50;
  const H = PAD + PRICE_H + GAP + VOL_H + PAD;
  const highs = visible.map(c => parseFloat(c.highPrice));
  const lows  = visible.map(c => parseFloat(c.lowPrice));
  const maValues = maSeries.flatMap(line => line.values.filter(v => v !== null));
  const max = Math.max(...highs, ...maValues);
  const min = Math.min(...lows, ...maValues);
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const logRange = (logMax - logMin) || 1; // 가격이 전혀 안 움직인 극단적 경우 0 나눔 방지
  const colW = (W - PAD * 2) / visible.length;
  const y = (price) => PAD + PRICE_H * (1 - (Math.log(price) - logMin) / logRange);
  const cx = (i) => PAD + colW * i + colW / 2;

  const volumes   = visible.map(c => parseFloat(c.volume));
  const maxVol    = Math.max(...volumes) || 1;
  const volBottom = PAD + PRICE_H + GAP + VOL_H;
  const barH = (v) => (v / maxVol) * VOL_H;
  const barY = (v) => volBottom - barH(v);

  return (
    <svg className="candle-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {visible.map((c, i) => {
        const o = parseFloat(c.openPrice), h = parseFloat(c.highPrice);
        const l = parseFloat(c.lowPrice), cl = parseFloat(c.closePrice);
        const vol = parseFloat(c.volume);
        const up = cl >= o;
        const color = up ? BAR_UP : BAR_DOWN;
        const tick = colW * 0.3;
        return (
          <g key={c.timestamp}>
            <line x1={cx(i)} x2={cx(i)} y1={y(h)} y2={y(l)} style={{ stroke: color }} strokeWidth="1.4" />
            <line x1={cx(i) - tick} x2={cx(i)} y1={y(o)} y2={y(o)} style={{ stroke: color }} strokeWidth="1.4" />
            <line x1={cx(i)} x2={cx(i) + tick} y1={y(cl)} y2={y(cl)} style={{ stroke: color }} strokeWidth="1.4" />
            <rect x={cx(i) - colW * 0.35} width={colW * 0.7} y={barY(vol)} height={barH(vol)} style={{ fill: color }} />
          </g>
        );
      })}
      {maSeries.map(line => {
        const points = line.values
          .map((v, i) => (v === null ? null : `${cx(i)},${y(v)}`))
          .filter(Boolean)
          .join(' ');
        return points && (
          <polyline key={line.period} points={points} fill="none" style={{ stroke: line.color }} strokeWidth="1.5" />
        );
      })}
    </svg>
  );
}

export default function StockChartPanel({ code, dateISO }) {
  const [candles, setCandles] = useState(null);
  const [error,   setError]   = useState(null);
  const [period,  setPeriod]  = useState('D');

  useEffect(() => {
    if (!code) return;
    setCandles(null);
    setError(null);
    fetch(`/api/candles?symbol=${code}&date=${dateISO}&period=${period}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setCandles(data.candles || []);
      })
      .catch(e => setError(e.message));
  }, [code, dateISO, period]);

  const activeTab = PERIOD_TABS.find(t => t.key === period);

  const last = candles && candles[0];
  const prevClose = candles && candles[1] ? parseFloat(candles[1].closePrice) : null;
  const changeRate = last && prevClose ? ((parseFloat(last.closePrice) - prevClose) / prevClose) * 100 : null;

  return (
    <div className="chart-panel-body">
      <div className="period-tabs">
        {PERIOD_TABS.map(tab => (
          <button
            key={tab.key}
            className={`period-tab${period === tab.key ? ' active' : ''}`}
            onClick={() => setPeriod(tab.key)}
          >{tab.label}</button>
        ))}
      </div>
      {error && <div className="chart-state">차트를 불러오지 못했습니다 ({error})</div>}
      {!error && !candles && <div className="chart-state">불러오는 중...</div>}
      {!error && candles && candles.length === 0 && <div className="chart-state">캔들 데이터가 없습니다</div>}
      {!error && candles && candles.length > 0 && (
        <>
          <div className="chart-summary">
            <span className="chart-price">{fmtN(last.closePrice)}</span>
            {changeRate !== null && (
              <span className={rc(changeRate)}>{changeRate >= 0 ? '+' : ''}{changeRate.toFixed(2)}%</span>
            )}
          </div>
          <div className="candle-legend">
            {activeTab.maLines.map(line => (
              <span className="candle-legend-item" key={line.period}>
                <i style={{ background: line.color }} />{line.label}
              </span>
            ))}
          </div>
          <CandleChart candles={candles} maLines={activeTab.maLines} />
        </>
      )}
    </div>
  );
}
