"""
Claude Code가 생성한 분석 JSON을 MongoDB에 저장하는 스크립트
사용법: python 저장분석.py 분석결과_YYYY-MM-DD.json
       파일명 생략 시 분석결과/ 폴더의 최신 분석결과_*.json 자동 탐색
"""

import os
import sys
import glob
import json
from dotenv import load_dotenv
from pymongo import MongoClient

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')

# DATA_PIPELINE.md의 28개 카테고리 목록과 손으로 동기화해야 함 — 목록을 추가/삭제/이름
# 변경하면 여기도 같이 고쳐야 새로 분류한 정상 데이터가 저장 거부당하지 않음.
VALID_CATEGORIES = {
    '반도체', '반도체장비', '2차전지', '제약/바이오', '조선/해운', '방산/우주항공', '금융/증권', '건설',
    'AI', '로봇', '에너지/신재생', '전력인프라', '화장품', '호텔/유통', '자동차', '지주사',
    '피부/미용', '식품', '패션/의류', 'IT보안', '엔터/게임', '철강',
    '정유/화학', '의료AI', '통신', '디스플레이', '가전', '사료', '기타',
}

# 2026-10-31 개편(30개→28개): 방산·우주항공·항공을 '방산/우주항공' 하나로 통합. 사용자 결정으로
# 2026-10-31 이전에 저장된 ai_analysis·rs_category_cache는 옛 이름 그대로 두고 백필하지 않으므로,
# 그 데이터를 "지금 기준"으로 읽는 곳(rs랭킹.py의 카테고리 맵 → RS랭킹 탭·종목스크리닝)만 이 표로
# 옛 이름을 새 이름으로 바꿔서 쓴다. 새 분석 저장(validate_categories)은 이 옛 이름을 받지 않는다.
LEGACY_CATEGORY_ALIASES = {'방산': '방산/우주항공', '우주항공': '방산/우주항공', '항공': '방산/우주항공'}


def resolve_category(cat, candidate=None):
    """저장된 (카테고리, 신규카테고리후보)를 "지금 기준" 카테고리로 해석해 (카테고리, 후보)로 반환.
    ① 옛 이름(LEGACY_CATEGORY_ALIASES)은 새 이름으로. ② `기타`+후보인데 그 후보가 이제 정식
    카테고리(VALID_CATEGORIES)가 됐으면(예: 2026-10-31 `패션/의류` 신설) 그 카테고리로 — 이미 저장된
    일간 분석을 백필하지 않고도 후보로 쌓아뒀던 종목이 정식 카테고리로 자동 편입된다."""
    cat = LEGACY_CATEGORY_ALIASES.get(cat, cat)
    if cat == '기타' and candidate and candidate != '기타' and candidate in VALID_CATEGORIES:
        return candidate, None
    return cat, candidate


def validate_categories(analysis):
    problems = []
    for key in ('거래대금', '등락률'):
        for i, item in enumerate(analysis.get(key, [])):
            cat = item.get('카테고리')
            name = item.get('종목명', '?')
            if not cat:
                problems.append(f'{key}[{i}] {name}: 카테고리 없음')
            elif cat not in VALID_CATEGORIES:
                problems.append(f'{key}[{i}] {name}: 알 수 없는 카테고리 "{cat}"')
            elif cat != '기타' and item.get('신규카테고리후보'):
                problems.append(f'{key}[{i}] {name}: 카테고리가 "기타"가 아닌데 신규카테고리후보가 있음')
            elif cat == '기타' and item.get('신규카테고리후보') in VALID_CATEGORIES:
                problems.append(f'{key}[{i}] {name}: 신규카테고리후보 "{item["신규카테고리후보"]}"는 이미 정식 카테고리 — 카테고리에 바로 쓸 것')
    return problems


