import { useState, useMemo, useRef } from 'react';
import { TREND_PALETTE } from './TrendChart';
import { PieChart } from './PieChart';

const MAX_THEMES = 6;

function ThemeTable({ themes }) {
  if (!themes || themes.length === 0) return null;
  const shown = themes.slice(0, MAX_THEMES);
  return (
    <div>
      <h2 className="sec-title" style={{ marginTop: 36 }}>핫한 테마</h2>
      <div className="theme-wrap">
        <table className="theme-table">
          <thead>
            <tr>
              <th>테마</th>
              <th>핵심 재료</th>
              <th>주요 종목</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i}>
                <td><span className="theme-tag">{row.테마}</span></td>
                <td className="theme-material">{row.핵심재료}</td>
                <td>{row.주요종목}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 카테고리별 종목 수를 세어 상위 5개를 순위대로 반환한다(그날 거래대금 상위 50 중 — 기타는
// 제외, CategoryPieCarousel과 동일하게 진짜 섹터만 순위 경쟁). 카테고리가 하나도 없는
// 날(과거 미백필분)은 null — 그 날짜를 추이에서 통째로 제외한다.
function rankCategoriesByDay(items) {
  const counts = {};
  (items || []).forEach(it => {
    if (it.카테고리 && it.카테고리 !== '기타') counts[it.카테고리] = (counts[it.카테고리] || 0) + 1;
  });
  if (Object.keys(counts).length === 0) return null;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) // 동률이면 항상 같은 순서(결정적)
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));
}

// themeTrend(api/getThemeTrend.js 응답의 days 배열, 최신순, 각 {date, 거래대금, 등락률})을
// 표에 그릴 날짜별 TOP5 칸으로 바꾼다. field로 '거래대금'/'등락률' 중 어느 배열을 집계할지
// 고른다(2026-06-28, 등락률 추이 추가 — 그 전엔 거래대금 전용이었음). 카테고리가 있는
// 날짜만 남기고(과거 미백필 날짜는 통째로 제외, 2026-06-28) 가장 오래된 보이는 칸도 전날과
// 정확히 비교할 수 있게, 표시할 날짜 수보다 하루치 더 가져와 비교 전용(baseline)으로만
// 쓰고 화면에는 그리지 않는다.
function buildCategoryRankTrend(days, field, visibleCount = 15) {
  const chrono = [...days].reverse(); // 과거 → 최신
  const ranked = chrono
    .map(d => ({ date: d.date, ranks: rankCategoriesByDay(d[field]) }))
    .filter(d => d.ranks !== null);
  if (ranked.length === 0) return null;

  const windowed = ranked.slice(-(visibleCount + 1));
  const hasBaseline = windowed.length > visibleCount;
  const baseline = hasBaseline ? windowed[0] : null;
  const visible = hasBaseline ? windowed.slice(1) : windowed;

  return visible.map((day, i) => {
    const prevDay = i === 0 ? baseline : visible[i - 1];
    const prevRankOf = {};
    (prevDay?.ranks || []).forEach((r, idx) => { prevRankOf[r.category] = idx + 1; });

    const cells = day.ranks.map((r, idx) => {
      const rank = idx + 1;
      const prevRank = prevRankOf[r.category];
      let state = 'same';
      if (prevRank === undefined) state = prevDay ? 'new' : 'same'; // 비교 대상이 없으면 중립
      else if (rank < prevRank) state = 'up';   // 숫자가 작아짐 = 더 상위로(상승) = 빨강
      else if (rank > prevRank) state = 'down'; // 숫자가 커짐 = 더 하위로(하락) = 파랑
      return { category: r.category, count: r.count, state };
    });
    return { date: day.date, cells };
  });
}

