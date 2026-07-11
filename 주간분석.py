"""
코스피·코스닥 이번 주(월~금) 변동률 + 거래대금·등락률 상위 50 종목 + ETF 등락률 상위 15 계산
+ MongoDB 저장 스크립트
사용법: python 주간분석.py
       (아무 때나 실행 가능. 가장 최근 1주일치만 다시 계산해 weekly_indices에 upsert한다)
결과:
  - MongoDB weekly_indices 컬렉션에 해당 주차 1건
    {kospi, kosdaq: {close, change, changeRate}, vol, rate: [...50개], lastTradingDate,
     etfRank: [...15개]} 저장
    (vol/rate는 뉴스분석.py와 동일하게 KIS 통합(KRX+NXT) 보강을 거침, 2026-06-27 추가)
    (vol/rate 각 항목에 그 주 일간 ai_analysis에서 찾은 카테고리도 채움 — 매칭 안 되는
    종목은 필드 자체가 없음, 웹앱 "주간 거래대금·등락률 카테고리 비중" 도넛에 쓰임,
    2026-06-27 추가)
    (etfRank는 최소 순자산(AUM) 100억원 이상 ETF의 그 주 등락률 상위 15개 — 원래
    별도 스크립트였던 ETF분석.py의 랭킹 계산 로직을 여기로 흡수함, 2026-07-06. ETF분석.py가
    하던 구성종목(holdings) 역색인 갱신 기능은 웹앱 "ETF 분석" 탭 자체를 접으면서 함께
    삭제함 — KIS ETF 구성종목 API 응답이 불안정했던 문제([HISTORY.md](HISTORY.md) 참고)
    라기보다 "구성종목 검색" 기능 자체를 유지할 필요가 없다고 판단해 정리한 것)
    (rsRank는 전종목 대상 RS Score(3/6/9/12개월 수익률 가중합, 주식자동매매/차트분석/
    16-RS랭킹.md 공식 포팅) 백분위 90 이상 종목 — {rank, code, name, rsScore, 카테고리?}
    배열, 2026-07-11 추가(도입 당일 첫 실행에서 80 기준으로는 527개·미분류 364개가 나와
    카테고리 수작업 분류 범위가 너무 넓어져 90으로 상향). 카테고리는 과거 ai_analysis에서
    찾은 것만 채워지고 못 찾은 종목은 필드가 비어 있어 실행 후 Claude Code가 채워야 함,
    아래 "주간분석.py" 절 참고)
  - 웹앱 달력의 그 주 주차(W##) 칸이 kospi/kosdaq을 읽어 표시하고, 그 주차를 클릭하면
    카테고리 비중 도넛과 주간 종목 데이터 표 사이에 etfRank 표도 함께 보여줌
"""

import os
import sys
import time
from datetime import datetime, timedelta
import FinanceDataReader as fdr
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient

import 뉴스분석  # KIS 통합(KRX+NXT) 보강 로직 재사용 — get_kis_token/_fetch_kis_daily/
                  # fetch_market_data/임계값 상수. import만 해도 main()은 실행 안 됨
                  # (if __name__=='__main__' 가드, 주도주분석.py가 종목분석.py를 임포트하는
                  # 기존 패턴과 동일).
import 저장분석  # VALID_CATEGORIES(28개 카테고리 목록)를 단일 진실 공급원으로 재사용 —
                  # RS 랭킹 카테고리 캐시(rs_category_cache)가 이 목록을 그대로 따라야 해서
                  # 이 파일 안에 별도 사본을 만들지 않는다. 저장분석.py도 if __name__=='__main__'
                  # 가드가 있어 import만 해선 부작용 없음(위 뉴스분석.py와 동일한 패턴).

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')

MONGODB_URI = os.getenv('MONGODB_URI')

LOOKBACK_DAYS = 21  # 이번 주 + 비교 기준인 지난 주 종가 확보용 여유(휴일 감안 3주치)


def week_key(d):
    """src/utils.js의 weekKeyFromDate와 동일한 규칙(달력 연도 + ISO 주차)."""
    iso_week = d.isocalendar()[1]
    return f'{d.year}-W{iso_week}'


def monday_of(d):
    """d가 속한 주의 월요일."""
    return d - timedelta(days=d.weekday())


