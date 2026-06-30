"""
등락률 상위 50 진입 종목을 30거래일 동안 추적하는 스크립트 ("차트분석" 탭 데이터 소스)
사용법: python 차트분석.py
       (뉴스분석.py가 오늘자 stock_data를 먼저 저장해둔 상태에서 실행해야 함)
규칙:
  - 등락률 상위 50에 오른 날 추적 리스트에 추가
  - 그 뒤로 30거래일 동안 다시 상위 50에 못 오르면 제외(타임아웃)
  - 제외되지 않은 채로 다시 상위 50에 오르면(재진입) 타임아웃 기준일·45% 하락 기준가 모두
    그날 종가로 갱신 — 단 차트 시작일(firstAddedDate)은 그대로 유지
  - 완전히 제외됐다가 나중에 다시 진입하면 처음부터 새로 추적(차트 시작일도 그날로 리셋)
  - 추가(또는 재진입)된 날 종가 대비 45% 이상 하락하면 제외
결과:
  - MongoDB tracked_stocks 컬렉션에 종목코드(_id) 기준 upsert
  - 매번 stock_data 이력 전체를 처음부터 다시 리플레이해서 재구성하므로 몇 번을 다시 돌려도
    결과가 같다(멱등) — 별도의 "마지막 처리 날짜" 상태를 따로 저장하지 않음
  - 웹앱 "차트분석" 탭(api/getTrackedStocks.js)이 status='active' 항목만 읽어 표시
"""

import os
from datetime import datetime, timedelta
import FinanceDataReader as fdr
from dotenv import load_dotenv
from pymongo import MongoClient

import 뉴스분석  # fetch_market_data() 재사용(시장 구분 + 오늘 전종목 종가 스냅샷).
                  # import만 해도 main()은 실행 안 됨(if __name__=='__main__' 가드,
                  # 주간분석.py가 뉴스분석.py를 임포트하는 기존 패턴과 동일).

load_dotenv('.env.local')

MONGODB_URI = os.getenv('MONGODB_URI')

TIMEOUT_TRADING_DAYS = 30
DROP_RATE_THRESHOLD  = 0.45   # 45% 하락
MA_LOOKBACK_DAYS      = 400   # 200거래일치 확보용 여유 캘린더일(휴장일 감안)


def sma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def replay_history(stock_docs):
    """stock_data 문서들(날짜 오름차순, 각 {_id, rate})을 순회하며 등락률 상위 50
    진입/재진입/30거래일 타임아웃 로직을 처음부터 다시 구성한다. MongoDB에 이미 저장된
    데이터만 읽으므로 추가 API 호출이 없고, 몇 번을 다시 돌려도 같은 결과가 나온다(멱등).
    반환: {code: {name, status, firstAddedDate, lastEnteredDate, referenceClose,
                   removedDate, removedReason}}"""
    dates = [doc['_id'] for doc in stock_docs]
    date_index = {d: i for i, d in enumerate(dates)}
    tracked = {}

    for doc in stock_docs:
        today_str = doc['_id']
        for s in (doc.get('rate') or []):
            code = s['code']
            entry = tracked.get(code)
            if entry is None or entry['status'] == 'removed':
                tracked[code] = {
                    'name': s['name'],
                    'status': 'active',
                    'firstAddedDate': today_str,
                    'lastEnteredDate': today_str,
                    'referenceClose': s['price'],
                    'removedDate': None,
                    'removedReason': None,
                }
            else:
                entry['name'] = s['name']
                entry['lastEnteredDate'] = today_str
                entry['referenceClose'] = s['price']

        # 30거래일 타임아웃 — 이 날짜를 반영한 직후, 현재 active인 모든 종목에 적용
        today_idx = date_index[today_str]
        for entry in tracked.values():
            if entry['status'] != 'active':
                continue
            elapsed = today_idx - date_index[entry['lastEnteredDate']]
            if elapsed > TIMEOUT_TRADING_DAYS:
                entry['status'] = 'removed'
                entry['removedDate'] = today_str
                entry['removedReason'] = 'timeout'

    return tracked


