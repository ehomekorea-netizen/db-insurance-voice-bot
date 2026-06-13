import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { code, redirect_uri } = await request.json();

    if (!code) {
      return NextResponse.json({ error: "Authorization code is required" }, { status: 400 });
    }

    const apiKey = process.env.KAKAO_REST_API_KEY;
    const clientSecret = process.env.KAKAO_CLIENT_SECRET;

    if (!apiKey || apiKey === "your-kakao-rest-api-key-here") {
      console.error("[KAKAO AUTH] KAKAO_REST_API_KEY is not configured.");
      return NextResponse.json({ error: "카카오 API 키가 서버에 설정되지 않았습니다." }, { status: 500 });
    }

    console.log(`[KAKAO AUTH] Exchanging code for token with redirect_uri: ${redirect_uri}`);

    // 1. Get access token from Kakao
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "authorization_code");
    tokenParams.append("client_id", apiKey);
    tokenParams.append("redirect_uri", redirect_uri);
    tokenParams.append("code", code);
    if (clientSecret) {
      tokenParams.append("client_secret", clientSecret);
    }

    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("[KAKAO AUTH] Token request failed:", errorText);
      return NextResponse.json({ error: "카카오 토큰 발급에 실패했습니다.", details: errorText }, { status: 400 });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. Get user info from Kakao
    const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      }
    });

    if (!userRes.ok) {
      const errorText = await userRes.text();
      console.error("[KAKAO AUTH] User info request failed:", errorText);
      return NextResponse.json({ error: "카카오 사용자 정보를 가져오는 데 실패했습니다.", details: errorText }, { status: 400 });
    }

    const userData = await userRes.json();

    // Extract profile details
    const nickname = userData.properties?.nickname || userData.kakao_account?.profile?.nickname || "사용자";
    const profileImage = userData.properties?.thumbnail_image || userData.kakao_account?.profile?.thumbnail_image_url || "";
    const id = userData.id;

    console.log(`[KAKAO AUTH] Successfully authenticated user: ${nickname} (${id})`);

    return NextResponse.json({
      success: true,
      user: {
        id,
        nickname,
        profileImage
      }
    });
  } catch (error: any) {
    console.error("[KAKAO AUTH] Callback handler error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
