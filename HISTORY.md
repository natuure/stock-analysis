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