def weekly_change(ticker):
    """ticker의 가장 최근 월~금 주 변동률 1건을 (weekKey, {close,change,changeRate})로 반환.
    이번 주에 아직 거래일이 없으면(주말·휴일에 실행 등) 직전 완결된 주로 자동 이동한다."""
    today = datetime.now().date()
    df = fdr.DataReader(ticker, today - timedelta(days=LOOKBACK_DAYS), today)
    if df.empty:
        return None

    this_monday = monday_of(today)
    while df.loc[str(this_monday):].empty:
        this_monday -= timedelta(days=7)
    prev_monday = this_monday - timedelta(days=7)

    this_week = df.loc[str(this_monday):]
    prev_week = df.loc[str(prev_monday):str(this_monday - timedelta(days=1))]
    if prev_week.empty:
        return None

    close      = float(this_week['Close'].iloc[-1])   # 이번 주(월~금, 진행 중이면 그날까지) 마지막 종가
    prev_close = float(prev_week['Close'].iloc[-1])    # 지난 주 마지막 거래일(금) 종가
    change = close - prev_close
    return week_key(this_monday), {
        'close': close,
        'change': change,
        'changeRate': change / prev_close * 100,
    }


# ── 주간 거래대금·등락률 상위 50 (2026-06-27 추가) ───────────────────────────
# 뉴스분석.py가 하루치를 하는 것과 같은 2단계(FDR 넓은 후보 → KIS 통합 보강)를 한 주
# 단위로 적용한다. FDR fdr.DataReader(종목별 과거시세)에는 StockListing 스냅샷에 있는
# Amount(거래대금) 필드가 없어(직접 확인) Volume×Close 일별 합산으로 근사하고, 최종 순위는
# KIS 통합(UN) 거래대금 합계로 매긴다. 임계값(RATE_PRECHECK_MIN_AMOUNT/RATE_MIN_AMOUNT)은
# 일간 값을 그 주 실제 거래일 수만큼 곱해 스케일링한다(공휴일로 거래일이 줄면 임계값도 같이
# 낮아짐 — "휴장일 제외" 요구사항).

def resolve_target_week(lookback_days=LOOKBACK_DAYS):
    """이번 주(또는 거래일이 아직 없으면 가장 최근 완결된 주)의 월요일과 실제 거래일
    목록을 KOSPI 지수 데이터 기준으로 1회 계산한다. weekly_change()와 별개로 호출—
    지수 자체의 변동률 계산 로직은 그대로 두고 건드리지 않기 위함.
    반환: (week_key_str, trading_dates: list[date]) 또는 데이터가 없으면 None."""
    today = datetime.now().date()
    df = fdr.DataReader('KS11', today - timedelta(days=lookback_days), today)
    if df.empty:
        return None
    this_monday = monday_of(today)
    while df.loc[str(this_monday):].empty:
        this_monday -= timedelta(days=7)
    this_week_df = df.loc[str(this_monday):]
    trading_dates = [ts.date() for ts in this_week_df.index]
    return week_key(this_monday), trading_dates


def fetch_weekly_market_data(trading_dates):
    """전종목 유니버스는 뉴스분석.fetch_market_data()로 얻고(KONEX·스팩 제외 동일), 종목별로
    fdr.DataReader(code, 그 주 시작 10일 전, 그 주 마지막 거래일) 1회 호출해 주간 거래대금
    근사치(Volume×Close 일별 합산), 주간 거래량 합계, 주간 등락률 근사치(주 시작 전 마지막
    종가 대비)를 계산한다. 새로 상장했거나 그 주에 거래가 없는 종목은 건너뛴다. 이 근사치는
    KIS 보강 대상 후보 풀을 추리는 데만 쓰고 최종 순위는 KIS 통합 데이터로 매긴다."""
    universe = 뉴스분석.fetch_market_data()
    week_start, week_end = trading_dates[0], trading_dates[-1]
    fetch_start = week_start - timedelta(days=10)

    result = []
    total = len(universe)
    for i, (_, r) in enumerate(universe.iterrows(), start=1):
        if i % 500 == 0:
            print(f'  주간 FDR 히스토리 수집 중... ({i}/{total})')
        code = r['Code']
        try:
            hist = fdr.DataReader(code, fetch_start, week_end)
        except Exception:
            continue
        if hist.empty:
            continue
        this_week = hist.loc[str(week_start):str(week_end)]
        if this_week.empty:
            continue
        prior = hist.loc[:str(week_start - timedelta(days=1))]
        anchor_close = float(prior['Close'].iloc[-1]) if not prior.empty else None
        last_close = float(this_week['Close'].iloc[-1])
        amount_approx = float((this_week['Volume'] * this_week['Close']).sum())
        volume_sum = float(this_week['Volume'].sum())
        change_approx = (last_close - anchor_close) if anchor_close else 0.0
        rate_approx = (change_approx / anchor_close * 100) if anchor_close else 0.0
        result.append({
            'code': code,
            'name': r['Name'],
            'stocks': float(r['Stocks']),
            'weeklyAmountApprox': amount_approx,
            'weeklyVolumeApprox': volume_sum,
            'weeklyCloseApprox': last_close,
            'weeklyChangeApprox': change_approx,
            'weeklyChangeRateApprox': rate_approx,
        })
    return result


