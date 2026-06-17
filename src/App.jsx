import { useState, useRef, useEffect } from 'react';
import Header from './components/Header';
import Calendar from './components/Calendar';
import Cards from './components/Cards';
import Analysis from './components/Analysis';
import Tables from './components/Tables';
import {
  dateToISO,
  saveAnalysisToStorage, loadAnalysisFromStorage,
  loadWeeklyFromStorage,
} from './utils';
import { fetchSectors } from './api';

export default function App() {
  const [vol,     setVol]     = useState(null);
  const [rate,    setRate]    = useState(null);
  const [sectors, setSectors] = useState({});
  const [date,    setDate]    = useState(null);
  const [analysisExcel, setAnalysisExcel] = useState(null);

  const [calYear,     setCalYear]     = useState(() => new Date().getFullYear());
  const [calMonth,    setCalMonth]    = useState(() => new Date().getMonth());
  const [calSelected, setCalSelected] = useState(null);

  const [sortV, setSortV] = useState({ col: 'rank', dir: 'asc' });
  const [sortR, setSortR] = useState({ col: 'rank', dir: 'asc' });
  const [tab,   setTab]   = useState('v');

  const [aiAnalysis,  setAiAnalysis]  = useState(null);
  const [serverDates, setServerDates] = useState([]);

  const volRef  = useRef(null);
  const rateRef = useRef(null);
  const dateRef = useRef(null);

  useEffect(() => {
    fetch('/api/getData')
      .then(r => r.json())
      .then(({ dates }) => { if (dates) setServerDates(dates); })
      .catch(() => {});
  }, []);

  async function triggerSectorFetch(currentVol, currentRate, currentDate) {
    const codes = [...new Set([...currentVol.map(s => s.code), ...currentRate.map(s => s.code)])];
    try {
      const newSectors = await fetchSectors(codes, dateToISO(currentDate));
      const mergedVol  = currentVol.map(s => ({ ...s, sector: newSectors[s.code] || '' }));
      const mergedRate = currentRate.map(s => ({ ...s, sector: newSectors[s.code] || '' }));
      setVol(mergedVol);
      setRate(mergedRate);
      setSectors(newSectors);
      volRef.current  = mergedVol;
      rateRef.current = mergedRate;
      const iso = dateToISO(currentDate);
      saveAnalysisToStorage(iso, {
        vol: mergedVol, rate: mergedRate, sectors: newSectors, date: currentDate,
      });
      setCalSelected(iso);
      fetchAiAnalysis(iso);
    } catch (e) {
      console.warn('업종 로딩 실패:', e.message);
    }
  }

  async function fetchAiAnalysis(dateISO) {
    try {
      const r = await fetch(`/api/getAnalysis?date=${dateISO}`);
      if (!r.ok) return;
      const { analysis } = await r.json();
      if (analysis) setAiAnalysis(analysis);
    } catch { /* 네트워크 오류 시 무시 */ }
  }

  function loadAnalysis(dateISO) {
    const data = loadAnalysisFromStorage(dateISO);
    if (data) {
      const mergedVol  = data.vol.map(s => ({ ...s, sector: (data.sectors || {})[s.code] || '' }));
      const mergedRate = data.rate.map(s => ({ ...s, sector: (data.sectors || {})[s.code] || '' }));
      volRef.current  = mergedVol;
      rateRef.current = mergedRate;
      dateRef.current = data.date;
      setVol(mergedVol);
      setRate(mergedRate);
      setSectors(data.sectors || {});
      setDate(data.date);
      setAnalysisExcel(data.analysisExcel || null);
      setAiAnalysis(null);
      setCalSelected(dateISO);
      fetchAiAnalysis(dateISO);
      return;
    }
    // localStorage에 없으면 MongoDB에서 로드
    fetch(`/api/getData?date=${dateISO}`)
      .then(r => r.json())
      .then(({ vol, rate, date }) => {
        if (!vol) return;
        volRef.current  = vol;
        rateRef.current = rate;
        dateRef.current = date;
        setVol(vol);
        setRate(rate);
        setDate(date);
        setAnalysisExcel(null);
        setAiAnalysis(null);
        setCalSelected(dateISO);
        triggerSectorFetch(vol, rate, date);
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

  return (
    <div className="wrap">
      <Header date={date} />
      <Calendar
        year={calYear} month={calMonth} selected={calSelected}
        onMove={calMove}
        onDayClick={loadAnalysis}
        serverDates={serverDates}
        onWeekClick={(weekKey) => {
          const data = loadWeeklyFromStorage(weekKey);
          if (data) setAnalysisExcel(data.rows);
        }}
      />
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
          />
        </main>
      )}
    </div>
  );
}
