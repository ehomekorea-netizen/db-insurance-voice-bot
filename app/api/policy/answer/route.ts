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

// Local knowledge base keywords similarity match helper for Hybrid RAG
function searchLocalChunks(question: string): PolicyChunk[] {
  const cleanQ = question.toLowerCase();
  const matched: Array<{ chunk: PolicyChunk; score: number }> = [];
  
  for (const chunk of samplePolicyChunks) {
    let score = 0;
    
    // 1. Direct keyword match (Highest priority)
    for (const kw of chunk.keywords) {
      if (cleanQ.includes(kw.toLowerCase())) {
        score += 5; // Add weight on keyword match
      }
    }
    
    // 2. Chunk content word match (Semantic overlap helper)
    const contentWords = (chunk.content || "").split(/\s+/);
    for (const word of contentWords) {
      if (word.length > 1 && cleanQ.includes(word.toLowerCase())) {
        score += 1; // Add minor weight on body word match
      }
    }
    
    if (score > 0) {
      matched.push({ chunk, score });
    }
  }
  
  // Sort descending by relevance score
  matched.sort((a, b) => b.score - a.score);
  return matched.map(m => m.chunk).slice(0, 2); // Return top 2 matching local chunks
}

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
    // 1. Hybrid RAG Search Integration: Search local knowledge base first
    const localChunks = searchLocalChunks(question);
    let localContext = "";
    if (localChunks.length > 0) {
      localContext = `[로컬 데이터베이스 약관 참고자료]\n` + localChunks.map((c, i) => {
        return `조회된 약관자료 ${i + 1}: ${c.product} - ${c.documentTitle} (조항: ${c.section}, 페이지: ${c.page}p, 약관버전: ${c.version})
본문내용: ${c.content}`;
      }).join("\n\n");
      console.log(`[Hybrid RAG] 로컬 매칭 청크 ${localChunks.length}개 발견`);
    }

    // 2. Query Gemini API with built-in Google Search Grounding tool
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: localContext
                ? `[로컬 약관 참고 정보]\n${localContext}\n\n[PA 질문]\n${question}`
                : `[PA 질문]\n${question}`
            }
          ]
        }
      ],
      tools: [
        {
          googleSearch: {}
        }
      ],
      systemInstruction: {
        parts: [
          {
            text: `당신은 DB손해보험의 공식 상품 약관, 담보 보상여부, 청구서류 및 보험 업무 전반을 전문적으로 해설하는 AI 언더라이터이자 보상 전문가입니다.
사용자는 보험 설계사 또는 지점 임직원(보험 전문가)입니다. 
현재 시점 정보: ${currentDateString}

[중요: 포맷 및 답변 지침]
- 인사말이나 인트로 문구(예: "~이해하기 쉽게 정리해 드릴게요", "반갑습니다")와 아웃트로 사설은 불필요한 토큰 낭비이므로 **절대 쓰지 마십시오.**
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
- 찾지 못했다면 이 항목을 생략하십시오.`
          }
        ]
      },
      generationConfig: {
        temperature: 0.1
      }
    };

    let modelName = "gemini-2.5-flash";
    let response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );

    // 503 Unavailable (High Demand) 또는 기타 API 에러 발생 시, 검증된 gemini-1.5-flash로 자동 폴백 재시도
    if (response.status === 503 || !response.ok) {
      console.warn(`[Gemini API Warning] ${modelName} 호출 실패(HTTP ${response.status}). 안정화된 gemini-1.5-flash로 즉시 우회 재시도합니다.`);
      modelName = "gemini-1.5-flash";
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        }
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API HTTP ${response.status} (Model: ${modelName}): ${errText}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 3. Robust parsing of the reasoning response
    let analysis = "";
    let summary = "";
    let conditions: string[] = [];
    let cautions: string[] = [];

    const analysisStart = responseText.indexOf("[분석 배경 및 이해]");
    const summaryStart = responseText.indexOf("[요약]");
    const conditionsStart = responseText.indexOf("[조건]");
    const cautionsStart = responseText.indexOf("[주의사항]");

    if (analysisStart !== -1) {
      const end = summaryStart !== -1 ? summaryStart : (conditionsStart !== -1 ? conditionsStart : (cautionsStart !== -1 ? cautionsStart : responseText.length));
      analysis = responseText.substring(analysisStart + 12, end).trim();
    }

    if (summaryStart !== -1) {
      const end = conditionsStart !== -1 ? conditionsStart : (cautionsStart !== -1 ? cautionsStart : responseText.length);
      summary = responseText.substring(summaryStart + 4, end).trim();
    } else if (analysisStart === -1) {
      summary = responseText;
    }

    if (conditionsStart !== -1) {
      const end = cautionsStart !== -1 ? cautionsStart : responseText.length;
      const rawConditions = responseText.substring(conditionsStart + 4, end).trim();
      conditions = rawConditions.split("\n").map((l: string) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    }

    if (cautionsStart !== -1) {
      const rawCautions = responseText.substring(cautionsStart + 6).trim();
      cautions = rawCautions.split("\n").map((l: string) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    }

    // 4. Extract search grounding citations
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata || {};
    const groundingChunks = groundingMetadata.groundingChunks || [];
    
    const citations = groundingChunks.map((chunk: any, i: number) => {
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

      return {
        id: `citation-${i + 1}-${crypto.randomUUID().substring(0, 8)}`,
        title: web.title || "DB손해보험 공식 공시실",
        section: getCitationSection(url),
        page: 1,
        version: productHint || "공식 정보",
        sourceUrl: url,
        excerpt: web.title || "실시간 검색 출처"
      };
    });

    const usedEngine = groundingChunks.length > 0
      ? (localChunks.length > 0 ? `로컬 약관 + Google Search (${modelName})` : `Google Search (${modelName})`)
      : (localChunks.length > 0 ? `로컬 약관 지식베이스` : `Gemini (${modelName})`);

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
