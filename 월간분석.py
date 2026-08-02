"""
코스피·코스닥 이번 달 변동률 + 거래대금·등락률 상위 50 종목 + ETF 등락률 상위 15 계산
+ MongoDB 저장 스크립트 (주간분석.py의 월간 버전)
사용법: python 월간분석.py
       (아무 때나 실행 가능. 가장 최근 1개월치만 다시 계산해 monthly_indices에 upsert한다)
결과:
  - MongoDB monthly_indices 컬렉션에 해당 달 1건
    {kospi, kosdaq: {close, change, changeRate}, vol, rate: [...50개], lastTradingDate,
     etfRank: [...15개]} 저장
    (vol/rate는 뉴스분석.py·주간분석.py와 동일하게 KIS 통합(KRX+NXT) 보강을 거침)
    (vol/rate 각 항목에 그 달 일간 ai_analysis에서 찾은 카테고리도 채움 — 주간분석.py의
    fetch_weekly_category_map()/attach_categories()가 trading_dates만 받는 범용 함수라
    그대로 재사용함, 매칭 안 되는 종목은 필드 자체가 없음)
    (etfRank는 최소 순자산(AUM) 100억원 이상 ETF의 그 달 등락률 상위 15개 — 주간분석.py의
    fetch_etf_universe()/ETF_MIN_MARKET_CAP도 그대로 재사용)
  - 웹앱 달력의 "YYYY년 M월" 제목을 클릭하면 그 달의 코스피/코스닥 + 카테고리 비중 도넛 +
    ETF 랭킹 + 거래대금·등락률 상위 50 표를 보여줌(주간뷰의 주차(W##) 칸 클릭과 동일한 패턴)

RS Score(상대강도) 랭킹은 이 스크립트가 다루지 않는다(주간분석.py와 동일하게 rs랭킹.py가
별도로 계산·저장, 달력 뷰와 무관한 독립 "RS랭킹" 탭 전용).
"""

import os
import sys
import time
import calendar
from datetime import datetime, timedelta
import FinanceDataReader as fdr
from dotenv import load_dotenv
from pymongo import MongoClient

import 뉴스분석  # KIS 통합(KRX+NXT) 보강 로직 재사용 — get_kis_token/_fetch_kis_daily/
                  # fetch_market_data/임계값 상수.
import 주간분석  # attach_categories/fetch_weekly_category_map(둘 다 trading_dates만 받는
                  # 범용 함수)·fetch_etf_universe/ETF_MIN_MARKET_CAP 재사용. import만 해도
                  # main()은 실행 안 됨(if __name__=='__main__' 가드, rs랭킹.py가 주간분석.py를
                  # 임포트하는 기존 패턴과 동일).

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')

MONGODB_URI = os.getenv('MONGODB_URI')

LOOKBACK_DAYS = 70  # 이번 달 + 비교 기준인 지난 달 마지막 종가 확보용 여유(공휴일 감안 약 2.3개월치)
KIS_LOOKBACK_DAYS = 45  # 그 달 전체(최대 31일) + 지난 달 마지막 거래일 기준선 확보용 여유


def month_key(d):
    """예: 2026-07-15 → "2026-07" """
    return f'{d.year}-{d.month:02d}'


def first_day_of_month(d):
    return d.replace(day=1)


def month_end(d):
    last_day = calendar.monthrange(d.year, d.month)[1]
    return d.replace(day=last_day)


def monthly_change(ticker):
    """ticker의 가장 최근 1개월 변동률 1건을 (monthKey, {close,change,changeRate})로 반환.
    이번 달에 아직 거래일이 없으면(월초 실행 등) 직전 완결된 달로 자동 이동한다."""
    today = datetime.now().date()
    df = fdr.DataReader(ticker, today - timedelta(days=LOOKBACK_DAYS), today)
    if df.empty:
        return None

    this_month_start = first_day_of_month(today)
    while df.loc[str(this_month_start):].empty:
        this_month_start = first_day_of_month(this_month_start - timedelta(days=1))
    this_month_end = month_end(this_month_start)

    this_month = df.loc[str(this_month_start):str(this_month_end)]
    prev_month = df.loc[:str(this_month_start - timedelta(days=1))]
    if prev_month.empty:
        return None

    close      = float(this_month['Close'].iloc[-1])   # 이번 달(진행 중이면 그날까지) 마지막 종가
    prev_close = float(prev_month['Close'].iloc[-1])    # 지난 달 마지막 거래일 종가
    change = close - prev_close
    return month_key(this_month_start), {
        'close': close,
        'change': change,
        'changeRate': change / prev_close * 100,
    }


# ── 월간 거래대금·등락률 상위 50 (주간분석.py 로직을 그대로 월 단위로 적용) ──────────

