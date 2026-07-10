import * as XLSX from 'xlsx';

export const ls    = (k)    => localStorage.getItem(k) || '';
export const lsSet = (k, v) => localStorage.setItem(k, v);
export const str   = (v)    => String(v || '').trim();

export function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/[,\s]/g, '')) || 0;
}
export function toInt(v)   { return parseInt(String(v || '').replace(/,/g, '')) || 0; }
export function toRate(v) {
  if (v === null || v === undefined || v === '') return 0;
  return parseFloat(String(v).replace(/[%,\s]/g, '')) || 0;
}
export function toPrevRank(v) {
  const s = String(v || '').trim();
  if (!s || s === '-' || ['신규', 'NEW', 'N/A', '0'].includes(s)) return null;
  const n = parseInt(s);
  return isNaN(n) || n <= 0 ? null : n;
}
export function toChange(changeVal, changeRate) {
  const raw = String(changeVal || '').replace(/[,\s]/g, '');
  if (raw.startsWith('+') || raw.startsWith('-')) return parseFloat(raw) || 0;
  const abs = parseFloat(raw) || 0;
  return changeRate < 0 ? -abs : abs;
}
export function toCode(v) {
  return String(v || '').replace(/\D/g, '').padStart(6, '0');
}
export function fmtN(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return Math.round(Number(n)).toLocaleString('ko-KR');
}
export function rc(r) { return r > 0 ? 'up' : r < 0 ? 'down' : 'flat'; }

export function fileDate(ts) {
  const d = new Date(ts);
  const w = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${w[d.getDay()]})`;
}
export function fileDateFromName(filename) {
  const m = filename.match(/_(\d{6})(?:\.|_|$)/);
  if (!m) return null;
  const s = m[1];
  const year = 2000 + parseInt(s.slice(0, 2));
  const mo   = parseInt(s.slice(2, 4));
  const dd   = parseInt(s.slice(4, 6));
  const d = new Date(year, mo - 1, dd);
  if (isNaN(d.getTime()) || mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  const w = ['일', '월', '화', '수', '목', '금', '토'];
  return `${year}년 ${mo}월 ${dd}일 (${w[d.getDay()]})`;
}
export function dateToISO(str) {
  if (!str) return new Date().toISOString().slice(0, 10);
  const m = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return new Date().toISOString().slice(0, 10);
}

function toRows(ws) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let hi = 0;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const r = raw[i].map(c => String(c).trim());
    if (r.includes('순위') && r.includes('종목명')) { hi = i; break; }
  }
  const hdrs = raw[hi].map(c => String(c).trim());
  return raw.slice(hi + 1).map(row => {
    const obj = {};
    hdrs.forEach((h, i) => { if (h) obj[h] = row[i]; });
    return obj;
  });
}

export function parseExcel(file, sheetName) {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        let ws = wb.Sheets[sheetName];
        if (!ws) {
          const found = wb.SheetNames.find(n => n.includes(sheetName.slice(0, 2)));
          ws = wb.Sheets[found || wb.SheetNames[0]];
        }
        ok(toRows(ws));
      } catch (err) { fail(err); }
    };
    reader.onerror = () => fail(new Error('파일 읽기 실패'));
    reader.readAsBinaryString(file);
  });
}

export function parseCombinedExcel(file) {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const getSheet = (name) => {
          if (wb.Sheets[name]) return wb.Sheets[name];
          const found = wb.SheetNames.find(n => n.includes(name.slice(0, 2)));
          return wb.Sheets[found] || null;
        };
        const volSheet  = getSheet('거래대금') || wb.Sheets[wb.SheetNames[0]];
        const rateSheet = getSheet('등락률')   || wb.Sheets[wb.SheetNames[1]];
        if (!volSheet)  throw new Error("'거래대금' 시트를 찾을 수 없습니다.");
        if (!rateSheet) throw new Error("'등락률' 시트를 찾을 수 없습니다.");
        ok({ volRows: toRows(volSheet), rateRows: toRows(rateSheet) });
      } catch (err) { fail(err); }
    };
    reader.onerror = () => fail(new Error('파일 읽기 실패'));
    reader.readAsBinaryString(file);
  });
}

export function parseAnalysisExcel(file) {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) return ok([]);
        const headers = raw[0].map(h => String(h).trim()).filter(Boolean);
        const rows = raw.slice(1)
          .map(row => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = String(row[i] ?? '').trim(); });
            return obj;
          })
          .filter(row => Object.values(row).some(v => v));
        ok(rows);
      } catch (err) { fail(err); }
    };
    reader.onerror = () => fail(new Error('파일 읽기 실패'));
    reader.readAsBinaryString(file);
  });
}

export function normVol(rows) {
  return rows.map(r => {
    const rank = toInt(r['순위']);
    if (!rank) return null;
    const cr = toRate(r['등락률']);
    return {
      rank, prevRank: toPrevRank(r['전일']),
      code: toCode(r['종목코드']),
      name: str(r['종목명']),
      price: toNum(r['현재가']),
      change: toChange(r['대비'], cr),
      changeRate: cr,
      volume: toNum(r['거래량']),
      marketCap: toNum(r['시가총액']),
      tradingVolume: toNum(r['거래대금']),
    };
  }).filter(r => r && r.name);
}

export function normRate(rows) {
  return rows.map(r => {
    const rank = toInt(r['순위']);
    if (!rank) return null;
    const cr = toRate(r['등락률']);
    return {
      rank,
      code: toCode(r['종목코드']),
      name: str(r['종목명']),
      price: toNum(r['현재가']),
      change: toChange(r['대비'], cr),
      changeRate: cr,
      isUpperLimit: String(r['대비'] || '').includes('↑'),
      volume: toNum(r['거래량']),
    };
  }).filter(r => r && r.name);
}

export function saveWeeklyToStorage(weekKey, rows) {
  lsSet(`weekly_${weekKey}`, JSON.stringify({ rows, weekKey }));
  const dates = JSON.parse(ls('weekly_dates') || '[]');
  if (!dates.includes(weekKey)) {
    dates.unshift(weekKey);
    lsSet('weekly_dates', JSON.stringify(dates));
  }
}

export function loadWeeklyFromStorage(weekKey) {
  const raw = ls(`weekly_${weekKey}`);
  return raw ? JSON.parse(raw) : null;
}

// stock_data 문서 스키마가 바뀔 때마다 올려서, 옛 캐시를 무효화하고 서버에서 다시 받아오게 한다.
export const CACHE_VERSION = 9;

export function saveAnalysisToStorage(dateISO, data) {
  lsSet(`analysis_${dateISO}`, JSON.stringify({ ...data, _v: CACHE_VERSION }));
  const dates = JSON.parse(ls('analysis_dates') || '[]');
  if (!dates.includes(dateISO)) {
    dates.unshift(dateISO);
    lsSet('analysis_dates', JSON.stringify(dates));
  }
}

export function loadAnalysisFromStorage(dateISO) {
  const raw = ls(`analysis_${dateISO}`);
  return raw ? JSON.parse(raw) : null;
}
