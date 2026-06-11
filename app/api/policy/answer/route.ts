import { NextResponse } from "next/server";
import OpenAI from "openai";
import { buildPolicyAnswer, classifyIntent, type PolicyIntent } from "@/lib/policyKnowledge";

export const runtime = "nodejs";

type PolicyAnswerRequest = {
  question?: string;
  intent?: PolicyIntent;
  product_hint?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as PolicyAnswerRequest;
  const question = body.question?.trim();
  const productHint = body.product_hint?.trim();

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  // FALLBACK: If OpenAI Key or Tavily API Key is not configured, fallback to local MVP mock database
  if (!apiKey || !tavilyApiKey) {
    console.warn("경고: OPENAI_API_KEY 또는 TAVILY_API_KEY가 설정되지 않아 로컬 MVP 샘플 데이터로 응답합니다.");
    const fallbackAnswer = buildPolicyAnswer({
      question,
      intent: body.intent ?? classifyIntent(question),
      productHint: body.product_hint
    });
    return NextResponse.json(fallbackAnswer);
  }

  try {
    // 1. Build a highly targeted search query for DB Insurance Public Disclosure Room
    // Search both "판매상품" (Active) and "판매중지 상품" (Discontinued)
    const productQueryTerm = productHint ? `"${productHint}"` : "";
    const searchQuery = `site:disclosure.idbins.com (판매상품 OR "판매중지 상품") ${productQueryTerm} "${question}" 약관`;

    console.log(`Tavily 검색 실행: ${searchQuery}`);

    const searchResponse = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query: searchQuery,
        search_depth: "advanced",
        include_domains: ["idbins.com"],
        max_results: 5
      })
    });

    if (!searchResponse.ok) {
      const errText = await searchResponse.text();
      throw new Error(`Tavily API responded with status ${searchResponse.status}: ${errText}`);
    }

    const searchData = await searchResponse.json();
    const results = searchData.results || [];

    // 2. Strict Ingestion Filtering: Remove generic/useless FAQ or help URLs
    const filteredResults = results.filter((r: any) => {
      const url = (r.url || "").toLowerCase();
      // Filter out customer service main, FAQ pages, index pages, help pages
      if (
        url.includes("/faq") ||
        url.includes("/customer") ||
        url.includes("/main") ||
        url.includes("/index") ||
        url.includes("faqdetail") ||
        url.includes("/qna")
      ) {
        return false;
      }
      return true;
    });

    // Fallback to top result if everything got filtered out to prevent empty search
    const finalResults = filteredResults.length > 0 ? filteredResults : results.slice(0, 1);

    let searchContext = "";
    if (finalResults.length > 0 && finalResults[0]?.content) {
      searchContext = finalResults.map((r: any, i: number) => {
        return `[공식 공시자료 ${i + 1}]
제목: ${r.title}
출처 주소: ${r.url}
내용: ${r.content}`;
      }).join("\n\n");
    } else {
      searchContext = "DB손해보험 상품공시실에서 해당 조건의 구체적인 약관 원문 조항을 찾지 못했습니다.";
    }

    // 3. Query OpenAI gpt-4o-mini (Cost-efficient Model)
    const openai = new OpenAI({ apiKey });
    
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 DB손해보험의 공식 상품 약관 및 공시 기초서류를 전문적으로 해설하는 AI 언더라이터(보험 심사 전문가)입니다.
사용자는 보험 설계사 또는 지점 임직원(보험 전문가)입니다. 
제공된 [공식 공시자료]만을 면밀히 추론/분석하여 사용자의 질문에 답변하십시오. 

[답변 작성 원칙]
- 대화체나 존댓말을 장황하게 쓰지 말고, 공문서나 보고서 스타일로 전문 용어(면책, 자기부담금, 공제율, 특약 등)를 사용하여 핵심만 명확하게 작성하십시오.
- 사용자가 확인해 준 가입 연도나 판매유무(판매상품/판매중지) 단서가 있다면, 해당 약관의 개정 시점을 기준으로 정확히 보상 범위를 추론하여 작성하십시오.
- 제공된 공시자료 상에서 특정 정보가 확실하지 않다면, 추론 과정과 한계(예: "공시자료상 2009년 표준화 이전 상해의료비 세부 공제 비율은 확인되지 않음")를 솔직하게 명시하고, [확인 필요 사항]에 구체적으로 적어 넣으십시오.
- 절대 임의로 답변을 꾸며내지 마십시오.

