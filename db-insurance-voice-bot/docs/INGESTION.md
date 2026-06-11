# 약관 인덱싱 설계

실제 서비스로 전환하려면 `lib/policyKnowledge.ts`의 샘플 데이터를 공식 약관 인덱스로 교체합니다.

## 권장 chunk schema

```json
{
  "id": "dbins-product-code-version-section",
  "company": "DB손해보험",
  "product": "상품명",
  "documentTitle": "약관명",
  "version": "시행일 또는 개정일",
  "section": "조항명",
  "page": 12,
  "sourceUrl": "https://...",
  "content": "조항 원문",
  "keywords": ["실손", "입원", "면책"]
}
```

## 검색 기준

- 1차: 상품명/특약명/조항명 keyword filter
- 2차: semantic search
- 3차: 조항 우선순위 rerank
- 4차: 답변 생성 전 citation 필수 확인

## 추천 구현

빠른 MVP:

- OpenAI File Search + Vector Store
- 약관 PDF 업로드
- 답변 시 `file_search` citation 사용

운영형:

- PDF parser
- Postgres + pgvector
- BM25 + vector hybrid search
- 조항/상품/시행일 metadata filter
- 답변 citation formatter
