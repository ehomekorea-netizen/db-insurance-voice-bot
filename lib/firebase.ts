export interface FirestoreUser {
  id: string;
  nickname: string;
  profileImage: string;
  status: "approved" | "blocked";
  updatedAt: string;
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

// 사용자 생성 및 프로필 업데이트 (기존 status 보존)
export async function upsertUser(
  kakaoId: string,
  nickname: string,
  profileImage: string,
  status?: "approved" | "blocked"
): Promise<FirestoreUser | null> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return null;

  try {
    // Preserve existing status if not explicitly passed
    const existing = await getUser(kakaoId);
    const finalStatus = status || existing?.status || "approved";

    const fields: any = {
      nickname: { stringValue: nickname },
      profileImage: { stringValue: profileImage },
      status: { stringValue: finalStatus },
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
  return {
    id,
    nickname: fields.nickname?.stringValue || "",
    profileImage: fields.profileImage?.stringValue || "",
    status: (fields.status?.stringValue || "approved") as "approved" | "blocked",
    updatedAt: fields.updatedAt?.stringValue || new Date().toISOString()
  };
}
