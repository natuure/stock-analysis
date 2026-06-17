"""
Claude Code가 생성한 분석 JSON을 MongoDB에 저장하는 스크립트
사용법: python 저장분석.py 분석결과_YYYYMMDD.json
"""

import os
import sys
import json
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('.env.local')


def main():
    if len(sys.argv) < 2:
        print('사용법: python 저장분석.py 분석결과_YYYYMMDD.json')
        sys.exit(1)

    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    date = data.get('date')
    analysis = data.get('analysis')
    if not date or not analysis:
        print('오류: JSON에 date 또는 analysis 필드가 없습니다.')
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
