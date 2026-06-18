"""
FinanceDataReader 전종목 수집 + Naver 뉴스 수집 + MongoDB 저장 스크립트
사용법: python 뉴스분석.py
       (장마감 후 실행 가정. 오늘 날짜 기준으로 전종목 거래대금/등락률 상위 50종목 자동 수집)
결과:
  - 뉴스데이터_YYYYMMDD.json 저장 (Claude Code가 읽어 분석)
  - MongoDB stock_data 컬렉션에 거래대금/등락률 데이터 저장
"""

import os
import re
import json
import time
import requests
import FinanceDataReader as fdr
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('.env.local')

NAVER_ID     = os.getenv('NAVER_CLIENT_ID')
NAVER_SECRET = os.getenv('NAVER_CLIENT_SECRET')
MONGODB_URI  = os.getenv('MONGODB_URI')
TOSS_CLIENT_ID     = os.getenv('TOSS_CLIENT_ID')
TOSS_CLIENT_SECRET = os.getenv('TOSS_CLIENT_SECRET')
TOSS_BASE = 'https://openapi.tossinvest.com'

SPAM_KEYWORDS = ['무료 리딩방', '카톡방', '클릭 시 이동', '급등주 추천', 'vip 회원', '선착순 모집']
DAYS_KO = ['월', '화', '수', '목', '금', '토', '일']


# ── 유틸 ────────────────────────────────────────────────────────────────────

