import { useState } from 'react';
import { ROE_COLORS, ROE_BANDS, bandOf } from './EarningsScatter';

// 종목스크리닝 탭의 "실적 비교표"(2026-11-05 도입) — 스크리닝 통과 종목 전부의 매출·영업이익·순이익·ROE를
// 기간별로 한 표에서 비교하는 히트맵. 데이터는 stock_screening.stocks[i].fin.hist(종목스크리닝.py가 DART로
// 수집, 연간 최근 3개년·분기 최근 8개 분기, 보고서가 있는 기간만 — DATA_PIPELINE.md "종목스크리닝.py" 절)를
// 표시만 한다.
//  - 행 = 종목, 열 = 기간(오래된 → 최근), 지표는 한 번에 하나(칩으로 전환) — 지표 4개 × 기간 8개를 한꺼번에
//    펼치면 32열이라 오히려 안 읽힌다.
//  - 금액 지표: 칸 배경 = 전년(동기) 대비 증감률(빨강 증가 / 파랑 감소, 앱 공통 색), 흑자전환·적자전환·적자지속은
//    글자로 표시. ROE: 칸 배경 = 수준(실적 분포 산점도와 같은 5단계 색, 분기는 연환산 안 함).
//  - 기간 헤더를 누르면 그 기간 값 순 → 증감률 순 → 기본(시총순)으로 정렬이 바뀐다.
const KINDS = [{ key: 'annual', label: '연간' }, { key: 'quarter', label: '분기' }];
const METRICS = [
  { key: 'revenue', label: '매출액' },
  { key: 'opIncome', label: '영업이익' },
  { key: 'netIncome', label: '순이익' },
  { key: 'roe', label: 'ROE' },
];
// 증감률 색 구간(%) — 양쪽 3단계씩. 흑자전환은 가장 진한 빨강, 적자전환은 가장 진한 파랑.
const UP_BG = ['#fde4e6', '#f9b4ba', '#f47c86'];
const DOWN_BG = ['#e3eefe', '#b3d0fb', '#7aaef8'];
const STEPS = [20, 50];
const stepOf = (absPct) => STEPS.filter(s => absPct >= s).length;
const OTHER = '기타';

