# 프론트엔드 — 화면 구성·컴포넌트·스타일

## 화면 구성 (현재, 위에서 아래 순서)

### 상단 탭 (App.jsx의 `topTab` 상태, TopTabs.jsx)
- `app-top`(Header+TopTabs를 함께 감싸는 sticky 영역) 안에 3개 탭
  1. **주식 거래대금·등락률 분석** — 기존 화면 전체(Calendar~Tables)
  2. **종목 분석** — `StockAnalysis.jsx`, 아래 절 참고
  3. **조건 검색** — 내용 미정, "준비 중" placeholder만 표시
- 탭 전환은 클라이언트 상태로만 처리 (URL 라우팅 없음, react-router 미사용)

### StockAnalysis.jsx (2026-06-24 도입, 2026-06-25 종목 검색 + 손익계산서·재무상태표 연동 추가)
- "종목 분석" 탭의 내용. 맨 위에 종목명 검색창(`.stock-search`, `<input list=>` + `<datalist>`로
  자동완성)이 있고, 그 아래 기업개요·재무상태표·손익계산서·현금흐름표 4개 버튼을 그리드로 표시
  (`.stock-analysis-tabs`, 데스크톱 4열 → 767px 이하 2열 `.stock-analysis-btn` 폰트/패딩도 같이
  축소 — 안 줄이면 2열 폭에서 "기업개요" 같은 4글자 라벨도 줄바꿈되어 깨짐, 직접 확인함).
  클릭하면 `active` 상태만 토글되고(파란 테두리+파란 글자) 해당 버튼의 뷰가 표시됨. 현금흐름표는
  아직 "준비 중" placeholder. 기업개요는 아래 별도 절 참고.
- **손익계산서·재무상태표 연동**(2026-06-25): `IncomeStatementView`/`BalanceSheetView`가
  `companyData`(검색으로 받은 종목분석.py 출력)를 `data` prop으로 받아 `annual_financials`의
  가장 최근 연도 값으로 계산함(`lastAnnual()`). 손익계산서는 매출액·영업이익·영업이익률(영업이익
  ÷매출액)·당기순이익(억원 단위, `fmtEok()`)·주당순이익(DART가 직접 보고하는 `기본주당이익_DART`
  원본 값, `fmtWon()` — 기업개요의 연환산 EPS와는 다른 값). 재무상태표는 CAPEX·재고자산·
  매출채권·현금 비중(각 항목÷자산총계, `ratioOf()`)과 부채비율(부채총계÷자본총계), 선수금·
  자본금·자본잉여금·이익잉여금(억원)을 보여줌. **"CAPEX 비중"은 실제 CAPEX(투자 현금흐름)가
  아니라 유형자산(보유 자산 스냅샷)으로 근사** — DART 본문 재무제표에 CAPEX 흐름 항목이 없어
  종목분석.py가 수집하는 항목 중 가장 가까운 유형자산으로 대신함. 종목을 검색하기 전에는
  기업개요와 마찬가지로 "종목을 검색하세요" placeholder가 보임(이전에는 항상 `-`만 표시).
