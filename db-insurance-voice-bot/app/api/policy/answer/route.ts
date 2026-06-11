import { NextResponse } from "next/server";
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

  const answer = buildPolicyAnswer({
    question,
    intent: body.intent ?? classifyIntent(question),
    productHint: body.product_hint
  });

  return NextResponse.json(answer);
}
