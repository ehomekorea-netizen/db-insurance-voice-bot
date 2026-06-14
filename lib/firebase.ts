export interface FirestoreUser {
  id: string;
  nickname: string;
  profileImage: string;
  status: "approved" | "blocked";
  updatedAt: string;
  geminiCost: number;
  whisperCost: number;
}

const getBaseUrl = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || projectId === "dummy-firebase-project-id") {
    return null;
  }
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
};

// 특정 사용자 조회
export async function getUser(kakaoId: string): Promise<FirestoreUser | null> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    console.warn("[FIREBASE] Firebase Project ID is not configured. Returning local mock session.");
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/users/${kakaoId}`, {
      method: "GET",
      headers: { "cache-control": "no-cache" }
    });

    if (!res.ok) {
      if (res.status === 404) return null; // User not found
      throw new Error(`Firestore GET error: ${res.statusText}`);
    }

    const doc = await res.json();
    return parseFirestoreDoc(doc);
  } catch (err) {
    console.error(`[FIREBASE] getUser error for ID ${kakaoId}:`, err);
    return null;
  }
}

// 사용자 생성 및 프로필 업데이트 (기존 status 및 cost 보존)
export async function upsertUser(
  kakaoId: string,
  nickname: string,
  profileImage: string,
  status?: "approved" | "blocked",
  geminiCost?: number,
  whisperCost?: number
): Promise<FirestoreUser | null> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return null;

  try {
    // Preserve existing fields if not explicitly passed
    const existing = await getUser(kakaoId);
    const finalStatus = status || existing?.status || "approved";
    const finalGeminiCost = geminiCost !== undefined ? geminiCost : (existing?.geminiCost || 0);
    const finalWhisperCost = whisperCost !== undefined ? whisperCost : (existing?.whisperCost || 0);

    const fields: any = {
      nickname: { stringValue: nickname },
      profileImage: { stringValue: profileImage },
      status: { stringValue: finalStatus },
      geminiCost: { doubleValue: finalGeminiCost },
      whisperCost: { doubleValue: finalWhisperCost },
      updatedAt: { stringValue: new Date().toISOString() }
    };

    // Use PATCH to create or update/merge the document at /users/{kakaoId}
    const res = await fetch(`${baseUrl}/users/${kakaoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore PATCH error: ${res.status} - ${errText}`);
    }

    const doc = await res.json();
    return parseFirestoreDoc(doc);
  } catch (err) {
    console.error(`[FIREBASE] upsertUser error for ID ${kakaoId}:`, err);
    return null;
  }
}

// 사용자 누적 비용 증가 유틸리티
export async function incrementUserCost(
  kakaoId: string,
  type: "gemini" | "whisper",
  amount: number
): Promise<FirestoreUser | null> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return null;

  try {
    const existing = await getUser(kakaoId);
    if (!existing) {
      console.warn(`[FIREBASE] Cannot increment cost. User ${kakaoId} not found.`);
      return null;
    }

    let geminiCost = existing.geminiCost || 0;
    let whisperCost = existing.whisperCost || 0;

    if (type === "gemini") {
      geminiCost += amount;
    } else if (type === "whisper") {
      whisperCost += amount;
    }

    const fields: any = {
      nickname: { stringValue: existing.nickname },
      profileImage: { stringValue: existing.profileImage },
      status: { stringValue: existing.status },
      geminiCost: { doubleValue: geminiCost },
      whisperCost: { doubleValue: whisperCost },
      updatedAt: { stringValue: new Date().toISOString() }
    };

    const res = await fetch(`${baseUrl}/users/${kakaoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });

    if (!res.ok) {
      throw new Error(`Firestore PATCH increment error: ${res.status}`);
    }

    const doc = await res.json();
    return parseFirestoreDoc(doc);
  } catch (err) {
    console.error(`[FIREBASE] incrementUserCost error for ID ${kakaoId}:`, err);
    return null;
  }
}

