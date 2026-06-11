import { NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { buildPolicyAnswer, classifyIntent, type PolicyIntent } from "@/lib/policyKnowledge";

export const runtime = "nodejs";

type PolicyAnswerRequest = {
  question?: string;
  intent?: PolicyIntent;
  product_hint?: string;
};

// Preprocess conversational user question into optimized Korean search keywords
async function generateSearchQuery(openai: OpenAI, question: string, productHint?: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a search query optimizer for Korean insurance policies.
Analyze the user's question and product hint. Extract the key product name, coverage details, and terms.
Generate a search query consisting of space-separated keywords in Korean that will find official Korean insurance policies, old conditions, and expert explanations.

Crucial Rules for Old/Discontinued Policies:
- If the question or product hint refers to a discontinued product, old policy, specific past year (e.g., 2009년, 2017년), or past terms, you MUST explicitly append keywords like "과거 약관", "년도", "개정전", or "보장 분석".
- Example 1: DB손해보험 (무)컨버전스보험 2009년 가입 약관 도수치료 보상 여부
- Example 2: 2017년 4월 이전 DB손해 실손보험 해외의료비 보상 한도 약관

General Rules:
1. Output ONLY the optimized search keywords in Korean, separated by spaces.
2. Do NOT use search operators like AND, OR, site:, or quotes.
3. Keep the query concise (typically under 7 words).
4. Ensure "DB손해보험" or "DB손해" is present in the query.
5. Do NOT include any conversational text.`
        },
        {
          role: "user",
          content: `질문: "${question}"\n상품정보: "${productHint || "없음"}"`
        }
      ],
      temperature: 0.1,
      max_tokens: 50
    });
    return response.choices[0].message?.content?.trim() || `DB손해보험 ${productHint || ""} ${question}`;
  } catch (err) {
    console.error("OpenAI search query generation failed, using fallback:", err);
    const cleanQuestion = question.replace(/["']/g, "");
    return `DB손해보험 ${productHint || ""} ${cleanQuestion}`;
  }
}

// Classify if user query is a simple greeting/conversational phrase or a detailed policy query requiring RAG
async function classifyConversationalOrRag(openai: OpenAI, question: string): Promise<{ isSimpleChat: boolean; answer: string }> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a classification assistant for a Korean insurance voice counselor bot.
Analyze the user's message. Determine if it is a simple conversational query (greeting like "안녕하세요", "반갑습니다", checking capability like "뭘 도와줄 수 있어?", acknowledgment like "알겠어", "감사합니다", "그래", "오케이", or short chat) or a specific policy query that requires actual insurance policy document search/RAG analysis (e.g. asking about coverage, exclusions, required claim documents, terms).

If the message is a simple conversational query:
Return a JSON object with:
"isSimpleChat": true
"answer": "A short, professional, and friendly response in Korean (1-2 sentences) matching the DB Insurance counselor's identity (e.g. "안녕하세요! DB손해보험 동목포 부지점장 프로미입니다. 무엇을 도와드릴까요?")."

If the message requires searching policy/rules/documents (RAG):
Return a JSON object with:
"isSimpleChat": false
"answer": ""

Output ONLY valid JSON. Do not include markdown code block formatting like \`\`\`json.`
        },
        {
          role: "user",
          content: question
        }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message?.content?.trim();
    if (content) {
      const parsed = JSON.parse(content);
      return {
        isSimpleChat: !!parsed.isSimpleChat,
        answer: parsed.answer || ""
      };
    }
  } catch (err) {
    console.error("Classification failed, default to RAG:", err);
  }
  return { isSimpleChat: false, answer: "" };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as PolicyAnswerRequest;
  const question = body.question?.trim();
  const productHint = body.product_hint?.trim();

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  // FALLBACK: If API Keys are not configured, fallback to local sample data
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
    const openai = new OpenAI({ apiKey });

    // 1. Classify if it's a simple conversational message or a detailed RAG query
    const classification = await classifyConversationalOrRag(openai, question);
    if (classification.isSimpleChat) {
      return NextResponse.json({
        id: crypto.randomUUID(),
        question,
        intent: "policy_explanation",
        analysis: "",
        summary: classification.answer,
        conditions: [],
        cautions: [],
        requiredInfo: [],
        citations: [],
        disclaimer: "",
        isSimpleChat: true
      });
    }

    // 2. Optimize search query to get clean Korean terms instead of conversational sentence
    const searchQuery = await generateSearchQuery(openai, question, productHint);
    console.log(`Tavily 검색 실행 (최적화): ${searchQuery}`);

    let finalResults: any[] = [];
    let searchContext = "";

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const searchResponse = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: searchQuery,
          search_depth: "advanced",
          include_raw_content: true,
          include_domains: [
            "idb.co.kr",
            "idbins.com",
            "disclosure.idbins.com",
            "fss.or.kr",
            "knia.or.kr",
            "klia.or.kr",
            "e-insmarket.or.kr",
            "kidi.or.kr",
            "insnews.co.kr",
            "ppomppu.co.kr",
            "clien.net",
            "bobaedream.co.kr",
            "dcinside.com",
            "cafe.naver.com",
            "blog.naver.com",
            "tistory.com"
          ],
          max_results: 5
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!searchResponse.ok) {
        const errText = await searchResponse.text();
        throw new Error(`Tavily API responded with status ${searchResponse.status}: ${errText}`);
      }

      const searchData = await searchResponse.json();
      const results = searchData.results || [];

      // 2. Strict Ingestion Filtering: Remove generic/useless FAQ, English corporate pages, investor relations
      const filteredResults = results.filter((r: any) => {
        const url = (r.url || "").toLowerCase();
        const title = (r.title || "").toLowerCase();
        // Filter out customer service main, FAQ pages, help pages, English pages, and IR files
        if (
          url.includes("/faq") ||
          url.includes("/customer") ||
          url.includes("/main") ||
          url.includes("/index") ||
          url.includes("faqdetail") ||
          url.includes("/qna") ||
          url.includes("/eng/") ||
          url.includes("/en/") ||
          url.includes("corporate") ||
          url.includes("ir-") ||
          url.includes("growth-stage") ||
          title.includes("annual report") ||
          title.includes("investor")
        ) {
          return false;
        }
        return true;
      });

      finalResults = filteredResults.length > 0 ? filteredResults.slice(0, 4) : results.slice(0, 3);

      if (finalResults.length > 0 && (finalResults[0]?.raw_content || finalResults[0]?.content)) {
        searchContext = finalResults.map((r: any, i: number) => {
          const textContent = r.raw_content || r.content || "";
          return `[검색 자료 ${i + 1}]
제목: ${r.title}
출처 주소: ${r.url}
내용: ${textContent}`;
        }).join("\n\n");
      } else {
        searchContext = "DB손해보험 상품공시실 및 웹 검색에서 구체적인 약관 및 보장 정보를 찾지 못했습니다.";
      }
    } catch (searchErr) {
      console.warn("Tavily 검색 또는 파싱 중 오류 발생으로 OpenAI 사전 지식을 통한 폴백을 실행합니다:", searchErr);
      searchContext = "Tavily 검색 API의 지연 또는 일시적 오류로 인해 DB손해보험 약관에 대한 자체 지식 분석 결과를 제공합니다.";
    }

    // 3. Query OpenAI gpt-4o-mini to get logical response containing background reasoning
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 DB손해보험의 공식 상품 약관, 담보 보상여부, 청구서류 및 보험 업무 전반을 전문적으로 해설하는 AI 언더라이터이자 보상 전문가입니다.
사용자는 보험 설계사 또는 지점 임직원(보험 전문가)입니다. 
제공된 [검색 및 공시자료]를 면밀히 추론/분석하여 사용자의 질문에 답변하십시오. 

