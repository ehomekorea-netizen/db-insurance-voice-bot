import { NextResponse } from "next/server";
import { realtimeSessionConfig } from "@/lib/realtimeSession";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const safetyIdentifier = request.headers.get("x-user-id") ?? "mvp-anonymous-user";

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier
    },
    body: JSON.stringify(realtimeSessionConfig)
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Failed to create Realtime client secret.",
        detail: data
      },
      { status: response.status }
    );
  }

  return NextResponse.json(data);
}
