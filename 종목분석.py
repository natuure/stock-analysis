"""
DART 공식 Open API로 단일 종목의 재무제표를 수집하는 스크립트.
사용법: python 종목분석.py 종목명
       예) python 종목분석.py 인지컨트롤스

오늘 날짜 기준 그 종목이 실제로 제출한 가장 최근 보고서(사업보고서/1분기/반기/3분기)를
찾아, 거기에 맞춰 아래 4가지 경우 중 하나로 조회 범위를 정한다(Y = 최신 보고서의 연도):
  - 최신이 Y년 1분기보고서 → Y-3,Y-2,Y-1년 사업보고서 + Y년 1분기보고서
  - 최신이 Y년 반기보고서  → Y-3,Y-2,Y-1년 사업보고서 + Y년 1분기·반기보고서
  - 최신이 Y년 3분기보고서 → Y-3,Y-2,Y-1년 사업보고서 + Y년 1분기·반기·3분기보고서
  - 최신이 Y년 사업보고서  → Y-3,Y-2,Y-1,Y년 사업보고서 4개년 (분기 조회 불필요)

결과: 종목분석결과/{종목명}_{YYYYMMDD}.json 저장 + MongoDB company_analysis 컬렉션 저장
      (_id=종목코드) — 웹앱 "종목 분석" 탭에서 종목명 검색 시 바로 조회됨.
"""
import os
import io
import sys
import json
import time
import zipfile
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('.env.local')

DART_API_KEY = os.getenv('DART_API_KEY')
KIS_APP_KEY = os.getenv('KIS_APP_KEY')
KIS_APP_SECRET = os.getenv('KIS_APP_SECRET')

DART_BASE = 'https://opendart.fss.or.kr/api'
KIS_BASE = 'https://openapi.koreainvestment.com:9443'
CORP_CODE_CACHE = '_dart_corp_codes.json'  # corpCode.xml은 전체 상장사 목록이라 매번 받지 않고 캐싱

# 분기 보고서는 한 해 안에서 진행 순서가 고정돼 있다(1분기→반기→3분기). 사업보고서(연간)는
# 같은 '연도' 라벨이라도 실제 제출은 그 다음 해 3월이라 1분기~3분기보고서보다 항상 더 늦다.
QUARTER_REPORTS = [('11013', '1분기보고서'), ('11012', '반기보고서'), ('11014', '3분기보고서')]
ANNUAL_REPORT = ('11011', '사업보고서')
# 최신 보고서 탐색 순서: 사업보고서(다음해 3월 제출이라 가장 늦음) → 3분기 → 반기 → 1분기
LATEST_REPORT_PROBE_ORDER = [ANNUAL_REPORT, QUARTER_REPORTS[2], QUARTER_REPORTS[1], QUARTER_REPORTS[0]]

# DART는 보고서 종류·기업마다 같은 항목을 다른 이름으로 태깅한다(직접 확인함, 2026-06-22):
# 사업보고서(연간)는 '당기순이익', 분기·반기보고서는 회사에 따라 '분기순이익'/'반기순이익'을 씀.
# 지배주주지분도 회사별로 '지배기업소유주지분'(공백 없음)/'지배기업 소유주지분'(공백)/
# '지배기업의 소유주에게 귀속되는 자본' 셋 다 쓰인다 — 후보를 넉넉히 둬야 누락이 줄어든다.
NET_INCOME_NAMES = ['당기순이익', '당기순이익(손실)', '분기순이익', '분기순이익(손실)', '반기순이익', '반기순이익(손실)']
PARENT_EQUITY_NAMES = ['지배기업의 소유주에게 귀속되는 자본', '지배기업소유주지분', '지배기업 소유주지분']
# 매출채권도 회사마다, 같은 회사라도 보고연도마다 이름이 다름(직접 확인, 2026-06-24): 대부분
# '매출채권' 단독이지만 '매출채권및기타채권'/'매출채권 및 기타유동채권'처럼 기타수취채권과
# 합쳐서 한 줄로 보고하는 경우도 있음(인지컨트롤스는 2023년엔 후자, 2025년엔 전자를 씀 — 같은
# 회사도 연도별로 표기가 바뀔 수 있어 후보를 넉넉히 둬야 함). 장기성매출채권(비유동)은 의도적
# 으로 후보에서 제외 — 같이 잡으면 단기/장기가 섞여 회전율 비중 계산이 왜곡됨.
ACCOUNTS_RECEIVABLE_NAMES = ['매출채권', '매출채권및기타채권', '매출채권 및 기타채권', '매출채권 및 기타유동채권']
# 재고자산도 유동/비유동 구분 없이 '재고자산' 하나로 보고하는 게 보통이지만, 유동자산 항목을
# 세분화해 '유동재고자산'으로 쓰는 회사도 있음(직접 확인).
INVENTORY_NAMES = ['재고자산', '유동재고자산']
# 자본잉여금도 회사마다 다름: 삼성전자처럼 '자본잉여금' 합계줄 자체가 없고 세부 항목인
# '주식발행초과금'만 보고하는 경우가 있음(직접 확인) — 이 경우 주식발행초과금을 대신 씀.
CAPITAL_SURPLUS_NAMES = ['자본잉여금', '주식발행초과금']
# 선수금은 2018년 수익인식기준(K-IFRS 1115) 도입 이후 '계약부채'로 대체 표기하는 회사도 있음.
ADVANCE_RECEIPTS_NAMES = ['선수금', '계약부채']


