import { rc } from '../utils';

function fmtIndex(n) {
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function IndexBlock({ label, data }) {
  return (
    <div className="card index-card">
      <div className="index-label">{label}</div>
      <div className="index-close">{fmtIndex(data.close)}</div>
      <div className={`index-change ${rc(data.changeRate)}`}>
        {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)} ({Math.abs(data.changeRate).toFixed(2)}%)
      </div>
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
