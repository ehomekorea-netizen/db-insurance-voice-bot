import { NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { buildPolicyAnswer, classifyIntent, type PolicyIntent } from "@/lib/policyKnowledge";
import { correctInsuranceTerms } from "@/lib/koreanFuzzy";

export const runtime = "nodejs";

type PolicyAnswerRequest = {
  question?: string;
  intent?: PolicyIntent;
  product_hint?: string;
};

// Real-time webpage/PDF scraper via Jina Reader API
async function scrapeUrl(url: string, apiKey?: string): Promise<string> {
  if (!url) return "";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // Strict 3.5s timeout for scraping
    
    const headers: Record<string, string> = {
      "Accept": "text/plain"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[Jina Reader] Failed to scrape ${url}: HTTP ${response.status}`);
      return "";
    }
    const text = await response.text();
    return text.substring(0, 8000); // Truncate content to first 8,000 characters to prevent prompt bloat
  } catch (err) {
    console.warn(`[Jina Reader] Error scraping ${url}:`, err);
    return "";
  }
}

// Preprocess conversational user question into optimized Korean search keywords
async function generateSearchQuery(openai: OpenAI, question: string, currentDate: string, productHint?: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 DB손해보험 설계사(PA)를 지원하기 위한 한국어 보험 약관 RAG 구글 검색 쿼리 최적화기입니다.
현재 날짜와 시간 정보: ${currentDate}
사용자의 질문과 상품 힌트를 분석하여, 구글 검색(Google Search)에 가장 최적화된 명사 위주의 한글 검색 키워드를 생성하십시오.

[시간 지칭어 규칙]
- 사용자가 '올해', '최근', '이번에' 등을 말하면 현재 연도인 ${currentDate}를 기준으로 삼아 구체적인 연도(예: 2026년)를 검색어에 반드시 명시해 주십시오. (예: '올해 6월 개정' -> '2026년 6월 개정')

[구글 검색 최적화 규칙]
1. 보험 상품 명칭(예: 참좋은운전자보험, 참좋은훼밀리플러스 등)은 반드시 큰따옴표로 감싸서 구글에서 정확히 매칭되도록 하십시오 (예: "참좋은운전자보험").
2. 자연어 조사(은, 는, 이, 가, 을, 를, 에, 에서 등)는 최대한 탈락시키고 검색에 유효한 핵심 키워드(명사)만 띄어쓰기로 나열하십시오.
3. 약관 규정, 면책사항, 서류 등을 묻는 경우 "약관", "면책", "구비서류", "개정" 등의 중요 단어를 명시적으로 포함시키십시오.

[중요: 음성 인식(STT) 오타 및 보험 도메인 용어 교정 규칙]
사용자의 질문은 음성 인식 과정을 거쳐 유입되므로, 발음이 유사한 오타나 오인식된 단어가 다수 포함되어 있습니다. 당신은 보험 전문가로서 컨텍스트와 의도(Intent)를 파악하여 아래와 같이 올바른 보험 도메인 용어로 반드시 보정한 후 검색 키워드를 생성해야 합니다.
- '2번 의료비', '2번 보장', '이본', '이번' -> 문맥상 입원(hospitalization) 의료비/보장으로 반드시 해석 (예: "2번 의료비랑 통원" -> "입원의료비 통원의료비")
- '수치료', '도수치로' -> '도수치료'로 보정 (수치료는 하이드로테라피가 아닌 발음 오류로 인한 '도수치료'일 확률이 99%입니다)
- '나비', '나비면제' -> '납입', '납입면제'로 보정 (보험 보상 조건에서 '나비면제'는 '납입면제'의 음성 인식 오타 또는 발음 실수일 확률이 100%입니다)
- '포장', '포장한도' -> '보장', '보장한도'로 보정
- '실소', '실선', '실선보험' -> '실손', '실손보험'으로 보정
- '고번에' -> '이번에' 등 문맥상 불필요한 발음 오타 제거 및 교정

[약관 개정 시점 및 단종 상품 규칙]
- 사용자의 가입 시기 단서(예: 2009년, 2017년 등)가 있다면 검색어에 해당 가입 년도와 "과거 약관", "개정전", "표준화이전" 등의 키워드를 적극적으로 병합하십시오.

[출력 규칙]
1. 오직 공백으로 구분된 한글 검색 키워드들만 출력하십시오. (큰따옴표 외의 특수 기호는 금지)
2. 키워드 목록은 7단어 이내로 간결하게 하십시오.
3. 반드시 "DB손해보험" 또는 "DB손해"라는 핵심 키워드를 포함시키십시오.`
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

  const apiKey = process.env.OPENAI_API_KEY;
  const serperApiKey = process.env.SERPER_API_KEY;

  // FALLBACK: If API Keys are not configured, fallback to local sample data
  if (!apiKey || !serperApiKey) {
    console.warn("경고: OPENAI_API_KEY 또는 SERPER_API_KEY가 설정되지 않아 로컬 MVP 샘플 데이터로 응답합니다.");
    const fallbackAnswer = buildPolicyAnswer({
      question,
      intent: body.intent ?? classifyIntent(question),
      productHint: body.product_hint
    });
    fallbackAnswer.searchEngine = "로컬 MVP 샘플 데이터";
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
    const searchQuery = await generateSearchQuery(openai, question, currentDateString, productHint);

    let finalResults: any[] = [];
    let extraContext = "";
    let usedEngine = "자체 사전지식";
    let searchSuccess = false;
    let searchErrors: string[] = [];

    // Dynamic Query Enrichment: If searching for official rules/deductibles, restrict query to official sites
    const isOfficialQuery = /약관|개정|보장|지급|제외|면책|한도|서류|기준|운전자|실손|보험료|할인/i.test(question + " " + searchQuery);
    let serperQuery = searchQuery;
    if (isOfficialQuery) {
      serperQuery = `${searchQuery} (site:disclosure.idbins.com OR site:idbins.com OR site:fss.or.kr OR site:knia.or.kr OR site:klia.or.kr)`;
      console.log(`[공식 사이트 필터 적용] 구글 검색 쿼리: ${serperQuery}`);
    } else {
      console.log(`[일반 웹 검색 적용] 구글 검색 쿼리: ${serperQuery}`);
    }

    // Try Google Search via Serper.dev
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": serperApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: serperQuery,
          gl: "kr",
          hl: "ko",
          num: 4
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Serper HTTP ${response.status}: ${errText.substring(0, 80).trim()}`);
      }

      const data = await response.json();
      const organicResults = data.organic || [];
      const answerBox = data.answerBox;
      const peopleAlsoAsk = data.peopleAlsoAsk || [];

      let parsedResults: any[] = [];

      // 1. Capture Google AnswerBox (Featured Snippet)
      if (answerBox) {
        const abContent = answerBox.answer || answerBox.snippet || "";
        if (abContent) {
          console.log("구글 AnswerBox 요약 데이터 감지됨");
          extraContext += `[구글 추천 답변 (AnswerBox)]\n제목: ${answerBox.title || "구글 공식 추천 요약"}\n출처 주소: ${answerBox.link || ""}\n내용: ${abContent}\n\n`;
          parsedResults.push({
            title: `[추천답변] ${answerBox.title || "구글 공식 요약"}`,
            url: answerBox.link || "",
            content: abContent,
            raw_content: abContent
          });
        }
      }

      // 2. Capture Google PeopleAlsoAsk (Related Q&A)
      if (peopleAlsoAsk.length > 0) {
        const paaItems = peopleAlsoAsk.slice(0, 2);
        console.log(`구글 연관 Q&A 감지됨: ${paaItems.length}개`);
        extraContext += `[연관 Q&A (People Also Ask)]\n`;
        paaItems.forEach((paa: any, idx: number) => {
          const paaContent = paa.snippet || paa.answer || "";
          if (paaContent) {
            extraContext += `질문 ${idx + 1}: ${paa.question}\n답변: ${paaContent}\n출처 주소: ${paa.link || ""}\n\n`;
            parsedResults.push({
              title: `[연관질문] ${paa.question}`,
              url: paa.link || "",
              content: paaContent,
              raw_content: paaContent
            });
          }
        });
      }

      // 3. Capture Organic Results & Scrape Top 2 pages in parallel
      let scrapedSections: string[] = [];
      if (organicResults.length > 0) {
        const organicMapped = organicResults.slice(0, 4).map((r: any) => ({
          title: r.title || "참고자료",
          url: r.link || "",
          content: r.snippet || "",
          raw_content: r.snippet || ""
        }));
        parsedResults.push(...organicMapped);

        // Scrape top 2 URLs in parallel using Jina Reader
        const scrapeTargets = organicResults.slice(0, 2);
        console.log(`[Jina Reader] 상위 ${scrapeTargets.length}개 링크 실시간 본문 스크래핑 시작...`);
        const jinaApiKey = process.env.JINA_API_KEY;
        
        try {
          const scrapedContents = await Promise.all(
            scrapeTargets.map((r: any) => scrapeUrl(r.link, jinaApiKey))
          );
          
          scrapedContents.forEach((content, idx) => {
            const target = scrapeTargets[idx];
            if (content && content.trim()) {
              console.log(`[Jina Reader] 스크래핑 성공: ${target.link} (${content.length}자)`);
              scrapedSections.push(`[공식 문서 실시간 분석 자료 ${idx + 1}]
출처 주소: ${target.link}
제목: ${target.title}
상세 본문 내용:
${content}`);
            }
          });
        } catch (scrapeErr) {
          console.warn("[Jina Reader] 실시간 스크래핑 중 에러 발생:", scrapeErr);
        }
      }

      if (scrapedSections.length > 0) {
        extraContext += `[구글 실시간 공식 문서 스크래핑 결과]\n${scrapedSections.join("\n\n")}\n\n`;
      }

      if (parsedResults.length > 0) {
        finalResults = parsedResults.slice(0, 5); // Keep top 5 results for citation links
        usedEngine = "Google (Serper)";
        searchSuccess = true;
        console.log(`Google Serper Search 성공: 총 ${finalResults.length}개 컨텍스트 구축 완료`);
      } else {
        console.log("Google Serper Search 결과 없음");
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn("Google Serper Search 실패:", errMsg);
      searchErrors.push(`Serper: ${errMsg}`);
    }

    let searchContext = "";
    if (searchSuccess && finalResults.length > 0) {
      const organicContext = finalResults.map((r: any, i: number) => {
        return `[검색 자료 ${i + 1}]
제목: ${r.title}
출처 주소: ${r.url}
내용: ${r.content}`;
      }).join("\n\n");

      searchContext = extraContext 
        ? `${extraContext}---\n\n${organicContext}`
        : organicContext;
    } else {
      usedEngine = searchErrors.length > 0
        ? `자체 사전지식 (${searchErrors.join(", ")})`
        : "자체 사전지식";
      searchContext = "DB손해보험 상품공시실 및 웹 검색에서 구체적인 약관 및 보장 정보를 찾지 못했거나 검색 엔진에 에러가 발생하여 자체 지식 분석 결과를 제공합니다.";
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

현재 시점 정보: ${currentDateString}

[중요: 시간적 지칭 및 검색 데이터 불일치 대응 규칙]
- 현재 연도는 ${currentDateString} (2026년) 기준입니다.
- 만약 사용자가 '올해(2026년)' 혹은 특정 시점의 개정 사항에 대해 질문하였으나, 제공된 [검색 및 공시자료]에 해당 시점(2026년)의 자료가 존재하지 않고 과거 연도(예: 2023년 등)의 자료만 검색되는 경우, 절대 과거 연도 자료를 '올해(2026년)의 개정 자료'인 것처럼 왜곡하거나 생략하여 답변하지 마십시오.
- 이 경우 반드시 [분석 배경 및 이해] 및 [요약] 단락에서 "현재 시점은 2026년이나, 검색 결과에 2026년 6월 개정 자료가 확인되지 않아 가장 최근에 확인되는 2023년 6월 개정 약관 내용을 기준으로 분석 결과를 제공합니다."와 같이 시간적 정보 불일치 사실을 정확하게 밝히십시오.

[답변 작성 원칙]
- 대화체나 존댓말을 장황하게 쓰지 말고, 공문서나 보고서 스타일로 전문 용어(면책, 자기부담금, 공제율, 특약, 구비서류 등)를 사용하여 핵심만 명확하게 작성하십시오.
- 사용자가 '올해', '현재', '최근', '이번에'라고 언급하면 현재 시점인 ${currentDateString}를 기준으로 판단하십시오.
- 사용자가 확인해 준 가입 연도나 판매유무(판매상품/판매중지) 단서가 있다면, 해당 약관 및 보상 시점을 기준으로 정확히 보상 범위나 구비서류를 추론하여 작성하십시오.
- 제공된 자료 상에서 특정 정보가 확실하지 않다면, 추론 과정과 한계(예: "공시자료상 2009년 표준화 이전 상해의료비 세부 공제 비율은 확인되지 않음")를 솔직하게 명시하고, [확인 필요 사항]에 구체적으로 적어 넣으십시오.
- 절대 임의로 답변을 꾸며내지 마십시오.
- 검색 결과 중 블로그 글(naver.com, tistory.com 등)은 반드시 여러 출처에서 교차 검증된 객관적인 사실과 내용만 답변에 채택하여 사용하십시오.
- 사용자의 질문은 음성 인식(STT) 과정에서 오타나 유사한 발음의 잘못된 전문 용어(예: '포장' -> '보장', '수치료' -> '도수치료', '실선' -> '실손', '나비면제' -> '납입면제')로 입력될 수 있으므로, 문맥을 파악해 자동으로 올바른 보험 용어로 정정 및 이해하여 답변을 작성하고 답변 내에서도 오타 단어를 그대로 쓰지 마십시오.
- 특히, '도수치료'가 발음이나 오타로 인해 '수치료'로 잘못 입력되는 경우가 빈번합니다. 보상/청구 관련 질문에서 '수치료'라는 오타가 감지되면, 이를 반드시 '도수치료'로 올바르게 교정하여 '도수치료의 가입년도별 보상 규정(횟수 한도, 자기부담금 등)'을 설명하십시오.
- 또한, '납입면제'가 발음이나 오타로 인해 '나비면제'나 '나비'로 잘못 입력되는 경우가 있습니다. 이 경우 절대 '나비면제'라는 오인식 단어를 답변서에 그대로 쓰지 말고, 반드시 '납입면제'로 통일하여 교정하여 보상 규정(예: 자부치 부상 등급별 납입면제 대상)을 설명하십시오. 단어 정정이 이루어져야 신뢰성 있는 분석서가 됩니다.

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
      disclaimer: "본 답변은 DB손해보험 공식 상품공시실의 기초서류 검색을 바탕으로 AI 추론 엔진이 분석한 전문가용 자료이며, 최종 보상 지급 판단은 심사 결과에 따라 다를 수 있습니다.",
      searchEngine: usedEngine
    });

  } catch (err: any) {
    console.error("RAG API 실행 중 에러 발생:", err);
    return NextResponse.json(
      { error: "RAG 실행 오류", detail: err.message || err },
      { status: 500 }
    );
  }
}