def slim_indices(indices):
    """stock_data.indices에서 분석결과 JSON에 넣을 코스피/코스닥 기본 3개 필드만 추린다
    (trend/signals 같은 추가 계산값은 제외)."""
    slim = {}
    for key in ('kospi', 'kosdaq'):
        item = (indices or {}).get(key)
        if item and item.get('close') is not None:
            slim[key] = {f: round(item[f], 2) for f in ('close', 'change', 'changeRate') if item.get(f) is not None}
    return slim


TOP_RATE_COUNT = 10  # 등락률 상위 몇 위까지 `상승률`을 적을지


def fill_top_rates(analysis, news_data, count=TOP_RATE_COUNT):
    """analysis.등락률 상위 count개 항목에 `상승률`("+18.9%" — 소수점 아래 첫째 자리까지)을
    뉴스데이터의 changeRate로 채운다(종목명 매칭, 종목명 바로 다음 키). 바뀐 게 있으면 True."""
    rate_map = build_change_rate_map(news_data)
    changed = False
    items = analysis.get('등락률', [])
    for i, item in enumerate(items[:count]):
        rate = rate_map.get(item.get('종목명'))
        if rate is None:
            continue
        text = f'{rate:+.1f}%'
        if item.get('상승률') == text:
            continue
        rebuilt = {}
        for k, v in item.items():
            if k != '상승률':
                rebuilt[k] = v
            if k == '종목명':
                rebuilt['상승률'] = text
        if '상승률' not in rebuilt:
            rebuilt['상승률'] = text
        items[i] = rebuilt
        changed = True
    return changed


def sync_json_file(path, data, indices, force=False):
    """분석결과 JSON에 그날의 코스피/코스닥 정보(`indices`, date 바로 다음 키)를 채워 넣고
    (이미 같은 값이면 안 건드림), data가 다른 이유(예: 상승률)로 바뀌었으면(force) 같이 저장한다.
    지수는 stock_data가 원본이라 거기서 가져온다."""
    slim = slim_indices(indices)
    if not force and (not slim or data.get('indices') == slim):
        return
    rest = {k: v for k, v in data.items() if k not in ('date', 'indices')}
    keep = slim or data.get('indices')
    updated = {'date': data['date'], **({'indices': keep} if keep else {}), **rest}
    with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
        json.dump(updated, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'분석결과 JSON 갱신(코스피/코스닥 지수·상승률): {path}')


def find_latest():
    files = glob.glob(os.path.join('분석결과', '분석결과_*.json'))
    if not files:
        raise FileNotFoundError('분석결과/ 폴더에 분석결과_*.json 파일이 없습니다.')
    return max(files, key=os.path.getmtime)


# --- digest 생성 (돈의노래 프로젝트의 scripts/market_digest.py 로직 포팅) ---

TOP_MOVERS_PER_LIST = 6  # 거래대금/등락률 각각에서 가져올 종목 수
MOOD_STRONG = 2.0  # 시장 분위기 분류 임계값(top50 평균 등락률, %)
MOOD_MILD = 0.5


def classify_mood(avg_change_rate, up_ratio):
    if avg_change_rate >= MOOD_STRONG and up_ratio >= 0.6:
        return '급등'
    if avg_change_rate <= -MOOD_STRONG and up_ratio <= 0.4:
        return '급락'
    if avg_change_rate >= MOOD_MILD and up_ratio >= 0.55:
        return '상승'
    if avg_change_rate <= -MOOD_MILD and up_ratio <= 0.45:
        return '하락'
    return '혼조'


def build_change_rate_map(news_data):
    rate_map = {}
    if not news_data:
        return rate_map
    for key in ('vol', 'rate'):
        for item in news_data.get(key, []):
            name = item.get('name')
            change_rate = item.get('changeRate')
            if name and change_rate is not None:
                rate_map[name] = change_rate
    return rate_map


def compute_market_stats(news_data):
    if not news_data or not news_data.get('vol'):
        return None, None
    rates = [item['changeRate'] for item in news_data['vol'] if 'changeRate' in item]
    if not rates:
        return None, None
    avg_change_rate = sum(rates) / len(rates)
    up_ratio = sum(1 for r in rates if r > 0) / len(rates)
    return round(avg_change_rate, 2), round(up_ratio, 2)


