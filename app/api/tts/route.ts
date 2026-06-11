import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = body.text?.trim();

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    // Generate speech using the high-quality tts-1 model
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy", // 'alloy' is natural, clear, and highly recognizable for assistants
      input: text,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable", // Cache synthesis output to optimize cost and performance
      },
    });
  } catch (err: any) {
    console.error("OpenAI TTS Generation failed:", err);
    return NextResponse.json(
      { error: "TTS Generation failed", detail: err.message || err },
      { status: 500 }
    );
  }
}
