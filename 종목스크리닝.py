"""
종목스크리닝 주간 저장 스크립트 (/종목스크리닝 스킬의 2단계)
사용법: python 종목스크리닝.py            # 저장 (이미 그 주차 데이터가 있으면 알림만 하고 종료)
        python 종목스크리닝.py --dry-run  # 저장 없이 주차·분류 결과만 미리보기

/종목서칭 스킬(주식자동매매 프로젝트, 일봉 이동평균 정배열 스크리닝)이 만든
`분석결과/종목서칭_{기준일}.csv` 중 가장 최근 파일을 읽어, 종목을 카테고리(저장분석.
VALID_CATEGORIES, 앱 전체가 쓰는 29개 업종 분류)별로 묶고 **주 1회** MongoDB
stock_screening 컬렉션(_id = weekKey, 예: "2026-W44")에 저장한다. 웹앱 "종목스크리닝" 탭
(api/getScreening.js → ScreeningView.jsx)이 이 컬렉션을 읽어 주차별 종목 수 추이와 업종
추이를 보여준다.

저장 주차 규칙(사용자 지정, 2026-10-31): 한 주는 금요일에 끝난 것으로 본다.
  - 금·토·일에 실행 → 이번 주(월~일) 주차로 저장  (예: 10/31 토 → W44)
  - 월~목에 실행   → 아직 한 주가 안 끝났으므로 직전 주차로 저장 (예: 10/29 목 → W43)
이미 그 주차 문서가 있으면 덮어쓰지 않고 "이미 했다"고 알린 뒤 종료한다.
실제 데이터 기준일은 문서의 asOfDate에 따로 기록한다.

카테고리 분류: rs랭킹.py와 같은 2단계 소스(ai_analysis 최신 → rs_category_cache 영속 캐시)를
재사용한다. 둘 다에 없는 종목이 있으면 저장하지 않고 목록을 출력한 뒤 종료 코드 2로 끝난다 —
이 스크립트는 Claude를 호출하지 못하므로, Claude Code가 그 종목들을 본업·최근 뉴스 기준으로
분류(불확실하면 WebSearch)해 rs_category_cache에 upsert한 뒤 이 스크립트를 다시 실행한다
(DATA_PIPELINE.md "종목스크리닝.py" 절 참고).
"""

import csv
import glob
import os
import re
import sys
from datetime import date, datetime, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

import 저장분석  # VALID_CATEGORIES 단일 진실 공급원
import 주간분석  # week_key()/monday_of()/attach_categories() 재사용
import rs랭킹    # fetch_global_category_map()/fetch_category_cache_map() 재사용

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')

MONGODB_URI = os.getenv('MONGODB_URI')
SCREENING_COLLECTION = 'stock_screening'
# /종목서칭 스킬이 결과를 쓰는 폴더(다른 프로젝트라 import 불가, 경로로만 참조)
SEARCH_RESULT_DIR = r'C:\Users\USER\Desktop\Claude\주식\주식자동매매\분석결과'
MAX_CSV_AGE_DAYS = 4  # 금요일 데이터를 월요일(3일 뒤)에 써도 통과, 그보다 오래되면 재실행 요청


def resolve_target_week(today=None):
    """저장할 주차를 (weekKey, 그 주 월요일 date)로 반환 — 금·토·일은 이번 주, 월~목은 직전 주."""
    today = today or date.today()
    monday = 주간분석.monday_of(today)
    if today.weekday() < 4:  # 월(0)~목(3)
        monday -= timedelta(days=7)
    return 주간분석.week_key(monday), monday


def load_latest_search_csv():
    """가장 최근 종목서칭_YYYYMMDD.csv를 읽어 (기준일 date, 조건 설명, 종목 리스트)를 반환."""
    files = [f for f in glob.glob(os.path.join(SEARCH_RESULT_DIR, '종목서칭_*.csv'))
             if re.search(r'종목서칭_(\d{8})\.csv$', f)]
    if not files:
        return None
    path = max(files, key=lambda f: re.search(r'(\d{8})\.csv$', f).group(1))
    ymd = re.search(r'(\d{8})\.csv$', path).group(1)
    as_of = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:]))

    condition = ''
    stocks = []
    with open(path, encoding='utf-8-sig', newline='') as f:
        lines = f.read().splitlines()
    body = []
    for line in lines:
        if line.startswith('#'):
            condition = line.lstrip('# ').strip()
        elif line.strip():
            body.append(line)
    for row in csv.DictReader(body):
        stocks.append({
            'code': row['종목코드'].strip().zfill(6),
            'name': row['종목명'].strip(),
            'market': row['시장'].strip(),
            'close': int(float(row['종가'])),
            'marcap': int(float(row['시가총액(억원)'])),
        })
    return path, as_of, condition, stocks


