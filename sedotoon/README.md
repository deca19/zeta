# 세로툰 (폰 앱)

폰 안에서만 돌아가는 세로 웹툰 제작 앱이에요. 서버도 PC도 결제도 없어요.

- **대사 AI**: Qwen3.5 0.8B가 폰 브라우저 안에서 WebGPU로 돌아가요. 그림을 보고 한국어 대사를 써요.
  - 처음 한 번 약 1GB를 받아요. 그 뒤로는 인터넷 없이도 써요.
- **그림**: 폰 그림 앱에서 무료로 뽑아요.
  - 안드로이드: Local Dream
  - 아이폰: Draw Things
  - 그림 앱에 붙여 넣을 프롬프트는 이 앱이 컷마다 만들어 줘요.
- **필요한 브라우저**: 안드로이드는 최신 Chrome, 아이폰은 iOS 26 이상 Safari (WebGPU 때문)

## 올리는 법 (HTTPS 주소가 필요해요)

이 폴더의 파일 6개를 GitHub Pages나 Netlify에 그대로 올리면 돼요.

1. index.html
2. sw.js
3. manifest.webmanifest
4. icon-192.png
5. icon-512.png
6. README.md

## 설치

1. 폰에서 그 주소를 열어요.
2. 홈 화면에 추가해요.
   - 안드로이드 Chrome: ⋮ → 앱 설치
   - 아이폰 Safari: 공유 → 홈 화면에 추가
