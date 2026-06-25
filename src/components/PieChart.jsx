// 카테고리 비중 도넛 차트 — TrendChart와 같은 의존성 없는 순수 SVG 컨벤션.
// TrendChart와 가장 큰 차이: 원이 타원으로 일그러지면 안 되므로 정사각형 viewBox를 쓰고
// preserveAspectRatio를 기본값(xMidYMid meet)으로 둔다(TrendChart는 막대/꺾은선이라
// preserveAspectRatio="none"으로 비균일하게 늘려도 무방했지만 원은 그러면 안 됨).
const SIZE = 200, CX = 100, CY = 100, R_OUTER = 90, R_INNER = 54;

function polarToCartesian(angleDeg, r) {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90: 0도가 3시가 아니라 12시 방향이 되게
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function donutSlicePath(startAngle, endAngle) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(endAngle, R_OUTER);
  const outerEnd   = polarToCartesian(startAngle, R_OUTER);
  const innerStart = polarToCartesian(startAngle, R_INNER);
  const innerEnd   = polarToCartesian(endAngle, R_INNER);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

export function PieChart({ slices, title }) {
  if (!slices || slices.length === 0) return null;

  let angle = 0;
  const arcs = slices.map(s => {
    const start = angle;
    const end = angle + (s.pct / 100) * 360;
    angle = end;
    return { ...s, start, end };
  });

  return (
    <div className="pie-chart-wrap">
      {title && <div className="trend-chart-title">{title}</div>}
      <svg className="pie-chart-svg" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {arcs.length === 1
          ? (
            // SVG arc는 360도 전체를 한 번에 못 그림(시작점=끝점 퇴화) — 단일 슬라이스(100%)는
            // 원 두 개(채우기+구멍)로 대신 그린다.
            <>
              <circle cx={CX} cy={CY} r={R_OUTER} fill={arcs[0].color} />
              <circle cx={CX} cy={CY} r={R_INNER} style={{ fill: 'var(--c-bg)' }} />
            </>
          )
          : arcs.map((s, i) => (
            <path key={i} d={donutSlicePath(s.start, s.end)} fill={s.color}>
              <title>{s.label} {s.pct.toFixed(1)}%</title>
            </path>
          ))}
      </svg>
      <div className="pie-legend">
        {slices.map(s => (
          <span className="pie-legend-item" key={s.label}>
            <i style={{ background: s.color }} />
            <span className="pie-legend-label">{s.label}</span>
            <span className="pie-legend-pct">{s.pct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
