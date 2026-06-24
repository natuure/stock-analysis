import { useState, useEffect } from 'react';
import CompanyOverviewView from './CompanyOverviewView';

const SECTIONS = [
  { key: 'overview', label: '기업개요' },
  { key: 'balance',  label: '재무상태표' },
  { key: 'income',   label: '손익계산서' },
  { key: 'cashflow', label: '현금흐름표' },
];

// 비용구조(원재료비/인건비/감가상각비 비중)는 DART API(fnlttSinglAcntAll)가 본문 재무제표만
// 제공하고 주석은 주지 않아 제외함 — 직접 확인(2026-06-24), DATA_PIPELINE.md 참고.
const INCOME_ROWS = [
  { key: 'revenue',   label: '매출액' },
  { key: 'opIncome',  label: '영업이익' },
  { key: 'opMargin',  label: '영업이익률' },
  { key: 'netIncome', label: '당기순이익' },
  { key: 'eps',       label: '주당순이익' },
];

function IncomeStatementView() {
  return (
    <div className="fin-card">
      {INCOME_ROWS.map(row => (
        <div className="fin-row" key={row.key}>
          <span className="fin-label">{row.label}</span>
          <span className="fin-value">-</span>
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

function BalanceSheetView() {
  return (
    <div className="fin-card">
      {BALANCE_ROWS.map(row => (
        <div className="fin-row" key={row.key}>
          <span className="fin-label">{row.label}</span>
          <span className="fin-value">-</span>
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
        <IncomeStatementView />
      ) : active === 'balance' ? (
        <BalanceSheetView />
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
