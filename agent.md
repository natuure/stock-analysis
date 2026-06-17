# 주식 거래대금·등락률 분석 — 프로젝트 컨텍스트

## 프로젝트 개요
매일 HTS에서 추출한 거래대금·등락률 합본 엑셀 파일을 **Python 스크립트**로 처리하면
MongoDB에 자동 저장 → 웹앱 달력에서 날짜 클릭 시 데이터·AI 분석 결과 자동 표시.
브라우저 파일 업로드 없이 Python 스크립트 + MongoDB 기반으로 완전 자동화됨.

---

## 데이터 흐름 (현재)

```
HTS 엑셀 파일 (거래대금,등락률_YYMMDD.xlsx)
    ↓
python 뉴스분석.py  ← 데일리분석/ 폴더 최신 파일 자동 탐색
    ├── 거래대금/등락률 파싱 (pandas)
    ├── MongoDB stock_data 컬렉션 저장
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
```

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
  utils.js                             Claude API 프록시 (미사용)       _id = "YYYY-MM-DD"
  styles.css                                                           analysis = {테마,거래대금,등락률}

Python (로컬 실행)
  뉴스분석.py   ← 엑셀 파싱 + Naver 뉴스 수집 + stock_data 저장
  저장분석.py   ← ai_analysis 저장
```

- **GitHub 저장소**: https://github.com/natuure/stock-analysis.git
- **Vercel 자동 배포**: master 브랜치 push → 자동 빌드·배포
- **Vercel 환경변수**: `MONGODB_URI`, `ANTHROPIC_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`

---

## 파일 구조

```
/
├── api/
│   ├── getData.js           # GET ?date= → stock_data 조회 / 날짜 목록 반환
│   ├── getAnalysis.js       # GET ?date= → ai_analysis 조회
│   └── analyzeStocks.js     # Claude API 프록시 (현재 미사용)
├── src/
│   ├── main.jsx
│   ├── App.jsx              # 상태 관리 (Upload 제거, serverDates 추가)
│   ├── api.js               # 비어있음 (fetchSectors 제거됨)
│   ├── utils.js             # parseExcel, normVol, normRate, 날짜 유틸
│   ├── styles.css
│   └── components/
│       ├── Header.jsx
│       ├── Calendar.jsx     # serverDates prop 추가 (MongoDB 날짜 표시)
│       ├── Cards.jsx        # 카드 2개 (거래대금/시가총액 TOP5, 순위상승 TOP5)
│       ├── Tables.jsx       # 거래대금·등락률 테이블
│       └── Analysis.jsx     # ThemeTable + AiPanels + N파일
├── 뉴스분석.py              # 엑셀 파싱 + Naver 뉴스 + stock_data 저장
├── 저장분석.py              # ai_analysis MongoDB 저장
├── requirements.txt         # pandas, openpyxl, requests, pymongo[srv], python-dotenv
├── AI검색.md                # Naver API 쿼리 패턴 가이드
├── 데일리분석/              # HTS 엑셀 파일 보관 폴더 (gitignore)
├── 분석결과/                # 뉴스데이터_*.json, 분석결과_*.json (gitignore)
├── index.html
├── vite.config.js
├── package.json
├── vercel.json
├── .env.local               # MONGODB_URI, ANTHROPIC_API_KEY, NAVER_* (git 제외)
└── .gitignore               # .env.local, node_modules/, dist/, .vercel/, 데일리분석/, 분석결과/, *.xlsx
```

---

## Python 스크립트

### 뉴스분석.py
```bash
python 뉴스분석.py                          # 데일리분석/ 최신 xlsx 자동 탐색
python 뉴스분석.py "데일리분석\파일명.xlsx"  # 파일 직접 지정
```
- `분석결과/뉴스데이터_YYYYMMDD.json` 생성
- MongoDB `stock_data` 컬렉션에 저장 (웹앱 달력 초록 점 자동 표시)
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

> ⚠️ `wics_cache` 컬렉션은 삭제됨 (WICS 업종 분류 기능 제거)

---

## 엑셀 파일 구조

**파일명 규칙**: `거래대금,등락률_YYMMDD.xlsx` (합본 파일, 2개 시트)
→ 파일명에서 날짜 자동 파싱 (`_YYMMDD` 패턴)

**거래대금 시트**:
```
순위 | 전일 | 종목코드 | 종목명 | 현재가 | 대비 | 등락률 | 거래량 | 시가총액 | 거래대금
```

**등락률 시트**:
```
순위 | 종목코드 | 종목명 | 현재가 | 대비 | 등락률 | 거래량 | 체결강도
```
- 대비 열에 `↑` 포함 시 상한가 처리 (`isUpperLimit: true`)

---

## 데이터 구조 (JavaScript / Python 공통)

**vol 항목:**
```javascript
{ rank, prevRank, code, name, price, change, changeRate, volume, marketCap, tradingVolume }
// prevRank: null = 신규, sector 필드 없음 (WICS 제거됨)
```

**rate 항목:**
```javascript
{ rank, code, name, price, change, changeRate, isUpperLimit, volume, contractStrength }
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

---

## API 엔드포인트

| 엔드포인트 | 메서드 | 용도 |
|-----------|--------|------|
| `/api/getData` | GET | date 없음: 날짜 목록 반환 / date 있음: 해당일 vol+rate 반환 |
| `/api/getAnalysis` | GET | `?date=YYYY-MM-DD` → ai_analysis 반환 |
| `/api/analyzeStocks` | POST | Claude API 프록시 (현재 미사용) |

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
- **등락률 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 거래량 | 체결강도
- 상한가 행: `limit-up` 클래스 (연한 빨강 배경)

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
- **업종.py**: 미사용 스크립트 삭제
