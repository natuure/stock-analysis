"""
DART 공식 Open API + 네이버 뉴스/웹 검색으로 단일 종목 분석용 원자료를 수집하는 스크립트.
사용법: python 종목분석.py "종목명/현재가/시가총액/발행주식수/유통주식수"
       예) python 종목분석.py "인지컨트롤스/6680/1056억/15809197/12237922"

이 스크립트는 "/종목분석" 스킬의 0~1단계(입력 파싱, DART·네이버 데이터 수집)와
2단계(밸류에이션 계산)까지만 자동화한다. 사업의 개요·매출/수주 현황 같은 서술형 본문이나
임원/최대주주 상세, 최종 투자의견·SWOT·.docx 리포트 작성(3~4단계)은 이 결과 JSON을 보고
Claude Code가 직접 작성한다(뉴스분석.py → "분석해줘" → 저장분석.py와 같은 분리 구조).

결과: 종목분석결과/{종목명}_{YYYYMMDD}.json 저장
"""
import os
import re
import io
import sys
import json
import time
import zipfile
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
from dotenv import load_dotenv

load_dotenv('.env.local')

DART_API_KEY = os.getenv('DART_API_KEY')
NAVER_ID     = os.getenv('NAVER_CLIENT_ID')
NAVER_SECRET = os.getenv('NAVER_CLIENT_SECRET')

DART_BASE = 'https://opendart.fss.or.kr/api'
CORP_CODE_CACHE = '_dart_corp_codes.json'  # corpCode.xml은 전체 상장사 목록이라 매번 받지 않고 캐싱

REPRT_CODES = [('11013', '1분기보고서'), ('11012', '반기보고서'), ('11014', '3분기보고서'), ('11011', '사업보고서')]

# DART는 보고서 종류·기업마다 같은 항목을 다른 이름으로 태깅한다(직접 확인함, 2026-06-22):
# 사업보고서(연간)는 '당기순이익', 분기·반기보고서는 회사에 따라 '분기순이익'/'반기순이익'을 씀.
# 지배주주지분도 회사별로 '지배기업소유주지분'(공백 없음)/'지배기업 소유주지분'(공백)/
# '지배기업의 소유주에게 귀속되는 자본' 셋 다 쓰인다 — 후보를 넉넉히 둬야 누락이 줄어든다.
NET_INCOME_NAMES = ['당기순이익', '당기순이익(손실)', '분기순이익', '분기순이익(손실)', '반기순이익', '반기순이익(손실)']
PARENT_EQUITY_NAMES = ['지배기업의 소유주에게 귀속되는 자본', '지배기업소유주지분', '지배기업 소유주지분']


# ── 입력 파싱 ─────────────────────────────────────────────────────────────────

def parse_market_cap(raw):
    """'1056억' / '1조 2000억' 형태를 억원 단위 숫자로 변환."""
    s = raw.strip()
    if '조' in s:
        jo_part, _, eok_part = s.partition('조')
        jo = float(re.sub(r'[^0-9.]', '', jo_part) or 0)
        eok = float(re.sub(r'[^0-9.]', '', eok_part) or 0)
        return jo * 10000 + eok
    return float(re.sub(r'[^0-9.]', '', s) or 0)


def parse_input(raw):
    parts = raw.strip().split('/')
    if len(parts) != 5:
        raise ValueError('입력 형식: 종목명/현재가/시가총액/발행주식수/유통주식수')
    name, price, marcap, shares_total, shares_float = parts
    return {
        'name': name.strip(),
        'price': float(re.sub(r'[^0-9.]', '', price)),
        'market_cap_eok': parse_market_cap(marcap),
        'shares_total': int(re.sub(r'[^0-9]', '', shares_total)),
        'shares_float': int(re.sub(r'[^0-9]', '', shares_float)),
    }


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
    for k, v in corp_map.items():
        if name in k or k in name:
            return v
    return None


# ── DART 데이터 수집 ──────────────────────────────────────────────────────────

def fetch_company_overview(corp_code):
    r = requests.get(f'{DART_BASE}/company.json', params={'crtfc_key': DART_API_KEY, 'corp_code': corp_code}, timeout=10)
    data = r.json()
    return data if data.get('status') == '000' else None


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


def fetch_annual_financials(corp_code, today_year):
    """최근 3개 사업연도 재무제표(사업보고서 기준)."""
    years = {}
    for year in (today_year - 1, today_year - 2, today_year - 3):
        items, fs_div = fetch_financial_statement(corp_code, year, '11011', 'CFS')
        if not items:
            print(f'  {year}년 사업보고서 없음, 건너뜀')
            continue
        years[str(year)] = {
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
            '차입금_추정': extract_account_like(items, '차입금'),
            '감가상각비': extract_account(items, ['감가상각비']),
        }
        time.sleep(0.2)
    return years


REPRT_PERIOD_ORDER = {'11013': 1, '11012': 2, '11014': 3, '11011': 4}  # 1분기<반기<3분기<사업보고서