def attach_categories(db, stocks):
    """rs랭킹.py와 동일한 2단계 병합(ai_analysis 우선, rs_category_cache 폴백)으로 분류를 붙인다."""
    cat_map = {**rs랭킹.fetch_category_cache_map(db), **rs랭킹.fetch_global_category_map()}
    주간분석.attach_categories(stocks, cat_map)  # 매칭된 종목에만 '카테고리'(+신규카테고리후보) 추가
    return [s for s in stocks if '카테고리' not in s]


def count_by_category(stocks):
    counts = {}
    for s in stocks:
        counts[s['카테고리']] = counts.get(s['카테고리'], 0) + 1
    return [{'category': c, 'count': n}
            for c, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


def main():
    dry_run = '--dry-run' in sys.argv
    if not MONGODB_URI:
        print('[오류] MONGODB_URI가 없어 진행할 수 없습니다 (.env.local 확인).')
        sys.exit(1)

    week_key, monday = resolve_target_week()
    print(f'저장 대상 주차: {week_key} ({monday} ~ {monday + timedelta(days=6)}), 오늘 {date.today()}')

    client = MongoClient(MONGODB_URI)
    db = client.get_default_database()

    existing = db[SCREENING_COLLECTION].find_one({'_id': week_key})
    if existing:
        print(f"[알림] 이미 {week_key} 주차 종목스크리닝을 했습니다 "
              f"(기준일 {existing.get('asOfDate')}, {existing.get('total')}종목, "
              f"저장 {existing.get('savedAt')}). 저장하지 않고 종료합니다.")
        client.close()
        return

    loaded = load_latest_search_csv()
    if loaded is None:
        print(f'[오류] {SEARCH_RESULT_DIR} 에 종목서칭_*.csv 가 없습니다. /종목서칭을 먼저 실행하세요.')
        sys.exit(1)
    path, as_of, condition, stocks = loaded
    age = (date.today() - as_of).days
    print(f'종목서칭 결과: {os.path.basename(path)} (기준일 {as_of}, {len(stocks)}종목)')
    if age > MAX_CSV_AGE_DAYS:
        print(f'[오류] 종목서칭 결과가 {age}일 전 데이터입니다. /종목서칭을 다시 실행한 뒤 재시도하세요.')
        sys.exit(1)

    missing = attach_categories(db, stocks)
    if missing:
        print(f'[분류 필요] 카테고리를 찾지 못한 종목 {len(missing)}개 — Claude Code가 분류해 '
              f'rs_category_cache에 upsert한 뒤 이 스크립트를 다시 실행하세요:')
        for s in missing:
            print(f"  {s['name']} ({s['code']}, {s['market']}, 시총 {s['marcap']:,}억)")
        client.close()
        sys.exit(2)

    counts = count_by_category(stocks)
    print(f'{len(stocks)}종목 업종 분포:')
    for c in counts:
        print(f"  {c['category']:<10} {c['count']:>3}  ({c['count'] / len(stocks) * 100:.1f}%)")

    if dry_run:
        print('[dry-run] 저장하지 않았습니다.')
        client.close()
        return

    doc_stocks = [{k: s[k] for k in ('code', 'name', 'market', 'close', 'marcap', '카테고리', '신규카테고리후보') if k in s}
                  for s in stocks]  # 시가총액 내림차순(CSV 원본 순서) 유지
    db[SCREENING_COLLECTION].insert_one({
        '_id': week_key,
        'weekKey': week_key,
        'weekStart': monday.isoformat(),
        'asOfDate': as_of.isoformat(),
        'condition': condition,
        'total': len(stocks),
        'categoryCounts': counts,
        'stocks': doc_stocks,
        'savedAt': datetime.now().isoformat(timespec='seconds'),
    })
    print(f'MongoDB 저장 완료: {SCREENING_COLLECTION}/{week_key} ({len(stocks)}종목, 기준일 {as_of})')
    client.close()


if __name__ == '__main__':
    main()
