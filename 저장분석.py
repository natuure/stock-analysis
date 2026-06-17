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
