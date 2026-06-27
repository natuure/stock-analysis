"""
코스피·코스닥 이번 주(월~금) 변동률 + 거래대금·등락률 상위 50 종목 계산 + MongoDB 저장 스크립트
사용법: python 주간분석.py
       (아무 때나 실행 가능. 가장 최근 1주일치만 다시 계산해 weekly_indices에 upsert한다)
결과:
  - MongoDB weekly_indices 컬렉션에 해당 주차 1건
    {kospi, kosdaq: {close, change, changeRate}, vol, rate: [...50개], lastTradingDate} 저장
    (vol/rate는 뉴스분석.py와 동일하게 KIS 통합(KRX+NXT) 보강을 거침, 2026-06-27 추가)
  - 웹앱 달력의 그 주 주차(W##) 칸이 이 값을 읽어 표시
"""

import os
import time
from datetime import datetime, timedelta
import FinanceDataReader as fdr
from dotenv import load_dotenv
from pymongo import MongoClient

import 뉴스분석  # KIS 통합(KRX+NXT) 보강 로직 재사용 — get_kis_token/_fetch_kis_daily/
                  # fetch_market_data/임계값 상수. import만 해도 main()은 실행 안 됨
                  # (if __name__=='__main__' 가드, 주도주분석.py가 종목분석.py를 임포트하는
                  # 기존 패턴과 동일).

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
            entry['vol']  = vol
            entry['rate'] = rate
            entry['lastTradingDate'] = week_anchor_date_str
            print(f'주간 거래대금 상위 {len(vol)}개, 등락률 상위 {len(rate)}개 종목 산출 완료')
        else:
            print('[경고] KIS 보강 실패 — 이번 실행에서는 주간 거래대금/등락률을 저장하지 않습니다.')

    save_to_mongodb(week, entry)
    print('웹앱 달력의 이번 주 주차(W##) 칸에 반영됩니다.')


if __name__ == '__main__':
    main()
