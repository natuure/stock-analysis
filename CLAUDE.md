# 주식 거래대금·등락률 분석 — 프로젝트 컨텍스트

## 프로젝트 개요
매일 장마감 후 **Python 스크립트**가 FinanceDataReader로 KRX 전종목 시세를 자동 수집해
MongoDB에 저장 → 웹앱 달력에서 날짜 클릭 시 데이터·AI 분석 결과 자동 표시.
HTS 엑셀 수동 업로드 단계 없이 Python 스크립트 + MongoDB 기반으로 완전 자동화됨.
종목 클릭 시 토스증권 Open API로 실시간 일봉 캔들 차트도 조회 가능.

---

## 데이터 흐름 (현재)

```
python 뉴스분석.py  ← 장마감 후 실행
    ├── FinanceDataReader로 KRX 전종목 시세 수집 (fdr.StockListing('KRX'))
    ├── 거래대금 상위 50 / 등락률 상위 50(거래대금 300억↑) 산출
    ├── 직전 거래일 순위와 비교해 prevRank 계산 (MongoDB 조회)
    ├── MongoDB stock_data 컬렉션 저장
    ├── 토스증권 API로 거래대금+등락률 종목(최대 100개)의 일봉 캔들 60개 미리 조회
    │     → MongoDB candles 컬렉션 캐싱 (Vercel은 토스 API를 직접 호출하지 않음, 아래 참고)
    ├── Naver 뉴스 API 검색 (AI검색.md 쿼리 패턴)
    └── 분석결과/뉴스데이터_YYYYMMDD.json 저장
         ↓
Claude Code "분석해줘" 요청
    ├── 뉴스데이터 JSON 읽기
    ├── AI 분석 생성 (테마/거래대금/등락률 JSON)
    └── 분석결과/분석결과_YYYY-MM-DD.json 저장
         ↓
python 저장분석.py  ← 분석결과/ 폴더 최신 파일 자동 탐색
    └── MongoDB ai_analysis 컬렉션 저장
         ↓
웹앱 달력 날짜 클릭
    ├── /api/getData?date= → stock_data 조회
    └── /api/getAnalysis?date= → ai_analysis 조회
         → 화면 자동 표시
         ↓
종목 행 클릭 → /api/tossQuote?symbol=&date= → MongoDB candles 컬렉션 조회 → 모달에 캔들차트 표시
```

> ⚠️ **토스증권 API는 IP 허용 목록 기반**이라 Vercel 서버리스 함수(유동 IP)에서 직접 호출하면
> `access_denied: IP address not allowed` 오류가 난다. 그래서 토스 API 호출은 고정 IP인
> 로컬 `뉴스분석.py`에서만 수행하고, Vercel `/api/tossQuote`는 MongoDB `candles` 컬렉션을
> 읽기만 한다. 따라서 캔들 차트는 **그날 거래대금/등락률 상위 50에 포함된 종목만** 조회 가능.

---

## 배포 아키텍처

```
Frontend (React + Vite → Vercel)     Backend (Vercel Serverless)     DB
────────────────────────────────     ──────────────────────────      ──────────────────
src/                                 api/getData.js                  MongoDB Atlas
  App.jsx                              stock_data 조회 (날짜별)        stock_data 컬렉션
  components/                        api/getAnalysis.js                _id = "YYYY-MM-DD"
    Header, Calendar                   ai_analysis 조회                vol, rate, date
    Cards, Tables, Analysis          api/analyzeStocks.js            ai_analysis 컬렉션
    StockDetailModal                   Claude API 프록시 (미사용)       _id = "YYYY-MM-DD"
  utils.js                           api/tossQuote.js                 candles 컬렉션 (토스 캔들 캐시)
  styles.css                           candles 컬렉션 조회만 함          _id = "종목코드_YYYY-MM-DD"
                                        (토스 API 직접 호출 안 함)        candles: [...]

Python (로컬 실행, 고정 IP)
  뉴스분석.py   ← FinanceDataReader 수집 + 토스 캔들 캐싱 + Naver 뉴스 수집 + stock_data 저장
  저장분석.py   ← ai_analysis 저장
```