# ── DART corp_code 매핑 (종목명 → corp_code) ─────────────────────────────────

def load_corp_codes():
    if os.path.exists(CORP_CODE_CACHE):
        with open(CORP_CODE_CACHE, encoding='utf-8') as f:
            return json.load(f)
    print('DART 상장기업 코드 목록 다운로드 중 (최초 1회, 이후 캐싱)...')
    r = requests.get(f'{DART_BASE}/corpCode.xml', params={'crtfc_key': DART_API_KEY}, timeout=30)
    r.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    root = ET.fromstring(zf.read(zf.namelist()[0]))
    mapping = {}
    for node in root.findall('list'):
        stock_code = (node.findtext('stock_code') or '').strip()
        if not stock_code:
            continue  # 비상장사 제외
        mapping[(node.findtext('corp_name') or '').strip()] = {
            'corp_code': (node.findtext('corp_code') or '').strip(),
            'stock_code': stock_code,
        }
    with open(CORP_CODE_CACHE, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False)
    return mapping


def find_corp_code(name, corp_map):
    if name in corp_map:
        return corp_map[name]
    # 대소문자만 다른 정확 일치(예: 'sk하이닉스' 입력 vs 'SK하이닉스' 정식명)를 부분일치보다
    # 먼저 확인한다 — 안 그러면 짧은 회사명이 입력 문자열에 우연히 포함돼 잘못 매칭될 수 있음
    # (직접 확인, 2026-06-25: 'sk하이닉스' → 부분일치만 썼을 때 전혀 무관한 '이닉스'(452400)에
    # 매칭되고 실제 SK하이닉스(000660)는 매칭되지 않는 버그가 있었음).
    name_lower = name.lower()
    for k, v in corp_map.items():
        if k.lower() == name_lower:
            return v
    candidates = [(k, v) for k, v in corp_map.items() if name_lower in k.lower() or k.lower() in name_lower]
    if not candidates:
        return None
    # 부분일치 후보가 여럿이면 입력값과 길이 차이가 가장 작은(가장 가까운) 회사명을 선택.
    candidates.sort(key=lambda kv: abs(len(kv[0]) - len(name)))
    return candidates[0][1]


# ── KIS 현재가·시가총액·발행주식수 조회 ───────────────────────────────────────
# 종목분석.py는 MongoDB를 쓰지 않으므로(뉴스분석.py와 달리) KIS 토큰을 캐싱하지 않고 매 실행마다
# 새로 발급한다 — 수동으로 가끔 실행하는 스크립트라 1분당 1회 제한에 걸릴 일이 거의 없음.

def get_kis_token():
    r = requests.post(f'{KIS_BASE}/oauth2/tokenP', headers={
        'Content-Type': 'application/json; charset=UTF-8',
    }, json={
        'grant_type': 'client_credentials',
        'appkey': KIS_APP_KEY,
        'appsecret': KIS_APP_SECRET,
    }, timeout=10)
    r.raise_for_status()
    return r.json()['access_token']