def resolve_target_month(lookback_days=LOOKBACK_DAYS):
    """이번 달(또는 거래일이 아직 없으면 가장 최근 완결된 달)의 실제 거래일 목록을 KOSPI
    지수 데이터 기준으로 1회 계산한다. monthly_change()와 별개로 호출 — 지수 자체의
    변동률 계산 로직은 그대로 두고 건드리지 않기 위함.
    반환: (month_key_str, trading_dates: list[date]) 또는 데이터가 없으면 None."""
    today = datetime.now().date()
    df = fdr.DataReader('KS11', today - timedelta(days=lookback_days), today)
    if df.empty:
        return None
    this_month_start = first_day_of_month(today)
    while df.loc[str(this_month_start):].empty:
        this_month_start = first_day_of_month(this_month_start - timedelta(days=1))
    this_month_end = month_end(this_month_start)
    this_month_df = df.loc[str(this_month_start):str(this_month_end)]
    trading_dates = [ts.date() for ts in this_month_df.index]
    if not trading_dates:
        return None
    return month_key(this_month_start), trading_dates


def fetch_monthly_market_data(trading_dates):
    """전종목 유니버스는 뉴스분석.fetch_market_data()로 얻고(KONEX·스팩 제외 동일), 종목별로
    fdr.DataReader(code, 그 달 시작 10일 전, 그 달 마지막 거래일) 1회 호출해 월간 거래대금
    근사치(Volume×Close 일별 합산), 월간 거래량 합계, 월간 등락률 근사치(달 시작 전 마지막
    종가 대비)를 계산한다. 새로 상장했거나 그 달에 거래가 없는 종목은 건너뛴다. 이 근사치는
    KIS 보강 대상 후보 풀을 추리는 데만 쓰고 최종 순위는 KIS 통합 데이터로 매긴다."""
    universe = 뉴스분석.fetch_market_data()
    month_start, month_last = trading_dates[0], trading_dates[-1]
    fetch_start = month_start - timedelta(days=10)

    result = []
    total = len(universe)
    for i, (_, r) in enumerate(universe.iterrows(), start=1):
        if i % 500 == 0:
            print(f'  월간 FDR 히스토리 수집 중... ({i}/{total})')
        code = r['Code']
        try:
            hist = fdr.DataReader(code, fetch_start, month_last)
        except Exception:
            continue
        if hist.empty:
            continue
        this_month = hist.loc[str(month_start):str(month_last)]
        if this_month.empty:
            continue
        prior = hist.loc[:str(month_start - timedelta(days=1))]
        anchor_close = float(prior['Close'].iloc[-1]) if not prior.empty else None
        last_close = float(this_month['Close'].iloc[-1])
        amount_approx = float((this_month['Volume'] * this_month['Close']).sum())
        volume_sum = float(this_month['Volume'].sum())
        change_approx = (last_close - anchor_close) if anchor_close else 0.0
        rate_approx = (change_approx / anchor_close * 100) if anchor_close else 0.0
        result.append({
            'code': code,
            'name': r['Name'],
            'stocks': float(r['Stocks']),
            'monthlyAmountApprox': amount_approx,
            'monthlyVolumeApprox': volume_sum,
            'monthlyCloseApprox': last_close,
            'monthlyChangeApprox': change_approx,
            'monthlyChangeRateApprox': rate_approx,
        })
    return result


def filter_monthly_candidates(monthly_data, threshold):
    return [s for s in monthly_data if s['monthlyAmountApprox'] >= threshold]