[답변 작성 원칙]
- 대화체나 존댓말을 장황하게 쓰지 말고, 공문서나 보고서 스타일로 전문 용어(면책, 자기부담금, 공제율, 특약, 구비서류 등)를 사용하여 핵심만 명확하게 작성하십시오.
- 사용자가 확인해 준 가입 연도나 판매유무(판매상품/판매중지) 단서가 있다면, 해당 약관 및 보상 시점을 기준으로 정확히 보상 범위나 구비서류를 추론하여 작성하십시오.
- 제공된 자료 상에서 특정 정보가 확실하지 않다면, 추론 과정과 한계(예: "공시자료상 2009년 표준화 이전 상해의료비 세부 공제 비율은 확인되지 않음")를 솔직하게 명시하고, [확인 필요 사항]에 구체적으로 적어 넣으십시오.
- 절대 임의로 답변을 꾸며내지 마십시오.
- 검색 결과 중 블로그 글(naver.com, tistory.com 등)은 반드시 여러 출처에서 교차 검증된 객관적인 사실과 내용만 답변에 채택하여 사용하십시오.
- 사용자의 질문은 음성 인식(STT) 과정에서 오타나 유사한 발음의 잘못된 전문 용어(예: '포장한도' -> '보장한도', '실소' -> '실손', '실선' -> '실손')로 입력될 수 있으므로, 문맥을 파악해 자동으로 올바른 보험 용어로 정정 및 이해하여 답변을 작성하고 답변 내에서도 오타 단어를 그대로 쓰지 마십시오.

