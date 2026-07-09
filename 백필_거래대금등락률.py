"""
과거 날짜(기본: 2026-01-01 ~ 실데이터 시작일 전날)의 거래대금/등락률 상위 50을
종목별 개별 시세(FinanceDataReader DataReader)로 재구성해 MongoDB stock_data에 채워 넣는다.

배경: 뉴스분석.py의 fetch_market_data()가 쓰는 fdr.StockListing('KRX')는 start/end 인자를
받지만 실제로는 항상 "지금 시점"의 최신 시세만 반환한다(2026-07-08 직접 검증 — 화신정공을
6/1, 6/8, 6/17, 7/6 네 날짜로 조회해도 전부 동일한 값이 나옴). 그래서 과거 특정일 기준
"전종목 거래대금/등락률 상위 50"을 얻으려면 종목별로 fdr.DataReader(code, start, end)를
한 번씩 호출해 날짜별 시계열을 받은 뒤 직접 랭킹을 재구성해야 한다(종목당 약 0.08초,
전종목 약 2,800개 기준 3~4분 소요, 2026-07-08 벤치마크).

의도적 한계(뉴스분석.py 결과와 100% 동일하지 않음):
  - 거래대금(tradingVolume)은 실제 체결금액이 아니라 종가×거래량 근사치
    (KIS 통합 실시간 보강 없음 — 이 스크립트는 그 시절 KIS 데이터를 받을 수 없음).
  - marketCap, high60Rate, isUpperLimit 계산은 하되 신고가 대비 필드는 채우지 않음(캔들 캐시 없음).
  - 카테고리/뉴스(analysis.카테고리, 뉴스데이터_*.json)는 이 스크립트 범위 밖 — AI가 뉴스를
    읽고 수작업으로 분류하는 별도 단계이며, 기계적으로 대량 생성할 수 없다.
  - 종목 유니버스는 "실행 시점 현재 상장된 종목" 기준 스냅샷 — 그 사이 상장폐지된 종목은
    빠질 수 있고, 그 사이 신규상장된 종목은 상장일 이전 구간이 자연히 비어 있다.
  - 저장 문서에 backfilled: true 플래그를 남겨 실데이터(뉴스분석.py 산출)와 구분한다.

안전장치: MongoDB stock_data의 "실제 최초 날짜"보다 같거나 늦은 날짜는 절대 덮어쓰지 않는다
(끝 날짜를 그 전날로 자동 축소).

사용법:
  python 백필_거래대금등락률.py --dry-run          # 저장 없이 요약만 출력(권장: 먼저 실행)
  python 백필_거래대금등락률.py                     # 실제 MongoDB 저장
  python 백필_거래대금등락률.py --start 2026-03-01 --end 2026-03-31 --dry-run
  python 백필_거래대금등락률.py --limit 30 --dry-run  # 종목 30개로 축소한 빠른 파이프라인 테스트
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime

import pandas as pd
import FinanceDataReader as fdr
from dotenv import load_dotenv
from pymongo import MongoClient

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')
MONGODB_URI = os.getenv('MONGODB_URI')

SPAC_PATTERN = '스팩|기업인수목적'
RATE_MIN_AMOUNT = 30_000_000_000  # 등락률 상위 컷오프(300억) — 뉴스분석.py의 최종 기준과 동일
UPPER_LIMIT_RATE = 29.5
DAYS_KO = ['월', '화', '수', '목', '금', '토', '일']
def cache_path_for(start, end):
    """구간마다 별도 캐시 파일을 쓴다 — 종목코드만으로 캐시를 키잉하면, 다른 날짜 구간으로
    재실행했을 때 "이미 캐시에 있다"고 착각해 실제로는 다른 기간의 시세만 담긴 캐시를
    재사용해버려 그 구간 데이터가 통째로 비어버린다(2025년 백필 요청 때 실제로 발견됨)."""
    return os.path.join('백필작업', f'종목별시세_캐시_{start}_{end}.json')


def format_date_korean(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return f'{d.year}년 {d.month}월 {d.day}일 ({DAYS_KO[d.weekday()]})'


def get_real_data_start():
    """MongoDB stock_data의 실제(뉴스분석.py 산출) 최초 날짜. 백필이 이 날짜를 절대 침범하지 않게 하는 기준선."""
    if not MONGODB_URI:
        raise RuntimeError('MONGODB_URI 없음 — 안전장치를 확인할 수 없어 중단합니다.')
    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['stock_data']
    earliest = col.find_one({'backfilled': {'$ne': True}}, sort=[('_id', 1)])
    client.close()
    if not earliest:
        raise RuntimeError('stock_data에 실데이터가 하나도 없습니다 — 안전 기준선을 정할 수 없어 중단합니다.')
    return earliest['_id']


def get_universe():
    """뉴스분석.py fetch_market_data()와 동일한 필터(KONEX·스팩 제외)로 현재 상장 종목 목록을 가져온다."""
    df = fdr.StockListing('KRX')
    df = df[
        (df['Market'] != 'KONEX') & (df['Close'] > 0) &
        (~df['Name'].str.contains(SPAC_PATTERN, na=False))
    ]
    return df[['Code', 'Name']].to_dict('records')


def load_cache(cache_path):
    if os.path.exists(cache_path):
        with open(cache_path, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_cache(cache, cache_path):
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False)


def fetch_all_histories(codes, start, end, cache_path):
    """종목별 fdr.DataReader(code, start, end) 결과를 캐시에 누적한다. 이미 캐시에 있는
    종목은 건너뛰어 중단 후 재실행(resume)이 가능하다. 50종목마다 캐시를 디스크에 저장."""
    cache = load_cache(cache_path)
    total = len(codes)
    todo = [c for c in codes if c['Code'] not in cache]
    print(f'전체 {total}개 종목 중 {len(todo)}개 신규 조회 필요(캐시 재사용: {total - len(todo)}개)')

    for i, c in enumerate(todo, 1):
        code, name = c['Code'], c['Name']
        try:
            df = fdr.DataReader(code, start, end)
            rows = []
            for idx, row in df.iterrows():
                if pd.isna(row.get('Close')):
                    continue
                change = row.get('Change')
                rows.append({
                    'date': idx.strftime('%Y-%m-%d'),
                    'close': float(row['Close']),
                    'volume': float(row.get('Volume', 0) or 0),
                    'change': float(change) if pd.notna(change) else 0.0,
                })
            cache[code] = {'name': name, 'rows': rows}
        except Exception as e:
            cache[code] = {'name': name, 'rows': [], 'error': str(e)}

        if i % 50 == 0 or i == len(todo):
            print(f'  [{i}/{len(todo)}] 진행 중... (캐시 저장)')
            save_cache(cache, cache_path)

    save_cache(cache, cache_path)
    return cache


def build_trading_calendar(start, end):
    """코스피 지수 시계열로 실제 거래일 목록을 얻는다(주말·휴장일 자동 제외)."""
    df = fdr.DataReader('KS11', start, end)
    return [d.strftime('%Y-%m-%d') for d in df.index]


def build_indices_by_date(start, end):
    result = {}
    for ticker, key in [('KS11', 'kospi'), ('KQ11', 'kosdaq')]:
        df = fdr.DataReader(ticker, start, end)
        closes = df['Close'].tolist()
        dates = [d.strftime('%Y-%m-%d') for d in df.index]
        for i, d in enumerate(dates):
            prev_close = closes[i - 1] if i > 0 else closes[i]
            close = closes[i]
            change = close - prev_close
            result.setdefault(d, {})[key] = {
                'close': float(close),
                'change': float(change),
                'changeRate': float(change / prev_close * 100) if prev_close else 0.0,
            }
    return result


def build_daily_items(cache, trading_dates):
    """캐시(종목별 시계열)를 날짜별로 뒤집는다: {date: [{code, name, price, changeRate, volume, amount}, ...]}"""
    date_set = set(trading_dates)
    by_date = {d: [] for d in trading_dates}
    for code, info in cache.items():
        name = info.get('name')
        for row in info.get('rows', []):
            d = row['date']
            if d not in date_set:
                continue
            amount = row['close'] * row['volume']  # 근사치(종가×거래량) — 스크립트 상단 docstring 참고
            by_date[d].append({
                'code': code,
                'name': name,
                'price': row['close'],
                'changeRate': row['change'] * 100,
                'volume': row['volume'],
                'amount': amount,
            })
    return by_date


def build_day_ranking(items, prev_vol_ranks, top=50):
    vol_sorted = sorted(items, key=lambda x: x['amount'], reverse=True)[:top]
    vol = []
    for rank, it in enumerate(vol_sorted, start=1):
        vol.append({
            'rank': rank,
            'prevRank': prev_vol_ranks.get(it['code']),
            'code': it['code'],
            'name': it['name'],
            'price': it['price'],
            'change': None,  # 원 단위 절대 변동값은 백필에서 신뢰도 낮아 생략(changeRate만 제공)
            'changeRate': it['changeRate'],
            'volume': it['volume'],
            'marketCap': None,  # 날짜별 발행주식수 미확보로 생략
            'tradingVolume': it['amount'] / 1_000_000,  # 백만원 단위(뉴스분석.py와 동일 단위)
        })

    rate_eligible = [it for it in items if it['amount'] >= RATE_MIN_AMOUNT]
    rate_sorted = sorted(rate_eligible, key=lambda x: x['changeRate'], reverse=True)[:top]
    rate = []
    for rank, it in enumerate(rate_sorted, start=1):
        rate.append({
            'rank': rank,
            'code': it['code'],
            'name': it['name'],
            'price': it['price'],
            'change': None,
            'changeRate': it['changeRate'],
            'isUpperLimit': it['changeRate'] >= UPPER_LIMIT_RATE,
            'volume': it['volume'],
        })

    new_prev_ranks = {it['code']: it['rank'] for it in vol}
    return vol, rate, new_prev_ranks


def save_day(date, vol, rate, indices):
    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['stock_data']
    col.update_one(
        {'_id': date},
        {'$set': {
            'vol': vol, 'rate': rate,
            'date': format_date_korean(date),
            'indices': indices,
            'backfilled': True,
        }},
        upsert=True,
    )
    client.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='2026-01-01')
    ap.add_argument('--end', default=None, help='기본: 실데이터 최초 날짜 하루 전')
    ap.add_argument('--limit', type=int, default=None, help='테스트용 — 종목 수를 앞에서부터 N개로 제한')
    ap.add_argument('--dry-run', action='store_true', help='MongoDB에 쓰지 않고 요약만 출력')
    args = ap.parse_args()

    real_start = get_real_data_start()
    end = args.end or (pd.Timestamp(real_start) - pd.Timedelta(days=1)).strftime('%Y-%m-%d')
    if end >= real_start:
        print(f'[안전장치] --end({end})가 실데이터 시작일({real_start})을 침범해 {real_start} 하루 전으로 축소합니다.')
        end = (pd.Timestamp(real_start) - pd.Timedelta(days=1)).strftime('%Y-%m-%d')

    print(f'백필 구간: {args.start} ~ {end} (실데이터 시작일: {real_start})')

    print('거래일 캘린더 조회 중...')
    trading_dates = build_trading_calendar(args.start, end)
    print(f'거래일 {len(trading_dates)}일')

    print('지수(코스피/코스닥) 조회 중...')
    indices_by_date = build_indices_by_date(args.start, end)

    print('종목 유니버스 조회 중...')
    universe = get_universe()
    if args.limit:
        universe = universe[:args.limit]
    print(f'대상 종목 {len(universe)}개')

    print('종목별 시세 이력 수집 중...')
    t0 = time.time()
    cache_path = cache_path_for(args.start, end)
    cache = fetch_all_histories(universe, args.start, end, cache_path)
    print(f'수집 완료 ({time.time() - t0:.1f}초)')

    by_date = build_daily_items(cache, trading_dates)

    prev_vol_ranks = {}
    saved = 0
    for d in trading_dates:
        items = by_date.get(d, [])
        if not items:
            print(f'  {d}: 데이터 없음 — 건너뜀')
            continue
        vol, rate, prev_vol_ranks = build_day_ranking(items, prev_vol_ranks)
        indices = indices_by_date.get(d, {})

        if args.dry_run:
            top_vol = vol[0]['name'] if vol else '-'
            top_rate = rate[0]['name'] if rate else '-'
            print(f'  {d}: 거래대금 {len(vol)}개(1위 {top_vol}), 등락률 {len(rate)}개(1위 {top_rate})')
        else:
            save_day(d, vol, rate, indices)
            saved += 1
            if saved % 20 == 0:
                print(f'  저장 중... {saved}/{len(trading_dates)}')

    if args.dry_run:
        print(f'\n[dry-run] {len(trading_dates)}개 거래일 계산 완료 — MongoDB에는 저장하지 않았습니다.')
    else:
        print(f'\n완료: {saved}개 거래일을 MongoDB stock_data에 backfilled:true로 저장했습니다.')


if __name__ == '__main__':
    main()
