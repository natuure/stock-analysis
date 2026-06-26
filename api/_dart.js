// DART Open API 재무제표 수집 — 종목분석.py(51~373행)의 1:1 JS 포팅.
// 후보 계정명 문자열은 실제 DART 데이터에서 발견한 버그 수정의 결과물이라 한 글자도 바꾸지
// 않고 그대로 옮긴다(DATA_PIPELINE.md의 "계정명이 보고서·기업마다 다름" 절 참고).
const DART_BASE = 'https://opendart.fss.or.kr/api';

const NET_INCOME_NAMES = [
  '당기순이익', '당기순이익(손실)', '분기순이익', '분기순이익(손실)', '반기순이익', '반기순이익(손실)',
  '당기순손익',
];
// sj_div='BS'로 한정해야 함 — 노바렉스에서 직접 확인한 CIS 충돌 버그(종목분석.py 55~60행 참고).
const PARENT_EQUITY_NAMES = [
  '지배기업의 소유주에게 귀속되는 자본', '지배기업소유주지분', '지배기업 소유주지분',
  '지배기업의 소유주지분', '지배기업의 소유지분',
];
const ACCOUNTS_RECEIVABLE_NAMES = ['매출채권', '매출채권및기타채권', '매출채권 및 기타채권', '매출채권 및 기타유동채권'];
const INVENTORY_NAMES = ['재고자산', '유동재고자산'];
const CAPITAL_SURPLUS_NAMES = ['자본잉여금', '주식발행초과금', '기타불입자본'];
const ADVANCE_RECEIPTS_NAMES = ['선수금', '계약부채'];
const REVENUE_NAMES = ['매출액', '영업수익', '수익(매출액)', '매출'];
const FIXED_ASSET_NAMES = ['유형자산', '기초 유형자산'];
const EPS_NAMES = [
  '기본 주당이익', '기본주당이익', '기본 주당이익(손실)', '기본주당이익(손실)',
  '기본주당분기순이익', '기본주당순이익', '기본주당순이익(손실)',
];
const OPERATING_INCOME_NAMES = ['영업이익', '영업이익(손실)', '영업손익'];

const QUARTER_REPORTS = [['11013', '1분기보고서'], ['11012', '반기보고서'], ['11014', '3분기보고서']];
const ANNUAL_REPORT = ['11011', '사업보고서'];
const LATEST_REPORT_PROBE_ORDER = [ANNUAL_REPORT, QUARTER_REPORTS[2], QUARTER_REPORTS[1], QUARTER_REPORTS[0]];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── DART corp_code 매핑 (종목명 → corp_code) ─────────────────────────────────
// 로컬 _dart_corp_codes.json을 기업코드동기화.py가 1회 MongoDB dart_corp_codes에 옮겨두고,
// 여기서는 그 컬렉션만 읽는다(Vercel엔 영속 파일시스템이 없어 종목분석.py의 로컬 JSON
// 캐싱 패턴을 그대로 못 씀, corpCode.xml의 ZIP/XML 파싱도 JS로 새로 안 만듦).
let corpMapCache = null;

async function loadCorpCodeMap(db) {
  if (corpMapCache) return corpMapCache;
  const doc = await db.collection('dart_corp_codes').findOne({ _id: 'map' });
  if (!doc) throw new Error('dart_corp_codes 컬렉션에 map 문서가 없습니다 — 기업코드동기화.py를 먼저 실행하세요.');
  corpMapCache = doc.data;
  return corpMapCache;
}

// 종목분석.py find_corp_code()와 동일 알고리즘(정확일치 → 대소문자 무시 정확일치 → 부분일치
// 중 이름 길이차 최소). 대소문자 무시 일치를 부분일치보다 먼저 봐야 한다 — 안 그러면
// "sk하이닉스"가 무관한 짧은 회사명에 잘못 매칭되는 버그가 있었음(직접 확인된 사례).
// Python과 다른 점: 매칭된 회사의 정식 명칭(매칭된 키)도 함께 반환한다(name 필드 추가) —
// 즉석분석 결과를 저장할 때 사용자가 입력한 표기 그대로가 아니라 DART 정식 명칭을 쓰기 위함.
function findCorpCode(name, corpMap) {
  if (corpMap[name]) return { name, ...corpMap[name] };
  const nameLower = name.toLowerCase();
  for (const key of Object.keys(corpMap)) {
    if (key.toLowerCase() === nameLower) return { name: key, ...corpMap[key] };
  }
  const candidates = Object.keys(corpMap).filter(
    k => nameLower.includes(k.toLowerCase()) || k.toLowerCase().includes(nameLower)
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.length - name.length) - Math.abs(b.length - name.length));
  return { name: candidates[0], ...corpMap[candidates[0]] };
}

