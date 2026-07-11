"""
RS Score(Relative Strength, 상대강도) 랭킹 계산 + MongoDB 저장 스크립트
사용법: python rs랭킹.py
       (아무 때나 실행 가능. 가장 최근 거래일 기준으로 전종목 RS Score를 다시 계산해
       rs_ranking 컬렉션의 단일 문서(_id='latest')에 upsert한다)

원래 주간분석.py 안에 있던 기능이었으나(2026-07-11 도입), 결과를 보여줄 곳이 주간뷰
("금주의 코스피/코스닥" 이하)가 아니라 별도의 상단 탭("RS랭킹")으로 확정되면서 이 파일로
분리했다(2026-07-11) — 주간분석.py는 계속 주간 코스피/코스닥·거래대금/등락률·ETF
랭킹만 다루고, RS Score는 이 스크립트가 독립적으로 계산·저장한다.

RS Score 공식은 주식자동매매/차트분석/16-RS랭킹.md에 문서화된 윌리엄 오닐/IBD 스타일
근사식(최근 3/6/9/12개월 수익률에 40/20/20/20% 가중치)을 그대로 포팅했다. 원 구현은 그
프로젝트의 backtest/relative_strength.py에 있으나 완전히 다른 git 저장소라 import할 수
없어 필요한 부분만 이 파일에 다시 구현했다.

결과:
  - MongoDB rs_ranking 컬렉션에 {_id:'latest', asOfDate, weekKey, rsRank:[...], updatedAt}
    저장(단일 문서 — 이 탭은 달력처럼 날짜를 선택해 과거를 보는 화면이 아니라 "지금
    기준 RS 랭킹"만 보여주면 되므로, weekly_indices처럼 주차별 문서를 쌓지 않는다).
    rsRank는 백분위(rsScore) 90 이상 종목만 [{rank, code, name, rsScore, 카테고리?,
    신규카테고리후보?}] 형태로 내림차순 저장.
  - 웹앱 "RS랭킹" 탭(api/getRsRanking.js → RsRankTable.jsx)이 이 문서를 그대로 읽어
    표시. 주간뷰(달력 주차 클릭 화면)에는 더 이상 표시하지 않는다(2026-07-11 사용자 결정).
"""

import os
import sys
from datetime import datetime, timedelta
import FinanceDataReader as fdr
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient

import 뉴스분석  # fetch_market_data() 재사용 — KONEX·스팩 제외된 전종목 유니버스
import 저장분석  # VALID_CATEGORIES(28개 카테고리 목록)를 단일 진실 공급원으로 재사용
import 주간분석  # attach_categories()/week_key()/monday_of() 재사용 — 세 함수 모두
                  # 이 스크립트와 주간분석.py가 똑같이 필요로 하는 범용 로직이라 중복
                  # 정의하지 않는다. 주간분석.py도 if __name__=='__main__' 가드가 있어
                  # import만 해선 main()이 실행되지 않음(뉴스분석.py를 여러 스크립트가
                  # import하는 기존 패턴과 동일).

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')

MONGODB_URI = os.getenv('MONGODB_URI')

RS_RANKING_COLLECTION = 'rs_ranking'
RS_CATEGORY_CACHE_COLLECTION = 'rs_category_cache'

RS_WEIGHTS = {3: 0.4, 6: 0.2, 9: 0.2, 12: 0.2}       # 개월 수 → 가중치
RS_MIN_HISTORY_DAYS = 365  # 상장 1년 미만(또는 장기 거래정지로 이력 부족) 제외
RS_PERCENTILE_THRESHOLD = 90  # 이 백분위 이상만 rs_ranking.rsRank에 저장(2026-07-11
                               # 도입 당일 80으로 첫 실행해보니 527개·미분류 364개가 나와
                               # 카테고리 수작업 분류 범위를 줄이려고 90으로 상향, 사용자 확정)


