// 연도별/일별 추이 차트 (그룹 막대/꺾은선, CandleChart와 동일하게 의존성 없는 순수 SVG).
// 종목 분석 탭(재무 추이)과 거래대금·등락률 분석 탭(테마 카테고리 추이)이 공유한다.
export const TREND_PALETTE = ['#3182f6', '#9b59b6', '#f04452', '#2ecc71', '#f39c12', '#1abc9c'];

export function TrendChart({ periods, metrics, type, title, showValues, valueFormatter = v => v.toFixed(1) }) {
  // showValues는 각 표식/막대 위에 값을 숫자로 같이 보여준다(라인 차트엔 먼저 추가 — 막대는
  // 길이로 이미 값이 보인다고 판단해 처음엔 제외했으나, 이후 사용자 피드백으로 막대도 지원
  // 추가: 높이만으로는 정확한 수치 비교가 어려움). 라벨이 들어갈 위쪽 여백(PAD_T)을
  // 더 두는 것만으론 부족함 — 두 계열의 값이 서로 가까우면(예: ROE 8.1%·영업이익률 6.2%처럼
  // 차이가 작으면) 점 사이 간격 자체가 좁아서 라벨끼리 겹친다(글꼴 크기는 고정인데 같은 비율로
  // 줄어들지 않으므로 차트를 단순히 더 "늘려서" 그리는 건 효과가 없음 — viewBox는 그대로 두고
  // CSS 높이만 키우면 폰트도 같이 커져서 간격 대비 비율이 똑같이 유지됨). 그래서 showValues일
  // 때는 내부 좌표계 자체(H)를 키워 플롯 영역(plotH)을 넓히고, SVG 렌더 높이도 그만큼 같이
  // 키워서(1유닛=1px 유지) 점과 점 사이의 실제 화면 간격을 넓힌다 — 글꼴 크기(9유닛)는 그대로라
  // 상대적으로 더 여유로워짐.
  const W = 600, H = showValues ? 240 : 130, PAD_L = 6, PAD_R = 6, PAD_T = showValues ? 24 : 10, PAD_B = 8;
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
      <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
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
              const bw = barW * 0.85;
              return (
                <g key={`${m.key}-${i}`}>
                  <rect x={x} y={top} width={bw} height={h} fill={m.color} />
                  {showValues && (
                    <text x={x + bw / 2} y={top - 4} textAnchor="middle" className="trend-point-label" fill={m.color}>
                      {valueFormatter(v)}
                    </text>
                  )}
                </g>
              );
            }))
          : metrics.map(m => {
              const pts = periods
                .map((p, i) => (p[m.key] == null ? null : `${cx(i)},${y(p[m.key])}`))
                .filter(Boolean).join(' ');
              return pts && (
                <g key={m.key}>
                  <polyline points={pts} fill="none" stroke={m.color} strokeWidth="2" />
                  {periods.map((p, i) => p[m.key] != null && (
                    <g key={i}>
                      <circle cx={cx(i)} cy={y(p[m.key])} r="2.5" fill={m.color} />
                      {showValues && (
                        <text x={cx(i)} y={y(p[m.key]) - 6} textAnchor="middle" className="trend-point-label" fill={m.color}>
                          {valueFormatter(p[m.key])}
                        </text>
                      )}
                    </g>
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
