# Walkthrough: Voice Bot Pipeline Transition & Multi-Engine Search Router

기존 고비용 WebRTC Realtime API 방식에서 **비용 절감형 파이프라인(브라우저 SpeechRecognition + Next.js RAG + OpenAI TTS) 방식으로의 전환**을 완료한 데 이어, 웹 RAG 검색을 **Google Search (Serper.dev) 단독**으로 개편하고 가독성이 떨어지던 **RAG 리포트 카드 UI/UX 디자인을 프리미엄 디자인 규격으로 대폭 개선**하였습니다.

---

## 변경 사항 요약

### 1. 백엔드 API 레이어

#### 🔧 [MODIFY] [route.ts](file:///C:/Users/IN/./.gemini/antigravity/scratch/db-insurance-voice-bot/app/api/policy/answer/route.ts)
- **Google Search (Serper.dev) 단독 연동:**
  - Jina Search의 일시적 장애 및 Cloudflare 차단 문제와 Tavily의 한글 인덱스 제한을 감안하여, 사용자의 요구에 따라 **오직 Google Search (Serper.dev) API만 단독으로 사용**하도록 엔진을 최적화했습니다.
  - 검색 실패(Timeout, API 에러 등) 시 다른 검색엔진으로 우회하지 않고, 에러 로그를 기록한 뒤 즉시 **자체 보험 도메인 지식 분석(Zero-Crash)** 단계로 폴백합니다.

---

### 2. 프론트엔드 및 스타일링 레이어 (UI/UX 대대적 개편)

#### 🔧 [MODIFY] [VoiceCounselorApp.tsx](file:///C:/Users/IN/./.gemini/antigravity/scratch/db-insurance-voice-bot/components/VoiceCounselorApp.tsx)
- **조악한 시스템 이모지 제거 및 SVG 배지 도입:**
  - 제목 앞에 텍스트로 붙어있던 무딘 이모지(`🔍`, `💡`, `✅`, `⚠️`, `📋`, `🔗`)를 전부 걷어내고, 색상 테마와 선 굵기가 조화를 이루는 **정밀한 인라인 SVG 아이콘**으로 전면 교체했습니다.
  - 각 섹션마다 역할에 어울리는 원형 배지(`icon-badge`) 래퍼를 적용하여 시각적 구분을 명확히 했습니다.
- **클립보드 복사 버튼 시각화:**
  - 텍스트 버튼 형태에서 복사 아이콘 SVG가 포함된 정교한 인터랙티브 버튼으로 개선했습니다.

#### 🔧 [MODIFY] [globals.css](file:///C:/Users/IN/./.gemini/antigravity/scratch/db-insurance-voice-bot/app/globals.css)
- **프리미엄 폰트 패밀리 바인딩:**
  - 브라우저 기본 글꼴 대신 Next.js 레이아웃에서 최적화 로드하는 글로벌 구글 폰트인 **`Inter`** 및 **`Outfit`**을 CSS 변수(`--font-body`, `--font-display`)로 완벽 바인딩하여 텍스트 가독성을 최상으로 끌어올렸습니다.
- **Answer Card 리포트 레이아웃 전면 리팩토링:**
  - **테두리 & 섀도우:** 기존의 두꺼운 검은색 네오 브루탈리즘 테두리를 제거하고, 1px의 미세한 브랜드 테두리와 부드럽고 넓게 퍼지는 프리미엄 음영 효과(`box-shadow`)를 부여하여 깊이감 있는 카드 형태를 연출했습니다.
  - **섹션별 색상 테마 정밀화 (HSL/RGB soft palette):**
    - **질문 이해 및 판단 근거:** 산뜻한 블루 계열 배지 및 슬레이트 배경 (`#f8fafc` + `border-left: 3px solid #2563eb`)
    - **핵심 답변 요약:** 따뜻한 옐로우 톤 그라데이션 및 엠버 텍스트 테두리 (`linear-gradient` + `#fffbeb`)
    - **보장 대상 및 지급 조건:** 신뢰감을 주는 에메랄드 그린 배지 및 소프트 블릿 포인트
    - **보장 제외 및 면책 유의사항:** 주의를 끄는 부드러운 코랄 레드 배지 및 소프트 블릿 포인트
    - **서류 및 정보:** 가독성을 높인 인디고 블루 배지 및 소프트 블릿 포인트

---

## 검증 결과

- **빌드 성공 여부:** `npm.cmd run build` 테스트를 통과했으며 TypeScript 컴파일 에러 및 페이지 정적 추출 오류 없이 완벽히 동작합니다.
- **디자인 만족도:** 이모지의 시각적 노이즈가 사라지고 세련된 인라인 아이콘과 영역별 컬러 블록이 조화를 이루어 설계사가 답변 카드를 복사하거나 조회할 때 한눈에 핵심 내용이 드러납니다.
