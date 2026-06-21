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

KIS_APP_KEY    = os.getenv('KIS_APP_KEY')
KIS_APP_SECRET = os.getenv('KIS_APP_SECRET')
KIS_BASE = 'https://openapi.koreainvestment.com:9443'

SPAM_KEYWORDS = ['무료 리딩방', '카톡방', '클릭 시 이동', '급등주 추천', 'vip 회원', '선착순 모집']
DAYS_KO = ['월', '화', '수', '목', '금', '토', '일']


# ── 유틸 ────────────────────────────────────────────────────────────────────

def format_date_korean(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return f'{d.year}년 {d.month}월 {d.day}일 ({DAYS_KO[d.weekday()]})'


# ── FinanceDataReader 전종목 수집 ────────────────────────────────────────────

UPPER_LIMIT_RATE = 29.5
RATE_MIN_AMOUNT  = 30_000_000_000  # 등락률 순위 집계 대상 최소 거래대금 (300억)

SPAC_PATTERN = '스팩|기업인수목적'

def fetch_market_data():
    """KRX 전종목 시세 조회 (KONEX·스팩 제외).
    ETF/ETN은 fdr.StockListing('KRX')에 원래 포함되지 않음(보통주/우선주만 반환되는 것을
    직접 확인함 — KODEX 200 등 주요 ETF 코드가 안 잡힘) — 스팩만 이름 패턴으로 걸러낸다."""
    df = fdr.StockListing('KRX')
    df = df[
        (df['Market'] != 'KONEX') & (df['Close'] > 0) &
        (~df['Name'].str.contains(SPAC_PATTERN, na=False))
    ]
    return df

def fetch_indices():
    """코스피·코스닥 지수의 최근 거래일 종가/전일대비 포인트·등락률."""
    end = datetime.now()
    start = end - timedelta(days=7)
    start_str, end_str = start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d')

    def last_two(ticker):
        df = fdr.DataReader(ticker, start_str, end_str)
        close, prev_close = float(df['Close'].iloc[-1]), float(df['Close'].iloc[-2])
        change = close - prev_close
        return {'close': close, 'change': change, 'changeRate': change / prev_close * 100}

    return {'kospi': last_two('KS11'), 'kosdaq': last_two('KQ11')}

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
            'marketCap': float(r['Marcap']) / 100_000_000,    # 억원 단위
            'tradingVolume': float(r['Amount']) / 1_000_000,  # 백만원 단위
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


# ── KIS 통합(KRX+NXT) 거래대금·등락률 보강 ───────────────────────────────────
# FDR StockListing('KRX')은 KRX 거래소 단독 수치라 대체거래소 NXT에서 체결된
# 거래량·거래대금·종가가 빠져 있다(2026-06-21 KIS로 직접 검증: UN=KRX+NXT 정확히 일치,
# 종가도 더 늦게 마감하는 NXT 쪽 값이 그날의 진짜 최종 종가). 종목 1개당 1회 호출해야
# 해서 전종목을 다 보강하긴 비효율적이므로, 이미 등락률 후보 기준으로 쓰던
# RATE_MIN_AMOUNT(300억) 이상 종목만 추려 보강한다.

def get_kis_token(db):
    """JS api/candles.js의 getKisToken과 동일한 MongoDB kis_token 컬렉션을 공유해서
    캐싱한다 — 발급은 1분당 1회 제한이라 Vercel 쪽과 토큰을 같이 써야 한다."""
    col = db['kis_token']
    cached = col.find_one({'_id': 'token'})
    now_ms = time.time() * 1000
    if cached and cached['expiresAt'] > now_ms + 5 * 60 * 1000:
        return cached['accessToken']
    r = requests.post(f'{KIS_BASE}/oauth2/tokenP', headers={
        'Content-Type': 'application/json; charset=UTF-8',
    }, json={
        'grant_type': 'client_credentials',
        'appkey': KIS_APP_KEY,
        'appsecret': KIS_APP_SECRET,
    }, timeout=10)
    data = r.json()
    if not r.ok:
        raise RuntimeError(f'KIS 토큰 발급 실패: {data}')
    expires_at = now_ms + data['expires_in'] * 1000
    col.update_one(
        {'_id': 'token'},
        {'$set': {'accessToken': data['access_token'], 'expiresAt': expires_at}},
        upsert=True,
    )
    return data['access_token']


def _fetch_kis_daily(token, code, mrkt_code, date_str, lookback_days=10, max_retries=3):
    """inquire-daily-itemchartprice 1회 호출(+재시도)해 오래된→최신 순으로 반환한다.
    KIS 호출 제한(EGW00201, "초당 거래건수를 초과하였습니다")에 걸리면 1초 쉬고 재시도한다
    — 호출 사이에 sleep을 둬도 종목 300여 개를 빠르게 돌리면 실제로 종종 걸림(직접 확인함)."""
    d2 = datetime.strptime(date_str, '%Y-%m-%d')
    d1 = d2 - timedelta(days=lookback_days)
    headers = {
        'Content-Type': 'application/json; charset=UTF-8',
        'authorization': f'Bearer {token}',
        'appkey': KIS_APP_KEY,
        'appsecret': KIS_APP_SECRET,
        'tr_id': 'FHKST03010100',
        'custtype': 'P',
    }
    params = {
        'FID_COND_MRKT_DIV_CODE': mrkt_code,
        'FID_INPUT_ISCD': code,
        'FID_INPUT_DATE_1': d1.strftime('%Y%m%d'),
        'FID_INPUT_DATE_2': d2.strftime('%Y%m%d'),
        'FID_PERIOD_DIV_CODE': 'D',
        'FID_ORG_ADJ_PRC': '0',
    }
    data = None
    for _ in range(max_retries):
        r = requests.get(
            f'{KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
            headers=headers, params=params, timeout=10,
        )
        data = r.json()
        if data.get('msg_cd') == 'EGW00201':
            time.sleep(1)
            continue
        if not r.ok or data.get('rt_cd') != '0':
            raise RuntimeError(f'KIS 시세 조회 실패({code}, {mrkt_code}): {data.get("msg1")}')
        rows = [row for row in (data.get('output2') or []) if row.get('stck_bsop_date')]
        rows.sort(key=lambda row: row['stck_bsop_date'])
        return rows
    raise RuntimeError(f'KIS 호출 제한으로 재시도 끝까지 실패({code}, {mrkt_code}): {data.get("msg1")}')


def fetch_kis_consolidated(token, code, date_str, lookback_days=10):
    """오늘 가격·거래량·거래대금용 — FID_COND_MRKT_DIV_CODE=UN(KRX+NXT 통합) 일별 시세.
    NXT에서 전혀 거래되지 않는 종목(우선주 등 일부)은 UN이 빈 배열을 반환한다(직접 확인함)
    — 이 경우 J로 다시 KIS를 호출해도 FDR과 같은 KRX 단독 값일 뿐이라(직접 검증함),
    별도 재조회 없이 빈 배열을 그대로 반환해서 enrich_with_kis가 이미 갖고 있는 FDR 값으로
    바로 폴백하게 한다 — UN에 데이터가 있는 종목만 KIS를 쓰고, 없는 종목은 KIS를 한 번 더
    부르지 않는다."""
    return _fetch_kis_daily(token, code, 'UN', date_str, lookback_days)


def fetch_kis_prev_close(token, code, date_str, lookback_days=10):
    """등락률 기준선용 — 오늘보다 이전인 가장 최근 거래일의 KRX 단독(J) 종가.
    실제 HTS 표시와 대조해 직접 검증함(2026-06-21): 오늘 가격(현재가)은 통합(UN) 최종가를
    쓰지만, 등락률/대비의 기준선(전일종가)은 NXT 체결 여부와 무관하게 항상 KRX 단독
    공식 종가를 쓴다 — 그래서 등락률만큼은 전일 UN 종가가 아니라 전일 J 종가로 계산해야
    실제 시세와 맞는다."""
    today_str = date_str.replace('-', '')
    rows = _fetch_kis_daily(token, code, 'J', date_str, lookback_days)
    prev_rows = [row for row in rows if row['stck_bsop_date'] < today_str]
    return float(prev_rows[-1]['stck_clpr']) if prev_rows else None


def enrich_with_kis(df, date_str):
    """RATE_MIN_AMOUNT(300억) 이상인 종목만 후보로 추려 KIS UN(통합) 데이터로 보강한다.
    종목별 호출 실패(상장정지·일시 오류 등)는 그 종목만 FDR(KRX 단독) 값으로 폴백해서
    명단에서 빠지지 않게 한다. KIS 전체를 못 쓰면(키 없음·토큰 발급 실패) None을 반환해
    main()이 기존 FDR 전용 경로로 통째로 폴백하게 한다."""
    if not KIS_APP_KEY or not KIS_APP_SECRET or not MONGODB_URI:
        print('[경고] KIS_APP_KEY/SECRET 또는 MONGODB_URI 없음 — FDR 전용으로 폴백')
        return None

    candidates = df[df['Amount'] >= RATE_MIN_AMOUNT]
    client = MongoClient(MONGODB_URI)
    db = client.get_default_database()
    try:
        token = get_kis_token(db)
    except Exception as e:
        client.close()
        print(f'[경고] KIS 토큰 발급 실패, FDR 전용으로 폴백: {e}')
        return None

    today_str = date_str.replace('-', '')
    enriched = []
    ok = fallback = 0
    for _, r in candidates.iterrows():
        code = r['Code']
        item = {'code': code, 'name': r['Name']}
        try:
            rows = fetch_kis_consolidated(token, code, date_str)
            today = rows[-1] if rows else None
            if not today or today['stck_bsop_date'] != today_str:
                raise ValueError('오늘자 통합 데이터 없음(거래정지 등)')
            close = float(today['stck_clpr'])
            time.sleep(0.12)  # UN 호출과 J 호출 사이에도 같은 간격으로 KIS 호출 제한 대비
            prev = fetch_kis_prev_close(token, code, date_str)
            if prev is None:
                prev = close  # 비교 기준 없으면(신규상장 등) 변동 0으로 처리
            item.update(
                price=close,
                change=close - prev,
                changeRate=(close - prev) / prev * 100 if prev else 0.0,
                volume=float(today['acml_vol']),
                tradingVolume=float(today['acml_tr_pbmn']) / 1_000_000,
                marketCap=close * float(r['Stocks']) / 100_000_000,
            )
            ok += 1
        except Exception:
            item.update(
                price=float(r['Close']),
                change=float(r['Changes']),
                changeRate=float(r['ChagesRatio']),
                volume=float(r['Volume']),
                marketCap=float(r['Marcap']) / 100_000_000,
                tradingVolume=float(r['Amount']) / 1_000_000,
            )
            fallback += 1
        enriched.append(item)
        time.sleep(0.12)  # KIS 초당 20건 제한 대비(약 8건/초로 보수적으로 — fetch_kis_consolidated의
                           # 재시도 로직과 함께 EGW00201(초당 거래건수 초과)을 줄이기 위함

    client.close()
    print(f'KIS 통합 보강: {len(candidates)}개 후보 중 {ok}개 성공, {fallback}개 FDR 폴백')
    return enriched


def build_vol_rate_from_enriched(enriched, prev_ranks, top=50):
    vol = sorted(enriched, key=lambda s: s['tradingVolume'], reverse=True)[:top]
    for rank, s in enumerate(vol, start=1):
        s['rank'] = rank
        s['prevRank'] = prev_ranks.get(s['code'])

    rate_sorted = sorted(enriched, key=lambda s: s['changeRate'], reverse=True)[:top]
    rate = [{
        'rank': i + 1,
        'code': s['code'],
        'name': s['name'],
        'price': s['price'],
        'change': s['change'],
        'changeRate': s['changeRate'],
        'isUpperLimit': s['changeRate'] >= UPPER_LIMIT_RATE,
        'volume': s['volume'],
    } for i, s in enumerate(rate_sorted)]
    return vol, rate


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

def save_to_mongodb(date, date_korean, vol, rate, indices):
    if not MONGODB_URI:
        print('[경고] MONGODB_URI 없음 — MongoDB 저장 건너뜀')
        return
    try:
        client = MongoClient(MONGODB_URI)
        col = client.get_default_database()['stock_data']
        col.update_one(
            {'_id': date},
            {'$set': {'vol': vol, 'rate': rate, 'date': date_korean, 'indices': indices}},
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

CANDLE_COUNT = 85  # 화면에는 60개만 표시하지만, 20일선이 맨 왼쪽 캔들까지 끊김 없이 그려지려면
                    # 19거래일치 선행 데이터가 더 필요해 여유를 두고 85개를 가져온다.
HIGH60_WINDOW = 60  # "60일 신고가" 계산에 쓰는 최근 거래일 수 (화면 표시 구간과 동일)

def fetch_candles(token, code, date_str):
    before = f'{date_str}T16:00:00+09:00'
    r = requests.get(f'{TOSS_BASE}/api/v1/candles', params={
        'symbol': code, 'interval': '1d', 'count': CANDLE_COUNT, 'before': before,
    }, headers={'Authorization': f'Bearer {token}'}, timeout=10)
    r.raise_for_status()
    return r.json()['result']['candles']

def cache_candles(vol, rate, date_str):
    """토스 캔들을 캐싱하면서, 이미 받아온 캔들의 closePrice로 60일 신고가(종가 기준) 대비
    등락률(high60Rate)도 같이 계산해 vol/rate 딕셔너리에 채워넣는다 — API 추가 호출 없음.
    intraday 고가(highPrice)가 아니라 종가 기준 — 일시적 꼬리(wick)를 신고가로 안 치기 위함."""
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
    high60_map = {}
    ok = fail = 0
    for i, code in enumerate(codes, 1):
        try:
            candles = fetch_candles(token, code, date_str)
            col.update_one({'_id': f'{code}_{date_str}'}, {'$set': {'candles': candles}}, upsert=True)
            if candles:
                high60_map[code] = max(float(c['closePrice']) for c in candles[:HIGH60_WINDOW])
            ok += 1
        except Exception as e:
            fail += 1
            print(f'  [{i}/{len(codes)}] {code} 실패: {e}')
        time.sleep(1.1)  # 캔들 조회 Rate Limit (burst 5, 초당 1개 충전) 대비
    client.close()
    print(f'캔들 캐싱 완료: {ok}개 성공, {fail}개 실패')

    # 0%를 상한으로 클램프 — 토스 캔들은 KRX 단독이라 NXT 포함 현재가(KIS UN)보다 그날 고가가
    # 낮게 잡혀 있을 수 있는데, 그런 데이터 소스 차이로 양수가 나오는 걸 막고 "현재가가 60일
    # 신고가(이상)면 0%"를 항상 보장한다.
    for s in vol + rate:
        high60 = high60_map.get(s['code'])
        s['high60Rate'] = min(0.0, (s['price'] - high60) / high60 * 100) if high60 else None


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    date = datetime.now().strftime('%Y-%m-%d')
    date_korean = format_date_korean(date)
    print(f'날짜: {date_korean}')

    print('FinanceDataReader로 전종목 시세 수집 중...')
    df = fetch_market_data()
    print(f'전종목 {len(df)}개 수집 완료')

    prev_ranks = get_previous_vol_ranks(date)

    print('KIS 통합(KRX+NXT) 데이터로 거래대금·등락률 상위 보강 중...')
    enriched = enrich_with_kis(df, date)
    if enriched is not None:
        vol, rate = build_vol_rate_from_enriched(enriched, prev_ranks)
    else:
        vol  = build_vol_list(df, prev_ranks)
        rate = build_rate_list(df)
    print(f'거래대금 상위 {len(vol)}개, 등락률 상위 {len(rate)}개 종목 산출 완료')

    indices = fetch_indices()
    print(f"코스피 {indices['kospi']['close']:.2f} ({indices['kospi']['changeRate']:+.2f}%), "
          f"코스닥 {indices['kosdaq']['close']:.2f} ({indices['kosdaq']['changeRate']:+.2f}%)")

    # 토스증권 일봉 캔들 캐싱 (종목 클릭 시 모달에서 사용) + 60일 신고가 대비 등락률 계산
    # (vol/rate에 high60Rate를 채워넣으므로 MongoDB 저장보다 먼저 실행해야 함)
    cache_candles(vol, rate, date)

    # MongoDB에 종목 데이터 저장 (웹앱 자동 로드용)
    save_to_mongodb(date, date_korean, vol, rate, indices)

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
