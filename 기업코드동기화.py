"""
DART corp_code 매핑 1회성/재사용 마이그레이션: 로컬 _dart_corp_codes.json -> MongoDB
dart_corp_codes 컬렉션. api/analyzeCompany.js(JS, Vercel)가 이 컬렉션을 읽어서 종목명으로
corp_code를 찾는다 — Vercel 서버리스 환경엔 영속 파일시스템이 없어 종목분석.py처럼 로컬
JSON 캐시 파일을 그대로 못 쓰기 때문(2026-06-27).

사용법: python 기업코드동기화.py
재실행해도 안전(upsert) — 로컬 _dart_corp_codes.json을 다시 받거나(종목분석.py의
load_corp_codes()가 자동으로 갱신하지는 않으므로 파일을 지우고 한 번 실행해 새로 받은 뒤)
이 스크립트를 다시 실행하면 신규 상장사가 반영된다. 단, 이미 떠 있는 Vercel warm 람다
인스턴스는 다음 콜드스타트 전까지 이전 캐시를 들고 있을 수 있음 — 즉시 반영을 원하면
재배포(redeploy) 권장.
"""
import json
import os
import sys
from dotenv import load_dotenv
from pymongo import MongoClient

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')

with open('_dart_corp_codes.json', encoding='utf-8') as f:
    mapping = json.load(f)

uri = os.getenv('MONGODB_URI')
if not uri:
    print('[오류] MONGODB_URI가 .env.local에 없습니다.')
else:
    client = MongoClient(uri)
    client.get_default_database()['dart_corp_codes'].update_one(
        {'_id': 'map'}, {'$set': {'data': mapping}}, upsert=True)
    client.close()
    print(f'완료: dart_corp_codes/map에 {len(mapping)}개 기업 매핑 저장됨')
