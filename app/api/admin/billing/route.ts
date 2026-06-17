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
    const limit = process.env.GCP_BILLING_LIMIT ? Number(process.env.GCP_BILLING_LIMIT) : 16000; // 선불 예산 한도

    const offset = process.env.GCP_BILLING_OFFSET ? Number(process.env.GCP_BILLING_OFFSET) : 0;

    // 1. Fetch real-time user costs from Firestore first (100% real-time sync)
    let dbSpend = offset;
    try {
      const { getAllUsers } = await import("@/lib/firebase");
      const allUsers = await getAllUsers();
      const firestoreTotal = allUsers.reduce((sum, u) => sum + (u.geminiCost || 0) + (u.whisperCost || 0), 0);
      dbSpend = Math.round(firestoreTotal) + offset;
      console.log(`[ADMIN BILLING] Firestore Real-time total calculated: ₩${dbSpend} (Offset: ₩${offset})`);
    } catch (fbErr) {
      console.error("[ADMIN BILLING] Failed to calculate real-time Firestore cost:", fbErr);
    }

    // 환경 변수가 아예 설정되지 않은 경우 Firestore 실시간 데이터로 안전하게 폴백
    if (!serviceAccountKey || !billingTableId) {
      console.warn("[ADMIN BILLING] GCP environment variables are not set. Falling back to Firestore real-time total.");
      return NextResponse.json({
        success: true,
        spend: dbSpend,
        limit: limit,
        balance: Math.max(0, limit - dbSpend),
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

      const queryOptions: any = { query };
      const debugQuery = `
        SELECT cost, invoice.month, usage_start_time, service.description, project.id as project_id
        FROM \`${billingTableId}\`
        ORDER BY usage_start_time DESC
        LIMIT 10
      `;
      const debugOptions: any = { query: debugQuery };

      if (process.env.GCP_BIGQUERY_LOCATION) {
        queryOptions.location = process.env.GCP_BIGQUERY_LOCATION;
        debugOptions.location = process.env.GCP_BIGQUERY_LOCATION;
      }
      
      const [rows] = await bigquery.query(queryOptions);
      let debugRows: any[] = [];
      try {
        const [dRows] = await bigquery.query(debugOptions);
        debugRows = dRows;
      } catch (dErr: any) {
        debugRows = [{ error: dErr.message }];
      }
      
      // cost 값에 소수점이 포함되어 있을 수 있고 원화로 환산하기 위해 소수점 버림/반올림 처리
      const totalCost = rows[0]?.totalSpend || 0;
      const bqSpend = Math.round(Number(totalCost)) + offset;
      const spend = Math.max(bqSpend, dbSpend);
      const balance = Math.max(0, limit - spend);

      return NextResponse.json({
        success: true,
        spend,
        limit,
        balance,
        status: "active",
        debug: debugRows
      });
    } catch (dbError: any) {
      // 테이블이 존재하지 않거나 초기 내보내기 딜레이(24시간) 중인 경우의 예외 처리
      console.error("[ADMIN BILLING] BigQuery query error:", dbError);
      
      let extraInfo = "";
      try {
        const parts = billingTableId.split(".");
        const datasetId = parts.length >= 2 ? parts[parts.length - 2] : "gcp_billing";
        
        const credentials = JSON.parse(serviceAccountKey);
        const bigquery = new BigQuery({
          projectId: credentials.project_id,
          credentials,
        });
        
        const dataset = bigquery.dataset(datasetId);
        const [tables] = await dataset.getTables();
        const tableIds = tables.map(t => t.id);
        
        if (tableIds.length === 0) {
          extraInfo = `\n🔍 진단 결과: '${datasetId}' 데이터세트는 존재하지만 내부에 결제 테이블이 아직 0개입니다. (구글 클라우드 결제 데이터의 첫 전송 대기 상태가 확실합니다)`;
        } else {
          extraInfo = `\n🔍 진단 결과: '${datasetId}' 데이터세트 내에 존재하는 테이블 목록은 [${tableIds.join(", ")}] 입니다. 설정하신 환경 변수 테이블 ID와 스펠링이 일치하는지 대조해 보세요.`;
        }
      } catch (inspectErr: any) {
        console.error("[ADMIN BILLING INSPECT] Failed to list tables:", inspectErr);
        extraInfo = `\n🔍 진단 결과: 데이터세트 목록 조회 자체가 실패했습니다 (${inspectErr.message})`;
      }

      // 테이블 미생성이나 권한 부족인 경우 Firestore 데이터 기준으로 실시간 표기하여 크래시 방지
      return NextResponse.json({
        success: true,
        spend: dbSpend,
        limit: limit,
        balance: Math.max(0, limit - dbSpend),
        status: "error_fallback",
        errorDetails: dbError.message + extraInfo
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

