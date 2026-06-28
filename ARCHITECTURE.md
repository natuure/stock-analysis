# 아키텍처 — 배포·파일 구조·DB·API

## 배포 아키텍처

```
Frontend (React + Vite → Vercel)     Backend (Vercel Serverless)     DB
────────────────────────────────     ──────────────────────────      ──────────────────
src/                                 api/getData.js                  MongoDB Atlas
  App.jsx                              stock_data 조회 (날짜별)        stock_data 컬렉션
  components/                        api/getAnalysis.js                _id = "YYYY-MM-DD"
    Header, Calendar                   ai_analysis 조회                ai_analysis 컬렉션
    Tables, Analysis                 api/analyzeStocks.js               _id = "YYYY-MM-DD"
    StockChartPanel                    Claude API 프록시 (미사용)       candles 컬렉션 (토스 캔들 캐시·폴백용)
    StockAnalysis                     api/candles.js                     _id = "종목코드_YYYY-MM-DD"
    CompanyOverviewView                 KIS Open API 직접 호출(실시간)  kis_token 컬렉션 (KIS 접근토큰 캐시)
  utils.js                              → 실패 시에만 candles 캐시 폴백   _id = "token"
  styles.css                          api/getCompanyOverview.js        weekly_indices 컬렉션
                                         company_analysis 조회             _id = "YYYY-W##"
                                         (목록/종목코드별 단건) +        company_analysis 컬렉션
                                         KIS로 현재가 실시간 덮어씀         _id = "종목코드"
                                         (실패 시에만 저장된 quote 폴백)
                                     api/analyzeCompany.js            dart_corp_codes 컬렉션
                                       DART+KIS 즉석 분석                _id = "map"
                                       (Claude 미사용) → company_analysis
                                       저장(없던 종목이면 신규)
                                       api/_kis.js (candles.js·
                                         getCompanyOverview.js·
                                         analyzeCompany.js 공용
                                         KIS 토큰·현재가, 라우트 아님)
                                       api/_dart.js (analyzeCompany.js
                                         전용, DART 추출·corp_code
                                         조회, 라우트 아님)

Python (로컬 실행, 고정 IP)
  뉴스분석.py   ← FinanceDataReader 수집 + 토스 캔들 캐싱(폴백용) + Naver 뉴스 수집 + stock_data 저장
  저장분석.py   ← ai_analysis 저장
  주간분석.py   ← 코스피/코스닥 주간 변동률 + 주간 거래대금/등락률 상위 50(뉴스분석.py 임포트해
                  KIS 통합 보강 재사용, 2026-06-27) 계산 + weekly_indices 저장 (메인 흐름과 독립)
  종목분석.py   ← DART로 단일 종목 재무제표 수집 + MongoDB company_analysis 저장
                  (웹앱 "종목 분석" 탭 검색용, DATA_PIPELINE.md 참고 — 2026-06-27부터는
                  수동 실행 없이도 웹에서 미분석 종목을 즉석 분석 가능, api/analyzeCompany.js)
  기업코드동기화.py ← 로컬 _dart_corp_codes.json → MongoDB dart_corp_codes 매핑(1회성/재사용)
  주도주분석.py ← 뉴스분석.py 다음 실행, 그날 거래대금·등락률 상위 종목(최대 100개)을
                  종목분석.py의 analyze_one()으로 일괄 분석(이미 DART 최신 보고서까지
                  반영돼 있으면 스킵, 2026-06-27)
```

