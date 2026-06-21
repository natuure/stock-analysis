"""
코스피·코스닥 주간(월~금) 변동률 계산 + MongoDB 저장 스크립트
사용법: python 주간분석.py
       (아무 때나 실행 가능. 최근 약 1.4년치 주간 종가를 다시 계산해
        weekly_indices 컬렉션을 통째로 갱신한다)
결과:
  - MongoDB weekly_indices 컬렉션에 주차별 {kospi, kosdaq: {close, change, changeRate}} 저장
  - 웹앱 달력의 토요일 칸이 이 컬렉션을 읽어 그 주(월~금) 변동률을 표시
"""

import os
from datetime import datetime, timedelta
import FinanceDataReader as fdr
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('.env.local')

MONGODB_URI = os.getenv('MONGODB_URI')

LOOKBACK_DAYS = 540  # api/candles.js의 기존 주봉 lookbackDays와 동일 (약 75주)


def week_key(d):
    """src/utils.js의 weekKeyFromDate와 동일한 규칙(달력 연도 + ISO 주차)."""
    iso_week = d.isocalendar()[1]
    return f'{d.year}-W{iso_week}'


def weekly_changes(ticker):
    """ticker의 주간(월~금) 종가를 모아 (주차별 {close,change,changeRate} dict, 최신 주 날짜)를 반환.
    주차 키(예: '2026-W9')는 숫자가 아니라 문자열이라 정렬·max()로 최신 주를 못 찾으므로
    최신 날짜를 별도로 같이 반환한다."""
    end = datetime.now()
    start = end - timedelta(days=LOOKBACK_DAYS)
    df = fdr.DataReader(ticker, start, end)
    weekly = df['Close'].resample('W-FRI').last().dropna()

    result = {}
    prev_close = None
    last_date = None
    for ts, close in weekly.items():
        if prev_close is not None:
            change = float(close) - prev_close
            result[week_key(ts.date())] = {
                'close': float(close),
                'change': change,
                'changeRate': change / prev_close * 100,
            }
            last_date = ts.date()
        prev_close = float(close)
    return result, last_date


def save_to_mongodb(merged):
    if not MONGODB_URI:
        print('[경고] MONGODB_URI 없음 — MongoDB 저장 건너뜀')
        return
    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['weekly_indices']
    for week, data in merged.items():
        col.update_one({'_id': week}, {'$set': data}, upsert=True)
    client.close()
    print(f'MongoDB 저장 완료: weekly_indices ({len(merged)}개 주차)')


def main():
    print('코스피·코스닥 주간 시세 수집 중...')
    kospi, kospi_last = weekly_changes('KS11')
    kosdaq, _         = weekly_changes('KQ11')

    merged = {}
    for week in set(kospi) | set(kosdaq):
        entry = {}
        if week in kospi:
            entry['kospi'] = kospi[week]
        if week in kosdaq:
            entry['kosdaq'] = kosdaq[week]
        merged[week] = entry

    if kospi_last:
        latest = week_key(kospi_last)
        k, q = merged.get(latest, {}).get('kospi'), merged.get(latest, {}).get('kosdaq')
        if k and q:
            print(f"최근 주({latest}): 코스피 {k['changeRate']:+.2f}%, 코스닥 {q['changeRate']:+.2f}%")

    save_to_mongodb(merged)
    print('웹앱 달력의 해당 주 토요일 칸에 반영됩니다.')


if __name__ == '__main__':
    main()
