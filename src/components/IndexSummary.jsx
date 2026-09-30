import { rc } from '../utils';

function fmtIndex(n) {
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TREND_ITEMS = [
  ['above50', '50일선 위'],
  ['slope50Up', '50일선 상승'],
  ['slope200Up', '200일선 상승'],
];

function fmtMD(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// Stage 1(셀링 클라이맥스)·Stage 2(FTD) 상태 → [라벨, 상태 문구, 최근 발생일, 강조 여부]
function signalRows({ climax, ftd }) {
  const ftdText = ftd.today ? '오늘 발생'
    : ftd.attempt ? `반등 ${ftd.attempt.day}일차` : '미해당';
  return [
    ['셀링 클라이맥스', climax.today ? '오늘 해당' : '미해당', climax.lastDate, climax.today],
    ['FTD', ftdText, ftd.lastDate, ftd.today || !!ftd.attempt],
  ];
}

function IndexBlock({ label, data }) {
  return (
    <div className="card index-card">
      <div className="index-label">{label}</div>
      <div className="index-close">{fmtIndex(data.close)}</div>
      <div className={`index-change ${rc(data.changeRate)}`}>
        {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)} ({Math.abs(data.changeRate).toFixed(2)}%)
      </div>
      {data.trend && (
        <ul className="index-trend">
          {TREND_ITEMS.map(([key, text]) => (
            <li key={key} className={data.trend[key] ? 'ok' : 'no'}>
              <span className="index-trend-mark">{data.trend[key] ? '✓' : '✗'}</span>
              {text}
            </li>
          ))}
        </ul>
      )}
      {data.signals && (
        <ul className="index-signals">
          {signalRows(data.signals).map(([name, status, lastDate, on]) => (
            <li key={name}>
              <span className="index-signal-name">{name}</span>
              <span className={`index-signal-val ${on ? 'on' : 'off'}`}>
                {status}
                {lastDate && <span className="index-signal-last"> · 최근 {fmtMD(lastDate)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function IndexSummary({ indices, title = '오늘의 코스피/코스닥' }) {
  if (!indices) return null;
  return (
    <>
      <h2 className="sec-title">{title}</h2>
      <div className="index-grid">
        <IndexBlock label="코스피" data={indices.kospi} />
        <IndexBlock label="코스닥" data={indices.kosdaq} />
      </div>
    </>
  );
}
