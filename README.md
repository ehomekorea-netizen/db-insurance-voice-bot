# DB Insurance Voice Policy Bot MVP

DB손해보험 약관 기반 음성 상담봇 MVP입니다.

핵심 구조는 Realtime 음성 모델이 사용자의 intent를 파악하고 짧게 안내한 뒤, 긴 약관 답변은 백엔드에서 생성해 채팅창에 표시하는 방식입니다.

## What is included

- Next.js 앱
- OpenAI Realtime API `gpt-realtime-2` WebRTC 연결
- Realtime function tool: `prepare_policy_answer`
- 약관 검색/답변 API: `/api/policy/answer`
- Realtime client secret API: `/api/realtime/token`
- 샘플 약관 지식 베이스
- PRD 문서

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

`.env`에 서버 전용 API 키를 넣습니다.

```bash
OPENAI_API_KEY=sk-proj-...
```

브라우저에서 `http://localhost:3000`을 열고 `음성 연결`을 누릅니다. 마이크 권한이 필요합니다.

## Production note

현재 `lib/policyKnowledge.ts`는 MVP 샘플 데이터입니다. 실제 배포 전에는 다음이 필요합니다.

- DB손해보험 공식 약관 PDF/HTML 수집 및 사용 권한 확인
- 상품명, 문서 버전, 시행일, 조항, 페이지 metadata 추출
- OpenAI Vector Store 또는 자체 `pgvector` 인덱스 구축
- 공식 웹 검색은 DB손해보험 공식 도메인으로 제한
- 답변마다 약관 버전과 출처 표시
- 개인정보/민감정보 저장 정책 수립

## Suggested deployment

- App: Vercel
- DB/vector: Supabase Postgres + pgvector or OpenAI File Search
- Secrets: Vercel Environment Variables