- **GitHub 저장소**: https://github.com/natuure/stock-analysis.git
- **Vercel 자동 배포**: master 브랜치 push → 자동 빌드·배포
- **Vercel 환경변수**: `MONGODB_URI`, `ANTHROPIC_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `KIS_APP_KEY`, `KIS_APP_SECRET`
- `TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET`는 **로컬 `.env.local`에만** 필요 (Vercel은 토스 API를 호출하지 않으므로 Vercel 환경변수 등록은 불필요, 등록해 둬도 무해함)
- `KIS_APP_KEY`/`KIS_APP_SECRET`는 **로컬 + Vercel(Production·Preview) 모두 필요** — KIS는 IP 제한이 없어 `api/candles.js`·`api/getCompanyOverview.js`가 Vercel에서 직접 호출함 (2026-06-20 확인, 2026-06-25 getCompanyOverview.js 추가)

---

## 파일 구조

```
/
├── api/
│   ├── getData.js              # GET ?date= → stock_data 조회 / ?week= → weekly_indices 조회
│   │                             (vol/rate 포함) / 둘 다 없음 → 날짜 목록 + weeklyIndices 반환
│   ├── getAnalysis.js          # GET ?date= → ai_analysis 조회
│   ├── analyzeStocks.js        # Claude API 프록시 (현재 미사용)
│   ├── candles.js              # GET ?symbol=&date= → KIS Open API 직접 호출(실시간), 실패 시 candles 캐시 폴백
│   ├── getCompanyOverview.js   # GET (code 없음) → 분석된 종목 목록 / GET ?code= → company_analysis 조회 +
│   │                             KIS로 현재가 실시간 덮어씀(실패 시에만 저장된 quote 폴백)
│   ├── analyzeCompany.js       # GET ?name=종목명 → 미분석 종목을 DART+KIS로 즉석 분석해 company_analysis에
│   │                             저장 후 반환(2026-06-27, Claude 미사용 — 종목분석.py의 JS 포팅)
│   ├── getThemeTrend.js        # GET ?days=(기본 14) → ai_analysis에서 최근 N일 거래대금·등락률 배열만
│   │                             프로젝션해 반환(2026-06-28부터 테마 대신 거래대금/등락률 — "거래대금·
│   │                             등락률 카테고리 TOP5 추이" 표 2개용)
│   ├── _kis.js                 # KIS 접근토큰 발급·캐싱 + fetchLiveQuote(현재가 조회) 공용 모듈(라우트 아님,
│   │                             candles.js·getCompanyOverview.js·analyzeCompany.js가 import)
│   └── _dart.js                # DART 재무제표 추출·corp_code 조회 공용 모듈(라우트 아님, analyzeCompany.js가
│                                  import, 종목분석.py 핵심 로직의 1:1 JS 포팅, 2026-06-27)
├── src/
│   ├── main.jsx
│   ├── App.jsx              # 상태 관리 (Tables에 dateISO 전달 — 차트 패널은 각 표 내부에서 자체 관리)
│   ├── api.js               # 비어있음 (fetchSectors 제거됨)
│   ├── utils.js             # normVol, normRate, 날짜 유틸
│   ├── styles.css
│   └── components/
│       ├── Header.jsx
│       ├── Calendar.jsx     # serverDates prop 추가 (MongoDB 날짜 표시), 주차(W##) 칸
│       ├── Tables.jsx       # 거래대금·등락률 테이블, 행 클릭 시 그 표 내부에서 차트 패널을 인라인으로 펼침/접음(독립 상태)
│       ├── StockChartPanel.jsx  # 종목 클릭 시 표 행 아래에 인라인으로 펼치는 일봉/주봉 캔들 차트 패널(모달 아님)
│       ├── Analysis.jsx     # ThemeTable + ThemeCategoryTrend(최근 14일 카테고리 추이) + AiPanels + N파일
│       ├── StockAnalysis.jsx  # "종목 분석" 탭 — 종목명 검색(자동완성)창 + 기업개요/재무상태표/손익계산서/현금흐름표 4버튼
│       ├── CompanyOverviewView.jsx  # 기업개요 — PER/PBR/ROE/EV·EBITDA + 적정주가 슬라이더 4종 (data prop으로 받음)
│       └── TrendChart.jsx   # 의존성 없는 SVG 추이 차트(막대/꺾은선), StockAnalysis.jsx·Analysis.jsx 공용
├── 뉴스분석.py              # FinanceDataReader 수집 + Naver 뉴스 + stock_data 저장
├── 저장분석.py              # ai_analysis MongoDB 저장
├── 주간분석.py              # 코스피/코스닥 주간 변동률 + 주간 거래대금/등락률 상위 50 → weekly_indices 저장
├── 종목분석.py              # DART로 단일 종목 재무제표 수집 → 종목분석결과/*.json (gitignore) + MongoDB company_analysis 저장
│                             (analyze_one()은 주도주분석.py가 일괄 호출용으로 재사용, 2026-06-27)
├── 주도주분석.py            # 그날 거래대금·등락률 상위 종목(최대 100개, 중복 제거)을 종목분석.py로
│                             일괄 분석 — DART 최신 보고서까지 반영돼 있으면 스킵(2026-06-27)
├── 기업코드동기화.py        # 로컬 _dart_corp_codes.json → MongoDB dart_corp_codes 1회성/재사용 마이그레이션
│                             (api/analyzeCompany.js가 Vercel에서 읽는 corp_code 매핑, 2026-06-27)
├── requirements.txt         # pandas, finance-datareader, requests, pymongo[srv], python-dotenv
├── AI검색.md                # Naver API 쿼리 패턴 가이드
├── 데일리분석/              # (과거 HTS 엑셀 보관 폴더, 더 이상 스크립트가 사용하지 않음, gitignore 유지)
├── 분석결과/                # 뉴스데이터_*.json, 분석결과_*.json (gitignore)
├── index.html
├── vite.config.js
├── package.json
├── vercel.json
├── .env.local               # MONGODB_URI, ANTHROPIC_API_KEY, NAVER_*, TOSS_*, KIS_*, DART_API_KEY (git 제외)
└── .gitignore               # .env.local, node_modules/, dist/, .vercel/, 데일리분석/, 분석결과/, 종목분석결과/, *.xlsx, *.xls
```

---

## MongoDB 컬렉션 (현재)

| 컬렉션 | 용도 | 구조 |
|--------|------|------|
| `stock_data` | 일별 종목 데이터 | `{ _id: "YYYY-MM-DD", vol: [...], rate: [...], date: "2026년 6월 17일 (화)", indices: {...} }` |
| `ai_analysis` | AI 분석 결과 | `{ _id: "YYYY-MM-DD", analysis: { 테마:[...], 거래대금:[...], 등락률:[...] } }` — `테마` 배열 각 항목에 2026-06-25부터 `카테고리`(고정 13개 값 중 하나, 일자 간 추이 집계용) 필드 추가, [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고 |
| `candles` | 종목별 토스 일봉 캔들 캐시 (KIS 실패 시 폴백용) | `{ _id: "종목코드_YYYY-MM-DD", candles: [...] }` (해당일 거래대금/등락률 상위 종목만) |
| `kis_token` | KIS 접근토큰 캐시 (1분당 1회 발급 제한 대응) | `{ _id: "token", accessToken, expiresAt }` 단일 문서 |
| `weekly_indices` | 주간 코스피/코스닥 변동률 + 주간 거래대금/등락률 상위 50(주간분석.py가 채움, vol/rate/lastTradingDate는 2026-06-27 추가라 그 이전 주차에는 없을 수 있음) | `{ _id: "YYYY-W##", kospi: {...}, kosdaq: {...}, vol: [...50], rate: [...50], lastTradingDate: "YYYY-MM-DD" }` |
| `company_analysis` | 종목별 DART 재무제표 + KIS 현재가 (종목분석.py 수동 실행, `주도주분석.py` 일괄 실행, **또는** `api/analyzeCompany.js` 즉석분석이 채움, "종목 분석" 탭용). **`quote`는 채워진 시점에 박힌 값이라 폴백 전용** — 실제 화면에는 `api/getCompanyOverview.js`가 조회 시점에 KIS로 새로 받아온 현재가가 표시됨(2026-06-25) | `{ _id: "종목코드", name, date, corp_code, quote, annual_financials, quarterly_financials, latest_report }` |
| `dart_corp_codes` | DART 상장기업 corp_code 매핑(`기업코드동기화.py`가 로컬 `_dart_corp_codes.json`을 1회 옮김, `api/analyzeCompany.js`가 종목명→corp_code 조회에 사용 — Vercel엔 영속 파일시스템이 없어 로컬 JSON 캐싱 패턴을 못 씀, 2026-06-27) | `{ _id: "map", data: { "회사명": { corp_code, stock_code }, ... } }` 단일 문서 |

> ⚠️ `wics_cache` 컬렉션은 삭제됨 (WICS 업종 분류 기능 제거)

---

## API 엔드포인트

| 엔드포인트 | 메서드 | 용도 |
|-----------|--------|------|
| `/api/getData` | GET | date/week 둘 다 없음: 날짜 목록 + weeklyIndices(주차별 kospi/kosdaq/lastTradingDate만, 가벼운 요약) 반환 / date 있음: 해당일 vol+rate+indices 반환 / week 있음: 그 주차의 kospi+kosdaq+vol+rate+lastTradingDate 전체 반환(2026-06-27 추가) |
| `/api/getAnalysis` | GET | `?date=YYYY-MM-DD` → ai_analysis 반환 |
| `/api/getThemeTrend` | GET | `?days=`(기본 14, 최대 90) → ai_analysis에서 최근 N일의 `거래대금`/`등락률` 배열만 프로젝션해 반환(테마 제외, 날짜 내림차순, 2026-06-28부터 `테마`에서 `거래대금`/`등락률`로 교체) — "거래대금·등락률 분석" 탭의 거래대금·등락률 카테고리 TOP5 추이 표 2개용 |
| `/api/analyzeStocks` | POST | Claude API 프록시 (현재 미사용) |
| `/api/candles` | GET | `?symbol=&date=` → KIS Open API로 일봉 캔들 85개 실시간 조회. 실패 시에만 MongoDB `candles`(토스 캐시) 폴백 |
| `/api/getCompanyOverview` | GET | code 없음: company_analysis 전체 목록(`name`+`stock_code`, 검색 자동완성용) / `?code=종목코드`: 단건 조회 + KIS Open API로 현재가를 실시간 재조회해 `quote` 덮어씀(실패 시에만 저장된 `quote` 폴백) |
| `/api/analyzeCompany` | GET | `?name=종목명` → DART에서 corp_code를 못 찾으면 `{error:'not_found'}`, 최근 보고서가 없으면 `{error:'no_report'}`. **이미 `company_analysis`에 그 보고서까지 분석돼 있으면 DART 재무제표를 다시 받지 않고 저장된 데이터 그대로(현재가만 새로 받아) 즉시 반환**(2026-06-28 추가 — 주도주분석.py로 미리 분석해놔도 검색이 바로 안 보이던 문제 수정). 그 외엔 DART 재무제표+KIS 현재가를 즉석 조회해 `company_analysis`에 저장하고 `{data:...}` 반환(2026-06-27, Claude 미사용) |

---

## 환경변수

| 변수 | 위치 | 용도 |
|------|------|------|
| `MONGODB_URI` | .env.local + Vercel | MongoDB Atlas 연결 (종목분석.py도 사용 — 없으면 company_analysis 저장만 건너뛰고 로컬 JSON은 정상 저장) |
| `ANTHROPIC_API_KEY` | .env.local + Vercel | Claude API (analyzeStocks 미사용) |
| `NAVER_CLIENT_ID` | .env.local | Naver 검색 API (뉴스분석.py) |
| `NAVER_CLIENT_SECRET` | .env.local | Naver 검색 API (뉴스분석.py) |
| `TOSS_CLIENT_ID` | .env.local | 토스증권 Open API OAuth2 (뉴스분석.py, IP 허용 목록 때문에 로컬에서만 사용) |
| `TOSS_CLIENT_SECRET` | .env.local | 토스증권 Open API OAuth2 (뉴스분석.py, IP 허용 목록 때문에 로컬에서만 사용) |
| `KIS_APP_KEY` | .env.local + Vercel | KIS(한국투자증권) Open API 인증 (api/candles.js·api/getCompanyOverview.js·뉴스분석.py·종목분석.py, IP 제한 없어 Vercel에서 직접 호출) |
| `KIS_APP_SECRET` | .env.local + Vercel | KIS(한국투자증권) Open API 인증 (api/candles.js·api/getCompanyOverview.js·뉴스분석.py·종목분석.py, IP 제한 없어 Vercel에서 직접 호출) |
| `DART_API_KEY` | .env.local + Vercel | DART Open API 인증 (종목분석.py + `api/_dart.js`/`api/analyzeCompany.js`, IP 제한 없어 Vercel에서 직접 호출 — 2026-06-27부터 웹앱도 사용, 그 전엔 종목분석.py 전용이었음) |
