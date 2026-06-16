"use client";

import { useState, useEffect } from "react";

interface UserRecord {
  id: string;
  nickname: string;
  profileImage: string;
  status: "approved" | "blocked";
  updatedAt: string;
  lastActiveAt?: string;
  geminiCost?: number;
  whisperCost?: number;
  groundingCount?: number;
}

interface BillingData {
  spend: number;
  limit: number;
  balance: number;
  status: string;
  errorDetails?: string;
  debug?: any[];
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  // Billing States
  // Tab State ("users": 가입 사용자 목록, "billing": 구글 API 사용량)
  const [activeTab, setActiveTab] = useState<"users" | "billing">("users");

  // Sorting States
  const [sortKey, setSortKey] = useState<"updatedAt" | "totalCost">("updatedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Sort Handler
  const handleSort = (key: "updatedAt" | "totalCost") => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("desc"); // 다른 열을 누르면 우선 내림차순(최신/최고 비용순)으로 시작
    }
  };

  // Billing States
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);


  // Chat Logs Modal States
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserNickname, setSelectedUserNickname] = useState<string>("");
  const [chatLogs, setChatLogs] = useState<any[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  // Auto restore login session from localStorage
  useEffect(() => {
    const savedToken = localStorage.getItem("admin_session_token");
    if (savedToken) {
      setToken(savedToken);
      setIsLoggedIn(true);
      fetchUserList(savedToken);
      fetchBillingData(savedToken);
    }
  }, []);


  // Fetch users list from backend API
  const fetchUserList = async (authToken: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 401) {
          handleLogout();
          throw new Error("인증 세션이 만료되었습니다.");
        }
        throw new Error("사용자 목록을 가져오지 못했습니다.");
      }
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (err: any) {
      setError(err.message || "목록 조회 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch billing details from Google Cloud
  const fetchBillingData = async (authToken: string) => {
    setIsBillingLoading(true);
    setBillingError(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        throw new Error("결제 정보를 가져오지 못했습니다.");
      }
      const data = await res.json();
      if (data.success) {
        setBillingData({
          spend: data.spend,
          limit: data.limit,
          balance: data.balance,
          status: data.status,
          errorDetails: data.errorDetails,
          debug: data.debug
        });
      }
    } catch (err: any) {
      setBillingError(err.message || "결제 정보 조회 중 오류가 발생했습니다.");
    } finally {
      setIsBillingLoading(false);
    }
  };

  // Combined refresh helper
  const handleRefreshAll = async (authToken: string) => {
    await Promise.all([
      fetchUserList(authToken),
      fetchBillingData(authToken)
    ]);
  };

  // Submit passcode
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "비밀번호가 올바르지 않습니다.");
      }
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem("admin_session_token", data.token);
        setToken(data.token);
        setIsLoggedIn(true);
        fetchUserList(data.token);
        fetchBillingData(data.token);
      }
    } catch (err: any) {
      setError(err.message || "로그인에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // Session termination
  const handleLogout = () => {
    localStorage.removeItem("admin_session_token");
    setToken(null);
    setIsLoggedIn(false);
    setUsers([]);
    setBillingData(null);
    setBillingError(null);
    setError(null);
  };

  // Change user status (Approved <-> Blocked)
  const toggleUserStatus = async (userId: string, currentStatus: "approved" | "blocked") => {
    if (!token) return;
    const newStatus = currentStatus === "approved" ? "blocked" : "approved";
    const confirmMsg =
      newStatus === "blocked"
        ? "해당 사용자를 차단하시겠습니까? 로그인 정보는 남으나 대화방 진입이 통제됩니다."
        : "해당 사용자의 차단을 해제하고 서비스 사용을 다시 승인하시겠습니까?";

    if (!window.confirm(confirmMsg)) return;

    setActionUserId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ userId, status: newStatus })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "상태 업데이트 실패");
      }

      await fetchUserList(token);
    } catch (err: any) {
      alert(err.message || "상태 변경 중 오류가 발생했습니다.");
    } finally {
      setActionUserId(null);
    }
  };

  // Fetch user's chat logs
  const handleViewChatLogs = async (userId: string, nickname: string) => {
    setSelectedUserId(userId);
    setSelectedUserNickname(nickname);
    setIsLogsLoading(true);
    setChatLogs([]);
    try {
      const res = await fetch(`/api/admin/messages?userId=${userId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error("대화 기록을 가져오지 못했습니다.");
      }
      const data = await res.json();
      if (data.success) {
        setChatLogs(data.logs || []);
      }
    } catch (err: any) {
      alert(err.message || "대화 기록 조회 실패");
    } finally {
      setIsLogsLoading(false);
    }
  };

  // Delete user's chat logs in Firebase (hard delete)
  const handleDeleteChatLogs = async (userId: string) => {
    if (!window.confirm("이 사용자의 모든 대화 기록을 DB(Firebase)에서 영구적으로 삭제하시겠습니까?\n삭제된 데이터는 완전히 지워지며 복구할 수 없습니다.")) return;

    try {
      const res = await fetch(`/api/admin/messages?userId=${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error("대화 기록 삭제에 실패했습니다.");
      }
      const data = await res.json();
      if (data.success) {
        alert("대화 기록을 DB에서 영구 삭제하여 보관 공간을 확보했습니다.");
        setChatLogs([]);
      }
    } catch (err: any) {
      alert(err.message || "삭제 도중 에러가 발생했습니다.");
    }
  };

  const formatDate = (isoStr: string) => {
    try {
      const date = new Date(isoStr);
      return date.toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch {
      return isoStr;
    }
  };

  if (!isLoggedIn) {
    return (
      <main className="admin-login-shell">
        <div className="admin-login-card">
          <div className="admin-logo">
            <img src="/promy.png" alt="PROMY" />
            <h1>동목포 오멘토 어드민</h1>
            <p>가입 사용자 접근 제어 시스템</p>
          </div>

          <form onSubmit={handleLogin} className="admin-login-form">
            <div className="input-group">
              <label htmlFor="admin-pw">관리자 비밀번호</label>
              <input
                id="admin-pw"
                type="password"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {error && <div className="admin-error-text">{error}</div>}

            <button type="submit" className="admin-submit-btn" disabled={isLoading}>
              {isLoading ? "인증 확인 중..." : "관리자 로그인"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-dashboard-shell">
      <header className="admin-dashboard-header">
        <div className="admin-header-title">
          <img src="/promy.png" alt="PROMY" className="admin-header-logo" />
          <div>
            <h1>동목포 오멘토 관리자</h1>
            <p>실시간 가입자 조회 및 차단 관리</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            onClick={() => token && handleRefreshAll(token)}
            className="admin-refresh-btn"
            disabled={isLoading || isBillingLoading}
            title="새로고침"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-refresh-cw"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          </button>
          <button onClick={handleLogout} className="admin-logout-btn">
            로그아웃
          </button>
        </div>
      </header>

      <section className="admin-dashboard-content">
        {/* 서류철 라벨 탭 디자인 */}
        <div className="admin-tab-wrapper">
          <div
            onClick={() => setActiveTab("users")}
            className={`admin-tab-item ${activeTab === "users" ? "active" : "inactive"}`}
          >
            📂 가입 사용자 목록
          </div>
          <div
            onClick={() => setActiveTab("billing")}
            className={`admin-tab-item ${activeTab === "billing" ? "active" : "inactive"}`}
          >
            💳 Google API 사용량
          </div>
        </div>

        {/* 탭 1: 가입 사용자 목록 */}
        {activeTab === "users" && (() => {
          // 렌더링용 정렬 배열 연산
          const sortedUsers = [...users].sort((a, b) => {
            let valA: number | string = 0;
            let valB: number | string = 0;

            if (sortKey === "totalCost") {
              valA = (a.geminiCost || 0) + (a.whisperCost || 0);
              valB = (b.geminiCost || 0) + (b.whisperCost || 0);
            } else if (sortKey === "updatedAt") {
              valA = a.lastActiveAt || a.updatedAt || "";
              valB = b.lastActiveAt || b.updatedAt || "";
            }

            if (valA < valB) return sortDirection === "asc" ? -1 : 1;
            if (valA > valB) return sortDirection === "asc" ? 1 : -1;
            return 0;
          });

          return (
            <div className="admin-card-panel">
              <div className="panel-header">
                <h2>가입 사용자 목록 ({users.length}명)</h2>
              </div>

              {error && <div className="admin-error-banner">{error}</div>}

              {isLoading && users.length === 0 ? (
                <div className="admin-loading-spinner">가입자 데이터를 읽어오는 중...</div>
              ) : users.length === 0 ? (
                <div className="admin-empty-state">아직 접속한 사용자가 없습니다.</div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-user-table">
                    <thead>
                      <tr>
                        <th>작업</th>
                        <th>프로필</th>
                        <th>STT 사용료</th>
                        <th>API 비용<br/>(그라운딩 횟수)</th>
                        <th 
                          onClick={() => handleSort("totalCost")} 
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="총 비용 정렬"
                        >
                          총 비용 {sortKey === "totalCost" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
                        </th>
                        <th 
                          onClick={() => handleSort("updatedAt")} 
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="최종 활동 시각 정렬"
                        >
                          최종 활동 시각 {sortKey === "updatedAt" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
                        </th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUsers.map((user) => (
                        <tr key={user.id} className={user.status === "blocked" ? "blocked-row" : ""}>
                          {/* 1. 작업 */}
                          <td>
                            <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                              <button
                                onClick={() => toggleUserStatus(user.id, user.status)}
                                className={`admin-action-btn ${
                                  user.status === "approved" ? "block-action" : "approve-action"
                                }`}
                                disabled={actionUserId === user.id}
                                style={{ padding: "4px 8px" }}
                              >
                                {actionUserId === user.id
                                  ? "..."
                                  : user.status === "approved"
                                  ? "차단"
                                  : "승인/해제"}
                              </button>
                              <button
                                onClick={() => handleViewChatLogs(user.id, user.nickname)}
                                className="admin-action-btn approve-action"
                                style={{ background: "var(--accent-teal, #10b981)", borderColor: "var(--text-ink)", padding: "4px 8px" }}
                              >
                                기록
                              </button>
                            </div>
                          </td>
                          {/* 2. 프로필 (아바타 이미지 + 아래에 이름 배치) */}
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                              <div className="admin-table-avatar" style={{ margin: 0 }}>
                                {user.profileImage ? (
                                  <img src={user.profileImage} alt={user.nickname} />
                                ) : (
                                  <div className="admin-avatar-placeholder">
                                    {user.nickname ? user.nickname.slice(0, 2) : "PA"}
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: "11px", fontWeight: "900", color: "var(--text-ink)", whiteSpace: "nowrap" }}>
                                {user.nickname}
                              </span>
                            </div>
                          </td>
                          {/* 3. STT 사용료 */}
                          <td>
                            ₩{(user.whisperCost || 0).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          </td>
                          {/* 4. API 비용 */}
                          <td>
                            ₩{(user.geminiCost || 0).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}<br/>({user.groundingCount || 0}회)
                          </td>
                          {/* 5. 총 비용 */}
                          <td style={{ fontWeight: "700" }}>
                            ₩{((user.geminiCost || 0) + (user.whisperCost || 0)).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          </td>
                          {/* 6. 최종 활동 시각 */}
                          <td className="text-gray" style={{ fontSize: "11px" }}>
                            {formatDate(user.lastActiveAt || user.updatedAt)}
                          </td>
                          {/* 7. 상태 */}
                          <td>
                            <span className={`status-badge ${user.status}`} style={{ fontSize: "10.5px", padding: "2px 6px" }}>
                              {user.status === "approved" ? "승인됨 🟢" : "차단됨 🔴"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        {/* 탭 2: Google API 사용량 및 잔액 카드 */}
        {activeTab === "billing" && (
          <div className="admin-card-panel">
            <div className="panel-header">
              <h2>Google API 실시간 사용량 및 잔액</h2>
              {billingData?.status === "mock_fallback" && (
                <span style={{ fontSize: "11px", color: "var(--accent-teal, #10b981)", fontWeight: "bold" }}>
                  (데모 모드)
                </span>
              )}
              {billingData?.status === "error_fallback" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: "bold" }}>
                    (연동 대기중 - 테이블 생성 중)
                  </span>
                  {billingData.errorDetails && (
                    <p style={{ 
                      fontSize: "10px", 
                      color: "#dc2626", 
                      background: "#fef2f2", 
                      padding: "6px 10px", 
                      border: "1.5px solid #fee2e2", 
                      borderRadius: "6px", 
                      fontWeight: "normal",
                      margin: "4px 0 0 0",
                      textAlign: "left",
                      whiteSpace: "pre-wrap"
                    }}>
                      🚨 구글 에러 원인: {billingData.errorDetails}
                    </p>
                  )}
                </div>
              )}
            </div>
            
            {isBillingLoading && !billingData ? (
              <div className="admin-loading-spinner" style={{ padding: "20px 0" }}>결제 데이터를 가져오는 중...</div>
            ) : billingError ? (
              <div className="admin-error-banner">{billingError}</div>
            ) : billingData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0" }}>
                {/* 1행: 남은 잔액 (가장 크고 돋보이게) */}
                <div>
                  <span style={{ fontSize: "13px", fontWeight: "bold", color: "#64748b" }}>남은 잔액</span>
                  <div style={{ fontSize: "36px", fontWeight: "900", color: "var(--accent-teal, #10b981)", marginTop: "4px" }}>
                    ₩{billingData.balance.toLocaleString("ko-KR")}
                  </div>
                </div>

                {/* 2행: 누적 사용량 (줄바꿈하여 구분) */}
                <div style={{ borderTop: "1.5px dashed var(--panel-border)", paddingTop: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "bold", color: "#64748b" }}>누적 사용량</span>
                  <div style={{ fontSize: "18px", fontWeight: "bold", color: "var(--text-ink, #20343A)", marginTop: "4px" }}>
                    ₩{billingData.spend.toLocaleString("ko-KR")} / ₩{billingData.limit.toLocaleString("ko-KR")}
                  </div>
                </div>

                {/* 3행: 진행 상태 바 (Progress bar) */}
                <div style={{ width: "100%", height: "16px", background: "#e2e8f0", borderRadius: "8px", overflow: "hidden", border: "2px solid var(--text-ink)", marginTop: "4px" }}>
                  <div 
                    style={{ 
                      width: `${Math.min(100, (billingData.spend / billingData.limit) * 100)}%`, 
                      height: "100%", 
                      background: "var(--accent-red, #f43f5e)", 
                      transition: "width 0.4s ease-out" 
                    }} 
                  />
                </div>

                {/* 안내 문구 */}
                <div style={{ fontSize: "12px", color: "#64748b", lineHeight: "1.4" }}>
                  💡 이번 달(당월 1일~현재) 구글 AI Studio에서 사용된 실시간 API 비용 합산 정보입니다. <br />
                  선불 충전금 <strong>₩{billingData.limit.toLocaleString("ko-KR")}</strong> 기준으로 소모 시 잔액이 자동으로 갱신됩니다.
                </div>

                {billingData.debug && (
                  <pre style={{ 
                    fontSize: "10px", 
                    background: "#f1f5f9", 
                    padding: "10px", 
                    borderRadius: "6px", 
                    overflow: "auto", 
                    maxHeight: "200px", 
                    marginTop: "12px", 
                    textAlign: "left",
                    border: "1.5px solid var(--panel-border, #e2e8f0)",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: "var(--text-ink)"
                  }}>
                    🔍 BigQuery 실시간 테이블 데이터 진단 목록 (최근 10건):
                    {"\n" + JSON.stringify(billingData.debug, null, 2)}
                  </pre>
                )}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {selectedUserId && (
        <div className="admin-modal-overlay" onClick={() => setSelectedUserId(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2>{selectedUserNickname}님의 대화 기록</h2>
                <p style={{ display: "inline-flex", alignItems: "center", gap: "6px", margin: "2px 0 0 0" }}>
                  카카오 ID: <span style={{ fontWeight: "750", color: "var(--text-ink)" }}>{selectedUserId}</span>
                  <button 
                    onClick={() => {
                      if (selectedUserId) {
                        navigator.clipboard.writeText(selectedUserId);
                        alert("카카오 ID가 클립보드에 복사되었습니다.");
                      }
                    }}
                    style={{
                      background: "#e2e8f0",
                      border: "1.5px solid var(--text-ink, #20343A)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: "900",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "2px",
                      boxShadow: "1px 1px 0px var(--text-ink, #20343A)",
                      color: "var(--text-ink)"
                    }}
                    title="카카오 ID 복사"
                  >
                    복사 📋
                  </button>
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {chatLogs.length > 0 && (
                  <button 
                    onClick={() => handleDeleteChatLogs(selectedUserId)}
                    style={{
                      background: "#fee2e2",
                      border: "2px solid var(--text-ink, #20343A)",
                      color: "#991b1b",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontSize: "12.5px",
                      fontWeight: "800",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      boxShadow: "2px 2px 0px var(--text-ink, #20343A)"
                    }}
                    title="이 사용자의 전체 대화 기록 영구 삭제"
                  >
                    대화 삭제 🗑️
                  </button>
                )}
                <button className="modal-close-btn" onClick={() => setSelectedUserId(null)}>
                  &times;
                </button>
              </div>
            </header>
            
            <div className="modal-body">
              {isLogsLoading ? (
                <div className="modal-loading">대화 기록을 불러오는 중...</div>
              ) : chatLogs.length === 0 ? (
                <div className="modal-empty">아직 기록된 대화가 없습니다.</div>
              ) : (
                <div className="modal-chat-list">
                  {chatLogs.map((log) => (
                    <div key={log.id} className={`modal-chat-item ${log.role}`}>
                      <div className="chat-bubble-header">
                        <span className="chat-sender">
                          {log.role === "user" ? selectedUserNickname : "프로미"}
                        </span>
                        <span className="chat-time">
                          {formatDate(log.timestamp)}
                        </span>
                      </div>
                      <div className="chat-bubble-content">
                        {log.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