def filter_weekly_candidates(weekly_data, threshold):
    return [s for s in weekly_data if s['weeklyAmountApprox'] >= threshold]


def enrich_weekly_with_kis(candidates, trading_dates, week_anchor_date_str, db):
    """후보 종목별로 뉴스분석._fetch_kis_daily(UN)을 그 주(+여유) 범위로 1회 호출해 받은
    일별 행 중 trading_dates에 속하는 행만 합산하고(거래대금·거래량 합계, 주 마지막 거래일
    통합 종가), 등락률 기준선(주 시작 전 마지막 거래일 종가)은 뉴스분석._fetch_kis_daily(J)로
    따로 받는다(일간과 동일한 이유 — 등락률은 항상 KRX 공식 전일종가 기준).
    상한가 표시는 "그 주에 하루라도 일간 등락률 29.5% 이상을 친 날이 있는지"로 판정 —
    이미 받은 UN 행들의 종가를 연속으로 비교하고(주 첫째 날만 J 기준선과 비교) 추가 KIS
    호출 없이 계산한다(2026-06-27 사용자 확정 — 주간 누적 등락률엔 일간 ±30% 한도 개념이
    그대로 적용되지 않아 재정의함).
    종목별 호출 실패는 그 종목만 FDR 근사치로 폴백(명단에서 빠지지 않음). KIS를 전혀 못 쓰면
    (키 없음·토큰 발급 실패) None을 반환해 main()이 FDR 전용 경로로 폴백하게 한다."""
    if not 뉴스분석.KIS_APP_KEY or not 뉴스분석.KIS_APP_SECRET or not MONGODB_URI:
        print('[경고] KIS_APP_KEY/SECRET 또는 MONGODB_URI 없음 — FDR 전용으로 폴백')
        return None
    try:
        token = 뉴스분석.get_kis_token(db)
    except Exception as e:
        print(f'[경고] KIS 토큰 발급 실패, FDR 전용으로 폴백: {e}')
        return None

    trading_date_strs = {d.strftime('%Y%m%d') for d in trading_dates}
    week_start_str = trading_dates[0].strftime('%Y%m%d')
    enriched = []
    ok = fallback = 0
    for s in candidates:
        code = s['code']
        item = {'code': code, 'name': s['name']}
        try:
            un_rows_all = 뉴스분석._fetch_kis_daily(token, code, 'UN', week_anchor_date_str, lookback_days=15)
            time.sleep(0.12)
            j_rows_all = 뉴스분석._fetch_kis_daily(token, code, 'J', week_anchor_date_str, lookback_days=15)
            un_rows = [row for row in un_rows_all if row['stck_bsop_date'] in trading_date_strs]
            if not un_rows:
                raise ValueError('이번 주 통합 데이터 없음(거래정지 등)')
            j_prev_rows = [row for row in j_rows_all if row['stck_bsop_date'] < week_start_str]
            anchor_close = float(j_prev_rows[-1]['stck_clpr']) if j_prev_rows else None

            last_close = float(un_rows[-1]['stck_clpr'])
            trading_value = sum(float(row['acml_tr_pbmn']) for row in un_rows) / 1_000_000  # 백만원
            volume_sum = sum(float(row['acml_vol']) for row in un_rows)
            change = (last_close - anchor_close) if anchor_close else 0.0
            change_rate = (change / anchor_close * 100) if anchor_close else 0.0

            # 일별 등락률(상한가 판정용) — 주 첫째 날은 J 기준선, 그 이후는 UN 연속 비교
            daily_rates = []
            prev_close = anchor_close
            for row in un_rows:
                close = float(row['stck_clpr'])
                if prev_close:
                    daily_rates.append((close - prev_close) / prev_close * 100)
                prev_close = close
            hit_upper_limit = any(r >= 뉴스분석.UPPER_LIMIT_RATE for r in daily_rates)

            item.update(
                price=last_close,
                change=change,
                changeRate=change_rate,
                volume=volume_sum,
                tradingVolume=trading_value,
                marketCap=last_close * s['stocks'] / 100_000_000,
                isUpperLimit=hit_upper_limit,
            )
            ok += 1
        except Exception:
            item.update(
                price=s['weeklyCloseApprox'],
                change=s['weeklyChangeApprox'],
                changeRate=s['weeklyChangeRateApprox'],
                volume=s['weeklyVolumeApprox'],
                tradingVolume=s['weeklyAmountApprox'] / 1_000_000,
                marketCap=s['weeklyCloseApprox'] * s['stocks'] / 100_000_000,
                isUpperLimit=False,
            )
            fallback += 1
        enriched.append(item)
        time.sleep(0.12)

    print(f'주간 KIS 통합 보강: {len(candidates)}개 후보 중 {ok}개 성공, {fallback}개 FDR 폴백')
    return enriched


