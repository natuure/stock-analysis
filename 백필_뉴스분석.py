"""
백필된 거래일(stock_data.backfilled=true)의 등락률 상위 50종목에 대해
뉴스분석.py의 뉴스 수집(fetch_news)을 재사용해 과거 날짜 기준 뉴스를 모은다.

배경: 백필_거래대금등락률.py로 2026-01-02~2026-06-14(실데이터 시작 전날)의 거래대금/등락률
상위 50을 MongoDB에 채워 넣었다. 이 스크립트는 그 등락률(rate) 리스트를 대상으로
뉴스분석.py.fetch_news(name, date)를 그대로 호출해 종목명_날짜 조합별 뉴스를 모은다.
fetch_news는 "오늘"과 file_date의 차이가 3일 이상이면 이미 자체적으로
file_date ~ file_date+3일 범위로 뉴스를 제한한다(뉴스분석.py 참고) — 백필 대상 날짜는
전부 오늘(2026-07-08)보다 훨씬 과거라 이 조건에 항상 해당하므로 별도 수정 없이 그대로 쓴다.

규모: 108일 x 50종목 x 쿼리 8개 ≈ 43,200회 네이버 API 호출 — 하루 쿼터를 넘을 가능성이 높아
(date, name) 쌍 단위로 진행 상황을 로컬에 체크포인트하고, 할당량 소진으로 보이면 저장 후
멈춘다. 같은 명령을 다시 실행하면 이어서 진행된다.

사용법:
  python 백필_뉴스분석.py --dry-run           # 네이버 호출 없이 계획만 출력
  python 백필_뉴스분석.py --limit 5           # 실제 호출을 5쌍으로 제한(스모크 테스트)
  python 백필_뉴스분석.py                     # 전체 실행(할당량 소진 시 자동 중단, 재실행하면 이어짐)
  python 백필_뉴스분석.py --finalize-only     # 캐시엔 있는데 파일이 안 써진 날짜만 파일로 재생성
"""

import os
import sys
import json
import time
import argparse

from pymongo import MongoClient

import 뉴스분석  # fetch_news/_call_naver/NEWS_QUERIES/NAVER_ID/NAVER_SECRET/MONGODB_URI 재사용 (주간분석.py와 동일한 선례)

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

CACHE_PATH = os.path.join('백필작업', '뉴스분석_캐시.json')
CONSECUTIVE_FAILURE_THRESHOLD = 20


def get_backfilled_dates(start=None, end=None):
    """stock_data에서 backfilled=true인 문서를 날짜 오름차순으로, {date: rate_list} 형태로 반환."""
    if not 뉴스분석.MONGODB_URI:
        print('오류: MONGODB_URI 없음')
        sys.exit(1)
    client = MongoClient(뉴스분석.MONGODB_URI)
    col = client.get_default_database()['stock_data']
    query = {'backfilled': True}
    if start or end:
        rng = {}
        if start:
            rng['$gte'] = start
        if end:
            rng['$lte'] = end
        query['_id'] = rng
    docs = list(col.find(query, {'rate': 1}).sort('_id', 1))
    client.close()
    result = {}
    for d in docs:
        rate = d.get('rate') or []
        if rate:
            result[d['_id']] = rate
        else:
            print(f'[경고] {d["_id"]}: rate 없음 — 건너뜀')
    return result


def build_worklist(dates_and_rates):
    """{date: rate_list} -> (pairs=[(date,name),...] 전체 순서, expected_names_by_date, full_rate_by_date)"""
    pairs = []
    expected_names_by_date = {}
    for date in sorted(dates_and_rates.keys()):
        rate = dates_and_rates[date]
        names = [it['name'] for it in rate]
        expected_names_by_date[date] = names
        for name in names:
            pairs.append((date, name))
    return pairs, expected_names_by_date, dates_and_rates


def load_cache():
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    tmp_path = CACHE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False)
    os.replace(tmp_path, CACHE_PATH)


def is_date_complete(date, cache, expected_names_by_date):
    done = set(cache.get(date, {}).keys())
    return set(expected_names_by_date[date]) <= done


def write_date_output(date, cache, full_rate_by_date):
    os.makedirs('분석결과', exist_ok=True)
    out_file = os.path.join('분석결과', f'뉴스데이터_{date.replace("-", "")}.json')
    output = {
        'date': date,
        'vol': [],  # 이번 백필 범위는 등락률(rate)만 — 거래대금은 범위 밖
        'rate': full_rate_by_date[date],
        'news': cache.get(date, {}),
        'backfilled': True,
    }
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    return out_file


