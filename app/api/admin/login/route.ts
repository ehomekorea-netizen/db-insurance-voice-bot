import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();

    const adminPassword = process.env.ADMIN_PASSWORD || "dbmokpo777";

    if (!password) {
      return NextResponse.json({ error: "비밀번호를 입력해야 합니다." }, { status: 400 });
    }

    if (password !== adminPassword) {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 401 });
    }

    // Return a mock static token for dashboard authentication check
    return NextResponse.json({
      success: true,
      token: "admin-auth-session-token-2026"
    });
  } catch (error: any) {
    console.error("[ADMIN LOGIN] Handler error:", error);
    return NextResponse.json({ error: "서버 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
