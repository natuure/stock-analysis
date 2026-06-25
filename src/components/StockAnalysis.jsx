import { useState, useEffect } from 'react';
import { fmtN } from '../utils';
import CompanyOverviewView from './CompanyOverviewView';

const SECTIONS = [
  { key: 'overview', label: '기업개요' },
  { key: 'balance',  label: '재무상태표' },
  { key: 'income',   label: '손익계산서' },
  { key: 'cashflow', label: '현금흐름표' },
];

// annual_financials는 연도("2023" 등) 키의 객체라 가장 최근 연도(사업보고서가 최신이면 그
// 연도, 분기가 최신이면 그 전 해 — 종목분석.py의 build_fetch_plan()이 이미 그렇게 채워둠)만 쓴다.
function lastAnnual(data) {
  const years = Object.keys(data.annual_financials || {}).sort();
  return years.length ? data.annual_financials[years[years.length - 1]] : null;
}
// 23·24·25년 연간 + 올해 진행 중인 최신 분기/반기보고서(있으면) 1개까지, 최대 4개 기간의 추이.
// 분기 값은 연환산하지 않고 보고된 실제값 그대로 씀(사용자 요청, 2026-06-25) — 기업개요 탭의
// 연환산 PER(선행)과는 별개 용도.
function allPeriods(data) {
  const annualYears = Object.keys(data.annual_financials || {}).sort();
  const periods = annualYears.map(y => ({ label: y, ...data.annual_financials[y] }));
  const quarters = data.quarterly_financials || [];
  if (quarters.length) {
    const q = quarters[quarters.length - 1];
    // 주의: 스프레드(...q)를 label 지정보다 먼저 둬야 함 — q 자체에도 'label'
    // 필드(예: '1분기보고서')가 있어서 순서가 반대면 우리가 만든 라벨이 덮어써짐.
    periods.push({ ...q, label: `${q.year} ${q.label.replace('보고서', '')}` });
  }
  return periods;
}
function fmtEok(n) { return n == null ? '-' : `${fmtN(n / 1e8)}억원`; }
function fmtWon(n) { return n == null ? '-' : `${fmtN(n)}원`; }
function fmtPct(n) { return n == null || !isFinite(n) ? '-' : `${n.toFixed(2)}%`; }
function ratioOf(num, base) { return (num != null && base) ? (num / base) * 100 : null; }

// ── 연도별 추이 차트 (그룹 막대/꺾은선, CandleChart와 동일하게 의존성 없는 순수 SVG) ────────
const TREND_PALETTE = ['#3182f6', '#9b59b6', '#f04452', '#2ecc71'];

