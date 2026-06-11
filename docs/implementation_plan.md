# Implementation Plan - Google Serper.dev RAG Search Optimization

This plan optimizes the Google Serper.dev search integration in `route.ts` to maximize RAG accuracy and reasoning quality using Serper's advanced features, query structures, and filters.

## Proposed Changes

### 1. API Route Layer

#### [MODIFY] [route.ts](file:///C:/Users/IN/./.gemini/antigravity/scratch/db-insurance-voice-bot/app/api/policy/answer/route.ts)
- **Optimize Query Optimizer LLM (`generateSearchQuery`):**
  - Refine system prompt to instruct GPT to generate Google Search-friendly queries:
    - Enclose exact product names in double quotes (e.g. `"참좋은운전자보험"`).
    - Remove conversational Korean particles (조사).
    - Append `filetype:pdf` or `약관` keywords when the intent is to find specific policy rules or booklets.
- **Dynamic Query Enrichment (Search Filters):**
  - If the query relates to official rules, coverage limits, deductibles, or claims, dynamically append official domain constraints to the search query sent to Serper.dev:
    - `site:disclosure.idbins.com OR site:idbins.com OR site:fss.or.kr OR site:knia.or.kr`
    - This restricts search results strictly to DB Insurance official pages, FSS, and Knia to ensure 100% official compliance.
- **Leverage Advanced Serper.dev Features:**
  - Parse `answerBox` (Google's Featured Snippets) if returned by Serper.
  - Parse `peopleAlsoAsk` (related questions and answers) to capture Google's structured Q&A data.
  - Parse `organic` search results.
- **Structure Search Context for the RAG LLM:**
  - Feed these distinct sources to the RAG answering LLM with clear headers:
    - `[구글 추천 답변 (AnswerBox)]`
    - `[연관 Q&A (People Also Ask)]`
    - `[공식 웹 검색 결과 (Organic)]`
  - Update citation formatting to handle links from `answerBox` or `organic` cleanly.

---

## Verification Plan

### Automated Tests
- Run `npm.cmd run build` to verify there are no compilation or type check issues.

### Manual Verification
- Test with queries like "올해 6월 참좋은운전자보험 개정" and verify that:
  - Official DB Insurance sites are searched.
  - AnswerBox data is successfully injected into the prompt.
  - The final answer cites official sources.