def fetch_kis_quote(token, stock_code):
    """KIS 주식현재가 시세(inquire-price)로 현재가·시가총액·발행주식수를 조회한다.
    FID_COND_MRKT_DIV_CODE=UN(KRX+NXT 통합)으로 호출 — KRX 단독(J)과 비교해 직접 검증함
    (2026-06-25, 삼성전자: J 현재가 340,500원/거래대금 15.8조 vs UN 339,500원/27.4조로
    NXT 체결분 반영 확인). 시가총액은 KIS가 주는 hts_avls를 안 쓰고 (현재가×상장주식수)로
    직접 계산함 — hts_avls의 단위 표기(공식 문서상 백만원)를 그대로 적용하면 직접 계산한
    값과 100배 차이가 나는 걸 확인해서(2026-06-25), 단위가 불확실한 필드 대신 이미 알고
    있는 두 값(현재가·상장주식수)으로 직접 계산하는 쪽을 택함."""
    r = requests.get(f'{KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price', headers={
        'Content-Type': 'application/json; charset=UTF-8',
        'authorization': f'Bearer {token}',
        'appkey': KIS_APP_KEY,
        'appsecret': KIS_APP_SECRET,
        'tr_id': 'FHKST01010100',
        'custtype': 'P',
    }, params={
        'FID_COND_MRKT_DIV_CODE': 'UN',
        'FID_INPUT_ISCD': stock_code,
    }, timeout=10)
    data = r.json()
    if data.get('rt_cd') != '0':
        raise RuntimeError(f'KIS 현재가 조회 실패: {data.get("msg1")}')
    o = data['output']
    price = float(o['stck_prpr'])
    shares = int(o['lstn_stcn'])
    return {
        'price': price,
        'marketCap_억원': price * shares / 100_000_000,
        'sharesOutstanding': shares,
    }


# ── DART 재무제표 조회 ────────────────────────────────────────────────────────

def fetch_financial_statement(corp_code, bsns_year, reprt_code, fs_div='CFS'):
    """단일회사 전체 재무제표. 연결(CFS) 기준 데이터가 없으면 별도(OFS)로 재시도."""
    for div in ([fs_div, 'OFS'] if fs_div == 'CFS' else [fs_div]):
        r = requests.get(f'{DART_BASE}/fnlttSinglAcntAll.json', params={
            'crtfc_key': DART_API_KEY, 'corp_code': corp_code,
            'bsns_year': bsns_year, 'reprt_code': reprt_code, 'fs_div': div,
        }, timeout=10)
        try:
            data = r.json()
        except ValueError:
            continue
        if data.get('status') == '000' and data.get('list'):
            return data['list'], div
    return [], fs_div


def extract_account(items, names):
    """items(account_nm 목록)에서 names 중 일치하는 첫 계정의 당기 금액(원 단위)을 찾는다."""
    for it in items:
        if it.get('account_nm') in names:
            try:
                return float(str(it.get('thstrm_amount', '0')).replace(',', ''))
            except ValueError:
                continue
    return None


def extract_account_like(items, keyword, sj_div='BS'):
    """account_nm에 keyword가 포함된 재무상태표(BS) 항목들의 당기 금액 합계
    (차입금처럼 유동/비유동으로 라벨이 갈리는 계정용). sj_div를 BS로 한정하는 이유:
    현금흐름표(CF)에도 '차입금의 차입'/'차입금의 상환' 같은 유사 이름의 플로우 항목이 있어,
    필터 없이 부분일치만 하면 잔액(stock)과 흐름(flow)이 섞여 말도 안 되는 값이 나온다."""
    total, found = 0.0, False
    for it in items:
        if it.get('sj_div') == sj_div and keyword in str(it.get('account_nm', '')):
            try:
                total += float(str(it.get('thstrm_amount', '0')).replace(',', ''))
                found = True
            except ValueError:
                continue
    return total if found else None


def find_latest_report(corp_code, today):
    """오늘 기준 실제 제출된 가장 최근 사업/분기/반기보고서를 찾는다(연도 내림차순, 같은
    연도 안에서는 LATEST_REPORT_PROBE_ORDER 순서로 실제 DART 응답 존재 여부를 확인).
    아직 제출 안 된(미래) 보고서는 DART가 빈 응답을 주므로 자연히 건너뛰어진다."""
    for year in (today.year, today.year - 1, today.year - 2):
        for code, label in LATEST_REPORT_PROBE_ORDER:
            items, _ = fetch_financial_statement(corp_code, year, code, 'CFS')
            time.sleep(0.2)
            if items:
                return year, code, label
    return None, None, None