def build_weekly_vol_rate_from_enriched(enriched, prev_ranks, rate_min_amount_million, top=50):
    vol = sorted(enriched, key=lambda s: s['tradingVolume'], reverse=True)[:top]
    for rank, s in enumerate(vol, start=1):
        s['rank'] = rank
        s['prevRank'] = prev_ranks.get(s['code'])

    rate_eligible = [s for s in enriched if s['tradingVolume'] >= rate_min_amount_million]
    rate_sorted = sorted(rate_eligible, key=lambda s: s['changeRate'], reverse=True)[:top]
    rate = [{
        'rank': i + 1,
        'code': s['code'],
        'name': s['name'],
        'price': s['price'],
        'change': s['change'],
        'changeRate': s['changeRate'],
        'isUpperLimit': s['isUpperLimit'],
        'volume': s['volume'],
    } for i, s in enumerate(rate_sorted)]
    return vol, rate


# ── 주간 거래대금·등락률 카테고리 비중 (2026-06-27 추가) ──────────────────────
# 주간분석.py는 Claude/Codex를 호출하지 않으므로 카테고리를 직접 분류할 수 없다. 대신 그 주
# 거래일들에 대해 이미 만들어진 일간 ai_analysis(Claude/Codex 생성, 저장분석.py가 저장)에서
# 종목명별 카테고리를 모아 재사용한다 — 일간 표의 "거래대금·등락률 카테고리 비중"
# 도넛(`CategoryPieCarousel`)이 하는 매칭(날짜의 vol/rate를 ai_analysis.거래대금/등락률과
# 종목명으로 매칭)을 한 주 단위로 적용한 것.

def fetch_weekly_category_map(trading_dates):
    """그 주 거래일들의 ai_analysis에서 종목명별 카테고리를 모아
    {종목명: {'카테고리':..., '신규카테고리후보':...}}로 반환한다. 같은 종목이 그 주 여러
    날 다른 카테고리로 분류돼 있으면 더 최근 날짜의 분류로 덮어쓴다(날짜 오름차순으로 순회
    — "분석하는 시점에 가장 부합하는 카테고리를 쓰고 과거와 맞추지 않는다"는 일간 원칙을
    한 주 내에서도 그대로 적용). 그 주에 ai_analysis가 하나도 없으면(아직 분석 안 함,
    또는 카테고리 도입 전인 2026-06-25 이전 주) 빈 dict를 반환 — 프론트엔드가 일간과
    동일하게 카테고리 차트 섹션 자체를 숨기게 된다."""
    if not MONGODB_URI:
        return {}
    date_strs = sorted(d.strftime('%Y-%m-%d') for d in trading_dates)
    client = MongoClient(MONGODB_URI)
    docs = list(client.get_default_database()['ai_analysis'].find({'_id': {'$in': date_strs}}))
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


def attach_categories(items, cat_map):
    """vol/rate 항목에 cat_map에서 찾은 카테고리를 채운다. 매칭 안 되는 종목(그 주 어느
    날의 일간 거래대금·등락률 상위 50에도 없었던 경우 등)은 필드를 아예 안 붙인다 —
    프론트엔드의 aggregateByCategory()가 일간과 동일하게 매칭 실패를 '기타'로 폴백하므로
    여기서 직접 '기타'를 채우지 않는다(그러면 모든 항목이 항상 카테고리를 갖게 돼,
    "그 주에 카테고리 데이터가 전혀 없다"는 신호(cat_map 비어있음)와 구분이 안 됨)."""
    for s in items:
        info = cat_map.get(s['name'])
        if not info:
            continue
        s['카테고리'] = info['카테고리']
        if info['카테고리'] == '기타' and info.get('신규카테고리후보'):
            s['신규카테고리후보'] = info['신규카테고리후보']


def get_previous_week_vol_ranks(week_key_str):
    """직전 주(weekly_indices 중 vol 필드가 있고 (year, iso주차)가 week_key_str보다 작은
    가장 최근 문서)의 거래대금 순위를 {종목코드: 순위}로 반환. weekly_indices의 _id는
    "2026-W9" 형태라 문자열 정렬이 시간순이 아니므로(DATA_PIPELINE.md에 문서화된 함정),
    전체 문서를 가져와 (year, iso주차) 튜플로 직접 비교한다."""
    if not MONGODB_URI:
        return {}

    def parse_key(k):
        y, w = k.split('-W')
        return int(y), int(w)

    target = parse_key(week_key_str)
    client = MongoClient(MONGODB_URI)
    docs = list(client.get_default_database()['weekly_indices'].find({'vol': {'$exists': True}}))
    client.close()
    candidates = [d for d in docs if parse_key(d['_id']) < target]
    if not candidates:
        return {}
    prev = max(candidates, key=lambda d: parse_key(d['_id']))
    return {s['code']: s['rank'] for s in prev['vol']}


