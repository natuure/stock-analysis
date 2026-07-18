import { ls } from '../utils';

const DOWS   = ['월', '화', '수', '목', '금', '주차'];
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

export default function Calendar({ year, month, selected, onMove, onDayClick, onNoDataClick, onWeekClick, serverDates = [], weeklyIdx = {}, weekSelected = null }) {
  const dates   = JSON.parse(ls('analysis_dates') || '[]');
  const dateSet = new Set([...dates, ...serverDates]);

  const today = new Date();
  const todayStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const firstDayDow  = new Date(year, month, 1).getDay(); // 0=일~6=토
  const mondayOffset = (firstDayDow + 6) % 7;              // 1일이 속한 주의 월요일까지 며칠 전인지
  const gridStart     = 1 - mondayOffset;
  const lastDate      = new Date(year, month + 1, 0).getDate();
  const weeksCount    = Math.ceil((mondayOffset + lastDate) / 7);

  // 월~금만 5칸씩 주 단위로 생성 (토/일은 칸 자체를 만들지 않음)
  let weeks = [];
  for (let w = 0; w < weeksCount; w++) {
    const days = [];
    for (let dow = 0; dow < 5; dow++) {
      const dayNum   = gridStart + w * 7 + dow;
      const realDate = new Date(year, month, dayNum);
      const other    = dayNum < 1 || dayNum > lastDate;
      const iso = `${realDate.getFullYear()}-${String(realDate.getMonth() + 1).padStart(2, '0')}-${String(realDate.getDate()).padStart(2, '0')}`;
      const hasData = !other && dateSet.has(iso);
      days.push({
        d: realDate.getDate(), iso: other ? null : iso, other,
        isToday: !other && iso === todayStr,
        hasData,
        isHoliday: !other && !hasData && iso < todayStr,
        isSel:   !other && iso === selected,
      });
    }
    // 그 주의 월요일은 평일 칸들이 전부 other라도 항상 직접 계산 가능 (anchor 탐색 불필요)
    const monday  = new Date(year, month, gridStart + w * 7);
    const weekNum = getISOWeek(monday);
    const weekKey = `${monday.getFullYear()}-W${weekNum}`;
    const idx     = weeklyIdx[weekKey];
    const hasIdx  = !!(idx && idx.kospi && idx.kosdaq);
    weeks.push({ days, weekNum, weekKey, hasIdx });
  }
  // 한 주의 평일 5칸이 전부 다른 달이면(그 주의 거래일이 이번 달에 하나도 없음) 행 자체를 드롭
  weeks = weeks.filter(week => week.days.some(day => !day.other));

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

        {/* 주 단위 렌더링: 월~금 5칸 + 주차 라벨 1칸 */}
        {weeks.map(({ days, weekNum, weekKey, hasIdx }, wi) => {
          const dayCells = days.map((day, di) => {
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
                {day.isHoliday && <div className="cal-holiday">휴장</div>}
              </div>
            );
          });

          let weekCls = 'cal-week';
          if (hasIdx) weekCls += ' has-data';
          if (hasIdx && weekKey === weekSelected) weekCls += ' selected';
          const weekCell = (
            <div className="cal-week-wrap" key={`${wi}-w`}>
              <div className={weekCls} onClick={hasIdx ? () => onWeekClick && onWeekClick(weekKey) : undefined}>
                W{weekNum}
              </div>
            </div>
          );

          return [...dayCells, weekCell];
        })}
      </div>
    </div>
  );
}
