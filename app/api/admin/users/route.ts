import { NextResponse } from "next/server";
import { getAllUsers, getUser, upsertUser, getUserChatLogs, updateUserLastActiveAt } from "@/lib/firebase";

// Helper for administrative token authentication check
function verifyAdmin(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  return authHeader === "Bearer admin-auth-session-token-2026";
}

// GET: Fetch all registered Kakao users from DB
export async function GET(request: Request) {
  try {
    if (!verifyAdmin(request)) {
      return NextResponse.json({ error: "인증 권한이 없습니다." }, { status: 401 });
    }

    const users = await getAllUsers();

    // Auto-heal: Verify and align lastActiveAt with the actual last chat message timestamp from chat_logs
    const healedUsers = await Promise.all(
      users.map(async (user) => {
        try {
          const logs = await getUserChatLogs(user.id);
          if (logs.length > 0) {
            const latestLog = logs[logs.length - 1];
            const latestTimestamp = latestLog.timestamp;

            // If the recorded lastActiveAt differs from the actual latest chat log timestamp, correct it in DB
            if (user.lastActiveAt !== latestTimestamp) {
              console.log(`[HEALER] Aligning user ${user.nickname} (${user.id}) activity time to actual last message: ${latestTimestamp} (was ${user.lastActiveAt})`);
              await updateUserLastActiveAt(user.id, latestTimestamp);
              return { ...user, lastActiveAt: latestTimestamp };
            }
          }
        } catch (healErr) {
          console.error(`[HEALER] Error healing user ${user.id}:`, healErr);
        }
        return user;
      })
    );

    // Re-sort healed users by latest lastActiveAt (or updatedAt as fallback)
    healedUsers.sort(
      (a: any, b: any) => new Date(b.lastActiveAt || b.updatedAt).getTime() - new Date(a.lastActiveAt || a.updatedAt).getTime()
    );

    return NextResponse.json({ success: true, users: healedUsers });
  } catch (error: any) {
    console.error("[ADMIN USERS GET] Error:", error);
    return NextResponse.json(
      { error: "사용자 목록을 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST: Toggle user status (approved/blocked) in DB
export async function POST(request: Request) {
  try {
    if (!verifyAdmin(request)) {
      return NextResponse.json({ error: "인증 권한이 없습니다." }, { status: 401 });
    }

    const { userId, status } = await request.json();

    if (!userId || !status) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    if (status !== "approved" && status !== "blocked") {
      return NextResponse.json({ error: "올바르지 않은 상태 값입니다." }, { status: 400 });
    }

    // Retrieve the existing user profile details to prevent data loss
    const existing = await getUser(userId);
    if (!existing) {
      return NextResponse.json({ error: "가입되어 있지 않은 사용자입니다." }, { status: 404 });
    }

    // Save update in Firestore DB
    const updated = await upsertUser(userId, existing.nickname, existing.profileImage, status);
    console.log(`[ADMIN CONTROL] Changed user ${existing.nickname} status to ${status}`);

    return NextResponse.json({ success: true, user: updated });
  } catch (error: any) {
    console.error("[ADMIN USERS POST] Status update error:", error);
    return NextResponse.json(
      { error: "사용자 상태를 업데이트하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