def fetch_recent_quarters(corp_code, today, count=5):
    """오늘 기준으로 거슬러 올라가며 최근 N개 분기/반기/사업보고서를 찾는다.
    아직 제출 안 된(미래) 보고서는 DART가 빈 응답을 주므로 자연히 건너뛰어진다."""
    candidates = []
    for year in (today.year, today.year - 1, today.year - 2):
        for code, label in REPRT_CODES:
            candidates.append((year, code, label))
    # 분기말 기준 진짜 시간순으로 정렬해야 한다 — 단순히 리스트를 뒤집으면
    # "연도 내림차순 + 분기 오름차순"이 되어 최신 분기가 맨 뒤로 밀리는 버그가 생김.
    candidates.sort(key=lambda c: c[0] * 4 + REPRT_PERIOD_ORDER[c[1]], reverse=True)

    quarters = []
    for year, code, label in candidates:
        if len(quarters) >= count:
            break
        items, fs_div = fetch_financial_statement(corp_code, year, code, 'CFS')
        if not items:
            continue
        quarters.append({
            'year': year, 'reprt_code': code, 'label': label, 'fs_div': fs_div,
            '매출액': extract_account(items, ['매출액', '영업수익']),
            '영업이익': extract_account(items, ['영업이익', '영업이익(손실)']),
            '당기순이익': extract_account(items, NET_INCOME_NAMES),
            '영업활동현금흐름': extract_account(items, ['영업활동현금흐름', '영업활동으로인한현금흐름', '영업활동으로 인한 현금흐름']),
        })
        time.sleep(0.2)
    return quarters


def fetch_recent_disclosures(corp_code, start_date, end_date):
    r = requests.get(f'{DART_BASE}/list.json', params={
        'crtfc_key': DART_API_KEY, 'corp_code': corp_code,
        'bgn_de': start_date, 'end_de': end_date, 'page_count': 30,
    }, timeout=10)
    data = r.json()
    if data.get('status') != '000':
        return []
    return [{
        'rcept_no': d.get('rcept_no'), 'report_nm': d.get('report_nm'),
        'rcept_dt': d.get('rcept_dt'), 'flr_nm': d.get('flr_nm'),
    } for d in data.get('list', [])]


# ── 네이버 검색 (뉴스분석.py와 동일한 호출 방식) ───────────────────────────────

