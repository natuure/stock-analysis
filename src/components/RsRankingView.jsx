import { useState, useEffect } from 'react';
import RsRankTable from './RsRankTable';

// 상단 "RS랭킹" 탭의 내용(2026-07-11 도입, 구 "차트분석" 탭 이름 변경 후 이 컴포넌트로
// 채움). StockAnalysis.jsx와 같은 패턴 — 탭 컴포넌트가 App.jsx의 상태 관리 없이 자체적으로
// /api/getRsRanking을 fetch한다(App.jsx는 그냥 <RsRankingView />만 렌더링). 데이터 원본은
// rs랭킹.py가 채우는 MongoDB rs_ranking 컬렉션의 단일 문서(_id='latest') —
// DATA_PIPELINE.md "rs랭킹.py" 절 참고.
export default function RsRankingView() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  useEffect(() => {
    fetch('/api/getRsRanking')
      .then(r => r.json())
      .then(({ rsRank, asOfDate }) => {
        setData({ rsRank, asOfDate });
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  return (
    <main>
      <h2 className="sec-title">RS Score 랭킹 (90점 이상)</h2>
      {status === 'loading' && <div className="tab-placeholder">불러오는 중...</div>}
      {status === 'error' && <div className="tab-placeholder">조회 중 오류가 발생했습니다.</div>}
      {status === 'ready' && <RsRankTable rsRank={data.rsRank} asOfDate={data.asOfDate} />}
    </main>
  );
}