def format_date_korean(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return f'{d.year}년 {d.month}월 {d.day}일 ({DAYS_KO[d.weekday()]})'


# ── FinanceDataReader 전종목 수집 ────────────────────────────────────────────

UPPER_LIMIT_RATE = 29.5
RATE_MIN_AMOUNT  = 30_000_000_000  # 등락률 순위 집계 대상 최소 거래대금 (300억)

def fetch_market_data():
    """KRX 전종목 시세 조회 (KONEX 제외)."""
    df = fdr.StockListing('KRX')
    df = df[(df['Market'] != 'KONEX') & (df['Close'] > 0)]
    return df

def get_previous_vol_ranks(today_date_str):
    """직전 거래일의 거래대금 순위를 {종목코드: 순위} 형태로 반환."""
    if not MONGODB_URI:
        return {}
    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['stock_data']
    prev = col.find_one({'_id': {'$lt': today_date_str}}, sort=[('_id', -1)])
    client.close()
    if not prev or not prev.get('vol'):
        return {}
    return {s['code']: s['rank'] for s in prev['vol']}

def build_vol_list(df, prev_ranks, top=50):
    top_df = df.sort_values('Amount', ascending=False).head(top)
    result = []
    for rank, (_, r) in enumerate(top_df.iterrows(), start=1):
        result.append({
            'rank': rank,
            'prevRank': prev_ranks.get(r['Code']),
            'code': r['Code'],
            'name': r['Name'],
            'price': float(r['Close']),
            'change': float(r['Changes']),
            'changeRate': float(r['ChagesRatio']),
            'volume': float(r['Volume']),
            'marketCap': float(r['Marcap']),
            'tradingVolume': float(r['Amount']),
        })
    return result

def build_rate_list(df, top=50):
    eligible = df[df['Amount'] >= RATE_MIN_AMOUNT]
    top_df = eligible.sort_values('ChagesRatio', ascending=False).head(top)
    result = []
    for rank, (_, r) in enumerate(top_df.iterrows(), start=1):
        cr = float(r['ChagesRatio'])
        result.append({
            'rank': rank,
            'code': r['Code'],
            'name': r['Name'],
            'price': float(r['Close']),
            'change': float(r['Changes']),
            'changeRate': cr,
            'isUpperLimit': cr >= UPPER_LIMIT_RATE,
            'volume': float(r['Volume']),
        })
    return result


# ── Naver 뉴스 API ───────────────────────────────────────────────────────────

# AI검색.md 기반 쿼리 패턴 (필수 → 선택 순)
NEWS_QUERIES = [
    '{name} 특징주',        # 필수 ★
    '{name} 급등 이유',     # 필수
    '{name} 상승 배경',     # 필수
    '{name} 상한가 사유',   # 필수
    '{name} 거래량 폭발',   # 선택
    '{name} 모멘텀',        # 선택
    '{name} 공급계약 공시', # 선택
    '{name} 대규모 수주',   # 선택
]

def _call_naver(query):
    url = 'https://openapi.naver.com/v1/search/news.json'
    params = {'query': query, 'display': 20, 'sort': 'date', 'start': 1}
    headers = {'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET}
    r = requests.get(url, params=params, headers=headers, timeout=6)
    return r.json().get('items', [])

def _parse_articles(items, file_date, upper_limit, seen):
    """items 리스트에서 스팸 제거·중복 제거 후 (priority, title, desc) 반환."""
    result = []
    for item in items:
        try:
            pub_date = parsedate_to_datetime(item.get('pubDate', '')).date()
            # 상한만 적용: 3일 이상 지난 데이터는 file_date+3일 이후 기사 제외
            if upper_limit and pub_date > upper_limit:
                continue
            # 파일날짜에 가까울수록 우선 (당일=0, 이전/이후는 날짜 차이만큼)
            priority = abs((pub_date - file_date).days)
        except Exception:
            priority = 999

        title = re.sub(r'<[^>]+>', '', item.get('title', ''))
        desc  = re.sub(r'<[^>]+>', '', item.get('description', ''))
        if any(kw in (title + desc).lower() for kw in SPAM_KEYWORDS):
            continue
        if title in seen:
            continue
        seen.add(title)
        result.append((priority, title, desc))
    return result


def fetch_news(name, file_date_str):
    """
    file_date_str 기준으로 뉴스 검색.
    - 당일(파일날짜) 기사 최우선, 날짜 하한 없음 (오래된 기사도 참고)
    - 3일 이상 지난 데이터: file_date+3일 이후 기사 제외 (오늘 뉴스 혼입 방지)
    - 8개 쿼리 후에도 0건이면 종목명 단독 검색으로 폴백
    """
    if not NAVER_ID or not NAVER_SECRET:
        print(f'  [경고] NAVER API 키 없음 — {name} 뉴스 건너뜀')
        return []

    file_date    = datetime.strptime(file_date_str, '%Y-%m-%d').date()
    today        = datetime.now().date()
    days_elapsed = (today - file_date).days
    upper_limit  = file_date + timedelta(days=3) if days_elapsed >= 3 else None

    seen     = set()
    articles = []

    for q_template in NEWS_QUERIES:
        try:
            items = _call_naver(q_template.format(name=name))
            articles += _parse_articles(items, file_date, upper_limit, seen)
        except Exception:
            pass
        time.sleep(0.05)

    # 폴백: 결과가 없으면 종목명 단독 검색
    if not articles:
        try:
            items = _call_naver(name)
            articles += _parse_articles(items, file_date, upper_limit, seen)
        except Exception:
            pass

    articles.sort(key=lambda x: x[0])
    return [{'title': t, 'description': d} for _, t, d in articles[:10]]


# ── MongoDB 저장 ──────────────────────────────────────────────────────────────

def save_to_mongodb(date, date_korean, vol, rate):
    if not MONGODB_URI:
        print('[경고] MONGODB_URI 없음 — MongoDB 저장 건너뜀')
        return
    try:
        client = MongoClient(MONGODB_URI)
        col = client.get_default_database()['stock_data']
        col.update_one(
            {'_id': date},
            {'$set': {'vol': vol, 'rate': rate, 'date': date_korean}},
            upsert=True,
        )
        client.close()
        print(f'MongoDB 저장 완료: stock_data/{date}')
    except Exception as e:
        print(f'[오류] MongoDB 저장 실패: {e}')


# ── 토스증권 캔들 캐싱 ────────────────────────────────────────────────────────
# Vercel 서버리스 함수는 토스 API의 IP 허용 목록에 등록할 수 없는 유동 IP를 쓰므로
# (access_denied: IP address not allowed), 고정 IP인 로컬에서 미리 가져와 MongoDB에
# 캐싱하고 api/tossQuote.js는 MongoDB만 읽도록 한다.

def get_toss_token():
    r = requests.post(f'{TOSS_BASE}/oauth2/token', data={
        'grant_type': 'client_credentials',
        'client_id': TOSS_CLIENT_ID,
        'client_secret': TOSS_CLIENT_SECRET,
    }, timeout=10)
    r.raise_for_status()
    return r.json()['access_token']

def fetch_candles(token, code, date_str):
    before = f'{date_str}T16:00:00+09:00'
    r = requests.get(f'{TOSS_BASE}/api/v1/candles', params={
        'symbol': code, 'interval': '1d', 'count': 60, 'before': before,
    }, headers={'Authorization': f'Bearer {token}'}, timeout=10)
    r.raise_for_status()
    return r.json()['result']['candles']

def cache_candles(vol, rate, date_str):
    if not TOSS_CLIENT_ID or not TOSS_CLIENT_SECRET:
        print('[경고] TOSS_CLIENT_ID/SECRET 없음 — 캔들 캐싱 건너뜀')
        return
    if not MONGODB_URI:
        print('[경고] MONGODB_URI 없음 — 캔들 캐싱 건너뜀')
        return

    codes = list(dict.fromkeys(s['code'] for s in vol + rate))
    print(f'\n토스 캔들 캐싱 시작 ({len(codes)}개 종목)...')
    try:
        token = get_toss_token()
    except Exception as e:
        print(f'[오류] 토스 토큰 발급 실패: {e}')
        return

    client = MongoClient(MONGODB_URI)
    col = client.get_default_database()['candles']
    ok = fail = 0
    for i, code in enumerate(codes, 1):
        try:
            candles = fetch_candles(token, code, date_str)
            col.update_one({'_id': f'{code}_{date_str}'}, {'$set': {'candles': candles}}, upsert=True)
            ok += 1
        except Exception as e:
            fail += 1
            print(f'  [{i}/{len(codes)}] {code} 실패: {e}')
        time.sleep(1.1)  # 캔들 조회 Rate Limit (burst 5, 초당 1개 충전) 대비
    client.close()
    print(f'캔들 캐싱 완료: {ok}개 성공, {fail}개 실패')


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    date = datetime.now().strftime('%Y-%m-%d')
    date_korean = format_date_korean(date)
    print(f'날짜: {date_korean}')

    print('FinanceDataReader로 전종목 시세 수집 중...')
    df = fetch_market_data()
    print(f'전종목 {len(df)}개 수집 완료')

    prev_ranks = get_previous_vol_ranks(date)
    vol  = build_vol_list(df, prev_ranks)
    rate = build_rate_list(df)
    print(f'거래대금 상위 {len(vol)}개, 등락률 상위 {len(rate)}개 종목 산출 완료')

    # MongoDB에 종목 데이터 저장 (웹앱 자동 로드용)
    save_to_mongodb(date, date_korean, vol, rate)

    # 토스증권 일봉 캔들 캐싱 (종목 클릭 시 모달에서 사용)
    cache_candles(vol, rate, date)

    # Naver 뉴스 수집
    names = list(dict.fromkeys([s['name'] for s in vol + rate]))
    print(f'\n뉴스 검색 시작 ({len(names)}개 종목)...')

    news_map = {}
    for i, name in enumerate(names, 1):
        print(f'  [{i}/{len(names)}] {name}', end=' ', flush=True)
        news = fetch_news(name, date)
        news_map[name] = news
        print(f'→ {len(news)}건')
        time.sleep(0.1)

    os.makedirs('분석결과', exist_ok=True)
    output = {'date': date, 'vol': vol, 'rate': rate, 'news': news_map}
    out_file = os.path.join('분석결과', f'뉴스데이터_{date.replace("-", "")}.json')
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\n완료: {out_file} 저장됨')
    print('다음 단계: Claude Code에 "분석해줘"라고 요청하세요.')


if __name__ == '__main__':
    main()
