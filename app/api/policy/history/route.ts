import { NextResponse } from "next/server";
import { getUserChatLogs } from "@/lib/firebase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const logs = await getUserChatLogs(userId);
    return NextResponse.json({ success: true, logs });
  } catch (error: any) {
    console.error("[POLICY HISTORY GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch chat logs", detail: error.message || error },
      { status: 500 }
    );
  }
}
