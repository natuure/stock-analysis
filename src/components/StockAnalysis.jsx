import { useState, useEffect } from 'react';
import { fmtN } from '../utils';
import CompanyOverviewView from './CompanyOverviewView';
import { TrendChart, TREND_PALETTE } from './TrendChart';

const SECTIONS = [
  { key: 'overview', label: '기업개요' },
  { key: 'interest', label: '시장관심도' },
  { key: 'balance',  label: '재무상태표' },
  { key: 'income',   label: '손익계산서' },
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
  // ROE = 당기순이익 / 지배기업소유주지분(분기엔 없어 자본총계로 대체) — 분기도 연환산 안
  // 하고 그 기간 실적 그대로(영업이익률과 같은 방식, 2026-06-27 ROE 라인 추가).
  const marginPeriods = periods.map(p => ({ label: p.label, 영업이익률: ratioOf(p.영업이익, p.매출액) }));
  const roePeriods = periods.map(p => ({ label: p.label, ROE: ratioOf(p.당기순이익, p.지배기업소유주지분 || p.자본총계) }));
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
      <TrendChart type="bar" title="매출액·영업이익·당기순이익 추이 (억원)" periods={amountPeriods} showValues valueFormatter={fmtN} metrics={[
        { key: '매출액',   label: '매출액',   color: TREND_PALETTE[0] },
        { key: '영업이익', label: '영업이익', color: TREND_PALETTE[1] },
        { key: '당기순이익', label: '당기순이익', color: TREND_PALETTE[2] },
      ]} />
      <TrendChart type="bar" title="영업이익률 추이 (%)" periods={marginPeriods} showValues valueFormatter={fmtPct} metrics={[
        { key: '영업이익률', label: '영업이익률', color: TREND_PALETTE[0] },
      ]} />
      <TrendChart type="bar" title="ROE 추이 (%)" periods={roePeriods} showValues valueFormatter={fmtPct} metrics={[
        { key: 'ROE', label: 'ROE', color: TREND_PALETTE[1] },
      ]} />
      <TrendChart type="bar" title="주당순이익 추이 (원)" periods={epsPeriods} showValues valueFormatter={fmtWon} metrics={[
        { key: '주당순이익', label: '주당순이익', color: TREND_PALETTE[2] },
      ]} />
    </div>
  );
}

