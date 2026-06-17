import time
import pandas as pd
import requests
from bs4 import BeautifulSoup

def get_wics_industry(code):
    \"\"\"
    종목코드를 입력받아 네이버 증권에서 WICS 업종명을 크롤링합니다.
    \"\"\"
    # 종목코드가 6자리가 아닐 경우를 대비해 앞자리를 0으로 채움 (예: '5930' -> '005930')
    code = str(code).zfill(6)
    url = f"[https://finance.naver.com/item/main.naver?code=](https://finance.naver.com/item/main.naver?code=){code}"

    # 봇 차단을 방지하기 위한 브라우저 헤더 설정
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
    }

    try:
        response = requests.get(url, headers=headers)
        response.encoding = "euc-kr"  # 네이버 금융 페이지의 EUC-KR 인코딩 대응
        soup = BeautifulSoup(response.text, "html.parser")

        # HTML 내에서 "WICS" 텍스트를 가진 th 태그를 탐색
        wics_element = soup.find("th", string="WICS")

        if wics_element:
            # <th>WICS</th> 태그 바로 다음에 오는 <td> 태그 안의 텍스트(업종명) 추출
            wics_name = wics_element.find_next("td").get_text(strip=True)
            return wics_name
        else:
            return "WICS 정보 없음 (ETF, ETN 또는 우선주 등)"

    except Exception as e:
        return f"오류 발생: {e}"


# --- 다중 종목 테스트 및 데이터프레임 변환 예시 ---
if __name__ == "__main__":
    # 1. 크롤링 대상 종목 정의 (종목명: 종목코드)
    target_stocks = {
        "삼성전자": "005930",
        "LG에너지솔루션": "373220",
        "현대차": "005380",
        "NAVER": "035420",
        "에코프로비엠": "247540",
        "한미반도체": "042700"
    }

    results = []

    print("=== WICS 업종 수집 및 분류 시작 ===")
    for name, code in target_stocks.items():
        wics_industry = get_wics_industry(code)
        results.append({
            "종목명": name,
            "종목코드": code,
            "WICS 업종": wics_industry
        })
        
        # 연속 요청 시 서버 부하 및 IP 차단 방지를 위한 짧은 휴식 (0.3초)
        time.sleep(0.3)

    # 2. 판다스 데이터프레임으로 시각화 및 정렬
    df_result = pd.DataFrame(results)

    print("\n=== 종목별 WICS 분류 결과 ===")
    print(df_result.to_string(index=False))
    
    # (선택 사항) 크롤링 결과를 CSV 파일로 보관하고 싶을 때 주석 해제
    # df_result.to_csv("wics_classification_result.csv", index=False, encoding="utf-8-sig")