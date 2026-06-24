# 주식 거래대금·등락률 분석 — 프로젝트 컨텍스트

## 프로젝트 개요
매일 장마감 후 **Python 스크립트**가 FinanceDataReader로 KRX 전종목 시세를 자동 수집해
MongoDB에 저장 → 웹앱 달력에서 날짜 클릭 시 데이터·AI 분석 결과 자동 표시.
HTS 엑셀 수동 업로드 단계 없이 Python 스크립트 + MongoDB 기반으로 완전 자동화됨.
거래대금·등락률 상위 50은 FDR(KRX 단독) 후 KIS 통합(KRX+NXT, `FID_COND_MRKT_DIV_CODE=UN`)
데이터로 다시 보강함(2026-06-21) — NXT(대체거래소)에서 체결된 거래량·거래대금이 빠지지 않게.
종목 클릭 시 KIS(한국투자증권) Open API로 일봉·주봉 차트(이동평균선 포함)를 실시간 조회.
KIS 장애 시에만 토스증권 캔들 캐시(일봉만)로 폴백. 차트는 캔들이 아니라 OHLC 바 모양으로 표시됨.
달력에는 토·일 없이 월~금만 표시되고, 그 대신 각 행 맨 끝에 주차(W##) 칸이 있어 누르면
그 주(월~금) 코스피·코스닥 변동률을 보여준다(2026-06-22, 그 전에는 토요일 칸이었음).
`python 주간분석.py`가 FDR로 미리 계산해 MongoDB에 저장해두고 웹앱은 그 결과만 읽음
(실시간 KIS 호출 아님).
화면 상단에는 탭 3개(거래대금·등락률 분석 / 종목 분석 / 조건 검색)가 있고, 조건 검색은 아직
내용 미정인 "준비 중" placeholder 상태. **"종목 분석" 탭은 2026-06-25부터 내용이 채워짐** —
기업개요·재무상태표·손익계산서 3개 버튼이 실제로 동작(기업개요: PER/PBR/ROE/EV·EBITDA + 목표
PER·PBR·EV·EBITDA·WACC를 슬라이더로 조절하는 적정주가 4종 / 재무상태표·손익계산서: CAPEX·
재고자산·매출채권·현금 비중, 부채비율, 매출액·영업이익·영업이익률·당기순이익·주당순이익 등).
`python 종목분석.py 종목명`을 실행하면 MongoDB `company_analysis` 컬렉션에 저장되고, 탭 상단
검색창에 종목명을 입력(자동완성 지원)하면 3개 버튼 모두 바로 조회된다(2026-06-25, 종목 검색
자동 연동). 현금흐름표만 여전히 내용 미정 placeholder.

이 파일은 목차 역할만 한다 — 세부 내용은 아래 표에서 안내하는 파일을 직접 열어서 참고할 것.

---

## 데이터 흐름 (요약)

```
python 뉴스분석.py  ← 장마감 후 실행
    ├── FinanceDataReader로 전종목 + 코스피/코스닥 지수 수집
    ├── MongoDB stock_data 컬렉션 저장
    ├── 토스증권 캔들 미리 조회 → MongoDB candles 컬렉션 캐싱 (KIS 장애 시 폴백용)
    ├── Naver 뉴스 API 검색
    └── 분석결과/뉴스데이터_YYYYMMDD.json 저장
         ↓
Codex "분석해줘" 요청 → 분석결과/분석결과_YYYY-MM-DD.json 생성
         ↓
python 저장분석.py → MongoDB ai_analysis 컬렉션 저장

python 주간분석.py  ← 아무 때나 실행 가능 (별도 흐름, 위 일간 분석과 무관)
    └── FDR로 코스피/코스닥 주간(월~금) 변동률 계산 → MongoDB weekly_indices 컬렉션 저장
         ↓
웹앱: /api/getData, /api/getAnalysis 는 MongoDB만 읽어서 화면 표시
     (달력 주차(W##) 칸의 주간 변동률도 /api/getData가 weekly_indices를 같이 읽어 내려줌)
     /api/candles 는 KIS Open API를 직접 호출(실시간) → 실패 시에만 candles 캐시(토스) 폴백

python 종목분석.py 종목명  ← 단일 종목 재무제표·현재가 수집, 수동 실행
    ├── DART Open API로 최근 3~4개년 사업보고서 + 올해 진행 분기/반기보고서 수집
    ├── KIS Open API(UN, KRX+NXT 통합)로 현재가·시가총액·발행주식수 수집
    ├── 종목분석결과/{종목명}_{YYYYMMDD}.json 저장
    ├── MongoDB company_analysis 컬렉션 저장(_id=종목코드, upsert) → 웹앱 "종목 분석" 탭에서
    │     종목명 검색(자동완성)하면 /api/getCompanyOverview가 바로 조회해 표시 (2026-06-25)
    └── Codex가 이 JSON + dart-mcp/웹 검색으로 서술형 리포트(.docx) 작성 (수동, /종목분석
          스킬 참고, 웹앱 표시와는 별개의 산출물)
```

> ⚠️ **토스증권 API는 IP 허용 목록 기반**이라 Vercel 서버리스 함수(유동 IP)에서 직접 호출하면
> 막힌다. 반면 **KIS(한국투자증권) Open API는 IP 제한이 없음을 확인**(2026-06-20)했고, 캔들 조회는
> `api/candles.js`가 KIS를 직접 호출한다. 토스 호출은 고정 IP인 로컬 `뉴스분석.py`에서만 계속하며,
> 그 결과는 KIS 호출이 실패했을 때만 쓰이는 폴백 캐시다. 자세한 내용·이유는
> [DATA_PIPELINE.md](DATA_PIPELINE.md) 참고.

---

## 어떤 작업을 하려면 → 이 파일을 참고하세요

| 하고 싶은 작업 | 참고 파일 |
|---|---|
| 배포 구조, 폴더/파일 구조, MongoDB 스키마, API 엔드포인트, 환경변수 확인 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| `뉴스분석.py`/`저장분석.py`/`주간분석.py`/`종목분석.py` 사용법, FDR·토스·DART 데이터 수집 로직, vol/rate/indices/weekly_indices 데이터 구조, 캐시 버전(`CACHE_VERSION`) 규칙 | [DATA_PIPELINE.md](DATA_PIPELINE.md) |
| 화면/컴포넌트 구성(Tables·Analysis·StockChartPanel·IndexSummary·StockAnalysis·CompanyOverviewView), 디자인 토큰, 반응형 규칙 | [FRONTEND.md](FRONTEND.md) |
| 로컬 빌드·개발 환경 (Google Drive npm 이슈 우회) | [DEV.md](DEV.md) |
| 과거에 제거되거나 대체된 기능 이력 | [HISTORY.md](HISTORY.md) |
| Naver 뉴스 검색 쿼리 패턴 | [AI검색.md](AI검색.md) |

---

## 자주 헷갈리는 점 (빠른 참고)

- **체결강도 컬럼이 안 보임** → 의도된 동작. FDR 전환 시 제거됨 ([HISTORY.md](HISTORY.md)).
- **종목 클릭 캔들차트가 일부 종목만 보임** → 옛 동작이었음. KIS 전환(2026-06-20) 이후 해소됨 —
  이제 아무 종목이나 KIS로 실시간 조회됨 ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **종목 클릭 차트가 캔들이 아니라 막대(바차트) 모양** → 의도된 동작(2026-06-20 변경, 사용자 요청).
  양봉 검정·음봉 빨강이며 전역 상승/하락 색(`--c-up`/`--c-down`)과는 무관한 차트 전용 색상.
  컴포넌트명(`CandleChart`)·클래스명은 그대로 유지됨 ([FRONTEND.md](FRONTEND.md)).
- **"조건 검색" 탭이 비어있음** → 의도된 동작. 아직 내용 미정, 탭 구조만 만들어둔 상태
  ([FRONTEND.md](FRONTEND.md)). "종목 분석" 탭은 2026-06-25부터 내용이 채워짐 — 아래
  "`종목분석.py`가 '종목 분석' 탭을 채워주는 건가?" 참고.
- **종목 클릭 시 모달이 안 뜨고 표 안에서 바로 펼쳐짐** → 의도된 동작(2026-06-22, 사용자 요청).
  모달(`StockDetailModal.jsx`) 대신 클릭한 행 바로 아래에 인라인 아코디언으로 차트가 펼쳐짐
  (`StockChartPanel.jsx`), 같은 행 재클릭 시 접힘. 거래대금·등락률 표는 서로 독립적으로 펼침
  상태를 가짐 ([FRONTEND.md](FRONTEND.md)).
- **MongoDB 스키마를 바꿨는데 화면에 안 보임** → `src/utils.js`의 `CACHE_VERSION`을 올렸는지 확인
  (안 올리면 옛 localStorage 캐시가 새 필드를 영원히 안 가져옴, [DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **달력 주차(W##) 칸에 주간 변동률이 안 보임/안 바뀜** → `python 주간분석.py`를 실행해야 MongoDB
  `weekly_indices`가 채워짐/갱신됨. 실시간 KIS 호출이 아니라 이 스크립트를 수동 실행해야
  반영되는 구조임 ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **로컬에서 `npm run dev`/`npm run build`가 이상하게 실패함** → [DEV.md](DEV.md)의 Google Drive 우회 방법 사용.
- **`종목분석.py`가 "종목 분석" 탭을 채워주는 건가?** → 2026-06-25부터 그렇다(자동 연동 완료).
  "종목 분석" 탭은 기업개요·재무상태표·손익계산서·현금흐름표 4개 버튼으로 구성됐고, 기업개요·
  재무상태표·손익계산서 3개가 `종목분석.py` 출력 구조(DART 재무제표 + KIS 현재가)를 읽어 계산함
  — 기업개요는 PER/PBR/ROE/EV·EBITDA와 적정주가 슬라이더 4종(PER법·PBR법·EV/EBITDA법·DCF법),
  재무상태표·손익계산서는 CAPEX·재고자산·매출채권·현금 비중·부채비율과 매출액·영업이익률·
  당기순이익·주당순이익 등을 계산함. `python 종목분석.py 종목명`을 실행하면 결과가 MongoDB
  `company_analysis` 컬렉션에 저장되고, 탭 상단 검색창(자동완성 지원)에 종목명을 입력하면
  `/api/getCompanyOverview`가 바로 조회해 3개 버튼 모두에 표시 — 분석해둔 종목이 아니면
  "분석된 종목이 아닙니다" 안내가 뜬다. 현금흐름표만 내용 미정 placeholder
  ([DATA_PIPELINE.md](DATA_PIPELINE.md), [FRONTEND.md](FRONTEND.md)).
- **"거래대금 분석"/"등락률 분석" 카드(거래대금/시가총액 TOP5, 순위상승 TOP5, 상한가 종목)가
  안 보임** → 의도된 동작(2026-06-22, `Cards.jsx` 삭제). 거래대금/시가총액 비율은 거래대금
  표의 한 열(60일 신고가대비와 거래대금 사이)로 옮겨졌고, 상한가는 등락률 표의 `limit-up`
  강조로 대신함 ([HISTORY.md](HISTORY.md)).
- **거래대금·등락률 표에 "거래량" 컬럼이 안 보임** → 의도된 동작(2026-06-21). "60일
  신고가대비" 컬럼으로 교체됨 ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **종목 클릭 차트 아래에 시가/고가/저가/거래량 텍스트가 안 보임** → 의도된 동작(2026-06-21).
  대신 캔들 바로 아래에 일별 거래량 막대를 같이 그림 ([FRONTEND.md](FRONTEND.md)).
- **종목 클릭 차트의 가격축이 로그 스케일로 보임(가격 간격이 일정하지 않음)** → 의도된
  동작(2026-06-22, 사용자 요청). 토글 없이 항상 로그 스케일 ([FRONTEND.md](FRONTEND.md)).
- **"주요 뉴스" 카드에 "요약"/"트리거" 줄이 안 보임** → 의도된 동작(2026-06-22, 사용자 요청).
  `한줄요약`·`트리거` 필드와 "원인" 라벨 자체를 제거하고 `상승원인` 내용만 보여줌 — Codex가
  분석 JSON을 생성할 때도 이 두 필드는 더 이상 만들지 않음 ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **헤더 제목은 "GM Investment"인데 첫 번째 탭 이름·브라우저 탭 타이틀은 여전히 "주식
  거래대금·등락률 분석"** → 의도된 동작(2026-06-23, 사용자 요청). `Header.jsx`의 `header-title`
  텍스트만 바꾸는 요청이었고 `TopTabs.jsx`/`index.html`은 별개 요소라 그대로 둠
  ([FRONTEND.md](FRONTEND.md)).
- **모바일에서 종목 클릭 차트가 카드 밖으로 잘려 보임** → 과거 버그였음, 수정됨(2026-06-23).
  좁은 화면에서 표가 가로 스크롤될 때 인라인 차트도 표 폭만큼 같이 넓어지던 문제 — 이제
  `.tbl-card`의 실제 폭을 측정해 차트 폭으로 쓰고 `position: sticky`로 고정함
  ([FRONTEND.md](FRONTEND.md)).
- **"핫한 테마" 표가 6개까지만 보임(분석 JSON엔 더 있을 수도 있는데)** → 의도된 동작
  (2026-06-24, 사용자 요청). `Analysis.jsx`의 `ThemeTable`이 `MAX_THEMES=6`으로 7번째부터
  자름 — Codex가 분석 JSON을 생성할 때도 테마를 6개 이하로 작성함
  ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **등락률 상위 50에 거래대금은 작지만 등락률이 큰 종목이 빠져 있었음** → 과거 버그였음,
  수정됨(2026-06-24~25). 등락률 후보군을 FDR(KRX 단독) 거래대금 300억 기준으로 뽑다 보니,
  NXT(대체거래소) 체결 비중이 큰 종목(예: 로켓헬스케어 — FDR 단독 40억 vs KIS 통합 370억)이
  KIS 보강 대상에서조차 빠졌던 것. 사전 후보 풀 기준(`RATE_PRECHECK_MIN_AMOUNT`)을 30억으로
  낮춰 넓게 받은 뒤, KIS 보강 후 실제 통합 거래대금이 300억(`RATE_MIN_AMOUNT`) 이상인지
  다시 거르는 2단계 필터로 수정함 ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
