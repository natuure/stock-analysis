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
    EtfRankTable                          KIS Open API 직접 호출(실시간)  kis_token 컬렉션 (KIS 접근토큰 캐시)
    RsRankingView, RsRankTable         api/getRsRanking.js                _id = "token"
    CompanyOverviewView                  rs_ranking 조회(단일 문서)     weekly_indices 컬렉션
  utils.js                            api/getCompanyOverview.js          _id = "YYYY-W##" (etfRank 필드 포함,
  styles.css                            company_analysis 조회               과거 도입기 문서엔 rsRank도 있을
                                         (목록/종목코드별 단건) +             수 있으나 더 이상 쓰지 않음)
                                         KIS로 현재가 실시간 덮어씀     rs_ranking 컬렉션
                                         (실패 시에만 저장된 quote 폴백)   _id = "latest" 단일 문서
                                     api/analyzeCompany.js            rs_category_cache 컬렉션
                                       DART+KIS 즉석 분석                _id = "종목명"
                                       (Claude 미사용) → company_analysis
                                       저장(없던 종목이면 신규)         company_analysis 컬렉션
                                       api/_kis.js (candles.js·           _id = "종목코드"
                                         getCompanyOverview.js·
                                         analyzeCompany.js 공용         dart_corp_codes 컬렉션
                                         KIS 토큰·현재가, 라우트 아님)     _id = "map"
                                       api/_dart.js (analyzeCompany.js
                                         전용, DART 추출·corp_code
                                         조회, 라우트 아님)

