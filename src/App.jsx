import { useState, useRef, useEffect } from 'react';
import Header from './components/Header';
import TopTabs from './components/TopTabs';
import Calendar from './components/Calendar';
import IndexSummary from './components/IndexSummary';
import Analysis, { CategoryPieCarousel } from './components/Analysis';
import Tables from './components/Tables';
import StockAnalysis from './components/StockAnalysis';
import {
  dateToISO, CACHE_VERSION,
  saveAnalysisToStorage, loadAnalysisFromStorage,
} from './utils';

// 주간 vol/rate 항목(주간분석.py가 그 주 일간 ai_analysis에서 찾은 카테고리를 name 옆에
// 바로 채워둠)을 CategoryPieCarousel이 기대하는 aiAnalysis.거래대금/등락률 모양
// (종목명+카테고리)으로 바꾼다 — 일간처럼 별도 ai_analysis 문서가 없으므로 그 자리를
// 주간 항목 자신으로 대신한다. 카테고리가 없는 항목(그 주 어느 날의 일간 상위 50에도
// 없었던 종목)은 빼서, aggregateByCategory()가 일간과 동일하게 '기타'로 폴백하게 한다.
function toWeeklyAiItems(items) {
  return (items || [])
    .filter(s => s.카테고리)
    .map(s => ({ 종목명: s.name, 카테고리: s.카테고리, 신규카테고리후보: s.신규카테고리후보 }));
}

