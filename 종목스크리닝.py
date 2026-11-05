"""
종목스크리닝 주간 저장 스크립트 (/종목스크리닝 스킬의 2단계)
사용법: python 종목스크리닝.py            # 저장 (이미 그 주차 데이터가 있으면 알림만 하고 종료)
        python 종목스크리닝.py --dry-run  # 저장 없이 주차·분류 결과만 미리보기
        python 종목스크리닝.py --refresh-fin [weekKey] [--dry-run]
                                          # 이미 저장된 주차(기본 최신)의 종목별 실적(fin)만 DART로 다시 받아 갱신

/종목서칭 스킬(주식자동매매 프로젝트, 일봉 이동평균 정배열 스크리닝)이 만든
`분석결과/종목서칭_{기준일}.csv` 중 가장 최근 파일을 읽어, 종목을 카테고리(저장분석.
VALID_CATEGORIES, 앱 전체가 쓰는 31개 업종 분류)별로 묶고 **주 1회** MongoDB
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

종목별 실적(`fin`, 2026-10-31 도입): 저장할 때 DART로 종목마다 연간(가장 최근 사업보고서의 당기 vs 전기)과
분기(가장 최근 분기보고서의 당 분기 3개월 vs 전년 동기 3개월) 영업이익·매출액·순이익·자본을 받아
영업이익 성장률·영업이익률·ROE를 계산해 stocks[i].fin에 같이 저장한다(웹앱 "실적 분포" 차트용).
계산식·제외 사유는 derive_metrics() 참고. DART_API_KEY가 없거나 종목별 조회가 실패하면 그 종목의
fin만 비워 두고 계속 진행한다.
"""

import csv
import glob
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

import 저장분석  # VALID_CATEGORIES 단일 진실 공급원
import 주간분석  # week_key()/monday_of()/attach_categories() 재사용
import rs랭킹    # fetch_global_category_map()/fetch_category_cache_map() 재사용
import 종목분석  # DART 계정명 후보 상수·fetch_financial_statement()·extract_account() 재사용

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
    cat_map = rs랭킹.merge_category_maps(rs랭킹.fetch_category_cache_map(db), rs랭킹.fetch_global_category_map())
    주간분석.attach_categories(stocks, cat_map)  # 매칭된 종목에만 '카테고리'(+신규카테고리후보) 추가
    return [s for s in stocks if '카테고리' not in s]


