# Task List: Voice Bot Pipeline Transition

- `[x]` 1. Create OpenAI TTS API route (`app/api/tts/route.ts`)
- `[x]` 2. Update RAG API route (`app/api/policy/answer/route.ts`) with simple/RAG query classification
- `[x]` 3. Remove old WebRTC token route (`app/api/realtime/token/route.ts`)
- `[x]` 4. Modify frontend component (`components/VoiceCounselorApp.tsx`) to implement the pipeline voice loop
- `[x]` 5. Verify the full application and check for compilation/runtime correctness
- `[x]` 6. Refine search domains, citation formatting, and timestamps
  - `[x]` Expand Tavily search include_domains in `app/api/policy/answer/route.ts` and set dynamic citation sections
  - `[x]` Update citation rendering in `components/VoiceCounselorApp.tsx` to display as light-blue underlined hyperlinks
  - `[x]` Add timestamp to RAG card footer and remove "음성 상담 종료" system message from timeline
  - `[x]` Verify typescript compilation and runtime behavior
- `[x]` 7. Integrate Jina Search API with dynamic fallback to Tavily
  - `[x]` Modify `app/api/policy/answer/route.ts` to implement Jina Search API (`s.jina.ai`) search & parsing
  - `[x]` Test typescript compilation using `npm.cmd run build`

## Phase 2: Multi-Engine Search Router (Replacing Jina priority with Google/Tavily)
- `[x]` 8. Implement Multi-Engine Search Router in `app/api/policy/answer/route.ts`
  - `[x]` Update environment checks to require `OPENAI_API_KEY` and *at least one* search key (`SERPER_API_KEY`, `TAVILY_API_KEY`, `JINA_API_KEY`).
  - `[x]` Implement Google Serper API search execution block.
  - `[x]` Implement Tavily API search execution block (open web search, removing domain filters).
  - `[x]` Keep Jina Search as a last-resort fallback.
  - `[x]` Wrap each search engine call in try-catch and cascade down the priority list.
  - `[x]` Dynamically update the RAG response's `searchEngine` field based on the active successful engine.
- `[x]` 9. Verify compilation with `npm.cmd run build`.

## Phase 3: Google Serper.dev RAG Search Optimization
- `[x]` 10. Implement Google Serper Search Optimization in `app/api/policy/answer/route.ts`
  - `[x]` Modify `generateSearchQuery` to build Google Search-friendly queries (double quotes for product names, filetype:pdf, key terms).
  - `[x]` Parse `answerBox` (Featured Snippets) and map to RAG context.
  - `[x]` Parse `peopleAlsoAsk` (related questions & answers) and map to RAG context.
  - `[x]` Dynamically append site filters (site:disclosure.idbins.com, etc.) for official policy queries.
  - `[x]` Merge all sources (AnswerBox, PeopleAlsoAsk, Organic) into a structured search context for the LLM.
- `[x]` 11. Verify compilation using `npm.cmd run build`.
- `[x]` 12. Commit and push code and documents (implementation plan, walkthrough, task list) to GitHub.

## Phase 4: Korean Jamo Fuzzy Corrector for STT Errors
- `[x]` 13. Create Korean Jamo decomposition & Levenshtein distance corrector utility in `lib/koreanFuzzy.ts`
- `[x]` 14. Write and execute test script `lib/test-fuzzy.ts` to verify fuzzy corrector logic
- `[x]` 15. Integrate fuzzy corrector in `app/api/policy/answer/route.ts`
- `[x]` 16. Verify full Next.js project compilation using `npm run build`
- `[x]` 17. Commit and push changes to GitHub
