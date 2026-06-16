import { NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

// Helper for administrative token authentication check
function verifyAdmin(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  return authHeader === "Bearer admin-auth-session-token-2026";
}

export async function GET(request: Request) {
  try {
    if (!verifyAdmin(request)) {
      return NextResponse.json({ error: "인증 권한이 없습니다." }, { status: 401 });
    }

    const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
    const billingTableId = process.env.GCP_BILLING_TABLE_ID;
    const limit = 16000; // 선불 예산 한도 (16,000원)

    // 환경 변수가 아예 설정되지 않은 경우 모크 데이터로 안전하게 폴백
    if (!serviceAccountKey || !billingTableId) {
      console.warn("[ADMIN BILLING] GCP environment variables are not set. Falling back to mock data.");
      return NextResponse.json({
        success: true,
        spend: 0,
        limit: limit,
        balance: limit,
        status: "mock_fallback"
      });
    }

    try {
      const credentials = JSON.parse(serviceAccountKey);
      const realProjectId = credentials.project_id;

      // Force process.env project override to bypass auto-detected gen-lang-client from Gemini API key
      if (realProjectId) {
        process.env.GOOGLE_CLOUD_PROJECT = realProjectId;
        process.env.GCLOUD_PROJECT = realProjectId;
      }

      // BigQuery 클라이언트 초기화
      const bigquery = new BigQuery({
        projectId: realProjectId,
        credentials,
      });

      // 이번 달의 총 지출액을 합산하는 쿼리
      const query = `
        SELECT SUM(cost) as totalSpend
        FROM \`${billingTableId}\`
        WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
      `;

      const [rows] = await bigquery.query({
        query,
        location: process.env.GCP_BIGQUERY_LOCATION || "US"
      });
      
      // cost 값에 소수점이 포함되어 있을 수 있고 원화로 환산하기 위해 소수점 버림/반올림 처리
      const totalCost = rows[0]?.totalSpend || 0;
      const spend = Math.round(Number(totalCost));
      const balance = Math.max(0, limit - spend);

      return NextResponse.json({
        success: true,
        spend,
        limit,
        balance,
        status: "active"
      });
    } catch (dbError: any) {
      // 테이블이 존재하지 않거나 초기 내보내기 딜레이(24시간) 중인 경우의 예외 처리
      console.error("[ADMIN BILLING] BigQuery query error:", dbError);
      
      // 테이블 미생성이나 권한 부족인 경우 0원 처리로 크래시 방지
      return NextResponse.json({
        success: true,
        spend: 0,
        limit: limit,
        balance: limit,
        status: "error_fallback",
        errorDetails: dbError.message
      });
    }
  } catch (error: any) {
    console.error("[ADMIN BILLING GET] Error:", error);
    return NextResponse.json(
      { error: "결제 정보를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