def resolve_as_of_date(lookback_days=10):
    """가장 최근 실제 거래일(오늘 포함, 아직 개장 전이거나 휴일이면 그 이전 거래일)을
    KOSPI 지수 데이터 기준으로 계산한다. 주간분석.py의 resolve_target_week()과 달리
    "그 주 전체 거래일 목록"이 필요 없어(RS Score는 as_of_date 하나만 씀) 더 단순한
    버전으로 독립 구현했다."""
    today = datetime.now().date()
    df = fdr.DataReader('KS11', today - timedelta(days=lookback_days), today)
    if df.empty:
        return None
    return df.index[-1].date()


def _price_at_or_before(hist, target_ts):
    """target_ts 이전(포함) 가장 최근 거래일 종가. 이력이 그 시점까지 없으면 None."""
    window = hist[hist.index <= target_ts]
    if window.empty:
        return None
    return float(window['Close'].iloc[-1])


def _compute_return(hist, as_of_ts, months_ago, current_price):
    """as_of_ts 기준 months_ago개월 전(달력 기준 pd.DateOffset — "개월" 표현과 직접
    대응시키기 위해 거래일수 고정 오프셋을 쓰지 않음) 대비 수익률."""
    base_price = _price_at_or_before(hist, as_of_ts - pd.DateOffset(months=months_ago))
    if base_price is None or base_price <= 0:
        return None
    return (current_price - base_price) / base_price


def compute_rs_scores(universe, as_of_date):
    """universe(뉴스분석.fetch_market_data() 결과, KONEX·스팩 이미 제외)의 각 종목에 대해
    RS Score·백분위를 계산한다. 종목당 fdr.DataReader를 1회 호출해 12개월치 종가 이력을
    받으므로, 전종목(약 2,875개) 대상이면 시간이 오래 걸릴 수 있다(사용자 확정 — 느려도
    전종목 대상 유지). 상장 1년 미만은 결과에서 제외.
    반환: rsScore(백분위) 내림차순 [{code, name, rsScore}] 리스트."""
    as_of_ts = pd.Timestamp(as_of_date)
    fetch_start = as_of_date - timedelta(days=400)  # 12개월 수익률 계산 + 휴일 여유

    results = []
    total = len(universe)
    for i, (_, r) in enumerate(universe.iterrows(), start=1):
        if i % 500 == 0:
            print(f'  RS Score 계산 중... ({i}/{total})')
        code = r['Code']
        try:
            hist = fdr.DataReader(code, fetch_start, as_of_date)
        except Exception:
            continue
        if hist.empty:
            continue
        if (as_of_ts - hist.index[0]).days < RS_MIN_HISTORY_DAYS:
            continue  # 상장 1년 미만(또는 장기 거래정지) — 제외
        current_price = _price_at_or_before(hist, as_of_ts)
        if current_price is None or current_price <= 0:
            continue

        returns = {}
        for months_ago in RS_WEIGHTS:
            ret = _compute_return(hist, as_of_ts, months_ago, current_price)
            if ret is None:
                break
            returns[months_ago] = ret
        if len(returns) < len(RS_WEIGHTS):
            continue  # 3/6/9/12개월 수익률 중 하나라도 계산 불가하면 제외

        rs_score_raw = sum(RS_WEIGHTS[m] * v for m, v in returns.items())
        results.append({'code': code, 'name': r['Name'], 'rsScoreRaw': rs_score_raw})

    if not results:
        return []
    percentiles = pd.Series([s['rsScoreRaw'] for s in results]).rank(pct=True) * 100
    for s, pct in zip(results, percentiles):
        s['rsScore'] = round(float(pct), 1)
        del s['rsScoreRaw']

    results.sort(key=lambda s: s['rsScore'], reverse=True)
    return results


