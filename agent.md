# 주식 거래대금·등락률 분석 — 프로젝트 컨텍스트

## 프로젝트 개요
매일 HTS에서 추출한 거래대금 상위 50위 / 등락률 상위 50위 엑셀 파일 2개를 업로드하면
자동 파싱 → 요약 카드·테이블 시각화 → Claude API AI 뉴스 분석을 제공하는 개인용 웹앱.

---

## 배포 아키텍처 (확정·운영 중)

```
Frontend (React + Vite → Vercel)     Backend (Vercel Serverless)         DB
────────────────────────────────     ─────────────────────────           ──────────────────
src/                                 api/getSectors.js                   MongoDB Atlas
  App.jsx (오케스트레이터)              WISEindex API → MongoDB 캐시         wics_cache 컬렉션
  components/                        api/analyzeStocks.js                 _id = "YYYY-MM-DD"
    Header, Calendar, Upload           Claude API 프록시                   값 = {종목코드: 업종명}
    Cards, Tables, Analysis, Toast
  utils.js (파싱·유틸)
  api.js (fetch 래퍼)
  styles.css (Toss 디자인)
```

- **GitHub 저장소**: https://github.com/natuure/stock-analysis.git
- **Vercel 자동 배포**: master 브랜치 push → 자동 빌드·배포
- Firebase는 완전히 제거됨
- Vercel 환경변수: `MONGODB_URI`, `ANTHROPIC_API_KEY`

---

## 파일 구조

```
/
├── api/
│   ├── getSectors.js        # WISEindex 업종 조회 + MongoDB 캐시
│   └── analyzeStocks.js     # Claude API 프록시
├── src/
│   ├── main.jsx             # ReactDOM 엔트리
│   ├── App.jsx              # 상태 관리 오케스트레이터
│   ├── api.js               # fetchSectors, callAnalysis
│   ├── utils.js             # parseExcel, normVol, normRate, 날짜 유틸
│   ├── styles.css           # Toss 디자인 시스템 CSS
│   └── components/
│       ├── Header.jsx       # 타이틀 + 날짜 표시
│       ├── Calendar.jsx     # 월간 달력 (localStorage 히스토리)
│       ├── Upload.jsx       # 드래그앤드롭 파일 업로드 (2개)
│       ├── Cards.jsx        # 요약 카드 5개
│       ├── Tables.jsx       # 거래대금·등락률 테이블 (정렬 가능)
│       ├── Analysis.jsx     # AI 분석 버튼·결과
│       └── Toast.jsx        # 토스트 알림
├── index.html               # Vite 엔트리포인트
├── vite.config.js           # defineConfig({ plugins: [react()] })
├── package.json             # react, react-dom, xlsx, mongodb, iconv-lite
├── vercel.json              # 빌드 설정, 함수 타임아웃 60초
├── .env.local               # MONGODB_URI, ANTHROPIC_API_KEY (git 제외)
└── .gitignore               # .env.local, node_modules/, dist/, .vercel/
```

---

## 엑셀 파일 구조

**파일명 규칙**: `거래대금_YYMMDD.xlsx`, `등락률_YYMMDD.xlsx`
→ 파일명에서 날짜 자동 파싱 (`fileDateFromName()`)
→ 당일 업로드하지 않아도 해당 날짜로 데이터 저장 가능

**거래대금 파일** (시트명 없어도 첫 번째 시트 자동 인식):
```
순위 | 전일 | 종목코드 | 종목명 | 현재가 | 대비 | 등락률 | 거래량 | 시가총액 | 거래대금
```
- 전일: 전일 순위 숫자. 빈칸/신규/- → null → "NEW" 배지

**등락률 파일** (거래대금 300억 이상 필터):
```
순위 | 종목코드 | 종목명 | 현재가 | 대비 | 등락률 | 거래량 | 체결강도
```
- 대비 열에 `↑` 포함 시 상한가 처리 (`isUpperLimit: true`)

---

## 데이터 구조 (JavaScript)

**normVol 결과 (S.vol 항목):**
```javascript
{
  rank, prevRank,           // prevRank: null = 신규
  code, name,
  price, change, changeRate,
  volume, marketCap, tradingVolume,
  sector,                   // fetchSectors 후 채워짐
}
```

**normRate 결과 (S.rate 항목):**
```javascript
{
  rank, code, name,
  price, change, changeRate,
  isUpperLimit,             // 대비 열에 '↑' 포함 여부
  volume, contractStrength,
  sector,
}
```

**localStorage 구조:**
```
analysis_dates       → JSON 배열 ["2026-06-16", ...]
analysis_YYYY-MM-DD  → JSON { vol:[...], rate:[...], sectors:{...}, date:"2026년 6월 16일 (화)" }
```

