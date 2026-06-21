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
   - 각 종목 카드: 종목명 + 테마 태그, 요약·원인·트리거 라벨 후 내용 다음 줄
3. **분석 결과** (N파일 업로드 시, 현재 미사용)

### Tables.jsx
- 거래대금/시가총액 카드(구 Cards.jsx) 제거됨(2026-06-22) — 그 핵심 지표(`tradingVolume/marketCap`
  비율)는 거래대금 표 맨 왼쪽 열로 옮김. WICS 업종 분포 카드도 그 전에 이미 제거됨
  ([HISTORY.md](HISTORY.md) 참고)
- 거래대금·등락률 탭 전환 (모바일)
- 컬럼 클릭 정렬 (asc/desc)
- **거래대금 컬럼**: 거래대금/시가총액 | 순위 | 종목명 | 현재가 | 등락률 | 60일 신고가대비 | 거래대금
  - 거래대금/시가총액 열만 맨 앞에 있어, 이 표(`.vol-table` 클래스)에 한해 순위·종목명 칸
    스타일을 한 칸씩 다시 매핑함(`styles.css`) — 등락률 표는 영향 없음
- **등락률 컬럼**: 순위 | 종목명 | 현재가 | 등락률 | 60일 신고가대비
- 60일 신고가대비(`high60Rate`): 항상 0% 이하(0 = 60일 신고가), 데이터 없으면 '-'
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- 상한가 행: `limit-up` 클래스 (연한 빨강 배경)
- 행 클릭 → `onRowClick` → `StockDetailModal` 오픈

### StockDetailModal.jsx
- 거래대금·등락률 표의 종목 행 클릭 시 오버레이 모달로 표시
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
