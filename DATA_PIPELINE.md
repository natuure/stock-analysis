# 데이터 파이프라인 — Python 스크립트·수집 로직·데이터 구조

## Python 스크립트

### 뉴스분석.py
```bash
python 뉴스분석.py   # 장마감 후 실행. 오늘 날짜 기준 KRX 전종목 자동 수집
```
- FinanceDataReader(`fdr.StockListing('KRX')`)로 전종목 시세 1회 호출 (KONEX 제외)
- 거래대금 상위 50 / 등락률 상위 50(거래대금 300억↑ 대상) 산출
- 코스피·코스닥 지수 종가/등락률도 같이 수집 (`fetch_indices()`, `fdr.DataReader('KS11'|'KQ11')`)
- MongoDB `stock_data` 컬렉션에 저장 (웹앱 달력 초록 점 자동 표시)
- 거래대금+등락률 종목(최대 100개)의 토스증권 일봉 캔들 85개를 미리 조회해 MongoDB `candles`에 캐싱
  (토스 API는 IP 허용 목록 기반이라 고정 IP인 로컬에서만 호출, Vercel은 직접 호출하지 않음.
  2026-06-20부터는 `api/candles.js`가 KIS를 우선 호출하므로, 이 캐싱은 KIS 장애 시에만 쓰이는
  폴백 데이터가 됨 — 자세한 내용은 아래 "KIS 일별 캔들 조회(api/candles.js)" 참고)
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

### 주간분석.py (2026-06-21 도입, 2026-06-21 범위 축소)
```bash
python 주간분석.py   # 아무 때나 실행 가능 (장마감 후가 자연스러움)
```
- `fdr.DataReader('KS11'|'KQ11')`로 최근 21일치(이번 주 + 비교 기준 지난 주 확보용 여유)만
  받아서 **가장 최근 1주(월~금)치만** 계산 — 과거 주차는 다시 계산하지 않음(이미 저장된
  과거 주는 그대로 유지됨)
- `monday_of(today)`로 이번 주 월요일을 구하고, 그 주 마지막 거래일 종가 vs 지난 주
  마지막 거래일(보통 금) 종가를 비교해 `{close, change, changeRate}` 계산. 이번 주에
  아직 거래일이 없으면(주말·휴일에 실행 등) 한 주 전으로 자동 이동
- 주차 키는 `f'{d.year}-W{iso_week}'` 형태(예: `2026-W25`) — `src/utils.js`의
  (현재는 `Calendar.jsx` 내부에 로컬로 있는) ISO 주차 계산과 동일한 규칙이어야
  웹앱이 키를 매칭할 수 있음. **숫자가 아닌 문자열이라 사전식 정렬로는 시간순이
  안 됨** (`"2026-W9"` > `"2026-W25"`)
- MongoDB `weekly_indices` 컬렉션에 해당 주차 1건만 upsert
- 웹앱 `/api/getData`가 이 컬렉션 전체를 같이 읽어 `weeklyIndices`로 내려주고,
  달력의 **토요일 칸**이 그 주(월~금)의 코스피/코스닥 변동률을 표시함
  (`Calendar.jsx`가 행의 월~금 중 실제 날짜로 주차를 계산해 매칭 — 일요일 기준으로
  하면 ISO 주차가 하루 앞당겨지는 버그가 있었음, 2026-06-21 수정)
- 처음 도입 시점에 과거 ~76주를 1회 백필해둔 상태라 과거 달도 정상 표시됨. 더 과거
  주차가 비어있으면 `LOOKBACK_DAYS`를 늘려 그 주만 따로 1회 실행해 백필하면 됨.

---

## 데이터 수집 (FinanceDataReader)

`fdr.StockListing('KRX')` 1회 호출로 KRX 전종목(KOSPI/KOSDAQ, KONEX 제외)의
`Code, Name, Market, Close, Changes, ChagesRatio, Volume, Amount, Marcap`을 가져옴.
- **거래대금 상위 50**: `Amount` 내림차순
- **등락률 상위 50**: `Amount >= 300억` 필터 후 `ChagesRatio` 내림차순
- **상한가 판정**: `changeRate >= 29.5` (`isUpperLimit: true`)
- **전일 순위(prevRank)**: MongoDB에서 직전 거래일 `stock_data` 문서를 조회해 종목코드로 매칭 (없으면 NEW)
- **체결강도**: FDR로 계산 불가하여 컬럼 자체 제거됨 (HTS 엑셀 시절에는 있었음)
- **ETF/ETN/스팩 제외** (2026-06-21): `fetch_market_data()`에서 이름에 `스팩|기업인수목적`이
  들어간 행을 제외함. ETF/ETN은 직접 확인해본 결과 `fdr.StockListing('KRX')` 자체가 보통주/
  우선주만 반환해서(KODEX 200 등 주요 ETF 코드도 안 잡힘) 별도 필터가 필요 없었음 — 스팩만
  실제로 섞여 있었음(`Dept` 컬럼의 `SPAC(소속부없음)` 태그만으론 전부 안 잡혀서 이름 패턴
  사용, 관리종목으로 전환된 스팩까지 잡아냄). 기존 MongoDB `stock_data`/`ai_analysis`에 이미
  들어가 있던 스팩 1건(2026-06-19, 메리츠제2호스팩)도 같이 제거 + rank 재정렬함.

