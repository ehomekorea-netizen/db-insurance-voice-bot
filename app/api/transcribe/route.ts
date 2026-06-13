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
      prompt: "이 대화는 DB손해보험 PA(설계사)의 영업 활동을 지원하는 인공지능 멘토 '프로미'와의 음성 대화입니다. 보험 약관, 고객 응대, 영업 지원, 상품 설명 등 보험 업무 전반에 관한 질문과 답변이 주를 이룹니다. 기침 소리, 한숨 소리, '어', '음', '아', '네' 등의 무의미한 잡음이나 단순 감탄사는 받아쓰지 마시고 무시하세요. 보험 상담과 영업 지원 관련 내용만 정확하게 한국어로 전사해 주세요.",
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

    return NextResponse.json({ text: transcription.text || "" });
  } catch (err: any) {
    console.error("OpenAI Whisper Transcription failed:", err);
    return NextResponse.json(
      { error: "Transcription failed", detail: err.message || err },
      { status: 500 }
    );
  }
}
