"""
뉴스분석.py가 그날 저장한 거래대금/등락률 상위 50종목(합쳐서 중복 제거하면 최대 100개)을
종목분석.py로 일괄 분석한다. 이미 분석돼 있고 DART 최신 보고서까지 반영돼 있으면 건너뛰고,
그 사이 새 분기/반기/사업보고서가 올라온 종목만 재분석해 최신화한다.
사용법: python 주도주분석.py [YYYY-MM-DD]  (날짜 생략 시 오늘)
"""
import os
import re
import sys
from datetime import datetime
from dotenv import load_dotenv
from pymongo import MongoClient

import 종목분석

load_dotenv('.env.local')


# 우선주 표기 접미사(...우, ...우B, ...2우B 등) — 코드 매칭이 안 될 때 떼고 다시 찾아보는
# 용도. DART corpCode.xml은 발행회사 단위라 우선주 티커를 따로 안 줌(직접 확인).
def strip_preferred_suffix(name):
    return re.sub(r'\d*우[A-Z]?$', '', name)


def resolve_corp(name, code, corp_map, code_to_corp):
    """뉴스분석.py가 이미 알고 있는 정확한 KRX 코드로 corp_code를 역매핑한다(이름 기반
    퍼지매칭보다 정확함 — "현대차" 같은 약식 종목명은 DART 정식명("현대자동차")과 전혀
    안 겹쳐 퍼지매칭도 실패하지만, 코드로는 정확히 찾아짐, 직접 확인). 코드로 못 찾으면
    우선주일 가능성을 보고 접미사를 뗀 이름의 **정확 일치만** 한 번 더 시도한다 —
    `find_corp_code()`의 부분일치 폴백은 여기서 쓰지 않음: 직접 테스트해보니 "현대차2우B"를
    "현대차"로 떼어낸 뒤 부분일치를 타면 무관한 "현대차증권"에 잘못 매칭됐다("현대차"가
    "현대차증권"의 부분문자열이라서) — sk하이닉스/이닉스 사고와 같은 패턴. 정확 일치만
    허용해 잘못된 회사로 매칭될 위험을 없애는 대신, "현대차2우B"처럼 약식명이 정식명과
    전혀 안 겹치는 경우는 못 찾고 건너뜀(받아들이는 한계)."""
    corp = code_to_corp.get(code)
    if corp:
        return corp
    stripped = strip_preferred_suffix(name)
    if stripped != name and stripped in corp_map:
        return corp_map[stripped]
    return None


def main():
    date_str = sys.argv[1] if len(sys.argv) >= 2 else datetime.now().strftime('%Y-%m-%d')
    mongo_uri = os.getenv('MONGODB_URI')
    if not mongo_uri:
        print('[오류] MONGODB_URI가 .env.local에 없습니다.')
        return

    client = MongoClient(mongo_uri)
    db = client.get_default_database()
    doc = db['stock_data'].find_one({'_id': date_str})
    if not doc:
        print(f'[오류] stock_data에 {date_str} 데이터가 없습니다. 먼저 뉴스분석.py를 실행하세요.')
        client.close()
        return

    candidates = {}  # code -> name, vol+rate 합쳐서 code 기준 중복 제거(최대 100개)
    for s in (doc.get('vol') or []) + (doc.get('rate') or []):
        candidates[s['code']] = s['name']
    print(f'{date_str} 거래대금·등락률 상위 종목 {len(candidates)}개(중복 제거) 확인')

    corp_map = 종목분석.load_corp_codes()
    code_to_corp = {v['stock_code']: v for v in corp_map.values()}

    kis_token = None
    try:
        kis_token = 종목분석.get_kis_token()
    except Exception as e:
        print(f'[경고] KIS 토큰 발급 실패, 이번 배치는 현재가 없이 진행: {e}')

    today = datetime.now()
    company_col = db['company_analysis']
    analyzed = skipped = failed = 0

    for code, name in candidates.items():
        corp = resolve_corp(name, code, corp_map, code_to_corp)
        if not corp:
            print(f'  [건너뜀] {name}({code}): DART corp_code를 찾지 못함')
            failed += 1
            continue

        try:
            latest_year, latest_code, latest_label = 종목분석.find_latest_report(corp['corp_code'], today)
        except Exception as e:
            print(f'  [건너뜀] {name}: 최신 보고서 조회 실패 — {e}')
            failed += 1
            continue
        if latest_year is None:
            print(f'  [건너뜀] {name}: 최근 3년 내 제출된 보고서 없음')
            failed += 1
            continue

        existing = company_col.find_one({'_id': corp['stock_code']}, {'latest_report': 1})
        if existing and existing.get('latest_report') == {
            'year': latest_year, 'reprt_code': latest_code, 'label': latest_label
        }:
            print(f'  [스킵] {name}: 이미 최신 보고서({latest_year}년 {latest_label})까지 분석돼 있음')
            skipped += 1
            continue

        print(f'  [분석] {name}: 최신 보고서 {latest_year}년 {latest_label} 확인됨, 재분석 진행')
        try:
            종목분석.analyze_one(name, corp, latest_year, latest_code, latest_label, kis_token=kis_token)
            analyzed += 1
        except Exception as e:
            print(f'  [실패] {name} 분석 중 오류: {e}')
            failed += 1

    client.close()
    print(f'\n완료: 분석 {analyzed}건 / 이미 최신이라 스킵 {skipped}건 / 실패·건너뜀 {failed}건')


if __name__ == '__main__':
    main()