def build_fetch_plan(latest_year, latest_code):
    """최신 보고서 종류에 따라 조회할 (연간 사업보고서 연도 목록, 올해 분기보고서 목록)을 정한다.
    latest_year를 Y라 하면:
      - 최신이 Y년 1분기보고서   → Y-3,Y-2,Y-1년 사업보고서 + Y년 1분기보고서
      - 최신이 Y년 반기보고서    → Y-3,Y-2,Y-1년 사업보고서 + Y년 1분기·반기보고서
      - 최신이 Y년 3분기보고서   → Y-3,Y-2,Y-1년 사업보고서 + Y년 1분기·반기·3분기보고서
      - 최신이 Y년 사업보고서    → Y-3,Y-2,Y-1,Y년 사업보고서 (4개년, 분기 조회는 불필요)
    """
    annual_years = [latest_year - 3, latest_year - 2, latest_year - 1]
    if latest_code == ANNUAL_REPORT[0]:
        annual_years.append(latest_year)
        return sorted(annual_years), []
    idx = next(i for i, (code, _) in enumerate(QUARTER_REPORTS) if code == latest_code)
    quarters = [(latest_year, code, label) for code, label in QUARTER_REPORTS[:idx + 1]]
    return sorted(annual_years), quarters


def fetch_annual_financials(corp_code, years):
    """사업보고서(연간) 재무제표. `years`에 지정된 연도만 조회한다."""
    annual = {}
    for year in years:
        items, fs_div = fetch_financial_statement(corp_code, year, ANNUAL_REPORT[0], 'CFS')
        if not items:
            print(f'  {year}년 사업보고서 없음, 건너뜀')
            continue
        annual[str(year)] = {
            'fs_div': fs_div,
            '매출액': extract_account(items, ['매출액', '영업수익']),
            '영업이익': extract_account(items, ['영업이익', '영업이익(손실)']),
            # 주의: 지배주주지분 계정명(PARENT_EQUITY_NAMES)을 당기순이익 후보에 넣으면 안 됨
            # — BS(재무상태표)에도 같은 이름의 항목이 있어 자본 항목이 먼저 매칭되는 버그가 났었음.
            '당기순이익': extract_account(items, NET_INCOME_NAMES),
            '기본주당이익_DART': extract_account(items, ['기본 주당이익', '기본주당이익', '기본 주당이익(손실)']),
            '자산총계': extract_account(items, ['자산총계']),
            '부채총계': extract_account(items, ['부채총계']),
            '자본총계': extract_account(items, ['자본총계']),
            '지배기업소유주지분': extract_account(items, PARENT_EQUITY_NAMES),
            '현금및현금성자산': extract_account(items, ['현금및현금성자산']),
            '단기금융상품': extract_account(items, ['단기금융상품']),
            '차입금_추정': extract_account_like(items, '차입금'),
            '감가상각비': extract_account(items, ['감가상각비']),
            '무형자산': extract_account(items, ['무형자산']),
            '유형자산': extract_account(items, ['유형자산']),
            '재고자산': extract_account(items, INVENTORY_NAMES),
            '매출채권': extract_account(items, ACCOUNTS_RECEIVABLE_NAMES),
            '선수금': extract_account(items, ADVANCE_RECEIPTS_NAMES),
            '자본금': extract_account(items, ['자본금']),
            '자본잉여금': extract_account(items, CAPITAL_SURPLUS_NAMES),
            '이익잉여금': extract_account(items, ['이익잉여금', '이익잉여금(결손금)']),
        }
        time.sleep(0.2)
    return annual


