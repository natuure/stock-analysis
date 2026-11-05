import { useState } from 'react';

// 종목스크리닝 탭의 "실적 분포" — 종목별 영업이익 성장률(x)·영업이익률(y)·ROE(색) 버블 산점도.
// 데이터는 stock_screening.stocks[i].fin(종목스크리닝.py가 DART로 수집·계산, 계산식과 제외 사유는
// DATA_PIPELINE.md "종목스크리닝.py" 절 참고)을 그대로 쓰고, 여기서는 표시만 한다.
//  - annual : 가장 최근 사업보고서의 당기 vs 전기
//  - quarter: 종목별 가장 최근 분기보고서의 당 분기 3개월 vs 전년 동기 3개월(분기 칩으로 필터)
// 차트에 못 찍는 종목(fin.skip)은 차트 아래에 사유별로 이름을 나열한다.
const KINDS = [{ key: 'annual', label: '연간' }, { key: 'quarter', label: '분기' }];

// ROE 색 구간(순차 색상 5단계). ROE 음수는 차트에서 제외되므로 0 이상만 다룬다.
// 분기 ROE는 프로젝트 규칙대로 연환산하지 않아 값이 작으므로 구간을 따로 둔다. EarningsTable(실적 비교표)도 같은 색·구간을 쓴다.
export const ROE_COLORS = ['#cfe0fd', '#9dc1fb', '#6aa3f8', '#3182f6', '#1b4fa3'];
export const ROE_BANDS = {
  annual: { edges: [5, 10, 15, 20], labels: ['5% 미만', '5~10%', '10~15%', '15~20%', '20% 이상'] },
  quarter: { edges: [2, 4, 6, 10], labels: ['2% 미만', '2~4%', '4~6%', '6~10%', '10% 이상'] },
};
export const bandOf = (kind, roe) => ROE_BANDS[kind].edges.filter(e => roe >= e).length;

const W = 480, H = 320, PAD_L = 46, PAD_R = 26, PAD_T = 14, PAD_B = 36;
const X_MIN = -100, X_MAX = 300; // x축(영업이익 성장률 %) 고정 범위 — 범위 밖 점은 가장자리에 삼각형으로 표시
const X_TICKS = [-100, 0, 100, 200, 300];

const fmtPct = (v, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
const fmtEok = (v) => (v == null ? '-' : `${v.toLocaleString()}억`);

function niceTicks(min, max) {
  const span = max - min || 1;
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) || raw;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}

