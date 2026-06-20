import { useState, useRef, useEffect } from 'react';
import Header from './components/Header';
import TopTabs from './components/TopTabs';
import Calendar from './components/Calendar';
import Cards from './components/Cards';
import IndexSummary from './components/IndexSummary';
import Analysis from './components/Analysis';
import Tables from './components/Tables';
import StockDetailModal from './components/StockDetailModal';
import {
  dateToISO, CACHE_VERSION,
  saveAnalysisToStorage, loadAnalysisFromStorage,
  loadWeeklyFromStorage, weeklyIndexMap,
} from './utils';

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

  const [aiAnalysis,  setAiAnalysis]  = useState(null);
  const [serverDates, setServerDates] = useState([]);
  const [weeklyIdx,   setWeeklyIdx]   = useState({});
  const [weekSelected, setWeekSelected] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);

  const volRef  = useRef(null);
  const rateRef = useRef(null);
  const dateRef = useRef(null);

  useEffect(() => {
    fetch('/api/getData')
      .then(r => r.json())
      .then(({ dates }) => { if (dates) setServerDates(dates); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    Promise.all([
      fetch(`/api/candles?symbol=0001&date=${todayISO}&period=W&market=index`).then(r => r.json()),
      fetch(`/api/candles?symbol=1001&date=${todayISO}&period=W&market=index`).then(r => r.json()),
    ]).then(([kospiRes, kosdaqRes]) => {
      const kospiMap  = weeklyIndexMap(kospiRes.candles  || []);
      const kosdaqMap = weeklyIndexMap(kosdaqRes.candles || []);
      const merged = {};
      for (const k of new Set([...Object.keys(kospiMap), ...Object.keys(kosdaqMap)])) {
        merged[k] = { kospi: kospiMap[k], kosdaq: kosdaqMap[k] };
      }
      setWeeklyIdx(merged);
    }).catch(() => {});
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
            onWeekClick={(weekKey) => {
              const data = loadWeeklyFromStorage(weekKey);
              if (data) setAnalysisExcel(data.rows);
              const idx = weeklyIdx[weekKey];
              setWeekSelected(idx && idx.kospi && idx.kosdaq ? weekKey : null);
            }}
          />
          {(weekData || (showMain && indices)) && (
            <IndexSummary
              indices={weekData || indices}
              title={weekData ? '금주의 코스피/코스닥' : '오늘의 코스피/코스닥'}
            />
          )}
          {showMain && (
            <main>
              <Cards vol={vol} rate={rate} />
              <Analysis analysisExcel={analysisExcel} aiAnalysis={aiAnalysis} />
              <h2 className="sec-title" style={{ marginTop: 36 }}>종목 데이터</h2>
              <Tables
                vol={vol} rate={rate}
                sortV={sortV} sortR={sortR}
                tab={tab}
                onSort={handleSort}
                onTab={setTab}
                onRowClick={setSelectedStock}
              />
            </main>
          )}
        </>
      )}
      {topTab === 'stock'    && <div className="tab-placeholder">종목 분석 — 준비 중입니다</div>}
      {topTab === 'screener' && <div className="tab-placeholder">조건 검색 — 준비 중입니다</div>}

      <StockDetailModal
        open={!!selectedStock}
        code={selectedStock?.code}
        name={selectedStock?.name}
        dateISO={dateToISO(date)}
        onClose={() => setSelectedStock(null)}
      />
    </div>
  );
}
