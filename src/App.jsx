import { useState, useRef, useCallback } from 'react';
import Header from './components/Header';
import Calendar from './components/Calendar';
import Upload from './components/Upload';
import Cards from './components/Cards';
import Analysis from './components/Analysis';
import Tables from './components/Tables';
import Toast from './components/Toast';
import {
  parseExcel, normVol, normRate,
  fileDate, fileDateFromName, dateToISO,
  lsSet,
  saveAnalysisToStorage, loadAnalysisFromStorage,
} from './utils';
import { fetchSectors, callAnalysis } from './api';

export default function App() {
  const [vol,     setVol]     = useState(null);
  const [rate,    setRate]    = useState(null);
  const [sectors, setSectors] = useState({});
  const [date,    setDate]    = useState(null);

  const [calYear,     setCalYear]     = useState(() => new Date().getFullYear());
  const [calMonth,    setCalMonth]    = useState(() => new Date().getMonth());
  const [calSelected, setCalSelected] = useState(null);

  const [sortV, setSortV] = useState({ col: 'rank', dir: 'asc' });
  const [sortR, setSortR] = useState({ col: 'rank', dir: 'asc' });
  const [tab,   setTab]   = useState('v');

  const [settingsOpen,   setSettingsOpen]   = useState(false);
  const [toast,          setToast]          = useState('');
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [fetchingSectors, setFetchingSectors] = useState(false);

  // Refs to avoid stale closures in async handlers
  const volRef  = useRef(null);
  const rateRef = useRef(null);
  const dateRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  }, []);

  async function triggerSectorFetch(currentVol, currentRate, currentDate) {
    const codes = [...new Set([...currentVol.map(s => s.code), ...currentRate.map(s => s.code)])];
    setFetchingSectors(true);
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
      saveAnalysisToStorage(iso, { vol: mergedVol, rate: mergedRate, sectors: newSectors, date: currentDate });
      setCalSelected(iso);
    } catch (e) {
      console.warn('업종 로딩 실패:', e.message);
    } finally {
      setFetchingSectors(false);
    }
  }

  async function handleVolFile(file) {
    try {
      const rows    = await parseExcel(file, '거래대금');
      const newVol  = normVol(rows);
      const newDate = fileDateFromName(file.name) || dateRef.current || fileDate(file.lastModified);
      volRef.current  = newVol;
      dateRef.current = newDate;
      setVol(newVol);
      setDate(newDate);
      if (rateRef.current) triggerSectorFetch(newVol, rateRef.current, newDate);
    } catch (e) {
      showToast('거래대금 파일 오류: ' + e.message);
      throw e;
    }
  }

  async function handleRateFile(file) {
    try {
      const rows    = await parseExcel(file, '등락률');
      const newRate = normRate(rows);
      const nameDate = fileDateFromName(file.name);
      const newDate  = nameDate || dateRef.current || fileDate(file.lastModified);
      rateRef.current = newRate;
      dateRef.current = newDate;
      setRate(newRate);
      setDate(newDate);
      if (volRef.current) triggerSectorFetch(volRef.current, newRate, newDate);
    } catch (e) {
      showToast('등락률 파일 오류: ' + e.message);
      throw e;
    }
  }

  function loadAnalysis(dateISO) {
    const data = loadAnalysisFromStorage(dateISO);
    if (!data) return;
    const mergedVol  = data.vol.map(s => ({ ...s, sector: (data.sectors || {})[s.code] || '' }));
    const mergedRate = data.rate.map(s => ({ ...s, sector: (data.sectors || {})[s.code] || '' }));
    volRef.current  = mergedVol;
    rateRef.current = mergedRate;
    dateRef.current = data.date;
    setVol(mergedVol);
    setRate(mergedRate);
    setSectors(data.sectors || {});
    setDate(data.date);
    setCalSelected(dateISO);
    setAnalysisResult(null);
  }

  async function startAnalysis() {
    setAnalyzeLoading(true);
    setAnalysisResult(null);
    try {
      const text = await callAnalysis(vol, rate, dateToISO(date));
      const m = text.match(/\{[\s\S]+\}/);
      setAnalysisResult(m ? JSON.parse(m[0]) : null);
    } catch (e) {
      showToast('오류: ' + e.message);
    } finally {
      setAnalyzeLoading(false);
    }
  }

  function handleSort(key, col) {
    const st  = key === 'v' ? sortV : sortR;
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

  function scrollToUpload() {
    document.querySelector('.upload-section')?.scrollIntoView({ behavior: 'smooth' });
  }

  const showMain = !!(vol && rate);

  return (
    <div className="wrap">
      <Header date={date} />
      <Calendar
        year={calYear} month={calMonth} selected={calSelected}
        onMove={calMove}
        onDayClick={loadAnalysis}
        onNoDataClick={scrollToUpload}
      />
      <Upload onVolFile={handleVolFile} onRateFile={handleRateFile} />

      {showMain && (
        <main>
          <Cards vol={vol} rate={rate} fetchingSectors={fetchingSectors} />
          <Analysis
            vol={vol} rate={rate}
            loading={analyzeLoading}
            result={analysisResult}
            onStart={startAnalysis}
          />
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

      <Toast message={toast} />
    </div>
  );
}
