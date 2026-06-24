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
- **"주요 뉴스" 카드의 "요약"·"트리거" 필드** (2026-06-22): AiCard에서 두 필드의 표시를 제거하고
  "원인"(`상승원인`) 내용만 보여줌. "원인" 라벨 텍스트도 같이 제거해 내용만 바로 표시. Claude
  Code가 분석 JSON을 생성할 때도 `한줄요약`/`트리거` 필드는 더 이상 만들지 않음
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **종목분석.py의 밸류에이션·공시 목록·네이버 뉴스/웹 검색·기업 개요 수집** (2026-06-24): 입력도
  "종목명/현재가/시가총액/발행주식수/유통주식수" 5개 수동 입력에서 종목명 하나로 축소. DART
  재무제표(연간 3~4개년 + 올해 진행 분기)만 수집하는 순수 데이터 수집 스크립트로 범위를 좁힘 —
  밸류에이션·서술형 내용은 결과 JSON을 보고 Claude Code가 직접 작성하는 구조로 정리
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **"핫한 테마" 표시 개수 제한** (2026-06-24): 분석 JSON에 테마가 몇 개든 화면엔 최대 6개까지만
  표시(`Analysis.jsx`의 `ThemeTable`, `MAX_THEMES=6`). Claude Code가 분석 JSON을 생성할 때도
  테마를 6개 이하로 작성 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **등락률 상위 50의 NXT 비중 큰 종목 누락 버그** (2026-06-24~25 수정): `RATE_MIN_AMOUNT`(거래대금
  300억)를 KIS 보강 "이전"(FDR 단독 거래대금)에 적용해서, NXT 체결 비중이 큰 종목(예: FDR 단독
  40억 vs KIS 통합 370억)이 후보군에서 통째로 빠지던 버그. 사전 후보 풀(`RATE_PRECHECK_MIN_AMOUNT`,
  30억)로 넓힌 뒤 KIS 보강 "이후" 통합 거래대금에 300억 기준을 다시 적용하는 2단계 필터로 수정
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **기업개요 고정 샘플 import** (`src/data/companyOverviewSample.json` 삭제, 2026-06-25): 종목
  검색 입력이 없어 삼성전자 결과 1건을 `CompanyOverviewView.jsx`가 직접 import해 쓰던 임시
  방편을 제거. 종목분석.py가 결과를 MongoDB `company_analysis`에도 저장하도록 바꾸고,
  `StockAnalysis.jsx`에 종목명 검색창(자동완성)을 추가해 `api/getCompanyOverview.js`로 조회한
  데이터를 `data` prop으로 넘기는 방식으로 교체 ([DATA_PIPELINE.md](DATA_PIPELINE.md),
  [FRONTEND.md](FRONTEND.md) 참고)
- **재무상태표·손익계산서 항목이 전부 `-`만 표시** (2026-06-25 수정): 레이아웃만 있고 값 계산이
  없던 `IncomeStatementView`/`BalanceSheetView`(`StockAnalysis.jsx`)에 종목 검색 결과(`data`
  prop)로 매출액·영업이익률·당기순이익·주당순이익과 CAPEX·재고자산·매출채권·현금 비중·
  부채비율을 계산하는 로직을 추가 — 기업개요와 동일하게 검색 전에는 "종목을 검색하세요"
  placeholder를 보여줌 ([FRONTEND.md](FRONTEND.md) 참고)
- **종목분석.py corp_code 부분일치 오매칭 버그** (2026-06-25 수정): `python 종목분석.py
  sk하이닉스`(소문자) 실행 시 정확 일치가 실패하고 부분일치로 폴백하면서, 입력 문자열에
  우연히 부분문자열로 포함된 무관한 회사 `이닉스`(종목코드 452400)에 매칭되고 실제
  `SK하이닉스`(000660)는 매칭되지 않는 사고가 발생 — MongoDB `company_analysis`에 종목코드
  452400 문서가 `이닉스`의 재무 데이터를 담은 채 이름만 `sk하이닉스`로 잘못 저장됐던 걸
  발견 즉시 삭제하고 재실행. `find_corp_code()`에 대소문자 무시 정확 일치 단계를 부분일치보다
  먼저 보도록 추가해 재발 방지 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **일지테크 매출액·기본주당이익 null 누락 버그** (2026-06-25 수정): `python 종목분석.py
  일지테크` 실행 결과 영업이익은 정상 추출됐는데 매출액·EPS만 `null`로 나옴 — DART 원본을
  직접 조회해보니 매출액은 `매출액`/`영업수익`이 아니라 `수익(매출액)`으로, EPS는 기존
  후보 3종이 아니라 `기본주당이익(손실)`(공백 없음+손실 표기)으로 보고된 게 원인. 두 계정명을
  각각 `REVENUE_NAMES`와 EPS 후보 목록에 추가하고 재실행해 정상값(매출액 8,550억·EPS 3,457원)
  확인 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