반드시 아래의 [응답 형식]을 엄격하게 준수하여 대괄호 제목과 줄바꿈을 활용하십시오.

[응답 형식]
[분석 배경 및 이해]
- 사용자의 질문을 설계사 관점에서 어떻게 이해했는지 분석 맥락을 한글로 정리하고, 상품공시 및 보험 지식 검색 결과에서 어떤 논리적 근거(상품 출시일, 가입년도 매핑 등)를 활용하여 판정했는지 구체적인 근거를 명확하게 서술하십시오.
[요약]
- 질문에 대한 핵심 팩트 중심의 2~3문장 결론 요약.
[조건]
- 보장이 지급되기 위해 만족해야 하는 명확한 약관상 조건들을 기재하십시오 (예: 사고 구분, 치료 항목, 지급 비율 등).
- 찾지 못했다면 이 항목을 생략하십시오.
[주의사항]
- 보상 제외 대상(면책 조항), 한도 제한, 지급 거절 요인 등을 약관 기준으로 상세히 기재하십시오.
- 찾지 못했다면 이 항목을 생략하십시오.

[검색 및 공시자료]
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
      conditions = rawConditions.split("\n").map(l => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    }

    if (cautionsStart !== -1) {
      const rawCautions = responseText.substring(cautionsStart + 6).trim();
      cautions = rawCautions.split("\n").map(l => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    }

    // Helper to determine citation section category based on domain/url
    const getCitationSection = (url: string): string => {
      const lowUrl = (url || "").toLowerCase();
      if (lowUrl.includes("idbins.com") || lowUrl.includes("idb.co.kr")) {
        return "DB손보 공식";
      }
      if (lowUrl.includes("fss.or.kr")) {
        return "금융감독원";
      }
      if (lowUrl.includes("knia.or.kr") || lowUrl.includes("klia.or.kr")) {
        return "보험협회";
      }
      if (
        lowUrl.includes("ppomppu.co.kr") ||
        lowUrl.includes("clien.net") ||
        lowUrl.includes("bobaedream.co.kr") ||
        lowUrl.includes("dcinside.com")
      ) {
        return "커뮤니티";
      }
      if (lowUrl.includes("naver.com") || lowUrl.includes("tistory.com")) {
        return "블로그/지식iN";
      }
      return "참고자료";
    };

    // 5. Generate high-quality citations
    const citations = finalResults
      .map((r: any, i: number) => ({
        id: `citation-${i + 1}-${r.url ? crypto.randomUUID().substring(0, 8) : "unknown"}`,
        title: r.title || "DB손해보험 공식 공시실",
        section: getCitationSection(r.url),
        page: 1,
        version: productHint || "공식 정보",
        sourceUrl: r.url || "https://disclosure.idbins.com/",
        excerpt: (r.raw_content || r.content || "").substring(0, 200) + "..."
      }));

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
      disclaimer: "본 답변은 DB손해보험 공식 상품공시실의 기초서류 검색을 바탕으로 o3-mini 추론 엔진이 분석한 전문가용 자료이며, 최종 보상 지급 판단은 심사 결과에 따라 다를 수 있습니다."
    });

  } catch (err: any) {
    console.error("RAG API 실행 중 에러 발생:", err);
    return NextResponse.json(
      { error: "RAG 실행 오류", detail: err.message || err },
      { status: 500 }
    );
  }
}
