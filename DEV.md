# 로컬 개발

```powershell
# 빌드 확인 (Google Drive에서 npm install 불가 시)
Copy-Item -Recurse "g:\내 드라이브\Claude\주식\거래대금, 등락률 분석" "C:\stock-analysis-build" -Exclude node_modules,.git
cd C:\stock-analysis-build
npm install && npm run build
```

배포는 원본 경로에서 `git push` → Vercel 자동 빌드.

Google Drive 동기화 폴더 안에서는 `node_modules/.bin/` 심링크/실행 셈이 깨져서
`npm run dev`/`npm run build`가 바로 안 되는 경우가 있다. 위처럼 `C:\` 로컬 디스크에
복사한 임시 폴더에서 빌드 확인 후, 실제 커밋·푸시는 원본 Google Drive 경로에서 한다.
