"""
코스피·코스닥 이번 주(월~금) 변동률 계산 + MongoDB 저장 스크립트
사용법: python 주간분석.py
       (아무 때나 실행 가능. 가장 최근 1주일치만 다시 계산해 weekly_indices에 upsert한다)
결과:
  - MongoDB weekly_indices 컬렉션에 해당 주차 1건 {kospi, kosdaq: {close, change, changeRate}} 저장
  - 웹앱 달력의 그 주 토요일 칸이 이 값을 읽어 표시
"""

import os
from datetime import datetime, timedelta
import FinanceDataReader as fdr
from dotenv import load_dotenv
from pymongo import MongoClient

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

    save_to_mongodb(week, entry)
    print('웹앱 달력의 이번 주 토요일 칸에 반영됩니다.')


if __name__ == '__main__':
    main()