def fetch_quarters(corp_code, specs):
    """올해 진행된 분기/반기보고서. `specs`: [(year, reprt_code, label), ...] (시간순)."""
    quarters = []
    for year, code, label in specs:
        items, fs_div = fetch_financial_statement(corp_code, year, code, 'CFS')
        if not items:
            print(f'  {year}년 {label} 없음, 건너뜀')
            continue
        quarters.append({
            'year': year, 'reprt_code': code, 'label': label, 'fs_div': fs_div,
            '매출액': extract_account(items, ['매출액', '영업수익']),
            '영업이익': extract_account(items, ['영업이익', '영업이익(손실)']),
            '당기순이익': extract_account(items, NET_INCOME_NAMES),
            '영업활동현금흐름': extract_account(items, ['영업활동현금흐름', '영업활동으로인한현금흐름', '영업활동으로 인한 현금흐름']),
            # 재무상태표 항목 — 분기말 시점 스냅샷이라 연간 데이터와 동일하게 매 보고서에 포함됨.
            '자산총계': extract_account(items, ['자산총계']),
            '부채총계': extract_account(items, ['부채총계']),
            '자본총계': extract_account(items, ['자본총계']),
            '현금및현금성자산': extract_account(items, ['현금및현금성자산']),
            '단기금융상품': extract_account(items, ['단기금융상품']),
            '무형자산': extract_account(items, ['무형자산']),
            '유형자산': extract_account(items, ['유형자산']),
            '재고자산': extract_account(items, INVENTORY_NAMES),
            '매출채권': extract_account(items, ACCOUNTS_RECEIVABLE_NAMES),
            '선수금': extract_account(items, ADVANCE_RECEIPTS_NAMES),
            '자본금': extract_account(items, ['자본금']),
            '자본잉여금': extract_account(items, CAPITAL_SURPLUS_NAMES),
            '이익잉여금': extract_account(items, ['이익잉여금', '이익잉여금(결손금)']),
        })
        time.sleep(0.2)
    return quarters


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print('사용법: python 종목분석.py 종목명')
        print('예시: python 종목분석.py 인지컨트롤스')
        return
    if not DART_API_KEY:
        print('[오류] DART_API_KEY가 .env.local에 없습니다. https://opendart.fss.or.kr 에서 발급 후 추가하세요.')
        return

    name = sys.argv[1].strip()
    today = datetime.now()
    print(f'종목분석 시작: {name}')

    corp_map = load_corp_codes()
    corp = find_corp_code(name, corp_map)
    if not corp:
        print(f"[오류] DART 상장사 목록에서 '{name}'을 찾지 못했습니다. 정식 회사명을 확인하세요.")
        return
    print(f"corp_code={corp['corp_code']} stock_code={corp['stock_code']}")

    print('최근 제출 보고서 확인 중...')
    latest_year, latest_code, latest_label = find_latest_report(corp['corp_code'], today)
    if latest_year is None:
        print('[오류] 최근 3년 내 제출된 사업보고서/분기보고서를 찾지 못했습니다.')
        return
    print(f'  → 최신 보고서: {latest_year}년 {latest_label}')

    annual_years, quarter_specs = build_fetch_plan(latest_year, latest_code)
    print(f"연간 재무제표 조회 중... ({', '.join(str(y) for y in annual_years)}년 사업보고서)")
    annual = fetch_annual_financials(corp['corp_code'], annual_years)

    quarters = []
    if quarter_specs:
        labels = ', '.join(f'{y}년 {l}' for y, _, l in quarter_specs)
        print(f'올해 분기/반기 재무제표 조회 중... ({labels})')
        quarters = fetch_quarters(corp['corp_code'], quarter_specs)

    quote = None
    if not KIS_APP_KEY or not KIS_APP_SECRET:
        print('[경고] KIS_APP_KEY/SECRET이 .env.local에 없어 현재가·시가총액 조회를 건너뜁니다.')
    else:
        print('현재가·시가총액·발행주식수 조회 중 (KIS)...')
        try:
            kis_token = get_kis_token()
            quote = fetch_kis_quote(kis_token, corp['stock_code'])
        except Exception as e:
            print(f'[경고] KIS 현재가 조회 실패, quote 없이 진행: {e}')

    result = {
        'name': name,
        'date': today.strftime('%Y-%m-%d'),
        'corp_code': corp['corp_code'],
        'stock_code': corp['stock_code'],
        'latest_report': {'year': latest_year, 'reprt_code': latest_code, 'label': latest_label},
        'quote': quote,
        'annual_financials': annual,
        'quarterly_financials': quarters,
    }

    os.makedirs('종목분석결과', exist_ok=True)
    out_file = os.path.join('종목분석결과', f"{name}_{today.strftime('%Y%m%d')}.json")
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f'\n완료: {out_file} 저장됨')

    mongo_uri = os.getenv('MONGODB_URI')
    if not mongo_uri:
        print('[경고] MONGODB_URI가 .env.local에 없어 MongoDB 저장을 건너뜁니다 (웹앱에는 반영되지 않음).')
    else:
        client = MongoClient(mongo_uri)
        client.get_default_database()['company_analysis'].update_one(
            {'_id': corp['stock_code']}, {'$set': result}, upsert=True)
        client.close()
        print(f"MongoDB 저장 완료: company_analysis/{corp['stock_code']} ({name})")
        print('웹앱 "종목 분석" 탭에서 종목명을 검색하면 표시됩니다.')


if __name__ == '__main__':
    main()