def install_quota_guard(state, threshold=CONSECUTIVE_FAILURE_THRESHOLD):
    """뉴스분석._call_naver를 감시용 래퍼로 교체한다. fetch_news는 모듈 전역을 호출 시점에
    다시 참조하므로 이 몽키패치가 그대로 반영된다."""
    import requests

    def guarded_call_naver(query):
        url = 'https://openapi.naver.com/v1/search/news.json'
        params = {'query': query, 'display': 20, 'sort': 'date', 'start': 1}
        headers = {
            'X-Naver-Client-Id': 뉴스분석.NAVER_ID,
            'X-Naver-Client-Secret': 뉴스분석.NAVER_SECRET,
        }
        try:
            r = requests.get(url, params=params, headers=headers, timeout=6)
        except requests.exceptions.RequestException as e:
            state['consecutive_failures'] += 1
            _maybe_trip(state, threshold, f'네트워크 오류: {e}')
            return []

        if r.status_code == 429:
            state['quota_exceeded'] = True
            state['reason'] = 'HTTP 429 (Too Many Requests) — 할당량 초과'
            return []
        if r.status_code != 200:
            state['consecutive_failures'] += 1
            _maybe_trip(state, threshold, f'HTTP {r.status_code}')
            return []

        try:
            body = r.json()
        except ValueError:
            state['consecutive_failures'] += 1
            _maybe_trip(state, threshold, 'JSON 파싱 실패')
            return []

        err_code = body.get('errorCode') or body.get('error', {}).get('errorCode') if isinstance(body.get('error'), dict) else body.get('errorCode')
        err_msg = str(body.get('errorMessage', '')) + str(body.get('error', ''))
        if err_code or any(k in err_msg.lower() for k in ['limit', 'quota']) or '초과' in err_msg:
            state['quota_exceeded'] = True
            state['reason'] = f'응답 본문에 오류 표시: {err_code or err_msg}'
            return []

        state['consecutive_failures'] = 0
        return body.get('items', [])

    def _maybe_trip(state, threshold, reason):
        if state['consecutive_failures'] >= threshold:
            state['quota_exceeded'] = True
            state['reason'] = f'연속 {threshold}회 호출 실패 — 할당량 소진 추정 (마지막 사유: {reason})'

    뉴스분석._call_naver = guarded_call_naver


def print_status(pairs, cache, expected_names_by_date, prefix=''):
    total = len(pairs)
    done = sum(1 for d, n in pairs if n in cache.get(d, {}))
    dates = sorted(expected_names_by_date.keys())
    complete_dates = [d for d in dates if is_date_complete(d, cache, expected_names_by_date)]
    next_incomplete = next((d for d in dates if d not in complete_dates), None)
    print(f'{prefix}전체 {total}개 (date,name) 쌍 중 {done}개 완료 / 날짜 {len(dates)}개 중 {len(complete_dates)}개 완료')
    if next_incomplete:
        nd = sum(1 for n in expected_names_by_date[next_incomplete] if n in cache.get(next_incomplete, {}))
        print(f'{prefix}다음 미완료 날짜: {next_incomplete} ({nd}/{len(expected_names_by_date[next_incomplete])} 완료)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default=None)
    ap.add_argument('--end', default=None)
    ap.add_argument('--limit', type=int, default=None, help='이번 실행에서 실제로 처리할 (date,name) 쌍 수 제한')
    ap.add_argument('--dry-run', action='store_true', help='네이버 호출 없이 계획만 출력')
    ap.add_argument('--finalize-only', action='store_true', help='캐시엔 완료됐는데 파일이 없는 날짜만 파일로 재생성')
    args = ap.parse_args()

    if not 뉴스분석.NAVER_ID or not 뉴스분석.NAVER_SECRET:
        print('오류: NAVER_CLIENT_ID/SECRET 없음 — .env.local 확인 필요')
        sys.exit(1)

    dates_and_rates = get_backfilled_dates(args.start, args.end)
    if not dates_and_rates:
        print('backfilled=true 문서가 없습니다(범위 확인 필요).')
        return
    pairs, expected_names_by_date, full_rate_by_date = build_worklist(dates_and_rates)
    cache = load_cache()

    if args.dry_run:
        print_status(pairs, cache, expected_names_by_date, prefix='[dry-run] ')
        pending = [p for p in pairs if p[1] not in cache.get(p[0], {})]
        print(f'[dry-run] 미완료 {len(pending)}개 쌍 — 쿼리 8개 기준 예상 네이버 호출 수: 약 {len(pending) * 8}회')
        print('[dry-run] 미리보기(최대 10개):', pending[:10])
        return

    if args.finalize_only:
        written = 0
        for date in expected_names_by_date:
            if is_date_complete(date, cache, expected_names_by_date):
                out_file = os.path.join('분석결과', f'뉴스데이터_{date.replace("-", "")}.json')
                if not os.path.exists(out_file):
                    write_date_output(date, cache, full_rate_by_date)
                    written += 1
        print(f'{written}개 날짜 파일을 재생성했습니다.')
        return

    print_status(pairs, cache, expected_names_by_date, prefix='[시작] ')

    state = {'quota_exceeded': False, 'reason': None, 'consecutive_failures': 0}
    install_quota_guard(state)

    pending = [p for p in pairs if p[1] not in cache.get(p[0], {})]
    if args.limit:
        pending = pending[:args.limit]

    processed = 0
    try:
        for i, (date, name) in enumerate(pending, 1):
            news = 뉴스분석.fetch_news(name, date)
            cache.setdefault(date, {})[name] = news
            processed += 1
            print(f'  [{i}/{len(pending)}] {date} {name} → {len(news)}건')

            if processed % 10 == 0:
                save_cache(cache)

            if is_date_complete(date, cache, expected_names_by_date):
                out_file = write_date_output(date, cache, full_rate_by_date)
                print(f'    → {date} 완료, {out_file} 저장')

            if state['quota_exceeded']:
                print(f'\n[중단] {state["reason"]}')
                break

            time.sleep(0.1)
    finally:
        save_cache(cache)
        print(f'\n이번 실행에서 처리: {processed}개 쌍')
        print_status(pairs, cache, expected_names_by_date, prefix='[종료 시점] ')
        if state['quota_exceeded']:
            print('재실행하면 체크포인트에서 자동으로 이어서 진행됩니다: python 백필_뉴스분석.py')


if __name__ == '__main__':
    main()
