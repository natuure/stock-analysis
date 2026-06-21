# 주식 거래대금·등락률 분석 — 프로젝트 컨텍스트

## 프로젝트 개요
매일 장마감 후 **Python 스크립트**가 FinanceDataReader로 KRX 전종목 시세를 자동 수집해
MongoDB에 저장 → 웹앱 달력에서 날짜 클릭 시 데이터·AI 분석 결과 자동 표시.
HTS 엑셀 수동 업로드 단계 없이 Python 스크립트 + MongoDB 기반으로 완전 자동화됨.
종목 클릭 시 KIS(한국투자증권) Open API로 일봉·주봉 차트(이동평균선 포함)를 실시간 조회.
KIS 장애 시에만 토스증권 캔들 캐시(일봉만)로 폴백. 차트는 캔들이 아니라 OHLC 바 모양으로 표시됨.
달력의 토요일 칸은 그 주(월~금) 코스피·코스닥 변동률을 보여주는데, `python 주간분석.py`가
FDR로 미리 계산해 MongoDB에 저장해두고 웹앱은 그 결과만 읽음 (실시간 KIS 호출 아님).
화면 상단에는 탭 3개(거래대금·등락률 분석 / 종목 분석 / 조건 검색)가 있고, 종목 분석·조건 검색은
아직 내용 미정인 "준비 중" placeholder 상태.

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
Claude Code "분석해줘" 요청 → 분석결과/분석결과_YYYY-MM-DD.json 생성
         ↓
python 저장분석.py → MongoDB ai_analysis 컬렉션 저장

python 주간분석.py  ← 아무 때나 실행 가능 (별도 흐름, 위 일간 분석과 무관)
    └── FDR로 코스피/코스닥 주간(월~금) 변동률 계산 → MongoDB weekly_indices 컬렉션 저장
         ↓
웹앱: /api/getData, /api/getAnalysis 는 MongoDB만 읽어서 화면 표시
     (달력 토요일 칸의 주간 변동률도 /api/getData가 weekly_indices를 같이 읽어 내려줌)
     /api/candles 는 KIS Open API를 직접 호출(실시간) → 실패 시에만 candles 캐시(토스) 폴백
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
| `뉴스분석.py`/`저장분석.py`/`주간분석.py` 사용법, FDR·토스 데이터 수집 로직, vol/rate/indices/weekly_indices 데이터 구조, 캐시 버전(`CACHE_VERSION`) 규칙 | [DATA_PIPELINE.md](DATA_PIPELINE.md) |
| 화면/컴포넌트 구성(Cards·Tables·Analysis·StockDetailModal·IndexSummary), 디자인 토큰, 반응형 규칙 | [FRONTEND.md](FRONTEND.md) |
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
- **"종목 분석"/"조건 검색" 탭이 비어있음** → 의도된 동작. 아직 내용 미정, 탭 구조만 만들어둔
  상태 ([FRONTEND.md](FRONTEND.md)).
- **MongoDB 스키마를 바꿨는데 화면에 안 보임** → `src/utils.js`의 `CACHE_VERSION`을 올렸는지 확인
  (안 올리면 옛 localStorage 캐시가 새 필드를 영원히 안 가져옴, [DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **달력 토요일 칸에 주간 변동률이 안 보임/안 바뀜** → `python 주간분석.py`를 실행해야 MongoDB
  `weekly_indices`가 채워짐/갱신됨. 실시간 KIS 호출이 아니라 이 스크립트를 수동 실행해야
  반영되는 구조임 ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
- **로컬에서 `npm run dev`/`npm run build`가 이상하게 실패함** → [DEV.md](DEV.md)의 Google Drive 우회 방법 사용.