function TrendChart({ periods, metrics, type, title }) {
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

// 비용구조(원재료비/인건비/감가상각비 비중)는 DART API(fnlttSinglAcntAll)가 본문 재무제표만
// 제공하고 주석은 주지 않아 제외함 — 직접 확인(2026-06-24), DATA_PIPELINE.md 참고.
const INCOME_ROWS = [
  { key: 'revenue',   label: '매출액' },
  { key: 'opIncome',  label: '영업이익' },
  { key: 'opMargin',  label: '영업이익률' },
  { key: 'netIncome', label: '당기순이익' },
  { key: 'eps',       label: '주당순이익' },
];

function IncomeStatementView({ data }) {
  const f = lastAnnual(data);
  const values = {
    revenue:   fmtEok(f?.매출액),
    opIncome:  fmtEok(f?.영업이익),
    opMargin:  fmtPct(ratioOf(f?.영업이익, f?.매출액)),
    netIncome: fmtEok(f?.당기순이익),
    eps:       fmtWon(f?.기본주당이익_DART),
  };

  const periods = allPeriods(data);
  const amountPeriods = periods.map(p => ({
    label: p.label,
    매출액:   p.매출액 != null ? p.매출액 / 1e8 : null,
    영업이익: p.영업이익 != null ? p.영업이익 / 1e8 : null,
    당기순이익: p.당기순이익 != null ? p.당기순이익 / 1e8 : null,
  }));
  const marginPeriods = periods.map(p => ({ label: p.label, 영업이익률: ratioOf(p.영업이익, p.매출액) }));
  const epsPeriods = periods.map(p => ({ label: p.label, 주당순이익: p.기본주당이익_DART }));

  return (
    <div>
      <div className="fin-card">
        {INCOME_ROWS.map(row => (
          <div className="fin-row" key={row.key}>
            <span className="fin-label">{row.label}</span>
            <span className="fin-value">{values[row.key]}</span>
          </div>
        ))}
      </div>
      <TrendChart type="bar" title="매출액·영업이익·당기순이익 추이 (억원)" periods={amountPeriods} metrics={[
        { key: '매출액',   label: '매출액',   color: TREND_PALETTE[0] },
        { key: '영업이익', label: '영업이익', color: TREND_PALETTE[1] },
        { key: '당기순이익', label: '당기순이익', color: TREND_PALETTE[2] },
      ]} />
      <TrendChart type="line" title="영업이익률 추이 (%)" periods={marginPeriods} metrics={[
        { key: '영업이익률', label: '영업이익률', color: TREND_PALETTE[0] },
      ]} />
      <TrendChart type="line" title="주당순이익 추이 (원)" periods={epsPeriods} metrics={[
        { key: '주당순이익', label: '주당순이익', color: TREND_PALETTE[1] },
      ]} />
    </div>
  );
}

const BALANCE_ROWS = [
  { key: 'capexRatio',      label: 'CAPEX 비중' },
  { key: 'inventoryRatio',  label: '재고자산 비중' },
  { key: 'receivableRatio', label: '매출채권 비중' },
  { key: 'cashRatio',       label: '현금 비중' },
  { key: 'debtRatio',       label: '부채비율' },
  { key: 'advances',        label: '선수금' },
  { key: 'capitalStock',    label: '자본금' },
  { key: 'capitalSurplus',  label: '자본잉여금' },
  { key: 'retainedEarnings', label: '이익잉여금' },
];

function BalanceSheetView({ data }) {
  const f = lastAnnual(data);
  // CAPEX 자체(투자 흐름)는 DART 본문 재무제표에 없어 유형자산(보유 자산 스냅샷)으로 근사함
  // — 종목분석.py가 수집하는 재무상태표 항목 중 CAPEX와 가장 가까운 유일한 필드.
  const values = {
    capexRatio:       fmtPct(ratioOf(f?.유형자산, f?.자산총계)),
    inventoryRatio:   fmtPct(ratioOf(f?.재고자산, f?.자산총계)),
    receivableRatio:  fmtPct(ratioOf(f?.매출채권, f?.자산총계)),
    cashRatio:        fmtPct(ratioOf(f?.현금및현금성자산, f?.자산총계)),
    debtRatio:        fmtPct(ratioOf(f?.부채총계, f?.자본총계)),
    advances:         fmtEok(f?.선수금),
    capitalStock:     fmtEok(f?.자본금),
    capitalSurplus:   fmtEok(f?.자본잉여금),
    retainedEarnings: fmtEok(f?.이익잉여금),
  };

  const periods = allPeriods(data);
  const ratioPeriods = periods.map(p => ({
    label: p.label,
    CAPEX:   ratioOf(p.유형자산, p.자산총계),
    재고자산: ratioOf(p.재고자산, p.자산총계),
    매출채권: ratioOf(p.매출채권, p.자산총계),
    현금:    ratioOf(p.현금및현금성자산, p.자산총계),
  }));
  const debtPeriods = periods.map(p => ({ label: p.label, 부채비율: ratioOf(p.부채총계, p.자본총계) }));
  const amountPeriods = periods.map(p => ({
    label: p.label,
    선수금:   p.선수금 != null ? p.선수금 / 1e8 : null,
    자본금:   p.자본금 != null ? p.자본금 / 1e8 : null,
    자본잉여금: p.자본잉여금 != null ? p.자본잉여금 / 1e8 : null,
    이익잉여금: p.이익잉여금 != null ? p.이익잉여금 / 1e8 : null,
  }));

  return (
    <div>
      <div className="fin-card">
        {BALANCE_ROWS.map(row => (
          <div className="fin-row" key={row.key}>
            <span className="fin-label">{row.label}</span>
            <span className="fin-value">{values[row.key]}</span>
          </div>
        ))}
      </div>
      <TrendChart type="line" title="자산 구성비 추이 (%)" periods={ratioPeriods} metrics={[
        { key: 'CAPEX',   label: 'CAPEX',   color: TREND_PALETTE[0] },
        { key: '재고자산', label: '재고자산', color: TREND_PALETTE[1] },
        { key: '매출채권', label: '매출채권', color: TREND_PALETTE[2] },
        { key: '현금',    label: '현금',    color: TREND_PALETTE[3] },
      ]} />
      <TrendChart type="line" title="부채비율 추이 (%)" periods={debtPeriods} metrics={[
        { key: '부채비율', label: '부채비율', color: TREND_PALETTE[2] },
      ]} />
      <TrendChart type="bar" title="선수금·자본금·자본잉여금·이익잉여금 추이 (억원)" periods={amountPeriods} metrics={[
        { key: '선수금',   label: '선수금',   color: TREND_PALETTE[0] },
        { key: '자본금',   label: '자본금',   color: TREND_PALETTE[1] },
        { key: '자본잉여금', label: '자본잉여금', color: TREND_PALETTE[2] },
        { key: '이익잉여금', label: '이익잉여금', color: TREND_PALETTE[3] },
      ]} />
    </div>
  );
}

export default function StockAnalysis() {
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState('');
  const [companyList, setCompanyList] = useState([]);
  const [companyData, setCompanyData] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | notfound | error

  useEffect(() => {
    fetch('/api/getCompanyOverview')
      .then(r => r.json())
      .then(({ list }) => setCompanyList(list || []))
      .catch(() => {});
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    const name = query.trim();
    if (!name) return;
    const match = companyList.find(c => c.name === name) || companyList.find(c => c.name.includes(name));
    if (!match) {
      setStatus('notfound');
      setCompanyData(null);
      return;
    }
    setStatus('loading');
    fetch(`/api/getCompanyOverview?code=${match.stock_code}`)
      .then(r => r.json())
      .then(({ data }) => {
        setCompanyData(data || null);
        setStatus(data ? 'idle' : 'notfound');
      })
      .catch(() => setStatus('error'));
  }

  return (
    <div className="stock-analysis">
      <form className="stock-search" onSubmit={handleSearch}>
        <input
          list="company-analysis-list"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="종목명 검색 (예: 삼성전자)"
          className="stock-search-input"
        />
        <datalist id="company-analysis-list">
          {companyList.map(c => <option key={c.stock_code} value={c.name} />)}
        </datalist>
        <button type="submit" className="stock-search-btn">조회</button>
      </form>
      {status === 'loading' && (
        <div className="stock-search-msg">조회 중...</div>
      )}
      {status === 'notfound' && (
        <div className="stock-search-msg">
          분석된 종목이 아닙니다. 먼저 <code>python 종목분석.py 종목명</code>을 실행하세요.
        </div>
      )}
      {status === 'error' && (
        <div className="stock-search-msg">조회 중 오류가 발생했습니다.</div>
      )}

      <div className="stock-analysis-tabs">
        {SECTIONS.map(s => (
          <button
            key={s.key}
            className={`stock-analysis-btn${active === s.key ? ' active' : ''}`}
            onClick={() => setActive(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {active === 'overview' ? (
        companyData
          ? <CompanyOverviewView data={companyData} />
          : <div className="tab-placeholder">종목을 검색하세요</div>
      ) : active === 'income' ? (
        companyData
          ? <IncomeStatementView data={companyData} />
          : <div className="tab-placeholder">종목을 검색하세요</div>
      ) : active === 'balance' ? (
        companyData
          ? <BalanceSheetView data={companyData} />
          : <div className="tab-placeholder">종목을 검색하세요</div>
      ) : (
        <div className="tab-placeholder">
          {active
            ? `${SECTIONS.find(s => s.key === active).label} — 준비 중입니다`
            : '항목을 선택하세요'}
        </div>
      )}
    </div>
  );
}