def enrich_monthly_with_kis(candidates, trading_dates, month_anchor_date_str, db):
    """후보 종목별로 뉴스분석._fetch_kis_daily(UN)을 그 달(+여유) 범위로 1회 호출해 받은
    일별 행 중 trading_dates에 속하는 행만 합산하고(거래대금·거래량 합계, 달 마지막 거래일
    통합 종가), 등락률 기준선(달 시작 전 마지막 거래일 종가)은 뉴스분석._fetch_kis_daily(J)로
    따로 받는다(주간분석.py와 동일한 이유 — 등락률은 항상 KRX 공식 전일종가 기준).
    상한가 표시는 "그 달에 하루라도 일간 등락률 29.5% 이상을 친 날이 있는지"로 판정(주간과
    동일한 재정의) — 이미 받은 UN 행들의 종가를 연속으로 비교하고(달 첫째 날만 J 기준선과
    비교) 추가 KIS 호출 없이 계산한다.
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
    month_start_str = trading_dates[0].strftime('%Y%m%d')
    enriched = []
    ok = fallback = 0
    for s in candidates:
        code = s['code']
        item = {'code': code, 'name': s['name']}
        try:
            un_rows_all = 뉴스분석._fetch_kis_daily(token, code, 'UN', month_anchor_date_str, lookback_days=KIS_LOOKBACK_DAYS)
            time.sleep(0.12)
            j_rows_all = 뉴스분석._fetch_kis_daily(token, code, 'J', month_anchor_date_str, lookback_days=KIS_LOOKBACK_DAYS)
            un_rows = [row for row in un_rows_all if row['stck_bsop_date'] in trading_date_strs]
            if not un_rows:
                raise ValueError('이번 달 통합 데이터 없음(거래정지 등)')
            j_prev_rows = [row for row in j_rows_all if row['stck_bsop_date'] < month_start_str]
            anchor_close = float(j_prev_rows[-1]['stck_clpr']) if j_prev_rows else None

            last_close = float(un_rows[-1]['stck_clpr'])
            trading_value = sum(float(row['acml_tr_pbmn']) for row in un_rows) / 1_000_000  # 백만원
            volume_sum = sum(float(row['acml_vol']) for row in un_rows)
            change = (last_close - anchor_close) if anchor_close else 0.0
            change_rate = (change / anchor_close * 100) if anchor_close else 0.0

            # 일별 등락률(상한가 판정용) — 달 첫째 날은 J 기준선, 그 이후는 UN 연속 비교
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
                price=s['monthlyCloseApprox'],
                change=s['monthlyChangeApprox'],
                changeRate=s['monthlyChangeRateApprox'],
                volume=s['monthlyVolumeApprox'],
                tradingVolume=s['monthlyAmountApprox'] / 1_000_000,
                marketCap=s['monthlyCloseApprox'] * s['stocks'] / 100_000_000,
                isUpperLimit=False,
            )
            fallback += 1
        enriched.append(item)
        time.sleep(0.12)

    print(f'월간 KIS 통합 보강: {len(candidates)}개 후보 중 {ok}개 성공, {fallback}개 FDR 폴백')
    return enriched


def build_monthly_vol_rate_from_enriched(enriched, prev_ranks, rate_min_amount_million, top=50):
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


def get_previous_month_vol_ranks(month_key_str):
    """직전 달(monthly_indices 중 vol 필드가 있고 (year, month)가 month_key_str보다 작은
    가장 최근 문서)의 거래대금 순위를 {종목코드: 순위}로 반환. weekly_indices와 동일한
    "_id 문자열 정렬은 시간순이 아니다" 함정을 피하려 전체 문서를 가져와 (year, month)
    튜플로 직접 비교한다(monthly_indices는 "YYYY-MM"이라 사실 사전식 정렬도 시간순이지만,
    주간분석.py와 동일한 안전한 패턴을 그대로 따름)."""
    if not MONGODB_URI:
        return {}

    def parse_key(k):
        y, m = k.split('-')
        return int(y), int(m)

    target = parse_key(month_key_str)
    client = MongoClient(MONGODB_URI)
    docs = list(client.get_default_database()['monthly_indices'].find({'vol': {'$exists': True}}))
    client.close()
    candidates = [d for d in docs if parse_key(d['_id']) < target]
    if not candidates:
        return {}
    prev = max(candidates, key=lambda d: parse_key(d['_id']))
    return {s['code']: s['rank'] for s in prev['vol']}


# ── 월간 ETF 등락률 상위 15 (주간분석.py의 fetch_etf_universe/ETF_MIN_MARKET_CAP 재사용) ──

def etf_monthly_change(code, month_start, month_last):
    """해당 ETF의 그 달(month_start~month_last) 마지막 종가 vs 그 전 마지막 종가로 등락률을
    계산한다. fetch_monthly_market_data()와 동일한 윈도잉. 히스토리가 부족하면(신규 상장 등) None."""
    try:
        hist = fdr.DataReader(code, month_start - timedelta(days=10), month_last)
    except Exception:
        return None
    if hist.empty:
        return None
    this_month = hist.loc[str(month_start):str(month_last)]
    if this_month.empty:
        return None
    prior = hist.loc[:str(month_start - timedelta(days=1))]
    if prior.empty:
        return None
    anchor_close = float(prior['Close'].iloc[-1])
    last_close = float(this_month['Close'].iloc[-1])
    if not anchor_close:
        return None
    change = last_close - anchor_close
    return {
        'price': last_close,
        'change': change,
        'changeRate': change / anchor_close * 100,
    }


def etf_monthly_rank(db, top=15):
    resolved = resolve_target_month()
    if resolved is None:
        print('[경고] ETF 월간 랭킹을 계산할 거래일이 없어 건너뜁니다.')
        return None
    target_month, trading_dates = resolved
    month_start, month_last = trading_dates[0], trading_dates[-1]

    universe = 주간분석.fetch_etf_universe()
    eligible = [e for e in universe if e['marCap'] and e['marCap'] >= 주간분석.ETF_MIN_MARKET_CAP]
    print(f'ETF 유니버스 {len(universe)}개 중 최소 AUM(100억) 이상 {len(eligible)}개 대상으로 계산...')

    ranked = []
    for i, e in enumerate(eligible, start=1):
        if i % 200 == 0:
            print(f'  ETF 월간 등락률 계산 중... ({i}/{len(eligible)})')
        change = etf_monthly_change(e['code'], month_start, month_last)
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
        db['monthly_indices'].update_one({'_id': target_month}, {'$set': {'etfRank': etf_rank}}, upsert=True)
        print(f'MongoDB 저장 완료: monthly_indices/{target_month}.etfRank ({len(etf_rank)}개)')
    else:
        print('[경고] MONGODB_URI 없음 — ETF 랭킹 MongoDB 저장 건너뜀')

    print(f'ETF 월간 등락률 상위 {len(etf_rank)}개 산출 완료 ({len(eligible)}개 후보 중 {len(ranked)}개 계산 성공)')
    return target_month, etf_rank


def save_to_mongodb(month, entry):
    if not MONGODB_URI:
        print('[경고] MONGODB_URI 없음 — MongoDB 저장 건너뜀')
        return
    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['monthly_indices']
    col.update_one({'_id': month}, {'$set': entry}, upsert=True)
    client.close()
    print(f'MongoDB 저장 완료: monthly_indices/{month}')


def main():
    print('코스피·코스닥 이번 달 변동률 계산 중...')
    kospi  = monthly_change('KS11')
    kosdaq = monthly_change('KQ11')

    if not kospi and not kosdaq:
        print('[오류] 최근 거래일 데이터가 부족해 계산할 수 없습니다.')
        return

    month = (kospi or kosdaq)[0]
    entry = {}
    if kospi:
        entry['kospi'] = kospi[1]
    if kosdaq:
        entry['kosdaq'] = kosdaq[1]

    k, q = entry.get('kospi'), entry.get('kosdaq')
    if k and q:
        print(f"{month}: 코스피 {k['changeRate']:+.2f}%, 코스닥 {q['changeRate']:+.2f}%")

    resolved = resolve_target_month()
    if resolved is None:
        print('[경고] 월간 거래대금/등락률을 계산할 거래일이 없어 건너뜁니다.')
    else:
        target_month, trading_dates = resolved
        n_days = len(trading_dates)
        print(f'월간 거래대금·등락률 상위 50 산출 중... (이번 달 실제 거래일 {n_days}일)')
        rate_precheck_min = 뉴스분석.RATE_PRECHECK_MIN_AMOUNT * n_days
        rate_min          = 뉴스분석.RATE_MIN_AMOUNT * n_days
        month_anchor_date_str = trading_dates[-1].strftime('%Y-%m-%d')

        market_data = fetch_monthly_market_data(trading_dates)
        print(f'월간 FDR 히스토리 수집 완료: {len(market_data)}개 종목')
        candidates = filter_monthly_candidates(market_data, rate_precheck_min)

        client = MongoClient(MONGODB_URI) if MONGODB_URI else None
        db = client.get_default_database() if client is not None else None
        prev_ranks = get_previous_month_vol_ranks(target_month)
        enriched = enrich_monthly_with_kis(candidates, trading_dates, month_anchor_date_str, db) if db is not None else None
        if client is not None:
            client.close()

        if enriched is not None:
            vol, rate = build_monthly_vol_rate_from_enriched(enriched, prev_ranks, rate_min / 1_000_000)
            cat_map = 주간분석.fetch_weekly_category_map(trading_dates)
            주간분석.attach_categories(vol, cat_map)
            주간분석.attach_categories(rate, cat_map)
            entry['vol']  = vol
            entry['rate'] = rate
            entry['lastTradingDate'] = month_anchor_date_str
            matched = sum(1 for s in vol + rate if '카테고리' in s)
            print(f'월간 거래대금 상위 {len(vol)}개, 등락률 상위 {len(rate)}개 종목 산출 완료'
                  f' (일간 분석에서 카테고리 매칭 {matched}/{len(vol) + len(rate)})')
        else:
            print('[경고] KIS 보강 실패 — 이번 실행에서는 월간 거래대금/등락률을 저장하지 않습니다.')

    save_to_mongodb(month, entry)

    print('월간 ETF 등락률 상위 15 산출 중...')
    etf_client = MongoClient(MONGODB_URI) if MONGODB_URI else None
    etf_db = etf_client.get_default_database() if etf_client is not None else None
    etf_monthly_rank(etf_db)
    if etf_client is not None:
        etf_client.close()

    print('웹앱 달력의 "YYYY년 M월" 제목을 클릭하면 반영됩니다.')


if __name__ == '__main__':
    main()
