import { useState } from 'react';
import { fmtN } from '../utils';

// PER(선행) 연환산 규칙 — 최근 보고서 종류에 따라 당기순이익을 연 단위로 환산한다.
// 1분기보고서: ×4, 반기보고서: ×2, 3분기보고서: ×4/3, 사업보고서(연간 확정): ×1(그대로).
function annualizeNetIncome(netIncome, reprtCode) {
  const factor = { '11013': 4, '11012': 2, '11014': 4 / 3, '11011': 1 }[reprtCode];
  return factor ? netIncome * factor : netIncome;
}

// 종목분석.py 출력(JSON)에서 적정주가 계산에 필요한 값만 뽑아낸다.
// - PER(후행) 기준 당기순이익: annual_financials의 가장 최근 연도(사업보고서가 최신이면 그
//   연도 자체, 분기가 최신이면 그 전 해 — build_fetch_plan()이 이미 그렇게 채워둠).
// - PER(선행) 기준 당기순이익: 올해 분기가 있으면 그중 가장 최근 분기, 없으면(최신이 이미
//   사업보고서) 위와 동일한 연간 데이터 — annualizeNetIncome()으로 연환산.
function pickFinancials(data) {
  const annualYears = Object.keys(data.annual_financials).sort();
  const lastFullYear = annualYears[annualYears.length - 1];
  const lastFullYearData = data.annual_financials[lastFullYear];

  const quarters = data.quarterly_financials || [];
  const latestPeriod = quarters.length > 0 ? quarters[quarters.length - 1] : lastFullYearData;
  const latestReprtCode = data.latest_report.reprt_code;

  const equity = lastFullYearData.지배기업소유주지분 || lastFullYearData.자본총계;
  // 감가상각비를 못 찾은 회사(직접 확인, DATA_PIPELINE.md 참고)는 영업이익만으로 근사(EBIT).
  const ebitda = (lastFullYearData.영업이익 || 0) + (lastFullYearData.감가상각비 || 0);
  const netDebt = (lastFullYearData.차입금_추정 || 0) - (lastFullYearData.현금및현금성자산 || 0);

  return {
    price: data.quote?.price,
    sharesOutstanding: data.quote?.sharesOutstanding,
    netIncomeLastYear: lastFullYearData.당기순이익,
    netIncomeAnnualized: annualizeNetIncome(latestPeriod.당기순이익, latestReprtCode),
    equity, ebitda, netDebt,
  };
}

function calcOverview(s) {
  const marketCap = s.price * s.sharesOutstanding;
  const eps = s.netIncomeAnnualized / s.sharesOutstanding;
  const bps = s.equity / s.sharesOutstanding;
  return {
    marketCap, eps, bps,
    perTrailing: marketCap / s.netIncomeLastYear,
    perForward: marketCap / s.netIncomeAnnualized,
    pbr: marketCap / s.equity,
    roe: (s.netIncomeLastYear / s.equity) * 100,
    evEbitda: (marketCap + s.netDebt) / s.ebitda,
  };
}

function ValuationSlider({ label, unit, min, max, step, value, onChange }) {
  return (
    <div className="val-slider-row">
      <div className="val-slider-head">
        <span className="val-slider-label">{label}</span>
        <span className="val-slider-value">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="val-slider-input"
      />
    </div>
  );
}

// 왼쪽엔 KIS 실시간 현재가, 오른쪽엔 슬라이더로 계산한 적정주가 — 둘을 나란히 비교해서 보여줌.
function PriceRow({ current, fair }) {
  return (
    <div className="val-price-row">
      <span className="val-current-price">
        {current != null && isFinite(current) ? `현재가: ${fmtN(current)}원` : '-'}
      </span>
      <span className="val-fair-price">
        {fair != null && isFinite(fair) ? `${fmtN(fair)}원` : '-'}
      </span>
    </div>
  );
}

function PerMethodCard({ eps, currentPrice }) {
  const [per, setPer] = useState(10);
  return (
    <div className="val-method-card">
      <div className="val-method-title">PER법</div>
      <ValuationSlider label="목표 PER" unit="배" min={1} max={40} step={0.5} value={per} onChange={setPer} />
      <PriceRow current={currentPrice} fair={eps != null ? per * eps : null} />
    </div>
  );
}

function PbrMethodCard({ bps, currentPrice }) {
  const [pbr, setPbr] = useState(1);
  return (
    <div className="val-method-card">
      <div className="val-method-title">PBR법</div>
      <ValuationSlider label="목표 PBR" unit="배" min={0.2} max={5} step={0.1} value={pbr} onChange={setPbr} />
      <PriceRow current={currentPrice} fair={bps != null ? pbr * bps : null} />
    </div>
  );
}