// ── DART 재무제표 조회 ────────────────────────────────────────────────────────
// 네이티브 fetch는 Python requests의 timeout=10과 달리 기본적으로 무한 대기한다 —
// DART가 멈추면 maxDuration까지 끌려가다 죽는 걸 막기 위해 타임아웃을 직접 건다.
async function fetchWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 단일회사 전체 재무제표. 연결(CFS) 기준 데이터가 없으면 별도(OFS)로 재시도.
async function fetchFinancialStatement(corpCode, bsnsYear, reprtCode, fsDiv = 'CFS') {
  const divs = fsDiv === 'CFS' ? [fsDiv, 'OFS'] : [fsDiv];
  for (const div of divs) {
    const url = new URL(`${DART_BASE}/fnlttSinglAcntAll.json`);
    url.searchParams.set('crtfc_key', process.env.DART_API_KEY);
    url.searchParams.set('corp_code', corpCode);
    url.searchParams.set('bsns_year', String(bsnsYear));
    url.searchParams.set('reprt_code', reprtCode);
    url.searchParams.set('fs_div', div);
    let data;
    try {
      const r = await fetchWithTimeout(url);
      data = await r.json();
    } catch (e) {
      continue;
    }
    if (data.status === '000' && data.list && data.list.length) return [data.list, div];
  }
  return [[], fsDiv];
}

function amountOf(it) {
  const raw = it.thstrm_amount == null ? '0' : it.thstrm_amount;
  return parseFloat(String(raw).replace(/,/g, ''));
}