# ── 주간 ETF 등락률 상위 15 (원래 별도 ETF분석.py였던 랭킹 계산 로직을 흡수, 2026-07-06) ──
# ETF분석.py가 하던 두 가지 일(랭킹 계산 + KIS로 구성종목 역색인 갱신) 중 랭킹 계산만 여기로
# 옮기고, 구성종목 갱신은 "ETF 분석" 탭의 구성종목 검색 기능 자체를 없애면서 함께 삭제했다
# (etf_constituents 컬렉션도 더 이상 채우지 않음). resolve_target_week()을 그대로 재사용해
# vol/rate와 같은 주(weekly_indices._id)에 합쳐지도록 한다.

ETF_MIN_MARKET_CAP = 100  # 최소 순자산(AUM) 100억원 — fdr.StockListing('ETF/KR')의 MarCap
                          # 컬럼은 원 단위가 아니라 억원 단위로 내려온다(직접 확인, 2026-07-04 —
                          # KODEX 200의 MarCap이 273942로 나오는데 이는 27.4조원에 해당).
                          # 레버리지·테마 ETF의 반짝 변동성이 랭킹을 독점하지 않도록 하는 필터
                          # (사용자 확정).


def fetch_etf_universe():
    """fdr.StockListing('ETF/KR')로 현재 상장된 ETF 전체 유니버스를 받아
    {code, name, marCap} 리스트로 변환한다. marCap은 억원 단위(위 ETF_MIN_MARKET_CAP 설명
    참고). 원본의 Category 컬럼은 1~7의 내부 분류 코드일 뿐 사람이 읽을 수 있는 이름이
    아니라(직접 확인 — "KODEX 200"과 "TIGER 200"이 둘 다 1인 반면 "KODEX 레버리지"는 3,
    매핑표를 찾지 못함) 사용하지 않는다."""
    df = fdr.StockListing('ETF/KR')
    result = []
    for _, r in df.iterrows():
        result.append({
            'code': r['Symbol'],
            'name': r['Name'],
            'marCap': float(r['MarCap']),
        })
    return result


def etf_weekly_change(code, week_start, week_end):
    """해당 ETF의 그 주(week_start~week_end) 마지막 종가 vs 그 전 마지막 종가로 등락률을
    계산한다. fetch_weekly_market_data()와 동일한 윈도잉(과거 10일 여유를 두고 조회해
    주 시작 전 마지막 종가를 anchor로 삼음). 히스토리가 부족하면(신규 상장 등) None."""
    try:
        hist = fdr.DataReader(code, week_start - timedelta(days=10), week_end)
    except Exception:
        return None
    if hist.empty:
        return None
    this_week = hist.loc[str(week_start):str(week_end)]
    if this_week.empty:
        return None
    prior = hist.loc[:str(week_start - timedelta(days=1))]
    if prior.empty:
        return None
    anchor_close = float(prior['Close'].iloc[-1])
    last_close = float(this_week['Close'].iloc[-1])
    if not anchor_close:
        return None
    change = last_close - anchor_close
    return {
        'price': last_close,
        'change': change,
        'changeRate': change / anchor_close * 100,
    }


def etf_weekly_rank(db, top=15):
    resolved = resolve_target_week()
    if resolved is None:
        print('[경고] ETF 주간 랭킹을 계산할 거래일이 없어 건너뜁니다.')
        return None
    target_week, trading_dates = resolved
    week_start, week_end = trading_dates[0], trading_dates[-1]

    universe = fetch_etf_universe()
    eligible = [e for e in universe if e['marCap'] and e['marCap'] >= ETF_MIN_MARKET_CAP]
    print(f'ETF 유니버스 {len(universe)}개 중 최소 AUM(100억) 이상 {len(eligible)}개 대상으로 계산...')

    ranked = []
    for i, e in enumerate(eligible, start=1):
        if i % 200 == 0:
            print(f'  ETF 주간 등락률 계산 중... ({i}/{len(eligible)})')
        change = etf_weekly_change(e['code'], week_start, week_end)
        if change is None:
            continue
        ranked.append({**e, **change})

    ranked.sort(key=lambda s: s['changeRate'], reverse=True)
    top_ranked = ranked[:top]
    for rank, s in enumerate(top_ranked, start=1):
        s['rank'] = rank

    etf_rank = [{
        'rank': s['rank'],
        'code': s['code'],
        'name': s['name'],
        'price': s['price'],
        'change': s['change'],
        'changeRate': s['changeRate'],
        'marCap': s['marCap'],
    } for s in top_ranked]

    if db is not None:
        db['weekly_indices'].update_one({'_id': target_week}, {'$set': {'etfRank': etf_rank}}, upsert=True)
        print(f'MongoDB 저장 완료: weekly_indices/{target_week}.etfRank ({len(etf_rank)}개)')
    else:
        print('[경고] MONGODB_URI 없음 — ETF 랭킹 MongoDB 저장 건너뜀')

    print(f'ETF 주간 등락률 상위 {len(etf_rank)}개 산출 완료 ({len(eligible)}개 후보 중 {len(ranked)}개 계산 성공)')
    return target_week, etf_rank


