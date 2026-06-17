import { ls } from '../utils';

const DOWS   = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

export default function Calendar({ year, month, selected, onMove, onDayClick, onNoDataClick, onWeekClick }) {
  const dates       = JSON.parse(ls('analysis_dates') || '[]');
  const weeklyDates = JSON.parse(ls('weekly_dates')   || '[]');
  const dateSet     = new Set(dates);
  const weeklySet   = new Set(weeklyDates);

  const today = new Date();
  const todayStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const firstDay     = new Date(year, month, 1).getDay();
  const lastDate     = new Date(year, month + 1, 0).getDate();
  const prevLastDate = new Date(year, month, 0).getDate();

  const days = [];
  for (let i = firstDay - 1; i >= 0; i--)
    days.push({ d: prevLastDate - i, iso: null, other: true });
  for (let d = 1; d <= lastDate; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ d, iso, other: false, isToday: iso === todayStr, hasData: dateSet.has(iso), isSel: iso === selected });
  }
  const remaining = (7 - (days.length % 7)) % 7;
  for (let i = 1; i <= remaining; i++)
    days.push({ d: i, iso: null, other: true });

  // 7일씩 주 단위로 그룹화
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="cal-card">
      <div className="cal-header">
        <div className="cal-title">{year}년 {MONTHS[month]}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="cal-nav" onClick={() => onMove(-1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button className="cal-nav" onClick={() => onMove(1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="cal-grid">
        {/* 헤더: 빈 셀(주차 컬럼) + 요일 */}
        <div />
        {DOWS.map(d => <div className="cal-dow" key={d}>{d}</div>)}

        {/* 주 단위 렌더링 */}
        {weeks.map((week, wi) => {
          const firstReal = week.find(d => !d.other);
          const refDate   = firstReal
            ? new Date(firstReal.iso)
            : new Date(year, month, week[0].d);
          const weekNum  = getISOWeek(refDate);
          const weekKey  = `${refDate.getFullYear()}-W${weekNum}`;
          const hasWeekly = weeklySet.has(weekKey);

          return [
            <div className="cal-week-col" key={`wn-${wi}`}>
              <span
                className={`cal-week-label${hasWeekly ? ' has-weekly' : ''}`}
                onClick={hasWeekly && onWeekClick ? () => onWeekClick(weekKey) : undefined}
                style={{ cursor: hasWeekly ? 'pointer' : 'default' }}
              >
                W{weekNum}
              </span>
            </div>,
            ...week.map((day, di) => {
              if (day.other) return (
                <div className="cal-day-wrap" key={`${wi}-${di}`}>
                  <div className="cal-day other-month">{day.d}</div>
                </div>
              );
              let cls = 'cal-day';
              if (day.isToday) cls += ' today';
              if (day.hasData) cls += ' has-data';
              if (day.isSel)   cls += ' selected';
              const onClick = day.hasData ? () => onDayClick(day.iso) : onNoDataClick;
              return (
                <div className="cal-day-wrap" key={`${wi}-${di}`}>
                  <div className={cls} onClick={onClick}>{day.d}</div>
                </div>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}
