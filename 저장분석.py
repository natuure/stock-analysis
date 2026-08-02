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
    '반도체', '반도체장비', '2차전지', '제약/바이오', '조선/해운', '방산', '금융/증권', '건설',
    'AI', '로봇', '에너지/신재생', '전력인프라', '화장품', '호텔/유통', '자동차', '지주사',
    '우주항공', '피부/미용', '식품', 'IT보안', '엔터/게임', '철강',
    '정유/화학', '의료AI', '항공', '통신', '디스플레이', '가전', '사료', '기타',
}


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
    return problems


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

    try:
        import 유튜브카드
        유튜브카드.generate_cards(date, analysis, indices=indices)
    except Exception as e:
        print(f'경고: 유튜브 카드(16:9) 생성 실패({e}) — MongoDB 저장/digest는 정상 완료됨.')

    try:
        import 유튜브카드
        유튜브카드.generate_shorts_cards(date, analysis, indices=indices)
    except Exception as e:
        print(f'경고: 유튜브 쇼츠 카드(9:16) 생성 실패({e}) — MongoDB 저장/digest는 정상 완료됨.')


if __name__ == '__main__':
    main()
