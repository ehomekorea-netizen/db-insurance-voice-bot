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
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

  // FALLBACK: If OpenAI Key or Vector Store ID is not configured, fallback to local MVP mock database
  if (!apiKey || !vectorStoreId) {
    console.warn("경고: OPENAI_API_KEY 또는 OPENAI_VECTOR_STORE_ID가 설정되지 않아 로컬 MVP 샘플 데이터로 응답합니다.");
    const fallbackAnswer = buildPolicyAnswer({
      question,
      intent: body.intent ?? classifyIntent(question),
      productHint: body.product_hint
    });
    return NextResponse.json(fallbackAnswer);
  }

  // Initializing OpenAI Client
  const openai = new OpenAI({ apiKey });
  let assistant: any = null;
  let thread: any = null;

  try {
    // 1. Create an ephemeral Assistant configured with File Search
    assistant = await openai.beta.assistants.create({
      name: "DB손해보험 MVP 약관 상담 RAG",
      instructions: `당신은 DB손해보험 약관에 대해 정확하게 상담해주는 AI 상담원입니다. 제공된 파일 검색(File Search) 약관 문서 결과를 철저히 탐색하여 고객의 질문에 대답하십시오. 답변할 때는 반드시 아래의 [응답 형식]을 엄격하게 준수해야 합니다. 대괄호 제목과 구분 기호(줄바꿈 등)를 정확하게 출력하십시오.

[응답 형식]
[요약]
질문에 대한 전반적인 RAG 요약 답변 (2~3문장).
[조건]
- 주요 보장 지급 조건 또는 해당 조건 1
- 주요 보장 지급 조건 또는 해당 조건 2
[주의사항]
- 면책 조항, 한도, 유의해야 할 사항 1
- 면책 조항, 한도, 유의해야 할 사항 2`,

      model: "gpt-4o-mini", // Fast and cost-efficient
      tools: [{ type: "file_search" }]
    });

    // 2. Create a Thread with the specified Vector Store attached
    thread = await openai.beta.threads.create({
      messages: [
        {
          role: "user",
          content: question
        }
      ],
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId]
        }
      }
    });

    // 3. Run the thread and wait for completion
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistant.id
    });

    if (run.status !== "completed") {
      throw new Error(`OpenAI Assistants Run failed with status: ${run.status}`);
    }

    // 4. Retrieve Messages and extract AI response text
    const messageList = await openai.beta.threads.messages.list(thread.id);
    const lastMsg = messageList.data[0];

    let responseText = "";
    const citations: any[] = [];

    if (lastMsg && lastMsg.content[0].type === "text") {
      const textContent = lastMsg.content[0].text;
      responseText = textContent.value;
      const annotations = textContent.annotations || [];

      // Process Citations
      let citationIndex = 1;
      for (const annotation of annotations) {
        if (annotation.type === "file_citation") {
          const fileCitation = annotation.file_citation;
          const fileId = fileCitation?.file_id;
          const quote = fileCitation?.quote || "약관 원문 인용";

          let filename = "DB손해보험 약관 PDF";
          if (fileId) {
            try {
              // Retrieve filename from OpenAI Files API
              const fileInfo = await openai.files.retrieve(fileId);
              filename = fileInfo.filename;
            } catch (err) {
              console.error(`파일 정보 조회 실패 (File ID: ${fileId}):`, err);
            }
          }

          // Replace source annotation markup (e.g. 【12:1†source】) in response text
          const annotationText = annotation.text;
          responseText = responseText.replace(annotationText, ` [참조: ${filename}]`);

          citations.push({
            id: `citation-${citationIndex++}-${fileId ? fileId.substring(5, 12) : "unknown"}`,
            title: filename,
            section: "약관 세부 조항",
            page: 1, // File Search typically does not provide direct PDF page numbers natively
            version: "공식 약관",
            sourceUrl: "https://www.idbins.com/",
            excerpt: quote
          });
        }
      }
    }

    // 5. Parse responseText into summary, conditions, and cautions based on the format
    const summaryMatch = responseText.match(/\[요약\]([\s\S]*?)\[조건\]/);
    const conditionsMatch = responseText.match(/\[조건\]([\s\S]*?)\[주의사항\]/);
    const cautionsMatch = responseText.match(/\[주의사항\]([\s\S]*)/);

    const summary = summaryMatch ? summaryMatch[1].trim() : responseText;
    
    const conditions = conditionsMatch 
      ? conditionsMatch[1]
          .split("\n")
          .map(line => line.replace(/^-\s*/, "").trim())
          .filter(Boolean)
      : [];

    const cautions = cautionsMatch 
      ? cautionsMatch[1]
          .split("\n")
          .map(line => line.replace(/^-\s*/, "").trim())
          .filter(Boolean)
      : [];

    // 6. Return standard structured response matching PolicyAnswer type
    return NextResponse.json({
      id: crypto.randomUUID(),
      question,
      intent: body.intent ?? classifyIntent(question),
      summary,
      conditions,
      cautions,
      requiredInfo: [
        "정확한 상품명 또는 보험증권 번호",
        "가입일과 약관 버전",
        "사고 경위 및 청구 예정 서류"
      ],
      citations,
      disclaimer: "이 답변은 OpenAI File Search 약관 원문을 검색하여 산출된 결과이며, 최종 보상 판단은 심사 결과에 따라 다를 수 있습니다."
    });

  } catch (err: any) {
    console.error("OpenAI RAG API 실행 중 에러 발생:", err);
    return NextResponse.json(
      { error: "RAG 실행 오류", detail: err.message || err },
      { status: 500 }
    );
  } finally {
    // 7. Cleanup ephemeral thread & assistant resources to prevent leaks
    if (thread?.id) {
      await openai.beta.threads.del(thread.id).catch(err => console.error("Thread 삭제 실패:", err));
    }
    if (assistant?.id) {
      await openai.beta.assistants.del(assistant.id).catch(err => console.error("Assistant 삭제 실패:", err));
    }
  }
}
