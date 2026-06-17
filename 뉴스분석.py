"""
엑셀 파싱 + Naver 뉴스 수집 + MongoDB 저장 스크립트
사용법: python 뉴스분석.py [파일명.xlsx]
       파일명 생략 시 현재 폴더의 최신 xlsx 파일을 자동 탐색
결과:
  - 뉴스데이터_YYYYMMDD.json 저장 (Claude Code가 읽어 분석)
  - MongoDB stock_data 컬렉션에 거래대금/등락률 데이터 저장
"""

import os
import re
import sys
import json
import glob
import time
import requests
import pandas as pd
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('.env.local')

NAVER_ID     = os.getenv('NAVER_CLIENT_ID')
NAVER_SECRET = os.getenv('NAVER_CLIENT_SECRET')
MONGODB_URI  = os.getenv('MONGODB_URI')

SPAM_KEYWORDS = ['무료 리딩방', '카톡방', '클릭 시 이동', '급등주 추천', 'vip 회원', '선착순 모집']
DAYS_KO = ['월', '화', '수', '목', '금', '토', '일']


# ── 유틸 ────────────────────────────────────────────────────────────────────

def to_code(v):
    return re.sub(r'\D', '', str(v or '')).zfill(6)

def to_int(v):
    try: return int(float(str(v or '').replace(',', '')))
    except: return 0

def to_rate(v):
    try: return float(str(v or '').replace('%', '').replace(',', '').strip())
    except: return 0.0

def to_num(v):
    try: return float(str(v or '').replace(',', '').strip())
    except: return 0.0

def to_change(change_val, change_rate):
    raw = str(change_val or '').replace(',', '').strip()
    if raw.startswith('+') or raw.startswith('-'):
        try: return float(raw)
        except: return 0.0
    return -to_num(change_val) if change_rate < 0 else to_num(change_val)

def to_prev_rank(v):
    s = str(v or '').strip()
    if not s or s in ('-', '신규', 'NEW', 'N/A', '0', 'nan'):
        return None
    try:
        n = int(float(s))
        return n if n > 0 else None
    except:
        return None

def format_date_korean(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return f'{d.year}년 {d.month}월 {d.day}일 ({DAYS_KO[d.weekday()]})'


# ── 파일 탐색 ────────────────────────────────────────────────────────────────

def find_excel():
    files = glob.glob('데일리분석/**/*.xlsx', recursive=True) + glob.glob('데일리분석/**/*.xls', recursive=True)
    if not files:
        raise FileNotFoundError('데일리분석 폴더에 엑셀 파일이 없습니다.')
    return max(files, key=os.path.getmtime)

def extract_date(filename):
    m = re.search(r'_(\d{6})(?:\.|_|$)', os.path.basename(filename))
    if m:
        s = m.group(1)
        year, month, day = 2000 + int(s[:2]), int(s[2:4]), int(s[4:6])
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f'{year}-{month:02d}-{day:02d}'
    return datetime.fromtimestamp(os.path.getmtime(filename)).strftime('%Y-%m-%d')


# ── 엑셀 파싱 ────────────────────────────────────────────────────────────────

def parse_sheet(xl, hint):
    matched = next((n for n in xl.sheet_names if hint in n), None)
    if not matched:
        return None
    df = xl.parse(matched, header=None)
    for i in range(min(10, len(df))):
        row_vals = [str(v).strip() for v in df.iloc[i]]
        if '순위' in row_vals and '종목명' in row_vals:
            df.columns = pd.Index([str(v).strip() for v in df.iloc[i]])
            return df.iloc[i + 1:].reset_index(drop=True)
    return None

def norm_vol(df, top=30):
    if df is None:
        return []
    result = []
    for _, r in df.iterrows():
        rank = to_int(r.get('순위', ''))
        name = str(r.get('종목명', '')).strip()
        if not rank or not name or name in ('nan', ''):
            continue
        cr = to_rate(r.get('등락률', ''))
        result.append({
            'rank': rank,
            'prevRank': to_prev_rank(r.get('전일', '')),
            'code': to_code(r.get('종목코드', '')),
            'name': name,
            'price': to_num(r.get('현재가', '')),
            'change': to_change(r.get('대비', ''), cr),
            'changeRate': cr,
            'volume': to_num(r.get('거래량', '')),
            'marketCap': to_num(r.get('시가총액', '')),
            'tradingVolume': to_num(r.get('거래대금', '')),
            'sector': '',
        })
    result.sort(key=lambda x: x['rank'])
    return result[:top]

def norm_rate(df, top=30):
    if df is None:
        return []
    result = []
    for _, r in df.iterrows():
        rank = to_int(r.get('순위', ''))
        name = str(r.get('종목명', '')).strip()
        if not rank or not name or name in ('nan', ''):
            continue
        cr = to_rate(r.get('등락률', ''))
        daeby = str(r.get('대비', ''))
        result.append({
            'rank': rank,
            'code': to_code(r.get('종목코드', '')),
            'name': name,
            'price': to_num(r.get('현재가', '')),
            'change': to_change(daeby, cr),
            'changeRate': cr,
            'isUpperLimit': '↑' in daeby,
            'volume': to_num(r.get('거래량', '')),
            'contractStrength': to_num(r.get('체결강도', '')),
            'sector': '',
        })
    result.sort(key=lambda x: x['rank'])
    return result[:top]


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


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else find_excel()
    print(f'파일: {path}')

    date = extract_date(path)
    date_korean = format_date_korean(date)
    print(f'날짜: {date_korean}')

    xl = pd.ExcelFile(path)
    vol  = norm_vol(parse_sheet(xl, '거래대금'))
    rate = norm_rate(parse_sheet(xl, '등락'))
    print(f'거래대금 {len(vol)}개, 등락률 {len(rate)}개 종목 파싱 완료')

    # MongoDB에 종목 데이터 저장 (웹앱 자동 로드용)
    save_to_mongodb(date, date_korean, vol, rate)

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

    output = {'date': date, 'vol': vol, 'rate': rate, 'news': news_map}
    out_file = f'뉴스데이터_{date.replace("-", "")}.json'
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\n완료: {out_file} 저장됨')
    print('다음 단계: Claude Code에 "분석해줘"라고 요청하세요.')


if __name__ == '__main__':
    main()
