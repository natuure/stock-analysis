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

