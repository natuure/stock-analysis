import { useState, useRef, useCallback } from 'react';
import Header from './components/Header';
import Calendar from './components/Calendar';
import Upload from './components/Upload';
import Cards from './components/Cards';
import Analysis from './components/Analysis';
import Tables from './components/Tables';
import Toast from './components/Toast';
import {
  parseCombinedExcel, parseAnalysisExcel, normVol, normRate,
  fileDate, fileDateFromName, dateToISO,
  lsSet,
  saveAnalysisToStorage, loadAnalysisFromStorage,
  saveWeeklyToStorage, loadWeeklyFromStorage, weekKeyFromDate,
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

  const [aiAnalysis,      setAiAnalysis]      = useState(null);
  const [toast,           setToast]           = useState('');
  const [fetchingSectors, setFetchingSectors] = useState(false);

  const volRef          = useRef(null);
  const rateRef         = useRef(null);
  const dateRef         = useRef(null);
  const analysisExcelRef = useRef(null);

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
      saveAnalysisToStorage(iso, {
        vol: mergedVol, rate: mergedRate, sectors: newSectors,
        date: currentDate, analysisExcel: analysisExcelRef.current,
      });
      setCalSelected(iso);
      fetchAiAnalysis(iso);
    } catch (e) {
      console.warn('업종 로딩 실패:', e.message);
    } finally {
      setFetchingSectors(false);
    }
  }

  async function handleDataFile(file) {
    try {
      const { volRows, rateRows } = await parseCombinedExcel(file);
      const newVol  = normVol(volRows);
      const newRate = normRate(rateRows);
      const newDate = fileDateFromName(file.name) || dateRef.current || fileDate(file.lastModified);
      volRef.current  = newVol;
      rateRef.current = newRate;
      dateRef.current = newDate;
      setVol(newVol);
      setRate(newRate);
      setDate(newDate);
      triggerSectorFetch(newVol, newRate, newDate);
    } catch (e) {
      showToast('데이터 파일 오류: ' + e.message);
      throw e;
    }
  }

  async function handleWeeklyFile(file) {
    try {
      const rows = await parseAnalysisExcel(file);
      const d = new Date(file.lastModified);
      const weekKey = weekKeyFromDate(d);
      saveWeeklyToStorage(weekKey, rows);
      showToast(`주간 요약 저장 완료 (${weekKey})`);
    } catch (e) {
      showToast('주간 파일 오류: ' + e.message);
      throw e;
    }
  }

  async function handleAnalysisFile(file) {
    try {
      const rows = await parseAnalysisExcel(file);
      analysisExcelRef.current = rows;
      setAnalysisExcel(rows);
      // 현재 날짜 저장본에 분석 파일도 포함
      if (dateRef.current) {
        const iso = dateToISO(dateRef.current);
        const saved = loadAnalysisFromStorage(iso);
        if (saved) lsSet(`analysis_${iso}`, JSON.stringify({ ...saved, analysisExcel: rows }));
      }
    } catch (e) {
      showToast('분석 파일 오류: ' + e.message);
      throw e;
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
    if (!data) return;
    const mergedVol  = data.vol.map(s => ({ ...s, sector: (data.sectors || {})[s.code] || '' }));
    const mergedRate = data.rate.map(s => ({ ...s, sector: (data.sectors || {})[s.code] || '' }));
    volRef.current          = mergedVol;
    rateRef.current         = mergedRate;
    dateRef.current         = data.date;
    analysisExcelRef.current = data.analysisExcel || null;
    setVol(mergedVol);
    setRate(mergedRate);
    setSectors(data.sectors || {});
    setDate(data.date);
    setAnalysisExcel(data.analysisExcel || null);
    setAiAnalysis(null);
    setCalSelected(dateISO);
    fetchAiAnalysis(dateISO);
  }

  function handleSort(key, col) {
    const st   = key === 'v' ? sortV : sortR;
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

      <Upload onDataFile={handleDataFile} onAnalysisFile={handleAnalysisFile} onWeeklyFile={handleWeeklyFile} />
      <Toast message={toast} />
    </div>
  );
}
