import { NextResponse } from "next/server";
import { getUserChatLogs } from "@/lib/firebase";

// Helper for administrative token authentication check
function verifyAdmin(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  return authHeader === "Bearer admin-auth-session-token-2026";
}

// GET: Fetch conversation logs for a specific user ID
export async function GET(request: Request) {
  try {
    if (!verifyAdmin(request)) {
      return NextResponse.json({ error: "인증 권한이 없습니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "userId 파라미터가 필요합니다." }, { status: 400 });
    }

    const logs = await getUserChatLogs(userId);
    return NextResponse.json({ success: true, logs });
  } catch (error: any) {
    console.error("[ADMIN MESSAGES GET] Error:", error);
    return NextResponse.json(
      { error: "대화 기록을 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