export default function App() {
  const [vol,     setVol]     = useState(null);
  const [rate,    setRate]    = useState(null);
  const [date,    setDate]    = useState(null);
  const [indices, setIndices] = useState(null);
  const [analysisExcel, setAnalysisExcel] = useState(null);

  const [calYear,     setCalYear]     = useState(() => new Date().getFullYear());
  const [calMonth,    setCalMonth]    = useState(() => new Date().getMonth());
  const [calSelected, setCalSelected] = useState(null);

  const [sortV, setSortV] = useState({ col: 'rank', dir: 'asc' });
  const [sortR, setSortR] = useState({ col: 'rank', dir: 'asc' });
  const [tab,   setTab]   = useState('v');

  const [topTab, setTopTab] = useState('main');
  const [stockJumpTarget, setStockJumpTarget] = useState(null);

  const [aiAnalysis,  setAiAnalysis]  = useState(null);
  const [serverDates, setServerDates] = useState([]);
  const [weeklyIdx,   setWeeklyIdx]   = useState({});
  const [weekSelected, setWeekSelected] = useState(null);
  const [weekVolRate, setWeekVolRate] = useState(null); // 선택한 주차의 {vol, rate} 또는 null
  const [themeTrend,  setThemeTrend]  = useState(null);

  const volRef  = useRef(null);
  const rateRef = useRef(null);
  const dateRef = useRef(null);

  useEffect(() => {
    fetch('/api/getData')
      .then(r => r.json())
      .then(({ dates, weeklyIndices }) => {
        if (dates) setServerDates(dates);
        if (weeklyIndices) setWeeklyIdx(weeklyIndices);
      })
      .catch(() => {});

    // 최근 거래대금 카테고리 TOP5 추이 — 캘린더에서 어느 날짜를 골랐는지와 무관한 "현재
    // 펄스"라 날짜 선택과 별개로 앱이 뜰 때 한 번만 가져온다. 종목별 카테고리가 없는
    // 과거 날짜가 섞여 있어도 표시 가능한 날짜를 15개 넉넉히 확보하려고 30일 요청
    // (2026-06-28, DATA_PIPELINE.md 참고).
    fetch('/api/getThemeTrend?days=30')
      .then(r => r.json())
      .then(({ days }) => setThemeTrend(days || []))
      .catch(() => {});
  }, []);

  async function fetchAiAnalysis(dateISO) {
    try {
      const r = await fetch(`/api/getAnalysis?date=${dateISO}`);
      if (!r.ok) return;
      const { analysis } = await r.json();
      if (analysis) setAiAnalysis(analysis);
    } catch { /* 네트워크 오류 시 무시 */ }
  }

  function loadAnalysis(dateISO) {
    setWeekSelected(null);
    const data = loadAnalysisFromStorage(dateISO);
    if (data && data._v === CACHE_VERSION) {
      volRef.current  = data.vol;
      rateRef.current = data.rate;
      dateRef.current = data.date;
      setVol(data.vol);
      setRate(data.rate);
      setDate(data.date);
      setIndices(data.indices || null);
      setAnalysisExcel(data.analysisExcel || null);
      setAiAnalysis(null);
      setCalSelected(dateISO);
      fetchAiAnalysis(dateISO);
      return;
    }
    // localStorage에 없으면 MongoDB에서 로드
    fetch(`/api/getData?date=${dateISO}`)
      .then(r => r.json())
      .then(({ vol, rate, date, indices }) => {
        if (!vol) return;
        volRef.current  = vol;
        rateRef.current = rate;
        dateRef.current = date;
        setVol(vol);
        setRate(rate);
        setDate(date);
        setIndices(indices || null);
        setAnalysisExcel(null);
        setAiAnalysis(null);
        setCalSelected(dateISO);
        saveAnalysisToStorage(dateISO, { vol, rate, date, indices });
        fetchAiAnalysis(dateISO);
      })
      .catch(() => {});
  }

  function handleSort(key, col) {
    const st    = key === 'v' ? sortV : sortR;
    const setSt = key === 'v' ? setSortV : setSortR;
    setSt({
      col,
      dir: st.col === col ? (st.dir === 'asc' ? 'desc' : 'asc') : (col === 'rank' ? 'asc' : 'desc'),
    });
  }

  // 거래대금·등락률 표의 "이동" 버튼 — 종목 분석 탭으로 전환하고 그 종목을 바로 검색한다.
  // 매번 새 객체를 만들어야 같은 종목을 연달아 눌러도 StockAnalysis의 useEffect가 다시 실행됨.
  function jumpToStockAnalysis(name) {
    setStockJumpTarget({ name, ts: Date.now() });
    setTopTab('stock');
  }

  function calMove(dir) {
    setCalMonth(m => {
      const nm = m + dir;
      if (nm > 11) { setCalYear(y => y + 1); return 0; }
      if (nm < 0)  { setCalYear(y => y - 1); return 11; }
      return nm;
    });
  }

  const showMain = !!(vol && rate);
  const weekIdx  = weekSelected ? weeklyIdx[weekSelected] : null;
  const weekData = weekIdx && weekIdx.kospi && weekIdx.kosdaq ? weekIdx : null;

  return (
    <div className="wrap">
      <div className="app-top">
        <Header date={date} />
        <TopTabs active={topTab} onChange={setTopTab} />
      </div>

      {topTab === 'main' && (
        <>
          <Calendar
            year={calYear} month={calMonth} selected={calSelected}
            onMove={calMove}
            onDayClick={loadAnalysis}
            serverDates={serverDates}
            weeklyIdx={weeklyIdx}
            weekSelected={weekSelected}
            onWeekClick={(weekKey) => {
              setVol(null); setRate(null); setDate(null);
              setIndices(null); setAnalysisExcel(null); setAiAnalysis(null);
              setCalSelected(null);
              const idx = weeklyIdx[weekKey];
              const valid = idx && idx.kospi && idx.kosdaq ? weekKey : null;
              setWeekSelected(valid);
              setWeekVolRate(null); // 이전 주차의 표를 먼저 지움(전환 중 잔존 데이터 방지)
              if (valid) {
                fetch(`/api/getData?week=${weekKey}`)
                  .then(r => r.json())
                  .then(({ vol, rate }) => {
                    if (vol && rate) setWeekVolRate({ vol, rate });
                  })
                  .catch(() => {});
              }
            }}
          />
          {(weekData || (showMain && indices)) && (
            <IndexSummary
              indices={weekData || indices}
              title={weekData ? '금주의 코스피/코스닥' : '오늘의 코스피/코스닥'}
            />
          )}
          {weekData && weekVolRate && (
            <main>
              <CategoryPieCarousel
                vol={weekVolRate.vol} rate={weekVolRate.rate}
                aiAnalysis={{
                  거래대금: toWeeklyAiItems(weekVolRate.vol),
                  등락률: toWeeklyAiItems(weekVolRate.rate),
                }}
                date={weekIdx?.lastTradingDate}
              />
              <h2 className="sec-title" style={{ marginTop: 36 }}>주간 종목 데이터</h2>
              <Tables
                vol={weekVolRate.vol} rate={weekVolRate.rate}
                sortV={sortV} sortR={sortR}
                tab={tab}
                onSort={handleSort}
                onTab={setTab}
                dateISO={weekIdx?.lastTradingDate}
                onJumpToStock={jumpToStockAnalysis}
                showHigh60Rate={false}
                showCategory
              />
            </main>
          )}
          {showMain && (
            <main>
              <Analysis analysisExcel={analysisExcel} aiAnalysis={aiAnalysis} themeTrend={themeTrend} vol={vol} rate={rate} date={dateToISO(date)} />
              <h2 className="sec-title" style={{ marginTop: 36 }}>종목 데이터</h2>
              <Tables
                vol={vol} rate={rate}
                sortV={sortV} sortR={sortR}
                tab={tab}
                onSort={handleSort}
                onTab={setTab}
                dateISO={dateToISO(date)}
                onJumpToStock={jumpToStockAnalysis}
              />
            </main>
          )}
        </>
      )}
      {topTab === 'stock'    && <StockAnalysis target={stockJumpTarget} />}
      {topTab === 'screener' && <div className="tab-placeholder">조건 검색 — 준비 중입니다</div>}
    </div>
  );
}
