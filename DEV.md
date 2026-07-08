# 로컬 개발

## 자주 쓰는 명령어

```bash
# 프론트엔드 (React + Vite)
npm install
npm run dev       # Vite 개발 서버 — 프론트엔드만 서빙됨. api/*.js는 응답 안 함
                  # (Vercel CLI 미설치라 vercel dev 불가 — MongoDB/KIS/DART 연동 화면은
                  #  로컬에서 못 띄움, 배포 후 확인하거나 컴포넌트를 임시로 mock 데이터로 띄워 확인)
npm run build     # 프로덕션 빌드 → dist/ (vercel.json buildCommand와 동일)

# 데이터 파이프라인 (Python, 로컬 전용 — Vercel에는 안 올라감)
pip install -r requirements.txt
python 뉴스분석.py            # 장마감 후 실행, 오늘자 KRX 전종목 수집(인자 없음)
python 저장분석.py            # 분석결과/ 최신 JSON 자동 탐색(또는 파일 경로를 인자로 직접 지정)
python 주간분석.py            # 인자 없음, 아무 때나 실행 가능
python 종목분석.py 종목명      # 종목명 인자 필수
python 주도주분석.py [날짜]    # YYYY-MM-DD, 생략 시 오늘
```

> lint·테스트 스크립트는 구성돼 있지 않음(eslint/jest/vitest 등 없음, 테스트 파일도 없음) —
> 검증은 `npm run build` 통과 여부 + `verify`/`run` 스킬로 브라우저 확인.

## 로컬 빌드 환경

```powershell
npm install && npm run build   # 또는 npm run dev
```

이 폴더(`Desktop\Claude\주식\거래대금, 등락률 분석`)는 더 이상 Google Drive와 동기화되지
않아(2026-06-29), `node_modules`를 직접 여기에 설치해도 `.bin/` 심링크가 깨지지 않는다 —
별도 폴더에 복사해 빌드 확인하던 우회 절차는 더 이상 필요 없음.

배포는 이 폴더에서 바로 `git push` → Vercel 자동 빌드.