def pick_top_movers(analysis, rate_map, count):
    movers = []
    seen = set()
    for list_key in ('거래대금', '등락률'):
        for item in analysis.get(list_key, [])[:count]:
            name = item.get('종목명')
            if not name or name in seen:
                continue
            seen.add(name)
            movers.append({
                '종목명': name,
                '상승원인': item.get('상승원인', ''),
                '카테고리': item.get('카테고리', ''),
                'changeRate': rate_map.get(name),
            })
    return movers


def build_digest(date, analysis):
    news_path = os.path.join('분석결과', f"뉴스데이터_{date.replace('-', '')}.json")
    news_data = None
    if os.path.exists(news_path):
        with open(news_path, 'r', encoding='utf-8') as f:
            news_data = json.load(f)

    rate_map = build_change_rate_map(news_data)
    avg_change_rate, up_ratio = compute_market_stats(news_data)
    mood = classify_mood(avg_change_rate, up_ratio) if avg_change_rate is not None else '정보없음'

    return {
        'date': date,
        'mood': mood,
        'avg_change_rate': avg_change_rate,
        'up_ratio': up_ratio,
        'themes': analysis.get('테마', []),
        'top_movers': pick_top_movers(analysis, rate_map, TOP_MOVERS_PER_LIST),
    }


def save_digest(date, analysis):
    digest = build_digest(date, analysis)
    os.makedirs('digests', exist_ok=True)
    out_path = os.path.join('digests', f'digest_{date}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(digest, f, ensure_ascii=False, indent=2)
    print(f'digest 저장 완료: {out_path}')
    print(f"mood={digest['mood']} avg_change_rate={digest['avg_change_rate']} up_ratio={digest['up_ratio']}")


def main():
    if len(sys.argv) >= 2:
        path = sys.argv[1]
    else:
        path = find_latest()
        print(f'자동 탐색: {path}')


    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    date = data.get('date')
    analysis = data.get('analysis')
    if not date or not analysis:
        print('오류: JSON에 date 또는 analysis 필드가 없습니다.')
        sys.exit(1)

    problems = validate_categories(analysis)
    if problems:
        print('오류: 카테고리 누락/오타가 있어 저장을 중단합니다.')
        for p in problems:
            print(' -', p)
        sys.exit(1)

    news_path = os.path.join('분석결과', f"뉴스데이터_{date.replace('-', '')}.json")
    rates_changed = False
    if os.path.exists(news_path):
        with open(news_path, 'r', encoding='utf-8') as f:
            rates_changed = fill_top_rates(analysis, json.load(f))

    uri = os.getenv('MONGODB_URI')
    if not uri:
        print('오류: MONGODB_URI 환경변수가 없습니다.')
        sys.exit(1)

    client = MongoClient(uri)
    db = client.get_default_database()
    col = db['ai_analysis']
    col.update_one({'_id': date}, {'$set': {'analysis': analysis}}, upsert=True)

    stock_doc = db['stock_data'].find_one({'_id': date}, {'indices': 1})
    indices = stock_doc.get('indices') if stock_doc else None

    client.close()

    print(f'MongoDB 저장 완료: {date}')
    print('웹앱에서 해당 날짜를 로드하면 분석 결과가 자동으로 표시됩니다.')

    save_digest(date, analysis)

    sync_json_file(path, data, indices, force=rates_changed)

    try:
        import 유튜브카드
        유튜브카드.generate_cards(date, analysis, indices=indices)
    except Exception as e:
        print(f'경고: 유튜브 카드(16:9) 생성 실패({e}) — MongoDB 저장/digest는 정상 완료됨.')

    # 일간 쇼츠(9:16) 카드는 자동 생성 안 함(2026-10-03 사용자 요청) — 필요하면 수동으로
    # `python 유튜브카드.py [date] --shorts` 실행.


if __name__ == '__main__':
    main()
