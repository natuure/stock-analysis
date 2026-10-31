import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { TrendChart, TREND_PALETTE } from './TrendChart';

// 상단 "종목스크리닝" 탭의 내용(2026-10-31 도입, 구 "조건 검색" 빈 탭 이름 변경 후 채움).
// RsRankingView.jsx와 같은 패턴 — App.jsx의 상태 관리 없이 자체적으로 /api/getScreening을
// fetch한다. 데이터 원본은 종목스크리닝.py가 주 1회 쌓는 MongoDB stock_screening 컬렉션
// (/종목서칭 정배열 스크리닝 결과를 30개 카테고리로 분류) — DATA_PIPELINE.md
// "종목스크리닝.py" 절 참고.
const TREND_WEEKS = 10;       // 추이 차트·표에 보여줄 최근 주차 수
const TREND_TOP_CATEGORIES = 5; // 업종 추이 차트에 그릴 선택 주차의 상위 업종 수
const VISIBLE_ROWS = 5;         // 업종별 분포·전체 종목은 위에서 5개 업종만 보이고 나머지는 스크롤
const PEEK = 14;                // 6번째 항목을 살짝 걸쳐 보여 스크롤할 수 있다는 표시를 줌(px)
// 시가총액 구간(억원, 큰 쪽부터) — 절대 금액 기준이라 주차가 바뀌어도 구간이 흔들리지 않는다.
// 종목서칭 기본 조건이 시총 1,000억 이상이라 가장 작은 구간의 하한은 사실상 1,000억.
const MARCAP_BUCKETS = [
  { label: '초대형 (10조 이상)', min: 100000 },
  { label: '대형 (3조~10조)', min: 30000 },
  { label: '중형 (1조~3조)', min: 10000 },
  { label: '소형 (3천억~1조)', min: 3000 },
  { label: '초소형 (3천억 미만)', min: 0 },
];
// 종목서칭 스크리닝 조건 요약(제목과 주차 선택 사이에 작게 표시). 조건을 바꾸면(종목서칭 스킬의
// 기본 조건 — DATA_PIPELINE.md "종목스크리닝.py" 절) 여기 문구도 같이 고칠 것.
const CONDITION_TEXT = '조건: 종가 1,000원↑ · 시총 1,000억↑ · 종가 ≥ 50일선 > 150일선·200일선(일봉) · 최근 1년 액면병합 제외 · 최근 2일 거래량 0·스팩/ETF/리츠/우선주 제외';
const OTHER = '기타';           // 분류 못 한 종목 묶음 — 최다 업종에서 제외, 분포·종목 목록에서는 맨 아래

const weekLabel = (w) => w.weekKey.split('-')[1];                     // "2026-W44" → "W44"
const mmdd = (iso) => iso.slice(5).replace('-', '/');                 // "2026-10-26" → "10/26"
function weekRange(w) {
  if (!w.weekStart) return '';
  const end = new Date(w.weekStart);
  end.setDate(end.getDate() + 6);
  const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return `${mmdd(w.weekStart)} ~ ${mmdd(endIso)}`;
}
const countOf = (w, category) => w.categoryCounts.find(c => c.category === category)?.count || 0;

// 목록의 처음 VISIBLE_ROWS개 항목 높이만큼만 보이게 maxHeight를 맞춘다 — 항목마다 높이가 달라
// (전체 종목은 칩 줄 수가 업종마다 다름) CSS 고정 높이로는 "5개"가 안 되므로 렌더 후 실측한다.
function useVisibleRows(ref, deps) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const kids = el.children;
      if (kids.length <= VISIBLE_ROWS) { el.style.maxHeight = ''; return; }
      const last = kids[VISIBLE_ROWS - 1];
      el.style.maxHeight = `${last.offsetTop + last.offsetHeight - kids[0].offsetTop + PEEK}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function DistributionBars({ week }) {
  const ref = useRef(null);
  useVisibleRows(ref, [week.weekKey]);
  const max = Math.max(...week.categoryCounts.map(c => c.count), 1);
  return (
    <div className="scr-bars scr-scroll" ref={ref}>
      {week.categoryCounts.map(c => (
        <div className="scr-bar-row" key={c.category}>
          <span className="scr-bar-name">{c.category}</span>
          <span className="scr-bar-track"><i style={{ width: `${(c.count / max) * 100}%` }} /></span>
          <span className="scr-bar-num">{c.count}<em>{(c.count / week.total * 100).toFixed(0)}%</em></span>
        </div>
      ))}
    </div>
  );
}

// 억원 단위 시가총액을 "1조 2,345억" / "8,628억"으로 표기
function fmtMarcap(eok) {
  const v = Math.round(eok);
  const jo = Math.floor(v / 10000);
  const rest = v % 10000;
  if (jo === 0) return `${rest.toLocaleString()}억`;
  return rest ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억` : `${jo.toLocaleString()}조`;
}