def _naver_search(kind, query, display=10, sort='date'):
    if not NAVER_ID or not NAVER_SECRET:
        return []
    try:
        r = requests.get(
            f'https://openapi.naver.com/v1/search/{kind}.json',
            params={'query': query, 'display': display, 'sort': sort, 'start': 1},
            headers={'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET},
            timeout=10,
        )
        data = r.json()
        return data.get('items', [])
    except Exception as e:
        print(f'  [경고] 네이버 {kind} 검색 실패({query}): {e}')
        return []


def strip_html(s):
    return re.sub(r'<[^>]+>', '', str(s or '')).replace('&quot;', '"').replace('&amp;', '&').strip()


def fetch_news_and_web(name):
    queries_news = [f'{name} 실적 수주 계약', f'{name} 전망 이슈 2026']
    queries_web  = [f'{name} PER PBR ROE 밸류에이션 배당', f'{name} 임원 최대주주 주식보유 경력']
    news = []
    for q in queries_news:
        for item in _naver_search('news', q, display=10):
            news.append({'query': q, 'title': strip_html(item.get('title')), 'description': strip_html(item.get('description')), 'pubDate': item.get('pubDate')})
    web = []
    for q in queries_web:
        for item in _naver_search('webkr', q, display=10):
            web.append({'query': q, 'title': strip_html(item.get('title')), 'description': strip_html(item.get('description'))})
    return news, web


# ── 밸류에이션 계산 ───────────────────────────────────────────────────────────

def compute_ttm_net_income(corp_code, quarters):
    """trailing 12개월 순이익 = 최근 사업보고서(연간) 순이익 - 작년 동기 누적치 + 올해 동기 누적치.
    DART의 분기·반기보고서 손익 계정은 연초부터의 '누적'치라서, 최근 보고서 4개를 그냥
    더하면 사업보고서(12개월) + 3분기(9개월누적) + 반기(6개월누적) + 분기(3개월)처럼 중복
    합산되어 크게 부풀려진다 — 표준 TTM 롤포워드 방식으로 계산해야 함."""
    if not quarters:
        return None
    latest = quarters[0]
    if latest.get('당기순이익') is None:
        return None
    if latest['reprt_code'] == '11011':  # 가장 최근 보고서가 이미 사업보고서면 그 값 자체가 TTM
        return latest['당기순이익']

    fy = next((q for q in quarters if q['reprt_code'] == '11011'), None)
    if not fy or fy.get('당기순이익') is None:
        return None

    prior_items, _ = fetch_financial_statement(corp_code, latest['year'] - 1, latest['reprt_code'], 'CFS')
    prior_ni = extract_account(prior_items, NET_INCOME_NAMES) if prior_items else None
    if prior_ni is None:
        return None
    return fy['당기순이익'] - prior_ni + latest['당기순이익']


def compute_valuation(info, annual, quarters, corp_code):
    latest_year = max(annual.keys()) if annual else None
    latest = annual.get(latest_year, {}) if latest_year else {}

    net_income   = latest.get('당기순이익')
    equity_owner = latest.get('지배기업소유주지분') or latest.get('자본총계')
    op_income    = latest.get('영업이익')
    cash         = latest.get('현금및현금성자산') or 0
    borrowings   = latest.get('차입금_추정') or 0
    dep          = latest.get('감가상각비') or 0

    shares = info['shares_total']
    price  = info['price']
    market_cap_won = info['market_cap_eok'] * 100_000_000

    eps_dart = latest.get('기본주당이익_DART')  # DART가 직접 보고하는 주당이익(가중평균주식수 반영, 더 정확)
    eps = eps_dart if eps_dart else (net_income / shares if net_income and shares else None)
    bps = equity_owner / shares if equity_owner and shares else None
    per = price / eps if eps and eps > 0 else None
    pbr = price / bps if bps and bps > 0 else None
    roe = (net_income / equity_owner * 100) if net_income and equity_owner else None

    ttm_net_income = compute_ttm_net_income(corp_code, quarters)
    ttm_eps = ttm_net_income / shares if ttm_net_income and shares else None

    net_debt = (borrowings - cash) if (borrowings or cash) else None
    ev = market_cap_won + net_debt if net_debt is not None else None
    ebitda = (op_income + dep) if op_income is not None else None
    ev_ebitda = ev / ebitda if ev and ebitda else None

    graham = (22.5 * eps * bps) ** 0.5 if eps and bps and eps > 0 and bps > 0 else None

    return {
        'latest_year': latest_year,
        'EPS': eps, 'BPS': bps, 'PER': per, 'PBR': pbr, 'ROE(%)': roe,
        'TTM_EPS': ttm_eps,
        '순차입금_추정': net_debt, 'EV_추정': ev, 'EBITDA_추정': ebitda, 'EV_EBITDA_추정': ev_ebitda,
        'Graham_Number': graham,
        '참고': 'EV/EBITDA·순차입금·Graham Number는 공개 계정명 매칭 기반 추정치 — '
                '리포트 작성 시 사업보고서 원문으로 교차 확인 권장',
    }


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print('사용법: python 종목분석.py "종목명/현재가/시가총액/발행주식수/유통주식수"')
        print('예시: python 종목분석.py "인지컨트롤스/6680/1056억/15809197/12237922"')
        return
    if not DART_API_KEY:
        print('[오류] DART_API_KEY가 .env.local에 없습니다. https://opendart.fss.or.kr 에서 발급 후 추가하세요.')
        return

    try:
        info = parse_input(sys.argv[1])
    except ValueError as e:
        print(f'[오류] {e}')
        return
    today = datetime.now()
    print(f"종목분석 시작: {info['name']} (현재가 {info['price']:,.0f}원, 시가총액 {info['market_cap_eok']:,.0f}억원)")

    corp_map = load_corp_codes()
    corp = find_corp_code(info['name'], corp_map)
    if not corp:
        print(f"[오류] DART 상장사 목록에서 '{info['name']}'을 찾지 못했습니다. 정식 회사명을 확인하세요.")
        return
    print(f"corp_code={corp['corp_code']} stock_code={corp['stock_code']}")

    print('기업 개요 조회 중...')
    overview = fetch_company_overview(corp['corp_code'])

    print('연간 재무제표(최근 3개년) 조회 중...')
    annual = fetch_annual_financials(corp['corp_code'], today.year)

    print('최근 분기 실적 조회 중...')
    quarters = fetch_recent_quarters(corp['corp_code'], today)

    print('최근 공시 목록 조회 중...')
    start_1y = f'{today.year - 1}{today.strftime("%m%d")}'
    disclosures = fetch_recent_disclosures(corp['corp_code'], start_1y, today.strftime('%Y%m%d'))

    print('네이버 뉴스·웹 검색 중...')
    news, web = fetch_news_and_web(info['name'])

    print('밸류에이션 계산 중...')
    valuation = compute_valuation(info, annual, quarters, corp['corp_code'])

    result = {
        'input': info,
        'date': today.strftime('%Y-%m-%d'),
        'corp_code': corp['corp_code'],
        'stock_code': corp['stock_code'],
        'overview': overview,
        'annual_financials': annual,
        'recent_quarters': quarters,
        'recent_disclosures': disclosures,
        'news': news,
        'web': web,
        'valuation': valuation,
    }

    os.makedirs('종목분석결과', exist_ok=True)
    out_file = os.path.join('종목분석결과', f"{info['name']}_{today.strftime('%Y%m%d')}.json")
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f'\n완료: {out_file} 저장됨')
    print('다음 단계: Claude Code에게 이 JSON을 바탕으로 종목분석 리포트(.docx) 작성을 요청하세요.')
    print('(사업의 개요·매출/수주 현황·임원/최대주주 상세는 이 스크립트가 수집하지 않으므로,')
    print(' 리포트 작성 시 dart-mcp/웹 검색으로 보완이 필요합니다.)')


if __name__ == '__main__':
    main()
