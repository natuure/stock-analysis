export async function fetchSectors(codes, dateStr) {
  try {
    const res = await fetch('/api/getSectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, date: dateStr }),
    });
    if (res.ok) return res.json();
  } catch (e) {
    console.warn('업종 로딩 실패:', e.message);
  }
  return {};
}

export async function callAnalysis(volumeStocks, rateStocks, date) {
  const res = await fetch('/api/analyzeStocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      volumeStocks: volumeStocks.slice(0, 30).map(s => ({ name: s.name, changeRate: s.changeRate })),
      rateStocks:   rateStocks.slice(0, 30).map(s => ({ name: s.name, changeRate: s.changeRate })),
      date,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '분석 실패');
  return data.analysis;
}
