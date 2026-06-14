import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey || geminiKey === "your-gemini-api-key-here" || geminiKey.trim() === "") {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    // Convert the audio file to Base64
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");
    const mimeType = file.type || "audio/webm";

    // Call Gemini API with the audio file inline
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`;
    
    const promptText = "이 대화는 DB손해보험 PA(설계사)의 영업 활동을 지원하는 인공지능 멘토 '프로미'와의 음성 대화입니다. 보험 약관, 고객 응대, 영업 지원, 상품 설명 등 보험 업무 전반에 관한 질문과 답변이 주를 이룹니다. 질문하는 어조인 경우에는 문장 끝에 물음표(?)를 정확하게 붙여 전사하고, '알려줘', '설명해줘', '알려주세요'와 같이 요청하는 경우에는 문장 끝에 느낌표(!) 또는 마침표(.)를 문맥에 맞게 표기해 주세요. 기침 소리, 한숨 소리, '어', '음', '아', '네' 등의 무의미한 잡음이나 단순 감탄사는 받아쓰지 마세요. 오직 오디오 파일에서 사용자가 말한 한국어 음성만을 텍스트로 정확하게 받아쓰기(전사)하여 출력하세요. 아무런 설명이나 부연 설명 없이 오직 받아쓴 한글 텍스트만 그대로 출력해 주세요.";

    const requestBody = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: promptText
            }
          ]
        }
      ]
    };

    const res = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini STT API Error (HTTP ${res.status}): ${errText}`);
    }

    const resJson = await res.json();
    const transcribedText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const usage = resJson.usageMetadata || {};
    const promptTokenCount = usage.promptTokenCount || 0;
    const candidatesTokenCount = usage.candidatesTokenCount || 0;

    // gemini-3.1-flash-lite pricing: $0.125/1M input, $0.75/1M output * 1400₩ (official pricing)
    const inputCost = promptTokenCount * 0.000175;
    const outputCost = candidatesTokenCount * 0.00105;
    const cost = inputCost + outputCost;

    const userId = formData.get("userId") as string;

    if (userId && cost > 0) {
      try {
        const { incrementUserCost } = await import("@/lib/firebase");
        // Save STT cost in whisperCost field (represented as STT 사용료 in UI)
        await incrementUserCost(userId, "whisper", cost);
        console.log(`[Gemini STT Cost Log] Added ₩${cost.toFixed(4)} (Tokens: ${promptTokenCount}/${candidatesTokenCount}) to user ${userId}`);
      } catch (dbErr) {
        console.error("[Gemini STT Cost Log] Failed to update user cost:", dbErr);
      }
    }

    const rawText = transcribedText.trim();
    const processedText = appendPunctuationByContext(rawText);

    return NextResponse.json({ text: processedText });
  } catch (err: any) {
    console.error("Gemini STT Transcription failed:", err);
    return NextResponse.json(
      { error: "Transcription failed", detail: err.message || err },
      { status: 500 }
    );
  }
}

// 문맥 기반 문장부호 자동 교정 헬퍼 함수
function appendPunctuationByContext(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return trimmed;
  
  // 이미 문장부호(. ! ?)로 종결된 경우 그대로 반환
  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }
  
  // 의문형 어미 감지 패턴 (예: ~가 좋아, ~인가요, ~있나요, ~될까요 등)
  const questionPattern = /(?:가요|나요|되나요|있나요|없나요|될까요|할까요|인가요|무엇인가요|뭐야|맞나요|좋아|맞아|돼|있어|있지|인가|의미인가|차이인가|기준인가|좋은가)$/;
  // 요청 및 명령형 어미 감지 패턴 (예: ~알려줘, ~해줘, ~부탁해 등)
  const requestPattern = /(?:알려줘|설명해줘|보여줘|해줘|부탁해|알려주세요|설명해주세요|해주세요|바랄게|바랍니다)$/;

  if (questionPattern.test(trimmed)) {
    return trimmed + "?";
  } else if (requestPattern.test(trimmed)) {
    return trimmed + "!";
  }
  
  return trimmed;
}