반드시 아래의 [응답 형식]을 엄격하게 준수하여 대괄호 제목과 줄바꿈을 활용하십시오.

[응답 형식]
[요약]
검색 결과에 따른 핵심 보장 및 면책 여부 요약 (2~3문장).
[조건]
- 보장이 지급되기 위해 만족해야 하는 명확한 약관상 조건들을 기재하십시오 (예: 사고 구분, 치료 항목, 지급 비율 등).
- 찾지 못했다면 이 항목을 생략하십시오.
[주의사항]
- 보상 제외 대상(면책 조항), 한도 제한, 지급 거절 요인 등을 약관 기준으로 상세히 기재하십시오.
- 찾지 못했다면 이 항목을 생략하십시오.

[공식 공시자료]
${searchContext}`
        },
        {
          role: "user",
          content: question
        }
      ]
    });

    const responseText = chatCompletion.choices[0].message?.content || "";

    // 4. Robust parsing of the reasoning response
    let summary = "";
    let conditions: string[] = [];
    let cautions: string[] = [];

    const summaryStart = responseText.indexOf("[요약]");
    const conditionsStart = responseText.indexOf("[조건]");
    const cautionsStart = responseText.indexOf("[주의사항]");

    if (summaryStart !== -1) {
      const end = conditionsStart !== -1 ? conditionsStart : (cautionsStart !== -1 ? cautionsStart : responseText.length);
      summary = responseText.substring(summaryStart + 4, end).trim();
    } else {
      summary = responseText;
    }

    if (conditionsStart !== -1) {
      const end = cautionsStart !== -1 ? cautionsStart : responseText.length;
      const rawConditions = responseText.substring(conditionsStart + 4, end).trim();
      conditions = rawConditions.split("\n").map(l => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    }

    if (cautionsStart !== -1) {
      const rawCautions = responseText.substring(cautionsStart + 6).trim();
      cautions = rawCautions.split("\n").map(l => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    }

    // 5. Generate high-quality citations, excluding any generic FAQ pages
    const citations = finalResults
      .filter((r: any) => {
        // Double check: do not export FAQ links as citations
        const url = (r.url || "").toLowerCase();
        return !(
          url.includes("/faq") ||
          url.includes("/customer") ||
          url.includes("/main") ||
          url.includes("/index") ||
          url.includes("faqdetail")
        );
      })
      .map((r: any, i: number) => ({
        id: `citation-${i + 1}-${r.url ? crypto.randomUUID().substring(0, 8) : "unknown"}`,
        title: r.title || "DB손해보험 공식 공시실",
        section: "상품 공시/기초서류",
        page: 1,
        version: productHint || "공식 공시 정보",
        sourceUrl: r.url || "https://disclosure.idbins.com/",
        excerpt: (r.content || "").substring(0, 200) + "..."
      }));

    return NextResponse.json({
      id: crypto.randomUUID(),
      question,
      intent: body.intent ?? classifyIntent(question),
      summary,
      conditions,
      cautions,
      requiredInfo: [
        "정확한 상품 명칭 및 약관 개정 버전",
        "가입 시기 및 청구 항목의 영수증/진단서",
        "해당 상품이 판매상품인지 판매중지 상품인지 여부"
      ],
      citations,
      disclaimer: "본 답변은 DB손해보험 공식 상품공시실의 기초서류 검색을 바탕으로 o3-mini 추론 엔진이 분석한 전문가용 자료이며, 최종 보상 지급 판단은 심사 결과에 따라 다를 수 있습니다."
    });

  } catch (err: any) {
    console.error("o3-mini RAG API 실행 중 에러 발생:", err);
    return NextResponse.json(
      { error: "RAG 실행 오류", detail: err.message || err },
      { status: 500 }
    );
  }
}