def apply_today_checks(tracked, today_str, market_df):
    """오늘(가장 최근 stock_data 날짜)에 한해서만: 45% 하락 체크 + 50/150/200일 이동평균
    정배열 계산. 과거 리플레이 날짜에는 적용하지 않는다 — 그 시점의 전종목 종가 스냅샷이
    저장돼있지 않아 45% 체크를 정확히 할 수 없기 때문(알려진 한계, DATA_PIPELINE.md 참고)."""
    close_map  = {r['Code']: float(r['Close']) for _, r in market_df.iterrows()}
    market_map = {r['Code']: r['Market'] for _, r in market_df.iterrows()}

    today_dt = datetime.strptime(today_str, '%Y-%m-%d')
    start    = today_dt - timedelta(days=MA_LOOKBACK_DAYS)

    drop45_count = 0
    ma_count = 0

    for code, entry in tracked.items():
        if entry['status'] != 'active':
            continue
        entry['market'] = market_map.get(code)

        current_price = close_map.get(code)
        if current_price is None:
            print(f'  [경고] {entry["name"]}({code}): 오늘 시세를 찾을 수 없어 45%·MA 점검을 건너뜀')
            continue

        if current_price <= entry['referenceClose'] * (1 - DROP_RATE_THRESHOLD):
            entry['status'] = 'removed'
            entry['removedDate'] = today_str
            entry['removedReason'] = 'drop45'
            drop45_count += 1
            continue

        try:
            hist = fdr.DataReader(code, start, today_dt)
            closes = [float(c) for c in hist['Close'].tolist()]
        except Exception as e:
            print(f'  [경고] {entry["name"]}({code}): 이동평균 계산용 시세 조회 실패 — {e}')
            closes = []

        ma50, ma150, ma200 = sma(closes, 50), sma(closes, 150), sma(closes, 200)
        aligned = bool(ma50 and ma150 and ma200 and current_price > ma50 > ma150 > ma200)
        entry['ma'] = {
            'asOf': today_str,
            'currentPrice': current_price,
            'ma50': ma50, 'ma150': ma150, 'ma200': ma200,
            'aligned': aligned,
        }
        ma_count += 1

    return drop45_count, ma_count


def save_to_mongodb(tracked):
    if not MONGODB_URI:
        print('[경고] MONGODB_URI 없음 — MongoDB 저장 건너뜀')
        return
    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['tracked_stocks']
    for code, entry in tracked.items():
        doc = {
            'name': entry['name'],
            'market': entry.get('market'),
            'status': entry['status'],
            'firstAddedDate': entry['firstAddedDate'],
            'lastEnteredDate': entry['lastEnteredDate'],
            'referenceClose': entry['referenceClose'],
            'removedDate': entry['removedDate'],
            'removedReason': entry['removedReason'],
        }
        if entry.get('ma'):
            doc['ma'] = entry['ma']
        col.update_one({'_id': code}, {'$set': doc}, upsert=True)
    client.close()
    print(f'MongoDB 저장 완료: tracked_stocks {len(tracked)}건 upsert')


def main():
    if not MONGODB_URI:
        print('[오류] MONGODB_URI가 .env.local에 없습니다.')
        return

    client = MongoClient(MONGODB_URI)
    db = client.get_default_database()
    stock_docs = list(db['stock_data'].find({}, {'rate': 1}).sort('_id', 1))
    client.close()

    if not stock_docs:
        print('[오류] stock_data가 비어 있습니다. 먼저 뉴스분석.py를 실행하세요.')
        return

    today_str = datetime.now().strftime('%Y-%m-%d')
    if stock_docs[-1]['_id'] != today_str:
        print(f'[오류] 오늘({today_str}) stock_data가 없습니다. 먼저 뉴스분석.py를 실행하세요.')
        return

    print(f'stock_data {len(stock_docs)}일치를 리플레이해 추적 리스트를 재구성하는 중...')
    tracked = replay_history(stock_docs)
    timeout_count = sum(1 for e in tracked.values() if e['removedReason'] == 'timeout')

    print('오늘 시세로 45% 하락·이동평균 정배열 점검 중...')
    market_df = 뉴스분석.fetch_market_data()
    drop45_count, ma_count = apply_today_checks(tracked, today_str, market_df)

    save_to_mongodb(tracked)

    active = sum(1 for e in tracked.values() if e['status'] == 'active')
    print(f'\n완료: 활성 {active}종목 / 누적 타임아웃 제외 {timeout_count}건 / '
          f'오늘 45%하락 제외 {drop45_count}건 / 오늘 이동평균 갱신 {ma_count}종목')


if __name__ == '__main__':
    main()