- **연도별 추이 차트**(2026-06-25 추가, 사용자 요청): 손익계산서·재무상태표 둘 다 단일 최근값
  카드 아래에 23·24·25년 연간 + 올해 진행 중인 최신 분기/반기보고서까지 최대 4개 기간의 추이를
  그래프로 보여줌(`allPeriods()` — `annual_financials`의 연도들 + `quarterly_financials`
  배열의 마지막 항목 1개를 라벨 `"YYYY N분기"`로 이어붙임). **올해 분기 값은 연환산하지 않고
  보고된 실제값 그대로 사용**(사용자 요청) — 기업개요 탭 PER(선행)의 연환산 EPS와는 의도적으로
  다른 계산. 차트는 의존성 없는 순수 SVG로 직접 구현한 `TrendChart`(`type="bar"`|`"line"`,
  `CandleChart`와 같은 패턴 — `viewBox` + 좌표 변환 함수, 외부 차트 라이브러리 미사용)이며,
  손익계산서는 ① 매출액·영업이익·당기순이익 묶음 막대(억원) ② 영업이익률 꺾은선(%) ③
  주당순이익 꺾은선(원) 3개, 재무상태표는 ① CAPEX·재고자산·매출채권·현금 비중 꺾은선(%, 4계열)
  ② 부채비율 꺾은선(%) ③ 선수금·자본금·자본잉여금·이익잉여금 묶음 막대(억원, 4계열) 3개를
  그림. 값이 둘 이상인 계열은 캔들차트의 이동평균선 범례(`.candle-legend`)와 같은 패턴의
  `.trend-legend`로 색상-라벨을 표시. **분기 EPS를 보여주려고 종목분석.py의 `fetch_quarters()`에
  `기본주당이익_DART` 추출을 새로 추가**했음 — 이 필드 추가 전에 분석해둔 종목은 4번째(올해
  분기) 포인트의 EPS만 비어 보이므로 `python 종목분석.py 종목명`을 한 번 더 실행해야 채워짐
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고).
- **종목 검색 흐름**(2026-06-25): 마운트 시 `/api/getCompanyOverview`(code 없이)로 분석된
  전체 종목 목록(`{name, stock_code}[]`)을 받아 `<datalist>`에 채워 자동완성을 지원함. 검색창에
  종목명을 입력 후 엔터/조회 버튼을 누르면 그 목록에서 이름이 정확히 일치(없으면 부분일치)하는
  종목을 찾아 `stock_code`로 `/api/getCompanyOverview?code=`를 다시 호출, 받은 문서를
  `companyData` state에 저장해 `CompanyOverviewView`에 `data` prop으로 넘김. 목록에 없으면
  "분석된 종목이 아닙니다. 먼저 `python 종목분석.py 종목명`을 실행하세요" 안내(`.stock-search-msg`)를
  보여줌 — 종목 검색 자체가 KRX 전종목을 대상으로 하는 게 아니라 **이미 종목분석.py로 분석해
  MongoDB `company_analysis`에 저장된 종목만** 대상이라는 점에 주의.

### CompanyOverviewView.jsx (2026-06-25 도입, "기업개요" 버튼)
- PER(후행/선행)·PBR·ROE·EV/EBITDA 5개 지표를 `.fin-card`로 표시 후, "적정주가" 섹션에 PER법·
  PBR법·EV/EBITDA법·DCF법 4개 카드(`.val-grid`, 데스크톱 2열 → 767px 이하 1열)를 보여줌. 각
  카드는 가로 슬라이더(`<input type=range>`, `.val-slider-input`)로 목표 PER/PBR/EV·EBITDA
  배수 또는 WACC 할인율을 조절하면 적정주가가 실시간 재계산됨(React state, 헤드리스 브라우저로
  슬라이더 드래그 시 값이 실제로 바뀌는 것까지 확인함). **각 카드 맨 아래엔 `PriceRow`가
  현재가(왼쪽, `.val-current-price`, 회색)와 적정주가(오른쪽, `.val-fair-price`, 진한 글자)를
  같은 글자 크기(22px)로 나란히 보여줌**(`.val-price-row`, `justify-content: space-between`,
  2026-06-25 추가, 사용자 요청) — 적정주가만 있던 이전 `FairPrice`를 두 값을 같이 받는
  `PriceRow`로 교체. 현재가는 `CompanyOverviewView`가 `fin.price`(= `api/getCompanyOverview.js`가
  검색 시점에 KIS로 받아온 실시간 현재가)를 4개 카드 모두에 `currentPrice` prop으로 내려줌.