Python (로컬 실행, 고정 IP)
  뉴스분석.py   ← FinanceDataReader 수집 + 토스 캔들 캐싱(폴백용) + Naver 뉴스 수집 + stock_data 저장
  저장분석.py   ← ai_analysis 저장
  주간분석.py   ← 코스피/코스닥 주간 변동률 + 주간 거래대금/등락률 상위 50(뉴스분석.py 임포트해
                  KIS 통합 보강 재사용, 2026-06-27) + 주간 ETF 등락률 상위 15(weekly_indices.etfRank,
                  원래 별도 ETF분석.py였던 랭킹 계산 로직을 흡수, 2026-07-06) 계산 + weekly_indices
                  저장 (메인 흐름과 독립)
  rs랭킹.py     ← 전종목 RS Score 백분위 90 이상 랭킹 계산(뉴스분석.py·저장분석.py·주간분석.py
                  임포트해 유니버스·카테고리 목록·attach_categories() 재사용) + rs_ranking 컬렉션
                  단일 문서(_id='latest') 저장(2026-07-11 도입, 같은 날 주간분석.py에서 분리 —
                  웹앱 "RS랭킹" 탭 전용, 주간뷰에는 더 이상 표시 안 함, HISTORY.md 참고)
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
│   ├── getRsRanking.js         # GET → rs_ranking 컬렉션의 단일 문서(_id='latest')를 그대로 반환
│   │                             (2026-07-11 도입, "RS랭킹" 탭 전용 — 날짜/주차 파라미터 없음)
│   ├── getStockMarketInterest.js  # GET ?code=&name= → 종목 하나의 RS Score 10주 추이(rs_ranking의
│   │                             주차별 히스토리) + 최근 15거래일 등락률 상위50 등장 + 카테고리 +
│   │                             카테고리 TOP5 등장을 한 번에 계산해 반환(2026-07-11 도입, "종목 분석"
│   │                             탭 "시장관심도" 전용)
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
│       ├── StockAnalysis.jsx  # "종목 분석" 탭 — 종목명 검색(자동완성)창 + 기업개요/시장관심도/재무상태표/손익계산서
│       │                       4버튼. 시장관심도(MarketInterestView, 2026-07-11 도입)는 api/getStockMarketInterest.js를
│       │                       탭을 처음 열 때만 지연 fetch — RS Score 10주 추이 + 등락률 상위50 등장 + 카테고리
│       │                       TOP5 등장을 보여줌
│       ├── EtfRankTable.jsx   # 주간뷰(카테고리 비중 도넛 ~ 주간 종목 데이터 표 사이)에 삽입되는
│       │                       ETF 등락률 상위 15 표 — 별도 탭이 아니라 weekVolRate.etfRank를 그대로 받아
│       │                       렌더링만 함(2026-07-04 도입, 2026-07-06 별도 탭에서 이 위치로 이동)
│       ├── RsRankingView.jsx  # 상단 "RS랭킹" 탭의 내용 — /api/getRsRanking을 자체 fetch(StockAnalysis.jsx와
│       │                       같은 패턴)해 RsRankTable에 넘김(2026-07-11 도입)
│       ├── RsRankTable.jsx    # RS Score 랭킹 카드형 표 — rsRank 배열(RS Score 백분위 90 이상, 이미
│       │                       정렬돼 옴)을 그대로 받아 렌더링만 함. 2026-07-11 도입 당일엔 주간뷰
│       │                       (EtfRankTable 다음)에 있었으나, RS Score 계산이 주간분석.py에서
│       │                       rs랭킹.py로 분리되며 이 컴포넌트도 "RS랭킹" 탭 전용으로 옮겨짐
│       │                       ([HISTORY.md](HISTORY.md) 참고)
│       ├── CompanyOverviewView.jsx  # 기업개요 — PER/PBR/ROE/EV·EBITDA + 적정주가 슬라이더 4종 (data prop으로 받음)
│       └── TrendChart.jsx   # 의존성 없는 SVG 추이 차트(막대/꺾은선), StockAnalysis.jsx·Analysis.jsx 공용
├── 뉴스분석.py              # FinanceDataReader 수집 + Naver 뉴스 + stock_data 저장
├── 저장분석.py              # ai_analysis MongoDB 저장
├── 주간분석.py              # 코스피/코스닥 주간 변동률 + 주간 거래대금/등락률 상위 50 + 주간 ETF 등락률
│                             상위 15(etfRank, 2026-07-06부터 흡수) → weekly_indices 저장
├── rs랭킹.py                # 전종목 RS Score 백분위 90 이상 랭킹 → MongoDB rs_ranking 컬렉션
│                             단일 문서(_id='latest') 저장(2026-07-11 도입, 같은 날 주간분석.py에서
│                             분리 — 뉴스분석.py·저장분석.py·주간분석.py를 import해 재사용)
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
| `weekly_indices` | 주간 코스피/코스닥 변동률 + 주간 거래대금/등락률 상위 50(주간분석.py가 채움, vol/rate/lastTradingDate는 2026-06-27 추가라 그 이전 주차에는 없을 수 있음) + 주간 ETF 등락률 상위 15(`etfRank`, 2026-07-04 도입, 2026-07-06부터 `주간분석.py`가 직접 채움 — 그 이전 주차에는 없을 수 있음). **`rsRank` 필드는 더 이상 채우지 않음**(2026-07-11 도입 당일에만 잠깐 여기 있었고, 같은 날 `rs_ranking` 컬렉션으로 옮김 — 2026-W28 등 도입 당일에 실행된 문서에는 옛 `rsRank` 필드가 그대로 남아있을 수 있으나 화면에서 더 이상 읽지 않음, [HISTORY.md](HISTORY.md) 참고) | `{ _id: "YYYY-W##", kospi: {...}, kosdaq: {...}, vol: [...50], rate: [...50], lastTradingDate: "YYYY-MM-DD", etfRank: [...15] }` |
| `rs_ranking` | 두 종류 문서가 공존(2026-07-11 도입). **① `_id: "latest"`**: RS Score 백분위 90 이상 종목만(+카테고리) — `rs랭킹.py`가 매 실행마다 덮어씀, "RS랭킹" 탭(`api/getRsRanking.js`)이 읽음. **② `_id: "YYYY-W##"`(주차별 히스토리)**: 그 주 계산 성공한 전종목(임계값 무관, 카테고리 없음) — `api/getStockMarketInterest.js`가 특정 종목의 10주 추이를 조회할 때 읽음 | `{ _id: "latest", asOfDate, weekKey, rsRank: [{rank, code, name, rsScore, 카테고리?, 신규카테고리후보?}], updatedAt }` 또는 `{ _id: "YYYY-W##", asOfDate, weekKey, scores: [{code, name, rsScore}], updatedAt }` |
| `rs_category_cache` | RS Score 랭킹 카테고리 영속 캐시 — `ai_analysis`에 한 번도 등장한 적 없는 RS 전용 종목의 분류를 Claude Code가 조사해 저장, 다음 실행 이후로도 재사용(2026-07-11 도입, `rs랭킹.py`의 `rs_ranking()`이 읽음, [DATA_PIPELINE.md](DATA_PIPELINE.md) "RS 랭킹 카테고리 영속 캐시" 절 참고). `카테고리`는 `저장분석.VALID_CATEGORIES`(28개)를 그대로 따름 — 조회 시점에 그 목록에 없는 값(카테고리 개편으로 무효화)은 자동 제외돼 재분류 대상으로 복귀 | `{ _id: "종목명", code, 카테고리, 신규카테고리후보?, classifiedAt: "YYYY-MM-DD", source: "claude_code_manual" }` |
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
| `/api/getRsRanking` | GET | 파라미터 없음 → `rs_ranking` 컬렉션의 단일 문서(`_id='latest'`) 반환(2026-07-11 도입) — "RS랭킹" 탭 전용 |
| `/api/getStockMarketInterest` | GET | `?code=&name=` 필수 → RS Score 10주 추이 + 최근 15거래일 등락률 상위50 등장 + 카테고리 + 카테고리 TOP5 등장을 계산해 반환(2026-07-11 도입) — "종목 분석" 탭 "시장관심도" 전용 |
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
