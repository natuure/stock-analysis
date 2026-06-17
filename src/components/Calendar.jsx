import { ls } from '../utils';

const DOWS   = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export default function Calendar({ year, month, selected, onMove, onDayClick, onNoDataClick }) {
  const dates   = JSON.parse(ls('analysis_dates') || '[]');
  const dateSet = new Set(dates);

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

  for (let i = firstDay - 1; i >= 0; i--) {
    days.push({ d: prevLastDate - i, iso: null, other: true });
  }
  for (let d = 1; d <= lastDate; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ d, iso, other: false, isToday: iso === todayStr, hasData: dateSet.has(iso), isSel: iso === selected });
  }
  const remaining = (7 - (days.length % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    days.push({ d: i, iso: null, other: true });
  }

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
        {DOWS.map(d => <div className="cal-dow" key={d}>{d}</div>)}
        {days.map((day, i) => {
          if (day.other) {
            return (
              <div className="cal-day-wrap" key={i}>
                <div className="cal-day other-month">{day.d}</div>
              </div>
            );
          }
          let cls = 'cal-day';
          if (day.isToday)  cls += ' today';
          if (day.hasData)  cls += ' has-data';
          if (day.isSel)    cls += ' selected';
          const onClick = day.hasData ? () => onDayClick(day.iso) : onNoDataClick;
          return (
            <div className="cal-day-wrap" key={i}>
              <div className={cls} onClick={onClick}>{day.d}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