- **GitHub 저장소**: https://github.com/natuure/stock-analysis.git
- **Vercel 자동 배포**: master 브랜치 push → 자동 빌드·배포
- **Vercel 환경변수**: `MONGODB_URI`, `ANTHROPIC_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- `TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET`는 **로컬 `.env.local`에만** 필요 (Vercel은 토스 API를 호출하지 않으므로 Vercel 환경변수 등록은 불필요, 등록해 둬도 무해함)

---

## 파일 구조

```
/
├── api/
│   ├── getData.js           # GET ?date= → stock_data 조회 / 날짜 목록 반환
│   ├── getAnalysis.js       # GET ?date= → ai_analysis 조회
│   ├── analyzeStocks.js     # Claude API 프록시 (현재 미사용)
│   └── tossQuote.js         # GET ?symbol=&date= → MongoDB candles 컬렉션 조회 (토스 API 직접 호출 안 함)
├── src/
│   ├── main.jsx
│   ├── App.jsx              # 상태 관리 (selectedStock 추가 → StockDetailModal 연결)
│   ├── api.js               # 비어있음 (fetchSectors 제거됨)
│   ├── utils.js             # normVol, normRate, 날짜 유틸
│   ├── styles.css
│   └── components/
│       ├── Header.jsx
│       ├── Calendar.jsx     # serverDates prop 추가 (MongoDB 날짜 표시)
│       ├── Cards.jsx        # 카드 2개 (거래대금/시가총액 TOP5, 순위상승 TOP5)
│       ├── Tables.jsx       # 거래대금·등락률 테이블, 행 클릭 시 onRowClick
│       ├── StockDetailModal.jsx  # 종목 클릭 시 토스 API 일봉 캔들 차트 모달
│       └── Analysis.jsx     # ThemeTable + AiPanels + N파일
├── 뉴스분석.py              # FinanceDataReader 수집 + Naver 뉴스 + stock_data 저장
├── 저장분석.py              # ai_analysis MongoDB 저장
├── requirements.txt         # pandas, finance-datareader, requests, pymongo[srv], python-dotenv
├── AI검색.md                # Naver API 쿼리 패턴 가이드
├── 데일리분석/              # (과거 HTS 엑셀 보관 폴더, 더 이상 스크립트가 사용하지 않음, gitignore 유지)
├── 분석결과/                # 뉴스데이터_*.json, 분석결과_*.json (gitignore)
├── index.html
├── vite.config.js
├── package.json
├── vercel.json
├── .env.local               # MONGODB_URI, ANTHROPIC_API_KEY, NAVER_*, TOSS_* (git 제외)
└── .gitignore               # .env.local, node_modules/, dist/, .vercel/, 데일리분석/, 분석결과/, *.xlsx, *.xls
```

---

## Python 스크립트

### 뉴스분석.py
```bash
python 뉴스분석.py   # 장마감 후 실행. 오늘 날짜 기준 KRX 전종목 자동 수집
```
- FinanceDataReader(`fdr.StockListing('KRX')`)로 전종목 시세 1회 호출 (KONEX 제외)
- 거래대금 상위 50 / 등락률 상위 50(거래대금 300억↑ 대상) 산출
- MongoDB `stock_data` 컬렉션에 저장 (웹앱 달력 초록 점 자동 표시)
- 거래대금+등락률 종목(최대 100개)의 토스증권 일봉 캔들 60개를 미리 조회해 MongoDB `candles`에 캐싱
  (토스 API는 IP 허용 목록 기반이라 고정 IP인 로컬에서만 호출, Vercel은 직접 호출하지 않음)
- `분석결과/뉴스데이터_YYYYMMDD.json` 생성
- Naver 뉴스 쿼리: `{name} 특징주`, `{name} 급등 이유`, `{name} 상승 배경` 등 8개
- 날짜 기준 검색: 파일날짜 ~ 오늘 (3일 이상 지난 경우 파일날짜+3일로 제한)
- 당일 기사 우선 정렬

### 저장분석.py
```bash
python 저장분석.py                              # 분석결과/ 최신 분석결과_*.json 자동 탐색
python 저장분석.py "분석결과/분석결과_2026-06-17.json"  # 파일 직접 지정
```
- Claude Code가 생성한 분석 JSON을 MongoDB `ai_analysis`에 저장

---

## MongoDB 컬렉션 (현재)

| 컬렉션 | 용도 | 구조 |
|--------|------|------|
| `stock_data` | 일별 종목 데이터 | `{ _id: "YYYY-MM-DD", vol: [...], rate: [...], date: "2026년 6월 17일 (화)" }` |
| `ai_analysis` | AI 분석 결과 | `{ _id: "YYYY-MM-DD", analysis: { 테마:[...], 거래대금:[...], 등락률:[...] } }` |
| `candles` | 종목별 토스 일봉 캔들 캐시 | `{ _id: "종목코드_YYYY-MM-DD", candles: [...] }` (해당일 거래대금/등락률 상위 종목만) |

> ⚠️ `wics_cache` 컬렉션은 삭제됨 (WICS 업종 분류 기능 제거)

---

## 데이터 수집 (FinanceDataReader)

`fdr.StockListing('KRX')` 1회 호출로 KRX 전종목(KOSPI/KOSDAQ, KONEX 제외)의
`Code, Name, Market, Close, Changes, ChagesRatio, Volume, Amount, Marcap`을 가져옴.
- **거래대금 상위 50**: `Amount` 내림차순
- **등락률 상위 50**: `Amount >= 300억` 필터 후 `ChagesRatio` 내림차순
- **상한가 판정**: `changeRate >= 29.5` (`isUpperLimit: true`)
- **전일 순위(prevRank)**: MongoDB에서 직전 거래일 `stock_data` 문서를 조회해 종목코드로 매칭 (없으면 NEW)
- **체결강도**: FDR로 계산 불가하여 컬럼 자체 제거됨 (HTS 엑셀 시절에는 있었음)

> ⚠️ **알려진 한계 — NXT(대체거래소) 거래량 포함 여부 미확인**: 거래대금/등락률 산출에 쓰는
> FDR `StockListing('KRX')`가 NXT에서 체결된 거래량·거래대금까지 합산하는지 공개 자료로
> 확정하지 못했다 (2026-06-19 조사). NXT 공식 사이트는 종목별 일별거래현황 조회 화면은
> 있으나 무료 다운로드/API가 없고, 진짜 데이터 접근은 유료 "정보이용사" 전용 서비스로 보임.
> 따라서 지금은 고치지 않고 기록만 남김 — NXT가 공개 API/다운로드를 제공하면 재검토.

---

## 데이터 구조 (JavaScript / Python 공통)

**vol 항목:**
```javascript
{ rank, prevRank, code, name, price, change, changeRate, volume, marketCap, tradingVolume }
// prevRank: null = 신규, sector 필드 없음 (WICS 제거됨)
```

**rate 항목:**
```javascript
{ rank, code, name, price, change, changeRate, isUpperLimit, volume }
// contractStrength 필드 제거됨 (FDR 전환 시 더 이상 제공 불가)
```

**localStorage 구조:**
```
analysis_dates       → JSON 배열 ["2026-06-17", ...]
analysis_YYYY-MM-DD  → JSON { vol:[...], rate:[...], date:"2026년 6월 17일 (화)" }
```

---

## AI 분석 JSON 형식 (Claude Code 생성)

```json
{
  "date": "2026-06-17",
  "analysis": {
    "테마": [
      { "테마": "반도체/AI", "주요종목": "SK하이닉스(+5%), SK스퀘어(+6%)", "핵심재료": "250만닉스 달성, GAM 슈퍼사이클" }
    ],
    "거래대금": [
      { "종목명": "SK하이닉스", "한줄요약": "...", "상승원인": "...", "트리거": "...", "테마섹터": "반도체/HBM/AI인프라" }
    ],
    "등락률": [
      { "종목명": "한솔테크닉스", "한줄요약": "...", "상승원인": "...", "트리거": "...", "테마섹터": "전선/전력인프라" }
    ]
  }
}
```

---

## 화면 구성 (현재)

### Analysis.jsx — 3개 섹션

1. **핫한 테마** (ThemeTable)
   - 표 형식: 테마 태그 | 주요 종목 | 핵심 재료 (전체 가운데 정렬)
   - `aiAnalysis.테마` 배열에서 렌더링

2. **주요 뉴스** (AiPanels)
   - 좌측 패널: 거래대금 상위 / 우측 패널: 등락률 상위
   - 모바일: 거래대금/등락률 탭 전환
   - 각 종목 카드: 종목명 + 테마 태그, 요약·원인·트리거 라벨 후 내용 다음 줄

3. **분석 결과** (N파일 업로드 시)
   - 기존 N파일 Excel 분석 표시 (현재 미사용)

### Cards.jsx — 2개 카드
- 거래대금/시가총액 TOP 5
- 전일 대비 순위 상승 TOP 5
> WICS 업종 분포 카드 제거됨

### Calendar.jsx
- localStorage `analysis_dates` + MongoDB `serverDates` 합쳐서 초록 점 표시
- 날짜 클릭 → localStorage 우선, 없으면 MongoDB에서 로드 후 localStorage 캐시
- 주간(W##) 클릭 → 주간 요약 표시

### StockDetailModal.jsx
- 거래대금·등락률 표의 종목 행 클릭 시 오버레이 모달로 표시
- `/api/tossQuote?symbol=&date=`로 토스증권 일봉 캔들 60개 조회 → SVG 캔들차트 직접 렌더링 (차트 라이브러리 미사용)
- 선택일 시가·고가·저가·거래량 텍스트 요약 포함

---

## API 엔드포인트

| 엔드포인트 | 메서드 | 용도 |
|-----------|--------|------|
| `/api/getData` | GET | date 없음: 날짜 목록 반환 / date 있음: 해당일 vol+rate 반환 |
| `/api/getAnalysis` | GET | `?date=YYYY-MM-DD` → ai_analysis 반환 |
| `/api/analyzeStocks` | POST | Claude API 프록시 (현재 미사용) |
| `/api/tossQuote` | GET | `?symbol=&date=` → MongoDB `candles` 컬렉션에서 일봉 캔들 60개 조회 (토스 API 직접 호출 안 함) |

---

## 요약 카드

| 카드 | 데이터 | 로직 |
|------|--------|------|
| 거래대금/시가총액 TOP5 | vol | tradingVolume / marketCap 정렬 |
| 전일 대비 순위 상승 TOP5 | vol | prevRank - rank 정렬, null → NEW 배지 |
| 상한가 종목 | rate | isUpperLimit === true |

---

## 테이블 (Tables.jsx)

- 거래대금·등락률 탭 전환 (모바일)
- 컬럼 클릭 정렬 (asc/desc)
- **거래대금 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 거래량 | 거래대금
- **등락률 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 거래량
- 상한가 행: `limit-up` 클래스 (연한 빨강 배경)
- 행 클릭 → `onRowClick` → `StockDetailModal` 오픈

---

## Toss 디자인 토큰

```css
--c-primary:   #3182f6;
--c-up:        #f04452;
--c-down:      #3182f6;
--c-success:   #03b26c;
--c-limit-bg:  #fff0f1;
```

---

## 반응형

- 767px 이하: 1열, 탭 전환
- 768~1023px: 2열
- 1024px 이상: 3+2 그리드

---

## 환경변수

| 변수 | 위치 | 용도 |
|------|------|------|
| `MONGODB_URI` | .env.local + Vercel | MongoDB Atlas 연결 |
| `ANTHROPIC_API_KEY` | .env.local + Vercel | Claude API (analyzeStocks 미사용) |
| `NAVER_CLIENT_ID` | .env.local | Naver 검색 API (뉴스분석.py) |
| `NAVER_CLIENT_SECRET` | .env.local | Naver 검색 API (뉴스분석.py) |
| `TOSS_CLIENT_ID` | .env.local | 토스증권 Open API OAuth2 (뉴스분석.py, IP 허용 목록 때문에 로컬에서만 사용) |
| `TOSS_CLIENT_SECRET` | .env.local | 토스증권 Open API OAuth2 (뉴스분석.py, IP 허용 목록 때문에 로컬에서만 사용) |

---

## 로컬 개발

```powershell
# 빌드 확인 (Google Drive에서 npm install 불가 시)
Copy-Item -Recurse "g:\내 드라이브\Claude\주식\거래대금, 등락률 분석" "C:\stock-analysis-build" -Exclude node_modules,.git
cd C:\stock-analysis-build
npm install && npm run build
```
배포는 원본 경로에서 `git push` → Vercel 자동 빌드.

---

## 제거된 기능

- **브라우저 파일 업로드** (Upload.jsx 삭제): D/N/W 드래그앤드롭 → Python 스크립트로 대체
- **WICS 업종 분류** (getSectors.js 삭제, wics_cache 삭제): 업종 데이터 미표시
- **SectorBars 카드** (Cards.jsx): WICS 업종 분포 TOP5 카드 제거
- **sector 필드** (normVol/normRate): 종목 데이터에서 sector 필드 제거
- **HTS 엑셀 수동 업로드** (`데일리분석/` 폴더, parseExcel류 함수): FinanceDataReader 자동 수집으로 대체
- **체결강도 필드** (rate.contractStrength): FDR 전환으로 계산 불가하여 제거 (필요 시 별도 데이터 소스로 재도입 검토)
- **업종.py**: 미사용 스크립트 삭제
