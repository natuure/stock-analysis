# 제거된 기능 / 변경 이력

- **브라우저 파일 업로드** (Upload.jsx 삭제): D/N/W 드래그앤드롭 → Python 스크립트로 대체
- **WICS 업종 분류** (getSectors.js 삭제, wics_cache 삭제): 업종 데이터 미표시
- **SectorBars 카드** (Cards.jsx): WICS 업종 분포 TOP5 카드 제거
- **sector 필드** (normVol/normRate): 종목 데이터에서 sector 필드 제거
- **HTS 엑셀 수동 업로드** (`데일리분석/` 폴더, parseExcel류 함수): FinanceDataReader 자동 수집으로 대체
- **체결강도 필드** (rate.contractStrength): FDR 전환으로 계산 불가하여 제거 (필요 시 별도 데이터 소스로 재도입 검토)
- **업종.py**: 미사용 스크립트 삭제
- **api/_toss.js** (Vercel에서 토스 API 직접 호출하던 모듈): IP 허용 목록 차단(`access_denied: IP address not allowed`)으로 폐기.
  대신 로컬 `뉴스분석.py`가 캔들을 미리 가져와 MongoDB `candles`에 캐싱하고 `api/tossQuote.js`는 그걸 읽기만 함
  ([ARCHITECTURE.md](ARCHITECTURE.md), [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **달력 토요일 칸** (2026-06-22): 토·일 칸 자체를 없애고, 그 자리에 주차(W##) 칸을 추가해
  누르면 그 주 코스피/코스닥 변동률을 보여주는 방식으로 교체 (`Calendar.jsx`, [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **Cards.jsx 전체** (2026-06-22): "거래대금 분석"(거래대금/시가총액 TOP5, 전일 순위상승
  TOP5)·"등락률 분석"(상한가 종목) 카드 섹션을 통째로 제거. 거래대금/시가총액 비율은
  거래대금 표 맨 왼쪽 열로 옮겼고, 상한가는 등락률 표의 `limit-up` 강조로 대신함
  ([FRONTEND.md](FRONTEND.md) 참고)
- **거래대금·등락률 표의 "거래량" 컬럼** (2026-06-21): "60일 신고가대비"(`high60Rate`) 컬럼으로
  교체. 종가 기준 60거래일 최고가 대비 등락률, 항상 0% 이하 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **종목 차트 하단 시가/고가/저가/거래량 텍스트 요약** (2026-06-21): 제거하고 캔들 바로 아래에
  일별 거래량 막대(같은 x축, 양봉 검정/음봉 빨강)를 그리는 방식으로 교체. 같은 시점에 가격축도
  선형 → 로그 스케일로 변경(2026-06-22) ([FRONTEND.md](FRONTEND.md) 참고)
- **종목 상세 차트 모달** (StockDetailModal.jsx 삭제, 2026-06-22): 화면 중앙 오버레이 모달 →
  클릭한 행 바로 아래에 펼쳐지는 인라인 아코디언 행으로 교체(StockChartPanel.jsx). 거래대금·
  등락률 표는 각자 독립적으로 펼침 상태를 가지며, 날짜/주간 변경 시 자동으로 접힘
  ([FRONTEND.md](FRONTEND.md) 참고)