function EvEbitdaMethodCard({ ebitda, netDebt, sharesOutstanding, currentPrice }) {
  const [multiple, setMultiple] = useState(6);
  const fairPrice = ebitda != null
    ? (multiple * ebitda - netDebt) / sharesOutstanding
    : null;
  return (
    <div className="val-method-card">
      <div className="val-method-title">EV/EBITDA법</div>
      <ValuationSlider label="목표 EV/EBITDA" unit="배" min={2} max={20} step={0.5} value={multiple} onChange={setMultiple} />
      <PriceRow current={currentPrice} fair={fairPrice} />
    </div>
  );
}

// 간단한 고정 전제 DCF: 연환산 당기순이익을 FCF 대용으로 삼아 5년간 고정 성장률(3%)로
// 키운 뒤, 영구성장률(2%)로 터미널 밸류를 구해 WACC(슬라이더)로 할인한다 — 실제 CAPEX·
// 순운전자본 변동 등은 반영하지 않은 단순화된 근사치(2026-06-25, 사용자 요청으로 단순화).
const DCF_GROWTH_RATE = 0.03;
const DCF_TERMINAL_GROWTH = 0.02;
const DCF_YEARS = 5;

function calcDcfFairPrice(netIncomeAnnualized, sharesOutstanding, wacc) {
  if (netIncomeAnnualized == null || wacc <= DCF_TERMINAL_GROWTH) return null;
  let pv = 0;
  let fcf = netIncomeAnnualized;
  for (let t = 1; t <= DCF_YEARS; t++) {
    fcf *= 1 + DCF_GROWTH_RATE;
    pv += fcf / (1 + wacc) ** t;
  }
  const terminalValue = (fcf * (1 + DCF_TERMINAL_GROWTH)) / (wacc - DCF_TERMINAL_GROWTH);
  const equityValue = pv + terminalValue / (1 + wacc) ** DCF_YEARS;
  return equityValue / sharesOutstanding;
}

function DcfMethodCard({ netIncomeAnnualized, sharesOutstanding, currentPrice }) {
  const [wacc, setWacc] = useState(8);
  return (
    <div className="val-method-card">
      <div className="val-method-title">DCF법</div>
      <ValuationSlider label="WACC(할인율)" unit="%" min={4} max={15} step={0.5} value={wacc} onChange={setWacc} />
      <PriceRow current={currentPrice} fair={calcDcfFairPrice(netIncomeAnnualized, sharesOutstanding, wacc / 100)} />
    </div>
  );
}

function fmtEok(n) { return n == null ? '-' : `${fmtN(n / 1e8)}억원`; }

const OVERVIEW_ROWS = [
  { key: 'marketCap',   label: '시가총액',   fmt: fmtEok },
  { key: 'perTrailing', label: 'PER(후행)', fmt: v => `${v.toFixed(2)}배` },
  { key: 'perForward',  label: 'PER(선행)', fmt: v => `${v.toFixed(2)}배` },
  { key: 'pbr',         label: 'PBR',       fmt: v => `${v.toFixed(2)}배` },
  { key: 'roe',         label: 'ROE',       fmt: v => `${v.toFixed(2)}%` },
  { key: 'evEbitda',    label: 'EV/EBITDA', fmt: v => `${v.toFixed(2)}배` },
];

export default function CompanyOverviewView({ data }) {
  const fin = pickFinancials(data);
  const ov = calcOverview(fin);

  return (
    <div>
      <div className="fin-card">
        {OVERVIEW_ROWS.map(row => (
          <div className="fin-row" key={row.key}>
            <span className="fin-label">{row.label}</span>
            <span className="fin-value">{row.fmt(ov[row.key])}</span>
          </div>
        ))}
      </div>

      <h3 className="val-section-title">적정주가</h3>
      <div className="val-grid">
        <PerMethodCard eps={ov.eps} currentPrice={fin.price} />
        <PbrMethodCard bps={ov.bps} currentPrice={fin.price} />
        <EvEbitdaMethodCard
          ebitda={fin.ebitda}
          netDebt={fin.netDebt}
          sharesOutstanding={fin.sharesOutstanding}
          currentPrice={fin.price}
        />
        <DcfMethodCard
          netIncomeAnnualized={fin.netIncomeAnnualized}
          sharesOutstanding={fin.sharesOutstanding}
          currentPrice={fin.price}
        />
      </div>
    </div>
  );
}