> ⚠️ **알려진 한계 — NXT(대체거래소) 거래량 포함 여부 미확인**: 거래대금/등락률 산출에 쓰는
> FDR `StockListing('KRX')`가 NXT에서 체결된 거래량·거래대금까지 합산하는지 공개 자료로
> 확정하지 못했다 (2026-06-19 조사). NXT 공식 사이트는 종목별 일별거래현황 조회 화면은
> 있으나 무료 다운로드/API가 없고, 진짜 데이터 접근은 유료 "정보이용사" 전용 서비스로 보임.
> 따라서 지금은 고치지 않고 기록만 남김 — NXT가 공개 API/다운로드를 제공하면 재검토.

### 토스증권 캔들 캐싱
- `fetch_candles(token, code, date_str)`로 종목당 1회, `interval=1d&count=85` 조회 (`before` 커서로 해당 날짜 지정)
- 85개를 가져오는 이유: 차트엔 최근 60거래일만 표시하지만, 20일선이 표시 구간 맨 왼쪽까지 끊김 없이
  그려지려면 19거래일치 선행 데이터가 더 필요해서 (`StockDetailModal.jsx`의 `VISIBLE_COUNT=60` 참고)
- Rate Limit(burst 5, 초당 1개 충전) 대비 종목당 1.1초 슬립

### KIS 캔들 조회 — 일봉/주봉 (`api/candles.js`, 2026-06-20 도입, 주봉은 같은 날 추가)
- 종목 클릭 시 Vercel이 **KIS(한국투자증권) Open API를 실시간으로 직접 호출**한다.
  토스와 달리 KIS는 IP 허용 목록 제한이 없음을 확인했음 (Vercel 프리뷰 배포에서 토큰 발급·조회
  성공으로 검증, 2026-06-20).
