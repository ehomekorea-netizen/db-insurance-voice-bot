import { NextResponse } from "next/server";
import { buildPolicyAnswer, classifyIntent, type PolicyIntent, samplePolicyChunks, type PolicyChunk } from "@/lib/policyKnowledge";
import { correctInsuranceTerms } from "@/lib/koreanFuzzy";

export const runtime = "edge";

function getUUIDShort(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try {
      return crypto.randomUUID().substring(0, 8);
    } catch {
      // fallback
    }
  }
  return Math.random().toString(36).substring(2, 10);
}

type PolicyAnswerRequest = {
  question?: string;
  intent?: PolicyIntent;
  product_hint?: string;
};

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Local database chunks lookup helper removed per client request to focus 100% on search grounding.

function generateHeadline(question: string, summary: string): string {
  // Apply Korean Jamo Fuzzy Corrector first on the topic to avoid typos in headline
  const correctedQuestion = correctInsuranceTerms(question);
  const q = correctedQuestion.toLowerCase();
  let topic = "";
  if (q.includes("골절")) topic = "골절 진단비";
  else if (q.includes("문질")) topic = "골절 사고";
  else if (q.includes("도수")) topic = "도수치료 실손";
  else if (q.includes("백내장") || q.includes("다초점")) topic = "백내장 수술비";
  else if (q.includes("실손") || q.includes("실비")) topic = "실손 의료비";
  else if (q.includes("수술")) topic = "수술비 담보";
  else if (q.includes("서류") || q.includes("청구")) topic = "보험금 청구 서류";
  else {
    topic = correctedQuestion.length > 15 ? correctedQuestion.substring(0, 15) + "..." : correctedQuestion;
  }

  const s = summary.toLowerCase();
  let action = "안내";
  if (s.includes("제외") || s.includes("면책") || s.includes("보상하지 않")) {
    action = "지급 제외 안내";
  } else if (s.includes("지급") || s.includes("보장")) {
    action = "지급 기준 및 조건";
  } else if (s.includes("서류") || s.includes("준비")) {
    action = "필수 구비 서류";
  }

  return `"${topic} ${action}"`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as PolicyAnswerRequest & { userId?: string };
  let question = body.question?.trim();
  const productHint = body.product_hint?.trim();
  const userId = body.userId?.trim();

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }


  // Apply Korean Jamo Fuzzy Corrector to clean up STT typos
  const originalQuestion = question;
  question = correctInsuranceTerms(question);
  if (originalQuestion !== question) {
    console.log(`[STT Auto-Correct] "${originalQuestion}" -> "${question}"`);
  }

  const now = new Date();
  const currentDateString = now.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }); // e.g. "2026년 6월 12일 금요일"

  const geminiKey = process.env.GEMINI_API_KEY;

  // 디버깅용 로그 추가: Vercel 콘솔 로그에서 실제 키 유입 상태를 식별하기 위함
  console.log(`[GEMINI_API_KEY Debug] 로드 여부: ${!!geminiKey}, 길이: ${geminiKey ? geminiKey.length : 0}, 앞 5글자: "${geminiKey ? geminiKey.substring(0, 5) : "없음"}"`);

  // Save user's question to chat logs in the background (non-blocking)
  if (userId && question) {
    try {
      const { saveChatMessage } = await import("@/lib/firebase");
      saveChatMessage(userId, "user", question).catch(err => {
        console.error("[Firebase Log] Failed to save user message:", err);
      });
    } catch (importErr) {
      console.error("[Firebase Log] Failed to import saveChatMessage:", importErr);
    }
  }

  // FALLBACK: If Gemini API Key is not configured, fallback to local sample data
  if (!geminiKey || geminiKey === "your-gemini-api-key-here" || geminiKey.trim() === "") {
    console.warn("경고: GEMINI_API_KEY가 설정되지 않아 로컬 MVP 샘플 데이터로 응답합니다.");
    const fallbackAnswer = buildPolicyAnswer({
      question,
      intent: body.intent ?? classifyIntent(question),
      productHint: body.product_hint
    });
    fallbackAnswer.searchEngine = "로컬 MVP 샘플 데이터";
    fallbackAnswer.modelName = "Gemini 3.1 Flash-Lite";

    // Save fallback response as assistant message in the background
    if (userId) {
      try {
        const { saveChatMessage } = await import("@/lib/firebase");
        const answerText = `[요약]\n${fallbackAnswer.summary}\n\n[조건]\n${fallbackAnswer.conditions.join("\n")}\n\n[주의사항]\n${fallbackAnswer.cautions.join("\n")}`;
        saveChatMessage(userId, "assistant", answerText).catch(() => {});
      } catch {}
    }

    return NextResponse.json(fallbackAnswer);
  }

  try {
    // Local knowledge base chunk integration removed per client request.

    // 2. Query Gemini API with built-in Google Search Grounding tool
    const useWebSearch = process.env.ENABLE_OFFICIAL_WEB_SEARCH !== "false";
    
    // 공식 신뢰성 검증 도메인 화이트리스트 지정
    const whitelistDomains = [
      "disclosure.idbins.com",  // DB손해보험 공식 상품공시실
      "idbins.com",             // DB손해보험 공식 사이트
      "fss.or.kr",              // 금융감독원
      "fsc.go.kr",              // 금융위원회
      "knia.or.kr",             // 손해보험협회
      "klia.or.kr",             // 생명보험협회
      "korea.kr",               // 대한민국 정책브리핑
      "law.go.kr",              // 국가법령정보센터
      "kidi.or.kr",             // 보험개발원
      "nhis.or.kr",             // 국민건강보험공단
      "hira.or.kr"              // 건강보험심사평가원
    ];
    const searchOperator = whitelistDomains.map(dom => `site:${dom}`).join(" OR ");
    const queryText = useWebSearch
      ? `[PA 질문]\n${question}\n\n(참조 대상 제한: ${searchOperator})`
      : `[PA 질문]\n${question}`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: queryText
            }
          ]
        }
      ],
      tools: useWebSearch ? [
        {
          google_search: {}
        }
      ] : undefined,
      systemInstruction: {
        parts: [
          {
            text: `당신은 DB손해보험 PA(설계사)의 영업 활동을 지원하고 보험 약관, 고객 응대, 영업 지원, 상품 설명 등 보험 업무 전반에 대해 가이드해 주는 인공지능 멘토 '프로미'입니다.
사용자는 보험 설계사 또는 지점 임직원(보험 전문가)입니다. 
현재 시점 정보: ${currentDateString}

[중요: 포맷 및 답변 지침]
- **[매우 중요: 헤드라인 제목 생성 규칙]** 당신은 답변 본문을 작성하기에 앞서, **가장 첫 줄에 이 답변의 핵심 요지를 직관적으로 한눈에 설명해 줄 15자 내외의 세련된 제목을 반드시 다음 대괄호 형식으로 작성**하십시오. 질문에 STT 오타(예: '질비')가 섞여 있더라도, 제목에는 반드시 올바른 표준 보험 용어(예: '실비' 또는 '실손보험')로 교정하여 작성하십시오. 인트로/아웃트로 사설은 절대 쓰지 말고 오직 아래의 형식으로 즉시 시작하십시오.
  * 형식: \`[제목: 4세대 및 5세대 실손보험 비교 분석]\`
- **[매우 중요: 구글 검색 도구 사용 시 출처 및 쿼리 제약 조건]**
  * 구글 실시간 검색 도구를 사용할 때, 신뢰할 수 있고 공인된 정보만을 수집하기 위해 반드시 다음의 도메인들만을 타겟팅하여 검색어(query)를 생성하거나 참조해야 합니다.
    - 금융감독원/금융위원회: \`fss.or.kr\`, \`fsc.go.kr\`
    - DB손해보험: \`idbins.com\`, \`disclosure.idbins.com\`
    - 보험협회/개발원: \`knia.or.kr\`, \`klia.or.kr\`, \`kidi.or.kr\`
    - 정부정책/법령: \`korea.kr\`, \`law.go.kr\`
    - 보건의료 기관: \`nhis.or.kr\`, \`hira.or.kr\`
  * 검색 쿼리에 반드시 \`site:도메인\`을 조합(예: \`site:fss.or.kr 5세대 실손의료비\`)하여 검색 범위를 엄격히 제약하십시오.
  * 개인 블로그, 카페(네이버, 다음 등), 비공식 커뮤니티 및 일반 찌라시 언론 정보는 검색 결과에서 철저히 배제하고, 상기의 공식 도메인에서 조회된 정보만을 핵심적인 보장 판단 기준으로 삼으십시오.
- 만약 사용자의 질문이 보험 업무, 약관, 고객 응대, 영업 지원과 전혀 무관한 일반적인 사담(예: 오늘 날씨, 일상 대화, 유머, 일반 상식, 인사 등)인 경우, [분석 배경 및 이해], [조건], [주의사항] 헤더를 모두 생략하고 오직 다음 한 문장의 텍스트만 출력하십시오: "저는 DB손해보험 PA 분들의 영업 활동을 돕는 인공지능 멘토 프로미입니다. 보험이나 영업 관련 질문을 입력해 주시겠어요?" (이 경우 구글 검색 도구를 호출하지 마십시오.)
- 인사말이나 인트로 문구(예: "~이해하기 쉽게 정리해 드릴게요", "반갑습니다")와 아웃트로 사설은 불필요한 토큰 낭비이므로 **절대 쓰지 마십시오.** (단, 위의 보험 무관 질문에 대한 거절 답변은 제외)
- 반드시 아래의 대괄호 헤더로 **즉시 본론부터 기재를 시작**하십시오.
- 약관 지급 기준이나 보장 부위(예: 5대 골절의 구체적 대상 등)는 일반적인 원론에 그치지 말고, **번호나 불릿 기호 리스트를 활용하여 아주 명확하고 구체적인 팩트 위주로 일목요연하게 서술**하십시오.
- 사용자가 '올해', '현재', '최근', '이번에'라고 언급하면 현재 시점인 ${currentDateString}를 기준으로 판단하십시오.
- 사용자의 질문은 음성 인식(STT) 과정에서 발음 오타(예: '나비면제' -> '납입면제', '수치료/도수치로' -> '도수치료', '실선' -> '실손', '포장' -> '보장')로 입력될 수 있으므로, 문맥상 이를 알아듣고 올바른 보험 단어로 정정하여 이해하십시오.
- 특히 사용자가 "다리가 문질러졌다", "문질러졌고"라고 질문하면 100% "부러졌다/골절"의 STT 오류이므로, 이를 "다리가 부러진 골절 사고"로 정정해서 이해하여 골절 진단비 및 5대 골절의 정의를 설명하십시오.
- **[매우 중요]** 사용자의 질문을 내부적으로 보험 단어로 정정하여 이해했을 때, 답변 본문(특히 [분석 배경 및 이해])에 "다리가 문질러졌다는 골절의 STT 오타이므로 골절 사고로 정정해서 이해하고 답변을 작성합니다" 같은 **AI의 내부 보정 규칙이나 독백, 개발용 메타 설명을 절대 답변 텍스트로 노출하지 마십시오.** 사용자는 백엔드의 보정 알고리즘을 알 필요가 없으므로, 조용히 속으로만 정정하여 오직 정정된 골절 담보의 약관 팩트만 서술해 주십시오.
- **[매우 중요: 가독성 극대화 및 볼드 처리]** 사용자가 필수 청구 서류명(예: 진단서, 영수증, 세부내역서 등), 핵심 보장 조건, 지급 면책 조항, 보장 한도 금액 등의 중요 정보를 한눈에 빠르게 파악할 수 있도록, **질문의 핵심 대답이 되는 단어와 필수 청구 서류명은 반드시 마크다운 두꺼운 글씨(볼드: **단어**)로 감싸서 강조**하여 출력하십시오.
  * 단, 지급 조건이나 불릿 리스트를 기재할 때, 각 항목의 앞 제목(예: '1. 수가 표준화 :', '2. 본인부담률 :', '입증 서류 :')은 절대 볼드(**) 처리하지 마십시오. 오직 그 뒤의 구체적인 값(예: '4만 3,850원', '95%')이나 실질적인 나열 항목 자체만 볼드로 감싸야 합니다.
  * 또한 쉼표(,), 마침표(.), 콜론(:) 등의 문장 부호 자체를 단독으로 볼드(**) 처리하는 일은 절대 없어야 합니다. 예: '진단서 **,** 의사 소견서' (X) -> '**진단서**, **의사 소견서**' (O)

[응답 형식]
[분석 배경 및 이해]
- 사용자의 질문을 설계사 관점에서 보정한 맥락과, 약관/검색 정보 상의 구체적 판정 기준(예: 일반 골절과 5대 골절의 담보별 보장 범위 차이 등)을 명확하게 분석하여 서술하십시오.
[요약]
- 질문에 대한 핵심 팩트 중심의 결론 요약.
- **[매우 중요]** 핵심 요약문에는 줄 시작 부분에 하이픈(-)이나 글머리 기호(* 등)를 절대 기재하지 마십시오. 문장이나 내용을 구분하여 나열하고 싶을 때는 기호 대신 단순히 줄바꿈(엔터)으로 문단을 구분하여 작성하십시오.
[조건]
- 보장이 지급되기 위해 만족해야 하는 명확한 약관상 조건들을 번호 또는 불릿 기호 리스트로 구체적이고 일목요연하게 기재하십시오 (예: 5대 골절의 구체적 대상 부위: 머리, 목, 척추, 골반, 대퇴골 등).
- 찾지 못했다면 이 항목을 생략하십시오.
[주의사항]
- 보상 제외 대상(면책 조항), 한도 제한, 지급 거절 요인 등을 상세히 기재하십시오.
- 찾지 못했다면 이 항목을 생략하십시오.

[매우 중요: 검색 출처 및 마크다운 링크 기재 규칙]
- 만약 구글 실시간 검색 결과를 활용하여 답변을 작성했다면, 답변 맨 마지막 줄에 참고한 블로그, 뉴스, 공시자료의 실제 기사/게시글 제목과 원본 웹사이트 주소(URL)를 아래의 포맷을 준수하여 3~5개 기재해 주십시오. (이 줄은 시스템에서 자동으로 파싱되므로 기호와 양식을 정확히 일치시켜야 합니다).
[출처: 게시글 또는 웹페이지의 한글 제목](참고한 실제 원본 URL)
예시:
[출처: 시그널플래너 블로그 - 질병 1~5종 수술비 보장 항목 및 지급 한도 총정리](https://www.signalplanner.co.kr/blog/...)
[출처: 금융감독원 보도자료 - 실손의료보험 도수치료 보장 기준 강화 안내](https://www.fss.or.kr/...)`
          }
        ]
      },
      generationConfig: {
        temperature: 0.1
      }
    };

    let modelName = "gemini-3.1-flash-lite";
    let usedSearch = useWebSearch;

    async function getGeminiStreamReader(model: string, searchEnabled: boolean) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${geminiKey}`;
      const payload = searchEnabled ? requestBody : { ...requestBody, tools: undefined };
      
      console.log(`[Gemini API] Calling ${model} stream (search: ${searchEnabled})...`);
      const response = await fetchWithTimeout(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, searchEnabled ? 12000 : 5000);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      if (!response.body) {
        throw new Error("Empty response body from Gemini API");
      }

      return response.body.getReader();
    }

    let promptTokenCount = 0;
    let candidatesTokenCount = 0;

    const customStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        const writeChunk = (text: string) => {
          controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify(text)}\n\n`));
        };
        
        const writeMetadata = (meta: any) => {
          controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify(meta)}\n\n`));
        };

        let reader: ReadableStreamDefaultReader<Uint8Array>;
        try {
          reader = await getGeminiStreamReader(modelName, usedSearch);
        } catch (err: any) {
          console.warn(`[Gemini API Warning] ${modelName} with search grounding failed or timed out:`, err.message || err);
          modelName = "gemini-3.1-flash-lite";
          usedSearch = false;
          try {
            reader = await getGeminiStreamReader(modelName, usedSearch);
          } catch (fallbackErr: any) {
            console.error(`[Gemini API Critical] Fallback also failed:`, fallbackErr.message || fallbackErr);
            const primaryErrorMsg = err.name === "AbortError" ? "1차 실시간 검색 답변 생성 시간 초과(12.0초)" : `1차 실시간 검색 에러 (${err.message || err})`;
            const fallbackErrorMsg = fallbackErr.name === "AbortError" ? "2차 빠른 답변 생성 시간 초과(5.0초)" : `2차 빠른 답변 에러 (${fallbackErr.message || fallbackErr})`;
            
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(`답변 생성 엔진 호출 실패:\n- ${primaryErrorMsg}\n- ${fallbackErrorMsg}`)}\n\n`));
            controller.close();
            return;
          }
        }

        try {
          const decoder = new TextDecoder();
          let buffer = "";
          let fullText = "";
          let groundingMetadata: any = null;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let braceCount = 0;
            let startIndex = -1;
            let inString = false;
            let escapeNext = false;

            for (let i = 0; i < buffer.length; i++) {
              const char = buffer[i];

              if (escapeNext) {
                escapeNext = false;
                continue;
              }

              if (char === '\\') {
                escapeNext = true;
                continue;
              }

              if (char === '"') {
                inString = !inString;
                continue;
              }

              if (!inString) {
                if (char === "{") {
                  if (braceCount === 0) {
                    startIndex = i;
                  }
                  braceCount++;
                } else if (char === "}") {
                  braceCount--;
                  if (braceCount === 0 && startIndex !== -1) {
                    const jsonStr = buffer.substring(startIndex, i + 1);
                    try {
                      const obj = JSON.parse(jsonStr);
                      const text = obj.candidates?.[0]?.content?.parts?.[0]?.text || "";
                      if (text) {
                        fullText += text;
                        writeChunk(text);
                      }
                      const meta = obj.candidates?.[0]?.groundingMetadata;
                      if (meta) {
                        console.log(`[Gemini Stream] Detected groundingMetadata chunk: ${JSON.stringify(meta)}`);
                        if (!groundingMetadata) {
                          groundingMetadata = {};
                        }
                        if (meta.webSearchQueries) {
                          groundingMetadata.webSearchQueries = meta.webSearchQueries;
                        }
                        if (meta.searchEntryPoint) {
                          groundingMetadata.searchEntryPoint = meta.searchEntryPoint;
                        }
                        if (meta.groundingChunks && meta.groundingChunks.length > 0) {
                          groundingMetadata.groundingChunks = meta.groundingChunks;
                        }
                        if (meta.groundingSupports && meta.groundingSupports.length > 0) {
                          groundingMetadata.groundingSupports = meta.groundingSupports;
                        }
                      }
                      const usage = obj.usageMetadata;
                      if (usage) {
                        promptTokenCount = usage.promptTokenCount || promptTokenCount;
                        candidatesTokenCount = usage.candidatesTokenCount || candidatesTokenCount;
                      }
                    } catch (e) {
                      console.error("[Gemini Stream] JSON Parse error for chunk:", e);
                    }
                    buffer = buffer.substring(i + 1);
                    i = -1;
                    startIndex = -1;
                    inString = false;
                    escapeNext = false;
                  }
                }
              }
            }
          }

          // Stream completed!
          console.log(`[Gemini Stream Done] fullText length: ${fullText.length}`);
          console.log(`[Gemini Stream Done] Raw groundingMetadata accumulated: ${JSON.stringify(groundingMetadata)}`);

          // Extract generated headline from the response text
          const headlineRegex = /\[제목:\s*([\s\S]+?)\]/;
          const headlineMatch = headlineRegex.exec(fullText);
          const generatedHeadline = headlineMatch ? headlineMatch[1].trim() : generateHeadline(question, fullText);

          // Clean response text by removing the headline markup
          const textWithoutHeadline = fullText.replace(headlineRegex, "").trim();

          // Extract citations from the clean response text
          const markdownCitations: Array<{ title: string; url: string }> = [];
          const citationRegex = /[-*•\s]*\[출처:\s*([\s\S]+?)\]\s*\((https?:\/\/[^\)]+)\)/g;
          let match;
          while ((match = citationRegex.exec(textWithoutHeadline)) !== null) {
            markdownCitations.push({
              title: match[1].trim(),
              url: match[2].trim()
            });
          }

          // Fallback: parse general markdown links [Title](URL) in case formatting differs
          const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
          let linkMatch;
          while ((linkMatch = linkRegex.exec(textWithoutHeadline)) !== null) {
            const title = linkMatch[1].trim();
            const url = linkMatch[2].trim();
            if (!markdownCitations.some(c => c.url === url) && !url.includes("kakaolink")) {
              markdownCitations.push({
                title: title.startsWith("출처:") ? title.replace("출처:", "").trim() : title,
                url
              });
            }
          }

          console.log(`[Gemini Stream Done] Extracted markdownCitations: ${JSON.stringify(markdownCitations)}`);

          let citations = [];
          const getCitationSection = (uri: string): string => {
            const lowUrl = uri.toLowerCase();
            if (lowUrl.includes("idbins.com") || lowUrl.includes("idb.co.kr")) return "DB손보 공식";
            if (lowUrl.includes("fss.or.kr") || lowUrl.includes("fsc.go.kr")) return "금융당국";
            if (lowUrl.includes("knia.or.kr") || lowUrl.includes("klia.or.kr") || lowUrl.includes("kidi.or.kr")) return "보험협회";
            if (lowUrl.includes("korea.kr") || lowUrl.includes("law.go.kr")) return "정부/법령";
            if (lowUrl.includes("nhis.or.kr") || lowUrl.includes("hira.or.kr")) return "보건의료";
            return "웹 검색 정보";
          };

          const getCleanTitle = (title: string, url: string): string => {
            const clean = title.trim();
            const isDomainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?$/.test(clean) || clean.toLowerCase().startsWith("http");
            
            if (!clean || isDomainPattern) {
              const lowUrl = url.toLowerCase();
              if (lowUrl.includes("idbins.com") || lowUrl.includes("idb.co.kr")) return "DB손해보험 공식 상품공시실 및 약관 정보";
              if (lowUrl.includes("fss.or.kr") || lowUrl.includes("fsc.go.kr")) return "금융감독기관 공식 보험 보도 및 분쟁조정사례";
              if (lowUrl.includes("knia.or.kr") || lowUrl.includes("klia.or.kr")) return "손해/생명보험협회 표준약관 및 제도 안내";
              if (lowUrl.includes("kidi.or.kr")) return "보험개발원 기술 분석 및 공시 가이드";
              if (lowUrl.includes("korea.kr")) return "대한민국 정책브리핑 공식 보도자료";
              if (lowUrl.includes("law.go.kr")) return "국가법령정보센터 관련 법령 및 판례";
              if (lowUrl.includes("nhis.or.kr")) return "국민건강보험공단 급여/비급여 정책 가이드";
              if (lowUrl.includes("hira.or.kr")) return "건강보험심사평가원 의료 수가 및 기준";
              if (lowUrl.includes("signalplanner.co.kr")) return "시그널플래너 실손/수술비 보험 가이드 및 지급사례";
              if (lowUrl.includes("kbthink.com")) return "KB손해보험 공식 지식 블로그 - 실손보험금 청구 기준";
              if (lowUrl.includes("son4.net")) return "손사넷 손해사정사 전문 보상 분쟁 및 판례 해설";
              if (lowUrl.includes("naver.com")) return "네이버 지식iN / 블로그 보험 보상 청구 가이드";
              if (lowUrl.includes("tistory.com")) return "보상 실무 전문가 티스토리 블로그 정보";
              if (lowUrl.includes("brunch.co.kr")) return "브런치 보험 전문 작가 칼럼 및 보상 리뷰";
              
              try {
                const hostname = new URL(url).hostname.replace("www.", "");
                return `${hostname} 전문 정보 및 해설`;
              } catch {
                return "실시간 검색 참조 자료";
              }
            }
            return clean;
          };

          if (markdownCitations.length > 0) {
            citations = markdownCitations.slice(0, 5).map((cit, i) => {
              return {
                id: `citation-${i + 1}-${getUUIDShort()}`,
                title: cit.title,
                section: getCitationSection(cit.url),
                page: 1,
                version: productHint || "공식 정보",
                sourceUrl: cit.url,
                excerpt: cit.title
              };
            });
          } else if (groundingMetadata) {
            const groundingChunks = groundingMetadata.groundingChunks || [];
            citations = groundingChunks.slice(0, 5).map((chunk: any, i: number) => {
              const web = chunk.web || {};
              const url = web.uri || "https://disclosure.idbins.com/";
              const resolvedTitle = getCleanTitle(web.title || "", url);

              return {
                id: `citation-${i + 1}-${getUUIDShort()}`,
                title: resolvedTitle,
                section: getCitationSection(url),
                page: 1,
                version: productHint || "공식 정보",
                sourceUrl: url,
                excerpt: resolvedTitle
              };
            });
          }

          console.log(`[Gemini Stream Done] Final citations array (${citations.length} items): ${JSON.stringify(citations)}`);

          const cleanResponseText = textWithoutHeadline.replace(citationRegex, "").trim();
          const isSimpleChat = cleanResponseText.length < 250 && !cleanResponseText.includes("[분석 배경 및 이해]") && !cleanResponseText.includes("[조건]");

          const usedEngine = modelName === "gemini-3.1-flash-lite"
            ? (usedSearch ? "실시간 검색 답변(Gemini 3.1 Flash-Lite)" : "빠른 답변(Gemini 3.1 Flash-Lite - 실시간 검색 시간초과)")
            : (usedSearch ? "실시간 검색 답변(Gemini 2.5 flash)" : "빠른 답변(Gemini 2.5 flash - 실시간 검색 시간초과)");

          writeMetadata({
            isSimpleChat,
            searchEngine: usedEngine,
            modelName: modelName === "gemini-3.1-flash-lite" ? "Gemini 3.1 Flash-Lite" : "Gemini 2.5 Flash",
            citations,
            headline: generatedHeadline,
            requiredInfo: [
              "정확한 상품 명칭 및 약관 개정 버전",
              "가입 시기 및 청구 항목의 영수증/진단서",
              "해당 상품이 판매상품인지 판매중지 상품인지 여부"
            ]
          });

          // Accumulate Gemini Cost (USD/KRW converted with rate 1,400₩/$1)
          if (userId && (promptTokenCount > 0 || candidatesTokenCount > 0)) {
            // gemini-3.1-flash-lite: $0.125/1M input, $0.75/1M output (official pricing)
            // gemini-2.5-flash: $0.30/1M input, $2.50/1M output
            // gemini-2.0-flash-lite / gemini-1.5-flash: $0.075/1M input, $0.30/1M output
            let inputRate = 0.000175; // default gemini-3.1-flash-lite ($0.125/1M * 1400₩)
            let outputRate = 0.00105; // default gemini-3.1-flash-lite ($0.75/1M * 1400₩)

            if (modelName === "gemini-2.5-flash") {
              inputRate = 0.00042;   // $0.30/1M * 1400₩
              outputRate = 0.0035;   // $2.50/1M * 1400₩
            } else if (modelName === "gemini-2.0-flash-lite" || modelName === "gemini-1.5-flash") {
              inputRate = 0.000105;  // $0.075/1M * 1400₩
              outputRate = 0.00042;  // $0.30/1M * 1400₩
            }

            const inputCost = promptTokenCount * inputRate;
            const outputCost = candidatesTokenCount * outputRate;
            const totalCost = inputCost + outputCost;
            const groundingIncrement = usedSearch ? 1 : 0;
            try {
              // Dynamic import to prevent initialisation timing race conditions in Edge Runtime
              const { incrementUserCost } = await import("@/lib/firebase");
              await incrementUserCost(userId, "gemini", totalCost, groundingIncrement);
              console.log(`[Gemini Cost Log] Added ₩${totalCost.toFixed(3)} (Tokens: ${promptTokenCount}/${candidatesTokenCount}, Grounding: ${groundingIncrement}) to user ${userId}`);
            } catch (dbErr) {
              console.error("[Gemini Cost Log] Failed to update user cost:", dbErr);
            }
          }

          // Save the assistant's answer in the background (non-blocking)
          if (userId && fullText) {
            try {
              const { saveChatMessage } = await import("@/lib/firebase");
              saveChatMessage(userId, "assistant", fullText).catch(err => {
                console.error("[Firebase Log] Failed to save assistant message:", err);
              });
            } catch (importErr) {
              console.error("[Firebase Log] Failed to import saveChatMessage:", importErr);
            }
          }

          controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));

          controller.close();
        } catch (streamErr: any) {
          console.error("Gemini stream parsing failed:", streamErr);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(streamErr.message || streamErr)}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(customStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });

  } catch (err: any) {
    console.error("Gemini RAG API 실행 중 에러 발생:", err);
    return NextResponse.json(
      { error: "RAG 실행 오류", detail: err.message || err },
      { status: 500 }
    );
  }
}
