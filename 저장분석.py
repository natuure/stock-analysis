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

load_dotenv('.env.local')

# DATA_PIPELINE.md의 15개 카테고리 목록과 손으로 동기화해야 함 — 목록을 추가/삭제/이름
# 변경하면 여기도 같이 고쳐야 새로 분류한 정상 데이터가 저장 거부당하지 않음.
VALID_CATEGORIES = {
    '반도체', '반도체장비', '2차전지', '바이오/제약', '조선', '방산', '금융/증권', '건설/건자재',
    'AI/로봇', '에너지/신재생', '전력/전선인프라', '화장품/유통', '자동차', '지주사/지분가치재평가',
    '기타',
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
    col = client.get_default_database()['ai_analysis']
    col.update_one({'_id': date}, {'$set': {'analysis': analysis}}, upsert=True)
    client.close()

    print(f'MongoDB 저장 완료: {date}')
    print('웹앱에서 해당 날짜를 로드하면 분석 결과가 자동으로 표시됩니다.')


if __name__ == '__main__':
    main()