def fetch_global_category_map():
    """RS Score 상위 종목의 업종 카테고리를 매기기 위해, 저장된 모든 ai_analysis 문서를
    날짜 오름차순으로 훑어 종목명별 최신 카테고리를 모은다 — RS 백분위 90 이상 종목은
    대부분 일간 거래대금·등락률 상위 50 밖에 있어서 특정 날짜만 봐서는 거의 매칭이 안
    되기 때문에 전체 기간을 훑는다. 한 번이라도 일간 분석에서 분류된 적 있는 종목은 그
    카테고리를 그대로 재사용해 "이미 분류된 종목은 스킵"하는 효과를 낸다. rs_ranking()
    에서 이 함수가 1순위 소스로 쓰이고, 여기서 못 찾은 종목은 fetch_category_cache_map()
    (rs_category_cache, 영속 캐시)이 2순위로 보완한다."""
    if not MONGODB_URI:
        return {}
    client = MongoClient(MONGODB_URI)
    docs = list(client.get_default_database()['ai_analysis'].find({}))
    client.close()
    docs.sort(key=lambda d: d['_id'])

    cat_map = {}
    for doc in docs:
        analysis = doc.get('analysis', {})
        for key in ('거래대금', '등락률'):
            for item in analysis.get(key, []):
                name = item.get('종목명')
                cat = item.get('카테고리')
                if name and cat:
                    cat_map[name] = {'카테고리': cat, '신규카테고리후보': item.get('신규카테고리후보')}
    return cat_map


# ── RS 랭킹 카테고리 영속 캐시 (2026-07-11 도입) ────────────────────────────
# fetch_global_category_map()(ai_analysis 기반)은 그 종목이 일간 상위50에 한 번도
# 안 든 "RS 전용" 종목은 영원히 못 찾는다. rs_category_cache 컬렉션(_id=종목명)에
# Claude Code가 조사한 결과를 영속 저장해 ai_analysis에서 못 찾은 종목만 여기서 보완한다
# — 이 컬렉션에 한 번 기록되면 재실행해도 사라지지 않는다(예전엔 weekly_indices.rsRank에
# 직접 patch했는데 매 실행마다 rsRank를 통째로 새로 계산해 사라지는 문제가 있었음).

def fetch_category_cache_map(db):
    """rs_category_cache에서 '현재' 저장분석.VALID_CATEGORIES에 있는 카테고리 값을 가진
    문서만 읽어 {종목명: {카테고리, 신규카테고리후보}}로 반환한다(fetch_global_category_map()
    과 동일한 shape이라 attach_categories()에 그대로 넘길 수 있음). 카테고리 목록이
    개편(이름 변경·삭제)돼 저장 당시엔 유효했던 값이 더 이상 VALID_CATEGORIES에 없으면
    이 쿼리에서 자동으로 빠진다 — 문서를 지우거나 고치는 별도 무효화 작업 없이 "조회
    시점 기준"으로 항상 최신 목록에 맞춰 필터링되므로, 다음 RS Score 계산 전에 카테고리
    개편이 자동으로 반영된다. 목록이 나중에 원래대로 되돌아오면 그 문서도 다시 자동으로
    유효해짐 — 삭제 방식이었다면 사라졌을 복구성을 의도적으로 남겨둔 설계다."""
    if db is None:
        return {}
    docs = db[RS_CATEGORY_CACHE_COLLECTION].find(
        {'카테고리': {'$in': list(저장분석.VALID_CATEGORIES)}})
    return {d['_id']: {'카테고리': d['카테고리'], '신규카테고리후보': d.get('신규카테고리후보')}
            for d in docs}


def report_stale_category_cache(db):
    """rs_category_cache 전체를 훑어 카테고리 값이 더 이상 저장분석.VALID_CATEGORIES에
    없는 문서(카테고리 목록 개편으로 무효화된 캐시)를 콘솔에 보고만 한다 —
    fetch_category_cache_map()이 이미 이런 문서를 결과에서 자동으로 제외하므로 실제
    매칭 동작에는 영향이 없는 진단용 함수다. 삭제·수정하지 않는 이유: (a) 이 스크립트는
    Claude/Codex를 호출하지 않아 그 자리에서 재분류를 못 하고, (b) 목록 개편이 나중에
    되돌려지면 문서가 다시 자동으로 유효해지는 복구성을 지우지 않기 위함."""
    if db is None:
        return []
    docs = list(db[RS_CATEGORY_CACHE_COLLECTION].find({}, {'_id': 1, '카테고리': 1}))
    stale = [d for d in docs if d.get('카테고리') not in 저장분석.VALID_CATEGORIES]
    if stale:
        names = ', '.join(d['_id'] for d in stale)
        print(f'[알림] 카테고리 목록 개편 감지 — rs_category_cache에서 {len(stale)}개 '
              f'무효화됨(이번 실행부터 재분류 대상): {names}')
    return stale