# ── RS Score 랭킹 (Relative Strength, 2026-07-11 도입) ──────────────────────
# 주식자동매매/차트분석/16-RS랭킹.md에 문서화된 RS Score 공식(윌리엄 오닐/IBD 스타일
# 근사식: 최근 3/6/9/12개월 수익률에 40/20/20/20% 가중치)을 그대로 포팅한다. 원 구현은
# 그 프로젝트의 backtest/relative_strength.py에 있으나 완전히 다른 git 저장소라 import할
# 수 없어(뉴스분석.py를 이 파일이 import하는 것과 달리 로컬 파일 경로 자체가 없음) 필요한
# 부분만 이 파일에 다시 구현했다. rsScore는 계산에 성공한 종목군 내 백분위(0~100, 원
# 프로젝트의 rs_percentile과 동일한 정의 — 전체 시장 절대 기준이 아니라 이번 주 계산
# 대상(상장 1년 미만 제외 후 전종목) 내에서의 상대 순위)이며, 사용자가 화면에서 보는
# "RS score 100점~90점"이 바로 이 값이다.

RS_WEIGHTS = {3: 0.4, 6: 0.2, 9: 0.2, 12: 0.2}       # 개월 수 → 가중치
RS_MIN_HISTORY_DAYS = 365  # 상장 1년 미만(또는 장기 거래정지로 이력 부족) 제외
RS_PERCENTILE_THRESHOLD = 90  # 이 백분위 이상만 weekly_indices.rsRank에 저장(2026-07-11
                               # 도입 당일 80으로 첫 실행해보니 527개·미분류 364개가 나와
                               # 카테고리 수작업 분류 범위를 줄이려고 90으로 상향, 사용자 확정)


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
    RS Score·백분위를 계산한다. 종목당 fdr.DataReader를 1회 호출(fetch_weekly_market_data와
    동일한 패턴)해 12개월치 종가 이력을 받으므로, 전종목(약 2,875개) 대상이면 시간이 오래
    걸릴 수 있다(사용자 확정 — 느려도 전종목 대상 유지). 상장 1년 미만은 결과에서 제외.
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
    """RS Score 상위 종목의 업종 카테고리를 매기기 위해, fetch_weekly_category_map()과
    달리 그 주로 범위를 좁히지 않고 지금까지 저장된 모든 ai_analysis 문서를 날짜
    오름차순으로 훑어 종목명별 최신 카테고리를 모은다 — RS 백분위 90 이상 종목은 대부분
    그 주 거래대금·등락률 상위 50 밖에 있어서 그 주 ai_analysis만 봐서는 거의 매칭이 안
    되기 때문. 한 번이라도 일간 분석에서 분류된 적 있는 종목은 그 카테고리를 그대로
    재사용해 "이미 분류된 종목은 스킵"하는 효과를 낸다. rs_ranking()에서 이 함수가
    1순위 소스로 쓰이고, 여기서 못 찾은 종목은 fetch_category_cache_map()(rs_category_cache,
    영속 캐시)이 2순위로 보완한다 — 두 함수 모두 못 찾은 종목만 진짜 미분류로 남는다."""
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
# 안 든 "RS 전용" 종목은 영원히 못 찾는다. 이전에는 그런 종목을 Claude Code가 조사해
# weekly_indices.rsRank에 직접 patch했는데, rs_ranking()이 매 실행마다 rsRank 전체를
# 새로 계산해 덮어써서 그 patch가 다음 실행(다음 주 등) 때 사라지는 문제가 있었다
# (2026-W28 첫 실행에서 실제로 겪음 — 90점 기준 264개 중 150개 미분류를 임시로 '기타'
# patch했다가 재실행하면 사라진다는 걸 확인). rs_category_cache 컬렉션(_id=종목명)을
# 새로 두어 Claude Code가 조사한 결과를 영속 저장하고, ai_analysis에서 못 찾은 종목만
# 여기서 보완한다.