// 억원 → "1,234" / "1.2조"(1조 이상). 표 안이라 단위 '억'은 헤더에만 적는다.
function fmtAmt(v) {
  if (v == null) return '–';
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}조`;
  return v.toLocaleString();
}
const fmtEok = (v) => (v == null ? '-' : `${v.toLocaleString()}억`);

// 금액 지표의 전년(동기) 대비 변화. pct는 전년 > 0일 때만, 부호가 바뀌거나 둘 다 적자면 tag로.
function yoyOf(cur, prev) {
  if (cur == null || prev == null) return null;
  if (prev > 0 && cur > 0) return { pct: (cur - prev) / prev * 100 };
  if (prev <= 0 && cur > 0) return { tag: '흑전' };
  if (prev > 0 && cur <= 0) return { tag: '적전' };
  return { tag: '적지' };
}

function cellStyle(metric, kind, p) {
  if (!p) return null;
  if (metric === 'roe') {
    if (p.roe == null) return null;
    if (p.roe < 0) return { color: 'var(--c-down)' };
    const b = bandOf(kind, p.roe);
    return { background: ROE_COLORS[b], color: b >= 3 ? '#fff' : undefined };
  }
  const y = yoyOf(p[metric], p[`${metric}Prev`]);
  if (!y) return null;
  if (y.tag === '흑전') return { background: UP_BG[2] };
  if (y.tag === '적전') return { background: DOWN_BG[2] };
  if (y.tag === '적지') return { background: 'var(--c-surface)' };
  if (Math.abs(y.pct) < 5) return null; // ±5% 미만은 보합으로 색칠 안 함
  return { background: (y.pct > 0 ? UP_BG : DOWN_BG)[stepOf(Math.abs(y.pct))] };
}

function Sparkline({ values }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return <span className="scr-et-spark-empty">–</span>;
  const W = 64, H = 22, P = 2;
  const vs = pts.map(([, v]) => v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = i => P + (i / Math.max(values.length - 1, 1)) * (W - 2 * P);
  const y = v => (hi === lo ? H / 2 : P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P));
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const [li, lv] = pts[pts.length - 1];
  const zero = lo < 0 && hi > 0 ? y(0) : null;
  return (
    <svg className="scr-et-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {zero != null && <line x1={P} x2={W - P} y1={zero} y2={zero} className="scr-et-spark-zero" />}
      <path d={d} />
      <circle cx={x(li)} cy={y(lv)} r="2.2" />
    </svg>
  );
}

function cellTitle(name, period, metric, p) {
  if (!p) return `${name} ${period}: 보고서 없음(상장 전이거나 아직 미제출)`;
  const label = METRICS.find(m => m.key === metric).label;
  if (metric === 'roe') {
    return `${name} ${period} ROE ${p.roe == null ? '산출 불가' : `${p.roe}%`} (순이익 ${fmtEok(p.netIncome)} ÷ 자본 ${fmtEok(p.equity)})`;
  }
  const cur = p[metric], prev = p[`${metric}Prev`];
  const y = yoyOf(cur, prev);
  const yTxt = !y ? '' : y.tag ? `, ${y.tag}` : `, ${y.pct > 0 ? '+' : ''}${y.pct.toFixed(1)}%`;
  return `${name} ${period} ${label} ${fmtEok(cur)} (전년${period.includes('Q') ? ' 동기' : ''} ${fmtEok(prev)}${yTxt})`;
}

export default function EarningsTable({ stocks }) {
  const [kind, setKind] = useState('annual');
  const [metric, setMetric] = useState('opIncome');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState(null); // { period, by: 'value' | 'yoy' } — null이면 시총순(원본 순서)

  const withHist = stocks.filter(s => s.fin && s.fin.hist);
  if (!withHist.length) {
    return <div className="scr-earn-empty">이 주차는 기간별 실적 데이터가 없습니다 (python 종목스크리닝.py --refresh-fin 으로 수집).</div>;
  }

  const rows = stocks.map(s => {
    const list = (s.fin && s.fin.hist && s.fin.hist[kind]) || [];
    return { code: s.code, name: s.name, cat: s.카테고리, marcap: s.marcap, byPeriod: Object.fromEntries(list.map(p => [p.period, p])) };
  });
  // 열 = 종목들에 있는 기간의 합집합(실적 발표 시즌엔 최신 분기를 낸 종목과 아직 안 낸 종목이 섞여 열이 하나 늘 수 있음)
  const periods = [...new Set(rows.flatMap(r => Object.keys(r.byPeriod)))].sort();
  const cats = [...new Set(stocks.map(s => s.카테고리))].sort((a, b) => (a === OTHER) - (b === OTHER) || a.localeCompare(b, 'ko'));

  let shown = cat === 'all' ? rows : rows.filter(r => r.cat === cat);
  if (sort && periods.includes(sort.period)) {
    const keyOf = (r) => {
      const p = r.byPeriod[sort.period];
      if (!p) return null;
      if (sort.by === 'value') return p[metric];
      if (metric === 'roe') return null;
      const y = yoyOf(p[metric], p[`${metric}Prev`]);
      if (!y) return null;
      return y.tag === '흑전' ? Infinity : y.tag === '적전' ? -Infinity : y.tag === '적지' ? -1e12 : y.pct;
    };
    shown = [...shown].sort((a, b) => {
      const ka = keyOf(a), kb = keyOf(b);
      if (ka === kb) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      return kb - ka;
    });
  }

  const clickPeriod = (period) => {
    const yoyAllowed = metric !== 'roe';
    if (!sort || sort.period !== period) setSort({ period, by: 'value' });
    else if (sort.by === 'value' && yoyAllowed) setSort({ period, by: 'yoy' });
    else setSort(null);
  };
  const sortMark = (period) => (sort && sort.period === period ? (sort.by === 'value' ? ' ▼값' : ' ▼증감') : '');
  const unit = metric === 'roe' ? '%' : '억원 (1조 이상은 조)';

  return (
    <div className="scr-et">
      <div className="scr-earn-head">
        <div className="scr-earn-tabs">
          {KINDS.map(k => (
            <button key={k.key} className={`scr-week-btn${kind === k.key ? ' active' : ''}`}
              onClick={() => { setKind(k.key); setSort(null); }}>{k.label}</button>
          ))}
        </div>
        <select className="scr-et-select" value={cat} onChange={e => setCat(e.target.value)} aria-label="업종 필터">
          <option value="all">전체 업종 ({stocks.length})</option>
          {cats.map(c => <option key={c} value={c}>{c} ({rows.filter(r => r.cat === c).length})</option>)}
        </select>
      </div>
      <div className="scr-earn-chips">
        {METRICS.map(m => (
          <button key={m.key} className={`scr-chip-btn${metric === m.key ? ' active' : ''}`}
            onClick={() => { setMetric(m.key); if (m.key === 'roe' && sort?.by === 'yoy') setSort({ ...sort, by: 'value' }); }}>
            {m.label}
          </button>
        ))}
        <span className="scr-et-unit">단위: {unit}</span>
      </div>

      <div className="scr-et-wrap">
        <table className="scr-et-table">
          <thead>
            <tr>
              <th className="scr-et-name" onClick={() => setSort(null)} title="눌러서 기본(시가총액) 순으로">종목</th>
              {periods.map(p => (
                <th key={p} className="scr-et-period" onClick={() => clickPeriod(p)}
                  title="누를 때마다: 값 순 → 증감률 순 → 기본 순">{p}{sortMark(p)}</th>
              ))}
              <th>추세</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.code}>
                <td className="scr-et-name">
                  <b>{r.name}</b><span>{r.cat}</span>
                </td>
                {periods.map(period => {
                  const p = r.byPeriod[period];
                  const v = p ? p[metric] : null;
                  const y = p && metric !== 'roe' ? yoyOf(p[metric], p[`${metric}Prev`]) : null;
                  return (
                    <td key={period} style={cellStyle(metric, kind, p) || undefined}
                      className={p ? '' : 'scr-et-none'} title={cellTitle(r.name, period, metric, p)}>
                      {!p ? '' : metric === 'roe'
                        ? (v == null ? '–' : `${v.toFixed(1)}`)
                        : <>
                            <span className="scr-et-v">{fmtAmt(v)}</span>
                            {y && <em className="scr-et-y">{y.tag || `${y.pct > 0 ? '+' : ''}${Math.round(y.pct).toLocaleString()}%`}</em>}
                          </>}
                    </td>
                  );
                })}
                <td className="scr-et-spark-cell"><Sparkline values={periods.map(pd => r.byPeriod[pd]?.[metric] ?? null)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="scr-earn-legend">
        {metric === 'roe' ? (
          <>
            <span className="scr-earn-legend-title">ROE{kind === 'quarter' ? '(분기, 연환산 안 함)' : ''}</span>
            {ROE_BANDS[kind].labels.map((l, i) => (
              <span key={l} className="scr-earn-legend-item"><i className="sq" style={{ background: ROE_COLORS[i] }} />{l}</span>
            ))}
            <span className="scr-earn-legend-item" style={{ color: 'var(--c-down)' }}>음수는 파란 글자</span>
          </>
        ) : (
          <>
            <span className="scr-earn-legend-title">전년{kind === 'quarter' ? ' 동기' : ''} 대비</span>
            {[...DOWN_BG].reverse().map((c, i) => (
              <span key={c} className="scr-earn-legend-item"><i className="sq" style={{ background: c }} />{['−50%↓', '−20~50%', '−5~20%'][i]}</span>
            ))}
            {UP_BG.map((c, i) => (
              <span key={c} className="scr-earn-legend-item"><i className="sq" style={{ background: c }} />{['+5~20%', '+20~50%', '+50%↑'][i]}</span>
            ))}
            <span className="scr-earn-legend-item">흑전·적전 = 진한 색, 적지 = 회색</span>
          </>
        )}
        <span className="scr-earn-legend-item">빈 칸 = 보고서 없음(상장 전·미제출)</span>
      </div>
    </div>
  );
}