- **데이터는 `StockAnalysis.jsx`가 검색 결과로 받은 `data` prop**(종목분석.py 출력과 동일한
  구조: `quote`+`annual_financials`+`quarterly_financials`+`latest_report`) — 자체적으로
  fetch하거나 import하지 않는 순수 표시 컴포넌트. 이전에는 고정 샘플 1건(`src/data/
  companyOverviewSample.json`, 종목분석.py로 삼성전자를 실제로 돌려 받은 실데이터)을 직접
  import해 썼지만, 종목 검색이 연동되면서 그 파일은 삭제하고 props 기반으로 전환함(2026-06-25).
  `pickFinancials()`가 이 prop에서 계산에 필요한 값만 뽑아냄 — 계산 로직 자체는 변경 없음.
- **PER(선행) 연환산 규칙**(`annualizeNetIncome()`): 최신 보고서가 1분기보고서면 당기순이익
  ×4, 반기보고서면 ×2, 3분기보고서면 ×4/3, 사업보고서(연간 확정)면 그대로 — 사용자가 명시한
  단순 연환산 방식(작년 동기 대비 롤포워드가 아님, 종목분석.py에서 제거됐던 TTM 계산과는
  다른 더 단순한 방식으로 의도적으로 채택, 2026-06-25).
- **DCF법은 "간단한 고정 전제"로 단순화**(사용자 요청, 2026-06-25): 연환산 당기순이익을 FCF
  대용으로 써서 고정 성장률 3%·5년 투자기간·영구성장률 2%로 터미널 밸류를 구하고, WACC만
  슬라이더로 조절(`DCF_GROWTH_RATE`/`DCF_TERMINAL_GROWTH`/`DCF_YEARS` 상수). 실제 CAPEX·
  순운전자본 변동은 반영하지 않은 근사치 — WACC 슬라이더 최솟값(4%)은 영구성장률(2%)보다
  항상 높게 둬서 0으로 나누는 걸 방지.

### Header.jsx
- 제목 + 현재 보고 있는 날짜 표시 (이제 `.app-top` 안에서 TopTabs와 함께 sticky)
- 제목 텍스트는 "GM Investment"(2026-06-23, `header-title`만 변경) — 부제 줄(`header-sub`,
  날짜/업로드 안내)은 그대로 유지. **TopTabs의 첫 번째 탭 이름("주식 거래대금·등락률 분석")과
  브라우저 탭 타이틀(`index.html`)은 별개 요소라 안 바뀌었음** — 의도된 동작, 둘을 같은 텍스트로
  맞추려는 작업이 아니라 헤더 브랜딩만 바꾸는 요청이었음