- 엔드포인트: `GET /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
  (`tr_id: FHKST03010100`), 시작일~종료일 범위로 한 번에 최대 100개 캔들 반환. 같은 엔드포인트를
  `FID_PERIOD_DIV_CODE`로 일봉(`D`)/주봉(`W`) 전환해서 재사용한다.
- 프론트엔드가 보내는 `?period=D|W` 쿼리에 따라 `PERIOD_CONFIG`에서 조회 개수·범위를 다르게 잡음:
  - `D`(일봉): 캔들 85개, `FID_INPUT_DATE_1`은 대상일 기준 135캘린더일 전(85거래일 확보용 여유)
  - `W`(주봉): 캔들 75개, `FID_INPUT_DATE_1`은 대상일 기준 540캘린더일 전(75주 확보용 여유)
  - 둘 다 `FID_INPUT_DATE_2`는 대상일
- 접근토큰은 `/oauth2/tokenP`로 발급하며 **1분당 1회 발급 제한**이 있어 MongoDB `kis_token`
  컬렉션에 캐싱 후 만료(`expires_in`, 보통 24시간) 전까지 재사용한다.
- 응답(`output2`)의 `stck_bsop_date/stck_oprc/stck_hgpr/stck_lwpr/stck_clpr/acml_vol`을
  프론트엔드가 기대하는 `{timestamp, openPrice, highPrice, lowPrice, closePrice, volume}` 형태로
  변환하고, 날짜 내림차순(최신순)으로 정렬해 `PERIOD_CONFIG`의 개수만큼 잘라서 반환한다.
- KIS 호출이 실패하면(네트워크 오류, 상장폐지 등) **일봉(`D`)일 때만** 기존 토스 캐시(`candles`
  컬렉션)로 폴백한다 — 이 캐시는 위 "토스증권 캔들 캐싱" 절차로 여전히 매일 채워지지만 일봉만
  보관하므로, 주봉(`W`)은 KIS 실패 시 폴백 없이 빈 배열을 반환한다.
- 이 전환으로 "그날 거래대금/등락률 상위 50에 든 종목만 캔들 조회 가능"하던 한계가 사실상
  해소됨 (KIS는 캐싱 없이 아무 종목이나 즉시 조회 가능).

### 코스피·코스닥 지수 수집
- `fetch_indices()`: 최근 7일 범위로 `KS11`(코스피)/`KQ11`(코스닥)을 조회해 마지막 두 행의 `Close`로
  `close`, `change(포인트)`, `changeRate(%)`를 직접 계산 (FDR이 포인트 변동을 안 주므로 직접 차감)
- 과거 날짜 백필 시엔 `end`를 해당 날짜로 고정한 별도 호출 필요 (스크립트엔 "오늘" 전용 버전만 있음 — 과거 날짜 백필은 1회성으로 직접 작성해 실행함, 2026-06-19 기준 6/15~18 백필 완료)

---

## 데이터 구조 (JavaScript / Python 공통)

**vol 항목:**
```javascript
{ rank, prevRank, code, name, price, change, changeRate, volume, marketCap, tradingVolume }
// prevRank: null = 신규, sector 필드 없음 (WICS 제거됨)
// marketCap: 억원 단위, tradingVolume: 백만원 단위 (둘 다 2026-06-21부터, FDR 원 단위에서 변환)
// → 단위가 100배 차이나서 Cards.jsx의 거래대금/시가총액 비율(CardA)은 둘을 그대로 나눈 값이라
//   실제 회전율의 100배로 부풀려진 숫자임 (의도된 동작 — 보정하지 않기로 결정함, 2026-06-21)
```

**rate 항목:**
```javascript
{ rank, code, name, price, change, changeRate, isUpperLimit, volume }
// contractStrength 필드 제거됨 (FDR 전환 시 더 이상 제공 불가)
```

**indices 필드** (stock_data 문서에 같이 저장됨, 일간):
```javascript
{ kospi: { close, change, changeRate }, kosdaq: { close, change, changeRate } }
// change = 포인트 변동(부호 포함), changeRate = %
```

**weekly_indices 컬렉션** (`_id`가 주차 키, 주간분석.py가 채움):
```javascript
{ _id: "2026-W25", kospi: { close, change, changeRate }, kosdaq: { close, change, changeRate } }
// close/change는 그 주 마지막 거래일 기준, changeRate는 전주 마지막 거래일 종가 대비 %
```

**localStorage 구조:**
```
analysis_dates       → JSON 배열 ["2026-06-17", ...]
analysis_YYYY-MM-DD  → JSON { vol:[...], rate:[...], date:"...", indices:{...}, _v: CACHE_VERSION }
```

> ⚠️ **stock_data 스키마를 바꿀 때마다 `src/utils.js`의 `CACHE_VERSION`을 올려야 한다.**
> 캐시에 `_v`가 같이 저장되고, `App.jsx`의 `loadAnalysis()`가 `_v !== CACHE_VERSION`이면
> localStorage를 무시하고 `/api/getData`에서 새로 받아온다. 안 올리면 이미 캐싱된 날짜는
> 새 필드(예: indices)가 영원히 안 보이는 버그가 생긴다 (2026-06-18 실제로 겪은 버그).
> 필드를 추가할 때만이 아니라 **기존 필드의 값 단위를 바꿀 때도 마찬가지** — marketCap/
> tradingVolume을 억원/백만원 단위로 바꾸면서(2026-06-21) `CACHE_VERSION`을 2→3으로 올림.
> 이미 MongoDB에 저장된 과거 문서들은 원 단위로 남아있던 2건(2026-06-18, 19)만 1회성
> 스크립트로 변환해 백필함 — 그보다 더 오래된 문서(06-15~17)는 신기하게도 이미 억원/백만원
> 단위였음(FDR 전환 전 HTS 엑셀 시절 단위가 그대로 남아있던 것으로 추정). 앞으로 다른 과거
> 날짜를 새로 채울 일이 있으면 단위가 섞여있을 수 있으니 값 크기(예: marketCap > 10억)로
> 변환 여부를 먼저 확인할 것.
> **필드 추가/단위 변경 같은 스키마 변화가 아니어도, MongoDB의 기존 문서 내용 자체를 고친
> 경우(예: 스팩 종목 제거 + rank 재정렬, 2026-06-21)에도 똑같이 올려야 한다** — 안 그러면
> 이미 옛 데이터를 캐싱해둔 브라우저는 MongoDB가 고쳐진 뒤에도 옛 localStorage 캐시를 그대로
> 보여준다(실제로 겪음: 스팩 제거 후에도 화면에 계속 보임 → `CACHE_VERSION` 3→4로 해결).

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
