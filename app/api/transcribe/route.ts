import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    // Call OpenAI Whisper API to transcribe the audio file
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "ko",
      prompt: "이 대화는 DB손해보험 PA(설계사)의 영업 활동을 지원하는 인공지능 멘토 '프로미'와의 음성 대화입니다. 보험 약관, 고객 응대, 영업 지원, 상품 설명 등 보험 업무 전반에 관한 질문과 답변이 주를 이룹니다. 질문하는 어조인 경우에는 문장 끝에 물음표(?)를 정확하게 붙여 전사하고, '알려줘', '설명해줘', '알려주세요'와 같이 요청하는 경우에는 문장 끝에 느낌표(!) 또는 마침표(.)를 문맥에 맞게 표기해 주세요. 기침 소리, 한숨 소리, '어', '음', '아', '네' 등의 무의미한 잡음이나 단순 감탄사는 받아쓰지 마세요.",
    });

    const duration = formData.get("duration") as string;
    const userId = formData.get("userId") as string;

    const durationSec = duration ? Math.max(0, parseInt(duration, 10)) : 0;
    const cost = durationSec * 0.14; // $0.006 / 60s * 1400₩ = 0.14₩ per second

    if (userId && cost > 0) {
      try {
        const { incrementUserCost } = await import("@/lib/firebase");
        await incrementUserCost(userId, "whisper", cost);
        console.log(`[Whisper Cost Log] Added ₩${cost.toFixed(3)} (Sec: ${durationSec}) to user ${userId}`);
      } catch (dbErr) {
        console.error("[Whisper Cost Log] Failed to update user cost:", dbErr);
      }
    }

    const rawText = transcription.text || "";
    const processedText = appendPunctuationByContext(rawText);

    return NextResponse.json({ text: processedText });
  } catch (err: any) {
    console.error("OpenAI Whisper Transcription failed:", err);
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
