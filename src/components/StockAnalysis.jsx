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
function fmtEok(n) { return n == null ? '-' : `${fmtN(n / 1e8)}억원`; }
function fmtWon(n) { return n == null ? '-' : `${fmtN(n)}원`; }
function fmtPct(n) { return n == null || !isFinite(n) ? '-' : `${n.toFixed(2)}%`; }
function ratioOf(num, base) { return (num != null && base) ? (num / base) * 100 : null; }

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
  return (
    <div className="fin-card">
      {INCOME_ROWS.map(row => (
        <div className="fin-row" key={row.key}>
          <span className="fin-label">{row.label}</span>
          <span className="fin-value">{values[row.key]}</span>
        </div>
      ))}
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
  return (
    <div className="fin-card">
      {BALANCE_ROWS.map(row => (
        <div className="fin-row" key={row.key}>
          <span className="fin-label">{row.label}</span>
          <span className="fin-value">{values[row.key]}</span>
        </div>
      ))}
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