function marcapStats(stocks) {
  const caps = stocks.map(s => s.marcap).sort((a, b) => a - b);
  if (!caps.length) return null;
  const mid = caps.length >> 1;
  return {
    mean: caps.reduce((sum, v) => sum + v, 0) / caps.length,
    median: caps.length % 2 ? caps[mid] : (caps[mid - 1] + caps[mid]) / 2,
  };
}

function MarcapBars({ week }) {
  const stats = marcapStats(week.stocks);
  const rows = MARCAP_BUCKETS.map((b, i) => {
    const max = i === 0 ? Infinity : MARCAP_BUCKETS[i - 1].min;
    const stocks = week.stocks.filter(s => s.marcap >= b.min && s.marcap < max);
    return { label: b.label, count: stocks.length, names: stocks.map(s => s.name).join(', ') };
  });
  const maxCount = Math.max(...rows.map(r => r.count), 1);
  return (
    <>
      {stats && (
        <div className="scr-marcap-stats">
          <div><span>평균</span><b>{fmtMarcap(stats.mean)}</b></div>
          <div><span>중위값</span><b>{fmtMarcap(stats.median)}</b></div>
        </div>
      )}
      <div className="scr-bars scr-bars-wide">
        {rows.map(r => (
          <div className="scr-bar-row" key={r.label} title={r.names}>
            <span className="scr-bar-name">{r.label}</span>
            <span className="scr-bar-track"><i style={{ width: `${(r.count / maxCount) * 100}%` }} /></span>
            <span className="scr-bar-num">{r.count}<em>{(r.count / week.total * 100).toFixed(0)}%</em></span>
          </div>
        ))}
      </div>
    </>
  );
}

