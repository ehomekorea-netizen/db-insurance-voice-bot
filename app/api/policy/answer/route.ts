import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildPolicyAnswer, classifyIntent, type PolicyIntent, samplePolicyChunks, type PolicyChunk } from "@/lib/policyKnowledge";
import { correctInsuranceTerms } from "@/lib/koreanFuzzy";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as PolicyAnswerRequest;
  let question = body.question?.trim();
  const productHint = body.product_hint?.trim();

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

  // FALLBACK: If Gemini API Key is not configured, fallback to local sample data
  if (!geminiKey || geminiKey === "your-gemini-api-key-here" || geminiKey.trim() === "") {
    console.warn("경고: GEMINI_API_KEY가 설정되지 않아 로컬 MVP 샘플 데이터로 응답합니다.");
    const fallbackAnswer = buildPolicyAnswer({
      question,
      intent: body.intent ?? classifyIntent(question),
      productHint: body.product_hint
    });
    fallbackAnswer.searchEngine = "로컬 MVP 샘플 데이터";
    return NextResponse.json(fallbackAnswer);
  }

  try {
    // Local knowledge base chunk integration removed per client request.

    // 2. Query Gemini API with built-in Google Search Grounding tool
    const useWebSearch = process.env.ENABLE_OFFICIAL_WEB_SEARCH !== "false";
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `[PA 질문]\n${question}`
            }
          ]
        }
      ],
      tools: useWebSearch ? [
        {
          googleSearch: {}
        }
      ] : undefined,
      systemInstruction: {
        parts: [
          {
            text: `당신은 DB손해보험 PA(설계사)의 영업 활동을 지원하고 보험 약관, 고객 응대, 영업 지원, 상품 설명 등 보험 업무 전반에 대해 가이드해 주는 인공지능 멘토 '프로미'입니다.
사용자는 보험 설계사 또는 지점 임직원(보험 전문가)입니다. 
현재 시점 정보: ${currentDateString}

[중요: 포맷 및 답변 지침]
- 만약 사용자의 질문이 보험 업무, 약관, 고객 응대, 영업 지원과 전혀 무관한 일반적인 사담(예: 오늘 날씨, 일상 대화, 유머, 일반 상식, 인사 등)인 경우, [분석 배경 및 이해], [조건], [주의사항] 헤더를 모두 생략하고 오직 다음 한 문장의 텍스트만 출력하십시오: "저는 DB손해보험 PA 분들의 영업 활동을 돕는 인공지능 멘토 프로미입니다. 보험이나 영업 관련 질문을 입력해 주시겠어요?" (이 경우 구글 검색 도구를 호출하지 마십시오.)
- 인사말이나 인트로 문구(예: "~이해하기 쉽게 정리해 드릴게요", "반갑습니다")와 아웃트로 사설은 불필요한 토큰 낭비이므로 **절대 쓰지 마십시오.** (단, 위의 보험 무관 질문에 대한 거절 답변은 제외)
- 반드시 아래의 대괄호 헤더로 **즉시 본론부터 기재를 시작**하십시오.
- 약관 지급 기준이나 보장 부위(예: 5대 골절의 구체적 대상 등)는 일반적인 원론에 그치지 말고, **번호나 불릿 기호 리스트를 활용하여 아주 명확하고 구체적인 팩트 위주로 일목요연하게 서술**하십시오.
- 사용자가 '올해', '현재', '최근', '이번에'라고 언급하면 현재 시점인 ${currentDateString}를 기준으로 판단하십시오.
- 사용자의 질문은 음성 인식(STT) 과정에서 발음 오타(예: '나비면제' -> '납입면제', '수치료/도수치로' -> '도수치료', '실선' -> '실손', '포장' -> '보장')로 입력될 수 있으므로, 문맥상 이를 알아듣고 올바른 보험 단어로 정정하여 이해하십시오.
- 특히 사용자가 "다리가 문질러졌다", "문질러졌고"라고 질문하면 100% "부러졌다/골절"의 STT 오류이므로, 이를 "다리가 부러진 골절 사고"로 정정해서 이해하여 골절 진단비 및 5대 골절의 정의를 설명하십시오.
- **[매우 중요]** 사용자의 질문을 내부적으로 보험 단어로 정정하여 이해했을 때, 답변 본문(특히 [분석 배경 및 이해])에 "다리가 문질러졌다는 골절의 STT 오타이므로 골절 사고로 정정해서 이해하고 답변을 작성합니다" 같은 **AI의 내부 보정 규칙이나 독백, 개발용 메타 설명을 절대 답변 텍스트로 노출하지 마십시오.** 사용자는 백엔드의 보정 알고리즘을 알 필요가 없으므로, 조용히 속으로만 정정하여 오직 정정된 골절 담보의 약관 팩트만 서술해 주십시오.

[응답 형식]
[분석 배경 및 이해]
- 사용자의 질문을 설계사 관점에서 보정한 맥락과, 약관/검색 정보 상의 구체적 판정 기준(예: 일반 골절과 5대 골절의 담보별 보장 범위 차이 등)을 명확하게 분석하여 서술하십시오.
[요약]
- 질문에 대한 핵심 팩트 중심의 2~3문장 결론 요약.
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

    let modelName = "gemini-2.5-flash";
    let response: Response;
    let usedSearch = useWebSearch;

    try {
      console.log(`[Gemini API] Calling ${modelName} with search grounding (timeout 6.5s)...`);
      response = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        },
        6500
      );

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }
    } catch (err: any) {
      console.warn(`[Gemini API Warning] ${modelName} with search grounding failed or timed out:`, err.message || err);
      // Fallback to gemini-2.5-flash without search grounding for high speed and avoiding Vercel timeouts
      modelName = "gemini-2.5-flash";
      usedSearch = false;
      console.log(`[Gemini API Fallback] Calling ${modelName} WITHOUT search grounding (timeout 2.5s)...`);
      const fallbackBody = {
        ...requestBody,
        tools: undefined
      };
      
      try {
        response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fallbackBody)
          },
          2500
        );
      } catch (fallbackErr: any) {
        console.error(`[Gemini API Critical] Fallback model ${modelName} also failed or timed out:`, fallbackErr.message || fallbackErr);
        throw new Error(`답변 생성 엔진 호출 실패: ${fallbackErr.message || fallbackErr}`);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API HTTP ${response.status} (Model: ${modelName}): ${errText}`);
      }
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 3. Extract Markdown citations generated by Gemini model based on prompt instruction
    const markdownCitations: Array<{ title: string; url: string }> = [];
    const citationRegex = /[-*•\s]*\[출처:\s*([\s\S]+?)\]\((https?:\/\/[^\)]+)\)/g;
    let match;
    let cleanResponseText = responseText;
    while ((match = citationRegex.exec(responseText)) !== null) {
      markdownCitations.push({
        title: match[1].trim(),
        url: match[2].trim()
      });
    }
    // Remove the markdown source lines from main text so it doesn't clutter output
    cleanResponseText = responseText.replace(citationRegex, "").trim();

    let analysis = "";
    let summary = "";
    let conditions: string[] = [];
    let cautions: string[] = [];

    const analysisStart = cleanResponseText.indexOf("[분석 배경 및 이해]");
    const summaryStart = cleanResponseText.indexOf("[요약]");
    const conditionsStart = cleanResponseText.indexOf("[조건]");
    const cautionsStart = cleanResponseText.indexOf("[주의사항]");

    if (analysisStart !== -1) {
      const end = summaryStart !== -1 ? summaryStart : (conditionsStart !== -1 ? conditionsStart : (cautionsStart !== -1 ? cautionsStart : cleanResponseText.length));
      analysis = cleanResponseText.substring(analysisStart + 12, end).trim();
    }

    if (summaryStart !== -1) {
      const end = conditionsStart !== -1 ? conditionsStart : (cautionsStart !== -1 ? cautionsStart : cleanResponseText.length);
      summary = cleanResponseText.substring(summaryStart + 4, end).trim();
    } else if (analysisStart === -1) {
      summary = cleanResponseText;
    }

    if (conditionsStart !== -1) {
      const end = cautionsStart !== -1 ? cautionsStart : cleanResponseText.length;
      const rawConditions = cleanResponseText.substring(conditionsStart + 4, end).trim();
      conditions = rawConditions
        .split("\n")
        .map((l: string) => l.replace(/^[\s\u200B\u200C\u200D\uFEFF\u00A0\u3000\-*•◦‣⁃]+/, "").trim())
        .filter(Boolean);
    }

    if (cautionsStart !== -1) {
      const rawCautions = cleanResponseText.substring(cautionsStart + 6).trim();
      cautions = rawCautions
        .split("\n")
        .map((l: string) => l.replace(/^[\s\u200B\u200C\u200D\uFEFF\u00A0\u3000\-*•◦‣⁃]+/, "").trim())
        .filter(Boolean);
    }

    // 4. Extract search grounding citations (Gemini generated 우선, 구글 기본 metadata fallback)
    let citations = [];
    if (markdownCitations.length > 0) {
      citations = markdownCitations.slice(0, 5).map((cit, i) => {
        const getCitationSection = (uri: string): string => {
          const lowUrl = uri.toLowerCase();
          if (lowUrl.includes("idbins.com") || lowUrl.includes("idb.co.kr")) return "DB손보 공식";
          if (lowUrl.includes("fss.or.kr")) return "금융감독원";
          if (lowUrl.includes("knia.or.kr") || lowUrl.includes("klia.or.kr")) return "보험협회";
          if (lowUrl.includes("naver.com") || lowUrl.includes("tistory.com")) return "블로그/지식iN";
          return "참고자료";
        };
        return {
          id: `citation-${i + 1}-${crypto.randomUUID().substring(0, 8)}`,
          title: cit.title,
          section: getCitationSection(cit.url),
          page: 1,
          version: productHint || "공식 정보",
          sourceUrl: cit.url,
          excerpt: cit.title
        };
      });
    } else {
      const getCleanTitle = (title: string, url: string): string => {
        const clean = title.trim();
        const isDomainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?$/.test(clean) || clean.toLowerCase().startsWith("http");
        
        if (!clean || isDomainPattern) {
          const lowUrl = url.toLowerCase();
          if (lowUrl.includes("idbins.com") || lowUrl.includes("idb.co.kr")) return "DB손해보험 공식 상품공시실 및 약관 정보";
          if (lowUrl.includes("fss.or.kr")) return "금융감독원 공식 보험분쟁 조정사례 및 규정";
          if (lowUrl.includes("knia.or.kr") || lowUrl.includes("klia.or.kr")) return "손해보험협회 표준약관 및 제도 안내";
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

      const groundingMetadata = data.candidates?.[0]?.groundingMetadata || {};
      const groundingChunks = groundingMetadata.groundingChunks || [];

      citations = groundingChunks.slice(0, 5).map((chunk: any, i: number) => {
        const web = chunk.web || {};
        const url = web.uri || "https://disclosure.idbins.com/";
        
        const getCitationSection = (uri: string): string => {
          const lowUrl = uri.toLowerCase();
          if (lowUrl.includes("idbins.com") || lowUrl.includes("idb.co.kr")) return "DB손보 공식";
          if (lowUrl.includes("fss.or.kr")) return "금융감독원";
          if (lowUrl.includes("knia.or.kr") || lowUrl.includes("klia.or.kr")) return "보험협회";
          if (lowUrl.includes("naver.com") || lowUrl.includes("tistory.com")) return "블로그/지식iN";
          return "참고자료";
        };

        const resolvedTitle = getCleanTitle(web.title || "", url);

        return {
          id: `citation-${i + 1}-${crypto.randomUUID().substring(0, 8)}`,
          title: resolvedTitle,
          section: getCitationSection(url),
          page: 1,
          version: productHint || "공식 정보",
          sourceUrl: url,
          excerpt: resolvedTitle
        };
      });
    }

    const usedEngine = modelName === "gemini-2.5-flash"
      ? (usedSearch ? "실시간 검색 답변(Gemini 2.5 flash)" : "빠른 답변(Gemini 2.5 flash - 실시간 검색 시간초과)")
      : (usedSearch ? "실시간 검색 답변(Gemini 2.0-flash는 폐기됨)" : "빠른 답변(Gemini 2.0-flash는 폐기됨)");

    return NextResponse.json({
      id: crypto.randomUUID(),
      question,
      intent: body.intent ?? classifyIntent(question),
      analysis,
      summary,
      conditions,
      cautions,
      requiredInfo: [
        "정확한 상품 명칭 및 약관 개정 버전",
        "가입 시기 및 청구 항목의 영수증/진단서",
        "해당 상품이 판매상품인지 판매중지 상품인지 여부"
      ],
      citations,
      disclaimer: "본 답변은 DB손해보험 공식 상품공시실 기초서류와 구글 실시간 검색을 바탕으로 AI 추론 엔진이 분석한 전문가용 자료이며, 최종 보상 지급 판단은 심사 결과에 따라 다를 수 있습니다.",
      searchEngine: usedEngine
    });

  } catch (err: any) {
    console.error("Gemini RAG API 실행 중 에러 발생:", err);
    return NextResponse.json(
      { error: "RAG 실행 오류", detail: err.message || err },
      { status: 500 }
    );
  }
}