def count_by_category(stocks):
    counts = {}
    for s in stocks:
        counts[s['카테고리']] = counts.get(s['카테고리'], 0) + 1
    return [{'category': c, 'count': n}
            for c, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


# ── 종목별 실적(fin): DART에서 연간·분기 영업이익 성장률/영업이익률/ROE ─────────────────────
# DART fnlttSinglAcntAll 필드 의미(삼성전자로 직접 확인, 2026-10-31):
#   사업보고서 IS/BS : thstrm_amount = 당기(말), frmtrm_amount = 전기(말)  → 보고서 1건에 두 해가 같이 옴
#   반기·3분기 IS    : thstrm_amount = 당 분기 3개월, frmtrm_q_amount = 전년 동기 3개월
#                      (thstrm_add_amount/frmtrm_add_amount는 누적)
#   1분기 IS         : 3개월/누적 구분이 없어 전년 동기가 frmtrm_amount일 수 있음 → frmtrm_q_amount 우선, 없으면 frmtrm_amount
#   BS               : thstrm_amount = 보고서 기준 기말
# 같은 계정명이 자본변동표(SCE)에도 있으므로 손익은 IS(없으면 CIS), 자본은 BS로 sj_div를 한정한다.
EOK = 1e8  # 원 → 억원
ANNUAL_CODE = '11011'
QUARTER_CODES = (('11014', 3), ('11012', 2), ('11013', 1))  # 최신 보고서부터 프로브: 3분기 → 반기 → 1분기
DART_SLEEP = 0.2
FIN_RETRIES = 3
IS_DIVS = ('IS', 'CIS')  # 손익계산서만 따로 안 내고 포괄손익계산서(CIS) 하나로 내는 회사가 많음
# 종목분석.py의 후보 목록에 W44 69종목 실측으로 확인한 표기(2026-10-31)를 더한다. 종목분석.py 쪽 상수는 건드리지 않고
# 여기서만 확장한다(그 상수는 종목 분석 탭·즉석분석 로직과 1:1로 맞춰져 있음).
#  - 매출: K-IFRS 1115 이후 최상단 라인을 그냥 '수익'으로 쓰는 회사가 가장 많음(케이씨텍·엑시콘·서산 등 20여 곳),
#          타이거일렉은 '매출액(매출액)'. 보험사는 매출 라인 자체가 없어 의도적으로 산출 불가(noData) 처리.
#  - 순이익: 이니텍 '연결당기순이익(손실)', KPX케미칼 '반기순손익'. 펌텍코리아처럼 합계 줄 없이 지배기업 귀속분만 있는
#          회사는 NET_INCOME_FALLBACK(지배기업 귀속 순이익)으로 대신한다(자본도 지배기업 기준이라 ROE 정의와 일관).
#  - 자본: 지배기업지분 / 지배기업의 소유주에게 귀속되는 지분 표기를 추가(없으면 자본총계로 폴백).
REVENUE_NAMES = 종목분석.REVENUE_NAMES + ['수익', '매출액(매출액)']
NET_INCOME_NAMES = 종목분석.NET_INCOME_NAMES + [
    '연결당기순이익(손실)', '연결분기순이익(손실)', '연결반기순이익(손실)', '당기순손익(손실)', '분기순손익', '반기순손익']
NET_INCOME_FALLBACK = [
    '지배기업의 소유주에게 귀속되는 당기순이익(손실)', '지배기업의 소유주에게 귀속되는 당기순이익',
    '지배기업의 소유주에게 귀속되는 분기순이익(손실)', '지배기업의 소유주에게 귀속되는 분기순이익',
    '지배기업의 소유주에게 귀속되는 반기순이익(손실)', '지배기업의 소유주에게 귀속되는 반기순이익',
    '지배기업소유주지분순이익', '지배기업소유주지분 순이익']
PARENT_EQUITY_NAMES = 종목분석.PARENT_EQUITY_NAMES + ['지배기업지분', '지배기업의 소유주에게 귀속되는 지분']


def _num(v):
    try:
        return float(str(v).replace(',', ''))
    except (TypeError, ValueError):
        return None


def extract_pair(items, names, sj_divs, prev_fields):
    """(당기, 전기/전년동기) 금액 쌍(원 단위) 추출. sj_divs 순서대로, 그 안에서 names 후보에 처음 일치하는
    계정을 쓰고 전기 값은 prev_fields 순서로 처음 있는 값을 쓴다. 못 찾으면 (None, None)."""
    for sj in sj_divs:
        for it in items:
            if it.get('sj_div') != sj or it.get('account_nm') not in names:
                continue
            cur = _num(it.get('thstrm_amount'))
            if cur is None:
                continue
            prev = next((v for v in (_num(it.get(f)) for f in prev_fields) if v is not None), None)
            return cur, prev
    return None, None


def _eok(v):
    return None if v is None else round(v / EOK)


def derive_metrics(rev, rev_prev, op, op_prev, ni, equity):
    """원 단위 입력 → fin 한 칸(연간 또는 분기)의 억원 원자료 + 파생값 + 차트 제외 사유.
      opGrowth = (영업이익 − 전년) / 전년 × 100   (전년 영업이익 > 0 일 때만)
      opMargin = 영업이익 / 매출액 × 100
      roe      = 당기순이익 / 자본 × 100          (자본 = 지배기업소유주지분, 없으면 자본총계 — StockAnalysis.jsx와 동일,
                                                  분기도 연환산하지 않고 그 기간 실적 그대로)
    skip(차트 제외 사유, 우선순위 순): noData(영업이익·전년·매출·순이익·자본 중 하나라도 없음 — 금융업 등)
      > prevOpLoss(전년 영업이익 ≤ 0) > roeNegative(ROE < 0)."""
    out = {'revenue': _eok(rev), 'revenuePrev': _eok(rev_prev), 'opIncome': _eok(op), 'opIncomePrev': _eok(op_prev),
           'netIncome': _eok(ni), 'equity': _eok(equity), 'opGrowth': None, 'opMargin': None, 'roe': None, 'skip': None}
    if rev is not None and rev > 0 and op is not None:
        out['opMargin'] = round(op / rev * 100, 1)
    if op is not None and op_prev is not None and op_prev > 0:
        out['opGrowth'] = round((op - op_prev) / op_prev * 100, 1)
    if ni is not None and equity is not None and equity > 0:
        out['roe'] = round(ni / equity * 100, 1)
    if out['opMargin'] is None or op_prev is None or out['roe'] is None:
        out['skip'] = 'noData'
    elif out['opGrowth'] is None:
        out['skip'] = 'prevOpLoss'
    elif out['roe'] < 0:
        out['skip'] = 'roeNegative'
    return out


def _statement_pair(items, prev_fields):
    """보고서 하나에서 손익(당기·전기)과 기말 자본을 뽑아 derive_metrics 입력으로 넘긴다."""
    rev, rev_prev = extract_pair(items, REVENUE_NAMES, IS_DIVS, prev_fields)
    op, op_prev = extract_pair(items, 종목분석.OPERATING_INCOME_NAMES, IS_DIVS, prev_fields)
    ni, _ = extract_pair(items, NET_INCOME_NAMES, IS_DIVS, prev_fields)
    if ni is None:
        ni, _ = extract_pair(items, NET_INCOME_FALLBACK, IS_DIVS, prev_fields)
    equity, _ = extract_pair(items, PARENT_EQUITY_NAMES, ('BS',), ())
    if equity is None:
        equity, _ = extract_pair(items, ['자본총계'], ('BS',), ())
    return derive_metrics(rev, rev_prev, op, op_prev, ni, equity)


def make_report_fetcher(corp_code):
    """종목 하나의 DART 보고서 조회를 (연도, 보고서코드) 단위로 메모이즈한다 — 산점도용 fin(annual/quarter)과
    비교표용 fin.hist가 같은 보고서를 여러 번 쓰므로 한 번만 받는다. 반환: get(year, reprt_code) → (items, fs_div)."""
    cache = {}

    def get(year, code):
        if (year, code) not in cache:
            cache[(year, code)] = 종목분석.fetch_financial_statement(corp_code, year, code, 'CFS')
            time.sleep(DART_SLEEP)
        return cache[(year, code)]
    return get


def fetch_annual_fin(get, today):
    """가장 최근 사업보고서(올해 보고서는 내년 3월에야 나오므로 작년·재작년만 프로브)의 당기 vs 전기."""
    for year in (today.year - 1, today.year - 2):
        items, fs_div = get(year, ANNUAL_CODE)
        if items:
            m = _statement_pair(items, ('frmtrm_amount',))
            return {'label': f'{year} vs {year - 1}', 'year': year, 'fsDiv': fs_div, **m}
    return None


def fetch_quarter_fin(get, today):
    """가장 최근 분기보고서(올해 3분기 → 반기 → 1분기, 없으면 작년)의 당 분기 3개월 vs 전년 동기 3개월."""
    for year in (today.year, today.year - 1):
        for code, q in QUARTER_CODES:
            items, fs_div = get(year, code)
            if items:
                m = _statement_pair(items, ('frmtrm_q_amount', 'frmtrm_amount'))
                return {'label': f'{year} {q}Q vs {year - 1} {q}Q', 'period': f'{year} {q}Q',
                        'year': year, 'q': q, 'fsDiv': fs_div, **m}
    return None


# ── 종목별 실적 비교표(fin.hist, 2026-11-05 도입): 연간 최근 3개년 + 분기 최근 8개 분기 ─────────────────
# 각 기간 값: 매출·영업이익·당기순이익(억원)과 전년(동기) 값(*Prev, 화면의 YoY 색칠용), 기말 자본, ROE.
# 보고서가 있는 기간만 담는다 — 3년 이내 상장 종목은 상장 전 연도/분기 보고서가 DART에 없으므로 자연히 빠진다
# (사업보고서에 같이 실린 전기 값은 *Prev로만 쓰고 별도 기간으로 만들지 않음).
# 4분기는 별도 보고서가 없어 "사업보고서(연간) − 3분기보고서 누적(9개월)"으로 계산한다(삼성전자 2025년으로 확인:
# 3분기 IS thstrm_add_amount = 9개월 누적, frmtrm_add_amount = 전년 9개월 누적). 연간·3분기 보고서의 연결/별도
# 구분이 다르면 섞지 않고 그 4분기는 비운다. 4분기 ROE의 자본은 연말(사업보고서 BS) 값.
HIST_YEARS = 3
HIST_QUARTERS = 8
Q_CODES = {1: '11013', 2: '11012', 3: '11014'}
HIST_ITEMS = (('revenue', REVENUE_NAMES), ('opIncome', 종목분석.OPERATING_INCOME_NAMES), ('netIncome', NET_INCOME_NAMES))


def find_account(items, names, sj_divs):
    """sj_divs 순서대로, names 후보에 처음 일치하고 당기 금액이 숫자인 계정 행을 돌려준다(없으면 None)."""
    for sj in sj_divs:
        for it in items:
            if it.get('sj_div') == sj and it.get('account_nm') in names and _num(it.get('thstrm_amount')) is not None:
                return it
    return None


def _first(it, fields):
    """계정 행 it에서 fields 순서로 처음 숫자인 값(원 단위). 행이 없거나 다 비었으면 None."""
    if not it:
        return None
    return next((v for v in (_num(it.get(f)) for f in fields) if v is not None), None)


def hist_rows(items):
    """보고서 하나에서 매출·영업이익·순이익 계정 행(dict)을 찾는다. 순이익은 합계 줄이 없으면 지배기업 귀속분."""
    rows = {key: find_account(items, names, IS_DIVS) for key, names in HIST_ITEMS}
    if rows['netIncome'] is None:
        rows['netIncome'] = find_account(items, NET_INCOME_FALLBACK, IS_DIVS)
    return rows


def hist_equity(items):
    it = find_account(items, PARENT_EQUITY_NAMES, ('BS',)) or find_account(items, ['자본총계'], ('BS',))
    return _num(it.get('thstrm_amount')) if it else None


def hist_point(period, cur, prev, equity, fs_div):
    """원 단위 {revenue, opIncome, netIncome} 당기·전년 → 억원 기간 한 칸. ROE = 순이익 ÷ 기말 자본 × 100
    (분기도 연환산하지 않음 — 산점도 fin과 같은 정의)."""
    out = {'period': period, 'fsDiv': fs_div, 'equity': _eok(equity), 'roe': None}
    for key, _ in HIST_ITEMS:
        out[key] = _eok(cur.get(key))
        out[key + 'Prev'] = _eok(prev.get(key))
    ni = cur.get('netIncome')
    if ni is not None and equity is not None and equity > 0:
        out['roe'] = round(ni / equity * 100, 1)
    return out


def _report_point(period, items, fs_div, prev_fields):
    rows = hist_rows(items)
    cur = {k: _first(it, ('thstrm_amount',)) for k, it in rows.items()}
    prev = {k: _first(it, prev_fields) for k, it in rows.items()}
    return hist_point(period, cur, prev, hist_equity(items), fs_div)


def fetch_annual_hist(get, today):
    """최근 HIST_YEARS개 연도 칸(작년부터 거꾸로, 최대 1년 더 프로브 — 1~3월엔 작년 보고서가 아직 없음).
    창은 가장 최근 사업보고서가 있는 해부터 HIST_YEARS개 연도로 고정하고, 그 안에서 보고서가 없는 해(상장 전·
    DART 누락)는 담지 않는다. 오래된 해 → 최근 해 순서."""
    out, slots = [], 0
    for year in range(today.year - 1, today.year - 2 - HIST_YEARS, -1):
        items, fs_div = get(year, ANNUAL_CODE)
        if items:
            out.append(_report_point(str(year), items, fs_div, ('frmtrm_amount',)))
        if items or slots:
            slots += 1
        if slots == HIST_YEARS:
            break
    return out[::-1]


def _q4_point(get, year):
    """4분기 = 사업보고서 − 3분기보고서 누적. 사업보고서가 없으면 'missing', 계산 불가(3분기보고서 없음·연결/별도
    불일치)면 None."""
    a_items, a_div = get(year, ANNUAL_CODE)
    if not a_items:
        return 'missing'
    q3_items, q3_div = get(year, Q_CODES[3])
    if not q3_items or q3_div != a_div:
        return None
    a_rows, q3_rows = hist_rows(a_items), hist_rows(q3_items)
    cur, prev = {}, {}
    for key, _ in HIST_ITEMS:
        a_cur, a_prev = _first(a_rows[key], ('thstrm_amount',)), _first(a_rows[key], ('frmtrm_amount',))
        c9, p9 = _first(q3_rows[key], ('thstrm_add_amount',)), _first(q3_rows[key], ('frmtrm_add_amount',))
        cur[key] = a_cur - c9 if a_cur is not None and c9 is not None else None
        prev[key] = a_prev - p9 if a_prev is not None and p9 is not None else None
    return hist_point(f'{year} 4Q', cur, prev, hist_equity(a_items), a_div)


def fetch_quarter_hist(get, today):
    """최근 HIST_QUARTERS개 분기 칸(올해 4분기부터 거꾸로 4년치를 프로브, 아직 안 나온 최신 보고서는 건너뜀).
    창은 가장 최근 분기 보고서가 있는 분기부터 HIST_QUARTERS개 분기로 고정하고, 그 안에서 보고서가 없는 분기
    (상장 전·DART 누락 — 방림은 2026 1Q가 DART에 없음, 2026-11-05 확인)와 4분기 계산 불가 분기는 담지 않는다.
    오래된 분기 → 최근 분기 순서."""
    out, slots = [], 0
    for year in range(today.year, today.year - 4, -1):
        for q in (4, 3, 2, 1):
            if q == 4:
                p = _q4_point(get, year)
                missing = p == 'missing'
                if missing:
                    p = None
            else:
                items, fs_div = get(year, Q_CODES[q])
                missing = not items
                p = None if missing else _report_point(f'{year} {q}Q', items, fs_div, ('frmtrm_q_amount', 'frmtrm_amount'))
            if missing and not slots:
                continue  # 아직 제출 안 된 최신 분기
            slots += 1
            if p is not None:
                out.append(p)
            if slots == HIST_QUARTERS:
                return out[::-1]
    return out[::-1]


def load_code_to_corp():
    """KRX 종목코드 → DART corp_code. 로컬 캐시(_dart_corp_codes.json)만 쓴다 — 없으면 새로 받는 로직이
    FDR(KRX) 호출을 하므로 여기서는 실행하지 않고 빈 매핑을 돌려준다."""
    path = 종목분석.CORP_CODE_CACHE
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return {v['stock_code']: v for v in json.load(f).values()}


def fetch_all_fin(stocks):
    """stocks(code·name 보유) 전체의 fin을 {종목코드: fin 또는 None}으로 반환. 종목 단위 실패는 건너뛴다."""
    if not 종목분석.DART_API_KEY:
        print('[경고] DART_API_KEY가 없어 종목별 실적(fin) 수집을 건너뜁니다.')
        return {}
    code_to_corp = load_code_to_corp()
    if not code_to_corp:
        print(f'[경고] {종목분석.CORP_CODE_CACHE}가 없어 종목별 실적(fin) 수집을 건너뜁니다.')
        return {}
    today = date.today()
    result, failed = {}, []
    t0 = time.time()
    for i, s in enumerate(stocks, 1):
        corp = code_to_corp.get(s['code'])
        if not corp:
            result[s['code']] = None
            print(f"  {s['name']}({s['code']}): DART corp_code 매핑 없음")
            continue
        for attempt in range(1, FIN_RETRIES + 1):  # 일시적 네트워크 오류는 재시도(2026-11-01 W44 백필에서 28종목이 한꺼번에 실패)
            try:
                get = make_report_fetcher(corp['corp_code'])
                result[s['code']] = {'annual': fetch_annual_fin(get, today),
                                     'quarter': fetch_quarter_fin(get, today),
                                     'hist': {'annual': fetch_annual_hist(get, today),
                                              'quarter': fetch_quarter_hist(get, today)}}
                break
            except (requests.RequestException, ValueError) as e:
                if attempt == FIN_RETRIES:
                    result[s['code']] = None
                    failed.append(s['code'])
                    print(f"  {s['name']}({s['code']}): 조회 실패({FIN_RETRIES}회) — {e}")
                else:
                    time.sleep(2 * attempt)
        if i % 20 == 0:
            print(f'  실적 수집 {i}/{len(stocks)} ({time.time() - t0:.0f}s)', flush=True)
    print(f'종목별 실적(fin) 수집 완료: {len(result)}종목 중 실패 {len(failed)}, {time.time() - t0:.0f}s')
    return result


def summarize_fin(fin_map):
    """수집 결과 요약 출력: 탭별 차트 표시 수와 제외 사유 분포, 분기 라벨 분포."""
    for kind, title in (('annual', '연간'), ('quarter', '분기')):
        rows = [(f or {}).get(kind) for f in fin_map.values()]
        have = [r for r in rows if r]
        reasons = {}
        for r in have:
            if r['skip']:
                reasons[r['skip']] = reasons.get(r['skip'], 0) + 1
        plotted = sum(1 for r in have if not r['skip'])
        print(f"[{title}] 보고서 {len(have)}/{len(rows)} · 차트 표시 {plotted} · 제외 {reasons or '-'}")
        if kind == 'quarter':
            labels = {}
            for r in have:
                labels[r['period']] = labels.get(r['period'], 0) + 1
            print(f'  분기 분포: {dict(sorted(labels.items(), reverse=True))}')
    for kind, title in (('annual', '연간'), ('quarter', '분기')):  # 비교표(fin.hist) 기간 수 분포
        lens = {}
        for f in fin_map.values():
            n = len(((f or {}).get('hist') or {}).get(kind) or [])
            lens[n] = lens.get(n, 0) + 1
        print(f"[비교표 {title}] 기간 수별 종목 수: {dict(sorted(lens.items(), reverse=True))}")


def refresh_fin(db, dry_run):
    """이미 저장된 주차(--refresh-fin 뒤 weekKey, 없으면 가장 최근 주차)의 stocks[*].fin만 새로 받아 갱신한다.
    업종·종목 구성 등 다른 필드는 건드리지 않는다."""
    args = sys.argv[sys.argv.index('--refresh-fin') + 1:]
    if args and not args[0].startswith('--'):
        week_key = args[0]
    else:
        keys = [d['_id'] for d in db[SCREENING_COLLECTION].find({}, {'_id': 1})]
        if not keys:
            print('[오류] 저장된 stock_screening 주차가 없습니다.')
            return
        week_key = max(keys, key=lambda k: tuple(int(x) for x in re.findall(r'\d+', k)))
    doc = db[SCREENING_COLLECTION].find_one({'_id': week_key})
    if not doc:
        print(f'[오류] {week_key} 주차 문서가 없습니다.')
        return
    print(f"{week_key} 종목별 실적(fin) 갱신: {len(doc['stocks'])}종목 (기준일 {doc.get('asOfDate')})")
    fin_map = fetch_all_fin(doc['stocks'])
    if not fin_map:
        return
    summarize_fin(fin_map)
    if dry_run:
        print('[dry-run] 저장하지 않았습니다.')
        return
    kept = 0
    for s in doc['stocks']:
        new = fin_map.get(s['code'])
        if new is None:
            kept += 1 if s.get('fin') else 0  # 실패한 종목은 이전에 받아 둔 fin을 지우지 않고 유지
            continue
        s['fin'] = new
    if kept:
        print(f'조회 실패로 이전 fin을 유지한 종목 {kept}개')
    db[SCREENING_COLLECTION].update_one(
        {'_id': week_key},
        {'$set': {'stocks': doc['stocks'], 'finFetchedAt': datetime.now().isoformat(timespec='seconds')}})
    print(f'MongoDB 갱신 완료: {SCREENING_COLLECTION}/{week_key} (fin)')


def main():
    dry_run = '--dry-run' in sys.argv
    if not MONGODB_URI:
        print('[오류] MONGODB_URI가 없어 진행할 수 없습니다 (.env.local 확인).')
        sys.exit(1)

    if '--refresh-fin' in sys.argv:
        client = MongoClient(MONGODB_URI)
        refresh_fin(client.get_default_database(), dry_run)
        client.close()
        return

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

    fin_map = fetch_all_fin(stocks)
    if fin_map:
        summarize_fin(fin_map)
    doc_stocks = [{k: s[k] for k in ('code', 'name', 'market', 'close', 'marcap', '카테고리', '신규카테고리후보') if k in s}
                  for s in stocks]  # 시가총액 내림차순(CSV 원본 순서) 유지
    for ds in doc_stocks:
        if fin_map.get(ds['code']):
            ds['fin'] = fin_map[ds['code']]
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
        **({'finFetchedAt': datetime.now().isoformat(timespec='seconds')} if fin_map else {}),
    })
    print(f'MongoDB 저장 완료: {SCREENING_COLLECTION}/{week_key} ({len(stocks)}종목, 기준일 {as_of})')
    client.close()


if __name__ == '__main__':
    main()