### Calendar.jsx
- localStorage `analysis_dates` + MongoDB `serverDates` 합쳐서 초록 점 표시
- 날짜 클릭 → localStorage 우선(단, `_v === CACHE_VERSION`일 때만, [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고),
  없으면 MongoDB에서 로드 후 localStorage 캐시
- 주간(W##) 클릭 → 주간 요약 표시

### IndexSummary.jsx
- 달력 바로 아래, "오늘의 코스피/코스닥" 제목 + 2칸 그리드
- 각 칸: 라벨 → 큰 종가 → 변동 줄(`+199.60 (2.25%)` 형식, 상승 빨강/하락 파랑)
- `indices`가 없는 날짜(옛 데이터)는 아무것도 렌더링 안 함

### Analysis.jsx — 5개 섹션
1. **핫한 테마** (ThemeTable)
   - 표 컬럼 순서: 테마 태그 | 핵심 재료 | 주요 종목 (전체 가운데 정렬)
   - `aiAnalysis.테마` 배열에서 렌더링
2. **테마 카테고리 추이**(`ThemeCategoryTrend`, 2026-06-25 도입) — "시장이 지금 어떤 테마에
   주목하는지, 시간에 따라 어떻게 바뀌는지 한눈에" 보고 싶다는 사용자 요청으로 추가. `테마`
   필드는 매일 자유 텍스트라("반도체/마이크론서프라이즈" vs 다른 날 "반도체/HBM슈퍼사이클")
   날짜 간 비교가 안 돼서, 같은 테마 항목에 고정 어휘 `카테고리`(14개, [DATA_PIPELINE.md](DATA_PIPELINE.md)
   참고) 필드를 추가로 기록하고 그걸로 집계함. `App.jsx`가 마운트 시 1회
   `/api/getThemeTrend`(최근 14일치 `테마` 배열만)를 받아 `themeTrend` prop으로 내려주고(날짜
   캘린더 선택과 무관 — "현재 펄스"이므로 어느 날짜를 보고 있어도 항상 최근 14일 기준),
   `Analysis.jsx`의 `aggregateThemeTrend()`가 카테고리별 일별 등장 횟수로 집계해 등장 빈도
   상위 6개 카테고리를 표식 있는 꺾은선 그래프(`TrendChart`, type="line")로 보여줌(2026-06-25,
   사용자 요청으로 막대→꺾은선 변경 — 새로 등장한 테마를 더 쉽게 알아볼 수 있게. 미등장일은
   0으로 채워두므로 선이 기준선에 붙어있다가 처음 올라오는 지점이 그대로 "첫 등장일" 표식이
   됨). `ThemeTable` 바로 아래, "주요 뉴스" 위에 위치. 카테고리 데이터가 전혀 없으면(백필 전
   과거 데이터 등) 섹션 자체를 조용히 숨김 — `null`을 임의로 "기타"로 채우지 않음.
3. **거래대금·등락률 카테고리 비중**(`CategoryPieCarousel`, 2026-06-26 도입) — 선택한 날짜의
   거래대금/등락률 상위 50이 어떤 섹터에 쏠렸는지 도넛 차트 2장으로 보여줌(어느 섹터에
   수급이 쏠렸는지 한눈에 보고 싶다는 사용자 요청). 테마 카테고리 추이(고정 14일 창)와 달리
   현재 선택된 날짜 하나만의 스냅샷이라 별도 API 호출 없이 이미 로드된 `vol`/`rate`(숫자,
   `App.jsx`가 보유, 새로 `Analysis`에 prop으로 전달)와 `aiAnalysis.거래대금`/`등락률`(종목명+
   카테고리)을 종목명으로 매칭해 집계. **거래대금 차트는 종목별 `tradingVolume`(금액) 합산
   비중, 등락률 차트는 종목별 `changeRate`(%) 합산 비중**(사용자가 "종목 개수 비율" 대신
   명시적으로 선택 — 변동률 강도를 반영) — 가중치 기준이 서로 다름에 주의. 공유 순수 함수
   `aggregateByCategory(items, aiItems, valueKey)`가 두 경우 다 처리(`valueKey`만 다름).
   합산 결과를 내림차순 정렬해 상위 5개 카테고리만 색을 칠하고 나머지(소액 카테고리 + 카테고리
   없는/매칭 안 된 종목)는 모두 "기타" 한 슬라이스로 합쳐 도넛 차트(`PieChart.jsx`, TrendChart
   처럼 의존성 없는 순수 SVG)로 보여줌. **두 차트는 `.pie-carousel`(CSS `scroll-snap`)로 한
   화면에 하나씩 배치돼 가로로 스와이프하며 전환**(거래대금 ↔ 등락률), 아래 점 2개로 현재
   페이지 표시. **점은 클릭/탭으로도 페이지 이동 가능**(`scrollTo({ behavior: 'smooth' })`,
   2026-06-26 추가 — 스크롤바를 숨겨놔서 터치 스와이프가 없는 데스크톱 마우스 환경에서는
   스와이프 말고 페이지를 옮길 방법이 전혀 없었던 문제를 보완). `vol`/`rate`가 아직
   없거나(날짜 미선택) 그날 카테고리가 둘 다 하나도 없으면 섹션 자체를 조용히 숨김 — 한쪽만
   데이터가 없으면 그 페이지만 빈 채로 캐러셀은 정상 동작.
4. **주요 뉴스** (AiPanels)
   - 좌측 패널: 거래대금 상위 / 우측 패널: 등락률 상위
   - 모바일: 거래대금/등락률 탭 전환
   - 각 종목 카드: 종목명 + 테마 태그, 그 아래 `상승원인` 내용만 표시(2026-06-22부터 — `한줄요약`/
     `트리거` 필드와 "원인" 라벨 자체를 제거하고 원인 텍스트만 보여줌, [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
5. **분석 결과** (N파일 업로드 시, 현재 미사용)

### TrendChart.jsx (2026-06-25, StockAnalysis.jsx에서 추출)
의존성 없는 순수 SVG 추이 차트(`{periods, metrics, type:'bar'|'line', title}`) — 원래 종목
분석 탭의 재무 추이(연도별 매출액·영업이익 등) 전용으로 `StockAnalysis.jsx` 안에 있었는데,
"테마 카테고리 추이"에도 같은 모양(기간×지표)이 필요해져서 별도 파일로 분리하고 두 곳에서
import. 종목/날짜 등 특정 도메인 로직이 전혀 없는 범용 컴포넌트라 추출에 따른 동작 변화 없음.
팔레트 `TREND_PALETTE`도 같이 옮기며 4색 → 6색으로 확장(`MAX_THEMES=6`/카테고리 상위 6개와
정합) — 기존 재무 추이 차트는 여전히 4계열까지만 쓰므로 영향 없음.

### PieChart.jsx (2026-06-26 신규)
의존성 없는 순수 SVG **도넛** 차트(`{slices:[{label,value,pct,color}], title}`) —
"거래대금·등락률 카테고리 비중"(`CategoryPieCarousel`) 전용. `TrendChart`와 가장 큰 차이는
**원이 일그러지지 않게 정사각형 viewBox를 쓰고 `preserveAspectRatio`를 기본값(`xMidYMid
meet`)으로 둔다는 점**(`TrendChart`는 막대/꺾은선이라 `none`으로 비균일하게 늘려도 무방했지만,
원은 그러면 타원이 됨). 중앙에 구멍을 둔 도넛 형태(파이 아님, `innerR = outerR * 0.6`)이고,
슬라이스가 1개(100%)인 경우 SVG arc로 360도를 한 번에 못 그리는 한계를 피하려고 `<circle>`
두 개(채우기+구멍)로 대신 그림. 색상은 호출 쪽이 슬라이스마다 미리 정해서 넘기고(`TrendChart`
처럼 자체적으로 팔레트를 고르지 않음), "기타" 슬라이스는 `TREND_PALETTE[5]`가 아니라
`var(--c-muted)` 회색을 써서 진짜 상위 5개 섹터와 동급으로 안 보이게 시각적으로 구분.

### Tables.jsx
- 거래대금/시가총액 카드(구 Cards.jsx) 제거됨(2026-06-22) — 그 핵심 지표(`tradingVolume/marketCap`
  비율)는 거래대금 표의 한 열로 옮김. WICS 업종 분포 카드도 그 전에 이미 제거됨
  ([HISTORY.md](HISTORY.md) 참고)
- 거래대금·등락률 탭 전환 (모바일)
- 컬럼 클릭 정렬 (asc/desc)
- **거래대금 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 60일 신고가대비 | 거래대금/시가총액 | 거래대금
  (거래대금/시가총액 열은 처음엔 맨 앞이었다가 2026-06-22에 60일 신고가대비와 거래대금 사이로
  옮김 — 순위·종목명이 다시 표준 위치라 별도 CSS 재매핑 불필요해짐)
- **등락률 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 60일 신고가대비
- 등락률 표 제목 옆에 "(거래대금 300억 이상)" 보조 설명 표시(2026-06-22, `.tbl-head-note`) —
  후보 종목 필터 기준(`RATE_MIN_AMOUNT`)을 화면에도 명시 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- 60일 신고가대비(`high60Rate`): 항상 0% 이하(0 = 60일 신고가), 데이터 없으면 '-'
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- 상한가 행: `limit-up` 클래스 (연한 빨강 배경)
- 행 클릭 → 그 표 내부의 `expandedCode` state 토글 → 클릭한 행 바로 아래에 인라인 아코디언
  행(`<tr class="chart-row">`, colSpan으로 표 전체 폭)으로 차트 패널 표시. 같은 행 재클릭 시
  접힘. 거래대금·등락률 표는 각각 독립된 펼침 상태를 가짐(전역 공유 아님 — 2026-06-22 모달에서
  전환)
- **모바일 차트 잘림 버그 수정** (2026-06-23): 좁은 화면에서는 `tbody td`가 `white-space: nowrap`
  이라 표 자체가 카드 폭보다 넓어져 `.tbl-wrap`이 가로 스크롤된다. 펼쳐진 차트 행도 같은
  `<td colSpan>` 안에 있어서 표가 넓어진 만큼 같이 넓어져 카드 밖으로 잘려 보이는 문제가 있었음
  (표 셀의 `width`는 CSS만으로 줄일 수 없음 — 헤드리스 브라우저로 직접 재현·검증함). `Tables.jsx`의
  `useCardWidth` 훅이 `ResizeObserver`로 `.tbl-card`의 실제 폭(표 오버플로 영향 없음)을 측정해
  `StockChartPanel`에 `maxWidth`로 내려주고, `.chart-panel-body`에 `position: sticky; left: 0`을
  줘서 표를 가로로 스크롤해도 차트는 항상 카드 폭에 맞춰 고정 표시됨

### StockChartPanel.jsx
- 거래대금·등락률 표의 종목 행 클릭 시 그 행 바로 아래에 인라인으로 펼쳐짐(모달 아님).
  날짜/주간이 바뀌면(`vol`/`rate` 데이터 변경) 펼쳐진 행은 자동으로 접힘(VolTable/RateTable
  내부 `useEffect`)
- `/api/candles?symbol=&date=&period=`로 일봉/주봉 조회 (KIS Open API 실시간, 실패 시 토스 캐시 폴백
  — [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고) → SVG **OHLC 바차트**로 직접 렌더링 (차트 라이브러리 미사용)
  - 양봉(상승) 검정 `#000000`, 음봉(하락) 빨강 `#f04452` — 이 차트 전용 색상, 전역 `--c-up`/`--c-down`과는 무관
- **일봉/주봉 탭** (`PERIOD_TABS`): 일봉은 5일선·20일선, 주봉은 5주선·10주선 이동평균선 표시
  (5일선·5주선 파란 `#3182f6`, 20일선·10주선 보라 `#9b59b6`)
  - 표시 구간(60개) 양 끝까지 끊김 없이 그려지도록, 캐싱된 캔들 중 앞부분은 MA 계산에만 쓰고 차트엔 안 그림
- 가격축은 로그 스케일(2026-06-22) — OHLC 바·이동평균선 공통으로 `y()`가 로그 보간을 씀.
  거래량 막대는 선형 유지
- 차트 아래 시가·고가·저가·거래량 텍스트 요약은 제거됨 — 대신 캔들 바로 아래에 일별 거래량
  막대를 같은 x축으로 정렬해 표시(양봉 검정/음봉 빨강, 캔들과 동일 기준)

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

- 767px 이하: 거래대금·등락률 표 1열 + `seg-tabs`로 탭 전환
- 768px 이상: 거래대금·등락률 표 2열(`tables-grid`)
- 인라인 차트(`StockChartPanel`)는 폭이 표가 아니라 `.tbl-card` 측정값을 따르므로 767px 이하에서
  표가 가로 스크롤돼도 잘리지 않음(위 Tables.jsx "모바일 차트 잘림 버그 수정" 참고)
