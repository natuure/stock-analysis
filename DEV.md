# 로컬 개발

```powershell
npm install && npm run build   # 또는 npm run dev
```

이 폴더(`Desktop\Claude\주식\거래대금, 등락률 분석`)는 더 이상 Google Drive와 동기화되지
않아(2026-06-29), `node_modules`를 직접 여기에 설치해도 `.bin/` 심링크가 깨지지 않는다 —
별도 폴더에 복사해 빌드 확인하던 우회 절차는 더 이상 필요 없음.

배포는 이 폴더에서 바로 `git push` → Vercel 자동 빌드.
