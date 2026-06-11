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
    // 1. Perform Real-time Web Search using Tavily (restricted to idbins.com)
    const searchResponse = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query: `DB손해보험 약관 상품 ${question}`,
        search_depth: "advanced",
        include_domains: ["idbins.com"],
        max_results: 3
      })
    });

    if (!searchResponse.ok) {
      const errText = await searchResponse.text();
      throw new Error(`Tavily API responded with status ${searchResponse.status}: ${errText}`);
    }

    const searchData = await searchResponse.json();
    const results = searchData.results || [];

    let searchContext = "";
    if (results.length > 0) {
      searchContext = results.map((r: any, i: number) => {
        return `[검색 결과 ${i + 1}]
제목: ${r.title}
URL: ${r.url}
내용: ${r.content}`;
      }).join("\n\n");
    } else {
      searchContext = "공식 홈페이지에서 해당 질문에 대한 관련 약관 검색 결과를 찾지 못했습니다.";
    }

    // 2. Query OpenAI Chat Completions API with the search context
    const openai = new OpenAI({ apiKey });
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 DB손해보험 약관에 대해 전문적이고 솔직하게 설명해주는 AI 보험 상담원입니다.
제공된 [공식 사이트 검색 결과]만을 면밀히 분석하여 사용자의 질문에 성실히 대답하십시오.

답변할 때는 반드시 아래의 [응답 형식]을 엄격하게 준수해야 합니다. 대괄호 제목과 각 항목의 구분 기호를 정확하게 출력하십시오.

[응답 형식]
[요약]
질문에 대한 핵심 요약 및 답변 (2~3문장). 만약 검색 결과에서 정확한 정보를 찾을 수 없거나 내용이 부족하다면 억지로 지어내지 마시고, 공식 홈페이지에서 명확한 정보를 찾지 못했음을 설명해주십시오.
[조건]
- 보장 또는 지급을 받기 위해 만족해야 하는 구체적인 조건들(가입 유형, 연령, 보상 비율 등)을 목록으로 나열하십시오.
- 검색 결과에서 구체적인 조건을 찾지 못했다면 이 항목을 비워두거나 생략하십시오.
[주의사항]
- 보장 범위에서 제외되는 사항(면책 조항), 한도 제한, 가입 시 유의할 점을 나열하십시오.
- 검색 결과에서 주의사항을 찾지 못했다면 이 항목을 비워두거나 생략하십시오.

[공식 사이트 검색 결과]
${searchContext}`
        },
        {
          role: "user",
          content: question
        }
      ],
      temperature: 0.1
    });

    const responseText = chatCompletion.choices[0].message?.content || "";

    // 3. Robust parsing of the response text
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

    // 4. Map search results to citations
    const citations = results.map((r: any, i: number) => ({
      id: `citation-${i + 1}-${r.url ? crypto.randomUUID().substring(0, 8) : "unknown"}`,
      title: r.title || "DB손해보험 공식 홈페이지",
      section: "약관/공시실 정보",
      page: 1,
      version: "실시간 공식 공시",
      sourceUrl: r.url || "https://www.idbins.com/",
      excerpt: r.content || ""
    }));

    return NextResponse.json({
      id: crypto.randomUUID(),
      question,
      intent: body.intent ?? classifyIntent(question),
      summary,
      conditions,
      cautions,
      requiredInfo: [
        "정확한 상품명 또는 보험 가입 시기",
        "사고 발생 경위 및 진단서",
        "본인 보험 가입 증권 또는 청구서류"
      ],
      citations,
      disclaimer: "본 답변은 DB손해보험 공식 사이트의 최신 공시 정보를 실시간으로 검색하여 작성된 결과이며, 최종 보상 및 가입 여부는 구체적인 계약 조건과 심사 결과에 따라 달라질 수 있습니다."
    });

  } catch (err: any) {
    console.error("Tavily RAG API 실행 중 에러 발생:", err);
    return NextResponse.json(
      { error: "RAG 실행 오류", detail: err.message || err },
      { status: 500 }
    );
  }
}