function StockGroups({ week }) {
  const ref = useRef(null);
  useVisibleRows(ref, [week.weekKey]);
  return (
    <div className="scr-groups scr-scroll" ref={ref}>
      {week.categoryCounts.map(c => (
        <div className="scr-group" key={c.category}>
          <div className="scr-group-title">{c.category}<span>{c.count}</span></div>
          <div className="scr-chips">
            {week.stocks.filter(s => s.카테고리 === c.category).map(s => (
              <span className="scr-chip" key={s.code}
                title={`${s.code} · ${s.market} · 종가 ${s.close.toLocaleString()}원 · 시총 ${s.marcap.toLocaleString()}억`}>
                {s.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// 업종 × 주차 종목 수 표 — 전주 대비 증가는 빨강, 감소는 파랑(거래대금 카테고리 TOP5 순위표와
// 같은 cat-trend-* 클래스 재사용), 이번 주에 처음 등장한 업종은 초록 배경.
function CategoryTrendTable({ weeks, selected }) {
  const recent = weeks.slice(-TREND_WEEKS);
  const cats = [...new Set(recent.flatMap(w => w.categoryCounts.map(c => c.category)))];
  const total = (cat) => recent.reduce((sum, w) => sum + countOf(w, cat), 0);
  cats.sort((a, b) => countOf(selected, b) - countOf(selected, a) || total(b) - total(a) || a.localeCompare(b, 'ko'));

  return (
    <div className="cat-trend-block">
      <div className="trend-chart-title">업종별 종목 수 (최근 {recent.length}주)</div>
      <div className="cat-trend-wrap">
        <table className="cat-trend-table">
          <thead>
            <tr>
              <th className="cat-trend-rank-col">업종</th>
              {recent.map(w => <th key={w.weekKey}>{weekLabel(w)}</th>)}
            </tr>
          </thead>
          <tbody>
            {cats.map(cat => (
              <tr key={cat}>
                <td className="cat-trend-rank-col">{cat}</td>
                {recent.map((w, i) => {
                  const n = countOf(w, cat);
                  const prev = i > 0 ? countOf(recent[i - 1], cat) : null;
                  let cls = '';
                  if (prev !== null) {
                    if (prev === 0 && n > 0) cls = 'cat-trend-new';
                    else if (n > prev) cls = 'cat-trend-up';
                    else if (n < prev) cls = 'cat-trend-down';
                  }
                  return <td key={w.weekKey} className={cls}>{n || '-'}</td>;
                })}
              </tr>
            ))}
            <tr>
              <td className="cat-trend-rank-col">합계</td>
              {recent.map(w => <td key={w.weekKey}><b>{w.total}</b></td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScreeningView() {
  const [weeks, setWeeks] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    fetch('/api/getScreening')
      .then(r => r.json())
      .then(({ weeks }) => {
        setWeeks(weeks || []);
        setIdx(Math.max((weeks || []).length - 1, 0));
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  const body = () => {
    if (status === 'loading') return <div className="tab-placeholder">불러오는 중...</div>;
    if (status === 'error') return <div className="tab-placeholder">조회 중 오류가 발생했습니다.</div>;
    if (!weeks.length) {
      return <div className="tab-placeholder">스크리닝 데이터가 아직 없습니다. /종목스크리닝 을 먼저 실행해 주세요.</div>;
    }

    const week = weeks[idx];
    // 업종별 분포·전체 종목은 "기타"를 맨 아래로 보내고, 최다 업종은 "기타"를 빼고 고른다
    // ("기타"는 업종이 아니라 분류 못 한 종목 묶음이라 1위로 보여주면 의미가 없음).
    const ordered = [
      ...week.categoryCounts.filter(c => c.category !== OTHER),
      ...week.categoryCounts.filter(c => c.category === OTHER),
    ];
    const shownWeek = { ...week, categoryCounts: ordered };
    const topCategory = ordered.find(c => c.category !== OTHER);
    const prev = idx > 0 ? weeks[idx - 1] : null;
    const diff = prev ? week.total - prev.total : null;
    const recent = weeks.slice(-TREND_WEEKS);
    const topCats = week.categoryCounts.slice(0, TREND_TOP_CATEGORIES).map(c => c.category);

    return (
      <>
        <p className="scr-conditions">{CONDITION_TEXT}</p>
        <div className="scr-week-picker">
          {weeks.map((w, i) => (
            <button key={w.weekKey} className={`scr-week-btn${i === idx ? ' active' : ''}`}
              onClick={() => setIdx(i)}>{weekLabel(w)}</button>
          ))}
        </div>

        <div className="scr-summary">
          <div className="card scr-stat">
            <div className="scr-stat-label">{weekLabel(week)} 통과 종목</div>
            <div className="scr-stat-value">{week.total}<small>개</small></div>
            {diff !== null && (
              <div className={`scr-stat-sub ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}`}>
                전주 대비 {diff > 0 ? '+' : ''}{diff}
              </div>
            )}
          </div>
          <div className="card scr-stat">
            <div className="scr-stat-label">최다 업종</div>
            <div className="scr-stat-value scr-stat-text">{topCategory?.category || '-'}</div>
            <div className="scr-stat-sub flat">{topCategory?.count || 0}개</div>
          </div>
          <div className="card scr-stat">
            <div className="scr-stat-label">기준일</div>
            <div className="scr-stat-value scr-stat-text">{week.asOfDate ? mmdd(week.asOfDate) : '-'}</div>
            <div className="scr-stat-sub flat">{weekRange(week)}</div>
          </div>
        </div>

        <h3 className="sec-subtitle">업종별 분포</h3>
        <div className="card"><DistributionBars week={shownWeek} /></div>

        <h3 className="sec-subtitle">시가총액 분포</h3>
        <div className="card"><MarcapBars week={week} /></div>

        <h3 className="sec-subtitle">전체 종목 ({week.total}개)</h3>
        <div className="card"><StockGroups week={shownWeek} /></div>

        <h2 className="sec-title">주차별 추이</h2>
        <TrendChart
          title="통과 종목 수"
          type="line"
          showValues
          valueFormatter={v => String(v)}
          periods={recent.map(w => ({ label: weekLabel(w), total: w.total }))}
          metrics={[{ key: 'total', label: '통과 종목 수', color: TREND_PALETTE[0] }]}
        />
        <TrendChart
          title={`상위 업종 종목 수 (${weekLabel(week)} 기준 상위 ${topCats.length}개)`}
          type="line"
          valueFormatter={v => String(v)}
          periods={recent.map(w => Object.fromEntries([
            ['label', weekLabel(w)], ...topCats.map(c => [c, countOf(w, c)]),
          ]))}
          metrics={topCats.map((c, i) => ({ key: c, label: c, color: TREND_PALETTE[i % TREND_PALETTE.length] }))}
        />
        <CategoryTrendTable weeks={weeks} selected={week} />
      </>
    );
  };

  return (
    <main className="screening">
      <h2 className="sec-title">
        종목스크리닝<span className="sec-sub">일봉 정배열 종목 · 주 1회 저장</span>
      </h2>
      {body()}
    </main>
  );
}