RS_CATEGORY_CACHE_COLLECTION = 'rs_category_cache'


def fetch_category_cache_map(db):
    """rs_category_cache에서 '현재' 저장분석.VALID_CATEGORIES에 있는 카테고리 값을 가진
    문서만 읽어 {종목명: {카테고리, 신규카테고리후보}}로 반환한다(fetch_global_category_map()
    과 동일한 shape이라 attach_categories()에 그대로 넘길 수 있음). 카테고리 목록이
    개편(이름 변경·삭제)돼 저장 당시엔 유효했던 값이 더 이상 VALID_CATEGORIES에 없으면
    이 쿼리에서 자동으로 빠진다 — 문서를 지우거나 고치는 별도 무효화 작업 없이 "조회
    시점 기준"으로 항상 최신 목록에 맞춰 필터링되므로, 다음 RS Score 계산 전에 카테고리
    개편이 자동으로 반영된다(사용자 요청). 목록이 나중에 원래대로 되돌아오면 그 문서도
    다시 자동으로 유효해짐 — 삭제 방식이었다면 사라졌을 복구성을 의도적으로 남겨둔
    설계다. db는 호출부(rs_ranking)가 이미 열어둔 핸들을 그대로 받는다(fetch_global_
    category_map()처럼 별도 MongoClient를 새로 열지 않음)."""
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
    Claude/Codex를 호출하지 않아 그 자리에서 재분류를 못 하고(기존 원칙 유지), (b) 목록
    개편이 나중에 되돌려지면 문서가 다시 자동으로 유효해지는 복구성을 지우지 않기
    위함. rs_ranking() 맨 앞에서 호출해 "이번 실행부터 재분류가 필요해진 종목"을 조기에
    알린다."""
    if db is None:
        return []
    docs = list(db[RS_CATEGORY_CACHE_COLLECTION].find({}, {'_id': 1, '카테고리': 1}))
    stale = [d for d in docs if d.get('카테고리') not in 저장분석.VALID_CATEGORIES]
    if stale:
        names = ', '.join(d['_id'] for d in stale)
        print(f'[알림] 카테고리 목록 개편 감지 — rs_category_cache에서 {len(stale)}개 '
              f'무효화됨(이번 실행부터 재분류 대상): {names}')
    return stale


def rs_ranking(db, target_week, trading_dates):
    """그 주 마지막 거래일 기준 RS Score 백분위 90 이상 종목을 산출해 weekly_indices에
    rsRank 필드로 저장한다. 이 스크립트는 Claude/Codex를 호출하지 않으므로(기존
    attach_categories와 동일한 원칙) 카테고리를 새로 판단하지 못하고, 두 소스를 순서대로
    병합해서 채운다 — 1순위 fetch_global_category_map()(ai_analysis, 항상 최신),
    2순위 fetch_category_cache_map(db)(rs_category_cache, ai_analysis에 없는 RS 전용
    종목을 위한 영속 캐시). 둘 다 없는 종목만 '카테고리' 필드 없이 남으며, python
    주간분석.py 실행 후 Claude Code가 그 종목들을 본업·최근 뉴스 기준으로 분류해
    (불확실하면 WebSearch) rs_category_cache에 upsert하는 표준 워크플로우를 거친다(기존
    vol/rate 카테고리 공백 채우기 워크플로우와 동일한 패턴 — DATA_PIPELINE.md 참고).
    rs_category_cache에 한 번 기록되면 다음 주 이후로도 재사용되므로, 예전처럼
    weekly_indices.rsRank에만 직접 patch했을 때와 달리 재실행해도 사라지지 않는다.
    적합한 카테고리가 없으면 '기타'+'신규카테고리후보'로 표시하고 사용자에게 새 카테고리
    추가가 필요한지 보고한다 — 카테고리 목록 자체를 추가·변경하는 것은 항상 사용자가
    결정하며 Claude Code가 임의로 하지 않는다."""
    as_of_date = trading_dates[-1]
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
    attach_categories(top, cat_map)

    matched_ai = sum(1 for s in top if s['name'] in cat_map_ai)
    matched_cache_only = sum(1 for s in top if s['name'] in cat_map_cache and s['name'] not in cat_map_ai)
    matched = sum(1 for s in top if '카테고리' in s)
    print(f'RS Score {RS_PERCENTILE_THRESHOLD}점 이상 {len(top)}개 종목 산출 완료'
          f' (ai_analysis 매칭 {matched_ai}개, rs_category_cache 매칭 {matched_cache_only}개,'
          f' 전체 매칭 {matched}/{len(top)})')

    if db is not None:
        db['weekly_indices'].update_one({'_id': target_week}, {'$set': {'rsRank': top}}, upsert=True)
        print(f'MongoDB 저장 완료: weekly_indices/{target_week}.rsRank ({len(top)}개)')
    else:
        print('[경고] MONGODB_URI 없음 — RS Score 랭킹 MongoDB 저장 건너뜀')
    return top


def save_to_mongodb(week, entry):
    if not MONGODB_URI:
        print('[경고] MONGODB_URI 없음 — MongoDB 저장 건너뜀')
        return
    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['weekly_indices']
    col.update_one({'_id': week}, {'$set': entry}, upsert=True)
    client.close()
    print(f'MongoDB 저장 완료: weekly_indices/{week}')


def main():
    print('코스피·코스닥 이번 주(월~금) 변동률 계산 중...')
    kospi  = weekly_change('KS11')
    kosdaq = weekly_change('KQ11')

    if not kospi and not kosdaq:
        print('[오류] 최근 거래일 데이터가 부족해 계산할 수 없습니다.')
        return

    week  = (kospi or kosdaq)[0]
    entry = {}
    if kospi:
        entry['kospi'] = kospi[1]
    if kosdaq:
        entry['kosdaq'] = kosdaq[1]

    k, q = entry.get('kospi'), entry.get('kosdaq')
    if k and q:
        print(f"{week}: 코스피 {k['changeRate']:+.2f}%, 코스닥 {q['changeRate']:+.2f}%")

    resolved = resolve_target_week()
    if resolved is None:
        print('[경고] 주간 거래대금/등락률을 계산할 거래일이 없어 건너뜁니다.')
    else:
        target_week, trading_dates = resolved
        n_days = len(trading_dates)
        print(f'주간 거래대금·등락률 상위 50 산출 중... (이번 주 실제 거래일 {n_days}일)')
        rate_precheck_min = 뉴스분석.RATE_PRECHECK_MIN_AMOUNT * n_days
        rate_min          = 뉴스분석.RATE_MIN_AMOUNT * n_days
        week_anchor_date_str = trading_dates[-1].strftime('%Y-%m-%d')

        market_data = fetch_weekly_market_data(trading_dates)
        print(f'주간 FDR 히스토리 수집 완료: {len(market_data)}개 종목')
        candidates = filter_weekly_candidates(market_data, rate_precheck_min)

        client = MongoClient(MONGODB_URI) if MONGODB_URI else None
        db = client.get_default_database() if client is not None else None
        prev_ranks = get_previous_week_vol_ranks(target_week)
        enriched = enrich_weekly_with_kis(candidates, trading_dates, week_anchor_date_str, db) if db is not None else None
        if client is not None:
            client.close()

        if enriched is not None:
            vol, rate = build_weekly_vol_rate_from_enriched(enriched, prev_ranks, rate_min / 1_000_000)
            cat_map = fetch_weekly_category_map(trading_dates)
            attach_categories(vol, cat_map)
            attach_categories(rate, cat_map)
            entry['vol']  = vol
            entry['rate'] = rate
            entry['lastTradingDate'] = week_anchor_date_str
            matched = sum(1 for s in vol + rate if '카테고리' in s)
            print(f'주간 거래대금 상위 {len(vol)}개, 등락률 상위 {len(rate)}개 종목 산출 완료'
                  f' (일간 분석에서 카테고리 매칭 {matched}/{len(vol) + len(rate)})')
        else:
            print('[경고] KIS 보강 실패 — 이번 실행에서는 주간 거래대금/등락률을 저장하지 않습니다.')

    save_to_mongodb(week, entry)

    print('주간 ETF 등락률 상위 15 산출 중...')
    etf_client = MongoClient(MONGODB_URI) if MONGODB_URI else None
    etf_db = etf_client.get_default_database() if etf_client is not None else None
    etf_weekly_rank(etf_db)
    if etf_client is not None:
        etf_client.close()

    if resolved is not None:
        rs_target_week, rs_trading_dates = resolved  # 위에서 이미 계산해둔 값 재사용(재조회 없음)
        rs_client = MongoClient(MONGODB_URI) if MONGODB_URI else None
        rs_db = rs_client.get_default_database() if rs_client is not None else None
        rs_ranking(rs_db, rs_target_week, rs_trading_dates)
        if rs_client is not None:
            rs_client.close()
    else:
        print('[경고] RS Score 랭킹을 계산할 거래일이 없어 건너뜁니다.')

    print('웹앱 달력의 이번 주 주차(W##) 칸에 반영됩니다.')


if __name__ == '__main__':
    main()