// 전체 사용자 목록 가져오기
export async function getAllUsers(): Promise<FirestoreUser[]> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return [];

  try {
    const res = await fetch(`${baseUrl}/users?pageSize=150`, {
      method: "GET",
      headers: { "cache-control": "no-cache" }
    });

    if (!res.ok) {
      throw new Error(`Firestore List error: ${res.statusText}`);
    }

    const data = await res.json();
    const documents = data.documents || [];

    const users = documents
      .map(parseFirestoreDoc)
      .filter((u: any): u is FirestoreUser => u !== null);

    // Sort by latest updatedAt first
    return users.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (err) {
    console.error("[FIREBASE] getAllUsers error:", err);
    return [];
  }
}

// Helper: Firestore raw document JSON을 타입 객체로 파싱
function parseFirestoreDoc(doc: any): FirestoreUser | null {
  if (!doc || !doc.name || !doc.fields) return null;

  const nameParts = doc.name.split("/");
  const id = nameParts[nameParts.length - 1];

  const fields = doc.fields;
  
  // doubleValue 혹은 integerValue 모두 지원하도록 파싱
  const parseCost = (val: any) => {
    if (!val) return 0;
    if (val.doubleValue !== undefined) return Number(val.doubleValue);
    if (val.integerValue !== undefined) return Number(val.integerValue);
    return 0;
  };

  return {
    id,
    nickname: fields.nickname?.stringValue || "",
    profileImage: fields.profileImage?.stringValue || "",
    status: (fields.status?.stringValue || "approved") as "approved" | "blocked",
    updatedAt: fields.updatedAt?.stringValue || new Date().toISOString(),
    geminiCost: parseCost(fields.geminiCost),
    whisperCost: parseCost(fields.whisperCost)
  };
}

export interface ChatLogEntry {
  id: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// 사용자 질문/답변 기록 저장
export async function saveChatMessage(
  userId: string,
  role: "user" | "assistant",
  content: string
): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;

  try {
    const fields: any = {
      userId: { stringValue: userId },
      role: { stringValue: role },
      content: { stringValue: content },
      timestamp: { stringValue: new Date().toISOString() }
    };

    const res = await fetch(`${baseUrl}/chat_logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[FIREBASE] saveChatMessage POST error: ${res.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[FIREBASE] saveChatMessage error for user ${userId}:`, err);
    return false;
  }
}

// 사용자별 대화 히스토리 전체 조회
export async function getUserChatLogs(userId: string): Promise<ChatLogEntry[]> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return [];

  try {
    const res = await fetch(`${baseUrl}:runQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "chat_logs" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "userId" },
              op: "EQUAL",
              value: { stringValue: userId }
            }
          }
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[FIREBASE] getUserChatLogs runQuery error: ${res.status} - ${errText}`);
      return [];
    }

    const docs = await res.json();
    if (!Array.isArray(docs)) return [];

    const logs: ChatLogEntry[] = [];
    for (const item of docs) {
      if (item.document && item.document.fields) {
        const doc = item.document;
        const nameParts = doc.name.split("/");
        const id = nameParts[nameParts.length - 1];
        const fields = doc.fields;
        
        logs.push({
          id,
          userId: fields.userId?.stringValue || "",
          role: (fields.role?.stringValue || "user") as "user" | "assistant",
          content: fields.content?.stringValue || "",
          timestamp: fields.timestamp?.stringValue || new Date().toISOString()
        });
      }
    }

    // 시간 오름차순 정렬
    logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return logs;
  } catch (err) {
    console.error(`[FIREBASE] getUserChatLogs error for user ${userId}:`, err);
    return [];
  }
}

// 사용자별 대화 히스토리 전체 삭제 (디스크 물리적 영구 삭제)
export async function deleteUserChatLogs(userId: string): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;

  try {
    const logs = await getUserChatLogs(userId);
    if (logs.length === 0) return true;

    // 각 대화 문서를 개별적으로 DELETE 요청하여 공간을 완전하게 반환(영구삭제)
    const deletePromises = logs.map(async (log) => {
      const res = await fetch(`${baseUrl}/chat_logs/${log.id}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        console.error(`[FIREBASE] Failed to delete document ${log.id}: ${res.statusText}`);
      }
    });

    await Promise.all(deletePromises);
    return true;
  } catch (err) {
    console.error(`[FIREBASE] deleteUserChatLogs error for user ${userId}:`, err);
    return false;
  }
}


