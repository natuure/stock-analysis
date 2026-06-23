# 프론트엔드 — 화면 구성·컴포넌트·스타일

## 화면 구성 (현재, 위에서 아래 순서)

### 상단 탭 (App.jsx의 `topTab` 상태, TopTabs.jsx)
- `app-top`(Header+TopTabs를 함께 감싸는 sticky 영역) 안에 3개 탭
  1. **주식 거래대금·등락률 분석** — 기존 화면 전체(Calendar~Tables)
  2. **종목 분석** — 내용 미정, "준비 중" placeholder만 표시
  3. **조건 검색** — 내용 미정, "준비 중" placeholder만 표시
- 탭 전환은 클라이언트 상태로만 처리 (URL 라우팅 없음, react-router 미사용)

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

### Analysis.jsx — 3개 섹션
1. **핫한 테마** (ThemeTable)
   - 표 컬럼 순서: 테마 태그 | 핵심 재료 | 주요 종목 (전체 가운데 정렬)
   - `aiAnalysis.테마` 배열에서 렌더링
2. **주요 뉴스** (AiPanels)
   - 좌측 패널: 거래대금 상위 / 우측 패널: 등락률 상위
   - 모바일: 거래대금/등락률 탭 전환
   - 각 종목 카드: 종목명 + 테마 태그, 그 아래 `상승원인` 내용만 표시(2026-06-22부터 — `한줄요약`/
     `트리거` 필드와 "원인" 라벨 자체를 제거하고 원인 텍스트만 보여줌, [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
3. **분석 결과** (N파일 업로드 시, 현재 미사용)

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