function Scatter({ kind, points }) {
  const [hover, setHover] = useState(null);
  const [picked, setPicked] = useState(null);
  const active = hover || picked;

  const ys = points.map(p => p.opMargin);
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const padY = (yMax - yMin || 10) * 0.08;
  const lo = yMin - padY, hi = yMax + padY;
  const x = v => PAD_L + ((Math.min(Math.max(v, X_MIN), X_MAX) - X_MIN) / (X_MAX - X_MIN)) * (W - PAD_L - PAD_R);
  const y = v => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const yTicks = niceTicks(lo, hi);

  // ROE가 큰 점이 위에 오도록 오름차순으로 그림
  const drawn = [...points].sort((a, b) => a.roe - b.roe);

  return (
    <>
      <svg className="scr-earn-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="영업이익 성장률과 영업이익률 산점도">
        {yTicks.map(t => (
          <g key={`y${t}`}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className={t === 0 ? 'scr-earn-zero' : 'scr-earn-grid'} />
            <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" className="scr-earn-tick">{t}%</text>
          </g>
        ))}
        {X_TICKS.map(t => (
          <g key={`x${t}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={H - PAD_B} className={t === 0 ? 'scr-earn-zero' : 'scr-earn-grid'} />
            <text x={x(t)} y={H - PAD_B + 16} textAnchor="middle" className="scr-earn-tick">{t}%</text>
          </g>
        ))}
        <text x={(PAD_L + W - PAD_R) / 2} y={H - 4} textAnchor="middle" className="scr-earn-axis">영업이익 성장률</text>
        <text transform={`translate(11 ${(PAD_T + H - PAD_B) / 2}) rotate(-90)`} textAnchor="middle" className="scr-earn-axis">영업이익률</text>
        {drawn.map(p => {
          const cx = x(p.opGrowth), cy = y(p.opMargin);
          const color = ROE_COLORS[bandOf(kind, p.roe)];
          const out = p.opGrowth > X_MAX ? 1 : p.opGrowth < X_MIN ? -1 : 0;
          const on = active && active.code === p.code;
          const common = {
            fill: color, className: `scr-earn-dot${on ? ' on' : ''}`,
            onMouseEnter: () => setHover(p), onMouseLeave: () => setHover(null),
            onClick: () => setPicked(picked && picked.code === p.code ? null : p),
          };
          return out ? (
            <polygon key={p.code} {...common}
              points={out > 0 ? `${cx - 6},${cy - 6} ${cx + 5},${cy} ${cx - 6},${cy + 6}` : `${cx + 6},${cy - 6} ${cx - 5},${cy} ${cx + 6},${cy + 6}`}>
              <title>{p.name}</title>
            </polygon>
          ) : (
            <circle key={p.code} {...common} cx={cx} cy={cy} r={on ? 7 : 5.5}><title>{p.name}</title></circle>
          );
        })}
      </svg>
      <div className="scr-earn-legend">
        <span className="scr-earn-legend-title">ROE</span>
        {ROE_BANDS[kind].labels.map((l, i) => (
          <span key={l} className="scr-earn-legend-item"><i style={{ background: ROE_COLORS[i] }} />{l}</span>
        ))}
        <span className="scr-earn-legend-item">▶ 성장률 범위 밖(−100%~+300%)</span>
      </div>
      <div className="scr-earn-detail">
        {active ? (
          <>
            <b>{active.name}</b> <span className="scr-earn-cat">{active.cat}</span> · {active.label}
            <div>
              영업이익 성장률 <b>{fmtPct(active.opGrowth)}</b> ({fmtEok(active.opIncomePrev)} → {fmtEok(active.opIncome)})
              · 영업이익률 <b>{fmtPct(active.opMargin).replace('+', '')}</b> · ROE <b>{fmtPct(active.roe).replace('+', '')}</b>
            </div>
          </>
        ) : '점에 마우스를 올리거나 눌러 보세요'}
      </div>
    </>
  );
}

export default function EarningsScatter({ stocks }) {
  const [kind, setKind] = useState('annual');
  const [period, setPeriod] = useState('all'); // 분기 탭의 분기 필터

  if (!stocks.some(s => s.fin)) {
    return <div className="scr-earn-empty">이 주차는 종목별 실적 데이터가 없습니다.</div>;
  }

  const rows = stocks.map(s => {
    const r = s.fin && s.fin[kind];
    return r ? { code: s.code, name: s.name, cat: s.카테고리, ...r } : { code: s.code, name: s.name, cat: s.카테고리, skip: 'noData', noReport: true };
  });
  const periods = {};
  if (kind === 'quarter') rows.forEach(r => { if (r.period) periods[r.period] = (periods[r.period] || 0) + 1; });
  const periodKeys = Object.keys(periods).sort().reverse();
  const inScope = kind === 'quarter' && period !== 'all' ? rows.filter(r => r.period === period) : rows;

  const points = inScope.filter(r => !r.skip);
  const prevLoss = inScope.filter(r => r.skip === 'prevOpLoss');
  const roeNeg = inScope.filter(r => r.skip === 'roeNegative');
  const noData = inScope.filter(r => r.skip === 'noData');
  const annualLabel = rows.find(r => r.label)?.label;

  const switchKind = (k) => { setKind(k); setPeriod('all'); };

  return (
    <div className="scr-earn">
      <div className="scr-earn-head">
        <div className="scr-earn-tabs">
          {KINDS.map(k => (
            <button key={k.key} className={`scr-week-btn${kind === k.key ? ' active' : ''}`} onClick={() => switchKind(k.key)}>{k.label}</button>
          ))}
        </div>
        <span className="scr-earn-count">
          표시 {points.length} / 전체 {inScope.length}
          {kind === 'annual' && annualLabel ? ` · ${annualLabel}` : ''}
        </span>
      </div>

      {kind === 'quarter' && periodKeys.length > 1 && (
        <div className="scr-earn-chips">
          <button className={`scr-chip-btn${period === 'all' ? ' active' : ''}`} onClick={() => setPeriod('all')}>전체 ({rows.length})</button>
          {periodKeys.map(p => (
            <button key={p} className={`scr-chip-btn${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>{p} ({periods[p]})</button>
          ))}
        </div>
      )}

      {points.length === 0
        ? <div className="scr-earn-empty">차트에 표시할 종목이 없습니다.</div>
        // 탭·필터가 바뀌면 호버·선택 상태를 초기화하려고 key를 준다
        : <Scatter key={`${kind}-${period}`} kind={kind} points={points} />}

      <div className="scr-earn-excluded">
        {prevLoss.length > 0 && (
          <p><b>성장률 계산 불가 {prevLoss.length}개</b> (전년 영업이익 ≤ 0): {prevLoss.map(r => `${r.name}(${r.opIncome > 0 ? '흑자전환' : '적자지속'})`).join(', ')}</p>
        )}
        {roeNeg.length > 0 && (
          <p><b>ROE 음수 {roeNeg.length}개</b>: {roeNeg.map(r => `${r.name}(${fmtPct(r.roe)})`).join(', ')}</p>
        )}
        {noData.length > 0 && (
          <p><b>산출 불가 {noData.length}개</b> (금융업 등 매출·영업이익 계정이 없거나 DART 값이 비어 있음): {noData.map(r => r.name).join(', ')}</p>
        )}
      </div>
    </div>
  );
}