// "시장관심도" 탭(2026-07-11 도입) — api/getStockMarketInterest.js가 계산한 값을 그대로
// 받아 표시하는 순수 표시 컴포넌트. 데이터 fetch 자체는 StockAnalysis 본체가 담당(아래
// 참고) — companyData가 바뀌거나 이 탭이 처음 열릴 때만 호출하고 결과를 캐싱해 재조회를
// 막는다.
function MarketInterestView({ data }) {
  const { rsHistory, rateTop50, category, categoryTop5 } = data;
  return (
    <div>
      <div className="trend-chart-title">최근 {rsHistory.length}주 RS Score 추이</div>
      {rsHistory.length === 0 ? (
        <div className="tab-placeholder">RS Score 데이터가 아직 없습니다. rs랭킹.py를 먼저 실행해 주세요.</div>
      ) : (
        <div className="cat-trend-wrap">
          <table className="cat-trend-table">
            <thead>
              <tr>
                <th className="cat-trend-rank-col"></th>
                {rsHistory.map(w => (
                  <th key={w.weekKey}>{w.asOfDate ? w.asOfDate.slice(5).replace('-', '/') : w.weekKey}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cat-trend-rank-col">RS Score</td>
                {rsHistory.map(w => (
                  <td key={w.weekKey}>{w.rsScore != null ? w.rsScore.toFixed(1) : '-'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="fin-card">
        <div className="fin-row">
          <span className="fin-label">최근 15거래일 등락률 상위 50 등장</span>
          <span className="fin-value">{rateTop50.count}회</span>
        </div>
        {rateTop50.dates.length > 0 && (
          <div className="fin-dates">{rateTop50.dates.join(', ')}</div>
        )}
      </div>

      <div className="fin-card">
        <div className="fin-row">
          <span className="fin-label">카테고리</span>
          <span className="fin-value">{category || '미분류'}</span>
        </div>
        <div className="fin-row">
          <span className="fin-label">최근 15거래일 등락률 TOP5 카테고리 등장</span>
          <span className="fin-value">{category ? `${categoryTop5.count}회` : '-'}</span>
        </div>
        {categoryTop5.dates.length > 0 && (
          <div className="fin-dates">{categoryTop5.dates.join(', ')}</div>
        )}
      </div>
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
  // 선수금은 회사별로 자본금·자본잉여금·이익잉여금보다 자릿수가 훨씬 작은 경우가 많아(같은
  // 차트에 묶으면 막대가 거의 안 보임) 별도 차트로 분리(2026-06-28, 사용자 요청).
  const capitalPeriods = periods.map(p => ({
    label: p.label,
    자본금:   p.자본금 != null ? p.자본금 / 1e8 : null,
    자본잉여금: p.자본잉여금 != null ? p.자본잉여금 / 1e8 : null,
    이익잉여금: p.이익잉여금 != null ? p.이익잉여금 / 1e8 : null,
  }));
  const advancesPeriods = periods.map(p => ({ label: p.label, 선수금: p.선수금 != null ? p.선수금 / 1e8 : null }));

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
      <TrendChart type="line" title="부채비율 추이 (%)" periods={debtPeriods} showValues valueFormatter={fmtPct} metrics={[
        { key: '부채비율', label: '부채비율', color: TREND_PALETTE[2] },
      ]} />
      <TrendChart type="bar" title="자본금·자본잉여금·이익잉여금 추이 (억원)" periods={capitalPeriods} showValues valueFormatter={fmtN} metrics={[
        { key: '자본금',   label: '자본금',   color: TREND_PALETTE[1] },
        { key: '자본잉여금', label: '자본잉여금', color: TREND_PALETTE[2] },
        { key: '이익잉여금', label: '이익잉여금', color: TREND_PALETTE[3] },
      ]} />
      <TrendChart type="bar" title="선수금 추이 (억원)" periods={advancesPeriods} showValues valueFormatter={fmtN} metrics={[
        { key: '선수금', label: '선수금', color: TREND_PALETTE[0] },
      ]} />
    </div>
  );
}

export default function StockAnalysis({ target }) {
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState('');
  const [companyList, setCompanyList] = useState([]);
  const [companyData, setCompanyData] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | analyzing | notfound | no_report | error
  const [interestData, setInterestData] = useState(null);
  const [interestStatus, setInterestStatus] = useState('idle'); // idle | loading | ready | error

  useEffect(() => {
    fetch('/api/getCompanyOverview')
      .then(r => r.json())
      .then(({ list }) => setCompanyList(list || []))
      .catch(() => {});
  }, []);

  // 거래대금/등락률 표의 "이동" 버튼 클릭(App.jsx의 target prop, 클릭마다 새 객체라 매번
  // 재실행됨) — 그 종목명으로 검색을 그대로 실행하고 기업개요 탭을 보여준다.
  useEffect(() => {
    if (!target) return;
    setQuery(target.name);
    setActive('overview');
    runSearch(target.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // "시장관심도" 탭을 열었을 때만 지연 조회(2026-07-11 도입) — companyData가 이미 있고
  // 아직 이 종목의 시장관심도를 안 받아왔으면(interestData가 없음, runSearch가 새 검색마다
  // null로 초기화해둠) 한 번만 fetch한다. 다른 탭으로 갔다가 다시 돌아와도 같은 종목이면
  // 재조회하지 않음(interestData가 남아있으므로).
  useEffect(() => {
    if (active !== 'interest' || !companyData || interestData) return;
    setInterestStatus('loading');
    fetch(`/api/getStockMarketInterest?code=${companyData.stock_code}&name=${encodeURIComponent(companyData.name)}`)
      .then(r => r.json())
      .then(data => {
        setInterestData(data);
        setInterestStatus('ready');
      })
      .catch(() => setInterestStatus('error'));
  }, [active, companyData, interestData]);

  function runSearch(name) {
    if (!name) return;
    if (status === 'loading' || status === 'analyzing') return; // 중복 제출 가드
    setStatus('loading');
    setInterestData(null); // 이전 종목의 시장관심도 데이터가 잠깐이라도 새 종목에 겹쳐 보이지 않게 초기화
    setInterestStatus('idle');

    // 분석된 종목 목록을 검색 시점에 다시 받아온다 — 마운트 시 한 번만 받아두면, 그 이후
    // 서버에 새로 추가된 종목(주도주분석.py 일괄 실행 등)을 모르고 있다가 이미 분석돼
    // 있는데도 즉석분석(느린 경로)을 타 버리는 문제가 있었음(2026-06-28, 사용자 제보 —
    // "주도주분석.py 미리 돌려놔도 검색이 바로 안 보임"). 즉석분석 경로(analyzeCompany)도
    // 이미 최신이면 재분석 없이 즉시 반환하도록 돼 있어 이중 안전망 역할.
    fetch('/api/getCompanyOverview')
      .then(r => r.json())
      .then(({ list }) => {
        const freshList = list || [];
        setCompanyList(freshList);
        // 대소문자 구분 없이 매칭(2026-07-12) — 정확 일치를 부분일치보다 먼저 확인해야
        // 짧은 회사명이 입력 문자열에 우연히 포함돼 잘못 매칭되는 걸 막는다(find_corp_code()의
        // 대소문자 무시 정확 일치 우선 원칙과 동일, 종목분석.py 참고).
        const nameLower = name.toLowerCase();
        const match = freshList.find(c => c.name.toLowerCase() === nameLower)
          || freshList.find(c => c.name.toLowerCase().includes(nameLower));
        if (match) {
          return fetch(`/api/getCompanyOverview?code=${match.stock_code}`)
            .then(r => r.json())
            .then(({ data }) => {
              setCompanyData(data || null);
              setStatus(data ? 'idle' : 'notfound');
            });
        }

        // 목록에 없으면 서버가 DART+KIS로 직접 즉석 분석한다(Claude 미사용, 2026-06-27 —
        // 더 이상 종목분석.py를 먼저 실행할 필요 없음).
        setStatus('analyzing');
        return fetch(`/api/analyzeCompany?name=${encodeURIComponent(name)}`)
          .then(r => r.json())
          .then(({ data, error }) => {
            if (data) {
              setCompanyData(data);
              // 같은 종목을 다시 검색하면 이 목록에서 매칭돼 기존 getCompanyOverview 경로
              // (실시간 KIS 재조회 포함)를 타게 됨 — 재분석 없이 캐시처럼 동작.
              setCompanyList(list => list.some(c => c.stock_code === data.stock_code)
                ? list
                : [...list, { name: data.name, stock_code: data.stock_code }]);
              setStatus('idle');
            } else if (error === 'not_found') {
              setStatus('notfound');
            } else if (error === 'no_report') {
              setStatus('no_report');
            } else {
              setStatus('error');
            }
          });
      })
      .catch(() => setStatus('error'));
  }

  function handleSearch(e) {
    e.preventDefault();
    runSearch(query.trim());
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
      {status === 'analyzing' && (
        <div className="stock-search-msg">
          분석 중입니다... DART·KIS에서 직접 조회하므로 최대 1~2분 정도 걸릴 수 있어요.
        </div>
      )}
      {status === 'notfound' && (
        <div className="stock-search-msg">
          DART 상장사 목록에서 종목을 찾지 못했습니다. 정식 회사명을 확인해 주세요.
        </div>
      )}
      {status === 'no_report' && (
        <div className="stock-search-msg">
          재무제표 공시가 없는 종목입니다(최근 상장 등). 분석할 수 없습니다.
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
      ) : active === 'interest' ? (
        !companyData ? (
          <div className="tab-placeholder">종목을 검색하세요</div>
        ) : interestStatus === 'loading' ? (
          <div className="tab-placeholder">불러오는 중...</div>
        ) : interestStatus === 'error' ? (
          <div className="tab-placeholder">조회 중 오류가 발생했습니다.</div>
        ) : interestData ? (
          <MarketInterestView data={interestData} />
        ) : (
          <div className="tab-placeholder">불러오는 중...</div>
        )
      ) : (
        <div className="tab-placeholder">항목을 선택하세요</div>
      )}
    </div>
  );
}
