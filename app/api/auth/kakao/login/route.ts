import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const host = request.headers.get("host") || "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const redirectUri = `${protocol}://${host}`;

    const apiKey = process.env.KAKAO_REST_API_KEY;
    
    // Check if the key is not set or has placeholder value
    if (!apiKey || apiKey === "your-kakao-rest-api-key-here") {
      console.error("[KAKAO AUTH] KAKAO_REST_API_KEY is not configured.");
      return NextResponse.json(
        { error: "카카오 API 키가 서버에 설정되지 않았습니다. 관리자에게 문의하세요." },
        { status: 500 }
      );
    }

    const kakaoUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${apiKey}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;

    console.log(`[KAKAO AUTH] Redirecting to Kakao OAuth: ${redirectUri}`);
    return NextResponse.redirect(kakaoUrl, 307);
  } catch (error: any) {
    console.error("[KAKAO AUTH] Redirection error:", error);
    return NextResponse.json(
      { error: "로그인 페이지로 이동 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
