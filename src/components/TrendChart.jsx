// 연도별/일별 추이 차트 (그룹 막대/꺾은선, CandleChart와 동일하게 의존성 없는 순수 SVG).
// 종목 분석 탭(재무 추이)과 거래대금·등락률 분석 탭(테마 카테고리 추이)이 공유한다.
export const TREND_PALETTE = ['#3182f6', '#9b59b6', '#f04452', '#2ecc71', '#f39c12', '#1abc9c'];

export function TrendChart({ periods, metrics, type, title }) {
  const W = 600, H = 130, PAD_L = 6, PAD_R = 6, PAD_T = 10, PAD_B = 8;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = periods.length;
  const values = metrics.flatMap(m => periods.map(p => p[m.key])).filter(v => v != null && isFinite(v));
  if (n === 0 || values.length === 0) return null;
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = (max - min) || 1;
  const y = (v) => PAD_T + plotH * (1 - (v - min) / range);
  const zeroY = y(0);
  const groupW = plotW / n;
  const cx = (i) => PAD_L + groupW * i + groupW / 2;

  return (
    <div className="trend-chart-block">
      {title && <div className="trend-chart-title">{title}</div>}
      <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} className="trend-axis" />
        {type === 'bar'
          ? metrics.map((m, mi) => periods.map((p, i) => {
              const v = p[m.key];
              if (v == null) return null;
              const barW = groupW / (metrics.length + 1);
              const x = cx(i) - (metrics.length * barW) / 2 + mi * barW;
              const yv = y(v);
              const top = Math.min(yv, zeroY);
              const h = Math.max(Math.abs(yv - zeroY), 0.5);
              return <rect key={`${m.key}-${i}`} x={x} y={top} width={barW * 0.85} height={h} fill={m.color} />;
            }))
          : metrics.map(m => {
              const pts = periods
                .map((p, i) => (p[m.key] == null ? null : `${cx(i)},${y(p[m.key])}`))
                .filter(Boolean).join(' ');
              return pts && (
                <g key={m.key}>
                  <polyline points={pts} fill="none" stroke={m.color} strokeWidth="2" />
                  {periods.map((p, i) => p[m.key] != null && (
                    <circle key={i} cx={cx(i)} cy={y(p[m.key])} r="2.5" fill={m.color} />
                  ))}
                </g>
              );
            })}
      </svg>
      <div className="trend-x-labels">
        {periods.map((p, i) => <span key={i}>{p.label}</span>)}
      </div>
      {metrics.length > 1 && (
        <div className="trend-legend">
          {metrics.map(m => (
            <span className="trend-legend-item" key={m.key}><i style={{ background: m.color }} />{m.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
