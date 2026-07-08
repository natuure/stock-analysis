"""
KIS(한국투자증권) Open API 인증·호출 테스트 스크립트
사용법: python kis_test.py
  - 접근토큰 발급(oauth2/tokenP) → 삼성전자(005930) 현재가 조회(FHKST01010100) 순서로 호출
  - 로컬에서 먼저 성공 확인 후, 같은 코드를 Vercel API 라우트로 옮겨 IP 제한 여부를 검증할 예정
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv('.env.local')

KIS_APP_KEY    = os.getenv('KIS_APP_KEY')
KIS_APP_SECRET = os.getenv('KIS_APP_SECRET')
KIS_BASE = 'https://openapi.koreainvestment.com:9443'  # 실전투자


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


def fetch_quote(token, code):
    r = requests.get(f'{KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price', headers={
        'Content-Type': 'application/json; charset=UTF-8',
        'authorization': f'Bearer {token}',
        'appkey': KIS_APP_KEY,
        'appsecret': KIS_APP_SECRET,
        'tr_id': 'FHKST01010100',
        'custtype': 'P',
    }, params={
        'FID_COND_MRKT_DIV_CODE': 'J',
        'FID_INPUT_ISCD': code,
    }, timeout=10)
    r.raise_for_status()
    return r.json()


if __name__ == '__main__':
    if not KIS_APP_KEY or not KIS_APP_SECRET:
        print('[오류] .env.local에 KIS_APP_KEY/KIS_APP_SECRET을 입력하세요.')
        raise SystemExit(1)

    print('[1/2] 접근토큰 발급 중...')
    token = get_kis_token()
    print(f'  → 토큰 발급 성공: {token[:20]}...')

    print('[2/2] 삼성전자(005930) 현재가 조회 중...')
    result = fetch_quote(token, '005930')
    output = result.get('output', {})
    print(f"  → rt_cd={result.get('rt_cd')} msg={result.get('msg1')}")
    print(f"  → 현재가={output.get('stck_prpr')} 전일대비={output.get('prdy_vrss')} 등락률={output.get('prdy_ctrt')}%")