// items(account_nm 목록)에서 names 중 일치하는 첫 계정의 당기 금액(원 단위)을 찾는다.
// sj_div를 지정하면 그 재무제표 구분(BS/CIS/CF/SCE)에서만 찾는다.
function extractAccount(items, names, sjDiv = null) {
  for (const it of items) {
    if (names.includes(it.account_nm) && (sjDiv === null || it.sj_div === sjDiv)) {
      const n = amountOf(it);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

// 기본주당이익을 찾고, 없으면 계속영업+중단영업 EPS를 합산, 그래도 없으면 보통주 EPS를 시도.
function extractEps(items, sjDiv = null) {
  const eps = extractAccount(items, EPS_NAMES, sjDiv);
  if (eps !== null) return eps;
  const continuing = extractAccount(items, ['계속영업 기본주당순이익'], sjDiv);
  if (continuing !== null) {
    const discontinued = extractAccount(items, ['중단영업 기본주당순이익'], sjDiv) || 0;
    return continuing + discontinued;
  }
  return extractAccount(items, ['보통주기본주당이익'], sjDiv);
}

// account_nm에 keyword가 포함된 재무상태표(BS) 항목들의 당기 금액 합계(차입금처럼
// 유동/비유동으로 라벨이 갈리는 계정용). sj_div를 BS로 한정해 현금흐름표의 유사 이름
// 항목(흐름)과 섞이지 않게 한다.
function extractAccountLike(items, keyword, sjDiv = 'BS') {
  let total = 0, found = false;
  for (const it of items) {
    if (it.sj_div === sjDiv && String(it.account_nm || '').includes(keyword)) {
      const n = amountOf(it);
      if (!Number.isNaN(n)) { total += n; found = true; }
    }
  }
  return found ? total : null;
}

// 오늘 기준 실제 제출된 가장 최근 사업/분기/반기보고서를 찾는다(연도 내림차순, 같은 연도
// 안에서는 LATEST_REPORT_PROBE_ORDER 순서). 아직 제출 안 된(미래) 보고서는 DART가 빈
// 응답을 주므로 자연히 건너뛰어진다.
async function findLatestReport(corpCode, today) {
  const years = [today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2];
  for (const year of years) {
    for (const [code, label] of LATEST_REPORT_PROBE_ORDER) {
      const [items] = await fetchFinancialStatement(corpCode, year, code, 'CFS');
      await delay(200);
      if (items.length) return { year, reprtCode: code, label };
    }
  }
  return { year: null, reprtCode: null, label: null };
}

// 최신 보고서 종류에 따라 조회할 (연간 사업보고서 연도 목록, 올해 분기보고서 목록)을 정한다.
function buildFetchPlan(latestYear, latestReprtCode) {
  const annualYears = [latestYear - 3, latestYear - 2, latestYear - 1];
  if (latestReprtCode === ANNUAL_REPORT[0]) {
    annualYears.push(latestYear);
    return { annualYears: annualYears.sort((a, b) => a - b), quarterSpecs: [] };
  }
  const idx = QUARTER_REPORTS.findIndex(([code]) => code === latestReprtCode);
  const quarterSpecs = QUARTER_REPORTS.slice(0, idx + 1).map(([code, label]) => ({ year: latestYear, code, label }));
  return { annualYears: annualYears.sort((a, b) => a - b), quarterSpecs };
}

// 사업보고서(연간) 재무제표. 보고서가 없는 연도는 건너뛴다(원본 Python과 동일하게, 건너뛰는
// 경우엔 delay를 타지 않음 — continue가 sleep보다 먼저라 원본 타이밍과 동일하게 유지).
async function fetchAnnualFinancials(corpCode, years) {
  const annual = {};
  for (const year of years) {
    const [items, fsDiv] = await fetchFinancialStatement(corpCode, year, ANNUAL_REPORT[0], 'CFS');
    if (!items.length) continue;
    annual[String(year)] = {
      fs_div: fsDiv,
      매출액: extractAccount(items, REVENUE_NAMES),
      영업이익: extractAccount(items, OPERATING_INCOME_NAMES),
      당기순이익: extractAccount(items, NET_INCOME_NAMES),
      기본주당이익_DART: extractEps(items),
      자산총계: extractAccount(items, ['자산총계']),
      부채총계: extractAccount(items, ['부채총계']),
      자본총계: extractAccount(items, ['자본총계']),
      지배기업소유주지분: extractAccount(items, PARENT_EQUITY_NAMES, 'BS'),
      현금및현금성자산: extractAccount(items, ['현금및현금성자산']),
      단기금융상품: extractAccount(items, ['단기금융상품']),
      차입금_추정: extractAccountLike(items, '차입금'),
      감가상각비: extractAccount(items, ['감가상각비']),
      무형자산: extractAccount(items, ['무형자산']),
      유형자산: extractAccount(items, FIXED_ASSET_NAMES),
      재고자산: extractAccount(items, INVENTORY_NAMES),
      매출채권: extractAccount(items, ACCOUNTS_RECEIVABLE_NAMES),
      선수금: extractAccount(items, ADVANCE_RECEIPTS_NAMES),
      자본금: extractAccount(items, ['자본금']),
      자본잉여금: extractAccount(items, CAPITAL_SURPLUS_NAMES),
      이익잉여금: extractAccount(items, ['이익잉여금', '이익잉여금(결손금)']),
    };
    await delay(200);
  }
  return annual;
}

// 올해 진행된 분기/반기보고서. specs: [{year, code, label}, ...] (시간순).
async function fetchQuarters(corpCode, specs) {
  const quarters = [];
  for (const { year, code, label } of specs) {
    const [items, fsDiv] = await fetchFinancialStatement(corpCode, year, code, 'CFS');
    if (!items.length) continue;
    quarters.push({
      year, reprt_code: code, label, fs_div: fsDiv,
      매출액: extractAccount(items, REVENUE_NAMES),
      영업이익: extractAccount(items, OPERATING_INCOME_NAMES),
      당기순이익: extractAccount(items, NET_INCOME_NAMES),
      기본주당이익_DART: extractEps(items),
      영업활동현금흐름: extractAccount(items, ['영업활동현금흐름', '영업활동으로인한현금흐름', '영업활동으로 인한 현금흐름']),
      자산총계: extractAccount(items, ['자산총계']),
      부채총계: extractAccount(items, ['부채총계']),
      자본총계: extractAccount(items, ['자본총계']),
      현금및현금성자산: extractAccount(items, ['현금및현금성자산']),
      단기금융상품: extractAccount(items, ['단기금융상품']),
      무형자산: extractAccount(items, ['무형자산']),
      유형자산: extractAccount(items, FIXED_ASSET_NAMES),
      재고자산: extractAccount(items, INVENTORY_NAMES),
      매출채권: extractAccount(items, ACCOUNTS_RECEIVABLE_NAMES),
      선수금: extractAccount(items, ADVANCE_RECEIPTS_NAMES),
      자본금: extractAccount(items, ['자본금']),
      자본잉여금: extractAccount(items, CAPITAL_SURPLUS_NAMES),
      이익잉여금: extractAccount(items, ['이익잉여금', '이익잉여금(결손금)']),
    });
    await delay(200);
  }
  return quarters;
}

module.exports = {
  loadCorpCodeMap,
  findCorpCode,
  findLatestReport,
  buildFetchPlan,
  fetchAnnualFinancials,
  fetchQuarters,
  ANNUAL_REPORT,
  QUARTER_REPORTS,
};
