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
- **종목분석.py corp_code는 맞게 찾아도 저장되는 이름 표기가 입력 원문 그대로 남는 잔여 버그**
  (2026-07-12 수정): 위 2026-06-25 수정으로 회사(corp_code/stock_code) 자체는 항상 올바르게
  찾게 됐지만, `find_corp_code()`가 매칭에 쓴 정식 회사명(대소문자 무시 일치로 찾아낸 키)을
  버리고 corp_code/stock_code 값만 반환하고 있어서, `main()`이 여전히 사용자가 타이핑한 원문
  (`sk하이닉스`, 소문자)을 `company_analysis.name`에 그대로 저장했다 — "종목 분석" 탭
  "시장관심도"가 `ai_analysis`의 `SK하이닉스`(대문자)와 문자열 정확 일치로 카테고리를 찾다가
  실패해 "미분류"로 표시되는 것을 사용자가 발견. `find_corp_code()`가 이제 정식 회사명을
  `{'name': ..., **corp_map값}` 형태로 함께 반환하고, `main()`은 이 정식명으로 저장한다
  (`api/_dart.js`의 `findCorpCode()`는 처음부터 이렇게 정식명을 반환하고 있어서 동일하게
  맞춤). 기존에 잘못 저장돼 있던 `company_analysis/000660`의 `name`도 `SK하이닉스`로 직접
  정정. 겸사겸사 `StockAnalysis.jsx`의 검색창 매칭도 대소문자 무시로 바꿈([FRONTEND.md](FRONTEND.md),
  [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **일지테크 매출액·기본주당이익 null 누락 버그** (2026-06-25 수정): `python 종목분석.py
  일지테크` 실행 결과 영업이익은 정상 추출됐는데 매출액·EPS만 `null`로 나옴 — DART 원본을
  직접 조회해보니 매출액은 `매출액`/`영업수익`이 아니라 `수익(매출액)`으로, EPS는 기존
  후보 3종이 아니라 `기본주당이익(손실)`(공백 없음+손실 표기)으로 보고된 게 원인. 두 계정명을
  각각 `REVENUE_NAMES`와 EPS 후보 목록에 추가하고 재실행해 정상값(매출액 8,550억·EPS 3,457원)
  확인 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **일지테크 유형자산 2025년 null 누락** (2026-06-25 수정, 사용자 제보): 2025년 사업보고서엔
  `유형자산` 라인이 없고 `기초 유형자산`만 있어 null로 나옴. 그 행의 전기·전전기 비교값이
  2024·2023년 사업보고서의 실제 `유형자산` 값과 정확히 일치하는 걸 대조 확인한 뒤
  `FIXED_ASSET_NAMES`에 `기초 유형자산`을 후보로 추가 — 재실행해 2025년 값(2,332억) 확인
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **달바글로벌 매출액·EPS 계정명 추가 누락** (2026-06-25 수정): `python 종목분석.py
  달바글로벌` 실행 결과 2024년 매출액과 모든 기간의 EPS가 `null`로 나옴 — DART 원본 확인
  결과 2024년 매출액은 `매출`(액 없음)로, EPS는 전 기간 `기본주당순이익`/`기본주당순이익
  (손실)`('주당이익'이 아니라 '주당순이익' 어순)으로 보고된 게 원인. `REVENUE_NAMES`·
  `EPS_NAMES`에 각각 추가하고 재실행해 정상값 확인 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **화신 영업이익·당기순이익 계정명 추가 누락** (2026-06-25 수정): `python 종목분석.py 화신`
  실행 결과 2025년 당기순이익과 올해 1분기 영업이익이 `null`로 나옴 — DART 원본 확인 결과
  '이익' 대신 '손익'을 쓴 `당기순손익`(2025 사업보고서)·`영업손익`(2026 1분기보고서)이
  원인. `NET_INCOME_NAMES`·신설 `OPERATING_INCOME_NAMES`에 각각 추가하고 재실행해 정상값
  확인 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **지배기업소유주지분이 재무상태표 아닌 포괄손익계산서 항목에 오매칭되는 버그** (2026-06-25
  수정, 영향도 높음): `python 종목분석.py 노바렉스` 실행 후 지배기업소유주지분이 자본총계의
  10~14%로 비현실적으로 작게 나와서 발견. 원인은 `지배기업 소유주지분`(공백 있는 표기)이
  재무상태표(BS)의 진짜 지배주주지분 라인뿐 아니라 포괄손익계산서(CIS)의 "총포괄손익 중
  지배기업 귀속분"(전혀 다른 의미의 흐름 항목)에도 똑같이 쓰여서, `extract_account()`가
  `sj_div`를 보지 않고 이름만 보다가 CIS 쪽을 먼저 매칭한 것. 이 값은 "기업개요" 탭의
  PBR·BPS·ROE 계산에 쓰여서, 비지배지분이 있는 종목은 이미 분석해둔 결과가 틀린 적정주가를
  보여주고 있었을 수 있음. `extract_account()`에 선택적 `sj_div` 인자를 추가해 `sj_div='BS'`로
  한정하도록 수정. 같은 김에 SK하이닉스가 `지배기업의 소유지분`('소유주지분'이 아니라
  '소유지분')을 써서 이 필드가 `null`로 비어있던 것도 발견해 후보에 추가 — 영향받은 종목
  (노바렉스·SK하이닉스) 재실행해 정상값 확인 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **카카오 EPS가 중단영업 분리 보고로 null 누락** (2026-06-25 수정): 당기순이익은 정상 추출됐는데
  2025년 사업보고서·2026년 1분기보고서 EPS만 `null`로 나옴 — 그 기간에 중단영업이 있어 단일
  `기본주당이익` 합계줄 없이 `계속영업 기본주당순이익`+`중단영업 기본주당순이익`으로만 나눠
  보고된 게 원인. 신설 `extract_eps()`가 기존 `EPS_NAMES`로 못 찾으면 이 두 계정을 합산하는
  폴백을 추가해 재실행, 정상값(2025년 1,118원, 2026년 1분기 390원) 확인
  ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **대한항공 자본잉여금·EPS 계정명 추가 누락** (2026-06-25 수정): `python 종목분석.py
  대한항공` 실행 결과 모든 기간의 자본잉여금과 2026년 1분기 EPS가 `null`로 나옴 — 자본잉여금은
  `자본잉여금` 자체를 안 쓰고 `기타불입자본`만 써서, EPS는 그 분기에 우선주가 있어 단일
  `기본주당이익` 없이 `보통주기본주당이익`/`우선주기본주당순이익`으로 나눠 보고된 게 원인.
  `CAPITAL_SURPLUS_NAMES`에 `기타불입자본`을 추가하고, `extract_eps()`에 일반 투자자 기준인
  `보통주기본주당이익`을 찾는 폴백을 추가(우선주 EPS는 오매칭 위험 때문에 후보에서 제외)해
  재실행, 정상값 확인 ([DATA_PIPELINE.md](DATA_PIPELINE.md) 참고)
- **기업개요 quote를 종목분석.py 실행 시점 가격에 고정해서 쓰던 방식 → 검색 시점 실시간
  조회로 교체** (2026-06-25, 사용자 제보): 종목분석.py가 MongoDB에 저장하는 `quote`를 그대로
  화면에 쓰면, 스크립트를 실행한 날 가격에 PER/PBR이 계속 고정돼버리는 문제가 있었음.
  `api/getCompanyOverview.js`가 `?code=` 단건 조회 시 KIS Open API로 현재가를 실시간으로
  다시 받아와 `quote`를 덮어쓰도록 변경(`api/candles.js`와 같은 "실시간 우선, 실패 시 저장값
  폴백" 패턴) — 저장된 `quote`는 이제 KIS 호출 실패 시에만 쓰는 폴백. KIS 접근토큰 발급·캐싱
  로직(`getKisToken`)을 candles.js에서 신설 `api/_kis.js`로 옮겨 두 라우트가 공유하도록 정리
  ([DATA_PIPELINE.md](DATA_PIPELINE.md), [ARCHITECTURE.md](ARCHITECTURE.md) 참고)
- **`TrendChart`의 보조(우측) y축(`metrics[i].axis: 'right'`)** (2026-06-28 도입 후 같은 날
  제거): ROE(%)와 주당순이익(원)을 한 차트에 합쳐 보여달라는 요청으로 추가했는데, 두 지표의
  크기 단위가 완전히 달라(ROE 10~30대, EPS 만원대) 같은 축에 그리면 ROE가 0 근처에 눌려 안
  보이는 문제가 있어 도입. 하지만 결국 사용자가 영업이익률·ROE·주당순이익 세 지표 모두
  독립된 단일 계열 막대 차트로 되돌리는 쪽을 선택해, 같은 날 보조 y축 지원 자체를 다시
  제거함 — 더 쓰는 곳이 없어짐 ([FRONTEND.md](FRONTEND.md) 참고)
- **"ETF 분석" 탭의 종목명 → 구성 ETF 검색 기능** (`EtfAnalysis.jsx`의 검색 섹션, `api/getEtfConstituents.js`,
  MongoDB `etf_constituents` 컬렉션, `ETF분석.py`의 `refresh_etf_constituents()`, `kis_etf_test.py`
  전부 삭제, 2026-07-06): 2026-07-04 도입 당시 KIS ETF 구성종목 API(`inquire-component-stock-price`)가
  VPN 차단으로 아예 안 됐고, 2026-07-05 VPN 해제 후에도 같은 ETF 코드를 반복 호출하면 응답이
  0건/30건으로 들쭉날쭉해 "평일 장중 재확인 후 전체 배치 실행"을 미뤄둔 상태였다 — 결국
  `etf_constituents` 컬렉션은 한 번도 채워진 적 없이 삭제됨. **랭킹 표(주간 ETF 등락률 상위 15)는
  삭제하지 않고 유지** — KIS를 쓰지 않고 FDR만으로 계산해 이 불안정성과 무관했기 때문. 다만 별도
  "ETF 분석" 탭 자체는 없애고, 그 표를 메인 화면 주간뷰의 카테고리 비중 도넛과 주간 종목 데이터
  표 사이로 옮김(`EtfRankTable.jsx` 신설). 랭킹 계산 로직(`etf_weekly_rank` 등)도 별도 `ETF분석.py`
  스크립트에서 `주간분석.py`로 흡수해, `python 주간분석.py` 한 번으로 vol/rate/etfRank가 모두
  채워지게 함 ([DATA_PIPELINE.md](DATA_PIPELINE.md), [ARCHITECTURE.md](ARCHITECTURE.md),
  [FEATURES.md](FEATURES.md) 참고)
- **RS Score 랭킹 계산이 `주간분석.py`에서 `rs랭킹.py`로 분리, 표시 위치도 주간뷰 →
  독립 탭으로 이동** (2026-07-11): 2026-07-11 도입 당일엔 `주간분석.py` 안에서 계산해
  `weekly_indices.rsRank`로 저장하고 주간뷰("금주의 코스피/코스닥" 아래, `EtfRankTable`
  다음)에 표시했으나, 같은 날 사용자가 결과를 보여줄 곳을 상단 탭 "RS랭킹"(구 "차트분석")
  으로 확정하면서 계산·저장 로직 전체를 별도 `rs랭킹.py`로 분리했다. 저장 위치도
  `weekly_indices.<주차>.rsRank`(주차별 문서)에서 새 컬렉션 `rs_ranking`의 단일 문서
  (`_id:'latest'`)로 바뀜 — 이 탭은 달력처럼 날짜를 선택해 과거를 보는 화면이 아니라
  "지금 기준 RS 랭킹"만 보여주면 되기 때문. `RsRankTable.jsx`는 주간뷰에서 빠지고
  `RsRankingView.jsx`(신설, `/api/getRsRanking` 자체 fetch)가 소유하는 컴포넌트로 옮겨짐.
  `rs_category_cache`(카테고리 영속 캐시)는 위치·이름 그대로 유지 — `rs랭킹.py`가 계속
  읽고 쓴다 ([DATA_PIPELINE.md](DATA_PIPELINE.md), [ARCHITECTURE.md](ARCHITECTURE.md),
  [FRONTEND.md](FRONTEND.md) 참고)