function CategoryRankTrendTable({ columns, label }) {
  if (!columns || columns.length === 0) return null; // 카테고리 데이터가 아예 없으면 섹션 자체를 숨김

  const maxRows = Math.max(...columns.map(c => c.cells.length));

  return (
    <div className="cat-trend-block">
      <div className="trend-chart-title">{`최근 ${columns.length}영업일 ${label} 카테고리 TOP5 추이`}</div>
      <div className="cat-trend-wrap">
        <table className="cat-trend-table">
          <thead>
            <tr>
              <th className="cat-trend-rank-col"></th>
              {columns.map(c => <th key={c.date}>{c.date.slice(5).replace('-', '/')}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRows }, (_, i) => (
              <tr key={i}>
                <td className="cat-trend-rank-col">{i + 1}위</td>
                {columns.map(c => {
                  const cell = c.cells[i];
                  return (
                    <td key={c.date} className={cell ? `cat-trend-${cell.state}` : ''}>
                      {cell ? `${cell.category} (${cell.count})` : '-'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryRankTrend({ themeTrend }) {
  const volColumns  = useMemo(() => (themeTrend ? buildCategoryRankTrend(themeTrend, '거래대금') : null), [themeTrend]);
  const rateColumns = useMemo(() => (themeTrend ? buildCategoryRankTrend(themeTrend, '등락률')   : null), [themeTrend]);
  return (
    <>
      <CategoryRankTrendTable columns={volColumns} label="거래대금" />
      <CategoryRankTrendTable columns={rateColumns} label="등락률" />
    </>
  );
}

// 2026-06-26 페이지(데이터)부터 도넛 차트가 top5+기타로 묶지 않고 그날의 모든 카테고리를
// 그대로 보여줌 — 그 이전 날짜는 과거 화면 그대로 top5+기타 유지(백필 안 함, 다른 카테고리
// 관련 변경들과 동일한 원칙).
const CATEGORY_SHOW_ALL_FROM = '2026-06-26';

// vol/rate(그날 상위 50, 숫자) + aiItems(aiAnalysis.거래대금/등락률, 종목명+카테고리)를
// 종목명으로 매칭해 카테고리별 "종목 수"를 센다(금액/등락률 합산이 아니라 단순 개수 —
// 사용자가 비중 대신 "50개 중 몇 종목" 표시를 명시적으로 요청). 매칭 실패/카테고리 없음은
// "기타"로 폴백(어떤 종목도 누락되지 않고 항상 기타로 흡수됨 — count 합은 항상 items.length).
// 카테고리별 종목 목록(members, {name, candidate})도 같이 반환해 범례 클릭 시 펼쳐서
// 보여주는 데 쓴다 — candidate는 신규카테고리후보(있으면 PieChart가 빨간 글씨로 표시).
function aggregateByCategory(items, aiItems, showAll) {
  if (!items || items.length === 0) return null;

  const catByName = new Map();
  const candidateByName = new Map();
  (aiItems || []).forEach(it => {
    if (it.카테고리) catByName.set(it.종목명, it.카테고리);
    if (it.신규카테고리후보) candidateByName.set(it.종목명, it.신규카테고리후보);
  });
  // 그날 카테고리가 하나도 없으면(2026-06-26 이전 날짜 등 미백필분) "전부 기타"로 보여주지
  // 않고 차트 자체를 숨긴다 — 분류 안 한 것과 분류했더니 전부 기타인 것은 다른 의미.
  if (catByName.size === 0) return null;

  const groups = {};
  items.forEach(s => {
    const cat = catByName.get(s.name) || '기타';
    const member = { name: s.name, candidate: candidateByName.get(s.name) || null };
    (groups[cat] ||= []).push(member);
  });

  const total = items.length;
  const etcMembers = groups['기타'] || [];
  const realCats = Object.entries(groups)
    .filter(([cat]) => cat !== '기타')
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])); // 동률이면 항상 같은 순서

  // "5개+기타"는 분류 단계가 아니라 여기(차트 렌더 집계)에서만 적용 — showAll이면 그날
  // 실제로 6개 이상이어도 전부 보여주고, 진짜 미분류(etcMembers)만 "기타"로 남긴다.
  const shownCats = showAll ? realCats : realCats.slice(0, 5);
  const restMembers = showAll ? etcMembers : realCats.slice(5).flatMap(([, members]) => members).concat(etcMembers);

  const slices = shownCats.map(([label, members], i) => ({
    label, members, count: members.length, pct: (members.length / total) * 100,
    color: TREND_PALETTE[i % TREND_PALETTE.length],
  }));
  if (restMembers.length > 0) {
    // "기타"는 진짜 섹터가 아니라 잔여 묶음이라 팔레트 색이 아닌 muted 회색으로 구분.
    slices.push({
      label: '기타', members: restMembers, count: restMembers.length,
      pct: (restMembers.length / total) * 100, color: 'var(--c-muted)',
    });
  }
  return { slices };
}

export function CategoryPieCarousel({ vol, rate, aiAnalysis, date }) {
  const showAll = !!date && date >= CATEGORY_SHOW_ALL_FROM;
  const volAgg  = useMemo(() => aggregateByCategory(vol,  aiAnalysis?.거래대금 || [], showAll), [vol, aiAnalysis, showAll]);
  const rateAgg = useMemo(() => aggregateByCategory(rate, aiAnalysis?.등락률   || [], showAll), [rate, aiAnalysis, showAll]);
  const [page, setPage] = useState(0);
  const scrollerRef = useRef(null);
  if (!volAgg && !rateAgg) return null; // 둘 다 데이터 없으면 섹션 자체를 숨김

  // 터치 스와이프가 없는 데스크톱(마우스)에서도 페이지를 넘길 수 있게 점을 클릭 가능하게 함
  // — 스크롤바를 숨겨놔서(.pie-carousel) 스와이프 말고는 페이지를 옮길 방법이 없었음.
  function goTo(i) {
    scrollerRef.current?.scrollTo({ left: i * scrollerRef.current.clientWidth, behavior: 'smooth' });
    setPage(i);
  }

  return (
    <div className="pie-carousel-block">
      <div
        ref={scrollerRef}
        className="pie-carousel"
        onScroll={e => setPage(Math.round(e.target.scrollLeft / e.target.clientWidth))}
      >
        <div className="pie-carousel-page">
          <PieChart title="거래대금 상위 50 카테고리 비중" slices={volAgg?.slices} />
        </div>
        <div className="pie-carousel-page">
          <PieChart title="등락률 상위 50 카테고리 비중" slices={rateAgg?.slices} />
        </div>
      </div>
      <div className="pie-carousel-dots">
        <span className={`pie-dot${page === 0 ? ' active' : ''}`} onClick={() => goTo(0)} />
        <span className={`pie-dot${page === 1 ? ' active' : ''}`} onClick={() => goTo(1)} />
      </div>
    </div>
  );
}

function AiCard({ item }) {
  return (
    <div className="a-item">
      <div className="a-head">
        <span className="a-name">{item.종목명}</span>
        {item.테마섹터 && <span className="a-theme">{item.테마섹터}</span>}
      </div>
      {item.상승원인 && (
        <div className="a-block">
          <div className="a-text">{item.상승원인}</div>
        </div>
      )}
    </div>
  );
}

function AiPanels({ aiAnalysis }) {
  const [tab, setTab] = useState('v');
  const vol  = aiAnalysis.거래대금 || [];
  const rate = aiAnalysis.등락률   || [];
  if (!vol.length && !rate.length) return null;

  return (
    <>
      <div className="seg-tabs">
        <button className={`seg-btn${tab === 'v' ? ' active' : ''}`} onClick={() => setTab('v')}>거래대금</button>
        <button className={`seg-btn${tab === 'r' ? ' active' : ''}`} onClick={() => setTab('r')}>등락률</button>
      </div>
      <div className="tables-grid">
        <div className={`tbl-card${tab === 'r' ? ' mobile-hidden' : ''}`}>
          <div className="tbl-wrap news-wrap">
            {vol.map((item, i) => <AiCard key={i} item={item} />)}
          </div>
        </div>
        <div className={`tbl-card${tab === 'v' ? ' mobile-hidden' : ''}`}>
          <div className="tbl-wrap news-wrap">
            {rate.map((item, i) => <AiCard key={i} item={item} />)}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Analysis({ analysisExcel, aiAnalysis, themeTrend, vol, rate, date }) {
  const hasTheme = aiAnalysis?.테마?.length > 0;
  const hasAi    = aiAnalysis && (aiAnalysis.거래대금?.length || aiAnalysis.등락률?.length);
  const hasN     = analysisExcel && analysisExcel.length > 0;
  if (!hasTheme && !hasAi && !hasN && !themeTrend?.length) return null;

  const headers = hasN ? Object.keys(analysisExcel[0]) : [];
  const nameKey = headers[0];

  return (
    <div>
      {hasTheme && <ThemeTable themes={aiAnalysis.테마} />}
      <CategoryPieCarousel vol={vol} rate={rate} aiAnalysis={aiAnalysis} date={date} />
      {/* 이 표는 선택한 날짜와 무관하게 "최근 영업일(현재 기준)" 추이를 보여주므로, 카테고리
          분류가 없는 날짜(1월 1일부터 백필한 거래대금/등락률 전용 날짜 등)를 볼 때는 그
          날짜와 상관없는 지금 시점 데이터가 뜨는 셈이라 숨긴다. */}
      {hasAi && <CategoryRankTrend themeTrend={themeTrend} />}

      {hasAi && (
        <>
          <h2 className="sec-title" style={{ marginTop: 36 }}>주요 뉴스</h2>
          <AiPanels aiAnalysis={aiAnalysis} />
        </>
      )}

      {hasN && (
        <>
          <h2 className="sec-title" style={{ marginTop: 36 }}>분석 결과</h2>
          <div className="analysis-grid">
            {analysisExcel.map((row, i) => (
              <div className="a-item" key={i}>
                <div className="a-head">
                  <span className="a-name">{row[nameKey]}</span>
                </div>
                {headers.slice(1).map(h => row[h] ? (
                  <div className="a-detail" key={h}>
                    <span className="a-label">{h}</span>{row[h]}
                  </div>
                ) : null)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