def rs_ranking(db):
    """가장 최근 거래일 기준 RS Score 백분위 90 이상 종목을 산출해 rs_ranking 컬렉션의
    단일 문서(_id='latest')에 저장한다. 이 스크립트는 Claude/Codex를 호출하지 않으므로
    카테고리를 새로 판단하지 못하고, 두 소스를 순서대로 병합해서 채운다 — 1순위
    fetch_global_category_map()(ai_analysis, 항상 최신), 2순위 fetch_category_cache_map(db)
    (rs_category_cache, ai_analysis에 없는 RS 전용 종목을 위한 영속 캐시). 둘 다 없는
    종목만 '카테고리' 필드 없이 남으며, python rs랭킹.py 실행 후 Claude Code가 그
    종목들을 본업·최근 뉴스 기준으로 분류해(불확실하면 WebSearch) rs_category_cache에
    upsert하는 표준 워크플로우를 거친다(DATA_PIPELINE.md 참고). 적합한 카테고리가 없으면
    '기타'+'신규카테고리후보'로 표시하고 사용자에게 새 카테고리 추가가 필요한지 보고한다
    — 카테고리 목록 자체를 추가·변경하는 것은 항상 사용자가 결정하며 Claude Code가
    임의로 하지 않는다."""
    as_of_date = resolve_as_of_date()
    if as_of_date is None:
        print('[오류] 최근 거래일을 확인할 수 없어 RS Score를 계산할 수 없습니다.')
        return None

    print(f'RS Score 랭킹 계산 중... (기준일 {as_of_date}, 전종목 대상 — 시간이 걸릴 수 있음)')
    universe = 뉴스분석.fetch_market_data()
    scored = compute_rs_scores(universe, as_of_date)
    print(f'RS Score 계산 완료: {len(scored)}개 종목(상장 1년 미만 제외)')

    top = [s for s in scored if s['rsScore'] >= RS_PERCENTILE_THRESHOLD]
    for rank, s in enumerate(top, start=1):
        s['rank'] = rank

    report_stale_category_cache(db)  # 카테고리 목록 개편 감지·보고(파괴적 작업 없음)

    cat_map_ai = fetch_global_category_map()       # 1순위: ai_analysis(항상 최신)
    cat_map_cache = fetch_category_cache_map(db)    # 2순위: rs_category_cache(영속 폴백)
    cat_map = {**cat_map_cache, **cat_map_ai}       # 뒤 인자가 우선 — ai_analysis가 있으면 그걸로 덮어씀
    주간분석.attach_categories(top, cat_map)

    matched_ai = sum(1 for s in top if s['name'] in cat_map_ai)
    matched_cache_only = sum(1 for s in top if s['name'] in cat_map_cache and s['name'] not in cat_map_ai)
    matched = sum(1 for s in top if '카테고리' in s)
    print(f'RS Score {RS_PERCENTILE_THRESHOLD}점 이상 {len(top)}개 종목 산출 완료'
          f' (ai_analysis 매칭 {matched_ai}개, rs_category_cache 매칭 {matched_cache_only}개,'
          f' 전체 매칭 {matched}/{len(top)})')

    week_key = 주간분석.week_key(주간분석.monday_of(as_of_date))
    if db is not None:
        db[RS_RANKING_COLLECTION].update_one(
            {'_id': 'latest'},
            {'$set': {
                'asOfDate': as_of_date.isoformat(),
                'weekKey': week_key,
                'rsRank': top,
                'updatedAt': datetime.now().isoformat(),
            }},
            upsert=True,
        )
        print(f'MongoDB 저장 완료: {RS_RANKING_COLLECTION}/latest ({len(top)}개, 기준일 {as_of_date})')
    else:
        print('[경고] MONGODB_URI 없음 — RS Score 랭킹 MongoDB 저장 건너뜀')
    return top


def main():
    client = MongoClient(MONGODB_URI) if MONGODB_URI else None
    db = client.get_default_database() if client is not None else None
    rs_ranking(db)
    if client is not None:
        client.close()
    print('웹앱 "RS랭킹" 탭에 반영됩니다.')


if __name__ == '__main__':
    main()