---

## 요약 카드 (5개)

| 카드 | 제목 | 데이터 | 로직 |
|---|---|---|---|
| A | 거래대금/시가총액 TOP5 | vol | tradingVolume / marketCap * 100 정렬 |
| B | WICS 업종 분포 TOP5 | vol | 업종별 카운트, CSS 막대 |
| C | 전일 대비 순위 상승 TOP5 | vol | prevRank - rank 정렬, null → NEW 배지 |
| D | 상한가 종목 | rate | isUpperLimit === true |
| E | WICS 업종 분포 TOP5 | rate | 업종별 카운트, CSS 막대 |

---

## 업종 조회 (api/getSectors.js)

**WISEindex API** (Naver Finance → 차단으로 교체):
```
https://www.wiseindex.com/Index/GetIndexComponets?ceil_yn=0&dt=YYYYMMDD&sec_cd=G10
```

WICS 섹터 코드: G10(에너지) G15(소재) G20(산업재) G25(경기소비재) G30(필수소비재)
G35(건강관리) G40(금융) G45(IT) G50(커뮤니케이션서비스) G55(유틸리티)

**로직:**
1. MongoDB `wics_cache`에서 날짜별 캐시 조회
2. 캐시 종목 수 > 100이면 캐시 반환
3. 없으면 10개 섹터 병렬 요청 → `{종목코드: 업종명}` 맵 생성
4. 주말·휴장일이면 직전 영업일로 자동 재시도
5. MongoDB에 저장 후 반환

**MongoDB 문서 구조:**
```json
{ "_id": "2026-06-16", "005930": "IT", "000660": "IT", "005380": "경기소비재", ... }
```

---

## AI 분석 (api/analyzeStocks.js)

- **모델**: claude-haiku-4-5-20251001, max_tokens: 8192
- **API 키**: `process.env.ANTHROPIC_API_KEY` (서버 env, 클라이언트 미노출)
- **입력**: 거래대금 TOP30 + 등락률 TOP30 (종목명, 등락률)
- **분석 관점**:
  - 실적/공시 이슈
  - 수주·계약·파트너십 뉴스
  - 정책·규제 수혜
  - 업종 동반 상승 (대장주 연동)
  - AI·반도체·배터리·방산·로봇 등 테마 모멘텀
- **출력**: `{"거래대금":[{"종목명":"...","이유":"..."}],"등락률":[...]}`

---

## 테이블 (Tables.jsx)

- 거래대금·등락률 탭 전환 (모바일)
- 컬럼 클릭 정렬 (asc/desc 토글)
- **거래대금 테이블 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 거래량 | 거래대금
- **등락률 테이블 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 거래량 | 체결강도
- 상한가 행: `limit-up` 클래스 (연한 빨강 배경)
- `대비` 열은 표시하지 않음

---

## 달력 (Calendar.jsx)

- 7열 그리드 (일~토), 월 이동 버튼
- 오늘: 파란 테두리 원
- 데이터 있는 날: 숫자 아래 초록 점 (`::after`, `has-data` 클래스)
- 선택된 날: 채워진 파란 원, 흰 텍스트
- 데이터 있는 날 클릭 → localStorage 복원
- 데이터 없는 날 클릭 → 업로드 섹션으로 스크롤

---

## Toss 디자인 토큰

```css
--c-primary:   #3182f6;   /* 파란색 */
--c-up:        #f04452;   /* 상승 = 빨강 (한국 증시 관례) */
--c-down:      #3182f6;   /* 하락 = 파랑 */
--c-success:   #03b26c;   /* 달력 점, 업로드 성공 */
--c-limit-bg:  #fff0f1;   /* 상한가 행 배경 */
```

---

## 반응형

- 767px 이하: 1열, 세그먼트 탭 테이블 전환
- 768~1023px: 2열 카드, 나란히 테이블
- 1024px 이상: 3+2 카드 그리드, 나란히 테이블

---

## 환경변수

| 변수 | 위치 | 용도 |
|---|---|---|
| `MONGODB_URI` | .env.local + Vercel | MongoDB Atlas 연결 문자열 |
| `ANTHROPIC_API_KEY` | .env.local + Vercel | Claude API 인증 |

---

## 로컬 개발

Google Drive 경로(`G:\`)에서 npm install이 불가하므로 C 드라이브에서 빌드 확인:
```powershell
Copy-Item -Recurse "g:\내 드라이브\Claude\주식\거래대금, 등락률 분석" "C:\stock-analysis-build" -Exclude node_modules,.git
cd C:\stock-analysis-build
npm install
npm run build
```
배포는 항상 원본 경로에서 `git push`로 Vercel 자동 빌드 사용.
